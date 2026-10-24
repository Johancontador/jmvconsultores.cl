'use strict'
/**
 * F8-D — INVARIANTES CONTABLES Y SEGREGACIÓN (datos sintéticos, dos empresas).
 *
 * No prueba "que la API responda 200": fija las propiedades que, si se rompen,
 * producen pérdida o mezcla de información contable:
 *
 *   I1  Un asiento descuadrado se rechaza y NO deja residuo.
 *   I2  Todo asiento persistido cuadra (Σdebe = Σhaber) y los folios son
 *       correlativos sin huecos por empresa/año.
 *   I3  Revertir no duplica: el saldo neto vuelve a cero, la segunda reversión
 *       se rechaza y el asiento original queda enlazado.
 *   I4  Aislamiento: un asiento de otra empresa no existe para esta empresa
 *       (ni en el diario ni por id).
 *   I5  Idempotencia: la misma clave no crea dos asientos.
 *   I6  Período cerrado: no admite asientos nuevos y no inserta nada.
 *   I7  Ingesta RCV: el mismo lote dos veces no duplica documentos.
 *
 * Datos 100 % sintéticos en una BD temporal. Correr con:
 *   node --test test/invariantes-contables.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-inv-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const cuentas = require('../backend/core/cuentas')
const asientos = require('../backend/core/asientos')
const periodos = require('../backend/core/periodos')
const documentos = require('../backend/core/documentos')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76000001-9', nombre: 'Invariantes Uno SpA',
  claveSii: 'clave-sintetica-uno', tasaPpm: 0.01, telefono: '222000001',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '76000002-7', nombre: 'Invariantes Dos Ltda',
  claveSii: 'clave-sintetica-dos', tasaPpm: 0.01, telefono: '222000002',
})

const cta = (empresa, alias) => cuentas.cuentaPorAlias(db, empresa.id, alias).id
const debe = (empresa, alias, monto) => ({ cuenta_id: cta(empresa, alias), debe: monto, haber: 0 })
const haber = (empresa, alias, monto) => ({ cuenta_id: cta(empresa, alias), debe: 0, haber: monto })

function contarAsientos(empresaId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(empresaId).n
}
function contarLineas(empresaId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM asiento_lineas WHERE empresa_id = ?`).get(empresaId).n
}
function descuadreGlobal(empresaId) {
  return db.prepare(`
    SELECT COALESCE(SUM(debe), 0) AS debe, COALESCE(SUM(haber), 0) AS haber
    FROM asiento_lineas WHERE empresa_id = ?
  `).get(empresaId)
}

// ---------------- I1 ----------------

test('I1: un asiento descuadrado se rechaza y no deja residuo', () => {
  const antesAsientos = contarAsientos(EMP.id)
  const antesLineas = contarLineas(EMP.id)

  assert.throws(
    () => asientos.crear(db, {
      empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-15', glosa: 'Descuadrado a propósito',
      lineas: [debe(EMP, 'CAJA', 1000), haber(EMP, 'CAPITAL', 900)],
    }),
    /DESCUADRADO/,
  )

  assert.strictEqual(contarAsientos(EMP.id), antesAsientos, 'no crea el encabezado')
  assert.strictEqual(contarLineas(EMP.id), antesLineas, 'no crea líneas sueltas')
})

test('I1b: un asiento en cero también se rechaza', () => {
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-15', glosa: 'Cero',
    lineas: [debe(EMP, 'CAJA', 0), haber(EMP, 'CAPITAL', 0)],
  }), /cero/)
})

// ---------------- I2 ----------------

test('I2: todo asiento persistido cuadra y los folios son correlativos sin huecos', () => {
  const a1 = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-10', glosa: 'Aporte de capital',
    lineas: [debe(EMP, 'BANCOS', 500000), haber(EMP, 'CAPITAL', 500000)],
  })
  const a2 = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-20', glosa: 'Venta de servicios',
    lineas: [debe(EMP, 'CLIENTES', 119000), haber(EMP, 'VENTAS_SERVICIOS', 100000), haber(EMP, 'IVA_DEBITO', 19000)],
  })

  // Cada asiento, individualmente.
  for (const id of [a1.id, a2.id]) {
    const { lineas } = asientos.obtenerCompleto(db, EMP.id, id)
    const s = lineas.reduce((acc, l) => ({ debe: acc.debe + l.debe, haber: acc.haber + l.haber }), { debe: 0, haber: 0 })
    assert.strictEqual(s.debe, s.haber, `asiento ${id} cuadra`)
    assert.ok(lineas.length >= 2)
  }

  // Global de la empresa.
  const g = descuadreGlobal(EMP.id)
  assert.strictEqual(g.debe, g.haber, `Σdebe ${g.debe} = Σhaber ${g.haber}`)

  // Folios: 1..n sin huecos, por empresa y año.
  const folios = db.prepare(`SELECT folio FROM asientos WHERE empresa_id = ? AND anio = 2026 ORDER BY folio`).all(EMP.id).map((r) => r.folio)
  assert.deepStrictEqual(folios, Array.from({ length: folios.length }, (_, i) => i + 1))
})

// ---------------- I3 ----------------

test('I3: revertir lleva el saldo a cero, no duplica y solo se permite una vez', () => {
  const saldoDe = (alias) => {
    const r = db.prepare(`
      SELECT COALESCE(SUM(al.debe), 0) - COALESCE(SUM(al.haber), 0) AS saldo
      FROM asiento_lineas al WHERE al.empresa_id = ? AND al.cuenta_id = ?
    `).get(EMP.id, cta(EMP, alias))
    return r.saldo
  }

  const saldoAntes = saldoDe('CLIENTES')
  const venta = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-22', glosa: 'Venta a revertir',
    lineas: [debe(EMP, 'CLIENTES', 59500), haber(EMP, 'VENTAS_SERVICIOS', 50000), haber(EMP, 'IVA_DEBITO', 9500)],
  })
  const saldoConVenta = saldoDe('CLIENTES')

  const rev = asientos.revertir(db, { empresaId: EMP.id, usuarioId: adminId, asientoId: venta.id, glosa: 'Anula venta' })
  assert.strictEqual(saldoDe('CLIENTES'), saldoAntes, 'el saldo vuelve al punto de partida')
  assert.strictEqual(saldoConVenta - saldoAntes, 59500, 'la reversión revierte el monto exacto')
  assert.strictEqual(rev.asiento_revertido_id, venta.id, 'queda enlazada al original')

  // El original queda marcado y no se puede revertir dos veces.
  const original = db.prepare(`SELECT * FROM asientos WHERE id = ?`).get(venta.id)
  assert.ok(original, 'el asiento original NO se borra (trazabilidad)')
  assert.throws(
    () => asientos.revertir(db, { empresaId: EMP.id, usuarioId: adminId, asientoId: venta.id }),
    /ya fue revertido|revert/i,
  )

  const g = descuadreGlobal(EMP.id)
  assert.strictEqual(g.debe, g.haber, 'sigue cuadrada tras la reversión')
})

// ---------------- I4 ----------------

test('I4: aislamiento — un asiento de otra empresa no existe para esta empresa', () => {
  const ajeno = asientos.crear(db, {
    empresaId: EMP2.id, usuarioId: adminId, fecha: '2026-09-10', glosa: 'Solo de la empresa dos',
    lineas: [debe(EMP2, 'BANCOS', 7000), haber(EMP2, 'CAPITAL', 7000)],
  })

  assert.strictEqual(asientos.obtenerCompleto(db, EMP.id, ajeno.id), null, 'por id no se cruza')
  const diario = asientos.diario(db, { empresaId: EMP.id, limit: 500 })
  const filas = Array.isArray(diario) ? diario : (diario.asientos || diario.rows || [])
  assert.ok(!filas.some((a) => a.id === ajeno.id), 'el diario no lista asientos de otra empresa')
  const cruzado = descuadreGlobal(EMP.id)
  assert.ok(!cruzado.debe.toString().includes('7000'), 'los totales no absorben la otra empresa')
})

// ---------------- I5 ----------------

test('I5: la misma clave de idempotencia no crea dos asientos', () => {
  const payload = {
    empresaId: EMP2.id, usuarioId: adminId, fecha: '2026-09-12', glosa: 'Centralización externa',
    idempotencia: 'centralizacion-202609-0001',
    lineas: [debe(EMP2, 'BANCOS', 123456), haber(EMP2, 'CAPITAL', 123456)],
  }
  const primero = asientos.crear(db, payload)
  const antes = contarAsientos(EMP2.id)

  let error = null
  try { asientos.crear(db, payload) } catch (e) { error = e }
  assert.ok(error, 'el segundo intento falla')
  assert.strictEqual(error.codigo, 'IDEMPOTENCIA_CONFLICTO')
  assert.strictEqual(contarAsientos(EMP2.id), antes, 'no hay asiento duplicado')
  assert.strictEqual(primero.idempotencia, 'centralizacion-202609-0001')
})

// ---------------- I6 ----------------

test('I6: un período cerrado no admite asientos y no inserta nada', () => {
  const fecha = '2026-08-05'
  const periodo = periodos.periodoDesdeFecha(fecha)
  periodos.obtenerOCrear(db, EMP.id, periodo)
  periodos.cerrar(db, EMP.id, periodo, adminId)

  const antes = contarAsientos(EMP.id)
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha, glosa: 'No debe entrar',
    lineas: [debe(EMP, 'CAJA', 100), haber(EMP, 'CAPITAL', 100)],
  }), /CERRADO/)
  assert.strictEqual(contarAsientos(EMP.id), antes)
})

// ---------------- I7 ----------------

test('I7: el mismo lote RCV dos veces no duplica documentos', () => {
  const lote = [{
    tipoDoc: 33, folio: 9001, rutDoc: '76666666-3', razonSocial: 'Cliente Sintético SpA',
    fechaDocto: '2026-09-18', montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  }]
  const params = { empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202609', documentos: lote }

  const primera = documentos.ingestarBatch(db, params)
  const segunda = documentos.ingestarBatch(db, params)

  assert.strictEqual(primera.insertados, 1, 'la primera ingesta inserta')
  assert.strictEqual(segunda.insertados, 0, 'la segunda no inserta')
  assert.strictEqual(segunda.duplicados, 1, 'la segunda lo cuenta como duplicado')
  const filas = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ? AND folio = '9001'`).get(EMP.id).n
  assert.strictEqual(filas, 1, 'un solo documento en la base')
})
