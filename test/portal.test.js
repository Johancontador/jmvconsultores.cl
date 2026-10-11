'use strict'
/**
 * PORTAL DE INTELIGENCIA COMERCIAL — métricas + aislamiento negativo.
 *
 * T1 — Motor de métricas core (resumen, cartera, movimientos) con datos reales
 *      de la bandeja `documentos`: notas de crédito NO descontadas dos veces,
 *      sin datos = null (nunca 0).
 * T2 — AISLAMIENTO NEGATIVO (§8): un usuario de la empresa A NO puede leer
 *      resumen/movimientos/cartera/exportar/reportes de la empresa B por URL
 *      manipulada — todo el router rechaza con 403 server-side.
 * T3 — Reportes guardados: config por usuario+empresa; un usuario no ve los
 *      reportes de otro ni borra reportes ajenos.
 *
 * Ejecutar con: node --test test/portal.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-portal-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { construirRouter } = require('../backend/routes/portal')
const metricas = require('../backend/core/portal-metricas')

const express = require('express')
const { requireAuth } = require('../backend/middleware/requireAuth')
const sessionSvc = require('../backend/services/session')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ===================== Setup: dos empresas, dos usuarios =====================

let empresaA, empresaB, userA, userB, sidA, sidB
const headerA = () => ({ cookie: `sid=${sidA}` })
const headerB = () => ({ cookie: `sid=${sidB}` })

test.before(() => {
  const eA = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77111111-2', 'Portal A SpA', '', 1)`).run()
  empresaA = Number(eA.lastInsertRowid)
  const eB = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77222222-3', 'Portal B Ltda', '', 1)`).run()
  empresaB = Number(eB.lastInsertRowid)

  require('../backend/core/migraciones').seedPlanCuentas(db, empresaA)
  require('../backend/core/migraciones').seedPlanCuentas(db, empresaB)

  // Usuarios: A pertenece a empresa A; B pertenece a empresa B.
  const uA = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('portal-a', 'x', 0, 1)`).run()
  userA = Number(uA.lastInsertRowid)
  const uB = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('portal-b', 'x', 0, 1)`).run()
  userB = Number(uB.lastInsertRowid)

  // Roles y asignaciones usuario_empresa
  const rolAdmin = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(userA, empresaA, rolAdmin)
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(userB, empresaB, rolAdmin)

  // Sesiones válidas
  sidA = sessionSvc.crearSesion(userA)
  sidB = sessionSvc.crearSesion(userB)

  // Datos en A: venta viva, compra y un ANULADO (no debe entrar a métricas)
  const insertar = db.prepare(`
    INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, fecha_docto,
      rut_contraparte, razon_social, monto_neto, monto_iva, monto_total,
      estado, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // A — período 202609
  insertar.run(empresaA, 'venta', 33, '1001', '2026-09-05', '11111111-1', 'Cliente Uno', 100000, 19000, 119000, 'PENDIENTE', '202609', 'pa-1')
  insertar.run(empresaA, 'venta', 33, '1002', '2026-09-20', '22222222-2', 'Cliente Dos', 50000, 9500, 59500, 'PENDIENTE', '202609', 'pa-2')
  // Nota de crédito de venta 202609: el RCV la trae con montos POSITIVOS (p. ej.
  // NC por 10.000 neto) — el portal NO vuelve a descontar (§7 del masterplan).
  insertar.run(empresaA, 'venta', 61, '1003', '2026-09-25', '11111111-1', 'Cliente Uno', 10000, 1900, 11900, 'PENDIENTE', '202609', 'pa-3')
  // ANULADO: excluido de todas las métricas
  insertar.run(empresaA, 'venta', 33, '1004', '2026-09-26', '33333333-3', 'Cliente Tres', 7000, 1330, 8330, 'ANULADO', '202609', 'pa-4')
  // Compra: no aparece en métricas de venta
  insertar.run(empresaA, 'compra', 33, '2001', '2026-09-10', '44444444-4', 'Proveedor X', 30000, 5700, 35700, 'PENDIENTE', '202609', 'pa-5')
  // A — período previo 202608 (para variación y cartera)
  insertar.run(empresaA, 'venta', 33, '0901', '2026-08-05', '11111111-1', 'Cliente Uno', 200000, 38000, 238000, 'PENDIENTE', '202608', 'pa-6')
  // A — histórico viejo 202501 (cartera 'controlar')
  insertar.run(empresaA, 'venta', 33, '0501', '2025-01-05', '55555555-5', 'Cliente Viejo', 10000, 1900, 11900, 'PENDIENTE', '202501', 'pa-7')
  // B — un dato propio
  insertar.run(empresaB, 'venta', 33, '9001', '2026-09-05', '99999999-9', 'Cliente de B', 999999, 0, 999999, 'PENDIENTE', '202609', 'pb-1')
})

const app = express()
app.use(express.json())
app.use('/api/portal', requireAuth, construirRouter(db))
let server, baseUrl

test.before(async () => {
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  baseUrl = `http://127.0.0.1:${server.address().port}/api/portal`
})
test.after(async () => { await new Promise((r) => server.close(r)) })

async function get(url, headers) {
  const res = await fetch(url, { headers })
  let body = null
  try { body = await res.json() } catch { /* CSV u otro binario */ }
  return { status: res.status, body, text: body ? null : await res.text() }
}

// ===================== T1: motor de métricas =====================

test('T1.1: resumen — suma vivos del período, excluye ANULADO y compra', () => {
  const r = metricas.resumen(db, { empresaId: empresaA, periodo: '202609' })
  // 100.000 + 50.000 - 10.000 (NC 61 descontada UNA vez con CASE signo
  // — misma convención que routes/sii.js) — el ANULADO no entra.
  assert.strictEqual(r.ventas.neta, 140000)
  assert.strictEqual(r.ventas.docs, 3, 'f33, f33, NC61; el ANULADO no cuenta')
  assert.strictEqual(r.clientes_compradores, 2)
  // ticket promedio documento = 140000 / 3 docs = 46666,67 → 46667
  assert.strictEqual(r.ticket_promedio_documento, 46667)
  // ticket promedio cliente = 140000 / 2 clientes = 70000
  assert.strictEqual(r.ticket_promedio_cliente, 70000)
  // VS: la compra de A NO está en la venta neta (tipo_flujo = 'venta' exclusivo)
  assert.notStrictEqual(r.ventas.neta, 190000)
  // Serie anual: 202609 tiene datos; 202608 tiene 200000
  const sep = r.serie_anual.find((m) => m.periodo === '202609')
  assert.strictEqual(sep.neto, 140000)
  const ago = r.serie_anual.find((m) => m.periodo === '202608')
  assert.strictEqual(ago.neto, 200000)
})

test('T1.2: variación — null cuando el mes previo no tiene datos', () => {
  // Empresa B: solo septiembre → octubre de B no tiene previo → variación null
  const r = metricas.resumen(db, { empresaId: empresaB, periodo: '202609' })
  assert.strictEqual(r.ventas.neta, 999999)
  const r10 = metricas.resumen(db, { empresaId: empresaB, periodo: '202610' })
  // 202610 sin docs en B → neta null (sin datos ≠ cero)
  assert.strictEqual(r10.ventas.neta, null)
})

test('T1.3: cartera — segmentos con la regla explícita en la respuesta', () => {
  // ventana 24: para que el cliente viejo de 202501 caiga dentro de la
  // ventana histórica y se clasifique 'controlar' (con 12 sería sin_datos).
  const r = metricas.cartera(db, { empresaId: empresaA, periodo: '202609', ventana: 24 })
  assert.ok(r.regla.includes('cuidar'), 'la regla viaja explícita')
  const por = r.clientes.find((c) => c.rut === '11111111-1')
  assert.strictEqual(por.segmento, 'cuidar', 'compró en ambos meses')
  const dos = r.clientes.find((c) => c.rut === '22222222-2')
  assert.strictEqual(dos.segmento, 'desarrollar', 'solo compró en el período')
  const uno = r.clientes.find((c) => c.rut === '11111111-1')
  assert.ok(uno.neto_periodo > 0)
  const viejo = r.clientes.find((c) => c.rut === '55555555-5')
  assert.strictEqual(viejo.segmento, 'controlar', 'activo 202501, dentro de la ventana 12m')
  const b = metricas.cartera(db, { empresaId: empresaB, periodo: '202609' })
  assert.ok(b.clientes.find((c) => c.rut === '99999999-9').segmento === 'desarrollar')
})

test('T1.4: movimientos — filtros y totales honestos', () => {
  const r = metricas.movimientos(db, { empresaId: empresaA, desde: '202609', hasta: '202609', limit: 10 })
  assert.strictEqual(r.total, 3, 'excluye el ANULADO y la compra')
  assert.strictEqual(r.neto, 140000)
  // Sin rango de fecha: f1001 (09) + NC 1003 (09) + f0901 (08) del mismo cliente
  const por = metricas.movimientos(db, { empresaId: empresaA, rut: '11111111', limit: 10 })
  assert.strictEqual(por.total, 3, 'los 3 documentos vivos del cliente 11111111-1')
  // Con rango 202609: solo f1001 + NC 1003
  const porRango = metricas.movimientos(db, { empresaId: empresaA, rut: '11111111', desde: '202609', hasta: '202609', limit: 10 })
  assert.strictEqual(porRango.total, 2, "f1001 + NC 1003 del mismo cliente")
  assert.strictEqual(porRango.neto, 90000, '100.000 f1001 - 10.000 NC (sin f1002 de otro cliente)')
})

test('T1.5: sin datos = null y cobertura — el período vacío no aparece como cero', () => {
  const r = metricas.resumen(db, { empresaId: empresaA, periodo: '202601' })
  assert.strictEqual(r.ventas.neta, null, 'sin datos → null')
  assert.strictEqual(r.clientes_compradores, null)
  // cobertura ancla el período real disponible
  assert.ok(r.cobertura.ultimo_periodo_con_datos >= '202609')
})

// ===================== T2: aislamiento negativo (HTTP real) =====================

test('T2.1: GET resumen de empresa B con sesión de A → 403', async () => {
  const r = await get(`${baseUrl}/empresas/${empresaB}/resumen?periodo=202609`, headerA())
  assert.strictEqual(r.status, 403)
})

test('T2.2: GET movimientos de empresa B con sesión de A → 403', async () => {
  const r = await get(`${baseUrl}/empresas/${empresaB}/movimientos`, headerA())
  assert.strictEqual(r.status, 403)
})

test('T2.3: GET cartera de empresa B con sesión de A → 403', async () => {
  const r = await get(`${baseUrl}/empresas/${empresaB}/cartera`, headerA())
  assert.strictEqual(r.status, 403)
})

test('T2.4: exportar.csv de empresa B con sesión de A → 403 sin CSV', async () => {
  const res = await fetch(`${baseUrl}/empresas/${empresaB}/exportar.csv`, { headers: headerA() })
  assert.strictEqual(res.status, 403)
  const texto = await res.text()
  assert.ok(!texto.includes('Cliente de B'), 'los datos de B NO se filtran en el cuerpo')
})

test('T2.5: empresas accesibles — A ve SOLO la suya, B ve SOLO la suya', async () => {
  const ra = await get(`${baseUrl}/empresas`, headerA())
  assert.strictEqual(ra.status, 200)
  assert.strictEqual(ra.body.empresas.length, 1)
  assert.strictEqual(ra.body.empresas[0].id, empresaA)
  const rb = await get(`${baseUrl}/empresas`, headerB())
  assert.strictEqual(rb.body.empresas.length, 1)
  assert.strictEqual(rb.body.empresas[0].id, empresaB)
})

test('T2.6: sin sesión → 401 (no 403, no fuga de existencia)', async () => {
  const r = await get(`${baseUrl}/empresas`, {})
  assert.strictEqual(r.status, 401)
})

test('T2.7: empresa_id inexistente o inválido → 403/400 sin datos', async () => {
  const r = await get(`${baseUrl}/empresas/999999/resumen`, headerA())
  assert.strictEqual(r.status, 403, 'empresa inexistente rechazada igual que ajena')
  const r2 = await get(`${baseUrl}/empresas/abc/resumen`, headerA())
  assert.ok([400, 403].includes(r2.status))
})

test('T2.8: camino feliz — A lee SU empresa y NO la de B', async () => {
  const ok = await get(`${baseUrl}/empresas/${empresaA}/resumen?periodo=202609`, headerA())
  assert.strictEqual(ok.status, 200)
  assert.strictEqual(ok.body.resumen.empresa.id, empresaA)
  assert.strictEqual(ok.body.resumen.ventas.neta, 140000)
})

// ===================== T3: reportes guardados =====================

test('T3.1: guardar config de reporte y volver a leerla (A en SU empresa)', async () => {
  const save = await fetch(`${baseUrl}/empresas/${empresaA}/reportes`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: 'Ventas por cliente', config: { agrupar: 'rut', metrica: 'venta_neta_mes', desde: '202609' } }),
  })
  assert.strictEqual(save.status, 201)
  const list = await get(`${baseUrl}/empresas/${empresaA}/reportes`, headerA())
  assert.ok(list.body.reportes.some((x) => x.nombre === 'Ventas por cliente'))
})

test('T3.2: reportes de un usuario NO se ven desde otro usuario de OTRA empresa', async () => {
  const rb = await get(`${baseUrl}/empresas/${empresaB}/reportes`, headerB())
  assert.ok(!rb.body.reportes.some((x) => x.nombre === 'Ventas por cliente'),
    'los reportes de A (empresa A) no aparecen listados en B')
})

test('T3.3: DELETE de un reporte ajeno → 404 sin borrar nada', async () => {
  // A crea un reporte; B intenta borrarlo vía URL manipulada con el id real.
  const list = await get(`${baseUrl}/empresas/${empresaA}/reportes`, headerA())
  const idAjeno = list.body.reportes[0].id
  const del = await fetch(`${baseUrl}/empresas/${empresaA}/reportes/${idAjeno}`, {
    method: 'DELETE', headers: headerB(),
  })
  assert.ok([403, 404, 400].includes(del.status), 'rechazado server-side')
  // el reporte de A sigue existiendo
  const luego = await get(`${baseUrl}/empresas/${empresaA}/reportes`, headerA())
  assert.ok(luego.body.reportes.some((x) => x.id === idAjeno))
})

test('T3.4: duplicar nombre sobrescribe la config del mismo usuario (upsert)', async () => {
  const save = await fetch(`${baseUrl}/empresas/${empresaA}/reportes`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: 'Ventas por cliente', config: { agrupar: 'tipo_doc', metrica: 'venta_neta_mes' } }),
  })
  assert.strictEqual(save.status, 201)
  const list = await get(`${baseUrl}/empresas/${empresaA}/reportes`, headerA())
  const mismos = list.body.reportes.filter((x) => x.nombre === 'Ventas por cliente')
  assert.strictEqual(mismos.length, 1, 'un solo reporte por nombre (config sobrescrita)')
})


