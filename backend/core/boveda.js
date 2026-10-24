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
 *  - Alternativa: passphrase de **al menos 32 caracteres** → se deriva con
 *    scrypt (salt fija de la app).
 *  - Si no hay ninguna: se usa un fallback constante SOLO en desarrollo/pruebas;
 *    se loggea una advertencia. **En producción la variable es OBLIGATORIA**:
 *    `validarClaveMaestra()` lanza y `backend/index.js` aborta el arranque
 *    (F5-B). Antes de F5 el fallback se usaba en silencio también en producción,
 *    lo que dejaba las claves SII cifradas con una clave pública conocida.
 *  - Si cambia, los datos cifrados dejan de ser legibles (rotación: F5-E y
 *    `scripts/rotar-master-key.js`).
 */

const crypto = require('crypto')

const VERSION = 'v1'
const SALT_APP = 'jmv-iva-mensual-boveda-v1'
const HEX64 = /^[0-9a-fA-F]{64}$/
const MIN_PASSPHRASE = 32
const FALLBACK_DEV = 'iva-mensual-fallback-dev'

let _clave = null
let _advertenciaEmitida = false

function esProduccion(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production'
}

/**
 * Valida la configuración de la clave maestra SIN descifrar nada ni exponer
 * valores. Es la guarda de «fallo seguro» de F5-B.
 *
 * @returns {{ok:true, origen:'hex'|'passphrase'|'fallback-dev'|'dev-invalida', produccion:boolean}}
 * @throws  En producción si falta la clave o su formato es inválido. El mensaje
 *          NUNCA incluye el valor (solo qué variable y cómo corregirla).
 */
function validarClaveMaestra(env = process.env) {
  const hex = String(env.SECRETOS_MASTER_KEY || '').trim()
  const pass = String(env.SECRETOS_MASTER_PASS || '').trim()
  const valor = hex || pass
  const produccion = esProduccion(env)

  if (!valor) {
    if (produccion) {
      throw new Error('SECRETOS_MASTER_KEY es OBLIGATORIA en producción y no está definida: ' +
        'la aplicación no arranca sin ella. Sin clave maestra real, las claves SII, los CAF y el ' +
        'certificado de firma quedarían cifrados con una clave conocida del código. ' +
        'Defínala en .env (64 hex) y reinicie — ver docs/SEGURIDAD.md §Bóveda.')
    }
    return { ok: true, origen: 'fallback-dev', produccion: false }
  }

  if (HEX64.test(valor)) return { ok: true, origen: 'hex', produccion }
  if (valor.length >= MIN_PASSPHRASE) return { ok: true, origen: 'passphrase', produccion }

  if (produccion) {
    throw new Error('SECRETOS_MASTER_KEY tiene un formato inválido: use 64 caracteres hexadecimales ' +
      '(recomendado) o una passphrase de al menos 32 caracteres. El valor no se muestra por seguridad.')
  }
  // Desarrollo/pruebas: se mantiene el comportamiento histórico (scrypt del
  // valor) para no romper entornos locales, pero se avisa.
  return { ok: true, origen: 'dev-invalida', produccion: false }
}

function cargarClave() {
  if (_clave) return _clave

  const estado = validarClaveMaestra()

  if (estado.origen === 'hex') {
    _clave = Buffer.from(String(process.env.SECRETOS_MASTER_KEY).trim(), 'hex')
    return _clave
  }

  if (estado.origen === 'passphrase' || estado.origen === 'dev-invalida') {
    const passphrase = String(process.env.SECRETOS_MASTER_KEY || process.env.SECRETOS_MASTER_PASS || '').trim()
    _clave = crypto.scryptSync(passphrase, SALT_APP, 32)
    return _clave
  }

  if (!_advertenciaEmitida) {
    console.warn('[BOVEDA] SECRETOS_MASTER_KEY no definida — usando fallback de desarrollo. ' +
      'Los secretos cifrados NO estarán protegidos; en producción la aplicación NO arranca sin la variable (docs/SEGURIDAD.md).')
    _advertenciaEmitida = true
  }
  _clave = crypto.scryptSync(FALLBACK_DEV, SALT_APP, 32)
  return _clave
}

/** Solo para pruebas: olvida la clave derivada cacheada. */
function _olvidarClave() {
  _clave = null
  _advertenciaEmitida = false
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

module.exports = {
  cifrar, descifrar, esCifrado,
  validarClaveMaestra, esProduccion, _olvidarClave,
  MIN_PASSPHRASE,
}
