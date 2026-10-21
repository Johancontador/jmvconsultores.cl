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

test('T8: F29 oficial se mezcla con la estimación y calcula diferencia', () => {
  const eid = empresa({ rut: '76012345-6', tasa: 0.01 })
  doc(eid, { periodo: '202609', tipo: 33, neto: 1000000, iva: 190000, folio: 'F29-1' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '76012345-6', 'F29', '202609', 'declarada', '123456789', '2026-10-12', 200000, '{}')
  `).run(eid)
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12, ficha: FICHA_COMPLETA })
  const m = inf.mensuales.find((x) => x.periodo === '202609')
  assert.equal(m.f29_estado, 'declarada')
  assert.equal(m.f29_oficial.folio, '123456789')
  assert.equal(m.f29_oficial.fecha_presentacion, '2026-10-12')
  assert.equal(m.f29_oficial.monto_total, 200000)
  // F29 estimado = IVA 190.000 + PPM 10.000 = 200.000 → diferencia 0.
  assert.equal(m.f29_diferencia, 0)
  assert.equal(inf.declaraciones.f29.estado, 'disponible')
  assert.equal(inf.declaraciones.f29.declaradas, 1)
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
  const anio = inf.declaraciones_anuales.anios.find((a) => a.anio === '2025')
  assert.equal(anio.f22.estado, 'declarada')
  assert.equal(anio.boletas_honorarios.emitidas.totales.honorario_bruto, 3000000)
  assert.equal(inf.declaraciones_anuales.totales_boletas.recibidas, 500000)
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
