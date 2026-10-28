'use strict'
/**
 * SALUD TRIBUTARIA — tests del informe y de la matriz de capacidades SII.
 *
 * Lo que se prueba:
 *  T1  Régimen desde atributos REALES del SII (14D1) — regresión del bug que
 *      dejaba `regimen = null` en todas las Pro Pyme General.
 *  T2  Sin ficha y sin RCV ⇒ SIN_INFORMACION; jamás un «al día» inventado.
 *  T3  F29/F22/juradas/boletas SIEMPRE `no_integrado` (la conexión no existe).
 *  T4  Alerta de término de giro del SII ⇒ REQUIERE_REVISION (alta).
 *  T5  Totales mensuales con Nota de Crédito restando y F29 estimado.
 *  T6  Cobertura completa + ficha completa ⇒ AL_DIA.
 *  T7  Snapshot persistido como evidencia.
 *
 * BD temporal; sin red. Ejecutar: node --test test/salud-tributaria.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-salud-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const salud = require('../backend/core/salud-tributaria')
const empresasSii = require('../backend/core/empresas-sii')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

let nEmp = 0
function empresa({ rut = '76312274-3', tasa = 0.01 } = {}) {
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES (?, ?, 'k', ?, 1)`)
    .run(rut, `Empresa Salud ${++nEmp}`, tasa)
  return Number(info.lastInsertRowid)
}

function doc(empresaId, { periodo, flujo = 'venta', tipo = 33, neto = 1000, iva = 190, folio }) {
  db.prepare(`
    INSERT INTO documentos
      (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, monto_neto, monto_iva, monto_total, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, ?, ?, '11111111-1', ?, ?, ?, ?, ?)
  `).run(empresaId, flujo, tipo, String(folio || `${Date.now()}-${Math.random()}`), neto, iva, neto + iva, periodo, `${flujo}:${tipo}:${folio || Math.random()}`)
}

const FICHA_COMPLETA = {
  rut: '76312274-3',
  nombre: 'COMERCIALIZADORA C&E CLIMA LIMITADA',
  inicioActividades: '2019-05-02',
  terminoGiro: null,
  regimen: 'Pro Pyme General (14 D)',
  regimenAtributo: { codigo: '14D1', descripcion: 'REGIMEN PRO PYME GENERAL (14D)' },
  actividades: ['VENTA E INSTALACION DE EQUIPOS DE CLIMATIZACION'],
  direccion: 'AV. SIEMPRE VIVA 123, RANCAGUA',
  direcciones: [{ tipo: 'DOMICILIO', calle: 'AV. SIEMPRE VIVA', numero: '123', comuna: 'RANCAGUA' }],
  capital: { enterado_miles_clp: 1000, por_enterar_miles_clp: 0 },
  email: 'contacto@example.com',
  telefono: '999999999',
  tipoContribuyente: 'EMPRESA',
  segmento: 'PEQUENA EMPRESA',
  unidadOperativa: { codigo: '06101', descripcion: 'RANCAGUA' },
  alertas: [],
  atributos: [{ codigo: '14D1', descripcion: 'REGIMEN PRO PYME GENERAL (14D)', fechaInicio: '01-01-2025', fechaTermino: null }],
  origen: 'test',
}

test('T1: régimen desde 14D1 (atributo real del SII) y ficha completa', () => {
  const eid = empresa()
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(inf.identidad.regimen, 'Pro Pyme General (14 D)')
  assert.equal(inf.identidad.regimen_atributo.codigo, '14D1')
  assert.equal(inf.identidad.inicio_actividades, '2019-05-02')
  assert.ok(inf.identidad.direccion.includes('RANCAGUA'))
  assert.equal(inf.identidad.capital.enterado_miles_clp, 1000)
})

test('T2: sin ficha y sin RCV ⇒ SIN_INFORMACION y hallazgo SIN_RCV (no inventa)', () => {
  const eid = empresa({ rut: '77255326-9' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  assert.equal(inf.opinion.nivel, 'SIN_INFORMACION')
  assert.ok(inf.opinion.hallazgos.some((h) => h.codigo === 'SIN_RCV' && h.severidad === 'alta'))
  assert.equal(inf.mensuales.length, 12)
  assert.ok(inf.mensuales.every((m) => m.estado === 'sin_datos'))
})

test('T3: sin consulta al SII, las declaraciones quedan no_consultado (nunca «al día»)', () => {
  const eid = empresa({ rut: '78198601-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', ficha: FICHA_COMPLETA })
  for (const k of ['f29', 'renta_f22', 'juradas', 'boletas_honorarios']) {
    assert.equal(inf.declaraciones[k].estado, 'no_consultado', `${k} sin consulta no puede declararse disponible`)
  }
  assert.equal(inf.ingresos_historicos.estado, 'parcial')
  assert.equal(inf.capacidades_sii.find((c) => c.id === 'rcv').estado, 'disponible')
  // No consultar es limitación, no hallazgo: la opinión no se degrada por eso.
  assert.ok(!inf.opinion.hallazgos.some((h) => h.codigo === 'F29_NO_CONSULTADO'))
})

test('T4: alerta de término de giro del SII ⇒ REQUIERE_REVISION', () => {
  const eid = empresa({ rut: '77838371-3' })
  const ficha = {
    ...FICHA_COMPLETA,
    rut: '77838371-3',
    terminoGiro: '2025-01-31',
    alertas: [{ codigo: '9221920251', descripcion: 'Periodo de Termino de Giro es: 01-01-2025 hasta 31-01-2025', fechaActiv: '10-08-2026' }],
  }
  doc(eid, { periodo: '202610', tipo: 33, neto: 500000, iva: 95000, folio: 'T4-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', ficha })
  assert.equal(inf.opinion.nivel, 'REQUIERE_REVISION')
  assert.ok(inf.opinion.hallazgos.some((h) => h.codigo === 'TERMINO_GIRO' && h.severidad === 'alta'))
  assert.ok(inf.opinion.hallazgos.some((h) => h.codigo === 'ALERTA_SII' && /Termino de Giro/.test(h.detalle)))
})

test('T5: Nota de Crédito resta y el F29 es ESTIMADO desde el RCV', () => {
  const eid = empresa({ rut: '77338917-9', tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000, iva: 190, folio: 'V1' })
  doc(eid, { periodo: '202609', tipo: 61, neto: 200, iva: 38, folio: 'NC1' })
  doc(eid, { periodo: '202609', flujo: 'compra', tipo: 33, neto: 400, iva: 76, folio: 'C1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const m = inf.mensuales.find((x) => x.periodo === '202609')
  assert.equal(m.ventas_neto, 800)
  assert.equal(m.ventas_iva, 152)
  assert.equal(m.iva_estimado, 76)
  assert.equal(m.ppm_estimado, 8)
  assert.equal(m.f29_estimado, 84)
  assert.equal(m.estado, 'con_datos')
  assert.ok(m.fuente.includes('estimación'))
})

test('T6: cobertura completa + ficha completa ⇒ AL_DIA', () => {
  const eid = empresa({ rut: '78181543-8' })
  const periodos = salud.ultimosPeriodos(12, '202610')
  periodos.forEach((p, i) => {
    doc(eid, { periodo: p, tipo: 33, neto: 100000 + i, iva: 19000, folio: `A-${p}` })
  })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(inf.cobertura.completa, true)
  assert.equal(inf.opinion.nivel, 'AL_DIA')
  assert.ok(inf.opinion.score >= 90)
  assert.ok(inf.opinion.limitaciones.some((l) => /F29/.test(l)))
})

test('T8: F29 con casilla 091 se mezcla con la estimación y calcula diferencia', () => {
  const eid = empresa({ rut: '76012345-6', tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'F29-1' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '76012345-6', 'F29', '202609', 'declarada', '123456789', '2026-10-12', 200000, '{}')
  `).run(eid)
  // Formulario Compacto: la ÚNICA vía que identifica la casilla 091.
  db.prepare(`
    INSERT INTO f29_formularios (empresa_id, rut, periodo, folio, estado, indicadores_json, casillas_json, verificaciones_json)
    VALUES (?, '76012345-6', '202609', '123456789', 'declarada', ?, '[]', '[]')
  `).run(eid, JSON.stringify({ total_a_pagar: 200000, iva_determinado: 190000, ppm_neto: 10000, base_imponible: 1000000 }))
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const m = inf.mensuales.find((x) => x.periodo === '202609')
  assert.equal(m.f29_estado, 'declarada')
  assert.equal(m.f29_oficial.folio, '123456789')
  assert.equal(m.f29_oficial.fecha_presentacion, '2026-10-12')
  assert.equal(m.f29_oficial.monto_total, 200000)
  assert.equal(m.f29_oficial.monto_concepto, 'total_a_pagar_091')
  assert.equal(m.f29_oficial.conciliable, true)
  // F29 estimado = IVA 190.000 + PPM 10.000 = 200.000 → diferencia 0.
  assert.equal(m.f29_diferencia, 0)
  assert.equal(inf.declaraciones.f29.estado, 'disponible')
  assert.equal(inf.declaraciones.f29.declaradas, 1)
})

// ST-02: el «Monto» de la Consulta Integral no identifica la casilla (091).
// Compararlo con la estimación del RCV fabricaba diferencias y exposición.
test('T8b: monto del F29 sin casilla identificada no genera diferencia ni exposición', () => {
  const eid = empresa({ rut: '76123456-7', tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'SC-1' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '76123456-7', 'F29', '202609', 'declarada', '999', '2026-10-12', 300000, ?)
  `).run(eid, JSON.stringify({ monto_concepto: 'no_identificado', origen: 'sifmConsultaInternet (Consulta Integral F29)' }))

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const m = inf.mensuales.find((x) => x.periodo === '202609')
  // El monto se INFORMA (es lo que dice el SII), pero no se compara.
  assert.equal(m.f29_oficial.monto_total, 300000)
  assert.equal(m.f29_oficial.monto_concepto, 'no_identificado')
  assert.equal(m.f29_oficial.conciliable, false)
  assert.equal(m.f29_diferencia, null)
  assert.equal(inf.opinion.exposicion.por_naturaleza.diferencia_por_investigar, 0)
  assert.ok(inf.opinion.limitaciones.some((l) => /casilla 091/.test(l)), 'la limitación explica por qué no se concilia')
})

test('T9: F29 pendiente según el SII ⇒ REQUIERE_REVISION', () => {
  const eid = empresa({ rut: '76098765-4' })
  doc(eid, { periodo: '202608', tipo: 33, neto: 500000, iva: 95000, folio: 'P-1' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, datos_json)
    VALUES (?, '76098765-4', 'F29', '202608', 'pendiente', '{}')
  `).run(eid)
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(inf.opinion.nivel, 'REQUIERE_REVISION')
  const h = inf.opinion.hallazgos.find((x) => x.codigo === 'F29_PENDIENTE')
  assert.ok(h && h.severidad === 'alta')
  assert.ok(/agosto 2026/i.test(h.detalle))
})

test('T10: la ventana admite 5 años (60 meses) y las anuales traen F22/BHE', () => {
  const eid = empresa({ rut: '76111222-3' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, datos_json)
    VALUES (?, '76111222-3', 'F22', '2025', 'declarada', '{}')
  `).run(eid)
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, datos_json)
    VALUES (?, '76111222-3', 'BHE', '2025', 'declarada', ?)
  `).run(eid, JSON.stringify({
    emitidas: { meses: [], totales: { honorario_bruto: 3000000, retencion_terceros: 300000 } },
    recibidas: { meses: [], totales: { honorario_bruto: 500000 } },
  }))
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 60, ficha: FICHA_COMPLETA })
  assert.equal(inf.mensuales.length, 60)
  assert.equal(inf.cobertura.desde, '202111')
  assert.equal(inf.f29_historial.desde, '202111')
  assert.equal(inf.f29_historial.hasta, '202610')
  assert.equal(inf.declaraciones_anuales.desde, 2022, 'F22, DJ y BHE cubren cinco años tributarios incluido 2026')
  const anio = inf.declaraciones_anuales.anios.find((a) => a.anio === '2025')
  assert.equal(anio.f22.estado, 'declarada')
  assert.equal(anio.f22.monto_total, null, 'no se rotula remanente/giro como total a pagar del F22')
  assert.equal(anio.boletas_honorarios.emitidas.totales.honorario_bruto, 3000000)
  assert.equal(inf.declaraciones_anuales.totales_boletas.recibidas, 500000)
})

// T11: el resumen que alimenta el KPI del panel y el pill del menú es el MISMO
// informe (no una segunda opinión) y se cachea hasta que algo lo invalide.
test('T11: resumen del panel = informe, con caché y invalidación', () => {
  const eid = empresa({ rut: '76222333-4' })
  doc(eid, { periodo: '202610', tipo: 33, neto: 100000, iva: 19000, folio: 'RES-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })

  const r1 = salud.resumenInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(r1.cache, false)
  assert.equal(r1.nivel, inf.opinion.nivel)
  assert.equal(r1.score, inf.opinion.score)
  assert.equal(r1.titulo, inf.opinion.titulo)
  assert.equal(r1.hallazgos, inf.opinion.hallazgos.length)
  assert.equal(r1.hallazgos_altos, inf.opinion.hallazgos.filter((h) => h.severidad === 'alta').length)
  assert.equal(r1.cobertura.con_datos, inf.cobertura.con_datos)
  assert.equal(r1.f29_oficial, false)
  assert.equal(r1.ficha, true)

  // Segunda lectura dentro de la ventana: mismo valor, sin recalcular.
  const r2 = salud.resumenInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(r2.cache, true)
  assert.equal(r2.score, r1.score)

  // Una sincronización invalida: vuelve a calcular con lo nuevo.
  salud.olvidarResumen(eid)
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, monto_total, datos_json)
    VALUES (?, '76222333-4', 'F29', '202610', 'declarada', '999', 1000, '{}')
  `).run(eid)
  const r3 = salud.resumenInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(r3.cache, false)
  assert.equal(r3.f29_oficial, true, 'tras consultar el F29 el resumen debe reflejarlo')
})

// T12: FICHA AUTOMÁTICA. Reglas: falta → se descarga; vigente → no se toca (no
// se gasta otra sesión SII); vencida → se refresca; error del SII → se reporta
// y NUNCA se propaga (la corrida que sí trajo documentos no puede caerse por
// la ficha). `consultar` se inyecta: estos tests no tocan la red.
test('T12: ficha automática — ausente, vigente, vencida y error', async () => {
  const rut = '76999000-1'
  const eid = empresa({ rut })
  const archivo = path.join(process.cwd(), 'data', 'sii-fichas', `${rut}.json`)
  const limpiar = () => { try { fs.rmSync(archivo, { force: true }) } catch { /* nada */ } }
  limpiar()

  let llamadas = 0
  const ok = async () => { llamadas++; return { datos: { regimen: 'Pro Pyme General (14 D)' } } }

  // 1) Sin ficha → descarga.
  const r1 = await empresasSii.asegurarFicha(db, { empresaId: eid, consultar: ok })
  assert.equal(r1.actualizada, true)
  assert.equal(r1.motivo, 'ausente')
  assert.equal(llamadas, 1)

  // Se materializa la ficha en disco para simular la descarga real.
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(archivo, JSON.stringify({ contribuyente: { rut } }))

  // 2) Ficha vigente (recién escrita) → NO se consulta el SII.
  const noLlamar = async () => { llamadas++; throw new Error('no debía llamarse') }
  const r2 = await empresasSii.asegurarFicha(db, { empresaId: eid, consultar: noLlamar })
  assert.equal(r2.actualizada, false)
  assert.equal(r2.motivo, 'vigente')
  assert.equal(llamadas, 1, 'una ficha vigente no gasta otra sesión en el SII')

  // 3) Ficha vencida (>7 días) → se refresca.
  const viejo = new Date(Date.now() - 30 * 86400000)
  fs.utimesSync(archivo, viejo, viejo)
  const r3 = await empresasSii.asegurarFicha(db, { empresaId: eid, consultar: ok })
  assert.equal(r3.actualizada, true)
  assert.equal(r3.motivo, 'vencida')
  assert.equal(r3.edad_dias, 30)
  assert.equal(r3.regimen, 'Pro Pyme General (14 D)')

  // 4) El SII falla → motivo 'error' con el mensaje, sin lanzar.
  limpiar()
  const falla = async () => { const e = new Error('Red SII inaccesible (ENOTFOUND)'); e.codigo = 'SII_SIN_NAVEGADOR'; throw e }
  const r4 = await empresasSii.asegurarFicha(db, { empresaId: eid, consultar: falla })
  assert.equal(r4.actualizada, false)
  assert.equal(r4.motivo, 'error')
  assert.equal(r4.codigo, 'SII_SIN_NAVEGADOR')
  assert.match(r4.error, /inaccesible/)

  limpiar()
})

// T17 (ST-01): el crédito fiscal que excede al débito NO se pierde. Antes,
// cada mes se calculaba aislado: julio dejaba −190.000 y agosto se declaraba
// como si ese crédito no existiera, sobrestimando el F29 estimado.
test('T17: el remanente de crédito fiscal se arrastra entre meses', () => {
  const eid = empresa({ rut: '76555004-5', tasa: 0.01 })
  // Julio: crédito 380.000 > débito 190.000 ⇒ remanente 190.000.
  doc(eid, { periodo: '202607', tipo: 33, neto: 1000000, iva: 190000, folio: 'CFT-V1' })
  doc(eid, { periodo: '202607', flujo: 'compra', tipo: 33, neto: 2000000, iva: 380000, folio: 'CFT-C1' })
  // Agosto: débito 190.000 cubierto por el remanente ⇒ IVA a pagar 0.
  doc(eid, { periodo: '202608', tipo: 33, neto: 1000000, iva: 190000, folio: 'CFT-V2' })
  // Septiembre: ya no hay remanente ⇒ IVA a pagar 190.000.
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'CFT-V3' })

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const mes = (p) => inf.mensuales.find((m) => m.periodo === p)
  const jul = mes('202607')
  const ago = mes('202608')
  const sep = mes('202609')

  // Julio: el neto sigue siendo negativo (diagnóstico) y el crédito queda como CFT.
  assert.equal(jul.iva_estimado, -190000)
  assert.equal(jul.remanente_anterior, 0)
  assert.equal(jul.remanente_siguiente, 190000)
  assert.equal(jul.iva_a_pagar, 0)
  assert.equal(jul.f29_estimado, 10000, 'sin IVA a pagar solo queda el PPM')

  // Agosto: consume el remanente completo; no se paga IVA.
  assert.equal(ago.remanente_anterior, 190000)
  assert.equal(ago.remanente_origen, 'estimado_propio')
  assert.equal(ago.iva_a_pagar, 0)
  assert.equal(ago.remanente_siguiente, 0)
  assert.equal(ago.f29_estimado, 10000)

  // Septiembre: sin remanente, vuelve a pagarse el IVA completo.
  assert.equal(sep.remanente_anterior, 0)
  assert.equal(sep.iva_a_pagar, 190000)
  assert.equal(sep.f29_estimado, 200000)

  // Total de la ventana: 10.000 + 10.000 + 200.000. Sin arrastre habría sido
  // 10.000 + 200.000 + 200.000 = 410.000 (190.000 de crédito perdido).
  const totalEstimado = inf.mensuales.reduce((s, m) => s + (m.f29_estimado || 0), 0)
  assert.equal(totalEstimado, 220000)
})

// T17b: si el F29 declarado trae la casilla 504, esa cifra oficial manda sobre
// el arrastre calculado con el RCV.
test('T17b: la casilla 504 del F29 declarado fija el remanente anterior', () => {
  const rut = '76555005-6'
  const eid = empresa({ rut, tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'CFT-504' })
  db.prepare(`
    INSERT INTO f29_formularios (empresa_id, rut, periodo, folio, estado, indicadores_json, casillas_json, verificaciones_json)
    VALUES (?, ?, '202609', '504-1', 'declarada', ?, '[]', '[]')
  `).run(eid, rut, JSON.stringify({ remanente_credito_anterior: 50000, total_a_pagar: 140000 }))

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const m = inf.mensuales.find((x) => x.periodo === '202609')
  assert.equal(m.remanente_anterior, 50000)
  assert.equal(m.remanente_origen, 'casilla_504')
  assert.equal(m.iva_a_pagar, 140000)
  assert.equal(m.f29_estimado, 150000)
})

// T16 (ST-06): las compras del RCV no son costo de ventas; el ratio no es un
// margen y, cuando no puede serlo (|%| > 100), se declara no evaluable.
test('T16: ventas − compras del RCV no se publica como margen cuando no lo es', () => {
  const eid = empresa({ rut: '76555003-4', tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 100000, iva: 19000, folio: 'MG-V' })
  doc(eid, { periodo: '202609', flujo: 'compra', tipo: 33, neto: 60000, iva: 11400, folio: 'MG-C1' })
  const ok = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(ok.kpis.margen_bruto_evaluable, true)
  assert.equal(ok.kpis.margen_bruto_pct, 40)

  // Compras desproporcionadas (bienes de capital, documentos de otro giro):
  // el ratio daría −800% y eso no es un margen.
  doc(eid, { periodo: '202609', flujo: 'compra', tipo: 33, neto: 840000, iva: 159600, folio: 'MG-C2' })
  const raro = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(raro.kpis.margen_bruto_evaluable, false)
  assert.equal(raro.kpis.margen_bruto_pct, null)
})

// T14 (ST-05): «riesgos» es la única dimensión que siempre puede puntuarse (los
// hallazgos existen). Por sí sola NO mide salud tributaria: con la ficha y nada
// más, el índice sería el puntaje de riesgos sin una sola fuente de datos.
test('T14: con ficha y sin RCV ni declaraciones el índice no es evaluable', () => {
  const eid = empresa({ rut: '76555001-2' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const op = inf.opinion
  assert.deepEqual(
    op.dimensiones.filter((d) => d.estado === 'evaluable').map((d) => d.clave),
    ['riesgos'],
    'sin RCV ni declaraciones la única dimensión con evidencia es riesgos',
  )
  assert.equal(op.indice_evaluable, false)
  assert.equal(op.clasificacion.clave, 'NO_EVALUABLE')
  assert.ok(/no basta/.test(op.resumen), 'el resumen explica que la ficha no basta')
})

// T15 (ST-04): la diferencia estimado − declarado tiene signo. Solo declarar de
// MENOS es dinero en riesgo; declarar de MÁS se informa y NO suma a la exposición.
test('T15: la sobre-declaración no suma a la exposición', () => {
  const rut = '76555002-3'
  const eid = empresa({ rut, tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'OV-1' })
  const guardarForm = (total) => {
    db.prepare(`
      INSERT INTO f29_formularios (empresa_id, rut, periodo, folio, estado, indicadores_json, casillas_json, verificaciones_json)
      VALUES (?, ?, '202609', 'OV-1', 'declarada', ?, '[]', '[]')
      ON CONFLICT(empresa_id, periodo) DO UPDATE SET indicadores_json = excluded.indicadores_json
    `).run(eid, rut, JSON.stringify({ total_a_pagar: total }))
  }
  const informe = () => salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })

  // Estimado 200.000 (IVA 190.000 + PPM 10.000) · declarado 300.000 ⇒ −100.000.
  guardarForm(300000)
  const sobre = informe()
  const m = sobre.mensuales.find((x) => x.periodo === '202609')
  assert.equal(m.f29_diferencia, -100000)
  assert.equal(sobre.opinion.exposicion.por_naturaleza.diferencia_por_investigar, 0)
  assert.equal(sobre.opinion.exposicion.por_naturaleza.sobre_declaracion, 100000)
  assert.equal(sobre.opinion.exposicion.total, 0, 'haber pagado de más no es exposición')
  assert.equal(sobre.opinion.matriz_riesgos.find((r) => r.codigo === 'F29_DIFERENCIA').cuenta_exposicion, false)

  // Declarado 150.000 ⇒ +50.000: subdeclaración, esta sí es exposición.
  guardarForm(150000)
  const sub = informe()
  assert.equal(sub.opinion.exposicion.por_naturaleza.diferencia_por_investigar, 50000)
  assert.equal(sub.opinion.exposicion.por_naturaleza.sobre_declaracion, 0)
  assert.equal(sub.opinion.exposicion.total, 50000)
})

// T13 (ST-03): índice, cobertura del ÍNDICE y cobertura de FUENTES son tres
// indicadores distintos. Antes, «cobertura» era el peso de las dimensiones con
// evidencia (100% con ficha + RCV) y de ahí salía una confianza ALTA aunque la
// TGR, el F22, las DJ y las boletas de honorarios nunca se hubieran consultado.
test('T13: cobertura de fuentes y confianza son independientes del índice', () => {
  const rut = '76444555-6'
  const eid = empresa({ rut })
  const periodos = salud.ultimosPeriodos(12, '202610')
  // RCV + F29 oficial + Formulario Compacto de los 12 meses: las cinco
  // dimensiones del índice quedan evaluables. La TGR, el F22, las DJ y las
  // boletas de honorarios, en cambio, NO se consultaron.
  periodos.forEach((p, i) => {
    doc(eid, { periodo: p, tipo: 33, neto: 1000000 + i, iva: 190000, folio: `ST3-${p}` })
    db.prepare(`
      INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
      VALUES (?, ?, 'F29', ?, 'declarada', ?, '2026-10-12', 200000, '{}')
    `).run(eid, rut, p, `FO-${p}`)
    db.prepare(`
      INSERT INTO f29_formularios (empresa_id, rut, periodo, folio, estado, indicadores_json, casillas_json, verificaciones_json)
      VALUES (?, ?, ?, ?, 'declarada', ?, '[]', ?)
    `).run(
      eid, rut, p, `FO-${p}`,
      JSON.stringify({ total_a_pagar: 200000, iva_determinado: 190000, base_imponible: 1000000 }),
      JSON.stringify([{ ok: true, nombre: 'total' }]),
    )
  })

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const op = inf.opinion

  // El índice se evalúa completo: las cinco dimensiones tienen evidencia.
  assert.equal(op.indice_evaluable, true)
  assert.equal(op.cobertura_diagnostico, 100)
  assert.ok(op.score >= 90)

  // Pero de las nueve fuentes del diagnóstico solo se consultaron cuatro.
  assert.equal(op.cobertura_fuentes.requeridas, 9)
  assert.equal(op.cobertura_fuentes.consultadas, 4)
  assert.equal(op.cobertura_fuentes.pct, 44)
  assert.deepEqual(
    op.cobertura_fuentes.por_fuente.filter((x) => x.estado === 'consultada').map((x) => x.clave).sort(),
    ['f29_compacto', 'f29_consulta_integral', 'ficha_sii', 'rcv'],
  )
  assert.ok(op.cobertura_fuentes.faltantes.includes('Deuda fiscal (TGR)'))
  assert.ok(op.cobertura_fuentes.faltantes.includes('Renta (F22)'))

  // Con 44% de fuentes la confianza no puede ser alta, aunque la cobertura del
  // índice sea 100%: ese era exactamente el error que ST-03 corrige. Además el
  // motivo se imprime (no queda un nivel huérfano).
  assert.equal(op.nivel_confianza, 'BAJA')
  assert.ok(op.confianza_motivos.some((m) => /Cobertura de fuentes 44%/.test(m)))
  assert.ok(op.confianza_motivos.some((m) => /Fuentes no consultadas/.test(m)))

  // Al consultar F22, DJ y BHE sube la cobertura de FUENTES… y el índice no se
  // mueve: medir fuentes no es medir salud tributaria.
  for (const tipo of ['F22', 'BHE', 'DJ']) {
    db.prepare(`
      INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, datos_json)
      VALUES (?, ?, ?, '2025', 'declarada', '{}')
    `).run(eid, rut, tipo)
  }
  const inf2 = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  assert.equal(inf2.opinion.cobertura_fuentes.consultadas, 7)
  assert.equal(inf2.opinion.cobertura_fuentes.pct, 78)
  assert.equal(inf2.opinion.nivel_confianza, 'MEDIA', 'sin la TGR consultada no hay confianza alta')
  assert.equal(inf2.opinion.score, op.score, 'consultar fuentes anuales no cambia el índice de salud tributaria')
})

// T18: el historial completo del F29 (los 5 años consultados) queda accesible
// como tabla consultable: folio, fecha de presentación, monto declarado,
// origen (Consulta Integral / Compacto), enlace al PDF y resumen de casillas
// del compacto. Orden del más reciente al más antiguo.
test('T18: historial F29 consultable — folio, fecha, monto, resumen y orden', () => {
  const eid = empresa({ rut: '76333444-5', tasa: 0.01 })
  // Consulta Integral: folio + fecha + monto SIN casilla identificada.
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '76333444-5', 'F29', '202607', 'declarada', '111222333', '2026-05-20', 320000, ?)
  `).run(eid, JSON.stringify({ monto_concepto: 'no_identificado' }))
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '76333444-5', 'F29', '202606', 'declarada', '444555666', '2026-04-19', 200000, '{}')
  `).run(eid)
  // Formulario Compacto del mismo período: casillas leídas + enlace al PDF.
  db.prepare(`
    INSERT INTO f29_formularios (empresa_id, rut, periodo, folio, estado, indicadores_json, casillas_json, verificaciones_json, url)
    VALUES (?, '76333444-5', '202606', '444555666', 'declarada', ?, '[]', '[]', 'https://www4.sii.cl/e-book/f29?folio=444555666')
  `).run(eid, JSON.stringify({ total_a_pagar: 210000, iva_determinado: 195000, ppm_neto: 8000, base_imponible: 1026315, remanente_credito_fiscal: 0 }))

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const hist = inf.f29_historial
  assert.equal(hist.estado, 'disponible')
  assert.ok(hist.rango && /202606/.test(hist.rango))
  // Orden: más reciente primero.
  assert.equal(hist.periodos[0].periodo, '202607')
  const julio = hist.periodos[0]
  assert.equal(julio.folio, '111222333')
  assert.equal(julio.fecha_presentacion, '2026-05-20')
  assert.equal(julio.monto_total, 320000)
  assert.equal(julio.monto_concepto, 'no_identificado')
  assert.equal(julio.origen, 'consulta_integral')
  // El PDF del compacto queda disponible aunque la fila venga de la Consulta
  // Integral: un solo lugar para abrir el formulario original.
  const junio = hist.periodos[1]
  assert.ok(/folio=444555666/.test(junio.url))
  assert.equal(junio.folio, '444555666')
  assert.equal(junio.resumen.total_a_pagar, 210000)
  assert.equal(junio.resumen.iva_determinado, 195000)
  assert.equal(junio.resumen.ppm_neto, 8000)
})

test('T7: el snapshot guarda la opinión como evidencia inmutable', () => {
  const eid = empresa({ rut: '77468067-5' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const id = salud.guardarSnapshot(db, { empresaId: eid, periodo: '202610', usuarioId: null, informe: inf })
  assert.ok(id > 0)
  const snap = salud.ultimoSnapshot(db, eid, '202610')
  assert.equal(snap.opinion_nivel, inf.opinion.nivel)
  assert.equal(snap.score, inf.opinion.score)
})
