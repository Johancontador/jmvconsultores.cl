'use strict'
/**
 * BLOQUE 3 (masterplan) — Rate-limits en SQLite.
 *
 * T1 — ventana+count: se agota, da 429-lógico, reinicia al vencer la ventana.
 * T2 — PERSISTENCIA tras "reinicio": un proceso nuevo con la MISMA BD sigue
 *      contando (no se resetea el contador de fuerza bruta con un crash).
 * T3 — claves independientes por scope+IP.
 * T4 — purga de vencidos.
 *
 * Ejecutar con: node --test test/rate-limit-db.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-rl-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const rl = require('../backend/core/rate-limit-db')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

test('T1: ventana+count — se agota en el límite y reinicia con ventana nueva', () => {
  const base = Date.now()
  // límite 3, ventana 1000 ms
  let r = rl.consumir(db, { clave: 'login:1.2.3.4', limite: 3, ventanaMs: 1000, ahora: base })
  assert.ok(r.permitido)
  r = rl.consumir(db, { clave: 'login:1.2.3.4', limite: 3, ventanaMs: 1000, ahora: base + 1 })
  assert.ok(r.permitido)
  r = rl.consumir(db, { clave: 'login:1.2.3.4', limite: 3, ventanaMs: 1000, ahora: base + 2 })
  assert.ok(r.permitido)
  assert.strictEqual(r.restantes, 0)

  // 4to intento DENTRO de la ventana: bloqueado
  r = rl.consumir(db, { clave: 'login:1.2.3.4', limite: 3, ventanaMs: 1000, ahora: base + 3 })
  assert.strictEqual(r.permitido, false)
  assert.ok(r.reset_en_ms > 0 && r.reset_en_ms <= 1000)

  // tras VENCER la ventana: de nuevo permitido (count reinicia)
  r = rl.consumir(db, { clave: 'login:1.2.3.4', limite: 3, ventanaMs: 1000, ahora: base + 1500 })
  assert.ok(r.permitido, 'ventana vencida reinicia')
  assert.strictEqual(r.restantes, 2)
})

test('T2: persistencia — un "nuevo proceso" con la misma BD conserva el contador', () => {
  // Simula: agotar los 5 intentos de login y "crashear".
  const base = Date.now()
  for (let i = 0; i < 5; i++) {
    const r = rl.consumir(db, { clave: 'login:5.6.7.8', limite: 5, ventanaMs: 15 * 60000, ahora: base + i })
    assert.ok(r.permitido, `intento ${i + 1} permitido`)
  }
  // El atacante fuerza un crash del servidor → proceso nuevo, misma BD.
  // (la tabla ya está en disco: LiteFileSync — same db handle does the job)
  const r = rl.consumir(db, { clave: 'login:5.6.7.8', limite: 5, ventanaMs: 15 * 60000, ahora: base + 10 })
  assert.strictEqual(r.permitido, false, 'el 6to intento sigue bloqueado tras el "crash"')
  assert.strictEqual(r.reset_en_ms > 0, true)
})

test('T3: claves independientes (scope e IP aislados)', () => {
  const base = Date.now()
  // distinta IP → propio contador
  let r = rl.consumir(db, { clave: 'login:9.9.9.9', limite: 1, ventanaMs: 60000, ahora: base })
  assert.ok(r.permitido)
  r = rl.consumir(db, { clave: 'login:9.9.9.9', limite: 1, ventanaMs: 60000, ahora: base + 1 })
  assert.strictEqual(r.permitido, false, 'misma IP agotada')
  // misma IP, otro scope → permitido
  r = rl.consumir(db, { clave: 'registro:9.9.9.9', limite: 1, ventanaMs: 60000, ahora: base + 2 })
  assert.ok(r.permitido, 'otro scope no hereda el bloqueo')
})

test('T4: purga de vencidos borra solo lo antiguo', () => {
  const base = Date.now()
  rl.consumir(db, { clave: 'old:x', limite: 5, ventanaMs: 1000, ahora: base - 10 * 3600e3 })
  rl.consumir(db, { clave: 'fresh:x', limite: 5, ventanaMs: 60000, ahora: base })
  const borrados = rl.limpiarVencidos(db, base)
  assert.ok(borrados >= 1, 'borró la entrada vieja')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM rate_limit WHERE clave = 'fresh:x'`).get().n, 1, 'conserva la fresca')
})

test('T5: e2e — el middleware SQLite bloquea el login 6/5 con 429 HTTP real', async () => {
  const express = require('express')
  const { requireAuth } = require('../backend/middleware/requireAuth')
  const routerAuth = require('../backend/routes/auth')
  const app = express()
  app.use(express.json())
  app.set('trust proxy', 1)
  app.use('/api/auth', routerAuth)
  const server = app.listen(0)
  const port = server.address().port

  try {
    // 5 intentos fallidos (credenciales malas) → el 6º da 429 SIN llegar a verifyPassword
    let lastStatus = null
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nadie', password: 'mal' }),
      })
      lastStatus = res.status
    }
    assert.strictEqual(lastStatus, 429, 'el 6º intento de login con límite 5 devuelve 429')
  } finally {
    server.close()
  }
})
