/**
 * Rutas /api/contable — SAAS-2: onboarding autónomo (ficha tributaria desde
 * el SII + ingesta del histórico). RBAC:
 *   - Lectura del estado: 'documentos:ver' (la ven todos los roles con bandeja).
 *   - Operaciones (consultar SII, confirmar ficha, ingestar histórico):
 *     'onboarding:ejecutar' (contador, admin_empresa y super_admin).
 * El gate de licencia aplica igual que en el resto de escrituras
 * (requirePermiso → licencias.exigirVigente): lectura nunca bloqueada, §5.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const onboarding = require('../core/onboarding')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Ficha tributaria + checklist §43 (lectura) ----------

router.get('/empresas/:empresaId/onboarding/ficha', requirePermiso('documentos:ver'), (req, res) => {
  try {
    res.json({ ok: true, ...onboarding.ficha(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Consulta al SII (propuesta, sin persistir) ----------

router.post('/empresas/:empresaId/onboarding/consultar-sii', requirePermiso('onboarding:ejecutar'), async (req, res) => {
  try {
    const propuesta = await onboarding.consultarSii(db, req.empresaId)
    res.json({ ok: true, propuesta })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Confirmación humana de la ficha ----------

router.post('/empresas/:empresaId/onboarding/confirmar-ficha', requirePermiso('onboarding:ejecutar'), (req, res) => {
  try {
    const b = req.body || {}
    const ficha = onboarding.confirmarFicha(db, {
      empresaId: req.empresaId,
      usuarioId: req.user.id,
      razonSocialSii: b.razon_social_sii ?? null,
      inicioActividades: b.inicio_actividades ?? null,
      actividades: b.actividades ?? null,
      regimenTributario: b.regimen_tributario ?? null,
      socios: b.socios ?? null,
      ip: ip(req),
    })
    res.json({ ok: true, ...ficha })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Ingesta del histórico (job en background) ----------

router.post('/empresas/:empresaId/onboarding/ingesta-historica', requirePermiso('onboarding:ejecutar'), (req, res) => {
  try {
    const { desde, hasta } = req.body || {}
    const job = onboarding.ingestarHistorico(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, desde, hasta, ip: ip(req),
    })
    res.status(202).json({ ok: true, ...job })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/onboarding/ingesta-historica/:jobId', requirePermiso('documentos:ver'), (req, res) => {
  const estado = onboarding.estadoIngestaHistorica(req.params.jobId, req.user.id)
  if (!estado || estado.empresa_id !== req.empresaId) {
    return res.status(404).json({ ok: false, error: 'Trabajo no encontrado' })
  }
  res.json({ ok: true, job: estado })
})

module.exports = router
