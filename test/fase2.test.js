/**
 * Tests FASE 2 — Núcleo contable: plan de cuentas (plantilla PUC), asientos
 * con partida doble atómica, correlatividad de folios, reversiones, diario y mayor.
 * Ejecutar con: node --test test/fase2.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase2-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { PLANTILLA } = require('../backend/core/plan-cuentas-plantilla')
const empresas = require('../backend/core/empresas')
const cuentas = require('../backend/core/cuentas')
const asientos = require('../backend/core/asientos')
const auditoria = require('../backend/core/auditoria')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76333333-7', nombre: 'Contable Test SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '76444444-2', nombre: 'Otra Empresa Ltda',
  claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
})

function aliasId(alias) {
  return cuentas.cuentaPorAlias(db, EMP.id, alias).id
}
function aliasIdEmp2(alias) {
  return cuentas.cuentaPorAlias(db, EMP2.id, alias).id
}
const lineaDe = (alias, monto, extra = {}) => ({ cuenta_id: aliasId(alias), debe: monto, haber: 0, ...extra })
const lineaHaber = (alias, monto, extra = {}) => ({ cuenta_id: aliasId(alias), debe: 0, haber: monto, ...extra })

// ---------- Plantilla PUC ----------

test('plantilla PUC precargada completa con alias de control y raíces resumen', () => {
  const plan = cuentas.listar(db, EMP.id)
  assert.ok(plan.length >= PLANTILLA.length, `esperado ≥ ${PLANTILLA.length}, hubo ${plan.length}`)

  for (const alias of ['CAJA', 'BANCOS', 'CLIENTES', 'IVA_CREDITO', 'IVA_DEBITO', 'PROVEEDORES', 'F29_POR_PAGAR', 'GASTO_SUELDOS', 'VENTAS_SERVICIOS', 'CAPITAL']) {
    const c = cuentas.cuentaPorAlias(db, EMP.id, alias)
    assert.ok(c, `alias ${alias} debe existir`)
  }
  const raiz = plan.find((c) => c.codigo === '1')
  assert.ok(raiz.es_resumen, 'la raíz 1 es resumen')
  const iva = cuentas.cuentaPorAlias(db, EMP.id, 'IVA_CREDITO')
  assert.strictEqual(iva.naturaleza, 'deudora')
  assert.strictEqual(iva.clase, 1)
  const venta = cuentas.cuentaPorAlias(db, EMP.id, 'VENTAS_SERVICIOS')
  assert.strictEqual(venta.naturaleza, 'acreedora')
  assert.strictEqual(venta.cierre, 'resultado')
})

test('aislamiento: cada empresa tiene SU propio plan y alias', () => {
  const a1 = aliasId('BANCOS')
  const a2 = aliasIdEmp2('BANCOS')
  assert.notStrictEqual(a1, a2)
  assert.strictEqual(cuentas.obtener(db, EMP2.id, a1), null, 'la cuenta de EMP1 no es visible desde EMP2')
})

test('cuentas: jerarquía validada y alias únicos', () => {
  assert.throws(() => cuentas.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: '6.1.9.01', nombre: 'Hija sin padre',
  }), /padre/)
  assert.throws(() => cuentas.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: '6.1.2.01', nombre: 'Código repetido',
  }), /UNIQUE|Ya existe/ || /UNIQUE/)
  assert.throws(() => cuentas.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: '6.1.2.07', nombre: 'Alias repetido', alias: 'GASTO_ARRIENDO',
  }), /alias/i)
  const ok = cuentas.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: '6.1.2.07', nombre: 'Publicaciones digitales' })
  assert.ok(ok.id > 0)
})

// ---------- Partida doble ----------

test('asiento válido se registra con folio 1 y queda auditado', () => {
  const a = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-09-05', glosa: 'Aporte inicial',
    lineas: [lineaDe('BANCOS', 500000), lineaHaber('CAPITAL', 500000)],
  })
  assert.strictEqual(a.folio, 1)
  assert.strictEqual(a.anio, 2026)
  assert.strictEqual(a.periodo, '202609')
  assert.strictEqual(a.lineas.length, 2)
  assert.ok(a.id > 0)

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 5 })
  assert.ok(registros.some((r) => r.accion === 'asiento.crear'))
})

test('asiento DESCUADRADO se rechaza y NO deja rastro (transacción atómica)', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n
  const lineasAntes = db.prepare(`SELECT COUNT(*) AS n FROM asiento_lineas`).get().n

  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-09-06', glosa: 'Descuadrado',
    lineas: [lineaDe('GASTO_ARRIENDO', 100000), lineaHaber('BANCOS', 99999)],
  }), /DESCUADRADO/)

  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n, antes)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asiento_lineas`).get().n, lineasAntes)
})

test('validaciones: una línea, cuenta resumen, monto decimal, doble pata, línea cero, empresa ajena', () => {
  // Una sola línea
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [lineaDe('CAJA', 1000)],
  }), /al menos 2 líneas/)

  // Cuenta resumen
  const resumen = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = '6.1'`).get(EMP.id)
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [{ cuenta_id: resumen.id, debe: 100, haber: 0 }, lineaHaber('BANCOS', 100)],
  }), /RESUMEN/)

  // Monto decimal
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [lineaDe('CAJA', 100.5), lineaHaber('BANCOS', 100.5)],
  }), /entero/)

  // Doble pata
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [{ cuenta_id: aliasId('CAJA'), debe: 100, haber: 50 }, lineaHaber('BANCOS', 150)],
  }), /débito Y crédito/)

  // Línea en cero
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [{ cuenta_id: aliasId('CAJA'), debe: 0, haber: 0 }, lineaHaber('BANCOS', 100)],
  }), /cero/)

  // Cuenta de OTRA empresa
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-06', glosa: 'x',
    lineas: [{ cuenta_id: aliasIdEmp2('CAJA'), debe: 100, haber: 0 }, lineaHaber('BANCOS', 100)],
  }), /no encontrada/)
})

test('período CERRADO rechaza asientos', () => {
  asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-01-10', glosa: 'Enero 1',
    lineas: [lineaDe('GASTO_ARRIENDO', 50000), lineaHaber('BANCOS', 50000)],
  })
  periodosCerrarEne()
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-01-15', glosa: 'Enero 2',
    lineas: [lineaDe('GASTO_ARRIENDO', 1), lineaHaber('BANCOS', 1)],
  }), /CERRADO/)
})

function periodosCerrarEne() {
  const periodos = require('../backend/core/periodos')
  periodos.cerrar(db, EMP.id, '202601', adminId)
}

test('correlatividad de folios sin huecos por año', () => {
  const a2 = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-09-10', glosa: 'Compra oficina',
    lineas: [lineaDe('GASTO_ARRIENDO', 100000), { cuenta_id: aliasId('IVA_CREDITO'), debe: 19000, haber: 0 }, lineaHaber('BANCOS', 119000)],
  })
  const a3 = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-09-20', glosa: 'Venta servicios',
    lineas: [lineaHaber('VENTAS_SERVICIOS', 200000), lineaHaber('IVA_DEBITO', 38000), lineaDe('BANCOS', 238000)],
  })
  // folio 1 = Aporte, 2 = Enero 1 → estos son 3 y 4 (correlatividad sin huecos)
  assert.strictEqual(a2.folio, 3)
  assert.strictEqual(a3.folio, 4)

  const folios = db.prepare(`
    SELECT folio FROM asientos WHERE empresa_id = ? AND anio = 2026 ORDER BY folio
  `).all(EMP.id).map((r) => r.folio)
  assert.deepStrictEqual(folios, folios.map((f, i) => i + 1), 'folios consecutivos sin huecos')
})

// ---------- Reversión ----------

test('reversión: patas invertidas, referenciada, auditada y sin doble reversión', () => {
  const original = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId,
    fecha: '2026-09-25', glosa: 'Gasto a revertir',
    lineas: [lineaDe('GASTO_ARRIENDO', 80000), lineaHaber('BANCOS', 80000)],
  })

  const rev = asientos.revertir(db, { empresaId: EMP.id, usuarioId: adminId, asientoId: original.id })
  assert.strictEqual(rev.tipo, 'reversion')
  assert.strictEqual(rev.asiento_revertido_id, original.id)
  const totalDebe = rev.lineas.reduce((s, l) => s + l.debe, 0)
  const totalHaber = rev.lineas.reduce((s, l) => s + l.haber, 0)
  assert.strictEqual(totalDebe, totalHaber)
  // las patas quedan invertidas respecto al original
  const origBancosHaber = original.lineas.find((l) => l.cuenta_codigo === '1.1.1.02').haber
  const revBancosDebe = rev.lineas.find((l) => l.cuenta_codigo === '1.1.1.02').debe
  assert.strictEqual(revBancosDebe, origBancosHaber)

  // efecto neto en la cuenta = 0
  const mayor = asientos.mayor(db, { empresaId: EMP.id, cuentaId: aliasId('GASTO_ARRIENDO') })
  const delPar = mayor.movimientos.filter((m) => m.fecha >= '2026-09-25')
  const neto = delPar.reduce((s, m) => s + m.debe - m.haber, 0)
  assert.strictEqual(neto, 0)

  // no se puede revertir dos veces el mismo asiento
  assert.throws(() => asientos.revertir(db, { empresaId: EMP.id, usuarioId: adminId, asientoId: original.id }), /ya fue revertido/)
  // revertir la reversión SÍ es válido (es el último de la cadena — contra-asiento)

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 10 })
  assert.ok(registros.some((r) => r.accion === 'asiento.revertir'))
})

// ---------- Diario y Mayor ----------

test('diario: filtra por período y por cuenta', () => {
  const septiembre = asientos.diario(db, { empresaId: EMP.id, periodo: '202609' })
  assert.ok(septiembre.total >= 3)
  assert.ok(septiembre.asientos.every((a) => a.periodo === '202609'))
  assert.ok(septiembre.asientos.every((a) => a.lineas.length >= 2))

  const conCuenta = asientos.diario(db, { empresaId: EMP.id, cuentaId: aliasId('BANCOS') })
  assert.ok(conCuenta.asientos.every((a) => a.lineas.some((l) => l.cuenta_id === aliasId('BANCOS'))))

  const porTexto = asientos.diario(db, { empresaId: EMP.id, texto: 'Venta servicios' })
  assert.strictEqual(porTexto.total, 1)
})

test('mayor: saldo con naturaleza y saldo corrido', () => {
  const bancos = asientos.mayor(db, { empresaId: EMP.id, cuentaId: aliasId('BANCOS') })
  assert.strictEqual(bancos.cuenta.naturaleza, 'deudora')
  // Aporte +500.000, Enero 1 −50.000, Compra oficina −119.000, Venta +238.000;
  // el par original/reversión del gasto de 80.000 netea a 0
  const esperado = 500000 - 50000 - 119000 + 238000
  assert.strictEqual(bancos.saldo, esperado)

  // saldo corrido: el último movimiento del rango llega al saldo total
  assert.strictEqual(bancos.movimientos[bancos.movimientos.length - 1].saldo, esperado)

  const ventas = asientos.mayor(db, { empresaId: EMP.id, cuentaId: aliasId('VENTAS_SERVICIOS') })
  assert.strictEqual(ventas.cuenta.naturaleza, 'acreedora')
  assert.strictEqual(ventas.saldo, 200000) // haber − debe

  // filtro por fecha: solo enero
  const enero = asientos.mayor(db, { empresaId: EMP.id, cuentaId: aliasId('GASTO_ARRIENDO'), hasta: '2026-01-31' })
  assert.strictEqual(enero.saldo, 50000)
})

test('aislamiento: diario y mayor de EMP1 jamás devuelven datos de EMP2', () => {
  // asiento en EMP2
  asientos.crear(db, {
    empresaId: EMP2.id, usuarioId: adminId,
    fecha: '2026-09-01', glosa: 'Asiento EMP2',
    lineas: [
      { cuenta_id: aliasIdEmp2('CAJA'), debe: 1000, haber: 0 },
      { cuenta_id: aliasIdEmp2('CAPITAL'), debe: 0, haber: 1000 },
    ],
  })
  const d1 = asientos.diario(db, { empresaId: EMP.id })
  assert.ok(d1.asientos.every((a) => a.empresa_id === EMP.id))
  const m2 = asientos.mayor(db, { empresaId: EMP2.id, cuentaId: aliasIdEmp2('CAJA') })
  assert.strictEqual(m2.saldo, 1000)
  assert.strictEqual(asientos.obtenerCompleto(db, EMP.id, m2.movimientos[0].id ? m2.movimientos[0].id : 0), null)
})
