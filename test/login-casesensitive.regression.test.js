// Regression: ISSUE CYESISTEMA — el login comparaba username exacto y rechazaba
// mayúsculas aunque los usuarios temporales nacen en minúsculas.
// Found by /qa on 2026-10-10
// Report: .gstack/qa-reports/qa-report-app-jmvconsultores-cl-2026-10-10.md
'use strict'
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

// BD aislada en tmp (patrón de usuarios-temporales.test.js) para no chocar con
// otras suites que corren en paralelo sobre la BD por defecto.
const dbFile = path.join(os.tmpdir(), `iva-mensual-login-case-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { hashPassword } = require('../backend/services/password')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

// Servidor efímero con solo el router de auth (patrón de usuarios-temporales.test.js).
const express = require('express')
const authRouter = require('../backend/routes/auth')
const app2 = express()
app2.use(express.json())
app2.use('/api/auth', authRouter)
const server2 = app2.listen(0)
const base2 = () => `http://127.0.0.1:${server2.address().port}/api/auth`

test('login acepta username con distinto case que el almacenado (regresión CYESISTEMA)', async () => {
  // Cuota limpia por prefijo (req.ip puede ser '::ffff:127.0.0.1').
  db.prepare(`DELETE FROM rate_limit WHERE clave LIKE ?`).run('login:%')
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave) VALUES (?, ?, 0, 1, 1)`)
    .run('regresion-case-login@example.org', hashPassword('ClaveForte123'))

  const r = await fetch(`${base2()}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'REGRESION-CASE-LOGIN@example.ORG', password: 'ClaveForte123' }),
  })
  assert.strictEqual(r.status, 200, `esperado 200, llegó ${r.status}`)
  const body = await r.json()
  assert.ok(body.user && body.user.debe_cambiar_clave === true, 'el login del usuario temporal entrega el cambio forzado')
})

test('login NO relaja la verificación de clave (case-insensitive solo en el username)', async () => {
  const r = await fetch(`${base2()}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'regresion-case-login@example.org', password: 'clave-equivocada' }),
  })
  assert.strictEqual(r.status, 401, `clave equivocada debe dar 401, llegó ${r.status}`)
})

test('la clave sigue siendo case-sensitive (scrypt): MAYÚS/minúsculas distintos', async () => {
  const r = await fetch(`${base2()}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'REGRESION-CASE-LOGIN@EXAMPLE.ORG', password: 'claveforte123' }),
  })
  assert.strictEqual(r.status, 401, `clave en otro case debe dar 401, llegó ${r.status}`)
})

test.after(() => {
  server2.close()
})
