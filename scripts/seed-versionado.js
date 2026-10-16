#!/usr/bin/env node
/**
 * seed-versionado.js — versión anti-caché por CONTENIDO, no por SHA del commit.
 *
 * Por qué: las referencias estáticas de `frontend/sistema/index.html` van con
 * `?v=<semilla>` porque el nginx del VPS fija `cache-control: max-age=14400`
 * a los `.js`/`.css` (lo fija nginx, no Express). La primera iteración usaba
 * el SHA de HEAD como semilla, lo que es un error de fondo: al hacer HEAD
 * todavía es el commit ANTERIOR, y esa URL ya fue servida (con el JS viejo)
 * y quedó cacheada por el navegador → el deploy «nuevo» sirve la MISMA URL
 * que el navegador ya tiene cacheada y no se ve nada.
 *
 * Solución: semilla = sha1(bytes del propio archivo). Dos URLs distintas ⇔
 * contenido distinto; el contenido no cambia ⇒ misma semilla (la caché sigue
 * siendo válida); el contenido cambia ⇒ URL nueva ⇒ refetch garantizado.
 *
 * Uso: `node scripts/seed-versionado.js` ANTES de commitear cualquier cambio
 * en frontend (o `npm run seed:v`).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
/**
 * Páginas con referencias versionadas por contenido. El nginx del VPS fija
 * `max-age=14400` a .js/.css de TODO el sitio (no solo /sistema/), así que el
 * mismo problema de caché aplica a las páginas públicas: sin ?v=<sha1> un
 * cambio de /css/sitio.css seguiría sirviéndose desde el navegador 4 horas.
 * Solo se versionan .css/.js (las imágenes van con su propio nombre).
 */
const PAGINAS = [
  path.join(ROOT, 'frontend', 'sistema', 'index.html'),
  path.join(ROOT, 'frontend', 'landing.html'),
  path.join(ROOT, 'frontend', 'login.html'),
  path.join(ROOT, 'frontend', 'registro.html'),
]

// El ?v= es OPCIONAL: también versiona referencias que aún no lo traen (una
// página nueva no puede quedar sin anti-caché solo por no tener la query).
const RE = /(href|src)="(\/(?:sistema|shared|css|assets)\/[^"?]+\.(?:js|css))(?:\?v=[a-f0-9]+)?"/g

let cambios = 0
let tocadas = 0

for (const HTML of PAGINAS) {
  if (!fs.existsSync(HTML)) throw new Error(`Página no existe: ${HTML}`)
  const html = fs.readFileSync(HTML, 'utf8')
  let enPagina = 0
  const out = html.replace(RE, (full, attr, url) => {
    const file = path.join(ROOT, 'frontend', url.replace(/^\//, '').replace(/\//g, path.sep))
    if (!fs.existsSync(file)) throw new Error(`Archivo referenciado no existe: ${url} (en ${path.basename(HTML)})`)
    const h = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8)
    enPagina++
    return `${attr}="${url}?v=${h}"`
  })
  cambios += enPagina
  if (out !== html) {
    fs.writeFileSync(HTML, out)
    tocadas++
    console.log(`  · ${path.relative(ROOT, HTML)}: ${enPagina} referencia(s) rehashadas`)
  }
}

if (tocadas) {
  console.log(`Versionado por contenido: ${cambios} referencia(s) en ${tocadas} página(s)`)
} else {
  console.log(`Sin cambios: ${cambios} referencia(s) ya versionadas por contenido`)
}
