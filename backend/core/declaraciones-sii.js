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
  ultimaConsulta,
  // helpers puros (tests)
  estadoDesdeTooltip,
  estadoDesdeBusqueda,
  normalizarFecha,
  normalizarMonto,
  parsearTablaBhe,
  // disponibilidad del navegador headless (no toca el SII)
  navegadorDisponible,
}
