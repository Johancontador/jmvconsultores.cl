/**
 * Tests cobranza (Fase 3 JMV) — saldosClientes + marcarPagada reusando el
 * núcleo (asiento de tesorería). Ejecutar: node --test test/cobranza.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const dbFile = path.join(os.tmpdir(), `iva-mensual-cobranza-${Date.now()}.db`)
process.env.DB_PATH = dbFile
const db = require('../backend/db')
const cobranza = require('../backend/core/cobranza')
const empresasCore = require('../backend/core/empresas')
const cuentasCore = require('../backend/core/cuentas')
const asientos = require('../backend/core/asientos')
const documentos = require('../backend/core/documentos')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const calc = (body) => {
  let s = 0, m = 2
  for (let i = body.length - 1; i >= 0; i--) { s += +body[i] * m; m = m < 7 ? m + 1 : 2 }
  const d = 11 - (s % 11)
  return d === 11 ? '0' : d === 10 ? 'K' : String(d)
}
const rutEmp = `70${crypto.randomInt(1000000, 9999999)}`.slice(0, 8)
const eid = (() => {
  const e = empresasCore.crear(db, { usuarioId: adminId, rut: `${rutEmp}-${calc(rutEmp)}`, nombre: 'Cobranza SpA', claveSii: 'x'.repeat(8) })
  return typeof e === 'object' ? e.id : e
})()

const RUT_CLIENTE = '76.111.222-3'
let docCobrable = null

// prep: banco + plan + documento de venta CONTABILIZADO de hace 40 días
const plan = cuentasCore.listar(db, eid)
const bancos = db.prepare(`SELECT id FROM bancos_cuentas WHERE empresa_id = ?`).all(eid)
let bancoId = bancos[0]?.id
if (!bancoId) {
  const tesoreria = require('../backend/core/tesoreria')
  const cuentaBanco = plan.find((c) => c.alias === 'BANCOS')
  const b = tesoreria.crearBanco(db, { empresaId: eid, usuarioId: adminId, banco: 'Banco Test', numero: '001', cuentaContableId: cuentaBanco.id, saldoInicial: 1000000 })
  bancoId = typeof b === 'object' ? b.id : b
}
const cuentaClientes = plan.find((c) => c.alias === 'CLIENTES')
const cuentaVentas = plan.find((c) => c.alias === 'VENTAS_SERVICIOS')
const cuentaIVA = plan.find((c) => c.alias === 'IVA_DEBITO')

const fechaVieja = new Date(Date.now() - 40 * 86400e3).toISOString().slice(0, 10)
const infoDoc = documentos.ingestarBatch(db, {
  empresaId: eid, usuarioId: adminId, tipoFlujo: 'venta', periodo: fechaVieja.slice(0, 7).replace('-', ''),
  documentos: [{
    folio: '555', tipoDoc: 33, fechaDocto: fechaVieja.split('-').reverse().join('/'),
    rutDoc: RUT_CLIENTE, razonSocial: 'Cliente Mora Ltda',
    montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
    fechaReclamo: '', montos: {}, detalleSII: {},
  }],
})
const docRow = db.prepare(`SELECT id, estado FROM documentos WHERE empresa_id = ? AND folio = '555'`).get(eid)
docCobrable = docRow.id

// contabilizar manualmente (propuesta + confirmación simplificada vía asiento directo)
const a = asientos.crear(db, {
  empresaId: eid, usuarioId: adminId, fecha: fechaVieja,
  glosa: 'Venta F555 onboarding test', tipo: 'manual',
  lineas: [
    { cuenta_id: cuentaClientes.id, debe: 119000, haber: 0, glosa: 'Cliente F555' },
    { cuenta_id: cuentaVentas.id, debe: 0, haber: 100000, glosa: 'Venta F555' },
    { cuenta_id: cuentaIVA.id, debe: 0, haber: 19000, glosa: 'IVA F555' },
  ], origen: null, ip: null,
})
db.prepare(`UPDATE documentos SET estado = 'CONTABILIZADO', asiento_id = ? WHERE id = ?`).run(a.id, docCobrable)

test('Fase 3 · saldosClientes: cliente con factura abierta aparece con mora roja', () => {
  const r = cobranza.saldosClientes(db, { empresaId: eid })
  assert.strictEqual(r.clientes.length, 1, 'un cliente con saldo')
  const c = r.clientes[0]
  assert.strictEqual(c.rut, RUT_CLIENTE)
  assert.strictEqual(c.saldo, 119000)
  assert.ok(c.mora_max_dias >= 35, `mora ≥35 días (llegó ${c.mora_max_dias})`)
  assert.strictEqual(c.nivel, 'rojo')
  assert.strictEqual(r.total_pendiente, 119000)
  // el documento abierto está en la lista
  assert.ok(c.documentos_abiertos.some((d) => d.id === docCobrable))
})

test('Fase 3 · marcarPagada: crea COBRO con asiento del núcleo y baja el saldo', () => {
  const r = cobranza.marcarPagada(db, {
    empresaId: eid, usuarioId: adminId, documentoId: docCobrable,
    bancoCuentaId: bancoId, // fecha default hoy, monto = total
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.cobrado_ahora, 119000)
  assert.strictEqual(r.saldo_restante, 0)
  assert.ok(r.asiento_folio, 'asiento registrado con folio')
  // el asiento cuadra y cobra a CLIENTES
  const lineas = db.prepare(`SELECT COUNT(*) AS n FROM asiento_lineas WHERE asiento_id = ? AND haber > 0 AND cuenta_id = ?`).get(r.asiento_folio ? (db.prepare(`SELECT id FROM asientos WHERE folio = ? AND empresa_id = ?`).get(r.asiento_folio, eid)?.id || 0) : 0, cuentaClientes.id)
  assert.strictEqual(lineas.n, 1, 'una línea Haber a CLIENTES')
  // el movimiento quedó como COBRO aplicado al documento
  const mov = db.prepare(`SELECT tipo, documento_id, monto FROM teso_movimientos WHERE id = ?`).get(r.movimiento_id)
  assert.strictEqual(mov.tipo, 'COBRO')
  assert.strictEqual(mov.documento_id, docCobrable)
  assert.strictEqual(Math.abs(mov.monto), 119000)
  // ahora el cliente ya NO aparece en cobranza (saldo 0)
  const r2 = cobranza.saldosClientes(db, { empresaId: eid })
  assert.strictEqual(r2.clientes.find((c) => c.rut === RUT_CLIENTE), undefined)
  assert.strictEqual(r2.total_pendiente, 0)
})

test('Fase 3 · marcarPagada: validaciones (doc no venta, no contabilizado, exceso)', () => {
  // documento de compra del mismo periodo (existe por ingesta? no — crear venta no contabilizada)
  const info2 = documentos.ingestarBatch(db, {
    empresaId: eid, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202601',
    documentos: [{ folio: '666', tipoDoc: 33, fechaDocto: '10/01/2026', rutDoc: RUT_CLIENTE, razonSocial: 'X', montoExento: 0, montoNeto: 1000, montoIVA: 190, montoTotal: 1190, fechaReclamo: '', montos: {}, detalleSII: {} }],
  })
  const noContab = db.prepare(`SELECT id FROM documentos WHERE folio = '666' AND empresa_id = ?`).get(eid)
  assert.throws(() => cobranza.marcarPagada(db, { empresaId: eid, usuarioId: adminId, documentoId: noContab.id, bancoCuentaId: bancoId }),
    /CONTABILIZADO/, 'sin contabilizar rechazado')
  assert.throws(() => cobranza.marcarPagada(db, { empresaId: eid, usuarioId: adminId, documentoId: 999999, bancoCuentaId: bancoId }),
    /no encontrado/i)
  // exceso: la factura ya está cobrada (119000); pedir 2 más la excede (máx total 119000 + 1)
  assert.throws(() => cobranza.marcarPagada(db, { empresaId: eid, usuarioId: adminId, documentoId: docCobrable, bancoCuentaId: bancoId, monto: 2 }),
    /excede/)
})
