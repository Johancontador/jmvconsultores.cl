'use strict'
/**
 * Contabilidad — pruebas de la fase F2 (2026-10-20).
 *
 * Cubren lo que la auditoría UX/UI marcó como hueco en el flujo
 * clasificar → proponer → contabilizar → revertir:
 *  C1 — Diario, Propuestas y Libros leen el PERÍODO GLOBAL (el del header y la
 *       URL), no el mes del calendario (`periodoActual()`).
 *  C2 — «Revertir asiento» tiene entrada en la interfaz, respeta
 *       `asientos:revertir` y no se ofrece sobre un asiento ya revertido.
 *  C3 — Revertir pide confirmación y NO escribe hasta confirmar; luego llama al
 *       endpoint real y avisa el folio de la reversión.
 *  C4 — Propuestas: el botón «Descartar» tiene rótulo (antes era un botón
 *       vacío) y la lista muestra cantidad/monto del filtro, no de la página.
 *  C5 — «Confirmar lote» muestra alcance (cantidad + monto) antes de ejecutar y
 *       reporta las OMITIDAS con el campo que el backend devuelve (`omitidos`).
 *  C6 — Libros: las notas de crédito (60/61) restan y los anulados no suman.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('node:crypto')

const FRONT = path.resolve(__dirname, '../frontend')

process.on('unhandledRejection', () => {})

// ---------- fixtures ----------

const LINEAS = (debe, haber) => [
  { cuenta_codigo: '5.1.01', cuenta_nombre: 'Gastos generales', debe, haber },
  { cuenta_codigo: '2.1.01', cuenta_nombre: 'Proveedores', debe: haber, haber: debe },
]

const ASIENTOS = {
  ok: true,
  total: 3,
  asientos: [
    // 7: vigente, revertible.
    { id: 7, folio: 41, anio: 2026, fecha: '2026-09-15', tipo: 'manual', glosa: 'Compra folio 2211', asiento_revertido_id: null, lineas: LINEAS(100000, 0) },
    // 8: ya revertido por el 9.
    { id: 8, folio: 42, anio: 2026, fecha: '2026-09-20', tipo: 'manual', glosa: 'Compra folio 2212', asiento_revertido_id: null, lineas: LINEAS(238000, 0) },
    // 9: la reversión del 8.
    { id: 9, folio: 43, anio: 2026, fecha: '2026-10-20', tipo: 'reversion', glosa: 'Reversión del asiento 42/2026', asiento_revertido_id: 8, lineas: LINEAS(0, 238000) },
  ],
}

const PROPUESTAS = {
  ok: true,
  total: 2,
  sumas: { n: 2, total: 357000 },
  propuestas: [
    { id: 5, estado: 'PENDIENTE', doc_tipo_flujo: 'compra', doc_folio: '2211', doc_razon_social: 'Proveedora Central SpA', doc_monto_total: 119000, cuenta_codigo: '5.1.01' },
    { id: 6, estado: 'PENDIENTE', doc_tipo_flujo: 'compra', doc_folio: '2212', doc_razon_social: 'Insumos del Sur Ltda', doc_monto_total: 238000, cuenta_codigo: '5.1.01' },
  ],
}

// ---------- sandbox ----------

function crearSandbox({ permisos = [], fixture, respuestaPost } = {}) {
  const htmls = []
  const urls = []
  const toasts = []
  const porId = new Map()

  const el = () => {
    let html = ''
    let texto = ''
    const e = {
      tagName: 'DIV', id: '', className: '', value: '', disabled: false,
      checked: false, href: '', src: '', dataset: {}, style: {},
      handlers: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(tipo, fn) { (e.handlers[tipo] = e.handlers[tipo] || []).push(fn) },
      removeEventListener() {},
      appendChild(c) { return c },
      remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => el(), querySelectorAll: () => [],
      closest: () => null,
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0, height: 0 }),
      // Dispara los listeners registrados (lo que en el navegador hace el clic).
      async disparar(tipo, ev = {}) {
        const lista = e.handlers[tipo] || []
        for (const fn of lista) await fn({ currentTarget: e, target: e, preventDefault() {}, ...ev })
      },
    }
    Object.defineProperty(e, 'innerHTML', {
      get: () => html,
      set(v) { html = String(v); htmls.push(html) },
    })
    Object.defineProperty(e, 'textContent', {
      get: () => texto,
      set(v) {
        texto = v == null ? '' : String(v)
        html = texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      },
    })
    return e
  }

  // getElementById devuelve SIEMPRE el mismo nodo por id: así la prueba puede
  // leer lo que la vista pintó en #cta-body/#prop-body y disparar el clic de un
  // botón que la propia vista conectó.
  const porIdEl = (id) => {
    if (!porId.has(id)) porId.set(id, el())
    return porId.get(id)
  }

  const location = { href: 't://x/sistema/#', origin: 't://x', pathname: '/sistema/', search: '', hash: '#asientos', replace() {}, assign() {} }
  // Listeners del documento por tipo: permite comprobar que el diálogo cierra
  // con Esc y que `cerrarModal()` no deja el keydown colgado.
  const listeners = {}
  const documentStub = {
    getElementById: porIdEl,
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener(tipo, fn) { (listeners[tipo] = listeners[tipo] || []).push(fn) },
    removeEventListener(tipo, fn) {
      listeners[tipo] = (listeners[tipo] || []).filter((x) => x !== fn)
    },
    body: el(), documentElement: el(), head: el(),
    activeElement: el(),
    readyState: 'complete',
  }
  const store = {
    getItem: () => null,
    setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0,
  }
  const sandbox = {
    document: documentStub,
    window: {},
    location,
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async () => {} } },
    localStorage: store, sessionStorage: store,
    history: {
      pushState(_a, _b, url) { location.hash = url },
      replaceState(_a, _b, url) { location.hash = url },
      back() {},
    },
    alert() {}, confirm: () => false, prompt: () => null,
    requestAnimationFrame: (fn) => setTimeout(fn, 16), cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} disconnect() {} unobserve() {} },
    IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    FormData: class {}, Event: class {}, CustomEvent: class {},
    URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: crypto.webcrypto,
    console,
    Intl,
  }
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.apiGet = async (url) => {
    urls.push(String(url))
    const f = fixture ? fixture(String(url)) : (String(url).includes('/propuestas?') ? PROPUESTAS : ASIENTOS)
    return JSON.parse(JSON.stringify(f))
  }
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    return respuestaPost ? JSON.parse(JSON.stringify(respuestaPost)) : { ok: true, asiento: { folio: 99 } }
  }
  sandbox.apiPut = async () => { throw new Error('no usado') }
  sandbox.apiDelete = async () => { throw new Error('no usado') }
  sandbox.iniciarPolling = () => () => {}
  sandbox.showToast = (msg, tipo) => { toasts.push({ msg: String(msg), tipo }) }
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const bundle = [
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'url-estado.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    lee(path.join(FRONT, 'sistema', 'views-fiscal.js')),
    lee(path.join(FRONT, 'sistema', 'views-conta.js')),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76.543.210-3", nombre: "Comercial Andes SpA" }',
    '  S.user = { id: 1, username: "tester" }',
    `  S.permisos = new Set(${JSON.stringify(permisos)})`,
    '  S.superAdmin = false',
    // Efectos secundarios fuera del alcance de estas pruebas: se cuentan.
    '  window.__render = 0; window.__pill = 0',
    '  renderRoute = () => { window.__render++ }',
    '  refrescarPillDocs = () => { window.__pill++ }',
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)

  return { sandbox, htmls, urls, toasts, porId, listeners, el }
}

const renderAsientos = (env) => env.sandbox.VIEWS.asientos.render(env.el())
const renderPropuestas = (env) => env.sandbox.VIEWS.propuestas.render(env.el())
const htmlDe = (env, id) => env.porId.get(id)?.innerHTML || ''

// ---------- C1: período global ----------
test('C1: Diario, Propuestas y Libros usan el período global, no el del calendario', async () => {
  const env = crearSandbox({ permisos: ['asientos:ver'] })
  // 2026-04 no es el mes del calendario: si la vista usara periodoActual()
  // pediría 202610 y la prueba fallaría.
  env.sandbox.aplicarPeriodoGlobal('202604')
  assert.strictEqual(env.sandbox.window._ctaPeriodo, '202604', 'el período global llega al Diario')
  assert.strictEqual(env.sandbox.window._propPeriodo, '202604', 'el período global llega a Propuestas')
  assert.strictEqual(env.sandbox.window._librosPeriodo, '202604', 'el período global llega a Libros')

  await renderAsientos(env)
  const asientosUrl = env.urls.find((u) => u.includes('/asientos?'))
  assert.match(asientosUrl, /periodo=202604/, 'el Diario pide el período del header/URL')

  await renderPropuestas(env)
  const propUrl = env.urls.find((u) => u.includes('/propuestas?'))
  assert.match(propUrl, /periodo=202604/, 'las Propuestas piden el período del header/URL')
})

// ---------- C2 / C3: revertir asiento ----------
test('C2: «Revertir» respeta el permiso y no se ofrece sobre un asiento ya revertido', async () => {
  const con = crearSandbox({ permisos: ['asientos:ver', 'asientos:revertir'] })
  await renderAsientos(con)
  const html = htmlDe(con, 'cta-body')

  assert.match(html, /data-rev="7"/, 'el asiento vigente ofrece revertir')
  assert.ok(!/data-rev="8"/.test(html), 'un asiento ya revertido no ofrece revertir otra vez')
  assert.match(html, />revertido</, 'el asiento revertido queda marcado')
  // La reversión SÍ puede revertirse (deshacer una reversión equivocada): el
  // backend lo permite y el original ya no. Ocultarla dejaría al usuario sin
  // camino cuando se equivoca de asiento.
  assert.match(html, /data-rev="9"/, 'la reversión se puede deshacer')
  assert.match(html, /reversión de #42/, 'la reversión dice a qué asiento revierte')
  assert.match(html, /aria-label="Revertir asiento 41"/, 'el botón se anuncia con su folio')

  const sin = crearSandbox({ permisos: ['asientos:ver'] })
  await renderAsientos(sin)
  assert.ok(!/data-rev=/.test(htmlDe(sin, 'cta-body')), 'sin asientos:revertir no hay acciones de escritura')
  assert.match(htmlDe(sin, 'cta-body'), /#41/, 'la lectura del diario se mantiene')
})

test('C3: revertir pide confirmación, no escribe al abrir y llama al endpoint real', async () => {
  const env = crearSandbox({ permisos: ['asientos:ver', 'asientos:revertir'] })
  await renderAsientos(env)
  env.sandbox.modalRevertirAsiento(ASIENTOS.asientos[0])

  const modal = env.htmls.filter((h) => h.includes('id="rev-ok"')).pop()
  assert.ok(modal, 'se abre el diálogo de confirmación')
  assert.match(modal, /Revertir asiento #41/, 'identifica el asiento')
  assert.match(modal, /Se registra un asiento <b>nuevo<\/b>/, 'explica que no borra el original')
  assert.match(modal, /no se puede revertir una vez|solo se puede revertir una vez/, 'advierte que es único')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'abrir el diálogo no escribe nada')

  await env.porId.get('rev-ok').disparar('click')
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.ok(post, 'confirmar escribe')
  assert.match(post, /POST \/api\/contable\/empresas\/1\/asientos\/7\/revertir/)
  assert.match(post, /"glosa":null/, 'sin glosa propia deja que el backend la construya')
  assert.ok(env.toasts.some((t) => /Reversión registrada/.test(t.msg) && /99/.test(t.msg)), 'avisa el folio de la reversión')
  assert.strictEqual(env.sandbox.window.__render, 1, 'refresca la vista')
})

// ---------- C4 / C5: propuestas ----------
test('C4: «Descartar» tiene rótulo y la lista muestra el total del filtro', async () => {
  const env = crearSandbox({ permisos: ['propuestas:ver', 'propuestas:generar', 'propuestas:confirmar'] })
  await renderPropuestas(env)
  const html = htmlDe(env, 'prop-body')

  assert.match(html, /data-no="5" aria-label="[^"]+"[^>]*>Descartar</, 'el botón de descartar se lee')
  assert.ok(!/data-no="5"[^>]*><\/button>/.test(html), 'ya no queda un botón vacío')
  assert.match(html, /2<\/b> propuesta\(s\) pendientes/, 'cantidad del filtro')
  assert.match(html, /\$357\.000/, 'monto del filtro (sumas del servidor)')
})

test('C5: confirmar lote muestra alcance antes de ejecutar y reporta las omitidas', async () => {
  const env = crearSandbox({
    permisos: ['propuestas:ver', 'propuestas:confirmar'],
    respuestaPost: { ok: true, aplicadas: 2, omitidos: [{ propuesta_id: 6, motivo: 'Período cerrado' }], total: 357000 },
  })
  env.sandbox.aplicarPeriodoGlobal('202604')
  await renderPropuestas(env)
  await env.sandbox.confirmarLotePropuestas('202604')

  const consulta = env.urls.find((u) => u.includes('/propuestas?') && u.includes('estado=PENDIENTE') && u.includes('limit=1000'))
  assert.ok(consulta, 'consulta las pendientes del período con el alcance completo, no la página')

  const modal = env.htmls.filter((h) => h.includes('id="prop-lote-ok"')).pop()
  assert.ok(modal, 'se abre la confirmación')
  assert.match(modal, /Propuestas pendientes<\/dt><dd><b class="mono">2<\/b>/, 'dice cuántas')
  assert.match(modal, /\$357\.000/, 'dice cuánto')
  assert.match(modal, /Contabilizar 2<\/button>/, 'el botón repite el alcance')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no escribe antes de confirmar')

  await env.porId.get('prop-lote-ok').disparar('click')
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.match(post, /POST \/api\/contable\/empresas\/1\/propuestas\/confirmar-lote \{"periodo":"202604"\}/)
  const toast = env.toasts.find((t) => /Lote:/.test(t.msg))
  assert.match(toast.msg, /2 contabilizada\(s\)/)
  assert.match(toast.msg, /1 omitida\(s\): Período cerrado/, 'las omitidas se informan (antes se leía `fallidas`, que el backend no manda)')
  assert.strictEqual(toast.tipo, 'error', 'un lote con omitidas no se reporta como éxito pleno')
})

test('C5b: sin pendientes no abre diálogo ni escribe', async () => {
  const env = crearSandbox({
    permisos: ['propuestas:ver', 'propuestas:confirmar'],
    fixture: () => ({ ok: true, total: 0, sumas: { n: 0, total: 0 }, propuestas: [] }),
  })
  await env.sandbox.confirmarLotePropuestas('202604')
  assert.ok(!env.htmls.some((h) => h.includes('id="prop-lote-ok"')), 'no hay alcance que confirmar')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no escribe')
  assert.ok(env.toasts.some((t) => /No hay propuestas pendientes/.test(t.msg)), 'explica por qué no hizo nada')
})

// ---------- C7: Esc en los diálogos ----------
test('C7: Esc cierra el diálogo y el keydown no queda colgado al cerrar', () => {
  const env = crearSandbox({ permisos: [] })
  env.sandbox.openModal('<h3>Prueba</h3>')
  assert.strictEqual((env.listeners.keydown || []).length, 1, 'el diálogo escucha Esc')

  // Abrir otro modal reemplaza el anterior: un solo listener, no una pila.
  env.sandbox.openModal('<h3>Otro</h3>')
  assert.strictEqual((env.listeners.keydown || []).length, 1, 'reabrir no acumula handlers')

  let evitado = false
  env.listeners.keydown[0]({ key: 'Escape', preventDefault() { evitado = true } })
  assert.ok(evitado, 'Esc se consume')
  assert.strictEqual((env.listeners.keydown || []).length, 0, 'cerrar retira el listener')

  env.sandbox.openModal('<h3>Tercero</h3>')
  env.sandbox.cerrarModal()
  assert.strictEqual((env.listeners.keydown || []).length, 0, 'cerrar por botón/acción también limpia')
  assert.ok(!/id="rev-ok"/.test(env.htmls.at(-1) || ''), 'no queda diálogo abierto')
})

// ---------- C6: libros ----------
test('C6: en los libros las NC restan y los anulados no suman', () => {
  const env = crearSandbox({ permisos: [] })
  const filas = [
    { tipo_doc: 33, estado: 'CLASIFICADO', monto_neto: 100000, monto_iva: 19000, monto_total: 119000, monto_exento: 0 },
    { tipo_doc: 61, estado: 'CONTABILIZADO', monto_neto: 50000, monto_iva: 9500, monto_total: 59500, monto_exento: 0 },
    { tipo_doc: 33, estado: 'ANULADO', monto_neto: 999999, monto_iva: 1, monto_total: 1000000, monto_exento: 0 },
  ]
  assert.strictEqual(env.sandbox.sumaLibro(filas, 'monto_neto'), 50000, 'factura menos nota de crédito')
  assert.strictEqual(env.sandbox.sumaLibro(filas, 'monto_total'), 59500)
  assert.strictEqual(env.sandbox.sumaLibro(filas, 'monto_iva'), 9500)
  assert.strictEqual(env.sandbox.sumaLibro([], 'monto_neto'), 0, 'sin filas no rompe')
})
