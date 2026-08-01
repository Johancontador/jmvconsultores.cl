/**
 * Guardas de esquema — detectan si vuelve a aparecer el bug de la FK rota
 * de "procesos" (apuntaba a "clientes_old_migracion" tras la migración de
 * rut UNIQUE, ver backend/db.js). También valida que un INSERT real en
 * "procesos" no reviente con foreign_keys=ON, que es justo lo que rompía
 * en producción.
 * Ejecutar con: node --test test/db-schema.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-test-schema-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

test('ninguna tabla referencia "clientes_old_migracion" (tabla de migración transitoria)', () => {
  const filas = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE sql LIKE '%clientes_old_migracion%'`)
    .all()
  assert.deepStrictEqual(filas, [], `Tablas con FK rota: ${filas.map((f) => f.name).join(', ')}`)
})

test('foreign_key_check no reporta violaciones tras inicializar el esquema', () => {
  const violaciones = db.prepare('PRAGMA foreign_key_check').all()
  assert.deepStrictEqual(violaciones, [])
})

test('INSERT en procesos con foreign_keys=ON no revienta (regresión bug FK clientes_old_migracion)', () => {
  db.pragma('foreign_keys = ON')
  const userId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const clienteInfo = db
    .prepare(`INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, user_id) VALUES ('76999999-9', 'Cliente Test FK', 'x', 0, '900000000', ?)`)
    .run(userId)

  assert.doesNotThrow(() => {
    db.prepare(
      `INSERT INTO procesos (periodo, cliente_id, ventas_neto, estado) VALUES (?, ?, ?, ?)`
    ).run('202601', clienteInfo.lastInsertRowid, 1000, 'ok')
  })
})
