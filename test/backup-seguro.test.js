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
const { restaurar, TABLAS_CRITICAS } = require('../backend/core/backup-restaurar')
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

// ---------- guardas destructivas y publicación atómica ----------

const Database = require('better-sqlite3')

// ---------- F-04 / F-05 (audit 2026-10-25) ----------

/** Base SQLite válida pero SIN tablas críticas (fue el hueco de F-04). */
function crearBaseSinCriticas() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-sincrit-'))
  const ruta = path.join(dir, 'origen.db')
  const d = new Database(ruta)
  d.exec(`CREATE TABLE otra_cosa(id INTEGER PRIMARY KEY); INSERT INTO otra_cosa(id) VALUES (1)`)
  d.close()
  return fs.readFileSync(ruta)
}

test('restaurar F-04: backup de 0 bytes se rechaza antes de escribir nada', () => {
  const { dir, base } = crearBackupTemporal(Buffer.alloc(0))
  const destinoDir = path.join(dir, 'vacio')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, 'SENTINELA')

  assert.throws(
    () => restaurar({
      rutaBackup: base + '.db.enc',
      dirDestino: destinoDir,
      claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
      descifrarSii: null,
      sobrescribir: true,
    }),
    /0 bytes/
  )
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'SENTINELA', 'el destino queda intacto')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [], 'sin temporales huérfanos')
})

test('restaurar F-04: base válida sin tablas críticas NO se publica', () => {
  const { dir, base } = crearBackupTemporal(crearBaseSinCriticas())
  const destinoDir = path.join(dir, 'sincriticas')

  const r = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
  })
  assert.strictEqual(r.ok, false, JSON.stringify(r))
  assert.strictEqual(r.integrity, 'ok', 'la ESTRUCTURA puede estar sana y aun así faltar la base del sistema')
  assert.strictEqual(r.publicado, false)
  assert.ok(r.criticas.faltantes.length >= TABLAS_CRITICAS.length - 3, 'reporta las faltantes')
  assert.strictEqual(fs.existsSync(path.join(destinoDir, 'iva_mensual_restaurada.db')), false, 'no se publica una base sin tablas críticas')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [], 'el temporal se borra')
})

test('restaurar F-04: TODAS las tablas críticas existentes → sí publica (control)', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'control-f04')

  const r = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.publicado, true)
  assert.deepStrictEqual(r.criticas.faltantes, [])
})

test('restaurar F-05: el destino que apareció durante la restauración NO se reemplaza', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'carrera')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')

  // Simula la carrera: otro proceso crea el destino DESPUÉS de la guarda
  // inicial, justo antes de la publicación (lo interceptamos en linkSync).
  const linkSyncReal = fs.linkSync
  let plantado = false
  fs.linkSync = function (origen, destinoLink) {
    if (!plantado) {
      plantado = true
      fs.writeFileSync(destinoLink, 'SENTINELA-OTRO-PROCESO')
    }
    return linkSyncReal.call(fs, origen, destinoLink)
  }

  let r
  try {
    r = restaurar({
      rutaBackup: base + '.db.enc',
      dirDestino: destinoDir,
      claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
      descifrarSii: null,
    })
  } finally {
    fs.linkSync = linkSyncReal
  }

  assert.ok(false === r.publicado, JSON.stringify(r))
  assert.match(r.motivo || '', /no se reemplaza/)
  assert.strictEqual(r.ok, true, 'la COPIA es válida: solo la publicación se negó')
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'SENTINELA-OTRO-PROCESO', 'el dato del otro proceso se preserva')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [], 'sin temporales huérfanos')

  // El reemplazo EXPLÍCITO sigue siendo legal (control del comportamiento
  // anterior a F-05 conservado para `sobrescribir:true`)
  const r2 = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
    sobrescribir: true,
  })
  assert.strictEqual(r2.publicado, true)
  assert.strictEqual(fs.readFileSync(destino).subarray(0, 15).toString(), 'SQLite format 3')

  // El reemplazo normal después de una corrida limpia NO confunde a F-05
  const r3 = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
    sobrescribir: true,
  })
  assert.strictEqual(r3.publicado, true)
  fs.rmSync(destinoDir, { recursive: true, force: true })
})

/** Base con las 10 tablas críticas; opcionalmente con una FK rota (huérfana). */
function crearBaseCritica({ violacionFK = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-fk-'))
  const ruta = path.join(dir, 'origen.db')
  const d = new Database(ruta)
  d.pragma('foreign_keys = OFF')
  d.exec(`
    CREATE TABLE users(id INTEGER PRIMARY KEY);
    CREATE TABLE empresas(id INTEGER PRIMARY KEY, clave_sii TEXT);
    CREATE TABLE clientes(id INTEGER PRIMARY KEY, clave_sii TEXT);
    CREATE TABLE auditoria(id INTEGER PRIMARY KEY);
    CREATE TABLE asientos(id INTEGER PRIMARY KEY);
    CREATE TABLE asiento_lineas(id INTEGER PRIMARY KEY);
    CREATE TABLE documentos(id INTEGER PRIMARY KEY);
    CREATE TABLE periodos_contables(id INTEGER PRIMARY KEY);
    CREATE TABLE bancos_cuentas(id INTEGER PRIMARY KEY, empresa_id INTEGER REFERENCES empresas(id));
    CREATE TABLE suscripciones(id INTEGER PRIMARY KEY);
    INSERT INTO users(id) VALUES (1);
    INSERT INTO empresas(id) VALUES (1);
    INSERT INTO clientes(id) VALUES (1);
  `)
  if (violacionFK) d.exec('INSERT INTO bancos_cuentas(id, empresa_id) VALUES (1, 999)')
  d.close()
  return { dir, ruta, contenido: fs.readFileSync(ruta) }
}

test('restaurar: destino ocupado se rechaza por defecto y el archivo queda intacto', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'ocupado')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, 'SENTINELA: dato que no debe perderse')

  assert.throws(
    () => restaurar({ rutaBackup: base + '.db.enc', dirDestino: destinoDir, claveBackup: process.env.BACKUP_ENCRYPTION_KEY, descifrarSii: null }),
    /ya existe/
  )
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'SENTINELA: dato que no debe perderse')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [], 'sin temporales huérfanos')
})

test('restaurar: `sobrescribir` explícito reemplaza y publica con integridad referencial', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'reemplazo')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, 'anterior')

  const r = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
    sobrescribir: true,
  })
  assert.strictEqual(r.ok, true, JSON.stringify(r))
  assert.strictEqual(r.publicado, true)
  assert.strictEqual(r.integrity, 'ok')
  assert.strictEqual(r.foreignKey.ok, true)
  assert.strictEqual(r.foreignKey.violaciones, 0)
  assert.strictEqual(r.tablas.users, 1)
  assert.strictEqual(fs.readFileSync(destino).subarray(0, 15).toString(), 'SQLite format 3')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [])
})

test('restaurar: nunca escribe sobre la BD activa, ni con `sobrescribir`', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  assert.throws(
    () => restaurar({
      rutaBackup: base + '.db.enc',
      dirDestino: dir,
      nombreDestino: 'iva_mensual.db',
      dbPathActivo: path.join(dir, 'iva_mensual.db'),
      claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
      descifrarSii: null,
      sobrescribir: true,
    }),
    /base de datos ACTIVA/
  )
  assert.strictEqual(fs.existsSync(path.join(dir, 'iva_mensual.db')), false, 'no se creó nada en la ruta de la BD activa')
})

test('restaurar: una FK rota no se publica (integrity ok no basta)', () => {
  const { contenido } = crearBaseCritica({ violacionFK: true })
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'fk')

  const r = restaurar({
    rutaBackup: base + '.db.enc',
    dirDestino: destinoDir,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
    descifrarSii: null,
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.publicado, false)
  assert.strictEqual(r.integrity, 'ok', 'la estructura puede estar sana y las FK no')
  assert.ok(r.foreignKey.violaciones >= 1)
  assert.ok(!r.foreignKey.ok)
  assert.strictEqual(fs.existsSync(path.join(destinoDir, 'iva_mensual_restaurada.db')), false, 'no se publica una base inválida')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [], 'el temporal se borra')
})

test('restaurar: corrupción y hash manipulado dejan el destino intacto', () => {
  // 1) Contenido que no es SQLite: falla al abrir y no publica
  const { dir, base } = crearBackupTemporal(Buffer.from('esto no es una base sqlite'))
  const destinoDir = path.join(dir, 'corrupto')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, 'SENTINELA')

  assert.throws(
    () => restaurar({
      rutaBackup: base + '.db.enc',
      dirDestino: destinoDir,
      claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
      descifrarSii: null,
      sobrescribir: true,
    }),
    /not a database/i
  )
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'SENTINELA')
  assert.deepStrictEqual(fs.readdirSync(destinoDir).filter((f) => f.startsWith('.')), [])

  // 2) Hash manipulado: rechazo antes de escribir
  const sano = crearBaseCritica()
  const otro = crearBackupTemporal(sano.contenido)
  const destino2 = path.join(otro.dir, 'hash')
  fs.mkdirSync(destino2)
  fs.writeFileSync(path.join(destino2, 'iva_mensual_restaurada.db'), 'SENTINELA')
  fs.writeFileSync(otro.base + '.db.enc', Buffer.concat([fs.readFileSync(otro.base + '.db.enc'), Buffer.from('x')]))
  assert.throws(
    () => restaurar({
      rutaBackup: otro.base + '.db.enc',
      dirDestino: destino2,
      claveBackup: process.env.BACKUP_ENCRYPTION_KEY,
      descifrarSii: null,
      sobrescribir: true,
    }),
    /Integridad.*FALLIDA/
  )
  assert.strictEqual(fs.readFileSync(path.join(destino2, 'iva_mensual_restaurada.db'), 'utf8'), 'SENTINELA')
})

test('restore-db.js: destino ocupado → exit 1; con --sobrescribir → exit 0 y publica', () => {
  const { contenido } = crearBaseCritica()
  const { dir, base } = crearBackupTemporal(contenido)
  const destinoDir = path.join(dir, 'cli')
  fs.mkdirSync(destinoDir)
  const destino = path.join(destinoDir, 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, 'SENTINELA')

  const entorno = { ...process.env, BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY, DB_PATH: path.join(dir, 'bd-activa.db') }
  const correr = (extra) =>
    require('node:child_process').spawnSync(
      process.execPath,
      ['scripts/restore-db.js', '--backup', base + '.db.enc', '--dest', destinoDir, ...extra],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: entorno }
    )

  const rechazado = correr([])
  assert.strictEqual(rechazado.status, 1, rechazado.stderr)
  assert.match(rechazado.stderr, /ya existe/)
  assert.strictEqual(fs.readFileSync(destino, 'utf8'), 'SENTINELA')

  const aceptado = correr(['--sobrescribir'])
  assert.strictEqual(aceptado.status, 0, aceptado.stderr)
  assert.match(aceptado.stdout, /publicado: sí/)
  assert.match(aceptado.stdout, /integridad referencial: ok/)
  assert.strictEqual(fs.readFileSync(destino).subarray(0, 15).toString(), 'SQLite format 3')
})
