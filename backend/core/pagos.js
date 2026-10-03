/**
 * PAGOS DE LA SUSCRIPCIÓN — SAAS-3 (SAAS-ACCESO §5.3: "webhook → activarPlan").
 *
 * Flujo:
 *   1. `crearCheckout` — el dueño (licencias:pagar) contrata un plan: se crea la
 *      fila PENDIENTE y el ADAPTADOR de la pasarela crea el checkout
 *      (init_point). external_reference = `pago_suscripcion:<id>` es el vínculo
 *      bidireccional con la pasarela.
 *   2. `procesarNotificacion` — la pasarela llama el webhook PÚBLICO:
 *      `/api/pagos/webhook/:gateway`. La confirmación SIEMPRE re-consulta el
 *      pago a la API de la pasarela (obtenerPago — fuente de verdad; el body
 *      del webhook solo trae ids, jamás se confía en él). Aprobado → la
 *      licencia se activa/renueva vía `licencias.activarPlan` y queda la
 *      factura de la suscripción PENDIENTE de emisión (facturas-suscripcion).
 *
 * Principios:
 *  - Módulo puro: la BD llega por parámetro y el adaptador de pasarela se
 *    INYECTA (los tests jamás tocan la red — mismo patrón que SII mockeado).
 *  - Idempotencia en DOS espacios: UNIQUE(gateway, evento_id) en
 *    `webhook_eventos` (re-entrega de la MISMA notificación no re-procesa) y
 *    UNIQUE(gateway, gateway_pago_id) en `pagos_suscripcion` (el MISMO pago
 *    reportado por otro evento tampoco re-activa la licencia).
 *  - El gate de licencia NO aplica aquí: pagar debe ser posible incluso con la
 *    licencia SUSPENDIDA (si no, la empresa no puede reactivarse sola).
 *  - Todo auditado (`pago.checkout`, `pago.aprobado`, `pago.rechazado`).
 *
 * Interfaz del adaptador (gatewayAdapter):
 *   crearPreferencia({ monto_clp, descripcion, external_reference, url_retorno, url_notificacion })
 *     → { id, init_point }
 *   obtenerPago(gatewayPagoId) → { estado, external_reference, monto, moneda, detalle }
 */

const { registrarAccion } = require('./auditoria')
const licencias = require('./licencias')
const facturas = require('./facturas-suscripcion')

const GATEWAY_VALIDOS = ['mercadopago', 'transbank', 'manual']
const MESES_MAX = 36

/** Monto vigente del plan (una sola fuente: PLANES en licencias.js). */
function montoPlan(plan) {
  return licencias.PLANES[plan].monto_clp
}

/**
 * Crea el intento de pago y pide el checkout a la pasarela.
 * Devuelve { pago, checkout:{ init_point, id } }.
 */
async function crearCheckout(db, {
  empresaId, plan, meses = 1, gateway = 'mercadopago',
  gatewayAdapter, usuarioId = null, ip = null,
  urlRetorno = null, urlNotificacion = null,
}) {
  if (!gatewayAdapter || typeof gatewayAdapter.crearPreferencia !== 'function') {
    throw new Error('Pasarela no soportada: falta el adaptador')
  }
  if (!licencias.esPlanValido(plan)) {
    throw new Error(`Plan inválido: ${plan} (usar: ${Object.keys(licencias.PLANES).join(', ')})`)
  }
  if (plan === 'PRUEBA') throw new Error('La prueba no se compra: es automática al registrar la empresa')
  if (!Number.isInteger(meses) || meses < 1 || meses > MESES_MAX) {
    throw new Error(`Meses inválido (1..${MESES_MAX})`)
  }
  if (!GATEWAY_VALIDOS.includes(gateway)) throw new Error(`Pasarela inválida: ${gateway}`)
  const empresa = db.prepare(`SELECT id FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  // El pago cobra el precio mensual × meses contratados (el plan se paga por
  // período completo; la licencia se extiende la misma cantidad de meses).
  const monto = montoPlan(plan) * meses

  const info = db.prepare(`
    INSERT INTO pagos_suscripcion (empresa_id, plan, monto_clp, meses, gateway, external_reference, estado)
    VALUES (?, ?, ?, ?, ?, 'pendiente', 'PENDIENTE')
  `).run(empresaId, plan, monto, meses, gateway)

  const pagoId = Number(info.lastInsertRowid)
  const external_reference = `pago_suscripcion:${pagoId}`
  db.prepare(`UPDATE pagos_suscripcion SET external_reference = ? WHERE id = ?`).run(external_reference, pagoId)

  const checkout = await gatewayAdapter.crearPreferencia({
    monto_clp: monto,
    descripcion: `Plan ${plan} — Software Contable JMV (${meses} mes${meses > 1 ? 'es' : ''})`,
    external_reference,
    url_retorno: urlRetorno,
    url_notificacion: urlNotificacion,
  })

  db.prepare(`UPDATE pagos_suscripcion SET gateway_pref_id = ? WHERE id = ?`)
    .run(checkout && checkout.id != null ? String(checkout.id) : null, pagoId)

  registrarAccion(db, {
    empresaId, usuarioId, accion: 'pago.checkout', entidad: 'pagos_suscripcion', entidadId: String(pagoId),
    despues: { plan, meses, monto_clp: monto, gateway, external_reference, ip },
  })

  const pago = db.prepare(`SELECT * FROM pagos_suscripcion WHERE id = ?`).get(pagoId)
  return { pago, checkout }
}

/**
 * Procesa una notificación del webhook. SIEMPRE re-consulta el pago a la
 * pasarela (obtenerPago) — el resultado depende solo de la fuente de verdad.
 * Idempotente: misma notificación → { deduplicado: true } sin re-activar.
 */
async function procesarNotificacion(db, {
  gateway, gatewayAdapter, eventoId, pagoPasarelaId, payloadJson = null,
}) {
  if (!gatewayAdapter || typeof gatewayAdapter.obtenerPago !== 'function') {
    throw new Error('Pasarela no soportada: falta el adaptador')
  }
  if (!eventoId || !pagoPasarelaId) {
    throw new Error('Notificación incompleta: falta evento_id o id del pago en la pasarela')
  }

  // Registro de la notificación (UNIQUE gateway+evento_id): re-entregas ya
  // procesadas se deduplican sin volver a tocar la licencia.
  const existe = db.prepare(`SELECT * FROM webhook_eventos WHERE gateway = ? AND evento_id = ?`).get(gateway, eventoId)
  if (existe && existe.procesado) {
    return { deduplicado: true, resultado: existe.resultado }
  }
  if (!existe) {
    db.prepare(`INSERT INTO webhook_eventos (gateway, evento_id, payload) VALUES (?, ?, ?)`)
      .run(gateway, eventoId, payloadJson)
  }

  // Fuente de verdad: la pasarela. Si el pago no existe ahí, nada se procesa.
  const p = await gatewayAdapter.obtenerPago(pagoPasarelaId)
  if (!p) {
    marcarEvento(db, gateway, eventoId, 'pago_no_encontrado_en_pasarela')
    return { ok: false, codigo: 'PAGO_NO_ENCONTRADO', mensaje: 'La pasarela no reconoce el pago notificado' }
  }
  // El pago puede llegar de dos maneras: ya asociado (gateway_pago_id, p. ej.
  // una segunda notificación del mismo pago) o por primera vez — entonces la
  // única referencia disponible es la external_reference que la PASARELA
  // devuelve ('pago_suscripcion:<id>'): el gateway_pago_id aún es NULL en la
  // fila. Resuelto el pago, se asocia (y se rechaza si ya estaba asociado a
  // otro id de la pasarela).
  let pago = db.prepare(`SELECT * FROM pagos_suscripcion WHERE gateway = ? AND gateway_pago_id = ?`)
    .get(gateway, String(pagoPasarelaId))
  if (!pago && p.external_reference && p.external_reference.startsWith('pago_suscripcion:')) {
    const idRef = Number(p.external_reference.split(':')[1])
    if (Number.isInteger(idRef) && idRef > 0) {
      const candidata = db.prepare(`SELECT * FROM pagos_suscripcion WHERE id = ? AND gateway = ?`).get(idRef, gateway)
      if (candidata) {
        if (candidata.gateway_pago_id && candidata.gateway_pago_id !== String(pagoPasarelaId)) {
          marcarEvento(db, gateway, eventoId, 'pago_ya_asociado_a_otro_id')
          return { ok: false, codigo: 'PAGO_YA_ASOCIADO', mensaje: 'El checkout ya está asociado a otro pago de la pasarela' }
        }
        pago = candidata
      }
    }
  }

  if (!pago) {
    marcarEvento(db, gateway, eventoId, 'pago_desconocido')
    return { ok: false, codigo: 'PAGO_DESCONOCIDO', mensaje: 'El pago notificado no corresponde a ningún checkout de esta plataforma' }
  }
  if (p.external_reference && p.external_reference !== pago.external_reference) {
    marcarEvento(db, gateway, eventoId, 'referencia_divergente')
    return { ok: false, codigo: 'REFERENCIA_DIVERGENTE', mensaje: 'La external_reference de la pasarela no coincide con el checkout' }
  }
  if (pago.estado === 'APROBADO') {
    marcarEvento(db, gateway, eventoId, 'ya_aprobado')
    return { deduplicado: true, resultado: 'ya_aprobado' }
  }

  const resultado = String(p.estado || '').toLowerCase()
  if (resultado === 'approved') {
    await activar(db, { pago, pasarela: p, gateway, eventoId, pagoPasarelaId: String(pagoPasarelaId) })
    marcarEvento(db, gateway, eventoId, 'aprobado')
    return { ok: true, estado: 'APROBADO', pago_id: pago.id, licencia: licencias.estadoParaUI(db, pago.empresa_id) }
  }
  if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(resultado)) {
    db.prepare(`UPDATE pagos_suscripcion SET estado = 'RECHAZADO', gateway_pago_id = ?, respuesta_json = ?, resuelto_en = datetime('now') WHERE id = ?`)
      .run(String(pagoPasarelaId), JSON.stringify({ estado: p.estado, detalle: p.detalle || null, monto: p.monto || null }), pago.id)
    registrarAccion(db, {
      empresaId: pago.empresa_id, usuarioId: licencias.usuarioSistema(db),
      accion: 'pago.rechazado', entidad: 'pagos_suscripcion', entidadId: String(pago.id),
      antes: { estado: pago.estado },
      despues: { estado: 'RECHAZADO', pasarela_estado: p.estado, detalle: p.detalle || null, evento: eventoId },
    })
    marcarEvento(db, gateway, eventoId, 'rechazado')
    return { ok: true, estado: 'RECHAZADO', pago_id: pago.id }
  }

  // pending / in_process / otros: el pago sigue PENDIENTE — MP re-notificará.
  db.prepare(`UPDATE pagos_suscripcion SET respuesta_json = ? WHERE id = ?`)
    .run(JSON.stringify({ estado: p.estado, detalle: p.detalle || null }), pago.id)
  marcarEvento(db, gateway, eventoId, `sin_cambio:${p.estado || 'desconocido'}`)
  return { ok: true, estado: pago.estado, pago_id: pago.id, pasarela: p.estado }
}

/** Aprobación: licencia activada + factura PENDIENTE, TODO en una transacción. */
async function activar(db, { pago, pasarela, gateway, eventoId, pagoPasarelaId }) {
  const sistema = licencias.usuarioSistema(db)
  db.transaction(() => {
    const ya = db.prepare(`SELECT estado FROM pagos_suscripcion WHERE id = ? AND estado = 'APROBADO'`).get(pago.id)
    if (ya) return // otro evento llegó primero: nada que hacer (idempotente)
    db.prepare(`UPDATE pagos_suscripcion SET estado = 'APROBADO', gateway_pago_id = ?, respuesta_json = ?, resuelto_en = datetime('now') WHERE id = ?`)
      .run(String(pagoPasarelaId || ''), JSON.stringify({ estado: pasarela.estado, monto: pasarela.monto, moneda: pasarela.moneda, evento: eventoId }), pago.id)
    licencias.activarPlan(db, {
      empresaId: pago.empresa_id, plan: pago.plan, usuarioId: sistema, meses: pago.meses,
      notas: `Pago ${gateway} ${pago.external_reference}`,
    })
    facturas.crearPendiente(db, db.prepare(`SELECT * FROM pagos_suscripcion WHERE id = ?`).get(pago.id))
    registrarAccion(db, {
      empresaId: pago.empresa_id, usuarioId: sistema,
      accion: 'pago.aprobado', entidad: 'pagos_suscripcion', entidadId: String(pago.id),
      antes: { estado: 'PENDIENTE' },
      despues: { estado: 'APROBADO', plan: pago.plan, meses: pago.meses, monto_clp: pago.monto_clp, evento: eventoId },
    })
  })()
}

function marcarEvento(db, gateway, eventoId, resultado) {
  db.prepare(`UPDATE webhook_eventos SET procesado = 1, resultado = ? WHERE gateway = ? AND evento_id = ?`)
    .run(resultado, gateway, eventoId)
}

/** Historial de pagos de la empresa (más nuevos primero). */
function listarPagos(db, empresaId) {
  return db.prepare(`SELECT * FROM pagos_suscripcion WHERE empresa_id = ? ORDER BY id DESC`).all(empresaId)
}

function obtenerPago(db, empresaId, pagoId) {
  return db.prepare(`SELECT * FROM pagos_suscripcion WHERE empresa_id = ? AND id = ?`).get(empresaId, pagoId) || null
}

module.exports = {
  GATEWAY_VALIDOS, MESES_MAX,
  montoPlan, crearCheckout, procesarNotificacion, listarPagos, obtenerPago,
}
