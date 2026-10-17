/**
 * Documentos — bandeja contable (FASE 3).
 *
 * Ciclo de vida (ACCOUNTING_DOMAIN §5): el documento SII es EVIDENCIA, no un
 * asiento. Estados y transiciones válidas viven aquí; las rutas HTTP nunca
 * escriben directo en la tabla.
 *
 *   RECIBIDO → PENDIENTE → CLASIFICADO → PROPUESTO → CONTABILIZADO   (F4: propuesta/contabilización)
 *                           └──► REVISIÓN ◄───────────────┘
 *   ERROR (falla de ingesta/validación)   ANULADO (nunca delete físico)
 *
 * Ingesta idempotente (DATA_MODEL §B.8): clave_dedupe = hash(rut empresa |
 * flujo | tipo doc | folio | período ingesta) con UNIQUE — re-ingesta del
 * mismo RCV no duplica nada. Montos REAL del SII se convierten a INTEGER
 * con Math.round AQUÍ (frontera de ingesta), nunca después.
 */

const crypto = require('crypto')
const { registrarAccion } = require('./auditoria')
const cuentas = require('./cuentas')
const centrosCosto = require('./centros-costo')
const periodos = require('./periodos')
const { SIGNO_NC } = require('./sii-convenios')

const ESTADOS = {
  RECIBIDO: 'RECIBIDO',
  PENDIENTE: 'PENDIENTE',
  CLASIFICADO: 'CLASIFICADO',
  PROPUESTO: 'PROPUESTO',
  CONTABILIZADO: 'CONTABILIZADO',
  REVISION: 'REVISION',
  ERROR: 'ERROR',
  ANULADO: 'ANULADO',
}

const TRANSICIONES = {
  RECIBIDO: ['PENDIENTE', 'ERROR', 'ANULADO'],
  PENDIENTE: ['CLASIFICADO', 'REVISION', 'ERROR', 'ANULADO'],
  CLASIFICADO: ['PROPUESTO', 'REVISION', 'ANULADO'],
  PROPUESTO: ['CONTABILIZADO', 'CLASIFICADO', 'REVISION', 'ANULADO'],
  CONTABILIZADO: [], // su corrección es reversión de asiento + nueva propuesta (FASE 4)
  REVISION: ['CLASIFICADO', 'PENDIENTE', 'ANULADO'],
  ERROR: ['PENDIENTE', 'ANULADO'],
  ANULADO: [],
}

const TRATAMIENTOS_IVA = ['credito', 'sin_credito', 'uso_comun', 'no_recuperable']
const TIPOS_FLUJO = ['compra', 'venta']

/**
 * Documentos SIN contraparte obligatoria (39 boleta, 41 boleta exenta —
 * con sus versiones del RCV, incluidas las ventas por medios de pago
 * electrónico). Sus montos son venta real: se ingresan con
 * rut_contraparte '' y entran a TODAS las sumas de resúmenes.
 */
const BOLETAS_TIPOS = [39, 41]

/** Estados que admiten clasificación (manual o por regla). */
const ADMITEN_CLASIFICACION = ['PENDIENTE', 'CLASIFICADO', 'REVISION']

function puedeTransicionar(desde, hacia) {
  return (TRANSICIONES[desde] || []).includes(hacia)
}

function claveDedupe(rutEmpresa, tipoFlujo, tipoDoc, folio, periodoIngesta) {
  return crypto
    .createHash('sha256')
    .update([rutEmpresa, tipoFlujo, tipoDoc, folio, periodoIngesta].join('|'))
    .digest('hex')
    .slice(0, 32)
}

function enteroSeguro(valor) {
  const n = Number(valor)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/**
 * Normaliza fechas del RCV a ISO (YYYY-MM-DD). El SII entrega DD/MM/YYYY
 * (p. ej. "14/09/2026"); sin esta normalización la confirmación de propuestas
 * no reconoce la fecha del documento y el asiento se fecha HOY — rompiendo el
 * devengo. Formato desconocido se conserva tal cual (visible, nunca inventado).
 */
function normalizarFechaSII(valor) {
  const s = String(valor ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10) // ya ISO
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/) // DD/MM/YYYY del RCV
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return s
}

/**
 * Normaliza un documento tal como lo entrega la integración SII existente
 * (consultarRCV → {folio, rutDoc, razonSocial, monto*, tipoDoc, fechaDocto,
 * fechaReclamo, montos, detalleSII}) a la forma de la bandeja. Única
 * frontera REAL→INTEGER: todo monto pasa por Math.round aquí.
 */
function mapearDocumentoRCV(doc, tipoFlujo) {
  if (!TIPOS_FLUJO.includes(tipoFlujo)) throw new Error(`tipo_flujo inválido: ${tipoFlujo} (esperado compra|venta)`)
  return {
    tipo_flujo: tipoFlujo,
    tipo_doc: Number(doc.tipoDoc) || 0,
    folio: String(doc.folio ?? '').trim(),
    rut_contraparte: String(doc.rutDoc ?? '').trim().toUpperCase(),
    razon_social: doc.razonSocial ? String(doc.razonSocial).trim().slice(0, 300) : null,
    fecha_docto: normalizarFechaSII(doc.fechaDocto),
    fecha_reclamo: normalizarFechaSII(doc.fechaReclamo),
    monto_exento: enteroSeguro(doc.montoExento),
    monto_neto: enteroSeguro(doc.montoNeto),
    monto_iva: enteroSeguro(doc.montoIVA),
    monto_total: enteroSeguro(doc.montoTotal),
    montos_sii_json: doc.montos ? JSON.stringify(doc.montos) : null,
    detalle_sii_json: doc.detalleSII ? JSON.stringify(doc.detalleSII) : null,
  }
}

const SELECT_BASE = `
  SELECT d.*,
         c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre,
         cc.codigo AS cc_codigo, cc.nombre AS cc_nombre,
         r.nombre AS regla_nombre,
         a.folio AS asiento_folio, a.anio AS asiento_anio
  FROM documentos d
  LEFT JOIN cuentas c ON c.id = d.cuenta_id
  LEFT JOIN centros_costo cc ON cc.id = d.centro_costo_id
  LEFT JOIN reglas_contables r ON r.id = d.regla_id
  LEFT JOIN asientos a ON a.id = d.asiento_id
`

/**
 * Ingesta idempotente de un lote de documentos RCV ya consultados.
 * Devuelve contadores {recibidos, validos, insertados, duplicados, en_revision, errores}.
 * Los documentos con problema de identidad (sin folio/tipo/RUT) NO detienen el
 * lote: se reportan en `errores` y el resto se inserta. Duplicado (misma clave
 * dedupe) se salta sin error. Todo dentro de una transacción atómica auditada.
 */
function ingestarBatch(db, { empresaId, usuarioId, tipoFlujo, periodo, documentos, informeId = null, ip = null }) {
  if (!TIPOS_FLUJO.includes(tipoFlujo)) throw new Error(`tipo_flujo inválido: ${tipoFlujo}`)
  if (!periodos.validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const empresa = db.prepare(`SELECT id, rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  const validos = []
  const errores = []
  for (const doc of documentos || []) {
    try {
      const m = mapearDocumentoRCV(doc, tipoFlujo)
      if (!m.folio) throw new Error('documento sin folio')
      if (!m.tipo_doc) throw new Error('documento sin tipo de documento')
      // Las MC (60/61) y las boletas (39/41, incluida la venta por medios de
      // pago electrónico) NO requieren RUT de contraparte: el RCV las entrega
      // con rutDoc vacío y su monto es venta real. Otros tipos SÍ exige RUT.
      if (!m.rut_contraparte && !BOLETAS_TIPOS.includes(m.tipo_doc)) {
        throw new Error('documento sin RUT de contraparte')
      }
      // Boleta sin contraparte: rotulamos el destinatario (consumidor final)
      // para que la bandeja revista algo legible.
      if (!m.rut_contraparte && !m.razon_social) m.razon_social = 'Consumidor final'
      validos.push(m)
    } catch (err) {
      errores.push({ folio: doc && doc.folio != null ? String(doc.folio) : null, error: err.message })
    }
  }

  let insertados = 0
  let duplicados = 0
  let enRevision = 0
  const clasificacionContraparte = tipoFlujo === 'compra' ? 'proveedor' : 'cliente'

  const tx = db.transaction(() => {
    const insertar = db.prepare(`
      INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
        fecha_docto, fecha_reclamo, monto_exento, monto_neto, monto_iva, monto_total,
        montos_sii_json, detalle_sii_json, estado, informe_id, origen, periodo_ingesta, clave_dedupe)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sii', ?, ?)
      ON CONFLICT(empresa_id, clave_dedupe) DO NOTHING
    `)
    const upsertContraparte = db.prepare(`
      INSERT INTO contrapartes (empresa_id, rut, razon_social, clasificacion, ultima_vez_en)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(empresa_id, rut) DO UPDATE SET
        razon_social = COALESCE(excluded.razon_social, contrapartes.razon_social),
        clasificacion = CASE
          WHEN contrapartes.clasificacion = 'desconocida' THEN excluded.clasificacion
          WHEN contrapartes.clasificacion = excluded.clasificacion THEN contrapartes.clasificacion
          ELSE 'ambos' END,
        ultima_vez_en = datetime('now')
    `)

    for (const m of validos) {
      const clave = claveDedupe(empresa.rut, tipoFlujo, m.tipo_doc, m.folio, periodo)
      // §5: monto 0 → REVISIÓN (divergencia visible para el humano)
      const estado = m.monto_total <= 0 ? ESTADOS.REVISION : ESTADOS.PENDIENTE
      const info = insertar.run(
        empresaId, m.tipo_flujo, m.tipo_doc, m.folio, m.rut_contraparte, m.razon_social,
        m.fecha_docto, m.fecha_reclamo, m.monto_exento, m.monto_neto, m.monto_iva, m.monto_total,
        m.montos_sii_json, m.detalle_sii_json, estado, informeId, periodo, clave
      )
      if (info.changes > 0) {
        insertados++
        if (estado === ESTADOS.REVISION) enRevision++
      } else {
        duplicados++
      }
      // Las boletas sin contraparte NO crean fila en `contrapartes` (no hay RUT).
      if (m.rut_contraparte) upsertContraparte.run(empresaId, m.rut_contraparte, m.razon_social, clasificacionContraparte)
    }

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'documentos.ingestar', entidad: 'documentos', entidadId: periodo,
      despues: {
        periodo, tipo_flujo: tipoFlujo,
        recibidos: (documentos || []).length, validos: validos.length,
        insertados, duplicados, en_revision: enRevision, errores: errores.length,
        ...(informeId ? { informe_id: informeId } : {}),
      },
      ip,
    })
  })
  tx()

  return {
    recibidos: (documentos || []).length,
    validos: validos.length,
    insertados,
    duplicados,
    en_revision: enRevision,
    errores,
  }
}

/**
 * Bandeja con filtros (período, flujo, estado, tipo doc, RUT, texto, cuenta).
 * Devuelve página + total + sumas del filtro completo + conteo por estado
 * (mismos filtros salvo el estado) para las pestañas de la UI.
 */
/**
 * Columnas ordenables de la bandeja (LISTA BLANCA: el nombre nunca llega al
 * SQL — un `orden` desconocido cae al orden por id). El folio se castea porque
 * es TEXT y "101" ordenaría antes que "9".
 */
const ORDEN_BANDEJA = {
  tipo_doc: 'd.tipo_doc',
  folio: 'CAST(d.folio AS INTEGER)',
  fecha_docto: 'd.fecha_docto',
  razon_social: 'd.razon_social',
  rut_contraparte: 'd.rut_contraparte',
  monto_neto: 'd.monto_neto',
  monto_iva: 'd.monto_iva',
  monto_total: 'd.monto_total',
}

function listar(db, { empresaId, periodo = null, tipoFlujo = null, estado = null, tipoDoc = null, rut = null, texto = null, cuentaId = null, orden = null, dir = null, limit = 200, offset = 0 }) {
  const where = ['d.empresa_id = ?']
  const params = [empresaId]
  if (periodo) { where.push('d.periodo_ingesta = ?'); params.push(periodo) }
  if (tipoFlujo) { where.push('d.tipo_flujo = ?'); params.push(tipoFlujo) }
  if (tipoDoc) { where.push('d.tipo_doc = ?'); params.push(Number(tipoDoc)) }
  if (cuentaId) { where.push('d.cuenta_id = ?'); params.push(Number(cuentaId)) }
  if (rut) { where.push('d.rut_contraparte LIKE ?'); params.push(`%${String(rut).replace(/[.\-]/g, '')}%`) }
  if (texto) {
    where.push('(d.razon_social LIKE ? OR d.folio LIKE ?)')
    const patron = `%${texto}%`
    params.push(patron, patron)
  }
  const whereBase = where.join(' AND ')

  // Conteo por estado con TODOS los filtros menos el de estado (pestañas UI)
  const resumenEstados = db.prepare(`
    SELECT d.estado, COUNT(*) AS n FROM documentos d WHERE ${whereBase} GROUP BY d.estado
  `).all(...params)

  // Recién ahora se añade el filtro de estado para la página y las sumas
  if (estado) { where.push('d.estado = ?'); params.push(estado) }
  const whereSql = where.join(' AND ')

  const sumas = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(${SIGNO_NC}(d.monto_neto)), 0) AS neto,
           COALESCE(SUM(${SIGNO_NC}(d.monto_iva)), 0) AS iva, COALESCE(SUM(${SIGNO_NC}(d.monto_total)), 0) AS total
    FROM documentos d WHERE ${whereSql}
  `).get(...params)

  const total = sumas.n
  // Orden de servidor: abarca TODO el filtro (no solo la página) y usa
  // desempate por id para que la paginación sea estable entre páginas.
  const columnaOrden = ORDEN_BANDEJA[orden] || 'd.id'
  const sentido = String(dir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  const documentos = db.prepare(`
    ${SELECT_BASE} WHERE ${whereSql}
    ORDER BY ${columnaOrden} ${sentido}, d.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0)

  return { total, sumas, estados: resumenEstados, documentos }
}

/** Documento por id, aislado por empresa (null si no pertenece). */
function obtener(db, empresaId, documentoId) {
  return db.prepare(`${SELECT_BASE} WHERE d.id = ? AND d.empresa_id = ?`).get(documentoId, empresaId) || null
}

/**
 * Clasificación manual: cuenta imputable + centro de costo + tratamiento IVA.
 * PENDIENTE/CLASIFICADO/REVISION → CLASIFICADO (re-clasificar es volver a pasar
 * por aquí). Auditado con antes/después.
 */
/**
 * Marca un documento en REVISIÓN con el motivo de la divergencia (§5) y deja
 * auditado el hallazgo. Usado por el pipeline cuando la propuesta nace
 * descuadrada (datos inconsistentes del RCV: neto+IVA ≠ total) o ante
 * cualquier regla de negocio que detecte un problema en el documento.
 */
function marcarRevision(db, { empresaId, usuarioId, documentoId, motivo, ip = null }) {
  const doc = obtener(db, empresaId, documentoId)
  if (!doc) throw new Error('Documento no encontrado en esta empresa')
  const texto = String(motivo || '').trim()
  if (!texto) throw new Error('El motivo de revisión es obligatorio')
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE documentos SET estado = 'REVISION', actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(documentoId, empresaId)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'documento.marcar_revision', entidad: 'documentos', entidadId: String(documentoId),
      antes: { estado: doc.estado },
      despues: { estado: 'REVISION', motivo: texto.slice(0, 500) },
      ip,
    })
  })
  tx()
  return obtener(db, empresaId, documentoId)
}

function clasificar(db, { empresaId, usuarioId, documentoId, cuentaId, centroCostoId = null, tratamientoIva = 'credito', reglaId = null, ip = null }) {
  const doc = obtener(db, empresaId, documentoId)
  if (!doc) throw new Error('Documento no encontrado en esta empresa')
  if (!ADMITEN_CLASIFICACION.includes(doc.estado)) {
    throw new Error(`Documento en estado ${doc.estado}: no admite clasificación`)
  }
  const cuenta = cuentas.obtener(db, empresaId, Number(cuentaId))
  if (!cuenta) throw new Error('Cuenta no encontrada en esta empresa')
  if (!cuenta.activa || cuenta.es_resumen) {
    throw new Error('La cuenta debe estar activa y ser imputable (no resumen)')
  }
  if (!TRATAMIENTOS_IVA.includes(tratamientoIva)) {
    throw new Error(`Tratamiento IVA inválido: ${tratamientoIva} (usar: ${TRATAMIENTOS_IVA.join(', ')})`)
  }
  let ccId = null
  if (centroCostoId !== null && centroCostoId !== undefined && centroCostoId !== '') {
    const cc = centrosCosto.obtener(db, empresaId, Number(centroCostoId))
    if (!cc) throw new Error('Centro de costo no encontrado en esta empresa')
    if (!cc.activo) throw new Error('El centro de costo está inactivo')
    ccId = cc.id
  }
  if (reglaId !== null && reglaId !== undefined) {
    const regla = db.prepare(`SELECT id FROM reglas_contables WHERE id = ? AND empresa_id = ?`).get(reglaId, empresaId)
    if (!regla) throw new Error('Regla no encontrada en esta empresa')
  }

  const antes = { estado: doc.estado, cuenta_id: doc.cuenta_id, centro_costo_id: doc.centro_costo_id, tratamiento_iva: doc.tratamiento_iva, regla_id: doc.regla_id }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE documentos
      SET estado = 'CLASIFICADO', cuenta_id = ?, centro_costo_id = ?, tratamiento_iva = ?, regla_id = ?,
          actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(cuenta.id, ccId, tratamientoIva, reglaId, documentoId, empresaId)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'documento.clasificar', entidad: 'documentos', entidadId: String(documentoId),
      antes, despues: {
        estado: 'CLASIFICADO', cuenta_id: cuenta.id, cuenta_codigo: cuenta.codigo,
        centro_costo_id: ccId, tratamiento_iva: tratamientoIva, regla_id: reglaId,
        origen: reglaId ? 'regla' : 'manual',
      },
      ip,
    })
  })
  tx()

  return obtener(db, empresaId, documentoId)
}

/**
 * Anulación auditada (§5: nunca delete físico; el ajuste contable correspondiente
 * es un asiento manual). Un CONTABILIZADO no se anula: se revierte su asiento (F4).
 */
function anular(db, { empresaId, usuarioId, documentoId, motivo, ip = null }) {
  const doc = obtener(db, empresaId, documentoId)
  if (!doc) throw new Error('Documento no encontrado en esta empresa')
  if (doc.estado === ESTADOS.ANULADO) throw new Error('El documento ya está anulado')
  if (doc.estado === ESTADOS.CONTABILIZADO) {
    throw new Error('Un documento CONTABILIZADO no se anula: revierte su asiento y genera una nueva propuesta (FASE 4)')
  }
  const motivoLimpio = String(motivo || '').trim()
  if (!motivoLimpio) throw new Error('La anulación exige un motivo (queda auditado)')

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE documentos SET estado = 'ANULADO', actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(documentoId, empresaId)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'documento.anular', entidad: 'documentos', entidadId: String(documentoId),
      antes: { estado: doc.estado }, despues: { estado: 'ANULADO', motivo: motivoLimpio.slice(0, 500) },
      ip,
    })
  })
  tx()

  return obtener(db, empresaId, documentoId)
}module.exports = { ESTADOS, TRANSICIONES, TRATAMIENTOS_IVA, TIPOS_FLUJO, BOLETAS_TIPOS, ADMITEN_CLASIFICACION,
  puedeTransicionar, claveDedupe, mapearDocumentoRCV, ingestarBatch, normalizarFechaSII,
  listar, obtener, clasificar, anular, marcarRevision,
}
