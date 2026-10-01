/**
 * Registro self-service + onboarding (SAAS-ACCESO §3, §4, §7).
 *
 * El visitante de jmvconsultores.cl llega a /registro.html y crea TODO con un
 * formulario: usuario, clave, RUT de su empresa y clave SII. El sistema:
 *  1. Valida el par RUT+clave SII EN VIVO contra el SII (probarConexion — la
 *     integración existente, sin scraping): si la credencial no sirve, no se
 *     crea nada (evita empresas fantasma que nunca sincronizarán).
 *  2. En UNA transacción crea: usuario dueño + empresa (clave SII cifrada en
 *     bóveda) + plan de cuentas PUC + rol admin_empresa + licencia PRUEBA 90
 *     días (SAAS-ACCESO §5.4).
 *  3. Deja registrada la ficha pendiente (onboarding_json) que SAAS-2 llenará
 *     desde el SII: razón social, actividades, régimen, socios. Checklist §43:
 *     cada dato se marca automático ✓ o pendiente humano ⚠.
 *
 * El nombre visible de la empresa lo elige el usuario; la razón social legal
 * llegará del SII (SAAS-2) — no se inventa (regla §42: nada fake).
 */

const { hashPassword } = require('../services/password')
const siiRcv = require('../services/sii-rcv')
const { registrarAccion } = require('./auditoria')
const { validarRut, normalizarRut } = require('./empresas')
const { seedPlanCuentas } = require('./migraciones')
const licencias = require('./licencias')

const ROLES_VALIDOS_REGISTRO = ['admin_empresa']

/** Datos mínimos del formulario público (honeypot incluido). */
function validarFormulario({ username, password, rut, claveSii, nombreEmpresa, telefono, web }) {
  if (web) throw new Error('Registro rechazado (formulario inválido)') // honeypot: bots rellenan este campo oculto
  if (!username || String(username).trim().length < 4) throw new Error('El usuario debe tener al menos 4 caracteres')
  if (!/^[a-zA-Z0-9._-]+$/.test(String(username).trim())) throw new Error('El usuario solo puede usar letras, números, punto, guion y guion bajo')
  if (!password || String(password).length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres')
  if (!claveSii || String(claveSii).length < 6) throw new Error('La clave SII es obligatoria (la usaremos solo para sincronizar tus documentos)')
  if (!validarRut(rut)) throw new Error('RUT inválido (revisa el dígito verificador)')
  if (!nombreEmpresa || String(nombreEmpresa).trim().length < 2) throw new Error('Indica el nombre con el que quieres ver tu empresa')
}

/** ¿El RUT ya está registrado como empresa activa? (una licencia por RUT) */
function rutRegistrado(db, rut) {
  const rutNorm = normalizarRut(rut)
  return !!db.prepare(`SELECT id FROM empresas WHERE rut = ? AND activo = 1`).get(rutNorm)
}

/**
 * Registro completo. `probarSii` (default true) valida la credencial en vivo
 * contra el SII ANTES de crear nada — si el servicio SII está caído se puede
 * registrar con probarSii=false quedando onboarding 'pendiente_verificacion'
 * (JMV lo revisa; la ingesta igual fallará hasta tener clave válida).
 */
async function registrarConOnboarding(db, {
  username, password, rut, claveSii, nombreEmpresa, telefono = '', web = null,
  probarSii = true, ip = null,
}) {
  validarFormulario({ username, password, rut, claveSii, nombreEmpresa, telefono, web })
  const rutNorm = normalizarRut(rut)
  if (rutRegistrado(db, rutNorm)) {
    throw new Error('Ese RUT ya tiene una cuenta en el sistema: inicia sesión o recupera tu acceso')
  }
  const userNorm = String(username).trim().toLowerCase()
  if (db.prepare(`SELECT id FROM users WHERE username = ?`).get(userNorm)) {
    throw new Error('Ese usuario ya existe: elige otro')
  }

  // 1) Validación EN VIVO contra el SII (fuera de la transacción: es I/O lenta
  //    con reintentos; la transacción SQLite debe ser corta y determinista).
  let verificacion = null
  if (probarSii) {
    const r = await siiRcv.probarConexion(rutNorm, String(claveSii))
    if (!r.ok) {
      throw new Error(`El SII no aceptó tus credenciales (${r.error}). Verifica tu RUT y clave tributaria — no se creó ninguna cuenta`)
    }
    verificacion = {
      verificado_en: new Date().toISOString(),
      periodo: r.periodo,
      documentos_mes: (r.compras || 0) + (r.ventas || 0),
    }
  }

  // 2) Transacción única: todo o nada.
  const tx = db.transaction(() => {
    const infoUser = db.prepare(`
      INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)
    `).run(userNorm, hashPassword(String(password)))
    const usuarioId = infoUser.lastInsertRowid

    const tel = String(telefono || '').replace(/\D/g, '')
    const infoEmp = db.prepare(`
      INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, telefono, exento, onboarding_json)
      VALUES (?, ?, ?, 0, ?, 0, ?)
    `).run(
      rutNorm, String(nombreEmpresa).trim(), require('./boveda').cifrar(String(claveSii)),
      tel || null,
      JSON.stringify({
        estado: verificacion ? 'verificado_sii' : 'pendiente_verificacion',
        verificacion,
        checklist: {
          razon_social_sii: 'pendiente',        // SAAS-2: desde el SII + confirmación humana
          inicio_actividades: 'pendiente',
          actividades_economicas: 'pendiente',
          regimen_tributario: 'pendiente',
          socios_representante: 'pendiente',
          documentos_historicos: 'pendiente',
        },
      })
    )
    const empresaId = infoEmp.lastInsertRowid

    seedPlanCuentas(db, empresaId)

    const rolRow = db.prepare(`SELECT id FROM roles WHERE codigo = 'admin_empresa'`).get()
    db.prepare(`
      INSERT INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (?, ?, ?)
    `).run(usuarioId, empresaId, rolRow.id)

    licencias.crearPrueba(db, empresaId, usuarioId)

    registrarAccion(db, {
      empresaId, usuarioId, accion: 'registro.self_service', entidad: 'empresas', entidadId: String(empresaId),
      despues: {
        rut: rutNorm, nombre: String(nombreEmpresa).trim(),
        usuario: userNorm,
        sii_verificado: !!verificacion,
        licencia: 'PRUEBA 90 días',
      }, ip,
    })

    return { usuarioId, empresaId }
  })
  const { usuarioId, empresaId } = tx()

  return {
    ok: true,
    usuarioId, empresaId,
    licencia: licencias.estadoParaUI(db, empresaId),
    onboarding: JSON.parse(db.prepare(`SELECT onboarding_json FROM empresas WHERE id = ?`).get(empresaId).onboarding_json),
  }
}

module.exports = { registrarConOnboarding, validarFormulario, rutRegistrado, ROLES_VALIDOS_REGISTRO }
