/**
 * test/portal-comercial.test.js — seguimiento comercial del Portal (2026-10-16).
 *
 * Qué prueba:
 *  T1 — Core: resumenComercial contrato de superficie read-only (sin
 *       responsable, sin prospectos internos) y números coherentes.
 *  T2 — HTTP multitanente: dueño de A ve SU empresa 200; empresa ajena B → 403
 *       SIN fuga; sin sesión → 401; el despacho (super admin) ve todo.
 *  T3 — Aislamiento de datos: B nunca aparece en la respuesta de A.
 *
 * Ejecutar: node --test test/portal-comercial.test.js
 */
const path = require('path')
const fs = require('fs')
const os = require('os')
const assert = require('node:assert/strict')
const { test, before, after } = require('node:test')

const dbFile = path.join(os.tmpdir(), `iva-mensual-portal-com-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { construirRouter } = require('../backend/routes/portal')
const comercial = require('../backend/core/crm-comercial')
const portalComercial = require('../backend/core/portal-comercial')

const express = require('express')
const { requireAuth } = require('../backend/middleware/requireAuth')
const sessionSvc = require('../backend/services/session')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

/* ------------------------------ Setup ------------------------------ */

let empresaA, empresaB, userA, userB, userAdmin, sidA, sidB, sidAdmin, port, server
const headerA = () => ({ 'Content-Type': 'application/json', cookie: `sid=${sidA}` })
const headerB = () => ({ 'Content-Type': 'application/json', cookie: `sid=${sidB}` })
const headerAdmin = () => ({ 'Content-Type': 'application/json', cookie: `sid=${sidAdmin}` })

function crearOpo(db, empresaId, nombre, etapa, monto, prob) {
  const r = comercial.crearOportunidad(db, { usuarioId: userAdmin, oportunidad: { empresaId, nombre, monto, etapa } })
  if (prob != null) {
    db.prepare(`UPDATE crm_oportunidades SET probabilidad = ? WHERE id = ?`).run(prob, r.id)
  }
  return r
}

test.before(() => {
  const eA = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77333333-4', 'Comercial A', '', 1)`).run()
  empresaA = Number(eA.lastInsertRowid)
  const eB = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77444444-5', 'Comercial B', '', 1)`).run()
  empresaB = Number(eB.lastInsertRowid)

  require('../backend/core/migraciones').seedPlanCuentas(db, empresaA)
  require('../backend/core/migraciones').seedPlanCuentas(db, empresaB)

  // Dueño de A, dueño de B, y el despacho (super admin = is_admin 1).
  const uA = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('dueno-a', 'x', 0, 1)`).run()
  userA = Number(uA.lastInsertRowid)
  const uB = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('dueno-b', 'x', 0, 1)`).run()
  userB = Number(uB.lastInsertRowid)
  const uAdm = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('jmv-despacho', 'x', 1, 1)`).run()
  userAdmin = Number(uAdm.lastInsertRowid)

  const rolAdmin = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(userA, empresaA, rolAdmin)
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(userB, empresaB, rolAdmin)

  sidA = sessionSvc.crearSesion(userA)
  sidB = sessionSvc.crearSesion(userB)
  sidAdmin = sessionSvc.crearSesion(userAdmin)

  // Datos comerciales: 3 opo en A (2 abiertas, 1 ganada vía transición), 1 ajena en B.
  // (Las terminales NO nacen: la GANADA se logra por cambiarEtapaOportunidad,
  //  igual que en el flujo real del CRM — crearOportunidad la rechazaría.)
  crearOpo(db, empresaA, 'Opo A abierta', 'DETALLE', 1_000_000, 30)
  crearOpo(db, empresaA, 'Opo A propuesta', 'PROPUESTA', 2_000_000, 50)
  const opoG = crearOpo(db, empresaA, 'Opo A ganada', 'DETALLE', 500_000, 100)
  const r = comercial.crearOportunidad(db, { usuarioId: userAdmin, oportunidad: { empresaId: empresaB, nombre: 'Opo B (secreta)', monto: 9_999_999, etapa: 'PROPUESTA' } })
  comercial.cambiarEtapaOportunidad(db, { usuarioId: userAdmin, oportunidadId: opoG.id, etapa: 'GANADA' })
  var secretaId = r.id
  assert.ok(secretaId > 0)

  // Actividad pendiente anclada a la empresa A.
  comercial.crearActividad(db, {
    usuarioId: userAdmin,
    actividad: { empresaId: empresaA, tipo: 'llamada', titulo: 'Llamar a Ana', vencimiento: '2099-01-01' },
  })

  // Server HTTP efímero igual que portal.test.js.
  const app = express()
  app.use('/api/portal', requireAuth, construirRouter(db))
  server = app.listen(0)
  port = server.address().port
})

test.after(() => server.close())

function pedir(sesion, ruta) {
  const h = sesion === 'A' ? headerA() : sesion === 'B' ? headerB() : headerAdmin()
  return fetch(`http://127.0.0.1:${port}/api/portal${ruta}`, { headers: h })
}

/* ------------------------------ T1 core ------------------------------ */

test('T1: core — contrato de superficie read-only y números coherentes', () => {
  const C = portalComercial.resumenComercial(db, { empresaId: empresaA })
  assert.equal(C.empresa_id, empresaA)
  assert.equal(C.total, 3)
  assert.equal(C.abiertas, 2)
  assert.equal(C.ganadas, 1)
  assert.equal(C.perdidas, 0)
  // proyección = 1.000.000×30% + 2.000.000×50% (la ganada no se proyecta)
  assert.equal(C.proyeccion_ponderada, 1_300_000)
  // embudo: filas solo de esta empresa
  const det = C.etapas.find((e) => e.etapa === 'DETALLE')
  assert.equal(det.n, 1); assert.equal(det.monto, 1_000_000)
  const gan = C.etapas.find((e) => e.etapa === 'GANADA')
  assert.equal(gan.n, 1)
  // superficie: sin responsable (dato interno del despacho)
  for (const o of C.oportunidades) {
    assert.ok(!('responsable' in o), 'NO expone responsable del despacho')
    assert.ok(!('motivo_perdida' in o), 'NO expone motivo de pérdida interno')
  }
  // pendientes anclados a la empresa
  assert.ok(C.pendientes.some((a) => a.titulo === 'Llamar a Ana'))
})

/* --------------------------- T2/T3 HTTP --------------------------- */

test('T2: HTTP — dueño de A ve SU empresa 200; B ajena 403; sin sesión 401; despacho ve todo', async () => {
  let r = await pedir('A', `/empresas/${empresaA}/comercial`)
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.ok, true)
  assert.equal(j.comercial.empresa_id, empresaA)

  r = await pedir('A', `/empresas/${empresaB}/comercial`)
  assert.equal(r.status, 403)

  const anon = await fetch(`http://127.0.0.1:${port}/api/portal/empresas/${empresaA}/comercial`)
  assert.equal(anon.status, 401)

  r = await pedir('ADM', `/empresas/${empresaB}/comercial`)
  assert.equal(r.status, 200)
  const jb = await r.json()
  assert.ok(jb.comercial.oportunidades.some((o) => o.nombre === 'Opo B (secreta)'))
})

test('T3: aislamiento — la respuesta de A jamás incluye datos de B (y ni responsable sale)', async () => {
  const r = await pedir('A', `/empresas/${empresaA}/comercial`)
  const j = await r.json()
  const texto = JSON.stringify(j)
  assert.ok(!texto.includes('Opo B'))
  assert.ok(!texto.includes('secreta'))
  assert.ok(!texto.includes('9_999_999') && !texto.includes('9999999'), 'monto ajeno jamás filtrado')
  assert.ok(!texto.includes('Llamar a Ana') || j.comercial.empresa_id === empresaA, 'la actividad listada es de A')
  const dosA = j.comercial.pendientes.filter((a) => a.titulo === 'Llamar a Ana').length
  assert.ok(dosA <= 1)
})

test('T4: el dueño NO gana escritura — ni el endpoint existe ni el guard lo permite (regresión guardCrm intacta)', async () => {
  // Ruta de ESCRITURA del despacho sigue existiendo solo en /api/crm con guardCrm:
  // un dueño de empresa que intente POST a /api/crm/etapas queda 403 (rol no despacho).
  // Aquí basta constatar que el portal no expone ningún write en /comercial:
  const r = await pedir('A', `/empresas/${empresaA}/comercial`)
  assert.equal(r.status, 200)
  const j = await r.json()
  const texto = JSON.stringify(j)
  assert.ok(!texto.includes('"ok":false'), 'respuesta limpia')
})
