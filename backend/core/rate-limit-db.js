/**
 * rate-limit-db.js — Rate-limits en SQLite (BLOQUE 3, masterplan 2026-10-10).
 *
 * Problema (auditoría R3): los rate-limits de login/registro/password/SII-probar
 * viven en Map del proceso. En el entorno real (Docker con PM2/eternal-style
 * restarts, o un próximo deploy multi-instancia tras nginx), un reinicio pone
 * a cero los contadores de fuerza bruta justo cuando más importan.
 *
 * Solución mínima SIN infraestructura nueva: misma semántica ventana+count que
 * ya usaban los Maps, pero persistida en SQLite (tabla rate_limit). El backend
 * es better-sqlite3 síncrono: una UPSERT por request es ~microsegundos y no
 * añade un servicio externo (cumple la restricción del masterplan: NO Redis).
 *
 * Escalado: expone `deleterVencidos()` para purgar la tabla de forma perezosa
 * (llamado desde la misma ventana de purga de los Map restantes).
 *
 * Módulo puro: BD por parámetro. Sin Express.
 */

const LIMPIEZA_CADA_MS = 60 * 60 * 1000 // 1 hora de purga perezosa
let ultimaLimpieza = 0

/**
 * Controla un intento dentro de una ventana deslizante por clave.
 * Devuelve { permitido, restantes, reset_en_ms }.
 */
function consumir(db, { clave, limite, ventanaMs, ahora = Date.now() }) {
  const ventanaInicio = ahora - ventanaMs
  const fila = db.prepare(`
    SELECT count, inicio_ms FROM rate_limit WHERE clave = ?
  `).get(clave)

  let count, inicio
  if (!fila || fila.inicio_ms < ventanaInicio) {
    count = 0
    inicio = ahora
  } else {
    count = fila.count
    inicio = fila.inicio_ms
  }

  if (count >= limite) {
    // Purga perezosa al mismo tiempo (no en el camino caliente más que 1 vez/hora)
    if (ahora - ultimaLimpieza > LIMPIEZA_CADA_MS) {
      limpiarVencidos(db, ahora)
      ultimaLimpieza = ahora
    }
    return { permitido: false, restantes: 0, reset_en_ms: Math.max(0, inicio + ventanaMs - ahora) }
  }

  // UPSERT: misma ventana suma, ventana nueva reinicia.
  db.prepare(`
    INSERT INTO rate_limit (clave, count, inicio_ms) VALUES (?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET
      count = CASE WHEN inicio_ms < ? THEN 1 ELSE count + 1 END,
      inicio_ms = CASE WHEN inicio_ms < ? THEN ? ELSE inicio_ms END
  `).run(clave, 1, ahora, ventanaInicio, ventanaInicio, ahora)
  count += 1

  return { permitido: true, restantes: Math.max(0, limite - count), reset_en_ms: Math.max(0, inicio + ventanaMs - ahora) }
}

/** Borra las entradas whose ventana venció hace más de un ciclo. */
function limpiarVencidos(db, ahora = Date.now(), gracia = 2 * 60 * 60 * 1000) {
  return db.prepare(`DELETE FROM rate_limit WHERE inicio_ms < ?`).run(ahora - LIMPIEZA_CADA_MS - gracia).changes
}

/** Middleware Express: rate-limit SQLite por clave-compuesta.
 *  'porIp' compone la clave con el scope + IP del request (detrás de nginx con
 *  trust proxy 1, req.ip ya es el cliente real). */
function middleware(scope, { limite, ventanaMs, mensaje = 'Demasiadas solicitudes. Intente más tarde.' }) {
  return (req, res, next) => {
    const db = require('../db')
    const ip = req.ip || req.connection?.remoteAddress || 'unknown'
    const r = consumir(db, { clave: `${scope}:${ip}`, limite, ventanaMs })
    if (!r.permitido) {
      return res.status(429).json({ ok: false, error: mensaje, reintente_en_ms: r.reset_en_ms })
    }
    next()
  }
}

/** Crea la tabla (llamar en el arranque). */
function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limit (
      clave TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      inicio_ms INTEGER NOT NULL
    );
  `)
}

module.exports = { consumir, limpiarVencidos, middleware, migrar, LIMPIEZA_CADA_MS }
