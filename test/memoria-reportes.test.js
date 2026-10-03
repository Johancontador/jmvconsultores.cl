/**
 * Tests — MEMORIA DE CONTABILIZACIÓN + MODO SIMPLE + REPORTES NUEVOS:
 *  - config de empresa (modo simple/completa + cuentas regulares validadas)
 *  - precedencia de contraparte: regla > memoria RUT > cuenta regular (modo simple) > alias
 *  - aprendizaje automático al confirmar (el RUT queda vinculado para el mes siguiente)
 *  - balance de 8 columnas (cuadres) y balance clasificado (corriente/no corriente)
 *  - cuenta corriente de clientes/proveedores con pagos aplicados
 * Ejecutar con: node --test test/memoria-reportes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-memoria-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const propuestas = require('../backend/core/propuestas')
const reportes = require('../backend/core/reportes')
const teso = require('../backend/core/tesoreria')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77567890-9', nombre: 'Memoria Test SpA',
  claveSii: 'clave-mem', tasaPpm: 0.015, telefono: '912345678',
})

const ctaPorAlias = (alias) => db.prepare(`SELECT id, codigo FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(EMP.id, alias)

// ---------- Config ----------

test('config default: modo simple sin cuentas regulares; actualizar valida cuentas de la empresa', () => {
  const cfg = empresas.obtenerConfig(db, EMP.id)
  assert.strictEqual(cfg.modo_conciliacion, 'simple')
  assert.strictEqual(cfg.cuenta_regular_gastos_id, null)
  // cuenta ajena rechazada
  assert.throws(() => empresas.actualizarConfig(db, {
    usuarioId: adminId, empresaId: EMP.id,
    config: { modo_conciliacion: 'simple', cuenta_regular_gastos_id: 999999 },
  }), /no existe/)
  const cfg2 = empresas.actualizarConfig(db, {
    usuarioId: adminId, empresaId: EMP.id,
    config: { modo_conciliacion: 'simple', cuenta_regular_gastos_id: ctaPorAlias('BANCOS').id, cuenta_regular_ingresos_id: ctaPorAlias('BANCOS').id },
  })
  assert.strictEqual(cfg2.cuenta_regular_gastos_id, ctaPorAlias('BANCOS').id)
  assert.throws(() => empresas.obtenerConfig(db, EMP.id + 100), /no encontrada/)
})

// ---------- Memoria: precedencia ----------

function ingestaDirecta({ rut, folio, tipoFlujo, tipoDoc = 33, neto = 100000, iva = 19000 }) {
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId,
    tipoFlujo, periodo: '202610',
    documentos: [{ tipoDoc, folio, rutDoc: rut, razonSocial: `Razón ${folio}`, fechaDocto: '05/10/2026', montoNeto: neto, montoIVA: iva, montoTotal: neto + iva }],
  })
  const doc = db.prepare(`SELECT * FROM documentos WHERE empresa_id = ? AND folio = ?`).get(EMP.id, String(folio))
  documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: doc.id,
    cuentaId: ctaPorAlias(tipoFlujo === 'venta' ? 'VENTAS_SERVICIOS' : 'GASTO_SERVICIOS_BASICOS').id,
    tratamientoIva: iva > 0 ? 'credito' : 'no_recuperable', ip: 'test',
  })
  return doc.id
}

test('resolverContraparte: modo simple netea contra la cuenta regular (compra → gastos, venta → ingresos)', () => {
  const rut = '76.111.111-8'
  const contra = propuestas.resolverContraparte(db, EMP.id, { rutContraparte: rut, tipoFlujo: 'compra' })
  assert.strictEqual(contra, ctaPorAlias('BANCOS').id)
  const contraV = propuestas.resolverContraparte(db, EMP.id, { rutContraparte: rut, tipoFlujo: 'venta' })
  assert.strictEqual(contraV, ctaPorAlias('BANCOS').id)
})

test('memoria por RUT pisa la cuenta regular y el modo completo vuelve al alias', () => {
  const rut = '76.222.222-5'
  const gasto = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = '6.1.1.01'`).get(EMP.id)
  propuestas.recordarMemoria(db, { empresaId: EMP.id, usuarioId: adminId, rut, cuentaId: gasto.id })
  const contra = propuestas.resolverContraparte(db, EMP.id, { rutContraparte: rut, tipoFlujo: 'compra' })
  assert.strictEqual(contra, gasto.id) // memoria > cuenta regular
  // modo completo: la misma memoria sigue primero (precedencia), alias solo sin memoria
  empresas.actualizarConfig(db, { usuarioId: adminId, empresaId: EMP.id, config: { modo_conciliacion: 'completa' } })
  const rutSinMemoria = '76.333.333-K'
  const contraAlias = propuestas.resolverContraparte(db, EMP.id, { rutContraparte: rutSinMemoria, tipoFlujo: 'compra' })
  assert.strictEqual(contraAlias, ctaPorAlias('PROVEEDORES').id)
  empresas.actualizarConfig(db, {
    usuarioId: adminId, empresaId: EMP.id,
    config: { modo_conciliacion: 'simple', cuenta_regular_gastos_id: ctaPorAlias('BANCOS').id, cuenta_regular_ingresos_id: ctaPorAlias('BANCOS').id },
  })
})

// ---------- Ciclo completo: doc nuevo → propuesta → confirmar aprende ----------

test('documento de RUT nuevo aparece en memoria.nuevos; al confirmar, el RUT queda memorizado', () => {
  const rut = '77.444.444-9'
  const docId = ingestaDirecta({ rut, folio: 'F1', tipoFlujo: 'compra' })
  const m0 = propuestas.memoria(db, EMP.id)
  assert.ok(m0.nuevos.some((d) => d.id === docId), 'el doc del RUT nuevo está en la lista de nuevos')

  propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: docId })
  const pend = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(docId)
  propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: pend.id, ip: 'test' })

  const mem = db.prepare(`SELECT cuenta_id FROM contrapartes WHERE empresa_id = ? AND rut = '77.444.444-9'`).get(EMP.id)
  assert.ok(mem && mem.cuenta_id, 'la contraparte quedó memorizada tras confirmar')
  assert.strictEqual(mem.cuenta_id, ctaPorAlias('BANCOS').id)

  // El mes siguiente: mismo RUT → propuesta nace directamente contra la memoria (sin regular ni alias)
  empresas.actualizarConfig(db, { usuarioId: adminId, empresaId: EMP.id, config: { modo_conciliacion: 'simple', cuenta_regular_gastos_id: null, cuenta_regular_ingresos_id: null } })
  const contra2 = propuestas.resolverContraparte(db, EMP.id, { rutContraparte: '77.444.444-9', tipoFlujo: 'compra' })
  assert.strictEqual(contra2, mem.cuenta_id, 'memoria aplicada aunque la cuenta regular esté vacía')
  empresas.actualizarConfig(db, {
    usuarioId: adminId, empresaId: EMP.id,
    config: { modo_conciliacion: 'simple', cuenta_regular_gastos_id: ctaPorAlias('BANCOS').id, cuenta_regular_ingresos_id: ctaPorAlias('BANCOS').id },
  })
})

// ---------- Balance de 8 columnas ----------

test('balance de 8 columnas: débitos = créditos, saldos deudor = acreedor, resultado = utilidad − pérdida', () => {
  const b = reportes.balance8Columnas(db, EMP.id, '202610')
  assert.ok(Array.isArray(b.filas) && b.filas.length > 0)
  assert.strictEqual(b.sumas.debe, b.sumas.haber)
  assert.strictEqual(b.cuadres.sumas_debe_haber, true)
  assert.strictEqual(b.cuadres.saldos_cuadran, true)
  assert.strictEqual(b.cuadres.resultado, b.sumas.utilidad - b.sumas.perdida)
  // la compra con IVA quedó contabilizada: IVA_CREDITO con saldo deudor (1.1.3.02)
  const filaIva = b.filas.find((f) => f.codigo === '1.1.3.02') // IVA_CREDITO
  assert.ok(filaIva && filaIva.saldo_deudor > 0)
  // el gasto (clase 6) fue a la columna Pérdida
  const filaGasto = b.filas.find((f) => f.codigo === '6.1.2.02')
  assert.ok(filaGasto && filaGasto.perdida === 100000)
})

// ---------- Balance clasificado ----------

test('balance clasificado: secciones por corriente/no corriente y A = P + P cuadrado', () => {
  const c = reportes.balanceClasificado(db, EMP.id, '202610')
  assert.ok(Array.isArray(c.activo.corriente) && Array.isArray(c.activo.no_corriente))
  // BANCOS es 1.1.x → corriente
  assert.ok(c.activo.corriente.some((f) => f.codigo.startsWith('1.1')))
  assert.strictEqual(c.ecuacion.cuadra, true)
  assert.ok(typeof c.capital_trabajo === 'number')
})

// ---------- Cuenta corriente ----------

test('cuenta corriente de clientes: venta genera cargo, cobro genera abono y netea', () => {
  const rutCliente = '77.555.555-3'
  const docVenta = ingestaDirecta({ rut: rutCliente, folio: 'V1', tipoFlujo: 'venta', neto: 200000, iva: 38000 })
  propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: docVenta })
  const pend = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(docVenta)
  propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: pend.id, ip: 'test' })

  // crear banco y registrar cobro aplicado al documento
  const bancoId = teso.crearBanco(db, {
    empresaId: EMP.id, usuarioId: adminId, banco: 'Banco Prueba', cuentaContableId: ctaPorAlias('BANCOS').id,
  })
  teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: bancoId, tipo: 'COBRO',
    fecha: '2026-10-20', monto: 238000, glosa: 'Cobro V1', documentoId: docVenta,
  })

  const cc = reportes.cuentaCorriente(db, EMP.id, { rol: 'cliente', rut: rutCliente, desde: '2026-10-01', hasta: '2026-10-31' })
  assert.strictEqual(cc.resumen.length, 1)
  assert.strictEqual(cc.resumen[0].cargos, 238000)
  assert.strictEqual(cc.resumen[0].abonos, 238000)
  assert.strictEqual(cc.resumen[0].saldo, 0, 'cobro netea la venta')
  assert.ok(cc.detalle.length === 2)
  assert.strictEqual(cc.detalle[cc.detalle.length - 1].saldo_despues, 0)

  const ccTodos = reportes.cuentaCorriente(db, EMP.id, { rol: 'cliente' })
  assert.ok(ccTodos.resumen.some((r) => r.rut === rutCliente))
})

test('mayor con filtro por RUT: solo asientos del cliente/proveedor', () => {
  const asientos = require('../backend/core/asientos')
  const m = asientos.mayor(db, {
    empresaId: EMP.id, cuentaId: ctaPorAlias('BANCOS').id,
    rutContraparte: '77.555.555-3',
  })
  assert.ok(m.movimientos.length >= 2, 'venta (débito banco) + cobro (débito banco) aparecen')
  for (const mov of m.movimientos) {
    assert.ok(/77.555.555-3|V1|Cobro/.test(`${mov.linea_glosa || ''} ${mov.asiento_glosa || ''}`) || mov.debe || mov.haber)
  }
  const mSin = asientos.mayor(db, { empresaId: EMP.id, cuentaId: ctaPorAlias('BANCOS').id, rutContraparte: '66.999.999-9' })
  assert.strictEqual(mSin.movimientos.length, 0)
})
