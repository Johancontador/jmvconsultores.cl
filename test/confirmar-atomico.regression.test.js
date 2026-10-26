'use strict'
/**
 * Regresión — la confirmación de una propuesta (CONTABILIZACIÓN) es UNA
 * transacción: el asiento y la transición PROPUESTO → CONTABILIZADO comparten
 * destino. Antes el asiento se creaba en su propia tx y los UPDATE de estado
 * en otra: si el guard «carrera de estados» disparaba DESPUÉS de haber creado
 * el asiento, el libro quedaba con un ASIENTO HUÉRFANO sin documento (el lote
 * lo reportaba como omitido y nadie lo revertía) — la misma partición de
 * escritura que el restore corrigió con F-04/F-05.
 *
 * Ejecutar con: node --test test/confirmar-atomico.regression.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-atomica-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const propuestas = require('../backend/core/propuestas')
const asientos = require('../backend/core/asientos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76558585-6', nombre: 'Confirmacion Atomica SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})

const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '76888888-5', razonSocial: 'Proveedor Uno SpA',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-09-10', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})

documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
  documentos: [docCompra(901), docCompra(902)],
})
const cuentaGasto = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'GASTO_ARRIENDO'`).get(EMP.id).id

function propuestaLista(folio) {
  const d = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = ? AND tipo_flujo = 'compra'`).get(EMP.id, String(folio))
  documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaGasto, tratamientoIva: 'credito',
  })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  return { docId: d.id, propuestaId: p.id }
}

const asientosCount = () => db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n

// ---------- CONTROL: confirmación limpia aplica propuesta y crea asiento ----------
test('control: confirmar contabiliza (asiento + estados) — misma transacción, flujo sano', () => {
  const { propuestaId } = propuestaLista(901)
  const antes = asientosCount()

  const r = propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId })
  const total = r.asiento.lineas.reduce((s, l) => s + l.debe, 0)
  assert.strictEqual(total, 119000, 'el asiento cuadrado con el documento')
  assert.strictEqual(asientosCount(), antes + 1, 'se creó exactamente un asiento')

  const p = db.prepare(`SELECT estado, aplicada_asiento_id FROM propuestas WHERE id = ?`).get(propuestaId)
  assert.strictEqual(p.estado, 'APLICADA')
  assert.strictEqual(Number(p.aplicada_asiento_id), Number(r.asiento.id))
  const d = db.prepare(`SELECT estado, asiento_id FROM documentos WHERE id = ?`).get(r.asiento.id ? db.prepare(`SELECT documento_id FROM propuestas WHERE id = ?`).get(propuestaId).documento_id : 0)
  assert.strictEqual(d.estado, 'CONTABILIZADO')
  assert.strictEqual(Number(d.asiento_id), Number(r.asiento.id), 'el documento queda ligado al MISMO asiento (en la misma tx)')
})

// ---------- REGRESIÓN: la carrera de estados NO deja asiento huérfano ----------
test('la «carrera de estados» durante la confirmación no deja asiento huérfano (F-estilo F-04/F-05)', () => {
  const { propuestaId } = propuestaLista(902)
  const antes = asientosCount()

  // Simula el OTRO actor: muta el estado de la propuesta entre la revalidación
  // inicial y los UPDATE finales — exactamente en la ventana que el guard
  // evitaba ya con el código viejo, pero solo el código nuevo la hace atómica.
  const creaOriginal = asientos.crear
  asientos.crear = function (dbArg, args) {
    db.prepare(`UPDATE propuestas SET estado = 'DESCARTADA' WHERE id = ? AND estado = 'PENDIENTE'`).run(propuestaId)
    db.prepare(`UPDATE documentos SET estado = 'CLASIFICADO' WHERE id = ? AND estado = 'PROPUESTO'`).run(args.origen ? docIdDe(propuestaId) : 0)
    return creaOriginal.call(asientos, dbArg, args)
  }
  function docIdDe(pid) {
    return db.prepare(`SELECT documento_id FROM propuestas WHERE id = ?`).get(pid).documento_id
  }

  let fueConfirmado = false
  try {
    propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId })
    fueConfirmado = true
  } catch (err) {
    assert.match(err.message, /carrera de estados|cambió de estado/, 'el guard nomina la carrera')
  } finally {
    asientos.crear = creaOriginal
  }
  assert.strictEqual(fueConfirmado, false, 'la confirmación NO se completó')

  assert.strictEqual(asientosCount(), antes, 'SIN asiento huérfano: el throw rollbokeó el asiento junto con los estados')

  // Los estados terminan en lo que el "otro actor" decidió (nada por parte de
  // la confirmación fallida): no queda propuesta APLICADA fantasma.
  const p = db.prepare(`SELECT estado FROM propuestas WHERE id = ?`).get(propuestaId)
  assert.notStrictEqual(p.estado, 'APLICADA')
})
