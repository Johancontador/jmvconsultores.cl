/**
 * Reglas contables (FASE 3) — transforman documentos en clasificaciones sin
 * digitación (ACCOUNTING_DOMAIN §6). No hay IA: hay reglas explícitas,
 * visibles, priorizadas y editables.
 *
 *  - CUANDO (todas las condiciones se combinan AND): tipo_flujo (compra|venta|
 *    NULL=ambos), RUT contraparte, tipo de DTE, patrón de razón social, monto
 *    en rango. Las reglas sin condiciones son catch-all.
 *  - ENTONCES: cuenta imputable + CC + tratamiento IVA (+ cuenta contraparte
 *    opcional que FASE 4 usará al generar propuestas).
 *  - Orden de evaluación: prioridad DESC, id ASC como desempate; la primera que
 *    calza gana y el documento registra qué regla se aplicó (auditable).
 *  - Aprendizaje simple: "crear regla desde clasificación manual" (RUT + tipo
 *    DTE → cuenta + CC), con prioridad alta y flag crear_desde_clasificacion.
 */

const { registrarAccion } = require('./auditoria')
const cuentas = require('./cuentas')
const centrosCosto = require('./centros-costo')
const documentosCore = require('./documentos')

const TRATAMIENTOS = documentosCore.TRATAMIENTOS_IVA

function toRegla(row) {
  return {
    id: row.id, empresa_id: row.empresa_id, nombre: row.nombre,
    prioridad: row.prioridad, activa: !!row.activa,
    tipo_flujo: row.tipo_flujo, rut_contraparte: row.rut_contraparte,
    tipo_doc: row.tipo_doc, patron_razon_social: row.patron_razon_social,
    patron_glosa: row.patron_glosa, monto_min: row.monto_min, monto_max: row.monto_max,
    cuenta_id: row.cuenta_id, cuenta_codigo: row.cuenta_codigo, cuenta_nombre: row.cuenta_nombre,
    centro_costo_id: row.centro_costo_id, cc_codigo: row.cc_codigo,
    tratamiento_iva: row.tratamiento_iva, cuenta_contraparte_id: row.cuenta_contraparte_id,
    crear_desde_clasificacion: !!row.crear_desde_clasificacion,
    creado_por: row.creado_por, creado_en: row.creado_en,
  }
}

const SELECT_BASE = `
  SELECT r.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, cc.codigo AS cc_codigo
  FROM reglas_contables r
  LEFT JOIN cuentas c ON c.id = r.cuenta_id
  LEFT JOIN centros_costo cc ON cc.id = r.centro_costo_id
`

function listar(db, empresaId) {
  return db.prepare(`${SELECT_BASE} WHERE r.empresa_id = ? ORDER BY r.prioridad DESC, r.id ASC`).all(empresaId).map(toRegla)
}

function obtener(db, empresaId, reglaId) {
  const row = db.prepare(`${SELECT_BASE} WHERE r.id = ? AND r.empresa_id = ?`).get(reglaId, empresaId)
  return row ? toRegla(row) : null
}

/**
 * Crea o actualiza una regla. Validaciones: nombre, cuenta imputable de la
 * empresa, CC de la empresa, tratamiento IVA válido, tipo_flujo válido,
 * prioridad entera y tipos de condición coherentes.
 */
function guardar(db, { empresaId, usuarioId, reglaId = null, nombre, prioridad = 100, activa = true,
  tipoFlujo = null, rutContraparte = null, tipoDoc = null, patronRazonSocial = null, patronGlosa = null,
  montoMin = null, montoMax = null, cuentaId, centroCostoId = null, tratamientoIva = 'credito',
  cuentaContraparteId = null, crearDesdeClasificacion = false, ip = null }) {

  const nombreLimpio = String(nombre || '').trim()
  if (!nombreLimpio) throw new Error('El nombre de la regla es obligatorio')
  if (!TIPO_FLUJO_VALIDO(tipoFlujo)) throw new Error('tipo_flujo inválido (compra | venta | vacío = ambos)')
  if (!TRATAMIENTOS.includes(tratamientoIva)) {
    throw new Error(`Tratamiento IVA inválido: ${tratamientoIva} (usar: ${TRATAMIENTOS.join(', ')})`)
  }
  const prio = Number(prioridad)
  if (!Number.isInteger(prio) || prio < 1 || prio > 10000) throw new Error('Prioridad inválida (entero 1..10000)')

  const tipoDocNum = tipoDoc === null || tipoDoc === undefined || tipoDoc === '' ? null : Number(tipoDoc)
  if (tipoDocNum !== null && (!Number.isInteger(tipoDocNum) || tipoDocNum <= 0)) {
    throw new Error('Tipo de DTE inválido (ej: 33, 34, 39, 41, 56, 61)')
  }

  const cuenta = cuentas.obtener(db, empresaId, Number(cuentaId))
  if (!cuenta) throw new Error('Cuenta imputable no encontrada en esta empresa')
  if (!cuenta.activa || cuenta.es_resumen) throw new Error('La cuenta de la regla debe estar activa y ser imputable')

  let ccId = null
  if (centroCostoId !== null && centroCostoId !== undefined && centroCostoId !== '') {
    const cc = centrosCosto.obtener(db, empresaId, Number(centroCostoId))
    if (!cc) throw new Error('Centro de costo no encontrado en esta empresa')
    if (!cc.activo) throw new Error('El centro de costo está inactivo')
    ccId = cc.id
  }

  let contraparteId = null
  if (cuentaContraparteId !== null && cuentaContraparteId !== undefined && cuentaContraparteId !== '') {
    const cta = cuentas.obtener(db, empresaId, Number(cuentaContraparteId))
    if (!cta) throw new Error('Cuenta contraparte no encontrada en esta empresa')
    contraparteId = cta.id
  }

  const limpiar = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim())
  const montoEntero = (v, campo) => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n)) throw new Error(`Monto ${campo} inválido`)
    return Math.round(n)
  }
  const datos = {
    nombre: nombreLimpio.slice(0, 200),
    prioridad: prio,
    activa: activa ? 1 : 0,
    tipo_flujo: tipoFlujo || null,
    rut_contraparte: limpiar(rutContraparte) ? limpiar(rutContraparte).toUpperCase() : null,
    tipo_doc: tipoDocNum,
    patron_razon_social: limpiar(patronRazonSocial),
    patron_glosa: limpiar(patronGlosa),
    monto_min: montoEntero(montoMin, 'mínimo'),
    monto_max: montoEntero(montoMax, 'máximo'),
    cuenta_id: cuenta.id,
    centro_costo_id: ccId,
    tratamiento_iva: tratamientoIva,
    cuenta_contraparte_id: contraparteId,
    crear_desde_clasificacion: crearDesdeClasificacion ? 1 : 0,
  }

  const antes = reglaId ? obtener(db, empresaId, reglaId) : null
  if (reglaId) {
    if (!antes) throw new Error('Regla no encontrada en esta empresa')
    const sets = Object.keys(datos).map((k) => `${k} = ?`).join(', ')
    db.prepare(`UPDATE reglas_contables SET ${sets} WHERE id = ? AND empresa_id = ?`).run(...Object.values(datos), reglaId, empresaId)
  } else {
    const info = db.prepare(`
      INSERT INTO reglas_contables (empresa_id, nombre, prioridad, activa, tipo_flujo, rut_contraparte, tipo_doc,
        patron_razon_social, patron_glosa, monto_min, monto_max, cuenta_id, centro_costo_id, tratamiento_iva,
        cuenta_contraparte_id, crear_desde_clasificacion, creado_por)
      VALUES (@empresa_id, @nombre, @prioridad, @activa, @tipo_flujo, @rut_contraparte, @tipo_doc,
        @patron_razon_social, @patron_glosa, @monto_min, @monto_max, @cuenta_id, @centro_costo_id, @tratamiento_iva,
        @cuenta_contraparte_id, @crear_desde_clasificacion, @creado_por)
    `).run({ ...datos, empresa_id: empresaId, creado_por: usuarioId })
    reglaId = Number(info.lastInsertRowid)
  }

  registrarAccion(db, {
    empresaId, usuarioId,
    accion: reglaId && antes ? 'regla.editar' : 'regla.crear',
    entidad: 'reglas_contables', entidadId: String(reglaId),
    antes: antes ? { ...antes } : null,
    despues: { ...datos, activa: !!datos.activa, crear_desde_clasificacion: !!datos.crear_desde_clasificacion },
    ip,
  })

  return obtener(db, empresaId, reglaId)
}

function TIPO_FLUJO_VALIDO(v) {
  return v === null || v === undefined || v === '' || ['compra', 'venta'].includes(v)
}

function desactivar(db, { empresaId, usuarioId, reglaId, ip = null }) {
  const regla = obtener(db, empresaId, reglaId)
  if (!regla) throw new Error('Regla no encontrada en esta empresa')
  db.prepare(`UPDATE reglas_contables SET activa = 0 WHERE id = ? AND empresa_id = ?`).run(reglaId, empresaId)
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'regla.desactivar', entidad: 'reglas_contables', entidadId: String(reglaId),
    antes: { activa: true }, despues: { activa: false }, ip,
  })
  return obtener(db, empresaId, reglaId)
}

/**
 * Evalúa un documento contra las reglas activas de la empresa, prioridad DESC.
 * Devuelve {cuenta_id, centro_costo_id, tratamiento_iva, cuenta_contraparte_id, regla_id, regla_nombre}
 * o null si ninguna calza. Las reglas catch-all (sin condiciones) calzan todo.
 */
function evaluar(db, empresaId, doc) {
  const reglas = db.prepare(`
    SELECT * FROM reglas_contables
    WHERE empresa_id = ? AND activa = 1
    ORDER BY prioridad DESC, id ASC
  `).all(empresaId)

  for (const r of reglas) {
    if (r.tipo_flujo && r.tipo_flujo !== doc.tipo_flujo) continue
    if (r.rut_contraparte && normRut(r.rut_contraparte) !== normRut(doc.rut_contraparte)) continue
    if (r.tipo_doc !== null && r.tipo_doc !== undefined && Number(r.tipo_doc) !== Number(doc.tipo_doc)) continue
    if (r.patron_razon_social && !(doc.razon_social || '').toLowerCase().includes(r.patron_razon_social.toLowerCase())) continue
    if (r.patron_glosa && !(doc.glosa || '').toLowerCase().includes(r.patron_glosa.toLowerCase())) continue
    if (r.monto_min !== null && r.monto_min !== undefined && Number(doc.monto_total) < r.monto_min) continue
    if (r.monto_max !== null && r.monto_max !== undefined && Number(doc.monto_total) > r.monto_max) continue
    return {
      cuenta_id: r.cuenta_id,
      centro_costo_id: r.centro_costo_id,
      tratamiento_iva: r.tratamiento_iva,
      cuenta_contraparte_id: r.cuenta_contraparte_id,
      regla_id: r.id,
      regla_nombre: r.nombre,
    }
  }
  return null
}

function normRut(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase()
}

/**
 * Clasificación automática: aplica el motor sobre los documentos que lo
 * admiten (PENDIENTE/CLASIFICADO/REVISION, según los filtros). Devuelve
 * {evaluados, clasificados, sin_regla} y deja auditada cada clasificación
 * (via documentos.clasificar) + un resumen del lote.
 */
function clasificarAutomatico(db, { empresaId, usuarioId, periodo = null, tipoFlujo = null, documentoId = null, ip = null }) {
  const admisibles = ['PENDIENTE', 'CLASIFICADO', 'REVISION']
  const where = ['empresa_id = ?', `estado IN (${admisibles.map(() => '?').join(',')})`]
  const params = [empresaId, ...admisibles]
  if (periodo) { where.push('periodo_ingesta = ?'); params.push(periodo) }
  if (tipoFlujo) { where.push('tipo_flujo = ?'); params.push(tipoFlujo) }
  if (documentoId) { where.push('id = ?'); params.push(Number(documentoId)) }

  const docs = db.prepare(`SELECT * FROM documentos WHERE ${where.join(' AND ')} ORDER BY id`).all(...params)

  let clasificados = 0
  const sinRegla = []
  for (const doc of docs) {
    const match = evaluar(db, empresaId, doc)
    if (!match) { sinRegla.push(doc.id); continue }
    documentosCore.clasificar(db, {
      empresaId, usuarioId, documentoId: doc.id,
      cuentaId: match.cuenta_id, centroCostoId: match.centro_costo_id,
      tratamientoIva: match.tratamiento_iva, reglaId: match.regla_id, ip,
    })
    clasificados++
  }

  if (docs.length) {
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'documentos.clasificar_automatico', entidad: 'documentos', entidadId: periodo || 'todos',
      despues: { evaluados: docs.length, clasificados, sin_regla: sinRegla.length },
      ip,
    })
  }

  return { evaluados: docs.length, clasificados, sin_regla: sinRegla }
}

/**
 * Aprendizaje simple (§6): "crear regla desde esta clasificación".
 * RUT + tipo DTE + flujo → cuenta + CC + tratamiento. Prioridad 50: la
 * evaluación es DESC, así que gana sobre un catch-all típico (10) pero pierde
 * frente a reglas manuales específicas (prioridad 100+).
 */
function crearDesdeClasificacion(db, { empresaId, usuarioId, rutContraparte, tipoDoc, tipoFlujo, cuentaId, centroCostoId = null, tratamientoIva = 'credito', prioridad = 50, ip = null }) {
  const rut = normRut(rutContraparte)
  if (!rut) throw new Error('RUT de contraparte obligatorio para aprender la regla')
  const doc = Number(tipoDoc)
  if (!Number.isInteger(doc) || doc <= 0) throw new Error('Tipo de DTE obligatorio para aprender la regla')

  const existente = db.prepare(`
    SELECT id FROM reglas_contables
    WHERE empresa_id = ? AND rut_contraparte IS ? AND tipo_doc IS ? AND tipo_flujo IS ?
  `).get(empresaId, rut, doc, tipoFlujo || null)
  if (existente) throw new Error('Ya existe una regla para esa contraparte/tipo DTE/flujo')

  const contra = db.prepare(`SELECT razon_social FROM contrapartes WHERE empresa_id = ? AND rut = ?`).get(empresaId, rut)
  const nombre = `Aprendida: ${contra && contra.razon_social ? contra.razon_social : rut} · DTE ${doc} · ${tipoFlujo}`

  return guardar(db, {
    empresaId, usuarioId, nombre, prioridad, activa: true,
    tipoFlujo, rutContraparte: rut, tipoDoc: doc,
    cuentaId, centroCostoId, tratamientoIva,
    crearDesdeClasificacion: true, ip,
  })
}

module.exports = { listar, obtener, guardar, desactivar, evaluar, clasificarAutomatico, crearDesdeClasificacion }
