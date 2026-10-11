/**
 * PORTAL DE INTELIGENCIA COMERCIAL — rutas /api/portal (§8, §9 del masterplan).
 *
 * PRINCIPIOS:
 *  - SOLO LECTURA comercial: el portal consume la bandeja oficial (`documentos`)
 *    — nada aquí clasifica ni contabiliza; el sistema interno sigue siendo la
 *    herramienta operativa (§1). Toda escritura es config del PROPIO usuario
 *    (reportes guardados), jamás datos contables.
 *  - AISLAMIENTO ESTRICTO (§8): el router implementa SU PROPIO guard — un
 *    usuario solo consulta empresas donde tiene asignación activa en
 *    usuario_empresa (o es super_admin). Cada endpoint revalida por-empresa
 *    ANTES de tocar datos. Pruebas negativas: test/portal.test.js.
 *  - Exportación CSV (§B): se genera en memoria tras revalidar el acceso, con
 *    el MISMO WHERE que la vista; cada descarga queda auditada.
 *  - Router factoría con `db` por parámetro — testeable in-memory.
 */
const express = require('express')
const { registrarAccion } = require('../core/auditoria')
const { rolEnEmpresa, esSuperAdmin } = require('../core/empresas')
const portal = require('../core/portal-metricas')

function construirRouter(db) {
  const router = express.Router()

  /** Guard por empresa: asignación activa (o super admin) → 403 server-side. */
  function accesoEmpresa(req, res, empresaId) {
    const id = Number(empresaId)
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ ok: false, error: 'empresa_id inválido' })
      return null
    }
    if (!rolEnEmpresa(db, req.user.id, id)) {
      res.status(403).json({ ok: false, error: 'No tienes acceso a esa empresa' })
      return null
    }
    return id
  }

  /** Período AAAAMM del query, con fallback al último con RCV de venta. */
  function periodoDe(req, empresaId) {
    const p = String(req.query.periodo || '').replace(/\D/g, '').slice(0, 6)
    if (/^\d{6}$/.test(p)) return p
    const fila = db.prepare(`
      SELECT MAX(periodo_ingesta) AS p FROM documentos
      WHERE empresa_id = ? AND tipo_flujo = 'venta'
    `).get(empresaId)
    return fila && fila.p ? fila.p : null
  }

  /** Normaliza texto de período desde el query ('' si inválido). */
  function cleanPeriodo(v) {
    const p = String(v || '').replace(/\D/g, '').slice(0, 6)
    return /^\d{6}$/.test(p) ? p : null
  }

  /* ------------------------ EMPRESAS ACCESIBLES ------------------------ */

  router.get('/empresas', (req, res) => {
    const filas = db.prepare(`
      SELECT e.id, e.rut, e.nombre
      FROM empresas e JOIN usuario_empresa ue ON ue.empresa_id = e.id AND ue.activo = 1
      WHERE e.activo = 1 AND ue.usuario_id = ?
      ORDER BY e.nombre
    `).all(req.user.id)
    // Super admin sin asignaciones explícitas ve todas (rol global).
    if (esSuperAdmin(db, req.user.id)) {
      const mapa = new Map(filas.map((f) => [f.id, f]))
      for (const e of db.prepare(`SELECT id, rut, nombre FROM empresas WHERE activo = 1 ORDER BY nombre`).all()) {
        mapa.set(e.id, e)
      }
      return res.json({ ok: true, empresas: [...mapa.values()] })
    }
    res.json({ ok: true, empresas: filas })
  })

  /* --------------------------- RESUMEN (§A) --------------------------- */

  router.get('/empresas/:empresaId/resumen', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const periodo = periodoDe(req, id)
      if (!periodo) return res.json({ ok: true, sin_datos: true, resumen: null })
      res.json({ ok: true, resumen: portal.resumen(db, { empresaId: id, periodo }) })
    } catch (err) {
      res.status(422).json({ ok: false, error: err.message })
    }
  })

  /* --------------------- MOVIMIENTOS (§B) --------------------- */

  router.get('/empresas/:empresaId/movimientos', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      res.json({
        ok: true,
        ...portal.movimientos(db, {
          empresaId: id,
          desde: cleanPeriodo(req.query.desde),
          hasta: cleanPeriodo(req.query.hasta),
          tipoDoc: req.query.tipo_doc || null,
          tipoFlujo: req.query.tipo_flujo === 'compra' ? 'compra' : 'venta',
          rut: req.query.rut || null,
          texto: req.query.texto || null,
          limit: req.query.limit,
          offset: req.query.offset,
        }),
      })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* -------------------- EXPORTACIÓN CSV (§B) -------------------- */

  router.get('/empresas/:empresaId/exportar.csv', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const { movimientos, neto, monto_total, total } = portal.movimientos(db, {
        empresaId: id,
        desde: cleanPeriodo(req.query.desde),
        hasta: cleanPeriodo(req.query.hasta),
        tipoDoc: req.query.tipo_doc || null,
        tipoFlujo: req.query.tipo_flujo === 'compra' ? 'compra' : 'venta',
        rut: req.query.rut || null,
        texto: req.query.texto || null,
        limit: 1000, offset: 0,
      })
      registrarAccion(db, {
        empresaId: id, usuarioId: req.user.id,
        accion: 'portal.exportar_csv', entidad: 'documentos',
        entidadId: null, despues: { total, neto, monto_total }, ip: req.ip,
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="portal-movimientos-${id}.csv"`)
      res.write('\uFEFF')
      res.write('fecha;folio;tipo_doc;rut;razon_social;neto;iva;total;estado\n')
      const esc = (v) => String(v == null ? '' : v).replace(/"/g, '""')
      for (const m of movimientos) {
        res.write([m.fecha_docto, m.folio, m.tipo_doc, m.rut_contraparte, m.razon_social,
          m.monto_neto, m.monto_iva, m.monto_total, m.estado].map(esc).join(';') + '\n')
      }
      res.end()
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* -------------------------- CARTERA (§C) -------------------------- */

  router.get('/empresas/:empresaId/cartera', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const periodo = periodoDe(req, id)
      if (!periodo) return res.json({ ok: true, sin_datos: true, cartera: null })
      const ventana = Math.min(Math.max(Number(req.query.ventana) || 12, 1), 24)
      res.json({ ok: true, cartera: portal.cartera(db, { empresaId: id, periodo, ventana }) })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* --------------------- CATÁLOGO DE MÉTRICAS (§7) --------------------- */

  router.get('/metricas', (req, res) => {
    res.json({ ok: true, metricas: portal.catalogo() })
  })

  /* ---------------- REPORTES GUARDADOS (§H, config no datos) ---------------- */

  ensureTablaReportes(db)

  router.get('/empresas/:empresaId/reportes', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    res.json({
      ok: true,
      reportes: db.prepare(`
        SELECT id, nombre, config_json, creado_en, actualizado_en
        FROM portal_reportes
        WHERE usuario_id = ? AND empresa_id = ?
        ORDER BY actualizado_en DESC, creado_en DESC
      `).all(req.user.id, id),
    })
  })

  router.post('/empresas/:empresaId/reportes', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    const nombre = String(req.body && req.body.nombre || '').trim()
    const config = req.body && req.body.config
    if (!nombre) return res.status(400).json({ ok: false, error: 'Falta el nombre del reporte' })
    if (!config || typeof config !== 'object') return res.status(400).json({ ok: false, error: 'Falta la config del reporte' })
    try {
      const texto = JSON.stringify(config)
      db.prepare(`
        INSERT INTO portal_reportes (usuario_id, empresa_id, nombre, config_json, actualizado_en)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(usuario_id, empresa_id, nombre) DO UPDATE SET
          config_json = excluded.config_json, actualizado_en = datetime('now')
      `).run(req.user.id, id, nombre, texto)
      const fila = db.prepare(`
        SELECT id, nombre, config_json, creado_en, actualizado_en
        FROM portal_reportes WHERE usuario_id = ? AND empresa_id = ? AND nombre = ?
      `).get(req.user.id, id, nombre)
      res.status(201).json({ ok: true, reporte: fila })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  router.delete('/empresas/:empresaId/reportes/:reporteId', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const r = db.prepare(`
        DELETE FROM portal_reportes
        WHERE usuario_id = ? AND empresa_id = ? AND id = ?
      `).run(req.user.id, id, Number(req.params.reporteId))
      if (!r.changes) return res.status(404).json({ ok: false, error: 'Reporte no encontrado' })
      res.json({ ok: true })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  return router
}

/** Tabla de reportes guardados: config del propio usuario (no datos contables). */
function ensureTablaReportes(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portal_reportes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES users(id),
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      nombre TEXT NOT NULL,
      config_json TEXT NOT NULL,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT,
      UNIQUE(usuario_id, empresa_id, nombre)
    )
  `).run()
}

module.exports = { construirRouter, ensureTablaReportes }
