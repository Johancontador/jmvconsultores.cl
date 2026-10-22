/**
 * tmp-auditar-informe.js — auditoría del informe de salud completo tal como
 * se imprime (Chrome, media: print, A4):
 *   · desborde horizontal de cualquier elemento fuera de la caja de papel
 *   · rótulos SVG superpuestos entre sí o fuera del viewBox
 *   · bloques obligatorios presentes (8 capítulos, 7 gráficos, portada)
 *   · capturas de cada capítulo para revisión visual
 */
const path = require('path')
const fs = require('fs')
const puppeteer = require('puppeteer-core')

const PROJECT = 'C:/Proyectos/iva-mensual'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const SALIDA = path.join(PROJECT, 'tmp-auditoria')

function arg(n, d) {
  const p = process.argv.find((a) => a.startsWith(`--${n}=`))
  return p ? p.split('=').slice(1).join('=') : d
}
const EMPRESA = Number(arg('empresa', 1))
const PERIODO = arg('periodo', '202610')
const MESES = Number(arg('meses', 24))

process.env.DB_PATH = path.join(PROJECT, 'data', 'iva_mensual.db')
const db = require(path.join(PROJECT, 'backend', 'db'))
const salud = require(path.join(PROJECT, 'backend', 'core', 'salud-tributaria'))
const informeHtml = require(path.join(PROJECT, 'backend', 'core', 'informe-salud-html'))

const inf = salud.construirInforme(db, { empresaId: EMPRESA, periodo: PERIODO, meses: MESES })
const doc = informeHtml.renderInformeHtml(inf)
fs.mkdirSync(SALIDA, { recursive: true })
const archivo = path.join(SALIDA, 'informe.html')
fs.writeFileSync(archivo, doc)

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
        desbordes.push({ tag: el.tagName, cls: el.className && el.className.toString().slice(0, 40), txt: (el.textContent || '').trim().slice(0, 40), left: Math.round(b.left), right: Math.round(b.right) })
      }
    }
    const solapes = []
    const fueraDeCaja = []
    for (const svg of document.querySelectorAll('svg.gfx')) {
      const textos = [...svg.querySelectorAll('text')]
      const cajas = textos.map((t) => ({ t, b: t.getBoundingClientRect(), txt: (t.textContent || '').trim() }))
      for (let i = 0; i < cajas.length; i++) {
        for (let j = i + 1; j < cajas.length; j++) {
          const a = cajas[i].b
          const b = cajas[j].b
          if (a.width === 0 || b.width === 0) continue
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ix > 1 && iy > 1) solapes.push({ svg: svg.getAttribute('aria-label'), a: cajas[i].txt, b: cajas[j].txt, px: Math.round(ix), py: Math.round(iy) })
        }
      }
      // Rótulos fuera del viewBox (se cortarían al imprimir).
      const vb = svg.viewBox.baseVal
      for (const c of cajas) {
        if (c.b.width === 0) continue
        if (c.b.left < svg.getBoundingClientRect().left - 1 || c.b.right > svg.getBoundingClientRect().right + 1) {
          fueraDeCaja.push({ svg: svg.getAttribute('aria-label'), txt: c.txt })
        }
      }
      if (vb && vb.width) { /* viewBox informative */ }
    }
    const capitulos = [...document.querySelectorAll('.cap h2')].map((h) => h.textContent.replace(/^\d+\s*/, '').trim())
    const graficos = [...document.querySelectorAll('svg.gfx')].map((s) => s.getAttribute('aria-label'))
    const tablas = [...document.querySelectorAll('table')].map((t) => ({ clase: t.className, filas: t.querySelectorAll('tbody tr').length, ancho: Math.round(t.getBoundingClientRect().width) }))
    return {
      scrollHorizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      cajaAncho: Math.round(cajaRect.width),
      desbordes: desbordes.slice(0, 12),
      nDesbordes: desbordes.length,
      solapes: solapes.slice(0, 12),
      nSolapes: solapes.length,
      fueraDeCaja: fueraDeCaja.slice(0, 12),
      nFuera: fueraDeCaja.length,
      capitulos,
      graficos,
      tablas,
      portada: !!document.querySelector('.portada .titulo-informe'),
      largo: document.documentElement.scrollHeight,
    }
  })

  console.log(JSON.stringify({ ...r, errores }, null, 1))

  // Capturas por capítulo.
  const capturas = await page.evaluate(() => {
    const out = []
    const portada = document.querySelector('.portada')
    if (portada) out.push({ nombre: '00-portada', el: portada })
    const caps = [...document.querySelectorAll('.cap')]
    caps.forEach((c, i) => out.push({ nombre: `${String(i + 1).padStart(2, '0')}-cap${i + 1}`, el: c }))
    const final = document.querySelector('.final')
    if (final) out.push({ nombre: '99-cierre', el: final })
    return out.map((x) => x.nombre)
  })
  for (const nombre of capturas) {
    const handle = await page.evaluateHandle((n) => {
      if (n === '00-portada') return document.querySelector('.portada')
      if (n === '99-cierre') return document.querySelector('.final')
      const i = Number(n.split('-')[1].replace('cap', '')) - 1
      return document.querySelectorAll('.cap')[i]
    }, nombre)
    const el = handle.asElement()
    if (el) await el.screenshot({ path: path.join(SALIDA, `${nombre}.png`) })
  }
  console.log('capturas:', capturas.join(', '))
  await browser.close()
  const problemas = r.nDesbordes + r.nSolapes + r.nFuera + (errores.length ? 1 : 0) + (r.scrollHorizontal > 0 ? 1 : 0)
  process.exit(problemas === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
