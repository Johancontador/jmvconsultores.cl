/**
 * verificar-render.mjs — comprueba el sitio en un navegador de verdad.
 *
 * Los tests de tests/sitio.test.mjs validan HTML y HTTP; esto valida lo que
 * ocurre después de pintar: errores de consola, desbordes horizontales,
 * contraste de texto, menú móvil y validación del formulario.
 *
 * Requiere Chrome instalado. Uso:
 *
 *   PORT=8090 python3 deploy/serve.py &
 *   node deploy/verificar-render.mjs
 *
 * No entra en `npm test` a propósito: el navegador no está garantizado en
 * cualquier máquina que corra la suite.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const BASE = process.env.SITIO_URL || 'http://127.0.0.1:8090'
const PAGINAS = fs.readdirSync(path.resolve('.')).filter((f) => f.endsWith('.html')).sort()
const VISTAS = [
  { nombre: 'móvil', width: 390, height: 844, mobile: true },
  { nombre: 'escritorio', width: 1280, height: 800, mobile: false },
]

const CANDIDATOS_CHROME = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

function chrome() {
  for (const ruta of CANDIDATOS_CHROME) if (fs.existsSync(ruta)) return ruta
  throw new Error('no se encontró Chrome; define la variable CHROME con su ruta')
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

async function abrirChrome() {
  const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'jmv-render-'))
  const proc = spawn(
    chrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${perfil}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  const puerto = await new Promise((resolve, reject) => {
    let salida = ''
    const limite = setTimeout(() => reject(new Error(`Chrome no arrancó: ${salida}`)), 20000)
    const revisar = (d) => {
      salida += d
      const m = salida.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (m) { clearTimeout(limite); resolve(Number(m[1])) }
    }
    proc.stderr.on('data', revisar)
    proc.stdout.on('data', revisar)
  })

  return { proc, puerto, perfil }
}

async function nuevaPestania(puerto) {
  const r = await fetch(`http://127.0.0.1:${puerto}/json/new?about:blank`, { method: 'PUT' })
  return r.json()
}

function cliente(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pendientes = new Map()
  const eventos = []
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pendientes.has(msg.id)) {
      pendientes.get(msg.id)(msg)
      pendientes.delete(msg.id)
    } else if (msg.method) eventos.push(msg)
  })
  const listo = new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })
  return {
    listo,
    eventos,
    enviar(method, params = {}) {
      return new Promise((res, rej) => {
        const mid = ++id
        pendientes.set(mid, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)))
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
    },
    cerrar: () => ws.close(),
  }
}

async function evaluar(cdp, expresion) {
  const r = await cdp.enviar('Runtime.evaluate', {
    expression: expresion,
    returnByValue: true,
    awaitPromise: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}

/** Contraste WCAG 2.x entre dos colores rgb(). */
const CONTRASTE = `
  (() => {
    const rgb = (s) => (s.match(/\\d+(\\.\\d+)?/g) || []).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fondoDe = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== 'transparent' && !c.includes('rgba(0, 0, 0, 0)')) return rgb(c);
        n = n.parentElement;
      }
      return [255, 255, 255];
    };
    return { rgb, lum, fondoDe };
  })()
`

async function revisarPagina(cdp, archivo, vista) {
  const fallos = []
  const ruta = '/' + (archivo === 'index.html' ? '' : archivo)

  await cdp.enviar('Emulation.setDeviceMetricsOverride', {
    width: vista.width,
    height: vista.height,
    deviceScaleFactor: 1,
    mobile: vista.mobile,
  })
  await cdp.enviar('Page.enable')
  await cdp.enviar('Runtime.enable')
  cdp.eventos.length = 0

  await cdp.enviar('Page.navigate', { url: BASE + ruta })
  await new Promise((res) => {
    const limite = setTimeout(res, 6000)
    const tic = setInterval(() => {
      if (cdp.eventos.some((e) => e.method === 'Page.loadEventFired')) { clearInterval(tic); clearTimeout(limite); res() }
    }, 50)
  })
  await dormir(350)

  const errores = cdp.eventos.filter(
    (e) =>
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
  )
  if (errores.length) {
    const detalle = errores
      .map((e) => e.params?.exceptionDetails?.text || e.params?.entry?.text || e.params?.args?.map((a) => a.value).join(' '))
      .join(' | ')
    fallos.push(`error de consola: ${detalle}`)
  }

  const resumen = await evaluar(
    cdp,
    `(() => {
      const c = ${CONTRASTE};
      const principal = document.querySelector('h1');
      // Contraste del texto de párrafo más común.
      const parrafo = document.querySelector('.section__lead, .hero__subtitle, .card__text, .detail__head p') || document.body;
      const cf = c.fondoDe(parrafo);
      const cl = c.rgb(getComputedStyle(parrafo).color);
      const ratio = (a, b) => { const [x, y] = [c.lum(a), c.lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        h1: principal ? principal.textContent.trim().slice(0, 60) : null,
        h1Visible: principal ? getComputedStyle(principal).visibility !== 'hidden' : false,
        fondo: getComputedStyle(document.body).backgroundColor,
        contraste: Number(ratio(cl, cf).toFixed(2)),
        toggle: (() => { const t = document.querySelector('.nav-toggle'); return t ? getComputedStyle(t).display : null; })(),
        navVisible: (() => { const n = document.getElementById('navPrincipal'); return n ? getComputedStyle(n).display : null; })(),
        skip: !!document.querySelector('.skip'),
        redes: (() => {
          const b = document.querySelector('[data-redes]');
          if (!b) return 'eliminado';
          return b.querySelectorAll('a').length ? 'con ' + b.querySelectorAll('a').length + ' enlaces' : 'vacío';
        })(),
        anchoContenido: document.querySelector('.container')?.getBoundingClientRect().width || 0,
        targetMin: (() => {
          const chicos = [...document.querySelectorAll('.nav__list a, .btn')]
            .filter((el) => el.offsetParent !== null)
            .filter((el) => el.getBoundingClientRect().height < 40);
          return chicos.length;
        })(),
      };
    })()`
  )

  if (resumen.overflow > 1) fallos.push(`desborde horizontal de ${resumen.overflow}px`)
  if (!resumen.h1) fallos.push('sin h1')
  if (!resumen.h1Visible) fallos.push('h1 oculto')
  if (resumen.contraste < 4.5) fallos.push(`contraste ${resumen.contraste}:1 bajo el mínimo AA`)
  if (resumen.fondo === 'rgb(10, 14, 26)') fallos.push('sigue el fondo oscuro anterior')
  if (resumen.targetMin > 0) fallos.push(`${resumen.targetMin} controles visibles bajo 40px de alto`)
  if (!resumen.skip) fallos.push('sin enlace de salto')
  // Sin perfiles configurados el bloque debe desaparecer; nunca quedar vacío.
  if (resumen.redes === 'vacío') fallos.push('el bloque de redes quedó visible y vacío')
  if (vista.mobile && resumen.toggle === 'none') fallos.push('sin botón de menú en móvil')
  if (vista.mobile && resumen.navVisible !== 'none') fallos.push('el menú móvil debería estar colapsado')
  if (!vista.mobile && resumen.toggle !== 'none') fallos.push('el botón de menú no debería mostrarse en escritorio')

  // Menú móvil: se abre, avisa su estado y cierra con Escape.
  if (vista.mobile) {
    const menu = await evaluar(
      cdp,
      `(async () => {
        const t = document.querySelector('.nav-toggle');
        t.click();
        await new Promise((r) => setTimeout(r, 80));
        const nav = document.getElementById('navPrincipal');
        const abierto = { visible: getComputedStyle(nav).display !== 'none', aria: t.getAttribute('aria-expanded') };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        return { ...abierto, ariaFinal: t.getAttribute('aria-expanded'), visibleFinal: getComputedStyle(nav).display !== 'none' };
      })()`
    )
    if (!menu.visible || menu.aria !== 'true') fallos.push('el menú no se abre')
    if (menu.visibleFinal || menu.ariaFinal !== 'false') fallos.push('el menú no se cierra con Escape')
  }

  // Formulario: enviar vacío debe marcar campos y enfocar el primero.
  const formulario = await evaluar(cdp, `!!document.querySelector('form[data-contacto], #contactForm')`)
  if (formulario) {
    const validacion = await evaluar(
      cdp,
      `(async () => {
        const f = document.querySelector('form[data-contacto], #contactForm');
        f.querySelectorAll('input, select, textarea').forEach((c) => { if (c.type !== 'text' || c.name !== 'web') c.value = ''; });
        f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        await new Promise((r) => setTimeout(r, 120));
        const errores = [...f.querySelectorAll('.form__error')].filter((p) => p.textContent.trim());
        const status = f.querySelector('.form__status');
        return {
          errores: errores.length,
          primero: errores[0] ? errores[0].textContent.trim().slice(0, 60) : null,
          descrito: errores[0] ? document.activeElement.getAttribute('aria-describedby') : null,
          status: status ? status.textContent.trim().slice(0, 80) : null,
          foco: document.activeElement.id,
        };
      })()`
    )
    if (validacion.errores === 0) fallos.push('el formulario no marca errores al enviar vacío')
    if (!validacion.status) fallos.push('el formulario no informa el problema al usuario')
    if (!validacion.foco) fallos.push('el formulario no lleva el foco al primer campo con error')
  }

  return { archivo, vista: vista.nombre, fallos, medidas: resumen }
}

async function main() {
  const { proc, puerto, perfil } = await abrirChrome()
  const resultados = []
  try {
    for (const archivo of PAGINAS) {
      const pestania = await nuevaPestania(puerto)
      const cdp = cliente(pestania.webSocketDebuggerUrl)
      await cdp.listo
      for (const vista of VISTAS) {
        resultados.push(await revisarPagina(cdp, archivo, vista))
      }
      cdp.cerrar()
    }
  } finally {
    proc.kill()
    try { fs.rmSync(perfil, { recursive: true, force: true }) } catch {}
  }

  let fallos = 0
  for (const r of resultados) {
    const marca = r.fallos.length ? '✖' : '✔'
    console.log(`${marca} ${r.archivo} · ${r.vista} — contraste ${r.medidas.contraste}:1, ancho ${Math.round(r.medidas.anchoContenido)}px, redes ${r.medidas.redes}`)
    r.fallos.forEach((f) => { fallos++; console.log(`    · ${f}`) })
  }
  console.log(`\n${resultados.length} revisiones, ${fallos} problema(s).`)
  return fallos ? 1 : 0
}

process.exit(await main())
