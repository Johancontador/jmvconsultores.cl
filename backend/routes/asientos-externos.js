/**
 * Rutas /api/contable — FASE 9.1: receptor de asientos externos (INTEGRATIONS
 * §4, Geo Daniela y otros). A diferencia del resto de los routers, la empresa
 * NO viene en la URL sino en el body/query (`empresa_rut`): el middleware local
 * resuelve la empresa DENTRO de las empresas del usuario autenticado y aplica
 * el mismo RBAC + gate de licencia que requirePermiso.
 */

const express = require('express')
const db = require('../db')
const { rolEnEmpresa } = require('../core/empresas')
const { permisosDeRol } = require('../core/permisos')
const licencias = require('../core/licencias')
const externos = require('../core/asientos-externos')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

function empresaPorRut(rut) {
  return db.prepare(`SELECT id FROM empresas WHERE rut = ? AND activo = 1`).get(String(rut || '').trim())
}

/** requirePermiso con la empresa resuelta desde el RUT del body/query. */
function permisoPorRut(capacidad, fuente = 'body') {
  return (req, res, next) => {
    const usuarioId = req.user && req.user.id
    if (!usuarioId) return res.status(401).json({ ok: false, error: 'No autenticado' })
    const rut = fuente === 'query' ? req.query.empresa_rut : (req.body && req.body.empresa_rut)
    const emp = empresaPorRut(rut)
    if (!emp) return res.status(404).json({ ok: false, error: `No existe una empresa activa con RUT ${rut}` })

    const rol = rolEnEmpresa(db, usuarioId, emp.id)
    if (!rol) return res.status(403).json({ ok: false, error: 'No tiene acceso a esta empresa' })
    if (!permisosDeRol(rol).has(capacidad)) {
      return res.status(403).json({ ok: false, error: `Permiso requerido: ${capacidad}` })
    }
    req.empresaId = emp.id
    req.rolEmpresa = rol
    if (!capacidad.endsWith(':ver')) {
      try {
        licencias.exigirVigente(db, emp.id)
      } catch (err) {
        return res.status(402).json({ ok: false, error: err.message, licencia: licencias.estadoParaUI(db, emp.id) })
      }
    }
    next()
  }
}

function responderError(res, err) {
  const status = Number(err.status) || 400
  res.status(status).json({ ok: false, error: err.message, codigo: err.codigo || null })
}

// ---------- Contrato INTEGRATIONS §4 ----------

router.post('/asientos-externos', permisoPorRut('asientos:crear'), (req, res) => {
  try {
    const b = req.body || {}
    const r = externos.recibir(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      remitente: b.remitente || 'geodaniela',
      idempotencia: b.idempotencia ?? null,
      periodo: b.periodo ?? null,
      glosa: b.glosa, fecha: b.fecha, lineas: b.lineas,
      ip: ip(req),
    })
    res.status(r.deduplicado ? 200 : 201).json({ ok: true, ...r })
  } catch (err) {
    responderError(res, err)
  }
})

// ---------- Auxiliares para el remitente / el contador ----------

router.get('/asientos-externos', permisoPorRut('asientos:ver', 'query'), (req, res) => {
  try {
    res.json({ ok: true, recibidos: externos.listar(db, req.empresaId, { remitente: req.query.remitente || null, limit: req.query.limit }) })
  } catch (err) {
    responderError(res, err)
  }
})

router.get('/asientos-externos/validar-codigos', permisoPorRut('asientos:ver', 'query'), (req, res) => {
  try {
    res.json({ ok: true, codigos: externos.validarCodigos(db, req.empresaId, req.query.codigos) })
  } catch (err) {
    responderError(res, err)
  }
})

module.exports = router
