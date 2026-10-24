'use strict'
/**
 * F0.3 · LÍNEA BASE DE SALUD TRIBUTARIA — taxonomía de estados y fixtures.
 *
 * El handoff (§4.5, doc 12) encontró tres problemas de lectura, no de cálculo:
 *   1. Un cero confirmado y un dato no consultado se veían igual («No
 *      evaluable»), así que una exposición real de $0 parecía información
 *      faltante y una fuente sin consultar parecía una ausencia de datos.
 *   2. Un fallo de red se mostraba como si fuera un hallazgo tributario.
 *   3. Cada pantalla usaba su propio vocabulario para decir «no hay dato».
 *
 * Este archivo fija el significado (E1), el mensaje (E2), la regla cero ≠
 * desconocido (E3), la vigencia de un dato antiguo (E4), la clasificación de
 * fallos (E5) y la traducción de los códigos que YA emite el motor (E6), para
 * que la vista y el informe imprimible no puedan divergir.
 *
 * Fixtures: test/fixtures/salud-estados.js (reloj congelado, datos inventados).
 * Ejecutar: node --test test/salud-estados.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const Estados = require('../frontend/shared/estados-salud')
const { AHORA, CASOS_ESTADO, CASOS_VALOR, CASOS_VIGENCIA, CASOS_FALLO } = require('./fixtures/salud-estados')

/* ---------- E1: los 9 estados existen y significan lo mismo ---------- */

test('E1: los 9 estados del handoff existen con etiqueta, condición y severidad válida', () => {
  assert.deepStrictEqual(Estados.ORDEN.slice().sort(), CASOS_ESTADO.map((c) => c.clave).sort())
  const SEVERIDADES = new Set(['ok', 'atencion', 'riesgo', 'info'])
  for (const caso of CASOS_ESTADO) {
    const e = Estados.estado(caso.clave)
    assert.ok(e, `estado ${caso.clave} definido`)
    assert.strictEqual(e.clave, caso.clave)
    assert.ok(e.etiqueta && e.etiqueta.length > 3, `${caso.clave}: etiqueta visible`)
    assert.ok(e.cuando && e.cuando.length > 10, `${caso.clave}: condición de activación documentada`)
    assert.ok(SEVERIDADES.has(e.severidad), `${caso.clave}: severidad '${e.severidad}' no permitida`)
    assert.strictEqual(e.severidad, caso.severidad, `${caso.clave}: severidad`)
    // Lo que es materia tributaria y lo que es condición del sistema se separa
    // explícitamente: un error técnico NO puede teñir el índice.
    assert.strictEqual(e.es_hallazgo, caso.es_hallazgo, `${caso.clave}: es_hallazgo`)
    assert.strictEqual(e.requiere_accion, caso.requiere_accion, `${caso.clave}: requiere_accion`)
    assert.ok(typeof e.reintentable === 'boolean', `${caso.clave}: reintentable`)
  }
  // Una clave desconocida no se inventa un estado.
  assert.strictEqual(Estados.estado('inventado'), null)
})

/* ---------- E2: mensajes profesionales ---------- */

test('E2: cada estado explica qué ocurrió, qué sigue disponible y qué hacer (sin mensajes genéricos)', () => {
  for (const clave of Estados.ORDEN) {
    const msg = Estados.mensaje(clave, { fuente: 'el RCV del SII', periodo: '202609' })
    assert.ok(msg.includes('el RCV del SII'), `${clave}: nombra la fuente`)
    assert.ok(msg.includes('202609'), `${clave}: nombra el período`)
    assert.ok(msg.length > 60, `${clave}: el mensaje explica el contexto, no solo que falló`)
    assert.ok(!/^no se pudo obtener informaci[oó]n\.?$/i.test(msg.trim()), `${clave}: mensaje genérico prohibido`)
    // Todo estado que representa AUSENCIA de información aclara que esa
    // ausencia no es un incumplimiento del contribuyente.
    if (['pendiente', 'fuente_no_disponible', 'error_tecnico', 'fuente_no_habilitada', 'no_concluyente'].includes(clave)) {
      assert.ok(/no (es|constituye|está|se computa)/i.test(msg), `${clave}: aclara que no es un incumplimiento`)
    }
  }
  // Los técnicos ofrecen reintento; los de configuración no (reintentar no sirve).
  assert.match(Estados.mensaje('fuente_no_disponible'), /reintentar/i)
  assert.doesNotMatch(Estados.mensaje('fuente_no_habilitada'), /reintentar/i)
  // Una clave inválida no rompe la pantalla: cae en error técnico.
  assert.strictEqual(Estados.mensaje('clave-rota', {}), Estados.mensaje('error_tecnico', {}))
})

/* ---------- E3: cero confirmado ≠ dato desconocido ---------- */

test('E3: un $0 solo es un dato cuando la fuente fue consultada (fixtures de valor)', () => {
  for (const caso of CASOS_VALOR) {
    const [valor, opciones] = caso.entrada
    assert.deepStrictEqual(Estados.valorDeclarado(valor, opciones), caso.esperado, caso.nombre)
  }
  // El caso que motivó el hallazgo: exposición 0 con fuente consultada.
  assert.strictEqual(Estados.valorDeclarado(0, { consultado: true }).estado, 'verificado')
  // Y el mismo 0 sin consulta no es evidencia de nada.
  assert.strictEqual(Estados.valorDeclarado(0, { consultado: false }).estado, 'pendiente')
})

/* ---------- E4: información antigua ---------- */

test('E4: un dato antiguo se conserva como evidencia y se marca (no se borra ni se presenta como vigente)', () => {
  for (const caso of CASOS_VIGENCIA) {
    const [fecha] = caso.entrada
    const v = Estados.vigencia(fecha, { ahora: AHORA })
    assert.strictEqual(v.estado, caso.esperado.estado, caso.nombre)
    assert.strictEqual(v.dias, caso.esperado.dias, `${caso.nombre}: días`)
    assert.ok(v.nota && v.nota.length > 5, `${caso.nombre}: la nota explica el estado`)
  }
  // El umbral es el de un mes tributario + cierre: hasta 45 días es vigente,
  // desde 46 se marca como antiguo (se conserva: es evidencia).
  assert.strictEqual(Estados.vigencia('2026-09-08T12:00:00Z', { ahora: AHORA }).estado, 'verificado') // 45 días
  assert.strictEqual(Estados.vigencia('2026-09-07T12:00:00Z', { ahora: AHORA }).estado, 'con_observaciones') // 46 días
})

/* ---------- E5: fallos externos ---------- */

test('E5: proveedor caído, defecto propio y fuente no habilitada son estados distintos', () => {
  for (const caso of CASOS_FALLO) {
    assert.strictEqual(Estados.clasificarFallo(caso.entrada).clave, caso.esperado, caso.nombre)
  }
  // Ningún fallo es un hallazgo tributario (regla del handoff §4.5).
  for (const clave of ['fuente_no_disponible', 'error_tecnico', 'fuente_no_habilitada']) {
    assert.strictEqual(Estados.estado(clave).es_hallazgo, false)
  }
})

/* ---------- E6: códigos del motor → taxonomía ---------- */

test('E6: los códigos del motor se traducen a la taxonomía y el informe sin antecedentes no puntúa', () => {
  // Contratos del motor (core/salud-tributaria): no se cambian, se traducen.
  const ESPERADO = {
    disponible: 'verificado',
    evaluable: 'verificado',
    parcial: 'con_observaciones',
    no_consultado: 'pendiente',
    sin_informacion: 'no_concluyente',
    no_evaluable: 'no_concluyente',
    error: 'error_tecnico',
  }
  for (const [codigo, clave] of Object.entries(ESPERADO)) {
    assert.strictEqual(Estados.desdeMotor(codigo).clave, clave, `motor '${codigo}'`)
  }
  // Todo código del mapa apunta a un estado real, y ningún estado queda sin uso.
  for (const clave of Object.values(Estados.MAPA_MOTOR)) {
    assert.ok(Estados.estado(clave), `el mapa apunta a '${clave}', que no existe`)
  }
  assert.deepStrictEqual([...new Set(Object.values(Estados.MAPA_MOTOR))].sort(), Estados.ORDEN.slice().sort())

  // Y contra el motor REAL con una empresa sin antecedentes.
  const dbFile = path.join(os.tmpdir(), `iva-mensual-estados-${Date.now()}-${process.pid}.db`)
  const anterior = process.env.DB_PATH
  process.env.DB_PATH = dbFile
  const db = require('../backend/db')
  const salud = require('../backend/core/salud-tributaria')
  try {
    const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES ('76000001-1', 'Empresa Sin Antecedentes', 'k', 0.01, 1)`).run()
    const eid = Number(info.lastInsertRowid)
    const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })

    assert.strictEqual(inf.opinion.indice_evaluable, false, 'sin evidencia no hay índice')
    assert.strictEqual(inf.opinion.nivel, 'SIN_INFORMACION')
    // Cada dimensión declara evaluable/no_evaluable; ninguna se puntúa con 0
    // por falta de datos.
    for (const d of inf.opinion.dimensiones) {
      assert.ok(['evaluable', 'no_evaluable'].includes(d.estado), `dimensión ${d.clave}: estado '${d.estado}'`)
      if (d.estado === 'no_evaluable') assert.strictEqual(d.puntaje, null, `dimensión ${d.clave}: no_evaluable no lleva puntaje`)
      assert.ok(Estados.desdeMotor(d.estado), `dimensión ${d.clave}: traducible`)
    }
    // Las declaraciones que no se consultaron son «pendiente», no «sin datos».
    for (const clave of ['f29', 'renta_f22', 'juradas', 'boletas_honorarios']) {
      const d = inf.declaraciones[clave]
      assert.ok(Estados.desdeMotor(d.estado), `${clave}: estado '${d.estado}' traducible`)
      assert.strictEqual(Estados.desdeMotor(d.estado).clave, 'pendiente', `${clave}: sin consulta = pendiente`)
    }
    // La exposición 0 acá NO es un cero confirmado: no se consultó nada.
    assert.strictEqual(inf.opinion.exposicion.total, 0)
    assert.strictEqual(Estados.valorDeclarado(inf.opinion.exposicion.total, { consultado: inf.opinion.cobertura_diagnostico > 0 }).estado, 'pendiente')
  } finally {
    try { db.close() } catch { /* ya cerrada */ }
    for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
    if (anterior === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = anterior
  }
})
