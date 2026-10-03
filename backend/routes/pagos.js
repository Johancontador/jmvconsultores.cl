/**
 * RUTAS DE PAGOS — SAAS-3. Montada en /api/pagos SIN requireAuth global:
 * el webhook de la pasarela es PÚBLICO (no tiene sesión) y se valida por
 * firma + re-consulta a la API de la pasarela; las demás rutas piden
 * requireAuth + capacidad RBAC aquí dentro.
 *
 * RBAC local SIN gate de licencia (a diferencia de requirePermiso): pagar y
 * facturar la suscripción deben funcionar incluso con la licencia VENCIDA o
 * SUSPENDIDA — si el gate bloqueara el checkout, una empresa suspendida no
 * podría reactivarse sola (deadlock). Lectura (licencias:ver) nunca se
 * bloquea; pagos (licencias:pagar) y facturación (facturacion:emitir) por
 * decisión de diseño de este módulo.
 */

const express = require('express')
const router = express.Router()
const db = require('../db')
const { requireAuth } = require('../middleware/requireAuth')
const { rolEnEmpresa } = require('../core/empresas')
const { permisosDeRol } = require('../core/permisos')
const licencias = require('../core/licencias')
const pagos = require('../core/pagos')
const facturas = require('../core/facturas-suscripcion')
const mercadopago = require('../core/pagos-mercadopago')
const dte = require('../core/dte')

function permisoSinGate(capacidad) {
  return (req, res, next) => {
    const usuarioId = req.user && req.user.id
    if (!usuarioId) return res.status(401).json({ ok: false, error: 'No autenticado' })
    const empresaId = Number(req.params.empresaId)
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return res.status(400).json({ ok: false, error: 'Empresa inválida' })
    }
    const rol = rolEnEmpresa(db, usuarioId, empresaId)
    if (!rol) return res.status(403).json({ ok: false, error: 'No tiene acceso a esta empresa' })
    if (!permisosDeRol(rol).has(capacidad)) {
      return res.status(403).json({ ok: false, error: `Permiso requerido: ${capacidad}` })
    }
    req.empresaId = empresaId
    next()
  }
}

/** Planes públicos para la UI (precio con IVA incluido, límites). */
function planesPublicos() {
  return Object.entries(licencias.PLANES).map(([plan, p]) => ({
    plan, monto_clp: p.monto_clp, empresas: p.empresas, usuarios: p.usuarios, docs_mes: p.docs_mes,
  }))
}

// ---------------------------------------------------------------
// Checkout: contratar/renovar plan (MercadoPago primero).
// ---------------------------------------------------------------
router.post('/empresas/:empresaId/checkout', requireAuth, permisoSinGate('licencias:pagar'), async (req, res) => {
  try {
    const { plan, meses } = req.body || {}
    const r = await pagos.crearCheckout(db, {
      empresaId: req.empresaId, plan, meses: Number(meses) || 1,
      gateway: 'mercadopago', gatewayAdapter: mercadopago,
      usuarioId: req.user.id, ip: req.ip,
      urlRetorno: process.env.PAGOS_URL_RETORNO || null,
      urlNotificacion: process.env.PAGOS_NOTIFICATION_URL || null,
    })
    res.json({ ok: true, pago: r.pago, checkout: r.checkout })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

// ---------------------------------------------------------------
// Suscripción + historial de pagos (una sola lectura para la UI).
// ---------------------------------------------------------------
router.get('/empresas/:empresaId/pagos', requireAuth, permisoSinGate('licencias:ver'), (req, res) => {
  res.json({
    ok: true,
    suscripcion: licencias.estadoParaUI(db, req.empresaId),
    pagos: pagos.listarPagos(db, req.empresaId),
    facturas: facturas.listar(db, req.empresaId),
    planes: planesPublicos(),
    checkout_disponible: Boolean(process.env.MP_ACCESS_TOKEN),
  })
})

// ---------------------------------------------------------------
// Factura electrónica del pago (DTE 33) — contador / super_admin.
// Receptor: ficha de la empresa + overrides del body (giro, dirección,
// comuna — el SII los exige y la BD puede no tenerlos: se piden, no se
// adivinan, §42).
// ---------------------------------------------------------------
router.post('/empresas/:empresaId/pagos/:pagoId/factura', requireAuth, permisoSinGate('facturacion:emitir'), async (req, res) => {
  try {
    const pago = pagos.obtenerPago(db, req.empresaId, Number(req.params.pagoId))
    if (!pago) return res.status(404).json({ ok: false, error: 'Pago no encontrado' })
    if (pago.estado !== 'APROBADO') {
      return res.status(422).json({ ok: false, error: `Solo los pagos APROBADO se facturan (este está ${pago.estado})` })
    }
    let factura = facturas.obtenerPorPago(db, pago.id)
    if (!factura) factura = facturas.crearPendiente(db, pago)

    const rec = facturas.receptorDesdeEmpresa(db, req.empresaId, req.body || {})
    if (!rec.ok) {
      return res.status(422).json({
        ok: false,
        error: `Faltan datos del receptor para el DTE: ${rec.faltantes.join(', ')} — complete la ficha de la empresa o páselos en el cuerpo del request`,
        faltantes: rec.faltantes,
      })
    }

    const r = await facturas.emitir(db, {
      facturaId: factura.id,
      emisor: dte.emisorDesdeEnv(),
      receptor: rec.receptor,
      dteAdapter: dte,
      usuarioId: req.user.id,
    })
    res.json({ ok: true, factura: r })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

// ---------------------------------------------------------------
// WEBHOOK MercadoPago — PÚBLICO (la pasarela no tiene sesión).
// Defensas: (1) firma x-signature HMAC si hay MP_WEBHOOK_SECRET;
// (2) el estado del pago SIEMPRE se re-consulta a la API de MP (fuente de
// verdad — el body solo trae ids y jamás se confía en él); (3) idempotencia
// en webhook_eventos (UNIQUE gateway+evento_id) y pagos_suscripcion
// (UNIQUE gateway+gateway_pago_id). Respuesta 200 salvo error transitorio
// (500 → la pasarela re-intenta).
// ---------------------------------------------------------------
router.post('/webhook/mercadopago', async (req, res) => {
  try {
    const tipo = (req.body && req.body.type) || req.query.type || req.query.topic || 'payment'
    const dataId = (req.body && req.body.data && req.body.data.id) || req.query['data.id'] || (req.body && req.body.id)
    if (!dataId) {
      return res.status(200).json({ ok: false, codigo: 'SIN_ID', mensaje: 'Notificación sin id de pago — ignorada' })
    }
    const secreto = process.env.MP_WEBHOOK_SECRET
    if (secreto && !mercadopago.validarFirmaWebhook({
      xSignature: req.headers['x-signature'], xRequestId: req.headers['x-request-id'], dataId: String(dataId), secret: secreto,
    })) {
      return res.status(401).json({ ok: false, error: 'Firma de webhook inválida' })
    }
    const r = await pagos.procesarNotificacion(db, {
      gateway: 'mercadopago',
      gatewayAdapter: mercadopago,
      eventoId: `${tipo}:${dataId}`,
      pagoPasarelaId: String(dataId),
      payloadJson: JSON.stringify({ query: req.query, body: req.body }).slice(0, 2000),
    })
    res.status(200).json({ ok: true, ...r })
  } catch (err) {
    // Error transitorio (red/MP caído): 500 → MP re-intenta; el evento quedó
    // con procesado=0 y la re-entrega lo reprocesa completo.
    console.error('[webhook mercadopago]', err.message)
    res.status(500).json({ ok: false, error: 'Error procesando la notificación' })
  }
})

module.exports = router
