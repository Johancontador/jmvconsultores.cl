'use strict'
/**
 * Contacto desde la landing pública (rediseño 2026-10):
 *  T1 — happy path guarda el lead en contactos_web (sin sesión).
 *  T2 — validación server-side: campos faltantes → 400 con detalle.
 *  T3 — honeypot ocupado → success fingido y SIN guardar.
 *  T4 — rate limit 5/hora por IP → la 6ª da 429 con consejo de WhatsApp.
 *  T5 — truncado server-side de longitudes (nombre > 120 chars).
 * Ejecutar con: node --test test/contacto-web.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-contacto-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const express = require('express')
const app = express()
app.use(express.json())
app.set('trust proxy', 1)
app.use('/api/contacto', require('../backend/routes/contacto'))

const server = app.listen(0)
const port = server.address().port

test.after(() => {
  server.close()
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const enviar = (cuerpo, ip = '9.9.9.9') => fetch(`http://127.0.0.1:${port}/api/contacto`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
  body: JSON.stringify(cuerpo),
})

test('T1: happy path — 201 y el lead queda en contactos_web', async () => {
  const r = await enviar({ nombre: 'Ana', empresa: 'Comercial Andes', contacto: '+56912345678', mensaje: 'Necesito contabilidad para mi empresa' })
  assert.strictEqual(r.status, 201)
  const j = await r.json()
  assert.strictEqual(j.ok, true)
  const fila = db.prepare(`SELECT nombre, empresa, contacto, mensaje FROM contactos_web WHERE nombre = 'Ana' AND empresa = 'Comercial Andes'`).get()
  assert.ok(fila, 'lead guardado')
  assert.strictEqual(fila.contacto, '+56912345678')
})

test('T2: campos faltantes → 400 con detalle de cuáles', async () => {
  const r = await enviar({ nombre: 'Beto' })
  assert.strictEqual(r.status, 400)
  const j = await r.json()
  assert.strictEqual(j.ok, false)
  assert.ok(j.error.includes('Empresa') && j.error.includes('Teléfono'))
})

test('T3: honeypot ocupado → éxito fingido y SIN guardado', async () => {
  const r = await enviar({ nombre: 'Bot', empresa: 'Bot Inc', contacto: 'x@y.z', mensaje: 'spam', web: 'relleno-de-bot' })
  assert.strictEqual(r.status, 200)
  const j = await r.json()
  assert.strictEqual(j.ok, true)
  const fila = db.prepare(`SELECT COUNT(*) AS n FROM contactos_web WHERE nombre = 'Bot'`).get()
  assert.strictEqual(fila.n, 0, 'el bot no dejó registro')
})

test('T4: rate limit — la 6ª petición en la hora da 429', async () => {
  // El middleware corre ANTES de la validación: TODO request consume, incluidos
  // el 400 de T2 y el honeypot de T3. Al llegar aquí van 3 de la IP compartida
  // del test; enviamos 3 más: la 1ª y 2ª pasan (4ª, 5ª absolutas) y la 3ª
  // (6ª absoluta) da 429 con el consejo de WhatsApp.
  const r4a = await enviar({ nombre: 'Cuatro', empresa: 'E', contacto: 'c', mensaje: 'm' }, '9.9.9.9')
  assert.strictEqual(r4a.status, 201, '4ª absoluta aún dentro del cupo')
  const r4b = await enviar({ nombre: 'Cinco', empresa: 'E', contacto: 'c', mensaje: 'm' }, '9.9.9.9')
  assert.strictEqual(r4b.status, 201, '5ª absoluta aún dentro del cupo')
  const r6 = await enviar({ nombre: 'Seis', empresa: 'E', contacto: 'c', mensaje: 'm' }, '9.9.9.9')
  assert.strictEqual(r6.status, 429)
  const j6 = await r6.json()
  assert.ok(j6.error.includes('WhatsApp'), 'el 429 sugiere el canal alternativo')
})

test('T5: truncado server-side de longitudes (nombre 150 chars → 120)', async () => {
  const r = await enviar({ nombre: 'N'.repeat(150), empresa: 'Truncadora', contacto: 'c@t.cl', mensaje: 'm' }, '10.10.10.10')
  assert.strictEqual(r.status, 201)
  const fila = db.prepare(`SELECT LENGTH(nombre) AS len FROM contactos_web WHERE empresa = 'Truncadora'`).get()
  assert.strictEqual(fila.len, 120, 'nombre truncado a 120 server-side')
})
