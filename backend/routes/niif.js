/**
 * Rutas /api/contable — FASE 8: NIIF (mapeo cuentas → rubros + estados).
 * Lecturas con 'reportes:ver'; el mapeo se edita con 'cuentas:editar'
 * (gate de licencia aplica igual que toda escritura).
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const niif = require('../core/niif')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

router.get('/empresas/:empresaId/niif/mapeo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, ...niif.mapeo(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.put('/empresas/:empresaId/niif/mapeo', requirePermiso('cuentas:editar'), (req, res) => {
  try {
    const r = niif.asignarMasivo(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      mapeos: req.body && req.body.mapeos, ip: ip(req),
    })
    res.json({ ok: true, ...r, ...niif.mapeo(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/niif/situacion/:periodo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, situacion: niif.situacionNiif(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/niif/resultados/:periodo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, resultados: niif.resultadosNiif(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
