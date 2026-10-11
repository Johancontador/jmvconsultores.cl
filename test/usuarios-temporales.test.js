/**
 * Tests ACCESO ADMIN (Fase A) — flujo administrador → usuario temporal →
 * cambio de clave forzado → onboarding de empresa exclusiva.
 *
 * Cobertura:
 *  - generador de clave provisional (pronunciable, ≥10, aleatorio, entropía)
 *  - creación: solo super admin, correo/username único, nace debe_cambiar_clave=1
 *  - auditoría SIN la clave provisional
 *  - la clave provisional verifica contra el hash guardado
 *  - onboarding bloqueado mientras el cambio de clave esté pendiente
 *  - onboarding: RUT inválido, sin clave SII, usuario con empresa previa
 *    (exclusividad: jamás dos), RUT ya registrado
 *  - conclusión del cambio forzado vía /api/auth/password (flujo real):
 *    login entrega debe_cambiar_clave, cambio consecuta la marca y revoca sesiones
 * Ejecutar con: node --test test/usuarios-temporales.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-utemp-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const utemp = require('../backend/core/usuarios-temporales')
const empresas = require('../backend/core/empresas')
const licencias = require('../backend/core/licencias')
const { seccionesDeUsuario } = require('../backend/core/empresas')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

test('clave provisional: 10+ chars, dos dígitos, sin caracteres ambiguos, aleatoria', () => {
  const claves = new Set()
  for (let i = 0; i < 30; i++) {
    const c0 = utemp.generarClaveProvisional()
    assert.ok(c0.length >= 10, `largo ≥ 10 (got ${c0.length})`)
    assert.ok(/\d{2}/.test(c0), 'contiene 2 dígitos seguidos')
    assert.ok(!/[l1I0O]/.test(c0), 'sin l/1/I/0/O ambiguos')
    assert.ok(/^[a-z0-9]+$/.test(c0), 'solo minúsculas y dígitos')
    claves.add(c0)
  }
  assert.ok(claves.size >= 25, 'la generación es aleatoria (30 corridas → casi todas distintas)')
})

test('usuario no-admin no puede crear usuarios temporales', () => {
  // Crear un usuario común y probar con su id.
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('comun1', x'00', 0)`).run()
  assert.throws(() => utemp.crearUsuarioTemporal(db, { adminId: info.lastInsertRowid, username: 'otro@x.cl' }), /super admin/i)
})

test('crear usuario temporal: nace con cambio forzado y auditoría sin la clave', () => {
  const r = utemp.crearUsuarioTemporal(db, { adminId, username: 'Cliente.Chile1@gmail.com' })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.username, 'cliente.chile1@gmail.com') // normalizado minúsculas
  assert.ok(r.clave_provisional.length >= 10)

  const row = db.prepare(`SELECT debe_cambiar_clave, is_admin, activo FROM users WHERE id = ?`).get(r.usuarioId)
  assert.strictEqual(row.debe_cambiar_clave, 1, 'nace con cambio forzado')
  assert.strictEqual(row.is_admin, 0)
  assert.strictEqual(row.activo, 1)

  // la clave provisional verifica contra el hash guardado
  const { verifyPassword } = require('../backend/services/password')
  const hash = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(r.usuarioId).password_hash
  assert.ok(verifyPassword(r.clave_provisional, hash), 'la clave provisional funciona')

  // la clave JAMÁS quedó en la auditoría (consultar filtra por empresa_id;
  // el alta de usuario es global, empresa_id=NULL → consulta directa)
  const registro = db.prepare(
    `SELECT despues_json FROM auditoria WHERE accion = 'usuarios.crear_usuario_temporal' AND entidad_id = ?`
  ).get(String(r.usuarioId))
  assert.ok(registro, 'hay registro de auditoría del alta')
  assert.ok(!JSON.stringify(registro).includes(r.clave_provisional), 'la clave no estaba en la auditoría')

  // duplicado rechazado
  assert.throws(() => utemp.crearUsuarioTemporal(db, { adminId, username: 'cliente.chile1@gmail.com' }), /ya existe/i)
})

test('validación de formulario: correos mal formados rechazados', () => {
  assert.throws(() => utemp.validarFormulario({ username: 'ab' }), /4 caracteres/i)
  assert.throws(() => utemp.validarFormulario({ username: 'do sédos' }), /correo/i)
  assert.throws(() => utemp.validarFormulario({ username: 'x@mal' }), /correo/i)
  assert.strictEqual(utemp.validarFormulario({ username: 'pagos@empresa.cl' }), 'pagos@empresa.cl')
  assert.strictEqual(utemp.validarFormulario({ username: 'Ana_1' }), 'ana_1')
})

test('onboardingEmpresa: bloqueado si debe cambiar clave, RUT malo, sin clave SII, exclusividad', async () => {
  const r = utemp.crearUsuarioTemporal(db, { adminId, username: 'nuevo2@example.org' })
  const uid = r.usuarioId

  // 1) bloqueado mientras la marca siga pendiente (antes de validar RUT)
  await assert.rejects(
    () => utemp.onboardingEmpresa(db, { usuarioId: uid, rut: '76312274-3', claveSii: 'xxxxxx' }),
    /cambiar tu clave/i,
  )

  // el router también la bloquea antes de tocar el SII
  assert.strictEqual(utemp.estadoDeCambio(db, uid), true)

  // Concluimos la marca como lo haría el endpoint real de cambio de clave
  db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(uid)

  // 2) RUT inválido (DV malo)
  await assert.rejects(() => utemp.onboardingEmpresa(db, { usuarioId: uid, rut: '12345678-9', claveSii: 'xxxxxx' }), /RUT inválido/i)

  // 3) sin clave SII
  await assert.rejects(() => utemp.onboardingEmpresa(db, { usuarioId: uid, rut: '76.312.274-3', claveSii: '' }), /clave SII es obligatoria/i)

  // 4)ONUS: exclusividad — un usuario con empresa ya asignada no puede onboarding de otra
  // (empresas.crear usa licencia heredada y rol; usamos seed directo).
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('conempresa', x'00', 0)`).run()
  const uid2 = info.lastInsertRowid
  const rolEmpresa = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
  const rutOtro = '1000000-9' // RUT sintético válido (el validador exige 8-9 chars)
  assert.ok(empresas.validarRut(rutOtro))
  const emp = empresas.crear(db, { usuarioId: adminId, rut: rutOtro, nombre: 'Otra SA', claveSii: 'x'.repeat(10) })
  const empId = typeof emp === 'object' ? emp.id : emp
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`).run(uid2, empId, rolEmpresa)

  const rutDistinta = '2-7'
  await assert.rejects(
    () => utemp.onboardingEmpresa(db, { usuarioId: uid2, rut: '9002000-5', claveSii: 'xxxxxx' }),
    /exclusiva no puede cambiarse|Ya tienes empresa/i,
  )
})

test('RUT ya registrado LINKEA la empresa existente (2026-10-11): sin clave válida del SII no da acceso', async () => {
  const r = utemp.crearUsuarioTemporal(db, { adminId, username: 'nuevo3@example.org' })
  db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(r.usuarioId)
  // usar el RUT existente (Otra SA): la clave SII que llega NO se puede validar
  // (no hay SII real en tests) → el core rechaza con mensaje claro, no crea duplicado
  await assert.rejects(
    () => utemp.onboardingEmpresa(db, { usuarioId: r.usuarioId, rut: '1000000-9', claveSii: 'xxxxxx' }),
    /validar la clave contra el SII|Clave SII incorrecta|ya tiene una empresa/i,
  )
  // Y NO se creó ninguna asignación (el acceso se da solo con credencial probada):
  assert.strictEqual(db.prepare(`SELECT count(*) as n FROM usuario_empresa WHERE usuario_id = ?`).get(r.usuarioId).n, 0)
})

test('integración /api/auth: login entrega debe_cambiar_clave y el cambio de clave lo concluye', async () => {
  const express = require('express')
  const authRouter = require('../backend/routes/auth')

  const app2 = express()
  app2.use(express.json())
  app2.use('/api/auth', authRouter)
  const server2 = app2.listen(0)
  await new Promise((resolve) => server2.on('listening', resolve))
  const base2 = `http://127.0.0.1:${server2.address().port}/api/auth`

  // 1) crear usuario temporal y sesión directa (el admin no participa aquí)
  const mk = utemp.crearUsuarioTemporal(db, { adminId, username: 'apiuser@example.org' })
  const sid = (() => {
    const token = require('crypto').randomBytes(16).toString('hex')
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
      .run(token, mk.usuarioId, new Date(Date.now() + 3600e3).toISOString())
    return token
  })()
  const rNoAdmin = await fetch(`${base2}/usuarios-empresa`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
    body: JSON.stringify({ username: 'otro@example.org' }),
  })
  assert.strictEqual(rNoAdmin.status, 403)

  // 2) /me entrega el flag pendiente
  const rMe = await fetch(`${base2}/me`, { headers: { cookie: `sid=${sid}` } })
  const me = await rMe.json()
  assert.ok(me.ok)
  // /me no entrega el flag — la UI usa /estado tras el login; aquí simulamos login:
  const rLogin = await fetch(`${base2}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'apiuser@example.org', password: mk.clave_provisional }),
  })
  const loginData = await rLogin.json()
  assert.ok(loginData.ok)
  assert.strictEqual(loginData.user.debe_cambiar_clave, true, 'login entrega el flag de cambio forzado')

  // 3) onboarding/empresa bloqueado mientras la marca esté (con nueva sesión)
  const sid2 = rLogin.headers.get('set-cookie').match(/sid=([^;]+)/)[1]
  await fetch(`${base2}/password`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: `sid=${sid2}` },
    body: JSON.stringify({ password_actual: mk.clave_provisional, password_nueva: 'NuevaClaveFuerte1' }),
  })
  // tras el cambio, la marca se concluye:
  const row = db.prepare(`SELECT debe_cambiar_clave FROM users WHERE id = ?`).get(mk.usuarioId)
  assert.strictEqual(row.debe_cambiar_clave, 0, 'el cambio de clave concluye el flag')

  // 4) la sesión vieja (sid2) fue REVOCADA por el cambio de clave
  const rMe2 = await fetch(`${base2}/me`, { headers: { cookie: `sid=${sid2}` } })
  assert.strictEqual(rMe2.status, 401, 'sesión vieja revocada tras cambio de clave')

  // keep-alive de fetch mantiene sockets abiertos: cerrarlos todos para que
  // node --test pueda terminar (sin esto el proceso queda vivo hasta el timeout).
  server2.closeAllConnections?.()
  server2.close()
})
