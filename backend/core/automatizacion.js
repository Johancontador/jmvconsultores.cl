/**
 * AUTOMATIZACIÓN — pipeline de contabilización automática (POST-MVP).
 *
 * El flujo completo del sistema, resumido en UNA operación por período:
 *
 *   IVA Mensual (ingesta SII) → documentos PENDIENTE ┐
 *   reglas contables (FASE 3) → documentos CLASIFICADO ├→ pipeline → asientos
 *   propuestas (FASE 4) → documentos PROPUESTO        ┘
 *
 * Orquesta los módulos core EXISTENTES sin re-implementar nada:
 *  1. clasificar:  reglas.clasificarAutomatico sobre PENDIENTE/CLASIFICADO/REVISION
 *  2. proponer:    propuestas.generar sobre cada documento CLASIFICADO del período
 *  3. contabilizar: propuestas.confirmarLote sobre las propuestas PENDIENTE del período
 *
 * La confirmación SIEMPRE es la del núcleo FASE 4: asiento por asiento vía
 * asientos.crear (partida doble, período abierto, folio correlativo) y cada
 * paso queda auditado. El lote reporta los omitidos con su motivo — nunca
 * queda a medias silenciosamente (ACCOUNTING_DOMAIN §6/§7).
 *
 * Módulo puro: recibe la BD como parámetro (testeable).
 */

const reglas = require('./reglas')
const propuestas = require('./propuestas')
const periodos = require('./periodos')
const documentosCore = require('./documentos')
const { registrarAccion } = require('./auditoria')

/**
 * Ejecuta el pipeline completo de un período.
 *
 * @returns {{
 *   periodo: string,
 *   clasificados: number, evaluados: number, sin_regla: number,
 *   propuestas_nuevas: number, propuestas_fallidas: {documento_id:number, motivo:string}[],
 *   contabilizadas: number, omitidas: {propuesta_id:number, motivo:string}[],
 *   total_asientos: number,
 *   pasadas: { clasificar: object, proponer: object, contabilizar: object },
 * }}
 */
function ejecutar(db, { empresaId, usuarioId, periodo, ip = null }) {
  if (!periodos.validarFormato(periodo)) {
    throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  }
  const empresa = db.prepare(`SELECT id FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  // ---- 1. CLASIFICAR (reglas → documentos sin cuenta) ------------------------
  // Solo PENDIENTE y REVISIÓN: nunca se pisa una clasificación humana ya
  // aplicada (un CLASIFICADO solo se toca desde la bandeja o re-clasificación
  // manual). REVISIÓN sí se reintenta con las reglas vigentes; lo que no se
  // resuelve sigue visible para decisión humana.
  const r1 = reglas.clasificarAutomatico(db, {
    empresaId, usuarioId, periodo, tipoFlujo: null, documentoId: null,
    estados: ['PENDIENTE', 'REVISION'], ip,
  })

  // ---- 2. PROPONER (documento CLASIFICADO → propuesta PENDIENTE) -------------
  // Incluye CONTABILIZADO cuyo asiento ya fue REVERTIDO (§5: la corrección de
  // un documento contabilizado es revertir + re-proponer): el pipeline lo
  // re-levanta automáticamente en la corrida siguiente.
  const docsClasificados = db.prepare(`
    SELECT d.id, d.folio, d.tipo_doc FROM documentos d
    WHERE d.empresa_id = ? AND d.periodo_ingesta = ? AND (
      d.estado = 'CLASIFICADO'
      OR (d.estado = 'CONTABILIZADO' AND d.asiento_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM asientos a WHERE a.asiento_revertido_id = d.asiento_id))
    )
    ORDER BY d.id
  `).all(empresaId, periodo)

  let propuestasNuevas = 0
  const propuestasFallidas = []
  for (const doc of docsClasificados) {
    try {
      propuestas.generar(db, { empresaId, usuarioId, documentoId: doc.id, ip })
      propuestasNuevas++
    } catch (err) {
      propuestasFallidas.push({ documento_id: doc.id, folio: doc.folio, tipo_doc: doc.tipo_doc, motivo: err.message })
      // §5: una propuesta que nace descuadrada/divergente deja el documento en
      // REVISIÓN, visible en la bandeja para decisión humana (nunca silencio).
      try {
        documentosCore.marcarRevision(db, {
          empresaId, usuarioId, documentoId: doc.id,
          motivo: `Automatización: propuesta no generada — ${err.message}`, ip,
        })
      } catch { /* si el estado no admite la transición, se conserva el error original */ }
    }
  }

  // ---- 3. CONTABILIZAR (propuestas PENDIENTE → asientos del núcleo) ----------
  const r3 = propuestas.confirmarLote(db, {
    empresaId, usuarioId, periodo, propuestaIds: null, fecha: null, ip,
  })

  const resumen = {
    periodo,
    evaluados: r1.evaluados,
    clasificados: r1.clasificados,
    sin_regla: r1.sin_regla.length,
    propuestas_nuevas: propuestasNuevas,
    propuestas_fallidas: propuestasFallidas,
    contabilizadas: r3.aplicadas,
    omitidas: r3.omitidos,
    total_asientos: r3.total,
    pasadas: {
      clasificar: r1,
      proponer: { evaluados: docsClasificados.length, generadas: propuestasNuevas, fallidas: propuestasFallidas.length },
      contabilizar: { aplicadas: r3.aplicadas, omitidas: r3.omitidos.length },
    },
  }

  registrarAccion(db, {
    empresaId, usuarioId,
    accion: 'automatizacion.ejecutar', entidad: 'documentos', entidadId: periodo,
    despues: {
      periodo,
      clasificados: resumen.clasificados,
      propuestas_nuevas: resumen.propuestas_nuevas,
      propuestas_fallidas: resumen.propuestas_fallidas.length,
      contabilizadas: resumen.contabilizadas,
      omitidas: resumen.omitidas.length,
      total_asientos: resumen.total_asientos,
    },
    ip,
  })

  return resumen
}

/**
 * Estado del período para la UI (vista Automatización): cuántos documentos hay
 * en cada eslabón de la cadena y qué falta por resolver. Lectura pura.
 *
 * Nota: los estados del dominio son REVISION (sin tilde) y REVISIÓN lo muestra
 * la UI; el chip del front ya mapea ambos.
 */
function estado(db, { empresaId, periodo }) {
  if (!periodos.validarFormato(periodo)) {
    throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  }
  const empresa = db.prepare(`SELECT id, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  const porEstado = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ?
    GROUP BY estado
  `).all(empresaId, periodo)
  const conteo = Object.fromEntries(porEstado.map((r) => [r.estado, r.n]))

  const propuestasPend = db.prepare(`
    SELECT COUNT(*) AS n FROM propuestas p
    JOIN documentos d ON d.id = p.documento_id
    WHERE p.empresa_id = ? AND d.periodo_ingesta = ? AND p.estado = 'PENDIENTE'
  `).get(empresaId, periodo).n

  const contabilizados = conteo.CONTABILIZADO || 0
  const asientos = db.prepare(`
    SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ? AND periodo = ?
  `).get(empresaId, periodo).n

  const p = db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`).get(empresaId, periodo)
  const periodoAbierto = !p || p.estado === 'ABIERTO'

  const sinResolver = (conteo.PENDIENTE || 0) + (conteo.CLASIFICADO || 0)
    + (conteo.PROPUESTO || 0) + (conteo.REVISION || 0) + (conteo.ERROR || 0)

  return {
    periodo,
    periodo_abierto: periodoAbierto,
    documentos: conteo,
    sin_resolver: sinResolver,
    propuestas_pendientes: propuestasPend,
    asientos_del_periodo: asientos,
    contabilizados,
    reglas_activas: db.prepare(`SELECT COUNT(*) AS n FROM reglas_contables WHERE empresa_id = ? AND activa = 1`).get(empresaId).n,
  }
}

/** Última ejecución del pipeline en un período (desde auditoría), para la UI. */
function ultimaEjecucion(db, { empresaId, periodo }) {
  const row = db.prepare(`
    SELECT a.creado_en AS creado_en, u.username AS username, a.despues_json AS despues_json
    FROM auditoria a
    LEFT JOIN users u ON u.id = a.usuario_id
    WHERE a.empresa_id = ? AND a.accion = 'automatizacion.ejecutar' AND a.entidad_id = ?
    ORDER BY a.id DESC LIMIT 1
  `).get(empresaId, periodo)
  if (!row) return null
  let despues = null
  try { despues = JSON.parse(row.despues_json || 'null') } catch { /* snapshot corrupto: se ignora */ }
  return {
    cuando: row.creado_en,
    usuario: row.username || null,
    resumen: despues,
  }
}

module.exports = { ejecutar, estado, ultimaEjecucion }
