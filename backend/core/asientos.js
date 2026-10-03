/**
 * Asientos contables — el corazón del software contable (FASE 2).
 *
 * Reglas de dominio (ACCOUNTING_DOMAIN §4), TODAS validadas aquí dentro de la
 * transacción de escritura — las rutas HTTP nunca escriben directo:
 *  1. ≥ 2 líneas; Σ débitos = Σ créditos; total > 0. Montos INTEGER en pesos.
 *  2. Cada línea: cuenta imputable y activa DE LA MISMA empresa; una pata sola
 *     (debe>0 XOR haber>0); centro de costo de la misma empresa si viene.
 *  3. La fecha cae en un período ABIERTO (creación lazy del período al primer uso).
 *  4. Numeración correlativa por empresa y año (folios sin huecos lógicos).
 *  5. Inmutabilidad: no hay editar ni borrar — corrección por REVERSIÓN
 *     referenciada (tipo 'reversion', asiento_revertido_id), fechada HOY.
 *  6. Aislamiento: toda consulta y toda validación incluye empresa_id.
 */

const { registrarAccion } = require('./auditoria')
const { rolEnEmpresa } = require('./empresas')
const periodos = require('./periodos')
const cuentas = require('./cuentas')
const centrosCosto = require('./centros-costo')

const TIPOS = ['manual', 'automatico', 'ajuste', 'reversion', 'cierre', 'apertura', 'externo']

function fechaHoy() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function validarMontoEntero(valor, campo, lineaIdx) {
  const n = Number(valor)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Línea ${lineaIdx}: ${campo} debe ser un entero en pesos (recibido: ${JSON.stringify(valor)})`)
  }
  return n
}

/** Valida y normaliza las líneas: [{cuenta_id|cuenta_codigo, debe, haber, centro_costo_id?, glosa?}] */
function normalizarLineas(db, empresaId, lineas) {
  if (!Array.isArray(lineas) || lineas.length < 2) {
    throw new Error('Un asiento requiere al menos 2 líneas (partida doble)')
  }
  return lineas.map((l, idx) => {
    const i = idx + 1
    const cuenta = l.cuenta_id !== undefined
      ? cuentas.obtener(db, empresaId, Number(l.cuenta_id))
      : (() => {
          const fila = db.prepare(`
            SELECT * FROM cuentas WHERE empresa_id = ? AND codigo = ?
          `).get(empresaId, String(l.cuenta_codigo || ''))
          return fila ? cuentas.toCuenta(fila) : null
        })()
    if (!cuenta) throw new Error(`Línea ${i}: cuenta no encontrada en esta empresa`)
    if (!cuenta.activa) throw new Error(`Línea ${i}: la cuenta ${cuenta.codigo} está desactivada`)
    if (cuenta.es_resumen) {
      throw new Error(`Línea ${i}: la cuenta ${cuenta.codigo} es RESUMEN y no recibe movimientos`)
    }

    const debe = validarMontoEntero(l.debe ?? 0, 'debe', i)
    const haber = validarMontoEntero(l.haber ?? 0, 'haber', i)
    if (debe > 0 && haber > 0) {
      throw new Error(`Línea ${i}: una línea no puede tener débito Y crédito a la vez`)
    }
    if (debe === 0 && haber === 0) {
      throw new Error(`Línea ${i}: la línea está en cero`)
    }

    let cc = null
    if (l.centro_costo_id !== undefined && l.centro_costo_id !== null && l.centro_costo_id !== '') {
      cc = centrosCosto.obtener(db, empresaId, Number(l.centro_costo_id))
      if (!cc) throw new Error(`Línea ${i}: centro de costo no encontrado en esta empresa`)
      if (!cc.activo) throw new Error(`Línea ${i}: el centro de costo ${cc.codigo} está inactivo`)
    }

    return {
      cuenta_id: cuenta.id, debe, haber,
      centro_costo_id: cc ? cc.id : null,
      glosa: l.glosa ? String(l.glosa).slice(0, 300) : null,
    }
  })
}

function obtenerCompleto(db, empresaId, asientoId) {
  const a = db.prepare(`
    SELECT a.*, u.username AS usuario
    FROM asientos a LEFT JOIN users u ON u.id = a.usuario_id
    WHERE a.id = ? AND a.empresa_id = ?
  `).get(asientoId, empresaId)
  if (!a) return null
  const lineas = db.prepare(`
    SELECT al.id, al.cuenta_id, al.debe, al.haber, al.glosa,
           c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, c.naturaleza,
           cc.codigo AS cc_codigo, cc.nombre AS cc_nombre
    FROM asiento_lineas al
    JOIN cuentas c ON c.id = al.cuenta_id
    LEFT JOIN centros_costo cc ON cc.id = al.centro_costo_id
    WHERE al.asiento_id = ?
    ORDER BY al.id
  `).all(asientoId)
  return { ...a, lineas }
}

/**
 * Crea un asiento validado y auditado. Devuelve el asiento completo.
 * @param {object} p lineas: mínimo 2; tipo: manual|ajuste|automatico|...
 */
function crear(db, { empresaId, usuarioId, fecha, glosa, tipo = 'manual', lineas, asientoRevertidoId = null, origen = null, idempotencia = null, ip = null }) {
  const rol = rolEnEmpresa(db, usuarioId, empresaId)
  if (!rol) throw new Error('No tiene acceso a esta empresa')
  if (!TIPOS.includes(tipo)) throw new Error(`Tipo de asiento inválido: ${tipo}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) {
    throw new Error('Fecha inválida (esperado YYYY-MM-DD)')
  }
  const glosaLimpia = String(glosa || '').trim()
  if (!glosaLimpia) throw new Error('La glosa del asiento es obligatoria')

  // Período: autocreación al primer uso + bloqueo si está cerrado
  const periodo = periodos.periodoDesdeFecha(fecha)
  const p = periodos.obtenerOCrear(db, empresaId, periodo)
  if (p.estado !== 'ABIERTO') {
    throw new Error(`El período ${periodo} está CERRADO: no admite modificaciones`)
  }

  const normalizadas = normalizarLineas(db, empresaId, lineas)
  const totalDebe = normalizadas.reduce((s, l) => s + l.debe, 0)
  const totalHaber = normalizadas.reduce((s, l) => s + l.haber, 0)
  if (totalDebe !== totalHaber) {
    throw new Error(`Asiento DESCUADRADO: débitos ${totalDebe} ≠ créditos ${totalHaber}`)
  }
  if (totalDebe === 0) throw new Error('El asiento está en cero')

  const anio = Number(String(fecha).slice(0, 4))
  if (asientoRevertidoId !== null) {
    const existeOrigen = db.prepare(`
      SELECT id FROM asientos WHERE id = ? AND empresa_id = ?
    `).get(asientoRevertidoId, empresaId)
    if (!existeOrigen) throw new Error('Asiento a revertir no encontrado en esta empresa')
  }

  const tx = db.transaction(() => {
    // Folio correlativo SIN huecos: se calcula DENTRO de la transacción
    const { n: folio } = db.prepare(`
      SELECT COALESCE(MAX(folio), 0) + 1 AS n FROM asientos WHERE empresa_id = ? AND anio = ?
    `).get(empresaId, anio)

    // Idempotencia (FASE 9, asientos externos): UNIQUE parcial empresa+clave.
    if (idempotencia !== null) {
      const previo = db.prepare(`
        SELECT id, folio, anio FROM asientos WHERE empresa_id = ? AND idempotencia = ?
      `).get(empresaId, String(idempotencia))
      if (previo) {
        const e = new Error(`Ya existe el asiento ${previo.folio}/${previo.anio} con esa clave de idempotencia`)
        e.status = 422
        e.codigo = 'IDEMPOTENCIA_CONFLICTO'
        throw e
      }
    }

    const info = db.prepare(`
      INSERT INTO asientos (empresa_id, folio, anio, fecha, periodo, tipo, glosa, usuario_id, asiento_revertido_id, origen, idempotencia)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, folio, anio, fecha, periodo, tipo, glosaLimpia, usuarioId, asientoRevertidoId, origen, idempotencia === null ? null : String(idempotencia))
    const asientoId = info.lastInsertRowid

    const insertarLinea = db.prepare(`
      INSERT INTO asiento_lineas (empresa_id, asiento_id, cuenta_id, debe, haber, centro_costo_id, glosa)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    for (const l of normalizadas) {
      insertarLinea.run(empresaId, asientoId, l.cuenta_id, l.debe, l.haber, l.centro_costo_id, l.glosa)
    }

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: tipo === 'reversion' ? 'asiento.revertir' : 'asiento.crear',
      entidad: 'asientos', entidadId: String(asientoId),
      despues: {
        folio, anio, fecha, periodo, tipo,
        glosa: glosaLimpia,
        total: totalDebe,
        lineas: normalizadas.map((l) => ({ cuenta_id: l.cuenta_id, debe: l.debe, haber: l.haber })),
        ...(asientoRevertidoId !== null ? { revierte_a: asientoRevertidoId } : {}),
        ...(origen ? { origen } : {}),
        ...(idempotencia !== null ? { idempotencia: String(idempotencia) } : {}),
      },
      ip,
    })
    return asientoId
  })

  const asientoId = tx()
  return obtenerCompleto(db, empresaId, asientoId)
}

/**
 * Reversión: nuevo asiento con las patas invertidas, referenciando al original.
 * Se fecha HOY (el período original puede estar cerrado; el actual debe estar abierto).
 * Un asiento solo puede revertirse una vez.
 */
function revertir(db, { empresaId, usuarioId, asientoId, glosa = null, ip = null }) {
  const rol = rolEnEmpresa(db, usuarioId, empresaId)
  if (!rol) throw new Error('No tiene acceso a esta empresa')

  const origen = db.prepare(`
    SELECT * FROM asientos WHERE id = ? AND empresa_id = ?
  `).get(asientoId, empresaId)
  if (!origen) throw new Error('Asiento no encontrado en esta empresa')

  const previa = db.prepare(`
    SELECT id, folio, anio FROM asientos WHERE asiento_revertido_id = ?
  `).get(asientoId)
  if (previa) {
    throw new Error(`El asiento ${origen.folio}/${origen.anio} ya fue revertido por el asiento ${previa.folio}/${previa.anio}`)
  }

  const lineasOrigen = db.prepare(`
    SELECT cuenta_id, debe, haber, centro_costo_id, glosa
    FROM asiento_lineas WHERE asiento_id = ? ORDER BY id
  `).all(asientoId)

  return crear(db, {
    empresaId, usuarioId,
    fecha: fechaHoy(),
    glosa: glosa || `Reversión del asiento ${origen.folio}/${origen.anio} — ${origen.glosa}`,
    tipo: 'reversion',
    lineas: lineasOrigen.map((l) => ({
      cuenta_id: l.cuenta_id, debe: l.haber, haber: l.debe,
      centro_costo_id: l.centro_costo_id, glosa: l.glosa,
    })),
    asientoRevertidoId: asientoId,
    ip,
  })
}

/**
 * Libro diario con filtros: periodo, rango de fechas, cuenta, centro de costo,
 * texto en glosa. Paginado por asiento.
 */
function diario(db, { empresaId, periodo = null, desde = null, hasta = null, cuentaId = null, centroCostoId = null, texto = null, limit = 100, offset = 0 }) {
  const where = ['a.empresa_id = ?']
  const params = [empresaId]
  if (periodo) { where.push('a.periodo = ?'); params.push(periodo) }
  if (desde) { where.push('a.fecha >= ?'); params.push(desde) }
  if (hasta) { where.push('a.fecha <= ?'); params.push(hasta) }
  if (cuentaId) {
    where.push('EXISTS (SELECT 1 FROM asiento_lineas al WHERE al.asiento_id = a.id AND al.cuenta_id = ?)')
    params.push(cuentaId)
  }
  if (centroCostoId) {
    where.push('EXISTS (SELECT 1 FROM asiento_lineas al2 WHERE al2.asiento_id = a.id AND al2.centro_costo_id = ?)')
    params.push(centroCostoId)
  }
  if (texto) {
    where.push('(a.glosa LIKE ? OR EXISTS (SELECT 1 FROM asiento_lineas al3 WHERE al3.asiento_id = a.id AND al3.glosa LIKE ?))')
    const patron = `%${texto}%`
    params.push(patron, patron)
  }

  const total = db.prepare(`
    SELECT COUNT(*) AS n FROM asientos a WHERE ${where.join(' AND ')}
  `).get(...params).n

  const asientos = db.prepare(`
    SELECT a.id, a.folio, a.anio, a.fecha, a.periodo, a.tipo, a.glosa, a.asiento_revertido_id,
           a.creado_en, u.username AS usuario
    FROM asientos a LEFT JOIN users u ON u.id = a.usuario_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.fecha DESC, a.folio DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  const conLineas = asientos.map((a) => obtenerCompleto(db, empresaId, a.id))
  return { total, asientos: conLineas }
}

/**
 * Libro mayor de una cuenta: agregados + movimientos con saldo corrido.
 * El saldo respeta la NATURALEZA: deudora → Σdebe − Σhaber; acreedora → Σhaber − Σdebe.
 * Filtro opcional por contraparte (`rutContraparte`): solo asientos vinculados a
 * esa cliente/proveedor — vía el documento contabilizado (documentos.asiento_id)
 * o vía el pago/cobro de tesorería aplicado a ese documento.
 */
function mayor(db, { empresaId, cuentaId, desde = null, hasta = null, rutContraparte = null }) {
  const cuenta = cuentas.obtener(db, empresaId, cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada en esta empresa')

  const whereFecha = []
  const paramsFecha = [cuentaId, empresaId]
  if (desde) { whereFecha.push('a.fecha >= ?'); paramsFecha.push(desde) }
  if (hasta) { whereFecha.push('a.fecha <= ?'); paramsFecha.push(hasta) }
  let filtroFecha = whereFecha.length ? `AND ${whereFecha.join(' AND ')}` : ''
  if (rutContraparte) {
    // Los RUT en BD llegan con el formato del SII (con puntos): se compara normalizado.
    const rutNorm = String(rutContraparte).replace(/[.\-\s]/g, '').toUpperCase()
    filtroFecha += ` AND (
      a.id IN (SELECT d.asiento_id FROM documentos d WHERE d.empresa_id = a.empresa_id AND d.asiento_id IS NOT NULL
               AND REPLACE(REPLACE(REPLACE(d.rut_contraparte, '.', ''), '-', ''), ' ', '') = ?)
      OR a.id IN (SELECT m.asiento_id FROM teso_movimientos m JOIN documentos d2 ON d2.id = m.documento_id
               WHERE REPLACE(REPLACE(REPLACE(d2.rut_contraparte, '.', ''), '-', ''), ' ', '') = ?)
    )`
    paramsFecha.push(rutNorm, rutNorm)
  }

  const agg = db.prepare(`
    SELECT COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber, COUNT(*) AS movimientos
    FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
    WHERE al.cuenta_id = ? AND a.empresa_id = ? ${filtroFecha}
  `).get(...paramsFecha)

  const movimientos = db.prepare(`
    SELECT al.id, a.fecha, a.folio, a.anio, a.periodo, a.tipo, a.glosa AS asiento_glosa,
           al.debe, al.haber, al.glosa AS linea_glosa,
           cc.codigo AS cc_codigo, cc.nombre AS cc_nombre,
           a.asiento_revertido_id
    FROM asiento_lineas al
    JOIN asientos a ON a.id = al.asiento_id
    LEFT JOIN centros_costo cc ON cc.id = al.centro_costo_id
    WHERE al.cuenta_id = ? AND a.empresa_id = ? ${filtroFecha}
    ORDER BY a.fecha, a.folio, al.id
  `).all(...paramsFecha)

  let saldoCorrido = 0
  const esDeudora = cuenta.naturaleza === 'deudora'
  const detalle = movimientos.map((m) => {
    saldoCorrido += esDeudora ? (m.debe - m.haber) : (m.haber - m.debe)
    return { ...m, saldo: saldoCorrido }
  })

  const saldo = esDeudora ? agg.debe - agg.haber : agg.haber - agg.debe
  return {
    cuenta,
    debe: agg.debe, haber: agg.haber, saldo,
    movimientos: detalle,
  }
}

module.exports = { TIPOS, crear, revertir, obtenerCompleto, diario, mayor, fechaHoy, normalizarLineas }
