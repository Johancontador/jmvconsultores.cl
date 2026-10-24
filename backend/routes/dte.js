/**
 * RUTAS DE EMISIÓN DE DTE — BLOQUE 2 (/api/dte).
 *
 * Capacidad de emisión de DTEs para las EMPRESAS CLIENTES: configuración del
 * emisor tributario (certificado, CAFs, resolución, ambiente), emisión de
 * Factura (33), Factura Exenta (34), Nota de Débito (56) y Nota de Crédito
 * (61), consulta del estado REAL del envío en el SII y reintentos.
 *
 * RBAC con gate de licencia (requirePermiso estándar — es una capacidad
 * operativa del software, a diferencia del pago de la suscripción):
 *   dte:ver        → consulta (config pública, CAFs, DTEs emitidos)
 *   dte:configurar → certificado, CAFs, resolución, ambiente
 *   dte:emitir     → emitir, consultar estado SII, reintentar
 * Aislamiento: todas las rutas resuelven la empresa por :empresaId dentro del
 * rol del usuario (requirePermiso) — nadie ve ni emite DTEs de otra empresa.
 *
 * Adaptador DTE inyectable: la app de producción usa el adaptador real
 * (core/dte-emisor.adaptadorReal, lazy); los tests inyectan uno falso con
 * app.set('dteAdapter', fake) — jamás tocan el SII.
 */

const express = require('express')
const router = express.Router()
const db = require('../db')
const { requirePermiso } = require('../middleware/requirePermiso')
const emisor = require('../core/dte-emisor')
const contable = require('../core/dte-contable')

function adaptador(req) {
  return (req.app && req.app.get('dteAdapter')) || emisor.adaptadorReal()
}

// ---------------------------------------------------------------
// Config del emisor (lectura pública sin secretos + faltantes por tipo)
// ---------------------------------------------------------------
router.get('/empresas/:empresaId/config', requirePermiso('dte:ver'), (req, res) => {
  res.json({
    ok: true,
    config: emisor.configPublica(db, req.empresaId),
    faltantes: emisor.faltantesPorTipo(db, req.empresaId),
    // F5-D: vigencia/identidad del certificado (metadatos, sin secretos).
    // La UI puede avisar «vence en N días» antes de intentar emitir.
    certificado: emisor.estadoCertificado(db, req.empresaId),
  })
})

router.put('/empresas/:empresaId/config', requirePermiso('dte:configurar'), (req, res) => {
  try {
    const config = emisor.guardarConfig(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, campos: req.body || {}, ip: req.ip,
    })
    res.json({ ok: true, config })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

// ---------------------------------------------------------------
// CAFs de folios (alta idempotente por rango; el XML queda cifrado)
// ---------------------------------------------------------------
router.post('/empresas/:empresaId/folios', requirePermiso('dte:configurar'), (req, res) => {
  try {
    const caf = emisor.guardarCaf(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, cafXml: (req.body || {}).caf_xml, ip: req.ip,
    })
    res.json({ ok: true, caf })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/folios', requirePermiso('dte:ver'), (req, res) => {
  res.json({ ok: true, folios: emisor.listarFolios(db, req.empresaId) })
})

// ---------------------------------------------------------------
// Emisión / consulta / reintento
// ---------------------------------------------------------------
router.post('/empresas/:empresaId/emitir', requirePermiso('dte:emitir'), async (req, res) => {
  try {
    const { tipo, items, receptor, referencia, documento_id, idempotencia } = req.body || {}
    // BLOQUE 3: idempotencia de emisión — re-envío con la misma clave devuelve
    // el DTE ya creado (deduplicado: true) en vez de emitir otro folio.
    const clave = idempotencia ? String(idempotencia) : null
    const previo = clave ? emisor.obtenerPorIdempotencia(db, req.empresaId, clave) : null
    if (previo) return res.json({ ok: true, dte: previo, deduplicado: true })
    const dte = await emisor.emitir(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      tipo, items, receptor, referencia,
      documentoId: documento_id || null,
      idempotencia: clave,
      dteAdapter: adaptador(req), ip: req.ip,
    })
    res.json({ ok: true, dte })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/dtes', requirePermiso('dte:ver'), (req, res) => {
  try {
    const dtes = emisor.listar(db, {
      empresaId: req.empresaId, tipo: req.query.tipo, estado: req.query.estado,
      limit: req.query.limit, offset: req.query.offset,
    })
    res.json({ ok: true, dtes })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/dtes/:dteId', requirePermiso('dte:ver'), (req, res) => {
  const dte = emisor.obtener(db, req.empresaId, Number(req.params.dteId))
  if (!dte) return res.status(404).json({ ok: false, error: 'DTE no encontrado' })
  res.json({ ok: true, dte })
})

router.post('/empresas/:empresaId/dtes/:dteId/estado', requirePermiso('dte:emitir'), async (req, res) => {
  try {
    const dte = await emisor.consultarEstado(db, {
      empresaId: req.empresaId, dteId: Number(req.params.dteId),
      usuarioId: req.user.id, dteAdapter: adaptador(req), ip: req.ip,
    })
    res.json({ ok: true, dte })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

// ---------------------------------------------------------------
// BLOQUE 3: DTE ACEPTADO → bandeja (origen 'dte') → reglas → propuesta
// PENDIENTE → confirmación humana → asiento. Idempotente; sin regla el
// documento queda PENDIENTE visible (jamás cuentas inventadas).
// ---------------------------------------------------------------
router.post('/empresas/:empresaId/sincronizar-contabilidad', requirePermiso('dte:emitir'), (req, res) => {
  try {
    const sincronizacion = contable.sincronizarContabilidad(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, ip: req.ip,
    })
    res.json({ ok: true, sincronizacion })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/dtes/:dteId/reintentar', requirePermiso('dte:emitir'), async (req, res) => {
  try {
    const dte = await emisor.reintentar(db, {
      empresaId: req.empresaId, dteId: Number(req.params.dteId),
      usuarioId: req.user.id, dteAdapter: adaptador(req), ip: req.ip,
    })
    res.json({ ok: true, dte })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

module.exports = router
