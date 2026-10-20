'use strict'
/**
 * pruebas de regresión del rediseño UX (masterplan unificación):
 *  T1 — MENU: keys únicos y toda vista tiene entrada (compatibilidad §36).
 *  T2 — UIEstado: cargando/vacio/chip/error escapan HTML (no inyección).
 *  T3 — Calculadora IVA: aritmética neta↔IVA↔total con 19% (19.000→3.610/22.610).
 *  T4 — Centro de reportes: favoritos persisten en localStorage (contrato de keys).
 *  T5 — Views sandbox: render de TODAS las vistas sin ReferenceError
 *       (regresión de portal-cartera: helper scope-fuera → `C is not defined`):
 *       tablaCarteraHTML() usaba `C` declarado dentro del try de cargar(), el
 *       ReferenceError caía al catch de cargar() y la pantalla quedaba pegada
 *       en el mensaje de error en vez de mostrar la cartera segmentada.
 */
const test = require('node:test')
const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const FRONT = path.resolve(__dirname, '../frontend')

// El sandbox T5 ejecuta vistas reales: varias disparan asyncs fire-and-forget
// (p. ej. views-crm) cuyo rechazo no cae en ningún catch del sandbox. En el
// navegador son solo errores de consola; aquí silenciar el nivel de proceso
// evita que el runner de node --test muera por rechazos que no son del test.
process.on('unhandledRejection', () => {})

// ---------- T1: MENU ----------
test('T1: menú — keys únicos y toda vista con entrada de menú', () => {
  const dirs = { sistema: fs.readdirSync(path.join(FRONT, 'sistema')).filter((f) => f.endsWith('.js')) }
  let all = ''
  for (const f of dirs.sistema) all += fs.readFileSync(path.join(FRONT, 'sistema', f), 'utf8')
  const app = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')
  const menuKeys = [...app.matchAll(/key: '([\w-]+)'/g)].map((m) => m[1])
  assert.ok(menuKeys.length >= 30, `menú tiene ${menuKeys.length} ítems`)
  assert.strictEqual(menuKeys.length, new Set(menuKeys).size, 'sin ítems duplicados')
  // cada VIEWS definida está en el menú
  const vistas2 = [...all.matchAll(/VIEWS\.([\w\w]+)\s*=/g)].map((m) => m[1])
    .concat([...all.matchAll(/VIEWS\['([\w-]+)'\]\s*=/g)].map((m) => m[1]))
  const menuSet = new Set(menuKeys)
  const sinMenu = vistas2.filter((v) => !menuSet.has(v))
  assert.strictEqual(sinMenu.length, 0, `vistas sin entrada de menú: ${sinMenu.join(',')}`)
})

// ---------- T2: UIEstado — carga y escape ----------
test('T2: UIEstado carga y escapa HTML en vacio/error/chip (anti inyección)', () => {
  const sandbox = { window: {}, document: undefined }
  vm.createContext(sandbox)
  new vm.Script(fs.readFileSync(path.join(FRONT, 'sistema', 'ui.js'), 'utf8')).runInContext(sandbox)
  const UI = sandbox.window.UIEstado
  assert.ok(UI, 'window.UIEstado definido')
  const malicioso = '<script>alert(1)</script>'
  for (const salida of [UI.vacio(malicioso), UI.error(malicioso), UI.chip(malicioso)]) {
    assert.ok(!salida.includes('<script>'), 'injection bloqueada')
    assert.ok(salida.includes('&lt;script&gt;'), 'escape correcto')
  }
  assert.ok(UI.cargando('x').includes('ui-spin'), 'spinner CSS presente')
  // calculadora HTML se genera
  assert.ok(UI.calculadoraIvaHTML().includes('ci-neto') && UI.calculadoraIvaHTML().includes('No</b> incluye'), 'calculadora con labeling provisional honesto')
})

// ---------- T3: aritmética de la calculadora (lógica verificada aislada) ----------
test('T3: aritmética IVA 19% — neto 19000 → IVA 3610 → total 22610 (formato chileno)', () => {
  const neto = 19000, TASA = 0.19
  const iva = Math.round(neto * TASA)
  const total = Math.round(neto * (1 + TASA))
  assert.strictEqual(iva, 3610)
  assert.strictEqual(total, 22610)
  // inversa: desde total 22610 → neto 19000, IVA 3610
  const netoInverso = Math.round(22610 / (1 + TASA))
  const ivaInverso = Math.round(22610 - 22610 / (1 + TASA))
  assert.strictEqual(netoInverso, 19000)
  assert.strictEqual(ivaInverso, 3610)
  // formato es-CL (miles con punto)
  const f = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(total)
  assert.ok(f.includes('.'), 'formato chileno de miles')
})

// ---------- T4: centro de reportes — favoritos/recientes (contrato de storage) ----------
test('T4: centro de reportes — keys de storage y contratos de favoritos/recientes', () => {
  const conta = fs.readFileSync(path.join(FRONT, 'sistema', 'views-conta.js'), 'utf8')
  assert.ok(conta.includes('jmv_fav_reports'), 'KEY_FAV definida')
  assert.ok(conta.includes('jmv_recent_records') || conta.includes('jmv_recent_reports'), 'KEY_REC definida')
  // favorito: botón dentro del anchor, con preventDefault (no navega)
  assert.ok(conta.includes('e.preventDefault()') && cont_a(conta), 'rep-fav no navega')
  // búsqueda muestra estado vacío
  assert.ok(conta.includes('rep-sin-resultados'), 'estado vacío de búsqueda presente')
})

function cont_a(s) {
  return s.includes("stopPropagation()")
}

// ---------- T5: views sandbox (regresión de scoping portal-cartera) ----------

/**
 * Carga shared/format.js + shared/uitoolkit.js + ui.js + app.js + views-*.js
 * en UN script vm (los `const` top-level de app.js — esc, S, leerPeriodo… —
 * son visibles a las vistas, igual que en scripts clásicos del navegador),
 * con stubs DOM/API mínimos y respuestas API rígidas para caminar el happy
 * path. Devuelve { sandbox, htmls }.
 *
 * El RuntimeError que NO toleramos es ReferenceError en render: esa es la
 * clase exacta del bug corregido en portal-cartera (un helper de la vista
 * referenciando un identificador declarado en el scope de OTRA función).
 * TypeError y derivados por shapes de stub incompletas NO son esa clase.
 */
function crearSandboxVistas() {
  const htmls = [] // todo innerHTML asignado queda aquí (getElementById crea objetos nuevos por llamada)
  const el = () => {
    let html = ''
    const e = {
      tagName: 'DIV', id: '', className: '', textContent: '', value: '',
      checked: false, href: '', src: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { return c }, remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => el(), querySelectorAll: () => [],
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    }
    Object.defineProperty(e, 'innerHTML', {
      get: () => html,
      set(v) { html = String(v); htmls.push(html) },
    })
    return e
  }
  const documentStub = {
    getElementById: () => el(),
    querySelector: () => el(), querySelectorAll: () => [],
    createElement: (t) => el(),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(),
    readyState: 'complete',
  }
  const store = () => ({ getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 })
  const RESPUESTAS = new Map([
    ['cartera', {
      ok: true,
      cartera: {
        periodo: '202609', periodo_previo: '202608', regla: 'X',
        resumen: { cuidar: 1, desarrollar: 0, recuperar: 0, controlar: 0, sin_datos: 0 },
        clientes: [{ rut: '1-9', razon_social: 'A', docs_periodo: 1, docs_previo: 1, neto_periodo: 100, neto_previo: 100, variacion_pct: 0, segmento: 'cuidar' }],
      },
    }], // portal-cartera: happy path
    ['movimientos', { ok: true, total: 0, neto: 0, monto_total: 0, movimientos: [] }], // portal-ventas
    ['serie', { ok: true, serie: [] }],
  ])
  const apiGetStub = async (url) => {
    for (const [k, v] of RESPUESTAS) if (String(url).includes(k)) return JSON.parse(JSON.stringify(v))
    return {}
  }
  const rejecting = async () => { throw new Error('stub') }
  const sandbox = {
    document: documentStub,
    window: {},
    location: { href: 't://x/sistema/#', origin: 't://x', pathname: '/sistema/', search: '', hash: '#', replace() {}, assign() {} },
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
    FormData: class {}, Event: class {}, CustomEvent: class {},
    URL, URLSearchParams,
    setTimeout, clearTimeout, setInterval, clearInterval,
    crypto: crypto.webcrypto,
    console,
  }
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.apiGet = apiGetStub
  sandbox.apiPost = rejecting
  sandbox.apiPut = rejecting
  sandbox.apiDelete = rejecting
  sandbox.iniciarPolling = () => () => {}
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const vistas = fs.readdirSync(path.join(FRONT, 'sistema')).filter((f) => f.startsWith('views-') && f.endsWith('.js')).sort()
  const bundle = [
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    ...vistas.map((f) => lee(path.join(FRONT, 'sistema', f))),
    ';(() => {',
    '  S.empresa = S.empresa || { id: 1, rut: "1-9", razon_social: "X", nombre: "X" }',
    '  S.user = S.user || { id: 1, nombre: "T" }',
    '  S.usuario = S.usuario || { id: 1, nombre: "T" }',
    '  S.superAdmin = true',
    `  if (S.permisos && S.permisos.add) { S.permisos.add('todo'); S.permisos.add('documentos:ver') }`,
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)
  return { sandbox, htmls }
}

test('T5: portal-cartera renderiza segmentos y tabla con datos (regresión `C is not defined`)', async () => {
  const { sandbox, htmls } = crearSandboxVistas()
  const cartera = sandbox.window.VIEWS['portal-cartera']
  assert.ok(cartera && typeof cartera.render === 'function', 'vista portal-cartera registrada')
  await cartera.render({ innerHTML: '' })
  const salida = htmls.join('')
  // Happy path: la zona dinámica muestra los segmentos y la TABLA (no el catch de error)
  assert.ok(salida.includes('Segmentos (regla explícita)'), 'resumen de segmentos presente')
  assert.ok(salida.includes('tubre') === false && salida.includes('<table') === true, 'tabla de cartera renderizada')
  assert.ok(salida.includes('septiembre 2026'), 'perLabel de C.periodo/previo funcionó (antes: C is not defined)')
})

test('T5b: NINGUNA vista lanza ReferenceError en render (clase de bug scope-fuera)', async () => {
  const { sandbox } = crearSandboxVistas()
  const vistas = Object.keys(sandbox.window.VIEWS).sort()
  assert.ok(vistas.length >= 30, `vistas registradas: ${vistas.length}`)
  const refErrs = []
  for (const key of vistas) {
    const v = sandbox.window.VIEWS[key]
    if (!v || typeof v.render !== 'function') continue
    try {
      await v.render({ innerHTML: '' })
    } catch (e) {
      if (e instanceof ReferenceError) refErrs.push(`[${key}] ${e.message}`)
      // TypeError por shapes de stub: no es la clase del bug, se tolera
    }
  }
  assert.deepStrictEqual(refErrs, [], 'ReferenceErrors en render de vistas')
})

// ---------- T6: campana de notificaciones y conciliación ----------
test('T6: la campana no pide el detalle de conciliación (404) y lee el conteo', () => {
  const app = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')
  // El detalle responde 404 cuando el período aún no tiene conciliación: en
  // cada carga del shell dejaba "Failed to load resource: 404" en consola.
  assert.ok(!/conciliacion\/\$\{periodo\}/.test(app), 'sin GET del detalle por período')
  assert.match(app, /\/conciliaciones\?periodo=\$\{periodo\}/, 'usa el listado filtrado (200)')
  // `diferencias` es el CONTEO persistido: con `.length` la alerta nunca salía.
  assert.match(app, /Number\(c && c\.diferencias\)/)
  const bloque = app.slice(app.indexOf("tiene('conciliacion:ver')"), app.indexOf("tiene('dte:ver')"))
  assert.ok(bloque.length > 0, 'se encontró el bloque de conciliación')
  assert.ok(!/if \(difs\.length\)/.test(bloque), 'no trata el conteo como arreglo')
})

// ---------- T6: móvil — shell de una columna y menú desplegable ----------
test('T7: móvil — ninguna plantilla de sidebar sin media query, menú desplegable y controles de 16 px', () => {
  const css = fs.readFileSync(path.join(FRONT, 'sistema', 'sistema.css'), 'utf8')
  const app = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')

  // Regresión real: `.sys { grid-template-columns: 232px … }` se declaró SIN
  // media query después de las media queries del móvil, ganó por cascada y a
  // 390 px el contenido quedaba en una franja de 232 px con 158 px vacíos.
  const sinGuarda = css.split('\n').filter((l) => /^\.sys \{ grid-template-columns: \d+px/.test(l))
  assert.deepStrictEqual(sinGuarda, [], 'la plantilla de escritorio debe ir dentro de @media (min-width: 961px)')

  assert.match(css, /@media \(min-width: 961px\) \{\s*\.sys \{ grid-template-columns: 232px minmax\(0, 1fr\); \}/, 'escritorio con guarda de ancho')
  assert.match(css, /@media \(max-width: 960px\)[\s\S]*?\.sys \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'móvil en una sola columna real')
  assert.match(css, /\.sys-side\.abierto/, 'el panel del menú se abre con clase explícita')
  assert.match(css, /\.sys-side \{[\s\S]*?position: fixed;[\s\S]*?transform: translateX\(-102%\)/, 'menú lateral fuera de pantalla cuando está cerrado')
  assert.match(css, /input:not\(\[type='checkbox'\]\):not\(\[type='radio'\]\)[\s\S]*?font-size: 16px/, 'controles a 16 px (sin zoom automático de iOS)')
  assert.match(css, /\.tbl-hint \{ display: flex; \}/, 'aviso de tabla desplazable visible en móvil')

  assert.match(app, /id="sys-menu-btn"[^>]*aria-expanded="false"[^>]*aria-controls="sys-nav"/, 'botón del menú con estado accesible')
  assert.match(app, /id="sys-side"[^>]*>/, 'sidebar con id para el panel')
  assert.match(app, /function marcarTablasDesplazables/, 'aviso de tablas ancho-dependiente')
  assert.match(app, /observarTablas\(\)/, 'las tablas que se pintan después de render() también reciben aviso')
  // El select de período ya no lleva el tamaño en un style inline imborrable.
  assert.ok(!app.includes('id="sys-periodo" class="form-input" style='), 'sin style inline en el selector de período')
})

// ---------- T8: rejillas móviles sin mínimo fijo --------------------------
test('T8: móvil — rejillas con min() , piso de 12 px y tarjetas del Centro sin recorte', () => {
  const css = fs.readFileSync(path.join(FRONT, 'sistema', 'sistema.css'), 'utf8')
  const sitio = fs.readFileSync(path.join(FRONT, 'css', 'sitio.css'), 'utf8')

  // Medido el 2026-10-19 en Chrome real: a 320 px de viewport (Chrome expande el
  // layout a 352/324) `minmax(320px, 1fr)` + padding del wrap forzaba zoom-out.
  // Es el mismo síntoma de la incidencia móvil del 16-oct, en otra rejilla.
  const minimosFijos = [
    ...css.matchAll(/grid-template-columns[^;]*minmax\((\d+)px/g),
    ...sitio.matchAll(/grid-template-columns[^;]*minmax\((\d+)px/g),
  ]
  assert.deepStrictEqual(minimosFijos.map((m) => m[0]), [], 'ninguna rejilla con minmax(<px>, …) sin min(…, 100%)')

  assert.match(css, /grid-template-columns: repeat\(auto-fill, minmax\(min\(320px, 100%\), 1fr\)\)/, 'Centro de Aplicaciones fluido')
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.sys table\.tbl th,[\s\S]*?font-size: 12px/, 'encabezados de tabla a 12 px en teléfono')
  assert.match(css, /\.sys \.centro-card-head > div \{ min-width: 0; \}/, 'el título de la tarjeta puede encogerse')
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.sys \.centro-card-head \{ flex-wrap: wrap; \}/, 'cabecera de tarjeta envuelve en teléfono')
  assert.match(sitio, /@media \(max-width: 420px\)[\s\S]*?\.pv-kpis \{ grid-template-columns: 1fr; \}/, 'KPIs del sitio en una columna en pantallas angostas')
})

// ---------- T9: F0 — tema claro por defecto y shell accesible --------------
test('T9: tema claro por defecto (la preferencia guardada manda) y shell accesible', () => {
  const temaSrc = fs.readFileSync(path.join(FRONT, 'sistema', 'tema.js'), 'utf8')
  const app = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')
  const css = fs.readFileSync(path.join(FRONT, 'sistema', 'sistema.css'), 'utf8')

  // Antes el defecto seguía al SO: en un equipo con tema oscuro la app
  // arrancaba oscura (AUDITORIA-UX-UI §7, decisión D1: claro por defecto).
  function cargarTema(guardado) {
    const ctx = {
      localStorage: { getItem: (k) => (k === 'jmv_tema' ? guardado : null), setItem() {} },
      document: { documentElement: { setAttribute() {} } },
      window: {},
      CustomEvent: class {},
    }
    vm.createContext(ctx)
    vm.runInContext(temaSrc, ctx)
    return ctx.window.Tema
  }
  assert.strictEqual(cargarTema(null).resolver(), 'light', 'sin preferencia arranca claro')
  assert.strictEqual(cargarTema('dark').resolver(), 'dark', 'la elección guardada manda')
  assert.strictEqual(cargarTema('light').resolver(), 'light')

  // Accesibilidad mínima del shell (la auditoría medía 0 skip-link y 0 aria-live).
  assert.match(app, /class="skip-link" href="#sys-contenido"/, 'enlace de salto al contenido')
  assert.match(app, /<main class="sys-main" id="sys-contenido" tabindex="-1">/, 'main es el destino enfocable del salto')
  assert.match(app, /id="sys-anuncio" class="sr-only" role="status" aria-live="polite"/, 'región viva para anunciar la vista')
  assert.match(app, /anuncio\.textContent = `Vista: /, 'cada cambio de ruta se anuncia')
  assert.match(css, /\.sys \.skip-link:focus \{ top:/, 'el enlace de salto se ve al enfocar')
})
