/**
 * Tests FASE 1 — Fundación del software contable.
 * Cubre: bóveda AES-256-GCM, RBAC, migración clientes→empresas (1:1 con clave
 * cifrada y asignación de roles), aislamiento multiempresa, períodos y auditoría.
 * Ejecutar con: node --test test/fase1.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase1-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { cifrar, descifrar, esCifrado } = require('../backend/core/boveda')
const { permisosDeRol, tienePermiso, esRolValido, PERMISOS_POR_ROL } = require('../backend/core/permisos')
const { migracionesFase1 } = require('../backend/core/migraciones')
const empresas = require('../backend/core/empresas')
const periodos = require('../backend/core/periodos')
const auditoria = require('../backend/core/auditoria')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Bóveda ----------

test('bóveda: cifra y descifra (roundtrip), formato v1', () => {
  const original = 'miClaveSII-secreta-2026'
  const almacenado = cifrar(original)
  assert.ok(esCifrado(almacenado), 'debe quedar marcado como cifrado')
  assert.ok(almacenado.startsWith('v1:'))
  assert.notStrictEqual(almacenado, original)
  assert.strictEqual(descifrar(almacenado), original)
})

test('bóveda: misma clave produce cifrados distintos (IV aleatorio) pero descifra ambos', () => {
  const a = cifrar('secreto')
  const b = cifrar('secreto')
  assert.notStrictEqual(a, b, 'el IV debe ser aleatorio por cifrado')
  assert.strictEqual(descifrar(a), 'secreto')
  assert.strictEqual(descifrar(b), 'secreto')
})

test('bóveda: valores legacy (texto plano) pasan sin cambio; vacío queda vacío', () => {
  assert.strictEqual(descifrar('clave-sin-cifrar'), 'clave-sin-cifrar')
  assert.strictEqual(cifrar(''), '')
  assert.strictEqual(descifrar(''), '')
  assert.strictEqual(descifrar(null), '')
})

test('bóveda: valor alterado falla la autenticación GCM', () => {
  const almacenado = cifrar('datos')
  const partes = almacenado.split(':')
  partes[3] = partes[3].slice(0, -2) + 'AA' // corromper ciphertext
  assert.throws(() => descifrar(partes.join(':')), /No se pudo descifrar/)
})

// ---------- RBAC ----------

test('RBAC: los 5 roles semilla existen y super_admin tiene todas las capacidades', () => {
  for (const rol of ['super_admin', 'contador', 'admin_empresa', 'auditor', 'tesoreria']) {
    assert.ok(esRolValido(rol), `rol ${rol} debe ser válido`)
    assert.ok(PERMISOS_POR_ROL[rol].length > 0)
  }
  const pSuper = permisosDeRol('super_admin')
  assert.ok(tienePermiso(pSuper, 'asientos:crear'))
  assert.ok(tienePermiso(pSuper, 'usuarios:admin'))
})

test('RBAC: auditor es solo lectura; tesorería no clasifica ni crea asientos', () => {
  const pAud = permisosDeRol('auditor')
  assert.ok(tienePermiso(pAud, 'asientos:ver'))
  assert.ok(!tienePermiso(pAud, 'asientos:crear'))
  assert.ok(!tienePermiso(pAud, 'documentos:clasificar'))

  const pTes = permisosDeRol('tesoreria')
  assert.ok(!tienePermiso(pTes, 'asientos:crear'))
  assert.ok(!tienePermiso(pTes, 'reglas:editar'))
})

// ---------- Migración clientes → empresas ----------

test('migración: clientes existentes se convierten en empresas con clave cifrada y dueño como admin_empresa', () => {
  // Dueño NO admin: el admin global siempre termina como super_admin (pasa de
  // último), así que admin_empresa se verifica con un usuario normal.
  const hash = require('../backend/services/password').hashPassword('dueno123456')
  const duenoId = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('dueno1', ?, 0)`).run(hash).lastInsertRowid
  const info = db.prepare(`
    INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, exento, user_id)
    VALUES ('76111111-6', 'Cliente Migrable SpA', 'clavePlano123', 0.015, '912345678', 0, ?)
  `).run(duenoId)

  migracionesFase1(db)

  const emp = db.prepare(`SELECT * FROM empresas WHERE rut = '76111111-6'`).get()
  assert.ok(emp, 'la empresa debe existir')
  assert.strictEqual(emp.nombre, 'Cliente Migrable SpA')
  assert.ok(esCifrado(emp.clave_sii), 'la clave SII de la empresa debe estar cifrada')
  assert.strictEqual(descifrar(emp.clave_sii), 'clavePlano123')
  assert.strictEqual(emp.tasa_ppm, 0.015)

  const asig = db.prepare(`
    SELECT r.codigo AS rol FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.empresa_id = ?
  `).get(duenoId, emp.id)
  assert.strictEqual(asig.rol, 'admin_empresa', 'el dueño del cliente queda como admin_empresa')
  assert.ok(info.lastInsertRowid > 0)
})

test('migración: es idempotente (re-ejecutar no duplica empresas)', () => {
  migracionesFase1(db)
  const n = db.prepare(`SELECT COUNT(*) AS n FROM empresas`).get().n
  migracionesFase1(db)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM empresas`).get().n, n)
})

test('migración: admin global es super_admin en todas las empresas', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const emp = db.prepare(`SELECT id FROM empresas WHERE rut = '76111111-6'`).get()
  const asig = db.prepare(`
    SELECT r.codigo AS rol FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.empresa_id = ?
  `).get(adminId, emp.id)
  assert.strictEqual(asig.rol, 'super_admin')
})

// ---------- Aislamiento multiempresa ----------

test('aislamiento: un usuario no asignado NO ve la empresa ni puede operarla', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  // usuario normal nuevo
  const hash = require('../backend/services/password').hashPassword('usuario12345')
  const u2 = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('usuario2', ?, 0)`).run(hash).lastInsertRowid

  const visibles = empresas.listarParaUsuario(db, u2)
  assert.strictEqual(visibles.length, 0)
  assert.strictEqual(empresas.rolEnEmpresa(db, u2, db.prepare(`SELECT id FROM empresas WHERE rut='76111111-6'`).get().id), null)
  assert.strictEqual(empresas.obtenerParaUsuario(db, u2, db.prepare(`SELECT id FROM empresas WHERE rut='76111111-6'`).get().id), null)
  // y el admin global sí ve todo
  assert.ok(empresas.listarParaUsuario(db, adminId).length >= 1)
})

test('empresas: crear exige super admin y valida RUT; clave queda cifrada', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const u2 = db.prepare(`SELECT id FROM users WHERE username = 'usuario2'`).get().id

  assert.throws(() => empresas.crear(db, {
    usuarioId: u2, rut: '76222222-1', nombre: 'X', claveSii: 'c', tasaPpm: 0.01, telefono: '912345678',
  }), /super administrador/)

  assert.throws(() => empresas.crear(db, {
    usuarioId: adminId, rut: '1-1', nombre: 'RUT inválido', claveSii: 'c', tasaPpm: 0.01, telefono: '912345678',
  }), /RUT inválido/)

  const e = empresas.crear(db, {
    usuarioId: adminId, rut: '76222222-1', nombre: 'Empresa Nueva Ltda', claveSii: 'secreta2',
    tasaPpm: 0.01, telefono: '912345678', ip: '127.0.0.1',
  })
  assert.ok(e.id > 0)
  const fila = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(e.id)
  assert.ok(esCifrado(fila.clave_sii))
  assert.strictEqual(empresas.claveSiiDescifrada(db, e.id), 'secreta2')
})

test('empresas: RUT duplicado activo rechazado', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  assert.throws(() => empresas.crear(db, {
    usuarioId: adminId, rut: '76222222-1', nombre: 'Duplicada', claveSii: 'c', tasaPpm: 0.01, telefono: '912345678',
  }), /Ya existe/)
})

// ---------- Períodos ----------

test('períodos: creación lazy, exigirAbierto, cerrar y reabrir con motivo', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const empId = db.prepare(`SELECT id FROM empresas WHERE rut = '76222222-1'`).get().id

  const p = periodos.obtenerOCrear(db, empId, '202609')
  assert.strictEqual(p.estado, 'ABIERTO')
  assert.strictEqual(periodos.periodoDesdeFecha('2026-09-15'), '202609')

  periodos.cerrar(db, empId, '202609', adminId)
  const cerrado = db.prepare(`SELECT * FROM periodos_contables WHERE empresa_id=? AND periodo='202609'`).get(empId)
  assert.strictEqual(cerrado.estado, 'CERRADO')
  assert.throws(() => periodos.exigirAbierto(db, empId, '202609'), /CERRADO/)
  assert.throws(() => periodos.cerrar(db, empId, '202609', adminId), /CERRADO|exige/)

  assert.throws(() => periodos.reabrir(db, empId, '202609', adminId, ''), /motivo/)
  periodos.reabrir(db, empId, '202609', adminId, 'ajuste detectado por auditoría')
  assert.strictEqual(db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id=? AND periodo='202609'`).get(empId).estado, 'ABIERTO')

  assert.throws(() => periodos.obtenerOCrear(db, empId, '26-09'), /inválido/)
})

// ---------- Auditoría ----------

test('auditoría: registra quién/qué/cuándo y la consulta filtra por empresa', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const empId = db.prepare(`SELECT id FROM empresas WHERE rut = '76222222-1'`).get().id

  auditoria.registrarAccion(db, {
    empresaId: empId, usuarioId: adminId, accion: 'test.accion',
    entidad: 'empresas', entidadId: empId, antes: { a: 1 }, despues: { a: 2 }, ip: '127.0.0.1',
  })

  const registros = auditoria.consultar(db, { empresaId: empId })
  assert.ok(registros.length >= 1)
  const ultima = registros[0]
  assert.strictEqual(ultima.accion, 'test.accion')
  assert.strictEqual(ultima.username, 'admin') // seeded admin username (BASIC_AUTH_USER)
  assert.ok(ultima.despues_json.includes('"a":2'))

  assert.throws(() => auditoria.registrarAccion(db, { accion: 'sin.usuario', entidad: 'x' }), /usuarioId/)
})

test('aislamiento: asignar rol y revocar (activo=0) cambia el acceso de un usuario', () => {
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const u2 = db.prepare(`SELECT id FROM users WHERE username = 'usuario2'`).get().id
  const empId = db.prepare(`SELECT id FROM empresas WHERE rut = '76222222-1'`).get().id

  empresas.asignarRol(db, { usuarioIdEjecutor: adminId, usuarioIdObjetivo: u2, empresaId: empId, rol: 'auditor' })
  assert.strictEqual(empresas.rolEnEmpresa(db, u2, empId), 'auditor')
  const visibles = empresas.listarParaUsuario(db, u2)
  assert.ok(visibles.some((e) => e.id === empId))

  // revocar: desactivar asignación
  db.prepare(`UPDATE usuario_empresa SET activo = 0 WHERE usuario_id = ? AND empresa_id = ?`).run(u2, empId)
  assert.strictEqual(empresas.rolEnEmpresa(db, u2, empId), null)
  assert.strictEqual(empresas.listarParaUsuario(db, u2).length, 0)
})
