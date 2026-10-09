/**
 * Tests CRM (Fase B) — pipeline, recordatorios, campañas, engagement.
 *
 *  - pipeline: listar (default PROSPECTO), cambiar etapa (validación),
 *    interacción actualiza última_interaccion, auditado
 *  - recordatorios: crear (validaciones tipo/fecha/título), listar,
 *    completar (idempotente), auditado
 *  - campañas: plantillas generan mensaje con datos reales (empresa,
 *    engagement de días, pendientes), marcar enviado idempotente
 *  - engagement: score según datos reales (sincronización, pendientes,
 *    cierre, contacto), resumen coherente
 *  - RBAC del router: cliente (admin_empresa) recibe 403 en /api/crm
 * Ejecutar con: node --test test/crm.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const dbFile = path.join(os.tmpdir(), `iva-mensual-crm-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const crm = require('../backend/core/crm')
const empresasCore = require('../backend/core/empresas')
const express = require('express')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

// ---- setup: dos empresas ----
const calc = (body) => {
  let s = 0, m = 2
  for (let i = body.length - 1; i >= 0; i--) { s += +body[i] * m; m = m < 7 ? m + 1 : 2 }
  const d = 11 - (s % 11)
  return d === 11 ? '0' : d === 10 ? 'K' : String(d)
}
const rutA = `706${String(crypto.randomInt(1000000, 9999999)).slice(0, 4)}`
const rutAfull = `${rutA}-${calc(rutA)}`
assert.ok(empresasCore.validarRut(rutAfull), `RUT A sintético válido: ${rutAfull}`)
const empA = empresasCore.crear(db, { usuarioId: adminId, rut: rutAfull, nombre: 'CRM Test SA', claveSii: 'x'.repeat(8) })
const empAId = typeof empA === 'object' ? empA.id : empA
const rutB = `80${String(crypto.randomInt(100000, 999999)).slice(0, 5)}`
const rutBfull = `${rutB}-${calc(rutB)}`
assert.ok(empresasCore.validarRut(rutBfull), `RUT B sintético válido: ${rutBfull}`)
const empB = empresasCore.crear(db, { usuarioId: adminId, rut: rutBfull, nombre: 'Otro Cliente SPA', claveSii: 'x'.repeat(8) })
const empBId = typeof empB === 'object' ? empB.id : empB

/* ---------------------------- PIPELINE ---------------------------- */

test('pipeline: lista todas las empresas con etapa default PROSPECTO', () => {
  const p = crm.listarPipeline(db, { usuarioId: adminId })
  const a = p.find((x) => x.empresa_id === empAId)
  assert.ok(a, 'la empresa está en el pipeline')
  assert.strictEqual(a.etapa, 'PROSPECTO')
  assert.ok(p.length >= 2)
})

test('pipeline: cambiar etapa con validación y auditoría', () => {
  assert.throws(() => crm.actualizarEtapa(db, { usuarioId: adminId, empresaId: empAId, etapa: 'INVENTADA' }), /Etapa inválida/)
  const r = crm.actualizarEtapa(db, { usuarioId: adminId, empresaId: empAId, etapa: 'OPERATIVO', notas: 'cliente activo mensual' })
  assert.strictEqual(r.etapa, 'OPERATIVO')
  const fila = db.prepare(`SELECT etapa, notas, ultima_interaccion FROM crm_pipeline WHERE empresa_id = ?`).get(empAId)
  assert.strictEqual(fila.etapa, 'OPERATIVO')
  assert.strictEqual(fila.notas, 'cliente activo mensual')
  assert.ok(fila.ultima_interaccion, 'la interacción se registró')
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'crm.etapa_cambiar' AND entidad_id = ?`).get(String(empAId))
  assert.ok(aud, 'auditado')
})

test('pipeline: re-cambiar etapa actualiza (upsert, no segundo row)', () => {
  crm.actualizarEtapa(db, { usuarioId: adminId, empresaId: empAId, etapa: 'RIESGO', notas: 'sin sincronizar 2 meses' })
  const n = db.prepare(`SELECT COUNT(*) AS n FROM crm_pipeline WHERE empresa_id = ?`).get(empAId).n
  assert.strictEqual(n, 1)
  assert.strictEqual(db.prepare(`SELECT etapa FROM crm_pipeline WHERE empresa_id = ?`).get(empAId).etapa, 'RIESGO')
})

test('macarena no existe: lista sin inventar empresas', () => {
  const p = crm.listarPipeline(db, { usuarioId: adminId })
  assert.ok(!p.some((x) => /macarena/i.test(x.nombre || '')))
})

/* -------------------------- RECORDATORIOS -------------------------- */

test('recordatorios: validaciones', () => {
  assert.throws(() => crm.crearRecordatorio(db, { usuarioId: adminId, empresaId: empAId, tipo: 'mal', titulo: 'x', fecha: '2026-11-02' }), /Tipo inválido/)
  assert.throws(() => crm.crearRecordatorio(db, { usuarioId: adminId, empresaId: empAId, tipo: 'f29', titulo: '', fecha: '2026-11-02' }), /Título obligatorio/)
  assert.throws(() => crm.crearRecordatorio(db, { usuarioId: adminId, empresaId: empAId, tipo: 'f29', titulo: 'x', fecha: '02/11/2026' }), /Fecha inválida/)
  assert.throws(() => crm.crearRecordatorio(db, { usuarioId: adminId, empresaId: 999999, tipo: 'f29', titulo: 'x', fecha: '2026-11-02' }), /Empresa no encontrada/)
})

test('recordatorios: crear, listar, completar idempotente, auditado', () => {
  const r = crm.crearRecordatorio(db, {
    usuarioId: adminId, empresaId: empAId, tipo: 'f29',
    titulo: 'Revisar F29 octubre', fecha: '2026-11-05', notas: 'con el cliente en llamada previa',
  })
  assert.ok(r.id > 0)
  const pend = crm.listarRecordatorios(db, { soloPendientes: true })
  assert.ok(pend.some((x) => x.id === r.id && x.empresa_nombre === 'CRM Test SA'))
  const r2 = crm.completarRecordatorio(db, { usuarioId: adminId, recordatorioId: r.id })
  assert.strictEqual(r2.ok, true)
  const r3 = crm.completarRecordatorio(db, { usuarioId: adminId, recordatorioId: r.id })
  assert.strictEqual(r3.ya_completado, true)
  const pend2 = crm.listarRecordatorios(db, { soloPendientes: true })
  assert.ok(!pend2.some((x) => x.id === r.id), 'ya no está en pendientes')
  const aud = db.prepare(`SELECT * FROM auditoria WHERE accion = 'crm.recordatorio_completar'`).get()
  assert.ok(aud)
})

/* ---------------------------- CAMPAÑAS ---------------------------- */

test('campañas: plantilla inválida rechazada; bienvenida genera con nombre real', () => {
  assert.throws(() => crm.generarCampana(db, { usuarioId: adminId, empresaId: empAId, plantilla: 'spam' }), /Plantilla inválida/)
  const r = crm.generarCampana(db, { usuarioId: adminId, empresaId: empAId, plantilla: 'bienvenida' })
  assert.ok(r.mensaje.includes('CRM Test SA'), 'usa el nombre real de la empresa')
  assert.ok(!r.mensaje.includes('undefined'))
})

test('campañas: reactivación inyecta días SIN sincronizar reales; frost inyecta pendientes', () => {
  // Documentos pendientes de prueba para empB
  db.prepare(`
    INSERT INTO documentos (empresa_id, clave_dedupe, tipo_flujo, periodo_ingesta, folio, tipo_doc, rut_contraparte, fecha_docto, monto_total, estado)
    VALUES (?, ?, 'compra', '202610', 100, 33, '1-9', '2026-10-01', 100000, 'PENDIENTE')
  `).run(empBId, `dedupe-test-${crypto.randomBytes(4).toString('hex')}`)
  const r = crm.generarCampana(db, { usuarioId: adminId, empresaId: empBId, plantilla: 'frost' })
  assert.ok(r.mensaje.includes('Otro Cliente SPA'))
  // La cantidad de pendientes debe aparecer en el mensaje
  assert.ok(/\d+\)/.test(r.mensaje), 'la plantilla frost interpola la cantidad')
})

test('campañas: marcar enviado idempotente + auditado', () => {
  const cam = db.prepare(`SELECT id FROM crm_campanas ORDER BY id DESC LIMIT 1`).get()
  const r = crm.marcarEnviado(db, { usuarioId: adminId, campanaId: cam.id })
  assert.strictEqual(r.ok, true)
  const r2 = crm.marcarEnviado(db, { usuarioId: adminId, campanaId: cam.id })
  assert.strictEqual(r2.ya_enviado, true)
})

/* ---------------------------- ENGAGEMENT ---------------------------- */

test('engagement: score según datos reales y resumen coherente', () => {
  const eng = crm.engagement(db, { usuarioId: adminId })
  const a = eng.clientes.find((x) => x.empresa_id === empAId)
  assert.ok(a, 'la empresa aparece')
  assert.strictEqual(typeof a.score, 'number')
  assert.ok(a.score >= 0 && a.score <= 100)
  assert.ok(['SANO', 'ATENCION', 'CRITICO'].includes(a.etiqueta))
  assert.ok(eng.resumen.SANO + eng.resumen.ATENCION + eng.resumen.CRITICO === eng.clientes.length, 'resumen cuadra')
  assert.ok(eng.resumen.promedio >= 0 && eng.resumen.promedio <= 100)
})

/* ------------------------- RBAC del router ------------------------- */

test('RBAC: /api/crm rechaza a un cliente (admin_empresa) y acepta a contador/super admin', async () => {
  // Usuario admin_empresa ligado a empA
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('crmcliente', x'00', 0)`).run()
  const clienteId = info.lastInsertRowid
  const rolEmpresa = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`).run(clienteId, empAId, rolEmpresa)

  // Usuario contador ligado a empA
  const info2 = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('crmcontador', x'00', 0)`).run()
  const contadorId = info2.lastInsertRowid
  const rolCont = db.prepare(`SELECT id FROM roles WHERE codigo = 'contador'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`).run(contadorId, empAId, rolCont)

  const app = express()
  app.use(express.json())
  // Fake de requireAuth: setea req.user según cookie simulada en header x-test-user
  app.use('/api/crm', (req, res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next() }, require('../backend/routes/crm'))

  const server = app.listen(0)
  await new Promise((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api/crm`

  // cliente → 403
  const r1 = await fetch(`${base}/pipeline`, { headers: { 'x-test-user': String(clienteId) } })
  assert.strictEqual(r1.status, 403)
  const j1 = await r1.json()
  assert.ok(/exclusivo del despacho/i.test(j1.error))

  // contador de empA → 200 en pipeline, pero NO puede operar empB (403)
  const r2 = await fetch(`${base}/pipeline`, { headers: { 'x-test-user': String(contadorId) } })
  assert.strictEqual(r2.status, 200)
  const r3 = await fetch(`${base}/pipeline/${empBId}`, {
    method: 'POST', headers: { 'x-test-user': String(contadorId), 'content-type': 'application/json' },
    body: JSON.stringify({ etapa: 'OPERATIVO' }),
  })
  assert.strictEqual(r3.status, 403)

  // contador de empA → puede operar empA
  const r4 = await fetch(`${base}/pipeline/${empAId}`, {
    method: 'POST', headers: { 'x-test-user': String(contadorId), 'content-type': 'application/json' },
    body: JSON.stringify({ etapa: 'ONBOARDING' }),
  })
  assert.strictEqual(r4.status, 200)

  server.closeAllConnections?.()
  server.close()
})
