/**
 * Activos fijos (FASE 7) — nada fuera de los libros.
 *
 *  - Registro: cada activo apunta a UNA cuenta imputable del plan (típicamente
 *    1.2.x PP&E) + la cuenta de depreciación acumulada (contra del activo) y la
 *    de gasto por depreciación. El alta contable es OPCIONAL (activo
 *    preexistente que ya está en los libros por apertura): si se pide, es un
 *    asiento tipo 'apertura' fechado el día de adquisición.
 *  - Depreciación mensual por LÍNEA RECTA: cuota = (valor − residual) / vida.
 *    `prepararDepreciacion` NO muta: propone UN asiento del período con una
 *    línea por activo (gasto al debe, depreciación acumulada al haber). La
 *    confirmación es SIEMPRE humana (`confirmarDepreciacion` crea el asiento
 *    del núcleo FASE 2 con todas sus validaciones) y cada fila queda en
 *    `activos_depreciaciones` con UNIQUE(activo, período): jamás se deprecia
 *    dos veces el mismo mes. Si la corrida llega al fin de la vida útil
 *    (o un período atrasado absorbe lo pendiente), la última cuota cierra el
 *    depreciable EXACTO (sin residuos por redondeo).
 *  - Venta/baja: UN asiento que limpia costo y depreciación acumulada y lleva
 *    la diferencia a utilidad (venta sobre valor libro) o pérdida (venta bajo
 *    valor libro o baja directa), por ALIAS de control con override opcional.
 *    El activo pasa a VENDIDO/BAJA y deja de depreciarse.
 *
 * Módulo puro: recibe la BD como parámetro (testeable, usable en transacciones).
 */

const { registrarAccion } = require('./auditoria')
const cuentas = require('./cuentas')
const periodos = require('./periodos')

const ESTADOS = ['ACTIVO', 'VENDIDO', 'BAJA']

/** Último día REAL del mes (31, 30, 28/29) — fecha del asiento de depreciación. */
function ultimoDiaDe(periodo) {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(4, 6))
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 'AAAAMM'. */
function periodoDeFecha(fecha) {
  return String(fecha).slice(0, 7).replace('-', '')
}

/** Meses transcurridos ENTRE dos períodos AAAAMM (b − a), inclusive base 0. */
function mesesEntre(a, b) {
  const ya = Number(a.slice(0, 4)) * 12 + Number(a.slice(4, 6))
  const yb = Number(b.slice(0, 4)) * 12 + Number(b.slice(4, 6))
  return yb - ya
}

/** Cuota mensual base por línea recta. */
function cuotaBaseDe(activo) {
  const depreciable = activo.valor_adquisicion - activo.valor_residual
  return Math.round(depreciable / activo.vida_util_meses)
}

/** Depreciación acumulada registrada de un activo (INTEGER). */
function depAcumulada(db, activoId) {
  const row = db.prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM activos_depreciaciones WHERE activo_id = ?`).get(activoId)
  return Number(row.t) || 0
}

/**
 * Cuota a registrar para UN activo EN un período (null si no corresponde).
 * Regla: mes de adquisición cuenta completo; la cuota cierra el depreciable
 * exacto cuando corresponde al fin de la vida útil o cuando lo pendiente es
 * menor que la cuota base (activo atrasado absorbe lo restante).
 */
function cuotaDelPeriodo(db, activo, periodo) {
  if (activo.estado !== 'ACTIVO') return { cuota: 0, motivo: `activo ${activo.estado.toLowerCase()}` }
  const periodoAdquisicion = periodoDeFecha(activo.fecha_adquisicion)
  if (mesesEntre(periodoAdquisicion, periodo) < 0) return { cuota: 0, motivo: 'aún no adquirido en el período' }
  const transcurridos = mesesEntre(periodoAdquisicion, periodo) + 1
  const acumulada = depAcumulada(db, activo.id)
  const yaRegistrado = db.prepare(`SELECT 1 FROM activos_depreciaciones WHERE activo_id = ? AND periodo = ?`).get(activo.id, periodo)
  if (yaRegistrado) return { cuota: 0, motivo: 'ya depreciado en este período' }
  const depreciable = activo.valor_adquisicion - activo.valor_residual
  const restante = depreciable - acumulada
  if (restante <= 0) return { cuota: 0, motivo: 'totalmente depreciado' }
  const base = cuotaBaseDe(activo)
  const esUltima = transcurridos >= activo.vida_util_meses
  const cuota = esUltima ? restante : Math.min(base, restante)
  return { cuota, motivo: transcurridos > activo.vida_util_meses ? `atrasado: absorbe lo pendiente (${restante})` : null }
}

// ============================================================
// VALIDACIONES DE CREACIÓN
// ============================================================

function validarCuenta(db, empresaId, id, { clase = null, nombre = 'cuenta' }) {
  const c = cuentas.obtener(db, empresaId, Number(id))
  if (!c) throw new Error(`La ${nombre} no existe en esta empresa`)
  if (!c.activa) throw new Error(`La ${nombre} (${c.codigo}) está desactivada`)
  if (c.es_resumen) throw new Error(`La ${nombre} (${c.codigo}) es RESUMEN y no recibe movimientos`)
  if (clase && c.clase !== clase) throw new Error(`La ${nombre} (${c.codigo}) debe ser de clase ${clase}`)
  return c
}

function resolverCuentasDepreciacion(db, empresaId, { cuentaDepId = null, cuentaGastoId = null }) {
  const dep = cuentaDepId
    ? validarCuenta(db, empresaId, cuentaDepId, { clase: 1, nombre: 'cuenta de depreciación acumulada' })
    : (() => {
        const c = cuentas.cuentaPorAlias(db, empresaId, 'DEPRECIACION_ACUMULADA')
        if (!c) throw new Error('Falta la cuenta con alias DEPRECIACION_ACUMULADA (o indícala explícitamente)')
        return c
      })()
  const gasto = cuentaGastoId
    ? validarCuenta(db, empresaId, cuentaGastoId, { nombre: 'cuenta de gasto por depreciación' })
    : (() => {
        const c = cuentas.cuentaPorAlias(db, empresaId, 'GASTO_DEPRECIACION')
        if (!c) throw new Error('Falta la cuenta con alias GASTO_DEPRECIACION (o indícala explícitamente)')
        return c
      })()
  if (![5, 6].includes(gasto.clase)) throw new Error(`La cuenta de gasto por depreciación (${gasto.codigo}) debe ser de clase 5 o 6`)
  return { dep, gasto }
}

// ============================================================
// REGISTRO
// ============================================================

/**
 * Registra un activo fijo. Con `contabilizarAlta: true` + `cuentaContraId`
 * genera además el asiento de alta (activo al debe, contraparte al haber)
 * fechado el día de adquisición — para activos que aún NO están en los libros.
 */
function crear(db, {
  empresaId, usuarioId, codigo, descripcion, cuentaActivoId,
  fechaAdquisicion, valorAdquisicion, vidaUtilMeses, valorResidual = 0,
  cuentaDepId = null, cuentaGastoId = null,
  contabilizarAlta = false, cuentaContraId = null, ip = null,
}) {
  const codigoLimpio = String(codigo || '').trim()
  const descripcionLimpia = String(descripcion || '').trim()
  if (!codigoLimpio) throw new Error('El código del activo es obligatorio')
  if (!descripcionLimpia) throw new Error('La descripción del activo es obligatoria')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaAdquisicion || ''))) throw new Error('Fecha de adquisición inválida (esperado YYYY-MM-DD)')
  const valor = Math.round(Number(valorAdquisicion))
  const residual = Math.round(Number(valorResidual) || 0)
  const vida = Math.round(Number(vidaUtilMeses))
  if (!Number.isInteger(valor) || valor <= 0) throw new Error('El valor de adquisición debe ser un entero en pesos mayor que cero')
  if (!Number.isInteger(residual) || residual < 0) throw new Error('El valor residual debe ser un entero en pesos ≥ 0')
  if (residual >= valor) throw new Error('El valor residual debe ser menor que el valor de adquisición')
  if (!Number.isInteger(vida) || vida < 1) throw new Error('La vida útil debe ser de al menos 1 mes')
  if (db.prepare(`SELECT 1 FROM activos_fijos WHERE empresa_id = ? AND codigo = ?`).get(empresaId, codigoLimpio)) {
    throw new Error(`Ya existe un activo con el código ${codigoLimpio} en esta empresa`)
  }
  const ctaActivo = validarCuenta(db, empresaId, cuentaActivoId, { clase: 1, nombre: 'cuenta del activo' })
  const { dep, gasto } = resolverCuentasDepreciacion(db, empresaId, { cuentaDepId, cuentaGastoId })

  let alta = null
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO activos_fijos (empresa_id, codigo, descripcion, cuenta_activo_id, fecha_adquisicion,
                                 valor_adquisicion, vida_util_meses, valor_residual, cuenta_dep_id, cuenta_gasto_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, codigoLimpio, descripcionLimpia, ctaActivo.id, fechaAdquisicion, valor, vida, residual, dep.id, gasto.id)
    const activoId = info.lastInsertRowid

    if (contabilizarAlta) {
      const contra = validarCuenta(db, empresaId, cuentaContraId, { nombre: 'cuenta contraparte del alta' })
      const asiento = require('./asientos').crear(db, {
        empresaId, usuarioId,
        fecha: fechaAdquisicion,
        glosa: `Alta de activo fijo ${codigoLimpio} — ${descripcionLimpia}`,
        tipo: 'apertura',
        origen: `activo-alta:${activoId}`,
        lineas: [
          { cuenta_id: ctaActivo.id, debe: valor, haber: 0, glosa: `Alta ${codigoLimpio} ${descripcionLimpia}` },
          { cuenta_id: contra.id, debe: 0, haber: valor, glosa: `Contrapartida del alta ${codigoLimpio}` },
        ],
        ip,
      })
      db.prepare(`UPDATE activos_fijos SET asiento_alta_id = ? WHERE id = ?`).run(asiento.id, activoId)
      alta = { asiento_id: asiento.id, folio: asiento.folio, anio: asiento.anio, total: valor }
    }

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'activos.crear', entidad: 'activos_fijos', entidadId: String(activoId),
      despues: {
        codigo: codigoLimpio, descripcion: descripcionLimpia,
        cuenta_activo_id: ctaActivo.id, fecha_adquisicion: fechaAdquisicion,
        valor_adquisicion: valor, vida_util_meses: vida, valor_residual: residual,
        contabilizado_alta: !!alta,
      },
      ip,
    })
    return activoId
  })
  const activoId = tx()
  return { id: activoId, alta }
}

/** Fila decorada con cuentas, depreciación acumulada y valor libro. */
function decorar(db, a) {
  const acumulada = depAcumulada(db, a.id)
  const cuenta = (id) => {
    if (!id) return null
    const c = db.prepare(`SELECT codigo, nombre FROM cuentas WHERE id = ?`).get(id)
    return c ? `${c.codigo} ${c.nombre}` : null
  }
  return {
    ...a,
    cuenta_activo: cuenta(a.cuenta_activo_id),
    cuenta_dep: cuenta(a.cuenta_dep_id),
    cuenta_gasto: cuenta(a.cuenta_gasto_id),
    depreciacion_acumulada: acumulada,
    valor_libro: a.valor_adquisicion - acumulada,
    cuota_base: a.estado === 'ACTIVO' ? cuotaBaseDe(a) : 0,
  }
}

function listar(db, empresaId, { estado = null } = {}) {
  const where = ['empresa_id = ?']
  const params = [empresaId]
  if (estado) { where.push('estado = ?'); params.push(String(estado)) }
  const filas = db.prepare(`
    SELECT * FROM activos_fijos WHERE ${where.join(' AND ')} ORDER BY codigo
  `).all(...params).map((a) => decorar(db, a))
  return {
    activos: filas,
    totales: {
      activos: filas.filter((f) => f.estado === 'ACTIVO').length,
      valor_adquisicion: filas.filter((f) => f.estado === 'ACTIVO').reduce((s, f) => s + f.valor_adquisicion, 0),
      depreciacion_acumulada: filas.reduce((s, f) => s + f.depreciacion_acumulada, 0),
      valor_libro: filas.reduce((s, f) => s + f.valor_libro, 0),
    },
  }
}

function obtener(db, empresaId, activoId) {
  const a = db.prepare(`SELECT * FROM activos_fijos WHERE id = ? AND empresa_id = ?`).get(activoId, empresaId)
  return a ? decorar(db, a) : null
}

/**
 * Plan de depreciación simulado de un activo: cuota por mes desde la
 * adquisición, marcando qué períodos ya quedaron registrados.
 */
function planDepreciacion(db, empresaId, activoId) {
  const activo = obtener(db, empresaId, activoId)
  if (!activo) throw new Error('Activo no encontrado en esta empresa')
  const registrados = new Map(
    db.prepare(`SELECT periodo, monto, asiento_id FROM activos_depreciaciones WHERE activo_id = ? ORDER BY periodo`).all(activoId)
      .map((r) => [r.periodo, r])
  )
  const inicio = periodoDeFecha(activo.fecha_adquisicion)
  const depreciable = activo.valor_adquisicion - activo.valor_residual
  const base = cuotaBaseDe(activo)
  const meses = []
  let acumulada = 0
  for (let i = 0; i < activo.vida_util_meses; i++) {
    const y = Number(inicio.slice(0, 4))
    const m = Number(inicio.slice(4, 6)) + i
    const periodo = `${y + Math.floor((m - 1) / 12)}${String(((m - 1) % 12) + 1).padStart(2, '0')}`
    const restante = depreciable - acumulada
    const cuota = i === activo.vida_util_meses - 1 ? restante : Math.min(base, restante)
    const reg = registrados.get(periodo) || null
    meses.push({ periodo, cuota, registrado: !!reg, monto_registrado: reg ? reg.monto : null, asiento_id: reg ? reg.asiento_id : null })
    if (reg) acumulada += reg.monto
    else acumulada += cuota
  }
  return { activo, depreciable, cuota_base: base, meses }
}

// ============================================================
// DEPRECIACIÓN MENSUAL DEL PERÍODO (propuesta → confirmación humana)
// ============================================================

/**
 * Calcula la depreciación del período SIN mutar nada: devuelve la propuesta
 * de asiento (una línea por activo en cada pata), los omitidos con motivo y
 * el estado del período. Si el período está CERRADO no hay propuesta posible.
 */
function prepararDepreciacion(db, empresaId, periodo) {
  if (!periodos.validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const p = db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`).get(empresaId, periodo)
  const periodoCerrado = !!p && p.estado === 'CERRADO'

  const activos = db.prepare(`SELECT * FROM activos_fijos WHERE empresa_id = ? AND estado = 'ACTIVO' ORDER BY codigo`).all(empresaId)
  const items = []
  const omitidos = []
  for (const a of activos) {
    const { cuota, motivo } = cuotaDelPeriodo(db, a, periodo)
    if (cuota <= 0) { omitidos.push({ activo_id: a.id, codigo: a.codigo, descripcion: a.descripcion, motivo }); continue }
    items.push({
      activo_id: a.id, codigo: a.codigo, descripcion: a.descripcion,
      cuenta_gasto_id: a.cuenta_gasto_id, cuenta_dep_id: a.cuenta_dep_id,
      cuota, motivo,
    })
  }

  const lineas = []
  for (const it of items) {
    lineas.push({ cuenta_id: it.cuenta_gasto_id, debe: it.cuota, haber: 0, glosa: `Depreciación ${it.codigo} ${it.descripcion}` })
    lineas.push({ cuenta_id: it.cuenta_dep_id, debe: 0, haber: it.cuota, glosa: `Depreciación acumulada ${it.codigo}` })
  }
  const total = items.reduce((s, it) => s + it.cuota, 0)

  return {
    periodo,
    fecha_asiento: ultimoDiaDe(periodo),
    periodo_cerrado: periodoCerrado,
    items, omitidos,
    lineas,
    total,
    puede_confirmar: !periodoCerrado && items.length > 0,
  }
}

/**
 * Confirma la depreciación del período: UN asiento del núcleo (tipo
 * 'automatico', fechado el último día del período) + una fila por activo en
 * `activos_depreciaciones` (UNIQUE activo+período como defensa final) — todo
 * en UNA transacción y auditado. Re-confirmar el mismo período lanza.
 */
function confirmarDepreciacion(db, { empresaId, usuarioId, periodo, ip = null }) {
  if (!periodos.validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const previa = db.prepare(`
    SELECT asiento_id FROM activos_depreciaciones WHERE empresa_id = ? AND periodo = ? LIMIT 1
  `).get(empresaId, periodo)
  if (previa) throw new Error(`El período ${periodo} ya tiene depreciación registrada (asiento ${previa.asiento_id})`)

  let resultado = null
  const tx = db.transaction(() => {
    const prep = prepararDepreciacion(db, empresaId, periodo)
    if (prep.periodo_cerrado) throw new Error(`El período ${periodo} está CERRADO: no admite modificaciones`)
    if (!prep.items.length) throw new Error(`No hay activos para depreciar en el período ${periodo}`)

    const asiento = require('./asientos').crear(db, {
      empresaId, usuarioId,
      fecha: prep.fecha_asiento,
      glosa: `Depreciación mensual del período ${periodo} (${prep.items.length} activo(s))`,
      tipo: 'automatico',
      origen: `depreciacion:${periodo}`,
      lineas: prep.lineas,
      ip,
    })
    const insertar = db.prepare(`
      INSERT INTO activos_depreciaciones (empresa_id, activo_id, periodo, monto, asiento_id)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const it of prep.items) insertar.run(empresaId, it.activo_id, periodo, it.cuota, asiento.id)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'activos.depreciar', entidad: 'activos_depreciaciones', entidadId: periodo,
      despues: {
        periodo, asiento_id: asiento.id, folio: asiento.folio, total: prep.total,
        activos: prep.items.map((it) => ({ activo_id: it.activo_id, codigo: it.codigo, monto: it.cuota })),
      },
      ip,
    })
    resultado = { asiento_id: asiento.id, folio: asiento.folio, anio: asiento.anio, total: prep.total, items: prep.items }
  })
  tx()
  return resultado
}

// ============================================================
// VENTA / BAJA
// ============================================================

function cuentaResultadoPorAlias(db, empresaId, alias) {
  const c = cuentas.cuentaPorAlias(db, empresaId, alias)
  if (!c) throw new Error(`Falta la cuenta con alias ${alias} (o indícala explícitamente)`)
  return c
}

/**
 * Registra la VENTA (con precio) o la BAJA (sin contraprestación) de un activo:
 * UN asiento que deja el costo y su depreciación acumulada en cero y lleva la
 * diferencia a utilidad o pérdida. El activo queda VENDIDO/BAJA y deja de
 * depreciarse. Auditado.
 */
function registrarVentaBaja(db, {
  empresaId, usuarioId, activoId, tipo, fecha,
  precioVenta = 0, cuentaDestinoId = null, cuentaResultadoId = null, glosa = null, ip = null,
}) {
  const tipoLimpio = String(tipo || '').toUpperCase()
  if (!['VENTA', 'BAJA'].includes(tipoLimpio)) throw new Error(`Tipo inválido: ${tipo} (esperado VENTA o BAJA)`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw new Error('Fecha inválida (esperado YYYY-MM-DD)')

  const a = db.prepare(`SELECT * FROM activos_fijos WHERE id = ? AND empresa_id = ?`).get(activoId, empresaId)
  if (!a) throw new Error('Activo no encontrado en esta empresa')
  if (a.estado !== 'ACTIVO') throw new Error(`El activo ${a.codigo} ya está ${a.estado.toLowerCase()}`)
  if (String(fecha) < String(a.fecha_adquisicion)) throw new Error('La fecha de venta/baja no puede ser anterior a la adquisición')

  const acumulada = depAcumulada(db, activoId)
  const valorLibro = a.valor_adquisicion - acumulada
  const precio = Math.round(Number(precioVenta) || 0)

  const lineas = []
  let resultado = null
  if (tipoLimpio === 'VENTA') {
    if (!Number.isInteger(precio) || precio <= 0) throw new Error('El precio de venta debe ser un entero en pesos mayor que cero')
    const destino = validarCuenta(db, empresaId, cuentaDestinoId, { nombre: 'cuenta destino del ingreso (banco, cliente...)' })
    lineas.push({ cuenta_id: destino.id, debe: precio, haber: 0, glosa: `Venta activo ${a.codigo}` })
    const diferencia = precio + acumulada - a.valor_adquisicion // utilidad > 0, pérdida < 0
    if (diferencia > 0) {
      resultado = cuentaResultadoId
        ? validarCuenta(db, empresaId, cuentaResultadoId, { nombre: 'cuenta de utilidad en venta' })
        : cuentaResultadoPorAlias(db, empresaId, 'UTILIDAD_VENTA_ACTIVO')
      lineas.push({ cuenta_id: resultado.id, debe: 0, haber: diferencia, glosa: `Utilidad en venta ${a.codigo}` })
    } else if (diferencia < 0) {
      resultado = cuentaResultadoId
        ? validarCuenta(db, empresaId, cuentaResultadoId, { nombre: 'cuenta de pérdida en venta' })
        : cuentaResultadoPorAlias(db, empresaId, 'PERDIDA_BAJA_ACTIVO')
      lineas.push({ cuenta_id: resultado.id, debe: -diferencia, haber: 0, glosa: `Pérdida en venta ${a.codigo}` })
    }
  } else if (precio !== 0) {
    throw new Error('Una BAJA no lleva precio de venta (usa VENTA si hubo contraprestación)')
  }
  if (acumulada > 0) lineas.push({ cuenta_id: a.cuenta_dep_id, debe: acumulada, haber: 0, glosa: `Depreciación acumulada ${a.codigo}` })
  lineas.push({ cuenta_id: a.cuenta_activo_id, debe: 0, haber: a.valor_adquisicion, glosa: `Baja del costo ${a.codigo}` })
  if (tipoLimpio === 'BAJA' && valorLibro > 0) {
    resultado = cuentaResultadoId
      ? validarCuenta(db, empresaId, cuentaResultadoId, { nombre: 'cuenta de pérdida por baja' })
      : cuentaResultadoPorAlias(db, empresaId, 'PERDIDA_BAJA_ACTIVO')
    lineas.push({ cuenta_id: resultado.id, debe: valorLibro, haber: 0, glosa: `Pérdida por baja ${a.codigo} (valor libro)` })
  }

  const d = lineas.reduce((s, l) => s + l.debe, 0)
  const h = lineas.reduce((s, l) => s + l.haber, 0)
  if (lineas.length < 2 || d !== h) throw new Error(`Asiento de ${tipoLimpio.toLowerCase()} descuadrado (debe ${d} ≠ haber ${h})`)

  const glosaAsiento = String(glosa || '').trim() || `${tipoLimpio === 'VENTA' ? 'Venta' : 'Baja'} de activo fijo ${a.codigo} — ${a.descripcion}`
  const estadoFinal = tipoLimpio === 'VENTA' ? 'VENDIDO' : 'BAJA'
  let resultadoTx = null
  const tx = db.transaction(() => {
    const asiento = require('./asientos').crear(db, {
      empresaId, usuarioId, fecha, glosa: glosaAsiento,
      tipo: 'automatico', origen: `activo-baja:${activoId}`,
      lineas, ip,
    })
    db.prepare(`
      UPDATE activos_fijos SET estado = ?, fecha_baja = ?, precio_venta = ?, cuenta_destino_id = ?, asiento_baja_id = ?
      WHERE id = ?
    `).run(estadoFinal, fecha, tipoLimpio === 'VENTA' ? precio : null, tipoLimpio === 'VENTA' ? cuentaDestinoId : null, asiento.id, activoId)

    // Aviso (no bloquea): si el mes de la venta/baja aún no tiene depreciación
    // y quedaba cuota, el contador decide si corresponde depreciar antes.
    const { cuota } = cuotaDelPeriodo(db, { ...a, estado: 'ACTIVO' }, periodoDeFecha(fecha))
    const aviso = cuota > 0
      ? `El activo tenía ${cuota} de depreciación pendiente del período ${periodoDeFecha(fecha)}: no se depreció automáticamente`
      : null

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: `activos.${tipoLimpio.toLowerCase()}`, entidad: 'activos_fijos', entidadId: String(activoId),
      antes: { estado: 'ACTIVO', valor_libro: valorLibro, depreciacion_acumulada: acumulada },
      despues: {
        estado: estadoFinal, fecha_baja: fecha, precio_venta: tipoLimpio === 'VENTA' ? precio : null,
        asiento_id: asiento.id, folio: asiento.folio,
        utilidad_perdida: resultado ? (tipoLimpio === 'VENTA' ? precio + acumulada - a.valor_adquisicion : valorLibro) : 0,
        aviso,
      },
      ip,
    })
    resultadoTx = { asiento_id: asiento.id, folio: asiento.folio, anio: asiento.anio, total: d, valor_libro: valorLibro, utilidad_perdida: resultado ? (tipoLimpio === 'VENTA' ? precio + acumulada - a.valor_adquisicion : valorLibro) : 0, aviso }
  })
  tx()
  return resultadoTx
}

/** Depreciaciones registradas de la empresa (histórico del módulo). */
function depreciaciones(db, empresaId, { limit = 200 } = {}) {
  return db.prepare(`
    SELECT ad.id, ad.periodo, ad.monto, ad.asiento_id, a.folio, a.anio,
           af.codigo, af.descripcion, af.estado
    FROM activos_depreciaciones ad
    JOIN activos_fijos af ON af.id = ad.activo_id
    LEFT JOIN asientos a ON a.id = ad.asiento_id
    WHERE ad.empresa_id = ?
    ORDER BY ad.periodo DESC, af.codigo
    LIMIT ?
  `).all(empresaId, Math.min(Number(limit) || 200, 1000))
}

/** Resumen para KPIs del módulo (nunca muta). */
function resumen(db, empresaId) {
  const { totales } = listar(db, empresaId)
  const periodoActual = new Date().toISOString().slice(0, 7).replace('-', '')
  const delMes = db.prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM activos_depreciaciones WHERE empresa_id = ? AND periodo = ?`).get(empresaId, periodoActual)
  const activos = db.prepare(`SELECT * FROM activos_fijos WHERE empresa_id = ? AND estado = 'ACTIVO'`).all(empresaId)
  const cuotaMensual = activos.reduce((s, a) => {
    const { cuota } = cuotaDelPeriodo(db, a, periodoActual)
    return s + cuota
  }, 0)
  return {
    ...totales,
    depreciacion_periodo_actual: Number(delMes.t) || 0,
    cuota_mensual_proyectada: cuotaMensual,
    periodo_actual: periodoActual,
  }
}

module.exports = {
  ESTADOS,
  crear, listar, obtener, planDepreciacion,
  prepararDepreciacion, confirmarDepreciacion,
  registrarVentaBaja, depreciaciones, resumen,
  cuotaDelPeriodo, cuotaBaseDe, depAcumulada,
}
