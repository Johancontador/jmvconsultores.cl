/**
 * BLOQUE 1bis — P6: cifrado, manifest y restauración verificada de backups.
 *
 *  - backup-cifrado: round-trip AES-256-GCM (formato JMVBACKUP1), rechazo de
 *    clave incorrecta, sha256 estable.
 *  - backup-restaurar: flujo completo sobre backups temporales (sha256 →
 *    descifrado → escritura aislada → integrity_check → conteos → claves v1).
 *  - backup-db.js (smoke real con la BD de datos): se ejecuta aparte en la
 *    validación de la fase.
 *
 * Ejecutar con: node --test test/backup-seguro.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-bktest-${Date.now()}.db`)
process.env.DB_PATH = dbFile
process.env.SECRETOS_MASTER_KEY = 'a'.repeat(64) // clave de test para claves v1:
process.env.BACKUP_ENCRYPTION_KEY = 'b'.repeat(64) // clave de test para backups

const db = require('../backend/db')
const cifrador = require('../backend/core/backup-cifrado')
const { restaurar } = require('../backend/core/backup-restaurar')
const boveda = require('../backend/core/boveda')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- helpers de backup temporal ----------

function crearBackupTemporal(contenido) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'))
  const base = path.join(dir, 'iva_mensual_test')
  fs.writeFileSync(base + '.db', contenido)
  const sha = cifrador.sha256Buffer(contenido)
  const enc = cifrador.cifrarBuffer(contenido, process.env.BACKUP_ENCRYPTION_KEY)
  fs.writeFileSync(base + '.db.enc', enc)
  fs.writeFileSync(base + '.manifest.json', JSON.stringify({
    archivo: 'iva_mensual_test.db.enc', sha256: cifrador.sha256Buffer(enc),
    tamano_bytes: enc.length, creado_en: new Date().toISOString(),
    formato: 'jmv-backup-v1', cifrado: true, sha256_original: sha,
  }))
  fs.writeFileSync(base + '.sha256', `${cifrador.sha256Buffer(enc)}  iva_mensual_test.db.enc\n`)
  return { dir, base, contenido, sha }
}

// ---------- backup-cifrado ----------

test('cifrado de backup: round-trip exacto y formato JMVBACKUP1', () => {
  const plano = Buffer.from('contenido-de-backup-sqlite-simulado-' + 'x'.repeat(4096))
  const enc = cifrador.cifrarBuffer(plano, process.env.BACKUP_ENCRYPTION_KEY)
  assert.ok(cifrador.esBackupCifrado(enc), 'magic JMVBACKUP1 presente')
  assert.strictEqual(cifrador.descifrarBuffer(enc, process.env.BACKUP_ENCRYPTION_KEY).toString(), plano.toString())
  // IV aleatorio: dos cifrados del mismo plano difieren
  const enc2 = cifrador.cifrarBuffer(plano, process.env.BACKUP_ENCRYPTION_KEY)
  assert.notStrictEqual(enc.toString('hex'), enc2.toString('hex'), 'IV distinto por cifrado')
})

test('cifrado de backup: clave incorrecta o passphrase derivada fallan explícitamente', () => {
  const plano = Buffer.from('datos')
  const enc = cifrador.cifrarBuffer(plano, process.env.BACKUP_ENCRYPTION_KEY)
  assert.throws(() => cifrador.descifrarBuffer(enc, 'c'.repeat(64)), /No se pudo descifrar/)
  // passphrase ≠ hex: derivación scrypt con salt propia de backups
  const encPass = cifrador.cifrarBuffer(plano, 'mi-passphrase-del-vps')
  assert.strictEqual(cifrador.descifrarBuffer(encPass, 'mi-passphrase-del-vps').toString(), 'datos')
  assert.throws(() => cifrador.descifrarBuffer(encPass, 'otra-passphrase'), /No se pudo descifrar/)
  assert.throws(() => cifrador.cifrarBuffer(plano, ''), /no definida/)
})

test('sha256: estable y distinto ante un byte cambiado', () => {
  const a = cifrador.sha256Buffer(Buffer.from('abc'))
  assert.strictEqual(a, cifrador.sha256Buffer(Buffer.from('abc')))
  assert.notStrictEqual(a, cifrador.sha256Buffer(Buffer.from('abd')))
})

// ---------- backup-restaurar ----------

test('restaurar: flujo completo verificado sobre copia aislada (integridad + tablas + claves v1)', async () => {
  // BD de test con datos críticos reales
  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  db.prepare(`INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, exento, user_id)
              VALUES ('77000000-4', 'Cliente Restore', ?, 0.01, '912345678', 0, ?)`)
    .run(boveda.cifrar('clave-restore-real'), adminId)

  // Snapshot del origen con la MISMA API que backup-db.js (backup online de
  // better-sqlite3: incluye lo que aún vive en el WAL — readFileSync directo
  // daría un snapshot incompleto).
  const dirSnap = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-snap-'))
  const snapshot = path.join(dirSnap, 'origen.db')
  const src = require('better-sqlite3')(dbFile, { readonly: true })
  await src.backup(snapshot)
  src.close()

  const { dir, base } = crearBackupTemporal(fs.readFileSync(snapshot))
  const destino = path.join(dir, 'restaurada')

  const r = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destino,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: (v) => boveda.descifrar(v),
    nombreDestino: 'iva_mensual_restaurada.db',
  })

  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.integrity, 'ok')
  assert.ok(r.tablas.users >= 1, 'usuarios presentes')
  assert.ok(r.tablas.clientes >= 1, 'clientes presentes')
  assert.ok(r.tablas.auditoria !== 'inexistente', 'auditoría presente')
  assert.ok(r.claves.clientes_v1 >= 1, 'hay claves v1 en la copia')
  assert.strictEqual(r.claves.descifrables, r.claves.clientes_v1 + r.claves.empresas_v1, 'TODAS las claves v1 descifran con la clave maestra')
  assert.ok(!r.claves.error, 'sin errores de descifrado')
  // La BD real de datos jamás fue tocada (el restore escribe SOLO en destino)
  assert.ok(fs.existsSync(path.join(destino, 'iva_mensual_restaurada.db')))
  fs.rmSync(dirSnap, { recursive: true, force: true })
})

test('restaurar: sha256 manipulado → rechazo; clave incorrecta → rechazo; sin clave → error claro', () => {
  const { dir, base } = crearBackupTemporal(Buffer.from('backup-para-negativos'))

  // 1) Archivo manipulado post-firma: sha256 del manifest no coincide
  fs.writeFileSync(base + '.db.enc', Buffer.concat([fs.readFileSync(base + '.db.enc'), Buffer.from('x')]))
  assert.throws(() => restaurar({
    rutaBackup: base + '.db.enc', dirDestino: path.join(dir, 'r1'),
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY, descifrarSii: null,
  }), /Integridad.*FALLIDA/)

  // 2) Clave incorrecta
  const { base: base2 } = crearBackupTemporal(Buffer.from('otro-backup'))
  assert.throws(() => restaurar({
    rutaBackup: base2 + '.db.enc', dirDestino: path.join(dir, 'r2'),
    claveBackup: 'c'.repeat(64), descifrarSii: null,
  }), /No se pudo descifrar/)

  // 3) Backup cifrado sin clave provista
  const { base: base3 } = crearBackupTemporal(Buffer.from('tercer-backup'))
  assert.throws(() => restaurar({
    rutaBackup: base3 + '.db.enc', dirDestino: path.join(dir, 'r3'),
    claveBackup: null, descifrarSii: null,
  }), /BACKUP_ENCRYPTION_KEY no fue provista/)
})
