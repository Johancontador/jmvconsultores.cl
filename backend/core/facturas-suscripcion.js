/**
 * FACTURA ELECTRÓNICA DE LA SUSCRIPCIÓN — SAAS-3 (DTE tipo 33 del pago).
 *
 * Cada pago APROBADO deja su factura PENDIENTE (UNIQUE pago_id — un DTE por
 * pago). `emitir` delega en el adaptador DTE INYECTABLE (core/dte.js con
 * @devlas/dte-sii; tests con adaptador falso — jamás tocan el SII):
 *   dteAdapter.emitirFactura({ emisor, receptor, folio, items, monto_neto, monto_iva, monto_total })
 *     → { folio, xml, track_id }  (lanza si el SII rechaza o falta configuración)
 *
 * Principios (§42 — honesto):
 *  - La tasa de IVA es configuración CON FUENTE CITADA, nunca inventada.
 *  - El desglose es TOTAL → NETO (el precio del plan es con IVA incluido).
 *  - Los datos del RECEPTOR se validan: lo que falta se NOMINA — jamás se
 *    adivina (si la empresa no tiene giro/dirección/comuna registrados, la
 *    emisión se rechaza pidiéndolos explícitamente).
 *  - El folio se asigna de la secuencia local de facturas (MAX(folio)+1 por
 *    tipo) y el adaptador lo valida contra el rango del CAF autorizado.
 */

const { registrarAccion } = require('./auditoria')

/** Tasa general de IVA — FUENTE: Ley sobre Impuesto a las Ventas y Servicios,
 *  D.L. 825, tasa 19% vigente desde 01-09-2019 (Ley 21.210). Configurada aquí
 *  con cita, no calculada ni adivinada. */
const TASA_IVA = 0.19
const TIPO_FACTURA = 33

/** Desglose con IVA incluido: total (precio del plan) → neto + IVA. */
function desglose(totalClp) {
  const total = Math.round(Number(totalClp) || 0)
  const neto = Math.round(total / (1 + TASA_IVA))
  return { neto, iva: total - neto, total }
}

/**
 * Crea la factura PENDIENTE del pago aprobado. Idempotente por UNIQUE(pago_id):
 * si ya existe, devuelve la fila existente sin duplicar.
 */
function crearPendiente(db, pago) {
  const existente = db.prepare(`SELECT * FROM facturas_suscripcion WHERE pago_id = ?`).get(pago.id)
  if (existente) return existente
  const { neto, iva, total } = desglose(pago.monto_clp)
  const info = db.prepare(`
    INSERT INTO facturas_suscripcion (empresa_id, pago_id, tipo_dte, estado, monto_neto, monto_iva, monto_total)
    VALUES (?, ?, ?, 'PENDIENTE', ?, ?, ?)
  `).run(pago.empresa_id, pago.id, TIPO_FACTURA, neto, iva, total)
  return db.prepare(`SELECT * FROM facturas_suscripcion WHERE id = ?`).get(info.lastInsertRowid)
}

function obtenerPorPago(db, pagoId) {
  return db.prepare(`SELECT * FROM facturas_suscripcion WHERE pago_id = ?`).get(pagoId) || null
}

function listar(db, empresaId) {
  return db.prepare(`SELECT * FROM facturas_suscripcion WHERE empresa_id = ? ORDER BY id DESC`).all(empresaId)
}

/**
 * Datos del receptor para el DTE: RUT y razón social vienen de la empresa
 * (ficha tributaria SAAS-2); giro/dirección/comuna se aceptan como override
 * (body del endpoint) porque el SII los exige y la BD puede no tenerlos.
 * Devuelve { ok, receptor } o { ok:false, faltantes:[...] }.
 */
function receptorDesdeEmpresa(db, empresaId, overrides = {}) {
  const e = db.prepare(`SELECT * FROM empresas WHERE id = ?`).get(empresaId)
  if (!e) throw new Error('Empresa no encontrada')
  const o = (k) => String(overrides[k] || '').trim()
  const receptor = {
    rut: o('rut') || e.rut,
    razon_social: o('razon_social') || e.razon_social_sii || e.nombre,
    giro: o('giro'),
    direccion: o('direccion'),
    comuna: o('comuna'),
  }
  const faltantes = Object.entries(receptor)
    .filter(([, v]) => !v)
    .map(([k]) => k)
  return faltantes.length ? { ok: false, faltantes } : { ok: true, receptor }
}

/**
 * Emite el DTE del pago vía el adaptador inyectable. Idempotente defensiva:
 * una factura EMITIDA no se re-emite (el folio ya quedó consumido).
 */
async function emitir(db, { facturaId, emisor, receptor, dteAdapter, usuarioId = null }) {
  if (!dteAdapter || typeof dteAdapter.emitirFactura !== 'function') {
    throw new Error('Emisor DTE no configurado: falta el adaptador')
  }
  const f = db.prepare(`SELECT * FROM facturas_suscripcion WHERE id = ?`).get(facturaId)
  if (!f) throw new Error('Factura no encontrada')
  if (f.estado === 'EMITIDA') throw new Error(`La factura ya fue emitida (folio ${f.folio}, track ${f.track_id})`)

  const pago = db.prepare(`SELECT * FROM pagos_suscripcion WHERE id = ?`).get(f.pago_id)
  const anterior = db.prepare(`SELECT MAX(folio) AS f FROM facturas_suscripcion WHERE tipo_dte = ?`).get(TIPO_FACTURA)
  const folio = (anterior && anterior.f ? anterior.f : 0) + 1

  const items = [{
    nombre: `Suscripción plan ${pago.plan} — Software Contable JMV (${pago.meses} mes${pago.meses > 1 ? 'es' : ''})`,
    cantidad: 1,
    precio: f.monto_total,
  }]

  let r
  try {
    r = await dteAdapter.emitirFactura({
      emisor, receptor, folio, items,
      monto_neto: f.monto_neto, monto_iva: f.monto_iva, monto_total: f.monto_total,
    })
  } catch (err) {
    db.prepare(`UPDATE facturas_suscripcion SET estado = 'RECHAZADA', motivo_rechazo = ?, receptor_json = ? WHERE id = ?`)
      .run(String(err.message).slice(0, 500), JSON.stringify(receptor), facturaId)
    registrarAccion(db, {
      empresaId: f.empresa_id, usuarioId, accion: 'factura.rechazada',
      entidad: 'facturas_suscripcion', entidadId: String(facturaId),
      despues: { motivo: String(err.message).slice(0, 200) },
    })
    throw err
  }

  db.prepare(`UPDATE facturas_suscripcion SET estado = 'EMITIDA', folio = ?, xml = ?, track_id = ?, receptor_json = ?, emitido_en = datetime('now'), motivo_rechazo = NULL WHERE id = ?`)
    .run(r.folio || folio, r.xml || null, r.track_id || null, JSON.stringify(receptor), facturaId)
  registrarAccion(db, {
    empresaId: f.empresa_id, usuarioId, accion: 'factura.emitir',
    entidad: 'facturas_suscripcion', entidadId: String(facturaId),
    despues: { tipo_dte: TIPO_FACTURA, folio: r.folio || folio, track_id: r.track_id || null, monto_total: f.monto_total, receptor: receptor.rut },
  })
  return db.prepare(`SELECT * FROM facturas_suscripcion WHERE id = ?`).get(facturaId)
}

module.exports = {
  TASA_IVA, TIPO_FACTURA,
  desglose, crearPendiente, obtenerPorPago, listar, receptorDesdeEmpresa, emitir,
}
