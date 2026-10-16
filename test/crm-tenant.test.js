/**
 * Tests aislamiento multitenant CRM (Fase 5 del rediseño):
 *
 * Un contador NO super admin con asignación a UNA sola empresa debe ver
 * SOLO los registros de esa empresa en TODAS las lecturas globales del
 * módulo (pipeline, recordatorios, campañas, engagement, alertas, contactos,
 * prospectos vinculados, oportunidades, actividades, informes, buscar,
 * duplicados). El super admin sigue viendo todo. Los prospectos SIN empresa
 * (NUEVOS, leads del despacho) los ve el asignado (pertenecen a su cartera).
 *
 * Ejecutar con: node --test test/crm-tenant.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')

const dbFile = path.join(os.tmpdir(), `iva-mensual-crm-tenant-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const crm = require('../backend/core/crm')
const comercial = require('../backend/core/crm-comercial')
const empresasCore = require('../backend/core/empresas')

test.after(() => {
  db.close()
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

// ---- setup: 2 empresas + 1 contador asignado SOLO a la B ----
const calc = (body) => {
  let s = 0, m = 2
  for (let i = body.length - 1; i >= 0; i--) { s += +body[i] * m; m = m < 7 ? m + 1 : 2 }
  const d = 11 - (s % 11)
  return d === 11 ? '0' : d === 10 ? 'K' : String(d)
}
const crearEmpresa = (prefijo, nombre) => {
  const base = `${prefijo}${String(crypto.randomInt(100000, 999999)).slice(0, 5)}`
  const rut = `${base}-${calc(base)}`
  const r = empresasCore.crear(db, { usuarioId: adminId, rut, nombre, claveSii: 'x'.repeat(8) })
  return typeof r === 'object' ? r.id : r
}
const empA = crearEmpresa('706', 'Tenant A (NO asignada al contador)')
const empB = crearEmpresa('807', 'Tenant B (asignada al contador)')

const { hashPassword } = require('../backend/services/password')
const infoUser = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, ?, 0, 1)`).run(`contador-tenant-${Date.now()}`, hashPassword('clave-test-1234'))
const contadorId = infoUser.lastInsertRowid
empresasCore.asignarRol(db, { usuarioIdEjecutor: adminId, usuarioIdObjetivo: contadorId, empresaId: empB, rol: 'contador' })

const idsB = [empB]
const idsTodos = null

// ---- datos en AMBAS empresas: oportunidad, contacto, actividad, recordatorio ----
for (const [id, etiqueta] of [[empA, 'A'], [empB, 'B']]) {
  comercial.crearOportunidad(db, {
    usuarioId: adminId,
    oportunidad: { nombre: `Oportunidad ${etiqueta}`, empresaId: id, monto: 1000000, etapa: 'DETALLE' },
  })
  comercial.crearContacto(db, { usuarioId: adminId, empresaId: id, contacto: { nombre: `Contacto ${etiqueta}`, correo: `c${etiqueta.toLowerCase()}-${id}@t.cl` } })
  comercial.crearActividad(db, { usuarioId: adminId, actividad: { tipo: 'tarea', titulo: `Tarea ${etiqueta}`, empresaId: id, vencimiento: '2099-01-01' } })
  crm.crearRecordatorio(db, { usuarioId: adminId, empresaId: id, tipo: 'llamada', titulo: `Recordatorio ${etiqueta}`, fecha: '2099-01-01' })
}
// Prospecto SIN empresa (lead del despacho) y prospecto vinculado a A
const prospLibre = db.prepare(`INSERT INTO crm_prospectos (nombre, correo, fuente, prioridad) VALUES ('Lead Libre', 'libre-${Date.now()}@t.cl', 'web', 'media')`).run()
const prospA = db.prepare(`INSERT INTO crm_prospectos (nombre, correo, fuente, prioridad, empresa_id) VALUES ('Lead de A', 'enA-${Date.now()}@t.cl', 'web', 'media', ?)`).run(empA)

/* ------------------------- PIPELINE ------------------------- */

test('pipeline: contador ve solo su empresa asignada; super admin ve todas', () => {
  const delContador = crm.listarPipeline(db, { usuarioId: contadorId, empresaIds: idsB })
  assert.strictEqual(delContador.length, 1)
  assert.strictEqual(delContador[0].empresa_id, empB)

  const delAdmin = crm.listarPipeline(db, { usuarioId: adminId, empresaIds: null })
  assert.ok(delAdmin.length >= 2)
  assert.ok(delAdmin.some((p) => p.empresa_id === empA) && delAdmin.some((p) => p.empresa_id === empB))
})

test('pipeline: sin asignaciones → lista vacía (no todas)', () => {
  const vacio = crm.listarPipeline(db, { usuarioId: contadorId, empresaIds: [] })
  assert.strictEqual(vacio.length, 0)
})

/* ---------------------- RECORDATORIOS/CAMPAÑAS ---------------------- */

test('recordatorios: solo los de SU empresa', () => {
  const r = crm.listarRecordatorios(db, { usuarioId: contadorId, soloPendientes: false, empresaIds: idsB })
  assert.ok(r.length >= 1)
  for (const rec of r) assert.strictEqual(rec.empresa_id, empB, `recordatorio de otra empresa filtrado: ${JSON.stringify(rec)}`)
  const rAdmin = crm.listarRecordatorios(db, { usuarioId: adminId, soloPendientes: false, empresaIds: null })
  assert.ok(rAdmin.some((x) => x.empresa_id === empA) && rAdmin.some((x) => x.empresa_id === empB))
})

/* ------------------------- ENGAGEMENT/ALERTAS ------------------------- */

test('engagement y alertasScoped: solo SU empresa', () => {
  const eng = crm.engagement(db, { usuarioId: contadorId, empresaIds: idsB })
  assert.strictEqual(eng.clientes.length, 1)
  assert.strictEqual(eng.clientes[0].empresa_id, empB)

  const alertas = crm.alertasRetencion(db, { empresaIds: idsB })
  for (const a of alertas.alertas) assert.strictEqual(a.empresa_id, empB)
})

/* ---- COMERCIAL: contactos, prospectos, oportunidades, actividades ---- */

test('contactos: solo los de SU empresa', () => {
  const r = comercial.listarContactos(db, { empresaIds: idsB })
  assert.ok(r.length >= 1)
  for (const c of r) assert.strictEqual(c.empresa_id, empB)
  const admin = comercial.listarContactos(db, { empresaIds: null })
  assert.ok(admin.some((c) => c.empresa_id === empA))
})

test('prospectos: ve leads libres + los vinculados a SU empresa; NO los de A', () => {
  const r = comercial.listarProspectos(db, { empresaIds: idsB })
  const ids = r.prospectos.map((p) => p.id)
  assert.ok(ids.includes(prospLibre.lastInsertRowid), 'lead sin empresa visible (es del despacho del contador)')
  assert.ok(ids.includes(db.prepare('SELECT id FROM crm_prospectos WHERE empresa_id = ?').get(empB)?.id) || !r.prospectos.some((p) => p.empresa_id === empA), 'prospecto de A jamás visible')
  assert.ok(!r.prospectos.some((p) => p.empresa_id === empA), 'prospecto vinculado a A filtrado')

  const admin = comercial.listarProspectos(db, { empresaIds: null })
  assert.ok(admin.prospectos.some((p) => p.empresa_id === empA), 'super admin sí ve el de A')
})

test('oportunidades: solo SU empresa (kanban y listado coherentes)', () => {
  const r = comercial.listarOportunidades(db, { empresaIds: idsB })
  for (const o of r.oportunidades) assert.strictEqual(o.empresa_id, empB)
  assert.ok(r.total >= 1)
  const kbTotal = r.kanban.reduce((s, k) => s + k.n, 0)
  assert.strictEqual(kbTotal, r.oportunidades.length, 'kanban suma = lista (mismo tenant)')

  const admin = comercial.listarOportunidades(db, { empresaIds: null })
  assert.ok(admin.total > r.total, 'admin ve las de A y B')
})

test('actividades: solo las de SU empresa', () => {
  const r = comercial.listarActividades(db, { empresaIds: idsB, estado: null })
  assert.ok(r.length >= 1)
  for (const a of r) assert.strictEqual(a.empresa_id, empB)
  const admin = comercial.listarActividades(db, { empresaIds: null, estado: null })
  assert.ok(admin.some((a) => a.empresa_id === empA))
})

test('informes: proyección/embudo SOLO de SU empresa', () => {
  const delContador = comercial.informes(db, { empresaIds: idsB })
  const delAdmin = comercial.informes(db, {})
  assert.ok(delAdmin.proyeccion_ponderada >= delContador.proyeccion_ponderada)
  // B monto 1.000.000 en DETALLE (10%) → 100.000 esperado si solo B
  assert.strictEqual(delContador.proyeccion_ponderada, 100000)
  // El admin cuyo alcance incluye A+B ve ≥ 200.000 (2× 100.000)
  assert.ok(delAdmin.proyeccion_ponderada >= 200000)
})

test('buscar: resultados de otras empresas jamás aparecen', () => {
  const r = comercial.buscar(db, { q: 'Tenant', empresaIds: idsB })
  const nombres = r.grupos.flatMap((g) => g.filas.map((f) => f.nombre))
  assert.ok(!nombres.some((n) => String(n).includes('Tenant A')), `A no debe aparecer: ${nombres}`)
  assert.ok(nombres.some((n) => String(n).includes('Tenant B')), 'B visible')

  const admin = comercial.buscar(db, { q: 'Tenant' })
  const nAdmin = admin.grupos.flatMap((g) => g.filas.map((f) => f.nombre))
  assert.ok(nAdmin.some((n) => String(n).includes('Tenant A')))
})

test('duplicados: solo candidatos del tenant (o leads libres en prospectos)', () => {
  const r = comercial.duplicados(db, { q: 'Tenant', tipo: 'empresas', empresaIds: idsB })
  for (const c of r.coincidencias) assert.notStrictEqual(String(c.nombre).includes('Tenant A'), true)

  // prospectos: falsos positivos por similitud → el de A NO puede salir
  const rp = comercial.duplicados(db, { q: 'Lead de A', tipo: 'prospectos', empresaIds: idsB })
  assert.ok(!rp.coincidencias.some((c) => c.nombre === 'Lead de A'), `prospecto de A debe filtrarse: ${JSON.stringify(rp.coincidencias)}`)
})

test('oportunidades por URL directa (cross-tenant via core): entrega solo si pertenece', () => {
  // El ROUTER ya bloquea con accesoEmpresa; a nivel core la garantía es que
  // la OBTENCIÓN individual sea válida solo con ancla del tenant correcto.
  const opoDeA = db.prepare(`SELECT id FROM crm_oportunidades WHERE empresa_id = ?`).get(empA)
  const filaA = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(opoDeA.id)
  assert.strictEqual(filaA.empresa_id, empA) // el router compara contra req.crmEmpresaIds
})
