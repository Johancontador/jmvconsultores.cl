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
const portalProductos = require('../backend/core/portal-productos')

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
  // NC de COMPRA (61): debe REBAJARlas compras netas una vez (dashboard duo:
  // la rebaja de notas de crédito opera en venta Y compra por igual).
  insertar.run(empresaA, 'compra', 61, '2002', '2026-09-18', '44444444-4', 'Proveedor X', 5000, 950, 5950, 'PENDIENTE', '202609', 'pa-8')
  // A — período previo 202608 (para variación y cartera)
  insertar.run(empresaA, 'venta', 33, '0901', '2026-08-05', '11111111-1', 'Cliente Uno', 200000, 38000, 238000, 'PENDIENTE', '202608', 'pa-6')
  // A — histórico viejo 202501 (cartera 'controlar')
  insertar.run(empresaA, 'venta', 33, '0501', '2025-01-05', '55555555-5', 'Cliente Viejo', 10000, 1900, 11900, 'PENDIENTE', '202501', 'pa-7')
  // B — un dato propio
  insertar.run(empresaB, 'venta', 33, '9001', '2026-09-05', '99999999-9', 'Cliente de B', 999999, 0, 999999, 'PENDIENTE', '202609', 'pb-1')

  // FASE A — DTEs EMITIDOS con ítems (fuente real de la sección productos):
  // empresa A emite 2 facturas (y 1 NC que descuenta) en 202609 + 1 en 202608.
  const insDte = db.prepare(`
    INSERT INTO dte_emitidos (empresa_id, tipo_dte, folio, fecha_emision,
      receptor_rut, monto_neto, monto_total, items_json, estado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const itemsServicio = JSON.stringify([
    { nombre: 'Mensualidad Contable', cantidad: 1, precio: 50000 },
    { nombre: 'Mensualidad Tributaria', cantidad: 2, precio: 20000 },
  ])
  insDte.run(empresaA, 33, 1, '2026-09-03', '11111111-1', 90000, 107100, itemsServicio, 'ACEPTADO')
  insDte.run(empresaA, 33, 2, '2026-09-15', '22222222-2', 30000, 35700, JSON.stringify([
    { nombre: 'Mensualidad Contable', cantidad: 1, precio: 30000 },
  ]), 'ACEPTADO')
  // NC emitida 61: descuenta la Mensualidad Tributaria (cant y neto una vez)
  insDte.run(empresaA, 61, 1, '2026-09-20', '11111111-1', 20000, 23800, JSON.stringify([
    { nombre: 'Mensualidad Tributaria', cantidad: 1, precio: 20000 },
  ]), 'ACEPTADO')
  insDte.run(empresaA, 33, 3, '2026-08-10', '11111111-1', 10000, 11900, JSON.stringify([
    { nombre: 'Producto Agosto', cantidad: 4, precio: 2500 },
  ]), 'ACEPTADO')
  // ERROR: excluido de productos (como los ANULados en métricas)
  insDte.run(empresaA, 33, 4, '2026-09-25', '33333333-3', 5000, 5950, JSON.stringify([
    { nombre: 'Doc Con Error', cantidad: 1, precio: 5000 },
  ]), 'ERROR')
  // B emite una factura propia: no debe verse desde A (aislamiento)
  insDte.run(empresaB, 33, 1, '2026-09-05', '99999999-9', 70000, 83300, JSON.stringify([
    { nombre: 'Producto Solo De B', cantidad: 7, precio: 10000 },
  ]), 'ACEPTADO')
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

// ===================== T4: serie interactivo (dashboard) =====================

test('T4.1: serie venta — 12 meses desde el ancla, null en meses sin datos', () => {
  const r = metricas.serie(db, { empresaId: empresaA, meses: 12, hasta: '202609', flujo: 'venta' })
  assert.strictEqual(r.flujo, 'venta')
  assert.strictEqual(r.hasta, '202609')
  assert.strictEqual(r.desde, '202510', '12 meses hacia atrás desde 202609 (sep→oct 2025)')
  assert.strictEqual(r.meses.length, 12)
  const sep = r.meses.find((m) => m.periodo === '202609')
  assert.strictEqual(sep.neto, 140000, 'septiembre de A con NC descontada una vez')
  const ago = r.meses.find((m) => m.periodo === '202608')
  assert.strictEqual(ago.neto, 200000)
  const vacio = r.meses.find((m) => m.periodo === '202607')
  assert.strictEqual(vacio.neto, null, 'mes sin datos es null (nunca 0)')
  assert.strictEqual(vacio.docs, 0)
})

test('T4.2: serie compra — el ANULADO no entra y la NC de compra REBAJA una vez', () => {
  const r = metricas.serie(db, { empresaId: empresaA, meses: 6, hasta: '202609', flujo: 'compra' })
  const sep = r.meses.find((m) => m.periodo === '202609')
  assert.strictEqual(sep.neto, 25000, 'compra 30000 − NC de compra 5000 (rebaja UNA vez en compras)')
  // El rango puede pedir hasta 36 meses = los 3 años que sincroniza el botón
  const tres = metricas.serie(db, { empresaId: empresaA, meses: 36, flujo: 'venta' })
  assert.strictEqual(tres.meses.length, 36)
})

test('T4.3: serie mes DEFAULT usa el último con datos del flujo', () => {
  const r = metricas.serie(db, { empresaId: empresaA, meses: 3, flujo: 'venta' })
  assert.strictEqual(r.hasta, '202609', 'el ancla es el último período con RCV de venta')
})

test('T4.4: serie HTTP — solo SU empresa, parámetros limpiados server-side', async () => {
  const ok = await get(`${baseUrl}/empresas/${empresaA}/serie?meses=6&hasta=202609&flujo=venta`, headerA())
  assert.strictEqual(ok.status, 200)
  assert.strictEqual(ok.body.serie.meses.length, 6)
  assert.strictEqual(ok.body.serie.hasta, '202609')
  // B con sesión de A → 403 (aislamiento igual que las otras rutas)
  const denegado = await get(`${baseUrl}/empresas/${empresaB}/serie`, headerA())
  assert.strictEqual(denegado.status, 403)
  // meses fuera de rango y basura se normalizan (no explota); el tope es 36
  const raro = await get(`${baseUrl}/empresas/${empresaA}/serie?meses=999&hasta=xyz`, headerA())
  assert.strictEqual(raro.status, 200)
  assert.ok(raro.body.serie.meses.length >= 1 && raro.body.serie.meses.length <= 36, 'tope de serie extendido a 36 (3 años del sync)')
})

// ===================== FASE A: productos (§7.2) =====================

test('T5.1: productos — agrega ítems de DTE emitidos, NC descuenta UNA vez, ERROR fuera', () => {
  const r = portalProductos.productosVendidos(db, { empresaId: empresaA, desde: '202609', hasta: '202609' })
  assert.strictEqual(r.dtes_analizados, 3, '2 facturas + 1 NC; el DTE en ERROR queda fuera')
  const contable = r.productos.find((p) => p.nombre === 'Mensualidad Contable')
  assert.strictEqual(contable.cantidad, 2, '1 + 1 de las dos facturas')
  assert.strictEqual(contable.neto, 80000, '50000 + 30000')
  assert.strictEqual(contable.precio_promedio, 40000)
  const trib = r.productos.find((p) => p.nombre === 'Mensualidad Tributaria')
  assert.strictEqual(trib.cantidad, 1, '2 emitidas - 1 por la NC (descuenta una vez)')
  assert.strictEqual(trib.neto, 20000, '40000 emitido - 20000 NC')
  assert.ok(!r.productos.some((p) => p.nombre === 'Doc Con Error'), 'el DTE ERROR no aporta productos')
})

test('T5.2: productos — rango excluye el mes de agosto', () => {
  const r = portalProductos.productosVendidos(db, { empresaId: empresaA, desde: '202609', hasta: '202609' })
  assert.ok(!r.productos.some((p) => p.nombre === 'Producto Agosto'), 'agosto fuera del filtro 202609')
  const wide = portalProductos.productosVendidos(db, { empresaId: empresaA, desde: '202608', hasta: '202609' })
  assert.ok(wide.productos.some((p) => p.nombre === 'Producto Agosto'))
})

test('T5.3: productos /cobranza — aislamiento HTTP real (A NO ve los dtes de B ni cobranza de B)', async () => {
  const rp = await get(`${baseUrl}/empresas/${empresaB}/productos`, headerA())
  assert.strictEqual(rp.status, 403)
  const rc = await get(`${baseUrl}/empresas/${empresaB}/cobranza`, headerA())
  assert.strictEqual(rc.status, 403)
  const ok = await get(`${baseUrl}/empresas/${empresaA}/productos?desde=202601&hasta=202612`, headerA())
  assert.strictEqual(ok.status, 200)
  assert.ok(!ok.text, 'respuesta JSON')
  assert.ok(!JSON.stringify(ok.body).includes('Producto Solo De B'), 'el producto de B no aparece en la respuesta para A')
  assert.ok(ok.body.productos.some((p) => p.nombre === 'Mensualidad Contable'))
})

test('T5.4: productos — sin emisiones = lista vacía con cobertura null (sin datos ≠ cero)', () => {
  const r = portalProductos.productosVendidos(db, { empresaId: empresaB, desde: '202601', hasta: '202601' })
  assert.strictEqual(r.productos.length, 0)
  assert.strictEqual(r.periodo_cobertura, null)
})

// ===================== FASE B: cobranza (§7.4) =====================

test('T5.5: cobranza — solo lectura; saldos de contabilizados; umbrales en la respuesta', async () => {
  // Sin documentos contabilizados todavía en A → lista vacía (no ceros falsos,
  // «sin datos»), con la forma OK del endpoint.
  const r = await get(`${baseUrl}/empresas/${empresaA}/cobranza?dias_amarillo=10&dias_rojo=45`, headerA())
  assert.strictEqual(r.status, 200)
  assert.strictEqual(r.body.ok, true)
  assert.strictEqual(r.body.cobranza.total_pendiente, 0)
  assert.strictEqual(r.body.cobranza.umbrales.amarillo, 10)
  assert.strictEqual(r.body.cobranza.umbrales.rojo, 45)
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


// ===================== FASES C/D/E del portal (§7.1/§7.3/§7.5) =====================
// Fuentes DIGITADAS de negocio (crédito autorizado, costos, cotizaciones) que el
// SII no entrega. Principio rector: lo sin fuente NO se estima — se registra aquí,
// con aislamiento estricto (§8) y escritura SOLO del dueño (admin_empresa).

const portalCredito = require('../backend/core/portal-credito')
const portalCostos = require('../backend/core/portal-costos')
const portalCotizaciones = require('../backend/core/portal-cotizaciones')

// Usuario CONTADOR de la empresa A: puede LEER los datos digitados pero NO
// escribirlos (la ficha de negocio es del dueño). Sesión creada en su test.
let sidC = null

test('T6.0: setup usuario contador (sin permisos de escritura del portal)', () => {
  const uC = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES ('portal-contador-a', 'x', 0, 1)`).run()
  const rolContador = db.prepare(`SELECT id FROM roles WHERE codigo = 'contador'`).get().id
  db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id, activo) VALUES (?, ?, ?, 1)`).run(Number(uC.lastInsertRowid), empresaA, rolContador)
  sidC = sessionSvc.crearSesion(Number(uC.lastInsertRowid))
})

const headerC = () => ({ cookie: `sid=${sidC}` })

// ===================== FASE C: crédito autorizado (§7.1) =====================

test('T6.1: fijar crédito — upsert idempotente por RUT normalizado', () => {
  let r = portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '12.345.678-5', razonSocial: 'Cliente Crédito', monto: 500000 })
  assert.strictEqual(r.actualizado, false)
  assert.strictEqual(r.rut_norm, '123456785')
  // Mismo cliente con otro formato de RUT → ACTUALIZA (no duplica)
  r = portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '123456785', monto: 450000 })
  assert.strictEqual(r.actualizado, true)
  const filas = portalCredito.listar(db, { empresaId: empresaA })
  assert.strictEqual(filas.length, 1)
  assert.strictEqual(filas[0].monto_autorizado, 450000)
  assert.strictEqual(filas[0].razon_social, 'Cliente Crédito', 'la razón social persiste si no se re-envía')
  // Ficha de un cliente al día (sin saldo en exposición)
  portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '88111111-9', razonSocial: 'Al Día SpA', monto: 200000 })
})

test('T6.2: fijar crédito — validaciones de dominio', () => {
  assert.throws(() => portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '12.345.678-5', monto: -1 }), /Monto/)
  assert.throws(() => portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '12.345.678-5', monto: 1.5 }), /Monto/)
  assert.throws(() => portalCredito.fijarAutorizado(db, { empresaId: empresaA, usuarioId: userA, rut: '', monto: 100 }), /Falta el RUT/)
})

test('T6.3: exposición — SOBREPASADO / DISPONIBLE / SIN_CREDITO, nunca creditos estimados', () => {
  const saldosFalsos = {
    total_pendiente: 700000,
    clientes: [
      { rut: '12.345.678-5', razon_social: 'Cliente Crédito', saldo: 600000, mora_max_dias: 40, nivel: 'rojo', documentos_abiertos: [] },
      { rut: '99.777.777-2', razon_social: 'Sin Ficha Ltda', saldo: 100000, mora_max_dias: 2, nivel: 'verde', documentos_abiertos: [] },
    ],
  }
  const r = portalCredito.exposicion(db, { empresaId: empresaA, saldosFn: () => saldosFalsos })
  const sobrepasado = r.clientes.find((c) => c.rut_norm === '123456785')
  assert.strictEqual(sobrepasado.estado, 'SOBREPASADO')
  assert.strictEqual(sobrepasado.disponible, -150000, '450000 autorizado − 600000 saldo')
  const sinFicha = r.clientes.find((c) => c.rut_norm === '997777772')
  assert.strictEqual(sinFicha.estado, 'SIN_CREDITO')
  assert.strictEqual(sinFicha.autorizado, null, 'sin ficha NO se estima el crédito')
  assert.strictEqual(sinFicha.disponible, null)
  const alDia = r.clientes.find((c) => c.rut_norm === '881111119')
  assert.strictEqual(alDia.estado, 'DISPONIBLE')
  assert.strictEqual(alDia.disponible, 200000, 'ficha de cliente sin saldo aparece con su crédito íntegro')
  assert.strictEqual(r.resumen.sobrepasados, 1)
  assert.strictEqual(r.resumen.sin_credito, 1)
})

test('T6.4: crédito HTTP — escritura SOLO del dueño; aislamiento de lectura', async () => {
  // dueño de A escribe en A (201 nueva)
  const ok = await fetch(`${baseUrl}/empresas/${empresaA}/credito`, {
    method: 'PUT', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ rut: '77777777-1', razon_social: 'Cliente HTTP', monto_autorizado: 300000 }),
  })
  assert.strictEqual(ok.status, 201)
  // El contador de A (asignado) PUEDE leer pero NO escribir
  const lectura = await get(`${baseUrl}/empresas/${empresaA}/credito`, headerC())
  assert.strictEqual(lectura.status, 200)
  assert.ok(lectura.body.fichas.some((f) => f.rut_original === '77777777-1'))
  const escrituraContador = await fetch(`${baseUrl}/empresas/${empresaA}/credito`, {
    method: 'PUT', headers: { ...headerC(), 'content-type': 'application/json' },
    body: JSON.stringify({ rut: '77777777-1', monto_autorizado: 1 }),
  })
  assert.strictEqual(escrituraContador.status, 403, 'solo el dueño registra datos de negocio')
  // A NO escribe/lee la empresa de B
  const putB = await fetch(`${baseUrl}/empresas/${empresaB}/credito`, {
    method: 'PUT', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ rut: '77777777-1', monto_autorizado: 500 }),
  })
  assert.strictEqual(putB.status, 403)
  const getB = await get(`${baseUrl}/empresas/${empresaB}/credito`, headerA())
  assert.strictEqual(getB.status, 403)
  // Datos inválidos → 400 (nunca media escritura)
  const malo = await fetch(`${baseUrl}/empresas/${empresaA}/credito`, {
    method: 'PUT', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ rut: '77777777-1', monto_autorizado: -5 }),
  })
  assert.strictEqual(malo.status, 400)
  assert.strictEqual(portalCredito.listar(db, { empresaId: empresaA }).filter((f) => f.rut_norm === '777777771').length, 1, 'la ficha quedó con su valor original')
})

// ===================== FASE D: costos y margen (§7.3) =====================

test('T7.1: margen — solo productos CON costo digitado; cobertura explícita', () => {
  portalCostos.fijarCosto(db, { empresaId: empresaA, usuarioId: userA, producto: 'Mensualidad Contable', costoUnitario: 20000 })
  const r = portalCostos.margen(db, { empresaId: empresaA, desde: '202609', hasta: '202609' })
  const con = r.productos.find((p) => p.nombre === 'Mensualidad Contable')
  assert.strictEqual(con.costo_unitario, 20000)
  assert.strictEqual(con.costo_total, 40000, '20000 × cantidad agregada 2')
  assert.strictEqual(con.margen, 40000, 'neto 80000 − costo 40000')
  const sinCosto = r.productos.find((p) => p.nombre === 'Mensualidad Tributaria')
  assert.strictEqual(sinCosto.margen, null, 'sin costo digitado NO se estima el margen')
  assert.strictEqual(sinCosto.costo_total, null)
  // Cobertura: venta positiva del rango = 80000 + 20000 = 100000; con costo 80000
  assert.strictEqual(r.cobertura.venta_positiva_total, 100000)
  assert.strictEqual(r.cobertura.venta_con_margen, 80000)
  assert.strictEqual(r.cobertura.pct_venta_con_margen, 80)
  assert.strictEqual(r.cobertura.productos_con_costo, 1)
  assert.strictEqual(r.cobertura.productos_total, 2)
  // Agosto (202608) fuera del rango
  assert.ok(!r.productos.some((p) => p.nombre === 'Producto Agosto'))
})

test('T7.2: fijar costo — upsert y validaciones', () => {
  let r = portalCostos.fijarCosto(db, { empresaId: empresaA, usuarioId: userA, producto: 'mensualidad contable', costoUnitario: 18000 })
  assert.strictEqual(r.actualizado, true, 'normalizado case-insensitive = mismo producto')
  let filas = portalCostos.listar(db, { empresaId: empresaA })
  assert.strictEqual(filas.length, 1)
  assert.strictEqual(filas[0].costo_unitario, 18000)
  assert.throws(() => portalCostos.fijarCosto(db, { empresaId: empresaA, usuarioId: userA, producto: 'X', costoUnitario: -1 }), /Costo/)
  assert.throws(() => portalCostos.fijarCosto(db, { empresaId: empresaA, usuarioId: userA, producto: '   ', costoUnitario: 10 }), /Falta el nombre/)
})

test('T7.3: costos/margen HTTP — aislamiento e igual regla de escritura', async () => {
  const putB = await fetch(`${baseUrl}/empresas/${empresaB}/costos`, {
    method: 'PUT', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ producto: 'Producto Solo De B', costo_unitario: 5 }),
  })
  assert.strictEqual(putB.status, 403)
  const getB = await get(`${baseUrl}/empresas/${empresaB}/margen`, headerA())
  assert.strictEqual(getB.status, 403)
  const margenA = await get(`${baseUrl}/empresas/${empresaA}/margen?desde=202609&hasta=202609`, headerC())
  assert.strictEqual(margenA.status, 200)
  assert.ok(!JSON.stringify(margenA.body).includes('Producto Solo De B'), 'los costos/venta de B no se filtran')
  assert.ok(margenA.body.productos.some((p) => p.nombre === 'Mensualidad Contable'))
})

// ===================== FASE E: cotizaciones y embudo (§7.5) =====================

test('T8.1: cotizaciones — ciclo real y embudo con tasa honesta', () => {
  const c1 = portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRut: '11111111-1', monto: 200000, estado: 'ENVIADA', descripcion: 'Licencia PRO anual' })
  const c2 = portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRut: '22222222-2', monto: 100000 })
  portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRazon: 'Prospecto Nuevo', monto: 50000 })

  let r = portalCotizaciones.actualizar(db, { empresaId: empresaA, usuarioId: userA, id: c2.cotizacion.id, estado: 'ENVIADA' })
  assert.strictEqual(r.cotizacion.estado, 'ENVIADA')
  r = portalCotizaciones.actualizar(db, { empresaId: empresaA, usuarioId: userA, id: c1.cotizacion.id, estado: 'ACEPTADA' })
  assert.strictEqual(r.cotizacion.estado, 'ACEPTADA')
  assert.ok(r.cotizacion.fecha_cierre, 'la ACEPTADA lleva fecha de cierre')

  const e = portalCotizaciones.embudo(db, { empresaId: empresaA })
  assert.strictEqual(e.hay_datos, true)
  const mapa = new Map(e.por_estado.map((x) => [x.estado, x]))
  assert.strictEqual(mapa.get('ENVIADA').monto, 100000)
  assert.strictEqual(mapa.get('ACEPTADA').monto, 200000)
  assert.strictEqual(mapa.get('BORRADOR').monto, 50000)
  assert.strictEqual(e.tasa_conversion.por_monto, 200, '200.000 aceptado / 100.000 enviado')
  assert.strictEqual(e.monto_pendiente, 150000, 'borrador 50.000 + enviada 100.000')
  const c1id = c1.cotizacion.id
  // Sin enviadas en la empresa B → tasa null (no 0%)
  const eB = portalCotizaciones.embudo(db, { empresaId: empresaB })
  assert.strictEqual(eB.hay_datos, false)
  // Cierre: una cerrada NO vuelve a open (la historia no se re-escribe)
  assert.throws(() => portalCotizaciones.actualizar(db, { empresaId: empresaA, usuarioId: userA, id: c1id, estado: 'BORRADOR' }), /cerrada/)
})

test('T8.2: cotizaciones — validaciones de dominio', () => {
  const candado = portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRut: '77777777-1', monto: 90000 })
  assert.throws(() => portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, monto: 10 }), /RUT o la razón/)
  assert.throws(() => portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRut: '77777777-1', monto: -3 }), /Monto/)
  assert.throws(() => portalCotizaciones.crear(db, { empresaId: empresaA, usuarioId: userA, clienteRut: '77777777-1', monto: 10, estado: 'GANADA' }), /Estado inicial/)
  assert.throws(() => portalCotizaciones.actualizar(db, { empresaId: empresaA, usuarioId: userA, id: candado.cotizacion.id, estado: 'GANADA' }), /Estado/)
  // Eliminar (agendada) quede auditada
  const del = portalCotizaciones.eliminar(db, { empresaId: empresaA, usuarioId: userA, id: candado.cotizacion.id })
  assert.strictEqual(del.ok, true)
  assert.throws(() => portalCotizaciones.eliminar(db, { empresaId: empresaA, usuarioId: userA, id: candado.cotizacion.id }), /no encontrada/)
})

test('T8.3: cotizaciones HTTP — aislamiento estricto y escritura del dueño', async () => {
  const crearB = await fetch(`${baseUrl}/empresas/${empresaB}/cotizaciones`, {
    method: 'POST', headers: { ...headerB(), 'content-type': 'application/json' },
    body: JSON.stringify({ cliente_razon: 'Cliente de B', monto: 123000 }),
  })
  assert.strictEqual(crearB.status, 201)
  // A intenta todo sobre B → 403
  const getListB = await get(`${baseUrl}/empresas/${empresaB}/cotizaciones`, headerA())
  assert.strictEqual(getListB.status, 403)
  const idDeB = (await get(`${baseUrl}/empresas/${empresaB}/cotizaciones`, headerB())).body.cotizaciones[0].id
  const putB = await fetch(`${baseUrl}/empresas/${empresaB}/cotizaciones/${idDeB}`, {
    method: 'PUT', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ estado: 'ENVIADA' }),
  })
  assert.strictEqual(putB.status, 403)
  const delB = await fetch(`${baseUrl}/empresas/${empresaB}/cotizaciones/${idDeB}`, { method: 'DELETE', headers: headerA() })
  assert.strictEqual(delB.status, 403)
  // Contador de A puede LEER pero no escribir
  const listaA = await get(`${baseUrl}/empresas/${empresaA}/cotizaciones`, headerC())
  assert.strictEqual(listaA.status, 200)
  assert.ok(listaA.body.cotizaciones.some((c) => c.cliente_rut === '11111111-1'))
  const crearCont = await fetch(`${baseUrl}/empresas/${empresaA}/cotizaciones`, {
    method: 'POST', headers: { ...headerC(), 'content-type': 'application/json' },
    body: JSON.stringify({ cliente_rut: '11111111-1', monto: 5 }),
  })
  assert.strictEqual(crearCont.status, 403)
  // Datos inválidos del dueño → 400
  const malo = await fetch(`${baseUrl}/empresas/${empresaA}/cotizaciones`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ monto: 5 }),
  })
  assert.strictEqual(malo.status, 400)
})
// ===================== CSV de costos + crédito en cobranza (incrementos Fases C/D) =====================

test('T7.4: importarCostosCSV — upsert idempotente, miles chilenos, saltadas con motivo', () => {
  const csv = [
    'producto;costo', // encabezado tolerado
    'Mensualidad Contable;22.000', // ya existe (18.000) → ACTUALIZA
    'Licencia Anual Pro;120.000', // nuevo
    '"Mensualidad Tributaria";10.000', // comillas toleradas → nuevo
    'Sin costo;;', // línea inválida con 2 columnas vacías...
    'Mensuel Rara;abc', // costo no numérico → saltada con motivo
  ].join('\n')
  const r = portalCostos.importarCostosCSV(db, { empresaId: empresaA, usuarioId: userA, texto: csv })
  assert.strictEqual(r.importados, 2, 'Licencia Anual Pro + Mensualidad Tributaria')
  assert.strictEqual(r.actualizados, 1, 'Mensualidad Contable actualizada a 22000')
  const motivos = r.saltadas.map((x) => x.motivo).join(' | ')
  assert.ok(motivos.includes('abc'), 'la línea con costo no numérico se reporta')
  // Re-importar el MISMO csv: 0 nuevos, 2 actualizados (idempotente)
  const r2 = portalCostos.importarCostosCSV(db, { empresaId: empresaA, usuarioId: userA, texto: csv })
  assert.strictEqual(r2.importados, 0)
  assert.strictEqual(r2.actualizados, 3, 'las tres líneas válidas ahora actualizan')
  // El margen usa el costo nuevo
  const m = portalCostos.margen(db, { empresaId: empresaA, desde: '202609', hasta: '202609' })
  assert.strictEqual(m.productos.find((p) => p.nombre === 'Mensualidad Contable').costo_unitario, 22000)
  // CSV vacío / todo inválido → error sin media importación (nada se escribe)
  assert.throws(() => portalCostos.importarCostosCSV(db, { empresaId: empresaA, usuarioId: userA, texto: '' }), /vacío/)
  const antes = portalCostos.listar(db, { empresaId: empresaA }).length
  assert.throws(() => portalCostos.importarCostosCSV(db, { empresaId: empresaA, usuarioId: userA, texto: 'uno solo' }), /Ninguna línea importable/)
  assert.strictEqual(portalCostos.listar(db, { empresaId: empresaA }).length, antes, 'sin en medio-import: nada cambió')
})

test('T7.5: costos-csv HTTP — escritura solo del dueño con resumen auditable', async () => {
  // Contador de A (asignado, no dueño) NO puede importar
  const solo = await fetch(`${baseUrl}/empresas/${empresaA}/costos-csv`, {
    method: 'POST', headers: { ...headerC(), 'content-type': 'application/json' },
    body: JSON.stringify({ texto_csv: 'X;1' }),
  })
  assert.strictEqual(solo.status, 403)
  // A NO toca la empresa de B
  const cruzado = await fetch(`${baseUrl}/empresas/${empresaB}/costos-csv`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ texto_csv: 'Producto Solo De B;1' }),
  })
  assert.strictEqual(cruzado.status, 403)
  // Camino feliz del dueño + cuerpo inválido → 400 (nada parcial)
  const ok = await fetch(`${baseUrl}/empresas/${empresaA}/costos-csv`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({ texto_csv: 'Producto HTTP;15.000' }),
  })
  assert.strictEqual(ok.status, 201)
  assert.strictEqual(JSON.parse(await ok.text()).importados, 1)
  const malo = await fetch(`${baseUrl}/empresas/${empresaA}/costos-csv`, {
    method: 'POST', headers: { ...headerA(), 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.strictEqual(malo.status, 400)
})

test('T6.5: enriquecerConCredito — sin ficha null (no estimado), sobrepasados y resumen', () => {
  const saldos = {
    total_pendiente: 300000,
    clientes: [
      { rut: '12.345.678-5', razon_social: 'Cliente Crédito', saldo: 600000, mora_max_dias: 40, nivel: 'rojo', documentos_abiertos: [] },
      { rut: '99.777.777-2', razon_social: 'Sin Ficha Ltda', saldo: 100000, mora_max_dias: 2, nivel: 'verde', documentos_abiertos: [] },
    ],
  }
  const r = portalCredito.enriquecerConCredito(db, { empresaId: empresaA, saldos })
  assert.strictEqual(r.total_pendiente, 300000, 'los campos de la cobranza base quedan intactos')
  const con = r.clientes.find((c) => c.rut_norm === '123456785')
  assert.strictEqual(con.credito_autorizado, 450000, 'ficha de T6.1')
  const sin = r.clientes.find((c) => c.rut_norm === '997777772')
  assert.strictEqual(sin.credito_autorizado, null, 'sin ficha NO se estima')
  assert.strictEqual(r.credito.sobrepasados, 1)
  assert.strictEqual(r.credito.sin_ficha, 1)
  assert.ok(r.credito.regla.includes('no se estima'))
})
// ===================== Dashboard DUO + SINCRONIZACIÓN 3 años (§A 2026-10) =====================

test('T9.1: resumenDuo — venta y compra con NC restadas UNA vez cada una; diferencia aritmética', () => {
  const r = metricas.resumenDuo(db, { empresaId: empresaA, periodo: '202609' })
  // Venta: 100000 + 50000 − NC 10000 = 140000; IVA 19000 + 9500 − 1900 = 26600
  assert.strictEqual(r.venta.neto, 140000)
  assert.strictEqual(r.venta.iva, 26600)
  // Compra: 30000 − NC de compra 5000 = 25000; IVA 5700 − 950 = 4750
  assert.strictEqual(r.compra.neto, 25000, 'la NC de compra REBAJA las compras netas')
  assert.strictEqual(r.compra.iva, 4750)
  // Variaciones con comparable real (202608: venta 200000; compra no tiene previo)
  assert.strictEqual(r.venta.variacion_neta_pct, -30)
  assert.strictEqual(r.compra.variacion_neta_pct, null, 'sin compras en 202608 → null (no 0%)')
  // Diferencia bruta: aritmética sobre datos reales, etiquetada provisional
  assert.strictEqual(r.diferencia_bruta.neto, 115000)
  assert.strictEqual(r.diferencia_bruta.iva_det, 21850)
  assert.ok(r.diferencia_bruta.etiqueta.includes('PPM'), 'la IVA determinado va labeling provisional')
  assert.ok(r.regla.includes('venta'), 'la regla de NC viaja explícita')
  // Sin compra (empresa B): diferencia null — NO cero
  const b = metricas.resumenDuo(db, { empresaId: empresaB, periodo: '202609' })
  assert.strictEqual(b.venta.neto, 999999)
  assert.strictEqual(b.compra.neto, null)
  assert.strictEqual(b.diferencia_bruta, null)
})

test('T9.2: resumen-duo HTTP — aislamiento igual que las otras rutas', async () => {
  const cruzada = await get(`${baseUrl}/empresas/${empresaB}/resumen-duo`, headerA())
  assert.strictEqual(cruzada.status, 403)
  const propia = await get(`${baseUrl}/empresas/${empresaA}/resumen-duo?periodo=202609`, headerC())
  assert.strictEqual(propia.status, 200)
  assert.strictEqual(propia.body.venta.neto, 140000)
  assert.ok(!JSON.stringify(propia.body).includes('999999'), 'los montos de B no se filtran a A')
})

test('T9.3: sincronizar 3 años — solo el dueño; sin clave SII → 422 honesto; estado por usuario', async () => {
  // El contador de A NO lanza sincronización (escritura de datos vía SII)
  const contador = await fetch(`${baseUrl}/empresas/${empresaA}/sincronizar`, { method: 'POST', headers: headerC() })
  assert.strictEqual(contador.status, 403)
  // A NO toca B
  const cruzada = await fetch(`${baseUrl}/empresas/${empresaB}/sincronizar`, { method: 'POST', headers: headerA() })
  assert.strictEqual(cruzada.status, 403)
  // Dueño de A, sin clave SII en la BD de pruebas → 422 con el motivo exacto
  const r = await fetch(`${baseUrl}/empresas/${empresaA}/sincronizar`, { method: 'POST', headers: headerA() })
  assert.strictEqual(r.status, 422)
  const cuerpo = JSON.parse(await r.text())
  assert.ok(cuerpo.error.includes('clave SII'), 'el error nombra la causa real: falta clave SII')
  // Estado sin job y con job ajeno → null (nunca datos de otro usuario)
  const sinJob = await get(`${baseUrl}/empresas/${empresaA}/sincronizar/estado`, headerA())
  assert.strictEqual(sinJob.status, 200)
  assert.strictEqual(sinJob.body.estado, null)
  const ajeno = await get(`${baseUrl}/empresas/${empresaA}/sincronizar/estado?job=inventado_123`, headerA())
  assert.strictEqual(ajeno.body.estado, null, 'un job que no es del usuario responde null')
})
