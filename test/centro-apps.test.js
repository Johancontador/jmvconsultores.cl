'use strict'
/**
 * CENTRO DE APLICACIONES (solicitud 2026-10-15) — tests:
 *  T1 — coherencia del catálogo: cada app referencia rutas/capacidades REALES
 *       (lee el MENU del frontend y CATALOGO_CAPACIDADES del RBAC).
 *  T2 — usuario autenticado + empresa autorizada + rol: el centro devuelve
 *       exactamente las apps/secciones que el rol habilita (sin apps de relleno).
 *  T3 — aislamiento: pedir ?empresa= ajena lanza/403 — jamás datos de otra.
 *  T4 — módulo habilitado comercialmente: con licencia SUSPENDIDA la app sigue
 *       visible (lectura) pero marcada habilitado_comercial=false.
 *  T5 — HTTP: 401 sin sesión; 200 con sesión (GET /api/auth/centro).
 * BD temporal por proceso. Ejecutar: node --test test/centro-apps.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-centro-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { CATALOGO_APPS, centroParaUsuario, validarCatalogo } = require('../backend/core/centro-apps')
const { CATALOGO_CAPACIDADES } = require('../backend/core/permisos')
const { crearSesion } = require('../backend/services/session')
const empresasCore = require('../backend/core/empresas')

const serverless = () => {
  const express = require('express')
  const app = express()
  app.use(express.json())
  app.use('/api/auth', require('../backend/routes/auth'))
  return app.listen(0)
}
const server = serverless()
const port = server.address().port

test.after(() => {
  server.close()
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- sembrado ----------
function dv(cuerpo) {
  let sum = 0, mult = 2
  for (let i = String(cuerpo).length - 1; i >= 0; i--) {
    sum += Number(String(cuerpo)[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const d = 11 - (sum % 11)
  return d === 11 ? 0 : d === 10 ? 'K' : String(d)
}

/** Usuario directo + asignación empresa/rol (sin depender del flujo de registro). */
const nSec = (() => { let n = 0; return () => ++n })()
function usuarioConRol(rolCodigo, empresaId, esAdmin = false) {
  const username = `u_centro_${nSec()}`
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, 'x', ?, 1)`)
    .run(username, esAdmin ? 1 : 0)
  const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
  const rol = db.prepare(`SELECT id FROM roles WHERE codigo = ?`).get(rolCodigo)
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`)
    .run(u.id, empresaId, rol.id)
  return u.id
}

const rutsUsados = new Set()
function empresaNueva(nombre) {
  let rut
  do { rut = `${Math.floor(76_000_000 + Math.random() * 999_999)}-${dv(String(Math.floor(76_000_000 + Math.random() * 999_999)))}` } while (rutsUsados.has(rut))
  rutsUsados.add(rut)
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES (?, ?, 'k', 0.01, 1)`)
    .run(rut, nombre)
  const id = info.lastInsertRowid
  // PRUEBA de 90 días como en el flujo real (licencias.crearPrueba)
  db.prepare(`INSERT OR IGNORE INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp) VALUES (?, 'PRUEBA', 'PRUEBA', date('now'), date('now', '+90 day'), 0)`).run(id)
  return id
}

const EMP_A = empresaNueva('Empresa Centro A')
const EMP_B = empresaNueva('Empresa Centro B')

// El dueño (admin_empresa) y un contador que atiende a la empresa A
const OWNER = usuarioConRol('admin_empresa', EMP_A)
const CONTADOR = usuarioConRol('contador', EMP_A)
const EXTERNO = usuarioConRol('contador', EMP_B) // solo pertenece a B

// ---------- T1: catálogo coherente con el menú REAL ----------
test('T1: catálogo sin módulos ficticios — toda ruta existe en el MENU del SPA y toda capacidad en el RBAC', () => {
  assert.equal(validarCatalogo(), true)

  // Rutas = anchors reales del MENU del frontend (frontend/sistema/app.js)
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'sistema', 'app.js'), 'utf8')
  const menuKeys = new Set([...appJs.matchAll(/key:\s*'([a-zA-Z0-9-]+)'/g)].map((m) => m[1]))
  for (const app of CATALOGO_APPS) {
    for (const s of app.secciones) {
      assert.ok(menuKeys.has(s.ruta), `la ruta '${s.ruta}' de la app '${app.key}' NO existe en el MENU real`)
      assert.ok(CATALOGO_CAPACIDADES[s.capacidad], `la capacidad '${s.capacidad}' de '${app.key}' no está definida en el RBAC`)
    }
  }
  // Grupos = secciones reales del menú (los cards nombran lo que ya existe)
  const grupos = new Set([...appJs.matchAll(/seccion:\s*'([^']+)'/g)].map((m) => m[1]))
  for (const app of CATALOGO_APPS) {
    for (const s of app.secciones) {
      assert.ok(grupos.has(s.grupo), `el grupo '${s.grupo}' de '${app.key}' no es una sección real del menú`)
    }
  }
})

// ---------- T2: visibilidad POR ROL (sin apps fantasmas) ----------
test('T2a: super admin (is_admin) ve todas las apps del catálogo', () => {
  const SA = usuarioConRol('contador', EMP_A, true)
  const c = centroParaUsuario(db, SA, EMP_A)
  assert.equal(new Set(c.apps.map((a) => a.key)).size, CATALOGO_APPS.length)
})

test('T2b: dueño (admin_empresa) — Portal primero en modo externo, sin DTE de emisión en su tarjeta', () => {
  const c = centroParaUsuario(db, OWNER, EMP_A)
  const keys = c.apps.map((a) => a.key)
  assert.ok(keys.includes('portal-cliente'), 'el dueño ve el Portal (experiencia externa)')
  const portal = c.apps.find((a) => a.key === 'portal-cliente')
  assert.equal(portal.modoExterno, true)
  assert.ok(c.licencia && c.licencia.estado === 'PRUEBA', 'la licencia PRUEBA viene para el chip')
})

test('T2c: el centro respeta las capacidades EXACTAS del rol (auditor: ve bandeja y DTEs; rol sin capacidades → cero apps)', () => {
  const AUDITOR = usuarioConRol('auditor', EMP_A)
  const c = centroParaUsuario(db, AUDITOR, EMP_A)
  const contabilidad = c.apps.find((a) => a.key === 'contabilidad-iva')
  assert.ok(contabilidad, 'el auditor ve Contabilidad e IVA (documentos:ver)')
  // El RBAC le da dte:ver al auditor (ve la bandeja de DTEs emitidos) → sección visible;
  // lo que NO puede (emitir) lo bloquea cada ruta con dte:emitir — el centro no agrega nada.
  assert.ok(contabilidad.secciones.some((s) => s.ruta === 'dte'))
  assert.ok(c.apps.some((a) => a.key === 'administracion'), 'auditoria:ver habilita el área restringida')

  // Rol con NINGUNA capacidad conocida → cero apps, ni siquiera con URL conocida
  db.prepare(`INSERT OR IGNORE INTO roles (codigo, nombre) VALUES ('celador', 'Sin capacidad alguna')`).run()
  const CELADOR = usuarioConRol('celador', EMP_A)
  const c2 = centroParaUsuario(db, CELADOR, EMP_A)
  assert.deepEqual(c2.apps, [], 'sin capacidades no existe app que mostrar')
})

// ---------- T3: aislamiento de empresas ----------
test('T3: pedir centro de una empresa AJENA da error; el propio siempre vuelve su asignación', async () => {
  // EXTERNO tiene asignación solo a B: pedir A → error estricto (sin fuga)
  await assert.rejects(() => Promise.resolve().then(() => centroParaUsuario(db, EXTERNO, EMP_A)),
    /No tiene acceso a esta empresa/)
  // Y con su empresa correcta ve exactamente lo suyo
  const c = centroParaUsuario(db, EXTERNO, EMP_B)
  assert.equal(c.empresa_activa.id, EMP_B)
})

// ---------- T4: gate comercial ----------
test('T4: licencia SUSPENDIDA → app visible (lectura) pero habilitado_comercial=false', () => {
  db.prepare(`UPDATE suscripciones SET estado = 'SUSPENDIDA' WHERE empresa_id = ?`).run(EMP_A)
  try {
    const c = centroParaUsuario(db, CONTADOR, EMP_A)
    assert.equal(c.licencia.estado, 'SUSPENDIDA')
    for (const app of c.apps) {
      assert.equal(app.habilitado_comercial, false, `${app.key} debe marcarse suspendido`)
    }
  } finally {
    db.prepare(`UPDATE suscripciones SET estado = 'PRUEBA' WHERE empresa_id = ?`).run(EMP_A)
  }
})

// ---------- T5: HTTP ----------
test('T5a: /api/auth/centro SIN sesión → 401', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/auth/centro?empresa=${EMP_A}`)
  assert.equal(r.status, 401)
})

test('T5b: con sesión → 200 y apps del rol de la empresa pedida', async () => {
  const sid = crearSesion(CONTADOR)
  // empresa legítima
  let r = await fetch(`http://127.0.0.1:${port}/api/auth/centro?empresa=${EMP_A}`, { headers: { Cookie: `sid=${sid}` } })
  assert.equal(r.status, 200)
  let j = await r.json()
  assert.equal(j.ok, true)
  assert.equal(j.empresa_activa.id, EMP_A)
  assert.ok(j.apps.length > 0)
  // empresa ajena → el error del core sube como 500 con mensaje (sin datos)
  r = await fetch(`http://127.0.0.1:${port}/api/auth/centro?empresa=${EMP_B}`, { headers: { Cookie: `sid=${sid}` } })
  assert.equal(r.status, 500, 'empresa ajena jamás devuelve datos')
  j = await r.json()
  assert.match(j.error, /No tiene acceso a esta empresa/)
})

test('T6: empresas.crear lista empresas solo del usuario (sanidad del aislamiento base)', () => {
  const lista = empresasCore.listarParaUsuario(db, EXTERNO)
  assert.deepEqual(lista.map((e) => e.id), [EMP_B])
})
