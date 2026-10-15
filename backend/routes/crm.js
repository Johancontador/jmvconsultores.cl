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

/* ===========================================================================
 * CRM COMERCIAL (rediseño 2026-10-15) — fichas, contactos, prospectos,
 * oportunidades, actividades, informes. MISMO guard multitenant: guardCrm
 * (solo despacho) + accesoEmpresa (asignación por empresa). El Centro de
 * Aplicaciones/presentación NUNCA autoriza: aquí se revalida todo.
 * ===========================================================================*/
const comercial = require('../core/crm-comercial')

/* ------------------------ FICHA COMERCIAL ------------------------ */

router.get('/fichas/:empresaId', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.params.empresaId)
  if (!id) return
  try { res.json({ ok: true, ...comercial.obtenerFicha(db, id) }) }
  catch (err) { res.status(err.message.startsWith('Empresa') ? 404 : 400).json({ ok: false, error: err.message }) }
})

router.put('/fichas/:empresaId', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.params.empresaId)
  if (!id) return
  try { res.json(comercial.guardarFicha(db, { usuarioId: req.user.id, empresaId: id, ficha: req.body || {}, ip: req.ip })) }
  catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ---------------------------- CONTACTOS ---------------------------- */

router.get('/contactos', guardCrm, (req, res) => {
  try {
    const empresaId = req.query.empresa_id != null ? accesoEmpresa(req, res, req.query.empresa_id) : null
    if (req.query.empresa_id != null && !empresaId) return
    res.json({ ok: true, contactos: comercial.listarContactos(db, {
      empresaId, texto: req.query.q || null,
      limit: req.query.limit || 100, offset: req.query.offset || 0,
    }) })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/contactos', guardCrm, (req, res) => {
  const id = accesoEmpresa(req, res, req.body.empresa_id)
  if (!id) return
  try {
    res.status(201).json(comercial.crearContacto(db, {
      usuarioId: req.user.id, empresaId: id, contacto: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.patch('/contactos/:id', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_contactos WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Contacto no encontrado' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json(comercial.editarContacto(db, {
      usuarioId: req.user.id, contactoId: Number(req.params.id), contacto: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.delete('/contactos/:id', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_contactos WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Contacto no encontrado' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json(comercial.eliminarContacto(db, {
      usuarioId: req.user.id, contactoId: Number(req.params.id), ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ---------------------------- PROSPECTOS ---------------------------- */

router.get('/prospectos', guardCrm, (req, res) => {
  try {
    res.json({ ok: true, ...comercial.listarProspectos(db, {
      estado: req.query.estado || null, texto: req.query.q || null,
      limit: req.query.limit || 100, offset: req.query.offset || 0,
    }) })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/prospectos', guardCrm, (req, res) => {
  try {
    res.status(201).json(comercial.crearProspecto(db, {
      usuarioId: req.user.id, prospecto: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.patch('/prospectos/:id', guardCrm, (req, res) => {
  try {
    res.json(comercial.editarProspecto(db, {
      usuarioId: req.user.id, prospectoId: Number(req.params.id), prospecto: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/prospectos/:id/convertir', guardCrm, (req, res) => {
  try {
    res.json(comercial.convertirProspecto(db, {
      usuarioId: req.user.id, prospectoId: Number(req.params.id),
      empresaId: req.body.empresa_id != null ? Number(req.body.empresa_id) : null,
      oportunidadId: req.body.oportunidad_id != null ? Number(req.body.oportunidad_id) : null,
      ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/prospectos/importar', guardCrm, (req, res) => {
  try {
    res.status(201).json(comercial.importarProspectos(db, {
      usuarioId: req.user.id, prospectos: req.body.prospectos || [], ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* -------------------------- OPORTUNIDADES -------------------------- */

router.get('/oportunidades', guardCrm, (req, res) => {
  try {
    const empresaId = req.query.empresa_id != null ? accesoEmpresa(req, res, req.query.empresa_id) : null
    if (req.query.empresa_id != null && !empresaId) return
    res.json({ ok: true, ...comercial.listarOportunidades(db, {
      empresaId,
      etapa: req.query.etapa || null,
      estado: req.query.estado || null,
      responsable: req.query.responsable || null,
      desde: req.query.desde || null, hasta: req.query.hasta || null,
      texto: req.query.q || null,
      limit: req.query.limit || 200, offset: req.query.offset || 0,
    }) })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.get('/oportunidades/:id', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json({ ok: true, oportunidad: comercial.obtenerOportunidad(db, Number(req.params.id)) })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/oportunidades', guardCrm, (req, res) => {
  const empresaId = accesoEmpresa(req, res, req.body.empresa_id)
  if (!empresaId) return
  try {
    res.status(201).json(comercial.crearOportunidad(db, {
      usuarioId: req.user.id,
      oportunidad: { ...req.body, empresaId }, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.patch('/oportunidades/:id', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json(comercial.editarOportunidad(db, {
      usuarioId: req.user.id, oportunidadId: Number(req.params.id), oportunidad: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/oportunidades/:id/etapa', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Oportunidad no encontrada' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json(comercial.cambiarEtapaOportunidad(db, {
      usuarioId: req.user.id, oportunidadId: Number(req.params.id),
      etapa: req.body.etapa, probabilidad: req.body.probabilidad != null ? Number(req.body.probabilidad) : null,
      motivo: req.body.motivo || null, comentario: req.body.comentario || null, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ---------------------------- ACTIVIDADES --------------------------- */

router.get('/actividades', guardCrm, (req, res) => {
  try {
    const empresaId = req.query.empresa_id != null ? accesoEmpresa(req, res, req.query.empresa_id) : null
    if (req.query.empresa_id != null && !empresaId) return
    res.json({ ok: true, actividades: comercial.listarActividades(db, {
      empresaId,
      oportunidadId: req.query.oportunidad_id != null ? Number(req.query.oportunidad_id) : null,
      estado: req.query.estado || 'PENDIENTE',
      vencidasSolo: req.query.vencidas === '1',
      responsable: req.query.responsable || null,
      limit: req.query.limit || 200, offset: req.query.offset || 0,
    }) })
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.post('/actividades', guardCrm, (req, res) => {
  // La empresa se deriva del ancla (contacto/oportunidad) si no viene explícita;
  // si viene explícita se valida contra asignaciones.
  try {
    const core = require('../core/crm-comercial')
    let empresaId = req.body.empresa_id != null ? accesoEmpresa(req, res, req.body.empresa_id) : null
    if (req.body.empresa_id != null && !empresaId) return
    if (empresaId == null) {
      // Derivar el ancla SOLO del despacho: contacto u oportunidad del CRM.
      let derivada = null
      if (req.body.contacto_id != null) {
        derivada = db.prepare(`SELECT empresa_id FROM crm_contactos WHERE id = ?`).get(Number(req.body.contacto_id))?.empresa_id || null
      } else if (req.body.oportunidad_id != null) {
        derivada = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(req.body.oportunidad_id))?.empresa_id || null
      }
      if (derivada == null) return res.status(400).json({ ok: false, error: 'Actividad sin ancla (empresa/contacto/oportunidad)' })
      if (!accesoEmpresa(req, res, derivada)) return
      empresaId = derivada
    }
    res.status(201).json(core.crearActividad(db, {
      usuarioId: req.user.id,
      actividad: {
        ...req.body,
        contactoId: req.body.contacto_id != null ? Number(req.body.contacto_id) : null,
        oportunidadId: req.body.oportunidad_id != null ? Number(req.body.oportunidad_id) : null,
      }, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.patch('/actividades/:id', guardCrm, (req, res) => {
  try {
    const fila = db.prepare(`SELECT empresa_id FROM crm_actividades WHERE id = ?`).get(Number(req.params.id))
    if (!fila) return res.status(404).json({ ok: false, error: 'Actividad no encontrada' })
    if (!accesoEmpresa(req, res, fila.empresa_id)) return
    res.json(comercial.actualizarActividad(db, {
      usuarioId: req.user.id, actividadId: Number(req.params.id), actividad: req.body, ip: req.ip,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* ------------------------------ INFORMES ---------------------------- */

router.get('/informes', guardCrm, (req, res) => {
  try {
    const empresaId = req.query.empresa_id != null ? accesoEmpresa(req, res, req.query.empresa_id) : null
    if (req.query.empresa_id != null && !empresaId) return
    res.json(comercial.informes(db, {
      empresaId,
      desde: req.query.desde || null, hasta: req.query.hasta || null,
      responsable: req.query.responsable || null,
    }))
  } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

/* --------------------- BÚSQUEDA / DUPLICADOS ----------------------- */

router.get('/buscar', guardCrm, (req, res) => {
  try { res.json(comercial.buscar(db, { q: req.query.q || '', limit: req.query.limit || 20 })) }
  catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

router.get('/duplicados', guardCrm, (req, res) => {
  try { res.json(comercial.duplicados(db, { q: req.query.q || '', tipo: req.query.tipo || 'empresas' })) }
  catch (err) { res.status(400).json({ ok: false, error: err.message }) }
})

module.exports = router
