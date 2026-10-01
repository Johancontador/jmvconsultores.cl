/**
 * Rutas /api/contable — FASE 5: reportes financieros (§8) y cierre de período (§7).
 * Todas exigen sesión (requireAuth, aplicado en index.js); el RBAC resuelve
 * el rol en :empresaId (requirePermiso). Cálculos en core/reportes.js — aquí
 * solo HTTP y contexto de auditoría.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const reportes = require('../core/reportes')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Reportes (§8) ----------

// Balance de comprobación y sumas: acumulado hasta el período + movimientos del mes.
router.get('/empresas/:empresaId/reportes/balance/:periodo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, balance: reportes.balanceComprobacion(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Estado de situación financiera con ecuación A = P + Patrimonio verificada.
router.get('/empresas/:empresaId/reportes/situacion/:periodo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, situacion: reportes.situacionFinanciera(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Estado de resultados: del mes y acumulado del año.
router.get('/empresas/:empresaId/reportes/resultados/:periodo', requirePermiso('reportes:ver'), (req, res) => {
  try {
    res.json({ ok: true, resultados: reportes.estadoResultados(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Cierre de período (§7) ----------

// Checklist + asientos de cierre PROPUESTOS (sin mutar nada).
router.get('/empresas/:empresaId/cierre/:periodo/preparar', requirePermiso('periodos:ver'), (req, res) => {
  try {
    res.json({ ok: true, cierre: reportes.prepararCierre(db, req.empresaId, req.params.periodo) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Ejecuta el cierre: asientos de cierre (subconjunto por `claves` opcional),
// cierra el período y persiste el snapshot. `forzar` permite cerrar con docs pendientes.
router.post('/empresas/:empresaId/cierre/:periodo/ejecutar', requirePermiso('periodos:cerrar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = reportes.ejecutarCierre(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, periodo: req.params.periodo,
      claves: Array.isArray(b.claves) ? b.claves.map(String) : null,
      forzar: !!b.forzar, ip: ip(req),
    })
    res.json({ ok: true, cierre: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Snapshot del cierre persistido (o 404).
router.get('/empresas/:empresaId/cierre/:periodo', requirePermiso('periodos:ver'), (req, res) => {
  const c = reportes.obtenerCierre(db, req.empresaId, req.params.periodo)
  if (!c) return res.status(404).json({ ok: false, error: 'Sin cierre guardado para ese período' })
  res.json({ ok: true, cierre: c })
})

module.exports = router
