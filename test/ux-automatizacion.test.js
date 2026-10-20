'use strict'
/**
 * Contabilización y Pendientes (#automatizacion) — pruebas de contrato UX.
 *
 * Cierran el hallazgo de la auditoría §2 sobre esta vista: el botón
 * «Contabilizar automáticamente» disparaba el pipeline completo a ciegas.
 *  A1 — abre una confirmación con el ALCANCE (cuántos documentos entran en
 *       cada eslabón) y cancelar NO envía ninguna petición.
 *  A2 — confirmar ejecuta el pipeline UNA vez y el resultado enlaza a las
 *       propuestas y al diario.
 *  A3 — sin nada por contabilizar no abre diálogo ni escribe; lo explica.
 *  A4 — con el período CERRADO la vista lo advierte y la confirmación repite
 *       que los asientos se omitirán (comportamiento real del núcleo: no se
 *       inventa un bloqueo que el backend no aplica).
 *  A5 — la vista lee el período GLOBAL (header + URL), no el mes del
 *       calendario, y su selector mueve el período de toda la app.
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

const ESTADO_ABIERTO = {
  ok: true,
  estado: {
    periodo: '202609',
    periodo_abierto: true,
    documentos: { PENDIENTE: 4, CLASIFICADO: 3, PROPUESTO: 0, CONTABILIZADO: 10, REVISION: 2 },
    sin_resolver: 9,
    propuestas_pendientes: 3,
    asientos_del_periodo: 10,
    contabilizados: 10,
    reglas_activas: 6,
  },
  ultima_ejecucion: null,
}

const RESULTADO = {
  ok: true,
  resultado: {
    periodo: '202609',
    evaluados: 6,
    clasificados: 6,
    sin_regla: 0,
    propuestas_nuevas: 3,
    propuestas_fallidas: [],
    contabilizadas: 3,
    omitidas: [],
    total_asientos: 357000,
  },
}

// ---------- sandbox ----------

function crearSandbox({ permisos = ['propuestas:ver', 'automatizacion:ejecutar'], estado = ESTADO_ABIERTO, resultado = RESULTADO, periodo = '202609' } = {}) {
  const htmls = []
  const urls = []
  const toasts = []
  const porId = new Map()
  const store = new Map()

  const el = () => {
    let html = ''
    let texto = ''
    const e = {
      tagName: 'DIV', id: '', className: '', value: '', disabled: false,
      checked: false, href: '', src: '', dataset: {}, style: {}, files: null,
      handlers: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(tipo, fn) { (e.handlers[tipo] = e.handlers[tipo] || []).push(fn) },
      removeEventListener() {},
      appendChild(c) { return c },
      remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      insertAdjacentHTML() {},
      querySelector: () => el(), querySelectorAll: () => [],
      closest: () => null,
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0, height: 0 }),
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
      set(v) { texto = v == null ? '' : String(v); html = texto },
    })
    return e
  }

  const porIdEl = (id) => {
    if (!porId.has(id)) porId.set(id, el())
    return porId.get(id)
  }

  const location = { href: 't://x/sistema/#automatizacion', origin: 't://x', pathname: '/sistema/', search: '', hash: '#automatizacion', replace() {}, assign() {} }
  const documentStub = {
    getElementById: porIdEl,
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(), activeElement: el(), readyState: 'complete',
  }
  const localStorageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: () => null, length: 0,
  }
  const sandbox = {
    document: documentStub,
    window: {},
    location,
    navigator: { userAgent: 'test', language: 'es-CL' },
    localStorage: localStorageStub, sessionStorage: localStorageStub,
    history: { pushState() {}, replaceState() {}, back() {} },
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
    return JSON.parse(JSON.stringify(estado))
  }
  store.set('iva_periodo_activo', periodo)
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    return JSON.parse(JSON.stringify(resultado))
  }
  sandbox.showToast = (msg, tipo) => { toasts.push({ msg: String(msg), tipo }) }
  sandbox.iniciarPolling = () => () => {}
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const bundle = [
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'url-estado.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    lee(path.join(FRONT, 'sistema', 'views-autom.js')),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76.543.210-3", nombre: "Comercial Andes SpA" }',
    '  S.user = { id: 1, username: "tester" }',
    `  S.permisos = new Set(${JSON.stringify(permisos)})`,
    '  S.superAdmin = false',
    '  window.__render = 0',
    '  renderRoute = () => { window.__render++ }',
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)

  return { sandbox, htmls, urls, toasts, porId, el, store }
}

const htmlDe = (env, id) => env.porId.get(id)?.innerHTML || ''
const ultimoModal = (env, idBoton) => env.htmls.filter((h) => h.includes(`id="${idBoton}"`)).pop()
const posts = (env) => env.urls.filter((u) => u.startsWith('POST'))

// ---------- A1: el alcance antes de ejecutar ----------

test('A1: «Contabilizar automáticamente» muestra el alcance y cancelar no escribe', async () => {
  const env = crearSandbox()
  const cont = env.el()
  await env.sandbox.VIEWS.automatizacion.render(cont)

  assert.ok(!/Pipeline completado/.test(cont.innerHTML), 'sin resultado previo')
  const pendiente = env.porId.get('auto-run').disparar('click')
  await new Promise((r) => setTimeout(r, 10))

  const modal = ultimoModal(env, 'ui-conf-ok')
  assert.ok(modal, 'se abre la confirmación')
  assert.match(modal, /Documentos por clasificar<\/dt><dd><b class="mono">6<\/b>/, 'PENDIENTE + REVISION')
  assert.match(modal, /Clasificados sin propuesta<\/dt><dd><b class="mono">3<\/b>/, 'cuántos se van a proponer')
  assert.match(modal, /Propuestas por contabilizar<\/dt><dd><b class="mono">3<\/b>/, 'cuántas se van a confirmar')
  assert.match(modal, /Contabilizar 12/, 'el botón repite el alcance total')
  assert.match(modal, /Nada se envía al SII/, 'aclara que no toca el SII')

  assert.deepStrictEqual(posts(env), [], 'abrir el diálogo no ejecuta el pipeline')

  await env.porId.get('ui-conf-no').disparar('click')
  await pendiente
  assert.deepStrictEqual(posts(env), [], 'cancelar tampoco ejecuta nada')
  assert.strictEqual(env.sandbox.window.__render, 0, 'no re-renderiza ni toca el estado')
})

// ---------- A2: ejecución con resultado enlazado ----------

test('A2: confirmar ejecuta el pipeline una vez y el resultado enlaza propuestas y diario', async () => {
  const env = crearSandbox()
  const cont = env.el()
  await env.sandbox.VIEWS.automatizacion.render(cont)

  const pendiente = env.porId.get('auto-run').disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  await env.porId.get('ui-conf-ok').disparar('click')
  await pendiente
  await new Promise((r) => setTimeout(r, 10))

  const post = posts(env)
  assert.strictEqual(post.length, 1, 'una sola petición')
  assert.match(post[0], /\/automatizacion\/202609\/ejecutar/)
  assert.ok(env.toasts.some((t) => /3 documento\(s\) contabilizado\(s\)/.test(t.msg) && t.tipo === 'success'))
  assert.strictEqual(env.sandbox.window.__render, 1, 're-renderiza para refrescar los KPIs')

  // El re-render muestra la tarjeta del resultado con los atajos a lo creado
  const res = env.sandbox.window._autoResultado
  assert.ok(res && res.empresaId === 1 && res.periodo === '202609', 'el resultado queda ligado a empresa+período')
  env.sandbox.window._autoResultado = res
  await env.sandbox.VIEWS.automatizacion.render(cont)
  const salida = cont.innerHTML
  assert.match(salida, /Pipeline completado/, 'se ve el resumen')
  assert.match(salida, /href="#propuestas"/, 'enlaza a las propuestas creadas')
  assert.match(salida, /href="#asientos"/, 'enlaza al libro diario')
  assert.match(salida, /\$357\.000/, 'monto total contabilizado')
})

// ---------- A3: nada por hacer ----------

test('A3: sin nada por contabilizar no abre diálogo ni ejecuta; lo explica', async () => {
  const vacio = JSON.parse(JSON.stringify(ESTADO_ABIERTO))
  vacio.estado.documentos = { PENDIENTE: 0, CLASIFICADO: 0, CONTABILIZADO: 10 }
  vacio.estado.propuestas_pendientes = 0
  vacio.estado.sin_resolver = 0

  const env = crearSandbox({ estado: vacio })
  await env.sandbox.VIEWS.automatizacion.render(env.el())
  await env.porId.get('auto-run').disparar('click')
  await new Promise((r) => setTimeout(r, 10))

  assert.ok(!env.htmls.some((h) => h.includes('id="ui-conf-ok"')), 'no hay nada que confirmar')
  assert.deepStrictEqual(posts(env), [], 'no se ejecutó el pipeline')
  assert.ok(env.toasts.some((t) => /No hay nada por contabilizar en Septiembre 2026/.test(t.msg)), 'dice por qué no hizo nada')
})

// ---------- A4: período cerrado ----------

test('A4: con el período cerrado la vista y la confirmación lo advierten', async () => {
  const cerrado = JSON.parse(JSON.stringify(ESTADO_ABIERTO))
  cerrado.estado.periodo_abierto = false
  const env = crearSandbox({ estado: cerrado })
  const cont = env.el()
  await env.sandbox.VIEWS.automatizacion.render(cont)

  const aviso = cont.innerHTML
  assert.match(aviso, /id="auto-cerrado"/, 'la vista lo dice antes de cualquier clic')
  assert.match(aviso, /CERRADO/, 'nombra el estado del período')
  assert.match(aviso, /no crea asientos/, 'explica la consecuencia real')

  const pendiente = env.porId.get('auto-run').disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'ui-conf-ok')
  assert.match(modal, /Período<\/dt><dd>CERRADO/, 'la confirmación repite el estado del período')
  assert.match(modal, /los asientos se van a omitir/, 'no promete asientos imposibles')

  await env.porId.get('ui-conf-ok').disparar('click')
  await pendiente
  assert.strictEqual(posts(env).length, 1, 'el pipeline sigue disponible (el backend lo permite y reporta los omitidos)')
})

// ---------- A5: un solo período ----------

test('A5: la vista usa el período global y su selector lo propaga a toda la app', async () => {
  const env = crearSandbox({ periodo: '202608' })
  const cont = env.el()
  await env.sandbox.VIEWS.automatizacion.render(cont)

  assert.ok(env.urls.some((u) => /\/automatizacion\/202608\/estado/.test(u)), 'consulta el período del header/URL, no el mes del calendario')
  assert.match(cont.innerHTML, /id="auto-periodo"[^>]*value="2026-08"/, 'su selector muestra el mismo período')

  // Cambiar el selector de esta vista mueve el período GLOBAL (header + URL).
  env.porId.get('auto-periodo').value = '2026-07'
  await env.porId.get('auto-periodo').disparar('change')
  assert.strictEqual(env.store.get('iva_periodo_activo'), '202607', 'el período activo cambia en toda la app')
  assert.ok(env.toasts.length === 0, 'sin ruido innecesario')

  // Y al volver a la vista sigue en 202607 (no rebota al calendario).
  env.urls.length = 0
  await env.sandbox.VIEWS.automatizacion.render(cont)
  assert.ok(env.urls.some((u) => /\/automatizacion\/202607\/estado/.test(u)), 'la vista recuerda el período elegido')
})
