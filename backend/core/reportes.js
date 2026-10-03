/**
 * Reportes financieros y cierre de período (FASE 5) — ACCOUNTING_DOMAIN §8 y §7.
 *
 * TODO derivado de `asiento_lineas` + plan de cuentas: NINGÚN monto digitado.
 *  - Balance de comprobación y sumas: por cuenta, débitos/créditos/saldo con
 *    ΣD = ΣC verificado. Del período O acumulado hasta el último día del mes.
 *  - Estado de situación financiera: activos (clase 1), pasivos (2) y
 *    patrimonio (3) + resultado del período (clases 4/5/6 por naturaleza,
 *    SIN asiento de cierre, para que la ecuación A = P + Pat cuadre siempre).
 *  - Estado de resultados: ingresos (4) − costos (5) − gastos (6), con detalle
 *    por cuenta, del mes y acumulado del año.
 *  - Cierre de período (§7): precondiciones visibles (período abierto, docs sin
 *    contabilizar, conciliación ejecutada), asientos de cierre PROPUESTOS por
 *    ALIAS de control — nunca código rígido (§3.5): IVA determinado →
 *    F29_POR_PAGAR, PPM devengado (tasa de la empresa, §10) → GASTO_PPM/
 *    PPM_POR_PAGAR, resultado del período → RESULTADO_EJERCICIO. La
 *    confirmación es SIEMPRE humana: nada se contabiliza sin ejecutarCierre.
 *  - Los asientos de cierre se crean vía asientos.crear (núcleo FASE 2 con
 *    TODAS sus validaciones, tipo 'cierre'), el período queda CERRADO con un
 *    snapshot JSON del cierre persistido, y todo queda auditado.
 *
 * Módulo puro: recibe la BD como parámetro.
 */

const { registrarAccion } = require('./auditoria')
const asientos = require('./asientos')
const cuentas = require('./cuentas')
const periodos = require('./periodos')
const conciliacion = require('./conciliacion')

/** Último día REAL del mes (31, 30, 28/29 según corresponda). */
function ultimoDiaDe(periodo) {
  const anio = Number(periodo.slice(0, 4))
  const mes = Number(periodo.slice(4, 6))
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10)
}

/** Valida el formato AAAAMM y lanza si no cumple (los reportes lo exigen). */
function exigirPeriodoValido(periodo) {
  const p = String(periodo || '')
  if (!periodos.validarFormato(p)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  return p
}

/** Agregado por cuenta de las líneas de asientos, con filtro de fecha/período. */
function agregadoPorCuenta(db, empresaId, { hasta = null, periodo = null } = {}) {
  const where = ['a.empresa_id = ?']
  const params = [empresaId]
  if (hasta) { where.push('a.fecha <= ?'); params.push(hasta) }
  if (periodo) { where.push('a.periodo = ?'); params.push(periodo) }

  return db.prepare(`
    SELECT al.cuenta_id, COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber,
           COUNT(*) AS movimientos
    FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
    WHERE ${where.join(' AND ')}
    GROUP BY al.cuenta_id
  `).all(...params)
}

/** Filas de cuentas (imputables con movimiento) decoradas con el plan. */
function filasPlan(db, empresaId, agregado) {
  const plan = new Map(cuentas.listar(db, empresaId).map((c) => [Number(c.id), c]))
  const filas = []
  for (const a of agregado) {
    const c = plan.get(Number(a.cuenta_id))
    if (!c || c.es_resumen) continue
    filas.push({
      cuenta_id: c.id, codigo: c.codigo, nombre: c.nombre, clase: c.clase,
      naturaleza: c.naturaleza, cierre: c.cierre, alias: c.alias || null, rubro_niif: c.rubro_niif || null,
      debe: Number(a.debe) || 0, haber: Number(a.haber) || 0, movimientos: a.movimientos,
      saldo: c.naturaleza === 'deudora'
        ? (Number(a.debe) || 0) - (Number(a.haber) || 0)
        : (Number(a.haber) || 0) - (Number(a.debe) || 0),
    })
  }
  filas.sort((x, y) => String(x.codigo).localeCompare(String(y.codigo)))
  return filas
}

/**
 * Balance de comprobación y sumas (§8): acumulado hasta el período y
 * movimientos del mes, ambos con ΣD = ΣC verificado.
 */
function balanceComprobacion(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)
  const hasta = ultimoDiaDe(periodo)
  const acumuladas = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta }))
  const delMes = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { periodo }))

  const sumas = (filas) => filas.reduce(
    (s, f) => ({ debe: s.debe + f.debe, haber: s.haber + f.haber }),
    { debe: 0, haber: 0 }
  )
  const construir = (filas) => {
    const s = sumas(filas)
    return { filas, ...s, cuadra: s.debe === s.haber }
  }

  return { periodo, acumulado: construir(acumuladas), periodo_mes: construir(delMes) }
}

/** Resultado (ingresos − costos − gastos) desde filas ya agregadas. */
function resultadoDesdeFilas(filas) {
  const ingresos = filas.filter((f) => f.clase === 4).reduce((s, f) => s + f.saldo, 0)
  const costos = filas.filter((f) => f.clase === 5).reduce((s, f) => s + f.saldo, 0)
  const gastos = filas.filter((f) => f.clase === 6).reduce((s, f) => s + f.saldo, 0)
  return { ingresos, costos, gastos, resultado: ingresos - costos - gastos }
}

/**
 * Estado de situación financiera (§8): activos, pasivos, patrimonio y la
 * ecuación A = P + Patrimonio verificada. El patrimonio incluye el resultado
 * del ejercicio calculado desde clases 4/5/6 acumuladas (sin asiento de
 * cierre): así cuadra antes de generar los asientos de cierre también.
 */
function situacionFinanciera(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)
  const filas = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) }))

  const porClase = (clase) => filas
    .filter((f) => f.clase === clase && f.saldo !== 0)
    .map((f) => ({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo }))

  const activos = porClase(1)
  const pasivos = porClase(2)
  const patrimonioCuentas = porClase(3)
  const resultados = resultadoDesdeFilas(filas)

  const totalActivos = activos.reduce((s, f) => s + f.saldo, 0)
  const totalPasivos = pasivos.reduce((s, f) => s + f.saldo, 0)
  const totalPatrimonioCuentas = patrimonioCuentas.reduce((s, f) => s + f.saldo, 0)
  const totalPatrimonio = totalPatrimonioCuentas + resultados.resultado

  return {
    periodo,
    activos, pasivos, patrimonio: patrimonioCuentas,
    resultados,
    totales: {
      activos: totalActivos, pasivos: totalPasivos,
      patrimonio_cuentas: totalPatrimonioCuentas, patrimonio: totalPatrimonio,
    },
    ecuacion: {
      activos: totalActivos,
      pasivo_patrimonio: totalPasivos + totalPatrimonio,
      diferencia: totalActivos - (totalPasivos + totalPatrimonio),
      cuadra: totalActivos === totalPasivos + totalPatrimonio,
    },
  }
}

/**
 * Estado de resultados (§8): detalle por cuenta, del período y acumulado
 * del año (enero → período).
 */
function estadoResultados(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)
  const anio = periodo.slice(0, 4)

  const resumen = (filas) => {
    const det = (clase) => filas
      .filter((f) => f.clase === clase && f.saldo !== 0)
      .map((f) => ({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo }))
    const r = resultadoDesdeFilas(filas)
    return {
      detalle: { ingresos: det(4), costos: det(5), gastos: det(6) },
      ...r,
    }
  }

  const delPeriodo = resumen(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { periodo })))
  const acumuladoAnio = resumen(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) })))

  return {
    periodo, anio,
    periodo_mes: delPeriodo,
    acumulado: acumuladoAnio,
    rango_acumulado: { desde: `${anio}-01-01`, hasta: ultimoDiaDe(periodo) },
  }
}

// ============================================================
// CIERRE DE PERÍODO (§7)
// ============================================================

/** Saldo (según naturaleza) de un alias de control EN el período. {cuenta:null,saldo:0} si falta. */
function saldoAlias(db, empresaId, alias, periodo) {
  const cta = cuentas.cuentaPorAlias(db, empresaId, alias)
  if (!cta) return { cuenta: null, saldo: 0 }
  const agg = db.prepare(`
    SELECT COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber
    FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
    WHERE al.cuenta_id = ? AND a.empresa_id = ? AND a.periodo = ?
  `).get(cta.id, empresaId, periodo)
  const saldo = cta.naturaleza === 'deudora' ? agg.debe - agg.haber : agg.haber - agg.debe
  return { cuenta: cta, saldo: Number(saldo) || 0 }
}

/** Resultado neto del período (clases 4/5/6 con movimientos EN el período). */
function resultadoDelPeriodo(db, empresaId, periodo) {
  return resultadoDesdeFilas(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { periodo })))
}

/**
 * Línea de cierre de UNA cuenta de resultado: invierte su saldo natural para
 * dejarla en cero (deudora → Haber su saldo positivo o Debe el negativo;
 * acreedora → Debe su saldo positivo o Haber el negativo). Es la contribución
 * opuesta a la actual, así el asiento cierra la cuenta exactamente.
 */
function lineaCierreCuenta(f) {
  const deudora = f.naturaleza === 'deudora'
  return {
    cuenta_id: f.cuenta_id,
    debe: deudora ? Math.max(-f.saldo, 0) : Math.max(f.saldo, 0),
    haber: deudora ? Math.max(f.saldo, 0) : Math.max(-f.saldo, 0),
    glosa: `${f.codigo} ${f.nombre}`,
  }
}

/** Deja solo líneas con monto y exige ≥ 2 (partida doble) — 0 líneas válidas → null. */
function lineasValidas(lineas) {
  const l = lineas.filter((x) => (x.debe || 0) !== 0 || (x.haber || 0) !== 0)
  return l.length >= 2 ? l : null
}

/**
 * Precondiciones y propuestos del cierre (§7). NO muta nada: devuelve el
 * checklist completo + los asientos de cierre PROPUESTOS (verificando que cada
 * uno cuadre ANTES de ofrecerlo) para que un humano confirme con ejecutarCierre.
 */
function prepararCierre(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)

  const p = db.prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`).get(empresaId, periodo)
  if (!p) throw new Error(`El período ${periodo} no existe (no hay movimientos que cerrar)`)
  if (p.estado === 'CERRADO') throw new Error(`El período ${periodo} ya está CERRADO`)

  // Precondición 1: documentos del período sin contabilizar (§7.1)
  const docs = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ?
    GROUP BY estado
  `).all(empresaId, periodo)
  const porEstado = new Map(docs.map((d) => [d.estado, d.n]))
  const pendientes = ['PENDIENTE', 'CLASIFICADO', 'PROPUESTO', 'REVISION']
    .reduce((s, e) => s + (porEstado.get(e) || 0), 0)

  // Precondición 2: conciliación ejecutada y diferencias visibles (§7.2)
  const conc = conciliacion.obtener(db, empresaId, periodo)

  const cierres = []
  const notas = []

  // (a) IVA determinado del mes (§7.3, §10): liquidar ambas cuentas de control
  //     y llevar la diferencia a F29_POR_PAGAR.
  //     Asiento: IVA_DEBITO al debe (liquida su saldo acreedor), IVA_CREDITO al
  //     haber (liquida su saldo deudor), F29 por la diferencia (ivaD − ivaC > 0).
  //     Con remanente (≤ 0) NO se propone: el crédito fiscal arrastra (§10).
  const ivaD = saldoAlias(db, empresaId, 'IVA_DEBITO', periodo)
  const ivaC = saldoAlias(db, empresaId, 'IVA_CREDITO', periodo)
  const f29 = saldoAlias(db, empresaId, 'F29_POR_PAGAR', periodo)
  const ivaDeterminado = ivaD.saldo - ivaC.saldo
  if (!f29.cuenta) notas.push('Falta la cuenta F29_POR_PAGAR: no se propone el cierre de IVA')
  if (ivaD.cuenta && ivaC.cuenta && f29.cuenta && ivaDeterminado > 0) {
    const lineas = lineasValidas([
      { cuenta_id: ivaD.cuenta.id, debe: ivaD.saldo, haber: 0, glosa: 'Liquidación IVA débito fiscal del período' },
      { cuenta_id: ivaC.cuenta.id, debe: 0, haber: ivaC.saldo, glosa: 'Liquidación IVA crédito fiscal del período' },
      { cuenta_id: f29.cuenta.id, debe: 0, haber: ivaDeterminado, glosa: 'IVA determinado del período a F29 por pagar' },
    ])
    if (lineas) {
      cierres.push({
        clave: 'IVA_F29',
        glosa: `Cierre ${periodo}: IVA determinado del período a F29 por pagar`,
        lineas,
        referencia: { iva_debito: ivaD.saldo, iva_credito: ivaC.saldo, iva_determinado: ivaDeterminado },
      })
    }
  } else if (ivaD.cuenta && ivaC.cuenta && ivaDeterminado <= 0) {
    notas.push(`Remanente de crédito fiscal ${Math.abs(ivaDeterminado)}: queda en IVA_CREDITO (el F29 lo arrastra, §10) — sin asiento de cierre`)
  }

  // (b) PPM devengado del mes (§7.3, §10): gasto (6.3) contra PPM por pagar.
  //     Devengo = ingresos netos del período × tasa_ppm de la empresa
  //     (parámetro de configuración con referencia legal citada, §10).
  const res0 = resultadoDelPeriodo(db, empresaId, periodo)
  const empresa = db.prepare(`SELECT tasa_ppm FROM empresas WHERE id = ?`).get(empresaId)
  const tasa = Number(empresa && empresa.tasa_ppm) || 0
  const gastoPpm = cuentas.cuentaPorAlias(db, empresaId, 'GASTO_PPM')
  const ppmPagar = cuentas.cuentaPorAlias(db, empresaId, 'PPM_POR_PAGAR')
  const ppmDevengado = Math.round(res0.ingresos * tasa)
  let ppmPropuesto = false
  if (!gastoPpm || !ppmPagar) notas.push('Faltan las cuentas GASTO_PPM / PPM_POR_PAGAR: no se propone el devengo de PPM')
  if (gastoPpm && ppmPagar && tasa > 0 && ppmDevengado > 0) {
    ppmPropuesto = true
    cierres.push({
      clave: 'PPM',
      glosa: `Cierre ${periodo}: PPM devengado del período (${(tasa * 100).toFixed(2)}% de ingresos netos)`,
      lineas: [
        { cuenta_id: gastoPpm.id, debe: ppmDevengado, haber: 0, glosa: `PPM devengado del período (tasa ${(tasa * 100).toFixed(2)}%)` },
        { cuenta_id: ppmPagar.id, debe: 0, haber: ppmDevengado, glosa: 'PPM por pagar' },
      ],
      referencia: { ingresos_base: res0.ingresos, tasa_ppm: tasa, ppm_devengado: ppmDevengado },
    })
  }
  // El devengo de PPM propuesto ES un resultado del período: se incorpora al
  // cálculo para que el asiento de RESULTADO (que se ejecuta después en la
  // misma transacción) también lo cierre y las clases 4/5/6 queden en cero.
  // El neto que absorbe RESULTADO_EJERCICIO es el ACUMULADO hasta el último
  // día del período (las filas que cierra son acumuladas, ver bloque (c));
  // el del mes queda como referencia informativa (resultado_mes).
  const resAcum = resultadoDesdeFilas(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) })))
  const res = ppmPropuesto
    ? { ...resAcum, gastos: resAcum.gastos + ppmDevengado, resultado: resAcum.resultado - ppmDevengado }
    : resAcum

  // (c) Resultado → Resultado del ejercicio (patrimonio). Se cierra el
  //     ACUMULADO hasta el último día del período (no solo el mes): un gasto de
  //     septiembre sin cerrar dejaría las clases 4/5/6 abiertas al reabrir su
  //     balance acumulado. RE absorbe el neto (haber si utilidad, debe si
  //     pérdida) y cada cuenta 4/5/6 con saldo se cierra con la línea inversa
  //     a su saldo (lineaCierreCuenta). Con resultado 0 no hay asiento.
  const reCuenta = cuentas.cuentaPorAlias(db, empresaId, 'RESULTADO_EJERCICIO')
  if (!reCuenta) notas.push('Falta la cuenta RESULTADO_EJERCICIO: no se propone el cierre de resultado')
  if (reCuenta) {
    const filas = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) }))
      .filter((f) => [4, 5, 6].includes(f.clase) && f.saldo !== 0)
      // El GASTO_PPM lo aporta el devengo virtual de arriba (aún no existe en BD)
      .filter((f) => !(ppmPropuesto && gastoPpm && f.cuenta_id === gastoPpm.id))
    if (ppmPropuesto && gastoPpm) {
      filas.push({
        cuenta_id: gastoPpm.id, codigo: gastoPpm.codigo, nombre: gastoPpm.nombre,
        clase: 6, naturaleza: 'deudora', saldo: ppmDevengado,
      })
    }
    // Con cuentas de resultado abiertas SIEMPRE hay asiento de cierre, aunque
    // el neto sea 0: la línea de RE queda en cero y lineasValidas la descarta.
    const reLinea = res.resultado > 0
      ? { cuenta_id: reCuenta.id, debe: 0, haber: res.resultado, glosa: 'Resultado del período (utilidad)' }
      : { cuenta_id: reCuenta.id, debe: Math.max(-res.resultado, 0), haber: 0, glosa: 'Resultado del período (pérdida)' }
    const lineas = lineasValidas([reLinea, ...filas.map(lineaCierreCuenta)])
    if (lineas) {
      cierres.push({
        clave: 'RESULTADO',
        glosa: `Cierre ${periodo}: resultado del período a Resultado del ejercicio`,
        lineas,
        referencia: { ...res },
      })
    }
  }

  // Defensa: jamás se PROPONE un asiento de cierre descuadrado.
  for (const c of cierres) {
    const d = c.lineas.reduce((s, l) => s + (l.debe || 0), 0)
    const h = c.lineas.reduce((s, l) => s + (l.haber || 0), 0)
    if (d !== h) throw new Error(`Asiento de cierre ${c.clave} descuadrado (debe ${d} ≠ haber ${h}): revisar saldos del período`)
  }

  return {
    periodo,
    checklist: {
      periodo_abierto: true,
      documentos_pendientes: pendientes,
      documentos_por_estado: Object.fromEntries(docs.map((d) => [d.estado, d.n])),
      conciliacion_ejecutada: !!conc,
      conciliacion_diferencias: conc ? conc.diferencias : null,
      conciliacion_conteo: conc ? conc.resultado.conteo_diferencias : null,
    },
    puede_cerrar: pendientes === 0, // las diferencias de conciliación NO bloquean: visibles (§7.2)
    cierres_propuestos: cierres,
    resultado_periodo: res,
    resultado_mes: res0,
    notas,
  }
}

/**
 * Ejecuta el cierre (§7.4): confirma los asientos de cierre elegidos (`claves`,
 * default todos los propuestos), cierra el período y persiste el snapshot —
 * TODO en UNA transacción y auditado. `forzar` permite cerrar con documentos
 * pendientes (decisión humana explícita, queda marcada en la auditoría).
 */
function ejecutarCierre(db, { empresaId, usuarioId, periodo, claves = null, forzar = false, ip = null }) {
  const prep = prepararCierre(db, empresaId, periodo)
  if (!prep.puede_cerrar && !forzar) {
    throw new Error(`El período ${periodo} tiene ${prep.checklist.documentos_pendientes} documento(s) sin contabilizar: contabilízalos o confirma con forzar`)
  }
  if (claves) {
    const propuestos = new Set(prep.cierres_propuestos.map((c) => c.clave))
    const faltantes = claves.map(String).filter((k) => !propuestos.has(k))
    if (faltantes.length) throw new Error(`No hay asiento de cierre propuesto para: ${faltantes.join(', ')}`)
  }

  const elegidos = claves
    ? prep.cierres_propuestos.filter((c) => claves.includes(c.clave))
    : prep.cierres_propuestos

  // El asiento de cierre se fecha el ÚLTIMO DÍA del período que se cierra:
  // queda dentro del período (aún abierto al insertarlo; el estado cambia
  // después en esta misma transacción) y el período siguiente queda limpio,
  // sin arrastrar las contra-partidas del cierre.
  const fechaCierre = ultimoDiaDe(periodo)
  const asientosCreados = []

  const tx = db.transaction(() => {
    for (const c of elegidos) {
      const a = asientos.crear(db, {
        empresaId, usuarioId, fecha: fechaCierre, glosa: c.glosa,
        tipo: 'cierre',
        lineas: c.lineas.map((l) => ({
          cuenta_id: l.cuenta_id, debe: l.debe || 0, haber: l.haber || 0,
          glosa: l.glosa || null, centro_costo_id: null,
        })),
        origen: `cierre:${periodo}:${c.clave}`, ip,
      })
      asientosCreados.push({
        clave: c.clave, asiento_id: a.id, folio: a.folio, anio: a.anio,
        total: a.lineas.reduce((s, l) => s + l.debe, 0),
      })
    }

    periodos.cerrar(db, empresaId, periodo, usuarioId)

    db.prepare(`
      UPDATE periodos_contables SET cierre_json = ?
      WHERE empresa_id = ? AND periodo = ?
    `).run(JSON.stringify({
      ejecutado_en: new Date().toISOString(),
      asientos: asientosCreados,
      checklist: prep.checklist,
      resultado_periodo: prep.resultado_periodo,
      forzado: !prep.puede_cerrar,
    }), empresaId, periodo)

    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'periodo.cerrar', entidad: 'periodos_contables', entidadId: periodo,
      antes: { estado: 'ABIERTO' },
      despues: {
        estado: 'CERRADO',
        asientos_cierre: asientosCreados,
        documentos_pendientes_al_cerrar: prep.checklist.documentos_pendientes,
        forzado: !prep.puede_cerrar,
      },
      ip,
    })
  })
  tx()

  return { periodo, asientos_cierre: asientosCreados, checklist: prep.checklist }
}

/** Snapshot del cierre persistido (o null). */
function obtenerCierre(db, empresaId, periodo) {
  const p = db.prepare(`SELECT cierre_json FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`).get(empresaId, periodo)
  if (!p || !p.cierre_json) return null
  return JSON.parse(p.cierre_json)
}

// ============================================================
// BALANCE DE 8 COLUMNAS (sumas y saldos con resultado)
// Columnas por cuenta: saldo anterior (deudor/acreedor) + débitos y créditos
// del período + saldo final (deudor/acreedor) + Pérdida / Utilidad de las
// cuentas de resultado (clases 4/5/6 — el cuadre clásico de la hoja de trabajo:
// Σ saldo deudor = Σ saldo acreedor y utilidad − pérdida = resultado del período).
// ============================================================

function mesAnteriorDe(periodo) {
  const y = Number(periodo.slice(0, 4))
  const m = Number(periodo.slice(4, 6))
  const mm = m === 1 ? 12 : m - 1
  const yy = m === 1 ? y - 1 : y
  return `${yy}${String(mm).padStart(2, '0')}`
}

function balance8Columnas(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)
  const finMes = ultimoDiaDe(periodo)
  const finAnterior = ultimoDiaDe(mesAnteriorDe(periodo))

  const aggAnterior = new Map(agregadoPorCuenta(db, empresaId, { hasta: finAnterior }).map((a) => [Number(a.cuenta_id), a]))
  const aggFinal = new Map(agregadoPorCuenta(db, empresaId, { hasta: finMes }).map((a) => [Number(a.cuenta_id), a]))
  const plan = new Map(cuentas.listar(db, empresaId).map((c) => [Number(c.id), c]))

  const filas = []
  for (const [id, a] of aggFinal) {
    const c = plan.get(id)
    if (!c || c.es_resumen) continue
    const ant = aggAnterior.get(id) || { debe: 0, haber: 0 }
    // En la hoja de trabajo las columnas deudor/acreedor se determinan por el
    // SIGNO del neto (debe − haber), NO por la naturaleza de la cuenta: una
    // cuenta de patrimonio con saldo acreedor va a la columna acreedora y una
    // cuenta de banco sobregirada a la acreedora igual.
    const antNeto = (Number(ant.debe) || 0) - (Number(ant.haber) || 0)
    const finNeto = (Number(a.debe) || 0) - (Number(a.haber) || 0)
    filas.push({
      cuenta_id: c.id, codigo: c.codigo, nombre: c.nombre, clase: c.clase,
      anterior_deudor: Math.max(antNeto, 0), anterior_acreedor: Math.max(-antNeto, 0),
      debe: Number(a.debe) || 0, haber: Number(a.haber) || 0,
      saldo_deudor: Math.max(finNeto, 0), saldo_acreedor: Math.max(-finNeto, 0),
      perdida: 0, utilidad: 0,
    })
  }
  filas.sort((x, y) => String(x.codigo).localeCompare(String(y.codigo)))

  // Pérdida (costos/gastos deudores) y Utilidad (ingresos acreedores) del período:
  // el saldo natural de las clases 4/5/6 se traslada a estas columnas (hoja de trabajo).
  for (const f of filas) {
    if ([4, 5, 6].includes(f.clase)) {
      if (f.saldo_deudor > 0) { f.perdida = f.saldo_deudor; f.saldo_deudor = 0 }
      else if (f.saldo_acreedor > 0) { f.utilidad = f.saldo_acreedor; f.saldo_acreedor = 0 }
    }
  }

  const sumar = (clave) => filas.reduce((s, f) => s + f[clave], 0)
  const sumas = {
    anterior_deudor: sumar('anterior_deudor'), anterior_acreedor: sumar('anterior_acreedor'),
    debe: sumar('debe'), haber: sumar('haber'),
    saldo_deudor: sumar('saldo_deudor'), saldo_acreedor: sumar('saldo_acreedor'),
    perdida: sumar('perdida'), utilidad: sumar('utilidad'),
  }
  return {
    periodo,
    filas,
    sumas,
    cuadres: {
      sumas_debe_haber: sumas.debe === sumas.haber,
      // Hoja de trabajo clásica: con las cuentas de resultado abiertas, el
      // cuadre de saldos incluye las columnas de Pérdida/Utilidad.
      saldos_cuadran: (sumas.saldo_deudor + sumas.perdida) === (sumas.saldo_acreedor + sumas.utilidad),
      resultado: sumas.utilidad - sumas.perdida,
    },
  }
}

// ============================================================
// BALANCE CLASIFICADO (presentación §8): activo corriente/no corriente,
// pasivo corriente/no corriente y patrimonio, derivado del CÓDIGO del plan
// (1.1 corriente, 1.2+ no corriente; 2.1 corriente, 2.2+ no corriente).
// Incluye el resultado del período para que A = P + Pat cuadre.
// ============================================================

function balanceClasificado(db, empresaId, periodo) {
  exigirPeriodoValido(periodo)
  const filas = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) }))
  const seccion = (filtro) => filas
    .filter(filtro)
    .map((f) => ({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo }))

  const activoCorriente = seccion((f) => f.clase === 1 && String(f.codigo).startsWith('1.1'))
  const activoNoCorriente = seccion((f) => f.clase === 1 && !String(f.codigo).startsWith('1.1'))
  const pasivoCorriente = seccion((f) => f.clase === 2 && String(f.codigo).startsWith('2.1'))
  const pasivoNoCorriente = seccion((f) => f.clase === 2 && !String(f.codigo).startsWith('2.1'))
  const patrimonio = seccion((f) => f.clase === 3)

  const t = (secciones) => secciones.flat().reduce((s, x) => s + x.saldo, 0)
  const resultados = resultadoDesdeFilas(filas)
  const totalActivo = t([activoCorriente, activoNoCorriente])
  const totalPasivo = t([pasivoCorriente, pasivoNoCorriente])
  const totalPasivoCorriente = t([pasivoCorriente])
  const totalPatrimonio = t([patrimonio]) + resultados.resultado

  return {
    periodo,
    activo: { corriente: activoCorriente, no_corriente: activoNoCorriente, total: totalActivo },
    pasivo: { corriente: pasivoCorriente, no_corriente: pasivoNoCorriente, total: totalPasivo },
    patrimonio: { cuentas: patrimonio, resultado_periodo: resultados.resultado, total: totalPatrimonio },
    capital_trabajo: totalActivo - totalPasivoCorriente,
    ecuacion: {
      activos: totalActivo,
      pasivo_patrimonio: totalPasivo + totalPatrimonio,
      cuadra: totalActivo === totalPasivo + totalPatrimonio,
    },
  }
}

// ============================================================
// CUENTA CORRIENTE de clientes y proveedores (§8): lo que cada contraparte
// debe a la empresa (clientes) o lo que la empresa le debe (proveedores).
// Cargos/abonos derivados de la partida doble real:
//  - Cliente: venta normal = cargo; NC de venta (60/61) = abono; cobro aplicado = abono.
//  - Proveedor: compra normal = cargo; NC de compra = abono; pago aplicado = abono.
// Fuente: documentos CONTABILIZADOS (asiento_id) + movimientos de tesorería
// aplicados a documentos. Solo-lectura, con filtros de fecha y RUT.
// ============================================================

function cuentaCorriente(db, empresaId, { rol = 'cliente', desde = null, hasta = null, rut = null, limit = 500 } = {}) {
  const tipoFlujo = rol === 'proveedor' ? 'compra' : 'venta'
  const where = [`d.empresa_id = ?`, `d.tipo_flujo = ?`, `d.estado = 'CONTABILIZADO'`, 'd.asiento_id IS NOT NULL']
  const params = [empresaId, tipoFlujo]
  if (rut) { where.push('d.rut_contraparte = ?'); params.push(rut) }
  if (desde) { where.push('d.fecha_docto >= ?'); params.push(desde) }
  if (hasta) { where.push('d.fecha_docto <= ?'); params.push(hasta) }

  const filas = []
  // 1) Documentos (facturas y NC) — la fecha efectiva es el DEVENGO (fecha_docto).
  const docs = db.prepare(`
    SELECT d.id, d.rut_contraparte, d.razon_social, d.tipo_doc, d.folio, d.fecha_docto, d.monto_total
    FROM documentos d WHERE ${where.join(' AND ')} ORDER BY d.fecha_docto, d.id
    LIMIT ?
  `).all(...params, Math.min(Number(limit) || 500, 2000))
  for (const d of docs) {
    const esNC = [60, 61].includes(Number(d.tipo_doc))
    const monto = Math.round(Number(d.monto_total) || 0)
    filas.push({
      rut: d.rut_contraparte, razon_social: d.razon_social, fecha: d.fecha_docto || d.periodo_ingesta,
      tipo: esNC ? 'NC' : 'DOCTO', referencia: `${d.tipo_doc}/${d.folio}`,
      cargo: esNC ? 0 : monto, abono: esNC ? monto : 0, documento_id: d.id,
    })
  }
  // 2) Pagos/cobros aplicados (tesorería) — la fecha es la del movimiento bancario.
  const whereTeso = [`d.empresa_id = ?`, `d.tipo_flujo = ?`, `m.documento_id IS NOT NULL`]
  const paramsTeso = [empresaId, tipoFlujo]
  if (rut) { whereTeso.push('d.rut_contraparte = ?'); paramsTeso.push(rut) }
  if (desde) { whereTeso.push('m.fecha >= ?'); paramsTeso.push(desde) }
  if (hasta) { whereTeso.push('m.fecha <= ?'); paramsTeso.push(hasta) }
  const pagos = db.prepare(`
    SELECT m.id, m.tipo, m.fecha, m.monto, d.rut_contraparte, d.razon_social,
           d.tipo_doc AS doc_tipo, d.folio AS doc_folio
    FROM teso_movimientos m JOIN documentos d ON d.id = m.documento_id
    WHERE ${whereTeso.join(' AND ')}
    ORDER BY m.fecha, m.id
    LIMIT ?
  `).all(...paramsTeso, Math.min(Number(limit) || 500, 2000))
  for (const m of pagos) {
    const monto = Math.abs(Math.round(Number(m.monto) || 0))
    filas.push({
      rut: m.rut_contraparte, razon_social: m.razon_social, fecha: m.fecha,
      tipo: m.tipo === 'COBRO' ? 'COBRO' : 'PAGO',
      referencia: `${m.doc_tipo || ''}/${m.doc_folio || ''}`.replace(/^\//, ''),
      cargo: 0, abono: monto, movimiento_id: m.id,
    })
  }

  filas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || (a.documento_id || a.movimiento_id || 0) - (b.documento_id || b.movimiento_id || 0))

  // Resumen por RUT + saldo corrido si se filtró por una contraparte.
  const mapa = new Map()
  let corrido = 0
  const detalle = []
  for (const f of filas) {
    const k = mapa.get(f.rut) || { rut: f.rut, razon_social: f.razon_social, cargos: 0, abonos: 0, saldo: 0 }
    k.cargos += f.cargo; k.abonos += f.abono; k.saldo = k.cargos - k.abonos
    mapa.set(f.rut, k)
    if (rut) { corrido += f.cargo - f.abono; detalle.push({ ...f, saldo_despues: corrido }) }
  }
  const resumen = [...mapa.values()].sort((a, b) => b.saldo - a.saldo)
  return {
    rol, desde, hasta, rut,
    resumen,
    detalle: rut ? detalle : null,
    total_cargos: resumen.reduce((s, r) => s + r.cargos, 0),
    total_abonos: resumen.reduce((s, r) => s + r.abonos, 0),
    total_saldo: resumen.reduce((s, r) => s + r.saldo, 0),
  }
}

module.exports = {
  balanceComprobacion,
  situacionFinanciera,
  estadoResultados,
  prepararCierre,
  ejecutarCierre,
  obtenerCierre,
  balance8Columnas,
  balanceClasificado,
  cuentaCorriente,
  // helpers de derivación compartidos (presentación NIIF, FASE 8)
  agregadoPorCuenta,
  filasPlan,
  ultimoDiaDe,
}
