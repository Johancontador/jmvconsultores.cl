const express = require('express')
const db = require('../db')
const { hashPassword, verifyPassword } = require('../services/password')
const { crearSesion, obtenerSesion, destruirSesion, SESSION_TTL_MS } = require('../services/session')
const { requireAuth, requireAdmin, parseCookies } = require('../middleware/requireAuth')
const { registrarAccion } = require('../core/auditoria')
const rlDb = require('../core/rate-limit-db')

const router = express.Router()

// Rate-limit simple en memoria para login (por IP)
const loginIntentos = new Map()
const LIMITE_LOGIN = 5
const VENTANA_LOGIN_MS = 15 * 60 * 1000 // 15 min

/**
 * Purga perezosa de los Map de rate-limit (BLOQUE 1 — P2): sin esto crecen
 * una entrada por IP para siempre. Se ejecuta en cada request (barato: solo
 * actúa sobre el umbral) con tope duro ante flooding con IPs falsas.
 * Restricción explícita: sigue siendo estado de UN proceso (mono-proceso).
 */
function purgarLimites(mapa, ventanaMs, ahora = Date.now()) {
  if (mapa.size > 500) {
    for (const [ip, reg] of mapa) {
      if (!reg || ahora - reg.inicio > ventanaMs) mapa.delete(ip)
    }
  }
  if (mapa.size > 2000) {
    let exceso = mapa.size - 2000
    for (const ip of mapa.keys()) {
      if (exceso-- <= 0) break
      mapa.delete(ip)
    }
  }
}

function rateLimitLogin(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown'
  const ahora = Date.now()
  purgarLimites(loginIntentos, VENTANA_LOGIN_MS, ahora)
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

router.post('/login', rlDb.middleware('login', {
  limite: LIMITE_LOGIN, ventanaMs: VENTANA_LOGIN_MS,
  mensaje: 'Demasiados intentos de login. Intente de nuevo en 15 minutos.',
}), (req, res) => {
  const { username, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Usuario y contraseña requeridos' })
  }

  const user = db.prepare(`SELECT * FROM users WHERE username = ? AND activo = 1`).get(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' })
  }

  // BLOQUE 1 (P3): purga batch de sesiones expiradas — hasta ahora solo se
  // purgaban perezosamente una a una cuando el MISMO sid se presentaba.
  try {
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(new Date().toISOString())
  } catch { /* la purga no puede bloquear jamás un login */ }

  const sid = crearSesion(user.id)
  const isSecure = process.env.NODE_ENV === 'production'
  res.cookie('sid', sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure, // Solo en producción (HTTPS)
    maxAge: SESSION_TTL_MS,
  })
  res.json({ ok: true, user: { username: user.username, is_admin: !!user.is_admin, debe_cambiar_clave: !!user.debe_cambiar_clave } })
})

// ---- ACCESO ADMIN (Fase A): usuario temporal con clave provisional ----
// El super admin crea un usuario desde Administración indicando el correo;
// el sistema genera la clave provisional y la devuelve UNA vez (solo en esta
// respuesta — no se guarda en claro, jamás va a logs/auditoría).
router.post('/usuarios-empresa', requireAuth, requireAdmin, (req, res) => {
  try {
    const { crearUsuarioTemporal } = require('../core/usuarios-temporales')
    const r = crearUsuarioTemporal(db, {
      adminId: req.user.id,
      username: req.body.username,
      ip: req.ip || null,
    })
    res.status(201).json(r)
  } catch (err) {
    const code = /ya exist|inválid|obligator|debe |Simple/i.test(err.message) ? 400 : 400
    res.status(code).json({ ok: false, error: err.message })
  }
})

// ---- ACCESO ADMIN (Fase A): onboarding de la empresa EXCLUSIVA del usuario ----
// RUT + clave SII → crearDesdeSii (ficha oficial del SII) + rol admin_empresa.
// Un usuario sin empresa aún y sin cambio de clave pendiente.
router.post('/onboarding/empresa', requireAuth, async (req, res) => {
  try {
    const { onboardingEmpresa, estadoDeCambio } = require('../core/usuarios-temporales')
    if (estadoDeCambio(db, req.user.id)) {
      return res.status(403).json({ ok: false, error: 'Debes cambiar tu clave provisional antes de continuar' })
    }
    const r = await onboardingEmpresa(db, {
      usuarioId: req.user.id,
      rut: req.body.rut,
      claveSii: req.body.clave_sii,
      ip: req.ip || null,
    })
    res.status(201).json(r)
  } catch (err) {
    const code = /inválid|ya |obligator|debe |existe|rechazad|incorrecta/i.test(err.message) ? 400 : 500
    res.status(code).json({ ok: false, error: err.message })
  }
})

// ---- Registro self-service (SAAS-ACCESO §3, §7) ----
// Rate-limit INDEPENDIENTE del login: 10 registros/hora/IP.
const registroIntentos = new Map()
const LIMITE_REGISTRO = 10
const VENTANA_REGISTRO_MS = 60 * 60 * 1000

function rateLimitRegistro(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown'
  const ahora = Date.now()
  purgarLimites(registroIntentos, VENTANA_REGISTRO_MS, ahora)
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

router.post('/registro', rlDb.middleware('registro', {
  limite: LIMITE_REGISTRO, ventanaMs: VENTANA_REGISTRO_MS,
  mensaje: 'Demasiados registros desde esta IP. Intente más tarde.',
}), async (req, res) => {
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

// ---- P5 (BLOQUE 1bis): cambio de contraseña propio + revocación total ----
// Rate-limit propio (reusa el patrón de login): protege contra fuerza bruta
// de la contraseña ACTUAL vía este endpoint, aun con sesión válida.
const passwordIntentos = new Map()
const LIMITE_PASSWORD = 5
const VENTANA_PASSWORD_MS = 15 * 60 * 1000

function rateLimitPassword(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown'
  const ahora = Date.now()
  purgarLimites(passwordIntentos, VENTANA_PASSWORD_MS, ahora)
  const registro = passwordIntentos.get(ip) || { count: 0, inicio: ahora }
  if (ahora - registro.inicio > VENTANA_PASSWORD_MS) {
    registro.count = 0
    registro.inicio = ahora
  }
  if (registro.count >= LIMITE_PASSWORD) {
    return res.status(429).json({ ok: false, error: 'Demasiados intentos. Intente de nuevo en 15 minutos.' })
  }
  registro.count++
  passwordIntentos.set(ip, registro)
  next()
}

router.post('/password', requireAuth, rlDb.middleware('password', {
  limite: LIMITE_PASSWORD, ventanaMs: VENTANA_PASSWORD_MS,
  mensaje: 'Demasiados intentos. Intente de nuevo en 15 minutos.',
}), (req, res) => {
  const { password_actual, password_nueva } = req.body
  if (!password_actual || !password_nueva) {
    return res.status(400).json({ ok: false, error: 'Contraseña actual y nueva requeridas' })
  }
  if (String(password_nueva).length < 8) {
    return res.status(400).json({ ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres' })
  }
  if (String(password_nueva) === String(password_actual)) {
    return res.status(400).json({ ok: false, error: 'La nueva contraseña debe ser distinta de la actual' })
  }

  const user = db
    .prepare(`SELECT id, password_hash FROM users WHERE id = ? AND activo = 1`)
    .get(req.user.id)
  if (!user) return res.status(401).json({ ok: false, error: 'Usuario no encontrado' })

  // Comparación segura (scrypt + timingSafeEqual) — jamás plaintext ni hashes en logs.
  if (!verifyPassword(String(password_actual), user.password_hash)) {
    return res.status(401).json({ ok: false, error: 'La contraseña actual es incorrecta' })
  }

  const nuevoHash = hashPassword(String(password_nueva))
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(nuevoHash, user.id)
    // ACCESO ADMIN (Fase A): si la clave provisional seguía pendiente, el
    // cambio exitoso la concluye (primer login del usuario temporal).
    const estabaPendiente = !!db.prepare(`SELECT debe_cambiar_clave FROM users WHERE id = ?`).get(user.id)?.debe_cambiar_clave
    if (estabaPendiente) {
      db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(user.id)
    }
    // REVOCAR TODAS las sesiones del usuario (incluida la actual): un cambio
    // de credencial exige re-autenticación en todos los dispositivos.
    const revocadas = db.prepare(`DELETE FROM sessions WHERE user_id = ?`).run(user.id).changes
    registrarAccion(db, {
      empresaId: null, usuarioId: user.id,
      accion: 'usuario.password_cambiar', entidad: 'users', entidadId: String(user.id),
      despues: { sesiones_revocadas: revocadas, primer_cambio: estabaPendiente }, ip: req.ip || null,
    })
  })
  tx()

  // La cookie apunta a una sesión ya eliminada: se limpia.
  res.clearCookie('sid')
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Se cerraron todas tus sesiones; vuelve a iniciar sesión.' })
})

// Disponibilidad en vivo para el formulario (usuario y RUT, sin crear nada).
router.get('/registro/disponible', rlDb.middleware('registro', {
  limite: LIMITE_REGISTRO, ventanaMs: VENTANA_REGISTRO_MS,
  mensaje: 'Demasiadas consultas desde esta IP. Intente más tarde.',
}), (req, res) => {
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

// Sondeo de sesión para páginas PÚBLICAS (landing, login). Siempre 200:
// el navegador no registra ruido 401 en consola y el front distingue con
// el payload. Las páginas autenticadas siguen usando /me (401 → redirect).
router.get('/estado', (req, res) => {
  const cookies = parseCookies(req.headers.cookie)
  const user = obtenerSesion(cookies.sid)
  res.json({ ok: true, autenticado: !!user, username: user ? user.username : null })
})

router.get('/me', requireAuth, (req, res) => {
  // FASE 1: además del usuario, el shell necesita saber a qué empresas tiene
  // acceso y con qué rol/capacidades (nav y botones se generan desde aquí).
  let accesoContable = null
  try {
    const { asignacionesDeUsuario } = require('../core/empresas')
    const { permisosDeRol } = require('../core/permisos')
    const { superAdmin, asignaciones } = asignacionesDeUsuario(db, req.user.id)
    // tasa_ppm y exento viajan para la ficha de Administración → Empresas
    // (la SPA las lee del acceso; sin ellas mostraría NaN%).
    const filas = db.prepare(`SELECT id, rut, nombre, tasa_ppm, exento FROM empresas WHERE activo = 1`).all()
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

// Exportado para tests (el router ES la export del módulo).
router.purgarLimites = purgarLimites

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
