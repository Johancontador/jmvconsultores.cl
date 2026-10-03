/**
 * Propuestas de asiento (FASE 4) — ACCOUNTING_DOMAIN §6.
 *
 * Una propuesta es un asiento PRE-VALIDADO pendiente de confirmación humana.
 *  - Generar desde documento CLASIFICADO: usa la clasificación del documento
 *    (cuenta imputable + CC + tratamiento IVA) y resuelve la contraparte
 *    (PROVEEDORES para compras, CLIENTES para ventas) por precedencia:
 *    regla del documento → contraparte recordada → alias de control.
 *  - El documento queda PROPUESTO con una propuesta PENDIENTE viva (UNIQUE).
 *  - Confirmar aplica EXACTAMENTE el snapshot de líneas (lineas_json): nunca
 *    regenera con reglas que pudieron cambiar entre medio.
 *  - Transición §5: PROPUESTO → CONTABILIZADO solo vía confirmación; un doc
 *    CONTABILIZADO no vuelve a PROPUESTO — su corrección es revertir el asiento
 *    y re-proponer (el documento vuelve a PROPUESTO con el asiento ya revertido).
 *  - Auditoría de cada paso (propuesta.crear/confirmar/confirmar_lote/descartar).
 *
 * Módulo puro: recibe la BD como parámetro; las rutas HTTP nunca escriben directo.
 */

const { registrarAccion } = require('./auditoria')
const cuentas = require('./cuentas')
const asientos = require('./asientos')
const documentosCore = require('./documentos')

const ESTADOS_PROPUESTA = { PENDIENTE: 'PENDIENTE', APLICADA: 'APLICADA', DESCARTADA: 'DESCARTADA' }

const SELECT_BASE = `
  SELECT p.*, d.tipo_flujo, d.tipo_doc, d.folio, d.rut_contraparte, d.razon_social,
         d.fecha_docto AS doc_fecha_docto, d.periodo_ingesta,
         d.monto_neto AS doc_monto_neto, d.monto_iva AS doc_monto_iva, d.monto_total AS doc_monto_total,
         d.estado AS doc_estado, d.asiento_id AS doc_asiento_id,
         ci.codigo AS cuenta_codigo, ci.nombre AS cuenta_nombre,
         cc.codigo AS cc_codigo, cc.nombre AS cc_nombre,
         cco.codigo AS contraparte_codigo, cco.nombre AS contraparte_nombre,
         r.nombre AS regla_nombre,
         a.folio AS asiento_folio, a.anio AS asiento_anio
  FROM propuestas p
  JOIN documentos d ON d.id = p.documento_id
  LEFT JOIN cuentas ci ON ci.id = p.cuenta_id
  LEFT JOIN centros_costo cc ON cc.id = p.centro_costo_id
  LEFT JOIN cuentas cco ON cco.id = p.cuenta_contraparte_id
  LEFT JOIN reglas_contables r ON r.id = p.regla_id
  LEFT JOIN asientos a ON a.id = p.aplicada_asiento_id
`

/** Compara RUTs en cualquiera de sus formas (con puntos/guion o normalizado). */
function rutNormalizado(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase()
}

/**
 * Resuelve la cuenta contraparte por orden de precedencia (§6 + memoria):
 *  1. cuenta_contraparte_id de la regla aplicada (configuración explícita)
 *  2. MEMORIA de contabilización: cuenta recordada para ese RUT en `contrapartes`
 *     (el auxiliar/proveedor/cliente se vincula solo el mes siguiente)
 *  3. MODO SIMPLE: la "cuenta regular" de la empresa (gastos para compras,
 *     ingresos para ventas) — pymes que no concilian: se netean contra el banco
 *  4. alias de control PROVEEDORES (compra) / CLIENTES (venta)
 */
function resolverContraparte(db, empresaId, { reglaId = null, rutContraparte, tipoFlujo }) {
  if (reglaId) {
    const regla = db.prepare(`SELECT cuenta_contraparte_id FROM reglas_contables WHERE id = ? AND empresa_id = ?`).get(reglaId, empresaId)
    if (regla && regla.cuenta_contraparte_id) return Number(regla.cuenta_contraparte_id)
  }
  const cp = db.prepare(`
    SELECT cuenta_id FROM contrapartes
    WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(rut, '.', ''), '-', ''), ' ', '') = ?
  `).get(empresaId, rutNormalizado(rutContraparte))
  if (cp && cp.cuenta_id) return Number(cp.cuenta_id)
  const config = require('./empresas').obtenerConfig(db, empresaId)
  if (config.modo_conciliacion === 'simple') {
    const regularId = tipoFlujo === 'venta' ? config.cuenta_regular_ingresos_id : config.cuenta_regular_gastos_id
    if (regularId) {
      const cta = cuentas.obtener(db, empresaId, regularId)
      if (cta && cta.activa) return cta.id
    }
  }
  const alias = tipoFlujo === 'venta' ? 'CLIENTES' : 'PROVEEDORES'
  const cta = cuentas.cuentaPorAlias(db, empresaId, alias)
  if (!cta) {
    throw new Error(`Cuenta contraparte no resuelta: la regla no la define, la contraparte no tiene memoria recordada y falta el alias ${alias}`)
  }
  return cta.id
}

/**
 * MEMORIA DE CONTABILIZACIÓN — vista para la UI:
 *  - memoria: cada RUT con la cuenta recordada a la que se contabiliza
 *    (el vínculo automático del mes siguiente).
 *  - nuevos: documentos CLASIFICADO/PROPUESTO de un RUT SIN memoria y sin regla
 *    con contraparte → la UI debe ofrecer ELEGIR a dónde contabilizar (y
 *    recordarlo). Es el prompt que pide el flujo del §6 para contrapartes nuevas.
 */
function memoria(db, empresaId) {
  const recordadas = db.prepare(`
    SELECT cp.rut, cp.razon_social, cp.clasificacion, cp.cuenta_id,
           c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre,
           (SELECT COUNT(*) FROM documentos d WHERE d.empresa_id = cp.empresa_id AND d.rut_contraparte = cp.rut) AS documentos
    FROM contrapartes cp LEFT JOIN cuentas c ON c.id = cp.cuenta_id
    WHERE cp.empresa_id = ?
    ORDER BY CASE WHEN cp.cuenta_id IS NULL THEN 0 ELSE 1 END, documentos DESC, cp.rut
  `).all(empresaId)

  const nuevos = db.prepare(`
    SELECT d.id, d.tipo_flujo, d.tipo_doc, d.folio, d.rut_contraparte, d.razon_social,
           d.monto_total, d.periodo_ingesta, d.estado,
           ci.codigo AS cuenta_codigo, ci.nombre AS cuenta_nombre
    FROM documentos d
    LEFT JOIN cuentas ci ON ci.id = d.cuenta_id
    WHERE d.empresa_id = ? AND d.estado IN ('CLASIFICADO', 'PROPUESTO')
      AND NOT EXISTS (SELECT 1 FROM contrapartes cp WHERE cp.empresa_id = d.empresa_id AND cp.rut = d.rut_contraparte AND cp.cuenta_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM reglas_contables r WHERE r.id = d.regla_id AND r.cuenta_contraparte_id IS NOT NULL)
    ORDER BY d.monto_total DESC
    LIMIT 200
  `).all(empresaId)

  return { memoria: recordadas, nuevos }
}

/**
 * Memoriza (o cambia) la cuenta regular de una contraparte: desde el próximo
 * documento, ese proveedor/cliente se contabiliza automáticamente contra esa
 * cuenta (precedencia 2 de resolverContraparte). Crea la contraparte si aún no
 * existe (p. ej. elegida desde la lista de "nuevos"). Auditado.
 */
function recordarMemoria(db, { empresaId, usuarioId, rut, cuentaId, ip = null }) {
  const cta = cuentas.obtener(db, empresaId, Number(cuentaId))
  if (!cta || !cta.activa) throw new Error('Cuenta de memoria inválida para esta empresa')
  // Reutiliza la fila existente (el RUT con el formato exacto que ingesta
  // guardó del SII) para no duplicar contrapartes con variantes del mismo RUT.
  const existente = db.prepare(`
    SELECT rut FROM contrapartes
    WHERE empresa_id = ? AND REPLACE(REPLACE(REPLACE(rut, '.', ''), '-', ''), ' ', '') = ?
  `).get(empresaId, rutNormalizado(rut))
  const rutNorm = existente ? existente.rut : require('./empresas').normalizarRut(rut)
  const nombre = db.prepare(`SELECT razon_social FROM documentos WHERE empresa_id = ? AND rut_contraparte = ? AND razon_social IS NOT NULL ORDER BY id DESC LIMIT 1`).get(empresaId, rutNorm)
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO contrapartes (empresa_id, rut, razon_social, clasificacion, cuenta_id, ultima_vez_en)
      VALUES (?, ?, ?, 'desconocida', ?, datetime('now'))
      ON CONFLICT(empresa_id, rut) DO UPDATE SET cuenta_id = excluded.cuenta_id, ultima_vez_en = datetime('now')
    `).run(empresaId, rutNorm, nombre ? nombre.razon_social : null, cta.id)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'memoria.contraparte', entidad: 'contrapartes', entidadId: rutNorm,
      despues: { rut: rutNorm, cuenta_id: cta.id, cuenta_codigo: cta.codigo }, ip,
    })
  })
  tx()
  return { rut: rutNorm, cuenta_id: cta.id, cuenta_codigo: cta.codigo, cuenta_nombre: cta.nombre }
}

function glosaLinea(doc, tipo) {
  const nombre = doc.razon_social || doc.rut_contraparte
  if (tipo === 'base') return `${nombre} — base imputable (neto + exento + otros)`
  return tipo === 'neto' ? `${nombre} — neto` : `${nombre} — total doc ${doc.folio}`
}

/**
 * Construye las líneas de la propuesta (§6). Montos enteros en pesos:
 *  - Compra con crédito:    Debe: imputable (base = total − IVA) + IVA_CREDITO (IVA); Haber: contraparte (total)
 *  - Compra sin crédito / uso común / no recuperable: Debe: imputable (total); Haber: contraparte (total)
 *  - Venta con IVA débito:  Debe: contraparte (total); Haber: ventas (base) + IVA_DEBITO (IVA)
 *  - Venta exenta/sin IVA:  Debe: contraparte (total); Haber: ventas (total)
 *  - NC (tipo 61/60): patas invertidas, conservando ΣD = ΣH (§6).
 *
 * La base imputable con crédito es `total − IVA` (no solo el neto): absorbe el
 * monto exento, los impuestos sin derecho a crédito que declara el propio RCV
 * (validación con datos reales: peajes exentos, "Impto. Sin Derecho a Credito")
 * y redondeos del SII — siempre ΣD = ΣH sin inventar montos. El IVA a crédito
 * es únicamente el IVA RECUPERABLE que declara el documento.
 */
function construirLineas(db, empresaId, doc) {
  const contra = resolverContraparte(db, empresaId, {
    reglaId: doc.regla_id, rutContraparte: doc.rut_contraparte, tipoFlujo: doc.tipo_flujo,
  })
  const esNC = [60, 61].includes(Number(doc.tipo_doc))
  const conIva = doc.tratamiento_iva === 'credito' && (Number(doc.monto_iva) || 0) > 0
  const neto = Number(doc.monto_neto) || 0
  const iva = Number(doc.monto_iva) || 0
  const total = Number(doc.monto_total) || 0
  // Base imputable con crédito: todo lo del documento que NO es IVA recuperable
  const base = Math.max(0, total - iva)

  let lineas
  if (doc.tipo_flujo === 'compra') {
    if (conIva) {
      const ivaCredito = cuentas.cuentaPorAlias(db, empresaId, 'IVA_CREDITO')
      if (!ivaCredito) throw new Error('Falta la cuenta IVA_CREDITO en el plan de la empresa')
      lineas = [
        { cuenta_id: Number(doc.cuenta_id), debe: base, haber: 0, glosa: glosaLinea(doc, 'base') },
        { cuenta_id: ivaCredito.id, debe: iva, haber: 0, glosa: 'IVA crédito fiscal' },
        { cuenta_id: contra, debe: 0, haber: total, glosa: glosaLinea(doc, 'total') },
      ]
    } else {
      lineas = [
        { cuenta_id: Number(doc.cuenta_id), debe: total, haber: 0, glosa: glosaLinea(doc, 'total') },
        { cuenta_id: contra, debe: 0, haber: total, glosa: glosaLinea(doc, 'total') },
      ]
    }
  } else {
    if (conIva) {
      const ivaDebito = cuentas.cuentaPorAlias(db, empresaId, 'IVA_DEBITO')
      if (!ivaDebito) throw new Error('Falta la cuenta IVA_DEBITO en el plan de la empresa')
      lineas = [
        { cuenta_id: contra, debe: total, haber: 0, glosa: glosaLinea(doc, 'total') },
        { cuenta_id: Number(doc.cuenta_id), debe: 0, haber: base, glosa: glosaLinea(doc, 'base') },
        { cuenta_id: ivaDebito.id, debe: 0, haber: iva, glosa: 'IVA débito fiscal' },
      ]
    } else {
      lineas = [
        { cuenta_id: contra, debe: total, haber: 0, glosa: glosaLinea(doc, 'total') },
        { cuenta_id: Number(doc.cuenta_id), debe: 0, haber: total, glosa: glosaLinea(doc, 'total') },
      ]
    }
  }

  if (esNC) {
    for (const l of lineas) {
      const debe = l.debe
      l.debe = l.haber
      l.haber = debe
    }
  }

  // Validación propia ANTES de guardar el snapshot: una propuesta jamás nace descuadrada.
  const totalDebe = lineas.reduce((s, l) => s + (l.debe || 0), 0)
  const totalHaber = lineas.reduce((s, l) => s + (l.haber || 0), 0)
  if (totalDebe !== totalHaber) throw new Error(`Propuesta DESCUADRADA: débitos ${totalDebe} ≠ créditos ${totalHaber}`)
  if (totalDebe === 0) throw new Error('La propuesta está en cero')

  return { lineas, total: totalDebe, contraparteId: contra }
}

/**
 * Genera la propuesta para un documento CLASIFICADO (o re-propone un PROPUESTO /
 * CONTABILIZADO-revertido según transiciones §5). Auditada. La propuesta previa
 * PENDIENTE se descarta (histórico) y se crea una nueva.
 */
function generar(db, { empresaId, usuarioId, documentoId, ip = null }) {
  const doc = documentosCore.obtener(db, empresaId, documentoId)
  if (!doc) throw new Error('Documento no encontrado en esta empresa')
  if (!['CLASIFICADO', 'PROPUESTO', 'CONTABILIZADO'].includes(doc.estado)) {
    throw new Error(`Documento en estado ${doc.estado}: no admite generar propuesta`)
  }
  if (doc.estado === 'CONTABILIZADO' && !doc.asiento_id) {
    throw new Error('Inconsistencia: documento CONTABILIZADO sin asiento')
  }
  if (doc.estado === 'CONTABILIZADO') {
    // Convención DATA_MODEL §B.2: la REVERSIÓN apunta al original
    // (reversion.asiento_revertido_id = original.id). Se comprueba en ambas
    // direcciones por robustez; antes solo se miraba la columna del original,
    // que revertir() nunca escribe — el re-propuesto tras revertir nunca
    // funcionaba (camino muerto detectado validando el pipeline con datos reales).
    const rev = db.prepare(`
      SELECT id FROM asientos
      WHERE (id = ? AND asiento_revertido_id IS NOT NULL) OR asiento_revertido_id = ?
    `).get(doc.asiento_id, doc.asiento_id)
    if (!rev) {
      throw new Error('Documento CONTABILIZADO vigente: primero revierte su asiento (asientos.revertir) y luego re-propón')
    }
  }
  if (!doc.cuenta_id) throw new Error('El documento no tiene cuenta imputable clasificada')

  const construida = construirLineas(db, empresaId, { ...doc, cuenta_contraparte_id: doc.cuenta_contraparte_id })
  const lineasJson = JSON.stringify(construida.lineas)

  let propuestaId
  const tx = db.transaction(() => {
    // Re-propuesta: la PENDIENTE anterior se descarta (queda en histórico)
    db.prepare(`
      UPDATE propuestas SET estado = 'DESCARTADA', descartada_en = datetime('now'),
        motivo_descarte = 'reemplazada por re-propuesta'
      WHERE documento_id = ? AND estado = 'PENDIENTE'
    `).run(documentoId)

    const info = db.prepare(`
      INSERT INTO propuestas (empresa_id, documento_id, cuenta_id, centro_costo_id, tratamiento_iva,
        cuenta_contraparte_id, regla_id, estado, lineas_json, propuesta_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)
    `).run(
      empresaId, documentoId, Number(doc.cuenta_id), doc.centro_costo_id ?? null,
      doc.tratamiento_iva || 'credito', construida.contraparteId, doc.regla_id ?? null,
      lineasJson, usuarioId
    )
    propuestaId = Number(info.lastInsertRowid)

    db.prepare(`
      UPDATE documentos SET estado = 'PROPUESTO', actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(documentoId, empresaId)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'propuesta.crear', entidad: 'propuestas', entidadId: String(propuestaId),
      antes: { doc_estado: doc.estado },
      despues: {
        documento_id: documentoId, doc_estado: 'PROPUESTO', total: construida.total,
        lineas: construida.lineas,
        ...(doc.estado === 'CONTABILIZADO' ? { re_propuesta_de_asiento: doc.asiento_id } : {}),
      },
      ip,
    })
  })
  tx()

  return obtener(db, empresaId, propuestaId)
}

/** Lista propuestas con filtros (estado, período de ingesta del documento). */
function listar(db, { empresaId, estado = null, periodo = null, limit = 200, offset = 0 }) {
  const where = ['d.empresa_id = ?']
  const params = [empresaId]
  if (estado) { where.push('p.estado = ?'); params.push(estado) }
  if (periodo) { where.push('d.periodo_ingesta = ?'); params.push(periodo) }
  const whereSql = where.join(' AND ')

  const sumas = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(d.monto_total), 0) AS total
    FROM propuestas p JOIN documentos d ON d.id = p.documento_id
    WHERE ${whereSql}
  `).get(...params)

  const propuestas = db.prepare(`
    ${SELECT_BASE} WHERE ${whereSql} ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0)

  return { total: sumas.n, sumas, propuestas }
}

/** Propuesta por id, aislada por empresa (JOIN documentos garantiza el scope). */
function obtener(db, empresaId, propuestaId) {
  return db.prepare(`${SELECT_BASE} WHERE p.id = ? AND d.empresa_id = ?`).get(propuestaId, empresaId) || null
}

/** Cuenta de contraparte aplicada en la confirmación: la que viene en el snapshot de líneas (patas de pasivo/cliente). */
function construidaContraparteDe(p) {
  try {
    const lineas = JSON.parse(p.lineas_json || '[]')
    const candidatas = lineas.filter((l) => Number(l.cuenta_id) === Number(p.cuenta_contraparte_id))
    if (candidatas.length) return Number(p.cuenta_contraparte_id)
    // Sin coincidencia por id (plan pudo cambiar): la pata del total del documento.
    const total = Number(p.doc_monto_total) || 0
    const pata = lineas.find((l) => (l.debe || 0) === total || (l.haber || 0) === total)
    return pata ? Number(pata.cuenta_id) : null
  } catch { return null }
}

/** Valida el snapshot guardado y decora con códigos de cuenta (para UI/confirmación). */
function validarLineasSnapshot(db, empresaId, lineasJson) {
  const lineas = JSON.parse(lineasJson)
  if (!Array.isArray(lineas) || lineas.length < 2) throw new Error('Snapshot de líneas inválido')
  const detalle = lineas.map((l) => {
    const cta = cuentas.obtener(db, empresaId, l.cuenta_id)
    if (!cta) throw new Error('El snapshot referencia una cuenta que no existe en esta empresa')
    return { ...l, cuenta_codigo: cta.codigo, cuenta_nombre: cta.nombre }
  })
  const debe = lineas.reduce((s, l) => s + (l.debe || 0), 0)
  const haber = lineas.reduce((s, l) => s + (l.haber || 0), 0)
  if (debe !== haber || debe === 0) throw new Error('Snapshot de líneas descuadrado o en cero')
  return { lineas: detalle, debe, haber, cuadrada: true }
}

/**
 * Confirma (contabiliza) una propuesta PENDIENTE — §5: PROPUESTO → CONTABILIZADO.
 * Asiento (núcleo FASE 2 con TODAS sus validaciones: partida doble, período
 * abierto con autocreación, folio correlativo) + documento CONTABILIZADO con
 * asiento_id + propuesta APLICADA. Auditado.
 * Fecha del asiento: fecha_docto del documento si existe (devengo en su período),
 * o HOY si falta / se pasa `fecha` explícita.
 */
function confirmar(db, { empresaId, usuarioId, propuestaId, fecha = null, glosa = null, ip = null }) {
  const p = obtener(db, empresaId, propuestaId)
  if (!p) throw new Error('Propuesta no encontrada en esta empresa')
  if (p.estado !== 'PENDIENTE') throw new Error(`Propuesta en estado ${p.estado}: solo PENDIENTE se confirma`)
  if (p.doc_estado !== 'PROPUESTO') {
    throw new Error(`Documento en estado ${p.doc_estado}: la confirmación exige documento PROPUESTO`)
  }

  const snapshot = validarLineasSnapshot(db, empresaId, p.lineas_json)
  const lineas = snapshot.lineas.map((l) => ({
    cuenta_id: l.cuenta_id, debe: l.debe, haber: l.haber,
    centro_costo_id: l.centro_costo_id ?? p.centro_costo_id ?? null,
    glosa: l.glosa || null,
  }))

  const fechaAsiento = /^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))
    ? fecha
    : (/^\d{4}-\d{2}-\d{2}$/.test(String(p.doc_fecha_docto || '')) ? String(p.doc_fecha_docto).slice(0, 10) : asientos.fechaHoy())
  const glosaAsiento = String(glosa || '').trim() ||
    `${p.tipo_flujo === 'compra' ? 'Compra' : 'Venta'} ${p.tipo_doc} folio ${p.folio} — ${p.razon_social || p.rut_contraparte}`

  const asiento = asientos.crear(db, {
    empresaId, usuarioId, fecha: fechaAsiento, glosa: glosaAsiento, tipo: 'automatico',
    lineas, origen: `propuesta:${propuestaId}`, ip,
  })

  const tx = db.transaction(() => {
    const updP = db.prepare(`
      UPDATE propuestas SET estado = 'APLICADA', aplicada_asiento_id = ?, aplicada_por = ?, aplicada_en = datetime('now')
      WHERE id = ? AND estado = 'PENDIENTE'
    `).run(asiento.id, usuarioId, propuestaId)
    const updD = db.prepare(`
      UPDATE documentos SET estado = 'CONTABILIZADO', asiento_id = ?, actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ? AND estado = 'PROPUESTO'
    `).run(asiento.id, p.documento_id, empresaId)
    if (updP.changes !== 1 || updD.changes !== 1) {
      throw new Error('La confirmación no pudo actualizar propuesta/documento (carrera de estados)')
    }
    // MEMORIA DE CONTABILIZACIÓN: la contraparte usada queda vinculada al RUT
    // (solo si aún no tenía memoria — jamás pisa una decisión ya recordada).
    // El próximo mes ese proveedor/cliente se contabiliza automáticamente ahí.
    const usada = db.prepare(`SELECT cuenta_id FROM contrapartes WHERE empresa_id = ? AND rut = ?`).get(empresaId, p.rut_contraparte)
    if (!usada || !usada.cuenta_id) {
      const contraUsada = construidaContraparteDe(p)
      if (contraUsada) {
        db.prepare(`
          UPDATE contrapartes SET cuenta_id = ?, ultima_vez_en = datetime('now')
          WHERE empresa_id = ? AND rut = ?
        `).run(contraUsada, empresaId, p.rut_contraparte)
      }
    }
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'propuesta.confirmar', entidad: 'propuestas', entidadId: String(propuestaId),
      antes: { estado: 'PENDIENTE', doc_estado: 'PROPUESTO' },
      despues: {
        estado: 'APLICADA', doc_estado: 'CONTABILIZADO',
        asiento_id: asiento.id, folio: asiento.folio, anio: asiento.anio, total: snapshot.debe,
      },
      ip,
    })
  })
  tx()

  return { propuesta: obtener(db, empresaId, propuestaId), asiento }
}

/**
 * Confirma EN LOTE las propuestas PENDIENTES (del período o todas). Cada una
 * pasa por confirmar() individual: las que fallen (p. ej. período cerrado)
 * se omiten y se reportan — el lote nunca queda a medias silenciosamente.
 */
function confirmarLote(db, { empresaId, usuarioId, periodo = null, propuestaIds = null, fecha = null, ip = null }) {
  const params = [empresaId]
  let sql = `
    SELECT p.id FROM propuestas p JOIN documentos d ON d.id = p.documento_id
    WHERE p.empresa_id = ? AND p.estado = 'PENDIENTE' AND d.estado = 'PROPUESTO'
  `
  if (periodo) { sql += ' AND d.periodo_ingesta = ?'; params.push(periodo) }
  sql += ' ORDER BY p.id'
  let pendientes = db.prepare(sql).all(...params)
  if (propuestaIds) {
    const filtro = new Set(propuestaIds.map(Number))
    pendientes = pendientes.filter((x) => filtro.has(Number(x.id)))
  }

  let aplicadas = 0
  let total = 0
  const omitidos = []
  for (const pend of pendientes) {
    try {
      const r = confirmar(db, { empresaId, usuarioId, propuestaId: pend.id, fecha, ip })
      aplicadas++
      total += r.asiento.lineas.reduce((s, l) => s + (l.debe || 0), 0)
    } catch (err) {
      omitidos.push({ propuesta_id: pend.id, motivo: err.message })
    }
  }

  if (aplicadas > 0 || omitidos.length > 0) {
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'propuesta.confirmar_lote', entidad: 'propuestas', entidadId: periodo || 'todas',
      despues: { aplicadas, omitidas: omitidos.length, total },
      ip,
    })
  }
  return { aplicadas, omitidos, total }
}

/**
 * Descarta una propuesta PENDIENTE: la propuesta queda DESCARTADA y el
 * documento vuelve a CLASIFICADO (re-clasificable / re-propgable). Auditado.
 */
function descartar(db, { empresaId, usuarioId, propuestaId, motivo = null, ip = null }) {
  const p = obtener(db, empresaId, propuestaId)
  if (!p) throw new Error('Propuesta no encontrada en esta empresa')
  if (p.estado !== 'PENDIENTE') throw new Error(`Propuesta en estado ${p.estado}: solo PENDIENTE se descarta`)
  if (p.doc_estado !== 'PROPUESTO') throw new Error(`Documento en estado ${p.doc_estado}: sin propuesta viva`)

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE propuestas SET estado = 'DESCARTADA', descartada_en = datetime('now'), motivo_descarte = ?
      WHERE id = ? AND estado = 'PENDIENTE'
    `).run(motivo ? String(motivo).slice(0, 500) : null, propuestaId)
    db.prepare(`
      UPDATE documentos SET estado = 'CLASIFICADO', actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ? AND estado = 'PROPUESTO'
    `).run(p.documento_id, empresaId)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'propuesta.descartar', entidad: 'propuestas', entidadId: String(propuestaId),
      antes: { estado: 'PENDIENTE', doc_estado: 'PROPUESTO' },
      despues: { estado: 'DESCARTADA', doc_estado: 'CLASIFICADO', motivo: motivo || null },
      ip,
    })
  })
  tx()
  return obtener(db, empresaId, propuestaId)
}

module.exports = {
  ESTADOS_PROPUESTA,
  generar, listar, obtener, confirmar, confirmarLote, descartar,
  validarLineasSnapshot, resolverContraparte, construirLineas,
  memoria, recordarMemoria,
}
