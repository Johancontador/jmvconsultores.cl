/**
 * ADAPTADOR MERCADOPAGO — SAAS-3 (primera pasarela del adaptador de pagos).
 *
 * La pasarela elegida primero es MercadoPago porque permite arrancar SIN
 * contrato previo: cuenta self-service + sandbox con tarjetas de prueba.
 * Transbank (Webpay Plus) queda para el segundo adaptador (misma interfaz).
 *
 * Configuración (env):
 *   MP_ACCESS_TOKEN        — token de la app (sandbox o producción)
 *   MP_WEBHOOK_SECRET      — secreto para validar la firma x-signature del
 *                            webhook (opcional: si falta, la confirmación
 *                            sigue siendo segura porque SIEMPRE se re-consulta
 *                            el pago a la API de MP — el webhook solo trae ids)
 *   MP_BASE_URL            — por defecto https://api.mercadopago.com
 *   PAGOS_NOTIFICATION_URL — URL pública del webhook para la preferencia
 *   PAGOS_URL_RETORNO      — back_urls del navegador tras pagar
 *
 * Interfaz que implementa (ver core/pagos.js):
 *   crearPreferencia({ monto_clp, descripcion, external_reference, url_retorno, url_notificacion })
 *   obtenerPago(gatewayPagoId)
 *
 * Usa el fetch global de Node ≥ 18 — cero dependencias nuevas.
 */

const crypto = require('crypto')

function baseUrl() {
  return process.env.MP_BASE_URL || 'https://api.mercadopago.com'
}
function accessToken() {
  return process.env.MP_ACCESS_TOKEN || ''
}

/**
 * Validación de la firma x-signature del webhook (docs de MercadoPago):
 *   manifest = `id:{dataId};request-id:{xRequestId};ts:{ts};`
 *   v1 = HMAC-SHA256(manifest, MP_WEBHOOK_SECRET) en hex
 * x-signature llega como `ts=1699...,v1=abc...` y v1 puede traer varios hashes
 * separados por coma (cualquiera que coincida valida).
 * La validación es defensa en profundidad: el estado del pago SIEMPRE se
 * confirma contra la API de MP aunque la firma no se pueda verificar.
 */
function validarFirmaWebhook({ xSignature, xRequestId, dataId, secret }) {
  if (!xSignature || !dataId || !secret) return false
  // Formato: `ts=1699...,v1=hash1,hash2` — v1 puede continuar con hashes sin
  // la clave repetida (la lista va separada por comas dentro del header).
  const tokens = String(xSignature).split(',').map((s) => s.trim()).filter(Boolean)
  let ts = null
  const v1s = []
  for (const t of tokens) {
    const eq = t.indexOf('=')
    if (eq === -1) {
      if (v1s.length) v1s.push(t) // continuación de la lista v1
      continue
    }
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (k === 'ts' && v) ts = v
    else if (k === 'v1' && v) v1s.push(v)
  }
  if (!ts || !v1s.length) return false
  const manifest = `id:${dataId};request-id:${xRequestId || ''};ts:${ts};`
  const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  return v1s.includes(hmac)
}

/** Crea la preferencia de checkout (Checkout Pro — init_point redirigible). */
async function crearPreferencia({ monto_clp, descripcion, external_reference, url_retorno, url_notificacion }) {
  if (!accessToken()) throw new Error('MercadoPago no configurado: falta MP_ACCESS_TOKEN')
  const body = {
    items: [{ title: descripcion, quantity: 1, currency_id: 'CLP', unit_price: monto_clp }],
    external_reference,
  }
  if (url_retorno) {
    body.back_urls = { success: url_retorno, failure: url_retorno, pending: url_retorno }
  }
  if (url_notificacion) body.notification_url = url_notificacion

  const r = await fetch(`${baseUrl()}/checkout/preferences`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(`MercadoPago rechazó la preferencia (${r.status}): ${json.message || JSON.stringify(json)}`)
  }
  return { id: json.id, init_point: json.init_point }
}

/** Re-consulta el pago a la API de MP — fuente de verdad de la notificación. */
async function obtenerPago(gatewayPagoId) {
  if (!accessToken()) throw new Error('MercadoPago no configurado: falta MP_ACCESS_TOKEN')
  const r = await fetch(`${baseUrl()}/v1/payments/${encodeURIComponent(gatewayPagoId)}`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  })
  const json = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(`MercadoPago no entregó el pago ${gatewayPagoId} (${r.status}): ${json.message || JSON.stringify(json)}`)
  }
  return {
    estado: json.status,
    external_reference: json.external_reference || null,
    monto: json.transaction_amount ?? null,
    moneda: json.currency_id || null,
    detalle: json.status_detail || null,
  }
}

module.exports = { validarFirmaWebhook, crearPreferencia, obtenerPago }
