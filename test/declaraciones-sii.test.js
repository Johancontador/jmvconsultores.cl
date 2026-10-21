'use strict'
/**
 * DECLARACIONES SII — tests de los parsers (sin red).
 *
 * Lo que se prueba:
 *  T1  Tooltip de la Consulta Integral → estado (declarada / no presentada).
 *  T2  Estado de la búsqueda de formularios («Vigente», «Rectificada»…).
 *  T3  Montos y fechas del SII en formato chileno.
 *  T4  Tabla del informe anual de boletas: 12 meses + totales.
 *
 * Los valores de los tooltips y de las columnas están copiados de respuestas
 * reales del SII (21-10-2026), no inventados.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-decl-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const decl = require('../backend/core/declaraciones-sii')
const db = require('../backend/db')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

test('T1: tooltip de la matriz F29 → estado', () => {
  assert.equal(decl.estadoDesdeTooltip('Declaración sin observaciones.'), 'declarada')
  assert.equal(decl.estadoDesdeTooltip('Periodo sin declaración, haz clic para ingresar al formulario.'), 'no_presentada')
  assert.equal(decl.estadoDesdeTooltip('Declaración con observaciones.'), 'declarada')
  assert.equal(decl.estadoDesdeTooltip('Declaración rectificada vigente'), 'rectificada')
  assert.equal(decl.estadoDesdeTooltip('texto desconocido'), 'sin_informacion')
  assert.equal(decl.estadoDesdeTooltip(''), null)
})

test('T2: estado de la búsqueda de formularios', () => {
  assert.equal(decl.estadoDesdeBusqueda('Vigente'), 'declarada')
  assert.equal(decl.estadoDesdeBusqueda('Rectificada'), 'rectificada')
  assert.equal(decl.estadoDesdeBusqueda('Anulada'), 'no_presentada')
  assert.equal(decl.estadoDesdeBusqueda('Pendiente'), 'no_presentada')
  assert.equal(decl.estadoDesdeBusqueda('—'), 'sin_informacion')
})

test('T3: montos y fechas en formato SII', () => {
  assert.equal(decl.normalizarMonto('$1,027,539'), 1027539)
  assert.equal(decl.normalizarMonto('$ 29.583'), 29583)
  assert.equal(decl.normalizarMonto('0'), 0)
  assert.equal(decl.normalizarMonto(''), null)
  assert.equal(decl.normalizarFecha('19/02/2025'), '2025-02-19')
  assert.equal(decl.normalizarFecha('8/3/2021'), '2021-03-08')
  assert.equal(decl.normalizarFecha('sin fecha'), null)
})

test('T4: informe anual de boletas — 12 meses y totales', () => {
  const filas = [
    ['ENERO', '1', '3', '3', '0', '1.000.000', '100.000', '50.000', '850.000'],
    ['FEBRERO', '4', '4', '1', '0', '200.000', '20.000', '10.000', '170.000'],
    ['TOTALES:', '3', '0', '1.200.000', '120.000', '60.000', '1.020.000'],
  ]
  const r = decl.parsearTablaBhe(filas)
  const enero = r.find((f) => f.mes === '01')
  assert.equal(enero.folio_inicial, '1')
  assert.equal(enero.folio_final, '3')
  assert.equal(enero.vigentes, 3)
  assert.equal(enero.honorario_bruto, 1000000)
  assert.equal(enero.retencion_terceros, 100000)
  assert.equal(enero.retencion_contribuyente, 50000)
  assert.equal(enero.total_liquido, 850000)
  const tot = r.find((f) => f.totales)
  assert.equal(tot.honorario_bruto, 1200000)
  assert.equal(tot.total_liquido, 1020000)
})

// T5: el despliegue en Docker instala chromium y puppeteer-core como
// dependencia de producción. Si falta cualquiera de los dos, la sincronización
// de declaraciones tiene que decirlo con SII_SIN_NAVEGADOR (no con un 500 y
// menos aún abriendo una sesión en el SII que después nadie cierra).
test('T5: disponibilidad del navegador headless', () => {
  const sinNada = decl.navegadorDisponible(['/ruta/que/no/existe'])
  assert.equal(sinNada.disponible, false)
  assert.equal(sinNada.ruta, null)
  assert.match(sinNada.motivo, /CHROME_PATH/)

  const conBinario = decl.navegadorDisponible([process.execPath])
  assert.equal(conBinario.disponible, true)
  assert.equal(conBinario.ruta, process.execPath)
  assert.equal(conBinario.motivo, null)
})

test('T6: puppeteer-core es dependencia de producción y el Dockerfile instala chromium', () => {
  const pkg = require('../package.json')
  assert.ok(pkg.dependencies['puppeteer-core'], 'puppeteer-core debe estar en dependencies (npm ci --omit=dev)')
  assert.ok(!(pkg.devDependencies || {})['puppeteer-core'], 'puppeteer-core no debe quedar solo en devDependencies')
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8')
  assert.match(dockerfile, /apt-get install[^\n]*chromium/)
  assert.match(dockerfile, /CHROME_PATH=\/usr\/bin\/chromium/)
})
