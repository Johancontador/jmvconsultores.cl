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
const asientos = require('../core/asientos')
const cuentas = require('../core/cuentas')
const centrosCosto = require('../core/centros-costo')
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

// ---------- Plan de cuentas y centros de costo (FASE 2) ----------

router.get('/empresas/:empresaId/cuentas', requirePermiso('cuentas:ver'), (req, res) => {
  res.json({ ok: true, cuentas: cuentas.listar(db, req.empresaId) })
})

router.get('/empresas/:empresaId/cuentas-imputables', requirePermiso('cuentas:ver'), (req, res) => {
  res.json({ ok: true, cuentas: cuentas.listarImputables(db, req.empresaId) })
})

router.post('/empresas/:empresaId/cuentas', requirePermiso('cuentas:editar'), (req, res) => {
  try {
    const c = cuentas.crear(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      codigo: req.body.codigo, nombre: req.body.nombre,
      esResumen: !!req.body.es_resumen, alias: req.body.alias, ip: ip(req),
    })
    res.status(201).json({ ok: true, cuenta: c })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.delete('/empresas/:empresaId/cuentas/:cuentaId', requirePermiso('cuentas:editar'), (req, res) => {
  try {
    cuentas.desactivar(db, { empresaId: req.empresaId, usuarioId: req.user.id, cuentaId: Number(req.params.cuentaId), ip: ip(req) })
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/centros-costo', requirePermiso('cuentas:ver'), (req, res) => {
  res.json({ ok: true, centros: centrosCosto.listar(db, req.empresaId) })
})

router.post('/empresas/:empresaId/centros-costo', requirePermiso('cuentas:editar'), (req, res) => {
  try {
    const cc = centrosCosto.crear(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      codigo: req.body.codigo, nombre: req.body.nombre, ip: ip(req),
    })
    res.status(201).json({ ok: true, centro: cc })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Asientos, diario y mayor (FASE 2) ----------

router.post('/empresas/:empresaId/asientos', requirePermiso('asientos:crear'), (req, res) => {
  try {
    const a = asientos.crear(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      fecha: req.body.fecha, glosa: req.body.glosa,
      tipo: req.body.tipo || 'manual', lineas: req.body.lineas, ip: ip(req),
    })
    res.status(201).json({ ok: true, asiento: a })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/asientos', requirePermiso('asientos:ver'), (req, res) => {
  const d = asientos.diario(db, {
    empresaId: req.empresaId,
    periodo: req.query.periodo || null,
    desde: req.query.desde || null,
    hasta: req.query.hasta || null,
    cuentaId: req.query.cuenta_id ? Number(req.query.cuenta_id) : null,
    centroCostoId: req.query.centro_costo_id ? Number(req.query.centro_costo_id) : null,
    texto: req.query.texto || null,
    limit: Math.min(Number(req.query.limit) || 100, 500),
    offset: Number(req.query.offset) || 0,
  })
  res.json({ ok: true, ...d })
})

router.post('/empresas/:empresaId/asientos/:asientoId/revertir', requirePermiso('asientos:revertir'), (req, res) => {
  try {
    const a = asientos.revertir(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      asientoId: Number(req.params.asientoId), glosa: req.body.glosa || null, ip: ip(req),
    })
    res.status(201).json({ ok: true, asiento: a })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/mayor', requirePermiso('asientos:ver'), (req, res) => {
  try {
    const m = asientos.mayor(db, {
      empresaId: req.empresaId,
      cuentaId: Number(req.query.cuenta_id),
      desde: req.query.desde || null,
      hasta: req.query.hasta || null,
      rutContraparte: req.query.rut || null,
    })
    res.json({ ok: true, ...m })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Configuración contable (memoria de contabilización / modo simple) ----------

router.get('/empresas/:empresaId/config', requirePermiso('empresas:ver'), (req, res) => {
  try {
    res.json({ ok: true, config: empresas.obtenerConfig(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.put('/empresas/:empresaId/config', requirePermiso('config:editar'), (req, res) => {
  try {
    const config = empresas.actualizarConfig(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, config: req.body, ip: ip(req),
    })
    res.json({ ok: true, config })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Memoria de contabilización (RUT → cuenta regular) ----------

router.get('/empresas/:empresaId/memoria', requirePermiso('documentos:ver'), (req, res) => {
  try {
    res.json({ ok: true, ...require('../core/propuestas').memoria(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/memoria', requirePermiso('documentos:clasificar'), (req, res) => {
  try {
    const r = require('../core/propuestas').recordarMemoria(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      rut: req.body.rut, cuentaId: req.body.cuenta_id, ip: ip(req),
    })
    res.json({ ok: true, memoria: r })
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
