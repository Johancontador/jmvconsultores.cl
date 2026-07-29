/**
 * Tests unitarios para backend/services/calculos.js
 * Ejecutar con: node --test test/calculos.test.js
 */
const {
  sumarDocumentos,
  agruparPorContraparte,
  combinarContrapartes,
  categorizarVentas,
  categorizarCompras,
  calcularMargen,
  calcularIVA,
  calcularPPM,
  calcularTotalF29,
  fmt,
  nombreMes,
  periodoDesde,
  generarPeriodos,
  MESES,
  TIPOS_FACTURA,
  TIPO_NOTA_DEBITO,
  TIPO_NOTA_CREDITO,
  TIPOS_NOTA_CREDITO,
} = require('../backend/services/calculos')

// Datos de prueba simulando respuesta del SII
const docsVentas = [
  { folio: '1001', tipoDoc: 33, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000, montoExento: 0, rutDoc: '76123456-7', razonSocial: 'Cliente A', fechaDocto: '2024-01-15', fechaReclamo: '' },
  { folio: '1002', tipoDoc: 34, montoNeto: 50000, montoIVA: 0, montoTotal: 50000, montoExento: 50000, rutDoc: '76123456-7', razonSocial: 'Cliente A', fechaDocto: '2024-01-16', fechaReclamo: '' },
  { folio: '1003', tipoDoc: 61, montoNeto: 20000, montoIVA: 3800, montoTotal: 23800, montoExento: 0, rutDoc: '76123456-7', razonSocial: 'Cliente A', fechaDocto: '2024-01-17', fechaReclamo: '' }, // NC electrónica
  { folio: '1004', tipoDoc: 60, montoNeto: 10000, montoIVA: 1900, montoTotal: 11900, montoExento: 0, rutDoc: '76555555-5', razonSocial: 'Cliente B', fechaDocto: '2024-01-18', fechaReclamo: '' }, // NC manual
  { folio: '1005', tipoDoc: 39, montoNeto: 8000, montoIVA: 1520, montoTotal: 9520, montoExento: 0, rutDoc: '76999999-9', razonSocial: 'Cliente C', fechaDocto: '2024-01-19', fechaReclamo: '2024-02-01' }, // Boleta electrónica con reclamo
  { folio: '1006', tipoDoc: 56, montoNeto: 5000, montoIVA: 950, montoTotal: 5950, montoExento: 0, rutDoc: '76123456-7', razonSocial: 'Cliente A', fechaDocto: '2024-01-20', fechaReclamo: '' }, // Nota de débito
]

const docsCompras = [
  { folio: '2001', tipoDoc: 46, montoNeto: 80000, montoIVA: 15200, montoTotal: 95200, montoExento: 0, rutDoc: '76111111-1', razonSocial: 'Proveedor X', fechaDocto: '2024-01-10' },
  { folio: '2002', tipoDoc: 61, montoNeto: 15000, montoIVA: 2850, montoTotal: 17850, montoExento: 0, rutDoc: '76111111-1', razonSocial: 'Proveedor X', fechaDocto: '2024-01-11' }, // NC
  { folio: '2003', tipoDoc: 33, montoNeto: 30000, montoIVA: 5700, montoTotal: 35700, montoExento: 0, rutDoc: '76222222-2', razonSocial: 'Proveedor Y', fechaDocto: '2024-01-12' },
]

// ============ Tests ============

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: esperado ${expected}, obtuvo ${actual}`)
  }
}

function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(`${msg}: \nesperado ${e}\nobtuvo ${a}`)
  }
}

function assertAlmostEqual(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${msg}: esperado ~${expected}, obtuvo ${actual}`)
  }
}

// Test suite
console.log('=== TESTS calculos.js ===\n')

// sumarDocumentos
{
  const res = sumarDocumentos(docsVentas)
  // 100000 + 50000 + 8000 + 5000 - 20000 - 10000 = 133000
  assertEqual(res.neto, 133000, 'sumarDocumentos ventas neto (con NC restando)')
  // 19000 + 0 - 3800 - 1900 + 1520 + 950 = 15770
  assertEqual(res.iva, 15770, 'sumarDocumentos ventas iva')
  // 119000 + 50000 + 9520 + 5950 - 23800 - 11900 = 148770
  assertEqual(res.total, 148770, 'sumarDocumentos ventas total')
  console.log('✓ sumarDocumentos (ventas con NC)')
}

{
  const res = sumarDocumentos(docsCompras)
  // 80000 + 30000 - 15000 = 95000
  assertEqual(res.neto, 95000, 'sumarDocumentos compras neto (con NC restando)')
  assertEqual(res.iva, 18050, 'sumarDocumentos compras iva')
  assertEqual(res.total, 113050, 'sumarDocumentos compras total')
  console.log('✓ sumarDocumentos (compras con NC)')
}

{
  const res = sumarDocumentos([])
  assertEqual(res.neto, 0, 'sumarDocumentos array vacío')
  assertEqual(res.iva, 0, 'sumarDocumentos array vacío iva')
  assertEqual(res.total, 0, 'sumarDocumentos array vacío total')
  console.log('✓ sumarDocumentos (array vacío)')
}

{
  const res = sumarDocumentos(null)
  assertEqual(res.neto, 0, 'sumarDocumentos null')
  console.log('✓ sumarDocumentos (null)')
}

// categorizarVentas
{
  const res = categorizarVentas(docsVentas)
  // facturas: 33(100000) + 34(50000) + 39(8000) = 158000
  assertEqual(res.facturas, 158000, 'categorizarVentas facturas (33,34,39)')
  assertEqual(res.notas_debito, 5000, 'categorizarVentas notas_debito (56)')
  assertEqual(res.notas_credito, 20000 + 10000, 'categorizarVentas notas_credito (60,61)')
  assertEqual(res.otros, 0, 'categorizarVentas otros')
  console.log('✓ categorizarVentas')
}

// categorizarCompras
{
  const res = categorizarCompras(docsCompras)
  assertEqual(res.facturas, 80000 + 30000, 'categorizarCompras facturas (46,33)')
  assertEqual(res.notas_credito, 15000, 'categorizarCompras notas_credito (61)')
  assertEqual(res.otros, 0, 'categorizarCompras otros')
  console.log('✓ categorizarCompras')
}

// agruparPorContraparte
{
  const res = agruparPorContraparte(docsVentas)
  assertEqual(res.length, 3, 'agruparPorContraparte 3 contrapartes únicas')
  const clienteA = res.find(c => c.rut === '76123456-7')
  // Cliente A: 100000(fact 33) + 50000(fact 34) + 8000(fact 39) + 5000(ND 56) - 20000(NC 61) = 135000
  assertEqual(clienteA.neto, 135000, 'agruparPorContraparte Cliente A neto (con NC y ND)')
  assertEqual(clienteA.cantidad, 4, 'agruparPorContraparte Cliente A cantidad docs')
  console.log('✓ agruparPorContraparte')
}

// combinarContrapartes
{
  const r1 = agruparPorContraparte(docsVentas.slice(0, 3))
  const r2 = agruparPorContraparte(docsVentas.slice(3))
  const combined = combinarContrapartes([r1, r2])
  assertEqual(combined.length, 3, 'combinarContrapartes 3 contrapartes')
  const clienteA = combined.find(c => c.rut === '76123456-7')
  // r1: docs 0,1,2 -> Cliente A: 100000+50000-20000=130000
  // r2: docs 3,4,5 -> Cliente A: 5000(ND)
  // Total: 135000
  assertEqual(clienteA.neto, 135000, 'combinarContrapartes Cliente A neto combinado')
  console.log('✓ combinarContrapartes')
}

// calcularMargen
{
  const { margen, pct } = calcularMargen(100000, 60000)
  assertEqual(margen, 40000, 'calcularMargen margen')
  assertEqual(pct, 40.0, 'calcularMargen pct')
  console.log('✓ calcularMargen')
}

{
  const { margen, pct } = calcularMargen(100000, 120000)
  assertEqual(margen, -20000, 'calcularMargen margen negativo')
  assertEqual(pct, -20.0, 'calcularMargen pct negativo')
  console.log('✓ calcularMargen (negativo)')
}

{
  const { margen, pct } = calcularMargen(0, 50000)
  assertEqual(margen, -50000, 'calcularMargen ventas cero')
  assertEqual(pct, 0, 'calcularMargen pct cero cuando ventas=0')
  console.log('✓ calcularMargen (ventas=0)')
}

// calcularIVA
{
  const iva = calcularIVA(19000, 15200)
  assertEqual(iva, 3800, 'calcularIVA')
  console.log('✓ calcularIVA')
}

// calcularPPM
{
  const ppm = calcularPPM(100000, 0.015)
  assertEqual(ppm, 1500, 'calcularPPM')
  console.log('✓ calcularPPM')
}

// calcularTotalF29
{
  const total1 = calcularTotalF29(3800, 1500) // iva_pagar > 0
  assertEqual(total1, 5300, 'calcularTotalF29 iva_pagar > 0')
  const total2 = calcularTotalF29(-500, 1500) // iva_pagar < 0 => solo PPM
  assertEqual(total2, 1500, 'calcularTotalF29 iva_pagar < 0')
  console.log('✓ calcularTotalF29')
}

// fmt
{
  assertEqual(fmt(1234567), '$1.234.567', 'fmt miles')
  assertEqual(fmt(1234), '$1.234', 'fmt miles simple')
  assertEqual(fmt(0), '$0', 'fmt cero')
  assertEqual(fmt(-5000), '$-5.000', 'fmt negativo')
  assertEqual(fmt(null), '$0', 'fmt null')
  assertEqual(fmt(undefined), '$0', 'fmt undefined')
  console.log('✓ fmt')
}

// nombreMes
{
  assertEqual(nombreMes(1), 'Enero', 'nombreMes 1')
  assertEqual(nombreMes(12), 'Diciembre', 'nombreMes 12')
  assertEqual(nombreMes(0), '', 'nombreMes 0')
  assertEqual(nombreMes(13), '', 'nombreMes 13')
  console.log('✓ nombreMes')
}

// periodoDesde
{
  assertEqual(periodoDesde(2024, 1), '202401', 'periodoDesde enero')
  assertEqual(periodoDesde(2024, 12), '202412', 'periodoDesde diciembre')
  assertEqual(periodoDesde(2024, 9), '202409', 'periodoDesde con zero-pad')
  console.log('✓ periodoDesde')
}

// generarPeriodos
{
  const p = generarPeriodos(2024, 2024, 3, 5)
  assertEqual(p.length, 3, 'generarPeriodos 3 meses')
  assertEqual(p[0].periodo, '202403', 'generarPeriodos primer mes')
  assertEqual(p[2].periodo, '202405', 'generarPeriodos último mes')
  console.log('✓ generarPeriodos (rango mes)')
}

{
  const p = generarPeriodos(2023, 2024)
  assertEqual(p.length, 24, 'generarPeriodos 2 años completos')
  assertEqual(p[0].periodo, '202301', 'generarPeriodos primer mes 2023')
  assertEqual(p[23].periodo, '202412', 'generarPeriodos último mes 2024')
  console.log('✓ generarPeriodos (años completos)')
}

{
  // No debe incluir meses futuros
  const now = new Date()
  const anioActual = now.getFullYear()
  const mesActual = now.getMonth() + 1
  const p = generarPeriodos(anioActual, anioActual)
  const ultimo = p[p.length - 1]
  assertEqual(ultimo.anio, anioActual, 'generarPeriodos año actual')
  assertEqual(ultimo.mes, mesActual, 'generarPeriodos no pasa mes actual')
  console.log('✓ generarPeriodos (corta mes futuro)')
}

// MESES array
{
  assertEqual(MESES.length, 12, 'MESES length')
  assertEqual(MESES[0], 'Enero', 'MESES[0]')
  assertEqual(MESES[11], 'Diciembre', 'MESES[11]')
  console.log('✓ MESES array')
}

// Constantes de tipos de documento
{
  assertEqual(TIPO_NOTA_CREDITO, 61, 'TIPO_NOTA_CREDITO')
  assertEqual(TIPO_NOTA_DEBITO, 56, 'TIPO_NOTA_DEBITO')
  assertTrue(TIPOS_FACTURA.has(33), 'TIPOS_FACTURA tiene 33')
  assertTrue(TIPOS_FACTURA.has(34), 'TIPOS_FACTURA tiene 34')
  assertTrue(TIPOS_FACTURA.has(39), 'TIPOS_FACTURA tiene 39')
  assertTrue(TIPOS_FACTURA.has(46), 'TIPOS_FACTURA tiene 46')
  assertTrue(TIPOS_NOTA_CREDITO.has(60), 'TIPOS_NOTA_CREDITO tiene 60')
  assertTrue(TIPOS_NOTA_CREDITO.has(61), 'TIPOS_NOTA_CREDITO tiene 61')
  console.log('✓ Constantes tipos documento')
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg)
}

console.log('\n=== TODOS LOS TESTS PASARON ===')