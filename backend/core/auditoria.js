/**
 * Auditoría — bitácora inmutable de acciones (FASE 1).
 *
 * Toda mutación del software contable debe llamar registrarAccion. La tabla
 * auditoria no recibe UPDATE/DELETE del código: solo INSERT. Las correcciones
 * de negocio se registran como acciones nuevas, nunca editando la bitácora.
 *
 * Módulo puro: recibe la instancia de BD como parámetro para poder usarse
 * dentro de transacciones (db.transaction) del core contable.
 */

const LIMITE_JSON = 50000 // tamaño máximo de antes/despues serializados

function _serializar(valor) {
  if (valor === null || valor === undefined) return null
  const texto = typeof valor === 'string' ? valor : JSON.stringify(valor)
  if (texto.length > LIMITE_JSON) return texto.slice(0, LIMITE_JSON) + '…[truncado]'
  return texto
}

/**
 * registrarAccion(db, {
 *   empresaId, usuarioId, accion, entidad, entidadId, antes, despues, ip
 * }) → id insertado. Lanza si falta lo esencial (usuario, accion, entidad):
 * si la auditoría falla, la operación falla con ella.
 */
function registrarAccion(db, {
  empresaId = null,
  usuarioId,
  accion,
  entidad,
  entidadId = null,
  antes = null,
  despues = null,
  ip = null,
}) {
  if (!usuarioId) throw new Error('Auditoría: usuarioId es obligatorio')
  if (!accion) throw new Error('Auditoría: accion es obligatoria')
  if (!entidad) throw new Error('Auditoría: entidad es obligatoria')

  const info = db.prepare(`
    INSERT INTO auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, antes_json, despues_json, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    empresaId, usuarioId, accion, entidad,
    entidadId === null ? null : String(entidadId),
    _serializar(antes), _serializar(despues), ip
  )
  return info.lastInsertRowid
}

/** Consulta paginada de la bitácora, siempre filtrada por empresa (aislamiento). */
function consultar(db, { empresaId, limit = 100, offset = 0 }) {
  return db.prepare(`
    SELECT a.id, a.empresa_id, a.usuario_id, a.accion, a.entidad, a.entidad_id,
           a.antes_json, a.despues_json, a.ip, a.creado_en,
           u.username
    FROM auditoria a LEFT JOIN users u ON u.id = a.usuario_id
    WHERE a.empresa_id = ?
    ORDER BY a.id DESC
    LIMIT ? OFFSET ?
  `).all(empresaId, limit, offset)
}

module.exports = { registrarAccion, consultar }
