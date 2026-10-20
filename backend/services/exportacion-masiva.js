const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const { ZipArchive } = require('archiver')

const db = require('../db')
const { consultarRCV } = require('./rcv')
const { generarPeriodos, nombreMes } = require('./calculos')
const { descifrar } = require('../core/boveda')
const jobsMemoria = require('../core/jobs-memoria')

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

const TIPOS_NOTA_CREDITO = new Set([60, 61])

// El SII no entrega siempre las mismas columnas de "monto" — varía por
// cliente/rubro (IVA No Recuperable, Activo Fijo, Uso Común, Tabacos, Otro
// Impuesto, etc.). Estas ya se muestran aparte con su propio campo
// normalizado; el resto se agrega como columnas dinámicas, con el mismo
// criterio que el Libro Compra/Venta de la SPA (frontend/sistema/views-fiscal.js).
const _MONTOS_YA_CUBIERTOS = /exento|^monto\s*neto$|^monto\s*total$|^monto\s*iva$|^monto\s*iva\s*recuperable$/i

function columnasMontosGestion(docs) {
  const vistos = new Map()
  docs.forEach((d) => {
    Object.keys(d.montos || {}).forEach((k) => {
      if (_MONTOS_YA_CUBIERTOS.test(k)) return
      if (!vistos.has(k)) vistos.set(k, `mg__${vistos.size}`)
    })
  })
  return [...vistos.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, key]) => ({ header: label, key, width: 16, style: { numFmt: '#,##0' } }))
}

// Nota de Crédito corrige (resta) un documento anterior — igual que en
// sumarDocumentos()/conSignoNC() del resto de la app, se refleja en negativo
// para que sumar la columna en Excel ya dé el neto real.
function conSigno(doc, columnasGestion) {
  const signo = TIPOS_NOTA_CREDITO.has(Number(doc.tipoDoc)) ? -1 : 1
  const plano = { ...doc, tipoDocNombre: nombreTipoDoc(doc.tipoDoc) }
  plano.montoExento = signo * (doc.montoExento || 0)
  plano.montoNeto = signo * (doc.montoNeto || 0)
  plano.montoIVA = signo * (doc.montoIVA || 0)
  plano.montoTotal = signo * (doc.montoTotal || 0)
  for (const col of columnasGestion) {
    plano[col.key] = signo * ((doc.montos || {})[col.header] || 0)
  }
  return plano
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
  const columnasGestion = columnasMontosGestion(docs)
  const columnas = [...COLUMNAS_HOJA, ...columnasGestion]
  hoja.columns = columnas
  hoja.getRow(1).font = { bold: true }
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }

  const filas = docs.map((d) => conSigno(d, columnasGestion))
  for (const f of filas) hoja.addRow(f)

  if (filas.length > 0) {
    const totalRow = { mes_nombre: 'TOTAL' }
    for (const col of columnas) {
      if (col.key === 'mes_nombre') continue
      if (!col.style) continue // solo suma columnas numéricas (montos)
      totalRow[col.key] = filas.reduce((s, f) => s + (f[col.key] || 0), 0)
    }
    const filaTotal = hoja.addRow(totalRow)
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
    // BLOQUE 1 (seguridad): la clave SII se descifra al vuelo — acepta plaintext
    // legacy y valores v1: de la bóveda. Nunca se loggea ni se expone por API.
    const claveReal = descifrar(cliente.clave_sii)
    const ventasDocs = await consultarRCV(cliente.rut, claveReal, 'ventas', p.periodo)
    const comprasDocs = await consultarRCV(cliente.rut, claveReal, 'compras', p.periodo)
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
  const archive = new ZipArchive({ zlib: { level: 9 } })
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
  jobsMemoria.registrar(exportaciones, exportId, {
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
  jobsMemoria.purgar(exportaciones)
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
