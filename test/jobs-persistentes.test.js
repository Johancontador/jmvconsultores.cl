'use strict'
/**
 * BLOQUE 2 (masterplan) — Persistencia de jobs largos en SQLite.
 *
 * T1 — Ciclo de vida: crear → tomar → checkpoint → completar, con estados
 *      explícitos y exclusión mutua (crear de nuevo devuelve el vivo).
 * T2 — Checkpoint por período: periodosFaltantes tras un reinicio devuelve
 *      solo lo pendiente; errores de período se registran y limpian.
 * T3 — Recuperación tras reinicio sin doble ejecución:
 *      (a) 'ejecutando' con latido fresco NO se toca (proceso dueño vivo).
 *      (b) 'ejecutando' huérfano sin latido → 'pendiente' (re-landizable)
 *          y el limite de reintentos respeta max_intentos.
 *      (c) crear con la misma clave de unicidad no duplica jobs vivos.
 * T4 — Cancelación y límites de reintentos.
 *
 * Ejecutar con: node --test test/jobs-persistentes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-jobs-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const jobsP = require('../backend/core/jobs-persistentes')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ============================ T1 ============================

test('T1: ciclo de vida completo con exclusión mutua por clave de unicidad', () => {
  // (a) crear un job persistente
  const r1 = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '42:202401-202404',
    empresaId: 42,
    usuarioId: 7,
    periodoDesde: '202401',
    periodoHasta: '202404',
  })
  assert.ok(r1.creado, 'crea el job')
  assert.strictEqual(r1.estado, 'pendiente')

  // (b) exclusión mutua: crear de nuevo la MISMA clave devuelve el vivo
  const r2 = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '42:202401-202404',
    empresaId: 42,
    usuarioId: 7,
    periodoDesde: '202401',
    periodoHasta: '202404',
  })
  assert.strictEqual(r2.creado, false, 'no duplica el job vivo')
  assert.strictEqual(r2.id, r1.id, 'devuelve el mismo job vivo')

  // (c) otra clave (otro rango) SÍ crea un job distinto
  const r3 = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '42:202401-202403',
    empresaId: 42,
    usuarioId: 7,
    periodoDesde: '202401',
    periodoHasta: '202403',
  })
  assert.ok(r3.creado, 'clave distinta crea un job nuevo')
  assert.notStrictEqual(r3.id, r1.id)

  // (d) tomar(): pendiente→ejecutando
  const fila = jobsP.tomar(db, r1.id)
  assert.strictEqual(fila.estado, 'ejecutando')
  assert.ok(fila.iniciado_en, 'registra el inicio')

  // (e) doble-ejecución: tomar de nuevo RECHAZA (lock activo)
  assert.throws(() => jobsP.tomar(db, r1.id), /lock activo/)

  // (f) checkpoint + finalizar → completado
  jobsP.checkpointPeriodo(db, r1.id, '202401')
  jobsP.checkpointPeriodo(db, r1.id, '202402')
  const fin = jobsP.finalizar(db, r1.id, 'completado')
  assert.strictEqual(fin.estado, 'completado')
  const xp1 = jobsP.obtener(db, r1.id)
  assert.strictEqual(xp1.estado, 'completado')
  assert.strictEqual(xp1.progreso.periodos_completados.length, 2)
  // BLOQUE 5: completado DENTRO de la ventana de idempotencia (24 h por
  // defecto) bloquea la clave — la sync diaria no re-ejecuta el mismo período
  // en el mismo día. Con ventana=0, sí libera (histórico: re-lanzable siempre).
  const r4 = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '42:202401-202404',
    empresaId: 42,
    usuarioId: 7,
    periodoDesde: '202401',
    periodoHasta: '202404',
  })
  assert.strictEqual(r4.creado, false, 'completado reciente bloquea (ventana de idempotencia)')
  assert.strictEqual(r4.id, r1.id, 'devuelve el hecho')
  const r5 = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '42:202401-202404',
    empresaId: 42,
    usuarioId: 7,
    periodoDesde: '202401',
    periodoHasta: '202404',
    ventanaIdempotenciaMin: 0,
  })
  assert.ok(r5.creado, 'con ventana=0 el completado libera (histórico re-lanzable)')
})

// Regresión del CI (Linux, 2026-10-20): con ventana=0 la comparación
// `terminado_en >= ahora` encontraba un job COMPLETADO en el mismo milisegundo
// y `crear` devolvía ese job; `tomar()` lo rechazaba («ya está completado») y la
// re-corrida moría con 'error'. En Windows el reloj avanzaba entre las dos
// llamadas y el fallo no se veía. Se fija el caso con la BD manipulada, sin
// depender de la velocidad de la máquina.
test('T1b: con ventana=0 un job completado en el MISMO milisegundo no bloquea', () => {
  const r = jobsP.crear(db, {
    tipo: 'historico_rcv', claveUnicidad: '55:202501-202502', empresaId: 55, usuarioId: 7,
    periodoDesde: '202501', periodoHasta: '202502',
  })
  jobsP.tomar(db, r.id)
  jobsP.finalizar(db, r.id, 'completado')

  // El caso exacto que fallaba: terminado_en == ahora (misma marca de tiempo).
  const ahora = new Date().toISOString()
  db.prepare('UPDATE jobs_persistentes SET terminado_en = ? WHERE id = ?').run(ahora, r.id)

  const otra = jobsP.crear(db, {
    tipo: 'historico_rcv', claveUnicidad: '55:202501-202502', empresaId: 55, usuarioId: 7,
    periodoDesde: '202501', periodoHasta: '202502', ventanaIdempotenciaMin: 0,
  })
  assert.ok(otra.creado, 'ventana=0 nunca reutiliza un completado (ni del mismo ms)')
  assert.notStrictEqual(otra.id, r.id, 'el histórico se puede re-lanzar de inmediato')
  assert.doesNotThrow(() => jobsP.tomar(db, otra.id), 'el job nuevo se puede tomar sin chocar con el anterior')

  // La ventana por defecto (24 h) sigue bloqueando: el fix no la aflojó.
  const bloqueado = jobsP.crear(db, {
    tipo: 'historico_rcv', claveUnicidad: '55:202501-202502', empresaId: 55, usuarioId: 7,
    periodoDesde: '202501', periodoHasta: '202502',
  })
  assert.strictEqual(bloqueado.id, otra.id, 'el vivo manda mientras corre')
})

// ============================ T2 ============================

test('T2: checkpoints por período — reanudación pide solo lo faltante', () => {
  const r = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: '77:202401-202406',
    empresaId: 77,
    usuarioId: 9,
    periodoDesde: '202401',
    periodoHasta: '202406',
  })
  const id = r.id
  jobsP.tomar(db, id)

  // Sin checkpoint: faltan los 6
  assert.deepStrictEqual(jobsP.periodosFaltantes(db, id, ['202401', '202402', '202403', '202404', '202405', '202406']),
    ['202401', '202402', '202403', '202404', '202405', '202406'])

  // Checkpoint de los 3 primeros → faltan solo los últimos 3
  jobsP.checkpointPeriodo(db, id, '202401')
  jobsP.checkpointPeriodo(db, id, '202402')
  jobsP.checkpointPeriodo(db, id, '202403')
  assert.deepStrictEqual(jobsP.periodosFaltantes(db, id, ['202401', '202402', '202403', '202404', '202405', '202406']),
    ['202404', '202405', '202406'], 'reanudación pide solo lo que falta')

  // Checkpoint idempotente: repetir el mismo período no duplica
  const n1 = jobsP.checkpointPeriodo(db, id, '202404')
  const n2 = jobsP.checkpointPeriodo(db, id, '202404')
  assert.strictEqual(n1, n2, 'checkpoint repetido es idempotente (4 hechos)')

  // Error de período se registra y el checkpoint posterior lo LIMPIA
  jobsP.errorPeriodo(db, id, '202405', 'SII 500 temporal')
  const xp = jobsP.obtener(db, id)
  assert.strictEqual(xp.progreso.errores['202405'], 'SII 500 temporal', 'error visible en el progreso')
  jobsP.checkpointPeriodo(db, id, '202405')
  const xp2 = jobsP.obtener(db, id)
  assert.ok(!xp2.progreso.errores['202405'], 'el checkpoint limpia el error del período')
})

// ============================ T3 — recuperación ============================

test('T3a: un job ejecutando con latido FRESCO no se toca (dueño vivo)', () => {
  const r = jobsP.crear(db, { tipo: 'sync_diaria', claveUnicidad: 'latido-fresco' })
  jobsP.tomar(db, r.id)

  // latido fresco: actualizamos actualizado_en AHORA
  db.prepare(`UPDATE jobs_persistentes SET actualizado_en = ? WHERE id = ?`).run(new Date().toISOString(), r.id)

  const liberados = jobsP.liberarLocksVencidos(db)
  // puede liberar huérfanos de otros tests pero este job queda intacto:
  const xp = jobsP.obtener(db, r.id)
  assert.strictEqual(xp.estado, 'ejecutando', 'el lock fresco se respeta')
  assert.strictEqual(xp.intentos, 0, 'no cuenta como intento fallido')
  void liberados
})

test('T3b: lock huérfano (crash sin latido) → pendiente, respeta max_intentos', () => {
  const r = jobsP.crear(db, { tipo: 'historico_rcv', claveUnicidad: 'huérfano-1', maxIntentos: 2 })
  const id = r.id
  jobsP.tomar(db, id)
  // simulamos crash: envejecemos el latido más allá del timeout de 30 min
  const viejo = new Date(Date.now() - (jobsP.JOB_LOCK_TIMEOUT_MIN + 5) * 60000).toISOString()
  db.prepare(`UPDATE jobs_persistentes SET actualizado_en = ? WHERE id = ?`).run(viejo, id)

  jobsP.liberarLocksVencidos(db)
  let xp = jobsP.obtener(db, id)
  assert.strictEqual(xp.estado, 'pendiente', 'crash → re-landizable (intento 1/2)')
  assert.strictEqual(xp.intentos, 1)
  assert.match(xp.error, /lock expirado/)

  // Segundo crash: agota los intentos → fallido definitivo
  jobsP.tomar(db, id)
  db.prepare(`UPDATE jobs_persistentes SET actualizado_en = ? WHERE id = ?`).run(viejo, id)
  jobsP.liberarLocksVencidos(db)
  xp = jobsP.obtener(db, id)
  assert.strictEqual(xp.estado, 'fallido', '2do crash agota max_intentos=2')
  assert.ok(xp.terminado_en, 'fallido definitivo tiene terminado_en')
})

test('T3c: recuperación tras reinicio — crear no duplica el pendiente', () => {
  // Mismo escenario que producción: crash → run de recuperación → crear de
  // nuevo el mismo job (los routers lo re-solicitan) NO crea un duplicado.
  const r1 = jobsP.crear(db, { tipo: 'historico_rcv', claveUnicidad: 'reinicio-x', empresaId: 5, usuarioId: 2 })
  jobsP.tomar(db, r1.id)
  jobsP.checkpointPeriodo(db, r1.id, '202401')
  // crash: latido viejo
  const viejo = new Date(Date.now() - (jobsP.JOB_LOCK_TIMEOUT_MIN + 1) * 60000).toISOString()
  db.prepare(`UPDATE jobs_persistentes SET actualizado_en = ? WHERE id = ?`).run(viejo, r1.id)
  jobsP.liberarLocksVencidos(db)

  // El proceso nuevo crea el job con la misma clave → recupera el existente
  // (con su checkpoint intacto) en vez de duplicarlo.
  const r2 = jobsP.crear(db, { tipo: 'historico_rcv', claveUnicidad: 'reinicio-x', empresaId: 5, usuarioId: 2 })
  assert.strictEqual(r2.creado, false, 'recupera el vivo, no duplica')
  assert.strictEqual(r2.id, r1.id)
  const xp = jobsP.obtener(db, r1.id)
  assert.strictEqual(xp.estado, 'pendiente')
  assert.deepStrictEqual(xp.progreso.periodos_completados, ['202401'], 'checkpoint sobrevive al crash+recuperación')
})

// ============================ T4 ============================

test('T4: cancelación y reintento por error con max_intentos', () => {
  // Cancelación: humana, solo si no está completado
  const r = jobsP.crear(db, { tipo: 'sync_diaria', claveUnicidad: 'cancelable' })
  jobsP.tomar(db, r.id)
  jobsP.cancelar(db, r.id, 'cancelado por test')
  const xp = jobsP.obtener(db, r.id)
  assert.strictEqual(xp.estado, 'cancelado')
  assert.match(xp.error, /cancelado por test/)
  assert.throws(() => jobsP.tomar(db, r.id), /cancelado/)
  // re-cancelar un job ya cancelado también rechaza (estado explícito)
  assert.throws(() => jobsP.cancelar(db, r.id), /ya est\D* cancelado/)

  // Reintentos: un job que falla vuelve a 'pendiente' hasta agotar intentos
  const r2 = jobsP.crear(db, { tipo: 'sync_diaria', claveUnicidad: 'reintentos', maxIntentos: 3 })
  jobsP.tomar(db, r2.id)
  let fin = jobsP.finalizar(db, r2.id, 'fallido', 'SII caído')
  assert.match(fin.estado, /pendiente/, 'falla 1/3 → vuelve a pendiente')
  jobsP.tomar(db, r2.id)
  fin = jobsP.finalizar(db, r2.id, 'fallido', 'SII caído 2')
  assert.match(fin.estado, /pendiente/, 'falla 2/3 → pendiente')
  jobsP.tomar(db, r2.id)
  fin = jobsP.finalizar(db, r2.id, 'fallido', 'SII caído 3')
  assert.strictEqual(fin.estado, 'fallido', 'falla 3/3 → fallido definitivo')
  const xp2 = jobsP.obtener(db, r2.id)
  assert.strictEqual(xp2.intentos, 3)
  assert.ok(xp2.terminado_en)
})

test('T5: listar() filtra por tipo/empresa y recorta el limite', () => {
  const lista = jobsP.listar(db, { tipo: 'sync_diaria', limit: 10 })
  assert.ok(Array.isArray(lista))
  for (const j of lista) assert.strictEqual(j.tipo, 'sync_diaria')
  const porEmpresa = jobsP.listar(db, { empresaId: 42 })
  assert.ok(porEmpresa.length >= 1)
  for (const j of porEmpresa) assert.strictEqual(j.empresa_id, 42)
})
