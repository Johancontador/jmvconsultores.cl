/**
 * DTE → CONTABILIDAD — BLOQUE 3 (cierra el riesgo crítico #1 de la auditoría 2A).
 *
 * Puente entre la emisión de DTE y el motor contable EXISTENTE, sin tocar
 * `core/asientos.js` ni inventar reglas tributarias:
 *
 *   DTE ACEPTADO (SII) → documento de BANDEJA (origen 'dte') → reglas del
 *   contador → PROPUESTA PENDIENTE → confirmación humana (§6) → asiento
 *   → vínculo `dte_emitidos.asiento_id`.
 *
 * Decisiones de diseño (auditoría 2A §Q/§S):
 *  - El MOMENTO CONTABLE es la ACEPTACIÓN del SII: un DTE rechazado/en error
 *    jamás genera documento contable (auditado §10 del informe).
 *  - La propuesta nace vía el MISMO motor de reglas de la bandeja
 *    (reglas.clasificarAutomatico): cuentas = decisiones del contador, jamás
 *    hardcodeadas. Sin regla → documento PENDIENTE visible en la bandeja y en
 *    la memoria de "nuevos por ubicar" (honestidad §42).
 *  - La confirmación humana (propuestas.confirmar) es la única puerta al
 *    asiento — ACCOUNTING_DOMAIN §6. Este módulo jamás escribe asientos.
 *  - UNA SOLA REPRESENTACIÓN: el documento usa la MISMA clave_dedupe que la
 *    ingesta RCV (hash rut|venta|tipo|folio|periodo) — cuando el RCV traiga
 *    el DTE emitido, la ingesta lo dedupea contra este documento (ON CONFLICT
 *    DO NOTHING). Si el RCV llegó primero, aquí se apunta al documento
 *    existente. Nunca doble conteo.
 *  - Devengo: fecha_docto = fecha_emision del DTE → la confirmación fecha el
 *    asiento en su período (mismo criterio que la bandeja).
 *  - Conciliación FASE 4: al vivir el DTE como documento de bandeja, la
 *    conciliación SII↔contable lo ve automáticamente (sin tocarla).
 *  - Idempotente por construcción: solo procesa ACEPTADO sin documento_id y
 *    vincula asientos a DTEs sin asiento_id; re-ejecutar no duplica nada.
 *
 * Módulo puro: recibe la BD como parámetro; auditado sin secretos ni XML.
 */

const { registrarAccion } = require('./auditoria')
const documentos = require('./documentos')
const reglas = require('./reglas')
const propuestas = require('./propuestas')

/** '2026-10-04' → '202610' (mismo formato de periodo_ingesta de la bandeja). */
function periodoDesdeFecha(fechaISO) {
  const m = String(fechaISO || '').match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}${m[2]}` : null
}

/**
 * Sincroniza el universo DTE con la contabilidad (dos pasadas idempotentes):
 *
 *  PASADA 1 — cada DTE ACEPTADO sin documento_id → documento de bandeja
 *  (origen 'dte'), auto-clasificación por reglas del contador y propuesta
 *  PENDIENTE cuando una regla calza. Si la ingesta RCV ya trajo ese documento
 *  (misma clave_dedupe), se APUNTA a él (una sola representación).
 *
 *  PASADA 2 — cada DTE con documento CONTABILIZADO y asiento sin vincular →
 *  `dte_emitidos.asiento_id` (el bidireccional que la auditoría halló ausente).
 *
 * Devuelve resumen con conteos y detalles; auditado como UNA acción.
 */
function sincronizarContabilidad(db, { empresaId, usuarioId, ip = null }) {
  const empresa = db.prepare(`SELECT id, rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  // ---------------- PASADA 1: ACEPTADO → documento de bandeja ----------------
  const aceptados = db.prepare(`
    SELECT * FROM dte_emitidos
    WHERE empresa_id = ? AND estado = 'ACEPTADO' AND documento_id IS NULL
    ORDER BY id
  `).all(empresaId)

  const creados = []
  const enlazadosExistente = []
  const sinRegla = []
  const fallidos = []
  let propuestasCreadas = 0

  const insertarDoc = db.prepare(`
    INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
      fecha_docto, monto_exento, monto_neto, monto_iva, monto_total,
      estado, origen, periodo_ingesta, clave_dedupe)
    VALUES (?, 'venta', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', 'dte', ?, ?)
  `)

  for (const dte of aceptados) {
    const periodo = periodoDesdeFecha(dte.fecha_emision)
    const clave = documentos.claveDedupe(empresa.rut, 'venta', dte.tipo_dte, String(dte.folio), periodo)
    try {
      const tx = db.transaction(() => {
        const existente = db.prepare(`
          SELECT id, estado FROM documentos WHERE empresa_id = ? AND clave_dedupe = ?
        `).get(empresaId, clave)
        let docId
        if (existente) {
          // La ingesta RCV llegó antes (o una pasada previa): UNA representación.
          docId = existente.id
          enlazadosExistente.push({ dte_id: dte.id, documento_id: docId, estado: existente.estado })
        } else {
          docId = Number(insertarDoc.run(
            empresaId, dte.tipo_dte, String(dte.folio), dte.receptor_rut, dte.receptor_razon_social,
            dte.fecha_emision, dte.monto_exento, dte.monto_neto, dte.monto_iva, dte.monto_total,
            periodo, clave,
          ).lastInsertRowid)
          creados.push({ dte_id: dte.id, documento_id: docId, tipo_dte: dte.tipo_dte, folio: dte.folio })

          // Auto-clasificación con las reglas DEL CONTADOR (jamás cuentas inventadas).
          const r = reglas.clasificarAutomatico(db, {
            empresaId, usuarioId, documentoId: docId, estados: ['PENDIENTE'], ip,
          })
          if (r.clasificados > 0) {
            // Propuesta PENDIENTE esperando confirmación humana (§6).
            try {
              propuestas.generar(db, { empresaId, usuarioId, documentoId: docId, ip })
              propuestasCreadas++
            } catch (err) {
              // Documento clasificado pero propuesta no nace (p. ej. alias
              // contraparte ausente): queda CLASIFICADO, visible, se NOMINA.
              fallidos.push({ dte_id: dte.id, documento_id: docId, etapa: 'propuesta', motivo: String(err.message).slice(0, 200) })
            }
          } else {
            sinRegla.push({ dte_id: dte.id, documento_id: docId })
          }
        }
        db.prepare(`UPDATE dte_emitidos SET documento_id = ?, actualizado_en = datetime('now') WHERE id = ?`)
          .run(docId, dte.id)
        return docId
      })
      tx()
    } catch (err) {
      fallidos.push({ dte_id: dte.id, etapa: 'documento', motivo: String(err.message).slice(0, 200) })
    }
  }

  // ---------------- PASADA 2: documento CONTABILIZADO → asiento_id ----------------
  const candidatos = db.prepare(`
    SELECT d.id AS dte_id, d.documento_id, doc.asiento_id, a.folio AS asiento_folio, a.anio AS asiento_anio
    FROM dte_emitidos d
    JOIN documentos doc ON doc.id = d.documento_id
    LEFT JOIN asientos a ON a.id = doc.asiento_id
    WHERE d.empresa_id = ? AND d.documento_id IS NOT NULL AND d.asiento_id IS NULL
      AND doc.estado = 'CONTABILIZADO' AND doc.asiento_id IS NOT NULL
    ORDER BY d.id
  `).all(empresaId)

  const vinculados = []
  const txVinculo = db.transaction(() => {
    const upd = db.prepare(`UPDATE dte_emitidos SET asiento_id = ?, actualizado_en = datetime('now') WHERE id = ?`)
    for (const c of candidatos) {
      upd.run(c.asiento_id, c.dte_id)
      vinculados.push({ dte_id: c.dte_id, documento_id: c.documento_id, asiento_id: c.asiento_id, asiento: `${c.asiento_folio}/${c.asiento_anio}` })
    }
  })
  txVinculo()

  // Resumen de lo omitido (los estados que NO generan contabilidad — honesto).
  const omitidos = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM dte_emitidos
    WHERE empresa_id = ? AND estado != 'ACEPTADO'
    GROUP BY estado
  `).all(empresaId)

  const resumen = {
    aceptados_procesados: aceptados.length,
    documentos_creados: creados.length,
    documentos_enlazados_por_dedupe: enlazadosExistente.length,
    propuestas_creadas: propuestasCreadas,
    sin_regla: sinRegla.length,
    asientos_vinculados: vinculados.length,
    omitidos_por_estado: omitidos,
    ...(creados.length ? { detalle_creados: creados } : {}),
    ...(enlazadosExistente.length ? { detalle_dedupe: enlazadosExistente } : {}),
    ...(vinculados.length ? { detalle_vinculados: vinculados } : {}),
    ...(sinRegla.length ? { detalle_sin_regla: sinRegla } : {}),
    ...(fallidos.length ? { fallidos } : {}),
  }

  if (aceptados.length || vinculados.length) {
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'dte.contabilizar.sincronizar', entidad: 'dte_emitidos', entidadId: `${creados.length}+${vinculados.length}`,
      despues: resumen,
      ip,
    })
  }

  return resumen
}

module.exports = { sincronizarContabilidad, periodoDesdeFecha }
