'use strict'
/**
 * Regresión ISSUE rate-limit-429 (mejora UX): el mensaje del 429 debe incluir
 * el tiempo restante humanizado (minutos/segundos), no un texto estático.
 *
 * Found by /qa on 2026-10-10
 * Report: .gstack/qa-reports/qa-report-app-jmvconsultores-cl-2026-10-10.md
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-rl-msg-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const rl = require('../backend/core/rate-limit-db')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

test('mensajeConReintente: minutos humanizados', () => {
  const m = rl.mensajeConReintente('Demasiados intentos de login.', 15 * 60000)
  assert.ok(/15 minutos/.test(m), `debe mencionar 15 minutos: ${m}`)
  assert.ok(!/reintente_en_ms/.test(m))
})

test('mensajeConReintente: minutos y segundos (< 3 min muestra segundos)', () => {
  const m = rl.mensajeConReintente('Demasiados intentos.', 95000)
  assert.ok(/1 minuto y 35 segundos/.test(m), `formato combinado: ${m}`)
})

test('mensajeConReintente: solo segundos cuando queda poco', () => {
  const m = rl.mensajeConReintente('Demasiados intentos.', 4000)
  assert.ok(/4 segundos/.test(m) && !/minuto/.test(m), `solo segundos: ${m}`)
})

test('mensajeConReintente: sin tiempo restante devuelve el mensaje original', () => {
  assert.strictEqual(rl.mensajeConReintente('Demasiados intentos.', 0), 'Demasiados intentos.')
  assert.strictEqual(rl.mensajeConReintente('Demasiados intentos.', -5), 'Demasiados intentos.')
})

test('integración: el 429 del login lleva el mensaje con minutos incluidos', async () => {
  const express = require('express')
  const authRouter = require('../backend/routes/auth')
  const app2 = express()
  app2.use(express.json())
  // IP sintética: la misma que usará fetch (127.0.0.1) — única para este test.
  app2.use('/api/auth', authRouter)
  const server2 = app2.listen(0)
  await new Promise((resolve) => server2.on('listening', resolve))
  const base = `http://127.0.0.1:${server2.address().port}/api/auth`

  try {
    // Agotar los 5 intentos de login desde 127.0.0.1.
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/login`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nadie-rate-msg@example.org', password: 'mal' }),
      })
    }
    const r6 = await fetch(`${base}/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'nadie-rate-msg@example.org', password: 'mal' }),
    })
    assert.strictEqual(r6.status, 429)
    const body = await r6.json()
    assert.ok(/Podrá intentar de nuevo en/.test(body.error), `error humanizado: ${body.error}`)
    assert.ok(typeof body.reintente_en_ms === 'number' && body.reintente_en_ms > 0)
  } finally {
    server2.close()
  }
})
