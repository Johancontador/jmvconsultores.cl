/**
 * Bóveda de secretos — cifrado AES-256-GCM para claves SII por empresa.
 *
 * Módulo PURO (solo crypto): lo usa db.js durante la migración y las rutas
 * contables en runtime; no requiere la base de datos.
 *
 * Formato almacenado: `v1:<iv b64>:<tag b64>:<ciphertext b64>`
 *
 * Clave maestra (SECRETOS_MASTER_KEY):
 *  - Preferido: 64 chars hex (32 bytes) → se usa directo.
 *    Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *  - Alternativa: cualquier passphrase → se deriva con scrypt (salt fija de la app).
 *  - Si no hay ninguna: se usa un fallback constante SOLO para desarrollo local;
 *    se loggea una advertencia. En producción (docs/SEGURIDAD.md) la variable es
 *    obligatoria: si cambia, los datos cifrados dejan de ser legibles.
 */

const crypto = require('crypto')

const VERSION = 'v1'
const SALT_APP = 'jmv-iva-mensual-boveda-v1'

let _clave = null
let _advertenciaEmitida = false

function cargarClave() {
  if (_clave) return _clave

  const hex = (process.env.SECRETOS_MASTER_KEY || '').trim()
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    _clave = Buffer.from(hex, 'hex')
    return _clave
  }

  const passphrase = hex || process.env.SECRETOS_MASTER_PASS
  if (passphrase) {
    _clave = crypto.scryptSync(passphrase, SALT_APP, 32)
    return _clave
  }

  if (!_advertenciaEmitida) {
    console.warn('[BOVEDA] SECRETOS_MASTER_KEY no definida — usando fallback de desarrollo. ' +
      'Los secretos cifrados NO estarán protegidos; en producción defina la variable (docs/SEGURIDAD.md).')
    _advertenciaEmitida = true
  }
  _clave = crypto.scryptSync('iva-mensual-fallback-dev', SALT_APP, 32)
  return _clave
}

function cifrar(texto) {
  if (texto === null || texto === undefined || texto === '') return ''
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cargarClave(), iv)
  const ct = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':')
}

/**
 * Descifra un valor de la bóveda. Valores "legacy" (texto plano de la tabla
 * clientes antes de la migración) se devuelven tal cual — permite la
 * transición one-way sin romper lecturas.
 */
function descifrar(almacenado) {
  if (almacenado === null || almacenado === undefined || almacenado === '') return ''
  const s = String(almacenado)
  if (!s.startsWith(VERSION + ':')) return s // legacy texto plano

  const [, ivB64, tagB64, ctB64] = s.split(':')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', cargarClave(), Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
  } catch (err) {
    throw new Error('No se pudo descifrar un secreto de la bóveda (¿SECRETOS_MASTER_KEY cambió desde el cifrado?)')
  }
}

function esCifrado(almacenado) {
  return typeof almacenado === 'string' && almacenado.startsWith(VERSION + ':')
}

module.exports = { cifrar, descifrar, esCifrado }
