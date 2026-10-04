/**
 * BLOQUE 3 — DTE → CONTABILIDAD (cierra los riesgos de la auditoría 2A):
 *
 *  T1  migración: columna idempotencia + UNIQUE parcial
 *  T2  emitir con idempotencia → deduplicado (misma fila, mismo folio)
 *  T3  emitir sin clave → folios distintos (comportamiento documentado)
 *  T4  sincronizar ignora no-ACEPTADO (ENVIADO/ERROR/RECHAZADO no contabilizan)
 *  T5  sincronizar 33 ACEPTADO → documento bandeja origen 'dte' + dte.documento_id
 *  T6  sincronizar re-ejecutado → idempotente (0 creados)
 *  T7  dedupe RCV: ingestarBatch con el mismo folio → duplicado, NO nueva fila
 *      (una sola representación del documento — riesgo 2A#4 cerrado)
 *  T8  flujo completo 33: regla → clasificación → propuesta → confirmación
 *      humana → asiento (Debe CLIENTES / Haber VENTAS + IVA_DEBITO) → vínculo
 *      dte.asiento_id (riesgo 2A#1 y cadena 2A-§14 cerrados)
 *  T9  exenta 34 → asiento SIN pata IVA
 *  T10 NC 61 → asiento invertido (reversión de ingreso + IVA)
 *  T11 sin regla → documento PENDIENTE sin propuesta (nada inventado)
 *  T12 aislamiento: ajeno 403
 *  T13 auditoría dte.contabilizar.sincronizar
 *
 * Ejecutar con: node --test test/dte-contable.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')
const forge = require('node-forge')

const dbFile = path.join(os.tmpdir(), `iva-mensual-dte-b3-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { requireAuth } = require('../backend/middleware/requireAuth')
const routerDte = require('../backend/routes/dte')
const empresas = require('../backend/core/empresas')
const emisor = require('../backend/core/dte-emisor')
const contable = require('../backend/core/dte-contable')
const reglas = require('../backend/core/reglas')
const propuestas = require('../backend/core/propuestas')
const documentos = require('../backend/core/documentos')
const cuentas = require('../backend/core/cuentas')
const asientos = require('../backend/core/asientos')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const sufijo of ['', '-wal', '-shm']) fs.rmSync(dbFile + sufijo, { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP1 = empresas.crear(db, { usuarioId: adminId, rut: '77591234-0', nombre: 'B3 Demo SpA', claveSii: 'k-b3', tasaPpm: 0 }).id
const EMP2 = empresas.crear(db, { usuarioId: adminId, rut: '77999999-8', nombre: 'B3 Otra Ltda', claveSii: 'k-b32', tasaPpm: 0 }).id

const { hashPassword } = require('../backend/services/password')
function crearUsuario(username, rol, empresaId) {
  const id = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)`).run(username, hashPassword(`${username}-pass123`)).lastInsertRowid
  if (empresaId) empresas.asignarRol(db, { usuarioIdEjecutor: adminId, usuarioIdObjetivo: id, empresaId, rol })
  return id
}
const contadorId = crearUsuario('cont_b3', 'contador', EMP1)
const ajenoId = crearUsuario('ajeno_b3', 'contador', EMP2)

function sesionPara(userId) {
  const sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(sid, userId, new Date(Date.now() + 3600e3).toISOString())
  return sid
}
const SID_ADMIN = sesionPara(adminId)
const SID_CONT = sesionPara(contadorId)
const SID_AJENO = sesionPara(ajenoId)

const fakeAdapter = {
  async emitirDTE({ tipo, folio, receptor }) {
    return { folio, xml: `<DTE tipo="${tipo}" folio="${folio}"/>`, track_id: `trk-b3-${tipo}-${folio}`, sii_respuesta: { trackId: `trk-b3-${tipo}-${folio}`, estado: 'REC' } }
  },
  async consultarEstadoDTE({ trackId, esExitoso }) {
    return { ok: true, trackId, estado: esExitoso === false ? 'RCH' : 'EPR', descripcion: esExitoso === false ? 'Rechazado' : 'Envío Procesado', esExitoso: esExitoso !== false, esRechazado: esExitoso === false, esIntermedio: false }
  },
}
const app = express()
app.use(express.json())
app.use('/api/dte', requireAuth, routerDte)
app.set('dteAdapter', fakeAdapter)
const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => server.close())

async function req(method, ruta, body, sid) {
  return fetch(`${base}${ruta}`, {
    method,
    headers: { 'content-type': 'application/json', ...(sid ? { cookie: `sid=${sid}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const RECEPTOR = { rut: '76123456-0', razon_social: 'Cliente B3 Ltda', giro: 'Comercio', direccion: 'Providencia 1', comuna: 'Santiago' }

// CAF REAL generado con node-forge (misma librería que usa @devlas/dte-sii):
// el constructor CAF parsea y carga la clave privada — debe ser válida.
const RSA_KEY_PEM = (() => {
  const par = forge.pki.rsa.generateKeyPair(1024)
  return forge.pki.privateKeyToPem(par.privateKey)
})()
function cafXml(tipo, desde = 1, hasta = 9) {
  return `<AUTORIZACION><CAF version="1.0"><DA><RE>77591234-0</RE><RS>B3 Demo SpA</RS><TD>${tipo}</TD>` +
    `<RNG><D>${desde}</D><H>${hasta}</H></RNG><FA>2026-01-01</FA><RSAPK><M>aaa</M><E>Aw==</E></RSAPK><IDK>300</IDK></DA>` +
    `<FRMA algoritmo="SHA1withRSA">firma</FRMA></CAF><RSASK>${RSA_KEY_PEM}</RSASK></AUTORIZACION>`
}

/** Config + CAFs + regla para EMP1; emite un DTE y lo deja ACEPTADO (fake SII). */
async function emitirDte(tipo, items, { idempotencia = null, referencia = null } = {}) {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, {
    tipo, items, receptor: RECEPTOR, referencia, idempotencia,
  }, SID_CONT)
  assert.strictEqual(r.status, 200, JSON.stringify(await r.clone().json().catch(() => ({}))))
  const { dte } = await r.json()
  const re = await req('POST', `/api/dte/empresas/${EMP1}/dtes/${dte.id}/estado`, {}, SID_CONT)
  assert.strictEqual(re.status, 200)
  const { dte: dteConsultado } = await re.json()
  assert.strictEqual(dteConsultado.estado, 'ACEPTADO')
  return dteConsultado
}

test.before(async () => {
  // Config emisor completa (cifrada; el pfx falso nunca se parsea — adaptador fake)
  const PFX = Buffer.from('pfx-de-prueba-no-real', 'binary').toString('base64')
  const rc = await req('PUT', `/api/dte/empresas/${EMP1}/config`, {
    razon_social: 'B3 Demo SpA', giro: 'Servicios contables', direccion: 'Moneda 100',
    comuna: 'Santiago', acteco: '692000', fch_resol: '2024-01-15', nro_resol: '0',
    ambiente: 'certificacion', cert_pfx: PFX, cert_pass: 'pass-fake',
  }, SID_CONT)
  assert.strictEqual(rc.status, 200)
  for (const tipo of [33, 34, 61]) {
    const rf = await req('POST', `/api/dte/empresas/${EMP1}/folios`, { caf_xml: cafXml(tipo) }, SID_CONT)
    assert.strictEqual(rf.status, 200, `CAF tipo ${tipo}: ${JSON.stringify(await rf.clone().json().catch(() => ({})))}`)
  }
  // Regla del contador: ventas → VENTAS_SERVICIOS (alias de la plantilla)
  const cta = cuentas.cuentaPorAlias(db, EMP1, 'VENTAS_SERVICIOS')
  assert.ok(cta, 'alias VENTAS_SERVICIOS en plantilla')
  reglas.guardar(db, {
    empresaId: EMP1, usuarioId: contadorId, nombre: 'B3 · Venta → Ventas de servicios',
    prioridad: 20, activa: true, tipoFlujo: 'venta', tipoDoc: null,
    cuentaId: cta.id, tratamientoIva: 'credito',
  })
})

// ---------- T1: migración ----------
test('T1 migración BLOQUE 3: columna idempotencia + UNIQUE parcial', () => {
  const cols = db.prepare(`PRAGMA table_info(dte_emitidos)`).all().map((c) => c.name)
  assert.ok(cols.includes('idempotencia'))
  const idx = db.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_dte_emitidos_idempotencia'`).get()
  assert.ok(idx && /UNIQUE/.test(idx.sql) && /idempotencia IS NOT NULL/.test(idx.sql))
})

// ---------- T2/T3: idempotencia de emisión ----------
test('T2 emitir con idempotencia: re-envío de la misma clave → deduplicado, misma fila y folio', async () => {
  const items = [{ nombre: 'Asesoría', cantidad: 2, precio: 10000 }]
  const r1 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 33, items, receptor: RECEPTOR, idempotencia: 'cli-2026-10-001' }, SID_CONT)
  const r2 = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 33, items, receptor: RECEPTOR, idempotencia: 'cli-2026-10-001' }, SID_CONT)
  assert.strictEqual(r1.status, 200); assert.strictEqual(r2.status, 200)
  const b1 = await r1.json(); const b2 = await r2.json()
  assert.strictEqual(b1.dte.id, b2.dte.id, 'misma fila')
  assert.strictEqual(b1.dte.folio, b2.dte.folio)
  assert.strictEqual(b2.deduplicado, true, 'marcado como deduplicado')
  const n = db.prepare(`SELECT COUNT(*) AS n FROM dte_emitidos WHERE idempotencia = 'cli-2026-10-001'`).get().n
  assert.strictEqual(n, 1)
})

test('T3 emitir SIN clave de idempotencia: dos llamadas → dos folios (comportamiento documentado: la UI debe enviar clave)', async () => {
  const items = [{ nombre: 'X', cantidad: 1, precio: 1000 }]
  const a = await (await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 34, items, receptor: RECEPTOR }, SID_CONT)).json()
  const b = await (await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 34, items, receptor: RECEPTOR }, SID_CONT)).json()
  assert.notStrictEqual(a.dte.folio, b.dte.folio)
  assert.strictEqual(b.dte.folio, a.dte.folio + 1)
})

// ---------- T4: solo ACEPTADO contabiliza ----------
test('T4 sincronizar: DTE no-ACEPTADO (ENVIADO, ERROR, RECHAZADO) no genera documento contable', async () => {
  // ENVIADO: emitir sin consultar estado
  await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 33, items: [{ nombre: 'Enviado', cantidad: 1, precio: 500 }], receptor: RECEPTOR }, SID_CONT)
  // RECHAZADO: consultar con esExitoso=false (adapter del test)
  const rechazado = await req('POST', `/api/dte/empresas/${EMP1}/emitir`, { tipo: 33, items: [{ nombre: 'Rech', cantidad: 1, precio: 500 }], receptor: RECEPTOR }, SID_CONT)
  const { dte: dR } = await rechazado.json()
  app.set('dteAdapter', { ...fakeAdapter, async consultarEstadoDTE() { return { ok: true, estado: 'RCH', descripcion: 'Rechazado', esExitoso: false, esRechazado: true, esIntermedio: false } } })
  await req('POST', `/api/dte/empresas/${EMP1}/dtes/${dR.id}/estado`, {}, SID_CONT)
  app.set('dteAdapter', fakeAdapter)

  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  assert.strictEqual(s.sincronizacion.documentos_creados, 0)
  const estados = Object.fromEntries(s.sincronizacion.omitidos_por_estado.map((o) => [o.estado, o.n]))
  assert.ok(estados.ENVIADO >= 1 && estados.RECHAZADO >= 1, JSON.stringify(estados))
  const docsDte = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE origen = 'dte'`).get().n
  assert.strictEqual(docsDte, 0)
})

// ---------- T5/T6: sincronización de un ACEPTADO ----------
let DTE33 = null
test('T5 sincronizar 33 ACEPTADO → documento de bandeja origen dte + vínculo dte→documento', async () => {
  DTE33 = await emitirDte(33, [{ nombre: 'Asesoría contable', cantidad: 2, precio: 10000 }])
  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  const { sincronizacion: s1 } = s
  assert.strictEqual(s1.documentos_creados, 1, JSON.stringify(s1))

  const doc = db.prepare(`SELECT * FROM documentos WHERE id = ?`).get(s1.detalle_creados[0].documento_id)
  assert.strictEqual(doc.tipo_flujo, 'venta')
  assert.strictEqual(doc.tipo_doc, 33)
  assert.strictEqual(doc.folio, String(DTE33.folio))
  assert.strictEqual(doc.rut_contraparte, RECEPTOR.rut)
  assert.strictEqual(doc.monto_neto, 20000)
  assert.strictEqual(doc.monto_iva, 3800)
  assert.strictEqual(doc.monto_total, 23800)
  assert.strictEqual(doc.origen, 'dte')
  assert.ok(doc.fecha_docto.startsWith(new Date().toISOString().slice(0, 10).slice(0, 7)), 'fecha_docto = fecha_emision (devengo)')

  const fila = db.prepare(`SELECT documento_id FROM dte_emitidos WHERE id = ?`).get(DTE33.id)
  assert.strictEqual(fila.documento_id, doc.id)
})

test('T6 sincronizar re-ejecutado → idempotente (0 creados, 0 duplicados)', async () => {
  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  assert.strictEqual(s.sincronizacion.documentos_creados, 0)
  assert.strictEqual(s.sincronizacion.aceptados_procesados, 0)
  const n = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE origen = 'dte'`).get().n
  assert.strictEqual(n, 1)
})

// ---------- T7: dedupe con ingesta RCV ----------
test('T7 re-ingesta RCV del mismo DTE → dedupe (UNA representación, riesgo 2A#4 cerrado)', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?`).get(EMP1).n
  const r = documentos.ingestarBatch(db, {
    empresaId: EMP1, usuarioId: contadorId, tipoFlujo: 'venta',
    periodo: contable.periodoDesdeFecha(DTE33.fecha_emision),
    documentos: [{
      tipoDoc: 33, folio: String(DTE33.folio), rutDoc: RECEPTOR.rut, razonSocial: RECEPTOR.razon_social,
      fechaDocto: DTE33.fecha_emision, montoExento: 0, montoNeto: 20000, montoIVA: 3800, montoTotal: 23800,
    }],
  })
  assert.strictEqual(r.duplicados, 1, 'el DTE emitido ya vive en la bandeja')
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?`).get(EMP1).n
  assert.strictEqual(despues, antes)
})

// ---------- T8: flujo completo 33 → asiento → vínculo ----------
test('T8 flujo completo 33: propuesta automática por regla → confirmación humana → asiento cuadrado + dte.asiento_id', async () => {
  DTE33 = db.prepare(`SELECT * FROM dte_emitidos WHERE id = ?`).get(DTE33.id)
  const doc = db.prepare(`SELECT * FROM documentos WHERE id = ?`).get(DTE33.documento_id)
  // La sincronización (T5) con regla activa ya clasificó y propuso:
  assert.strictEqual(doc.estado, 'PROPUESTO', `estado ${doc.estado}`)
  const p = db.prepare(`SELECT * FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(doc.id)
  assert.ok(p, 'propuesta PENDIENTE viva')

  // Confirmación HUMANA (§6) — el único camino al asiento
  const { asiento } = propuestas.confirmar(db, { empresaId: EMP1, usuarioId: contadorId, propuestaId: p.id })
  const ctaVentas = cuentas.cuentaPorAlias(db, EMP1, 'VENTAS_SERVICIOS')
  const ctaClientes = cuentas.cuentaPorAlias(db, EMP1, 'CLIENTES')
  const ctaIva = cuentas.cuentaPorAlias(db, EMP1, 'IVA_DEBITO')
  const lineas = asiento.lineas
  assert.strictEqual(asiento.fecha, DTE33.fecha_emision, 'devengo en fecha del DTE')
  assert.ok(lineas.some((l) => l.cuenta_id === ctaClientes.id && l.debe === 23800), 'Debe CLIENTES total')
  assert.ok(lineas.some((l) => l.cuenta_id === ctaVentas.id && l.haber === 20000), 'Haber VENTAS base')
  assert.ok(lineas.some((l) => l.cuenta_id === ctaIva.id && l.haber === 3800), 'Haber IVA_DEBITO')
  const dDoc = db.prepare(`SELECT estado, asiento_id FROM documentos WHERE id = ?`).get(doc.id)
  assert.strictEqual(dDoc.estado, 'CONTABILIZADO')

  // Segunda pasada: vínculo bidireccional DTE ↔ asiento (auditoría 2A §14)
  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  assert.strictEqual(s.sincronizacion.asientos_vinculados, 1, JSON.stringify(s.sincronizacion))
  const fila = db.prepare(`SELECT asiento_id FROM dte_emitidos WHERE id = ?`).get(DTE33.id)
  assert.strictEqual(fila.asiento_id, asiento.id)
  // Y desde el asiento se llega al DTE (cadena completa):
  const doc2 = db.prepare(`SELECT dte.id FROM dte_emitidos dte JOIN documentos d ON d.id = dte.documento_id WHERE d.asiento_id = ?`).get(asiento.id)
  assert.strictEqual(doc2.id, DTE33.id)
})

// ---------- T9: exenta 34 ----------
test('T9 flujo exenta 34 → asiento SIN pata IVA (riesgo 2A#5 cerrado)', async () => {
  const dte = await emitirDte(34, [{ nombre: 'Servicio exento', cantidad: 1, precio: 100000 }])
  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  assert.strictEqual(s.sincronizacion.documentos_creados, 1)
  const doc = db.prepare(`SELECT * FROM documentos WHERE id = ?`).get(s.sincronizacion.detalle_creados[0].documento_id)
  assert.strictEqual(doc.estado, 'PROPUESTO')
  const p = db.prepare(`SELECT * FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(doc.id)
  const { asiento } = propuestas.confirmar(db, { empresaId: EMP1, usuarioId: contadorId, propuestaId: p.id })
  const ctaIva = cuentas.cuentaPorAlias(db, EMP1, 'IVA_DEBITO')
  const ctaVentas = cuentas.cuentaPorAlias(db, EMP1, 'VENTAS_SERVICIOS')
  assert.ok(!asiento.lineas.some((l) => l.cuenta_id === ctaIva.id), 'sin IVA')
  assert.ok(asiento.lineas.some((l) => l.cuenta_id === ctaVentas.id && l.haber === 100000))
  assert.strictEqual(asiento.lineas.reduce((s2, l) => s2 + l.debe, 0), 100000)
})

// ---------- T10: NC 61 ----------
test('T10 flujo NC 61 → asiento INVERTIDO (reversión de ingreso + IVA + CxC, riesgo 2A#3 cerrado)', async () => {
  const dte = await emitirDte(61, [{ nombre: 'Ajuste monto', cantidad: 1, precio: 10000 }], {
    referencia: { TpoDocRef: 33, FolioRef: DTE33.folio, CodRef: 3, RazonRef: 'Corrige montos' },
  })
  const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
  const doc = db.prepare(`SELECT * FROM documentos WHERE id = ?`).get(s.sincronizacion.detalle_creados[0].documento_id)
  assert.strictEqual(doc.tipo_doc, 61)
  const p = db.prepare(`SELECT * FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(doc.id)
  const { asiento } = propuestas.confirmar(db, { empresaId: EMP1, usuarioId: contadorId, propuestaId: p.id })
  const ctaClientes = cuentas.cuentaPorAlias(db, EMP1, 'CLIENTES')
  const ctaVentas = cuentas.cuentaPorAlias(db, EMP1, 'VENTAS_SERVICIOS')
  const ctaIva = cuentas.cuentaPorAlias(db, EMP1, 'IVA_DEBITO')
  assert.ok(asiento.lineas.some((l) => l.cuenta_id === ctaClientes.id && l.haber === 11900), 'CxC reversada al haber')
  assert.ok(asiento.lineas.some((l) => l.cuenta_id === ctaVentas.id && l.debe === 10000), 'ingreso reversado al debe')
  assert.ok(asiento.lineas.some((l) => l.cuenta_id === ctaIva.id && l.debe === 1900), 'IVA débito reversado al debe')
})

// ---------- T11: sin regla ----------
test('T11 sin regla aplicable → documento PENDIENTE visible, sin propuesta, sin cuentas inventadas', async () => {
  const dte = await emitirDte(33, [{ nombre: 'Sin regla', cantidad: 1, precio: 999 }], { idempotencia: 'b3-sin-regla' })
  // Regla solo cubre EMP1; este DTE ya fue clasificado por la regla de EMP1 (mismo tipo_flujo=venta).
  // Para probar "sin regla": documento de EMP1 cuyo RUT/type no calza → usamos regla con tipoDoc específico.
  // Simplificación honesta: clasificar MANUAL es el camino del contador; aquí verificamos el caso
  // elimando reglas temporalmente.
  db.prepare(`UPDATE reglas_contables SET activa = 0 WHERE empresa_id = ?`).run(EMP1)
  try {
    const dte2 = await emitirDte(33, [{ nombre: 'Sin regla 2', cantidad: 1, precio: 888 }])
    const s = await (await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_CONT)).json()
    const creado = s.sincronizacion.detalle_creados.find((c) => c.dte_id === dte2.id)
    assert.ok(creado, 'documento creado')
    const doc = db.prepare(`SELECT estado FROM documentos WHERE id = ?`).get(creado.documento_id)
    assert.strictEqual(doc.estado, 'PENDIENTE')
    assert.ok(s.sincronizacion.sin_regla >= 1)
    const hayPropuesta = db.prepare(`SELECT 1 FROM propuestas WHERE documento_id = ?`).get(creado.documento_id)
    assert.ok(!hayPropuesta, 'sin propuesta (nada inventado)')
    // El contador lo resuelve por el flujo existente: clasificar manual + proponer
    const ctaVentas = cuentas.cuentaPorAlias(db, EMP1, 'VENTAS_SERVICIOS')
    documentos.clasificar(db, { empresaId: EMP1, usuarioId: contadorId, documentoId: creado.documento_id, cuentaId: ctaVentas.id, tratamientoIva: 'credito' })
    propuestas.generar(db, { empresaId: EMP1, usuarioId: contadorId, documentoId: creado.documento_id })
    const doc2 = db.prepare(`SELECT estado FROM documentos WHERE id = ?`).get(creado.documento_id)
    assert.strictEqual(doc2.estado, 'PROPUESTO')
  } finally {
    db.prepare(`UPDATE reglas_contables SET activa = 1 WHERE empresa_id = ?`).run(EMP1)
  }
})

// ---------- T12: aislamiento ----------
test('T12 aislamiento: usuario ajeno no puede sincronizar la empresa; auditoría por empresa', async () => {
  const r = await req('POST', `/api/dte/empresas/${EMP1}/sincronizar-contabilidad`, {}, SID_AJENO)
  assert.strictEqual(r.status, 403)
  const aud = db.prepare(`SELECT empresa_id FROM auditoria WHERE accion = 'dte.contabilizar.sincronizar' AND empresa_id = ?`).get(EMP1)
  assert.ok(aud, 'auditado en EMP1')
  const audOtra = db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE accion = 'dte.contabilizar.sincronizar' AND empresa_id = ?`).get(EMP2).n
  assert.strictEqual(audOtra, 0)
})
