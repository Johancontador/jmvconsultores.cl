/**
 * requirePermiso — RBAC a nivel de ruta (FASE 1).
 *
 * Uso: router.post('/empresas/:id/periodos/:periodo/cerrar', requirePermiso('periodos:cerrar'), handler)
 *
 * Resuelve el rol del usuario en la empresa (req.params.empresaId) y verifica
 * que el rol incluya la capacidad pedida. El super_admin global tiene todas.
 * Requiere requireAuth ANTES (necesita req.user).
 */

const db = require('../db')
const { rolEnEmpresa } = require('../core/empresas')
const { permisosDeRol, esCapacidadValida } = require('../core/permisos')

function requirePermiso(capacidad) {
  if (!esCapacidadValida(capacidad)) {
    throw new Error(`Capacidad RBAC no definida: ${capacidad}`)
  }
  return (req, res, next) => {
    const usuarioId = req.user && req.user.id
    if (!usuarioId) return res.status(401).json({ ok: false, error: 'No autenticado' })

    const empresaId = Number(req.params.empresaId)
    if (!Number.isInteger(empresaId) || empresaId <= 0) {
      return res.status(400).json({ ok: false, error: 'Empresa inválida' })
    }

    const rol = rolEnEmpresa(db, usuarioId, empresaId)
    if (!rol) return res.status(403).json({ ok: false, error: 'No tiene acceso a esta empresa' })

    const permisos = permisosDeRol(rol)
    if (!permisos.has(capacidad)) {
      return res.status(403).json({ ok: false, error: `Permiso requerido: ${capacidad}` })
    }

    req.empresaId = empresaId
    req.rolEmpresa = rol
    next()
  }
}

module.exports = { requirePermiso }
