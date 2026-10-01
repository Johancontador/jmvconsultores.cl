const express = require('express')
const db = require('../db')
const { hashPassword, verifyPassword } = require('../services/password')
const { crearSesion, destruirSesion, SESSION_TTL_MS } = require('../services/session')
const { requireAuth, requireAdmin, parseCookies } = require('../middleware/requireAuth')

const router = express.Router()

// Rate-limit simple en memoria para login (por IP)
const loginIntentos = new Map()
const LIMITE_LOGIN = 5
const VENTANA_LOGIN_MS = 15 * 60 * 1000 // 15 min

function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown'
  const ahora = Date.now()
  const registro = loginIntentos.get(ip) || { count: 0, inicio: ahora }
  if (ahora - registro.inicio > VENTANA_LOGIN_MS) {
    registro.count = 0
    registro.inicio = ahora
  }
  if (registro.count >= LIMITE_LOGIN) {
    return res.status(429).json({ ok: false, error: 'Demasiados intentos de login. Intente de nuevo en 15 minutos.' })
  }
  registro.count++
  loginIntentos.set(ip, registro)
  next()
}

router.post('/login', rateLimitLogin, (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' })
  }

  const user = db.prepare(`SELECT * FROM users WHERE username = ? AND activo = 1`).get(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' })
  }

  const sid = crearSesion(user.id)
  const isSecure = process.env.NODE_ENV === 'production'
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure, // Solo en producción (HTTPS)
    maxAge: SESSION_TTL_MS,
  })
  res.json({ ok: true, user: { username: user.username, is_admin: !!user.is_admin } })
})

// ---- Registro self-service (SAAS-ACCESO §3, §7) ----
// Rate-limit INDEPENDIENTE del login: 10 registros/hora/IP.
const registroIntentos = new Map()
const LIMITE_REGISTRO = 10
const VENTANA_REGISTRO_MS = 60 * 60 * 1000

function rateLimitRegistro(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown'
  const ahora = Date.now()
  const registro = registroIntentos.get(ip) || { count: 0, inicio: ahora }
  if (ahora - registro.inicio > VENTANA_REGISTRO_MS) {
    registro.count = 0
    registro.inicio = ahora
  }
  if (registro.count >= LIMITE_REGISTRO) {
    return res.status(429).json({ ok: false, error: 'Demasiados registros desde esta IP. Intente más tarde.' })
  }
  registro.count++
  registroIntentos.set(ip, registro)
  next()
}

router.post('/registro', rateLimitRegistro, async (req, res) => {
  try {
    const { registrarConOnboarding } = require('../core/registro')
    const r = await registrarConOnboarding(db, {
      username: req.body.username, password: req.body.password,
      rut: req.body.rut, claveSii: req.body.clave_sii,
      nombreEmpresa: req.body.nombre_empresa, telefono: req.body.telefono,
      web: req.body.web, // honeypot anti-bot (debe venir vacío)
      probarSii: req.body.probar_sii !== false,
      ip: req.ip || null,
    })
    res.status(201).json(r)
  } catch (err) {
    const code = /inválid|ya |obligator|debe |no aceptó|rechazado|existe/.test(err.message) ? 400 : 500
    res.status(code).json({ ok: false, error: err.message })
  }
})

// Disponibilidad en vivo para el formulario (usuario y RUT, sin crear nada).
router.get('/registro/disponible', rateLimitRegistro, (req, res) => {
  const { username, rut } = req.query
  const out = {}
  if (username) out.username = !db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(String(username).trim().toLowerCase())
  if (rut) {
    const { validarRut, normalizarRut } = require('../core/empresas')
    out.rut_valido = validarRut(rut)
    if (out.rut_valido) out.rut = !db.prepare(`SELECT 1 FROM empresas WHERE rut = ? AND activo = 1`).get(normalizarRut(rut))
  }
  res.json({ ok: true, ...out })
})

router.post('/logout', requireAuth, (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  destruirSesion(cookies.sid)
  res.clearCookie('sid')
  res.json({ ok: true })
})

router.get('/me', requireAuth, (req, res) => {
  // FASE 1: además del usuario, el shell necesita saber a qué empresas tiene
  // acceso y con qué rol/capacidades (nav y botones se generan desde aquí).
  let accesoContable = null
  try {
    const { asignacionesDeUsuario } = require('../core/empresas')
    const { permisosDeRol } = require('../core/permisos')
    const { superAdmin, asignaciones } = asignacionesDeUsuario(db, req.user.id)
    const filas = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE activo = 1`).all()
    const nombrePorId = new Map(filas.map((e) => [e.id, e]))
    const { estadoParaUI } = require('../core/licencias')
    const empresasDelUsuario = asignaciones
      .filter((a) => nombrePorId.has(a.empresa_id))
      .map((a) => ({
        ...nombrePorId.get(a.empresa_id),
        rol: a.rol,
        permisos: [...permisosDeRol(a.rol)],
        licencia: estadoParaUI(db, a.empresa_id),
      }))
    accesoContable = { super_admin: superAdmin, empresas: empresasDelUsuario }
  } catch (err) {
    console.error('[me] error cargando acceso contable:', err.message)
  }
  res.json({ ok: true, user: { ...req.user, acceso_contable: accesoContable } })
})

router.get('/usuarios', requireAuth, requireAdmin, (req, res) => {
  const usuarios = db
    .prepare(`SELECT id, username, is_admin, activo, creado_en FROM users ORDER BY creado_en`)
    .all()
  res.json({ ok: true, usuarios })
})

router.post('/usuarios', requireAuth, requireAdmin, (req, res) => {
  const { username, password } = req.body
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'Usuario y contraseña (mínimo 8 caracteres) requeridos' })
  }

  const existe = db.prepare(`SELECT id FROM users WHERE username = ?`).get(username)
  if (existe) {
    return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese nombre' })
  }

  const info = db
    .prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)`)
    .run(username, hashPassword(password))

  res.status(201).json({ ok: true, id: info.lastInsertRowid })
})

router.delete('/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user.id) {
    return res.status(400).json({ ok: false, error: 'No puedes desactivar tu propia cuenta' })
  }

  const result = db.prepare(`UPDATE users SET activo = 0 WHERE id = ?`).run(id)
  if (result.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Usuario no encontrado' })
  }

  res.json({ ok: true })
})

module.exports = router
