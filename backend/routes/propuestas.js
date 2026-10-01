/**
 * Rutas /api/contable — FASE 4: propuestas de asiento y conciliación.
 * Todas exigen sesión (requireAuth, aplicado en index.js); el RBAC resuelve
 * el rol del usuario en :empresaId (middleware requirePermiso). La escritura
 * siempre pasa por los módulos core — aquí solo hay HTTP y contexto de auditoría.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const propuestas = require('../core/propuestas')
const conciliacion = require('../core/conciliacion')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Propuestas ----------

router.get('/empresas/:empresaId/propuestas', requirePermiso('propuestas:ver'), (req, res) => {
  try {
    const r = propuestas.listar(db, {
      empresaId: req.empresaId,
      estado: req.query.estado || null,
      periodo: req.query.periodo || null,
      limit: req.query.limit,
      offset: req.query.offset,
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/propuestas/:propuestaId', requirePermiso('propuestas:ver'), (req, res) => {
  const p = propuestas.obtener(db, req.empresaId, Number(req.params.propuestaId))
  if (!p) return res.status(404).json({ ok: false, error: 'Propuesta no encontrada' })
  let lineas = null
  try { lineas = propuestas.validarLineasSnapshot(db, req.empresaId, p.lineas_json) } catch (err) { lineas = { error: err.message } }
  res.json({ ok: true, propuesta: p, lineas })
})

// Genera (o re-propone) la propuesta de un documento CLASIFICADO
router.post('/empresas/:empresaId/documentos/:documentoId/propuesta', requirePermiso('propuestas:generar'), (req, res) => {
  try {
    const p = propuestas.generar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      documentoId: Number(req.params.documentoId), ip: ip(req),
    })
    res.status(201).json({ ok: true, propuesta: p })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Confirma (contabiliza) una propuesta PENDIENTE — transición §5 a CONTABILIZADO
router.post('/empresas/:empresaId/propuestas/:propuestaId/confirmar', requirePermiso('propuestas:confirmar'), (req, res) => {
  try {
    const r = propuestas.confirmar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      propuestaId: Number(req.params.propuestaId),
      fecha: req.body.fecha || null, glosa: req.body.glosa || null, ip: ip(req),
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Confirmación en lote (período completo o ids explícitos)
router.post('/empresas/:empresaId/propuestas/confirmar-lote', requirePermiso('propuestas:confirmar'), (req, res) => {
  try {
    const r = propuestas.confirmarLote(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      periodo: req.body.periodo || null,
      propuestaIds: Array.isArray(req.body.propuesta_ids) ? req.body.propuesta_ids.map(Number) : null,
      fecha: req.body.fecha || null, ip: ip(req),
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Descarta una propuesta PENDIENTE (el documento vuelve a CLASIFICADO)
router.post('/empresas/:empresaId/propuestas/:propuestaId/descartar', requirePermiso('propuestas:generar'), (req, res) => {
  try {
    const p = propuestas.descartar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      propuestaId: Number(req.params.propuestaId),
      motivo: req.body.motivo || null, ip: ip(req),
    })
    res.json({ ok: true, propuesta: p })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Conciliación SII ↔ contable ----------

router.get('/empresas/:empresaId/conciliacion/:periodo', requirePermiso('conciliacion:ver'), (req, res) => {
  const c = conciliacion.obtener(db, req.empresaId, req.params.periodo)
  if (!c) return res.status(404).json({ ok: false, error: 'Sin conciliación guardada para ese período' })
  res.json({ ok: true, conciliacion: c })
})

router.get('/empresas/:empresaId/conciliaciones', requirePermiso('conciliacion:ver'), (req, res) => {
  res.json({ ok: true, conciliaciones: conciliacion.listar(db, req.empresaId) })
})

// Ejecuta la conciliación del período. `sii_resumen` es opcional ({neto, iva, total});
// sin él concilia bandeja ↔ contable. La variante con consulta al SII en vivo se
// ejecuta desde la UI con los datos de consultarResumen (frontera única de ingesta).
router.post('/empresas/:empresaId/conciliacion/:periodo/ejecutar', requirePermiso('conciliacion:ejecutar'), (req, res) => {
  try {
    const b = req.body || {}
    const siiResumen = b.sii_resumen && typeof b.sii_resumen === 'object' ? b.sii_resumen : null
    const r = conciliacion.ejecutar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      periodo: req.params.periodo, siiResumen, ip: ip(req),
    })
    res.json({ ok: true, conciliacion: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
