/**
 * Tests FASE 6 — TESORERÍA (§22): bancos, pagos/cobros/transferencias con
 * asiento del núcleo, libro banco con saldo corrido, importación de cartola
 * idempotente y conciliación bancaria report-only.
 * Ejecutar con: node --test test/fase6.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase6-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const asientos = require('../backend/core/asientos')
const reportes = require('../backend/core/reportes')
const teso = require('../backend/core/tesoreria')
const { permisosDeRol } = require('../backend/core/permisos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77551234-2', nombre: 'Tesorería Test SpA',
  claveSii: 'clave-teso', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77552345-K', nombre: 'Otra Tesorería Ltda',
  claveSii: 'clave-teso2', tasaPpm: 0.015, telefono: '912345678',
})

const ctaPorAlias = (empresaId, alias) => db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias).id

// ---------- RBAC ----------

test('RBAC: tesorería y contador operan y concilian; auditor y admin_empresa solo ven', () => {
  const t = permisosDeRol('tesoreria')
  assert.ok(t.has('tesoreria:ver') && t.has('tesoreria:operar') && t.has('bancos:conciliar'))
  const c = permisosDeRol('contador')
  assert.ok(c.has('tesoreria:operar') && c.has('bancos:conciliar'))
  const a = permisosDeRol('auditor')
  assert.ok(a.has('tesoreria:ver') && !a.has('tesoreria:operar') && !a.has('bancos:conciliar'))
  const ae = permisosDeRol('admin_empresa')
  assert.ok(!ae.has('tesoreria:ver'))
})

// ---------- Bancos ----------

test('crear banco: contabiliza el saldo inicial como apertura y rechaza duplicados', () => {
  const id = teso.crearBanco(db, {
    empresaId: EMP.id, usuarioId: adminId,
    banco: 'Banco de Chile', numero: '001-12345', cuentaContableId: ctaPorAlias(EMP.id, 'BANCOS'),
    saldoInicial: 1000000,
  })
  assert.ok(id > 0)
  // apertura: BANCOS al debe, patrimonio al haber
  const asientoApertura = db.prepare(`
    SELECT a.id, a.tipo FROM asientos a WHERE a.empresa_id = ? AND a.tipo = 'apertura' ORDER BY a.id DESC LIMIT 1
  `).get(EMP.id)
  assert.ok(asientoApertura, 'existe asiento de apertura')
  const lineas = db.prepare(`
    SELECT c.alias, al.debe, al.haber FROM asiento_lineas al JOIN cuentas c ON c.id = al.cuenta_id WHERE al.asiento_id = ?
  `).all(asientoApertura.id)
  assert.strictEqual(lineas.find((l) => l.alias === 'BANCOS').debe, 1000000)
  assert.strictEqual(lineas.find((l) => l.alias !== 'BANCOS').haber, 1000000)
  assert.throws(() => teso.crearBanco(db, {
    empresaId: EMP.id, usuarioId: adminId,
    banco: 'Otro', cuentaContableId: ctaPorAlias(EMP.id, 'BANCOS'),
  }), /ya está asociada/)
})

test('crear banco en otra empresa con la misma cuenta contable id: aislamiento', () => {
  // EMP2 tiene su propio plan (misma plantilla): puede tener su banco sin problema.
  const id2 = teso.crearBanco(db, {
    empresaId: EMP2.id, usuarioId: adminId,
    banco: 'Banco Santander', cuentaContableId: ctaPorAlias(EMP2.id, 'BANCOS'),
  })
  assert.ok(id2 > 0)
})

// ---------- Pagos y cobros ----------

test('pago: asiento proveedores/banco + movimiento firmado negativo en el libro', () => {
  const { movimientoId, asiento: a } = teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, tipo: 'PAGO',
    fecha: '2026-10-05', monto: 400000, glosa: 'Pago arriendo octubre',
  })
  const mov = db.prepare(`SELECT * FROM teso_movimientos WHERE id = ?`).get(movimientoId)
  assert.strictEqual(mov.monto, -400000)
  const lineas = db.prepare(`
    SELECT c.alias, al.debe, al.haber FROM asiento_lineas al JOIN cuentas c ON c.id = al.cuenta_id WHERE al.asiento_id = ?
  `).all(a.id)
  assert.strictEqual(lineas.find((l) => l.alias === 'PROVEEDORES').debe, 400000)
  assert.strictEqual(lineas.find((l) => l.alias === 'BANCOS').haber, 400000)
  // período autocreado y abierto
  const p = db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id = ? AND periodo = '202610'`).get(EMP.id)
  assert.strictEqual(p.estado, 'ABIERTO')
})

test('cobro: asiento banco/clientes + movimiento firmado positivo', () => {
  const { movimientoId, asiento: a } = teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, tipo: 'COBRO',
    fecha: '2026-10-06', monto: 700000, glosa: 'Cobro factura 100',
  })
  const mov = db.prepare(`SELECT * FROM teso_movimientos WHERE id = ?`).get(movimientoId)
  assert.strictEqual(mov.monto, 700000)
  const lineas = db.prepare(`
    SELECT c.alias, al.debe, al.haber FROM asiento_lineas al JOIN cuentas c ON c.id = al.cuenta_id WHERE al.asiento_id = ?
  `).all(a.id)
  assert.strictEqual(lineas.find((l) => l.alias === 'BANCOS').debe, 700000)
  assert.strictEqual(lineas.find((l) => l.alias === 'CLIENTES').haber, 700000)
})

test('validaciones: monto <= 0, glosa vacía, banco ajeno y cuenta de contraparte inexistente', () => {
  assert.throws(() => teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, tipo: 'PAGO',
    fecha: '2026-10-05', monto: 0, glosa: 'x',
  }), /mayor que cero/)
  assert.throws(() => teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, tipo: 'PAGO',
    fecha: '2026-10-05', monto: 100, glosa: '',
  }), /glosa/)
  assert.throws(() => teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 2, tipo: 'PAGO',
    fecha: '2026-10-05', monto: 100, glosa: 'banco de otra empresa',
  }), /no encontrada/)
  assert.throws(() => teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, tipo: 'PAGO',
    fecha: '2026-10-05', monto: 100, glosa: 'cuenta ajena', cuentaContraparteId: ctaPorAlias(EMP2.id, 'BANCOS'),
  }), /contraparte/)
})

// ---------- Transferencia ----------

test('transferencia: UN asiento con ambas patas bancarias y dos filas de libro', () => {
  const idCaja = teso.crearBanco(db, {
    empresaId: EMP.id, usuarioId: adminId,
    banco: 'Caja Chica', cuentaContableId: ctaPorAlias(EMP.id, 'CAJA'),
  })
  const { movimientoId, asiento: a } = teso.registrarTransferencia(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, bancoDestinoId: idCaja,
    fecha: '2026-10-07', monto: 150000, glosa: 'Fondos caja',
  })
  const lineas = db.prepare(`
    SELECT c.alias, al.debe, al.haber FROM asiento_lineas al JOIN cuentas c ON c.id = al.cuenta_id WHERE al.asiento_id = ?
  `).all(a.id)
  assert.strictEqual(lineas.find((l) => l.alias === 'CAJA').debe, 150000)
  assert.strictEqual(lineas.find((l) => l.alias === 'BANCOS').haber, 150000)
  const mov = db.prepare(`SELECT monto, banco_destino_id FROM teso_movimientos WHERE id = ?`).get(movimientoId)
  assert.strictEqual(mov.monto, -150000)
  assert.strictEqual(mov.banco_destino_id, idCaja)
  assert.throws(() => teso.registrarTransferencia(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, bancoDestinoId: 1,
    fecha: '2026-10-07', monto: 1, glosa: 'mismo banco',
  }), /distinta/)
})

// ---------- Libro banco ----------

test('libro banco: saldo corrido = saldo inicial + Σ movimientos', () => {
  const r = teso.libroBanco(db, { empresaId: EMP.id, bancoCuentaId: 1 })
  assert.strictEqual(r.saldo_final, 1000000 - 400000 + 700000 - 150000)
  const cronologico = [...r.filas].reverse()
  assert.strictEqual(cronologico[cronologico.length - 1].saldo_despues, r.saldo_final)
  const anterior = cronologico[cronologico.length - 2]
  const ultimo = cronologico[cronologico.length - 1]
  assert.strictEqual(ultimo.saldo_despues, anterior.saldo_despues + ultimo.monto)
})

// ---------- Cartola + conciliación ----------

test('importar cartola: idempotente (re-importar no duplica) y valida filas', () => {
  const filas = [
    { fecha: '2026-10-05', monto: -400000, glosa: 'Cargo arriendo' },
    { fecha: '2026-10-06', monto: 700000, glosa: 'Abono cliente' },
    { fecha: '2026-10-10', monto: -5000, glosa: 'Comisión cartola' }, // solo banco
  ]
  const r1 = teso.importarCartola(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, filas })
  assert.strictEqual(r1.insertadas, 3)
  const r2 = teso.importarCartola(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, filas })
  assert.strictEqual(r2.insertadas, 0)
  assert.strictEqual(r2.duplicadas, 3)
  assert.throws(() => teso.importarCartola(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1,
    filas: [{ fecha: '05/10/2026', monto: -1 }],
  }), /Fecha inválida/)
})

test('conciliación: empareja por monto+fecha±3d y reporta lo no conciliado de ambos lados', () => {
  const r = teso.conciliarBanco(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, hasta: '2026-10-31' })
  assert.strictEqual(r.emparejados, 2)
  assert.strictEqual(r.no_conciliado_libro.length, 1) // la transferencia (sale por BANCOS, no está en cartola)
  assert.strictEqual(r.no_conciliado_cartola.length, 1) // la comisión del banco
  assert.strictEqual(r.no_conciliado_cartola[0].monto, -5000)
  // saldos: libro 1.150.000 vs cartola 295.000 (solo lo importado: -400k+700k-5k)
  assert.strictEqual(r.saldo_libro, 1150000)
  assert.strictEqual(r.saldo_cartola, 295000)
  assert.strictEqual(r.cuadrado, false)
  // idempotente: re-conciliar mantiene los matches y no duplilca emparejamientos
  const r2 = teso.conciliarBanco(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: 1, hasta: '2026-10-31' })
  assert.strictEqual(r2.emparejados, 2)
})

test('conciliación cuadrada cuando la cartola refleja todo el libro', () => {
  // El escenario cuadrado: banco nuevo SIN comisiones — su cartola refleja
  // exactamente los mismos movimientos que el libro.
  const idBanco2 = teso.crearBanco(db, {
    empresaId: EMP.id, usuarioId: adminId,
    banco: 'Banco Estado', numero: '009-9', cuentaContableId: db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = '1.1.1.03'`).get(EMP.id).id,
  })
  teso.registrarPagoCobro(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: idBanco2, tipo: 'COBRO',
    fecha: '2026-10-12', monto: 250000, glosa: 'Cobro transferido',
  })
  teso.importarCartola(db, {
    empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: idBanco2,
    filas: [{ fecha: '2026-10-12', monto: 250000, glosa: 'Abono recibido' }],
  })
  const r = teso.conciliarBanco(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: idBanco2, hasta: '2026-10-31' })
  assert.strictEqual(r.no_conciliado_libro.length, 0)
  assert.strictEqual(r.no_conciliado_cartola.length, 0)
  assert.strictEqual(r.cuadrado, true)
})

// ---------- Integración con reportes ----------

test('el banco vive en el mayor: situación financiera incluye el saldo bancario', () => {
  const s = reportes.situacionFinanciera(db, EMP.id, '202610')
  const bancosFila = s.activos.find((a) => a.codigo === '1.1.1.02')
  assert.ok(bancosFila, 'la cuenta BANCOS aparece en activos')
  assert.strictEqual(bancosFila.saldo, 1150000)
})

// ---------- Aislamiento ----------

test('aislamiento: los bancos de EMP2 son independientes', () => {
  const b2 = teso.listarBancos(db, EMP2.id)
  assert.strictEqual(b2.length, 1)
  assert.strictEqual(b2[0].banco, 'Banco Santander')
  assert.strictEqual(b2[0].saldo, 0)
  const r2 = teso.resumen(db, EMP2.id)
  assert.strictEqual(r2.total_bancos, 0)
})

// ---------- Resumen ----------

test('resumen de tesorería: total bancos + caja + mes actual', () => {
  const r = teso.resumen(db, EMP.id)
  assert.strictEqual(r.total_bancos, 1400000) // banco 1.150.000 + Banco Estado 250.000
  assert.ok(r.caja > 0) // caja chica con 150.000
  assert.strictEqual(r.mes_actual.movimientos, 4) // 3 del banco 1 + 1 del Banco Estado
})

test('situación financiera sigue cuadrada con la tesorería operando (A = P + P)', () => {
  const s = reportes.situacionFinanciera(db, EMP.id, '202610')
  assert.strictEqual(s.ecuacion.cuadra, true)
})
