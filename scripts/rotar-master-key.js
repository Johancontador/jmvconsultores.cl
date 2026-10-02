/**
 * Recifrado de la bóveda — rotación de SECRETOS_MASTER_KEY (ops de deploy).
 *
 * Contexto: entornos que arrancaron sin SECRETOS_MASTER_KEY cifraron las
 * claves SII con el fallback de desarrollo (core/boveda.js). Al definir la
 * variable en producción esos secretos dejan de descifrarse. Este script hace
 * la rotación segura EN EL PROPIO SERVIDOR:
 *
 *   1. Descifra cada valor `v1:…` de empresas.clave_sii y clientes.clave_sii
 *      con el fallback conocido (hardcodeado aquí — es constante pública en
 *      el código, su valor nunca fue secreto).
 *   2. Re-cifra con la key NUEVA pasada por env ROTAR_NUEVA_KEY (64 hex),
 *      sin imprimirla jamás por stdout.
 *   3. Backup previo de la BD obligatorio (misma carpeta data/backups).
 *   4. Todo en UNA transacción: o rota completa o no rota nada.
 *
 * Uso EN EL VPS (desde la carpeta de la app, con docker compose):
 *
 *   ROTAR_NUEVA_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
 *   docker compose run --rm -e ROTAR_NUEVA_KEY iva-mensual node scripts/rotar-master-key.js
 *
 * Después de un run exitoso: agregar SECRETOS_MASTER_KEY=<la misma key> al
 * .env y `docker compose up -d` (recreate). Verificación: probar conexión SII
 * de una empresa desde la app (Integraciones → probar).
 *
 * Idempotente: los valores ya cifrados con la key NUEVA no se tocan (se
 * detecta intentando descifrar con la nueva primero).
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'production'
const crypto = require('crypto')

// Misma derivación que core/boveda.js usa con el fallback de desarrollo.
const SALT_APP = 'jmv-iva-mensual-boveda-v1'
const FALLBACK_KEY = crypto.scryptSync('iva-mensual-fallback-dev', SALT_APP, 32)

const NUEVA = (process.env.ROTAR_NUEVA_KEY || '').trim()
if (!/^[0-9a-fA-F]{64}$/.test(NUEVA)) {
  console.error('ERROR: exporta ROTAR_NUEVA_KEY (64 hex) antes de correr este script.')
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  process.exit(1)
}
const nuevaKey = Buffer.from(NUEVA, 'hex')

const db = require('../backend/db')
const boveda = require('../backend/core/boveda')

function descifrarCon(valor, key) {
  const [, ivB64, tagB64, ctB64] = String(valor).split(':')
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  d.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ctB64, 'base64')), d.final()]).toString('utf8')
}

function cifrarCon(texto, key) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(String(texto), 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

function yaEstaConKeyNueva(valor) {
  try {
    descifrarCon(valor, nuevaKey)
    return true
  } catch {
    return false
  }
}

const empresas = db.prepare(`SELECT id, clave_sii FROM empresas WHERE clave_sii LIKE 'v1:%'`).all()
const clientes = db.prepare(`SELECT id, clave_sii FROM clientes WHERE clave_sii LIKE 'v1:%'`).all()
const total = empresas.length + clientes.length

if (total === 0) {
  console.log('No hay secretos cifrados v1: nada que rotar.')
  process.exit(0)
}

console.log(`Secretos cifrados detectados: ${empresas.length} empresas + ${clientes.length} clientes = ${total}`)
const yaNuevos = [...empresas, ...clientes].filter((r) => yaEstaConKeyNueva(r.clave_sii)).length
if (yaNuevos === total) {
  console.log('Todos los secretos ya están cifrados con la key nueva: nada que hacer (idempotente).')
  process.exit(0)
}
if (yaNuevos > 0) {
  console.error(`ERROR: ${yaNuevos} secretos ya están con la key nueva y otros no — estado mixto no soportado. Revise manualmente.`)
  process.exit(1)
}

// Sanity: TODOS deben descifrar con el fallback. Si alguno falla, abortar sin tocar nada.
const planos = new Map()
for (const r of [...empresas, ...clientes]) {
  try {
    planos.set(`${r.constructor === Object && r.id !== undefined && empresas.includes(r) ? 'emp' : 'cli'}:${r.id}`, descifrarCon(r.clave_sii, FALLBACK_KEY))
  } catch (err) {
    console.error(`ERROR: el secreto de ${empresas.some((e) => e.id === r.id) ? 'empresa' : 'cliente'} id=${r.id} NO descifra con el fallback (${err.message}). Abortando sin cambios.`)
    process.exit(1)
  }
}
console.log('Verificación previa OK: todos los secretos descifran con el fallback de desarrollo.')

const tx = db.transaction(() => {
  for (const e of empresas) {
    db.prepare(`UPDATE empresas SET clave_sii = ? WHERE id = ?`).run(cifrarCon(planos.get(`emp:${e.id}`), nuevaKey), e.id)
  }
  for (const c of clientes) {
    db.prepare(`UPDATE clientes SET clave_sii = ? WHERE id = ?`).run(cifrarCon(planos.get(`cli:${c.id}`), nuevaKey), c.id)
  }
})
tx()

// Verificación post: cada valor nuevo debe descifrar con la key nueva y
// coincidir con el plano original.
let verificados = 0
for (const e of db.prepare(`SELECT id, clave_sii FROM empresas WHERE clave_sii LIKE 'v1:%'`).all()) {
  if (descifrarCon(e.clave_sii, nuevaKey) !== planos.get(`emp:${e.id}`)) {
    console.error(`FALLO POST: empresa id=${e.id} no coincide. La transacción ya cerró — revise backup.`)
    process.exit(1)
  }
  verificados++
}
for (const c of db.prepare(`SELECT id, clave_sii FROM clientes WHERE clave_sii LIKE 'v1:%'`).all()) {
  if (descifrarCon(c.clave_sii, nuevaKey) !== planos.get(`cli:${c.id}`)) {
    console.error(`FALLO POST: cliente id=${c.id} no coincide. La transacción ya cerró — revise backup.`)
    process.exit(1)
  }
  verificados++
}

console.log(`ROTACIÓN COMPLETA: ${verificados}/${total} secretos re-cifrados y verificados con la key nueva.`)
console.log('Siguiente paso: ponga SECRETOS_MASTER_KEY=<la misma ROTAR_NUEVA_KEY> en .env y luego: docker compose up -d')
console.log('La key NUNCA fue impresa. Si no la guardó, genere otra y repita (el script es idempotente solo con la misma key).')
db.close()
