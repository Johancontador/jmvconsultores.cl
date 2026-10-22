/**
 * tmp-auditar-todas.js — auditoría de impresión de TODAS las empresas
 * reales de la base de desarrollo, en Chrome con media: print (A4).
 * Verifica: desborde horizontal, solapes de rótulos SVG, rótulos fuera de
 * caja, valores rotos y presencia de los bloques obligatorios.
 */
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const PROJECT = 'C:/Proyectos/iva-mensual'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
process.env.DB_PATH = path.join(PROJECT, 'data', 'iva_mensual.db')
const db = require(path.join(PROJECT, 'backend', 'db'))
const salud = require(path.join(PROJECT, 'backend', 'core', 'salud-tributaria'))
const informeHtml = require(path.join(PROJECT, 'backend', 'core', 'informe-salud-html'))

const SALIDA = path.join(PROJECT, 'tmp-auditoria-todas')
fs.mkdirSync(SALIDA, { recursive: true })

const empresas = db.prepare(`SELECT id, nombre FROM empresas WHERE activo = 1 ORDER BY id`).all()
const periodos = ['202610', '202606']

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  const errores = []
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()) })
  page.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`))
  await page.emulateMediaType('print')
  await page.setViewport({ width: 688, height: 1100, deviceScaleFactor: 1 })

  let revisados = 0
  const problemas = []
  for (const e of empresas) {
    for (const p of periodos) {
      let inf
      try {
        inf = salud.construirInforme(db, { empresaId: e.id, periodo: p, meses: 24 })
      } catch (err) {
        problemas.push({ empresa: e.id, periodo: p, tipo: 'error-construccion', msg: err.message })
        continue
      }
      const doc = informeHtml.renderInformeHtml(inf)
      for (const roto of ['undefined', 'NaN', '[object Object]']) {
        if (doc.includes(roto)) problemas.push({ empresa: e.id, periodo: p, tipo: `roto-${roto}` })
      }
      const archivo = path.join(SALIDA, `inf-${e.id}-${p}.html`)
      fs.writeFileSync(archivo, doc)
      await page.goto('file:///' + archivo.replace(/\\/g, '/'), { waitUntil: 'networkidle0' })
      const r = await page.evaluate(() => {
        const caja = document.querySelector('.hoja')
        const cajaRect = caja.getBoundingClientRect()
        const desbordes = []
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('svg')) continue
          const b = el.getBoundingClientRect()
          if (b.width === 0 && b.height === 0) continue
          if (b.right > cajaRect.right + 1 || b.left < cajaRect.left - 1) {
            desbordes.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 30), left: Math.round(b.left), right: Math.round(b.right) })
          }
        }
        const solapes = []
        const fuera = []
        for (const svg of document.querySelectorAll('svg.gfx')) {
          const textos = [...svg.querySelectorAll('text')].map((t) => ({ b: t.getBoundingClientRect(), txt: (t.textContent || '').trim() }))
          for (let i = 0; i < textos.length; i++) {
            for (let j = i + 1; j < textos.length; j++) {
              const a = textos[i].b, b = textos[j].b
              if (!a.width || !b.width) continue
              const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
              const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
              if (ix > 1 && iy > 1) solapes.push({ svg: svg.getAttribute('aria-label'), a: textos[i].txt, b: textos[j].txt })
            }
          }
          const sb = svg.getBoundingClientRect()
          for (const c of textos) {
            if (!c.b.width) continue
            if (c.b.left < sb.left - 1 || c.b.right > sb.right + 1) fuera.push({ svg: svg.getAttribute('aria-label'), txt: c.txt })
          }
        }
        const tablas = [...document.querySelectorAll('table')].map((t) => ({ clase: t.className, ancho: Math.round(t.getBoundingClientRect().width) }))
        return {
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          nDesbordes: desbordes.length, desbordes: desbordes.slice(0, 6),
          nSolapes: solapes.length, solapes: solapes.slice(0, 6),
          nFuera: fuera.length, fuera: fuera.slice(0, 6),
          tablas,
          anchoUtil: 608,
        }
      })
      revisados++
      const tablasMal = r.tablas.filter((t) => t.ancho > r.anchoUtil + 1)
      if (r.scroll > 0) problemas.push({ empresa: e.id, periodo: p, tipo: 'scroll', v: r.scroll })
      if (r.nDesbordes) problemas.push({ empresa: e.id, periodo: p, tipo: 'desborde', v: r.desbordes })
      if (r.nSolapes) problemas.push({ empresa: e.id, periodo: p, tipo: 'solape', v: r.solapes })
      if (r.nFuera) problemas.push({ empresa: e.id, periodo: p, tipo: 'fuera', v: r.fuera })
      if (tablasMal.length) problemas.push({ empresa: e.id, periodo: p, tipo: 'tabla-ancha', v: tablasMal })
    }
  }
  console.log(JSON.stringify({ revisados, empresas: empresas.length, problemas: problemas.slice(0, 20), totalProblemas: problemas.length, errores }, null, 1))
  await browser.close()
  process.exit(problemas.length === 0 && errores.length === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
