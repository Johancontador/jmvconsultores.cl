/**
 * Tests de consistencia del sitio jmvconsultores.cl.
 *
 * Corren contra `deploy/serve.py` (el servidor real que se despliega), no
 * contra una idea de cómo debería servir: cada página se pide por HTTP.
 *
 *   node --test tests/
 *
 * Reglas que fijan (y que antes se rompieron sin que nadie lo notara):
 *   T1  cada URL del sitemap responde 200 y declara el canonical correcto
 *   T2  robots.txt apunta al sitemap y el sitemap cubre el disco (ni más ni menos)
 *   T3  title/description/canonical/og:url únicos por página
 *   T4  una URL inexistente devuelve 404 con la 404 propia (no la del servidor)
 *   T5  el repo no se publica: .git/, *.py, docs/, deploy/, data/ dan 404
 *   T6  URLs limpias: /remuneraciones → 301 a la canónica .html, sin duplicar
 *   T7  headers de seguridad y caché correctos (HTML revalidado, estáticos cacheados)
 *   T8  no hay enlaces internos rotos en ninguna página
 *   T9  tarjeta social: og:image real (1200×630) + twitter:card en todas
 *   T10 todas las páginas llevan a la app (acceso de clientes)
 *   T11 no hay listado de directorios
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://jmvconsultores.cl'

const leer = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const paginas = fs.readdirSync(ROOT)
  .filter((f) => f.endsWith('.html') && f !== '404.html')
  .sort()

/* ── servidor real ────────────────────────────────────────────────────────── */
function python() {
  for (const cmd of [process.env.PYTHON, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) return cmd
  }
  throw new Error('no hay python disponible para levantar deploy/serve.py')
}

let servidor
let origen

test.before(async () => {
  servidor = spawn(python(), [path.join(ROOT, 'deploy', 'serve.py')], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const puerto = await new Promise((resolve, reject) => {
    let salida = ''
    const limite = setTimeout(() => reject(new Error(`serve.py no arrancó: ${salida}`)), 10000)
    servidor.stdout.on('data', (d) => {
      salida += d
      const m = salida.match(/PORT=(\d+)/)
      if (m) { clearTimeout(limite); resolve(Number(m[1])) }
    })
    servidor.stderr.on('data', (d) => { salida += d })
    servidor.on('exit', (c) => reject(new Error(`serve.py terminó (${c}): ${salida}`)))
  })
  origen = `http://127.0.0.1:${puerto}`
})

test.after(() => { if (servidor) servidor.kill() })

const pedir = (ruta, opts = {}) => fetch(origen + ruta, { redirect: 'manual', ...opts })

const sitemapUrls = () => [...leer('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

/* ── T1 ───────────────────────────────────────────────────────────────────── */
test('T1: cada URL del sitemap responde 200 con su canonical', async () => {
  const urls = sitemapUrls()
  assert.ok(urls.length >= 9, `el sitemap debe listar el sitio (vio ${urls.length})`)
  for (const url of urls) {
    const ruta = new URL(url).pathname
    const r = await pedir(ruta)
    assert.equal(r.status, 200, `${ruta} debe responder 200`)
    const html = await r.text()
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    assert.equal(canonical, url, `${ruta} declara canonical ${canonical}`)
  }
})

/* ── T2 ───────────────────────────────────────────────────────────────────── */
test('T2: robots ↔ sitemap ↔ disco en el mismo conjunto de URLs', () => {
  const robots = leer('robots.txt')
  assert.match(robots, new RegExp(`Sitemap:\\s*${BASE}/sitemap\\.xml`), 'robots.txt declara el sitemap')
  assert.doesNotMatch(robots, /^Disallow:\s*\/\s*$/m, 'robots.txt no bloquea el sitio entero')

  const enSitemap = sitemapUrls().map((u) => new URL(u).pathname.replace(/^\//, '') || 'index.html').sort()
  assert.deepEqual(enSitemap, paginas, 'el sitemap lista exactamente las páginas del disco')
})

/* ── T3 ───────────────────────────────────────────────────────────────────── */
test('T3: title, description, canonical y og:url únicos por página', () => {
  const vistos = { title: new Map(), desc: new Map(), canonical: new Map() }
  for (const f of paginas) {
    const html = leer(f)
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim()
    const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1]?.trim()
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    const ogUrl = html.match(/<meta property="og:url" content="([^"]+)"/)?.[1]

    assert.ok(title && title.length > 10, `${f}: title propio`)
    assert.ok(desc && desc.length >= 60 && desc.length <= 200, `${f}: description entre 60 y 200 caracteres`)
    assert.ok(canonical?.startsWith(BASE + '/'), `${f}: canonical absoluto en el dominio`)
    assert.equal(ogUrl, canonical, `${f}: og:url coincide con canonical`)
    assert.doesNotMatch(html, /<meta name="robots" content="[^"]*noindex/, `${f}: el sitio es indexable`)

    for (const [clave, valor] of [['title', title], ['desc', desc], ['canonical', canonical]]) {
      assert.ok(!vistos[clave].has(valor), `${f}: ${clave} repetido con ${vistos[clave].get(valor)}`)
      vistos[clave].set(valor, f)
    }
  }
})

/* ── T4 ───────────────────────────────────────────────────────────────────── */
test('T4: URL inexistente → 404 con la página propia', async () => {
  const r = await pedir('/esto-no-existe-xyz')
  assert.equal(r.status, 404)
  assert.match(r.headers.get('content-type') ?? '', /text\/html/)
  const html = await r.text()
  assert.match(html, /Esta página no existe/, 'sirve 404.html, no la 404 del servidor')
  assert.match(html, /noindex/, 'la 404 no se indexa')
  assert.match(html, /href="\/"/, 'la 404 ofrece volver al inicio')
})

/* ── T5 ───────────────────────────────────────────────────────────────────── */
test('T5: el repositorio no se publica', async () => {
  const prohibidas = [
    '/.git/config', '/.git/HEAD', '/gen_servicios.py', '/gen_faq_central.py',
    '/README.md', '/docs/PROYECTO.md', '/deploy/serve.py', '/data/', '/.gitignore',
  ]
  for (const ruta of prohibidas) {
    const r = await pedir(ruta)
    assert.equal(r.status, 404, `${ruta} no debe ser público`)
    const cuerpo = await r.text()
    assert.doesNotMatch(cuerpo, /repositoryformatversion|^import |JMV Consultores — Contabilidad y Remuneraciones$/, `${ruta} no filtra contenido`)
  }
})

/* ── T6 ───────────────────────────────────────────────────────────────────── */
test('T6: URLs limpias redirigen a la canónica (no duplican)', async () => {
  // Ambas formas de la URL limpia llegan en un solo salto a la canónica.
  for (const [limpia, destino] of [['/remuneraciones', '/remuneraciones.html'], ['/remuneraciones/', '/remuneraciones.html'], ['/index.html', '/']]) {
    const r = await pedir(limpia)
    assert.equal(r.status, 301, `${limpia} debe redirigir`)
    assert.equal(r.headers.get('location'), destino, `${limpia} → ${destino}`)
  }
  const r = await pedir('/remuneraciones.html')
  assert.equal(r.status, 200, 'la canónica se sirve directo')
  const inexistente = await pedir('/no-hay-pagina')
  assert.equal(inexistente.status, 404, 'una ruta limpia inexistente no redirige a cualquier cosa')
})

/* ── T7 ───────────────────────────────────────────────────────────────────── */
test('T7: headers de seguridad y de caché', async () => {
  const html = await pedir('/')
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(html.headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.match(html.headers.get('referrer-policy') ?? '', /strict-origin-when-cross-origin/)
  assert.match(html.headers.get('content-type') ?? '', /text\/html;\s*charset=utf-8/)
  assert.match(html.headers.get('cache-control') ?? '', /no-cache/, 'el HTML se revalida: un despliegue se ve al instante')

  const css = await pedir('/css/styles.css')
  assert.equal(css.status, 200)
  assert.match(css.headers.get('cache-control') ?? '', /max-age=86400/, 'los estáticos sí se cachean')
  assert.equal(css.headers.get('x-content-type-options'), 'nosniff')

  const noExiste = await pedir('/nada')
  assert.equal(noExiste.headers.get('x-content-type-options'), 'nosniff')
})

/* ── T8 ───────────────────────────────────────────────────────────────────── */
test('T8: sin enlaces internos rotos', async () => {
  const revisadas = new Map()
  const revisar = async (ruta) => {
    if (revisadas.has(ruta)) return revisadas.get(ruta)
    // Sigue redirecciones: un enlace a /index.html cae en / por 301 y es válido.
    const r = await fetch(origen + ruta, { redirect: 'follow' })
    revisadas.set(ruta, r.status)
    return r.status
  }

  for (const f of [...paginas, '404.html']) {
    const html = leer(f)
    const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1])
    for (const ref of refs) {
      if (/^(https?:|mailto:|tel:|data:|#)/.test(ref)) continue
      // Relativa al documento: css/styles.css en /remuneraciones.html es /css/styles.css.
      const ruta = new URL(ref, `${BASE}/${f}`).pathname
      const estado = await revisar(ruta)
      assert.equal(estado, 200, `${f} → ${ref} está roto (${estado})`)
    }
  }
})

/* ── T9 ───────────────────────────────────────────────────────────────────── */
test('T9: tarjeta social declarada y con imagen real', async () => {
  const png = fs.readFileSync(path.join(ROOT, 'assets', 'og-image.png'))
  assert.equal(png.subarray(1, 4).toString(), 'PNG', 'og-image.png es un PNG')
  assert.equal(png.readUInt32BE(16), 1200, 'ancho 1200')
  assert.equal(png.readUInt32BE(20), 630, 'alto 630')

  for (const f of paginas) {
    const html = leer(f)
    assert.equal(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1], `${BASE}/assets/og-image.png`, `${f}: og:image`)
    assert.match(html, /<meta name="twitter:card" content="summary_large_image"/, `${f}: twitter:card`)
  }
  const r = await pedir('/assets/og-image.png')
  assert.equal(r.status, 200, 'la imagen social se sirve')
})

/* ── T10 ──────────────────────────────────────────────────────────────────── */
test('T10: todas las páginas llevan a la app', () => {
  for (const f of [...paginas, '404.html']) {
    assert.match(leer(f), /https:\/\/app\.jmvconsultores\.cl/, `${f} no tiene acceso a la app`)
  }
})

/* ── T11 ──────────────────────────────────────────────────────────────────── */
test('T11: sin listado de directorios', async () => {
  for (const ruta of ['/css/', '/js/', '/assets/', '/']) {
    const r = await pedir(ruta)
    if (r.status === 200) {
      assert.doesNotMatch(await r.text(), /Directory listing for|href="\?C=N;O=D"/, `${ruta} lista el directorio`)
    } else {
      assert.equal(r.status, 404, `${ruta} no debe listar (fue ${r.status})`)
    }
  }
  const raiz = await pedir('/')
  assert.doesNotMatch(await raiz.text(), /Directory listing for/, 'la raíz sirve index.html')
})

/* ── T12 ──────────────────────────────────────────────────────────────────── */
test('T12: css/js versionados con el sha1 del contenido', async () => {
  const { createHash } = await import('node:crypto')
  const versionables = ['css/styles.css', 'js/main.js', 'js/bg3d.js']
  const hashes = {}
  for (const rel of versionables) {
    hashes[rel] = createHash('sha1').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 8)
  }
  for (const f of [...paginas, '404.html']) {
    const html = leer(f)
    // Toda página usa el CSS y main.js; la 404 no carga el canvas 3D.
    for (const obligatorio of ['css/styles.css', 'js/main.js']) {
      assert.ok(html.includes(obligatorio), `${f} no referencia ${obligatorio}`)
    }
    for (const rel of versionables) {
      // Acepta css/styles.css?v=… y /css/styles.css?v=… (la 404 usa rutas absolutas).
      const marca = rel + '?v='
      let desde = 0
      let referencias = 0
      while (true) {
        const pos = html.indexOf(rel, desde)
        if (pos === -1) break
        desde = pos + rel.length
        // solo cuenta si es una referencia de href/src
        if (!/(href|src)="\/?$/.test(html.slice(Math.max(0, pos - 12), pos))) continue
        referencias++
        const sufijo = html.slice(pos, pos + marca.length)
        assert.equal(sufijo, marca, `${f}: ${rel} debe llevar ?v=<sha1> (corre deploy/versionar.py)`)
        assert.equal(html.slice(pos + marca.length, pos + marca.length + 8), hashes[rel],
          `${f}: el ?v= de ${rel} está desactualizado (corre deploy/versionar.py)`)
      }
      if (referencias === 0) assert.equal(rel, 'js/bg3d.js', `${f} no referencia ${rel}`)
    }
  }
  const r = await pedir('/css/styles.css?v=' + hashes['css/styles.css'])
  assert.equal(r.status, 200, 'el CSS con ?v= se sirve')
})
