/**
 * Plan de cuentas (FASE 2). Toda función recibe la BD como parámetro y
 * revalida el aislamiento: ninguna consulta cruza empresas.
 *
 * Reglas (ACCOUNTING_DOMAIN §3):
 *  - Cuenta RESUMEN no recibe movimientos; solo imputables (es_resumen=0).
 *  - No se eliminan cuentas con movimientos ni con hijos activos: se desactivan.
 *  - Alias únicos por empresa — el motor de reglas/cierres los busca por alias.
 */

const { clasificar } = require('./plan-cuentas-plantilla')
const { registrarAccion } = require('./auditoria')

function existeEmpresa(db, empresaId) {
  return !!db.prepare(`SELECT 1 FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
}

function validarCodigo(codigo) {
  if (!/^\d(\.\d+)*$/.test(String(codigo || ''))) {
    throw new Error('Código de cuenta inválido (usar jerarquía con puntos, ej: 6.1.2.01)')
  }
}

function toCuenta(row) {
  return {
    id: row.id, codigo: row.codigo, nombre: row.nombre, clase: row.clase,
    naturaleza: row.naturaleza, es_resumen: !!row.es_resumen, cierre: row.cierre,
    alias: row.alias, activa: !!row.activa,
    rubro_niif: row.rubro_niif || null,
  }
}

/** Lista completa del plan (orden jerárquico por código). */
function listar(db, empresaId) {
  return db.prepare(`
    SELECT * FROM cuentas WHERE empresa_id = ? ORDER BY codigo
  `).all(empresaId).map(toCuenta)
}

/** Cuenta por id, verificando que pertenece a la empresa (aislamiento). */
function obtener(db, empresaId, cuentaId) {
  const row = db.prepare(`SELECT * FROM cuentas WHERE id = ? AND empresa_id = ?`).get(cuentaId, empresaId)
  return row ? toCuenta(row) : null
}

/** Cuenta por alias de control (IVA_CREDITO, PROVEEDORES, ...). */
function cuentaPorAlias(db, empresaId, alias) {
  const row = db.prepare(`
    SELECT * FROM cuentas WHERE empresa_id = ? AND alias = ? AND activa = 1
  `).get(empresaId, String(alias).toUpperCase())
  return row ? toCuenta(row) : null
}

/** Crea una cuenta imputable o resumen. Valida jerarquía (el padre debe existir). */
function crear(db, { empresaId, usuarioId, codigo, nombre, esResumen = false, alias = null, ip = null }) {
  if (!existeEmpresa(db, empresaId)) throw new Error('Empresa no encontrada')
  validarCodigo(codigo)
  const nombreLimpio = String(nombre || '').trim()
  if (!nombreLimpio) throw new Error('Nombre de cuenta obligatorio')
  const { clase, naturaleza, cierre } = clasificar(codigo)

  // Jerarquía: el padre (código sin el último segmento) debe existir.
  const segmentos = String(codigo).split('.')
  let padre = null
  if (segmentos.length > 1) {
    const codigoPadre = segmentos.slice(0, -1).join('.')
    padre = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = ?`).get(empresaId, codigoPadre)
    if (!padre) throw new Error(`La cuenta padre ${codigoPadre} no existe — créala primero`)
  }

  // Alias único por empresa (índice parcial también lo garantiza; error amable)
  const aliasLimpio = alias ? String(alias).trim().toUpperCase() : null
  if (aliasLimpio) {
    const ocupado = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, aliasLimpio)
    if (ocupado) throw new Error(`El alias ${aliasLimpio} ya está en uso por otra cuenta`)
  }

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza, es_resumen, cierre, alias)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, String(codigo), nombreLimpio, clase, naturaleza, esResumen ? 1 : 0, cierre, aliasLimpio)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'cuenta.crear', entidad: 'cuentas', entidadId: info.lastInsertRowid,
      despues: { codigo, nombre: nombreLimpio, esResumen: !!esResumen, alias: aliasLimpio }, ip,
    })
    return info.lastInsertRowid
  })
  const id = tx()
  return obtener(db, empresaId, id)
}

/** Desactiva una cuenta (nunca DELETE). Rechaza si tiene movimientos o hijos activos. */
function desactivar(db, { empresaId, usuarioId, cuentaId, ip = null }) {
  const cuenta = obtener(db, empresaId, cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')
  const conMovimientos = db.prepare(`
    SELECT 1 FROM asiento_lineas WHERE cuenta_id = ? AND empresa_id = ? LIMIT 1
  `).get(cuentaId, empresaId)
  if (conMovimientos) throw new Error('La cuenta tiene movimientos: no se puede desactivar el historial contable depende de ella')
  const hijos = db.prepare(`
    SELECT codigo FROM cuentas WHERE empresa_id = ? AND activa = 1 AND codigo LIKE ? AND codigo != ?
    LIMIT 1
  `).get(empresaId, `${cuenta.codigo}.%`, cuenta.codigo)
  if (hijos) throw new Error(`La cuenta tiene cuentas hijas activas (ej. ${hijos.codigo})`)

  const tx = db.transaction(() => {
    db.prepare(`UPDATE cuentas SET activa = 0 WHERE id = ?`).run(cuentaId)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'cuenta.desactivar', entidad: 'cuentas', entidadId: cuentaId,
      antes: { activa: true }, despues: { activa: false }, ip,
    })
  })
  tx()
  return { ok: true }
}

/** Lista de cuentas imputables activas — para selects de asientos y reglas. */
function listarImputables(db, empresaId) {
  return db.prepare(`
    SELECT id, codigo, nombre, naturaleza FROM cuentas
    WHERE empresa_id = ? AND activa = 1 AND es_resumen = 0
    ORDER BY codigo
  `).all(empresaId)
}

module.exports = {
  listar, obtener, cuentaPorAlias, crear, desactivar, listarImputables,
  validarCodigo, existeEmpresa, toCuenta,
}
