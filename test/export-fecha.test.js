/**
 * Verifica que la fecha de cada documento (fechaDocto) sale en CSV / Excel / PDF
 * de todos los reportes que exportan. No toca el SII.
 *
 *   node --test test/export-fecha.test.js
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadFrontend() {
  const sandbox = {
    console,
    window: {},
    document: {
      createElement() {
        const el = { _t: '' }
        Object.defineProperty(el, 'textContent', {
          set(v) { el._t = v == null ? '' : String(v) },
          get() { return el._t },
        })
        Object.defineProperty(el, 'innerHTML', {
          get() {
            return el._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          },
        })
        return el
      },
      body: { appendChild() {}, removeChild() {} },
    },
    Blob: class { constructor(parts) { this.parts = parts } },
    URL: { createObjectURL() { return 'blob:x' }, revokeObjectURL() {} },
  }
  sandbox.window = sandbox
  const ctx = vm.createContext(sandbox)
  const root = path.join(__dirname, '..', 'frontend')
  vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'format.js'), 'utf8'), ctx)
  vm.runInContext(fs.readFileSync(path.join(root, 'shared', 'export.js'), 'utf8'), ctx)
  return ctx
}

const DOC = {
  libro: 'Ventas',
  periodo: '202401',
  folio: '1001',
  tipoDoc: 33,
  fechaDocto: '15/01/2024',
  rutDoc: '76123456-7',
  razonSocial: 'Cliente A',
  montoExento: 0,
  montoNeto: 100000,
  montoIVA: 19000,
  montoTotal: 119000,
  fechaReclamo: '',
}

test('columnasDocumento siempre incluye la columna Fecha (fechaDocto)', () => {
  const ctx = loadFrontend()
  const cols = ctx.columnasDocumento({ conLibro: true, conPeriodo: true, conReclamo: true })
  const fecha = cols.find((c) => c.key === 'fechaDocto')
  assert.ok(fecha, 'falta key fechaDocto')
  assert.equal(fecha.label, 'Fecha')
  const { headers, rows } = ctx._filasParaExport(cols, [DOC])
  assert.ok(headers.includes('Fecha'), `headers=${headers.join(',')}`)
  assert.equal(rows[0][headers.indexOf('Fecha')], '15/01/2024')
})

test('export de reporte agregado anexa hoja/tabla Documentos con fecha', () => {
  const ctx = loadFrontend()
  const secciones = ctx.seccionesParaExport({
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'iva_pagar', label: 'IVA a Pagar' },
    ],
    filas: [{ mes_label: 'Enero 2024', iva_pagar: 50000 }],
    titulo: 'IVA Mensual',
    data: { documentos_ventas: [DOC], documentos_compras: [] },
    esDetalleDocumentos: false,
  })
  assert.equal(secciones.length, 2)
  assert.equal(secciones[0].titulo, 'IVA Mensual')
  const docs = secciones[1]
  assert.equal(docs.titulo, 'Documentos')
  const fecha = docs.columnas.find((c) => c.key === 'fechaDocto')
  assert.ok(fecha, 'la sección Documentos no tiene fechaDocto')
  const { headers, rows } = ctx._filasParaExport(docs.columnas, docs.filas)
  assert.ok(headers.includes('Fecha'))
  assert.equal(rows[0][headers.indexOf('Fecha')], '15/01/2024')
})

test('Libro Compra/Venta (detalle) exporta Fecha en la tabla principal CSV/Excel/PDF', () => {
  const ctx = loadFrontend()
  const columnas = ctx.columnasDocumento({ conPeriodo: true, conReclamo: true })
  const secciones = ctx.seccionesParaExport({
    columnas,
    filas: [DOC],
    titulo: 'Libro Venta',
    data: { documentos_ventas: [DOC], documentos_compras: [] },
    esDetalleDocumentos: true,
  })
  assert.equal(secciones.length, 1, 'el libro no debe duplicar la hoja Documentos')
  const { headers, rows } = ctx._filasParaExport(secciones[0].columnas, secciones[0].filas)
  assert.ok(headers.includes('Fecha'))
  assert.equal(rows[0][headers.indexOf('Fecha')], '15/01/2024')
})

test('todos los reportes del catálogo exportan vía secciones con Fecha de documento', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'reportes.js'), 'utf8')
  assert.match(src, /exportarConDocumentos\(formato, exportActual\)/)
  assert.match(src, /registrarExport\(/)
  assert.match(src, /columnasDocumento\(\{ conPeriodo: true/)

  const tiposInforme = [
    'iva-mensual', 'iva-anual', 'estado-iva', 'ventas-mes', 'ventas-anio',
    'compras-mes', 'compras-anio', 'comparativo-mensual', 'comparativo-anual',
    'tendencias', 'variaciones', 'ranking-mensual', 'ranking-anual',
    'resumen-tributario', 'top-clientes', 'top-proveedores', 'kpis', 'alertas',
    'libro-compras-rango', 'libro-ventas-rango',
    'desglose-gestion-compras', 'desglose-gestion-ventas', 'informe-gestion',
  ]
  for (const tipo of tiposInforme) {
    assert.match(src, new RegExp(`'${tipo}':`), `falta el tipo ${tipo} en CATALOGO`)
  }
  assert.match(src, /esDetalleDocumentos: true/)
  assert.match(src, /esDetalleDocumentos: false/)
  assert.match(src, /Documentos \(con fecha\)/)
})

test('libro mensual y reporte masivo también incluyen Fecha', () => {
  const libro = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'libro.js'), 'utf8')
  assert.match(libro, /columnasDocumento\(\{ conPeriodo: false/)
  assert.match(libro, /descargarDetalleExcel/)
  assert.match(libro, /descargarDetallePDF/)

  const masivo = fs.readFileSync(path.join(__dirname, '..', 'backend', 'services', 'exportacion-masiva.js'), 'utf8')
  assert.match(masivo, /header: 'Fecha',\s*key: 'fechaDocto'/)
})
