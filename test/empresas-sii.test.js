/**
 * Tests empresas-sii — alta de empresa con solo RUT + clave SII.
 * Cubre el parser del JSON embebido (DatosCntrNow) y el mapeo ficha→registro,
 * sin llamar al SII real (las llamadas de red se prueban fuera de unit).
 * Ejecutar con: node --test test/empresas-sii.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-empresas-sii-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const { extraerJsonEmbebido, fichaSiiARegistro } = require('../backend/core/empresas-sii')

test.after(() => {
  try { fs.rmSync(dbFile, { force: true }) } catch {}
  try { fs.rmSync(dbFile + '-wal', { force: true }) } catch {}
  try { fs.rmSync(dbFile + '-shm', { force: true }) } catch {}
})

// ---------- extraerJsonEmbebido ----------

test('extraerJsonEmbebido: encuentra el objeto tras el marcador y parsea', () => {
  const html = `<html>x DatosCntrNow = {"a":1,"b":{"c":"dos"}}, resto</html>`
  const out = extraerJsonEmbebido(html, 'DatosCntrNow = ')
  assert.deepStrictEqual(out, { a: 1, b: { c: 'dos' } })
})

test('extraerJsonEmbebido: respeta llaves dentro de strings y escapes', () => {
  const html = `DatosCntrNow = {"glosa":"usa { y \\" y } adentro","n":2}`
  const out = extraerJsonEmbebido(html, 'DatosCntrNow = ')
  assert.strictEqual(out.glosa, 'usa { y " y } adentro')
  assert.strictEqual(out.n, 2)
})

test('extraerJsonEmbebido: sin marcador devuelve null', () => {
  assert.strictEqual(extraerJsonEmbebido('<p>hola</p>', 'DatosCntrNow = '), null)
})

test('extraerJsonEmbebido: JSON roto devuelve null (no lanza)', () => {
  const html = `DatosCntrNow = {"a": ` // truncado
  assert.strictEqual(extraerJsonEmbebido(html, 'DatosCntrNow = '), null)
})

// ---------- fichaSiiARegistro ----------

const FICHA_REAL = {
  codigoError: 0,
  contribuyente: {
    rut: '77255326',
    dv: '9',
    razonSocial: 'INVERSIONES SANTA CAMILA SPA',
    tipoContribuyenteDescripcion: 'PERSONA JURIDICA COMERCIAL',
    fechaConstitucion: '2020-11-07 00:00:00.0',
    eMail: 'algo@correo.cl',
    telefonoMovil: '940420120',
    fechaInicioActividades: '2020-11-10 00:00:00.0',
    unidadOperativaDescripcion: 'PROVIDENCIA',
    unidadOperativaDireccion: 'AV. SUECIA 211, PROVIDENCIA',
    glosaActividad: 'FABRICACION A DOMICILIO DE PRODUCTOS METALICOS',
  },
  direcciones: [{
    calle: 'P VALENZUELA 1098 OF 36',
    comunaDescripcion: 'PROVIDENCIA',
    regionDescripcion: 'REGION METROPOLITANA',
  }],
  atributos: [
    { atrCodigo: '14TT', descAtrCodigo: 'REGIMEN PRO PYME TRANSPARENTE (14D N°8)' },
    { atrCodigo: 'SGPM', descAtrCodigo: 'PEQUENA EMPRESA' },
  ],
}

test('fichaSiiARegistro: mapea razón social, RUT, fechas, contacto y régimen 14TT', () => {
  const r = fichaSiiARegistro(FICHA_REAL)
  assert.strictEqual(r.rut, '77255326-9')
  assert.strictEqual(r.nombre, 'INVERSIONES SANTA CAMILA SPA')
  assert.strictEqual(r.inicioActividades, '2020-11-10')
  assert.strictEqual(r.fechaConstitucion, '2020-11-07')
  assert.strictEqual(r.regimen, 'Pro Pyme Transparente (14 D)')
  assert.deepStrictEqual(r.actividades, ['FABRICACION A DOMICILIO DE PRODUCTOS METALICOS'])
  assert.strictEqual(r.telefono, '940420120')
  assert.strictEqual(r.email, 'algo@correo.cl')
  assert.strictEqual(r.tipoContribuyente, 'PERSONA JURIDICA COMERCIAL')
})

test('fichaSiiARegistro: atributo 14GG mapea a Pro Pyme General', () => {
  const ficha = JSON.parse(JSON.stringify(FICHA_REAL))
  ficha.atributos = [{ atrCodigo: '14GG' }]
  const r = fichaSiiARegistro(ficha)
  assert.strictEqual(r.regimen, 'Pro Pyme General (14 D)')
})

test('fichaSiiARegistro: sin atributos de régimen deja regimen null (no inventa)', () => {
  const ficha = JSON.parse(JSON.stringify(FICHA_REAL))
  ficha.atributos = []
  const r = fichaSiiARegistro(ficha)
  assert.strictEqual(r.regimen, null)
})

test('fichaSiiARegistro: persona natural sin razón social usa nombres + apellidos', () => {
  const ficha = JSON.parse(JSON.stringify(FICHA_REAL))
  ficha.contribuyente.razonSocial = null
  ficha.contribuyente.nombres = 'María Paz'
  ficha.contribuyente.apellidoPaterno = 'Rojas'
  ficha.contribuyente.apellidoMaterno = 'Soto'
  const r = fichaSiiARegistro(ficha)
  assert.strictEqual(r.nombre, 'María Paz Rojas Soto')
})

test('fichaSiiARegistro: sin razón social lanza (no se inventa identidad)', () => {
  const ficha = JSON.parse(JSON.stringify(FICHA_REAL))
  ficha.contribuyente.razonSocial = null
  assert.throws(() => fichaSiiARegistro(ficha), /no trae RUT ni nombre\/razón social/)
})

test('fichaSiiARegistro: campos nulos no rompen (persona natural sin constitución)', () => {
  const ficha = JSON.parse(JSON.stringify(FICHA_REAL))
  ficha.contribuyente.fechaConstitucion = null
  ficha.contribuyente.telefonoMovil = null
  ficha.contribuyente.glosaActividad = null
  const r = fichaSiiARegistro(ficha)
  assert.strictEqual(r.fechaConstitucion, null)
  assert.strictEqual(r.telefono, '')
  assert.deepStrictEqual(r.actividades, [])
})
