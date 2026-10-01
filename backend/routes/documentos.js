/**
 * Rutas /api/contable — FASE 3: documentos (bandeja), reglas y contrapartes.
 * Todas exigen sesión (requireAuth, aplicado en index.js) y el RBAC resuelve
 * el rol del usuario en :empresaId (middleware requirePermiso). La escritura
 * siempre pasa por los módulos core — aquí solo hay HTTP y auditoría de contexto.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const documentos = require('../core/documentos')
const reglas = require('../core/reglas')
const ingesta = require('../core/ingesta')
const auditoria = require('../core/auditoria')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Bandeja ----------

router.get('/empresas/:empresaId/documentos', requirePermiso('documentos:ver'), (req, res) => {
  try {
    const r = documentos.listar(db, {
      empresaId: req.empresaId,
      periodo: req.query.periodo || null,
      tipoFlujo: req.query.tipo_flujo || null,
      estado: req.query.estado || null,
      tipoDoc: req.query.tipo_doc || null,
      rut: req.query.rut || null,
      texto: req.query.texto || null,
      cuentaId: req.query.cuenta_id ? Number(req.query.cuenta_id) : null,
      limit: req.query.limit,
      offset: req.query.offset,
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/documentos/:documentoId', requirePermiso('documentos:ver'), (req, res) => {
  const d = documentos.obtener(db, req.empresaId, Number(req.params.documentoId))
  if (!d) return res.status(404).json({ ok: false, error: 'Documento no encontrado' })
  res.json({ ok: true, documento: d })
})

// Clasificación manual (también re-clasifica). Devuelve el doc para "crear regla desde aquí".
router.post('/empresas/:empresaId/documentos/:documentoId/clasificar', requirePermiso('documentos:clasificar'), (req, res) => {
  try {
    const d = documentos.clasificar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, documentoId: Number(req.params.documentoId),
      cuentaId: req.body.cuenta_id, centroCostoId: req.body.centro_costo_id ?? null,
      tratamientoIva: req.body.tratamiento_iva || 'credito', ip: ip(req),
    })
    res.json({ ok: true, documento: d })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/documentos/:documentoId/anular', requirePermiso('documentos:clasificar'), (req, res) => {
  try {
    const d = documentos.anular(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, documentoId: Number(req.params.documentoId),
      motivo: req.body.motivo, ip: ip(req),
    })
    res.json({ ok: true, documento: d })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Ingesta SII → bandeja (job en background) ----------

router.post('/empresas/:empresaId/documentos-ingesta', requirePermiso('documentos:ingestar'), (req, res) => {
  try {
    const { periodo } = req.body
    const job = ingesta.iniciar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, periodo, ip: ip(req),
    })
    res.status(202).json({ ok: true, ...job })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/documentos-ingesta/:jobId', requirePermiso('documentos:ver'), (req, res) => {
  const estado = ingesta.obtenerEstado(req.params.jobId, req.user.id)
  if (!estado || estado.empresa_id !== req.empresaId) {
    return res.status(404).json({ ok: false, error: 'Trabajo no encontrado' })
  }
  res.json({ ok: true, job: estado })
})

// ---------- Reglas contables ----------

router.get('/empresas/:empresaId/reglas', requirePermiso('reglas:ver'), (req, res) => {
  res.json({ ok: true, reglas: reglas.listar(db, req.empresaId) })
})

router.post('/empresas/:empresaId/reglas', requirePermiso('reglas:editar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = reglas.guardar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      reglaId: b.id ? Number(b.id) : null,
      nombre: b.nombre, prioridad: b.prioridad, activa: b.activa,
      tipoFlujo: b.tipo_flujo ?? null, rutContraparte: b.rut_contraparte ?? null,
      tipoDoc: b.tipo_doc ?? null, patronRazonSocial: b.patron_razon_social ?? null,
      patronGlosa: b.patron_glosa ?? null, montoMin: b.monto_min ?? null, montoMax: b.monto_max ?? null,
      cuentaId: b.cuenta_id, centroCostoId: b.centro_costo_id ?? null,
      tratamientoIva: b.tratamiento_iva || 'credito', cuentaContraparteId: b.cuenta_contraparte_id ?? null,
      ip: ip(req),
    })
    res.status(201).json({ ok: true, regla: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/reglas/:reglaId/desactivar', requirePermiso('reglas:editar'), (req, res) => {
  try {
    const r = reglas.desactivar(db, { empresaId: req.empresaId, usuarioId: req.user.id, reglaId: Number(req.params.reglaId), ip: ip(req) })
    res.json({ ok: true, regla: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Clasificación automática en lote (motor por prioridad)
router.post('/empresas/:empresaId/documentos/clasificar-automatico', requirePermiso('documentos:clasificar'), (req, res) => {
  try {
    const r = reglas.clasificarAutomatico(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      periodo: req.body.periodo || null, tipoFlujo: req.body.tipo_flujo || null,
      documentoId: req.body.documento_id ? Number(req.body.documento_id) : null,
      ip: ip(req),
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Aprendizaje simple: crear regla desde una clasificación manual
router.post('/empresas/:empresaId/documentos/:documentoId/aprender-regla', requirePermiso('reglas:editar'), (req, res) => {
  try {
    const doc = documentos.obtener(db, req.empresaId, Number(req.params.documentoId))
    if (!doc) return res.status(404).json({ ok: false, error: 'Documento no encontrado' })
    const b = req.body || {}
    const r = reglas.crearDesdeClasificacion(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      rutContraparte: b.rut_contraparte || doc.rut_contraparte,
      tipoDoc: b.tipo_doc ?? doc.tipo_doc,
      tipoFlujo: b.tipo_flujo || doc.tipo_flujo,
      cuentaId: b.cuenta_id ?? doc.cuenta_id,
      centroCostoId: b.centro_costo_id ?? doc.centro_costo_id,
      tratamientoIva: b.tratamiento_iva || doc.tratamiento_iva || 'credito',
      ip: ip(req),
    })
    res.status(201).json({ ok: true, regla: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Contrapartes (proveedores/clientes derivados del RCV) ----------

router.get('/empresas/:empresaId/contrapartes', requirePermiso('documentos:ver'), (req, res) => {
  try {
    const texto = (req.query.texto || '').trim()
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    let filas
    if (texto) {
      filas = db.prepare(`
        SELECT cp.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, cc.codigo AS cc_codigo
        FROM contrapartes cp
        LEFT JOIN cuentas c ON c.id = cp.cuenta_id
        LEFT JOIN centros_costo cc ON cc.id = cp.centro_costo_id
        WHERE cp.empresa_id = ? AND (cp.razon_social LIKE ? OR cp.rut LIKE ?)
        ORDER BY cp.razon_social LIMIT ?
      `).all(req.empresaId, `%${texto}%`, `%${texto}%`, limit)
    } else {
      filas = db.prepare(`
        SELECT cp.*, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, cc.codigo AS cc_codigo
        FROM contrapartes cp
        LEFT JOIN cuentas c ON c.id = cp.cuenta_id
        LEFT JOIN centros_costo cc ON cc.id = cp.centro_costo_id
        WHERE cp.empresa_id = ?
        ORDER BY cp.razon_social LIMIT ?
      `).all(req.empresaId, limit)
    }
    res.json({ ok: true, contrapartes: filas })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/contrapartes/:contraparteId', requirePermiso('documentos:clasificar'), (req, res) => {
  try {
    const cp = db.prepare(`SELECT * FROM contrapartes WHERE id = ? AND empresa_id = ?`).get(Number(req.params.contraparteId), req.empresaId)
    if (!cp) return res.status(404).json({ ok: false, error: 'Contraparte no encontrada' })

    const b = req.body || {}
    const cuentaId = b.cuenta_id ? Number(b.cuenta_id) : null
    if (cuentaId) {
      const c = db.prepare(`SELECT id FROM cuentas WHERE id = ? AND empresa_id = ?`).get(cuentaId, req.empresaId)
      if (!c) return res.status(400).json({ ok: false, error: 'Cuenta no encontrada en esta empresa' })
    }
    const ccId = b.centro_costo_id ? Number(b.centro_costo_id) : null
    if (ccId) {
      const cc = db.prepare(`SELECT id FROM centros_costo WHERE id = ? AND empresa_id = ?`).get(ccId, req.empresaId)
      if (!cc) return res.status(400).json({ ok: false, error: 'Centro de costo no encontrado en esta empresa' })
    }

    db.prepare(`
      UPDATE contrapartes SET cuenta_id = ?, centro_costo_id = ?, tratamiento_iva = ?
      WHERE id = ? AND empresa_id = ?
    `).run(cuentaId, ccId, b.tratamiento_iva || cp.tratamiento_iva || null, cp.id, req.empresaId)

    auditoria.registrarAccion(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      accion: 'contraparte.clasificar', entidad: 'contrapartes', entidadId: String(cp.id),
      antes: { cuenta_id: cp.cuenta_id, centro_costo_id: cp.centro_costo_id, tratamiento_iva: cp.tratamiento_iva },
      despues: { cuenta_id: cuentaId, centro_costo_id: ccId, tratamiento_iva: b.tratamiento_iva || cp.tratamiento_iva },
      ip: ip(req),
    })

    const actualizada = db.prepare(`
      SELECT cp.*, c.codigo AS cuenta_codigo, cc.codigo AS cc_codigo
      FROM contrapartes cp
      LEFT JOIN cuentas c ON c.id = cp.cuenta_id
      LEFT JOIN centros_costo cc ON cc.id = cp.centro_costo_id
      WHERE cp.id = ?
    `).get(cp.id)
    res.json({ ok: true, contraparte: actualizada })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
