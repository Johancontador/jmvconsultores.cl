'use strict'
/**
 * F0 · CONTRATOS DE NAVEGACIÓN — golden files de los 50 anchors.
 *
 * La suite de 634 pruebas no cubría el ROUTER del SPA: ninguna comprobaba que
 * una ruta resolviera SU identidad (título, breadcrumb, sección) y SUS permisos.
 * Ese hueco dejó pasar RK-21: los 6 reportes del Centro de Reportes (#balance8,
 * #clasificado, #comprobacion, #niif, #resultados, #situacion) no tienen entrada
 * en el MENU, así que `renderRoute` caía a `TODOS_LOS_ITEMS[0]` (Inicio): el
 * título decía «Panel del período», el breadcrumb apuntaba a otra sección y
 * `route.permiso` era null → el gate de UI no bloqueaba nada. El backend sí
 * devolvía 403 (autoridad real intacta), pero la pantalla mentía.
 *
 * Qué fija este archivo (contratos de COMPORTAMIENTO, no HTML completo):
 *  T1 — coherencia del golden con el código: MENU + RUTAS_FUERA_DE_MENU y el
 *       catálogo de VIEWS cubren exactamente los mismos 50 anchors.
 *  T2 — identidad de ruta: cada anchor resuelve su título, su breadcrumb con
 *       su sección y marca exactamente un ítem de menú como activo.
 *  T3 — accesibilidad por rol derivada del RBAC real (5 roles × 50 rutas):
 *       el gate de UI se activa si y solo si el rol carece de la capacidad.
 *  T4 — rutas desconocidas y query de vista conservada (#balance8?periodo=…).
 *  T5 — cada vista fuera de menú declara la MISMA capacidad que exige su
 *       endpoint real en el backend (no se inventa un permiso de UI).
 *  T6 — RK-21 explícito: las 6 vistas de reportes ya no se presentan como Inicio.
 *
 * El sandbox reemplaza `render` por un stub: lo que se prueba es el ROUTER
 * (identidad/permiso/navegación). El render real de las 49 vistas ya lo cubre
 * test/ux-unificacion.test.js (T5/T5b, sin ReferenceError en render).
 * El golden vive en test/fixtures/navegacion-anchors.json.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')

const FRONT = path.resolve(__dirname, '../frontend')
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'navegacion-anchors.json')
const GOLDEN = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'))
const { permisosDeRol, CATALOGO_CAPACIDADES } = require('../backend/core/permisos')

// Igual que ux-unificacion: las vistas disparan asyncs fire-and-forget que en
// el navegador son solo errores de consola; no deben tumbar el runner.
process.on('unhandledRejection', () => {})

/* ---------- sandbox del shell (documento con registro por id) ---------- */

function crearShell() {
  const porId = new Map()
  const activos = new Set()
  const navAnchors = []

  // `escapeHtml` de shared/format.js usa el truco `div.textContent = s; div.innerHTML`:
  // el stub debe reproducirlo (si no, esc() devuelve '' y todo texto visible —
  // títulos de sección, breadcrumb, etiquetas — se pierde en el sandbox).
  const escapar = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const el = (id = '') => {
    const e = {
      tagName: 'DIV', id, className: '', textContent: '', value: '', hidden: false,
      checked: false, href: '', src: '', dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {},
      appendChild(c) { return c }, remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      querySelector: () => el(), querySelectorAll: () => [],
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
    }
    let html = null
    Object.defineProperty(e, 'innerHTML', {
      get: () => (html === null ? escapar(e.textContent) : html),
      set(v) { html = String(v) },
    })
    return e
  }

  const documentStub = {
    // REGISTRO por id: el router escribe título/breadcrumb/vista en nodos
    // distintos del mismo id a lo largo de la sesión; devolver un nodo nuevo en
    // cada llamada (como hace el stub de ux-unificacion) haría invisibles esas
    // escrituras para el test.
    getElementById: (id) => { if (!porId.has(id)) porId.set(id, el(id)); return porId.get(id) },
    querySelector: () => el(),
    querySelectorAll: (sel) => (sel === '#sys-nav a' ? navAnchors : []),
    createElement: (t) => el(t),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(), readyState: 'complete',
  }
  // Un <a> por cada ítem de menú: el router hace classList.toggle('active').
  const store = () => ({ getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 })
  const sandbox = {
    document: documentStub,
    window: {},
    location: { href: 't://x/sistema/', origin: 't://x', pathname: '/sistema/', search: '', hash: '#inicio', replace() {}, assign() {} },
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
  sandbox.apiGet = async () => ({})
  sandbox.apiPost = async () => ({})
  sandbox.apiPut = async () => ({})
  sandbox.apiDelete = async () => ({})
  sandbox.iniciarPolling = () => () => {}
  vm.createContext(sandbox)

  const lee = (f) => ';' + fs.readFileSync(path.resolve(f), 'utf8')
  const vistas = fs.readdirSync(path.join(FRONT, 'sistema')).filter((f) => f.startsWith('views-') && f.endsWith('.js')).sort()
  const bundle = [
    lee(path.join(FRONT, 'sistema', 'url-estado.js')),
    lee(path.join(FRONT, 'shared', 'format.js')),
    lee(path.join(FRONT, 'shared', 'uitoolkit.js')),
    lee(path.join(FRONT, 'sistema', 'ui.js')),
    lee(path.join(FRONT, 'sistema', 'app.js')),
    ...vistas.map((f) => lee(path.join(FRONT, 'sistema', f))),
    // Hook de inspección: los `const` top-level de app.js (MENU, S, …) no son
    // propiedades del global, así que el test los expone desde dentro del script.
    ';(() => { globalThis.__nav = { MENU, TODOS_LOS_ITEMS, RUTAS_FUERA_DE_MENU, breadcrumbHTML, renderRoute, VIEWS, S } })()',
    ';1',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox, { filename: 'shell-jmv.js' })

  const nav = sandbox.__nav
  assert.ok(nav && Array.isArray(nav.MENU), 'el sandbox expuso MENU (hook __nav)')

  // Un <a data-route> por ítem de menú, para observar el marcado de activo.
  for (const item of nav.TODOS_LOS_ITEMS) {
    navAnchors.push({
      dataset: { route: item.key },
      setAttribute() {}, removeAttribute() {},
      classList: {
        toggle(clase, on) {
          if (clase !== 'active') return
          if (on) activos.add(item.key)
          else activos.delete(item.key)
        },
      },
    })
  }

  // Identidad del shell: usuario + empresa activa. `render` se stubea por vista.
  nav.S.user = { id: 1, nombre: 'Test' }
  nav.S.empresas = [{ id: 1, rut: '76000000-0', nombre: 'Empresa Test' }]
  nav.S.empresa = nav.S.empresas[0]
  for (const key of Object.keys(nav.VIEWS)) {
    const vista = nav.VIEWS[key]
    if (vista && typeof vista === 'object') vista.render = async (cont) => { cont.innerHTML = '<div class="stub-vista">ok</div>' }
  }

  /** Renderiza `#key` con las capacidades dadas y devuelve lo que ve el usuario. */
  function render(key, capacidades) {
    nav.S.permisos = new Set(capacidades)
    activos.clear()
    sandbox.location.hash = `#${key}`
    nav.renderRoute()
    return {
      titulo: documentStub.getElementById('sys-title').textContent,
      breadcrumb: documentStub.getElementById('sys-breadcrumb').innerHTML,
      vista: documentStub.getElementById('sys-view').innerHTML,
      activos: new Set(activos),
    }
  }

  return { sandbox, nav, document: documentStub, render, activos, navAnchors }
}

const shell = crearShell()
const { nav, render } = shell
const TODAS = Object.keys(CATALOGO_CAPACIDADES)
const TODOS_LOS_ANCHORS = [...GOLDEN.anchors, ...GOLDEN.rutas_fuera_de_menu]
const BLOQUEADO = /no tiene permiso para esta sección/

/* ---------- T1: golden ↔ código ---------- */

test('T1: el golden y el código cubren los mismos 50 anchors (44 de menú + 6 de reportes)', () => {
  assert.strictEqual(GOLDEN.anchors.length, 44, 'anchors con entrada de menú')
  assert.strictEqual(GOLDEN.rutas_fuera_de_menu.length, 6, 'vistas alcanzables sin menú')
  assert.strictEqual(TODOS_LOS_ANCHORS.length, 50, '50 anchors en total')

  // MENU real == golden (keys, etiquetas, sección y capacidad).
  // JSON round-trip: los objetos vienen de otro realm (vm) y deepStrictEqual
  // compara prototipos además de valores.
  const delMenu = JSON.parse(JSON.stringify(nav.TODOS_LOS_ITEMS.map((i) => {
    const sec = nav.MENU.find((m) => m.items.includes(i))
    return { key: i.key, label: i.label, seccion: sec.seccion, permiso: i.permiso ?? null }
  })))
  assert.deepStrictEqual(delMenu, GOLDEN.anchors.map(({ key, label, seccion, permiso }) => ({ key, label, seccion, permiso })))

  // Rutas fuera de menú: misma identidad declarada.
  const fuera = JSON.parse(JSON.stringify(Object.values(nav.RUTAS_FUERA_DE_MENU)
    .map(({ key, label, seccion, permiso }) => ({ key, label, seccion, permiso }))))
  assert.deepStrictEqual(fuera, GOLDEN.rutas_fuera_de_menu.map(({ key, label, seccion, permiso }) => ({ key, label, seccion, permiso })))

  // CERO VISTAS HUÉRFANAS: toda VIEWS registrada es alcanzable por anchor, y
  // todo anchor del golden tiene su vista (nada inventado en el menú).
  const vistas = Object.keys(nav.VIEWS).sort()
  const anchors = TODOS_LOS_ANCHORS.map((a) => a.key).sort()
  assert.deepStrictEqual(vistas, anchors, 'VIEWS y anchors son el mismo conjunto')
  assert.strictEqual(new Set(anchors).size, anchors.length, 'sin anchors duplicados')
})

/* ---------- T2: identidad de ruta ---------- */

test('T2: cada anchor resuelve su título, su sección en el breadcrumb y un único ítem activo', () => {
  const fallas = []
  for (const anchor of TODOS_LOS_ANCHORS) {
    const v = render(anchor.key, TODAS)
    const esperado = nav.VIEWS[anchor.key].titulo
    if (v.titulo !== esperado) fallas.push(`${anchor.key}: título «${v.titulo}» ≠ «${esperado}»`)
    if (!v.breadcrumb.includes(anchor.label)) fallas.push(`${anchor.key}: breadcrumb sin la etiqueta «${anchor.label}»`)
    if (!v.breadcrumb.includes(anchor.seccion)) fallas.push(`${anchor.key}: breadcrumb sin la sección «${anchor.seccion}»`)
    if (BLOQUEADO.test(v.vista)) fallas.push(`${anchor.key}: bloqueado con TODAS las capacidades`)
    const esDeMenu = anchor.origen === undefined
    if (esDeMenu && !v.activos.has(anchor.key)) fallas.push(`${anchor.key}: no marcó su ítem de menú como activo`)
    if (!esDeMenu && v.activos.size !== 0) fallas.push(`${anchor.key}: vista sin menú marcó ${[...v.activos].join(',')} como activo`)
  }
  assert.deepStrictEqual(fallas, [], fallas.join(' | '))
})

/* ---------- T3: accesibilidad por rol (RBAC real) ---------- */

test('T3: el gate de UI coincide con el RBAC — 5 roles × 49 rutas (bloqueado si y solo si falta la capacidad)', () => {
  const fallas = []
  for (const rol of GOLDEN.roles) {
    const capacidades = permisosDeRol(rol)
    for (const anchor of TODOS_LOS_ANCHORS) {
      const deberiaPasar = anchor.roles_ok.includes(rol)
      const v = render(anchor.key, capacidades)
      const bloqueado = BLOQUEADO.test(v.vista)
      if (deberiaPasar && bloqueado) fallas.push(`${rol} · ${anchor.key}: bloqueado aunque tiene ${anchor.permiso}`)
      if (!deberiaPasar && !bloqueado) fallas.push(`${rol} · ${anchor.key}: renderizado sin ${anchor.permiso}`)
    }
  }
  assert.deepStrictEqual(fallas, [], fallas.join(' | '))

  // CONTROL negativo: sin capacidades, TODA ruta con permiso queda bloqueada y
  // las rutas sin permiso (null) siguen abiertas. Si el gate dependiera del
  // ítem de menú, las 6 vistas fuera de menú pasarían siempre.
  for (const anchor of TODOS_LOS_ANCHORS) {
    const b = BLOQUEADO.test(render(anchor.key, []).vista)
    assert.strictEqual(b, Boolean(anchor.permiso), `${anchor.key}: gate sin capacidades`)
  }
})

/* ---------- T4: rutas desconocidas y query ---------- */

test('T4: ruta desconocida → Inicio (sin pantalla rota) y la query de la vista se conserva', () => {
  const desconocida = render('ruta-que-no-existe', TODAS)
  assert.strictEqual(desconocida.titulo, nav.VIEWS.inicio.titulo, 'ruta desconocida aterriza en Inicio')
  assert.ok(!BLOQUEADO.test(desconocida.vista), 'una ruta desconocida no muestra «sin permiso»')

  // `#vista?filtro=…` es estado de la ruta: no puede expulsar a Inicio.
  const v = render('balance8?periodo=202601&empresa=1', TODAS)
  assert.strictEqual(v.titulo, nav.VIEWS.balance8.titulo, 'la query no cambia la ruta resuelta')
})

/* ---------- T5: el permiso de la vista = el permiso de su endpoint ---------- */

test('T5: cada vista fuera de menú declara la capacidad que exige su endpoint real', () => {
  // Endpoint verificado por vista (backend/routes/reportes.js y routes/niif.js).
  const ENDPOINTS = {
    balance8: { archivo: 'reportes.js', ruta: '/empresas/:empresaId/reportes/balance8/:periodo' },
    clasificado: { archivo: 'reportes.js', ruta: '/empresas/:empresaId/reportes/clasificado/:periodo' },
    comprobacion: { archivo: 'reportes.js', ruta: '/empresas/:empresaId/reportes/balance/:periodo' },
    situacion: { archivo: 'reportes.js', ruta: '/empresas/:empresaId/reportes/situacion/:periodo' },
    resultados: { archivo: 'reportes.js', ruta: '/empresas/:empresaId/reportes/resultados/:periodo' },
    niif: { archivo: 'niif.js', ruta: '/empresas/:empresaId/niif/situacion/:periodo' },
  }
  const fallas = []
  for (const ruta of GOLDEN.rutas_fuera_de_menu) {
    if (!CATALOGO_CAPACIDADES[ruta.permiso]) {
      fallas.push(`${ruta.key}: la capacidad '${ruta.permiso}' no existe en el RBAC`)
      continue
    }
    const spec = ENDPOINTS[ruta.key]
    if (!spec) { fallas.push(`${ruta.key}: sin endpoint declarado en el test`); continue }
    const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'routes', spec.archivo), 'utf8')
    const i = src.indexOf(spec.ruta)
    if (i < 0) { fallas.push(`${ruta.key}: el endpoint ${spec.ruta} ya no existe en ${spec.archivo}`); continue }
    const linea = src.slice(i, src.indexOf('\n', i))
    if (!linea.includes(`requirePermiso('${ruta.permiso}')`)) {
      fallas.push(`${ruta.key}: el endpoint exige otra capacidad que la declarada (${ruta.permiso})`)
    }
  }
  assert.deepStrictEqual(fallas, [], fallas.join(' | '))
})

/* ---------- T6: RK-21 ---------- */

test('RK-21: las 6 vistas del Centro de Reportes ya no se presentan con la identidad de Inicio', () => {
  const afectadas = ['balance8', 'clasificado', 'comprobacion', 'niif', 'resultados', 'situacion']
  for (const key of afectadas) {
    const v = render(key, TODAS)
    assert.notStrictEqual(v.titulo, nav.VIEWS.inicio.titulo, `${key} no debe heredar el título de Inicio`)
    // F3: la sección del breadcrumb es la MISMA área del menú («Informes»).
    // Antes decía «Informes y control», un rótulo que ya no existe en el
    // sidebar desde la reorganización en áreas, así que el breadcrumb nombraba
    // una sección inexistente.
    assert.ok(v.breadcrumb.includes('Informes'), `${key} debe declarar su sección en el breadcrumb`)
    // Sin `reportes:ver` la vista NO se ejecuta (antes el permiso efectivo era null).
    assert.ok(BLOQUEADO.test(render(key, ['documentos:ver']).vista), `${key} debe quedar bloqueada sin reportes:ver`)
  }
})
