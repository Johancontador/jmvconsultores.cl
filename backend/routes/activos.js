/**
 * Rutas /api/contable — FASE 7: activos fijos y depreciación mensual.
 * Todas exigen sesión (requireAuth en index.js) y el RBAC resuelve el rol en
 * :empresaId (requirePermiso, con gate de licencia para escrituras). Aquí solo
 * HTTP y contexto; toda la lógica vive en core/activos.js.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const activos = require('../core/activos')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Listado y detalle ----------

router.get('/empresas/:empresaId/activos', requirePermiso('activos:ver'), (req, res) => {
  try {
    res.json({ ok: true, ...activos.listar(db, req.empresaId, { estado: req.query.estado || null }) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/activos/resumen', requirePermiso('activos:ver'), (req, res) => {
  try {
    res.json({ ok: true, resumen: activos.resumen(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/activos/depreciaciones', requirePermiso('activos:ver'), (req, res) => {
  try {
    res.json({ ok: true, depreciaciones: activos.depreciaciones(db, req.empresaId, { limit: req.query.limit }) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/activos/:activoId', requirePermiso('activos:ver'), (req, res) => {
  try {
    const a = activos.obtener(db, req.empresaId, req.params.activoId)
    if (!a) return res.status(404).json({ ok: false, error: 'Activo no encontrado en esta empresa' })
    res.json({ ok: true, activo: a, plan: activos.planDepreciacion(db, req.empresaId, req.params.activoId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Registro ----------

router.post('/empresas/:empresaId/activos', requirePermiso('activos:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = activos.crear(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      codigo: b.codigo, descripcion: b.descripcion,
      cuentaActivoId: b.cuenta_activo_id,
      fechaAdquisicion: b.fecha_adquisicion,
      valorAdquisicion: b.valor_adquisicion,
      vidaUtilMeses: b.vida_util_meses,
      valorResidual: b.valor_residual || 0,
      cuentaDepId: b.cuenta_dep_id ?? null,
      cuentaGastoId: b.cuenta_gasto_id ?? null,
      contabilizarAlta: !!b.contabilizar_alta,
      cuentaContraId: b.cuenta_contra_id ?? null,
      ip: ip(req),
    })
    res.status(201).json({ ok: true, activo: activos.obtener(db, req.empresaId, r.id), alta: r.alta })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Depreciación del período (propuesta → confirmación humana) ----------

router.get('/empresas/:empresaId/activos-depreciacion/:periodo', requirePermiso('activos:ver'), (req, res) => {
  try {
    res.json({ ok: true, depreciacion: activos.prepararDepreciacion(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/activos-depreciacion/:periodo/confirmar', requirePermiso('activos:operar'), (req, res) => {
  try {
    const r = activos.confirmarDepreciacion(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, periodo: req.params.periodo, ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Venta / baja ----------

router.post('/empresas/:empresaId/activos/:activoId/venta-baja', requirePermiso('activos:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = activos.registrarVentaBaja(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      activoId: req.params.activoId, tipo: b.tipo, fecha: b.fecha,
      precioVenta: b.precio_venta || 0,
      cuentaDestinoId: b.cuenta_destino_id ?? null,
      cuentaResultadoId: b.cuenta_resultado_id ?? null,
      glosa: b.glosa || null, ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r, activo: activos.obtener(db, req.empresaId, req.params.activoId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
