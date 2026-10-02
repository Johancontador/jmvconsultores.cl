/**
 * Rutas /api/contable — POST-MVP: automatización del período.
 * Todas exigen sesión (requireAuth, aplicado en index.js) + RBAC.
 * La escritura pasa por core/automatizacion.js — aquí solo HTTP y auditoría de contexto.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const automatizacion = require('../core/automatizacion')
const semilla = require('../core/reglas-semilla')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// Estado del período: cadena documentos → propuestas → asientos + última ejecución
router.get('/empresas/:empresaId/automatizacion/:periodo/estado', requirePermiso('propuestas:ver'), (req, res) => {
  try {
    const estado = automatizacion.estado(db, { empresaId: req.empresaId, periodo: req.params.periodo })
    const ultima = automatizacion.ultimaEjecucion(db, { empresaId: req.empresaId, periodo: req.params.periodo })
    res.json({ ok: true, estado, ultima_ejecucion: ultima })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Ejecuta el pipeline completo del período (clasificar → proponer → contabilizar)
router.post('/empresas/:empresaId/automatizacion/:periodo/ejecutar', requirePermiso('automatizacion:ejecutar'), (req, res) => {
  try {
    const r = automatizacion.ejecutar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      periodo: req.params.periodo, ip: ip(req),
    })
    res.json({ ok: true, resultado: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Instala reglas semilla si la empresa no tiene ninguna (arranque del motor)
router.post('/empresas/:empresaId/automatizacion/semilla', requirePermiso('reglas:editar'), (req, res) => {
  try {
    const r = semilla.instalarSiVacia(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, ip: ip(req),
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
