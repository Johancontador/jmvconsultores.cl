/**
 * rutas CRM (Fase B) — pipeline, recordatorios, campañas, engagement.
 *
 * Acceso: solo JMV (roles super_admin y contador — el CRM del despacho, no
 * del cliente): se exigía la capacidad empresas:ver + NINGÚN cliente ve esto.
 * Aislamiento: cada endpoint valida la empresa contra las asignaciones del
 * usuario (rolEnEmpresa) como el resto de la API — el super admin las ve todas.
 */
const express = require('express')
const db = require('../db')
const { rolEnEmpresa, esSuperAdmin } = require('../core/empresas')
const crm = require('../core/crm')

const router = express.Router()

/**
 * Guard CRM: SOLO el despacho (super admin o contador con asignación activa
 * a la empresa) ve/opera el CRM. Un cliente (admin_empresa/auditor/
 * tesorería) JAMÁS: su rol no incluye escribir empresas y el CRM es interno
 * de gestión del despacho.
 */
function guardCrm(req, res, next) {
  const usuarioId = req.user && req.user.id
  if (!usuarioId) return res.status(401).json({ ok: false, error: 'No autenticado' })
  const esAdmin = esSuperAdmin(db, usuarioId)
  const asignaciones = db.prepare(`
    SELECT ue.empresa_id, r.codigo AS rol
    FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.activo = 1
  `).all(usuarioId)
  const puedeOperarCrm = esAdmin || asignaciones.some((a) => ['contador', 'super_admin'].includes(a.rol))
  if (!puedeOperarCrm) return res.status(403).json({ ok: false, error: 'El CRM es exclusivo del despacho (rol contador o super admin)' })
  req.crmEmpresaIds = esAdmin ? null : asignaciones.map((a) => a.empresa_id)
  next()
}

/** Guard por empresa: el contador solo ve/opera SUS empresas (no las ajenas). */
function accesoEmpresa(req, res, empresaId) {
  const id = Number(empresaId)
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ ok: false, error: 'empresa_id inválido' }); return null }
  if (req.crmEmpresaIds !== null && !req.crmEmpresaIds.includes(id)) {
    res.status(403).json({ ok: false, error: 'No tienes acceso a esa empresa' })
    return null
  }
  return id
}

/* --------------------------- PIPELINE --------------------------- */

router.get('/pipeline', guardCrm, (req, res) => {
  res.json({ ok: true, etapas: crm.ETAPAS, pipeline: crm.listarPipeline(db, { usuarioId: req.user.id }) })
})

router.post('/pipeline/:empresaId', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.params.empresaId)
  if (!id) return
  try {
    const r = crm.actualizarEtapa(db, {
      usuarioId: req.user.id, empresaId: id,
      etapa: req.body.etapa, notas: req.body.notas || null,
      proximoContacto: req.body.proximo_contacto || null, ip: req.ip,
    })
    res.json(r)
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/pipeline/:empresaId/interaccion', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.params.empresaId)
  if (!id) return
  try {
    res.json(crm.registrarInteraccion(db, {
      usuarioId: req.user.id, empresaId: id, notas: req.body.notas || null, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ------------------------- RECORDATORIOS ------------------------- */

router.get('/recordatorios', guardCrm, (req, res) => {
  res.json({
    ok: true,
    recordatorios: crm.listarRecordatorios(db, { soloPendientes: req.query.todos !== '1' }),
    tipos: crm.TIPOS_RECORDATORIO,
  })
})

router.post('/recordatorios', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.body.empresa_id)
  if (!id) return
  try {
    res.status(201).json(crm.crearRecordatorio(db, {
      usuarioId: req.user.id, empresaId: id,
      tipo: req.body.tipo, titulo: req.body.titulo, fecha: req.body.fecha,
      notas: req.body.notas || null, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/recordatorios/:id/completar', guardCrm, (req, res) => {
  try {
    res.json(crm.completarRecordatorio(db, {
      usuarioId: req.user.id, recordatorioId: Number(req.params.id), ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ---------------------------- CAMPAÑAS ---------------------------- */

router.get('/campanas', guardCrm, (req, res) => {
  res.json({ ok: true, campanas: crm.listarCampanas(db), plantillas: Object.keys(crm.PLANTILLAS_CAMPANA) })
})

router.post('/campanas', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.body.empresa_id)
  if (!id) return
  try {
    res.status(201).json(crm.generarCampana(db, {
      usuarioId: req.user.id, empresaId: id,
      plantilla: req.body.plantilla, periodo: req.body.periodo || null,
      contacto: req.body.contacto || null, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/campanas/:id/enviar', guardCrm, (req, res) => {
  try {
    res.json(crm.marcarEnviado(db, { usuarioId: req.user.id, campanaId: Number(req.params.id), ip: req.ip }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* --------------------------- ENGAGEMENT --------------------------- */

router.get('/engagement', guardCrm, (req, res) => {
  res.json(crm.engagement(db, { usuarioId: req.user.id }))
})

/* -------------------- RETENCIÓN PROACTIVA (Fase C) -------------------- */

router.get('/alertas', guardCrm, (req, res) => {
  res.json(crm.alertasRetencion(db))
})

router.post('/campanas/lote', guardCrm, (req, res) => {
  try {
    res.status(201).json(crm.generarCampanaLote(db, {
      usuarioId: req.user.id,
      plantilla: req.body.plantilla,
      periodo: req.body.periodo || null,
      etiqueta: req.body.etiqueta || null,
      etapa: req.body.etapa || null,
      contacto: req.body.contacto || null,
      ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

module.exports = router
