/**
 * routes/planificacion.js — FICHA TRIBUTARIA (T0-B), montado en /api/contable.
 *
 * RBAC (igual que el resto de los routers contables):
 *  - GET       → 'planificacion:ver' (lectura; auditor, tesorería y dueño consultan).
 *  - POST/PUT  → 'planificacion:gestionar' (solo contador/super_admin; el gate
 *                de licencia del middleware requirePermiso aplica solo acá,
 *                porque la capacidad no termina en ':ver').
 *
 * Solo escribe en las tablas de planificación (ficha + historial) y firma la
 * bitácora central. NINGUNA otra tabla del sistema recibe escritura desde
 * estas rutas: la ficha es declaración, no cálculo.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const fichaCore = require('../core/plan-ficha')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

function respuesta(err, res) {
  const code = err.status || 400
  res.status(code).json({ ok: false, error: err.message })
}

// Ficha vigente: `ficha: null` significa SIN incorporación explícita todavía
// (es la ausencia de declaración, no un valor fiscal).
router.get('/empresas/:empresaId/planificacion/ficha', requirePermiso('planificacion:ver'), (req, res) => {
  try {
    const f = fichaCore.obtener(db, req.empresaId)
    res.json({ ok: true, ficha: f })
  } catch (err) {
    respuesta(err, res)
  }
})

// Historial de cambios (append-only), más nuevo primero, tope 100.
router.get('/empresas/:empresaId/planificacion/ficha/historial', requirePermiso('planificacion:ver'), (req, res) => {
  try {
    const entradas = fichaCore.listarHistorial(db, req.empresaId, Number(req.query.limite) || 20)
    res.json({ ok: true, entradas })
  } catch (err) {
    respuesta(err, res)
  }
})

// Incorporación EXPLÍCITA (una sola vez por empresa; duplicado → 409).
router.post('/empresas/:empresaId/planificacion/ficha', requirePermiso('planificacion:gestionar'), (req, res) => {
  try {
    const r = fichaCore.incorporar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      datos: req.body || {}, ip: ip(req),
    })
    res.json({ ok: true, ficha: r.ficha })
  } catch (err) {
    respuesta(err, res)
  }
})

// Cambios sobre la ficha vigente (delta validado; vacío → rechazo).
router.put('/empresas/:empresaId/planificacion/ficha', requirePermiso('planificacion:gestionar'), (req, res) => {
  try {
    const r = fichaCore.actualizar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      cambios: req.body || {}, ip: ip(req),
    })
    res.json({ ok: true, ficha: r.ficha })
  } catch (err) {
    respuesta(err, res)
  }
})

module.exports = router
