'use strict'
/**
 * RETIRO DE LA CAPA HEREDADA + CATÁLOGO ÚNICO DE REPORTES (2026-10-20).
 *
 * La auditoría §5 marcó dos solapamientos: (1) los reportes vivían en dos
 * modelos mentales (menú lateral + Centro) y tres vistas parecían tres
 * verdades distintas; (2) había tres capas de frontend, con siete pantallas
 * viejas publicadas y sin enlaces. Este test fija el contrato de la salida:
 *
 *  R1 — las 7 pantallas heredadas responden 302 al ancla de la SPA.
 *  R2 — los archivos retirados no existen y no queda ninguna referencia.
 *  R3 — las 4 vistas portadas existen y usan los MISMOS endpoints viejos.
 *  R4 — el menú tiene un solo catálogo de reportes (Centro + Cierre).
 *  R5 — el informe por rango pinta meses, totales y errores reales.
 *  R6 — la tarjeta del F29 masivo muestra IVA, PPM, total y mensaje.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const express = require('express')

const { PANTALLAS_HEREDADAS, montarRedirects } = require('../backend/core/pantallas-heredadas')

const FRONT = path.resolve(__dirname, '../frontend')
const RAIZ = path.resolve(__dirname, '..')

const RETIRADOS = [
  'index.html', 'dashboard.html', 'informe.html', 'proceso.html',
  'libro.html', 'exportacion-masiva.html', 'configuracion.html',
  'js/clientes.js', 'js/dashboard.js', 'js/exportacion-masiva.js',
  'js/herramientas.js', 'js/informe.js', 'js/libro.js', 'js/portafolio.js',
  'js/proceso.js', 'js/reportes.js', 'js/tributario.js',
  'shared/datagrid.js', 'shared/export.js', 'shared/filters.js',
  'shared/layout.js', 'shared/rango.js', 'shared/shell-router.js',
  'shared/shell-state.js', 'shared/table.js',
]

/* ------------------------------ R1 ------------------------------ */

test('R1: cada pantalla heredada redirige (302) al ancla de la SPA', async () => {
  const app = express()
  montarRedirects(app)
  app.use(express.static(FRONT))
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.strictEqual(Object.keys(PANTALLAS_HEREDADAS).length, 7, 'siete pantallas retiradas')
    for (const [archivo, destino] of Object.entries(PANTALLAS_HEREDADAS)) {
      const r = await fetch(`${base}/${archivo}`, { redirect: 'manual' })
      assert.strictEqual(r.status, 302, `${archivo} redirige (no 200, no 404)`)
      assert.strictEqual(r.headers.get('location'), destino, `${archivo} → ${destino}`)
      assert.ok(destino.startsWith('/sistema/#'), `${archivo} apunta a una vista de la SPA`)
    }
    // La query vieja no sobrevive al salto: `?tab=usuarios` igual cae en #admin.
    const conQuery = await fetch(`${base}/configuracion.html?tab=usuarios`, { redirect: 'manual' })
    assert.strictEqual(conQuery.headers.get('location'), '/sistema/#admin')

    // CONTROL: lo que sí existe no queda interceptado.
    for (const viva of ['/landing.html', '/login.html', '/sistema/index.html']) {
      const r = await fetch(`${base}${viva}`, { redirect: 'manual' })
      assert.strictEqual(r.status, 200, `${viva} sigue sirviéndose`)
    }
    // Y un 404 real no se convierte en redirect.
    const inexistente = await fetch(`${base}/ruta-inexistente-xyz`, { redirect: 'manual' })
    assert.strictEqual(inexistente.status, 404, 'una URL desconocida sigue en 404')
  } finally {
    server.close()
  }
})

test('R1b: el arranque real monta los redirects ANTES de los estáticos', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'backend/index.js'), 'utf8')
  const posRedirects = src.indexOf('montarRedirects(app)')
  const posStatic = src.indexOf("app.use(express.static(path.join(__dirname, '../frontend')))")
  assert.ok(posRedirects > 0, 'el arranque monta la tabla de pantallas retiradas')
  assert.ok(posStatic > 0 && posRedirects < posStatic, 'va antes de los estáticos (si no, el archivo viejo ganaría)')
})

/* ------------------------------ R2 ------------------------------ */

test('R2: los archivos heredados no existen y nadie los referencia', () => {
  for (const rel of RETIRADOS) {
    assert.ok(!fs.existsSync(path.join(FRONT, rel)), `frontend/${rel} fue retirado`)
  }
  assert.ok(!fs.existsSync(path.join(FRONT, 'js')), 'la carpeta frontend/js ya no existe')

  // Referencias colgantes en lo que se sirve: HTML y JS del frontend.
  const sospechosos = RETIRADOS.flatMap((r) => [`/${r}`, `"${r}"`, `'${r}'`])
  const archivos = []
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) recorrer(p)
      else if (/\.(html|js|css)$/.test(e.name)) archivos.push(p)
    }
  }
  recorrer(FRONT)
  for (const archivo of archivos) {
    const txt = fs.readFileSync(archivo, 'utf8')
    for (const s of sospechosos) {
      assert.ok(!txt.includes(s), `${path.relative(RAIZ, archivo)} referencia ${s} (retirado)`)
    }
  }
})

/* ------------------------------ R3 ------------------------------ */

test('R3: las 4 vistas portadas existen y conservan los contratos de la API', () => {
  const src = fs.readFileSync(path.join(FRONT, 'sistema', 'views-lote.js'), 'utf8')
  for (const vista of ['portafolio', 'informe-rango', 'proceso-masivo', 'exportacion-masiva']) {
    const declarada = src.includes(`VIEWS.${vista} =`) || src.includes(`VIEWS['${vista}'] =`)
    assert.ok(declarada, `VIEWS ${vista} registrada`)
  }
  // Los MISMOS endpoints que usaban las pantallas viejas: sin backend nuevo.
  for (const endpoint of [
    '/api/clientes', '/api/informe/estimacion', '/api/informe/generar',
    '/api/informe?limit', '/api/proceso/generar', '/api/proceso/reintentar/',
    '/api/exportacion-masiva/generar', '/api/exportacion-masiva/${j.export_id}/estado',
    '/api/exportacion-masiva/${j.export_id}/descargar',
  ]) {
    assert.ok(src.includes(endpoint), `usa ${endpoint}`)
  }
  // El ZIP se descarga con la sesión del navegador (sin token en la URL).
  assert.match(src, /href="\/api\/exportacion-masiva\/\$\{j\.export_id\}\/descargar"/)
  // Y la SPA carga el módulo.
  const html = fs.readFileSync(path.join(FRONT, 'sistema', 'index.html'), 'utf8')
  assert.match(html, /\/sistema\/views-lote\.js\?v=[a-f0-9]{8}/, 'index.html carga views-lote (versionado)')
})

/* ------------------------------ R4 ------------------------------ */

test('R4: un solo catálogo de reportes en el menú (Informes) y el cierre como proceso', () => {
  const src = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')
  // F2 (navegación de dos niveles): el área se llama «Informes» y el cierre de
  // período dejó de convivir con el catálogo porque NO es un reporte: es un
  // proceso contable y vive en Contabilidad. La regla que este test protege
  // sigue siendo la misma: el menú no repite los reportes que tienen tarjeta
  // en el Centro, y hay UN solo catálogo.
  const secciones = (nombre) => {
    const desde = src.indexOf(`seccion: '${nombre}'`)
    assert.ok(desde > 0, `existe la sección ${nombre}`)
    const bloque = src.slice(desde, src.indexOf(']', desde))
    return [...bloque.matchAll(/key: '([^']+)'/g)].map((m) => m[1])
  }
  assert.deepStrictEqual(secciones('Informes'), ['reportes', 'cclientes', 'cproveedores', 'informe-rango', 'exportacion-masiva'], 'el catálogo abre el área; lo demás son documentos del despacho')
  assert.ok(secciones('Contabilidad').includes('cierre'), 'el cierre es un proceso contable, no un reporte')
  assert.ok(!secciones('Informes').includes('cierre'), 'el cierre no se mezcla con el catálogo de reportes')
  for (const repetido of ['situacion', 'clasificado', 'niif', 'balance8', 'comprobacion', 'resultados']) {
    assert.ok(!secciones('Informes').includes(repetido), `${repetido} no se repite en el menú (vive en el Centro)`)
    assert.ok(!secciones('Contabilidad').includes(repetido), `${repetido} no se repite en Contabilidad`)
  }
  // Las tarjetas del Centro siguen existiendo: el anchor no se rompió.
  const conta = fs.readFileSync(path.join(FRONT, 'sistema', 'views-conta.js'), 'utf8')
  for (const hash of ['#comprobacion', '#balance8', '#situacion', '#resultados', '#clasificado', '#niif']) {
    assert.ok(conta.includes(`hash: '${hash}'`), `el Centro ofrece ${hash}`)
  }
  // Jerarquía explícita: oficial vs variante (auditoría §5).
  assert.match(conta, /Presentación oficial/, 'la tarjeta de situación se declara oficial')
  assert.match(conta, /Variante/, 'las otras se declaran variantes')
})

/* --------------------- sandbox para R5 y R6 --------------------- */

function crearSandbox() {
  // `escapeHtml` del proyecto escapa con un <div> real (textContent → innerHTML),
  // así que el stub tiene que reflejar esa relación o todo escapado saldría ''.
  const el = () => {
    const e = {
      value: '', dataset: {}, style: {}, className: '', hidden: false, disabled: false,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild: (c) => c, remove() {},
      querySelector: () => null, querySelectorAll: () => [], setAttribute() {},
      getAttribute: () => null, focus() {}, click() {},
    }
    let html = ''
    Object.defineProperty(e, 'innerHTML', {
      get: () => html,
      set(v) { html = String(v) },
    })
    Object.defineProperty(e, 'textContent', {
      get: () => html,
      set(v) {
        html = String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      },
    })
    return e
  }
  const sandbox = {
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => el(), addEventListener() {}, removeEventListener() {},
      body: el(), documentElement: el(), readyState: 'complete',
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    history: { pushState() {}, replaceState() {} },
    location: { hash: '#lote', pathname: '/sistema/', search: '', href: 't://x/sistema/' },
    navigator: { userAgent: 'test', language: 'es-CL' },
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    URL, URLSearchParams, Intl, console, setTimeout, clearTimeout, setInterval, clearInterval,
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.addEventListener = () => {}
  sandbox.removeEventListener = () => {}
  sandbox.apiGet = async () => { throw new Error('no usado') }
  sandbox.apiPost = async () => { throw new Error('no usado') }
  sandbox.apiPut = async () => { throw new Error('no usado') }
  sandbox.apiDelete = async () => { throw new Error('no usado') }
  sandbox.showToast = () => {}
  sandbox.iniciarPolling = () => () => {}
  vm.createContext(sandbox)

  const leer = (f) => ';' + fs.readFileSync(path.join(FRONT, f), 'utf8')
  const bundle = [
    leer('shared/format.js'),
    leer('sistema/ui.js'),
    leer('sistema/app.js'),
    leer('sistema/views-lote.js'),
    ';(() => { S.empresa = { id: 1, nombre: "JMV" }; S.user = { id: 1 }; S.permisos = new Set(); S.superAdmin = true })()',
  ].join('\n')
  new vm.Script(bundle).runInContext(sandbox)
  return sandbox
}

/* ------------------------------ R5 ------------------------------ */

test('R5: el informe por rango pinta meses, total acumulado y meses con error', () => {
  const sb = crearSandbox()
  const html = sb.informeRangoHTML({
    cliente: { nombre: 'Comercial Andes SpA', rut: '76543210-3' },
    anio_inicio: 2026, anio_fin: 2026, mes_inicio: 7, mes_fin: 9,
    modo: 'resumen',
    resumen: { ventas_neto: 3000000, compras_neto: 1000000, margen: 2000000, pct_margen: 66.7 },
    por_anio: [{
      anio: 2026,
      ventas_neto: 3000000, compras_neto: 1000000, margen: 2000000, pct_margen: 66.7,
      meses: [
        { anio: 2026, mes: 7, mes_nombre: 'Julio', ventas_neto: 1000000, compras_neto: 400000, margen: 600000, pct_margen: 60 },
        { anio: 2026, mes: 8, mes_nombre: 'Agosto', ventas_neto: 2000000, compras_neto: 600000, margen: 1400000, pct_margen: 70 },
      ],
    }],
    meses: [
      { anio: 2026, mes: 7, mes_nombre: 'Julio', estado: 'ok', ventas_neto: 1000000, compras_neto: 400000, margen: 600000, pct_margen: 60 },
      { anio: 2026, mes: 8, mes_nombre: 'Agosto', estado: 'ok', ventas_neto: 2000000, compras_neto: 600000, margen: 1400000, pct_margen: 70 },
      { anio: 2026, mes: 9, mes_nombre: 'Septiembre', estado: 'error', error_msg: 'SII no respondió (timeout)' },
    ],
    observaciones: ['El mes con mayor volumen de ventas fue Agosto 2026.'],
  })

  assert.match(html, /Comercial Andes SpA/, 'nombra al cliente')
  assert.match(html, /76\.543\.210-3/, 'RUT formateado')
  assert.match(html, /Julio/, 'lista los meses')
  assert.match(html, /Agosto/)
  assert.match(html, /TOTAL ACUMULADO/, 'cierra con el total del rango')
  assert.match(html, /66\.7%/, 'porcentaje de margen del resumen')
  assert.match(html, /Meses con error/, 'los meses caídos se declaran, no se esconden')
  assert.match(html, /SII no respondió \(timeout\)/, 'muestra el motivo real')
  assert.match(html, /<button[^>]*id="ir-imprimir"/, 'permite imprimir/PDF')
  assert.ok(!/Detalle por mes/.test(html), 'en modo resumen no inventa el detalle')
})

/* ------------------------------ R6 ------------------------------ */

test('R6: la tarjeta del F29 masivo muestra IVA, PPM, total y el mensaje', () => {
  const sb = crearSandbox()
  const ok = sb.loteCardHTML({
    cliente_id: 3, nombre: 'Panadería Sur', rut: '76123456-0', estado: 'ok',
    compras_neto: 1000000, compras_iva: 190000,
    ventas_neto: 2000000, ventas_iva: 380000,
    debito_fiscal: 380000, credito_fiscal: 190000, iva_pagar: 190000,
    ppm_monto: 30000, total_f29: 220000, mensaje_whatsapp: 'Hola Panadería Sur',
  }, 0)
  assert.match(ok, /Panadería Sur/)
  assert.match(ok, /IVA a pagar/, 'etiqueta el IVA')
  assert.match(ok, /190\.000/, 'monto de IVA')
  assert.match(ok, /PPM 1\.5%/, 'calcula la tasa real de PPM')
  assert.match(ok, /220\.000/, 'total F29')
  assert.match(ok, /id="pm-mensaje-0" hidden/, 'el mensaje nace oculto')
  assert.match(ok, /pm-wa/, 'ofrece el envío por WhatsApp (humano)')

  const remanente = sb.loteCardHTML({
    cliente_id: 4, nombre: 'Ferretería Norte', rut: '76987654-1', estado: 'ok',
    compras_neto: 500000, compras_iva: 95000, ventas_neto: 100000, ventas_iva: 19000,
    debito_fiscal: 19000, credito_fiscal: 95000, iva_pagar: -76000,
    ppm_monto: 1500, total_f29: 0,
  }, 1)
  assert.match(remanente, /Remanente/, 'un crédito mayor se nombra remanente, no "a pagar"')

  const fallo = sb.loteCardHTML({
    cliente_id: 5, nombre: 'Sin Clave SpA', rut: '77000000-0', estado: 'error',
    error_msg: 'La Clave Tributaria ingresada no es correcta',
  }, 2)
  assert.match(fallo, /La Clave Tributaria ingresada no es correcta/, 'el motivo real del SII')
  assert.match(fallo, /pm-retry/, 'permite reintentar ese cliente')
  assert.ok(!/pm-wa/.test(fallo), 'un cliente en error no ofrece enviar mensaje')
})
