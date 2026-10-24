'use strict'
/**
 * Tesorería e informes — pruebas de la fase F3 del rediseño UX (2026-10-20).
 *
 * Cubren los huecos que la auditoría marcó en dinero y cierre:
 *  T1 — Formatos de cartola guardados: la API existía y ninguna vista la
 *       llamaba; ahora se listan con sus columnas y se eligen sin importar nada.
 *  T2 — Aplicaciones de un documento: «quién cobró qué con qué movimiento» es
 *       consultable desde la interfaz (antes solo por API).
 *  T3 — «Pagada» en Cobranza dice banco, monto y asiento ANTES de escribir, y no
 *       envía nada si se cancela (antes creaba el movimiento a ciegas).
 *  T4 — Centro de Reportes: lo que no existe vive en «Próximamente», separado de
 *       los reportes reales, y el cierre tiene su tarjeta.
 *  T5 — Cierre de período con confirmación fuerte: impacto visible y período
 *       tecleado; cancelar no cierra nada.
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

const FORMATOS = {
  ok: true,
  formatos: [
    { id: 1, nombre: 'Banco de Chile — cartola', mapeo: { fila_inicio: 1, col_fecha: 0, col_monto: 1, col_glosa: 2 }, creado_en: '2026-10-01T12:00:00.000Z' },
    { id: 2, nombre: 'Santander cargo/abono', mapeo: { fila_inicio: 0, col_fecha: 1, col_cargo: 2, col_abono: 3, col_glosa: 4 }, creado_en: '2026-10-02T12:00:00.000Z' },
  ],
}

const BANCOS = {
  ok: true,
  bancos: [{ id: 2, banco: 'Banco de Chile', numero: '001-2', cuenta_codigo: '1.1.1.01', cuenta_nombre: 'Banco Chile', saldo_inicial: 0, ingresos: 0, egresos: 0, saldo: 1500000 }],
}

const RESUMEN = { ok: true, resumen: { total_bancos: 1500000, caja: null, mes_actual: { ingresos: 0, egresos: 0, movimientos: 0 } } }

const COBRANZA = {
  ok: true,
  total_pendiente: 119000,
  clientes: [{
    razon_social: 'Comercial Andes SpA', rut: '76543210-3', saldo: 119000, nivel: 'amarillo', mora_max_dias: 20,
    documentos_abiertos: [{ id: 5, folio: '2211', fecha_docto: '2026-09-03', monto_total: 119000, mora_dias: 20 }],
  }],
}

const APLICACIONES = {
  ok: true,
  documento_id: 5,
  cobrado: 50000,
  aplicaciones: [{ id: 1, monto: 50000, aplicado_en: '2026-10-01T10:00:00.000Z', motivo: 'pago parcial', movimiento_id: 3, fecha: '2026-10-01', tipo: 'COBRO', glosa: 'Abono factura 2211', asiento_id: 77 }],
}

const CIERRE = {
  checklist: { periodo_abierto: true, documentos_pendientes: 3, conciliacion_ejecutada: false, conciliacion_diferencias: 0 },
  cierres_propuestos: [
    { clave: 'IVA', glosa: 'IVA determinado', lineas: [{ debe: 1862050 }, { debe: 0, haber: 1862050 }] },
    { clave: 'PPM', glosa: 'PPM devengado', lineas: [{ debe: 614569 }] },
  ],
  puede_cerrar: false,
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

  const porIdEl = (id) => {
    if (!porId.has(id)) porId.set(id, el())
    return porId.get(id)
  }

  const location = { href: 't://x/sistema/#', origin: 't://x', pathname: '/sistema/', search: '', hash: '#tesoreria', replace() {}, assign() {} }
  const documentStub = {
    getElementById: porIdEl,
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener() {}, removeEventListener() {},
    body: el(), documentElement: el(), head: el(),
    activeElement: el(),
    readyState: 'complete',
  }
  const store = { getItem: () => null, setItem() {}, removeItem() {}, clear() {}, key: () => null, length: 0 }
  const sandbox = {
    document: documentStub,
    window: {},
    location,
    navigator: { userAgent: 'test', language: 'es-CL', clipboard: { writeText: async () => {} } },
    localStorage: store, sessionStorage: store,
    history: { pushState(_a, _b, url) { location.hash = url }, replaceState(_a, _b, url) { location.hash = url }, back() {} },
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

  // Enrutado de fixtures: el orden importa (cartola-formatos antes que /bancos).
  const fixturePorDefecto = (url) => {
    if (url.includes('cartola-formatos')) return FORMATOS
    if (url.includes('/aplicaciones')) return APLICACIONES
    if (url.includes('/cobranza')) return COBRANZA
    if (url.includes('tesoreria/resumen')) return RESUMEN
    if (url.includes('cuentas-imputables')) return { ok: true, cuentas: [] }
    if (url.includes('/bancos')) return BANCOS
    if (url.includes('/config')) return { ok: true, config: { modo_conciliacion: 'completa' } }
    if (url.includes('/preparar')) return { ok: true, cierre: CIERRE }
    return { ok: true }
  }
  sandbox.apiGet = async (url) => {
    urls.push(String(url))
    const f = fixture ? fixture(String(url), fixturePorDefecto) : fixturePorDefecto(String(url))
    return JSON.parse(JSON.stringify(f))
  }
  sandbox.apiPost = async (url, body) => {
    urls.push(`POST ${url} ${JSON.stringify(body || {})}`)
    return respuestaPost ? JSON.parse(JSON.stringify(respuestaPost)) : { ok: true, asiento_folio: 99, saldo_restante: 0 }
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
    lee(path.join(FRONT, 'sistema', 'views-teso.js')),
    lee(path.join(FRONT, 'sistema', 'views-cobranza.js')),
    lee(path.join(FRONT, 'sistema', 'views-conta.js')),
    ';(() => {',
    '  S.empresa = { id: 1, rut: "76.543.210-3", nombre: "Comercial Andes SpA" }',
    '  S.user = { id: 1, username: "tester" }',
    `  S.permisos = new Set(${JSON.stringify(permisos)})`,
    '  S.superAdmin = false',
    '  window.__render = 0',
    '  renderRoute = () => { window.__render++ }',
    '  refrescarPillDocs = () => {}',
    '})()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)

  return { sandbox, htmls, urls, toasts, porId, el }
}

const htmlDe = (env, id) => env.porId.get(id)?.innerHTML || ''
const ultimoModal = (env, idBoton) => env.htmls.filter((h) => h.includes(`id="${idBoton}"`)).pop()

// ---------- T1: formatos de cartola ----------

test('T1: la conciliación lista los formatos guardados con sus columnas y no importa nada al elegirlos', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'bancos:conciliar'] })
  env.sandbox.window._tesoTab = 'conciliacion'
  await env.sandbox.VIEWS.tesoreria.render(env.el())

  const html = htmlDe(env, 'teso-body')
  assert.ok(env.urls.some((u) => u.includes('/tesoreria/cartola-formatos')), 'consulta el catálogo real de la empresa')
  assert.match(html, /Formatos de cartola guardados/)
  assert.match(html, /Banco de Chile — cartola/, 'muestra el nombre guardado')
  assert.match(html, /fecha col 1 · monto col 2 · glosa col 3 · desde fila 2/, 'describe el mapeo en columnas de humano')
  assert.match(html, /Santander cargo\/abono/)
  assert.match(html, /cargo col 3 \/ abono col 4/, 'entiende los formatos cargo/abono')
  assert.match(html, /NO importa nada/, 'deja claro que elegir un formato no ingesta datos')
  assert.match(html, /data-fmt="Banco de Chile — cartola"/, 'cada formato se puede aplicar')

  // El mapeo interno cuenta desde 0; el texto para humanos, desde 1.
  assert.strictEqual(
    env.sandbox.describirMapeoCartola({ fila_inicio: 1, col_fecha: 0, col_monto: 1, col_glosa: 2 }),
    'fecha col 1 · monto col 2 · glosa col 3 · desde fila 2',
  )
})

test('T1b: sin bancos:conciliar no se consulta el catálogo ni se ofrece el mapeo', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver'] })
  env.sandbox.window._tesoTab = 'conciliacion'
  await env.sandbox.VIEWS.tesoreria.render(env.el())

  assert.ok(!env.urls.some((u) => u.includes('cartola-formatos')), 'no se pide un catálogo que el rol no puede leer')
  assert.ok(!/data-fmt=/.test(htmlDe(env, 'teso-body')), 'no hay acciones de mapeo para quien no concilia')
})

test('T1c: un formato elegido en otra empresa no se aplica en esta cartera', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'bancos:conciliar'] })
  // Mismo NOMBRE de formato, pero recordado con otra empresa (cambio de cartera).
  env.sandbox.window._tesoFormatoCartola = { empresa: 99, nombre: 'Banco de Chile — cartola' }
  env.sandbox.window._tesoTab = 'conciliacion'
  await env.sandbox.VIEWS.tesoreria.render(env.el())

  const html = htmlDe(env, 'teso-body')
  assert.match(html, /data-fmt="Banco de Chile — cartola"/, 'el formato sigue disponible para elegirlo')
  assert.ok(!/chip clasificado">elegido/.test(html), 'no se marca como elegido un formato de otra empresa')
})

// ---------- T2: aplicaciones del documento ----------

test('T2: «Aplicaciones» muestra con qué movimientos se cobró el documento', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver'] })
  await env.sandbox.modalAplicacionesDocumento(5, 'Factura 2211')

  assert.ok(env.urls.some((u) => u.includes('/tesoreria/documentos/5/aplicaciones')), 'consulta la trazabilidad real')
  const caja = htmlDe(env, 'apl-out')
  assert.match(caja, /Cobrado acumulado/, 'resume lo cobrado')
  assert.match(caja, /\$50\.000/, 'muestra el monto aplicado')
  assert.match(caja, /#77/, 'nombra el asiento del cobro')
  assert.match(caja, /Abono factura 2211/, 'trae la glosa del movimiento')
  assert.match(caja, /COBRO/, 'distingue cobro de pago')
})

test('T2b: un documento sin aplicaciones lo dice, no deja la tabla vacía', async () => {
  const env = crearSandbox({
    permisos: ['tesoreria:ver'],
    fixture: (url, def) => (url.includes('/aplicaciones') ? { ok: true, documento_id: 5, cobrado: 0, aplicaciones: [] } : def(url)),
  })
  await env.sandbox.modalAplicacionesDocumento(5, 'Factura 2211')
  assert.match(htmlDe(env, 'apl-out'), /no tiene aplicaciones registradas/)
})

// ---------- T3: cobranza con alcance ----------

test('T3: la fila de cobranza ofrece «Pagada» y «Aplicaciones»', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'tesoreria:operar'] })
  const cont = env.el()
  await env.sandbox.VIEWS.cobranza.render(cont)
  const html = env.htmls[env.htmls.length - 1]

  assert.match(html, /ccb-pagada/, 'el cobro sigue disponible')
  assert.match(html, /ccb-apl/, 'y la trazabilidad del pago también')
  assert.match(html, /aria-label="Registrar pagada la factura 2211"/, 'el botón se anuncia con su folio')
})

test('T3b: «Pagada» muestra banco, monto y asiento; no escribe hasta confirmar', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'tesoreria:operar'] })
  const doc = { id: 5, folio: '2211', fecha_docto: '2026-09-03', monto_total: 119000, cliente: 'Comercial Andes SpA' }
  const promesa = env.sandbox.modalPagadaCobranza(doc, { id: 2, banco: 'Banco de Chile', numero: '001-2' })

  const modal = ultimoModal(env, 'ccb-conf-ok')
  assert.ok(modal, 'se abre la confirmación')
  assert.match(modal, /Comercial Andes SpA/, 'identifica al cliente')
  assert.match(modal, /F2211/, 'identifica la factura')
  assert.match(modal, /\$119\.000/, 'dice el monto que se cobra')
  assert.match(modal, /Banco de Chile 001-2/, 'dice en qué banco entra la plata')
  assert.match(modal, /Debe banco \/ Haber clientes/, 'explica el asiento que se crea')
  assert.match(modal, /No se puede deshacer/, 'advierte que es irreversible')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'abrir el diálogo no escribe nada')

  await env.porId.get('ccb-conf-ok').disparar('click')
  const r = await promesa
  assert.ok(r, 'devuelve el resultado')
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.ok(post, 'confirmar escribe')
  assert.match(post, /POST \/api\/contable\/empresas\/1\/cobranza\/5\/pagada/)
  assert.match(post, /"banco_cuenta_id":2/, 'usa el banco elegido en la fila')
  assert.ok(env.toasts.some((t) => /Cobrado/.test(t.msg) && /F99/.test(t.msg)), 'avisa el asiento creado')
  assert.strictEqual(env.sandbox.window.__render, 1, 'refresca la vista')
})

test('T3c: cancelar el cobro no envía ninguna petición', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'tesoreria:operar'] })
  const promesa = env.sandbox.modalPagadaCobranza({ id: 5, folio: '2211', monto_total: 119000 }, { id: 2, banco: 'Banco de Chile' })
  await env.porId.get('ui-conf-no').disparar('click')
  const r = await promesa

  assert.strictEqual(r, null, 'cancelar devuelve null')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no se creó el movimiento')
  assert.strictEqual(env.sandbox.window.__render, 0, 'no refresca nada')
})

// ---------- T4: Centro de Reportes ----------

test('T4: lo que no existe vive en «Próximamente», fuera de los reportes reales', async () => {
  const env = crearSandbox({ permisos: [] })
  const cont = env.el()
  await env.sandbox.VIEWS.reportes.render(cont)
  const html = env.htmls[env.htmls.length - 1]

  assert.match(html, /rep-proximos/, 'hay un bloque separado para lo no disponible')
  assert.match(html, /Próximamente/)
  assert.ok(!/En preparación/.test(html), 'ya no hay tarjetas «en preparación» mezcladas con reportes reales')
  // F2.6: el listado decía «No disponible todavía» también para F29 y
  // antigüedad de saldos, que SÍ están implementados (Salud y Cobranza). Ahora
  // cada línea no implementada dice qué existe y qué falta, y lo implementado
  // es una tarjeta real.
  const bloque = html.slice(html.indexOf('rep-proximos'))
  for (const ausente of ['Flujo de efectivo', 'Cambios en patrimonio', 'PPM', 'Centros de costo']) {
    assert.ok(bloque.includes(ausente), `${ausente} se declara no implementado`)
  }
  assert.match(bloque, /No implementado/, 'rotula lo ausente como no implementado')
  assert.ok(!bloque.includes('F29'), 'F29 no puede estar en «Próximamente»: está implementado en Salud Tributaria')
  assert.ok(!bloque.includes('Antigüedad de saldos'), 'la antigüedad de saldos existe en Cobranza')
  assert.match(html, /href="#salud"/, 'F29 se abre desde el reporte real de Salud Tributaria')
  assert.match(html, /href="#cobranza"/, 'la antigüedad de saldos se abre en Cobranza')
  assert.match(html, /href="#cierre"/, 'el cierre tiene su tarjeta en el centro')
  assert.match(html, /href="#comprobacion"/, 'los reportes reales siguen navegables')
})

// ---------- T5: cierre con confirmación fuerte ----------

test('T5: cerrar exige teclear el período y muestra el impacto antes de escribir', async () => {
  const env = crearSandbox({ permisos: ['periodos:ver', 'periodos:cerrar'] })
  const promesa = env.sandbox.confirmarCierre({ eid: 1, periodo: '202609', cierre: CIERRE, claves: ['IVA', 'PPM'], forzar: false })

  const modal = ultimoModal(env, 'ci-conf-ok')
  assert.ok(modal, 'se abre la confirmación')
  assert.match(modal, /Cerrar Septiembre 2026/i, 'nombra el período que se cierra')
  assert.match(modal, /202609/)
  assert.match(modal, /<b style="color:var\(--danger\)">3<\/b>/, 'muestra los documentos pendientes')
  assert.match(modal, /IVA · PPM/, 'lista los asientos de cierre que se crearán')
  assert.match(modal, /\$2\.476\.619/, 'suma el monto del Debe de los asientos elegidos')
  assert.match(modal, /No se reabre desde la interfaz/, 'advierte el efecto irreversible')
  assert.ok(/id="ci-conf-ok" disabled/.test(modal), 'el botón nace bloqueado')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'abrir el diálogo no cierra nada')

  const input = env.porId.get('ui-conf-input')
  input.value = '202608'
  await input.disparar('input')
  assert.strictEqual(env.porId.get('ci-conf-ok').disabled, true, 'otro período no habilita')

  input.value = '202609'
  await input.disparar('input')
  assert.strictEqual(env.porId.get('ci-conf-ok').disabled, false, 'el período exacto habilita')

  await env.porId.get('ci-conf-ok').disparar('click')
  await promesa
  const post = env.urls.find((u) => u.startsWith('POST'))
  assert.ok(post, 'confirmar ejecuta el cierre')
  assert.match(post, /POST \/api\/contable\/empresas\/1\/cierre\/202609\/ejecutar/)
  assert.match(post, /"claves":\["IVA","PPM"\]/)
  assert.match(post, /"forzar":false/)
})

test('T5b: forzar con pendientes lo dice y exige la misma confirmación', async () => {
  const env = crearSandbox({ permisos: ['periodos:ver', 'periodos:cerrar'] })
  const promesa = env.sandbox.confirmarCierre({ eid: 1, periodo: '202609', cierre: CIERRE, claves: ['IVA', 'PPM'], forzar: true })

  const modal = ultimoModal(env, 'ci-conf-ok')
  assert.match(modal, /Forzar: el período se cierra CON documentos pendientes/)
  assert.match(modal, /Cerrar de todas formas/, 'el botón no finge normalidad')
  assert.ok(/id="ci-conf-ok" disabled/.test(modal), 'forzar tampoco salta la confirmación')

  const input = env.porId.get('ui-conf-input')
  input.value = '202609'
  await input.disparar('input')
  await env.porId.get('ci-conf-ok').disparar('click')
  await promesa
  assert.match(env.urls.find((u) => u.startsWith('POST')), /"forzar":true/)
})

test('T5c: cancelar el cierre no ejecuta nada', async () => {
  const env = crearSandbox({ permisos: ['periodos:ver', 'periodos:cerrar'] })
  const promesa = env.sandbox.confirmarCierre({ eid: 1, periodo: '202609', cierre: CIERRE, claves: ['IVA'], forzar: false })
  await env.porId.get('ui-conf-no').disparar('click')

  assert.strictEqual(await promesa, null)
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'cancelar no cierra el período')
})

// Regresión de la revisión del diff: `claves: []` NO significa «todos».
// El backend cierra el período sin asientos de cierre y el diálogo los habría
// mostrado todos: se bloquearía el período con un resumen falso.
test('T5d: sin asientos seleccionados no se abre el diálogo ni se cierra el período', async () => {
  const env = crearSandbox({ permisos: ['periodos:ver', 'periodos:cerrar'] })
  const r = await env.sandbox.confirmarCierre({ eid: 1, periodo: '202609', cierre: CIERRE, claves: [], forzar: false })

  assert.strictEqual(r, null)
  assert.ok(!env.htmls.some((h) => h.includes('id="ci-conf-ok"')), 'no hay diálogo que confirme algo falso')
  assert.ok(!env.urls.some((u) => u.startsWith('POST')), 'no se cerró el período')
  assert.ok(env.toasts.some((t) => /No hay asientos de cierre seleccionados/.test(t.msg)), 'explica por qué no hizo nada')
})

// La deuda FISCAL (TGR) es una obligación con el Fisco, distinta de la deuda
// comercial. Se muestra como tarjeta propia en Tesorería, con su certificado,
// y solo ofrece consultar a quien puede operar tesorería.
const DEUDA_TGR = {
  ok: true,
  deuda: {
    estado: 'con_deuda',
    etiqueta: 'Deuda fiscal registrada (TGR)',
    total: 1460500,
    fecha_emision: '2026-10-22',
    liquidada_al: '2026-10-22',
    codigo_verificacion: '001SD202629571457999',
    consultado_en: '2026-10-23 01:41:41',
    pdf: 'data/certificados-tgr/76312274-3-2026-10-22.pdf',
    documentos: [{ documento: 'F29', periodo: '202504', monto: 1250000, glosa: 'Formulario 29 2025-04 1.250.000' }],
    nota: 'La deuda del Fisco (TGR) es distinta de las cuentas por pagar comerciales.',
    detalle: 'El certificado emitido el 2026-10-22 registra deuda por 1.460.500 CLP en 1 documento(s).',
  },
}

const conDeuda = (url, def) => (url.includes('deuda-fiscal') ? DEUDA_TGR : def(url))

test('T6: Tesorería muestra la deuda fiscal TGR con su detalle y certificado', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver', 'tesoreria:operar'], fixture: conDeuda })
  await env.sandbox.VIEWS.tesoreria.render(env.el())
  const html = env.htmls.join('\n')

  assert.match(html, /Deuda fiscal \(TGR\)/)
  assert.match(html, /Deuda fiscal registrada \(TGR\)/, 'no la presenta como al día')
  assert.match(html, /1\.460\.500/, 'muestra el monto certificado')
  assert.match(html, /2026-10-22/, 'muestra la fecha del certificado')
  assert.match(html, /001SD202629571457999/, 'muestra el código de verificación')
  assert.match(html, /Detalle por documento/, 'el detalle no queda solo en el total')
  assert.match(html, /202504/)
  assert.match(html, /id="teso-deuda-pdf"/, 'ofrece el certificado oficial')
  assert.match(html, /id="teso-deuda-consultar"/, 'con tesoreria:operar puede consultar')
  assert.match(html, /distinta de las cuentas por pagar comerciales/, 'no la confunde con deuda comercial')
})

test('T6b: sin tesoreria:operar la tarjeta se ve pero no se ofrece consultar', async () => {
  const env = crearSandbox({ permisos: ['tesoreria:ver'], fixture: conDeuda })
  await env.sandbox.VIEWS.tesoreria.render(env.el())
  const html = env.htmls.join('\n')

  assert.match(html, /Deuda fiscal \(TGR\)/)
  assert.match(html, /1\.460\.500/)
  assert.ok(!/id="teso-deuda-consultar"/.test(html), 'solo lectura no dispara la consulta')
})

test('T6c: si la TGR no responde, Tesorería igual carga y lo dice', async () => {
  const env = crearSandbox({
    permisos: ['tesoreria:ver', 'tesoreria:operar'],
    fixture: (url, def) => {
      if (url.includes('deuda-fiscal')) throw new Error('TGR caída')
      return def(url)
    },
  })
  await env.sandbox.VIEWS.tesoreria.render(env.el())
  const html = env.htmls.join('\n')

  assert.match(html, /Deuda fiscal \(TGR\)/)
  assert.match(html, /No consultada/, 'no inventa un cero ni un «sin deuda»')
  assert.match(html, /id="teso-deuda-consultar"/, 'el botón queda disponible para reintentar')
})
