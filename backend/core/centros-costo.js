/**
 * Centros de costo (FASE 2) — dimensión analítica opcional por empresa.
 * Módulo puro, con aislamiento y auditoría.
 */

const { registrarAccion } = require('./auditoria')

function listar(db, empresaId, soloActivos = false) {
  return db.prepare(`
    SELECT id, codigo, nombre, activo FROM centros_costo
    WHERE empresa_id = ? ${soloActivos ? 'AND activo = 1' : ''} ORDER BY codigo
  `).all(empresaId)
}

function obtener(db, empresaId, centroCostoId) {
  return db.prepare(`
    SELECT id, codigo, nombre, activo FROM centros_costo
    WHERE id = ? AND empresa_id = ?
  `).get(centroCostoId, empresaId) || null
}

function crear(db, { empresaId, usuarioId, codigo, nombre, ip = null }) {
  if (!codigo || !String(codigo).trim()) throw new Error('Código de centro de costo obligatorio')
  const nombreLimpio = String(nombre || '').trim()
  if (!nombreLimpio) throw new Error('Nombre de centro de costo obligatorio')
  const codigoLimpio = String(codigo).trim()

  const existe = db.prepare(`
    SELECT id FROM centros_costo WHERE empresa_id = ? AND codigo = ?
  `).get(empresaId, codigoLimpio)
  if (existe) throw new Error('Ya existe un centro de costo con ese código')

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO centros_costo (empresa_id, codigo, nombre) VALUES (?, ?, ?)
    `).run(empresaId, codigoLimpio, nombreLimpio)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'centro_costo.crear', entidad: 'centros_costo',
      entidadId: info.lastInsertRowid, despues: { codigo: codigoLimpio, nombre: nombreLimpio }, ip,
    })
    return info.lastInsertRowid
  })
  return obtener(db, empresaId, tx())
}

function desactivar(db, { empresaId, usuarioId, centroCostoId, ip = null }) {
  const cc = obtener(db, empresaId, centroCostoId)
  if (!cc) throw new Error('Centro de costo no encontrado')
  const enUso = db.prepare(`
    SELECT 1 FROM asiento_lineas WHERE centro_costo_id = ? LIMIT 1
  `).get(centroCostoId)
  if (enUso) throw new Error('El centro de costo tiene movimientos: no se puede desactivar')

  const tx = db.transaction(() => {
    db.prepare(`UPDATE centros_costo SET activo = 0 WHERE id = ?`).run(centroCostoId)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'centro_costo.desactivar', entidad: 'centros_costo',
      entidadId: centroCostoId, antes: { activo: 1 }, despues: { activo: 0 }, ip,
    })
  })
  tx()
  return { ok: true }
}

module.exports = { listar, obtener, crear, desactivar }
