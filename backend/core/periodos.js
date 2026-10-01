/**
 * Períodos contables por empresa (FASE 1). El núcleo contable (FASE 2)
 * exige que toda fecha de asiento caiga en un período ABIERTO: aquí está
 * la única puerta de creación y consulta de esos períodos.
 *
 * Módulo puro: recibe la instancia de BD como parámetro (testeable,
 * usable dentro de transacciones).
 */

const ESTADOS = { ABIERTO: 'ABIERTO', CERRADO: 'CERRADO' }

function periodoDesdeFecha(fecha) {
  // 'YYYY-MM-DD' → 'AAAAMM'
  return String(fecha).slice(0, 7).replace('-', '')
}

function validarFormato(periodo) {
  return /^20\d{4}$/.test(String(periodo))
}

/** Devuelve el período (creándolo abierto si es el primer uso). */
function obtenerOCrear(db, empresaId, periodo) {
  if (!validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const existente = db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`)
    .get(empresaId, periodo)
  if (existente) return existente

  db.prepare(`INSERT INTO periodos_contables (empresa_id, periodo) VALUES (?, ?)`).run(empresaId, periodo)
  return db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`)
    .get(empresaId, periodo)
}

/** Exige que el período esté ABIERTO; lanza si no existe o está cerrado. */
function exigirAbierto(db, empresaId, periodo) {
  const p = db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`)
    .get(empresaId, periodo)
  if (!p) throw new Error(`El período ${periodo} de la empresa ${empresaId} no existe`)
  if (p.estado !== ESTADOS.ABIERTO) throw new Error(`El período ${periodo} está CERRADO: no admite modificaciones`)
  return p
}

/** Lista de períodos de una empresa, del más nuevo al más antiguo. */
function listar(db, empresaId) {
  return db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? ORDER BY periodo DESC`)
    .all(empresaId)
}

/**
 * Cierre de período (FASE 5 ejecutará los asientos de cierre; aquí solo el
 * control de estado, con precondición: no dejar documentos/asientos pendientes
 * se añadirá cuando existan). Auditado por el llamador (routes).
 */
function cerrar(db, empresaId, periodo, usuarioId) {
  exigirAbierto(db, empresaId, periodo)
  db.prepare(`
    UPDATE periodos_contables
    SET estado = 'CERRADO', cerrado_por = ?, cerrado_en = datetime('now'), reapertura_motivo = NULL
    WHERE empresa_id = ? AND periodo = ?
  `).run(usuarioId, empresaId, periodo)
  return db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`)
    .get(empresaId, periodo)
}

/** Reapertura excepcional (permiso separado, motivo obligatorio, auditado por el llamador). */
function reabrir(db, empresaId, periodo, usuarioId, motivo) {
  if (!motivo || !String(motivo).trim()) throw new Error('La reapertura exige un motivo')
  const info = db.prepare(`
    UPDATE periodos_contables
    SET estado = 'ABIERTO', reapertura_motivo = ?, cerrado_por = NULL, cerrado_en = NULL
    WHERE empresa_id = ? AND periodo = ? AND estado = 'CERRADO'
  `).run(String(motivo).trim(), empresaId, periodo)
  if (info.changes === 0) throw new Error(`El período ${periodo} no está cerrado o no existe`)
  return db
    .prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`)
    .get(empresaId, periodo)
}

module.exports = {
  ESTADOS,
  periodoDesdeFecha,
  validarFormato,
  obtenerOCrear,
  exigirAbierto,
  listar,
  cerrar,
  reabrir,
}
