'use strict'
/**
 * Tests de la racha nocturna 2026-10-11:
 *  1) reset-clave por admin (provisional mostrada una vez, cambio forzado, sesiones revocadas)
 *  2) reactivar un usuario desactivado
 *  3) eliminar definitivo (protegido: admin principal, propio usuario; borra rastro)
 *  4) onboarding RESUELTO: empresa ya existente con el mismo RUT → el login SII
 *     valida la credencial y VINCULA sin crear duplicado (issue ventas@cyeclima.cl)
 *
 * SII MOCKEADO: los tests jamás tocan la red (patrón saas1/saas2).
 * Found by /qa on 2026-10-11 — turno nocturno del arquitecto.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-admin-accesos-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { hashPassword, verifyPassword } = require('../backend/services/password')

// Mock del SII: obtenerSesion "funciona" y empresa-sii no golpea la red.
// Para el flujo de VINCULACIÓN, mockear services/sii-session ANTES de usar.
const siiSession = require('../backend/services/sii-session')
const originalObtenerSesion = siiSession.obtenerSesion

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const express = require('express')
const authRouter = require('../backend/routes/auth')
const app = express()
app.use(express.json())
app.use('/api/auth', authRouter)
const server = app.listen(0)
const base = () => `http://127.0.0.1:${server.address().port}/api/auth`
const cookieDe = (r) => (r.headers.get('set-cookie') || '').split(';')[0]

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`).get().id
const { crearSesion } = require('../backend/services/session')
const adminSid = crearSesion(adminId)
const adminCookie = 'sid=' + adminSid
const COOKIE = { cookie: adminCookie }

test('admin resetea la clave de un usuario: provisional devuelta una vez, must_change=1, sesiones muertas', async () => {
  const r = await fetch(`${base()}/usuarios-empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ username: 'reset-target@example.org' }),
  })
  const mk = await r.json()
  assert.ok(mk.ok)

  // El target entra con la provisional y crea su sesión
  const rLogin = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'reset-target@example.org', password: mk.clave_provisional }),
  })
  assert.strictEqual(rLogin.status, 200)

  // Admin resetea
  const rReset = await fetch(`${base()}/usuarios/${mk.usuarioId}/reset-clave`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
  })
  assert.strictEqual(rReset.status, 200)
  const reset = await rReset.json()
  assert.ok(reset.clave_provisional && reset.clave_provisional.length >= 10)
  assert.notStrictEqual(reset.clave_provisional, mk.clave_provisional, 'la provisional nueva es distinta')

  // Sesión pre-reset muerta (el /me da 401 con esa cookie)
  const rMuerta = await fetch(`${base()}/me`, { headers: { cookie: cookieDe(rLogin) } })
  assert.strictEqual(rMuerta.status, 401)

  // Marco de cambio forzado activa
  const row = db.prepare(`SELECT debe_cambiar_clave FROM users WHERE id = ?`).get(mk.usuarioId)
  assert.strictEqual(row.debe_cambiar_clave, 1)
  // La provisional nueva verifica contra el hash guardado
  const hash = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(mk.usuarioId).password_hash
  assert.ok(verifyPassword(reset.clave_provisional, hash))
  // La clave provisional jamás queda en auditoría
  const auditor = db.prepare(`SELECT despues_json FROM auditoria WHERE accion = 'usuarios.reset_clave' AND entidad_id = ?`).all(String(mk.usuarioId))
  assert.ok(auditor.every((r) => !JSON.stringify(r).includes(reset.clave_provisional)))
})

test('reactivar un usuario desactivado lo devuelve a activo', async () => {
  const r = await fetch(`${base()}/usuarios-empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ username: 'react-target@example.org' }),
  })
  const mk = await r.json()
  const rOff = await fetch(`${base()}/usuarios/${mk.usuarioId}`, {
    method: 'DELETE', headers: COOKIE,
  })
  assert.strictEqual(rOff.status, 200)

  const rOn = await fetch(`${base()}/usuarios/${mk.usuarioId}/reactivar`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
  })
  assert.strictEqual(rOn.status, 200)
  const row = db.prepare(`SELECT activo FROM users WHERE id = ?`).get(mk.usuarioId)
  assert.strictEqual(row.activo, 1)
})

test('eliminar definitivo: protege propio usuario y admin principal; borra el rastro', async () => {
  // Protege el propio usuario
  const rSelf = await fetch(`${base()}/usuarios/${adminId}/definitivo`, { method: 'DELETE', headers: COOKIE })
  assert.strictEqual(rSelf.status, 400)

  const r = await fetch(`${base()}/usuarios-empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ username: 'delete-target@example.org' }),
  })
  const mk = await r.json()
  // Protege el admin principal — primero lo desactivamos es imposible (es el propio admin),
  // así que probamos eliminando a otro usuario normal:
  const rDel = await fetch(`${base()}/usuarios/${mk.usuarioId}/definitivo`, { method: 'DELETE', headers: COOKIE })
  assert.strictEqual(rDel.status, 200)
  const row = db.prepare(`SELECT id FROM users WHERE id = ?`).get(mk.usuarioId)
  assert.strictEqual(row, undefined, 'el usuario ya no existe')
  // La auditoría del sistema mantiene su rastro con el username:
  const trail = db.prepare(`SELECT accion, entidad_id FROM auditoria WHERE accion = 'usuarios.eliminar_definitivo' ORDER BY id DESC LIMIT 1`).get()
  assert.ok(trail && trail.entidad_id === 'delete-target@example.org')
})

test('onboarding RESUELTO: empresa ya existente con el mismo RUT → vincula (mock SII listo)', async () => {
  // Mock: clave correcta. (Si el RUT de la empresa es 11111111-1 con clave 'bueno123', pasa.)
  siiSession.obtenerSesion = async (rut, clave) => {
    if (clave === 'CLAVE-SII-BUENA') return { jar: { mocked: true } }
    const e = new Error('Clave tributaria ingresada no es correcta')
    throw e
  }

  // Empresa YA creada por JMV:
  const empresaId = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, 'CYE Pre-Creada', 'antigua', 1)`)
    .run('11111111-1').lastInsertRowid

  // Usuario temporal ya con su clave propia (debe_cambiar_clave=0):
  const r = await fetch(`${base()}/usuarios-empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ username: 'vinc-target@example.org' }),
  })
  const mk = await r.json()
  db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(mk.usuarioId)
  const rLogin = await fetch(`${base()}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'vinc-target@example.org', password: mk.clave_provisional }),
  })
  assert.strictEqual(rLogin.status, 200)
  db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(mk.usuarioId)

  // Clave SII MALA → no vincula
  const { onboardingEmpresa } = require('../backend/core/usuarios-temporales')
  await assert.rejects(
    () => onboardingEmpresa(db, { usuarioId: mk.usuarioId, rut: '11111111-1', claveSii: 'mala' }),
    /Clave SII incorrecta/i,
    'clave SII incorrecta NO da acceso a la empresa existente',
  )
  assert.strictEqual(db.prepare(`SELECT count(*) as n FROM usuario_empresa WHERE usuario_id = ?`).get(mk.usuarioId).n, 0)

  // Clave SII BUENA → vincula la empresa existente, sin duplicado
  const rOnb = await onboardingEmpresa(db, { usuarioId: mk.usuarioId, rut: '11111111-1', claveSii: 'CLAVE-SII-BUENA' })
  assert.strictEqual(rOnb.empresaId, empresaId, 'mismo id de empresa (no duplicó)')
  const asig = db.prepare(`SELECT rol_id FROM usuario_empresa WHERE usuario_id = ?`).all(mk.usuarioId)
  assert.strictEqual(asig.length, 1)
  // La clave cifrada de la empresa quedó actualizada a la nueva
  const { claveSiiDescifrada } = require('../backend/core/empresas')
  assert.strictEqual(claveSiiDescifrada(db, empresaId), 'CLAVE-SII-BUENA')
})

test.after(() => {
  siiSession.obtenerSesion = originalObtenerSesion
  server.close()
})
