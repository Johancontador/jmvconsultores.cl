/**
 * Health check con verificación REAL de la base (F8-G).
 *
 * Antes `/api/health` respondía siempre `{ok:true, message:'IVA Mensual API
 * running'}`: el proceso podía estar arriba con la base bloqueada, corrupta o
 * inaccesible y el contenedor seguía «healthy». El healthcheck de Docker y
 * `ops/deploy.sh` se apoyan en este endpoint, así que un health que no prueba
 * nada convierte el despliegue en una falsa señal de éxito.
 *
 * Ahora: consulta `SELECT 1` contra la conexión de la aplicación.
 *  - 200 `{ok:true, db:'ok', version}` → disponible y con base utilizable.
 *  - 503 `{ok:false, db:'error', version}` → el proceso responde pero no puede
 *    operar (el healthcheck de Docker marca el contenedor unhealthy, que es
 *    exactamente lo que el operador necesita saber).
 *
 * El cuerpo NO incluye rutas, credenciales ni el error de SQLite: eso va al
 * log. Tampoco expone el commit desplegado (ver DEC de `33`).
 */

function crearHealth({ db, version = null } = {}) {
  return function health(req, res) {
    let estado = 'ok'
    if (!db || typeof db.prepare !== 'function') {
      estado = 'error'
      console.error('[HEALTH] la conexión de base no está disponible')
    } else {
      try {
        db.prepare('SELECT 1 AS uno').get()
      } catch (err) {
        estado = 'error'
        console.error('[HEALTH] la base no responde:', err.message)
      }
    }

    const ok = estado === 'ok'
    res.status(ok ? 200 : 503).json({ ok, db: estado, version })
  }
}

module.exports = { crearHealth }
