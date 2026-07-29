const { obtenerSesion } = require('../services/session')

function parseCookies(header) {
  const out = {}
  if (!header) return out
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx === -1) return
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim())
  })
  return out
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie)
  const user = obtenerSesion(cookies.sid)
  if (!user) {
    return res.status(401).json({ ok: false, error: 'No autenticado' })
  }
  req.user = user
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ ok: false, error: 'Requiere permisos de administrador' })
  }
  next()
}

module.exports = { requireAuth, requireAdmin, parseCookies }
