const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const archiver = require('archiver')

const db = require('../db')
const { consultarRCV } = require('./rcv')
const { generarPeriodos, nombreMes } = require('./calculos')

const NOMBRES_TIPO_DOC = {
  30: 'Factura', 32: 'Factura de Ventas y Servicios No Afectos o Exentos de IVA',
  33: 'Factura Electrónica', 34: 'Factura no Afecta o Exenta Electrónica',
  39: 'Boleta Electrónica', 41: 'Boleta no Afecta o Exenta Electrónica',
  43: 'Liquidación Factura Electrónica', 46: 'Factura de Compra Electrónica',
  52: 'Guía de Despacho Electrónica', 56: 'Nota de Débito Electrónica',
  60: 'Nota de Crédito', 61: 'Nota de Crédito Electrónica',
}
function nombreTipoDoc(tipoDoc) {
  return NOMBRES_TIPO_DOC[Number(tipoDoc)] || `Tipo ${tipoDoc}`
}

const EXPORTS_DIR = path.join(__dirname, '../../data/exports')
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true })

const exportaciones = new Map()

function crearExportacionId() {
  return `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

const COLUMNAS_HOJA = [
  { header: 'Mes', key: 'mes_nombre', width: 18 },
  { header: 'Folio', key: 'folio', width: 12 },
  { header: 'Tipo Documento', key: 'tipoDocNombre', width: 32 },
  { header: 'RUT', key: 'rutDoc', width: 14 },
  { header: 'Razón Social', key: 'razonSocial', width: 34 },
  { header: 'Fecha', key: 'fechaDocto', width: 14 },
  { header: 'Exento', key: 'montoExento', width: 14, style: { numFmt: '#,##0' } },
  { header: 'Neto', key: 'montoNeto', width: 14, style: { numFmt: '#,##0' } },
  { header: 'IVA', key: 'montoIVA', width: 14, style: { numFmt: '#,##0' } },
  { header: 'Total', key: 'montoTotal', width: 14, style: { numFmt: '#,##0' } },
]

function llenarHoja(hoja, docs) {
  hoja.columns = COLUMNAS_HOJA
  hoja.getRow(1).font = { bold: true }
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }
  for (const d of docs) {
    hoja.addRow({ ...d, tipoDocNombre: nombreTipoDoc(d.tipoDoc) })
  }
  if (docs.length > 0) {
    const filaTotal = hoja.addRow({
      mes_nombre: 'TOTAL',
      montoExento: docs.reduce((s, d) => s + (d.montoExento || 0), 0),
      montoNeto: docs.reduce((s, d) => s + (d.montoNeto || 0), 0),
      montoIVA: docs.reduce((s, d) => s + (d.montoIVA || 0), 0),
      montoTotal: docs.reduce((s, d) => s + (d.montoTotal || 0), 0),
    })
    filaTotal.font = { bold: true }
  }
}

async function construirWorkbookCliente(cliente, periodos) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'IVA Mensual'
  wb.created = new Date()

  const todasVentas = []
  const todasCompras = []

  for (const p of periodos) {
    const ventasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'ventas', p.periodo)
    const comprasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'compras', p.periodo)
    const tag = (docs) => docs.map((d) => ({ ...d, mes_nombre: `${nombreMes(p.mes)} ${p.anio}` }))
    todasVentas.push(...tag(ventasDocs))
    todasCompras.push(...tag(comprasDocs))
  }

  llenarHoja(wb.addWorksheet('Ventas'), todasVentas)
  llenarHoja(wb.addWorksheet('Compras'), todasCompras)

  return wb
}

function nombreArchivoCliente(cliente) {
  const base = `${cliente.rut}_${cliente.nombre}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return `${base}.xlsx`
}

async function ejecutarExportacion(exportId, userId, rango) {
  const estado = exportaciones.get(exportId)
  if (!estado) return

  const clientes = db
    .prepare(`SELECT id, rut, nombre, clave_sii FROM clientes WHERE activo = 1 AND user_id = ? ORDER BY nombre`)
    .all(userId)

  estado.total = clientes.length
  const periodos = generarPeriodos(rango.anioInicio, rango.anioFin, rango.mesInicio, rango.mesFin)

  const zipPath = path.join(EXPORTS_DIR, `${exportId}.zip`)
  const output = fs.createWriteStream(zipPath)
  const archive = archiver('zip', { zlib: { level: 9 } })
  const zipListo = new Promise((resolve, reject) => {
    output.on('close', resolve)
    archive.on('error', reject)
  })
  archive.pipe(output)

  for (let i = 0; i < clientes.length; i++) {
    const cliente = clientes[i]
    estado.procesando = cliente.nombre
    try {
      const wb = await construirWorkbookCliente(cliente, periodos)
      const buffer = await wb.xlsx.writeBuffer()
      archive.append(Buffer.from(buffer), { name: nombreArchivoCliente(cliente) })
    } catch (err) {
      estado.errores.push({ cliente: cliente.nombre, error: err.message })
    }
    estado.procesados = i + 1
  }

  await archive.finalize()
  await zipListo

  estado.estado = 'completado'
  estado.procesando = null
  estado.zipPath = zipPath
}

function iniciarExportacion(userId, rango) {
  const exportId = crearExportacionId()
  exportaciones.set(exportId, {
    id: exportId,
    userId,
    estado: 'procesando',
    total: 0,
    procesados: 0,
    procesando: null,
    errores: [],
    zipPath: null,
  })

  ejecutarExportacion(exportId, userId, rango).catch((err) => {
    const e = exportaciones.get(exportId)
    if (e) {
      e.estado = 'error'
      e.error_msg = err.message
    }
  })

  return { exportId }
}

function obtenerEstado(exportId, userId) {
  const e = exportaciones.get(exportId)
  if (!e || e.userId !== userId) return null
  return {
    id: e.id,
    estado: e.estado,
    total: e.total,
    procesados: e.procesados,
    procesando: e.procesando,
    errores: e.errores,
    error_msg: e.error_msg,
  }
}

function obtenerArchivo(exportId, userId) {
  const e = exportaciones.get(exportId)
  if (!e || e.userId !== userId || e.estado !== 'completado') return null
  return e.zipPath
}

module.exports = { iniciarExportacion, obtenerEstado, obtenerArchivo }
