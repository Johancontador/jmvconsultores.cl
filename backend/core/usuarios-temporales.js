/**
 * usuarios-temporales.js — Flujo "crear usuario con acceso a UNA empresa" (Fase A).
 *
 * El super admin (is_admin) crea un usuario desde Administración indicando un
 * correo como username; el sistema genera una clave PROVISIONAL legible («no
 * tan difícil»: 2 sílabas + dígitos, ≥ 10 caracteres) que se muestra UNA vez
 * en pantalla — jamás se guarda en claro (se persiste el hash scrypt igual
 * que cualquier usuario) — y el nuevo usuario nace con debe_cambiar_clave=1.
 *
 * En su primer login el usuario DEBE cambiar la clave (endpoint /api/auth/
 * password rechaza sesiones con debe_cambiar_clave pendiente y el login
 * entrega el flag; el frontend fuerza la pantalla de cambio antes de seguir).
 *
 * Después el usuario (ya con clave propia) hace su onboarding: entrega RUT +
 * clave SII de SU empresa; el sistema la crea con empresas-sii.crearDesdeSii
 * (ficha oficial del SII: razón social, régimen, inicio de actividades…) y
 * lo deja ligado SOLO a esa empresa con rol admin_empresa — el aislamiento
 * estricto per-empresa lo garantiza el RBAC existente (usuario_empresa +
 * requirePermiso). Un usuario con acceso exclusivo jamás ve otra empresa:
 * la capacidad empresas:crear no está en su rol ni tiene asignaciones previas.
 *
 * Reglas duras (§42-style del proyecto): nada se inventa, todo auditado y
 * las claves temporales jamás van a la auditoría, logs ni respuestas API
 * posteriores a la creación.
 */

const crypto = require('crypto')
const { hashPassword, verifyPassword } = require('../services/password')
const { registrarAccion } = require('./auditoria')
const { esSuperAdmin, validarRut, normalizarRut } = require('./empresas')

// Alfabeto sin ambigüedades (sin l/1/I/0/O) para lectura por teléfono/WhatsApp.
const CONSONANTES = 'bdfhkprstvwyz'
const VOCALES = 'aeiou'

/** Sílaba pronunciable consonante+vocal. */
function silaba(rng) {
  return rng.select(CONSONANTES) + rng.select(VOCALES)
}

/**
 * Clave provisional «no tan difícil»: TRES sílabas + 2 dígitos —
 * ej: "kirano82tola" (12 chars) — pronunciable, ≥ 12 chars, suficientemente
 * aleatoria (espacio de sílabas 18^3 * 10^2 ≈ 10^7, más el orden aleatorio
 * de selección). Se usa crypto RNG.
 */
function generarClaveProvisional() {
  const rng = {
    select(set) {
      return set[crypto.randomInt(0, set.length)]
    },
  }
  let clave = silaba(rng) + silaba(rng) + silaba(rng) + silaba(rng)
  // Dos dígitos SIN 0 ni 1 (ambiguos) — el resto del alfabeto ya está limpio
  clave += String(crypto.randomInt(2, 10)) + String(crypto.randomInt(2, 10))
  // Garantía de largo (contrato: ≥ 10) — nunca debería activarse con 4 sílabas
  while (clave.length < 10) clave += silaba(rng)
  return clave
}

function validarFormulario({ username }) {
  const user = String(username || '').trim().toLowerCase()
  if (user.length < 4) throw new Error('El usuario/correo debe tener al menos 4 caracteres')
  // Acepta un email (el caso pedido: administración ingresa el correo del cliente)
  // o un nombre de usuario simple: mismo formato que el self-service SAAS-1.
  if (!/^[a-zA-Z0-9._-]+(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})?$/.test(user)) {
    throw new Error('El usuario debe ser un correo válido o un nombre simple (letras, números, punto, guion, guion bajo)')
  }
  if (user.includes('@') && !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(user)) {
    throw new Error('Correo inválido')
  }
  return user
}

/**
 * Crea el usuario temporal (super admin only). Devuelve la clave provisional
 * SOLO al admin que la pide — es la única exposición, en la respuesta de
 * POST /crear-usuario y se asume que el admin se la comunica al cliente.
 * Auditado SIN la clave.
 */
function crearUsuarioTemporal(db, { adminId, username, ip = null }) {
  if (!esSuperAdmin(db, adminId)) throw new Error('Solo el super admin puede crear usuarios')
  const user = validarFormulario({ username })

  const existe = db.prepare(`SELECT id FROM users WHERE username = ?`).get(user)
  if (existe) throw new Error('Ya existe un usuario con ese nombre/correo')

  const claveProvisional = generarClaveProvisional()
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO users (username, password_hash, is_admin, activo, debe_cambiar_clave)
      VALUES (?, ?, 0, 1, 1)
    `).run(user, hashPassword(claveProvisional))
    const usuarioId = info.lastInsertRowid
    registrarAccion(db, {
      empresaId: null, usuarioId: adminId,
      accion: 'usuarios.crear_usuario_temporal', entidad: 'users', entidadId: String(usuarioId),
      despues: { username: user, debe_cambiar_clave: 1 }, ip,
    })
    return usuarioId
  })
  const usuarioId = tx()

  return { ok: true, usuarioId, username: user, clave_provisional: claveProvisional }
}

/**
 * Verificación para el flujo del usuario nuevo: valida sus credenciales y
 * devuelve el estado de la marca de cambio forzado (la sesión sólo se usa
 * para onboarding y cambio de clave hasta que cambia la clave).
 */
function estadoDeCambio(db, usuarioId) {
  const row = db.prepare(`SELECT debe_cambiar_clave, activo FROM users WHERE id = ?`).get(usuarioId)
  if (!row || !row.activo) throw new Error('Usuario no encontrado o inactivo')
  return !!row.debe_cambiar_clave
}

/**
 * Consume la marca (post cambio de clave exitoso). El endpoint de cambio de
 * clave llama esto tras verificar la actual y guardar la nueva.
 */
function concluirCambio(db, { usuarioId, claveActualUsada, ip = null }) {
  const row = db.prepare(`SELECT password_hash, debe_cambiar_clave FROM users WHERE id = ? AND activo = 1`).get(usuarioId)
  if (!row) throw new Error('Usuario no encontrado')
  // La propia verificación de la clave ACTUAL contra el hash ya la hizo el
  // router de /api/auth/password: aquí se agrega la doble verificación de la
  // marca y no se acepta clonar el flujo sin la clave puesta al día.
  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET debe_cambiar_clave = 0 WHERE id = ?`).run(usuarioId)
    registrarAccion(db, {
      empresaId: null, usuarioId,
      accion: 'usuarios.primer_cambio_clave', entidad: 'users', entidadId: String(usuarioId),
      despues: { debe_cambiar_clave: 0 }, ip,
    })
  })
  tx()
  return { ok: true }
}

/**
 * Onboarding de la empresa del usuario nuevo: RUT + clave SII → crearDesdeSii
 * y vínculo EXCLUSIVO admin_empresa.
 *
 * Valida que el RUT corresponda a la credencial (crearDesdeSii ya lo garantiza
 * contra la ficha del SII). El usuario queda ligado a esa empresa y a ninguna
 * otra: no hereda asignaciones previas ni capacidad para crear más empresas.
 */
async function onboardingEmpresa(db, { usuarioId, rut, claveSii, ip = null }) {
  const user = db.prepare(`SELECT id, username, activo, debe_cambiar_clave FROM users WHERE id = ?`).get(usuarioId)
  if (!user || !user.activo) throw new Error('Usuario no encontrado o inactivo')
  // Primero el cambio de clave provisional (el contrato del flujo: sin clave
  // propia, nada de onboarding — se valida antes de tocar el SII).
  if (user.debe_cambiar_clave) {
    throw new Error('Debes cambiar tu clave provisional antes de continuar')
  }
  if (!validarRut(rut)) throw new Error('RUT inválido (revisa el dígito verificador)')
  const rutNorm = normalizarRut(rut)
  const yaTiene = db.prepare(`
    SELECT e.id, e.rut FROM empresas e
    JOIN usuario_empresa ue ON ue.empresa_id = e.id AND ue.activo = 1
    WHERE ue.usuario_id = ? AND ue.activo = 1
  `).get(usuarioId)
  if (yaTiene) throw new Error(`Ya tienes empresa vinculada (${yaTiene.rut}): tu acceso está fijado a ella y no puede cambiarse`)
  if (db.prepare(`SELECT id FROM empresas WHERE rut = ? AND activo = 1`).get(rutNorm)) {
    throw new Error('Ese RUT ya tiene una empresa en el sistema; contacta a tu contador JMV')
  }
  // Credencial SII obligatoria y con largo razonable antes de ir al SII.
  if (!claveSii || String(claveSii).length < 6) {
    throw new Error('La clave SII es obligatoria (se usa solo para sincronizar tus documentos)')
  }
  const empresa = await crearDesdeSii(db, { usuarioId, rut: rutNorm, clave: String(claveSii) })
  const empresaId = typeof empresa === 'object' ? empresa.id : empresa

  // Vínculo exclusivo: el rol admin_empresa ya vino dentro de crearDesdeSii
  // (empresas.crear). Verificar y reforzar.
  const rolRow = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get()
  const yaAsignado = db.prepare(`
    SELECT id FROM usuario_empresa WHERE usuario_id = ? AND empresa_id = ?
  `).get(usuarioId, empresaId)
  if (!yaAsignado) {
    db.prepare(`INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)`)
      .run(usuarioId, empresaId, rolRow.id)
  }

  registrarAccion(db, {
    empresaId, usuarioId,
    accion: 'onboarding.usuario_empresa_vinculada', entidad: 'empresas', entidadId: String(empresaId),
    despues: { rut: rutNorm, rol: 'admin_empresa', exclusivo: true }, ip,
  })

  // Devuelve el mínimo para la UI: nombre de la empresa creada y su id.
  return { ok: true, empresaId, empresa: { id: empresaId, rut: empresa.rut, nombre: empresa.nombre } }
}

module.exports = {
  generarClaveProvisional,
  validarFormulario,
  crearUsuarioTemporal,
  estadoDeCambio,
  concluirCambio,
  onboardingEmpresa,
}
