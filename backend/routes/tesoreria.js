/**
 * Rutas /api/contable — FASE 6: tesorería (§22). Todas exigen sesión
 * (requireAuth en index.js) y el RBAC resuelve el rol en :empresaId
 * (requirePermiso, con gate de licencia para escrituras). Aquí solo HTTP y
 * contexto; toda la lógica vive en core/tesoreria.js.
 */

const express = require('express')
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const teso = require('../core/tesoreria')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- Resumen (para el dashboard del módulo) ----------

router.get('/empresas/:empresaId/tesoreria/resumen', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    res.json({ ok: true, resumen: teso.resumen(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Bancos ----------

router.get('/empresas/:empresaId/bancos', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    res.json({ ok: true, bancos: teso.listarBancos(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/bancos', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const id = teso.crearBanco(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      banco: b.banco, numero: b.numero || '', moneda: b.moneda || 'CLP',
      cuentaContableId: b.cuenta_contable_id, saldoInicial: b.saldo_inicial || 0,
      ip: ip(req),
    })
    res.status(201).json({ ok: true, banco: teso.obtenerBanco(db, req.empresaId, id) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Libro banco + movimientos ----------

router.get('/empresas/:empresaId/tesoreria/movimientos', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    const r = teso.libroBanco(db, {
      empresaId: req.empresaId, bancoCuentaId: req.query.banco_cuenta_id,
      desde: req.query.desde || null, hasta: req.query.hasta || null,
      limit: req.query.limit,
    })
    res.json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/pagos', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = teso.registrarPagoCobro(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      bancoCuentaId: b.banco_cuenta_id, tipo: 'PAGO', fecha: b.fecha,
      monto: b.monto, glosa: b.glosa, documentoId: b.documento_id ?? null,
      cuentaContraparteId: b.cuenta_contraparte_id ?? null,
      ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/cobros', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = teso.registrarPagoCobro(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      bancoCuentaId: b.banco_cuenta_id, tipo: 'COBRO', fecha: b.fecha,
      monto: b.monto, glosa: b.glosa, documentoId: b.documento_id ?? null,
      cuentaContraparteId: b.cuenta_contraparte_id ?? null,
      ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/transferencias', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = teso.registrarTransferencia(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      bancoCuentaId: b.banco_cuenta_id, bancoDestinoId: b.banco_destino_id,
      fecha: b.fecha, monto: b.monto, glosa: b.glosa, ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Cartola + conciliación ----------

router.get('/empresas/:empresaId/tesoreria/cartola', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    const filas = teso.listarCartola(db, {
      empresaId: req.empresaId, bancoCuentaId: req.query.banco_cuenta_id,
      soloPendientes: req.query.solo_pendientes === '1',
      limit: req.query.limit,
    })
    res.json({ ok: true, filas })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/cartola', requirePermiso('bancos:conciliar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = teso.importarCartola(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      bancoCuentaId: b.banco_cuenta_id, filas: b.filas, ip: ip(req),
    })
    res.status(201).json({ ok: true, ...r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/conciliar', requirePermiso('bancos:conciliar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = teso.conciliarBanco(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      bancoCuentaId: b.banco_cuenta_id, hasta: b.hasta, ip: ip(req),
    })
    res.json({ ok: true, conciliacion: r })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

module.exports = router
