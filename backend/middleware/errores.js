/**
 * Manejador de errores de Express (F8-G).
 *
 * Antes devolvía `err.message` tal cual al cliente. En producción eso filtra
 * internos: mensajes de SQLite con nombres de tabla y rutas de archivo, rutas
 * del sistema de archivos, identificadores de módulos y detalles de la bóveda.
 * La traza completa sigue yendo al log del contenedor; al cliente se le da un
 * mensaje genérico y accionable.
 *
 * En desarrollo/pruebas se conserva el mensaje original: es lo que hace
 * depurables los tests y el trabajo local.
 */

const PRODUCCION = 'production'
const MENSAJE_GENERICO = 'Error interno del servidor'

function esProduccion(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === PRODUCCION
}

/**
 * @param {object} [opciones]
 * @param {NodeJS.ProcessEnv} [opciones.env]  entorno (inyectable en tests)
 * @param {(msg:string)=>void} [opciones.log] registrador (default console.error)
 */
function crearManejadorErrores({ env = process.env, log } = {}) {
  const registrar = log || ((msg) => console.error(msg))
  return function manejadorErrores(err, req, res, next) {
    // El mensaje y la traza SÍ quedan en el log del servidor: es la única
    // forma de diagnosticar. Nunca se imprime nada que venga del request
    // (cuerpo, cookies, cabeceras de autorización).
    registrar(`[ERROR] ${req.method} ${req.originalUrl || req.url} → ${err && err.message ? err.message : err}`)
    if (err && err.stack) registrar(err.stack)

    if (res.headersSent) return next(err)

    const detalle = err && err.message ? err.message : MENSAJE_GENERICO
    return res.status(500).json({
      ok: false,
      error: esProduccion(env) ? MENSAJE_GENERICO : detalle,
    })
  }
}

module.exports = { crearManejadorErrores, esProduccion, MENSAJE_GENERICO }
