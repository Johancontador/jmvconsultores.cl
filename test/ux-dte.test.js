'use strict'
/**
 * Facturación electrónica — pruebas de la fase F4 del rediseño UX (2026-10-20).
 *
 * Cubren los huecos que la auditoría marcó en el módulo DTE:
 *  D1 — el borrador del formulario de emisión vive por empresa en este navegador
 *       (clave estable, roundtrip y borrado); no toca el servidor.
 *  D2 — «Sincronizar contabilidad» muestra su ALCANCE (aceptados, sin vínculo y
 *       monto) antes de ejecutar y no escribe si se cancela.
 *  D3 — el borrador se restaura al volver al formulario y se puede descartar.
 *  D4 — emitir pide confirmación con documento, receptor y totales (consume un
 *       folio del CAF) y limpia el borrador al terminar.
 *  D5 — la configuración separa el certificado como zona de alto riesgo y
 *       muestra los últimos cambios del emisor desde la auditoría.
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

const CONFIG = {
  ok: true,
  config: { ambiente: 'certificacion', tiene_certificado: true, razon_social: 'JMV SpA', nro_resol: '0', fch_resol: '2024-01-15' },
  faltantes: {},
}

const DTES = [
  { id: 1, folio: 10, tipo_dte: 33, estado: 'ACEPTADO', monto_total: 119000, asiento_id: null, documento_id: null },
  { id: 2, folio: 11, tipo_dte: 33, estado: 'ACEPTADO', monto_total: 119000, asiento_id: null, documento_id: 77 },
  { id: 3, folio: 12, tipo_dte: 33, estado: 'ACEPTADO', monto_total: 500, asiento_id: 99, documento_id: 78 },
]

const AUDITORIA = {
  ok: true,
  registros: [
    { id: 5, accion: 'dte.config.guardar', creado_en: '2026-10-20T12:34:00.000Z', username: 'johan', despues_json: JSON.stringify({ campos: ['ambiente', 'cert_pfx'] }) },
    { id: 4, accion: 'dte.caf.guardar', creado_en: '2026-10-19T09:00:00.000Z', username: 'johan', despues_json: JSON.stringify({ campos: ['tipo_dte', 'folio_desde'] }) },
    { id: 3, accion: 'documento.clasificar', creado_en: '2026-10-18T09:00:00.000Z', username: 'johan', despues_json: '{}' },
  ],
}

// ---------- sandbox ----------

function crearSandbox({ permisos = [], fixture, respuestaPost } = {}) {
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

  const location = { href: 't://x/sistema/#dte', origin: 't://x', pathname: '/sistema/', search: '', hash: '#dte', replace() {}, assign() {} }
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
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async () => {} } },
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

  const fixturePorDefecto = (url) => {
    if (url.includes('/auditoria')) return AUDITORIA
    if (url.includes('/folios')) return { ok: true, folios: [] }
    if (url.includes('/dtes')) return { ok: true, dtes: DTES }
    if (url.includes('/config')) return CONFIG
    return { ok: true }
  }
  sandbox.apiGet = async (url) => {
    urls.push(String(url))
    const f = fixture ? fixture(String(url), fixturePorDefecto) : fixturePorDefecto(String(url))
    return JSON.parse(JSON.stringify(f))
  }
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    if (respuestaPost) return JSON.parse(JSON.stringify(respuestaPost(String(url), body)))
    return {
      ok: true,
      sincronizacion: {
        aceptados_procesados: 2, documentos_creados: 1, documentos_enlazados_por_dedupe: 0,
        propuestas_creadas: 1, sin_regla: 0, asientos_vinculados: 0, fallidos: [],
      },
      dte: { tipo_dte: 33, folio: 10, estado: 'ENVIADO', track_id: 'T-1' },
    }
  }
  sandbox.apiPut = async (url, body) => {
    urls.push(`PUT ${url} ${JSON.stringify(body || {})}`)
    return { ok: true, config: CONFIG.config }
  }
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
    lee(path.join(FRONT, 'sistema', 'views-dte.js')),
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

// ---------- D1: contrato del borrador ----------

test('D1: el borrador se guarda por empresa en este navegador y se puede borrar', () => {
  const env = crearSandbox({ permisos: [] })
  const { sandbox } = env

  assert.strictEqual(sandbox.dteBorradorKey(1), 'jmv.dte.borrador.1')
  assert.strictEqual(sandbox.dteBorradorKey(22), 'jmv.dte.borrador.22', 'cada empresa tiene su espacio')

  assert.strictEqual(sandbox.dteBorradorLeer(1), null, 'sin borrador al empezar')
  sandbox.dteBorradorGuardar(1, { tipo: '33', receptor: { rut: '76123456-0' } })
  const b = sandbox.dteBorradorLeer(1)
  assert.strictEqual(b.tipo, '33')
  assert.strictEqual(b.receptor.rut, '76123456-0')
  assert.ok(b.guardado_en, 'sella la fecha para poder avisar cuándo se guardó')
  assert.strictEqual(sandbox.dteBorradorLeer(2), null, 'no se filtra entre empresas')

  sandbox.dteBorradorBorrar(1)
  assert.strictEqual(sandbox.dteBorradorLeer(1), null)
})

// ---------- D2: sincronización con alcance ----------

test('D2: «Sincronizar contabilidad» muestra el alcance y no escribe hasta confirmar', async () => {
  const env = crearSandbox({ permisos: ['dte:ver', 'dte:emitir'] })
  const cont = env.el()
  await env.sandbox.VIEWS.dte.render(cont)

  // El handler espera la confirmación: se dispara sin await y se resuelve al confirmar.
  const pendiente = env.porId.get('dte-sync').disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'dte-sync-ok')
  assert.ok(modal, 'se abre la confirmación del alcance')
  assert.match(modal, /Aceptados por el SII<\/dt><dd><b class="mono">3<\/b>/, 'dice cuántos aceptados hay')
  assert.match(modal, /Sin vínculo contable<\/dt><dd><b class="mono">2<\/b>/, 'dice cuántos siguen sin vínculo')
  assert.match(modal, /Ya con documento en la bandeja<\/dt><dd><span class="mono">1<\/span>/, 'separa los que ya tienen documento')
  assert.match(modal, /\$238\.000/, 'muestra el monto en juego')
  assert.match(modal, /Sincronizar 3/, 'el botón repite el alcance')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'abrir el diálogo no sincroniza nada')

  await env.porId.get('dte-sync-ok').disparar('click')
  await pendiente
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.match(post, /sincronizar-contabilidad/)
  assert.ok(env.toasts.some((t) => /Sincronización completada/.test(t.msg)))
  assert.ok(env.sandbox.window._dteSyncResultado, 'el resumen sobrevive al re-render')
})

test('D2b: sin DTE aceptados no abre diálogo ni escribe', async () => {
  const env = crearSandbox({
    permisos: ['dte:ver', 'dte:emitir'],
    fixture: (url, def) => (url.includes('/dtes?estado=ACEPTADO') ? { ok: true, dtes: [] } : def(url)),
  })
  await env.sandbox.VIEWS.dte.render(env.el())
  await env.porId.get('dte-sync').disparar('click')

  assert.ok(!env.htmls.some((h) => h.includes('id="dte-sync-ok"')), 'no hay nada que confirmar')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no se ejecutó la sincronización')
  assert.ok(env.toasts.some((t) => /No hay DTEs aceptados/.test(t.msg)), 'explica por qué no hizo nada')
})

// ---------- D3: borrador del formulario ----------

test('D3: al volver al formulario el borrador se restaura y se puede descartar', async () => {
  const env = crearSandbox({ permisos: ['dte:emitir'] })
  env.store.set('jmv.dte.borrador.1', JSON.stringify({
    tipo: '33',
    receptor: { rut: '76123456-0', razon_social: 'Cliente de prueba', giro: 'Servicios', direccion: 'Av. Siempre 1', comuna: 'Santiago' },
    items: [],
    guardado_en: '2026-10-20T11:00:00.000Z',
  }))

  await env.sandbox.VIEWS['dte-emision'].render(env.el())

  assert.strictEqual(env.porId.get('de-rut').value, '76123456-0', 'restaura el RUT del receptor')
  assert.strictEqual(env.porId.get('de-rz').value, 'Cliente de prueba', 'restaura la razón social')
  const aviso = htmlDe(env, 'de-borrador')
  assert.match(aviso, /Borrador restaurado/, 'avisa que es un borrador y no un envío')
  assert.match(aviso, /Nada se ha enviado al SII/, 'deja claro que no se emitió nada')
  assert.match(aviso, /de-borrador-x/, 'ofrece descartarlo')

  await env.porId.get('de-borrador-x').disparar('click')
  assert.strictEqual(env.sandbox.dteBorradorLeer(1), null, 'descartar borra el borrador')
})

// ---------- D4: emisión con confirmación ----------

test('D4: emitir muestra documento, receptor y totales antes de consumir el folio', async () => {
  const env = crearSandbox({ permisos: ['dte:emitir'] })
  await env.sandbox.VIEWS['dte-emision'].render(env.el())
  const campo = (id) => env.sandbox.document.getElementById(id)
  campo('de-rut').value = '76123456-0'
  campo('de-rz').value = 'Cliente de prueba'
  campo('de-neto').textContent = '$100.000'
  campo('de-iva').textContent = '$19.000'
  campo('de-exento').textContent = '$0'
  campo('de-total').textContent = '$119.000'

  const pendiente = env.porId.get('de-emitir').disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  const modal = ultimoModal(env, 'de-emitir-ok')
  assert.ok(modal, 'se abre la confirmación antes de emitir')
  assert.match(modal, /Consume un folio del CAF/, 'declara el costo de la acción')
  assert.match(modal, /Cliente de prueba/, 'identifica al receptor')
  assert.match(modal, /76123456-0/, 'muestra el RUT')
  assert.match(modal, /\$119\.000/, 'muestra el total que se firmará')
  assert.match(modal, /certificacion/, 'dice el ambiente del emisor')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no se emite antes de confirmar')

  await env.porId.get('de-emitir-ok').disparar('click')
  await pendiente
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.match(post, /POST \/api\/dte\/empresas\/1\/emitir/)
  assert.ok(env.toasts.some((t) => /DTE 33 folio 10/.test(t.msg)), 'informa folio y estado')
  assert.strictEqual(env.sandbox.dteBorradorLeer(1), null, 'al emitir se limpia el borrador')
})

test('D4b: cancelar la emisión no envía nada y conserva el borrador', async () => {
  const env = crearSandbox({ permisos: ['dte:emitir'] })
  await env.sandbox.VIEWS['dte-emision'].render(env.el())
  const pendiente = env.porId.get('de-emitir').disparar('click')
  await new Promise((r) => setTimeout(r, 10))
  await env.porId.get('ui-conf-no').disparar('click')
  await pendiente

  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no se emitió')
  assert.strictEqual(env.sandbox.window.__render, 0, 'sigue en el formulario')
})

// ---------- D5: configuración con zona de riesgo e historial ----------

test('D5: el certificado es zona aparte con aviso, y el historial del emisor es visible', async () => {
  const env = crearSandbox({ permisos: ['dte:ver', 'dte:configurar', 'auditoria:ver'] })
  const cont = env.el()
  await env.sandbox.VIEWS['dte-config'].render(cont)
  const html = env.htmls[env.htmls.length - 1]

  assert.match(html, /Certificado de firma — zona de alto riesgo/, 'el certificado deja de estar mezclado con la ficha')
  assert.match(html, /se pide confirmación escribiendo el RUT/, 'explica la confirmación')
  assert.match(html, /Últimos cambios del emisor/, 'hay historial en la propia pantalla')
  assert.match(html, /Ficha del emisor<\/td>/, 'nombra el cambio de ficha')
  assert.match(html, /CAF de folios<\/td>/, 'nombra la carga de CAF')
  assert.match(html, /ambiente, cert_pfx/, 'muestra los campos tocados sin la contraseña')
  assert.ok(!/cert_pass/.test(html), 'la contraseña del certificado jamás se pinta')
  assert.match(html, /johan/, 'atribuye el cambio a un usuario')
  assert.ok(!/documento\.clasificar<\/td>/.test(html), 'filtra a la configuración de emisión')
})
