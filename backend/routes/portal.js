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
const portalProductos = require('../core/portal-productos')
const cobranzaCore = require('../core/cobranza')
const portalCredito = require('../core/portal-credito')
const portalCostos = require('../core/portal-costos')
const portalCotizaciones = require('../core/portal-cotizaciones')

function construirRouter(db) {
  const router = express.Router()

  // Tablas de fuentes digitadas del portal (FASES C/D/E): idempotente.
  portalCredito.ensureTablas(db)
  portalCostos.ensureTablas(db)
  portalCotizaciones.ensureTablas(db)

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

  /**
   * Guard de ESCRITURA para las fuentes digitadas (Fases C/D/E): el dato de
   * negocio de la empresa (crédito, costos, cotizaciones) lo fija su DUEÑO
   * (admin_empresa o super_admin) — otros roles asignados solo leen.
   */
  function accesoEscritura(req, res, empresaId) {
    const id = accesoEmpresa(req, res, empresaId)
    if (!id) return null
    const rol = rolEnEmpresa(db, req.user.id, id)
    if (!['admin_empresa', 'super_admin'].includes(rol)) {
      res.status(403).json({ ok: false, error: 'Solo el dueño de la empresa (admin) registra sus datos de negocio' })
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

  /* --------------------- SERIE INTERACTIVA (dashboard) --------------------- */

  /**
   * Serie móvil para el dashboard: ?meses=12&hasta=202609&flujo=venta.
   * Los parámetros se limpian server-side (meses 1-24; hasta AAAAMM; flujo
   * binario) — el front no manda SQL ni números sueltos.
   */
  router.get('/empresas/:empresaId/serie', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      res.json({
        ok: true,
        serie: portal.serie(db, {
          empresaId: id,
          meses: req.query.meses,
          hasta: cleanPeriodo(req.query.hasta),
          flujo: req.query.flujo === 'compra' ? 'compra' : 'venta',
        }),
      })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* --------------------- PRODUCTOS (FASE A, §7.2) --------------------- */

  /**
   * Productos vendidos de SU empresa: agrega lícita de ítems de DTE EMITIDOS
   * propios (dte_emitidos.items_json). Fuente declarada: NO cubre RCV de
   * terceros — si la empresa no emitió, responde lista vacía con
   * periodo_cobertura null (sin datos ≠ cero).
   */
  router.get('/empresas/:empresaId/productos', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      res.json({
        ok: true,
        ...portalProductos.productosVendidos(db, {
          empresaId: id,
          desde: cleanPeriodo(req.query.desde),
          hasta: cleanPeriodo(req.query.hasta),
          limit: req.query.limit,
        }),
      })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* --------------------- COBRANZA (FASE B, §7.4) --------------------- */

  /**
   * Vista de lectura de cobranza del portal: los SALDOS de cuenta corriente
   * de venta CONTABILIZADA (motor core `saldosClientes`), con umbral de mora
   * configurable. SOLO LECTURA: cobrar/pagar queda en el sistema operativo
   * (tesoreria/marcarPagada), NUNCA desde el portal del cliente.
   */
  router.get('/empresas/:empresaId/cobranza', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const amarillo = Math.max(1, Number(req.query.dias_amarillo) || 15)
      const rojo = Math.max(amarillo + 1, Number(req.query.dias_rojo) || 30)
      const r = cobranzaCore.saldosClientes(db, { empresaId: id, diasMoraAmarillo: amarillo, diasMoraRojo: rojo })
      res.json({ ok: true, cobranza: { clientes: r.clientes, total_pendiente: r.total_pendiente, generado: r.generado, umbrales: { amarillo, rojo } } })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* ------------- CRÉDITO AUTORIZADO (FASE C, §7.1) — fuente digitada ------------- */
  /**
   * El crédito que la empresa le autoriza a CADA cliente no existe en el SII:
   * es dato de negocio que el dueño digita. Lectura para cualquier asignado;
   * escritura SOLO admin (el resto de roles es consulta).
   */
  router.get('/empresas/:empresaId/credito', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    const fichas = portalCredito.listar(db, { empresaId: id })
    let exposicion = null
    try {
      const amarillo = Math.max(1, Number(req.query.dias_amarillo) || 15)
      const rojo = Math.max(amarillo + 1, Number(req.query.dias_rojo) || 30)
      exposicion = portalCredito.exposicion(db, { empresaId: id, diasMoraAmarillo: amarillo, diasMoraRojo: rojo })
    } catch (err) {
      return res.status(422).json({ ok: false, error: `Exposición: ${err.message}` })
    }
    res.json({ ok: true, fichas, exposicion })
  })

  router.put('/empresas/:empresaId/credito', (req, res) => {
    const id = accesoEscritura(req, res, req.params.empresaId)
    if (!id) return
    try {
      const { rut, razon_social, monto_autorizado, notas } = req.body || {}
      const r = portalCredito.fijarAutorizado(db, {
        empresaId: id, usuarioId: req.user.id, rut,
        razonSocial: razon_social || null, monto: monto_autorizado, notas: notas || null, ip: req.ip,
      })
      res.status(r.actualizado ? 200 : 201).json(r)
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  /* ---------------- HOJA DE COSTOS Y MARGEN (FASE D, §7.3) ---------------- */
  /** Fuente honesta: sin costo digitado NO se estima margen (margen null). */
  router.get('/empresas/:empresaId/costos', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      res.json({ ok: true, costos: portalCostos.listar(db, { empresaId: id }) })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  router.put('/empresas/:empresaId/costos', (req, res) => {
    const id = accesoEscritura(req, res, req.params.empresaId)
    if (!id) return
    try {
      const { producto, costo_unitario, notas } = req.body || {}
      const r = portalCostos.fijarCosto(db, {
        empresaId: id, usuarioId: req.user.id, producto, costoUnitario: costo_unitario,
        notas: notas || null, ip: req.ip,
      })
      res.status(r.actualizado ? 200 : 201).json(r)
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  router.get('/empresas/:empresaId/margen', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      res.json({
        ok: true,
        ...portalCostos.margen(db, {
          empresaId: id,
          desde: cleanPeriodo(req.query.desde),
          hasta: cleanPeriodo(req.query.hasta),
          limit: req.query.limit,
        }),
      })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  /* -------------- COTIZACIONES / EMBUDO (FASE E, §7.5) — dato digitado -------------- */
  /** Las oportunidades previas a la factura no llegan del RCV: se registran aquí. */
  router.get('/empresas/:empresaId/cotizaciones', (req, res) => {
    const id = accesoEmpresa(req, res, req.params.empresaId)
    if (!id) return
    try {
      const estado = req.query.estado ? String(req.query.estado) : null
      res.json({
        ok: true,
        cotizaciones: portalCotizaciones.listar(db, { empresaId: id, estado }),
        embudo: portalCotizaciones.embudo(db, { empresaId: id }),
        estados: portalCotizaciones.ESTADOS,
      })
    } catch (err) { res.status(422).json({ ok: false, error: err.message }) }
  })

  router.post('/empresas/:empresaId/cotizaciones', (req, res) => {
    const id = accesoEscritura(req, res, req.params.empresaId)
    if (!id) return
    try {
      const { cliente_rut, cliente_razon, descripcion, monto, estado, notas } = req.body || {}
      const r = portalCotizaciones.crear(db, {
        empresaId: id, usuarioId: req.user.id, clienteRut: cliente_rut, clienteRazon: cliente_razon,
        descripcion, monto, estado: estado && String(estado) || 'BORRADOR', notas, ip: req.ip,
      })
      res.status(201).json(r)
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  router.put('/empresas/:empresaId/cotizaciones/:id', (req, res) => {
    const id = accesoEscritura(req, res, req.params.empresaId)
    if (!id) return
    try {
      const { estado, monto, descripcion, notas, fecha_cierre } = req.body || {}
      const r = portalCotizaciones.actualizar(db, {
        empresaId: id, usuarioId: req.user.id, id: req.params.id,
        estado: estado || null, monto: monto === undefined || monto === '' ? null : monto,
        descripcion, notas, fechaCierre: fecha_cierre, ip: req.ip,
      })
      res.json(r)
    } catch (err) {
      const status = /no encontrada/.test(err.message) ? 404 : 400
      res.status(status).json({ ok: false, error: err.message })
    }
  })

  router.delete('/empresas/:empresaId/cotizaciones/:id', (req, res) => {
    const id = accesoEscritura(req, res, req.params.empresaId)
    if (!id) return
    try {
      const r = portalCotizaciones.eliminar(db, { empresaId: id, usuarioId: req.user.id, id: req.params.id, ip: req.ip })
      res.json(r)
    } catch (err) {
      const status = /no encontrada/.test(err.message) ? 404 : 400
      res.status(status).json({ ok: false, error: err.message })
    }
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
