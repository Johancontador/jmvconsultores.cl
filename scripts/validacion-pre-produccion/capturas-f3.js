#!/usr/bin/env node
'use strict'
/**
 * capturas-f3.js — validación visual/funcional en Chrome real (F3).
 *
 * QUÉ HACE
 *  1. Siembra una BD FICTICIA en el directorio temporal del sistema
 *     (scripts/validacion-pre-produccion/entorno-demo.js) — nunca la BD real.
 *  2. Levanta `backend/index.js` en un puerto aislado con DB_PATH temporal,
 *     NODE_ENV=test y las empresas demo SIN clave SII (sync-diaria las filtra,
 *     así que no hay ninguna llamada al SII/TGR/MercadoPago durante la corrida).
 *  3. Abre Chrome con puppeteer-core, inicia sesión con un usuario de prueba y
 *     recorre las pantallas del rediseño en escritorio, tableta y móvil.
 *  4. Guarda capturas + un informe JSON con títulos, breadcrumb, ítem activo,
 *     errores de consola, respuestas >=400 y desbordes horizontales.
 *
 * Requisitos: Chrome instalado (o CHROME_PATH) y `puppeteer-core` (ya es
 * dependencia del proyecto: lo usa la lectura del portal del SII).
 *
 * Uso:
 *   node scripts/validacion-pre-produccion/capturas-f3.js [--solo=clave1,clave2]
 * Salida: docs/handoff-integral/capturas-f3/ (PNG) + informe-f3.json
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { spawn } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const SALIDA = path.join(ROOT, 'docs/handoff-integral/capturas-f3')
const PUERTO = Number(process.env.F3_PORT || 3599)
const BASE = `http://127.0.0.1:${PUERTO}`
const DIR_DB = process.env.F3_DB_DIR || path.join(os.tmpdir(), 'jmv-f3')
const DB_PATH = path.join(DIR_DB, 'demo.db')
const USER = 'demo'
const PASS = 'DemoF3.2026'
const PERIODO = '202609' // la demo siembra agosto/septiembre 2026

// Rutas capturadas: las áreas del menú, los módulos de cada área, los 6
// reportes que en F0 no tenían entrada de menú, el Portal, Administración y
// dos casos de borde (ruta desconocida y la referencia del informe imprimible).
const ESCRITORIO = [
  { key: 'centro', nombre: 'Inicio — Centro de Aplicaciones' },
  { key: 'inicio', nombre: 'Hoy — panel del período' },
  { key: 'documentos', nombre: 'Bandeja de documentos' },
  { key: 'libros', nombre: 'Libros de compras y ventas' },
  { key: 'automatizacion', nombre: 'Contabilización y pendientes' },
  { key: 'propuestas', nombre: 'Propuestas y conciliación' },
  { key: 'asientos', nombre: 'Asientos — diario y mayor' },
  { key: 'memoria', nombre: 'Memoria de contabilización' },
  { key: 'activos', nombre: 'Activos fijos' },
  { key: 'cierre', nombre: 'Cierre de período' },
  { key: 'salud', nombre: 'Salud tributaria' },
  { key: 'analitica', nombre: 'Dashboard tributario (IVA)' },
  { key: 'calculadora-iva', nombre: 'Calculadora de IVA' },
  { key: 'tesoreria', nombre: 'Tesorería — banco y conciliación' },
  { key: 'cobranza', nombre: 'Cobranza y mora' },
  { key: 'reportes', nombre: 'Centro de reportes' },
  { key: 'comprobacion', nombre: 'Balance de comprobación (F0)' },
  { key: 'balance8', nombre: 'Balance de 8 columnas (F0)' },
  { key: 'situacion', nombre: 'Situación financiera (F0)' },
  { key: 'resultados', nombre: 'Estado de resultados (F0)' },
  { key: 'clasificado', nombre: 'Balance clasificado (F0)' },
  { key: 'niif', nombre: 'NIIF por rubros (F0)' },
  { key: 'cclientes', nombre: 'Cuenta corriente clientes' },
  { key: 'cproveedores', nombre: 'Cuenta corriente proveedores' },
  { key: 'portal-inicio', nombre: 'Portal — dashboard' },
  { key: 'portal-ventas', nombre: 'Portal — ventas' },
  { key: 'portal-cartera', nombre: 'Portal — cartera' },
  { key: 'portal-cotizaciones', nombre: 'Portal — cotizaciones' },
  { key: 'portal-costos', nombre: 'Portal — hoja de costos' },
  { key: 'crm', nombre: 'CRM comercial' },
  { key: 'portafolio', nombre: 'Clientes del portafolio' },
  { key: 'admin', nombre: 'Administración' },
  { key: 'auditoria', nombre: 'Auditoría' },
  { key: 'integraciones', nombre: 'Integraciones' },
  { key: 'suscripcion', nombre: 'Suscripción y pagos' },
  { key: 'dte', nombre: 'Bandeja de DTEs emitidos' },
  { key: 'dte-config', nombre: 'Configuración del emisor' },
  { key: 'alertas', nombre: 'Alertas' },
  { key: 'ruta-inexistente', nombre: 'Ruta desconocida (borde)' },
]

// Responsive: las pantallas donde el rediseño cambia de composición.
const RESPONSIVE = ['centro', 'inicio', 'documentos', 'salud', 'tesoreria', 'reportes', 'asientos']

// ---------- infraestructura ----------

function log(...a) { console.log('[F3]', ...a) }

function rutaChrome() {
  const candidatos = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidatos.find((c) => { try { return fs.existsSync(c) } catch { return false } }) || null
}

function correr(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'inherit' })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salió con ${code}`))))
    p.on('error', reject)
  })
}

async function esperarServidor(ms = 30000) {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return true
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('el servidor de prueba no respondió')
}

// ---------- navegador ----------

async function abrirNavegador() {
  const exe = rutaChrome()
  if (!exe) throw new Error('Chrome no encontrado: define CHROME_PATH')
  const puppeteer = require('puppeteer-core')
  return puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=es-CL', '--hide-scrollbars'],
  })
}

async function iniciarSesion(page, usuario = USER, clave = PASS) {
  await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#input-username')
  await page.type('#input-username', usuario)
  await page.type('#input-password', clave)
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('#btn-login'),
  ])
  await page.waitForFunction(() => document.querySelector('#sys-view') && document.querySelector('#sys-title'), { timeout: 20000 })
  // NO se escribe el período en localStorage a mano: el contrato del producto
  // es que el período viaja en la URL y el router lo aplica (escribir el
  // storage por fuera deja selector y `periodoGlobal()` en desacuerdo, que es
  // un artefacto del harness, no del producto).
  await page.evaluate(() => localStorage.removeItem('jmv.nav.cerradas'))
}

/** Espera a que la vista termine de renderizar (deja de decir «Cargando…»). */
async function esperarVista(page) {
  // El contexto de la URL (empresa/período) se aplica en el router con un
  // remontaje del shell: sin esta espera se mide/captura la pantalla ANTERIOR
  // (período del calendario) y el defecto reportado no sería del producto.
  await page.waitForFunction((p) => {
    const sel = document.querySelector('#sys-periodo')
    return !sel || sel.value === p
  }, { timeout: 12000 }, PERIODO).catch(() => {})
  await page.waitForFunction(() => {
    const v = document.querySelector('#sys-view')
    if (!v) return false
    const txt = (v.textContent || '').trim()
    return txt.length > 0 && !/^Cargando…?$/.test(txt)
  }, { timeout: 20000 }).catch(() => {})
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 8000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 250))
}

/** Lectura del estado observable del shell + defectos detectables sin ojo humano. */
async function medir(page, key) {
  return page.evaluate((k) => {
    const t = (s) => (document.querySelector(s)?.textContent || '').trim()
    const activo = document.querySelector('#sys-nav a.active')
    const vista = document.getElementById('sys-view')
    const overflow = []
    const recortados = []
    const tablas = []
    const vw = window.innerWidth
    if (document.documentElement.scrollWidth > vw + 2) {
      overflow.push(`documento ${document.documentElement.scrollWidth}px > ${vw}px`)
    }
    const etiqueta = (el) => {
      const c = el.className && typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : ''
      return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}`
    }
    document.querySelectorAll('#sys-view *').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      if (el.closest('.tbl-wrap') || el.closest('.rep-scroll') || el.closest('.sr-only') || el.closest('svg')) return
      // 1) Caja fuera del viewport (contenido cortado sin scroll).
      if (r.right > vw + 2 || r.left < -2) {
        if (overflow.length < 8) overflow.push(`${etiqueta(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
      }
      // 2) Texto que excede SU caja sin poder envolver (white-space: nowrap):
      //    es la clase de defecto de las descripciones largas dentro de `.chip`.
      const cs = getComputedStyle(el)
      const soloTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (soloTexto && cs.whiteSpace === 'nowrap' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        if (recortados.length < 6) recortados.push(`${etiqueta(el)} ${el.scrollWidth}>${el.clientWidth}px «${(el.textContent || '').trim().slice(0, 40)}»`)
      }
    })
    // 3) Tablas más anchas que su contenedor: se informa (tienen scroll propio)
    //    y se marca si el contenedor NO puede desplazarse (recorte real).
    document.querySelectorAll('#sys-view table').forEach((tbl) => {
      const wrap = tbl.parentElement
      const cs = wrap ? getComputedStyle(wrap) : null
      const w = wrap ? wrap.getBoundingClientRect().width : 0
      const tw = tbl.getBoundingClientRect().width
      if (tw > w + 2) {
        tablas.push({ ancho_tabla: Math.round(tw), ancho_caja: Math.round(w), scroll: cs ? cs.overflowX : null })
      }
    })
    return {
      key: k,
      url: location.hash,
      titulo: t('#sys-title'),
      breadcrumb: t('#sys-breadcrumb').replace(/\s+/g, ' '),
      activo: activo ? (activo.dataset.route || activo.textContent.trim()) : null,
      kicker: t('#sys-kicker'),
      periodo: document.querySelector('#sys-periodo')?.value || null,
      vacio: Boolean(vista && /Cargando…/.test(vista.textContent || '')),
      largo_texto: (vista?.textContent || '').trim().length,
      error_visible: Boolean(vista && /Error|no tiene permiso/.test(vista.textContent || '')),
      overflow,
      textos_recortados: recortados,
      tablas_con_scroll: tablas,
    }
  }, key)
}

function limpiarNombre(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Captura de lo que ve el usuario (viewport). `completa` añade la página entera:
 * el sidebar es `position: sticky` y los elementos fijos se pintan en su
 * posición de scroll, así que la captura completa NO sirve para juzgar el
 * shell — solo el contenido largo. */
async function capturar(page, { key, nombre }, sufijo, ancho, { completa = false } = {}) {
  const base = `${sufijo}-${String(ancho)}-${limpiarNombre(key)}`
  const archivo = path.join(SALIDA, `${base}.png`)
  await page.screenshot({ path: archivo, fullPage: false })
  const rutas = [path.relative(ROOT, archivo)]
  if (completa) {
    const llena = path.join(SALIDA, `${base}-completo.png`)
    await page.screenshot({ path: llena, fullPage: true })
    rutas.push(path.relative(ROOT, llena))
  }
  return rutas
}

// ---------- corrida ----------

async function main() {
  const soloArg = process.argv.find((a) => a.startsWith('--solo='))
  const solo = soloArg ? new Set(soloArg.slice(7).split(',')) : null

  fs.mkdirSync(SALIDA, { recursive: true })
  fs.mkdirSync(DIR_DB, { recursive: true })
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) fs.rmSync(f, { force: true })

  const masterKey = crypto.randomBytes(32).toString('hex')
  log('sembrando BD ficticia en', DB_PATH)
  await correr(process.execPath, ['scripts/validacion-pre-produccion/entorno-demo.js'], {
    DB_PATH, SECRETOS_MASTER_KEY: masterKey, DEMO_USER: USER, DEMO_PASS: PASS,
  })

  log(`levantando servidor aislado en ${BASE}`)
  const server = spawn(process.execPath, ['backend/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PUERTO),
      DB_PATH,
      // NODE_ENV=test evita la cookie `secure` (HTTPS) del modo producción.
      NODE_ENV: 'test',
      SECRETOS_MASTER_KEY: masterKey,
      BASIC_AUTH_USER: USER,
      BASIC_AUTH_PASS: PASS,
      // Sin proveedor real: aunque algo intentara sincronizar, el filtro de
      // empresas sin clave ya lo impide. Se deja constancia en el informe.
      RCV_PROVIDER: 'sii',
      SII_PAUSA_MS: '0',
      SII_MAX_EMPRESAS: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  server.stdout.on('data', (d) => logs.push(String(d).trim()))
  server.stderr.on('data', (d) => logs.push(String(d).trim()))

  let browser
  const informe = { generado: new Date().toISOString(), base: BASE, db: DB_PATH, periodo: PERIODO, pantallas: [], responsive: [], recorridos: [], errores_consola: [] }

  try {
    await esperarServidor()
    browser = await abrirNavegador()
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    const consola = []
    page.on('console', (m) => { if (m.type() === 'error') consola.push(m.text()) })
    page.on('pageerror', (e) => consola.push(`pageerror: ${e.message}`))
    page.on('response', (r) => { if (r.status() >= 400) consola.push(`HTTP ${r.status()} ${r.url()}`) })

    await iniciarSesion(page)

    // ---- recorrido 1: login + aterrizaje ----
    informe.recorridos.push({
      paso: 'login con usuario de prueba',
      resultado: await page.evaluate(() => ({ url: location.pathname + location.hash, usuario: document.querySelector('.u-name')?.textContent || null })),
    })

    // ---- capturas de escritorio ----
    for (const r of ESCRITORIO) {
      if (solo && !solo.has(r.key)) continue
      consola.length = 0
      // El período viaja en la URL (el boot de la SPA descarta el de
      // localStorage al elegir empresa: la URL es la fuente compartible).
      await page.goto(`${BASE}/sistema/#${r.key}?periodo=${PERIODO}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.getElementById('sys-title'), { timeout: 15000 }).catch(() => {})
      await esperarVista(page)
      const med = await medir(page, r.key)
      med.nombre = r.nombre
      med.captura = await capturar(page, r, 'escritorio', 1440, { completa: ['salud', 'inicio', 'reportes'].includes(r.key) })
      med.consola = [...new Set(consola)].slice(0, 12)
      informe.pantallas.push(med)
      log(`${r.key}: «${med.titulo}» ${med.error_visible ? '(con mensaje de error)' : ''}`)
    }

    // ---- recorrido: navegación por el acordeón (dos niveles) ----
    await page.goto(`${BASE}/sistema/#centro`, { waitUntil: 'domcontentloaded' })
    await esperarVista(page)
    const grupos = await page.$$eval('#sys-nav .nav-grupo', (gs) => gs.map((g) => ({
      seccion: g.dataset.seccion, cerrado: g.dataset.cerrado,
      items: [...g.querySelectorAll('a')].map((a) => a.dataset.route),
    })))
    informe.recorridos.push({ paso: 'menú por áreas (nivel 1) y funciones (nivel 2)', grupos })
    await page.click('#sys-nav .nav-grupo:nth-of-type(3) .nav-seccion')
    await new Promise((r) => setTimeout(r, 300))
    const acordeon = await page.$$eval('#sys-nav .nav-grupo', (gs) => gs.map((g) => ({ seccion: g.dataset.seccion, cerrado: g.dataset.cerrado })))
    informe.recorridos.push({ paso: 'abrir un área cierra las demás', estado: acordeon })
    await page.screenshot({ path: path.join(SALIDA, 'escritorio-1440-menu-acordeon.png'), fullPage: false })

    // ---- recorrido: anchor directo y filtros ----
    await page.goto(`${BASE}/sistema/#documentos?estado=PENDIENTE&periodo=${PERIODO}`, { waitUntil: 'domcontentloaded' })
    await esperarVista(page)
    const anchor = await medir(page, 'documentos-filtrado')
    anchor.captura = await capturar(page, { key: 'documentos-filtrado', nombre: 'Bandeja filtrada por URL' }, 'escritorio', 1440)
    informe.recorridos.push({ paso: 'anchor directo con filtros en la URL (#documentos?estado=PENDIENTE)', resultado: anchor })

    // ---- recorrido: informe imprimible de Salud ----
    await page.goto(`${BASE}/api/contable/empresas/1/salud-tributaria/informe?periodo=${PERIODO}`, { waitUntil: 'networkidle2' })
    const impreso = await page.evaluate(() => ({
      titulo: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || null,
      secciones: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()),
      texto: (document.body.innerText || '').slice(0, 600),
      enlaces_rotos: [...document.querySelectorAll('link[rel=stylesheet],img')].filter((e) => e.complete === false).length,
      variables_css: [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).getPropertyValue('--space-4')).length,
    }))
    informe.recorridos.push({ paso: 'informe imprimible de Salud Tributaria', resultado: impreso })
    await page.screenshot({ path: path.join(SALIDA, 'escritorio-1440-salud-informe-print.png'), fullPage: true })
    await page.emulateMediaType('print')
    await page.screenshot({ path: path.join(SALIDA, 'escritorio-1440-salud-informe-print-media.png'), fullPage: true })
    await page.emulateMediaType(null)

    // ---- recorrido: ruta restringida con rol limitado ----
    // Contexto aislado: la cookie de sesión del demo no se comparte, así que
    // /login.html no redirige y el segundo usuario puede autenticarse de verdad.
    const ctxRol = await browser.createBrowserContext()
    const pageRol = await ctxRol.newPage()
    await pageRol.setViewport({ width: 1440, height: 900 })
    await iniciarSesion(pageRol, 'demo.tesoreria', PASS)
    await pageRol.goto(`${BASE}/sistema/#crm`, { waitUntil: 'domcontentloaded' })
    await esperarVista(pageRol)
    const restringida = await medir(pageRol, 'crm-como-tesoreria')
    restringida.captura = await capturar(pageRol, { key: 'ruta-restringida-crm-tesoreria', nombre: 'Ruta restringida' }, 'escritorio', 1440)
    informe.recorridos.push({ paso: 'ruta restringida por rol (#crm con rol tesorería)', resultado: restringida })
    await ctxRol.close()

    // ---- responsive ----
    for (const [w, h, etiqueta] of [[768, 1024, 'tablet'], [390, 844, 'movil']]) {
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
      for (const key of RESPONSIVE) {
        if (solo && !solo.has(key)) continue
        consola.length = 0
        await page.goto(`${BASE}/sistema/#${key}?periodo=${PERIODO}`, { waitUntil: 'domcontentloaded' })
        await esperarVista(page)
        const med = await medir(page, key)
        med.viewport = `${w}x${h}`
        med.captura = await capturar(page, { key, nombre: key }, etiqueta, w)
        med.consola = [...new Set(consola)].slice(0, 8)
        informe.responsive.push(med)
      }
      if (etiqueta === 'movil') {
        // Con --solo=<claves que no están en RESPONSIVE> el bucle no navegó
        // nada y la pestaña podía quedar en el login (sin shell, sin botón de
        // menú). Se deja la vista en Inicio antes de medir el panel móvil.
        await page.goto(`${BASE}/sistema/#centro?periodo=${PERIODO}`, { waitUntil: 'domcontentloaded' })
        await esperarVista(page)
        // Menú desplegable abierto (el panel es lo primero que se usa en móvil).
        await page.click('#sys-menu-btn')
        await new Promise((r) => setTimeout(r, 400))
        await page.screenshot({ path: path.join(SALIDA, `movil-390-menu-abierto.png`), fullPage: false })
        const menuMovil = await page.evaluate(() => ({
          abierto: document.getElementById('sys-side')?.classList.contains('abierto') || false,
          aria: document.getElementById('sys-menu-btn')?.getAttribute('aria-expanded'),
          ancho: Math.round(document.getElementById('sys-side')?.getBoundingClientRect().width || 0),
        }))
        informe.recorridos.push({ paso: 'menú desplegable en móvil (390 px)', resultado: menuMovil })
      }
    }

    informe.errores_consola = [...new Set(consola)]
  } finally {
    if (browser) await browser.close().catch(() => {})
    server.kill()
    await new Promise((r) => setTimeout(r, 300))
    const logFile = path.join(SALIDA, 'servidor-f3.log')
    fs.writeFileSync(logFile, logs.join('\n'), 'utf8')
    const destino = path.join(SALIDA, 'informe-f3.json')
    fs.writeFileSync(destino, JSON.stringify(informe, null, 2), 'utf8')
    log('informe:', path.relative(ROOT, destino))
  }
}

main().catch((err) => {
  console.error('[F3] falló:', err.message)
  process.exit(1)
})
