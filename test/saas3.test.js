/**
 * Tests SAAS-3 — PAGOS Y FACTURACIÓN DE LA SUSCRIPCIÓN:
 * checkout con adaptador inyectable, webhook idempotente → activarPlan
 * (renovación suma al fin vigente), rechazo no toca la licencia, dedupe en
 * dos espacios (evento y pago), firma HMAC x-signature de MercadoPago,
 * factura electrónica (DTE 33) con desglose IVA y emisión vía adaptador.
 * Ejecutar con: node --test test/saas3.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const dbFile = path.join(os.tmpdir(), `iva-mensual-saas3-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const permisos = require('../backend/core/permisos')
const licencias = require('../backend/core/licencias')
const pagos = require('../backend/core/pagos')
const facturas = require('../backend/core/facturas-suscripcion')
const mp = require('../backend/core/pagos-mercadopago')
const dte = require('../backend/core/dte')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77591234-0', nombre: 'Suscripción Test SpA',
  claveSii: 'clave-s3', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77561234-7', nombre: 'Otra Suscripción Ltda',
  claveSii: 'clave-s3b', tasaPpm: 0.015, telefono: '912345678',
})

// Dueño de EMP (admin_empresa) y dueño de EMP2 (para el aislamiento)
const hash = require('../backend/services/password').hashPassword('dueno12345678')
const duenoId = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('dueno_s3', ?, 0)`).run(hash).lastInsertRowid
empresas.asignarRol(db, { empresaId: EMP.id, usuarioIdObjetivo: duenoId, rol: 'admin_empresa', usuarioIdEjecutor: adminId })

// Normaliza la licencia: PRUEBA por 3 días (las creadas por super_admin nacen
// HEREDADA con fin +3650 días y la renovación sumaría sobre ese fin).
function licenciaPrueba(empresaId) {
  db.prepare(`UPDATE suscripciones SET plan = 'PRUEBA', estado = 'PRUEBA', fin = date('now', '+3 days'), monto_clp = 0 WHERE empresa_id = ?`)
    .run(empresaId)
}
licenciaPrueba(EMP.id)
licenciaPrueba(EMP2.id)

/** Adaptador de pasarela FALSO: los tests jamás tocan la red. */
function fakeGateway() {
  const memoria = new Map()
  let seq = 1000
  return {
    async crearPreferencia({ monto_clp, descripcion, external_reference }) {
      assert.ok(monto_clp > 0 && external_reference.startsWith('pago_suscripcion:'))
      const id = `pref-${++seq}`
      return { id, init_point: `https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=${id}` }
    },
    obtenerPago: (id) => memoria.get(String(id)) || null,
    _set: (id, estado, external_reference, extra = {}) => memoria.set(String(id), { estado, external_reference, monto: 29900, moneda: 'CLP', ...extra }),
  }
}

/** Adaptador DTE FALSO: no toca el SII. */
const fakeDte = {
  async emitirFactura({ folio, receptor }) {
    return { folio, xml: `<DTE folio="${folio}" receptor="${receptor.rut}"/>`, track_id: `trk-${folio}` }
  },
}

function hoyMasMeses(n, desde = null) {
  const base = desde || licencias.hoyISO()
  const [y, m, d] = base.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10)
}

// ---------- Migración ----------

test('migración SAAS-3: tablas pagos_suscripcion, webhook_eventos y facturas_suscripcion', () => {
  for (const t of ['pagos_suscripcion', 'webhook_eventos', 'facturas_suscripcion']) {
    assert.ok(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(t), t)
  }
  const cols = db.prepare(`PRAGMA table_info(pagos_suscripcion)`).all().map((c) => c.name)
  for (const c of ['gateway', 'gateway_pago_id', 'external_reference', 'estado']) assert.ok(cols.includes(c), c)
})

// ---------- RBAC ----------

test('permisos SAAS-3: pagar = admin_empresa/super_admin; facturar = contador/super_admin; ver = todos los roles de empresa', () => {
  const puede = (rol, cap) => permisos.permisosDeRol(rol).has(cap)
  for (const rol of ['super_admin', 'admin_empresa']) assert.ok(puede(rol, 'licencias:pagar'), `${rol} paga`)
  for (const rol of ['contador', 'auditor', 'tesoreria']) assert.ok(!puede(rol, 'licencias:pagar'), `${rol} NO paga`)
  for (const rol of ['super_admin', 'contador']) assert.ok(puede(rol, 'facturacion:emitir'), `${rol} factura`)
  for (const rol of ['admin_empresa', 'auditor', 'tesoreria']) assert.ok(!puede(rol, 'facturacion:emitir'), `${rol} NO factura`)
  for (const rol of ['super_admin', 'contador', 'admin_empresa', 'auditor', 'tesoreria']) assert.ok(puede(rol, 'licencias:ver'), `${rol} ve`)
})

// ---------- Desglose IVA ----------

test('desglose del plan PYME $29.900 con IVA incluido → neto + IVA = total', () => {
  const { neto, iva, total } = facturas.desglose(29900)
  assert.strictEqual(total, 29900)
  assert.strictEqual(neto, 25126)
  assert.strictEqual(iva, 4774)
  assert.strictEqual(neto + iva, total)
})

// ---------- Checkout ----------

test('checkout: fila PENDIENTE con external_reference, preferencia y auditoría', async () => {
  const gw = fakeGateway()
  const { pago, checkout } = await pagos.crearCheckout(db, {
    empresaId: EMP.id, plan: 'PYME', meses: 1, gatewayAdapter: gw, usuarioId: duenoId,
  })
  assert.strictEqual(pago.estado, 'PENDIENTE')
  assert.strictEqual(pago.plan, 'PYME')
  assert.strictEqual(pago.monto_clp, licencias.PLANES.PYME.monto_clp)
  assert.ok(pago.external_reference.startsWith(`pago_suscripcion:${pago.id}`))
  assert.strictEqual(pago.gateway_pref_id, checkout.id)
  assert.ok(checkout.init_point.includes('mercadopago'))
  const audit = db.prepare(`SELECT accion FROM auditoria WHERE empresa_id = ? AND accion = 'pago.checkout' AND entidad_id = ?`).get(EMP.id, String(pago.id))
  assert.ok(audit, 'auditado')
})

test('checkout: plan inválido, PRUEBA y meses fuera de rango se rechazan', async () => {
  const gw = fakeGateway()
  await assert.rejects(() => pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'GIGANTE', gatewayAdapter: gw }))
  await assert.rejects(() => pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PRUEBA', gatewayAdapter: gw }))
  await assert.rejects(() => pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PYME', meses: 0, gatewayAdapter: gw }))
  await assert.rejects(() => pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PYME', meses: 37, gatewayAdapter: gw }))
})

test('aislamiento: el dueño de otra empresa no aparece — pero una licencia SUSPENDIDA SÍ puede pagar', async () => {
  // el RBAC de la ruta lo garantiza (rolEnEmpresa null → 403); aquí se verifica
  // el diseño de dominio: pagar jamás queda bloqueado por la propia licencia.
  db.prepare(`UPDATE suscripciones SET estado = 'SUSPENDIDA' WHERE empresa_id = ?`).run(EMP2.id)
  const gw = fakeGateway()
  const { pago } = await pagos.crearCheckout(db, {
    empresaId: EMP2.id, plan: 'PRO', meses: 1, gatewayAdapter: gw, usuarioId: adminId,
  })
  assert.strictEqual(pago.estado, 'PENDIENTE')
})

// ---------- Webhook → activarPlan ----------

test('webhook aprobado → pago APROBADO, licencia ACTIVA 1 mes y factura PENDIENTE con desglose', async () => {
  const gw = fakeGateway()
  const { pago } = await pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PYME', meses: 1, gatewayAdapter: gw, usuarioId: duenoId })
  gw._set(pago.id, 'approved', pago.external_reference)

  const r = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:${pago.id}`, pagoPasarelaId: String(pago.id), payloadJson: '{}',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.estado, 'APROBADO')

  const p = db.prepare(`SELECT * FROM pagos_suscripcion WHERE id = ?`).get(pago.id)
  assert.strictEqual(p.estado, 'APROBADO')
  assert.strictEqual(p.gateway_pago_id, String(pago.id))

  const s = licencias.suscripcionDe(db, EMP.id)
  assert.strictEqual(s.plan, 'PYME')
  assert.strictEqual(s.estado, 'ACTIVA')
  assert.strictEqual(s.fin, hoyMasMeses(1))

  const f = facturas.obtenerPorPago(db, pago.id)
  assert.ok(f, 'factura pendiente creada')
  assert.strictEqual(f.estado, 'PENDIENTE')
  assert.strictEqual(f.monto_total, 29900)
  assert.strictEqual(f.monto_neto, 25126)
  assert.strictEqual(f.monto_iva, 4774)

  const audit = db.prepare(`SELECT accion FROM auditoria WHERE empresa_id = ? AND accion = 'pago.aprobado'`).get(EMP.id)
  assert.ok(audit, 'auditado')
})

test('idempotencia del webhook: la MISMA notificación no re-activa la licencia', async () => {
  const sAntes = licencias.suscripcionDe(db, EMP.id)
  const pagosAprobados = db.prepare(`SELECT COUNT(*) AS n FROM pagos_suscripcion WHERE estado = 'APROBADO'`).get().n

  const gw = fakeGateway()
  const r = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:${db.prepare(`SELECT id FROM pagos_suscripcion WHERE empresa_id = ? AND estado = 'APROBADO'`).get(EMP.id).id}`,
    pagoPasarelaId: String(db.prepare(`SELECT gateway_pago_id FROM pagos_suscripcion WHERE empresa_id = ? AND estado = 'APROBADO'`).get(EMP.id).gateway_pago_id),
  })
  assert.strictEqual(r.deduplicado, true)

  const sDespues = licencias.suscripcionDe(db, EMP.id)
  assert.strictEqual(sDespues.fin, sAntes.fin, 'fin de licencia sin cambio')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM pagos_suscripcion WHERE estado = 'APROBADO'`).get().n, pagosAprobados)
})

test('el MISMO pago notificado por otro evento tampoco re-activa (ya_aprobado)', async () => {
  const fila = db.prepare(`SELECT * FROM pagos_suscripcion WHERE empresa_id = ? AND estado = 'APROBADO'`).get(EMP.id)
  const gw = fakeGateway()
  gw._set(fila.gateway_pago_id, 'approved', fila.external_reference)
  const r = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:otro-evento-${Date.now()}`, pagoPasarelaId: fila.gateway_pago_id,
  })
  assert.strictEqual(r.deduplicado, true)
  assert.strictEqual(r.resultado, 'ya_aprobado')
})

test('pago desconocido o con referencia divergente: sin activación y sin caída', async () => {
  const gw = fakeGateway()
  const r1 = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: 'payment:desconocido-1', pagoPasarelaId: '99999',
  })
  assert.strictEqual(r1.codigo, 'PAGO_NO_ENCONTRADO')

  const r2 = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: 'payment:divergente-1', pagoPasarelaId: '88888',
  })
  assert.strictEqual(r2.codigo, 'PAGO_NO_ENCONTRADO', 'no existe checkout con ese id → nada que hacer')

  const fila = db.prepare(`SELECT * FROM pagos_suscripcion WHERE empresa_id = ? AND estado = 'APROBADO' ORDER BY id DESC LIMIT 1`).get(EMP.id)
  assert.ok(fila, 'hay al menos un pago aprobado previo y sigue intacto')

  // Un checkout manipulado (external_reference que no coincide con lo que la
  // pasarela reporta) se detecta y se rechaza sin activar nada.
  db.prepare(`INSERT INTO pagos_suscripcion (empresa_id, plan, monto_clp, meses, gateway, external_reference, estado) VALUES (?, 'PYME', 29900, 1, 'mercadopago', 'pago_suscripcion:manipulado', 'PENDIENTE')`).run(EMP.id)
  const manipulado = db.prepare(`SELECT * FROM pagos_suscripcion WHERE external_reference = 'pago_suscripcion:manipulado'`).get()
  gw._set('66666', 'approved', 'referencia_ajena')
  db.prepare(`UPDATE pagos_suscripcion SET gateway_pago_id = '66666' WHERE id = ?`).run(manipulado.id)
  const r3 = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: 'payment:divergente-2', pagoPasarelaId: '66666',
  })
  assert.strictEqual(r3.codigo, 'REFERENCIA_DIVERGENTE', 'la referencia de la pasarela debe coincidir con el checkout')
})

test('webhook rechazado → pago RECHAZADO y licencia intacta; pending no cambia nada', async () => {
  licenciaPrueba(EMP.id)
  const gw = fakeGateway()
  const { pago } = await pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PYME', meses: 1, gatewayAdapter: gw, usuarioId: duenoId })

  gw._set(pago.id, 'rejected', pago.external_reference, { monto: 29900 })
  const r = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:r-${pago.id}`, pagoPasarelaId: String(pago.id),
  })
  assert.strictEqual(r.estado, 'RECHAZADO')
  const s = licencias.suscripcionDe(db, EMP.id)
  assert.strictEqual(s.estado, 'PRUEBA', 'la licencia no cambia con un pago rechazado')

  gw._set(pago.id, 'pending', pago.external_reference)
  const r2 = await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:p-${pago.id}`, pagoPasarelaId: String(pago.id),
  })
  assert.strictEqual(r2.estado, 'RECHAZADO', 'el pago ya resuelto no vuelve a PENDIENTE')
})

test('renovación: segundo pago aprobado extiende el fin desde el fin vigente', async () => {
  // Licencia ACTIVA vigente (como un cliente que renueva antes de vencer)
  db.prepare(`UPDATE suscripciones SET plan = 'PYME', estado = 'ACTIVA', fin = date('now', '+20 days') WHERE empresa_id = ?`).run(EMP.id)
  const s1 = licencias.suscripcionDe(db, EMP.id)
  const finPrevio = s1.fin

  const gw = fakeGateway()
  const { pago } = await pagos.crearCheckout(db, { empresaId: EMP.id, plan: 'PRO', meses: 1, gatewayAdapter: gw, usuarioId: duenoId })
  gw._set(pago.id, 'approved', pago.external_reference)
  await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:ren-${pago.id}`, pagoPasarelaId: String(pago.id),
  })

  const s2 = licencias.suscripcionDe(db, EMP.id)
  assert.strictEqual(s2.plan, 'PRO')
  assert.strictEqual(s2.estado, 'ACTIVA')
  assert.strictEqual(s2.fin, hoyMasMeses(1, finPrevio), 'se suma al fin vigente, no desde hoy')
})

// ---------- Firma del webhook (MercadoPago) ----------

test('validarFirmaWebhook: HMAC correcto valida; hash alterno, manifest distinto y firma ausente rechazan', () => {
  const secret = 'secreto-webhook-test'
  const dataId = '1234567890'
  const xRequestId = 'req-abc-123'
  const ts = '1699870400'
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex')

  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, secret }), true)
  // v1 puede traer varios hashes (cualquiera que coincida valida)
  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: `ts=${ts},v1=deadbeef,${v1}`, xRequestId, dataId, secret }), true)
  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: `ts=${ts},v1=${'0'.repeat(64)}`, xRequestId, dataId, secret }), false)
  // manifest distinto (dataId manipulado) no valida
  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId: '999', secret }), false)
  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: null, xRequestId, dataId, secret }), false)
  assert.strictEqual(mp.validarFirmaWebhook({ xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId, secret: 'otro-secreto' }), false)
})

// ---------- Factura electrónica ----------

test('emitir factura con adaptador: EMITIDA con folio correlativo, xml y track_id; re-emitir lanza', async () => {
  const fila = db.prepare(`SELECT * FROM pagos_suscripcion WHERE empresa_id = ? AND estado = 'APROBADO' ORDER BY id DESC LIMIT 1`).get(EMP.id)
  let f = facturas.obtenerPorPago(db, fila.id)
  if (!f) f = facturas.crearPendiente(db, fila)

  const rec = facturas.receptorDesdeEmpresa(db, EMP.id, { giro: 'Comercio', direccion: 'Av. Test 123', comuna: 'Providencia' })
  assert.strictEqual(rec.ok, true)
  const r = await facturas.emitir(db, {
    facturaId: f.id, emisor: { rut: '76123456-7', razon_social: 'JMV Consultores' },
    receptor: rec.receptor, dteAdapter: fakeDte, usuarioId: adminId,
  })
  assert.strictEqual(r.estado, 'EMITIDA')
  assert.strictEqual(r.folio, 1)
  assert.ok(r.xml.includes('folio="1"') && r.track_id === 'trk-1')

  await assert.rejects(() => facturas.emitir(db, {
    facturaId: f.id, emisor: {}, receptor: rec.receptor, dteAdapter: fakeDte,
  }), /ya fue emitida/)
})

test('receptor incompleto: se NOMINA lo que falta (giro, dirección, comuna) — jamás se adivina', () => {
  const rec = facturas.receptorDesdeEmpresa(db, EMP.id, {})
  assert.strictEqual(rec.ok, false)
  for (const campo of ['giro', 'direccion', 'comuna']) assert.ok(rec.faltantes.includes(campo), campo)
  // RUT y razón social vienen de la empresa: nunca faltan
  assert.ok(!rec.faltantes.includes('rut') && !rec.faltantes.includes('razon_social'))
})

test('segunda factura de otra empresa continúa la secuencia de folios del emisor', async () => {
  const gw = fakeGateway()
  const { pago } = await pagos.crearCheckout(db, { empresaId: EMP2.id, plan: 'PYME', meses: 3, gatewayAdapter: gw, usuarioId: adminId })
  gw._set(pago.id, 'approved', pago.external_reference)
  await pagos.procesarNotificacion(db, {
    gateway: 'mercadopago', gatewayAdapter: gw,
    eventoId: `payment:emp2-${pago.id}`, pagoPasarelaId: String(pago.id),
  })
  const rec = facturas.receptorDesdeEmpresa(db, EMP2.id, { giro: 'Servicios', direccion: 'Calle 2', comuna: 'Las Condes' })
  const r = await facturas.emitir(db, {
    facturaId: facturas.obtenerPorPago(db, pago.id).id,
    emisor: { rut: '76123456-7' }, receptor: rec.receptor, dteAdapter: fakeDte, usuarioId: adminId,
  })
  assert.strictEqual(r.folio, 2)
  assert.strictEqual(r.monto_total, 29900 * 3, '3 meses = 3× el precio mensual')
})

test('adaptador DTE real sin configuración: el emisor lanza nombrando las variables que faltan', () => {
  // La ruta llama emisorDesdeEnv() ANTES de emitir: es el primer gate y lista
  // las variables exactas que JMV debe configurar (firma, CAF y resolución).
  assert.throws(() => dte.emisorDesdeEnv(), /DTE_CERT_PFX[\s\S]*DTE_NRO_RESOL/)
})
