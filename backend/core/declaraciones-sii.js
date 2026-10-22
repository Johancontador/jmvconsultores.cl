/**
 * declaraciones-sii.js — Declaraciones OFICIALES del SII (2026-10-21).
 *
 * Antes de este módulo el sistema solo podía ESTIMAR el F29 desde el RCV y
 * declarar «no integrado» todo lo demás. Aquí se lee lo que el contribuyente
 * YA declaró, desde el portal autenticado, y se guarda en `declaraciones_sii`.
 *
 * Fuentes verificadas contra el SII real (21-10-2026, empresa 3):
 *  1. Consulta Integral F29 — www4.sii.cl/sifmConsultaInternet
 *     · La matriz mes × año se pinta con iconos; el estado REAL está en el
 *       tooltip `.bottom` de cada celda:
 *         «Declaración sin observaciones.»            → declarada
 *         «Periodo sin declaración, haz clic…»         → no_presentada
 *         «…con observaciones» / «rectificad…»         → declarada / rectificada
 *     · «Buscar Formulario» → RESULTADO DE BUSQUEDA entrega, por período:
 *       Folio, Fecha Presentación, Estado y Monto de la declaración.
 *  2. Boletas de honorarios — loa.sii.cl CGI (acepta la sesión de zeusr por
 *     SSO dentro del mismo navegador):
 *       TMBCOC_InformeAnualBhe.cgi    (emitidas)
 *       TMBCOC_InformeAnualBheRec.cgi (recibidas)
 *     Tabla mes a mes con honorario bruto, retención de terceros, retención
 *     del contribuyente y total líquido, más la fila «Totales».
 *
 * Reglas:
 *  - UNA autenticación por corrida y cierre de sesión SIEMPRE al final: el SII
 *    limita las sesiones simultáneas por RUT (01.01.2xx.500.720.27) y dejarlas
 *    abiertas bloquea al cliente durante horas.
 *  - Nada se inventa: sin dato ⇒ `estado = 'sin_informacion'`; sin consulta ⇒
 *    la fila no existe y el informe lo declara como `no_consultado`.
 *  - Idempotente: UPSERT por (empresa, tipo, período).
 *
 * Lo que NO se consulta aquí (y el informe declara como tal): Renta F22 y
 * Declaraciones Juradas. Sus portales no exponen una consulta por RUT con el
 * login simple (F22 exige el flujo de Renta y las DDJJ se buscan formulario a
 * formulario); inventarles un endpoint sería peor que no tenerlos.
 */

const fs = require('fs')
const { loginSII, fetchConCookies } = require('../services/sii-session')
const { claveSiiDescifrada } = require('./empresas')
const f29Formulario = require('./f29-formulario')

const PORTAL = (form) => `https://www4.sii.cl/sifmConsultaInternet/index.html?dest=cifxx&form=${form}`
const BHE_EMITIDAS = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBhe.cgi'
const BHE_RECIBIDAS = 'https://loa.sii.cl/cgi_IMT/TMBCOC_InformeAnualBheRec.cgi'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_NUM = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']
const ESPERA = Number(process.env.SII_PORTAL_ESPERA_MS || 2200)

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function candidatosNavegador() {
  return [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean)
}

function rutaNavegador(candidatos = candidatosNavegador()) {
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c } catch { /* ruta inválida */ }
  }
  return null
}

/**
 * ¿Podemos abrir el portal? Se responde ANTES de autenticar: si falta el
 * navegador, autenticar primero dejaría una sesión abierta en el SII que nadie
 * cierra (justo el tope de sesiones que este módulo evita).
 */
function navegadorDisponible(candidatos) {
  const ruta = rutaNavegador(candidatos)
  if (!ruta) {
    return { disponible: false, ruta: null, motivo: 'No hay Chrome/Chromium en el servidor (define CHROME_PATH)' }
  }
  try {
    require.resolve('puppeteer-core')
  } catch {
    return { disponible: false, ruta, motivo: 'puppeteer-core no está instalado en este entorno (npm ci --omit=dev lo excluye)' }
  }
  return { disponible: true, ruta, motivo: null }
}

function errorNavegador(motivo) {
  const err = new Error(motivo)
  err.codigo = 'SII_SIN_NAVEGADOR'
  return err
}

async function abrirSesion(rut, clave) {
  const nav = navegadorDisponible()
  if (!nav.disponible) throw errorNavegador(nav.motivo)
  const exe = nav.ruta
  const jar = await loginSII(rut, clave)
  // Desde aquí SÍ hay sesión abierta en el SII: cualquier fallo (Chrome que no
  // arranca, página que no carga) tiene que cerrarla antes de propagar, o el
  // RUT queda con una sesión colgada sumando al tope de sesiones.
  try {
    const puppeteer = require('puppeteer-core')
    const browser = await puppeteer.launch({
      executablePath: exe,
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=es-CL'],
    })
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: 1440, height: 950 })
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      )
      const cookies = [...jar.cookies.entries()].map(([name, value]) => ({ name, value, domain: '.sii.cl', path: '/' }))
      await page.setCookie(...cookies)
      return { jar, browser, page }
    } catch (err) {
      try { await browser.close() } catch { /* ya cerrado */ }
      throw err
    }
  } catch (err) {
    try { await fetchConCookies('https://zeusr.sii.cl/cgi_AUT2000/CAutCierra.cgi', { method: 'GET' }, jar) } catch { /* sin red */ }
    throw err
  }
}

async function cerrarSesion({ jar, browser }) {
  try { await browser.close() } catch { /* ya cerrado */ }
  try { await fetchConCookies('https://zeusr.sii.cl/cgi_AUT2000/CAutCierra.cgi', { method: 'GET' }, jar) } catch { /* sin red */ }
}

// ---------------------------------------------------------------------------
// Normalizadores
// ---------------------------------------------------------------------------

function normalizarFecha(txt) {
  const m = String(txt || '').match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

function normalizarMonto(txt) {
  // Los montos del SII son ENTEROS y usan punto o coma como separador de
  // miles según la pantalla («$1,027,539» en la búsqueda, «1.027.539» en
  // boletas). Por eso se descartan ambos separadores en vez de interpretar
  // coma decimal: «1,027,539» no son 1,03 pesos.
  const limpio = String(txt == null ? '' : txt).replace(/[^\d-]/g, '')
  if (!limpio || limpio === '-') return null
  const n = Number(limpio)
  return Number.isFinite(n) ? Math.round(n) : null
}

/** Tooltip de la celda → estado del sistema. */
function estadoDesdeTooltip(tip) {
  const t = String(tip || '').toLowerCase()
  if (!t) return null
  if (/sin declaraci[oó]n|no hay declaraci[oó]n/.test(t)) return 'no_presentada'
  if (/rectificad/.test(t)) return 'rectificada'
  if (/con observaciones/.test(t)) return 'declarada'
  if (/sin observaciones|vigente/.test(t)) return 'declarada'
  return 'sin_informacion'
}

/** Estado que informa la búsqueda de formularios («Vigente», «Rectificada»…). */
function estadoDesdeBusqueda(txt) {
  const t = String(txt || '').toLowerCase()
  if (/rectific/.test(t)) return 'rectificada'
  if (/vigente|presentad/.test(t)) return 'declarada'
  if (/pendiente|no presentad/.test(t)) return 'no_presentada'
  if (/anulad/.test(t)) return 'no_presentada'
  return 'sin_informacion'
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

function guardar(db, { empresaId, rut, tipo, periodo, estado, folio, fechaPresentacion, montoTotal, datos }) {
  db.prepare(`
    INSERT INTO declaraciones_sii
      (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json, consultado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(empresa_id, tipo, periodo) DO UPDATE SET
      estado = excluded.estado,
      folio = excluded.folio,
      fecha_presentacion = excluded.fecha_presentacion,
      monto_total = excluded.monto_total,
      datos_json = excluded.datos_json,
      consultado_en = datetime('now')
  `).run(
    empresaId, rut, tipo, String(periodo), estado || null,
    folio || null, fechaPresentacion || null,
    montoTotal == null ? null : Number(montoTotal),
    JSON.stringify(datos || {}),
  )
}

// ---------------------------------------------------------------------------
// Consulta Integral: matriz de estados (rápida, 6 años en una página)
// ---------------------------------------------------------------------------

/**
 * Espera a que el portal autenticado esté realmente cargado. El SII es un GWT
 * lento: con una espera fija el chequeo de sesión se ejecutaba antes de que
 * pintara el encabezado y se reportaba «sesión expirada» sin serlo.
 */
async function esperarPortal(page, maxMs = 30000) {
  const inicio = Date.now()
  while (Date.now() - inicio < maxMs) {
    const cuerpo = await page.evaluate(() => document.body.innerText || '')
    if (/Cerrar Sesi/i.test(cuerpo)) return cuerpo
    if (/IngresoRutClave|AUT2000/i.test(page.url())) break
    await dormir(1000)
  }
  const err = new Error('El portal del SII no reconoció la sesión (¿expirada?)')
  err.codigo = 'SII_SESION_INVALIDA'
  throw err
}

async function leerMatrizF29(page) {
  await page.goto(PORTAL(29), { waitUntil: 'networkidle2', timeout: 90000 })
  await esperarPortal(page)

  const objetivo = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].find((x) => (x.innerText || '').trim().startsWith('F29'))
    if (!a) return null
    a.scrollIntoView({ block: 'center' })
    const r = a.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (objetivo) {
    await page.mouse.click(objetivo.x, objetivo.y)
    await dormir(ESPERA)
  }

  return page.evaluate((MESES) => {
    const a = [...document.querySelectorAll('a')].find((x) => (x.innerText || '').trim().startsWith('F29'))
    const cont = a?.closest('tr')
    if (!cont) return { anios: [], meses: [] }

    const anios = []
    for (const d of cont.querySelectorAll('.gw-par')) {
      const t = (d.innerText || '').trim()
      if (/^20\d{2}$/.test(t) && !anios.includes(t)) anios.push(t)
    }

    const meses = []
    for (const tr of cont.querySelectorAll('tr')) {
      const tds = [...tr.querySelectorAll('td')]
      const mes = (tds[0]?.innerText || '').trim().toLowerCase()
      if (!MESES.includes(mes)) continue
      // Cada año es una celda con icono y tooltip; las celdas vacías (sin
      // tooltip) son separadores y se descartan para no correr la alineación.
      const celdas = tds.slice(1)
        .map((td) => (td.querySelector('.bottom')?.innerText || '').trim())
        .filter((t) => t.length > 0)
      meses.push({ mes, celdas })
    }
    return { anios, meses }
  }, MESES)
}

// ---------------------------------------------------------------------------
// Consulta Integral: búsqueda de formularios (folio, fecha, estado y monto)
// ---------------------------------------------------------------------------

async function abrirBuscador(page) {
  await page.goto(PORTAL(29), { waitUntil: 'networkidle2', timeout: 90000 })
  await esperarPortal(page)
  await dormir(1200)
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((x) => /buscar formulario/i.test(x.innerText || ''))
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!b) throw new Error('No se encontró el botón «Buscar Formulario» en la Consulta Integral')
  await page.mouse.click(b.x, b.y)
  await dormir(1500)
}

/**
 * Búsqueda ANUAL del F29: una sola consulta devuelve los 12 períodos del año
 * con folio, fecha de presentación, estado y monto declarado (verificado
 * contra el SII: 12 filas para 2025). El radio «Anual» del diálogo NO viene
 * marcado por defecto, así que hay que activarlo con un clic real: el handler
 * de GWT ignora `.click()` programático.
 */
async function buscarF29Anio(page, anio) {
  await abrirBuscador(page)

  const radio = await page.evaluate(() => {
    const r = [...document.querySelectorAll('input[type=radio]')]
      .find((x) => /anual/i.test(x.nextSibling?.textContent || ''))
    if (!r) return null
    r.scrollIntoView({ block: 'center' })
    const b = r.getBoundingClientRect()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  })
  if (radio) {
    await page.mouse.click(radio.x, radio.y)
    await dormir(800)
  }

  await page.evaluate((anio) => {
    const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === String(anio)))
    if (s) { s.value = String(anio); s.dispatchEvent(new Event('change', { bubbles: true })) }
  }, anio)
  await dormir(500)

  const boton = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].filter((x) => (x.innerText || '').trim() === 'Consultar').pop()
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!boton) return []
  await page.mouse.click(boton.x, boton.y)
  await dormir(4000)

  return page.evaluate(() => {
    const filas = []
    for (const tr of document.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').trim())
      if (c.length < 6) continue
      // Periodo (YYYY-MM) · Folio · Contribuyente · Fecha · Estado · Monto · Ver
      if (!/^\d{4}-\d{2}$/.test(c[0])) continue
      filas.push({
        periodo: c[0].replace('-', ''),
        folio: c[1] || null,
        fecha: c[3] || null,
        estado: c[4] || null,
        monto: c[5] || null,
      })
    }
    return filas
  })
}

// ---------------------------------------------------------------------------
// Boletas de honorarios (CGI anual)
// ---------------------------------------------------------------------------

/**
 * Convierte las filas YA RENDERIZADAS de la tabla del CGI en datos.
 * Columnas del SII: MES · FOLIOS(Inicial, Final) · EMISIONES(Vigentes,
 * Anuladas) · HONORARIO BRUTO · RETENCIÓN TERCEROS · RETENCIÓN CONTRIBUYENTE
 * · TOTAL LÍQUIDO. Se recibe texto (no HTML) porque la tabla se escribe con
 * document.write y el HTML crudo no trae los valores.
 */
function parsearTablaBhe(filasTexto) {
  const filas = []
  const meses = MESES.map((x) => x.toUpperCase())
  for (const celdas of filasTexto || []) {
    const etiqueta = String(celdas[0] || '').trim().toUpperCase()
    if (meses.includes(etiqueta)) {
      filas.push({
        mes: MESES_NUM[meses.indexOf(etiqueta)],
        folio_inicial: celdas[1] || null,
        folio_final: celdas[2] || null,
        vigentes: normalizarMonto(celdas[3]),
        anuladas: normalizarMonto(celdas[4]),
        honorario_bruto: normalizarMonto(celdas[5]),
        retencion_terceros: normalizarMonto(celdas[6]),
        retencion_contribuyente: normalizarMonto(celdas[7]),
        total_liquido: normalizarMonto(celdas[8]),
      })
    } else if (/^TOTALES/i.test(etiqueta)) {
      filas.push({
        totales: true,
        vigentes: normalizarMonto(celdas[1]),
        anuladas: normalizarMonto(celdas[2]),
        honorario_bruto: normalizarMonto(celdas[3]),
        retencion_terceros: normalizarMonto(celdas[4]),
        retencion_contribuyente: normalizarMonto(celdas[5]),
        total_liquido: normalizarMonto(celdas[6]),
      })
    }
  }
  return filas
}

async function leerBhe(page, { rut, dv, anio, tipo }) {
  const base = tipo === 'recibidas' ? BHE_RECIBIDAS : BHE_EMITIDAS
  const url = `${base}?rut_arrastre=${rut}&dv_arrastre=${dv}&cbanoinformeanual=${anio}`
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 })
  await dormir(ESPERA)
  const html = await page.content()
  if (/IngresoRutClave/i.test(html)) {
    const err = new Error('El portal de boletas no aceptó la sesión del SII')
    err.codigo = 'SII_SESION_INVALIDA'
    throw err
  }
  const filasTexto = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => /ENERO/.test(x.innerText) && /DICIEMBRE/.test(x.innerText))
    if (!t) return []
    return [...t.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => (td.innerText || '').trim()))
  })
  const filas = parsearTablaBhe(filasTexto)
  const totales = filas.find((f) => f.totales) || null
  return { filas: filas.filter((f) => !f.totales), totales, url }
}

// ---------------------------------------------------------------------------
// CONSULTA DE ESTADO + FORMULARIO COMPACTO (la verdad declarada del F29)
// ---------------------------------------------------------------------------
//
// La búsqueda anual entrega folio, fecha, estado y MONTO de cada declaración.
// El Formulario Compacto es el PDF del F29 tal como se presentó: ahí están
// las casillas 502/510/538 (ventas declaradas), 520/528/537 (compras),
// 089 (IVA determinado), 063 (PPM), 091/092/093/094 (total a pagar) y las
// notas de crédito. Es la ÚNICA fuente que permite comparar «lo declarado»
// contra «lo que el sistema estima desde el RCV».
//
// El PDF no se baja con una URL estable: el SII exige un `codInt` que se
// genera al pulsar la pestaña «Formulario Compacto» de la consulta de estado
// del período. Por eso el flujo es: resultados → «Ver» del período →
// «Formulario Compacto» → descarga en el MISMO origen con la sesión viva.

/** Normaliza '$1.234.567' a 1234567; null si no hay número. */
function montoDeTexto(txt) {
  const m = String(txt || '').match(/[\d][\d\.]*/)
  if (!m) return null
  const n = Number(m[0].replace(/\./g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Parsea el texto de la «CONSULTA DE ESTADO» de un período.
 * Es una función PURA: recibe el innerText y devuelve los antecedentes
 * (folio, situación, vigentes, intentos, monto observado, observaciones e
 * historial de eventos). Si el texto no trae algo, ese dato queda en null:
 * el informe lo declara como ausente, nunca lo completa por su cuenta.
 */
function parsearEstadoF29(texto) {
  const t = String(texto || '')
  const out = {
    folio: null,
    situacion: null,
    declaraciones_vigentes: null,
    intentos_declaracion: null,
    monto_observado: null,
    notificaciones: [],
    observaciones: [],
    eventos: [],
    texto: t.slice(0, 6000),
  }

  // «8103205416 - DECLARACION VIGENTE»
  const mFolio = t.match(/(\d{6,12})\s*-\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s.-]{3,60})/)
  if (mFolio) {
    out.folio = mFolio[1]
    out.situacion = mFolio[2].trim().replace(/\s+/g, ' ')
  }

  const mVig = t.match(/Declaraciones\s+Vigentes\s*[\t\r\n\s]*(\d+)/i)
  if (mVig) out.declaraciones_vigentes = Number(mVig[1])

  const mInt = t.match(/Intentos\s+de\s+Declaraci[oó]n\s*[\t\r\n\s]*(\d+)/i)
  if (mInt) out.intentos_declaracion = Number(mInt[1])

  const mMonto = t.match(/Monto\s+Observado\s*[\t\r\n\s]*\$?\s*([\d\.]+)/i)
  if (mMonto) out.monto_observado = montoDeTexto(mMonto[1])

  // Historial de eventos: cada entrada empieza con dd/mm/yyyy [hh:mm:ss]
  const idx = t.search(/Historial\s+de\s+Eventos/i)
  if (idx >= 0) {
    const lineas = t.slice(idx).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    for (let i = 0; i < lineas.length; i++) {
      const md = lineas[i].match(/^(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)$/)
      if (!md) continue
      out.eventos.push({
        fecha: md[1],
        descripcion: lineas[i + 1] || null,
        detalle: lineas[i + 2] || null,
      })
      i += 2
    }
  }
  return out
}

/** Vuelve a la pestaña «Resultado Búsqueda» del portal (GWT). */
async function volverAResultados(page) {
  const punto = await page.evaluate(() => {
    const el = [...document.querySelectorAll('a')].find((x) => /Resultado\s+B[uú]squeda/i.test((x.innerText || '').trim()))
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  if (!punto) return false
  await page.mouse.click(punto.x, punto.y)
  await dormir(1500)
  return true
}

/**
 * Coordenadas del enlace «Ver» de un período en la tabla de resultados.
 * @returns {Promise<{x:number,y:number}|null>}
 */
async function puntoVerPeriodo(page, periodo) {
  return page.evaluate((per) => {
    const objetivo = per.replace('-', '')
    for (const tr of document.querySelectorAll('tr')) {
      const c = [...tr.querySelectorAll('td')].map((td) => (td.innerText || '').trim())
      if (c[0] && c[0].replace('-', '') === objetivo) {
        const a = tr.querySelectorAll('td')[6]?.querySelector('a')
        if (!a) return null
        a.scrollIntoView({ block: 'center' })
        const r = a.getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
    }
    return null
  }, periodo)
}

/** Lee el texto de la consulta de estado (pestaña abierta tras pulsar «Ver»). */
async function leerEstadoF29(page) {
  await dormir(2500)
  const texto = await page.evaluate(() => document.body ? document.body.innerText : '')
  return parsearEstadoF29(texto)
}

/**
 * Pulsa «Formulario Compacto», descarga el PDF y lo parsea.
 * @returns {Promise<{ok:boolean, error?:string, url?:string, folio?:string,
 *   bytes?:number, casillas?:Array, indicadores?:object, verificaciones?:Array}>}
 */
async function leerFormularioCompacto(page, { periodo } = {}) {
  const punto = await page.evaluate(() => {
    const sel = ['a', 'button', 'td', 'span', 'div']
    for (const tag of sel) {
      for (const el of document.querySelectorAll(tag)) {
        if ((el.innerText || '').trim() === 'Formulario Compacto') {
          el.scrollIntoView({ block: 'center' })
          const r = el.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        }
      }
    }
    return null
  })
  if (!punto) return { ok: false, error: 'No se encontró la pestaña «Formulario Compacto» en la consulta de estado' }

  const browser = page.browser()
  const antes = (await browser.pages()).length
  await page.mouse.click(punto.x, punto.y)
  await dormir(4000)
  const paginas = await browser.pages()
  const destino = paginas.length > antes ? paginas[paginas.length - 1] : page
  const url = destino.url()
  const mFolio = url.match(/folio=(\d+)/)

  // La descarga se hace desde la PESTAÑA CON SESIÓN (mismo origen): así la
  // cookie de sesión del SII viaja con la petición del PDF.
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'include' })
    const buf = await r.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }, url)

  if (paginas.length > antes) await destino.close().catch(() => { /* la pestaña auxiliar */ })

  const buffer = Buffer.from(b64, 'base64')
  if (buffer.length < 1000 || buffer.slice(0, 4).toString('latin1') !== '%PDF') {
    return { ok: false, error: 'El SII no devolvió un PDF (¿sesión vencida o folio sin formulario compacto?)', url }
  }

  const { casillas, lineas } = f29Formulario.parsearFormularioF29(buffer)
  const { indicadores, verificaciones } = f29Formulario.indicadores(casillas)
  return {
    ok: true,
    url,
    folio: mFolio ? mFolio[1] : null,
    bytes: buffer.length,
    casillas,
    indicadores,
    verificaciones,
    lineas: lineas.slice(0, 400),
  }
}

/** Últimos n períodos (YYYYMM) terminando en `hasta`. */
function ultimosPeriodos(n, hasta) {
  const y = Number(hasta.slice(0, 4))
  const m = Number(hasta.slice(4, 6))
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i
    let yy = y
    while (mm <= 0) { mm += 12; yy-- }
    out.push(`${yy}${String(mm).padStart(2, '0')}`)
  }
  return out
}

/**
 * Sincroniza el detalle DECLARADO de los F29: estado y Formulario Compacto
 * (casillas) de cada período declarado. Es idempotente (UPSERT por empresa y
 * período) y va en la tabla `f29_formularios`.
 *
 * @param {function} onProgress (info) => void — reporta avance por período.
 */
async function sincronizarFormularios(db, { empresaId, usuarioId = null, periodo, periodos = 12, onProgress = null }) {
  const emp = db.prepare(`SELECT id, rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const clave = claveSiiDescifrada(db, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada')

  const lista = ultimosPeriodos(periodos, periodo)
  const desde = lista[0]
  const resultado = { periodos: 0, con_formulario: 0, errores: [], consultados: [] }
  let ctx = null

  try {
    ctx = await abrirSesion(emp.rut, clave)
    const { page } = ctx

    // Se agrupan por año: la búsqueda anual del SII devuelve los 12 períodos
    // del año de una sola vez.
    const porAnio = new Map()
    for (const p of lista) {
      const a = p.slice(0, 4)
      if (!porAnio.has(a)) porAnio.set(a, [])
      porAnio.get(a).push(p)
    }

    for (const [anio, periodosAnio] of [...porAnio.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      let filas = []
      try {
        filas = await buscarF29Anio(page, anio)
      } catch (err) {
        resultado.errores.push(`Búsqueda F29 ${anio}: ${err.message}`)
        continue
      }
      const porPeriodo = new Map(filas.map((f) => [f.periodo, f]))

      for (const per of periodosAnio) {
        const fila = porPeriodo.get(per)
        if (!fila || !fila.folio) continue // no hay declaración: nada que leer
        if (onProgress) onProgress({ fase: 'f29', periodo: per, estado: 'leyendo' })
        try {
          // La consulta de estado se abre desde la pestaña de resultados.
          let punto = await puntoVerPeriodo(page, `${anio}-${per.slice(4)}`)
          if (!punto) {
            await volverAResultados(page)
            punto = await puntoVerPeriodo(page, `${anio}-${per.slice(4)}`)
          }
          if (!punto) {
            resultado.errores.push(`${per}: no se encontró el enlace «Ver» en los resultados`)
            continue
          }
          await page.mouse.click(punto.x, punto.y)
          const estado = await leerEstadoF29(page)
          const compacto = await leerFormularioCompacto(page, { periodo: per })

          const indicadores = compacto.ok ? compacto.indicadores : null
          db.prepare(`
            INSERT INTO f29_formularios
              (empresa_id, rut, periodo, folio, estado, situacion, monto_observado,
               declaraciones_vigentes, intentos, indicadores_json, casillas_json,
               verificaciones_json, eventos_json, url, datos_json, consultado_en)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(empresa_id, periodo) DO UPDATE SET
              folio = excluded.folio,
              estado = excluded.estado,
              situacion = excluded.situacion,
              monto_observado = excluded.monto_observado,
              declaraciones_vigentes = excluded.declaraciones_vigentes,
              intentos = excluded.intentos,
              indicadores_json = excluded.indicadores_json,
              casillas_json = excluded.casillas_json,
              verificaciones_json = excluded.verificaciones_json,
              eventos_json = excluded.eventos_json,
              url = excluded.url,
              datos_json = excluded.datos_json,
              consultado_en = datetime('now')
          `).run(
            empresaId, emp.rut, per,
            fila.folio || null,
            fila.estado || null,
            estado.situacion || null,
            estado.monto_observado != null ? estado.monto_observado : (fila.monto != null ? montoDeTexto(fila.monto) : null),
            estado.declaraciones_vigentes,
            estado.intentos_declaracion,
            JSON.stringify(indicadores || {}),
            JSON.stringify(comacto.ok ? compacto.casillas : []),
            JSON.stringify(comacto.ok ? compacto.verificaciones : []),
            JSON.stringify(estado.eventos || []),
            compacto.url || null,
            JSON.stringify({
              estado_texto: estado.texto,
              eventos: estado.eventos,
              compactado: compacto.ok ? { bytes: compacto.bytes, folio: compacto.folio } : { error: compacto.error },
              origen: 'Consulta Integral F29 + Formulario Compacto (SII)',
            }),
          )
          resultado.periodos++
          if (comulto.ok) resultado.con_formulario++
          resultado.consultados.push(per)
          if (onProgress) onProgress({ fase: 'f29', periodo: per, estado: 'ok', compactado: compacto.ok })
        } catch (err) {
          resultado.errores.push(`${per}: ${err.message}`)
          if (onProgress) onProgress({ fase: 'f29', periodo: per, estado: 'error', error: err.message })
        }
        // Vuelve a los resultados para el siguiente período.
        await volverAResultados(page)
      }
    }
  } finally {
    if (ctx) await cerrarSesion(ctx)
  }

  return resultado
}

// ---------------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------------

/**
 * Sincroniza las declaraciones de una empresa.
 * @returns {{resultado: object, aviso: string|null}}
 */
async function sincronizar(db, { empresaId, usuarioId = null, periodo, anios = 5 }) {
  const emp = db.prepare(`SELECT id, rut, razon_social_sii, nombre, clave_sii FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const clave = claveSiiDescifrada(db, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada: sin ella no se pueden consultar declaraciones')

  const [rutCuerpo, dv] = emp.rut.split('-')
  const anioHasta = Number(periodo.slice(0, 4))
  const anioDesde = anioHasta - anios + 1
  const aniosLista = []
  for (let a = anioHasta; a >= anioDesde; a--) aniosLista.push(String(a))

  const resultado = { f29: null, f22: null, juradas: null, boletas: null }
  const avisos = []
  let ctx = null

  try {
    ctx = await abrirSesion(emp.rut, clave)
    const { page } = ctx

    // ---------- F29: matriz de estados (una sola página) ----------
    const matriz = await leerMatrizF29(page)
    const porPeriodo = new Map()
    for (const fila of matriz.meses) {
      const mesIdx = MESES.indexOf(fila.mes)
      if (mesIdx === -1) continue
      fila.celdas.forEach((tooltip, i) => {
        const anio = matriz.anios[i]
        if (!anio) return
        if (Number(anio) < anioDesde) return
        porPeriodo.set(`${anio}${MESES_NUM[mesIdx]}`, {
          estado: estadoDesdeTooltip(tooltip),
          tooltip,
        })
      })
    }

    // ---------- F29: folio, fecha y monto por año ----------
    // La búsqueda anual trae todos los meses declarados en una tabla; el mes a
    // mes solo se usa si la anual no devuelve filas.
    let buscadas = 0
    for (const anio of aniosLista) {
      let filas = []
      try {
        filas = await buscarF29Anio(page, anio)
      } catch (err) {
        avisos.push(`Búsqueda F29 ${anio}: ${err.message}`)
        continue
      }
      for (const f of filas) {
        const prev = porPeriodo.get(f.periodo) || {}
        porPeriodo.set(f.periodo, {
          ...prev,
          estado: estadoDesdeBusqueda(f.estado) || prev.estado || 'sin_informacion',
          folio: f.folio,
          fecha: normalizarFecha(f.fecha),
          monto: normalizarMonto(f.monto),
          estado_sii: f.estado,
        })
        buscadas++
      }
    }

    for (const [per, d] of porPeriodo) {
      guardar(db, {
        empresaId, rut: emp.rut, tipo: 'F29', periodo: per,
        estado: d.estado || 'sin_informacion',
        folio: d.folio || null,
        fechaPresentacion: d.fecha || null,
        montoTotal: d.monto ?? null,
        datos: {
          tooltip: d.tooltip || null,
          estado_sii: d.estado_sii || null,
          origen: 'sifmConsultaInternet (Consulta Integral F29)',
        },
      })
    }
    resultado.f29 = {
      periodos: porPeriodo.size,
      con_folio: buscadas,
      desde: `${anioDesde}01`,
      hasta: periodo,
      anios: matriz.anios,
    }

    // ---------- Boletas de honorarios ----------
    try {
      const emitidas = {}
      const recibidas = {}
      for (const anio of aniosLista) {
        emitidas[anio] = await leerBhe(page, { rut: rutCuerpo.replace(/\./g, ''), dv, anio, tipo: 'emitidas' })
        recibidas[anio] = await leerBhe(page, { rut: rutCuerpo.replace(/\./g, ''), dv, anio, tipo: 'recibidas' })
      }
      for (const anio of aniosLista) {
        const e = emitidas[anio]
        const r = recibidas[anio]
        guardar(db, {
          empresaId, rut: emp.rut, tipo: 'BHE', periodo: anio,
          estado: 'declarada',
          montoTotal: e.totales?.honorario_bruto ?? null,
          datos: {
            emitidas: { meses: e.filas, totales: e.totales },
            recibidas: { meses: r.filas, totales: r.totales },
            origen: 'loa.sii.cl TMBCOC_InformeAnualBhe(.Rec)',
          },
        })
      }
      resultado.boletas = {
        anios: aniosLista.length,
        emitidas_bruto: aniosLista.reduce((s, a) => s + (emitidas[a].totales?.honorario_bruto || 0), 0),
        recibidas_bruto: aniosLista.reduce((s, a) => s + (recibidas[a].totales?.honorario_bruto || 0), 0),
      }
    } catch (err) {
      avisos.push(`Boletas de honorarios: ${err.message}`)
      resultado.boletas = { anios: 0, error: err.message }
    }
  } finally {
    if (ctx) await cerrarSesion(ctx)
  }

  // F22 y DDJJ no tienen consulta por RUT con este login: se declaran ausentes.
  resultado.f22 = { anios: 0, estado: 'no_consultado' }
  resultado.juradas = { estado: 'no_consultado' }

  return { resultado, aviso: avisos.length ? avisos.join(' · ') : null }
}

/**
 * Última vez que se consultaron declaraciones de una empresa (ISO) o null.
 * La usa la sincronización diaria para no volver a abrir una sesión de
 * navegador todos los días: las declaraciones no cambian a diario.
 */
function ultimaConsulta(db, empresaId) {
  const fila = db.prepare(`SELECT MAX(consultado_en) AS ult FROM declaraciones_sii WHERE empresa_id = ?`).get(empresaId)
  return fila && fila.ult ? fila.ult : null
}

module.exports = {
  sincronizar,
  sincronizarFormularios,
  ultimaConsulta,
  // helpers puros (tests)
  estadoDesdeTooltip,
  estadoDesdeBusqueda,
  normalizarFecha,
  normalizarMonto,
  parsearTablaBhe,
  parsearEstadoF29,
  montoDeTexto,
  ultimosPeriodos,
  // disponibilidad del navegador headless (no toca el SII)
  navegadorDisponible,
}
