const express = require('express')
const db = require('../db')
const { probarConexion, consultarResumen, consultarRCV } = require('../services/sii-rcv')
const { getProvider } = require('../services/rcv')

const router = express.Router()

router.get('/config', (req, res) => {
  res.json({
    ok: true,
    proveedor: getProvider(),
    portal_login: 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html',
    portal_rcv:
      'https://www4.sii.cl/consdcvinternetui/#/index',
    menu_sii:
      'Impuestos Mensuales → Registro de Compras y Ventas → Consultar y visualizar libros',
  })
})

router.post('/probar', async (req, res) => {
  try {
    let rut, clave

    if (req.body.cliente_id) {
      const cliente = db
        .prepare(
          `SELECT rut, clave_sii FROM clientes WHERE id = ? AND activo = 1 AND user_id = ?`
        )
        .get(Number(req.body.cliente_id), req.user.id)
      if (!cliente) {
        return res.status(404).json({ ok: false, error: 'Cliente no encontrado' })
      }
      rut = cliente.rut
      clave = cliente.clave_sii
    } else {
      rut = req.body.rut
      clave = req.body.clave_sii
    }

    if (!rut || !clave) {
      return res.status(400).json({ ok: false, error: 'RUT y clave SII requeridos' })
    }

    if (getProvider() !== 'sii') {
      return res.status(400).json({
        ok: false,
        error: 'Conexión directa SII requiere RCV_PROVIDER=sii en .env',
      })
    }

    const resultado = await probarConexion(rut, clave)
    if (!resultado.ok) {
      return res.status(401).json(resultado)
    }
    res.json(resultado)
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// Libro de compras o ventas de UN solo mes — resumen por tipo de documento
// (idéntico a lo que muestra la pantalla del SII) + detalle documento a documento.
// GET para poder probarlo directo desde la barra del navegador mientras validamos
// que cuadre; luego el frontend lo puede consumir igual.
router.get('/libro', async (req, res) => {
  try {
    const clienteId = Number(req.query.cliente_id)
    const periodo = req.query.periodo
    const tipo = req.query.tipo

    if (!clienteId || !periodo || !/^\d{6}$/.test(periodo) || !['compras', 'ventas'].includes(tipo)) {
      return res.status(400).json({
        ok: false,
        error: 'Parámetros requeridos: cliente_id, periodo (YYYYMM), tipo (compras|ventas)',
      })
    }

    if (getProvider() !== 'sii') {
      return res.status(400).json({ ok: false, error: 'Conexión directa SII requiere RCV_PROVIDER=sii en .env' })
    }

    const cliente = db
      .prepare(`SELECT id, rut, nombre, clave_sii FROM clientes WHERE id = ? AND activo = 1 AND user_id = ?`)
      .get(clienteId, req.user.id)
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' })

    const [resumen, detalle] = await Promise.all([
      consultarResumen(cliente.rut, cliente.clave_sii, periodo, tipo),
      consultarRCV(cliente.rut, cliente.clave_sii, tipo, periodo),
    ])

    const esNotaCredito = (tipoDoc) => Number(tipoDoc) === 60 || Number(tipoDoc) === 61

    // Total bruto: suma cruda por categoría, tal cual el resumen del SII (sirve
    // solo para el chequeo "cuadra" contra el detalle, no es el total real de IVA).
    const totalDetalleBruto = detalle.reduce(
      (acc, d) => ({
        neto: acc.neto + d.montoNeto,
        iva: acc.iva + d.montoIVA,
        exento: acc.exento + (d.montoExento || 0),
        total: acc.total + d.montoTotal,
      }),
      { neto: 0, iva: 0, exento: 0, total: 0 }
    )
    const totalResumenBruto = resumen.reduce(
      (acc, r) => ({
        neto: acc.neto + r.neto,
        iva: acc.iva + r.iva,
        exento: acc.exento + r.exento,
        total: acc.total + r.total,
      }),
      { neto: 0, iva: 0, exento: 0, total: 0 }
    )

    // Total neto: el que importa para IVA — las Notas de Crédito restan en vez
    // de sumar, porque corrigen un documento anterior.
    const totalNeto = resumen.reduce(
      (acc, r) => {
        const signo = esNotaCredito(r.tipoDoc) ? -1 : 1
        return {
          neto: acc.neto + signo * r.neto,
          iva: acc.iva + signo * r.iva,
          exento: acc.exento + signo * r.exento,
          total: acc.total + signo * r.total,
        }
      },
      { neto: 0, iva: 0, exento: 0, total: 0 }
    )

    res.json({
      ok: true,
      cliente: { id: cliente.id, nombre: cliente.nombre, rut: cliente.rut },
      periodo,
      tipo,
      resumen,
      detalle,
      totales: {
        resumen: totalResumenBruto,
        detalle: totalDetalleBruto,
        neto: totalNeto,
        tieneNotaCredito: resumen.some((r) => esNotaCredito(r.tipoDoc)),
        cuadra: Math.abs(totalResumenBruto.neto - totalDetalleBruto.neto) < 1 && Math.abs(totalResumenBruto.iva - totalDetalleBruto.iva) < 1,
      },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
