'use strict'
/**
 * F5-B — FALLO SEGURO DE LA CLAVE MAESTRA.
 *
 * Antes de F5, `boveda.cargarClave()` caía en silencio a una clave
 * DETERMINISTA y pública del código cuando faltaba `SECRETOS_MASTER_KEY`,
 * también en producción: las claves SII, los CAF y el certificado de firma
 * quedaban cifrados con una clave que cualquiera puede leer en el repositorio.
 *
 * Contrato que fija este archivo:
 *  - producción sin clave           → error (la app no arranca);
 *  - producción con formato inválido → error;
 *  - producción con 64 hex o passphrase ≥ 32 → OK;
 *  - desarrollo / test sin clave     → fallback con advertencia (sin romper el
 *    trabajo local);
 *  - el mensaje de error NUNCA contiene el valor de la clave;
 *  - `backend/index.js` valida ANTES de abrir la base (fallo al arrancar, no
 *    al primer secreto).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const boveda = require('../backend/core/boveda')

const HEX = 'a'.repeat(64)
const PASS = 'x'.repeat(40)

const env = (extra = {}) => ({ ...process.env, ...extra })
const sinClave = () => {
  const e = { ...process.env }
  delete e.SECRETOS_MASTER_KEY
  delete e.SECRETOS_MASTER_PASS
  return e
}

test.afterEach(() => boveda._olvidarClave())

// ---------- producción ----------

test('F5-B/1: producción SIN clave maestra → error explícito (no fallback)', () => {
  const e = { ...sinClave(), NODE_ENV: 'production' }
  assert.throws(() => boveda.validarClaveMaestra(e), (err) => {
    assert.match(err.message, /SECRETOS_MASTER_KEY/)
    assert.match(err.message, /OBLIGATORIA/)
    assert.ok(!/fallback-dev/i.test(err.message), 'el mensaje no revela el nombre del fallback')
    return true
  })
})

test('F5-B/2: producción con clave de formato inválido → error sin revelar el valor', () => {
  const corta = 'clave-corta-123'
  assert.throws(
    () => boveda.validarClaveMaestra(env({ NODE_ENV: 'production', SECRETOS_MASTER_KEY: corta })),
    (err) => {
      assert.match(err.message, /formato inválido/)
      assert.ok(!err.message.includes(corta), 'el mensaje NO contiene el valor de la clave')
      return true
    },
  )
})

test('F5-B/3: producción con 64 hex o passphrase ≥32 → aceptada', () => {
  assert.deepStrictEqual(
    boveda.validarClaveMaestra(env({ NODE_ENV: 'production', SECRETOS_MASTER_KEY: HEX })),
    { ok: true, origen: 'hex', produccion: true },
  )
  assert.deepStrictEqual(
    boveda.validarClaveMaestra(env({ NODE_ENV: 'production', SECRETOS_MASTER_KEY: PASS })),
    { ok: true, origen: 'passphrase', produccion: true },
  )
  // SECRETOS_MASTER_PASS es la alternativa histórica: también vale.
  const soloPass = { ...sinClave(), NODE_ENV: 'production', SECRETOS_MASTER_PASS: PASS }
  assert.strictEqual(boveda.validarClaveMaestra(soloPass).origen, 'passphrase')
})

test('F5-B/4: cifrar en producción sin clave lanza (no cifra con la clave del código)', () => {
  const prev = { ...process.env }
  process.env.NODE_ENV = 'production'
  delete process.env.SECRETOS_MASTER_KEY
  delete process.env.SECRETOS_MASTER_PASS
  boveda._olvidarClave()
  try {
    assert.throws(() => boveda.cifrar('clave-sii-ficticia'), /SECRETOS_MASTER_KEY/)
    assert.throws(() => boveda.descifrar('v1:aa:bb:cc'), /SECRETOS_MASTER_KEY/)
  } finally {
    process.env = prev
    boveda._olvidarClave()
  }
})

// ---------- desarrollo / test ----------

test('F5-B/5: desarrollo sin clave → fallback permitido (con advertencia), round-trip intacto', () => {
  const e = sinClave()
  e.NODE_ENV = 'development'
  assert.strictEqual(boveda.validarClaveMaestra(e).origen, 'fallback-dev')

  const prev = { ...process.env }
  process.env.NODE_ENV = 'development'
  delete process.env.SECRETOS_MASTER_KEY
  delete process.env.SECRETOS_MASTER_PASS
  boveda._olvidarClave()
  try {
    const cifrado = boveda.cifrar('clave-de-prueba')
    assert.ok(cifrado.startsWith('v1:'), 'formato v1 vigente')
    assert.strictEqual(boveda.descifrar(cifrado), 'clave-de-prueba')
    assert.ok(!cifrado.includes('clave-de-prueba'), 'no queda en claro')
  } finally {
    process.env = prev
    boveda._olvidarClave()
  }
})

test('F5-B/6: en pruebas (NODE_ENV=test) sin clave tampoco se bloquea', () => {
  const e = { ...sinClave(), NODE_ENV: 'test' }
  assert.strictEqual(boveda.validarClaveMaestra(e).ok, true)
  assert.strictEqual(boveda.validarClaveMaestra(e).origen, 'fallback-dev')
})

test('F5-B/7: una clave distinta NO descifra lo cifrado con otra (sin fallback silencioso)', () => {
  const prev = { ...process.env }
  try {
    process.env.NODE_ENV = 'production'
    process.env.SECRETOS_MASTER_KEY = 'b'.repeat(64)
    boveda._olvidarClave()
    const cifrado = boveda.cifrar('secreto-ficticio')

    process.env.SECRETOS_MASTER_KEY = 'c'.repeat(64)
    boveda._olvidarClave()
    assert.throws(() => boveda.descifrar(cifrado), /No se pudo descifrar/)
    // Compatibilidad: la capa legacy (texto plano) se sigue leyendo tal cual.
    assert.strictEqual(boveda.descifrar('texto-legacy'), 'texto-legacy')
  } finally {
    process.env = prev
    boveda._olvidarClave()
  }
})

// ---------- arranque ----------

test('F5-B/8: index.js valida la clave maestra ANTES de abrir la base y no imprime valores', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../backend/index.js'), 'utf8')
  const posValidacion = src.indexOf("require('./core/boveda').validarClaveMaestra()")
  const posDb = src.indexOf("db = require('./db')")
  assert.ok(posValidacion > 0, 'el arranque llama a validarClaveMaestra()')
  assert.ok(posDb > 0, 'sigue abriendo la base')
  assert.ok(posValidacion < posDb, 'la validación ocurre ANTES de abrir la base')
  assert.match(src, /process\.exit\(1\)/, 'una configuración inválida aborta el proceso')
  // Ni el arranque ni la guarda imprimen el valor de la variable.
  assert.ok(!/console\.(log|error)\([^)]*SECRETOS_MASTER_KEY\s*\)/.test(src), 'no se imprime la clave')
})
