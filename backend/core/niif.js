/**
 * NIIF/IFRS (FASE 8) — presentación de estados sobre el mayor real.
 *
 *  - Cada cuenta tiene UN rubro de presentación (`cuentas.rubro_niif`), con
 *    defaults sembrados por código del plan (migracionesFase8). El mapeo es
 *    editable por la empresa (auditado).
 *  - Los estados NUNCA adivinan: una cuenta imputable sin rubro aparece en el
 *    pseudo-rubro SIN_CLASIFICAR de su sección — la ecuación sigue cuadrando
 *    y el contador ve exactamente qué le falta mapear (report-only).
 *  - Situación financiera NIIF: activos/pasivos corrientes y no corrientes
 *    por rubro (PP&E NETO: la depreciación acumulada, contra-activo con saldo
 *    negativo, se pliega en su rubro), patrimonio + resultado del período.
 *  - Resultados NIIF por NATURALEZA (el plan es por naturaleza): ingresos,
 *    costos y gastos agrupados por rubro, del mes y acumulado del año.
 *
 * Módulo puro: recibe la BD como parámetro. Deriva TODO de asiento_lineas
 * vía los mismos helpers del motor de reportes (una sola fuente de verdad).
 */

const cuentas = require('./cuentas')
const { agregadoPorCuenta, filasPlan, ultimoDiaDe } = require('./reportes')
const { registrarAccion } = require('./auditoria')
const periodos = require('./periodos')

/** Catálogo de rubros de presentación (claves estables — no renombrar). */
const RUBROS_NIIF = [
  // Estado de Situación Financiera
  { key: 'EFECTIVO_EQUIVALENTES', nombre: 'Efectivo y equivalentes de efectivo', seccion: 'activo_corriente', orden: 1 },
  { key: 'DEUDORES_COMERCIALES', nombre: 'Deudores comerciales y otras cuentas por cobrar', seccion: 'activo_corriente', orden: 2 },
  { key: 'OTROS_ACTIVOS_CTES', nombre: 'Otros activos corrientes', seccion: 'activo_corriente', orden: 3 },
  { key: 'PYE', nombre: 'Propiedad, planta y equipo (neto)', seccion: 'activo_no_corriente', orden: 1 },
  { key: 'INTANGIBLES', nombre: 'Activos intangibles', seccion: 'activo_no_corriente', orden: 2 },
  { key: 'OTROS_ACTIVOS_NO_CTES', nombre: 'Otros activos no corrientes', seccion: 'activo_no_corriente', orden: 3 },
  { key: 'CXP_COMERCIALES', nombre: 'Cuentas por pagar comerciales', seccion: 'pasivo_corriente', orden: 1 },
  { key: 'OBLIGACIONES_TRIBUTARIAS', nombre: 'Obligaciones tributarias', seccion: 'pasivo_corriente', orden: 2 },
  { key: 'OBLIGACIONES_FINANCIERAS', nombre: 'Obligaciones financieras', seccion: 'pasivo_corriente', orden: 3 },
  { key: 'OTRAS_CXP', nombre: 'Otras cuentas por pagar', seccion: 'pasivo_corriente', orden: 4 },
  { key: 'OBLIGACIONES_LARGO_PLAZO', nombre: 'Obligaciones financieras a largo plazo', seccion: 'pasivo_no_corriente', orden: 1 },
  { key: 'OTROS_PASIVOS_NO_CTES', nombre: 'Otros pasivos no corrientes', seccion: 'pasivo_no_corriente', orden: 2 },
  { key: 'CAPITAL_EMITIDO', nombre: 'Capital emitido', seccion: 'patrimonio', orden: 1 },
  { key: 'RESERVAS', nombre: 'Reservas', seccion: 'patrimonio', orden: 2 },
  { key: 'RESULTADOS_ACUMULADOS', nombre: 'Resultados acumulados', seccion: 'patrimonio', orden: 3 },
  { key: 'RESULTADO_EJERCICIO', nombre: 'Resultado del ejercicio (cerrado)', seccion: 'patrimonio', orden: 4 },
  // Estado de Resultados (por naturaleza)
  { key: 'INGRESOS_ORDINARIOS', nombre: 'Ingresos de actividades ordinarias', seccion: 'resultado', orden: 1 },
  { key: 'COSTO_VENTAS', nombre: 'Costo de ventas', seccion: 'resultado', orden: 2 },
  { key: 'GASTO_PERSONAL', nombre: 'Gastos de personal', seccion: 'resultado', orden: 3 },
  { key: 'DEPRECIACION_AMORTIZACION', nombre: 'Depreciación y amortización', seccion: 'resultado', orden: 4 },
  { key: 'GASTO_ADMINISTRACION', nombre: 'Gastos de administración', seccion: 'resultado', orden: 5 },
  { key: 'GASTO_VENTAS', nombre: 'Gastos de distribución y ventas', seccion: 'resultado', orden: 6 },
  { key: 'GASTOS_FINANCIEROS', nombre: 'Gastos financieros', seccion: 'resultado', orden: 7 },
  { key: 'GASTOS_TRIBUTARIOS', nombre: 'Gastos tributarios', seccion: 'resultado', orden: 8 },
  { key: 'OTROS_INGRESOS', nombre: 'Otros ingresos', seccion: 'resultado', orden: 9 },
  { key: 'OTROS_GASTOS', nombre: 'Otros gastos', seccion: 'resultado', orden: 10 },
]

const POR_CLAVE = new Map(RUBROS_NIIF.map((r) => [r.key, r]))

function esRubroValido(key) {
  return key === null || POR_CLAVE.has(String(key))
}

/** Sección ESF de una cuenta según su código (1.1 corriente, 2.1 corriente…). */
function seccionDeCuenta(c) {
  const codigo = String(c.codigo)
  if (c.clase === 1) return codigo.startsWith('1.1') ? 'activo_corriente' : 'activo_no_corriente'
  if (c.clase === 2) return codigo.startsWith('2.1') ? 'pasivo_corriente' : 'pasivo_no_corriente'
  if (c.clase === 3) return 'patrimonio'
  return 'resultado'
}

/** Mapeo actual: cuentas imputables con su rubro + catálogo + pendientes. */
function mapeo(db, empresaId) {
  const imputables = db.prepare(`
    SELECT id, codigo, nombre, clase, rubro_niif FROM cuentas
    WHERE empresa_id = ? AND es_resumen = 0
    ORDER BY codigo
  `).all(empresaId)
  const sinClasificar = imputables.filter((c) => !c.rubro_niif).length
  return {
    rubros: RUBROS_NIIF,
    cuentas: imputables.map((c) => ({
      ...c,
      rubro_nombre: c.rubro_niif ? (POR_CLAVE.get(c.rubro_niif) || {}).nombre || null : null,
      seccion: seccionDeCuenta(c),
    })),
    sin_clasificar: sinClasificar,
  }
}

/** Asignación masiva de rubros (una transacción, un registro de auditoría). */
function asignarMasivo(db, { empresaId, usuarioId, mapeos, ip = null }) {
  if (!Array.isArray(mapeos) || !mapeos.length) throw new Error('No hay cambios de mapeo que guardar')
  const antes = new Map(
    db.prepare(`SELECT id, rubro_niif FROM cuentas WHERE empresa_id = ?`).all(empresaId).map((r) => [r.id, r.rubro_niif])
  )
  const cambios = []
  const tx = db.transaction(() => {
    for (const m of mapeos) {
      const cuentaId = Number(m && m.cuenta_id)
      const rubro = m.rubro === undefined || m.rubro === '' ? null : String(m.rubro)
      if (!antes.has(cuentaId)) throw new Error(`La cuenta ${cuentaId} no existe en esta empresa`)
      if (!esRubroValido(rubro)) throw new Error(`Rubro NIIF inválido: ${rubro}`)
      const actual = antes.get(cuentaId) || null
      if (actual === rubro) continue
      db.prepare(`UPDATE cuentas SET rubro_niif = ? WHERE id = ? AND empresa_id = ?`).run(rubro, cuentaId, empresaId)
      cambios.push({ cuenta_id: cuentaId, antes: actual, despues: rubro })
    }
    if (cambios.length) {
      registrarAccion(db, {
        empresaId, usuarioId,
        accion: 'niif.mapeo', entidad: 'cuentas', entidadId: String(empresaId),
        antes: null, despues: { cambios },
        ip,
      })
    }
  })
  tx()
  return { cambios: cambios.length }
}

/** Agrupa filas de cuentas por rubro NIIF dentro de una sección. */
function agruparPorRubro(filas, seccion) {
  const porRubro = new Map()
  const sinClasificar = []
  for (const f of filas) {
    const sec = seccionDeCuenta(f)
    if (sec !== seccion) continue
    if (f.rubro_niif && POR_CLAVE.has(f.rubro_niif)) {
      const r = POR_CLAVE.get(f.rubro_niif)
      const k = porRubro.get(r.key) || { rubro: r.key, nombre: r.nombre, orden: r.orden, cuentas: [], saldo: 0 }
      k.cuentas.push({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo })
      k.saldo += f.saldo
      porRubro.set(r.key, k)
    } else {
      sinClasificar.push({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo })
    }
  }
  const rubros = [...porRubro.values()].sort((a, b) => a.orden - b.orden)
  if (sinClasificar.length) {
    rubros.push({ rubro: 'SIN_CLASIFICAR', nombre: 'SIN CLASIFICAR NIIF (mapear en el módulo NIIF)', orden: 999, cuentas: sinClasificar, saldo: sinClasificar.reduce((s, c) => s + c.saldo, 0) })
  }
  for (const k of rubros) k.cuentas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
  return rubros
}

/** Estado de Situación Financiera NIIF: acumulado al último día del período. */
function situacionNiif(db, empresaId, periodo) {
  if (!periodos.validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const filas = filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) }))

  const activoCte = agruparPorRubro(filas, 'activo_corriente')
  const activoNoCte = agruparPorRubro(filas, 'activo_no_corriente')
  const pasivoCte = agruparPorRubro(filas, 'pasivo_corriente')
  const pasivoNoCte = agruparPorRubro(filas, 'pasivo_no_corriente')
  const patrimonio = agruparPorRubro(filas, 'patrimonio')

  const suma = (grupos) => grupos.reduce((s, g) => s + g.saldo, 0)
  const resultados = filas.filter((f) => [4, 5, 6].includes(f.clase))
  const resultadoPeriodo = resultados.reduce((s, f) => s + (f.clase === 4 ? f.saldo : -f.saldo), 0)

  const totalActivoCte = suma(activoCte)
  const totalActivoNoCte = suma(activoNoCte)
  const totalActivo = totalActivoCte + totalActivoNoCte
  const totalPasivoCte = suma(pasivoCte)
  const totalPasivoNoCte = suma(pasivoNoCte)
  const totalPasivo = totalPasivoCte + totalPasivoNoCte
  const totalPatrimonioRubros = suma(patrimonio)
  const totalPatrimonio = totalPatrimonioRubros + resultadoPeriodo

  return {
    periodo,
    activo_corriente: { rubros: activoCte, total: totalActivoCte },
    activo_no_corriente: { rubros: activoNoCte, total: totalActivoNoCte },
    pasivo_corriente: { rubros: pasivoCte, total: totalPasivoCte },
    pasivo_no_corriente: { rubros: pasivoNoCte, total: totalPasivoNoCte },
    patrimonio: { rubros: patrimonio, resultado_periodo: resultadoPeriodo, total: totalPatrimonio },
    totales: {
      activo: totalActivo, pasivo: totalPasivo, patrimonio: totalPatrimonio,
      pasivo_patrimonio: totalPasivo + totalPatrimonio,
    },
    ecuacion: {
      cuadra: totalActivo === totalPasivo + totalPatrimonio,
      diferencia: totalActivo - (totalPasivo + totalPatrimonio),
    },
    sin_clasificar: filas.filter((f) => [1, 2, 3].includes(f.clase) && !f.rubro_niif).length,
  }
}

/** Estado de Resultados NIIF por naturaleza: rubros del mes y acumulado. */
function resultadosNiif(db, empresaId, periodo) {
  if (!periodos.validarFormato(periodo)) throw new Error(`Período inválido: ${periodo} (esperado AAAAMM)`)
  const anio = periodo.slice(0, 4)

  const construir = (filas) => {
    const ingresos = agruparPorRubroClase(filas, 4)
    const costos = agruparPorRubroClase(filas, 5)
    const gastos = agruparPorRubroClase(filas, 6)
    const total = (grupos) => grupos.reduce((s, g) => s + g.saldo, 0)
    return {
      ingresos: { rubros: ingresos, total: total(ingresos) },
      costos: { rubros: costos, total: total(costos) },
      gastos: { rubros: gastos, total: total(gastos) },
      resultado: total(ingresos) - total(costos) - total(gastos),
      sin_clasificar: filas.filter((f) => [4, 5, 6].includes(f.clase) && !f.rubro_niif).length,
    }
  }

  return {
    periodo, anio,
    periodo_mes: construir(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { periodo }))),
    acumulado: construir(filasPlan(db, empresaId, agregadoPorCuenta(db, empresaId, { hasta: ultimoDiaDe(periodo) }))),
    rango_acumulado: { desde: `${anio}-01-01`, hasta: ultimoDiaDe(periodo) },
  }
}

/** Agrupa por rubro SOLO las cuentas de una clase de resultado (4/5/6). */
function agruparPorRubroClase(filas, clase) {
  const porRubro = new Map()
  const sinClasificar = []
  for (const f of filas) {
    if (f.clase !== clase) continue
    if (f.rubro_niif && POR_CLAVE.has(f.rubro_niif)) {
      const r = POR_CLAVE.get(f.rubro_niif)
      const k = porRubro.get(r.key) || { rubro: r.key, nombre: r.nombre, orden: r.orden, cuentas: [], saldo: 0 }
      k.cuentas.push({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo })
      k.saldo += f.saldo
      porRubro.set(r.key, k)
    } else {
      sinClasificar.push({ cuenta_id: f.cuenta_id, codigo: f.codigo, nombre: f.nombre, saldo: f.saldo })
    }
  }
  const rubros = [...porRubro.values()].sort((a, b) => a.orden - b.orden)
  if (sinClasificar.length) {
    rubros.push({ rubro: 'SIN_CLASIFICAR', nombre: 'SIN CLASIFICAR NIIF', orden: 999, cuentas: sinClasificar, saldo: sinClasificar.reduce((s, c) => s + c.saldo, 0) })
  }
  for (const k of rubros) k.cuentas.sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)))
  return rubros
}

module.exports = {
  RUBROS_NIIF,
  mapeo, asignarMasivo,
  situacionNiif, resultadosNiif,
  esRubroValido,
}
