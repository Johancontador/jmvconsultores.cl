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
const cobranza = require('../core/cobranza')
const formatos = require('../core/tesoreria-cartola-formatos')
const portalCredito = require('../core/portal-credito')

const router = express.Router()

function ip(req) {
  return req.ip || null
}

// ---------- 9.2: cartola desde ARCHIVO (Excel/CSV del portal del banco) ----------

// Preview: parsea el archivo y devuelve las filas detectadas SIN importar nada.
router.post('/empresas/:empresaId/tesoreria/cartola-archivo', requirePermiso('bancos:conciliar'), async (req, res) => {
  try {
    const b = req.body || {}
    if (!b.contenido_base64) return res.status(400).json({ ok: false, error: 'Falta el contenido del archivo (contenido_base64)' })
    const parsed = await formatos.parsearArchivo({ nombre: b.nombre_archivo, contenidoBase64: b.contenido_base64 })

    let fuente = parsed.formato_detectado ? parsed.formato_detectado.fuente : null
    let { filas, saltadas } = parsed
    if (b.mapeo) {
      const manual = formatos.parsearConMapeo(parsed.matriz, b.mapeo)
      filas = manual.filas
      saltadas = manual.saltadas
      fuente = 'manual'
      if (b.guardar_formato) {
        formatos.guardarFormato(db, {
          empresaId: req.empresaId, usuarioId: req.user.id,
          nombre: b.guardar_formato, mapeo: b.mapeo, ip: ip(req),
        })
      }
    }

    let importacion = null
    if (b.importar) {
      if (!filas.length) return res.status(422).json({ ok: false, error: 'No hay filas importables: el formato no se reconoció y no hay mapeo manual que aplique' })
      importacion = teso.importarCartola(db, {
        empresaId: req.empresaId, usuarioId: req.user.id,
        bancoCuentaId: b.banco_cuenta_id, filas, ip: ip(req),
      })
    }

    res.json({
      ok: true,
      tipo_archivo: parsed.tipo_archivo,
      fuente_mapeo: fuente,
      formato_detectado: parsed.formato_detectado,
      filas_detectadas: filas.length,
      filas: filas.slice(0, 200),
      saltadas,
      filas_totales: parsed.filas_totales,
      importacion,
    })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.get('/empresas/:empresaId/tesoreria/cartola-formatos', requirePermiso('bancos:conciliar'), (req, res) => {
  try {
    res.json({ ok: true, formatos: formatos.listarFormatos(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/cartola-formatos', requirePermiso('bancos:conciliar'), (req, res) => {
  try {
    const b = req.body || {}
    const r = formatos.guardarFormato(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      nombre: b.nombre, mapeo: b.mapeo, ip: ip(req),
    })
    res.status(201).json({ ok: true, formato: r, formatos: formatos.listarFormatos(db, req.empresaId) })
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// ---------- Resumen (para el dashboard del módulo) ----------

router.get('/empresas/:empresaId/tesoreria/resumen', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    // El período del header decide los KPI de ingresos/egresos del módulo. Un
    // valor con formato inválido se rechaza en vez de caer al mes en curso:
    // mostrar otro mes como si fuera el pedido sería una cifra engañosa.
    const periodo = req.query.periodo ? String(req.query.periodo) : null
    if (periodo && !/^\d{4}(0[1-9]|1[0-2])$/.test(periodo)) {
      return res.status(400).json({ ok: false, error: 'Período inválido (YYYYMM)' })
    }
    res.json({ ok: true, resumen: teso.resumen(db, req.empresaId, { periodo }) })
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

// ---------- Cobranza (Fase 3) — vista de saldos + botón «Pagada» ----------

router.get('/empresas/:empresaId/cobranza', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    const saldos = cobranza.saldosClientes(db, {
      empresaId: req.empresaId,
      limit: req.query.limit ? Number(req.query.limit) : 500,
    })
    // Crédito autorizado (Fase C portal): cada cliente con su ficha si existe —
    // sin ficha queda null (no se estima). Lectura pura; la escritura es del dueño.
    portalCredito.ensureTablas(db)
    res.json(portalCredito.enriquecerConCredito(db, { empresaId: req.empresaId, saldos }))
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/cobranza/:documentoId/pagada', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    res.status(201).json(cobranza.marcarPagada(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      documentoId: Number(req.params.documentoId),
      bancoCuentaId: b.banco_cuenta_id, fecha: b.fecha || null,
      monto: b.monto ?? null, glosa: b.glosa || null, ip: ip(req),
    }))
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// BLOQUE 4 (masterplan): aplicar un movimiento bancario a N documentos
// (1↔n), con techos validados y trazabilidad completa en teso_aplicaciones.
router.post('/empresas/:empresaId/tesoreria/movimientos/:movimientoId/aplicar', requirePermiso('tesoreria:operar'), (req, res) => {
  try {
    const b = req.body || {}
    res.status(201).json(cobranza.aplicarMovimientoADocumentos(db, {
      empresaId: req.empresaId, usuarioId: req.user.id,
      movimientoId: Number(req.params.movimientoId),
      aplicaciones: b.aplicaciones, ip: ip(req),
    }))
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message })
  }
})

// Consulta la trazabilidad de un documento: cada aplicación con su movimiento
// y asiento — el "quién cobró qué con qué transferencia" para auditoría.
router.get('/empresas/:empresaId/tesoreria/documentos/:documentoId/aplicaciones', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    res.json({
      ok: true,
      documento_id: Number(req.params.documentoId),
      cobrado: cobranza.cobradoDeDocumento(db, Number(req.params.documentoId)),
      aplicaciones: db.prepare(`
        SELECT a.id, a.monto, a.aplicado_en, a.motivo, a.movimiento_id,
               m.fecha, m.tipo, m.glosa, m.asiento_id
        FROM teso_aplicaciones a
        JOIN teso_movimientos m ON m.id = a.movimiento_id
        WHERE a.documento_id = ? AND a.empresa_id = ?
        ORDER BY a.id
      `).all(Number(req.params.documentoId), req.empresaId),
    })
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

// ---------- Deuda FISCAL (TGR) ----------
// La deuda con el Fisco no es deuda comercial: la emite la Tesorería General
// de la República y se acredita con su certificado. Se consulta con la MISMA
// Clave Tributaria del SII que ya está en la bóveda.

const deudaTgr = require('../core/deuda-tgr')
const path = require('path')
const fs = require('fs')

router.get('/empresas/:empresaId/tesoreria/deuda-fiscal', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    res.json({ ok: true, deuda: deudaTgr.resumen(db, req.empresaId), ultima: deudaTgr.ultima(db, req.empresaId) })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

router.post('/empresas/:empresaId/tesoreria/deuda-fiscal/consultar', requirePermiso('tesoreria:operar'), async (req, res) => {
  try {
    const r = await deudaTgr.consultar(db, {
      empresaId: req.empresaId, usuarioId: req.user.id, ip: ip(req),
    })
    // El resumen del menú (KPI/pill) cachea 60 s el informe: la deuda recién
    // consultada tiene que verse de inmediato, no en la próxima navegación.
    try { require('../core/salud-tributaria').olvidarResumen(req.empresaId) } catch { /* sin salud, no aplica */ }
    res.json({ ok: true, deuda: deudaTgr.resumen(db, req.empresaId), registro: r })
  } catch (err) {
    // 424 = falta el navegador headless en el servidor; 422 = la TGR rechazó
    // la Clave Tributaria; 502 = el portal falló o cambió.
    const code = err.codigo === 'TGR_SIN_NAVEGADOR' ? 424
      : err.codigo === 'TGR_SESION_INVALIDA' ? 422
        : err.codigo === 'TGR_PORTAL_CAMBIADO' ? 502
          : err.codigo ? 502 : 400
    res.status(code).json({ ok: false, codigo: err.codigo || null, error: err.message })
  }
})

// Certificado oficial tal como lo entregó la TGR (evidencia descargable).
router.get('/empresas/:empresaId/tesoreria/deuda-fiscal/certificado', requirePermiso('tesoreria:ver'), (req, res) => {
  try {
    const u = deudaTgr.ultima(db, req.empresaId)
    if (!u || !u.pdf_ruta) return res.status(404).json({ ok: false, error: 'No hay certificado descargado para esta empresa' })
    const base = path.resolve(process.cwd(), 'data', 'certificados-tgr')
    const archivo = path.resolve(process.cwd(), u.pdf_ruta)
    // El archivo debe estar DENTRO del directorio de certificados: nunca se
    // sirve una ruta arbitraria de la base.
    if (!archivo.startsWith(base + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Ruta de certificado inválida' })
    }
    if (!fs.existsSync(archivo)) return res.status(404).json({ ok: false, error: 'El archivo del certificado ya no existe en disco' })
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Disposition', `inline; filename="certificado-deuda-${String(u.fecha_emision || 'tgr')}.pdf"`)
    res.send(fs.readFileSync(archivo))
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
