'use strict'
/**
 * F1 · REGRESIÓN DE PRESENTACIÓN — Salud Tributaria e informe imprimible.
 *
 * Los defectos que corrige esta fase no eran de cálculo: el motor ya declaraba
 * «no evaluable» con honestidad. Eran de LECTURA. Este archivo los fija para
 * que no vuelvan:
 *
 *  P1  Sin duplicaciones: un solo bloque de índice, un solo plan de acción,
 *      una sola opinión. Sin adorno con animación infinita y sin badges
 *      «Módulo 0…7» (no eran módulos). Sin texto residual por KPI.
 *  P2  Cero ≠ desconocido: exposición y créditos muestran $0 solo cuando la
 *      fuente fue consultada; si no, «Sin consultar»/«No evaluable».
 *  P3  Un fallo de carga se declara como estado del sistema (taxonomía
 *      compartida), no como hallazgo tributario, y ofrece reintentar.
 *  P4  Informe imprimible: sin tokens CSS inexistentes, `hechos`/`riesgos`
 *      como listas (no concatenados por comas), sin «reflecten», sin la tabla
 *      de detalle repetida y sin lenguaje de certificación oficial.
 *
 * Los datos del fixture son inventados (ver informeBase).
 * Ejecutar: node --test test/salud-presentacion.regression.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')

const RAIZ = path.resolve(__dirname, '..')
const FRONT = path.join(RAIZ, 'frontend')
const VISTA = path.join(FRONT, 'sistema', 'views-salud.js')
const INFORME = path.join(RAIZ, 'backend', 'core', 'informe-salud-html.js')

process.on('unhandledRejection', () => {})

/* ---------- fixture determinista del informe ---------- */

/** Informe mínimo con la forma REAL de `salud.construirInforme`. */
function informeBase(over = {}) {
  return {
    periodo: '202609',
    generado_en: '2026-10-23T10:00:00Z',
    cobertura: { desde: '202510', hasta: '202609', meses: 12, con_datos: 12, sin_movimiento: 0, sin_datos: 0, completa: true },
    identidad: { rut: '76000000-0', razon_social: 'Empresa de Prueba SpA', regimen: '14 D N°3', actividades: ['Venta al por menor'], atributos: [] },
    declaraciones: {
      f29: { estado: 'disponible', detalle: '12 períodos declarados', ultima_consulta: '2026-10-20' },
      renta_f22: { estado: 'disponible', detalle: 'F22 2025 presentado', ultima_consulta: '2026-10-20' },
      juradas: { estado: 'no_consultado', detalle: '', ultima_consulta: null },
      boletas_honorarios: { estado: 'no_consultado', detalle: '', ultima_consulta: null },
    },
    declaraciones_juradas: { estado: 'no_consultado', presentadas: [], pendientes: [] },
    mensuales: [],
    ingresos_historicos: { anios: [], nota: 'Solo se muestran años con RCV ingerido.' },
    f29_declarado: { estado: 'no_consultado', periodos: [] },
    renta: { estado: 'no_consultado', anios: [] },
    tesoreria: {},
    kpis: {},
    metodologia: { regla_no_evaluable: 'Una dimensión sin antecedentes no se puntúa con cero.', clasificacion: '90–100 Sólida' },
    deudas: { fiscal_tgr: { estado: 'no_consultado', etiqueta: 'No consultada' }, comercial: {} },
    opinion: {
      nivel: 'FAVORABLE', score: 78, indice_evaluable: true, cobertura_diagnostico: 90,
      nivel_confianza: 'Alta', titulo: 'Favorable con observaciones', resumen: 'Sin contingencias relevantes en la ventana.',
      clasificacion: { titulo: 'Favorable con observaciones', nota: '' },
      dimensiones: [], hallazgos: [], fortalezas: ['RCV completo'], calendario: [],
      matriz_riesgos: [], plan_accion: [], exposicion: { total: 0, nota: 'Sin exposición cuantificada.' },
      opinion_profesional: { conclusion: 'Cumplimiento dentro del alcance revisado.', hechos: ['F29 declarado en 12 períodos'], diferencias: [], riesgos: [], recomendacion: 'Mantener el control mensual.', advertencias: [] },
    },
    ...over,
  }
}

/* ---------- sandbox de la vista ---------- */

function crearSandbox({ informe, falla = null }) {
  const htmls = []
  // `escapeHtml` (shared/format.js) usa el truco `div.textContent = s; div.innerHTML`:
  // sin reproducirlo, esc() devuelve '' y los textos del sandbox desaparecen.
  const escapar = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const el = () => {
    let html = null
    const e = {
      tagName: 'DIV', id: '', className: '', textContent: '', value: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild(c) { return c }, remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => el(), querySelectorAll: () => [], focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
      insertAdjacentHTML(_pos, v) { html = (html || '') + String(v); htmls.push(String(v)) },
    }
    Object.defineProperty(e, 'innerHTML', {
      get: () => (html === null ? escapar(e.textContent) : html),
      set(v) { html = String(v); htmls.push(html) },
    })
    return e
  }
  const store = () => ({ getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 })
  const sandbox = {
    document: {
      getElementById: () => el(), querySelector: () => el(), querySelectorAll: () => [],
      createElement: () => el(), addEventListener() {}, removeEventListener() {},
      body: el(), head: el(), documentElement: el(), readyState: 'complete',
    },
    window: {},
    location: { href: 't://x/sistema/', origin: 't://x', pathname: '/sistema/', search: '', hash: '#salud', replace() {}, assign() {} },
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async () => {} } },
    localStorage: store(), sessionStorage: store(),
    history: { pushState() {}, replaceState() {}, back() {} },
    alert() {}, confirm: () => false, prompt: () => null,
    requestAnimationFrame: (fn) => setTimeout(fn, 16), cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    FormData: class {}, Event: class {}, CustomEvent: class {}, URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval, crypto: crypto.webcrypto, console,
    scrollTo() {}, open: () => null,
  }
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.apiGet = async (url) => {
    if (falla) throw new Error(falla)
    // El endpoint de gráficos se pide antes que el del informe: se resuelve
    // primero para no devolver el informe en su lugar.
    if (String(url).includes('/graficos')) return { ok: true, graficos: {} }
    return { ok: true, informe }
  }
  sandbox.apiPost = async () => ({ ok: true })
  sandbox.apiPut = async () => ({ ok: true })
  sandbox.apiDelete = async () => ({ ok: true })
  sandbox.iniciarPolling = () => () => {}
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const vistas = fs.readdirSync(path.join(FRONT, 'sistema')).filter((f) => f.startsWith('views-') && f.endsWith('.js')).sort()
  const bundle = [
    lee(path.join(FRONT, 'sistema', 'url-estado.js')),
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'estados-salud.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    ...vistas.map((f) => lee(path.join(FRONT, 'sistema', f))),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76000000-0", nombre: "Empresa de Prueba SpA" }',
    '  S.empresas = [S.empresa]',
    '  S.user = { id: 1, nombre: "Test" }',
    '  S.permisos = new Set(["salud:ver", "salud:sincronizar", "tesoreria:operar"])',
    '  globalThis.__v = { VIEWS, S }',
    '})()',
    ';1',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox, { filename: 'shell-salud.js' })
  return { sandbox, htmls, el }
}

async function renderSalud(opciones) {
  const { sandbox, htmls, el } = crearSandbox(opciones)
  // El contenedor debe CAPTURAR innerHTML: con un objeto literal se pierde
  // todo lo que la vista pinta y las aserciones verían cadena vacía.
  await sandbox.__v.VIEWS.salud.render(el())
  return htmls.join('\n')
}

/* ---------- P1: duplicaciones y ruido ---------- */

test('P1: Salud sin bloques duplicados, sin animación infinita y sin texto residual por KPI', () => {
  const src = fs.readFileSync(VISTA, 'utf8')
  const cuenta = (re) => (src.match(re) || []).length

  assert.strictEqual(cuenta(/<div class="sl-indice">/g), 1, 'un solo bloque de índice en la portada')
  assert.strictEqual(cuenta(/<h3>Plan de acción \(/g), 1, 'un solo plan de acción')
  assert.strictEqual(cuenta(/Opinión Tributaria Profesional/g), 0, 'la opinión no se repite como tarjeta aparte')
  assert.strictEqual(cuenta(/Plan de acción tributario/g), 0, 'sin segunda tabla de plan idéntica')
  assert.strictEqual(cuenta(/kpiPulse/g), 0, 'sin animación infinita decorativa')
  assert.strictEqual(cuenta(/sl-kpi-animaciones/g), 0, 'sin la fila de badges animados')
  assert.strictEqual(cuenta(/kpiModuloSeleccion/g), 0, 'sin badges «Módulo N»')
  assert.strictEqual(cuenta(/kpiContextoSII/g), 0, 'sin la llamada mal formada que dejaba «: valor»')
  assert.strictEqual(cuenta(/kpiUltimaActualizacion/g), 0, 'sin «Última actualización SII» construida con new Date()')
  // El valor de un KPI se pinta una sola vez por tarjeta.
  assert.strictEqual(cuenta(/class="sl-kpi-v"/g), 1, 'un único render del valor por tarjeta')
})

/* ---------- P2: cero ≠ desconocido ---------- */

test('P2: exposición $0 con cobertura se muestra como cero confirmado; sin consulta, como pendiente', async () => {
  const conCobertura = await renderSalud({ informe: informeBase() })
  assert.match(conCobertura, /Sin contingencias cuantificadas/, 'un 0 con cobertura se explica como cero revisado')
  assert.doesNotMatch(conCobertura, /Exposición tributaria[\s\S]{0,400}No evaluable con los antecedentes/, 'no se declara «no evaluable» un cero confirmado')

  const sinCobertura = await renderSalud({
    informe: informeBase({
      cobertura: { desde: '202510', hasta: '202609', meses: 12, con_datos: 0, sin_movimiento: 0, sin_datos: 12, completa: false },
      opinion: { ...informeBase().opinion, cobertura_diagnostico: 0, indice_evaluable: false, nivel: 'SIN_INFORMACION', exposicion: { total: 0, nota: '' } },
    }),
  })
  assert.match(sinCobertura, /Sin consultar/, 'sin consulta el KPI lo dice')
  assert.doesNotMatch(sinCobertura, /Sin contingencias cuantificadas/, 'no se afirma un cero que nadie verificó')
})

test('P2b: los créditos distinguen renta consultada con $0 de renta no consultada', async () => {
  const consultada = await renderSalud({ informe: informeBase({ renta: { estado: 'disponible', anios: [{ anio: '2025', estado: 'declarada', remanente_devuelto: 0 }] } }) })
  assert.match(consultada, /Renta consultada: sin remanente devuelto/, 'F22 consultada con 0 se afirma')

  const noConsultada = await renderSalud({ informe: informeBase() })
  assert.match(noConsultada, /Sin consultar/, 'sin F22 el crédito no se inventa')
  assert.doesNotMatch(noConsultada, /Renta consultada/, 'no se afirma una consulta que no ocurrió')
})

/* ---------- P3: errores como estado del sistema ---------- */

test('P3: un fallo de carga se declara con la taxonomía y ofrece reintentar (nunca como hallazgo)', async () => {
  const caido = await renderSalud({ falla: 'fetch failed' })
  assert.match(caido, /Fuente temporalmente no disponible/, 'proveedor caído = fuente no disponible')
  assert.match(caido, /no están verificados/i, 'dice qué información queda sin verificar')
  assert.match(caido, /Reintentar/, 'ofrece reintentar')
  assert.match(caido, /siguen disponibles/i, 'aclara que el resto del sistema sigue operativo')
  assert.doesNotMatch(caido, /No se pudo cargar el diagnóstico/, 'el mensaje genérico ya no se usa')

  const propio = await renderSalud({ falla: 'Cannot read properties of undefined (reading id)' })
  assert.match(propio, /Error técnico/, 'un defecto propio se rotula como error técnico')
  assert.doesNotMatch(propio, /Fuente temporalmente no disponible/, 'no se culpa al proveedor de un defecto propio')
})

/* ---------- P4: informe imprimible ---------- */

test('P4: el informe usa tokens propios, imprime listas y no se presenta como certificado oficial', () => {
  const src = fs.readFileSync(INFORME, 'utf8')
  // Variables del SPA (--space-4, --fs-sm, --rojo, …) no existen en el documento
  // imprimible: el navegador descarta la declaración y el aviso pierde color.
  assert.strictEqual((src.match(/var\(--/g) || []).length, 0, 'sin tokens CSS del SPA en el informe')
  assert.strictEqual((src.match(/reflecten/g) || []).length, 0, 'sin el typo «reflecten»')
  assert.match(src, /No es un certificado oficial del SII/, 'declara su alcance')
  // El detalle por período no se imprime dos veces.
  assert.strictEqual((src.match(/<h3>Detalle por período/g) || []).length, 1, 'una sola tabla de detalle por período')
})

test('P4b: hechos y riesgos se imprimen como listas, no concatenados por comas', () => {
  const { renderInformeHtml } = require('../backend/core/informe-salud-html')
  const inf = informeBase()
  inf.opinion.opinion_profesional.hechos = ['F29 declarado en 12 períodos', 'RCV completo para la ventana']
  inf.opinion.opinion_profesional.riesgos = ['Diferencia de ventas en 202607']
  const html = renderInformeHtml(inf)
  assert.doesNotMatch(html, /F29 declarado en 12 períodos,Rcv|F29 declarado en 12 períodos,RCV completo/, 'no se concatenan con comas')
  assert.match(html, /<li>F29 declarado en 12 períodos<\/li>/, 'cada hecho es un ítem de lista')
  assert.match(html, /<li>Diferencia de ventas en 202607<\/li>/, 'cada riesgo es un ítem de lista')
  assert.ok(!html.includes('undefined') && !html.includes('[object Object]'), 'sin fugas de objeto')
})
