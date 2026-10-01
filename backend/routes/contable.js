/**
 * Rutas /api/contable — FASE 1 (fundación).
 * Todas exigen sesión (requireAuth, aplicado en index.js) y el RBAC resuelve
 * el rol del usuario en :empresaId por empresa (middleware requirePermiso).
 */

const express = require('express')
const db = require('../db')
const { requireAdmin } = require('../middleware/requireAuth')
const { requirePermiso } = require('../middleware/requirePermiso')
const empresas = require('../core/empresas')
const periodos = require('../core/periodos')
const auditoria = require('../core/auditoria')
const { PERMISOS_POR_ROL, CATALOGO_CAPACIDADES } = require('../core/permisos')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Catálogos (super admin) ----------

router.get('/roles', requireAdmin, (req, res) => {
  res.json({
    ok: true,
    roles: Object.keys(PERMISOS_POR_ROL).map((codigo) => ({
      codigo,
      capacidades: [...PERMISOS_POR_ROL[codigo]],
    })),
    capacidades: CATALOGO_CAPACIDADES,
  })
})

// ---------- Empresas ----------

router.get('/empresas', (req, res) => {
  try {
    res.json(empresas.listarParaUsuario(db, req.user.id))
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/empresas', requireAdmin, (req, res) => {
  try {
    const { rut, nombre, clave_sii, tasa_ppm, telefono, exento } = req.body
    const empresa = empresas.crear(db, {
      usuarioId: req.user.id, rut, nombre, claveSii: clave_sii,
      tasaPpm: tasa_ppm, telefono, exento, ip: ip(req),
    })
    res.status(201).json({ ok: true, empresa })
  } catch (err) {
    const code = /Ya existe|inválida|inválido|obligatorios/.test(err.message) ? 400 : 500
    res.status(code).json({ ok: false, error: err.message })
  }
})

router.put('/empresas/:empresaId', requirePermiso('empresas:editar'), (req, res) => {
  try {
    const { nombre, clave_sii, tasa_ppm, telefono, exento } = req.body
    const empresa = empresas.actualizar(db, {
      usuarioId: req.user.id, empresaId: req.empresaId,
      nombre, claveSii: clave_sii, tasaPpm: tasa_ppm, telefono, exento, ip: ip(req),
    })
    res.json({ ok: true, empresa })
  } catch (err) {
    const code = /inválida|inválido|No hay campos|No tiene acceso|no encontrada/.test(err.message) ? 400 : 500
    res.status(code).json({ ok: false, error: err.message })
  }
})

router.delete('/empresas/:empresaId', requireAdmin, (req, res) => {
  try {
    empresas.desactivar(db, { usuarioId: req.user.id, empresaId: req.empresaId, ip: ip(req) })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Clave SII: solo indicar si existe y si está cifrada — nunca devolver el valor.
router.get('/empresas/:empresaId', requirePermiso('empresas:ver'), (req, res) => {
  const e = empresas.obtenerParaUsuario(db, req.user.id, req.empresaId)
  if (!e) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' })
  const fila = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(req.empresaId)
  res.json({ ok: true, empresa: { ...e, clave_sii_configurada: !!fila.clave_sii } })
})

// ---------- Roles por empresa (super admin) ----------

router.get('/empresas/:empresaId/usuarios', requireAdmin, (req, res) => {
  const filas = db.prepare(`
    SELECT ue.usuario_id, u.username, r.codigo AS rol, ue.activo
    FROM usuario_empresa ue
    JOIN users u ON u.id = ue.usuario_id
    JOIN roles r ON r.id = ue.rol_id
    WHERE ue.empresa_id = ?
    ORDER BY u.username
  `).all(req.empresaId)
  res.json({ ok: true, usuarios: filas })
})

router.post('/empresas/:empresaId/usuarios', requireAdmin, (req, res) => {
  try {
    const { usuario_id, rol } = req.body
    empresas.asignarRol(db, {
      usuarioIdEjecutor: req.user.id,
      usuarioIdObjetivo: Number(usuario_id),
      empresaId: req.empresaId,
      rol,
      ip: ip(req),
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Períodos contables ----------

router.get('/empresas/:empresaId/periodos', requirePermiso('periodos:ver'), (req, res) => {
  res.json({ ok: true, periodos: periodos.listar(db, req.empresaId) })
})

// Crear (o devolver) un período — creación lazy declarativa desde la UI.
router.post('/empresas/:empresaId/periodos', requirePermiso('periodos:ver'), (req, res) => {
  try {
    const p = periodos.obtenerOCrear(db, req.empresaId, String(req.body.periodo || ''))
    res.status(201).json({ ok: true, periodo: p })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/periodos/:periodo/cerrar', requirePermiso('periodos:cerrar'), (req, res) => {
  try {
    const p = periodos.cerrar(db, req.empresaId, req.params.periodo, req.user.id)
    auditoria.registrarAccion(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      accion: 'periodo.cerrar', entidad: 'periodos_contables', entidadId: req.params.periodo,
      despues: { estado: 'CERRADO' }, ip: ip(req),
    })
    res.json({ ok: true, periodo: p })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/periodos/:periodo/reabrir', requirePermiso('periodos:reabrir'), (req, res) => {
  try {
    const p = periodos.reabrir(db, req.empresaId, req.params.periodo, req.user.id, req.body.motivo)
    auditoria.registrarAccion(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      accion: 'periodo.reabrir', entidad: 'periodos_contables', entidadId: req.params.periodo,
      despues: { estado: 'ABIERTO', motivo: String(req.body.motivo || '').slice(0, 500) }, ip: ip(req),
    })
    res.json({ ok: true, periodo: p })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Auditoría ----------

router.get('/empresas/:empresaId/auditoria', requirePermiso('auditoria:ver'), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500)
  const offset = Number(req.query.offset) || 0
  res.json({ ok: true, registros: auditoria.consultar(db, { empresaId: req.empresaId, limit, offset }) })
})

module.exports = router
