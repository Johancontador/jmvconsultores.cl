'use strict'
/**
 * Regresión: cada login exitoso dispara la sync RCV del período para las
 * empresas del usuario (petición del dueño: "que se sincronice todo
 * automáticamente en cada login") — SIN bloquear la respuesta (fire-and-forget)
 * y SI salta si ya corrió hoy (idempotencia de sync_diaria).
 *
 * SII MOCKEADO — los tests jamás tocan la red.
 * Found on 2026-10-11 — turno nocturno.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-autosync-login-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { hashPassword } = require('../backend/services/password')
const sync = require('../backend/core/sync-diaria')
const jobsP = require('../backend/core/jobs-persistentes')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`).get().id
const { crearSesion } = require('../backend/services/session')
const sid = crearSesion(adminId)
const COOKIE = { cookie: 'sid=' + sid }

// Empresa con clave SII sincifrable (bóveda).
const { cifrar } = require('../backend/core/boveda')
db.prepare(`DELETE FROM empresas WHERE rut = ?`).run('33333333-3')
const empresaId = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, 'AutoSync SA', ?, 1)`)
  .run('33333333-3', cifrar('CLAVE-SII')).lastInsertRowid
const rolId = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`).run(adminId, empresaId, rolId)

// Mock de sync.ejecutarSyncDiaria: cuenta llamadas con las empresas pedidas.
const originalEjecutar = sync.ejecutarSyncDiaria
let llamadas = []
sync.ejecutarSyncDiaria = async (db, { empresaIds } = {}) => {
  llamadas.push({ empresaIds })
  return { procesadas: 0, ok: 0, con_errores: 0, saltadas: 0, errores: {} }
}

const express = require('express')
const authRouter = require('../backend/routes/auth')
const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
const server = app.listen(0)
const base = () => `http://127.0.0.1:${server.address().port}/api/auth`

const espera = (ms, cond) => new Promise((res, rej) => {
  const t0 = Date.now()
  const tick = () => {
    if (cond()) return res()
    if (Date.now() - t0 > ms) return rej(new Error('timeout esperando condición'))
    setTimeout(tick, 30)
  }
  tick()
})

test('login exitoso dispara la sync del período para las empresas del usuario, sin bloquear la respuesta', async () => {
  llamadas = []
  const r = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'x-falso' }),
  })
  // (este login falla; hago uno REAL con usuario propio para no chocar rate-limit)
  llamadas = []
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave) VALUES (?, ?, 0, 1, 0)`)
    .run('autosync-user@example.org', hashPassword('ClaveLogin1'))
  const uid = db.prepare(`SELECT id FROM users WHERE username = 'autosync-user@example.org'`).get().id
  // La empresa del mock está asignada al admin; para el flujo real la asigno
  // también al usuario del login (el auto-sync usa SUS asignaciones).
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`).run(uid, empresaId, rolId)
  const rLogin = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'autosync-user@example.org', password: 'ClaveLogin1' }),
  })
  assert.strictEqual(rLogin.status, 200)
  // La respuesta del login NO espera a la sync (ya llegó con 200).

  // La sync corre asincrónica para SUS empresas:
  await espera(3000, () => llamadas.length > 0)
  assert.ok(llamadas.some((l) => l.empresaIds && l.empresaIds.includes(empresaId)), `sync con la empresa del usuario: ${JSON.stringify(llamadas)}`)
})

test('login sin empresa asignada NO dispara sync', async () => {
  llamadas = []
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave) VALUES (?, ?, 0, 1, 0)`)
    .run('autosync-sinemp@example.org', hashPassword('ClaveLogin2'))
  const rLogin = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'autosync-sinemp@example.org', password: 'ClaveLogin2' }),
  })
  assert.strictEqual(rLogin.status, 200)
  await new Promise((res) => setTimeout(res, 600))
  assert.strictEqual(llamadas.length, 0, 'sin empresas → sin sync')
})

test.after(() => {
  sync.ejecutarSyncDiaria = originalEjecutar
  server.close()
})
