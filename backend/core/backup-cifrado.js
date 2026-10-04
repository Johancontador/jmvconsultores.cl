/**
 * Cifrado de backups (BLOQUE 1bis — P6).
 *
 * Formato binario del archivo .db.enc:
 *   [ magic 'JMVBACKUP1' (10 bytes) ][ iv (12 bytes) ][ auth tag (16 bytes) ][ ciphertext ]
 *
 * Cifrado AES-256-GCM con BACKUP_ENCRYPTION_KEY (variable de entorno, JAMÁS
 * hardcodeada ni versionada):
 *  - 64 chars hex → se usan como bytes directos.
 *  - passphrase   → derivada con scrypt (salt propia de backups).
 *
 * SEPARACIÓN DE RESPONSABILIDADES (decisión arquitectónica documentada):
 *  - SECRETOS_MASTER_KEY → secretos de APLICACIÓN (bóveda de claves SII,
 *    salt 'jmv-iva-mensual-boveda-v1').
 *  - BACKUP_ENCRYPTION_KEY → cifrado de BACKUPS, con SALTO PROPIO
 *    ('jmv-backup-v1'). Comprometer/rotar una no afecta a la otra.
 *  - Alternativa age/gpg evaluada: requiere binario externo en el VPS y en el
 *    entorno de restore; Node crypto ya está en el stack y usa el mismo
 *    patrón auditado de la bóveda. Decisión: AES-256-GCM nativo.
 *
 * Módulo puro (crypto + fs): sin BD, sin Express, testeable.
 */

const crypto = require('crypto')
const fs = require('fs')

const VERSION = 'v1'
const MAGIC = Buffer.from('JMVBACKUP1', 'ascii')
const IV_BYTES = 12
const TAG_BYTES = 16
const SALT_BACKUP = 'jmv-backup-v1'

function cargarClaveDesde(envKey) {
  const hex = String(envKey || '').trim()
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, 'hex')
  if (!hex) throw new Error('BACKUP_ENCRYPTION_KEY no definida')
  return crypto.scryptSync(hex, SALT_BACKUP, 32)
}

/** Cifra un Buffer completo → Buffer en formato JMVBACKUP1. */
function cifrarBuffer(plano, envKey) {
  const clave = cargarClaveDesde(envKey)
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', clave, iv)
  const ct = Buffer.concat([cipher.update(plano), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, Buffer.from([1]), iv, tag, ct])
}

/** Descifra un Buffer en formato JMVBACKUP1 → Buffer plano (lanza si la key no corresponde). */
function descifrarBuffer(enc, envKey) {
  const clave = cargarClaveDesde(envKey)
  if (!enc || enc.length < MAGIC.length + 1 + IV_BYTES + TAG_BYTES || !enc.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('El archivo no tiene el formato de backup cifrado JMVBACKUP1')
  }
  const version = enc[MAGIC.length]
  if (version !== 1) throw new Error(`Versión de cifrado de backup desconocida: ${version}`)
  const iv = enc.subarray(MAGIC.length + 1, MAGIC.length + 1 + IV_BYTES)
  const tag = enc.subarray(MAGIC.length + 1 + IV_BYTES, MAGIC.length + 1 + IV_BYTES + TAG_BYTES)
  const ct = enc.subarray(MAGIC.length + 1 + IV_BYTES + TAG_BYTES)
  const decipher = crypto.createDecipheriv('aes-256-gcm', clave, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()])
  } catch {
    throw new Error('No se pudo descifrar el backup (¿BACKUP_ENCRYPTION_KEY incorrecta o archivo corrupto?)')
  }
}

function esBackupCifrado(enc) {
  return Buffer.isBuffer(enc) && enc.length > MAGIC.length && enc.subarray(0, MAGIC.length).equals(MAGIC)
}

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function sha256Archivo(ruta) {
  return sha256Buffer(fs.readFileSync(ruta))
}

module.exports = {
  VERSION, MAGIC, IV_BYTES, TAG_BYTES, SALT_BACKUP,
  cifrarBuffer, descifrarBuffer, esBackupCifrado,
  sha256Buffer, sha256Archivo,
  cargarClaveDesde,
}
