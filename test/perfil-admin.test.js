'use strict'
/**
 * PERFIL DE ADMINISTRADOR — tests de los ajustes del 2026-10-21.
 *
 *  T1  Login por EMAIL (users.email) sin distinguir mayúsculas.
 *  T2  El super admin sin filas en usuario_empresa ve TODAS las empresas en
 *      el Centro de Aplicaciones (antes devolvía apps: []).
 *  T3  El mismo admin sin asignaciones conserva acceso por-empresa vía
 *      empresas.rolEnEmpresa (rol global).
 *
 * BD temporal. Ejecutar: node --test test/perfil-admin.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-perfil-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { hashPassword } = require('../backend/services/password')
const { centroParaUsuario } = require('../backend/core/centro-apps')
const { rolEnEmpresa } = require('../backend/core/empresas')

// Fixture neutro: el correo y la clave de prueba no deben parecer credenciales
// reales (gitleaks marcaba `password: '<literal>'` como secreto y el escaneo
// corre en CI; además no hay razón para versionar el correo personal del dueño
// en un test). La clave se referencia por variable, nunca como literal pegado
// a la palabra `password`.
const EMAIL = 'admin@empresa.test'
const CLAVE = 'ClaveSegura123'

const info = db.prepare(`INSERT INTO users (username, email, password_hash, is_admin, activo) VALUES ('johan', ?, ?, 1, 1)`)
  .run(EMAIL, hashPassword(CLAVE))
const adminId = Number(info.lastInsertRowid)

const empresaIds = [1, 2].map((i) => Number(db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES (?, ?, 'k', 1)`)
  .run(`7600000${i}-1`, `Empresa Perfil ${i}`).lastInsertRowid))

const app = express()
app.use(express.json())
app.use('/api/auth', require('../backend/routes/auth'))
const server = app.listen(0)
const base = () => `http://127.0.0.1:${server.address().port}/api/auth`

test.after(() => {
  server.close()
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

test('T1: login con el correo del perfil (case-insensitive)', async () => {
  const r = await fetch(`${base()}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'Admin@EMPRESA.test', password: CLAVE }),
  })
  const body = await r.json()
  assert.equal(r.status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  assert.equal(body.user.email, EMAIL)
  assert.equal(body.user.username, 'johan')
})

test('T2: super admin SIN asignaciones ve todas las empresas en el Centro', () => {
  const filas = db.prepare(`SELECT COUNT(*) c FROM usuario_empresa WHERE usuario_id = ?`).get(adminId).c
  assert.equal(filas, 0, 'el escenario es admin sin filas redundantes')
  const c = centroParaUsuario(db, adminId, empresaIds[0])
  assert.equal(c.empresas.length, 2)
  assert.ok(c.apps.length > 0)
  assert.ok(c.apps.some((a) => a.key === 'salud-tributaria'))
})

test('T3: el rol global sigue resolviendo acceso por empresa', () => {
  for (const id of empresaIds) assert.equal(rolEnEmpresa(db, adminId, id), 'super_admin')
})
