'use strict'
/**
 * F8-G — SALUD OPERATIVA Y ERRORES SIN FILTRACIÓN.
 *
 * Dos controles que existían mal:
 *
 *  1. `/api/health` respondía SIEMPRE `{ok:true, message:'…API running'}`. El
 *     healthcheck de docker-compose y la espera de `ops/deploy.sh` dependen de
 *     ese endpoint: con la base bloqueada o corrupta el contenedor quedaba
 *     «healthy» y el deploy se declaraba exitoso. Ahora consulta la base y
 *     responde 503 si no puede leerla.
 *
 *  2. El manejador de errores devolvía `err.message` al cliente. En producción
 *     eso filtra internos (SQL, rutas de archivo, detalles de la bóveda). Ahora
 *     responde genérico y deja el detalle en el log.
 *
 * Correr con: node --test test/salud-y-errores.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const { crearHealth } = require('../backend/middleware/health')
const { crearManejadorErrores, MENSAJE_GENERICO } = require('../backend/middleware/errores')

function resFalso() {
  return {
    headersSent: false,
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    setHeader() {},
  }
}

// ---------------- 1) health ----------------

test('H1: health responde 200 y `db:ok` cuando la base responde', () => {
  let consultado = 0
  const db = { prepare: () => ({ get: () => { consultado++; return { uno: 1 } } }) }
  const res = resFalso()
  crearHealth({ db, version: '1.0.0' })({}, res)

  assert.strictEqual(consultado, 1, 'consulta la base en cada health')
  assert.strictEqual(res.statusCode, 200)
  assert.deepStrictEqual(res.body, { ok: true, db: 'ok', version: '1.0.0' })
})

test('H2: health responde 503 y `db:error` cuando la base falla, sin filtrar el error', () => {
  const db = { prepare: () => ({ get: () => { throw new Error('SQLITE_IOERR: disk I/O error at ./data/iva_mensual.db') } }) }
  const res = resFalso()
  const logs = []
  const original = console.error
  // console.error puede recibir varios argumentos: se conservan todos.
  console.error = (...args) => logs.push(args.map((a) => String(a)).join(' '))
  try {
    crearHealth({ db, version: '1.0.0' })({}, res)
  } finally {
    console.error = original
  }

  assert.strictEqual(res.statusCode, 503, 'un contenedor sin base no puede ser healthy')
  assert.deepStrictEqual(res.body, { ok: false, db: 'error', version: '1.0.0' })
  const serializado = JSON.stringify(res.body)
  assert.ok(!/SQLITE|iva_mensual\.db|I\/O/.test(serializado), 'el cuerpo no revela el error interno')
  assert.ok(logs.some((l) => /SQLITE_IOERR/.test(l)), 'el detalle sí queda en el log')
})

test('H3: health responde 503 si no hay conexión de base utilizable', () => {
  for (const db of [null, {}, { prepare: 'no-es-función' }]) {
    const res = resFalso()
    const original = console.error
    console.error = () => {}
    try {
      crearHealth({ db })({}, res)
    } finally {
      console.error = original
    }
    assert.strictEqual(res.statusCode, 503, `db=${JSON.stringify(db)} debe dar 503`)
    assert.strictEqual(res.body.ok, false)
  }
})

// ---------------- 2) manejador de errores ----------------

test('E1: en producción el 500 es genérico y el detalle queda en el log', () => {
  const logs = []
  const req = { method: 'GET', originalUrl: '/api/contable/x' }
  const res = resFalso()
  const err = Object.assign(new Error('no such table: asiento_lineas en ./data/iva_mensual.db'), { stack: 'stack-interno' })

  crearManejadorErrores({ env: { NODE_ENV: 'production' }, log: (m) => logs.push(m) })(err, req, res, () => {})

  assert.strictEqual(res.statusCode, 500)
  assert.deepStrictEqual(res.body, { ok: false, error: MENSAJE_GENERICO })
  assert.ok(!/asiento_lineas|iva_mensual/.test(JSON.stringify(res.body)), 'sin nombres de tabla ni rutas')
  assert.ok(logs.some((l) => /asiento_lineas/.test(l)), 'el log conserva el mensaje real')
  assert.ok(logs.includes('stack-interno'), 'el log conserva la traza')
})

test('E2: fuera de producción el mensaje se conserva (depuración local y tests)', () => {
  const res = resFalso()
  const err = new Error('Período inválido (YYYYMM)')
  crearManejadorErrores({ env: { NODE_ENV: 'development' }, log: () => {} })(err, { method: 'POST', originalUrl: '/x' }, res, () => {})

  assert.strictEqual(res.statusCode, 500)
  assert.strictEqual(res.body.error, 'Período inválido (YYYYMM)')
})

test('E3: si la respuesta ya se envió, delega en next y no escribe dos veces', () => {
  let delegado = null
  const res = resFalso()
  res.headersSent = true
  crearManejadorErrores({ env: { NODE_ENV: 'production' }, log: () => {} })(
    new Error('fallo tardío'), { method: 'GET', originalUrl: '/x' }, res, (e) => { delegado = e },
  )
  assert.ok(delegado instanceof Error, 'delega en Express')
  assert.strictEqual(res.body, null, 'no intenta responder')
})

// ---------------- 3) cableado en el servidor ----------------

test('W1: el servidor desactiva x-powered-by y usa los dos middlewares nuevos', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'index.js'), 'utf8')
  assert.match(src, /app\.disable\('x-powered-by'\)/, 'sin cabecera X-Powered-By (verificado en producción como hallazgo A6)')
  assert.match(src, /middleware\/health'\)\.crearHealth\(\{[\s\S]*?db,/, 'el health recibe la conexión de base')
  assert.match(src, /middleware\/errores'\)\.crearManejadorErrores\(\)/, 'el 500 usa el manejador que no filtra')
  assert.ok(!/error: err\.message/.test(src), 'no queda el manejador viejo devolviendo err.message')
})
