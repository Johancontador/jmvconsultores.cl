'use strict'
/**
 * Bandeja de Documentos — pruebas del piloto UX/UI (2026-10-17).
 *
 * Cubren lo que la suite anterior NO protegía de `#documentos`:
 *  B1 — período global aplicado y paginación de servidor (limit/offset).
 *  B2 — estado canónico REVISION (el backend nunca usó "REVISIÓN").
 *  B3 — totales y conteos desde la respuesta del servidor, no de la página.
 *  B4 — filtros reflejados en la URL.
 *  B5 — permisos: sin `documentos:clasificar` no hay acciones de escritura.
 *  B6 — acciones por fila solo en estados que el backend admite.
 *  B7 — exportación del filtro completo con tope 1000 declarado.
 *  B8 — clasificación automática con empresa, período y alcance previos.
 *  B9 — contratos/id/anchor existentes preservados y sin cambios de endpoints.
 * B10 — accesibilidad (caption, aria-sort, aria-live, dialog) y que UITabla
 *       siga funcionando igual para las demás vistas (opciones aditivas).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const crypto = require('node:crypto')

const FRONT = path.resolve(__dirname, '../frontend')
const fuenteVista = fs.readFileSync(path.join(FRONT, 'sistema', 'views-fiscal.js'), 'utf8')
const fuenteTabla = fs.readFileSync(path.join(FRONT, 'shared', 'uitoolkit.js'), 'utf8')
const fuenteCss = fs.readFileSync(path.join(FRONT, 'sistema', 'sistema.css'), 'utf8')

process.on('unhandledRejection', () => {})

// ---------- fixtures ----------
const DOCS = [
  {
    id: 11, tipo_flujo: 'compra', tipo_doc: 33, folio: '2211', fecha_docto: '2026-09-12',
    rut_contraparte: '76543210-3', razon_social: 'Proveedora Central SpA',
    monto_neto: 100000, monto_iva: 19000, monto_total: 119000, estado: 'PENDIENTE',
    cuenta_codigo: null, cuenta_nombre: null,
  },
  {
    id: 12, tipo_flujo: 'compra', tipo_doc: 33, folio: '2212', fecha_docto: '2026-09-13',
    rut_contraparte: '11111111-1', razon_social: 'Insumos del Sur Ltda',
    monto_neto: 200000, monto_iva: 38000, monto_total: 238000, estado: 'CONTABILIZADO',
    cuenta_codigo: '5.1.01', cuenta_nombre: 'Gastos generales',
  },
]
const ESTADOS = [
  { estado: 'PENDIENTE', n: 34 },
  { estado: 'CLASIFICADO', n: 61 },
  { estado: 'CONTABILIZADO', n: 30 },
  { estado: 'REVISION', n: 3 },
]
const LISTA = {
  ok: true,
  total: 128,
  sumas: { n: 128, neto: 42310000, iva: 8038900, total: 50348900 },
  estados: ESTADOS,
  documentos: DOCS,
}

// ---------- sandbox ----------

/** Elemento DOM mínimo con innerHTML observable (mismo patrón que ux-unificacion). */
function crearSandbox({ permisos = ['documentos:ver', 'documentos:clasificar', 'reglas:ver', 'cuentas:ver'], fixture = () => LISTA } = {}) {
  const htmls = []
  const urls = []
  const reemplazos = []
  const el = () => {
    let html = ''
    let texto = ''
    const e = {
      tagName: 'DIV', id: '', className: '', value: '', disabled: false,
      checked: false, href: '', src: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { return c }, remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => el(), querySelectorAll: () => [],
      closest: () => null,
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0, height: 0 }),
    }
    Object.defineProperty(e, 'innerHTML', {
      get: () => html,
      set(v) { html = String(v); htmls.push(html) },
    })
    // shared/format.js implementa escapeHtml() con un div real: textContent
    // entra y el HTML escapado sale por innerHTML. Se emula para que `esc()`
    // no devuelva vacío dentro del sandbox (como ocurriría con un stub plano).
    Object.defineProperty(e, 'textContent', {
      get: () => texto,
      set(v) {
        texto = v == null ? '' : String(v)
        html = texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
      },
    })
    return e
  }

  const location = { href: 't://x/sistema/#', origin: 't://x', pathname: '/sistema/', search: '', hash: '#', replace() {}, assign() {} }
  const documentStub = {
    getElementById: () => el(),
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(),
    activeElement: null,
    readyState: 'complete',
  }
  const store = {
    getItem: (k) => (k === 'iva_periodo_activo' ? '202609' : null),
    setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0,
  }
  const sandbox = {
    document: documentStub,
    window: {},
    location,
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async () => {} } },
    localStorage: store, sessionStorage: store,
    history: {
      pushState() {},
      replaceState(_a, _b, url) { reemplazos.push(url); location.hash = url },
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
    return JSON.parse(JSON.stringify(fixture(String(url))))
  }
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    return { ok: true, evaluados: 37, clasificados: 30, sin_regla: [1, 2, 3, 4, 5, 6, 7] }
  }
  sandbox.apiPut = async () => { throw new Error('no usado') }
  sandbox.apiDelete = async () => { throw new Error('no usado') }
  sandbox.iniciarPolling = () => () => {}
  sandbox.showToast = () => {}
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const bundle = [
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    lee(path.join(FRONT, 'sistema', 'views-fiscal.js')),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76.543.210-3", nombre: "Comercial Andes SpA" }',
    '  S.user = { id: 1, username: "tester" }',
    `  S.permisos = new Set(${JSON.stringify(permisos)})`,
    '  S.superAdmin = false',
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)

  return { sandbox, htmls, urls, reemplazos, location, el }
}

const urlDocs = (env, ultima = false) => {
  const lista = env.urls.filter((u) => u.includes('/documentos?') && !u.startsWith('POST'))
  return ultima ? lista[lista.length - 1] : lista[0]
}

function render(env) {
  // El contenedor es el elemento observable del sandbox: así el HTML de la
  // vista (chips, toolbar, resumen) entra en htmls, igual que lo hace el DOM real.
  return env.sandbox.window.VIEWS.documentos.render(env.el())
}

// ---------- B1 / B4: período, paginación de servidor y URL ----------
test('B1: pide el período global con limit/offset de servidor y refleja filtros en la URL', async () => {
  const env = crearSandbox()
  await render(env)
  const url = urlDocs(env)
  assert.ok(url, 'consulta la bandeja')
  assert.match(url, /periodo=202609/, 'usa el período global (no lista todos los períodos)')
  assert.match(url, /limit=50/, 'página de 50 en el servidor')
  assert.match(url, /offset=0/, 'primera página')
  assert.match(url, /estado=PENDIENTE/, 'filtro por defecto conservado')
  assert.ok(!/limit=300/.test(fuenteVista), 'eliminado el límite fijo de 300')

  // Cambiar de filtro empuja la URL (replaceState) sin recargar la vista.
  env.sandbox.window._docFiltros = { estado: '', flujo: 'venta', tipo: '61', texto: '', rut: '', pagina: 1 }
  await render(env)
  const url2 = urlDocs(env, true)
  assert.match(url2, /tipo_flujo=venta/)
  assert.match(url2, /tipo_doc=61/)
  assert.ok(!/estado=/.test(url2) || /estado=&/.test(url2) || /estado=$/.test(url2), 'estado vacío = Todos')

  // La URL es la fuente del filtro (compartible/atrás); el hash conserva
  // "Todos" aunque el estado vaya vacío, para no volver a PENDIENTE.
  const hash = env.sandbox.docHash({ estado: '', flujo: 'venta', tipo: '', cuenta: '', texto: '', rut: '', pagina: 2 })
  assert.match(hash, /^#documentos\?/)
  assert.match(hash, /flujo=venta/)
  assert.match(hash, /p=2/)
  assert.match(hash, /(^|[?&])estado=/, 'el estado vacío también se serializa')
  env.sandbox.docSincronizarURL({ estado: 'REVISION', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', pagina: 1 })
  assert.strictEqual(env.reemplazos[0], env.location.hash, 'replaceState deja la URL sincronizada')
  assert.match(env.location.hash, /estado=REVISION/)

  // ?p= ilegible no debe dejar la página en NaN (el fetch saldría con offset NaN).
  env.location.hash = '#documentos?p=abc'
  assert.strictEqual(env.sandbox.docFiltrosDeURL().pagina, 1)
  env.location.hash = '#documentos?p=3'
  assert.strictEqual(env.sandbox.docFiltrosDeURL().pagina, 3)
})

test('B4: página 2 pide offset 50 y conserva el estado', async () => {
  const env = crearSandbox()
  env.location.hash = '#documentos?estado=CONTABILIZADO&p=2'
  await render(env)
  const url = urlDocs(env)
  assert.match(url, /offset=50/)
  assert.match(url, /estado=CONTABILIZADO/)
})

// ---------- B2: estado canónico ----------
test('B2: REVISION es el estado canónico y "REVISIÓN" legado se normaliza', async () => {
  assert.strictEqual(vm.runInContext('docEstadoCanonico("REVISIÓN")', crearSandbox().sandbox), 'REVISION')
  assert.strictEqual(vm.runInContext('docEstadoCanonico("REVISION")', crearSandbox().sandbox), 'REVISION')

  const env = crearSandbox()
  env.sandbox.window._docFiltros = { estado: 'REVISIÓN', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', pagina: 1 }
  await render(env)
  const url = urlDocs(env)
  assert.match(url, /estado=REVISION/, 'pide el valor que el backend conoce')
  assert.ok(!/REVISI/.test(decodeURIComponent(url).replace('REVISION', '')), 'no viaja la grafía con tilde')

  const html = env.htmls.join('')
  assert.match(html, /data-est="REVISION"/, 'chip con el valor real')
  assert.match(html, /Revisión/, 'etiqueta visible se mantiene')
  assert.ok(!/data-est="REVISIÓN"/.test(html), 'no queda el chip roto')
  // PROPUESTO lo escribe el motor de propuestas: necesita chip propio o esos
  // documentos solo aparecen en "Todos" sin conteo visible.
  assert.match(html, /data-est="PROPUESTO"/, 'chip para el estado PROPUESTO')
  assert.match(html, /Propuestos/)
})

// ---------- B3: totales y conteos del servidor ----------
test('B3: totales del filtro completo (sumas), no la suma de la página', async () => {
  const env = crearSandbox()
  await render(env)
  const html = env.htmls.join('')
  // sumas del backend: neto 42.310.000 / IVA 8.038.900 / total 50.348.900
  assert.match(html, /\$50\.348\.900/, 'total del filtro visible')
  assert.match(html, /\$42\.310\.000/, 'neto del filtro visible')
  assert.match(html, /\$8\.038\.900/, 'IVA del filtro visible')
  assert.match(html, /128/, 'cantidad total del filtro')
  // la página suma 119.000 + 238.000 = 357.000: no debe presentarse como total
  assert.ok(!html.includes('$357.000'), 'no se suman solo las filas cargadas')
  assert.match(html, /Totales del filtro/)
  assert.match(html, /no es la suma de esta página/)
  assert.match(html, /las NC restan/, 'aclara por qué el pie no calza con las filas de NC')
})

test('B3c: cabecera, filas y pie cubren las mismas columnas (RUT incluido)', async () => {
  const env = crearSandbox()
  await render(env)
  const html = env.htmls.join('\n')

  // Cada innerHTML se captura por separado (cabecera, cuerpo, pie): se toma
  // el fragmento que corresponde a cada uno para no cruzar filas de tablas
  // distintas (el esqueleto también emite <tr>).
  const fragmentoHead = env.htmls.find((h) => h.includes('<thead>'))
  assert.ok(fragmentoHead, 'la tabla pinta cabecera')
  const thead = fragmentoHead.slice(fragmentoHead.indexOf('<thead>'), fragmentoHead.indexOf('</thead>'))
  const ths = (thead.match(/<th\b/g) || []).length

  const fragmentoCuerpo = env.htmls.find((h) => h.includes('data-doc="11"'))
  assert.ok(fragmentoCuerpo, 'la fila del documento se renderiza')
  const fila = fragmentoCuerpo.match(/<tr tabindex="0" data-doc="11">([\s\S]*?)<\/tr>/)
  assert.ok(fila, 'la primera fila está completa')
  const tds = (fila[1].match(/<td\b/g) || []).length
  assert.strictEqual(tds, ths, `la fila debe traer ${ths} celdas (trae ${tds})`)

  const fragmentoPie = env.htmls.find((h) => h.includes('Totales del filtro'))
  assert.ok(fragmentoPie, 'el pie de totales se renderiza')
  const pie = fragmentoPie.match(/<tr>([\s\S]*?)<\/tr>/)
  assert.ok(pie, 'la fila de totales está completa')
  let celdasPie = 0
  for (const m of pie[1].matchAll(/<td\b([^>]*)>/g)) {
    const colspan = m[1].match(/colspan="(\d+)"/)
    celdasPie += colspan ? Number(colspan[1]) : 1
  }
  assert.strictEqual(celdasPie, ths, `el pie debe cubrir ${ths} columnas (cubre ${celdasPie})`)

  // El orden importa: si la celda del RUT vuelve a faltar, los montos se
  // corren una columna y el usuario lee el neto bajo "RUT".
  const etiquetas = [...thead.matchAll(/data-k="([^"]+)"/g)].map((m) => m[1])
  assert.deepStrictEqual(etiquetas, [
    'tipo_doc', 'folio', 'fecha_docto', 'razon_social', 'rut_contraparte',
    'monto_neto', 'monto_iva', 'monto_total', 'estado', 'cuenta', 'acciones',
  ])
  assert.match(fila[1], /76\.543\.210-3/, 'la contraparte expone su RUT en su propia celda')
})

test('B3b: los conteos por estado se leen de r.estados con el estado canónico', () => {
  assert.match(fuenteVista, /Object\.fromEntries\(\(r\.estados \|\| \[\]\)\.map\(\(e\) => \[e\.estado, Number\(e\.n\) \|\| 0\]\)\)/)
  assert.match(fuenteVista, /docEstadoCanonico\(n\.dataset\.n\)/, 'los chips buscan REVISION, no REVISIÓN')
})

// ---------- B5: permisos ----------
test('B5: sin documentos:clasificar no hay escritura ni acción masiva', async () => {
  const env = crearSandbox({ permisos: ['documentos:ver', 'reglas:ver', 'cuentas:ver'] })
  await render(env)
  const html = env.htmls.join('')
  assert.ok(!html.includes('data-clas='), 'sin botón Clasificar por fila')
  assert.ok(!html.includes('id="doc-auto"'), 'sin clasificación automática')
  assert.ok(!/Anular documento/.test(html), 'sin anulación')
  assert.match(html, /solo lectura/, 'el rol se explica')
})

test('B5b: con permiso, Clasificar solo aparece en estados que lo admiten', async () => {
  const env = crearSandbox()
  await render(env)
  const html = env.htmls.join('')
  const botones = html.match(/data-clas="\d+"/g) || []
  assert.strictEqual(botones.length, 1, 'PENDIENTE sí, CONTABILIZADO no')
  assert.match(html, /data-clas="11"/)
  assert.ok(!/data-clas="12"/.test(html))
})

// ---------- B7: exportación honesta ----------
test('B7: exportar el filtro completo pide 1000 y advierte si el total lo supera', async () => {
  const milFilas = Array.from({ length: 1000 }, (_, i) => ({ ...DOCS[0], id: i + 1 }))
  const env = crearSandbox({ fixture: () => ({ ok: true, total: 1500, sumas: LISTA.sumas, estados: ESTADOS, documentos: milFilas }) })
  await env.sandbox.modalExportar({ estado: '', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', pagina: 1 })
  const pedido = urlDocs(env)
  assert.match(pedido, /limit=1000/)
  assert.match(pedido, /offset=0/)
  const html = env.htmls.join('')
  assert.match(html, /1500/, 'declara el total real del filtro')
  assert.match(html, /1000/, 'declara cuántas se exportan')
  assert.match(html, /no el total/, 'no presenta la exportación como completa')
  assert.match(fuenteVista, /DOC_LIMITE_EXPORT = 1000/, 'el tope es explícito en el código')
})

// ---------- B8: clasificación automática con alcance ----------
test('B8: clasificar automático muestra empresa, período y alcance antes de ejecutar', async () => {
  const env = crearSandbox()
  await env.sandbox.modalAutoClasificar({ estado: 'PENDIENTE', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', pagina: 1 })
  const alcanceUrl = urlDocs(env)
  assert.match(alcanceUrl, /limit=1/, 'consulta liviana de alcance')
  assert.match(alcanceUrl, /periodo=202609/)
  const html = env.htmls.join('')
  assert.match(html, /Comercial Andes SpA/)
  assert.match(html, /septiembre 2026/i)
  assert.match(html, /37/, 'PENDIENTE (34) + REVISION (3)')
  assert.match(html, /PENDIENTE \+ REVISIÓN/)
  assert.ok(/periodo,\n\s*tipo_flujo: f\.flujo/.test(fuenteVista), 'el POST ya no manda periodo: null')
})

test('B8b: la anulación exige motivo y confirmación', () => {
  assert.match(fuenteVista, /id="an-motivo"/)
  assert.match(fuenteVista, /ok\.disabled = !motivo\.value\.trim\(\)/, 'sin motivo no se puede confirmar')
  assert.match(fuenteVista, /\/documentos\/\$\{d\.id\}\/anular/, 'endpoint existente, sin cambios')
  assert.match(fuenteVista, /no se puede deshacer/)
})

// ---------- B9: contratos ----------
test('B9: conserva IDs, anchors, modales, permisos y endpoints', () => {
  for (const token of [
    'VIEWS.documentos',
    'id="doc-tabla"',
    'id="doc-auto"',
    'id="doc-reglas"',
    'data-est=',
    'data-clas=',
    'cl-cuenta', 'cl-cc', 'cl-iva', 'cl-recordar', 'cl-save',
    'modalClasificar', 'modalReglas',
    'refrescarPillDocs()',
    'documentos:clasificar',
    'documentos:ingestar',
    '/documentos/clasificar-automatico',
    '/documentos/${docId}/clasificar',
  ]) {
    assert.ok(fuenteVista.includes(token), `falta ${token}`)
  }
  assert.ok(!/backend\/|migraciones|detalle_sii.*INSERT/i.test(fuenteVista), '')
})

test('B9b: no se tocaron endpoints ni se agregaron llamadas nuevas al backend', () => {
  const rutas = [...fuenteVista.matchAll(/api(Get|Post)\(`([^`]+)`/g)].map((m) => m[2])
  const documentos = rutas.filter((r) => r.includes('/documentos') || r.includes('/reglas'))
  for (const r of documentos) {
    assert.ok(/\/api\/contable\/empresas\/\$\{(eid|S\.empresa\.id)\}\/(documentos|reglas)/.test(r), `ruta inesperada: ${r}`)
  }
})

// ---------- B11: estados de interfaz ----------
test('B11: error de red muestra el estado de error con botón de reintento', async () => {
  const env = crearSandbox({ fixture: (url) => { if (url.includes('/documentos?')) throw new Error('sin conexión con el servidor'); return {} } })
  await render(env)
  const html = env.htmls.join('')
  assert.match(html, /ui-error/, 'usa el estado de error compartido (UIEstado.error)')
  assert.match(html, /sin conexión con el servidor/, 'muestra el mensaje real del backend')
  assert.match(html, /id="doc-reintentar"/, 'ofrece reintentar')
  assert.match(fuenteVista, /getElementById\('doc-reintentar'\)\?\.addEventListener\('click', \(\) => cargar\(\)\)/, 'reintentar repite la consulta')
  // El resumen se reescribe por textContent (no por innerHTML), por eso se
  // verifica en la fuente: no queda mostrando cifras de una carga que falló.
  assert.match(fuenteVista, /resumen.textContent = 'No se pudieron cargar los documentos.'/, 'el resumen no queda mintiendo')
})

test('B11b: distingue "sin datos del período" de "sin resultados del filtro"', async () => {
  const vacio = { ok: true, total: 0, sumas: { n: 0, neto: 0, iva: 0, total: 0 }, estados: [], documentos: [] }
  // Período CON documentos, pero ninguno en el estado pedido: `estados` los
  // reporta (ignora el filtro de estado) y el vacío debe hablar del filtro.
  const soloOtrosEstados = { ok: true, total: 0, sumas: { n: 0, neto: 0, iva: 0, total: 0 }, estados: [{ estado: 'CONTABILIZADO', n: 3 }], documentos: [] }

  // Caso real que estaba roto: período vacío con el chip por defecto
  // (PENDIENTE), que antes se leía como "filtro sin resultados".
  const sinDatos = crearSandbox({ permisos: ['documentos:ver', 'documentos:ingestar'], fixture: () => vacio })
  await render(sinDatos)
  const htmlSinDatos = sinDatos.htmls.join('')
  assert.match(htmlSinDatos, /Aún no hay documentos en/, 'explica que el período está vacío')
  assert.match(htmlSinDatos, /Ir a Libros a sincronizar/, 'con permiso de ingesta ofrece el camino')
  assert.ok(!htmlSinDatos.includes('doc-vacio-limpiar'), 'no ofrece limpiar filtros si no hay filtros')

  // El mismo período vacío con "Todos" seleccionado.
  const sinDatosTodos = crearSandbox({ permisos: ['documentos:ver', 'documentos:ingestar'], fixture: () => vacio })
  sinDatosTodos.sandbox.window._docFiltros = { estado: '', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', pagina: 1 }
  await render(sinDatosTodos)
  assert.match(sinDatosTodos.htmls.join(''), /Aún no hay documentos en/, 'también con Todos')

  const sinResultados = crearSandbox({ fixture: () => soloOtrosEstados })
  await render(sinResultados) // estado por defecto PENDIENTE = hay filtro
  const htmlSinResultados = sinResultados.htmls.join('')
  assert.match(htmlSinResultados, /Ningún documento coincide con estos filtros/)
  assert.match(htmlSinResultados, /id="doc-vacio-limpiar"/, 'ofrece limpiar los filtros')
  assert.ok(!htmlSinResultados.includes('Ir a Libros a sincronizar'), 'no manda a sincronizar un período que sí tiene documentos')
})

test('B11c: carga con esqueleto y sin bloquear la vista (aria-busy)', async () => {
  const env = crearSandbox()
  await render(env)
  assert.match(env.htmls.join(''), /doc-skel/, 'esqueleto en la primera carga')
  assert.match(fuenteVista, /setAttribute\?\.\('aria-busy', 'true'\)/, 'la tabla se marca ocupada mientras consulta')
  assert.match(fuenteVista, /removeAttribute\?\.\('aria-busy'\)/, 'y se libera al terminar')
})

// ---------- B10: accesibilidad y compatibilidad de UITabla ----------
test('B10: accesibilidad de tabla, resumen y panel', () => {
  assert.match(fuenteTabla, /caption class="sr-only"/)
  assert.match(fuenteTabla, /aria-sort/)
  // El scroll horizontal debe ser alcanzable por teclado (región enfocable).
  assert.match(fuenteTabla, /<div class="tbl-wrap" tabindex="0" role="region" aria-label=/)
  assert.match(fuenteCss, /tbl-wrap:focus-visible/, 'foco visible en el contenedor')
  assert.match(fuenteVista, /aria-live="polite"/, 'el resumen anuncia cambios')
  assert.match(fuenteVista, /role="dialog" aria-modal="true"/, 'detalle como diálogo')
  assert.match(fuenteVista, /tabindex="0" data-doc=/, 'fila alcanzable por teclado')
  assert.match(fuenteVista, /aria-pressed/, 'chips de estado con estado accesible')
  assert.match(fuenteVista, /aria-label="Más acciones/, 'menú con etiqueta')
})

test('B10c: con paginación de servidor el orden es de página (aria-sort honesto)', () => {
  const env = crearSandbox()
  const mount = env.el()
  env.sandbox.UITabla.montar({
    mount,
    columnas: [{ key: 'a', label: 'A', num: true }],
    filas: [{ a: 2 }, { a: 1 }],
    filaHTML: (f) => `<tr><td>${f.a}</td></tr>`,
    servidor: { total: 120, pagina: 1, paginas: 3, onPagina() {} },
  })
  assert.match(mount.innerHTML, /data-k="a" aria-sort="none" title="Ordenar solo esta página"/, 'no anuncia orden global')
  assert.match(String(fuenteTabla), /!st\.servidor && th\.dataset\.k === st\.sortKey/, 'aria-sort solo fuera del modo servidor')
})

test('B10b: UITabla sigue igual para las demás vistas (opciones aditivas)', () => {
  const env = crearSandbox()
  const mount = env.el()
  env.sandbox.UITabla.montar({
    mount,
    columnas: [{ key: 'a', label: 'A' }],
    filas: [{ a: 1 }],
    filaHTML: (f) => `<tr><td>${f.a}</td></tr>`,
    vacio: 'sin datos',
  })
  assert.match(mount.innerHTML, /type="search"/, 'búsqueda local por defecto intacta')
  assert.match(mount.innerHTML, /placeholder="Buscar…"/, 'el placeholder de las demás vistas no cambia')
  assert.match(mount.innerHTML, /aria-label="Buscar en la tabla"/, 'la etiqueta accesible se mantiene')
  assert.match(env.htmls.join(''), /<tr><td>1<\/td><\/tr>/, 'el cuerpo se pinta igual que antes')
  assert.match(mount.innerHTML, /CSV/)
  // La columna de acciones no debe viajar a CSV/Excel/Copiar.
  assert.match(fuenteTabla, /const columnasExportables = \(st\) => st\.columnas\.filter\(\(c\) => c\.exportable !== false\)/)
  assert.match(fuenteVista, /key: 'acciones'[^}]*exportable: false/)
  assert.strictEqual(typeof env.sandbox.UITabla.exportar, 'function', 'API de exportación añadida')

  const sinBusqueda = env.el()
  env.sandbox.UITabla.montar({
    mount: sinBusqueda,
    busqueda: false,
    columnas: [{ key: 'a', label: 'A' }],
    filas: [],
    filaHTML: () => '',
    vacio: 'sin datos',
  })
  assert.ok(!sinBusqueda.innerHTML.includes('type="search"'), 'se puede omitir la búsqueda local')
})
