'use strict'
/**
 * F5-D — CERTIFICADO DE FIRMA: vigencia e identidad ANTES de emitir.
 *
 * Antes de F5 `emitir()` no comprobaba nada del certificado: uno vencido, de
 * otro RUT o imposible de descifrar llegaba hasta el adaptador. Ahora hay una
 * puerta local (`estadoCertificado` + `exigirCertificadoEmisor`) que:
 *  - bloquea certificado vencido, indescifrable o de otro RUT;
 *  - en producción bloquea además un .pfx ilegible o sin RUT (identidad no
 *    verificable);
 *  - en certificación deja pasar un .pfx ficticio (los tests/mocks lo usan) y
 *    lo reporta como `invalido`, sin inventar que está verificado.
 *
 * Los .pfx de este test son FICTICIOS, generados acá con node-forge (dependencia
 * transitiva de @devlas/dte-sii, que es quien parsea los .pfx en producción).
 * No se llama al SII ni se emite ningún documento.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const forge = require('node-forge')

const dbFile = path.join(os.tmpdir(), `iva-f5-dte-${Date.now()}.db`)
process.env.DB_PATH = dbFile
process.env.NODE_ENV = 'test'
if (!process.env.SECRETOS_MASTER_KEY) process.env.SECRETOS_MASTER_KEY = crypto.randomBytes(32).toString('hex')

const db = require('../backend/db')
const boveda = require('../backend/core/boveda')
const emisor = require('../backend/core/dte-emisor')

const RUT_EMPRESA = '76543210-3'
const PASS_CERT = 'pass-ficticia-f5'

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true })
})

/* ---------- fixtures: .pfx ficticios con vigencia y CN controlados ---------- */

function crearPfx({ cn, desde, hasta, pass = PASS_CERT }) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = desde
  cert.validity.notAfter = hasta
  const attrs = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: 'F5 Pruebas' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: '3des', useLocalKeyId: true })
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64')
}

const dias = (n) => new Date(Date.now() + n * 86400000)

function crearEmpresa(rut = RUT_EMPRESA) {
  // empresas.rut es UNIQUE: los casos reutilizan la misma empresa ficticia.
  const ya = db.prepare(`SELECT id FROM empresas WHERE rut = ?`).get(rut)
  if (ya) return ya.id
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, telefono, exento) VALUES (?, ?, '', 0, ?, 0)`)
    .run(rut, `Empresa ${rut}`, '+56900000000')
  return Number(info.lastInsertRowid)
}

function configurar(empresaId, { pfx, ambiente = 'certificacion', pass = PASS_CERT }) {
  db.prepare(`DELETE FROM dte_config WHERE empresa_id = ?`).run(empresaId)
  db.prepare(`
    INSERT INTO dte_config (empresa_id, razon_social, giro, direccion, comuna, acteco, fch_resol, nro_resol, ambiente, cert_pfx, cert_pass)
    VALUES (?, 'F5 SpA', 'Servicios', 'Calle 1', 'Santiago', '692000', '2024-01-15', '0', ?, ?, ?)
  `).run(empresaId, ambiente, pfx ? boveda.cifrar(pfx) : null, pass ? boveda.cifrar(pass) : null)
}

/* ---------- casos ---------- */

test('F5-D/1: certificado vigente y del RUT emisor → vigente, sin bloqueo, metadatos sin secretos', () => {
  const emp = crearEmpresa()
  configurar(emp, { pfx: crearPfx({ cn: `Firma F5 ${RUT_EMPRESA}`, desde: dias(-10), hasta: dias(400) }) })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'vigente')
  assert.strictEqual(r.bloqueante, false)
  assert.strictEqual(r.rut, RUT_EMPRESA)
  assert.ok(r.dias > 300, `días restantes razonables (${r.dias})`)
  assert.match(r.vence, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(!JSON.stringify(r).includes(PASS_CERT), 'el reporte no contiene la contraseña')
  assert.ok(!fs.existsSync(dbFile) === false)
  // El pfx cifrado en la BD no aparece en el reporte.
  const guardado = db.prepare(`SELECT cert_pfx FROM dte_config WHERE empresa_id = ?`).get(emp).cert_pfx
  assert.ok(!JSON.stringify(r).includes(guardado), 'el reporte no contiene el pfx')
})

test('F5-D/2: certificado VENCIDO → bloquea la emisión con el motivo', () => {
  const emp = crearEmpresa('11111111-1')
  configurar(emp, { pfx: crearPfx({ cn: `Firma ${'11111111-1'}`, desde: dias(-400), hasta: dias(-1) }) })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'vencido')
  assert.strictEqual(r.bloqueante, true)
  assert.match(r.motivo, /venció/)
  assert.throws(() => emisor.exigirCertificadoEmisor(db, emp), /Emisión bloqueada: .*venció/)
})

test('F5-D/3: certificado de OTRO RUT → bloquea (identidad del emisor)', () => {
  const emp = crearEmpresa(RUT_EMPRESA)
  configurar(emp, { pfx: crearPfx({ cn: 'Firma 22222222-2', desde: dias(-10), hasta: dias(300) }) })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'rut_no_coincide')
  assert.strictEqual(r.bloqueante, true)
  assert.match(r.motivo, /22222222-2/)
  assert.throws(() => emisor.exigirCertificadoEmisor(db, emp), /Emisión bloqueada/)
})

test('F5-D/4: certificado por vencer (≤30 días) → avisa pero no bloquea', () => {
  const emp = crearEmpresa()
  configurar(emp, { pfx: crearPfx({ cn: `Firma ${RUT_EMPRESA}`, desde: dias(-300), hasta: dias(10) }) })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'por_vencer')
  assert.strictEqual(r.bloqueante, false)
  assert.ok(r.dias <= 10)
  assert.doesNotThrow(() => emisor.exigirCertificadoEmisor(db, emp))
})

test('F5-D/5: certificado sin RUT en el subject → identidad NO VERIFICADA (no se inventa)', () => {
  const emp = crearEmpresa()
  configurar(emp, { pfx: crearPfx({ cn: 'Firma sin rut', desde: dias(-10), hasta: dias(300) }) })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'identidad_no_verificada')
  assert.match(r.motivo, /NO VERIFICADA/)
  // En certificación pasa (los mocks no tienen RUT); en producción se bloquea.
  assert.doesNotThrow(() => emisor.exigirCertificadoEmisor(db, emp))
  configurar(emp, { pfx: crearPfx({ cn: 'Firma sin rut', desde: dias(-10), hasta: dias(300) }), ambiente: 'produccion' })
  assert.throws(() => emisor.exigirCertificadoEmisor(db, emp), /bloqueada en producción/)
})

test('F5-D/6: .pfx ilegible → invalido; bloquea SOLO en producción', () => {
  const emp = crearEmpresa()
  configurar(emp, { pfx: Buffer.from('esto-no-es-un-pfx').toString('base64') })
  const r = emisor.estadoCertificado(db, emp)
  assert.strictEqual(r.estado, 'invalido')
  assert.strictEqual(r.bloqueante, false, 'en certificación no bloquea (mocks)')
  assert.doesNotThrow(() => emisor.exigirCertificadoEmisor(db, emp))

  configurar(emp, { pfx: Buffer.from('esto-no-es-un-pfx').toString('base64'), ambiente: 'produccion' })
  assert.throws(() => emisor.exigirCertificadoEmisor(db, emp), /bloqueada en producción/)
})

test('F5-D/7: sin certificado o con clave maestra cambiada → estado honesto', () => {
  const emp = crearEmpresa()
  configurar(emp, { pfx: null })
  assert.strictEqual(emisor.estadoCertificado(db, emp).estado, 'ausente')

  configurar(emp, { pfx: crearPfx({ cn: `Firma ${RUT_EMPRESA}`, desde: dias(-10), hasta: dias(300) }) })
  const prev = process.env.SECRETOS_MASTER_KEY
  try {
    process.env.SECRETOS_MASTER_KEY = crypto.randomBytes(32).toString('hex')
    boveda._olvidarClave()
    const r = emisor.estadoCertificado(db, emp)
    assert.strictEqual(r.estado, 'indescifrable')
    assert.strictEqual(r.bloqueante, true)
    assert.throws(() => emisor.exigirCertificadoEmisor(db, emp), /clave maestra/)
  } finally {
    process.env.SECRETOS_MASTER_KEY = prev
    boveda._olvidarClave()
  }
})

test('F5-D/8: el camino de emisión exige el certificado ANTES de reservar folio', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../backend/core/dte-emisor.js'), 'utf8')
  const posExigir = src.indexOf('exigirCertificadoEmisor(db, empresaId)')
  const posFolio = src.indexOf('const folioRes = siguienteFolio(db, empresaId, tipoN)')
  assert.ok(posExigir > 0, 'emitir() llama a exigirCertificadoEmisor')
  assert.ok(posFolio > 0)
  assert.ok(posExigir < posFolio, 'el certificado se valida antes de consumir un folio')
  // La ruta de configuración expone el estado sin secretos.
  const ruta = fs.readFileSync(path.resolve(__dirname, '../backend/routes/dte.js'), 'utf8')
  assert.match(ruta, /certificado: emisor\.estadoCertificado\(db, req\.empresaId\)/, 'GET /config informa el estado del certificado')
})
