/**
 * BLOQUE 1 (seguridad) — Bóveda de claves SII de clientes legacy.
 *
 * T1 — Migración one-way: plaintext → v1:, idempotente, transaccional,
 *      round-trip verificado, guard de corpus (sin plaintext restante).
 * T2 — Lectores: la integración SII recibe la clave REAL (no v1:), tanto si
 *      la fila está en plaintext legacy como cifrada en la bóveda.
 * T3 — Escritores: POST/PUT /api/clientes persisten v1: y GET jamás expone
 *      la clave por API.
 * T4 — Guard de corpus: COUNT(*) de plaintext = 0 tras la migración.
 *
 * Los tests HTTP montan los routers reales con requireAuth y una sesión
 * válida en la BD temporal (sin dependencias nuevas: express + fetch).
 * Ejecutar con: node --test test/boveda-clientes.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-boveda-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const boveda = require('../backend/core/boveda')
const migraciones = require('../backend/core/migraciones')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

let seq = 0
/** Inserta un cliente de prueba y devuelve su id. RUT único por secuencia. */
function insertarCliente(clave) {
  seq += 1
  const info = db.prepare(`
    INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, exento, user_id)
    VALUES (?, ?, ?, 0.01, '912345678', 0, ?)
  `).run(`7600${String(seq).padStart(4, '0')}-${seq % 10}`, `Cliente Bóveda ${seq}`, clave, adminId)
  return info.lastInsertRowid
}

function claveAlmacenada(id) {
  return db.prepare(`SELECT clave_sii FROM clientes WHERE id = ?`).get(id).clave_sii
}

function contarPlaintext() {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM clientes
    WHERE clave_sii IS NOT NULL AND clave_sii != '' AND clave_sii NOT LIKE 'v1:%'
  `).get().n
}

// ---------- Helper HTTP: routers reales + sesión válida ----------

async function conServidor(montar, pruebas) {
  const { requireAuth } = require('../backend/middleware/requireAuth')
  const app = express()
  app.use(express.json())
  montar(app, requireAuth)
  const server = app.listen(0)
  const port = server.address().port

  const sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(sid, adminId, new Date(Date.now() + 3600e3).toISOString())

  try {
    await pruebas(`http://127.0.0.1:${port}`, { 'content-type': 'application/json', cookie: `sid=${sid}` })
  } finally {
    server.close()
  }
}

// ============================ T1 + T4 ============================

test('T1: migración one-way convierte plaintext→v1:, es idempotente, transaccional y verificada', () => {
  const idLegacy1 = insertarCliente('clave-legacy-uno')
  const idYaCifrada = insertarCliente(boveda.cifrar('ya-cifrada')) // v1: preexistente — no se toca
  const idVacia = insertarCliente('')                              // vacía — no se toca
  const idLegacy2 = insertarCliente('clave-legacy-dos')

  const r = migraciones.migracionesBovedaClientes(db)
  assert.strictEqual(r.migradas, 2, 'debe migrar exactamente las 2 filas plaintext')

  assert.ok(claveAlmacenada(idLegacy1).startsWith('v1:'), 'legacy 1 queda cifrada')
  assert.ok(claveAlmacenada(idLegacy2).startsWith('v1:'), 'legacy 2 queda cifrada')
  assert.ok(claveAlmacenada(idYaCifrada).startsWith('v1:'), 'la ya cifrada sigue v1: (no re-cifrada)')
  assert.strictEqual(boveda.descifrar(claveAlmacenada(idYaCifrada)), 'ya-cifrada', 'la ya cifrada conserva su valor')
  assert.strictEqual(claveAlmacenada(idVacia), '', 'la fila vacía no se toca')

  // Round-trip: la clave real se recupera EXACTA
  assert.strictEqual(boveda.descifrar(claveAlmacenada(idLegacy1)), 'clave-legacy-uno')
  assert.strictEqual(boveda.descifrar(claveAlmacenada(idLegacy2)), 'clave-legacy-dos')

  // Trazabilidad de la migración (§29): un registro en auditoría, sin claves
  const audit = db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'migracion.boveda_clientes'`).get().n
  assert.ok(audit >= 1, 'la migración queda auditada')

  // Idempotente: re-corrida no hace nada
  const r2 = migraciones.migracionesBovedaClientes(db)
  assert.strictEqual(r2.migradas, 0)
  assert.strictEqual(boveda.descifrar(claveAlmacenada(idLegacy1)), 'clave-legacy-uno')

  // T4 (guard de corpus): no queda plaintext en toda la tabla
  assert.strictEqual(contarPlaintext(), 0)
})

test('T1b: la bóveda rechaza ciphertext corrupto y la migración respeta inactivos', () => {
  // El descifrado de un valor v1: corrupto FALLA explícitamente (nunca devuelve
  // basura silenciosa) — protección clave para los lectores del SII.
  assert.throws(() => boveda.descifrar('v1:AAAA:BBBB:CCCC'), /No se pudo descifrar/)

  // La migración cubre TAMBIÉN clientes inactivos: el plaintext de un cliente
  // desactivado no debe sobrevivir en la BD.
  seq += 1
  const idInactivo = db.prepare(`
    INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, exento, activo, user_id)
    VALUES (?, ?, 'clave-inactivo', 0.01, '912345678', 0, 0, ?)
  `).run(`7601${String(seq).padStart(4, '0')}-${seq % 10}`, 'Cliente Inactivo', adminId).lastInsertRowid

  const r = migraciones.migracionesBovedaClientes(db)
  assert.ok(r.migradas >= 1, 'migra también los inactivos')
  assert.ok(claveAlmacenada(idInactivo).startsWith('v1:'), 'el inactivo queda cifrado')
  assert.strictEqual(boveda.descifrar(claveAlmacenada(idInactivo)), 'clave-inactivo')
})

// ============================ T2 ============================

test('T2: /api/sii/probar con cliente_id entrega al SII la clave REAL (no v1:), legacy y cifrada', async () => {
  // Parche ANTES de requerir el router: routes/sii.js hace destructuring de
  // { probarConexion } en el require — la copia captura nuestro stub.
  const siiRcv = require('../backend/services/sii-rcv')
  const recibidas = []
  siiRcv.probarConexion = async (rut, clave) => {
    recibidas.push({ rut, clave })
    return { ok: true, proveedor: 'sii', periodo: '202609', pasos: [] }
  }
  const routerSii = require('../backend/routes/sii')

  await conServidor(
    (app, requireAuth) => app.use('/api/sii', requireAuth, routerSii),
    async (base, headers) => {
      // Cliente en PLAINTEXT legacy (estado pre-migración)
      const idLegacy = insertarCliente('clave-legacy-t2')
      // Cliente YA CIFRADO en la bóveda (estado post-migración)
      const idCifrada = insertarCliente(boveda.cifrar('clave-cifrada-t2'))

      let res = await fetch(`${base}/api/sii/probar`, {
        method: 'POST', headers, body: JSON.stringify({ cliente_id: idLegacy }),
      })
      assert.strictEqual(res.status, 200)

      res = await fetch(`${base}/api/sii/probar`, {
        method: 'POST', headers, body: JSON.stringify({ cliente_id: idCifrada }),
      })
      assert.strictEqual(res.status, 200)

      assert.strictEqual(recibidas.length, 2)
      assert.strictEqual(recibidas[0].clave, 'clave-legacy-t2', 'plaintext legacy llega REAL (fallback tolerante)')
      assert.strictEqual(recibidas[1].clave, 'clave-cifrada-t2', 'v1: de la bóveda llega DESCIFRADA, jamás como v1:')
      assert.ok(!recibidas[1].clave.startsWith('v1:'), 'la integración jamás recibe el formato cifrado')
    }
  )
})

// ============================ T3 ============================

test('T3: POST/PUT /api/clientes persisten v1: y GET jamás expone la clave', async () => {
  const routerClientes = require('../backend/routes/clientes')

  await conServidor(
    (app, requireAuth) => app.use('/api/clientes', requireAuth, routerClientes),
    async (base, headers) => {
      // POST: la clave debe quedar cifrada en BD
      let res = await fetch(`${base}/api/clientes`, {
        method: 'POST', headers,
        body: JSON.stringify({ rut: '76000000-0', nombre: 'Cliente POST', clave_sii: 'nueva-clave-post', tasa_ppm: 0.01, telefono: '912345678' }),
      })
      assert.strictEqual(res.status, 201)
      const { id } = await res.json()
      const fila = claveAlmacenada(id)
      assert.ok(fila.startsWith('v1:'), 'POST persiste v1: (bóveda), no plaintext')
      assert.strictEqual(boveda.descifrar(fila), 'nueva-clave-post')

      // PUT: la clave se re-cifra
      res = await fetch(`${base}/api/clientes/${id}`, {
        method: 'PUT', headers, body: JSON.stringify({ clave_sii: 'clave-actualizada' }),
      })
      assert.strictEqual(res.status, 200)
      const fila2 = claveAlmacenada(id)
      assert.ok(fila2.startsWith('v1:'), 'PUT persiste v1:')
      assert.strictEqual(boveda.descifrar(fila2), 'clave-actualizada')

      // GET (listado): la respuesta JAMÁS incluye la clave ni su nombre de campo
      res = await fetch(`${base}/api/clientes`, { headers })
      assert.strictEqual(res.status, 200)
      const texto = await res.text()
      assert.ok(!texto.includes('clave_sii'), 'GET no expone la clave ni el campo')
      assert.ok(!texto.includes('v1:'), 'GET no expone el ciphertext')
    }
  )
})

// ============================ T4 (guard global) ============================

test('T4: guard de corpus — ninguna fila de clientes queda en plaintext tras la migración', () => {
  // Sembramos un plaintext tardío y lo migramos: el guard es estable ante
  // cualquier fila que apareciera entre boot y boot (incluye la legacy de T2).
  insertarCliente('tardía-post-boot')
  assert.ok(contarPlaintext() >= 1)
  migraciones.migracionesBovedaClientes(db)
  assert.strictEqual(contarPlaintext(), 0)
})
