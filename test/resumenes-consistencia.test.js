/**
 * CONSISTENCIA DE TOTALES DE RESUMEN (requisito funcional):
 *   1. Las NC (60/61 — montos POSITIVOS en la bandeja) restan del total en
 *      TODOS los resúmenes: dashboard.kpis, dashboard.serie, analitica
 *      (mes + anual), portal (inicio + resumenDuo) y las sumas del listado
 *      de la bandeja. Una única cifra para todo el sistema.
 *   2. Boletas (39/41) sin contraparte (consumidor final / medios de pago
 *      electrónico) se ingesta, y sus montos SUMAN en los mismos resúmenes.
 *   3. Una FACTURA sin RUT SÍ se rechaza (identidad obligatoria).
 * Convención compartida: SIGNO_NC vive en core/sii-convenios.js.
 * BD temporal por proceso (DB_PATH en tmpdir).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'resumenes-')), 'test.db')
const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const dashboardCore = require('../backend/core/dashboard')
const { analitica } = require('../backend/core/analitica')
const portal = require('../backend/core/portal-metricas')

// ---------- sembrado ----------
/** Rut de la empresa de test: 76543210-3 (DV M11 calculado). */
function dv(cuerpo) {
  let sum = 0, mult = 2
  for (let i = String(cuerpo).length - 1; i >= 0; i--) {
    sum += Number(String(cuerpo)[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const d = 11 - (sum % 11)
  return d === 11 ? 0 : d === 10 ? 'K' : String(d)
}
const RUT_EMPRESA = `76543210-${dv('76543210')}`

const creado = empresas.crear(db, {
  usuarioId: 1, rut: RUT_EMPRESA,
  nombre: 'Empresa Resúmenes', claveSii: 'clave-test', tasaPpm: 0.01,
})
const empId = typeof creado === 'object' ? creado.id : creado

/**
 * Documento de la bandeja con montos como los deja la ingesta: NC positiva.
 */
function seed({ flujo, tipo, folio, rut, razon, neto, iva, total, estado = 'PENDIENTE', periodo = '202610' }) {
  db.prepare(`
    INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
      fecha_docto, monto_neto, monto_iva, monto_total, estado, origen, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sii', ?, ?)
  `).run(
    empId, flujo, tipo, folio, rut, razon, `${periodo.slice(0, 4)}-${periodo.slice(4)}-15`,
    neto, iva, total, estado, periodo,
    `seed|${flujo}|${tipo}|${folio}|${periodo}`
  )
}

// VENTAS: factura 238.000 + boleta sin RUT 53.600 − NC 59.500 → 232.100
seed({ flujo: 'venta', tipo: 33, folio: '101', rut: '76543210-3', razon: 'Cliente Único Limitada', neto: 200000, iva: 38000, total: 238000 })
seed({ flujo: 'venta', tipo: 39, folio: '350001', rut: '', razon: 'Consumidor final', neto: 45000, iva: 8600, total: 53600 })
seed({ flujo: 'venta', tipo: 61, folio: '301', rut: '76543210-3', razon: 'NC devolución Cliente Único', neto: 50000, iva: 9500, total: 59500 })
// COMPRAS: factura 142.800 − NC 23.800 → 119.000
seed({ flujo: 'compra', tipo: 34, folio: '401', rut: '78123456-2', razon: 'Proveedor Principal SA', neto: 120000, iva: 22800, total: 142800 })
seed({ flujo: 'compra', tipo: 61, folio: '402', rut: '78123456-2', razon: 'NC proveedor', neto: 20000, iva: 3800, total: 23800 })

const PER = '202610'
const ESPERADO = {
  ventas: 232100,
  compras: 119000,
  iva_ventas: 37100,
  iva_compras: 19000,
  neto_ventas: 195000,
  neto_compras: 100000,
}

// ---------- 1. dashboard.kpis ----------
test('dashboard.kpis: NC restan y boleta sin RUT suma; una cifra para todo el sistema', () => {
  const d = dashboardCore.dashboard(db, { empresaId: empId, periodo: PER })
  assert.equal(d.kpis.ventas, ESPERADO.ventas, `kpis.ventas=${d.kpis.ventas} esperado ${ESPERADO.ventas}`)
  assert.equal(d.kpis.compras, ESPERADO.compras)
  assert.equal(d.kpis.iva_determinado, ESPERADO.iva_ventas - ESPERADO.iva_compras)
})

test('dashboard.serie (barra Inicio): NC restan también ahí', () => {
  const d = dashboardCore.dashboard(db, { empresaId: empId, periodo: PER })
  const mes = d.serie.find((s) => s.periodo === PER)
  assert.equal(mes.ventas, ESPERADO.ventas)
  assert.equal(mes.compras, ESPERADO.compras)
})

// ---------- 2. analitica ----------
test('analitica (mes + anual): NC restan; top SIN fila vacía', () => {
  const a = analitica(db, { empresaId: empId, periodo: PER })
  const mes = a.meses.find((m) => m.periodo === PER)
  assert.equal(mes.ventas, ESPERADO.ventas)
  assert.equal(mes.compras, ESPERADO.compras)
  assert.equal(mes.iva_determinado, ESPERADO.iva_ventas - ESPERADO.iva_compras)
  assert.equal(a.anual.ventas, ESPERADO.ventas)
  assert.equal(a.anual.compras, ESPERADO.compras)
  // Top de contrapartes REALES: la boleta anónima (rut '') no puede pintar como "cliente"
  assert.ok(!a.top_clientes.some((c) => c.rut === ''), 'el top de clientes no debe incluir la fila sin RUT')
})

// ---------- 3. portal (inicio + duo) ----------
test('portal.resumen + resumenDuo: NC restan en venta y compra con la MISMA cifra del dashboard', () => {
  const r = portal.resumen(db, { empresaId: empId, periodo: PER })
  assert.equal(r.ventas.total, ESPERADO.ventas)
  assert.equal(r.ventas.neta, ESPERADO.neto_ventas)
  const duo = portal.resumenDuo(db, { empresaId: empId, periodo: PER })
  assert.equal(duo.venta.total, ESPERADO.ventas)
  assert.equal(duo.compra.total, ESPERADO.compras)
  assert.equal(duo.diferencia_bruta.neto, ESPERADO.neto_ventas - ESPERADO.neto_compras)
  // Cartera: la boleta anónima no es un "cliente" segmentable
  const cartera = portal.cartera(db, { empresaId: empId, periodo: PER })
  assert.ok(!cartera.clientes.some((c) => c.rut === ''))
})

// ---------- 4. bandeja (listar + ingesta) ----------
test('documentos.listar: las sumas de la bandeja restan NC UNA vez', () => {
  const l = documentos.listar(db, { empresaId: empId, periodo: PER, tipoFlujo: 'venta' })
  assert.equal(l.sumas.total, ESPERADO.ventas)
  assert.equal(l.sumas.iva, ESPERADO.iva_ventas)
})

test('ingestarBatch: boleta 39 SIN contraparte se ingesta (medios electrónicos), factura 33 sin RUT se rechaza, y no se crea contraparte vacía', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM contrapartes WHERE empresa_id = ? AND rut = ''`).get(empId).n
  const res = documentos.ingestarBatch(db, {
    empresaId: empId, usuarioId: 1, tipoFlujo: 'venta', periodo: PER,
    documentos: [
      { tipoDoc: 39, folio: '900001', rutDoc: '', razonSocial: null, fechaDocto: '2026-10-05', montoNeto: 10000, montoIVA: 1900, montoTotal: 11900 },
      { tipoDoc: 33, folio: '102', rutDoc: '', razonSocial: 'Boleto sin RUT', fechaDocto: '2026-10-06', montoNeto: 1000, montoIVA: 190, montoTotal: 1190 },
    ],
  })
  assert.equal(res.errores.length, 1, `solo la factura 33 debe error: ${JSON.stringify(res.errores)}`)
  assert.equal(res.errores[0].folio, '102')
  assert.equal(res.insertados, 1, 'solo la boleta 900001 entra')
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM contrapartes WHERE empresa_id = ? AND rut = ''`).get(empId).n
  assert.equal(despues - antes, 0, 'no se debe upsertar contraparte con rut vacío')

  // La boleta 900001 ahora suma en portal (11900 = 10000 + 1900)
  const r = portal.resumen(db, { empresaId: empId, periodo: PER })
  assert.equal(r.ventas.total, ESPERADO.ventas + 11900, 'la venta por medios electrónicos entra a los totales')
})
