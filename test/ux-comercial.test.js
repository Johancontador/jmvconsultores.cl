'use strict'
/**
 * Comercial y modo cliente — pruebas de la fase F5 del rediseño UX (2026-10-20).
 *
 * Cubren los huecos que la auditoría marcó en el módulo comercial y en el
 * portal del cliente:
 *  C1 — Campañas: la pantalla dice que SOLO genera el texto (no envía) y ofrece
 *       «Copiar», que copia el mensaje real sin escribir nada en el servidor.
 *  C2 — «Marcar como enviada» pide confirmación, advierte que no envía nada y
 *       no escribe hasta confirmar.
 *  C3 — Eliminar una etapa del embudo pide confirmación destructiva (antes era
 *       un clic sin vuelta atrás) y cancelar no borra.
 *  C4 — Ni el portal ni el CRM usan `alert()`/`confirm()` del navegador: los
 *       errores salen por toast y las confirmaciones por UIEstado.confirmar.
 *  C5 — Portal › Reportes guardados: eliminar pide confirmación con el nombre
 *       del reporte; cancelar no borra. Guardar sin nombre avisa por toast.
 *  C6 — Portal › Cotizaciones: eliminar pide confirmación con cliente y monto;
 *       cancelar no borra.
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

const CAMPANAS = {
  plantillas: ['recordatorio de cierre'],
  campanas: [
    { id: 9, empresa_nombre: 'Cliente Uno SpA', plantilla: 'recordatorio de cierre', mensaje: 'Estimado cliente: su cierre de mes está pendiente.', enviado: false },
    { id: 10, empresa_nombre: 'Cliente Dos Ltda', plantilla: 'recordatorio de cierre', mensaje: 'Mensaje ya enviado a mano.', enviado: true },
  ],
}

const ETAPAS = {
  etapas: [
    { nombre: 'NUEVO', orden: 1, prob_default: 20, terminal: false },
    { nombre: 'GANADA', orden: 2, prob_default: 100, terminal: true },
  ],
}

const REPORTES = {
  reportes: [{ id: 4, nombre: 'Ventas del semestre', config_json: '{}', actualizado_en: '2026-10-20' }],
}

const COTIZACIONES = {
  cotizaciones: [{ id: 12, cliente_razon: 'Cliente Dos Ltda', monto: 500000, estado: 'ENVIADA', fecha_cierre: '2026-10-15' }],
  estados: ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'PERDIDA'],
  embudo: { hay_datos: false, por_estado: [], tasa_conversion: { por_monto: null, por_conteo: null }, monto_pendiente: 0 },
}

// ---------- mini-DOM ----------

/**
 * Botones/selects presentes en un HTML ya renderizado. Las vistas conectan sus
 * handlers con `querySelectorAll(clase o [data-x])`; basta con devolver los
 * elementos reales de ese HTML (con su dataset) para disparar el clic como en
 * el navegador.
 */
function hijosDe(html, selector) {
  const clase = selector.startsWith('.') ? selector.slice(1) : null
  const attr = selector.startsWith('[data-') ? selector.slice(6, -1) : null
  const out = []
  const re = /<(button|select|input)\b([^>]*)>/g
  let m
  while ((m = re.exec(String(html || '')))) {
    const attrs = m[2]
    const clases = ((attrs.match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/)
    const data = {}
    for (const a of attrs.matchAll(/data-([a-z0-9-]+)="([^"]*)"/g)) data[a[1]] = a[2]
    if (clase && !clases.includes(clase)) continue
    if (attr && data[attr] === undefined) continue
    out.push(botonStub(data))
  }
  return out
}

function botonStub(data = {}) {
  const e = {
    dataset: { ...data }, value: '', disabled: false, handlers: {},
    addEventListener(tipo, fn) { (e.handlers[tipo] = e.handlers[tipo] || []).push(fn) },
    removeEventListener() {},
    remove() {},
    closest: () => ({ remove() {}, querySelector: () => null }),
    querySelector: () => null,
    querySelectorAll: () => [],
    focus() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0, height: 0 }),
    async disparar(tipo, ev = {}) {
      for (const fn of e.handlers[tipo] || []) await fn({ currentTarget: e, target: e, preventDefault() {}, ...ev })
    },
  }
  return e
}

// ---------- sandbox ----------

function crearSandbox({ fixture, respuestaDelete } = {}) {
  const htmls = []
  const urls = []
  const toasts = []
  const copiado = []
  const porId = new Map()
  let ultimoHtml = ''

  // Los handlers se conectan sobre los nodos que devuelve el primer
  // querySelectorAll; si cada llamada creara nodos nuevos, el clic de la prueba
  // caería en un botón distinto del que la vista conectó. Se cachean por
  // selector + HTML pintado.
  const cacheHijos = new Map()
  const hijosCache = (html, sel) => {
    const k = `${sel}\u0000${html}`
    if (!cacheHijos.has(k)) cacheHijos.set(k, hijosDe(html, sel))
    return cacheHijos.get(k)
  }

  const el = () => {
    let html = ''
    let texto = ''
    const e = {
      tagName: 'DIV', id: '', className: '', value: '', disabled: false,
      checked: false, href: '', src: '', dataset: {}, style: {}, files: null,
      selectedOptions: [],
      handlers: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(tipo, fn) { (e.handlers[tipo] = e.handlers[tipo] || []).push(fn) },
      removeEventListener() {},
      appendChild(c) { return c },
      remove() {},
      setAttribute() {}, getAttribute: () => null, removeAttribute() {},
      insertAdjacentHTML() {},
      querySelector: (sel) => hijosCache(html, sel)[0] || el(),
      querySelectorAll: (sel) => hijosCache(html, sel),
      closest: () => ({ remove() {}, querySelector: () => null }),
      focus() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 0, width: 0, height: 0 }),
      async disparar(tipo, ev = {}) {
        for (const fn of e.handlers[tipo] || []) await fn({ currentTarget: e, target: e, preventDefault() {}, ...ev })
      },
    }
    Object.defineProperty(e, 'innerHTML', {
      get: () => html,
      set(v) { html = String(v); htmls.push(html); ultimoHtml = html },
    })
    Object.defineProperty(e, 'textContent', {
      get: () => texto,
      set(v) { texto = v == null ? '' : String(v); html = texto; ultimoHtml = texto },
    })
    return e
  }

  const porIdEl = (id) => {
    if (!porId.has(id)) porId.set(id, el())
    return porId.get(id)
  }

  const location = { href: 't://x/sistema/#', origin: 't://x', pathname: '/sistema/', search: '', hash: '#crm', replace() {}, assign() {} }
  const documentStub = {
    getElementById: porIdEl,
    querySelector: (sel) => hijosCache(ultimoHtml, sel)[0] || el(),
    // Los modales se montan por innerHTML en un nodo creado al vuelo: se busca
    // en el último HTML pintado, que es lo que el usuario tiene delante.
    querySelectorAll: (sel) => hijosCache(ultimoHtml, sel),
    createElement: () => el(),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(), activeElement: el(), readyState: 'complete',
  }
  const store = new Map()
  const localStorageStub = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: () => null, length: 0,
  }

  const fixturePorDefecto = (url) => {
    if (url.includes('/crm/campanas')) return CAMPANAS
    if (url.includes('/crm/recordatorios')) return { recordatorios: [], tipos: ['cierre de mes'] }
    if (url.includes('/crm/engagement')) return { clientes: [], resumen: {} }
    if (url.includes('/crm/alertas')) return { alertas: [] }
    if (url.includes('/crm/etapas')) return ETAPAS
    if (url.includes('/portal/metricas')) return { metricas: [{ id: 'ventas', nombre: 'Ventas' }] }
    if (url.includes('/reportes')) return REPORTES
    if (url.includes('/cotizaciones')) return COTIZACIONES
    if (url.includes('/movimientos')) return { total: 0, neto: 0, monto_total: 0 }
    return { ok: true }
  }

  const sandbox = {
    document: documentStub,
    window: {},
    location,
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async (t) => { copiado.push(String(t)) } } },
    localStorage: localStorageStub, sessionStorage: localStorageStub,
    history: { pushState() {}, replaceState() {}, back() {} },
    alert: () => { throw new Error('la vista usó alert() del navegador') },
    confirm: () => { throw new Error('la vista usó confirm() del navegador') },
    prompt: () => null,
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
    const f = fixture ? fixture(String(url), fixturePorDefecto) : fixturePorDefecto(String(url))
    return JSON.parse(JSON.stringify(f))
  }
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    return { ok: true, generadas: 0, saltadas_dupe: 0, saltadas_nada: 0 }
  }
  sandbox.apiPut = async (url, body) => {
    urls.push(`PUT ${url} ${JSON.stringify(body || {})}`)
    return { ok: true }
  }
  sandbox.apiDelete = async (url) => {
    urls.push(`DELETE ${url}`)
    if (respuestaDelete) return respuestaDelete(String(url))
    return { ok: true }
  }
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
    lee(path.join(FRONT, 'sistema', 'views-crm.js')),
    lee(path.join(FRONT, 'sistema', 'views-portal.js')),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76.543.210-3", nombre: "Comercial Andes SpA" }',
    '  S.user = { id: 1, username: "tester" }',
    '  S.permisos = new Set(["empresas:ver", "crm:ver"])',
    '  S.superAdmin = false',
    '  window.__render = 0',
    '  renderRoute = () => { window.__render++ }',
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)

  return { sandbox, htmls, urls, toasts, copiado, porId, el, store }
}

const BASE_CRM = {
  pipeline: {
    pipeline: [
      { empresa_id: 1, nombre: 'Cliente Uno SpA', rut: '76.111.111-1', etapa: 'OPERATIVO', proximo_contacto: '2026-11-01' },
    ],
  },
}

const ultimoModal = (env, idBoton) => env.htmls.filter((h) => h.includes(`id="${idBoton}"`)).pop()

// ---------- C1: campañas honestas + copiar ----------

test('C1: campañas — la pantalla dice que NO envía y «Copiar» copia el texto real', async () => {
  const env = crearSandbox()
  const cuerpo = env.el()
  await env.sandbox.renderFidelizacion(cuerpo, BASE_CRM)

  const html = cuerpo.innerHTML
  assert.match(html, /Aquí solo se genera el texto/i, 'declara que el sistema no envía')
  assert.match(html, /NO envía WhatsApp, correo ni SMS/i, 'nombra los canales que NO usa')
  assert.match(html, />Marcar como enviada</, 'el botón dice lo que registra, no «enviar»')
  assert.ok(!/crm-cam-env[^>]*>Marcar enviado</.test(html), 'no queda el rótulo ambiguo anterior')
  assert.equal((html.match(/crm-cam-copiar/g) || []).length, 1, 'solo la campaña pendiente ofrece copiar')

  const copiar = cuerpo.querySelectorAll('.crm-cam-copiar')
  assert.equal(copiar.length, 1)
  await copiar[0].disparar('click')

  assert.deepEqual(env.copiado, ['Estimado cliente: su cierre de mes está pendiente.'], 'copia el mensaje generado, no la fila entera')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'copiar no escribe en el servidor')
  assert.ok(env.toasts.some((t) => /Mensaje copiado/.test(t.msg) && t.tipo === 'success'))
})

// ---------- C2: marcar enviada con confirmación ----------

test('C2: «Marcar como enviada» confirma, avisa que no envía y no escribe si se cancela', async () => {
  const env = crearSandbox()
  const cuerpo = env.el()
  await env.sandbox.renderFidelizacion(cuerpo, BASE_CRM)

  const pendiente = cuerpo.querySelectorAll('.crm-cam-env')[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))

  const modal = ultimoModal(env, 'crm-cam-ok')
  assert.ok(modal, 'se abre la confirmación')
  assert.match(modal, /Cliente Uno SpA/, 'nombra la empresa de la campaña')
  assert.match(modal, /no envía nada/i, 'repite que el sistema no envía')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'abrir el diálogo no marca nada')

  await env.porId.get('ui-conf-no').disparar('click')
  await pendiente
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'cancelar no escribe')
  assert.ok(!env.toasts.some((t) => /Marcada como enviada/.test(t.msg)))

  // Y al confirmar sí registra, contra el endpoint real.
  const pendiente2 = cuerpo.querySelectorAll('.crm-cam-env')[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  await env.porId.get('crm-cam-ok').disparar('click')
  await pendiente2
  assert.match(env.urls.find((u) => u.startsWith('POST')), /POST \/api\/crm\/campanas\/9\/enviar/)
  assert.ok(env.toasts.some((t) => /Marcada como enviada/.test(t.msg)))
})

// ---------- C3: borrar etapa del embudo ----------

test('C3: eliminar una etapa del embudo exige confirmación destructiva', async () => {
  const env = crearSandbox()
  const pendiente = env.sandbox.modalEmbudo()
  await new Promise((r) => setTimeout(r, 10))

  const botones = env.sandbox.document.querySelectorAll('.em-eliminar')
  assert.equal(botones.length, 1, 'solo la etapa no terminal se puede eliminar')
  assert.equal(botones[0].dataset.eliminar, 'NUEVO')

  const clic = botones[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'em-del-ok')
  assert.ok(modal, 'pide confirmación antes de borrar')
  assert.match(modal, /NUEVO/, 'dice qué etapa se elimina')
  assert.match(modal, /btn-danger/, 'el botón es destructivo')
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'no borra al abrir el diálogo')

  await env.porId.get('ui-conf-no').disparar('click')
  await clic
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'cancelar no borra la etapa')

  const clic2 = botones[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  await env.porId.get('em-del-ok').disparar('click')
  await clic2
  assert.match(env.urls.find((u) => u.startsWith('DELETE')), /DELETE \/api\/crm\/etapas\/NUEVO/)
  await pendiente
})

// ---------- C4: sin diálogos del navegador ----------

test('C4: portal y CRM no usan alert()/confirm() del navegador', () => {
  for (const archivo of ['views-portal.js', 'views-crm.js']) {
    const src = fs.readFileSync(path.join(FRONT, 'sistema', archivo), 'utf8')
    // Se excluye el propio componente (UIEstado.confirmar) y las palabras en
    // comentarios: solo importan las llamadas reales del código.
    const lineas = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l))
    const alertas = lineas.filter((l) => /\balert\(/.test(l))
    const confirma = lineas.filter((l) => /(?<![\w.])confirm\(/.test(l))
    assert.deepEqual(alertas, [], `${archivo}: sin alert() del navegador`)
    assert.deepEqual(confirma, [], `${archivo}: sin confirm() del navegador`)
  }
})

// ---------- C5: reportes guardados ----------

test('C5: eliminar un reporte guardado confirma con su nombre y no borra al cancelar', async () => {
  const env = crearSandbox()
  await env.sandbox.VIEWS['portal-reportes'].render(env.el())

  const zona = env.porId.get('pr-lista')
  const borrar = zona.querySelectorAll('[data-borrar]')
  assert.equal(borrar.length, 1)

  const clic = borrar[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'pr-del-ok')
  assert.ok(modal, 'pide confirmación')
  assert.match(modal, /Ventas del semestre/, 'nombra el reporte que se elimina')
  assert.match(modal, /no se tocan|no tus datos/i, 'aclara que solo se borra la configuración')
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'abrir el diálogo no borra')

  await env.porId.get('ui-conf-no').disparar('click')
  await clic
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'cancelar no borra')

  // Guardar sin nombre avisa por toast y no llama al servidor.
  env.sandbox.document.getElementById('pr-nombre').value = '   '
  await env.porId.get('pr-guardar').disparar('click')
  assert.ok(env.toasts.some((t) => /Escribe un nombre/.test(t.msg) && t.tipo === 'info'))
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'sin nombre no guarda nada')
})

// ---------- C6: cotizaciones ----------

test('C6: eliminar una cotización confirma con cliente y monto, y no borra al cancelar', async () => {
  const env = crearSandbox()
  await env.sandbox.VIEWS['portal-cotizaciones'].render(env.el())

  const zona = env.porId.get('pt-result')
  const borrar = zona.querySelectorAll('[data-del]')
  assert.equal(borrar.length, 1)
  assert.equal(borrar[0].dataset.del, '12')

  const clic = borrar[0].disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'pt-del-ok')
  assert.ok(modal, 'pide confirmación')
  assert.match(modal, /Cliente Dos Ltda/, 'dice de qué cliente es la cotización')
  assert.match(modal, /500\.000/, 'muestra el monto en juego')
  assert.match(modal, /auditoría/, 'advierte que queda registrada')
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'abrir el diálogo no borra')

  await env.porId.get('ui-conf-no').disparar('click')
  await clic
  assert.ok(!env.urls.some((u) => u.startsWith('DELETE')), 'cancelar no borra')
  assert.ok(!env.toasts.some((t) => t.tipo === 'error'), 'sin errores: la vista funciona sin alert()')
})
