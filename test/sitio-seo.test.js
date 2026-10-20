'use strict'
/**
 * test/sitio-seo.test.js — SEO técnico y frontera público/privado del sitio.
 *
 * Por qué: el sitio público tenía metadatos y JSON-LD, pero le faltaban las
 * piezas que hacen que un buscador —y una persona que abre una URL rota—
 * entiendan el sitio: robots.txt, sitemap.xml y una 404 propia. Además, `app.use
 * (express.static('frontend'))` sirve TODO lo que hay en frontend/, así que las
 * siete pantallas internas heredadas eran indexables sin que nadie lo decidiera.
 *
 * T1 — robots.txt: deja indexable el sitio público y desautoriza app y API.
 * T2 — sitemap.xml: XML válido, dominio canónico y solo páginas reales.
 * T3 — Toda URL del sitemap es indexable de verdad (sin noindex) y tiene
 *      title, description, canonical y Open Graph coherentes con su <loc>.
 * T4 — Frontera: las pantallas privadas declaran noindex y no están listadas.
 * T5 — 404 real por HTTP: página con identidad para el navegador, JSON para la
 *      API, y lo que existe sigue respondiendo 200 (el handler no lo intercepta).
 * T6 — La 404 comparte identidad y no se lista en el sitemap.
 *
 * Ejecutar con: node --test test/sitio-seo.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const express = require('express')

const FRONT = path.resolve(__dirname, '../frontend')
const leer = (p) => fs.readFileSync(path.join(FRONT, p), 'utf8')
const existe = (p) => fs.existsSync(path.join(FRONT, p))

// Este host sirve la app + la landing + vistas previas. El sitio corporativo
// canónico es otro host (https://jmvconsultores.cl) con su propio robots/sitemap:
// por eso las vistas previas de acá van con noindex y no se listan.
const DOMINIO = 'https://app.jmvconsultores.cl'
/**
 * URL pública → archivo que la sirve, por convención del servidor de estáticos:
 * `/` es la landing y cada ruta con barra final es una carpeta con index.html
 * (`/servicios/contabilidad/` → frontend/servicios/contabilidad/index.html).
 * Así, agregar una página nueva al sitemap no requiere tocar el test: si el
 * archivo no existe, falla.
 */
const archivoDe = (ruta) => {
  if (ruta === '/') return path.join(FRONT, 'landing.html')
  const rel = ruta.replace(/^\//, '').replace(/\/$/, '')
  return path.join(FRONT, ...rel.split('/'), 'index.html')
}
/** Pantallas que NUNCA deben indexarse (internas o de acceso). */
// Las 7 pantallas heredadas (index/dashboard/informe/proceso/libro/
// exportacion-masiva/configuracion) ya NO existen como páginas: se retiraron y
// su URL redirige a la SPA. Su contrato vive en test/legado-retirado.test.js.
const PRIVADAS = [
  'login.html', 'registro.html', 'sistema/index.html',
]

const robots = () => leer('robots.txt')
const locs = () => [...leer('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

/** Etiqueta legible de un archivo del sitio (`/servicios/` para su index.html). */
const etiqueta = (archivo) => {
  const rel = path.relative(FRONT, archivo).replace(/\\/g, '/')
  return '/' + rel.replace(/(^|\/)index\.html$/, '$1').replace(/404\.html$/, '404.html')
}

/**
 * Todas las páginas que sirve este host con el chrome del sitio: la landing, la
 * 404 y cada carpeta con index.html (las pantallas heredadas sueltas y
 * /sistema/ quedan fuera: no forman parte del sitio).
 */
const paginasDelSitio = () => {
  const salida = [path.join(FRONT, 'landing.html'), path.join(FRONT, '404.html')]
  const recorrer = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === 'sistema') continue
      const p = path.join(dir, e.name)
      if (fs.existsSync(path.join(p, 'index.html'))) salida.push(path.join(p, 'index.html'))
      recorrer(p)
    }
  }
  recorrer(FRONT)
  return salida
}

/* ------------------------------ T1 robots.txt ----------------------------- */
test('T1: robots.txt abre el sitio público y cierra la app y la API', () => {
  const r = robots()
  assert.match(r, /^User-agent: \*$/m, 'declara el agente comodín')
  assert.match(r, /^Allow: \/$/m, 'el sitio público es indexable')
  assert.ok(!/^Disallow: \/$/m.test(r), 'CONTROL: no desautoriza el sitio completo')
  assert.match(r, /^Disallow: \/sistema\/$/m, 'la aplicación privada queda fuera')
  assert.match(r, /^Disallow: \/api\/$/m, 'la API queda fuera del rastreo')
  assert.match(r, /^Sitemap: https:\/\/app\.jmvconsultores\.cl\/sitemap\.xml$/m, 'apunta al sitemap absoluto de este host')
  for (const vista of ['/servicios/', '/nosotros/', '/privacidad/', '/cookies/', '/terminos/']) {
    assert.ok(r.includes(`Disallow: ${vista}`), `las vistas previas ${vista} no se rastrean`)
  }
  // Las de acceso llevan noindex en su propio HTML: si además se desautorizaran,
  // el buscador no podría leer ese noindex.
  for (const p of ['login.html', 'registro.html']) {
    assert.ok(!r.includes(`Disallow: /${p}`), `${p} no se desautoriza (usa noindex)`)
  }
})

/* ------------------------------ T2 sitemap.xml ---------------------------- */
test('T2: sitemap.xml es XML válido y lista solo páginas que existen', () => {
  const s = leer('sitemap.xml')
  assert.match(s, /^<\?xml version="1\.0" encoding="UTF-8"\?>/, 'declaración XML')
  assert.match(s, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/, 'namespace del protocolo')
  assert.ok(s.trimEnd().endsWith('</urlset>'), 'cierra el urlset')

  const urls = locs()
  assert.ok(urls.length >= 1, 'al menos la portada')
  const abiertos = (s.match(/<url>/g) || []).length
  assert.strictEqual(abiertos, urls.length, 'un <url> por <loc> (sin bloques huérfanos)')

  for (const u of urls) {
    assert.ok(u.startsWith(`${DOMINIO}/`), `${u} usa el dominio canónico https`)
    const ruta = u.slice(DOMINIO.length) || '/'
    const archivo = archivoDe(ruta)
    assert.ok(fs.existsSync(archivo), `${u} → ${path.relative(FRONT, archivo)} existe`)
    assert.ok(/\/$/.test(ruta), `${u} usa la forma con barra final (la que sirve la carpeta)`)
  }
})

/* --------------------- T3 lo listado es indexable de verdad ---------------- */
test('T3: cada URL del sitemap tiene title, description, canonical y OG propios', () => {
  for (const u of locs()) {
    const ruta = u.slice(DOMINIO.length) || '/'
    const html = fs.readFileSync(archivoDe(ruta), 'utf8')

    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1]
    assert.ok(title && title.trim().length > 15, `${ruta}: título propio y descriptivo («${title || 'sin title'}»)`)
    assert.match(html, /<meta name="description" content="[^"]{50,}"/, `${ruta}: meta description con contenido`)
    assert.ok(!/name="robots" content="noindex/.test(html), `${ruta}: NO está marcada como noindex`)
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1]
    assert.ok(/^https:\/\//.test(canonical || ''), `${ruta}: canonical absoluto`)
    // La portada canonicaliza al dominio de marca (decisión previa a este trabajo);
    // el resto de lo listado se canoniza a sí mismo.
    if (ruta !== '/') assert.strictEqual(canonical, u, `${ruta}: canonical = ${u}`)
    for (const prop of ['og:title', 'og:description', 'og:url']) {
      assert.ok(html.includes(`property="${prop}"`), `${ruta}: Open Graph ${prop}`)
    }
    const ogUrl = (html.match(/<meta property="og:url" content="([^"]+)">/) || [])[1]
    assert.ok(/^https:\/\//.test(ogUrl || ''), `${ruta}: og:url absoluto`)
    // Misma excepción que el canonical: la portada se comparte con la URL de marca.
    if (ruta !== '/') assert.strictEqual(ogUrl, u, `${ruta}: og:url = ${u}`)
    assert.match(html, /<meta name="viewport" content="[^"]*width=device-width/, `${ruta}: viewport móvil`)
  }
})

/* --------------------------- T4 frontera público/privado ------------------ */
test('T4: las pantallas privadas declaran noindex y no están en el sitemap', () => {
  const urls = locs()
  for (const p of PRIVADAS) {
    assert.ok(existe(p), `frontend/${p} existe (si se renombra, actualiza este test)`)
    const html = leer(p)
    // Se exige la PROPIEDAD (declara noindex), no un formato exacto: login y
    // registro ya venían con «noindex,follow» y forzar la misma cadena en todo
    // el sitio solo agregaría ruido sin cambiar el comportamiento.
    assert.match(html, /<meta name="robots" content="[^"]*noindex[^"]*">/, `${p} declara noindex`)
    assert.ok(!/<meta name="robots" content="index/.test(html), `${p} no se autodeclara indexable`)
    assert.ok(!urls.includes(`${DOMINIO}/${p}`), `${p} no figura en el sitemap`)
  }
})

/* ------------------------------- T5 404 real ------------------------------ */
test('T5: 404 real por HTTP — página con identidad, JSON para la API y 200 para lo que existe', async () => {
  const app = express()
  app.use(express.static(FRONT))
  app.use(require('../backend/middleware/no-encontrado').noEncontrado)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    // 1) URL de página inexistente → 404 + HTML del sitio (no el texto de Express)
    const pag = await fetch(`${base}/ruta-que-no-existe-123`)
    assert.strictEqual(pag.status, 404, 'status 404 real (una 404 con 200 es un error de SEO)')
    assert.match(pag.headers.get('content-type') || '', /text\/html/, 'responde HTML')
    const cuerpo = await pag.text()
    assert.ok(cuerpo.includes('No encontramos esa página'), 'entrega la 404 del sitio')
    assert.ok(!cuerpo.includes('Cannot GET'), 'ya no expone el mensaje crudo de Express')
    assert.ok(cuerpo.includes('/css/sitio.css'), 'la 404 carga la identidad del sitio')

    // 2) API inexistente → 404 JSON (quien la llama no espera HTML)
    const api = await fetch(`${base}/api/ruta-inexistente`)
    assert.strictEqual(api.status, 404)
    assert.match(api.headers.get('content-type') || '', /application\/json/, 'la API responde JSON')
    const j = await api.json()
    assert.strictEqual(j.ok, false)
    assert.ok(j.error, 'el JSON explica el 404')

    // 3) CONTROL: lo que existe no queda interceptado (el handler va al final)
    const ok = await fetch(`${base}/landing.html`)
    assert.strictEqual(ok.status, 200, 'una página real sigue en 200')
    const okRobots = await fetch(`${base}/robots.txt`)
    assert.strictEqual(okRobots.status, 200, 'robots.txt se sirve')
    const okSitemap = await fetch(`${base}/sitemap.xml`)
    assert.strictEqual(okSitemap.status, 200, 'sitemap.xml se sirve')
  } finally {
    server.close()
  }
})

/* ------------------------------ T6 la 404 misma --------------------------- */
test('T6: la 404 comparte identidad, no se indexa y ofrece salidas reales', () => {
  const html = leer('404.html')
  assert.match(html, /<meta name="robots" content="noindex, follow">/, 'noindex (con follow, para aprovechar sus enlaces)')
  // nginx fija max-age=14400 a los .css: sin ?v=<sha1> un cambio de sitio.css
  // dejaría la 404 con el diseño viejo en el navegador del visitante.
  assert.match(html, /href="\/css\/sitio\.css\?v=[a-f0-9]{8}"/, 'el CSS va versionado por contenido')
  assert.ok(html.includes('/assets/logo-ink.svg'), 'usa el logo del sitio')
  assert.ok(!locs().includes(`${DOMINIO}/404.html`), 'no se lista en el sitemap')
  for (const salida of ['href="/"', 'href="/#contacto"', 'href="/servicios/"', 'href="/login.html"']) {
    assert.ok(html.includes(salida), `ofrece la salida ${salida}`)
  }
})

/* --------------- T7 el arranque real monta el 404 en su sitio -------------- */
test('T7: backend/index.js monta el 404 después de las rutas y antes del error', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../backend/index.js'), 'utf8')
  const pos404 = src.indexOf("require('./middleware/no-encontrado').noEncontrado")
  assert.ok(pos404 > 0, 'el arranque monta el 404 propio')
  assert.ok(src.indexOf('app.use(express.static') < pos404, 'va después de los estáticos (si no, taparía archivos reales)')
  assert.ok(src.lastIndexOf("app.use('/api/") < pos404, 'va después de todos los routers de la API')
  assert.ok(src.indexOf('app.use((err, req, res, next)') > pos404, 'va antes del manejador de errores')
})

/* ------------- T8 chrome compartido entre las páginas públicas ------------- */
test('T8: todas las páginas del sitio comparten navegación, pie y menú móvil', () => {
  for (const archivo of paginasDelSitio()) {
    const ruta = etiqueta(archivo)
    const html = fs.readFileSync(archivo, 'utf8')
    assert.ok(html.includes('id="pv-burger"'), `${ruta}: botón de menú móvil`)
    // A ≤980 px el CSS oculta la nav horizontal: sin drawer no hay navegación.
    assert.ok(html.includes('id="pv-drawer"'), `${ruta}: drawer del menú móvil`)
    assert.ok(html.includes('/shared/sitio-nav.js'), `${ruta}: carga el menú compartido (no lo duplica inline)`)
    assert.ok(html.includes('href="/servicios/"') && html.includes('href="/nosotros/"'), `${ruta}: enlaza servicios y nosotros`)
    assert.ok(/href="(\/)?#contacto"/.test(html), `${ruta}: llega al contacto`)
    assert.ok(html.includes('href="/login.html"'), `${ruta}: acceso de clientes`)
    assert.ok(html.includes('class="pv-skip"'), `${ruta}: enlace para saltar al contenido`)
    assert.ok(html.includes('pv-foot'), `${ruta}: pie editorial`)
    for (const legal of ['/privacidad/', '/cookies/', '/terminos/']) {
      assert.ok(html.includes(`href="${legal}"`), `${ruta}: enlaza ${legal}`)
    }
  }
})

/* ---------- T9 anti-caché en TODAS las páginas (no solo las 3) ----------- */
test('T9: toda referencia local .css/.js de las páginas del sitio va versionada', () => {
  let revisadas = 0
  for (const archivo of paginasDelSitio()) {
    const ruta = etiqueta(archivo)
    const html = fs.readFileSync(archivo, 'utf8')
    for (const m of html.matchAll(/(?:href|src)="(\/(?:css|shared|sistema|assets)\/[^"?]+\.(?:css|js))(\?v=[a-f0-9]{8})?"/g)) {
      assert.ok(m[2], `${ruta}: ${m[1]} sin ?v=<sha1> — corre «npm run seed:v»`)
      revisadas++
    }
  }
  assert.ok(revisadas >= 10, `se revisaron ${revisadas} referencias`)
})

/* --------- T10 las vistas previas no compiten con el sitio canónico -------- */
test('T10: las vistas previas del sitio corporativo son noindex y no se listan', () => {
  const urls = locs()
  const vistas = paginasDelSitio().filter((a) => !a.endsWith('landing.html') && !a.endsWith('404.html'))
  assert.ok(vistas.length >= 10, `hay ${vistas.length} vistas previas`)
  for (const archivo of vistas) {
    const ruta = etiqueta(archivo)
    const html = fs.readFileSync(archivo, 'utf8')
    assert.match(html, /<meta name="robots" content="noindex[^"]*">/, `${ruta}: noindex (no compite con jmvconsultores.cl)`)
    assert.ok(!urls.some((u) => u.endsWith(ruta)), `${ruta}: no está en el sitemap`)
    // El canonical no puede apuntar a una ruta que en ese host no existe: se
    // declara la URL real que sirve la página.
    const canonical = (html.match(/<link rel="canonical" href="([^"]+)">/) || [])[1]
    assert.strictEqual(canonical, `${DOMINIO}${ruta}`, `${ruta}: canonical al host que la sirve`)
  }
})
