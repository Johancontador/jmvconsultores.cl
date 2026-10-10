/**
 * Tests core alertas (Fase 2 onboarding JMV) — reclamadas/pendientes/sync
 * con datos reales de bandeja. Ejecutar: node --test test/alertas.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const dbFile = path.join(os.tmpdir(), `iva-mensual-alertas-${Date.now()}.db`)
process.env.DB_PATH = dbFile
const db = require('../backend/db')
const alertas = require('../backend/core/alertas')
const empresasCore = require('../backend/core/empresas')

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
const rut = `70${crypto.randomInt(1000000, 9999999)}`.slice(0, 8)
const empId = empresasCore.crear(db, { usuarioId: adminId, rut: `${rut}-${calc(rut)}`, nombre: 'Alertas Test SpA', claveSii: 'x'.repeat(8) })
const eid = typeof empId === 'object' ? empId.id : empId

function insertarDoc({ folio, flujo = 'compra', estado = 'PENDIENTE', reclamo = '', total = 119000, fecha = '2025-09-10' }) {
  db.prepare(`INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, razon_social,
    fecha_docto, fecha_reclamo, monto_exento, monto_neto, monto_iva, monto_total, estado, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, 33, ?, '76.111.222-3', 'Contraparte Test', ?, ?, 0, 100000, 19000, ?, ?, '202509', ?)`)
    .run(eid, flujo, String(folio), fecha, reclamo, total, estado, `al-${folio}-${Date.now()}-${crypto.randomInt(999)}`)
}

test('sin datos: resumen en cero y sync nunca', () => {
  const r = alertas.resumen(db, eid)
  assert.strictEqual(r.reclamadas.cantidad, 0)
  assert.strictEqual(r.pendientes.cantidad, 0)
  assert.strictEqual(r.sincronizacion.dias_desde_ultima, null)
  assert.strictEqual(r.sincronizacion.atrasada, true, 'sin datos = atrasada (nunca sincronizado)')
  assert.strictEqual(r.resumen.criticas, 0)
})

test('Fase 2 · reclamadas: fecha_reclamo llena marca crítico con monto en juego', () => {
  insertarDoc({ folio: 1, reclamo: '2025-09-20', total: 119000 })
  insertarDoc({ folio: 2, reclamo: '', total: 238000, flujo: 'venta' })
  const r = alertas.resumen(db, eid)
  assert.strictEqual(r.reclamadas.cantidad, 1)
  assert.strictEqual(r.reclamadas.total, 119000)
  assert.strictEqual(r.resumen.criticas, 1, 'reclamado = crítico')
  const doc = r.reclamadas.documentos[0]
  assert.strictEqual(doc.folio, '1')
  assert.strictEqual(doc.fecha_reclamo, '2025-09-20')
})

test('Fase 2 · pendientes: sin contabilizar vs REVISIÓN separados con montos', () => {
  // Ojo con el estado acumulado del test anterior: folios 1 (reclamado) y 2
  // (venta PENDIENTE) siguen en bandeja y cuentan como sin contabilizar.
  insertarDoc({ folio: 3, estado: 'PENDIENTE', total: 50000 })
  insertarDoc({ folio: 4, estado: 'REVISION', total: 70000 })
  insertarDoc({ folio: 5, estado: 'CONTABILIZADO', total: 999999 }) // invisible
  const r = alertas.resumen(db, eid)
  assert.strictEqual(r.pendientes.cantidad, 4, '1+2+3 pendientes de flujo + 4 en revisión')
  assert.strictEqual(r.pendientes.sin_contabilizar.cantidad, 3, 'folios 1, 2 y 3')
  assert.strictEqual(r.pendientes.sin_contabilizar.monto, 119000 + 238000 + 50000)
  assert.strictEqual(r.pendientes.en_revision.cantidad, 1)
  assert.strictEqual(r.pendientes.en_revision.monto, 70000)
  assert.strictEqual(r.resumen.criticas, 2, 'reclamado + revisión')
})

test('Fase 2 · sincronización: docs recientes → no atrasada; viejos → atrasada', () => {
  // los docs insertados tienen creado_en = ahora → atrasada=false
  const r = alertas.resumen(db, eid)
  assert.strictEqual(r.sincronizacion.atrasada, false)
  // simulamos doc viejo: created_at a 60 días
  db.prepare(`UPDATE documentos SET creado_en = datetime('now','-60 days') WHERE folio = '1' AND empresa_id = ?`).run(eid)
  // aún queda otro doc reciente → sigue no-atrasada (MAX creado_en)
  assert.strictEqual(alertas.sincronizacion(db, eid).atrasada, false)
  db.prepare(`UPDATE documentos SET creado_en = datetime('now','-60 days') WHERE empresa_id = ?`).run(eid)
  assert.strictEqual(alertas.sincronizacion(db, eid).atrasada, true, 'todos a 60 días → atrasada')
})
