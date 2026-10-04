/**
 * BLOQUE 2 — EMISIÓN DE DTE PARA EMPRESAS CLIENTES (/api/dte).
 *
 *  Migración: dte_config / dte_folios / dte_emitidos
 *  RBAC: dte:ver / dte:emitir / dte:configurar por rol
 *  Config: cifrado v1 del certificado, sin secretos en respuestas ni auditoría
 *  CAFs: parseo, RUT del emisor, idempotencia por rango, folios agotados
 *  Emisión: 33 correlativa, 34 exenta, 61 con referencia obligatoria,
 *           validaciones que NOMBRAN lo inválido, error+reintento,
 *           estado SII VERBATIM (EPR→ACEPTADO según clasificación de la librería)
 *  Aislamiento: nadie ve ni emite DTEs de otra empresa
 *  Offline real: generarXMLDTE con PKCS12+CAF generados → XML con claves
 *                nativas del XSD (el bug latente del camelCase, corregido)
 *
 * HTTP real (express + fetch + sesión insertada, patrón password.test.js).
 * Ejecutar con: node --test test/dte-emision.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')
const forge = require('node-forge')

const dbFile = path.join(os.tmpdir(), `iva-mensual-dte-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { requireAuth } = require('../backend/middleware/requireAuth')
const routerDte = require('../backend/routes/dte')
const permisos = require('../backend/core/permisos')
const empresas = require('../backend/core/empresas')
const emisor = require('../backend/core/dte-emisor')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(dbFile + sufijo, { force: true })
})

// ---------- Setup: empresas, usuarios y sesiones ----------

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP1 = empresas.crear(db, { usuarioId: adminId, rut: '77591234-0', nombre: 'Empresa Demo SpA', claveSii: 'clave-dte', tasaPpm: 0 }).id
const EMP2 = empresas.crear(db, { usuarioId: adminId, rut: '77999999-8', nombre: 'Otra Empresa Ltda', claveSii: 'clave-dte2', tasaPpm: 0 }).id

const { hashPassword } = require('../backend/services/password')
function crearUsuario(username, rol, empresaId) {
  const id = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)`).run(username, hashPassword(`${username}-pass123`)).lastInsertRowid
  if (empresaId) empresas.asignarRol(db, { usuarioIdEjecutor: adminId, usuarioIdObjetivo: id, empresaId, rol })
  return id
}
const contadorId = crearUsuario('contador_dte', 'contador', EMP1)
const auditorId = crearUsuario('auditor_dte', 'auditor', EMP1)
const ajenoId = crearUsuario('ajeno_dte', 'contador', EMP2) // solo EMP2

function sesionPara(userId) {
  const sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(sid, userId, new Date(Date.now() + 3600e3).toISOString())
  return sid
}
const SID_ADMIN = sesionPara(adminId)
const SID_CONTADOR = sesionPara(contadorId)
const SID_AUDITOR = sesionPara(auditorId)
const SID_AJENO = sesionPara(ajenoId)

const app = express()
app.use(express.json())
app.use('/api/dte', requireAuth, routerDte)

// Adaptador DTE FALSO (patrón del proyecto: los tests jamás tocan el SII)
const fakeAdapter = {
  async emitirDTE({ tipo, folio, receptor }) {
    return {
      folio,
      xml: `<DTE tipo="${tipo}" folio="${folio}" receptor="${receptor.rut}"/>`,
      track_id: `trk-${tipo}-${folio}`,
      sii_respuesta: { trackId: `trk-${tipo}-${folio}`, estado: 'REC', glosa: 'Envío recibido' },
    }
  },
  async consultarEstadoDTE({ trackId }) {
    return { ok: true, trackId, estado: 'EPR', descripcion: 'Envío Procesado', esExitoso: true, esRechazado: false, esIntermedio: false }
  },
}
const failingAdapter = {
  async emitirDTE() { throw new Error('SII inaccesible (timeout)') },
}
app.set('dteAdapter', fakeAdapter)

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => server.close())

function req(method, ruta, body, sid) {
  return fetch(`${base}${ruta}`, {
    method,
    headers: { 'content-type': 'application/json', ...(sid ? { cookie: `sid=${sid}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// CAFs y PKCS12 reales generados con node-forge (misma librería que usa @devlas/dte-sii)
const RSA_KEY_PEM = (() => {
  const par = forge.pki.rsa.generateKeyPair(1024)
  return forge.pki.privateKeyToPem(par.privateKey)
})()
function cafXml(rut, tipo, desde, hasta) {
  return `<AUTORIZACION><CAF version="1.0"><DA><RE>${rut}</RE><RS>Test SpA</RS><TD>${tipo}</TD>` +
    `<RNG><D>${desde}</D><H>${hasta}</H></RNG><FA>2026-01-01</FA>` +
    `<RSAPK><M>aaa</M><E>Aw==</E></RSAPK><IDK>300</IDK></DA>` +
    `<FRMA algoritmo="SHA1withRSA">firma</FRMA></CAF>` +
    `<RSASK>${RSA_KEY_PEM}</RSASK></AUTORIZACION>`
}
const CERT_PASS = 'clave-pfx-test-99'
const PFX_B64 = Buffer.from((() => {
  const par = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = par.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 86400e3)
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400e3)
  const attrs = [{ name: 'commonName', value: 'CERTIFICADO DE PRUEBA' }, { name: 'countryName', value: 'CL' }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(par.privateKey)
  return forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(par.privateKey, cert, CERT_PASS)).getBytes()
})(), 'binary').toString('base64')

const RECEPTOR_OK = { rut: '76123456-0', razon_social: 'Cliente Prueba Ltda', giro: 'Comercio al por menor', direccion: 'Av Providencia 123', comuna: 'Santiago' }

// ---------- Migración ----------

test('migración BLOQUE 2: tablas dte_config, dte_folios y dte_emitidos con sus columnas y UNIQUE', () => {
  for (const t of ['dte_config', 'dte_folios', 'dte_emitidos']) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t), t)
  }
  const emitidos = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='dte_emitidos'`).get().sql
  for (const c of ['sii_codigo', 'sii_respuesta_json', 'track_id', 'documento_id', 'asiento_id', 'intentos', 'xml']) assert.ok(emitidos.includes(c), c)
  assert.ok(/UNIQUE\(empresa_id,\s*tipo_dte,\s*folio\)/.test(emitidos), 'UNIQUE(empresa, tipo, folio)')
  const config = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='dte_config'`).get().sql
  assert.ok(/UNIQUE\(empresa_id\)/.test(config), 'UNIQUE empresa en dte_config')
})

// ---------- RBAC ----------

test('RBAC: configurar/emitir = contador+admin_empresa+super_admin; ver = todos los roles de empresa', () => {
  const puede = (rol, cap) => permisos.permisosDeRol(rol).has(cap)
  for (const rol of ['super_admin', 'contador', 'admin_empresa']) {
    for (const cap of ['dte:ver', 'dte:emitir', 'dte:configurar']) assert.ok(puede(rol, cap), `${rol} puede ${cap}`)
  }
  for (const rol of ['auditor', 'tesoreria']) {
    assert.ok(puede(rol, 'dte:ver'), `${rol} ve`)
    assert.ok(!puede(rol, 'dte:emitir') && !puede(rol, 'dte:configurar'), `${rol} NO opera`)
  }
})

// ---------- Config del emisor ----------

test('config: GET inicial muestra faltantes NOMBRANDO qué falta (certificado, CAF, resolución…)', async () => {
  const r = await req('GET', `/api/dte/empresas/${EMP1}/config`, undefined, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const body = await r.json()
  assert.strictEqual(body.config, null)
  const f33 = body.faltantes['33']
  assert.ok(f33.some((f) => /certificado de firma/.test(f)), 'nombra el certificado')
  assert.ok(f33.some((f) => /CAF de folios tipo 33/.test(f)), 'nombra el CAF')
  assert.ok(f33.some((f) => /resolución SII \(FchResol\)/.test(f)), 'nombra la resolución')
})

test('config: ambiente inválido → 422; FchResol con formato inválido → 422', async () => {
  const r1 = await req('PUT', `/api/dte/empresas/${EMP1}/config`, { ambiente: 'qa' }, SID_CONTADOR)
  assert.strictEqual(r1.status, 422)
  const r2 = await req('PUT', `/api/dte/empresas/${EMP1}/config`, { fch_resol: '15/01/2024' }, SID_CONTADOR)
  assert.strictEqual(r2.status, 422)
})

test('config: guardar CIFRA cert_pfx y cert_pass (v1: en BD); respuesta y auditoría SIN secretos', async () => {
  const r = await req('PUT', `/api/dte/empresas/${EMP1}/config`, {
    razon_social: 'Empresa Demo SpA', giro: 'Servicios contables', direccion: 'Moneda 100',
    comuna: 'Santiago', acteco: '692000', fch_resol: '2024-01-15', nro_resol: '0',
    ambiente: 'certificacion', cert_pfx: PFX_B64, cert_pass: CERT_PASS,
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const body = await r.json()
  assert.ok(body.config.ambiente === 'certificacion' && body.config.tiene_certificado === true)
  assert.strictEqual(body.config.cert_pfx, undefined, 'sin cert en la respuesta')
  assert.strictEqual(body.config.cert_pass, undefined, 'sin pass en la respuesta')
  assert.ok(!JSON.stringify(body).includes(CERT_PASS) && !JSON.stringify(body).includes('v1:'), 'respuesta sin secretos')

  const fila = db.prepare(`SELECT cert_pfx, cert_pass FROM dte_config WHERE empresa_id = ?`).get(EMP1)
  assert.ok(fila.cert_pfx.startsWith('v1:'), 'cert_pfx cifrado en reposo')
  assert.ok(fila.cert_pass.startsWith('v1:'), 'cert_pass cifrado en reposo')
  assert.ok(!fila.cert_pfx.includes(PFX_B64), 'no plaintext del pfx')

  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.config.guardar' AND empresa_id = ?`).get(EMP1)
  assert.ok(aud, 'auditado')
  const despues = JSON.stringify(aud.despues_json)
  assert.ok(!despues.includes(CERT_PASS) && !despues.includes('v1:') && !despues.includes(PFX_B64), 'auditoría sin secretos')
})

test('config: GET posterior no expone secretos y marca tiene_certificado', async () => {
  const r = await req('GET', `/api/dte/empresas/${EMP1}/config`, undefined, SID_CONTADOR)
  const body = await r.json()
  assert.ok(body.config.tiene_certificado)
  assert.ok(body.config.cert_pfx === undefined && body.config.cert_pass === undefined)
  assert.ok(!JSON.stringify(body).includes('v1:'), 'nunca el ciphertext')
})

// ---------- CAFs de folios ----------

test('CAF: XML inválido → 422 con motivo; CAF de otro RUT → 422 (cada empresa emite con SUS folios)', async () => {
  const r1 = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: '<pepe/>' }, SID_CONTADOR)
  assert.strictEqual(r1.status, 422)
  assert.ok(/CAF inválido/.test((await r1.json()).error))

  const r2 = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml('77999999-8', 33, 1, 5) }, SID_CONTADOR)
  assert.strictEqual(r2.status, 422)
  assert.ok(/pertenece al RUT 77999999-8/.test((await r2.json()).error))
})

test('CAF: carga válida extrae tipo/rango/RUT y queda CIFRADO (clave privada de folios)', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml('77591234-0', 33, 1, 5) }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const body = await r.json()
  assert.strictEqual(body.caf.tipo_dte, 33)
  assert.strictEqual(body.caf.folio_desde, 1)
  assert.strictEqual(body.caf.folio_hasta, 5)

  const fila = db.prepare(`SELECT caf_xml FROM dte_folios WHERE empresa_id = ? AND tipo_dte = 33`).get(EMP1)
  assert.ok(fila.caf_xml.startsWith('v1:'), 'caf_xml cifrado en reposo')
  assert.ok(!fila.caf_xml.includes('RSASK'), 'nunca plaintext de la clave del CAF')

  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.caf.guardar' AND empresa_id = ?`).get(EMP1)
  assert.ok(aud && !aud.despues_json.includes('RSASK'), 'auditado sin contenido del CAF')
})

test('CAF: re-cargar el MISMO rango es idempotente (no duplica fila); GET folios sin caf_xml', async () => {
  await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml('77591234-0', 33, 1, 5) }, SID_CONTADOR)
  const n = db.prepare(`SELECT COUNT(*) AS n FROM dte_folios WHERE empresa_id = ? AND tipo_dte = 33`).get(EMP1).n
  assert.strictEqual(n, 1, 'una sola fila por rango')

  const r = await req('GET', `/api/dte/empresas/${EMP1}/folios`, undefined, SID_CONTADOR)
  const body = await r.json()
  assert.ok(Array.isArray(body.folios) && body.folios.length === 1)
  assert.ok(body.folios[0].folios_usados === 0)
  assert.ok(!JSON.stringify(body).includes('v1:') && !body.folios[0].caf_xml, 'jamás el XML del CAF')
})

test('CAF: tipos 34 y 61 cargados para los tests siguientes', async () => {
  const r34 = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml('77591234-0', 34, 1, 5) }, SID_CONTADOR)
  const r61 = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml('77591234-0', 61, 1, 5) }, SID_CONTADOR)
  assert.strictEqual(r34.status, 200)
  assert.strictEqual(r61.status, 200)
})

// ---------- Emisión: factura 33 ----------

test('emisión 33: ENVIADO con folio inicial del CAF, track_id, respuesta SII VERBATIM y montos de los ítems', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Asesoría contable mensual', cantidad: 2, precio: 10000 }],
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  assert.strictEqual(dte.folio, 1, 'primer folio del CAF')
  assert.strictEqual(dte.estado, 'ENVIADO')
  assert.strictEqual(dte.track_id, 'trk-33-1')
  assert.strictEqual(dte.monto_neto, 20000)
  assert.strictEqual(dte.monto_iva, 3800)
  assert.strictEqual(dte.monto_total, 23800)
  assert.strictEqual(dte.sii_codigo, 'REC', 'código del SII verbatim')
  const fila = db.prepare(`SELECT sii_respuesta_json, xml, emitido_por FROM dte_emitidos WHERE id = ?`).get(dte.id)
  assert.ok(fila.sii_respuesta_json.includes('Envío recibido'), 'respuesta cruda del SII guardada')
  assert.ok(fila.xml.includes(`receptor="${RECEPTOR_OK.rut}"`))
  assert.strictEqual(fila.emitido_por, contadorId)
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.emitir' AND entidad_id = ?`).get(String(dte.id))
  assert.ok(aud && JSON.parse(aud.despues_json).folio === 1, 'auditado')
})

test('emisión 33: folio correlativo por empresa (segunda → folio 2)', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Asesoría', cantidad: 1, precio: 50000 }],
  }, SID_CONTADOR)
  const { dte } = await r.json()
  assert.strictEqual(dte.folio, 2)
})

test('emisión: validaciones NOMBRAN lo inválido (RUT, datos del receptor, ítems, tipo)', async () => {
  const casos = [
    [{ tipo: 33, receptor: { ...RECEPTOR_OK, rut: '12.345.678-9' }, items: [{ nombre: 'x', cantidad: 1, precio: 1 }] }, 'RUT del receptor'],
    [{ tipo: 33, receptor: { rut: RECEPTOR_OK.rut, razon_social: 'X' }, items: [{ nombre: 'x', cantidad: 1, precio: 1 }] }, 'giro del receptor'],
    [{ tipo: 33, receptor: RECEPTOR_OK, items: [] }, 'al menos un ítem'],
    [{ tipo: 33, receptor: RECEPTOR_OK, items: [{ cantidad: 1, precio: 10 }] }, 'nombre obligatorio'],
    [{ tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 0, precio: 10 }] }, 'cantidad'],
    [{ tipo: 39, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1 }] }, 'Tipo de DTE inválido'],
  ]
  for (const [body, esperado] of casos) {
    const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, body, SID_CONTADOR)
    assert.strictEqual(r.status, 422, esperado)
    assert.ok((await r.json()).error.includes(esperado), `error nombra: ${esperado}`)
  }
})

test('emisión con documento de la bandeja: vínculo guardado; documento de OTRA empresa → 422', async () => {
  db.prepare(`INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, periodo_ingesta, clave_dedupe)
              VALUES (?, 'venta', 33, 'F999', '76123456-0', '202610', 'dte-b2-1')`).run(EMP1)
  const docId = db.prepare(`SELECT id FROM documentos WHERE clave_dedupe = 'dte-b2-1'`).get().id

  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Venta', cantidad: 1, precio: 20000 }], documento_id: docId,
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  assert.strictEqual(dte.documento_id, docId, 'DTE ligado al documento')

  db.prepare(`INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, periodo_ingesta, clave_dedupe)
              VALUES (?, 'venta', 33, 'F888', '76123456-0', '202610', 'dte-b2-2')`).run(EMP2)
  const docAjeno = db.prepare(`SELECT id FROM documentos WHERE clave_dedupe = 'dte-b2-2'`).get().id
  const r2 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Venta', cantidad: 1, precio: 20000 }], documento_id: docAjeno,
  }, SID_CONTADOR)
  assert.strictEqual(r2.status, 422)
  assert.ok(/no encontrado en esta empresa/.test((await r2.json()).error))
})

// ---------- Factura exenta 34 ----------

test('factura exenta 34: sin IVA, exento = total (items exentos por tipo)', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 34, receptor: RECEPTOR_OK, items: [{ nombre: 'Servicio exento', cantidad: 1, precio: 100000 }],
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  assert.strictEqual(dte.monto_iva, 0)
  assert.strictEqual(dte.monto_exento, 100000)
  assert.strictEqual(dte.monto_total, 100000)
})

// ---------- Nota de crédito 61 (referencia obligatoria) ----------

test('NC 61: sin referencia → 422 nombrándola; CodRef inválido → 422 con los códigos reales', async () => {
  const r1 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 61, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1000 }],
  }, SID_CONTADOR)
  assert.strictEqual(r1.status, 422)
  assert.ok(/referencia obligatoria/.test((await r1.json()).error))

  const r2 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 61, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1000 }],
    referencia: { TpoDocRef: 33, FolioRef: 1, CodRef: 9, RazonRef: 'corrección' },
  }, SID_CONTADOR)
  assert.strictEqual(r2.status, 422)
  assert.ok(/referencia.CodRef/.test((await r2.json()).error))
})

test('NC 61: con referencia → ok, referencia_json guardada y auditada', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 61, receptor: RECEPTOR_OK, items: [{ nombre: 'Ajuste monto', cantidad: 1, precio: 10000 }],
    referencia: { TpoDocRef: 33, FolioRef: 1, FchRef: new Date().toISOString().slice(0, 10), CodRef: 3, RazonRef: 'Corrige montos' },
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  const ref = JSON.parse(db.prepare(`SELECT referencia_json FROM dte_emitidos WHERE id = ?`).get(dte.id).referencia_json)
  assert.strictEqual(ref.CodRef, 3)
  assert.strictEqual(ref.FolioRef, 1)
})

// ---------- Config incompleta: lo que falta se NOMINA ----------

test('emisión en empresa SIN configuración → 422 nombrando certificado, resolución y CAF', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP2}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1 }],
  }, SID_ADMIN)
  assert.strictEqual(r.status, 422)
  const error = (await r.json()).error
  assert.ok(error.includes('Emisor DTE no configurado'))
  assert.ok(error.includes('certificado de firma') && error.includes('CAF de folios tipo 33') && error.includes('ACTECO'), error)
})

// ---------- Error de envío + reintento ----------

let filaError = null
test('error de envío: estado ERROR con motivo e intentos=1; auditoría dte.error; sin track_id', async () => {
  app.set('dteAdapter', failingAdapter)
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Fallará', cantidad: 1, precio: 1000 }],
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 422)
  assert.ok(/SII inaccesible/.test((await r.json()).error))
  filaError = db.prepare(`SELECT * FROM dte_emitidos WHERE estado = 'ERROR' ORDER BY id DESC LIMIT 1`).get()
  assert.ok(filaError, 'fila en ERROR')
  assert.strictEqual(filaError.intentos, 1)
  assert.ok(/SII inaccesible/.test(filaError.motivo_error))
  assert.strictEqual(filaError.track_id, null)
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.error' AND entidad_id = ?`).get(String(filaError.id))
  assert.ok(aud, 'auditado')
})

test('estado sin track_id → 422 (el envío nunca llegó al SII)', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/dtes/${filaError.id}/estado`, {}, SID_CONTADOR)
  assert.strictEqual(r.status, 422)
  assert.ok(/track-id/.test((await r.json()).error))
})

test('reintento: ERROR → ENVIADO con el MISMO folio, intentos acumulados y auditoría dte.reintentar', async () => {
  app.set('dteAdapter', fakeAdapter)
  const r = await req('POST', `/api/dte/empresas/${EMP1}/dtes/${filaError.id}/reintentar`, {}, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  assert.strictEqual(dte.estado, 'ENVIADO')
  assert.strictEqual(dte.folio, filaError.folio, 'mismo folio reservado')
  assert.strictEqual(dte.intentos, 2)
  assert.strictEqual(dte.motivo_error, null)
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.reintentar' AND entidad_id = ?`).get(String(filaError.id))
  assert.ok(aud, 'auditado')
})

test('consulta de estado SII: EPR exitoso → ACEPTADO con sii_codigo verbatim y consultado_en', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/dtes/${filaError.id}/estado`, {}, SID_CONTADOR)
  assert.strictEqual(r.status, 200)
  const { dte } = await r.json()
  assert.strictEqual(dte.estado, 'ACEPTADO')
  assert.strictEqual(dte.sii_codigo, 'EPR')
  assert.ok(dte.consultado_en, 'consultado_en guardado')
  const fila = db.prepare(`SELECT sii_respuesta_json FROM dte_emitidos WHERE id = ?`).get(dte.id)
  assert.ok(fila.sii_respuesta_json.includes('"esExitoso":true'), 'respuesta completa del SII verbatim')
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'dte.estado.consultar' AND entidad_id = ?`).get(String(dte.id))
  assert.ok(aud && JSON.parse(aud.despues_json).estado_local === 'ACEPTADO', 'auditado')
})

test('reintentar un DTE ACEPTADO → 422 (jamás se reenvía lo ya enviado)', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/dtes/${filaError.id}/reintentar`, {}, SID_CONTADOR)
  assert.strictEqual(r.status, 422)
  assert.ok(/No se puede reintentar/.test((await r.json()).error))
})

// ---------- Folios agotados: el hueco se NOMINA ----------

test('folios agotados: emitidos 1–5 del CAF 33, el siguiente → 422 nombrando el rango cargado', async () => {
  // Folios usados en 33 hasta ahora: 1, 2, 3 (documento), ERROR→reenviado (folio siguiente) → quedan por emitir hasta el 5.
  const usados = db.prepare(`SELECT COUNT(*) AS n FROM dte_emitidos WHERE empresa_id = ? AND tipo_dte = 33`).get(EMP1).n
  for (let i = usados; i < 5; i++) {
    const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
      tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: `Llenado ${i}`, cantidad: 1, precio: 1000 }],
    }, SID_CONTADOR)
    assert.strictEqual(r.status, 200)
  }
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'Excede CAF', cantidad: 1, precio: 1000 }],
  }, SID_CONTADOR)
  assert.strictEqual(r.status, 422)
  const error = (await r.json()).error
  assert.ok(/no está cubierto por ningún CAF activo del tipo 33 \(rangos cargados: 1–5\)/.test(error), error)
})

// ---------- Aislamiento ----------

test('aislamiento: usuario ajeno no ve ni emite DTEs de la empresa; auditor no puede emitir', async () => {
  const r1 = await req('GET', `/api/dte/empresas/${EMP1}/dtes`, undefined, SID_AJENO)
  assert.strictEqual(r1.status, 403)
  const r2 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo: 33, receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1 }],
  }, SID_AJENO)
  assert.strictEqual(r2.status, 403)
  const r3 = await req('POST', `/api/dte/empresas/${EMP1}/dtes/1/estado`, {}, SID_AUDITOR)
  assert.strictEqual(r3.status, 403)
  assert.ok(/Permiso requerido: dte:emitir/.test((await r3.json()).error))
})

// ---------- Listado ----------

test('listado: filtros por tipo y estado validados; el listado no trae xml', async () => {
  const r = await req('GET', `/api/dte/empresas/${EMP1}/dtes?tipo=61`, undefined, SID_CONTADOR)
  const body = await r.json()
  assert.ok(body.dtes.length >= 1 && body.dtes.every((d) => d.tipo_dte === 61))
  assert.ok(body.dtes.every((d) => d.xml === undefined), 'sin xml en el listado')
  const r2 = await req('GET', `/api/dte/empresas/${EMP1}/dtes?estado=INVALIDO`, undefined, SID_CONTADOR)
  assert.strictEqual(r2.status, 422)
})

// ---------- Adaptador real OFFLINE (XML con claves nativas del XSD) ----------

test('adaptador real offline: XML de factura con emisor/receptor correctos, totales y TED del CAF', () => {
  const montos = emisor.calcularMontos([{ nombre: 'Asesoría', cantidad: 2, precio: 10000 }], 33)
  const { xml } = emisor.generarXMLDTE({
    tipo: 33, folio: 1, fechaEmision: '2026-10-04',
    emisor: { rut: '77591234-0', razon_social: 'Empresa Demo SpA', giro: 'Servicios contables', direccion: 'Moneda 100', comuna: 'Santiago', actividad_economica: 692000, resolucion: { fecha: '2024-01-15', numero: 0 } },
    receptor: RECEPTOR_OK,
    items: [{ nombre: 'Asesoría', cantidad: 2, precio: 10000 }],
    certPfx: Buffer.from(PFX_B64, 'base64'), certPass: CERT_PASS,
    cafXml: cafXml('77591234-0', 33, 1, 5),
  })
  assert.ok(xml.includes('<RUTEmisor>77591234-0</RUTEmisor>'), 'emisor con clave nativa del XSD')
  assert.ok(xml.includes('<RznSoc>Empresa Demo SpA</RznSoc>'), 'razón social del emisor')
  assert.ok(xml.includes(`<RUTRecep>${RECEPTOR_OK.rut}</RUTRecep>`), 'receptor REAL (no Consumidor Final)')
  assert.ok(xml.includes('<RznSocRecep>Cliente Prueba Ltda</RznSocRecep>'))
  assert.ok(xml.includes('<MntNeto>20000</MntNeto>') && xml.includes('<IVA>3800</IVA>') && xml.includes(`<MntTotal>${montos.monto_total}</MntTotal>`))
  assert.ok(xml.includes('<TED version="1.0">') && xml.includes('<RE>77591234-0</RE>') && xml.includes('<F>1</F>'), 'TED timbrado con el CAF')
  assert.ok(xml.includes('<SignatureValue>'), 'firmado con el certificado')
  assert.ok(xml.includes('<FchEmis>2026-10-04</FchEmis>'))
})

test('adaptador real offline: NC 61 incluye la Referencia con CodRef del XSD', () => {
  const { xml } = emisor.generarXMLDTE({
    tipo: 61, folio: 1, fechaEmision: '2026-10-04',
    emisor: { rut: '77591234-0', razon_social: 'Empresa Demo SpA', giro: 'Servicios contables', direccion: 'Moneda 100', comuna: 'Santiago', actividad_economica: 692000, resolucion: { fecha: '2024-01-15', numero: 0 } },
    receptor: RECEPTOR_OK,
    items: [{ nombre: 'Ajuste', cantidad: 1, precio: 10000 }],
    referencia: { NroLinRef: 1, TpoDocRef: 33, FolioRef: 1, FchRef: '2026-10-04', CodRef: 3, RazonRef: 'Corrige montos' },
    certPfx: Buffer.from(PFX_B64, 'base64'), certPass: CERT_PASS,
    cafXml: cafXml('77591234-0', 61, 1, 5),
  })
  assert.ok(xml.includes('<TipoDTE>61</TipoDTE>'))
  assert.ok(xml.includes('<Referencia>') && xml.includes('<TpoDocRef>33</TpoDocRef>') && xml.includes('<FolioRef>1</FolioRef>') && xml.includes('<CodRef>3</CodRef>'))
})

test('adaptador real: folio fuera del rango del CAF lanza con el rango en el mensaje', () => {
  assert.throws(() => emisor.generarXMLDTE({
    tipo: 33, folio: 999, fechaEmision: '2026-10-04',
    emisor: { rut: '77591234-0', razon_social: 'x', giro: 'x', direccion: 'x', comuna: 'x', resolucion: { fecha: '2024-01-15', numero: 0 } },
    receptor: RECEPTOR_OK, items: [{ nombre: 'x', cantidad: 1, precio: 1 }],
    certPfx: Buffer.from(PFX_B64, 'base64'), certPass: CERT_PASS,
    cafXml: cafXml('77591234-0', 33, 1, 5),
  }), /999 fuera del rango autorizado del CAF \(1–5\)/)
})
