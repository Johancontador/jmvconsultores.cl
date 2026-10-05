/**
 * Tests de analítica tributaria (core/analitica.js): resumen anual, top
 * clientes/proveedores, comparativo vs año anterior y alertas de calidad
 * (duplicados + RUT inválidos). BD temporal por proceso (DB_PATH en tmpdir).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'analitica-')), 'test.db')
const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const asientos = require('../backend/core/asientos')
const { analitica, dvM11, parseRutCrudo, alertasCalidad } = require('../backend/core/analitica')

// ---------- helpers de sembrado ----------

function rutAleatorio() {
  const cuerpo = String(Math.floor(Math.random() * 8e6) + 1e6) // 7 dígitos
  return `${cuerpo}-${dvM11(cuerpo)}`
}

function empresaTest(nombre) {
  const emp = empresas.crear(db, {
    usuarioId: 1, rut: rutAleatorio(),
    nombre, claveSii: 'clave-test', tasaPpm: 0.01,
  })
  const id = typeof emp === 'object' ? emp.id : emp
  // empresas.crear ya asigna el rol del usuario ejecutor en usuario_empresa.
  return id
}

let seq = 0
function documento(empresaId, { periodo, flujo, tipo = 33, folio, rut, razon, neto, iva, total, estado = 'CONTABILIZADO' }) {
  seq++
  const cols = db.prepare(`PRAGMA table_info(documentos)`).all().map((c) => c.name)
  const fila = {
    empresa_id: empresaId,
    periodo_ingesta: periodo,
    tipo_flujo: flujo,
    tipo_doc: tipo,
    folio: String(folio),
    fecha_docto: `${periodo.slice(0, 4)}-${periodo.slice(4)}-15`,
    rut_contraparte: rut,
    razon_social: razon,
    monto_neto: neto,
    monto_iva: iva,
    monto_total: total,
    monto_exento: 0,
    estado,
    clave_dedupe: `t${seq}-${folio}-${rut}`,
    origen: 'rcv',
  }
  const presentes = Object.fromEntries(Object.entries(fila).filter(([k]) => cols.includes(k)))
  const keys = Object.keys(presentes)
  db.prepare(`INSERT INTO documentos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => presentes[k]))
}

// ---------- unidades puras ----------

test('dvM11: dígito verificador correcto', () => {
  assert.equal(dvM11('77255326'), '9')   // 77255326-9
  assert.equal(dvM11('76312274'), '3')   // 76312274-3
  assert.equal(dvM11('1'), '9')
})

test('parseRutCrudo: normaliza y rechaza formatos inválidos', () => {
  assert.deepEqual(parseRutCrudo('77.255.326-9'), { cuerpo: '77255326', dv: '9' })
  assert.deepEqual(parseRutCrudo('77907448K'), { cuerpo: '77907448', dv: 'K' })
  assert.equal(parseRutCrudo('sin-rut'), null)
  assert.equal(parseRutCrudo(''), null)
})

test('parseRutCrudo + dvM11: el RUT propio calza', () => {
  const p = parseRutCrudo('77255326-9')
  assert.equal(dvM11(p.cuerpo), p.dv)
})

// ---------- analítica con datos ----------

test('analitica: resumen mensual, anual y top contrapartes', () => {
  const id = empresaTest('ANALITICA UNO SPA')

  documento(id, { periodo: '202601', flujo: 'venta', folio: 101, rut: '76123456-8', razon: 'CLIENTE ALFA', neto: 100000, iva: 19000, total: 119000 })
  documento(id, { periodo: '202601', flujo: 'compra', folio: 201, rut: '76555555-5', razon: 'PROVEEDOR BETA', neto: 50000, iva: 9500, total: 59500 })
  documento(id, { periodo: '202602', flujo: 'venta', folio: 102, rut: '76123456-8', razon: 'CLIENTE ALFA', neto: 200000, iva: 38000, total: 238000 })
  documento(id, { periodo: '202602', flujo: 'venta', folio: 103, rut: '76999999-9', razon: 'CLIENTE GAMMA', neto: 80000, iva: 15200, total: 95200 })
  documento(id, { periodo: '202602', flujo: 'compra', folio: 202, rut: '76555555-5', razon: 'PROVEEDOR BETA', neto: 30000, iva: 5700, total: 35700 })

  const a = analitica(db, { empresaId: id, periodo: '202602' })
  assert.equal(a.anio, '2026')

  // Resumen mensual
  const ene = a.meses.find((m) => m.mes === 1)
  const feb = a.meses.find((m) => m.mes === 2)
  assert.equal(ene.ventas, 119000)
  assert.equal(ene.compras, 59500)
  assert.equal(ene.iva_determinado, 19000 - 9500)
  assert.equal(feb.ventas, 238000 + 95200)
  assert.equal(feb.docs_venta, 2)

  // Anual acumulado
  assert.equal(a.anual.ventas, 119000 + 238000 + 95200)
  assert.equal(a.anual.compras, 59500 + 35700)
  assert.equal(a.anual.iva_determinado, (19000 + 38000 + 15200) - (9500 + 5700))
  assert.equal(a.anual.docs, 5)

  // Top clientes ordenado por total
  assert.equal(a.top_clientes[0].rut, '76123456-8')
  assert.equal(a.top_clientes[0].docs, 2)
  assert.equal(a.top_clientes[0].total, 119000 + 238000)
  assert.equal(a.top_proveedores[0].rut, '76555555-5')

  // Resultado comercial
  assert.equal(a.resumen_ejecutivo.resultado_comercial, a.anual.ventas - a.anual.compras)
})

test('analitica: excluye ANULADO y ERROR de todas las agregaciones', () => {
  const id = empresaTest('ANALITICA DOS SPA')
  documento(id, { periodo: '202603', flujo: 'venta', folio: 301, rut: '76111111-1', razon: 'X', neto: 10000, iva: 1900, total: 11900 })
  documento(id, { periodo: '202603', flujo: 'venta', folio: 302, rut: '76111111-1', razon: 'X', neto: 999999, iva: 0, total: 999999, estado: 'ANULADO' })
  documento(id, { periodo: '202603', flujo: 'venta', folio: 303, rut: '76111111-1', razon: 'X', neto: 888888, iva: 0, total: 888888, estado: 'ERROR' })

  const a = analitica(db, { empresaId: id, periodo: '202603' })
  assert.equal(a.anual.ventas, 11900)
  assert.equal(a.top_clientes[0].total, 11900)
  assert.equal(a.anual.docs, 1)
})

test('analitica: comparativo contra año anterior', () => {
  const id = empresaTest('ANALITICA TRES SPA')
  documento(id, { periodo: '202501', flujo: 'venta', folio: 401, rut: '76222222-2', razon: 'Y', neto: 100000, iva: 19000, total: 119000 })
  documento(id, { periodo: '202601', flujo: 'venta', folio: 402, rut: '76222222-2', razon: 'Y', neto: 150000, iva: 28500, total: 178500 })

  const a = analitica(db, { empresaId: id, periodo: '202601' })
  assert.equal(a.anual.anio_anterior.ventas, 119000)
  assert.equal(a.anual.variacion_ventas_pct, 50) // (178500-119000)/119000 = 50%
})

test('alertasCalidad: detecta folios duplicados por contraparte+tipo', () => {
  const id = empresaTest('ANALITICA CUATRO SPA')
  documento(id, { periodo: '202604', flujo: 'compra', folio: 501, rut: '76333333-3', razon: 'PROV DUP', neto: 1000, iva: 190, total: 1190 })
  documento(id, { periodo: '202604', flujo: 'compra', folio: 501, rut: '76333333-3', razon: 'PROV DUP', neto: 1000, iva: 190, total: 1190 })
  documento(id, { periodo: '202604', flujo: 'compra', folio: 502, rut: '76333333-3', razon: 'PROV DUP', neto: 1000, iva: 190, total: 1190 })

  const cal = alertasCalidad(db, id, '202601', '202612')
  assert.equal(cal.duplicados.length, 1)
  assert.equal(cal.duplicados[0].folio, '501')
  assert.equal(cal.duplicados[0].n, 2)
})

test('alertasCalidad: detecta RUTs con DV inválido (M11)', () => {
  const id = empresaTest('ANALITICA CINCO SPA')
  documento(id, { periodo: '202605', flujo: 'venta', folio: 601, rut: '77255326-9', razon: 'RUT OK', neto: 1000, iva: 0, total: 1000 })
  documento(id, { periodo: '202605', flujo: 'venta', folio: 602, rut: '77255326-0', razon: 'RUT MALO', neto: 1000, iva: 0, total: 1000 })
  documento(id, { periodo: '202605', flujo: 'venta', folio: 603, rut: 'SINRUT123', razon: 'RUT RARO', neto: 1000, iva: 0, total: 1000 })

  const cal = alertasCalidad(db, id, '202601', '202612')
  const malos = cal.ruts_invalidos.map((r) => r.rut)
  assert.ok(malos.includes('77255326-0'))
  assert.ok(malos.includes('SINRUT123'))
  assert.ok(!malos.includes('77255326-9'))
})

test('alertasCalidad: los anulados no generan alerta de duplicado', () => {
  const id = empresaTest('ANALITICA SEIS SPA')
  documento(id, { periodo: '202606', flujo: 'compra', folio: 701, rut: '76444444-4', razon: 'Z', neto: 1000, iva: 190, total: 1190 })
  documento(id, { periodo: '202606', flujo: 'compra', folio: 701, rut: '76444444-4', razon: 'Z', neto: 1000, iva: 190, total: 1190, estado: 'ANULADO' })
  const cal = alertasCalidad(db, id, '202601', '202612')
  assert.equal(cal.duplicados.length, 0)
})

test('analitica: aislamiento por empresa', () => {
  const a1 = empresaTest('ANALITICA SIETE A')
  const b1 = empresaTest('ANALITICA SIETE B')
  documento(a1, { periodo: '202607', flujo: 'venta', folio: 801, rut: '76555555-5', razon: 'SOY A', neto: 1000, iva: 0, total: 1000 })
  documento(b1, { periodo: '202607', flujo: 'venta', folio: 802, rut: '76666666-6', razon: 'SOY B', neto: 2000, iva: 0, total: 2000 })

  const a = analitica(db, { empresaId: a1, periodo: '202607' })
  assert.equal(a.anual.ventas, 1000)
  assert.equal(a.top_clientes.length, 1)
})

test('analitica: empresa sin documentos → ceros sin romper', () => {
  const id = empresaTest('ANALITICA OCHO VACIA')
  const a = analitica(db, { empresaId: id, periodo: '202601' })
  assert.equal(a.anual.ventas, 0)
  assert.equal(a.anual.docs, 0)
  assert.equal(a.top_clientes.length, 0)
  assert.equal(a.calidad.duplicados.length, 0)
})

test('analitica: empresa inexistente lanza', () => {
  assert.throws(() => analitica(db, { empresaId: 999999 }), /Empresa no encontrada/)
})

// El módulo asientos queda importado por compatibilidad con el esquema (no muta).
void asientos
