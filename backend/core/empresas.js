/**
 * Empresas — entidad de aislamiento del software contable (FASE 1).
 *
 * Módulo puro: recibe la BD como parámetro y valida el aislamiento en cada
 * función: ninguna consulta devuelve datos de una empresa a un usuario sin
 * asignación activa en usuario_empresa (o ser super_admin global).
 */

const { registrarAccion } = require('./auditoria')
const { cifrar, descifrar } = require('./boveda')
const { esRolValido } = require('./permisos')
const { seedPlanCuentas } = require('./migraciones')

function validarRut(rut) {
  const clean = String(rut).replace(/[.\-\s]/g, '').toUpperCase()
  if (clean.length < 8 || clean.length > 9) return false
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  let suma = 0
  let multiplo = 2
  for (let i = body.length - 1; i >= 0; i--) {
    suma += parseInt(body[i], 10) * multiplo
    multiplo = multiplo < 7 ? multiplo + 1 : 2
  }
  const dvEsperado = 11 - (suma % 11)
  const dvCalc = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado)
  return dv === dvCalc
}

function normalizarRut(rut) {
  const clean = String(rut).replace(/[.\-\s]/g, '').toUpperCase()
  return `${clean.slice(0, -1)}-${clean.slice(-1)}`
}

function esSuperAdmin(db, usuarioId) {
  return !!db.prepare(`SELECT 1 FROM users WHERE id = ? AND is_admin = 1 AND activo = 1`).get(usuarioId)
}

/**
 * Asignaciones activas del usuario: [{ empresa_id, rol }] (+ flag super_admin).
 * El super_admin ve todas las empresas activas con su rol global.
 */
function asignacionesDeUsuario(db, usuarioId) {
  const superAdmin = esSuperAdmin(db, usuarioId)
  const propias = db.prepare(`
    SELECT ue.empresa_id, r.codigo AS rol
    FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.activo = 1
  `).all(usuarioId)

  if (!superAdmin) return { superAdmin, asignaciones: propias }

  const todas = db.prepare(`SELECT id FROM empresas WHERE activo = 1`).all()
  const mapa = new Map(propias.map((a) => [a.empresa_id, a.rol]))
  for (const e of todas) {
    if (!mapa.has(e.id)) mapa.set(e.id, 'super_admin')
  }
  return { superAdmin, asignaciones: [...mapa.entries()].map(([empresa_id, rol]) => ({ empresa_id, rol })) }
}

/** ¿El usuario puede operar la empresa? Devuelve su rol si sí, null si no. */
function rolEnEmpresa(db, usuarioId, empresaId) {
  if (esSuperAdmin(db, usuarioId)) return 'super_admin'
  const fila = db.prepare(`
    SELECT r.codigo AS rol
    FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
    WHERE ue.usuario_id = ? AND ue.empresa_id = ? AND ue.activo = 1
  `).get(usuarioId, empresaId)
  return fila ? fila.rol : null
}

function toEmpresa(row) {
  return {
    id: row.id, rut: row.rut, nombre: row.nombre, tasa_ppm: row.tasa_ppm,
    telefono: row.telefono, exento: !!row.exento, activo: !!row.activo,
    creado_en: row.creado_en,
    config: parseConfig(row.config_json),
  }
}

/**
 * Configuración contable de la empresa (memoria de contabilización).
 *  - modo_conciliacion: 'simple' (default — compras y ventas se netean contra
 *    la cuenta regular, sin conciliación bancaria; la mayoría de las pymes)
 *    | 'completa' (CxC/CxP por contraparte + conciliación bancaria).
 *  - cuenta_regular_gastos_id / cuenta_regular_ingresos_id: la "cuenta regular"
 *    donde se netean los gastos e ingresos (típicamente la cuenta contable del
 *    banco). La memoria POR CONTRAPARTE (RUT → cuenta) vive en `contrapartes`.
 */
function parseConfig(json) {
  let c = {}
  try { c = JSON.parse(json || '{}') || {} } catch { c = {} }
  return {
    modo_conciliacion: c.modo_conciliacion === 'completa' ? 'completa' : 'simple',
    cuenta_regular_gastos_id: Number(c.cuenta_regular_gastos_id) || null,
    cuenta_regular_ingresos_id: Number(c.cuenta_regular_ingresos_id) || null,
  }
}

function obtenerConfig(db, empresaId) {
  const row = db.prepare(`SELECT config_json FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!row) throw new Error('Empresa no encontrada')
  return parseConfig(row.config_json)
}

/**
 * Actualiza la configuración contable. Valida que las cuentas regulares
 * existan en la empresa (aislamiento) y audita antes/después.
 */
function actualizarConfig(db, { empresaId, usuarioId, config, ip = null }) {
  if (!rolEnEmpresa(db, usuarioId, empresaId)) throw new Error('No tiene acceso a esta empresa')
  const actual = obtenerConfig(db, empresaId)
  const nuevo = {
    modo_conciliacion: config && config.modo_conciliacion === 'completa' ? 'completa' : 'simple',
    cuenta_regular_gastos_id: Number(config && config.cuenta_regular_gastos_id) || null,
    cuenta_regular_ingresos_id: Number(config && config.cuenta_regular_ingresos_id) || null,
  }
  const cuentas = require('./cuentas')
  for (const clave of ['cuenta_regular_gastos_id', 'cuenta_regular_ingresos_id']) {
    if (nuevo[clave] && !cuentas.obtener(db, empresaId, nuevo[clave])) {
      throw new Error('La cuenta regular configurada no existe en esta empresa')
    }
  }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE empresas SET config_json = ? WHERE id = ?`).run(JSON.stringify(nuevo), empresaId)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'empresa.config_actualizar', entidad: 'empresas', entidadId: String(empresaId),
      antes: actual, despues: nuevo, ip,
    })
  })
  tx()
  return nuevo
}

/** Lista de empresas visibles para el usuario (aislamiento garantizado aquí). */
function listarParaUsuario(db, usuarioId) {
  const { asignaciones } = asignacionesDeUsuario(db, usuarioId)
  if (!asignaciones.length) return []
  const ids = asignaciones.map((a) => a.empresa_id)
  const placeholders = ids.map(() => '?').join(',')
  const filas = db.prepare(`
    SELECT * FROM empresas WHERE activo = 1 AND id IN (${placeholders}) ORDER BY nombre
  `).all(...ids)
  return filas.map(toEmpresa)
}

/** Obtiene una empresa solo si el usuario tiene asignación activa. */
function obtenerParaUsuario(db, usuarioId, empresaId) {
  if (!rolEnEmpresa(db, usuarioId, empresaId)) return null
  const row = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  return row ? toEmpresa(row) : null
}

/**
 * Clave SII descifrada SOLO para pasarla a la integración SII existente
 * (rcv.consultarRCV). Nunca se expone por API ni se loggea.
 */
function claveSiiDescifrada(db, empresaId) {
  const row = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(empresaId)
  if (!row) throw new Error(`Empresa ${empresaId} no encontrada`)
  return descifrar(row.clave_sii)
}

/**
 * Crea una empresa. Requiere capacidad de super admin (validación de rol en
 * la ruta; aquí se revalida contra BD). Auditoría con despues completo.
 */
function crear(db, { usuarioId, rut, nombre, claveSii, tasaPpm = 0, telefono = '', exento = false, ip = null }) {
  if (!esSuperAdmin(db, usuarioId)) {
    throw new Error('Solo un super administrador puede crear empresas')
  }
  if (!rut || !nombre || !claveSii) throw new Error('RUT, nombre y clave SII son obligatorios')
  if (!validarRut(rut)) throw new Error('RUT inválido')
  const rutNorm = normalizarRut(rut)
  const tasa = Number(tasaPpm)
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 1) throw new Error('Tasa PPM inválida (0..1, ej: 0.015)')
  const tel = String(telefono || '').replace(/\D/g, '')

  const existente = db.prepare(`SELECT id FROM empresas WHERE rut = ? AND activo = 1`).get(rutNorm)
  if (existente) throw new Error('Ya existe una empresa activa con ese RUT')

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, telefono, exento)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(rutNorm, String(nombre).trim(), cifrar(claveSii), tasa, tel || null, exento ? 1 : 0)
    const empresaId = info.lastInsertRowid
    // Plantilla PUC precargada al crear la empresa (FASE 2)
    seedPlanCuentas(db, empresaId)
    // Licencia HEREDADA (SAAS-ACCESO §5): la empresa creada manualmente por el
    // super_admin es cliente de servicio — el gate de licencias no la bloquea.
    require('./licencias').crearHeredada(db, empresaId, usuarioId)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'empresa.crear', entidad: 'empresas', entidadId: empresaId,
      despues: { rut: rutNorm, nombre: String(nombre).trim(), tasa_ppm: tasa, exento: !!exento }, ip,
    })
    return empresaId
  })
  const empresaId = tx()
  return obtenerParaUsuario(db, usuarioId, empresaId)
}

/** Actualiza campos editables. La clave SII se re-cifra solo si viene nueva. */
function actualizar(db, { usuarioId, empresaId, nombre, claveSii, tasaPpm, telefono, exento, ip = null }) {
  if (!rolEnEmpresa(db, usuarioId, empresaId)) throw new Error('No tiene acceso a esta empresa')
  const actual = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!actual) throw new Error('Empresa no encontrada')

  const cambios = {}
  if (nombre !== undefined) cambios.nombre = String(nombre).trim()
  if (claveSii !== undefined && claveSii !== '') cambios.clave_sii = cifrar(claveSii)
  if (tasaPpm !== undefined) {
    const tasa = Number(tasaPpm)
    if (!Number.isFinite(tasa) || tasa < 0 || tasa > 1) throw new Error('Tasa PPM inválida (0..1, ej: 0.015)')
    cambios.tasa_ppm = tasa
  }
  if (telefono !== undefined) cambios.telefono = String(telefono).replace(/\D/g, '') || null
  if (exento !== undefined) cambios.exento = exento ? 1 : 0
  if (!Object.keys(cambios).length) throw new Error('No hay campos para actualizar')

  const antes = { nombre: actual.nombre, tasa_ppm: actual.tasa_ppm, telefono: actual.telefono, exento: !!actual.exento }
  const tx = db.transaction(() => {
    const sets = Object.keys(cambios).map((c) => `${c} = ?`).join(', ')
    db.prepare(`UPDATE empresas SET ${sets} WHERE id = ?`).run(...Object.values(cambios), empresaId)
    const despues = { ...antes, ...({ nombre: cambios.nombre, tasa_ppm: cambios.tasa_ppm, telefono: cambios.telefono, exento: cambios.exento !== undefined ? !!cambios.exento : undefined }) }
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'empresa.editar', entidad: 'empresas', entidadId: empresaId,
      antes, despues, ip,
    })
  })
  tx()
  return obtenerParaUsuario(db, usuarioId, empresaId)
}

/** Desactivación (soft delete) — nunca DELETE físico. */
function desactivar(db, { usuarioId, empresaId, ip = null }) {
  if (!esSuperAdmin(db, usuarioId)) throw new Error('Solo un super administrador puede desactivar empresas')
  const actual = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!actual) throw new Error('Empresa no encontrada')
  const tx = db.transaction(() => {
    db.prepare(`UPDATE empresas SET activo = 0 WHERE id = ?`).run(empresaId)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'empresa.desactivar', entidad: 'empresas', entidadId: empresaId,
      antes: { activo: true }, despues: { activo: false }, ip,
    })
  })
  tx()
  return { ok: true }
}

/** Asigna o cambia el rol de un usuario en una empresa (solo super admin). */
function asignarRol(db, { usuarioIdEjecutor, usuarioIdObjetivo, empresaId, rol, ip = null }) {
  if (!esSuperAdmin(db, usuarioIdEjecutor)) throw new Error('Solo un super administrador gestiona roles')
  if (!esRolValido(rol)) throw new Error(`Rol inválido: ${rol}`)
  const empresa = db.prepare(`SELECT id FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  const usuario = db.prepare(`SELECT id FROM users WHERE id = ? AND activo = 1`).get(usuarioIdObjetivo)
  if (!usuario) throw new Error('Usuario no encontrado')

  const rolRow = db.prepare(`SELECT id FROM roles WHERE codigo = ?`).get(rol)
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id)
      VALUES (?, ?, ?)
      ON CONFLICT(usuario_id, empresa_id) DO UPDATE SET rol_id = excluded.rol_id, activo = 1
    `).run(usuarioIdObjetivo, empresaId, rolRow.id)
    registrarAccion(db, {
      empresaId, usuarioId: usuarioIdEjecutor, accion: 'empresa.asignar_rol', entidad: 'usuario_empresa',
      entidadId: `${usuarioIdObjetivo}`, despues: { usuario_id: usuarioIdObjetivo, empresa_id: empresaId, rol }, ip,
    })
  })
  tx()
  return { ok: true }
}

module.exports = {
  validarRut, normalizarRut,
  esSuperAdmin, asignacionesDeUsuario, rolEnEmpresa,
  listarParaUsuario, obtenerParaUsuario, claveSiiDescifrada,
  crear, actualizar, desactivar, asignarRol,
  obtenerConfig, actualizarConfig, parseConfig,
}
