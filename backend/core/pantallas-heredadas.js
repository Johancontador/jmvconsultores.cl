/**
 * PANTALLAS HEREDADAS RETIRADAS (2026-10-20).
 *
 * La capa vieja (`frontend/index.html`, `dashboard.html`, `libro.html`,
 * `informe.html`, `proceso.html`, `exportacion-masiva.html` y
 * `configuracion.html` + sus módulos `frontend/js/*`) era una SEGUNDA UI sobre
 * la misma API. Sus funciones ya viven en la SPA:
 *
 *   Clientes del portafolio  → #portafolio
 *   Dashboard / Libro        → #inicio / #libros
 *   Informe por rango        → #informe-rango
 *   Proceso masivo           → #proceso-masivo
 *   Reporte masivo (ZIP)     → #exportacion-masiva
 *   Configuración / usuarios → #admin
 *
 * Se redirige con 302 (no 301): un permanente queda cacheado en el navegador y
 * haría imposible revertir sin limpiar la caché del usuario. La query se
 * descarta a propósito (`?tab=usuarios` → `#admin`), así el destino manda.
 *
 * Este módulo existe para que la tabla sea testeable sin arrancar el servidor.
 */

const PANTALLAS_HEREDADAS = {
  'index.html': '/sistema/#portafolio',
  'dashboard.html': '/sistema/#inicio',
  'libro.html': '/sistema/#libros',
  'informe.html': '/sistema/#informe-rango',
  'proceso.html': '/sistema/#proceso-masivo',
  'exportacion-masiva.html': '/sistema/#exportacion-masiva',
  'configuracion.html': '/sistema/#admin',
}

/** Monta una ruta GET por pantalla retirada. Debe ir ANTES de los estáticos. */
function montarRedirects(app) {
  for (const [archivo, destino] of Object.entries(PANTALLAS_HEREDADAS)) {
    app.get(`/${archivo}`, (req, res) => res.redirect(302, destino))
  }
}

module.exports = { PANTALLAS_HEREDADAS, montarRedirects }
