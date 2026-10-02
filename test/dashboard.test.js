/**
 * Tests DASHBOARD OPERATIVO (PROMPT MAESTRO §9/§10/§35).
 *  - Resolución de período (pedido → actividad → mes actual).
 *  - KPIs del ER derivados de asiento_lineas tras el pipeline completo.
 *  - Documentos por estado: contabilizados vs pendientes de decisión humana (§43).
 *  - CxP/CxC por alias de control con saldos naturales acumulados.
 *  - Conciliación: ejecutada con diferencias → alerta accionable.
 *  - Alertas: sin reglas, onboarding incompleto, período anterior sin cerrar,
 *    período cerrado (solo consulta), y el "todo al día" como caso residual.
 *  - Aislamiento multiempresa: la empresa B no ve nada de la A.
 * Ejecutar con: node --test test/dashboard.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-dashboard-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const asientos = require('../backend/core/asientos')
const conciliacion = require('../backend/core/conciliacion')
const automatizacion = require('../backend/core/automatizacion')
const semilla = require('../backend/core/reglas-semilla')
const periodos = require('../backend/core/periodos')
const { dashboard, resolverPeriodo } = require('../backend/core/dashboard')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77777777-7', nombre: 'Dashboard SpA',
  claveSii: 'clave-dash', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77888888-2', nombre: 'Otra Dash Ltda',
  claveSii: 'clave-dash2', tasaPpm: 0.015, telefono: '912345678',
})

const docVenta = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-6', razonSocial: 'Cliente Uno Ltda',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: '2026-09-15', fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})
const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '76888888-5', razonSocial: 'Proveedor Uno SpA',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-09-10', fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})

// Ingesta 202609: 3 ventas (Σ neto 600.000 / Σ IVA 114.000 / Σ total 714.000)
// + 2 compras (Σ neto 150.000 / Σ IVA 28.500 / Σ total 178.500)
// + 1 compra con total 0 → REVISIÓN en la ingesta (§5, divergencia visible).
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202609',
  documentos: [
    docVenta(501, { montoNeto: 200000, montoIVA: 38000, montoTotal: 238000, fechaDocto: '2026-09-05' }),
    docVenta(502, { montoNeto: 100000, montoIVA: 19000, montoTotal: 119000, fechaDocto: '2026-09-12' }),
    docVenta(503, { montoNeto: 300000, montoIVA: 57000, montoTotal: 357000, fechaDocto: '2026-09-25' }),
  ],
})
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
  documentos: [
    docCompra(601),
    docCompra(602, { montoNeto: 50000, montoIVA: 9500, montoTotal: 59500, fechaDocto: '2026-09-18' }),
    docCompra(603, { montoNeto: 0, montoIVA: 0, montoTotal: 0, fechaDocto: '2026-09-20' }),
  ],
})

const s = semilla.instalarSiVacia(db, { empresaId: EMP.id, usuarioId: adminId })
assert.strictEqual(s.instaladas, 3)
const corrida = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })

// ---------- Resolución de período ----------

test('resuelve el período con actividad cuando no se pide uno', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  assert.strictEqual(d.periodo, '202609')
})

test('pedido inválido → fallback al último con actividad', () => {
  assert.strictEqual(resolverPeriodo(db, EMP.id, 'septiembre'), '202609')
  assert.strictEqual(resolverPeriodo(db, EMP.id, null), '202609')
})

test('empresa sin actividad → mes actual (UTC) y alertas de arranque', () => {
  const d2 = dashboard(db, { empresaId: EMP2.id })
  const ahora = new Date()
  const esperado = `${ahora.getUTCFullYear()}${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`
  assert.strictEqual(d2.periodo, esperado)
  assert.strictEqual(d2.kpis.docs_total, 0)
  assert.strictEqual(d2.kpis.asientos_n, 0)
  assert.strictEqual(d2.conciliacion.ejecutada, false)
  assert.strictEqual(d2.kpis.cxp, 0) // plan precargado, sin movimientos
  assert.strictEqual(d2.kpis.cxc, 0)
  // sin reglas + onboarding incompleto: las dos alertas de arranque
  const mensajes = d2.alertas.map((a) => a.mensaje)
  assert.ok(mensajes.some((m) => m.includes('Sin reglas contables')), mensajes.join(' | '))
  assert.ok(mensajes.some((m) => m.includes('Onboarding')), mensajes.join(' | '))
})

// ---------- KPIs tras el pipeline ----------

test('pipeline contabiliza 5/6; la REVISIÓN no se pisa y queda como decisión humana', () => {
  assert.strictEqual(corrida.contabilizadas, 5)
  const d = dashboard(db, { empresaId: EMP.id })
  assert.strictEqual(d.kpis.docs_total, 6)
  assert.strictEqual(d.kpis.docs_contabilizados, 5)
  assert.strictEqual(d.kpis.docs_sin_contabilizar, 1)
  const rev = dashboard(db, { empresaId: EMP.id }).alertas.find((a) => a.mensaje.includes('revisión'))
  assert.ok(rev && rev.vista === 'documentos')
})

test('KPIs del ER: ingresos − gastos = resultado, todo derivado de asiento_lineas', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  const k = d.kpis
  assert.strictEqual(k.ingresos, 600000)          // ventas netas (clase 4)
  assert.strictEqual(k.gastos, 150000)            // bases imputables de compras (clase 6)
  assert.strictEqual(k.resultado, 450000)
  assert.strictEqual(k.ingresos_acum, 600000)     // año en curso = solo septiembre
  assert.strictEqual(k.ventas, 714000)            // RCV: total ventas
  assert.strictEqual(k.compras, 178500)
  assert.strictEqual(k.iva_determinado, 85500)    // 114.000 − 28.500
  assert.strictEqual(k.asientos_n, 5)
  assert.strictEqual(k.asientos_cuadrado, true)
})

test('CxP/CxC por alias de control con saldos naturales', () => {
  const k = dashboard(db, { empresaId: EMP.id }).kpis
  assert.strictEqual(k.cxp, 178500)   // proveedores: haber − debe
  assert.strictEqual(k.cxc, 714000)   // clientes: debe − haber
})

test('serie de 6 meses con un solo fetch (202609 tiene movimiento, el resto cero)', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  assert.strictEqual(d.serie.length, 6)
  assert.strictEqual(d.serie[5].periodo, '202609')
  assert.strictEqual(d.serie[5].ventas, 714000)
  assert.strictEqual(d.serie[5].compras, 178500)
  assert.strictEqual(d.serie.slice(0, 5).every((m) => m.ventas === 0 && m.compras === 0), true)
})

// ---------- Alertas ----------

test('conciliación ejecutada con 1 SOLO_SII (la REVISIÓN) → alerta accionable', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  assert.strictEqual(d.conciliacion.ejecutada, true)
  assert.strictEqual(d.conciliacion.diferencias, 1)
  const a = d.alertas.find((x) => x.mensaje.includes('diferencia'))
  assert.ok(a, 'debe existir la alerta de diferencias')
  assert.strictEqual(a.nivel, 'warn')
  assert.strictEqual(a.vista, 'propuestas')
  assert.ok(a.detalle.includes('SOLO_SII'), a.detalle)
})

test('alerta "sin reglas" solo si la empresa no tiene; EMP ya tiene 3', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  assert.strictEqual(d.automatizacion.reglas_activas, 3)
  assert.ok(!d.alertas.some((a) => a.mensaje.includes('Sin reglas')))
})

test('las alertas van ordenadas por severidad (error → warn → info → ok)', () => {
  const d = dashboard(db, { empresaId: EMP.id })
  const orden = { error: 0, warn: 1, info: 2, ok: 3 }
  const niveles = d.alertas.map((a) => orden[a.nivel])
  assert.deepEqual(niveles, [...niveles].sort((x, y) => x - y))
})

// ---------- Períodos anteriores y cierre ----------

test('período anterior con movimiento y ABIERTO → alerta de cierre; CxP acumula', () => {
  // Asiento manual en agosto (período anterior): gasto 10.000 contra proveedores.
  asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-08-31',
    glosa: 'Gasto de agosto (test dashboard)',
    lineas: [
      { cuenta_id: db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'GASTO_SERVICIOS_BASICOS'`).get(EMP.id).id, debe: 10000, haber: 0 },
      { cuenta_id: db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'PROVEEDORES'`).get(EMP.id).id, debe: 0, haber: 10000 },
    ],
  })
  const d = dashboard(db, { empresaId: EMP.id, periodo: '202609' })
  const a = d.alertas.find((x) => x.mensaje.includes('202608'))
  assert.ok(a, 'debe alertar el período 202608 sin cerrar')
  assert.strictEqual(a.vista, 'reportes')
  assert.strictEqual(d.kpis.cxp, 188500) // 178.500 de septiembre + 10.000 de agosto
  assert.ok(d.periodos_disponibles.some((p) => p.periodo === '202608'))
})

test('período cerrado: periodo_cerrado + alerta de solo consulta', () => {
  periodos.cerrar(db, EMP.id, '202608', adminId)
  const d = dashboard(db, { empresaId: EMP.id, periodo: '202608' })
  assert.strictEqual(d.periodo_cerrado, true)
  const a = d.alertas.find((x) => x.mensaje.includes('CERRADO'))
  assert.ok(a, 'debe informar que el período está cerrado')
})

// ---------- Aislamiento multiempresa ----------

test('aislamiento: la empresa 2 no ve documentos, asientos ni serie de la 1', () => {
  const d2 = dashboard(db, { empresaId: EMP2.id })
  assert.strictEqual(d2.kpis.docs_total, 0)
  assert.strictEqual(d2.kpis.asientos_n, 0)
  assert.strictEqual(d2.kpis.cxp, 0)
  assert.strictEqual(d2.kpis.cxc, 0)
  assert.ok(d2.serie.every((m) => m.ventas === 0 && m.compras === 0))
  assert.ok(!d2.periodos_disponibles.some((p) => p.periodo === '202609'))
})
