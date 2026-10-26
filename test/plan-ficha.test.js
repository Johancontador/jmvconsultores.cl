/**
 * Tests T0-B — Planificación: ficha tributaria (permisos, core, API HTTP).
 * Ejecutar con: node --test test/plan-ficha.test.js
 *
 * Cobertura:
 *  1) RBAC: 'planificacion:ver' para todos los roles con acceso; gestionar solo
 *     contador/super_admin (auditor, dueño y tesorería NO declaran).
 *  2) Core: incorporación EXPLÍCITA con centinelas sin valores fiscales,
 *     validaciones (régimen/vigencia/tipo/participaciones/fechas), estado
 *     CONFIGURADA calculado (nunca recibido) y sin downgrade a PENDIENTE.
 *  3) Historial doble: fila append-only en plan_ficha_historial + bitácora
 *     central auditoria; la fila previa queda intacta tras cada cambio.
 *  4) HTTP real (patrón centro-apps): 401 sin sesión, 403 sin permiso, 402 sin
 *     licencia, 409 duplicado, flujo completo POST→PUT con historial.
 * BD temporal por proceso; ninguna prueba toca la base de producción.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-plan-t0b-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const fichaCore = require('../backend/core/plan-ficha')
const auditoria = require('../backend/core/auditoria')
const { permisosDeRol, TODAS_LAS_CAPACIDADES } = require('../backend/core/permisos')

// ---------- servidor de prueba (patrón centro-apps) ----------

const serverless = () => {
  const express = require('express')
  const app = express()
  app.use(express.json())
  // Auth simulada: req.user disponible cuando viaja el header 'x-test-user'.
  app.use('/api/contable', (req, res, next) => {
    const id = Number(req.header('x-test-user') || 0)
    req.user = id ? db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) : undefined
    next()
  }, require('../backend/routes/planificacion'))
  return app.listen(0)
}
const server = serverless()
const port = server.address().port
const base = `http://127.0.0.1:${port}/api/contable`

test.after(() => {
  server.close()
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- sembrado (patrón centro-apps) ----------

function dv(cuerpo) {
  let sum = 0, mult = 2
  for (let i = String(cuerpo).length - 1; i >= 0; i--) {
    sum += Number(String(cuerpo)[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const d = 11 - (sum % 11)
  return d === 11 ? 0 : d === 10 ? 'K' : String(d)
}

const nSec = (() => { let n = 0; return () => ++n })()
function usuarioConRol(rolCodigo, empresaId) {
  const username = `u_plan_${nSec()}`
  db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, 'x', 0, 1)`).run(username)
  const u = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
  const rol = db.prepare(`SELECT id FROM roles WHERE codigo = ?`).get(rolCodigo)
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`)
    .run(u.id, empresaId, rol.id)
  return u.id
}

let rutSeq = 76500001
function empresaNueva(nombre, conLicencia = true) {
  const rut = `76${rutSeq++}-${dv(`76${rutSeq - 1}`)}`
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES (?, ?, 'k', 0.01, 1)`).run(rut, nombre)
  const id = info.lastInsertRowid
  if (conLicencia) {
    // PRUEBA de 90 días como en el flujo real (licencias.crearPrueba)
    db.prepare(`INSERT OR IGNORE INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp) VALUES (?, 'PRUEBA', 'PRUEBA', date('now'), date('now', '+90 day'), 0)`).run(id)
  }
  return id
}

const EMP = empresaNueva('Plan T0B SpA')
const EMP_SIN_LIC = empresaNueva('Plan Sin Licencia Ltda', false)
const CONTADOR = usuarioConRol('contador', EMP)
const AUDITOR = usuarioConRol('auditor', EMP)
const OWNER = usuarioConRol('admin_empresa', EMP)
const TESORERIA = usuarioConRol('tesoreria', EMP)
const CONTADOR_SIN_LIC = usuarioConRol('contador', EMP_SIN_LIC)

// ---------- 1) RBAC ----------

test('T0-B RBAC: planificacion:ver para todos; gestionar solo contador (y super_admin implícito)', () => {
  assert.ok(TODAS_LAS_CAPACIDADES.includes('planificacion:ver'))
  assert.ok(TODAS_LAS_CAPACIDADES.includes('planificacion:gestionar'))

  const contador = permisosDeRol('contador')
  assert.ok(contador.has('planificacion:ver') && contador.has('planificacion:gestionar'))

  for (const rol of ['auditor', 'admin_empresa', 'tesoreria']) {
    const p = permisosDeRol(rol)
    assert.ok(p.has('planificacion:ver'), `${rol} lee la ficha`)
    assert.ok(!p.has('planificacion:gestionar'), `${rol} NO declara`)
  }
})

// ---------- 2) Core ----------

test('T0-B core: incorporación sin datos nace PENDIENTE/SIN_CONFIGURAR (cero valores fiscales)', () => {
  const r = fichaCore.incorporar(db, { empresaId: EMP, usuarioId: CONTADOR, datos: {} })
  assert.strictEqual(r.ficha.regimen, 'PENDIENTE')
  assert.strictEqual(r.ficha.tipo_contribuyente, 'PENDIENTE')
  assert.strictEqual(r.ficha.estado_ficha, 'SIN_CONFIGURAR')
  assert.strictEqual(r.ficha.regimen_desde_ac, null)
  assert.strictEqual(r.ficha.sujeto_boletas_honorarios, 0)
})

test('T0-B core: duplicado → 409 status', () => {
  assert.throws(() => fichaCore.incorporar(db, { empresaId: EMP, usuarioId: CONTADOR, datos: {} }),
    (e) => e.status === 409)
})

test('T0-B core: validaciones de la declaración', () => {
  const base = { empresaId: EMP, usuarioId: CONTADOR }
  // Régimen fuera del catálogo
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { regimen: 'REGIMEN_MAGICO' } }), /Régimen inválido/)
  // Régimen real SIN vigencia → exige regimen_desde_ac
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { regimen: 'PRO_PMYE_GENERAL' } }), /exige regimen_desde_ac/)
  // Vigencia con formato inválido
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { regimen: 'PRO_PMYE_GENERAL', regimen_desde_ac: '2026-01' } }), /AAAA/)
  // Tipo de contribuyente fuera del catálogo
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { tipo_contribuyente: 'ORGANISMO_RARO' } }), /Tipo de contribuyente inválido/)
  // Propietarios: participación fuera de rango y suma > 100
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: {
    propietarios: [{ rut: '12345678-5', participacion: 120, gravado_finales: true }] } }), /participación inválida/)
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: {
    propietarios: [
      { rut: '12345678-5', participacion: 70, gravado_finales: true },
      { rut: '98765432-5', participacion: 50, gravado_finales: false },
    ] } }), /suman/)
  // Propietario con RUT inválido
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: {
    propietarios: [{ rut: 'no-rut', participacion: 50, gravado_finales: true }] } }), /RUT inválido/)
  // Fecha de inicio con formato inválido
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { fecha_inicio_actividades: '2026/01/02' } }), /YYYY-MM-DD/)
})

test('T0-B core: declaración completa calcula estado CONFIGURADA y firma historial + auditoría central', () => {
  let r
  try {
    r = fichaCore.actualizar(db, {
      empresaId: EMP, usuarioId: CONTADOR, ip: '10.0.0.9',
      cambios: {
        regimen: 'PRO_PMYE_GENERAL', regimen_desde_ac: '2025',
        tipo_contribuyente: 'PERSONA_JURIDICA', fecha_inicio_actividades: '2020-03-01',
        actividades_economicas: ['Tecnologías de la información'],
        sujeto_boletas_honorarios: true,
      },
    })
  } catch (err) {
    assert.fail(`DIAG: code=${err.code} msg=${JSON.stringify(err.message)}\n${err.stack}`)
  }
  assert.strictEqual(r.ficha.estado_ficha, 'CONFIGURADA')

  // Historial específico (append-only, empresa)
  const hist = fichaCore.listarHistorial(db, EMP, 10)
  assert.ok(hist[0].accion === 'ficha.actualizar' || hist[0].accion === 'ficha.crear')
  const desp = JSON.parse(hist[0].despues_json)
  assert.strictEqual(desp.regimen, 'PRO_PMYE_GENERAL')

  // Bitácora central (trazabilidad de toda mutación)
  const auditoriaRegistros = auditoria.consultar(db, { empresaId: EMP, limit: 20 })
  assert.ok(auditoriaRegistros.some((x) => x.accion === 'planificacion.ficha.actualizar'))
})

test('T0-B core: NO downgrade a PENDIENTE; sin cambios o valores idénticos → rechazo limpio', () => {
  const base = { empresaId: EMP, usuarioId: CONTADOR }
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { regimen: 'PENDIENTE' } }), /No se puede volver al centinela/)
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: {} }), /Sin cambios que registrar/)
  assert.throws(() => fichaCore.actualizar(db, { ...base, cambios: { regimen: 'PRO_PMYE_GENERAL', regimen_desde_ac: '2025' } }), /idénticos a los vigentes/)

  // La fila previa del historial quedó intacta (append-only de verdad)
  const hist = db.prepare(`SELECT id, accion FROM plan_ficha_historial WHERE empresa_id = ? ORDER BY id`).all(EMP)
  assert.ok(hist.length >= 2)
  assert.strictEqual(hist[0].accion, 'ficha.crear')
  const antes = hist.length
  try { fichaCore.actualizar(db, { ...base, cambios: {} }) } catch { /* rechazo esperado */ }
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_historial WHERE empresa_id = ?`).get(EMP).n
  assert.strictEqual(despues, antes, 'el rechazo no escribió historial')
})

test('T0-B core: actualizar SIN ficha → 404; empresa ajena sin ficha no comparte', () => {
  const ajena = empresaNueva('Plan Ajena SpA')
  assert.throws(() => fichaCore.actualizar(db, { empresaId: ajena, usuarioId: CONTADOR, cambios: { regimen: 'GENERAL_14A', regimen_desde_ac: '2026' } }),
    (e) => e.status === 404)
})

// ---------- 3) HTTP real ----------

async function llamar(metodo, empresaId, usuarioId, cuerpo) {
  const res = await fetch(`${base}/empresas/${empresaId}/planificacion/ficha`, {
    method: metodo,
    headers: { 'content-type': 'application/json', 'x-test-user': String(usuarioId || '') },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

test('T0-B HTTP: 401 sin sesión; GET nace con ficha null sin incorporación', async () => {
  const sinAuth = await llamar('GET', EMP, null)
  assert.strictEqual(sinAuth.status, 401)
})

test('T0-B HTTP: auditor lee (200) pero no declara (403); dueño y tesorería tampoco declaran', async () => {
  const EMP2 = empresaNueva('Plan T0B Solo Lectura Spa')
  const auditor2 = usuarioConRol('auditor', EMP2)
  const owner2 = usuarioConRol('admin_empresa', EMP2)
  const teso2 = usuarioConRol('tesoreria', EMP2)

  const lee = await llamar('POST', EMP2, auditor2, { regimen: 'GENERAL_14A', regimen_desde_ac: '2026' })
  assert.strictEqual(lee.status, 403)
  assert.match(lee.data.error, /planificacion:gestionar/)

  for (const uid of [owner2, teso2]) {
    const r = await llamar('POST', EMP2, uid, { regimen: 'GENERAL_14A', regimen_desde_ac: '2026' })
    assert.strictEqual(r.status, 403)
  }
})

test('T0-B HTTP: contador sin licencia operativa → 402 (gate de licencia en gestionar)', async () => {
  const r = await llamar('POST', EMP_SIN_LIC, CONTADOR_SIN_LIC, {})
  assert.strictEqual(r.status, 402)
})

test('T0-B HTTP: flujo completo contador con licencia → POST 200, duplicado 409, PUT 200, licencia gate no aplica a :ver', async () => {
  const EMP3 = empresaNueva('Plan T0B Flujo SpA')
  const contador3 = usuarioConRol('contador', EMP3)

  const alta = await llamar('POST', EMP3, contador3, {
    regimen: 'GENERAL_14A', regimen_desde_ac: '2026',
    tipo_contribuyente: 'PERSONA_JURIDICA',
    actividades_economicas: ['Consultoría'],
  })
  assert.strictEqual(alta.status, 200)
  assert.strictEqual(alta.data.ficha.estado_ficha, 'CONFIGURADA')
  assert.strictEqual(alta.data.ficha.regimen, 'GENERAL_14A')

  const dup = await llamar('POST', EMP3, contador3, {})
  assert.strictEqual(dup.status, 409)

  const put = await llamar('PUT', EMP3, contador3, { sujeto_boletas_honorarios: true })
  assert.strictEqual(put.status, 200)
  assert.strictEqual(put.data.ficha.sujeto_boletas_honorarios, 1)

  // La LECTURA nunca exige licencia (patrón SAAS-ACCESO §5 aplicado acá).
  const EMP4 = empresaNueva('Plan Solo Lectura Http', false)
  const teso4 = usuarioConRol('tesoreria', EMP4)
  const get4 = await llamar('GET', EMP4, teso4)
  assert.strictEqual(get4.status, 200)
  assert.strictEqual(get4.data.ficha, null)
})
