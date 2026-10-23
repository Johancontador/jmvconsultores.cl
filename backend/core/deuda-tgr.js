/**
 * deuda-tgr.js — Deuda fiscal REAL del contribuyente en la Tesorería General
 * de la República (TGR) y su certificado oficial.
 *
 * Por qué TGR y no el SII: el «Certificado de deuda fiscal» lo emite la TGR
 * (la deuda tributaria se paga en Tesorería), no el SII. Hasta hoy el informe
 * de Salud Tributaria solo mostraba deuda COMERCIAL (cuentas por cobrar y por
 * pagar del sistema) y estimaba contingencias propias; la deuda con el Fisco
 * no existía. Esto la trae con la misma clave tributaria que ya está en la
 * bóveda, sin pedir credenciales nuevas.
 *
 * Flujo verificado contra el portal real el 2026-10-22:
 *   1. tgr.gob.cl/tramites-tgr/certificado-de-deuda-fiscal → «Clave Tributaria».
 *   2. El SSO delega en el SII (www2.sii.cl/oauthsii-v1-org): RUT + clave.
 *   3. Tesorería entrega un token de trámite de un solo uso
 *      (LoginPortalPagosTGR12Web/redirect?vr=<base64>) que abre la app legada
 *      CertDeudasRutCutAixWeb.
 *   4. El certificado se renderiza como PDF embebido en un iframe
 *      (data:application/pdf;base64,…). Se guarda como evidencia y se extrae
 *      su texto con pdf-parse.
 *
 * REGLA DE ORO (igual que el resto del proyecto): nada se inventa. Si la TGR
 * no responde, se lanza un error con código y el informe declara «no
 * consultado». Si responde «NO REGISTRA DEUDA», el total es 0 con esa
 * evidencia. Si el certificado no informa un total legible, `total` queda
 * NULL y se conserva el texto/PDF: nunca se suma a mano lo que no se entendió.
 */

const fs = require('fs')
const path = require('path')
const { claveSiiDescifrada } = require('./empresas')
const { navegadorDisponible } = require('./declaraciones-sii')

const PORTAL = 'https://tgr.gob.cl/tramites-tgr/certificado-de-deuda-fiscal/'
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

const MONTO = /(-?\$?\s?\d{1,3}(?:\.\d{3})+|-?\$\s?\d+)/g

/** Monto chileno ('$1.234.567' / '1234567') → entero en pesos. */
function montoDeTexto(txt) {
  const t = String(txt || '').replace(/[^\d-]/g, '')
  if (!t || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** dd-mm-yyyy → yyyy-mm-dd. */
function fechaISO(txt) {
  const m = String(txt || '').match(/(\d{2})-(\d{2})-(\d{4})/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/**
 * Detalle de deuda por línea del certificado: documento, período y monto.
 *
 * La cartola fiscal de la TGR (que es la fuente estructurada ideal) está
 * protegida por reCAPTCHA: automatizarla exigiría resolver un captcha, así que
 * NO se scrapea. El certificado de deuda sí es automatizable y, cuando el
 * contribuyente tiene deuda, su PDF lista los documentos. Aquí se estructuran
 * esas líneas SIN sumar nada: si una línea no se entiende, se deja fuera.
 *
 * @returns {Array<{documento:string|null, periodo:string|null, monto:number, glosa:string}>}
 */
function parsearDetalle(lineas = []) {
  const PERIODO = /\b(?:(\d{1,2})[/-](\d{4})|(\d{4})[/-](\d{1,2})|((?:19|20)\d{2}))\b/
  const NO_ES_FILA = /^(total|subtotal|fecha|hora|liquidada|emitido|c[oó]digo|documento no|p[aá]gina|rut|nombre|direcci[oó]n|comuna|importante|el servicio|certificado)/i
  const salida = []
  for (const linea of lineas) {
    const l = String(linea).trim()
    if (!l || l.length < 8 || NO_ES_FILA.test(l)) continue
    if (!/\d/.test(l)) continue
    const per = l.match(PERIODO)
    if (!per) continue
    let periodo = null
    if (per[1] && per[2]) periodo = `${per[2]}${String(per[1]).padStart(2, '0')}`
    else if (per[3] && per[4]) periodo = `${per[3]}${String(per[4]).padStart(2, '0')}`
    else periodo = per[5]
    // El monto de la fila es el ÚLTIMO importe de la línea (las columnas
    // anteriores suelen ser folio o cuota, no dinero).
    const montos = (l.match(/-?\$?\s?\d{1,3}(?:\.\d{3})+|-?\$\s?\d+/g) || [])
      .map((m) => montoDeTexto(m))
      .filter((n) => n != null && Math.abs(n) >= 100)
    if (!montos.length) continue
    const monto = montos[montos.length - 1]
    const antes = l.slice(0, per.index).replace(/[\s:·-]+$/, '').trim()
    const forma = l.match(/\b(?:formulario|form\.?|f)\s*(\d{2,3})\b/i)
    const documento = forma ? `F${forma[1]}` : (antes || null)
    salida.push({
      documento,
      periodo,
      monto,
      glosa: l.replace(/\s+/g, ' ').slice(0, 160),
    })
  }
  return salida
}

/**
 * Interpreta el TEXTO del certificado. Función pura (se prueba con el texto
 * real de un certificado sin deuda y con uno con deuda).
 */
function parsearCertificado(texto) {
  const limpio = String(texto || '').replace(/\r/g, '')
  const lineas = limpio.split('\n').map((l) => l.trim()).filter(Boolean)
  const sinDeuda = /NO REGISTRA DEUDA/i.test(limpio)
  const documentos = sinDeuda ? [] : parsearDetalle(lineas)
  const totalCalculado = documentos.length
    ? documentos.reduce((s, d) => s + (d.monto || 0), 0)
    : null

  const emision = limpio.match(/Fecha de Emisi[oó]n del Certificado:\s*([\d-]{8,10})/i)
  const liquidada = limpio.match(/Liquidada al:\s*([\d-]{8,10})/i)
  const codigo = limpio.match(/\b\d{3}[A-Z]{2}\d{13,16}\b/)
  const rut = limpio.match(/\b(\d{1,2}\.\d{3}\.\d{3}-[\dkK])\b/)

  // Total explícito: solo una línea rotulada como total. No se suman montos
  // sueltos (podrían incluir reajustes, intereses o pagos ya imputados).
  let total = null
  let etiquetaTotal = null
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i]
    const rotulo = l.match(/^(TOTAL(?:\s+A\s+PAGAR|\s+DEUDA|\s+FISCAL)?|MONTO\s+TOTAL)\b[^\d$]*(\$?\s?\d[\d.]*)/i)
    if (rotulo) {
      total = montoDeTexto(rotulo[2])
      etiquetaTotal = rotulo[1]
      break
    }
    if (/^TOTAL(?:\s+A\s+PAGAR|\s+DEUDA|\s+FISCAL)?$/i.test(l)) {
      const siguiente = lineas[i + 1] || ''
      const m = siguiente.match(/\$?\s?\d[\d.]*/)
      if (m) { total = montoDeTexto(m[0]); etiquetaTotal = l; break }
    }
  }

  if (sinDeuda) total = 0
  if (!sinDeuda && total == null) {
    // Sin rótulo «TOTAL» no se afirma un monto: se conservan los importes
    // detectados para que el contador los revise en el PDF.
    const detectados = [...new Set((limpio.match(MONTO) || []).map((x) => montoDeTexto(x)).filter((n) => n != null))]
    return {
      estado: 'con_deuda',
      total: null,
      etiqueta_total: null,
      moneda: 'CLP',
      fecha_emision: fechaISO(emision && emision[1]),
      liquidada_al: fechaISO(liquidada && liquidada[1]),
      codigo_verificacion: codigo ? codigo[0] : null,
      rut: rut ? rut[1] : null,
      montos_detectados: detectados,
      documentos,
      total_calculado: totalCalculado,
      lineas,
      confianza: 'baja',
    }
  }

  return {
    estado: sinDeuda ? 'sin_deuda' : 'con_deuda',
    total,
    etiqueta_total: etiquetaTotal,
    moneda: 'CLP',
    fecha_emision: fechaISO(emision && emision[1]),
    liquidada_al: fechaISO(liquidada && liquidada[1]),
    codigo_verificacion: codigo ? codigo[0] : null,
    rut: rut ? rut[1] : null,
    montos_detectados: [],
    // Detalle por documento cuando el certificado lo trae (nunca se inventa:
    // solo filas con período e importe legibles).
    documentos,
    total_calculado: totalCalculado,
    lineas,
    confianza: sinDeuda ? 'alta' : (etiquetaTotal ? 'media' : 'baja'),
  }
}

/** Nombre del titular (la línea anterior a «NOMBRE» en el certificado). */
function nombreCertificado(texto) {
  const lineas = String(texto || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const i = lineas.findIndex((l) => /^NOMBRE$/i.test(l))
  return i > 0 ? lineas[i - 1] : null
}

/** ¿Hay Chrome para abrir el portal? Se responde ANTES de tocar la TGR. */
function disponible() {
  return navegadorDisponible()
}

function errorTgr(mensaje, codigo) {
  const err = new Error(mensaje)
  err.codigo = codigo
  return err
}

/**
 * Abre el portal de la TGR con Clave Tributaria y devuelve el PDF del
 * certificado de deuda + su texto. Sin dependencias inyectadas.
 */
/**
 * El portal hace redirecciones de SPA que a veces destruyen el contexto de la
 * página en medio de la navegación («Execution context was destroyed»). Es una
 * carrera del navegador, no un rechazo de la TGR: se reintenta UNA vez.
 */
function esFalloTransitorio(err) {
  return !err.codigo && /Execution context was destroyed|Target closed|Navigating frame|net::ERR_/i.test(err.message || '')
}

async function descargarCertificado(opciones) {
  try {
    return await descargarUnaVez(opciones)
  } catch (err) {
    if (!esFalloTransitorio(err)) throw err
    await dormir(1200)
    return descargarUnaVez(opciones)
  }
}

async function descargarUnaVez({ rut, dv, clave }) {
  const nav = navegadorDisponible()
  if (!nav.disponible) throw errorTgr(nav.motivo, 'TGR_SIN_NAVEGADOR')
  const puppeteer = require('puppeteer-core')
  const pdfParse = require('pdf-parse')

  const browser = await puppeteer.launch({
    executablePath: nav.ruta,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=es-CL'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 950 })
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
  )
  try {
    const respPortal = await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!respPortal || respPortal.status() >= 400) {
      throw errorTgr(`La TGR no respondió el portal (HTTP ${respPortal ? respPortal.status() : 'sin respuesta'})`, 'TGR_WAF')
    }
    await dormir(3000)

    // Selector de Clave Tributaria (el botón no tiene texto, solo clase).
    const btnClave = await page.$('#id-button-idp-claveTributaria')
    if (!btnClave) throw errorTgr('La TGR cambió el selector de Clave Tributaria', 'TGR_PORTAL_CAMBIADO')
    await btnClave.click()
    await page.waitForSelector('#inputRut', { timeout: 45000 })

    await page.click('#inputRut', { clickCount: 3 })
    await page.type('#inputRut', `${rut}-${dv}`, { delay: 25 })
    await page.click('#inputPass', { clickCount: 3 })
    await page.type('#inputPass', clave, { delay: 25 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null),
      page.click('#bt_ingresar'),
    ])

    // El SSO vuelve por LoginPortalCognito y recién despues la página del
    // trámite expone el token `go=` (base64 con el `vr`). Esperar con
    // paciencia: cortar a los 5 s intermitía entre corridas.
    let url = page.url()
    for (let i = 0; i < 30 && !/[?&]go=|CertDeudasRutCutAixWeb/i.test(url); i++) {
      await dormir(1000)
      url = page.url()
    }
    if (!/tesoreria\.cl/i.test(url)) {
      const texto = await page.evaluate(() => (document.body.innerText || '').slice(0, 300)).catch(() => '')
      if (/rut no v[aá]lido|clave incorrecta|no existe/i.test(texto)) {
        throw errorTgr('La TGR rechazó el RUT o la clave tributaria (son las mismas del SII)', 'TGR_SESION_INVALIDA')
      }
      throw errorTgr('La TGR no completó el inicio de sesión con Clave Tributaria', 'TGR_SESION_INVALIDA')
    }

    // Token de trámite de un solo uso (vr). Sin él, la app legada responde 401.
    let destino = null
    const mgo = url.match(/[?&]go=([^&]+)/)
    if (mgo) {
      destino = decodeURIComponent(mgo[1])
    } else if (/CertDeudasRutCutAixWeb/i.test(url)) {
      destino = url
    } else {
      // A veces el token no queda en la barra de direcciones sino en el src
      // del iframe del trámite. Se busca en el DOM antes de rendirse.
      const enDom = await page.evaluate(() => {
        const rx = /https:\/\/www\.tesoreria\.cl\/(?:LoginPortalPagosTGR12Web\/redirect\?vr=|CertDeudas)[^"'\s]*/
        for (const el of document.querySelectorAll('iframe,a,form')) {
          const s = el.src || el.href || el.action || ''
          const m = String(s).match(rx)
          if (m) return m[0]
        }
        return null
      }).catch(() => null)
      if (enDom) destino = enDom
    }
    if (!destino || !/^https:\/\/www\.tesoreria\.cl\//i.test(destino)) {
      throw errorTgr(`La TGR no entregó el token del trámite de certificado de deuda (quedó en ${url.slice(0, 120)})`, 'TGR_SIN_TOKEN')
    }

    const resp = await page.goto(destino, { waitUntil: 'networkidle2', timeout: 90000 })
    if (!resp || resp.status() >= 400) {
      throw errorTgr(`La TGR rechazó el certificado (HTTP ${resp ? resp.status() : 'sin respuesta'})`, 'TGR_SIN_CERTIFICADO')
    }

    // El PDF se carga como data URL dentro de un iframe.
    let b64 = null
    for (let i = 0; i < 30 && !b64; i++) {
      b64 = await page.evaluate(() => {
        const f = [...document.querySelectorAll('iframe,embed,object')]
          .map((x) => x.src || x.data || '')
          .find((s) => String(s).startsWith('data:application/pdf;base64,'))
        return f ? String(f).slice('data:application/pdf;base64,'.length) : null
      }).catch(() => null)
      if (!b64) await dormir(1000)
    }
    if (!b64) throw errorTgr('La TGR abrió el trámite pero no entregó el certificado en PDF', 'TGR_SIN_CERTIFICADO')

    const pdf = Buffer.from(b64, 'base64')
    if (!pdf.slice(0, 4).equals(Buffer.from('%PDF'))) {
      throw errorTgr('El archivo entregado por la TGR no es un PDF válido', 'TGR_SIN_CERTIFICADO')
    }
    let texto = ''
    try {
      const d = await pdfParse(pdf)
      texto = d.text || ''
    } catch (err) {
      throw errorTgr(`El certificado llegó pero su texto no se pudo leer: ${err.message}`, 'TGR_PDF_ILEGIBLE')
    }
    return { pdf, texto, url: page.url() }
  } finally {
    try { await browser.close() } catch { /* ya cerrado */ }
  }
}

/** Guarda el PDF como evidencia fuera del repo: data/certificados-tgr/. */
function guardarPdf(rut, pdf) {
  try {
    const dir = path.join(process.cwd(), 'data', 'certificados-tgr')
    fs.mkdirSync(dir, { recursive: true })
    const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const archivo = path.join(dir, `${rut}-${sello}.pdf`)
    fs.writeFileSync(archivo, pdf)
    return path.relative(process.cwd(), archivo).replace(/\\/g, '/')
  } catch {
    return null
  }
}

/** Última consulta de deuda de la empresa (para el informe y la UI). */
function ultima(db, empresaId) {
  const fila = db.prepare(`
    SELECT * FROM deuda_tgr WHERE empresa_id = ? ORDER BY id DESC LIMIT 1
  `).get(empresaId)
  if (!fila) return null
  let datos = {}
  try { datos = JSON.parse(fila.datos_json || '{}') } catch { datos = {} }
  return {
    ...fila,
    total: fila.total == null ? null : Number(fila.total),
    datos,
  }
}

/**
 * Consulta la deuda fiscal en la TGR y la deja registrada como evidencia.
 * Las dependencias de red se inyectan para poder probar el flujo sin portal.
 *
 * @returns {Promise<object>} registro guardado (misma forma que `ultima`).
 */
async function consultar(db, { empresaId, usuarioId = null, ip = null, deps = {} } = {}) {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const [rut, dv] = String(emp.rut).split('-')
  const clave = deps.clave !== undefined ? deps.clave : claveSiiDescifrada(db, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada: la TGR autentica con Clave Tributaria')

  const descargar = deps.descargarCertificado || descargarCertificado
  const persistirPdf = deps.guardarPdf || guardarPdf
  const r = await descargar({ rut, dv, clave })
  const parseado = parsearCertificado(r.texto)
  const nombre = nombreCertificado(r.texto)
  const pdfRuta = persistirPdf(emp.rut, r.pdf)

  const info = db.prepare(`
    INSERT INTO deuda_tgr
      (empresa_id, rut, estado, total, moneda, liquidada_al, fecha_emision,
       codigo_verificacion, nombre, pdf_ruta, texto, datos_json, consultado_por)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    empresaId,
    emp.rut,
    parseado.estado,
    parseado.total,
    parseado.moneda,
    parseado.liquidada_al,
    parseado.fecha_emision,
    parseado.codigo_verificacion,
    nombre,
    pdfRuta,
    r.texto,
    JSON.stringify({
      confianza: parseado.confianza,
      etiqueta_total: parseado.etiqueta_total,
      montos_detectados: parseado.montos_detectados,
      documentos: parseado.documentos,
      total_calculado: parseado.total_calculado,
      rut_certificado: parseado.rut,
      url: r.url,
      origen: 'TGR — Certificado de Deuda Fiscal',
    }),
    usuarioId,
  )

  registrarAuditoria(db, {
    empresaId, usuarioId, ip,
    total: parseado.total, estado: parseado.estado,
  })

  return ultima(db, empresaId) || { id: Number(info.lastInsertRowid), ...parseado }
}

function registrarAuditoria(db, { empresaId, usuarioId, ip, total, estado }) {
  try {
    const { registrarAccion } = require('./auditoria')
    registrarAccion(db, {
      empresaId,
      usuarioId,
      accion: 'tesoreria.deuda_tgr_consultar',
      entidad: 'deuda_tgr',
      entidadId: String(empresaId),
      despues: { estado, total },
      ip: ip || null,
    })
  } catch { /* la auditoría no debe tumbar la consulta */ }
}

/**
 * Resumen para el informe de salud: lo último consultado, con su vigencia y
 * la advertencia de que un certificado es una foto, no un plan de pago.
 */
function resumen(db, empresaId) {
  const u = ultima(db, empresaId)
  if (!u) {
    return {
      estado: 'no_consultado',
      etiqueta: 'Deuda fiscal (TGR) no consultada',
      total: null,
      fuente: 'TGR — Certificado de Deuda Fiscal',
      detalle: 'No se ha consultado la deuda fiscal en la Tesorería. Ejecuta la sincronización para leer el certificado oficial.',
      nota: null,
    }
  }
  const sinDeuda = u.estado === 'sin_deuda'
  return {
    estado: sinDeuda ? 'sin_deuda' : 'con_deuda',
    etiqueta: sinDeuda ? 'Sin deuda fiscal registrada (TGR)' : 'Deuda fiscal registrada (TGR)',
    total: u.total,
    moneda: u.moneda || 'CLP',
    fecha_emision: u.fecha_emision,
    liquidada_al: u.liquidada_al,
    codigo_verificacion: u.codigo_verificacion,
    nombre: u.nombre,
    pdf: u.pdf_ruta,
    documentos: Array.isArray(u.datos?.documentos) ? u.datos.documentos : [],
    total_calculado: u.datos?.total_calculado ?? null,
    consultado_en: u.consultado_en,
    confianza: u.datos?.confianza || null,
    fuente: 'TGR — Certificado de Deuda Fiscal',
    detalle: sinDeuda
      ? `El certificado emitido el ${u.fecha_emision || u.consultado_en} declara que el RUT no registra deuda (liquidada al ${u.liquidada_al || 'fecha del certificado'}).`
      : `El certificado emitido el ${u.fecha_emision || u.consultado_en} registra deuda${u.total == null ? ' (el monto no se pudo leer del PDF: revisa el certificado adjunto)' : ` por ${Number(u.total).toLocaleString('es-CL')} CLP`}${Array.isArray(u.datos?.documentos) && u.datos.documentos.length ? ` en ${u.datos.documentos.length} documento(s)` : ''}.`,
    nota: 'La deuda fiscal del Fisco (TGR) es distinta de la deuda comercial del sistema. El certificado es una foto a su fecha de emisión: no incluye deuda posterior ni acuerdos de pago vigentes. El detalle por documento sale del texto del certificado; la cartola fiscal de la TGR no se automatiza porque exige reCAPTCHA.',
  }
}

module.exports = {
  consultar,
  resumen,
  ultima,
  disponible,
  // helpers puros (tests)
  parsearCertificado,
  parsearDetalle,
  nombreCertificado,
  montoDeTexto,
  fechaISO,
  descargarCertificado,
  PORTAL,
}
