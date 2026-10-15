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
const HTML = path.join(ROOT, 'frontend', 'sistema', 'index.html')

const html = fs.readFileSync(HTML, 'utf8')
const RE = /(href|src)="(\/(?:sistema|shared|css|assets)\/[^"?]+)\?(?:v=[a-f0-9]+)?"/g

let cambios = 0
let out = html.replace(RE, (full, attr, url) => {
  const file = path.join(ROOT, 'frontend', url.replace(/^\//, '').replace(/\//g, path.sep))
  if (!fs.existsSync(file)) throw new Error(`Archivo referenciado no existe: ${url}`)
  const h = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8)
  cambios++
  return `${attr}="${url}?v=${h}"`
})

if (out !== html) {
  fs.writeFileSync(HTML, out)
  console.log(`Versionado por contenido: ${cambios} referencia(s) actualizadas en frontend/sistema/index.html`)
} else {
  console.log(`Sin cambios: ${cambios} referencia(s) ya versionadas por contenido`)
}
