'use strict'
/**
 * 404 propio (SEO/UX 2026-10-17).
 *
 * Antes: una URL inexistente devolvía el «Cannot GET /ruta» en texto plano de
 * Express — un final pobre para un enlace compartido o mal escrito, y sin la
 * identidad del sitio.
 *
 * Ahora se distingue el consumidor:
 *  - API (`/api/...`): 404 en JSON, porque quien la llama espera JSON y no HTML.
 *  - Páginas: 404 con frontend/404.html (identidad del sitio y accesos útiles).
 *
 * Se monta AL FINAL de todas las rutas (después de express.static y de los
 * routers) y ANTES del manejador de errores. El status siempre es 404 real:
 * una página de error servida con 200 es un error de SEO clásico.
 */
const path = require('path')

const PAGINA_404 = path.join(__dirname, '..', '..', 'frontend', '404.html')

function noEncontrado(req, res) {
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: 'Ruta no encontrada' })
  }
  res.status(404).sendFile(PAGINA_404)
}

module.exports = { noEncontrado, PAGINA_404 }
