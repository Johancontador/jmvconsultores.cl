const crypto = require('crypto')
const db = require('../db')

// TTL de sesión configurable (30 días por defecto, antes era fijo). Para
// exposición pública vía Cloudflare/nginx se recomienda SESSION_DIAS=7.
const SESSION_TTL_MS = Number(process.env.SESSION_DIAS || 30) * 24 * 60 * 60 * 1000

function crearSesion(userId) {
  const id = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(id, userId, expiresAt)
  return id
}

function obtenerSesion(sessionId) {
  if (!sessionId) return null

  const row = db
    .prepare(
      `SELECT s.expires_at, u.id as user_id, u.username, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND u.activo = 1`
    )
    .get(sessionId)

  if (!row) return null

  if (new Date(row.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
    return null
  }

  return { id: row.user_id, username: row.username, is_admin: !!row.is_admin }
}

function destruirSesion(sessionId) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId)
}

module.exports = { crearSesion, obtenerSesion, destruirSesion, SESSION_TTL_MS }
