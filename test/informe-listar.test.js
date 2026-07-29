/**
 * Tests de listarInformesDeBD con filtro por cliente.
 * Ejecutar con: node --test test/informe-listar.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-test-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { listarInformesDeBD } = require('../backend/services/informe')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

function seedCliente(userId, nombre, rut) {
  const info = db
    .prepare(`INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, user_id) VALUES (?, ?, 'x', 0, '900000000', ?)`)
    .run(rut, nombre, userId)
  return info.lastInsertRowid
}

function seedInforme(id, userId, clienteId, clienteNombre) {
  db.prepare(`
    INSERT INTO informes (id, user_id, cliente_id, cliente_nombre, cliente_rut, anio_inicio, anio_fin, mes_inicio, mes_fin, estado, consultas_estimadas, total_meses)
    VALUES (?, ?, ?, ?, '11111111-1', 2026, 2026, 1, 6, 'completado', 12, 6)
  `).run(id, userId, clienteId, clienteNombre)
}

test('listarInformesDeBD sin clienteId devuelve informes de todos los clientes del usuario', () => {
  const userId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const clienteA = seedCliente(userId, 'Cliente A', '76111111-1')
  const clienteB = seedCliente(userId, 'Cliente B', '76222222-2')
  seedInforme('inf-a', userId, clienteA, 'Cliente A')
  seedInforme('inf-b', userId, clienteB, 'Cliente B')

  const todos = listarInformesDeBD(userId, 50, 0)
  const ids = todos.map((i) => i.id)
  assert.ok(ids.includes('inf-a'))
  assert.ok(ids.includes('inf-b'))
})

test('listarInformesDeBD con clienteId solo devuelve informes de ese cliente', () => {
  const userId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const clienteA = seedCliente(userId, 'Cliente C', '76333333-3')
  const clienteB = seedCliente(userId, 'Cliente D', '76444444-4')
  seedInforme('inf-c', userId, clienteA, 'Cliente C')
  seedInforme('inf-d', userId, clienteB, 'Cliente D')

  const soloA = listarInformesDeBD(userId, 50, 0, clienteA)
  assert.strictEqual(soloA.length, 1)
  assert.strictEqual(soloA[0].id, 'inf-c')
})
