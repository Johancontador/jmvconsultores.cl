/**
 * alertas.js — Centro de alertas (Fase 2 del onboarding JMV aprobado 2026-10-10).
 *
 * Tres grupos de señales REALES, sin nada adivinado:
 *  1. RECLAMADAS   — documentos del RCV con fecha_reclamo informada por el SII
 *                    (conflicto formal con la contraparte: no confiar como
 *                    gasto/crédito hasta resolver; el cierre los BLOQUEA).
 *  2. PENDIENTES   — documentos en bandeja sin contabilizar (estado PENDIENTE
 *                    o REVISIÓN), con monto comprometido por grupo.
 *  3. SINCRONIZACIÓN — días desde el último documento bajado (ingesta RCV):
 *                    atraso > 30 días es señal de datos desactualizados.
 *
 * Módulo puro: BD por parámetro, empresa por parámetro — el llamado valida
 * RBAC (admin_empresa ve lo SUYO, contador/super_admin el portafolio).
 */

const DIAS_SYNC_ATRASADA = 30

const SQL_RECLAMADAS = `
  SELECT id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
         fecha_docto, fecha_reclamo, monto_total, estado
  FROM documentos
  WHERE empresa_id = ? AND fecha_reclamo IS NOT NULL AND fecha_reclamo != ''
  ORDER BY fecha_reclamo DESC, id DESC
  LIMIT 200`

function reclamadas(db, empresaId) {
  const filas = db.prepare(SQL_RECLAMADAS).all(empresaId)
  const total = filas.reduce((s, f) => s + (f.monto_total || 0), 0)
  return { total, cantidad: filas.length, documentos: filas }
}

const SQL_PENDIENTES = `
  SELECT d.id, d.tipo_flujo, d.tipo_doc, d.folio, d.rut_contraparte, d.razon_social,
         d.fecha_docto, d.monto_total, d.estado, d.periodo_ingesta
  FROM documentos d
  WHERE empresa_id = ? AND d.estado IN ('PENDIENTE', 'REVISION', 'ERROR', 'CLASIFICADO', 'PROPUESTO')
  ORDER BY CASE d.estado WHEN 'REVISION' THEN 0 WHEN 'ERROR' THEN 1 ELSE 2 END, d.fecha_docto DESC
  LIMIT 200`

function pendientes(db, empresaId) {
  const filas = db.prepare(SQL_PENDIENTES).all(empresaId)
  const enRevision = filas.filter((f) => f.estado === 'REVISION' || f.estado === 'ERROR')
  const porPagar = filas.filter((f) => f.estado === 'PENDIENTE' || f.estado === 'CLASIFICADO' || f.estado === 'PROPUESTO')
  const suma = (lista) => lista.reduce((s, f) => s + (f.monto_total || 0), 0)
  return {
    cantidad: filas.length,
    en_revision: { cantidad: enRevision.length, monto: suma(enRevision), documentos: enRevision.slice(0, 50) },
    sin_contabilizar: { cantidad: porPagar.length, monto: suma(porPagar), documentos: porPagar.slice(0, 50) },
  }
}

/** Días desde el último documento ingestado (bandeja) para la empresa. */
function diasUltimaSincronizacion(db, empresaId) {
  const row = db.prepare(`SELECT MAX(creado_en) AS ultima FROM documentos WHERE empresa_id = ?`).get(empresaId)
  if (!row?.ultima) return null
  const fecha = new Date(String(row.ultima).replace(' ', 'T') + (row.ultima.includes('Z') ? '' : 'Z'))
  if (Number.isNaN(fecha.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 86400e3))
}

function sincronizacion(db, empresaId) {
  const dias = diasUltimaSincronizacion(db, empresaId)
  return {
    dias_desde_ultima: dias,
    atrasada: dias === null || dias > DIAS_SYNC_ATRASADA,
    umbral_dias: DIAS_SYNC_ATRASADA,
  }
}

/** Agregado completo de alertas de una empresa (lo que pinta la vista). */
function resumen(db, empresaId) {
  const recl = reclamadas(db, empresaId)
  const pend = pendientes(db, empresaId)
  const sync = sincronizacion(db, empresaId)
  const niveles = {
    criticas: (recl.cantidad > 0 ? 1 : 0) + (pend.en_revision.cantidad > 0 ? 1 : 0),
    advertencias: (pend.sin_contabilizar.cantidad > 0 ? 1 : 0) + (sync.atrasada ? 1 : 0),
  }
  return {
    empresa_id: empresaId,
    reclamadas: recl,
    pendientes: pend,
    sincronizacion: sync,
    resumen: niveles,
  }
}

/** Alertas de varias empresas (portafolio del contador): ordena por crítica. */
function multi(db, empresaIds) {
  return empresaIds.map((id) => {
    const r = resumen(db, id)
    return { empresa_id: id, criticas: r.resumen.criticas, advertencias: r.resumen.advertencias, detalle: r }
  }).sort((a, b) => (b.criticas - a.criticas) || (b.advertencias - a.advertencias))
}

module.exports = { reclamadas, pendientes, sincronizacion, diasUltimaSincronizacion, resumen, multi, DIAS_SYNC_ATRASADA }
