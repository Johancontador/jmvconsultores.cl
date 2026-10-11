'use strict'
/**
 * Regresión ISSUE CYESISTEMA1 — el usuario temporal que cambió su clave pero
 * aún no completa el onboarding (RUT + SII) debe poder llegar al onboarding
 * tras re-loguear, no caer en "Sin empresas asignadas" sin salida.
 *
 * El backend garantiza los insumos: /me refleja acceso_contable con empresas:[]
 * y el POST /onboarding/empresa sigue vigente sin cambio de clave pendiente.
 * Aquí se verifica el contrato del backend que la UI usa (login → /me →
 * onboarding rechazado con RUT inválido dice "RUT inválido", NO
 * "sin empresas" ni 403 de marca pendiente).
 *
 * Found by /qa on 2026-10-10
 * Report: .gstack/qa-reports/qa-report-app-jmvconsultores-cl-2026-10-10.md
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-relogin-onb-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { hashPassword } = require('../backend/services/password')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

// Servidor efímero con el router de auth (patrón usuarios-temporales.test.js).
const express = require('express')
const authRouter = require('../backend/routes/auth')
const app2 = express()
app2.use(express.json())
app2.use('/api/auth', authRouter)
const server2 = app2.listen(0)
const base = () => `http://127.0.0.1:${server2.address().port}/api/auth`
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0]

test('re-login de usuario temporal ya sin clave provisional pero sin empresa: /me no ofrece empresas y onboarding sigue disponible', async () => {
  // Clave ya cambiada (debe_cambiar_clave=0) — el estado exacto de CYESISTEMA1.
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave) VALUES (?, ?, 0, 1, 0)`)
    .run('relogin-onb@example.org', hashPassword('SuClaveNueva1'))

  // Cuota limpia: los tests comparten rate_limit SQLite por IP en el MISMO proceso.
  // El req.ip puede ser '::ffff:127.0.0.1' (IPv4-mapped) — limpiar por prefijo.
  db.prepare(`DELETE FROM rate_limit WHERE clave LIKE ?`).run('login:%')

  const rLogin = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    // OJO: RELLOGIN (doble L) era un typo que hacía fallar el login vero
    // RELOGIN — el fold correcto de 'relogin-onb@example.org'.
    body: JSON.stringify({ username: 'RELOGIN-ONB@example.org', password: 'SuClaveNueva1' }),
  })
  assert.strictEqual(rLogin.status, 200)
  const login = await rLogin.json()
  assert.strictEqual(login.user.debe_cambiar_clave, false, 'sin marca pendiente')

  const rMe = await fetch(`${base()}/me`, { headers: { cookie: cookieDe(rLogin) } })
  const me = await rMe.json()
  assert.ok(me.ok)
  // Sin empresas: la UI debe mapear esto → onboarding (no callejón sin salida).
  assert.deepStrictEqual(me.user.acceso_contable.empresas, [])
  assert.strictEqual(me.user.acceso_contable.super_admin, false)

  // El onboarding sigue disponible y VALIDA el RUT (no bloquea por marca de clave).
  const rOnb = await fetch(`${base()}/onboarding/empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieDe(rLogin) },
    body: JSON.stringify({ rut: '12.3', clave_sii: 'xxxxxxxx' }),
  })
  assert.strictEqual(rOnb.status, 400)
  const onb = await rOnb.json()
  assert.match(onb.error, /RUT/i, `el error debe ser RUT inválido, llegó: ${onb.error}`)
})

test('exclusividad: tras onboarding lleno no se re-onboardea (ya tiene empresa)', async () => {
  // Simulación directa del core: un usuario CON asignación activa rechaza re-onboarding.
  const tu = require('../backend/core/usuarios-temporales')
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave) VALUES (?, ?, 0, 1, 0)`)
    .run('relogin-onb-2@example.org', hashPassword('SuClaveNueva1'))
  const uid = db.prepare(`SELECT id FROM users WHERE username = 'relogin-onb-2@example.org'`).get().id
  // Mejoración RUT válida (12345678-5 lo es): la empresa de simulación necesita
  // un rut real para no chocar con normalizarRut si el core lo re-valida.
  const empId = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, 'ReLogin Doce', 'xxxxxx', 1)`).run('11111111-1').lastInsertRowid
  const rolId = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(uid, empId, rolId)

  await assert.rejects(
    () => tu.onboardingEmpresa(db, { usuarioId: uid, rut: '2222222-8', claveSii: 'xxxxxxxx' }),
    /ya tienes empresa/i,
  )
})

test.after(() => { server2.close() })
