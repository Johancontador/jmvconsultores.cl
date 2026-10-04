/**
 * BLOQUE 1 — FASE 4: limpieza de memoria (P2/P3).
 *
 *  - jobs-memoria: TTL 24h, tope de 200 entradas, identidad de objeto
 *    preservada, purga perezosa sin timers.
 *  - Integración: iniciarInforme registra con timestamp y obtenerEstado
 *    mantiene su contrato (sin filtrar el campo interno __ts).
 *  - purgarLimites (rate-limits de auth): purga por ventana + tope duro.
 *
 * Ejecutar con: node --test test/memoria-limpieza.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-memoria-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const jobsMemoria = require('../backend/core/jobs-memoria')

test.after(() => {
  try { require('../backend/db').close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------------- jobs-memoria: unidad ----------------

test('registrar conserva la identidad del objeto y le fija __ts (purgable)', () => {
  const m = new Map()
  const t0 = Date.now()
  const estado = { id: 'x', estado: 'procesando' }
  jobsMemoria.registrar(m, 'x', estado, t0)
  assert.strictEqual(m.get('x'), estado, 'misma referencia (los .catch siguen funcionando)')
  assert.strictEqual(typeof estado.__ts, 'number')
  jobsMemoria.purgar(m, t0)
  assert.ok(m.has('x'), 'fresco: sobrevive a la purga')
})

test('purga elimina entradas más viejas que el TTL y las sin timestamp', () => {
  const m = new Map()
  const t0 = Date.now()
  jobsMemoria.registrar(m, 'viejo', { id: 'viejo' }, t0 - jobsMemoria.TTL_MS - 1)
  jobsMemoria.registrar(m, 'fresco', { id: 'fresco' }, t0)
  m.set('sin-ts', { id: 'sin-ts' }) // fila cruda sin __ts (p. ej. de un deploy previo)
  jobsMemoria.purgar(m, t0)
  assert.ok(!m.has('viejo'), 'vencido por TTL: fuera')
  assert.ok(!m.has('sin-ts'), 'sin timestamp: fuera (no puede quedarse para siempre)')
  assert.ok(m.has('fresco'), 'fresco: dentro')
})

test('tope duro: jamás más de MAX_ENTRADAS; salen los más viejos primero', () => {
  const m = new Map()
  const t0 = Date.now()
  for (let i = 0; i < jobsMemoria.MAX_ENTRADAS + 5; i++) {
    jobsMemoria.registrar(m, `job-${i}`, { id: i }, t0 + i)
  }
  assert.strictEqual(m.size, jobsMemoria.MAX_ENTRADAS)
  assert.ok(!m.has('job-0'), 'los más viejos salen primero')
  assert.ok(!m.has('job-4'))
  assert.ok(m.has(`job-${jobsMemoria.MAX_ENTRADAS + 4}`), 'los recientes quedan')
})

// ---------------- integración: informe ----------------

test('iniciarInforme registra purgable y obtenerEstado mantiene su contrato (sin __ts)', () => {
  const db = require('../backend/db')
  const informe = require('../backend/services/informe')
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

  const { informeId } = informe.iniciarInforme(999999, 2026, 2026, 'resumen', 9, 9, adminId)
  assert.ok(informeId, 'devuelve informeId')

  const est = informe.obtenerEstado(informeId, adminId)
  assert.ok(est, 'el estado del job vivo sigue consultable (contrato intacto)')
  assert.strictEqual(est.id, informeId)
  assert.ok(!('__ts' in est), 'el campo interno de purga NO se filtra por API')
})

// ---------------- rate-limits de auth ----------------

test('purgarLimites: ventana vencida fuera (bajo umbral de tamaño) y tope duro 2000', () => {
  const router = require('../backend/routes/auth')
  const f = router.purgarLimites
  assert.strictEqual(typeof f, 'function', 'helper exportado para tests')

  // Con ≤500 entradas NO purga (comportamiento actual preservado, costo cero):
  const mapaPequeño = new Map()
  const ahora = Date.now()
  const VENTANA = 15 * 60 * 1000
  mapaPequeño.set('ip-vieja', { count: 3, inicio: ahora - VENTANA - 1 })
  f(mapaPequeño, VENTANA, ahora)
  assert.ok(mapaPequeño.has('ip-vieja'), 'bajo umbral no toca nada (misma conducta)')

  // Flood: >500 entradas → las vencidas salen; las frescas quedan
  const mapaFlood = new Map()
  for (let i = 0; i < 600; i++) {
    mapaFlood.set(`vieja-${i}`, { count: 1, inicio: ahora - VENTANA - i - 1 })
  }
  mapaFlood.set('ip-fresca', { count: 1, inicio: ahora })
  f(mapaFlood, VENTANA, ahora)
  assert.ok(!mapaFlood.has('vieja-0'), 'vencidas fuera tras el flood')
  assert.ok(mapaFlood.has('ip-fresca'), 'la fresca queda')

  // Tope duro: 2100 frescas → quedan exactamente 2000
  const mapaTope = new Map()
  for (let i = 0; i < 2100; i++) mapaTope.set(`ip-${i}`, { count: 1, inicio: ahora })
  f(mapaTope, VENTANA, ahora)
  assert.strictEqual(mapaTope.size, 2000, 'tope duro de 2000 entradas')
  assert.ok(!mapaTope.has('ip-0'), 'salen las más viejas (orden de inserción)')
  assert.ok(mapaTope.has('ip-2099'), 'quedan las más nuevas')
})
