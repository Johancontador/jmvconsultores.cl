/**
 * BLOQUE 1bis — P5: POST /api/auth/password (T6a–T6g).
 *
 *  T6a password actual incorrecta → 401
 *  T6b password correcta → cambio exitoso (hash nuevo en BD)
 *  T6c la nueva password funciona (login)
 *  T6d la password anterior deja de funcionar
 *  T6e TODAS las sesiones del usuario revocadas (la actual incluida)
 *  T6f password < 8 → rechazo
 *  T6g passwords jamás aparecen en respuestas ni en auditoría
 *
 * HTTP real (express + fetch, sin dependencias nuevas).
 * Ejecutar con: node --test test/password.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-pass-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { verifyPassword } = require('../backend/services/password')
const routerAuth = require('../backend/routes/auth')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const PASS_VIEJA = 'Password01'
const PASS_NUEVA = 'NuevaClave99'

let userId, sid

function crearSesion() {
  sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(sid, userId, new Date(Date.now() + 3600e3).toISOString())
}

const app = express()
app.use(express.json())
app.use('/api/auth', routerAuth)
const server = app.listen(0)
const port = server.address().port
const base = `http://127.0.0.1:${port}`

test.after(() => server.close())

test('setup: usuario de prueba con sesión válida', () => {
  const { hashPassword } = require('../backend/services/password')
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('passuser', ?, 0)`)
    .run(hashPassword(PASS_VIEJA))
  userId = info.lastInsertRowid
  crearSesion()
  assert.ok(sid)
})

test('T6a: password actual incorrecta → 401, sin cambiar nada', async () => {
  const r = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
    body: JSON.stringify({ password_actual: 'Incorrecta99', password_nueva: PASS_NUEVA }),
  })
  assert.strictEqual(r.status, 401)
  const hash = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId).password_hash
  assert.ok(verifyPassword(PASS_VIEJA, hash), 'el hash no cambió')
})

test('T6f: password nueva < 8 caracteres → 400', async () => {
  const r = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
    body: JSON.stringify({ password_actual: PASS_VIEJA, password_nueva: 'corta' }),
  })
  assert.strictEqual(r.status, 400)
  const body = await r.json()
  assert.ok(/8 caracteres/.test(body.error))
})

test('T6b: password correcta → cambio exitoso con hash nuevo', async () => {
  const r = await fetch(`${base}/api/auth/password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
    body: JSON.stringify({ password_actual: PASS_VIEJA, password_nueva: PASS_NUEVA }),
  })
  assert.strictEqual(r.status, 200)
  const body = await r.json()
  assert.ok(body.ok)
  const hash = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(userId).password_hash
  assert.ok(verifyPassword(PASS_NUEVA, hash), 'el hash en BD corresponde a la NUEVA')
  assert.ok(!verifyPassword(PASS_VIEJA, hash), 'la anterior ya no valida')

  // T6g (parcial): la respuesta jamás contiene las contraseñas
  const texto = JSON.stringify(body)
  assert.ok(!texto.includes(PASS_VIEJA) && !texto.includes(PASS_NUEVA))

  // T6e: TODAS las sesiones del usuario revocadas (la actual incluida)
  const n = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?`).get(userId).n
  assert.strictEqual(n, 0)
  // Y la sesión usada ya no autentica
  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie: `sid=${sid}` } })
  assert.strictEqual(me.status, 401)

  // T6g: la auditoría registra el evento SIN secretos
  const audit = db.prepare(`SELECT despues_json FROM auditoria WHERE accion = 'usuario.password_cambiar' ORDER BY id DESC LIMIT 1`).get()
  assert.ok(audit, 'el cambio queda auditado')
  assert.ok(!JSON.stringify(audit).includes(PASS_VIEJA) && !JSON.stringify(audit).includes(PASS_NUEVA))
  assert.ok(/sesiones_revocadas/.test(audit.despues_json))
})

test('T6c: la nueva password funciona para login', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'passuser', password: PASS_NUEVA }),
  })
  assert.strictEqual(r.status, 200)
})

test('T6d: la password anterior deja de funcionar', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'passuser', password: PASS_VIEJA }),
  })
  assert.strictEqual(r.status, 401)
})
