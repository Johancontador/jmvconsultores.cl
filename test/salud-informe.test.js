'use strict'
/**
 * SALUD TRIBUTARIA v2 — tests de la reunión de antecedentes y del informe
 * imprimible.
 *
 * Lo que se prueba:
 *  S1  La reunión corre los siete pasos y termina en «completado».
 *  S2  Un paso que falla NO tira el resto: queda «completado_con_errores» y el
 *      informe se emite igual (un paso que falla no borra lo que otro trajo).
 *  S3  El estado de un job es privado del usuario que lo lanzó.
 *  S4  El RCV no se vuelve a bajar para períodos que ya tienen documentos.
 *  S5  El informe imprimible tiene los 8 capítulos, la marca, la opinión y no
 *      contiene «undefined», «NaN» ni «[object Object]».
 *  S6  Los gráficos del panel y del PDF son la MISMA fuente (una sola verdad).
 *  S7  Sin antecedentes el informe NO inventa: declara «no evaluable».
 *  S8  La matriz de riesgos cabe en A4 (anchos fijos que suman 100%).
 *  S9  Las boletas de honorarios (objeto anidado) se imprimen como datos.
 *  S10 Los montos en millones no se dividen dos veces (miles de millones).
 *  S11 El informe cabe en A4: ninguna tabla desborda la caja imprimible.
 *  S12 La diferencia del detalle mensual es la MISMA del capítulo 1.
 *  S14 Los agregados mensuales del SII (boletas/comprobantes, rcv_agregados)
 *      suman a las ventas del informe y evitan el falso «diferencia de
 *      ventas de millones» en los meses que el SII no entrega doc a doc.
 *
 * BD temporal; sin red (todas las dependencias del SII se inyectan).
 * Ejecutar: node --test test/salud-informe.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-salud-inf-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const salud = require('../backend/core/salud-tributaria')
const saludSync = require('../backend/core/salud-sincronizacion')
const informeHtml = require('../backend/core/informe-salud-html')
const decl = require('../backend/core/declaraciones-sii')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

let nEmp = 0
function empresa({ rut = '76312274-3', tasa = 0.01 } = {}) {
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES (?, ?, 'k', ?, 1)`)
    .run(rut, `Empresa Informe ${++nEmp}`, tasa)
  return Number(info.lastInsertRowid)
}

/** Usuario real: el snapshot tiene clave foránea a users(id). */
function usuario(username) {
  const info = db.prepare(`INSERT INTO users (username, password_hash, is_admin, activo) VALUES (?, 'x', 0, 1)`)
    .run(username)
  return Number(info.lastInsertRowid)
}

function doc(empresaId, { periodo, flujo = 'venta', tipo = 33, neto = 1000, iva = 190, folio }) {
  db.prepare(`
    INSERT INTO documentos
      (empresa_id, tipo_flujo, tipo_doc, folio, rut_contraparte, monto_neto, monto_iva, monto_total, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, ?, ?, '11111111-1', ?, ?, ?, ?, ?)
  `).run(empresaId, flujo, tipo, String(folio || `${Date.now()}-${Math.random()}`), neto, iva, neto + iva, periodo, `${flujo}:${tipo}:${folio || Math.random()}`)
}

/**
 * Espera a que el job termine (los pasos corren en segundo plano).
 *
 * El presupuesto es 20 s y no 8: la reunión hace seis pasos reales y, como los
 * archivos de prueba corren EN PARALELO, la contención de CPU la llevaba a
 * ~6-8 s. Con 8 s el test fallaba por carga de la suite (no por el producto):
 * se midió 8,0 s en la corrida completa y 5,8 s en solitario. Sigue siendo un
 * timeout real —si el job no termina, el test falla—, solo deja de ser un
 * cronómetro ajustado al estado de carga de la máquina.
 */
async function esperarJob(jobId, usuarioId = null, ms = 20000) {
  const limite = Date.now() + ms
  while (Date.now() < limite) {
    const est = saludSync.obtenerEstado(jobId, usuarioId)
    if (est && est.estado !== 'en_curso') return est
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('El job no terminó dentro del tiempo esperado')
}

/** Dependencias del SII simuladas: la reunión completa, sin red. */
function depsFalsas(over = {}) {
  return {
    asegurarFicha: async () => ({ actualizada: true, motivo: 'ausente', regimen: 'Pro Pyme General (14 D)' }),
    consultarRCV: async () => [],
    // Agregados mensuales del SII: también se inyectan. Sin esto el paso RCV
    // caía en la dependencia REAL (`services/rcv`) y el job quedaba esperando
    // al portal del SII: el test decía «sin red» pero tocaba la red.
    consultarAgregadosVenta: async () => [],
    guardarAgregados: () => ({ guardados: 0 }),
    ingestarBatch: async () => ({ insertados: 0, duplicados: 0, errores: [] }),
    sincronizarDeclaraciones: async () => ({ resultado: { f29: { periodos: 12 } }, aviso: null }),
    sincronizarFormularios: async () => ({ periodos: 12, con_formulario: 3, errores: [] }),
    consultarRenta: async () => ({ anios: [{ anio: '2025', vigente: true, folio: 'F22-1' }], aviso: null }),
    guardarRenta: async () => 1,
    consultarDeudaTgr: async () => ({
      id: 1, estado: 'sin_deuda', total: 0, fecha_emision: '2026-10-22', pdf_ruta: 'data/certificados-tgr/demo.pdf',
    }),
    descifrarClave: async () => 'clave',
    ...over,
  }
}

test('S1: la reunión corre los seis pasos y termina en «completado»', async () => {
  const eid = empresa({ rut: '77000001-1' })
  const uid = usuario('reunion-1')
  const { jobId } = saludSync.iniciar(db, {
    empresaId: eid, usuarioId: uid, periodo: '202610', meses: 12, deps: depsFalsas(),
  })
  const est = await esperarJob(jobId, uid)
  assert.equal(est.estado, 'completado')
  assert.equal(est.pasos.length, 7)
  for (const p of est.pasos) {
    assert.equal(p.estado, 'ok', `el paso ${p.clave} debio quedar ok`)
  }
  assert.ok(est.resumen.formularios.con_formulario === 3)
  assert.ok(est.resumen.renta.anios === 1)
  assert.ok(est.resumen.informe.snapshot_id > 0, 'la reunión deja evidencia (snapshot)')
})

test('S2: un paso fallido no impide el resto y el informe se emite igual', async () => {
  const eid = empresa({ rut: '77000002-2' })
  const uid = usuario('reunion-2')
  const { jobId } = saludSync.iniciar(db, {
    empresaId: eid, usuarioId: uid, periodo: '202610', meses: 12,
    deps: depsFalsas({
      sincronizarFormularios: async () => { throw new Error('SII_SIN_NAVEGADOR: sin chromium') },
    }),
  })
  const est = await esperarJob(jobId, uid)
  assert.equal(est.estado, 'completado_con_errores')
  const fallido = est.pasos.find((p) => p.clave === 'formularios')
  assert.equal(fallido.estado, 'error')
  assert.match(fallido.error, /chromium/)
  // Los demás pasos siguen bien y el informe se reconstruyó igual.
  assert.equal(est.pasos.find((p) => p.clave === 'informe').estado, 'ok')
  assert.ok(est.resumen.informe.snapshot_id > 0)
  // Un fallo NO borra lo que otro paso trajo.
  assert.equal(est.pasos.find((p) => p.clave === 'renta').estado, 'ok')
})

test('S3: el estado del job es privado del usuario que lo lanzó', async () => {
  const eid = empresa({ rut: '77000003-3' })
  const uid = usuario('reunion-3')
  const { jobId } = saludSync.iniciar(db, {
    empresaId: eid, usuarioId: uid, periodo: '202610', meses: 12, deps: depsFalsas(),
  })
  await esperarJob(jobId, uid)
  assert.ok(saludSync.obtenerEstado(jobId, uid))
  assert.equal(saludSync.obtenerEstado(jobId, 999), null, 'otro usuario no puede ver el job')
  assert.equal(saludSync.obtenerEstado('sal_inexistente', uid), null)
})

test('S4: el RCV no se vuelve a bajar para períodos que ya tienen documentos', () => {
  const eid = empresa({ rut: '77000004-4' })
  doc(eid, { periodo: '202609', folio: 'YA-1' })
  doc(eid, { periodo: '202608', folio: 'YA-2' })
  const lista = saludSync.periodosParaRcV(db, eid, '202610', 4, 3)
  assert.ok(lista.includes('202610'), 'el período pedido siempre se sincroniza')
  assert.ok(!lista.includes('202609'), '202609 ya tiene documentos: no se vuelve a bajar')
  assert.ok(!lista.includes('202608'), '202608 ya tiene documentos: no se vuelve a bajar')
  assert.ok(lista.length <= 3, 'respeta el tope de períodos por corrida')
  // La lista va del más reciente al más antiguo.
  assert.deepEqual(saludSync.periodosRecientes('202601', 3), ['202601', '202512', '202511'])
})

test('S18: el historial completo del F29 se imprime en el capítulo 3', () => {
  const eid = empresa({ rut: '77000018-8' })
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '77000018-8', 'F29', '202607', 'declarada', '123654789', '2026-05-20', 320000, ?)
  `).run(eid, JSON.stringify({ monto_concepto: 'no_identificado' }))
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  assert.ok(html.includes('Historial completo de F29'), 'el PDF trae la sección del historial')
  const fechaEsperada = new Date('2026-05-20').toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
  assert.ok(html.includes('123654789'), 'el folio del SII aparece en el PDF')
  assert.ok(html.includes(fechaEsperada), 'la fecha de presentación aparece formateada')
  // Sin casilla identificada el monto va con la nota de «monto informado».
  assert.ok(html.includes('sin casilla identificada'))
  // Nada de valores rotos en la tabla horrible.
  for (const roto of ['undefined', 'NaN', '[object Object]']) {
    assert.ok(!html.includes(roto), `la salida contiene «${roto}»`)
  }
  // Sin consulta al SII la sección se declara como tal (nunca disco vacío).
  const inf2 = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  inf2.f29_historial = { estado: 'no_consultado', periodos: [] }
  const html2 = informeHtml.renderInformeHtml(inf2)
  assert.ok(/Historial F29 no consultado/.test(html2))
})

test('S5: el informe imprimible tiene los 8 capítulos, la marca y la opinión', () => {
  const eid = empresa({ rut: '77000005-5' })
  doc(eid, { periodo: '202610', neto: 1000000, iva: 190000, folio: 'INF-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  assert.ok(html.startsWith('<!DOCTYPE html>'))
  for (const cap of [
    'Resumen ejecutivo', 'Cumplimiento tributario y obligaciones',
    'Análisis del IVA y conciliaciones', 'Matriz de riesgos tributarios',
    'Tendencias y comportamiento tributario', 'Impacto financiero y proyecciones',
    'Plan de acción y regularización', 'Metodología, alcance y anexos',
  ]) {
    assert.ok(html.includes(cap), `falta el capítulo: ${cap}`)
  }
  assert.ok(html.includes('JMV'), 'la marca JMV aparece en la portada')
  assert.ok(html.includes('Tax Health Intelligence'))
  assert.ok(html.includes('Informe Ejecutivo de Salud Tributaria'))
  // La opinión profesional (lo que vende) está en el capítulo 1.
  assert.ok(html.includes('Resumen ejecutivo'))
  assert.ok(/no constituye certificación tributaria/i.test(html), 'el informe declara que no certifica')

  // Nada de valores rotos: «undefined», «NaN» o «[object Object]» en la salida.
  for (const roto of ['undefined', 'NaN', '[object Object]']) {
    assert.ok(!html.includes(roto), `la salida contiene «${roto}»`)
  }
})

test('S6: los gráficos del panel y del PDF son la MISMA fuente', () => {
  const eid = empresa({ rut: '77000006-6' })
  doc(eid, { periodo: '202610', neto: 500000, iva: 95000, folio: 'G-1' })
  doc(eid, { periodo: '202609', neto: 400000, iva: 76000, folio: 'G-2' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const gfx = informeHtml.graficosSvg(inf)
  const html = informeHtml.renderInformeHtml(inf)
  for (const k of ['iva', 'riesgos', 'calendario', 'exposicion', 'puente', 'indice', 'tendencia']) {
    assert.ok(gfx[k], `falta el gráfico ${k}`)
    assert.ok(gfx[k].includes('<svg'), `el gráfico ${k} no es SVG`)
    assert.ok(html.includes(gfx[k]), `el PDF no usa el mismo SVG del gráfico ${k}`)
  }
})

test('S7: sin antecedentes el informe declara «no evaluable» y no inventa un 0', () => {
  const eid = empresa({ rut: '77000007-7' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  assert.equal(inf.opinion.nivel, 'SIN_INFORMACION')
  assert.equal(inf.opinion.indice_evaluable, false)
  const html = informeHtml.renderInformeHtml(inf)
  assert.ok(html.includes('no evaluable'), 'el informe dice que el índice no es evaluable')
  assert.ok(!html.includes('undefined'))
})

test('S10: los miles de millones se imprimen como miles de millones', () => {
  const eid = empresa({ rut: '77000010-0' })
  doc(eid, { periodo: '202610', neto: 3000000000, iva: 570000000, folio: 'MM-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)
  // $3.000 millones, no $3 millones (dividir dos veces era un error de 1000×).
  assert.ok(html.includes('$3.000 MM'), 'el informe muestra 3.000 millones')
  assert.ok(!html.includes('>3 MM<'), 'el informe no muestra 3 millones por error')
})

test('S8: la matriz de riesgos cabe en A4 (anchos fijos que suman 100%)', () => {
  const eid = empresa({ rut: '77000008-8' })
  doc(eid, { periodo: '202610', neto: 1000000, iva: 190000, folio: 'RIES-1' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  // La tabla de riesgos declara anchos en porcentaje: si no los declarara, el
  // navegador los calcularía por contenido y la tabla se saldría del papel
  // (9 columnas no caben en los 182 mm útiles de A4).
  const tabla = html.match(/<table class="tabla tabla-riesgos">([\s\S]*?)<\/table>/)
  assert.ok(tabla, 'la matriz de riesgos usa la tabla con anchos fijos')
  const anchos = [...tabla[1].matchAll(/<th style="width:(\d+)%"/g)].map((m) => Number(m[1]))
  assert.ok(anchos.length >= 5, 'cada columna tiene su ancho declarado')
  assert.equal(anchos.reduce((a, b) => a + b, 0), 100, 'los anchos suman 100%')

  // El CSS que obliga a la tabla a respetarlos.
  assert.ok(/\.tabla-riesgos \{ table-layout: fixed/.test(html), 'la tabla tiene layout fijo')

  // Naturaleza, responsable y plazo van agrupados en «Triage»: el informe
  // lleva la misma información que el panel, no una versión recortada.
  assert.ok(html.includes('>Triage</th>'), 'existe la columna Triage')
  assert.ok(!/>Naturaleza<\/th>/.test(tabla[1]), 'Naturaleza ya no es columna propia')
  assert.ok(!/>Responsable<\/th>/.test(tabla[1]), 'Responsable ya no es columna propia')
  assert.ok(!/>Plazo<\/th>/.test(tabla[1]), 'Plazo ya no es columna propia')

  // Un monto enorme no se parte a media cifra: los cortes van tras el
  // separador de miles (wbr), que es un punto de corte válido.
  const conMonto = informeHtml.renderInformeHtml({
    ...inf,
    opinion: {
      ...inf.opinion,
      matriz_riesgos: [{
        codigo: 'X', titulo: 'Prueba', severidad: 'alta', materia: 'IVA', periodo: '202610',
        importe: 123456789012, naturaleza: 'n', responsable: 'Contador', plazo: '15 días',
        evidencia: 'x',
      }],
    },
  })
  assert.ok(conMonto.includes('$123.<wbr>456.<wbr>789.<wbr>012'), 'el monto se parte en los separadores de miles')
})

test('S9: las boletas de honorarios se imprimen como datos, no como «[object Object]»', () => {
  const eid = empresa({ rut: '77000009-9' })
  doc(eid, { periodo: '202610', neto: 1000000, iva: 190000, folio: 'BHE-1' })
  // Forma real que guarda el sincronizador: un objeto con `meses` y `totales`.
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '77000009-9', 'BHE', '2025', 'declarada', 'BHE-2025', '2026-04-30', 3000000, ?)
  `).run(eid, JSON.stringify({
    emitidas: {
      meses: [{ mes: 3, folio_inicial: 10, folio_final: 21, vigentes: 12, anuladas: 1, honorario_bruto: 3000000 }],
      totales: { vigentes: 12, anuladas: 1, honorario_bruto: 3000000, retencion_terceros: 300000, total_liquido: 2700000 },
    },
    recibidas: {
      meses: [],
      totales: { vigentes: 3, anuladas: 0, honorario_bruto: 450000 },
    },
    origen: 'loa.sii.cl TMBCOC_InformeAnualBhe(.Rec)',
  }))

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  assert.ok(!html.includes('[object Object]'), 'el informe no imprime el objeto crudo')
  assert.ok(!html.includes('undefined'), 'el informe no imprime «undefined»')
  // Emitidas: 12 boletas y $3 MM. Recibidas: 3 boletas y $450.000 (exacto
  // porque está bajo el millón: en millones se vería «$0,5 MM»).
  assert.ok(html.includes('12 bol. · $3 MM'), 'las boletas emitidas muestran conteo y monto')
  assert.ok(html.includes('3 bol. · $450.000'), 'las boletas recibidas muestran conteo y monto exacto')
  // El detalle queda disponible en el tooltip, no solo en la cifra.
  assert.ok(html.includes('12 boleta(s) vigentes'), 'el tooltip detalla el conteo de boletas')
})

test('S11: el informe cabe en A4 (ninguna tabla desborda la caja imprimible)', () => {
  const eid = empresa({ rut: '77000011-1' })
  doc(eid, { periodo: '202610', neto: 12000000, iva: 2280000, folio: 'A4-1' })
  doc(eid, { periodo: '202609', neto: 8000000, iva: 1520000, folio: 'A4-2' })
  // La tabla de declaraciones anuales solo existe si el SII entregó F22 o BHE.
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '77000011-1', 'BHE', '2025', 'declarada', 'BHE-A4', '2026-04-30', 3000000, ?)
  `).run(eid, JSON.stringify({
    emitidas: { meses: [{ mes: 3, vigentes: 12, honorario_bruto: 3000000 }], totales: { vigentes: 12, honorario_bruto: 3000000 } },
    recibidas: { meses: [], totales: { vigentes: 3, honorario_bruto: 450000 } },
  }))
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  // Las tablas de 6, 8 y 9 columnas declaran anchos en porcentaje: sin eso el
  // navegador las dimensiona por contenido y se salen del papel (la tabla
  // mensual se iba 34 px y el bloque de declaraciones 131 px).
  for (const clase of ['tabla-mensual', 'tabla-anuales', 'tabla-plan']) {
    const t = html.match(new RegExp('<table class="tabla ' + clase + '">([\\s\\S]*?)</table>'))
    assert.ok(t, `la tabla ${clase} está en el informe`)
    const anchos = [...t[1].matchAll(/<th style="width:(\d+)%"/g)].map((m) => Number(m[1]))
    assert.ok(anchos.length >= 5, `${clase}: cada columna declara su ancho`)
    assert.equal(anchos.reduce((a, b) => a + b, 0), 100, `${clase}: los anchos suman 100%`)
    assert.ok(html.includes(`.${clase}`), `${clase}: el CSS fija el ancho`)
  }
  assert.ok(/\.tabla-mensual \{ table-layout: fixed/.test(html), 'la tabla mensual tiene layout fijo')
  assert.ok(/\.tabla-anuales, \.tabla-plan \{ table-layout: fixed/.test(html), 'anuales y plan tienen layout fijo')

  // Las columnas de la grilla no pueden crecer por su contenido: sin
  // minmax(0, 1fr) el bloque de declaraciones se salía 131 px del papel.
  assert.ok(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/.test(html), 'las columnas de la grilla respetan el ancho disponible')
  assert.ok(!/grid-template-columns: 1fr 1fr/.test(html), 'no queda ninguna grilla con 1fr 1fr sin tope')

  // El bloque de declaraciones son fichas, no una tabla de 5 columnas.
  assert.ok(html.includes('decl-stats'), 'las declaraciones se muestran como fichas')
  assert.ok(!html.includes('<th>Consultadas</th>'), 'la tabla de 5 columnas que desbordaba ya no existe')
})

test('S12: la diferencia del detalle mensual es la misma del capítulo 1', () => {
  const eid = empresa({ rut: '77000012-2' })
  doc(eid, { periodo: '202610', neto: 1000000, iva: 190000, folio: 'DIF-1' })
  // El SII declaró 300.000 (casilla 091 del Formulario Compacto); el RCV
  // estima 200.000 (IVA 190.000 + PPM 10.000). El monto de la Consulta
  // Integral no basta para comparar: ST-02 exige casilla identificada.
  db.prepare(`
    INSERT INTO declaraciones_sii (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json)
    VALUES (?, '77000012-2', 'F29', '202610', 'declarada', 'F29-DIF', '2026-11-20', 300000, '{"monto_concepto":"no_identificado"}')
  `).run(eid)
  decl.guardarFormularioF29(db, {
    empresaId: eid,
    rut: '77000012-2',
    periodo: '202610',
    fila: { folio: 'F29-DIF', estado: 'Vigente' },
    estado: { situacion: 'DECLARACION VIGENTE I', monto_observado: 0, declaraciones_vigentes: 1, eventos: [] },
    compacto: {
      ok: true,
      folio: 'F29-DIF',
      casillas: [{ codigo: '091', monto: 300000 }],
      verificaciones: [],
      indicadores: { total_a_pagar: 300000 },
      url: null,
    },
  })

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)
  const m = inf.mensuales.find((x) => x.periodo === '202610')

  // La diferencia es estimado − declarado (−100.000), la convención del MANUAL.
  assert.equal(m.f29_diferencia, -100000)
  // Convención de montos negativos del sistema: «$-100.000» (signo dentro).
  assert.ok(html.includes('$-100.<wbr>000'), 'el detalle mensual muestra la diferencia con su signo')

  // La columna no puede quedar en «—» mientras el capítulo 1 reporta la
  // diferencia: antes usaba `comparacion.diferencia_total`, que solo existe
  // con Formulario Compacto (casi nunca hay) y además con el signo opuesto.
  const tabla = html.match(/<table class="tabla tabla-mensual">([\s\S]*?)<\/table>/)
  assert.ok(tabla, 'el detalle mensual está en el informe')
  assert.ok(/<td class="der [^"]*">\$-100\.<wbr>000<\/td>/.test(tabla[1]), 'la diferencia aparece en la tabla del detalle mensual')
  assert.ok(/Dif\. \(est\. − decl\.\)/.test(tabla[1]), 'la columna declara su convención de signo')

  // Las clases de color que se usan existen en el CSS (antes .neg/.pos no
  // existían: el color nunca se aplicaba).
  assert.ok(html.includes('.dif-alerta'), 'el CSS define la clase de la diferencia')
  assert.ok(html.includes('.dif-ok'), 'el CSS define la clase de la diferencia sin alerta')
  assert.ok(!/class="der neg"|class="der pos"/.test(html), 'no quedan clases de color inexistentes')
})

test('S16: los montos chicos no se redondean a cero ni a 0,1 MM', () => {
  // ST-07: antes, $63.892 se imprimía «$0,1 MM» (37% de error) y $30.000 «$0 MM».
  assert.equal(informeHtml.mm(30000), '$30 mil')
  assert.equal(informeHtml.mm(63892), '$63,89 mil')
  assert.equal(informeHtml.mm(999), '$999')
  assert.equal(informeHtml.mm(1454207), '$1,45 MM')
  assert.equal(informeHtml.mm(3000000000), '$3.000 MM')
  assert.equal(informeHtml.mm(null), '—')
})

test('S15: el ratio ventas − compras del RCV no se presenta como margen bruto', () => {
  const eid = empresa({ rut: '77000015-5' })
  doc(eid, { periodo: '202610', neto: 100000, iva: 19000, folio: 'MG-V' })
  doc(eid, { periodo: '202610', flujo: 'compra', neto: 900000, iva: 171000, folio: 'MG-C' })
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 12 })
  const html = informeHtml.renderInformeHtml(inf)

  // −800% no es un margen: el RCV de compras incluye bienes de capital y
  // compras que no son costo de ventas.
  assert.equal(inf.kpis.margen_bruto_evaluable, false)
  assert.equal(inf.kpis.margen_bruto_pct, null)
  assert.ok(html.includes('Ventas − compras RCV'), 'el KPI se rotula por lo que mide')
  assert.ok(!html.includes('Margen bruto'), 'no queda ningún rótulo «Margen bruto»')
  assert.ok(html.includes('No evaluable'), 'el KPI declara que no es evaluable')
})

test('S13: el F29 leído sólo como Formulario Compacto cuenta como consultado', () => {
  // Regresión: la sección «Estado de las declaraciones» y el historial de
  // cumplimiento se armaban SÓLO con `declaraciones_sii`. Las empresas
  // sincronizadas con el lector nuevo escriben en `f29_formularios`, así que
  // aparecían con «F29 — No consultado» mientras el mismo informe mostraba los
  // 12 meses conciliados y sus casillas.
  const eid = empresa('77999001-7')
  doc(eid, { periodo: '202509', neto: 1000000, iva: 190000, folio: 'CMP-1' })

  decl.guardarFormularioF29(db, {
    empresaId: eid,
    rut: '77999001-7',
    periodo: '202509',
    fila: { folio: '9001', estado: 'Vigente' },
    estado: { situacion: 'DECLARACION VIGENTE I', monto_observado: 0, declaraciones_vigentes: 1, eventos: [] },
    compacto: {
      ok: true,
      folio: '9001',
      casillas: [{ codigo: '563', monto: 1000000 }, { codigo: '89', monto: 190000 }],
      verificaciones: [{ codigo: 'IVA_DETERMINADO', ok: true, detalle: 'cuadra' }],
      indicadores: { base_imponible: 1000000, total_debitos: 190000, iva_determinado: 190000, total_a_pagar: 190000 },
      url: 'https://www4.sii.cl/rfiInternet/formCompacto?folio=9001',
      bytes: 4321,
    },
  })
  // Período «No Declarante»: el SII entrega el folio y ninguna casilla.
  decl.guardarFormularioF29(db, {
    empresaId: eid,
    rut: '77999001-7',
    periodo: '202510',
    fila: { folio: '9002', estado: 'Vigente' },
    estado: { situacion: 'NO DECLARANTE I', monto_observado: 0, eventos: [] },
    compacto: { ok: false, error: 'sin visor' },
  })

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202510', meses: 2 })

  // La consulta se declara hecha: el compácto cuenta como declaración aunque
  // no exista fila en `declaraciones_sii`.
  assert.equal(inf.declaraciones.f29.estado, 'disponible')
  assert.equal(inf.declaraciones.f29.consultadas, 1)
  assert.equal(inf.declaraciones.f29.declaradas, 1, 'sólo el período con casillas es declaración')
  assert.equal(inf.declaraciones.f29.pendientes, 0, '«No Declarante» no es un pendiente del sistema')

  const m = inf.mensuales.map((x) => Object.fromEntries([['p', x.periodo], ['estado', x.f29_estado], ['origen', x.f29_oficial?.origen], ['total', x.f29_oficial?.monto_total]]))
  const sep = m.find((x) => x.p === '202509')
  const oct = m.find((x) => x.p === '202510')
  assert.equal(sep.estado, 'declarada')
  assert.equal(sep.origen, 'compacto', 'el origen queda declarado en el dato')
  assert.equal(sep.total, 190000)
  assert.equal(oct.estado, 'sin_informacion', 'un período leído no puede seguir diciendo «no consultado»')
  assert.equal(oct.origen, null)

  // El calendario de cumplimiento distingue los dos casos.
  const cal = inf.opinion.calendario.find((c) => c.periodo === '202509')
  assert.equal(cal.revisada, true)
  assert.equal(cal.cumplida, true)
  assert.ok(!inf.opinion.hallazgos.some((h) => h.codigo === 'F29_PENDIENTE'), 'no se inventan pendientes')
})

test('S14: los agregados mensuales (boletas 39) suman a las ventas del informe', () => {
  // Regresión 2026-10-23 (Santa Camila 202603/202606): el SII entrega las
  // boletas del RCV de ventas SOLO como total del mes (codTipoDoc=39/48),
  // nunca documento a documento. Sin sumarlos, el informe reportaba
  // «diferencia de ventas» por millones en meses declarados al día.
  const eid = empresa({ rut: '77999002-0' })
  // Facturas individuales del mes: 1.000.000 neto.
  doc(eid, { periodo: '202603', neto: 1000000, iva: 190000, folio: 'F1' })
  // Boletas del mes como las entrega el SII: 1 fila agregada, 2 documentos,
  // neto 2.000.000, iva 380.000 (pasa por guardarAgregados y su UPSERT).
  const filaArgregados = {
    tipoDoc: 39, folio: 'AG-202603-39', tipoVenta: 'Del Giro', cantidad: 2,
    montoExento: 0, montoNeto: 2000000, montoIVA: 380000, montoTotal: 2380000,
    fechaRecepcion: '30/03/2026', filaRaw: { Folio: '2', 'Monto Neto': '2000000' },
  }
  const g = salud.guardarAgregados(db, {
    empresaId: eid, rut: '77999002-0', periodo: '202603', agregados: [filaArgregados],
  })
  assert.equal(g.guardados, 1)
  // Idempotencia: la misma fila re-guardada actualiza, no duplica.
  assert.equal(salud.guardarAgregados(db, {
    empresaId: eid, rut: '77999002-0', periodo: '202603', agregados: [filaArgregados],
  }).guardados, 1)

  // Compacto del F29 del mes (la comparación viene del formulario declarado).
  decl.guardarFormularioF29(db, {
    empresaId: eid,
    rut: '77999002-0',
    periodo: '202603',
    fila: { folio: '9003', estado: 'Vigente' },
    estado: { situacion: 'DECLARACION VIGENTE I', monto_observado: 0, declaraciones_vigentes: 1, eventos: [] },
    compacto: {
      ok: true,
      folio: '9003',
      casillas: [{ codigo: '563', monto: 3000000 }],
      verificaciones: [],
      indicadores: { base_imponible: 3000000, total_debitos: 570000, iva_determinado: 570000, total_a_pagar: 570000 },
      url: 'https://www4.sii.cl/rfiInternet/formCompacto?folio=9003',
      bytes: 4321,
    },
  })

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202603', meses: 1 })
  const m = inf.mensuales.find((x) => x.periodo === '202603')
  // El RCV del mes = facturas + agregados, y queda rotulado de dónde sale.
  assert.equal(m.ventas_neto, 3000000)
  assert.equal(m.ventas_agregados.cantidad, 2)
  assert.equal(m.ventas_agregados.neto, 2000000)
  assert.equal(m.ventas_agregados.tipos[0].tipo_doc, 39)
  assert.equal(m.estado, 'con_datos', 'un mes con sólo boletas agregadas también es con datos')
  // La conciliación usa el RCV completo: con la misma base declarada ya no
  // hay diferencia falsa de millones.
  assert.equal(m.comparacion.ventas_estimadas, 3000000)
  // Y los documentos de la bandeja NO se tocan: un total mensual no es un doc.
  const nDocs = db.prepare('SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?').get(eid).n
  assert.equal(nDocs, 1)
})
