/**
 * Conciliación SII ↔ contabilidad (FASE 4) — ACCOUNTING_DOMAIN §9.
 *
 * Por empresa y período, compara por triplo (tipo DTE, folio, RUT contraparte):
 *  1. Documentos en bandeja (fuente: ingesta SII de FASE 3) vs documentos
 *     CONTABILIZADOS con asiento.
 *  2. Diferencias tipificadas: SOLO_SII (no contabilizado), MONTO_DIVERGENTE,
 *     IMPUESTO_DIVERGENTE. SOLO_CONTABLE (asiento sin documento SII) se lista
 *     como "ajustes sin documento" y NO se cuenta como diferencia (§9: es
 *     legítimo — apertura, depreciación, ajustes manuales).
 *  3. Totales tributario (bandeja) vs contable (asientos desde documentos) vs
 *     SII oficial cuando se pasa resumen (consultarResumen; para tests, datos
 *     ya consultados). Nunca recalcula el detalle del SII por su cuenta.
 *  4. Resultado visible y persistido en `conciliaciones` (UNIQUE empresa+periodo,
 *     re-ejecutar reemplaza el resultado); el histórico completo queda auditado.
 *
 * La conciliación REPORTA diferencias; jamás corrige nada en silencio (§1).
 * Módulo puro: recibe la BD como parámetro.
 */

const { registrarAccion } = require('./auditoria')

const TIPOS_DIFERENCIA = ['SOLO_SII', 'SOLO_CONTABLE', 'MONTO_DIVERGENTE', 'IMPUESTO_DIVERGENTE']

function normRut(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase()
}

function triploKey(tipoDoc, folio, rut) {
  return `${Number(tipoDoc)}|${String(folio).trim()}|${normRut(rut)}`
}

/** Sumas de la bandeja (lados tributario y contable del mismo universo SII). */
function sumasBandeja(db, empresaId, periodo) {
  const t = db.prepare(`
    SELECT COALESCE(SUM(monto_neto), 0) AS neto, COALESCE(SUM(monto_iva), 0) AS iva,
           COALESCE(SUM(monto_total), 0) AS total, COUNT(*) AS docs
    FROM documentos WHERE empresa_id = ? AND periodo_ingesta = ?
  `).get(empresaId, periodo)
  const c = db.prepare(`
    SELECT COALESCE(SUM(monto_neto), 0) AS neto, COALESCE(SUM(monto_iva), 0) AS iva,
           COALESCE(SUM(monto_total), 0) AS total, COUNT(*) AS docs
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? AND estado = 'CONTABILIZADO' AND asiento_id IS NOT NULL
  `).get(empresaId, periodo)
  return { tributario: t, contable: c }
}

/** Movimientos de asientos por período, con marcador de origen (para separar ajustes). */
function movimientosContables(db, empresaId, periodo) {
  return db.prepare(`
    SELECT a.id, a.folio, a.anio, a.fecha, a.tipo, a.origen, a.glosa,
           al.cuenta_id, al.debe, al.haber,
           d.id AS documento_id
    FROM asientos a
    JOIN asiento_lineas al ON al.asiento_id = a.id
    LEFT JOIN documentos d ON d.asiento_id = a.id
    WHERE a.empresa_id = ? AND a.periodo = ?
    ORDER BY a.id, al.id
  `).all(empresaId, periodo)
}

/**
 * Líneas de los asientos VINCULADOS a los documentos del período de ingesta,
 **seguidas por el vínculo asiento_id — no por el período contable**: con
 * devengo (fecha_docto), un doc ingestado en 202609 fechado 31/08 contabiliza
 * en 202608 y NO es divergencia.
 */
function lineasDeDocsContabilizados(db, empresaId, periodo) {
  return db.prepare(`
    SELECT d.id AS documento_id, al.cuenta_id, al.debe, al.haber
    FROM documentos d
    JOIN asientos a ON a.id = d.asiento_id
    JOIN asiento_lineas al ON al.asiento_id = a.id
    WHERE d.empresa_id = ? AND d.periodo_ingesta = ?
      AND d.estado = 'CONTABILIZADO' AND d.asiento_id IS NOT NULL
    ORDER BY d.id, al.id
  `).all(empresaId, periodo)
}

/**
 * Ejecuta la conciliación del período. `siiResumen` es OPCIONAL: un objeto
 * { neto, iva, total } con los totales oficiales del SII (consultarResumen,
 * compras+ventas con signo NC ya aplicado) para comparar también contra el
 * mundo tributario. Sin él, la conciliación queda bandeja ↔ contable.
 */
function ejecutar(db, { empresaId, usuarioId, periodo, siiResumen = null, ip = null }) {
  if (!/^20\d{4}$/.test(String(periodo || ''))) {
    throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  }

  // Lado 1: bandeja (universo SII ya ingestado)
  const sumas = sumasBandeja(db, empresaId, periodo)

  // Lado 2: asientos contables del período
  const movs = movimientosContables(db, empresaId, periodo)
  const asientosSinDoc = new Set(
    movs.filter((m) => m.documento_id === null).map((m) => `${m.folio}/${m.anio}`)
  )
  const contableDebe = movs.reduce((s, m) => s + (m.debe || 0), 0)
  const contableHaber = movs.reduce((s, m) => s + (m.haber || 0), 0)

  // Líneas por documento vía VÍNCULO (ver lineasDeDocsContabilizados) + índice
  // de asientos revertidos: un doc contabilizado cuyo asiento fue revertido ya
  // NO está en los libros → SOLO_SII (pendiente de re-proponer).
  const lineasPorDoc = new Map()
  for (const l of lineasDeDocsContabilizados(db, empresaId, periodo)) {
    if (!lineasPorDoc.has(l.documento_id)) lineasPorDoc.set(l.documento_id, [])
    lineasPorDoc.get(l.documento_id).push(l)
  }
  const asientosRevertidos = new Set(
    db.prepare(`SELECT asiento_revertido_id AS id FROM asientos WHERE empresa_id = ? AND asiento_revertido_id IS NOT NULL`)
      .all(empresaId).map((r) => r.id)
  )

  // Lado 3 (opcional): resumen oficial SII
  const sii = siiResumen ? {
    neto: Math.round(Number(siiResumen.neto) || 0),
    iva: Math.round(Number(siiResumen.iva) || 0),
    total: Math.round(Number(siiResumen.total) || 0),
  } : null

  // --- Diferencias documento a documento (triplo §9) ---
  const docs = db.prepare(`
    SELECT id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
           monto_neto, monto_iva, monto_total, estado, asiento_id
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ?
    ORDER BY id
  `).all(empresaId, periodo)

  const diferencias = []
  let contabilizados = 0
  for (const d of docs) {
    if (['ANULADO', 'ERROR'].includes(d.estado)) continue
    const key = triploKey(d.tipo_doc, d.folio, d.rut_contraparte)
    const asientoRevertido = d.asiento_id !== null && asientosRevertidos.has(d.asiento_id)
    const esContabilizado = d.estado === 'CONTABILIZADO' && d.asiento_id !== null && !asientoRevertido
    if (esContabilizado) contabilizados++

    if (!esContabilizado) {
      diferencias.push({
        tipo: 'SOLO_SII', clave: key, documento_id: d.id, tipo_flujo: d.tipo_flujo,
        tipo_doc: d.tipo_doc, folio: d.folio, rut: d.rut_contraparte,
        razon_social: d.razon_social, estado: asientoRevertido ? 'REVERTIDO' : d.estado,
        monto_neto: d.monto_neto, monto_iva: d.monto_iva, monto_total: d.monto_total,
      })
      continue
    }

    // Contabilizado: verificar que el asiento cuadre con el documento
    const lineasDoc = lineasPorDoc.get(d.id) || []
    const debe = lineasDoc.reduce((s, m) => s + (m.debe || 0), 0)
    const haber = lineasDoc.reduce((s, m) => s + (m.haber || 0), 0)
    if (debe !== d.monto_total) {
      diferencias.push({
        tipo: 'MONTO_DIVERGENTE', clave: key, documento_id: d.id, tipo_flujo: d.tipo_flujo,
        tipo_doc: d.tipo_doc, folio: d.folio, rut: d.rut_contraparte, razon_social: d.razon_social,
        monto_sii: d.monto_total, monto_contable: debe,
        detalle: `Σdébitos del asiento (${debe}) ≠ total del documento (${d.monto_total})`,
      })
    }
    // IVA: en una NC (60/61) el impuesto queda en la pata opuesta (§6)
    const esNC = [60, 61].includes(Number(d.tipo_doc))
    if (d.tipo_flujo === 'compra') {
      const ivaContable = lineasDoc
        .filter((m) => m.cuenta_id === ivaCreditoId(db, empresaId))
        .reduce((s, m) => s + (esNC ? (m.haber || 0) : (m.debe || 0)), 0)
      if (ivaContable !== d.monto_iva) {
        diferencias.push({
          tipo: 'IMPUESTO_DIVERGENTE', clave: key, documento_id: d.id, tipo_flujo: d.tipo_flujo,
          tipo_doc: d.tipo_doc, folio: d.folio, rut: d.rut_contraparte, razon_social: d.razon_social,
          iva_sii: d.monto_iva, iva_contable: ivaContable,
          detalle: `IVA crédito contabilizado (${ivaContable}) ≠ IVA del documento (${d.monto_iva})`,
        })
      }
    } else {
      const ivaContable = lineasDoc
        .filter((m) => m.cuenta_id === ivaDebitoId(db, empresaId))
        .reduce((s, m) => s + (esNC ? (m.debe || 0) : (m.haber || 0)), 0)
      if (ivaContable !== d.monto_iva) {
        diferencias.push({
          tipo: 'IMPUESTO_DIVERGENTE', clave: key, documento_id: d.id, tipo_flujo: d.tipo_flujo,
          tipo_doc: d.tipo_doc, folio: d.folio, rut: d.rut_contraparte, razon_social: d.razon_social,
          iva_sii: d.monto_iva, iva_contable: ivaContable,
          detalle: `IVA débito contabilizado (${ivaContable}) ≠ IVA del documento (${d.monto_iva})`,
        })
      }
    }
  }

  const resultado = {
    periodo,
    generado_en: new Date().toISOString(),
    resumen_estado: db.prepare(`
      SELECT estado, COUNT(*) AS n FROM documentos
      WHERE empresa_id = ? AND periodo_ingesta = ? GROUP BY estado
    `).all(empresaId, periodo),
    totales: {
      tributario: sumas.tributario,
      contable: {
        ...sumas.contable,
        // Vista contable total del período (asientos), independiente de la bandeja
        asientos_debe: contableDebe,
        asientos_haber: contableHaber,
      },
      ...(sii ? { sii } : {}),
      cuadre_contable: contableDebe === contableHaber,
    },
    diferencias,
    ajustes_sin_documento: [...asientosSinDoc],
    conteo_diferencias: diferencias.reduce((acc, d) => {
      acc[d.tipo] = (acc[d.tipo] || 0) + 1
      return acc
    }, {}),
  }
  if (sii) {
    resultado.totales.contra_sii = {
      neto_dif: sumas.tributario.neto - sii.neto,
      iva_dif: sumas.tributario.iva - sii.iva,
      total_dif: sumas.tributario.total - sii.total,
      cuadra: sumas.tributario.neto === sii.neto && sumas.tributario.iva === sii.iva,
    }
  }

  const nDif = diferencias.length
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO conciliaciones (empresa_id, periodo, fuente, resultado_json, diferencias, ejecutado_por)
      VALUES (?, ?, 'bandeja', ?, ?, ?)
      ON CONFLICT(empresa_id, periodo) DO UPDATE SET
        fuente = excluded.fuente, resultado_json = excluded.resultado_json,
        diferencias = excluded.diferencias, ejecutado_por = excluded.ejecutado_por,
        ejecutado_en = datetime('now')
    `).run(empresaId, periodo, JSON.stringify(resultado), nDif, usuarioId)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'conciliacion.ejecutar', entidad: 'conciliaciones', entidadId: periodo,
      despues: { diferencias: nDif, conteo: resultado.conteo_diferencias, con_resumen_sii: !!sii },
      ip,
    })
  })
  tx()

  return { ...resultado, diferencias_count: nDif }
}

function ivaCreditoId(db, empresaId) {
  const cta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'IVA_CREDITO' AND activa = 1`).get(empresaId)
  return cta ? cta.id : -1
}

function ivaDebitoId(db, empresaId) {
  const cta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'IVA_DEBITO' AND activa = 1`).get(empresaId)
  return cta ? cta.id : -1
}

/** Último resultado persistido del período (o null). */
function obtener(db, empresaId, periodo) {
  const fila = db.prepare(`
    SELECT c.*, u.username AS ejecutado_por_usuario
    FROM conciliaciones c LEFT JOIN users u ON u.id = c.ejecutado_por
    WHERE c.empresa_id = ? AND c.periodo = ?
  `).get(empresaId, periodo)
  if (!fila) return null
  return { ...fila, resultado: JSON.parse(fila.resultado_json) }
}

/**
 * Historial de ejecuciones por período (el resultado persistido es el último).
 * `periodo` es opcional: con él devuelve 0 o 1 fila, que es lo que necesita la
 * campana de notificaciones para saber si hay conciliación sin pedir el detalle
 * (ese GET responde 404 cuando no existe y ensuciaba la consola en cada carga).
 */
function listar(db, empresaId, limit = 50, periodo = null) {
  // resultado_json incluido: la UI de historial pinta el detalle de las
  // diferencias del último resultado persistido (sin re-ejecutar).
  const where = ['empresa_id = ?']
  const params = [empresaId]
  if (periodo) { where.push('periodo = ?'); params.push(String(periodo)) }
  return db.prepare(`
    SELECT id, empresa_id, periodo, fuente, resultado_json, diferencias, ejecutado_por, ejecutado_en
    FROM conciliaciones WHERE ${where.join(' AND ')} ORDER BY periodo DESC, ejecutado_en DESC LIMIT ?
  `).all(...params, Math.min(Number(limit) || 50, 200))
}

module.exports = { TIPOS_DIFERENCIA, ejecutar, obtener, listar, sumasBandeja, movimientosContables }
