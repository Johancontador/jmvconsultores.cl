/**
 * portal-metricas.js — Motor de métricas del PORTAL DE INTELIGENCIA COMERCIAL.
 *
 * PRINCIPIOS (docs/PORTAL-INTELIGENCIA-COMERCIAL.md §7):
 *  - UNA sola fuente: la bandeja `documentos` (la misma que consumen los
 *    libros C/V) — los totales del portal coinciden con la bandeja del sistema
 *    contable por construcción: misma tabla, misma clave dedupe.
 *  - Catálogo central: cada métrica tiene id, fórmula y limitaciones aquí
 *    (CATALOGO) — ninguna pantalla recalcula a su manera.
 *  - Notas de crédito: en la bandeja las NC (60/61) quedan con montos
 *    POSITIVOS (el signo se aplica al consumir: así lo hace routes/sii.js con
 *    `signo = -1` para 60/61); el portal aplica el MISMO tratamiento UNA sola
 *    vez: *CASE WHEN tipo_doc IN (60,61) THEN -monto ELSE monto END. Sumar
 *    crudo inflaría el total; descontar dos veces lo anularía.
 *  - Sin datos ≠ cero: si el período no tiene documentos vivos, la métrica es
 *    null y el portal lo presenta como "sin datos del período" (§7).
 *  - Aislamiento: toda función exige empresaId y solo consulta con filtros
 *    SQL; el router valida el acceso ANTES de llamar.
 *  - Módulo puro (BD por parámetro, testeable) — NUNCA muta.
 */

const MESES = ['01','02','03','04','05','06','07','08','09','10','11','12']

/** Solo documentos vivos cuentan para métricas comerciales. */
const WHERE_VIVOS = `estado NOT IN ('ANULADO','ERROR')`

/**
 * Catálogo de métricas — la ÚNICA descripción de fórmulas del portal.
 * Expuesto por GET /api/portal/metricas (constructor §H y transparencia).
 */
const CATALOGO = [
  {
    id: 'venta_neta_mes',
    nombre: 'Venta neta del mes',
    descripcion: 'Suma de monto_neto de documentos de venta vivos del período, con notas de crédito (60/61) restando UNA vez (CASE signo, igual que la integración SII).',
    formula: 'SUM(CASE WHEN tipo_doc IN (60,61) THEN -monto_neto ELSE monto_neto END) WHERE tipo_flujo = "venta"',
    unidad: 'CLP',
    limitaciones: 'Monto según RCV oficial del SII: refleja lo informado, puede diferir de la facturación interna (vendedor, SKU y costos no existen en esta fuente).',
  },
  {
    id: 'variacion_periodo',
    nombre: 'Variación vs. mes comparable',
    descripcion: 'Cambio porcentual de la venta neta entre el período y su mes anterior.',
    formula: '(venta_neta_actual - venta_neta_previa) / venta_neta_previa',
    unidad: '%',
    limitaciones: 'Si el mes comparable no tiene datos, la métrica es null (no 0% ni -100%).',
  },
  {
    id: 'clientes_compradores',
    nombre: 'Clientes compradores del período',
    descripcion: 'Cantidad de RUTs distintos con al menos un documento de venta vivo del período.',
    formula: 'COUNT(DISTINCT rut_contraparte) WHERE tipo_flujo = "venta"',
    unidad: 'clientes',
    limitaciones: null,
  },
  {
    id: 'ticket_promedio_documento',
    nombre: 'Ticket promedio por documento',
    descripcion: 'Venta neta del período dividida por la cantidad de documentos de venta vivos.',
    formula: 'venta_neta / COUNT(documentos de venta vivos)',
    unidad: 'CLP',
    limitaciones: 'Un cliente con 3 facturas cuenta 3 veces; para la vista por cliente existe ticket_promedio_cliente.',
  },
  {
    id: 'ticket_promedio_cliente',
    nombre: 'Ticket promedio por cliente',
    descripcion: 'Venta neta del período dividida por la cantidad de clientes compradores.',
    formula: 'venta_neta / COUNT(DISTINCT rut_contraparte)',
    unidad: 'CLP',
    limitaciones: null,
  },
  {
    id: 'frecuencia_compra',
    nombre: 'Frecuencia de compra',
    descripcion: 'Documentos de venta vivos por cliente en el período.',
    formula: 'COUNT(*) GROUP BY rut_contraparte WHERE tipo_flujo = "venta"',
    unidad: 'docs/cliente',
    limitaciones: null,
  },
  {
    id: 'concentracion_ventas',
    nombre: 'Concentración de ventas (top 5)',
    descripcion: 'Porcentaje de la venta neta del período concentrado en los 5 mayores clientes.',
    formula: 'SUM(neta top 5 clientes) / venta_neta_total',
    unidad: '%',
    limitaciones: null,
  },
]

/**
 * CASE de signo para NC (60/61) — úsalo siempre como `SUM(${SIGNO_NC}(monto_*))`.
 * Doc fuente de la regla: routes/sii.js (signo -1 para notas de crédito) y
 * conciliacion.js (esNC 60/61). El portal comparte esa MISMA convención.
 */
const SIGNO_NC = `CASE WHEN tipo_doc IN (60, 61) THEN -1 ELSE 1 END *`

/** Agregado de ventas de UN período (con NC descontando una vez; null-ish si no hay docs). */
function ventaDePeriodo(db, empresaId, periodo) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto,
      COALESCE(SUM(${SIGNO_NC}(monto_total)), 0) AS total,
      COUNT(*) AS docs,
      COUNT(DISTINCT rut_contraparte) AS clientes
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? AND tipo_flujo = 'venta' AND ${WHERE_VIVOS}
  `).get(empresaId, periodo)
}

/** Mes AAAAMM anterior. */
function periodoPrevio(periodo) {
  const s = String(periodo)
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(4))
  const mm = m === 1 ? 12 : m - 1
  const yy = m === 1 ? y - 1 : y
  return `${yy}${String(mm).padStart(2, '0')}`
}

/** Resumen ejecutivo (Inicio del portal). */
function resumen(db, { empresaId, periodo }) {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')

  const actual = ventaDePeriodo(db, empresaId, periodo)
  const previo = ventaDePeriodo(db, empresaId, periodoPrevio(periodo))

  const topClientes = db.prepare(`
    SELECT rut_contraparte AS rut, MAX(razon_social) AS razon_social,
           COUNT(*) AS docs, COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto,
           COALESCE(SUM(${SIGNO_NC}(monto_total)), 0) AS total
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? AND tipo_flujo = 'venta' AND ${WHERE_VIVOS}
    GROUP BY rut_contraparte
    ORDER BY neto DESC
    LIMIT 5
  `).all(empresaId, periodo)

  // Concentración top5 (métrica del catálogo).
  const netoTop5 = topClientes.reduce((s, c) => s + c.neto, 0)
  const concentracion = actual.docs > 0 && actual.neto > 0
    ? Math.round((netoTop5 / actual.neto) * 1000) / 10
    : null

  // Serie mensual del año del período: null = sin RCV de ese mes (NO cero).
  const anio = String(periodo).slice(0, 4)
  const serie = db.prepare(`
    SELECT periodo_ingesta AS p, COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto, COUNT(*) AS docs
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta LIKE ? AND tipo_flujo = 'venta' AND ${WHERE_VIVOS}
    GROUP BY 1
  `).all(empresaId, `${anio}%`)
  const seriePorP = new Map(serie.map((r) => [r.p, r]))

  const ultimo = db.prepare(`
    SELECT MAX(periodo_ingesta) AS p FROM documentos WHERE empresa_id = ? AND tipo_flujo = 'venta'
  `).get(empresaId).p

  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    periodo,
    periodo_previo: periodoPrevio(periodo),
    ventas: {
      neta: actual.docs > 0 ? actual.neto : null,
      total: actual.docs > 0 ? actual.total : null,
      docs: actual.docs,
      variacion_pct: (actual.docs > 0 && previo.docs > 0 && previo.neto > 0)
        ? Math.round(((actual.neto - previo.neto) / previo.neto) * 1000) / 10
        : null,
    },
    clientes_compradores: actual.docs > 0 ? actual.clientes : null,
    ticket_promedio_documento: actual.docs > 0 ? Math.round(actual.neto / actual.docs) : null,
    ticket_promedio_cliente: (actual.docs > 0 && actual.clientes > 0) ? Math.round(actual.neto / actual.clientes) : null,
    concentracion_top5_pct: concentracion,
    top_clientes: topClientes,
    serie_anual: MESES.map((mm) => {
      const p = `${anio}${mm}`
      const r = seriePorP.get(p)
      return { periodo: p, mes: Number(mm), neto: r ? r.neto : null, docs: r ? r.docs : 0 }
    }),
    cobertura: { ultimo_periodo_con_datos: ultimo },
  }
}

/** Agregado de UN flujo (venta|compra) de UN período — NC con signo UNA vez. */
function flujoDePeriodo(db, empresaId, periodo, flujo) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto,
      COALESCE(SUM(${SIGNO_NC}(monto_iva)), 0) AS iva,
      COALESCE(SUM(${SIGNO_NC}(monto_total)), 0) AS total,
      COUNT(*) AS docs,
      COUNT(DISTINCT rut_contraparte) AS contrapartes
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? AND tipo_flujo = ? AND ${WHERE_VIVOS}
  `).get(empresaId, periodo, flujo === 'compra' ? 'compra' : 'venta')
}

/**
 * Resumen DUO del período: venta y compra lado a lado con IVA y variación del
 * mes comparable, calculadas SIEMPRE server-side. La diferencia (bruto
 * estimado) es ARITMÉTICA sobre datos REALES con NC restando UNA vez en ambos
 * flujos (nunca inventa: si un flujo no tiene documentos, esa parte y su
 * diferencia quedan null). Fuente del Inicio del portal (dashboard tipo panel).
 */
function resumenDuo(db, { empresaId, periodo }) {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const previo = periodoPrevio(periodo)
  const v = flujoDePeriodo(db, empresaId, periodo, 'venta')
  const v0 = flujoDePeriodo(db, empresaId, previo, 'venta')
  const c = flujoDePeriodo(db, empresaId, periodo, 'compra')
  const c0 = flujoDePeriodo(db, empresaId, previo, 'compra')

  const empaque = (f, f0, esVenta) => ({
    neto: f.docs > 0 ? f.neto : null,
    iva: f.docs > 0 ? f.iva : null,
    total: f.docs > 0 ? f.total : null,
    docs: f.docs,
    contrapartes: f.docs > 0 ? f.contrapartes : null,
    variacion_neta_pct: (f.docs > 0 && f0.docs > 0 && f0.neto > 0)
      ? Math.round(((f.neto - f0.neto) / f0.neto) * 1000) / 10
      : null,
    rol: esVenta ? 'venta' : 'compra',
  })
  const venta = empaque(v, v0, true)
  const compra = empaque(c, c0, false)
  const diferencia = (venta.neto !== null && compra.neto !== null)
    ? { neto: venta.neto - compra.neto, iva_det: (venta.iva || 0) - (compra.iva || 0), etiqueta: 'Venta neta − Compras netas; IVA determinado provisional (NO incluye PPM ni retenciones)' }
    : null
  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    periodo, periodo_previo: previo,
    venta, compra, diferencia_bruta: diferencia,
    regla: 'Notas de crédito (60/61) restan UNA vez en venta y compra — misma convención CASE del motor y del SII. Sin documentos en un flujo → null, nunca 0.',
  }
}

/**
 * Movimientos (página Ventas / §B): listado lectura-only con filtros de
 * empresa, rango de períodos, tipo de doc, RUT y texto (razón social / folio).
 * Devuelve página + totales del filtro completo (sumas honestas).
 */
function movimientos(db, { empresaId, desde = null, hasta = null, tipoDoc = null, tipoFlujo = 'venta', rut = null, texto = null, limit = 100, offset = 0 }) {
  const where = ['empresa_id = ?', 'tipo_flujo = ?']
  const params = [empresaId, tipoFlujo === 'compra' ? 'compra' : 'venta']
  if (desde) { where.push('periodo_ingesta >= ?'); params.push(desde) }
  if (hasta) { where.push('periodo_ingesta <= ?'); params.push(hasta) }
  if (tipoDoc) { where.push('tipo_doc = ?'); params.push(Number(tipoDoc)) }
  if (rut) { where.push('rut_contraparte LIKE ?'); params.push(`%${String(rut).replace(/[.\-]/g, '')}%`) }
  if (texto) { where.push('(razon_social LIKE ? OR folio LIKE ?)'); params.push(`%${texto}%`, `%${texto}%`) }
  const whereSql = where.join(' AND ')

  const sumas = db.prepare(`    SELECT COUNT(*) AS n, COALESCE(SUM(${SIGNO_NC}(monto_neto)),0) AS neto, COALESCE(SUM(${SIGNO_NC}(monto_total)),0) AS total
    FROM documentos WHERE ${whereSql} AND ${WHERE_VIVOS}
  `).get(...params)

  const docs = db.prepare(`
    SELECT id, tipo_doc, folio, rut_contraparte, razon_social, fecha_docto,
           monto_exento,
           ${SIGNO_NC}(monto_neto) AS monto_neto,
           ${SIGNO_NC}(monto_iva) AS monto_iva,
           ${SIGNO_NC}(monto_total) AS monto_total,
           estado
    FROM documentos
    WHERE ${whereSql} AND ${WHERE_VIVOS}
    ORDER BY fecha_docto DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 100, 1000), Number(offset) || 0)

  return { total: sumas.n, neto: sumas.neto, monto_total: sumas.total, movimientos: docs }
}

/**
 * Cartera de clientes (§C) con segmentación EXPLÍCITA (la regla viaja en la
 * respuesta para que nadie adivine):
 *   cuidar     = compró el período Y el previo
 *   desarrollar= compró SOLO el período (nuevo o reactivado)
 *   recuperar  = compró SOLO el previo (en riesgo)
 *   controlar  = sin compras en ambos, pero activo en la ventana histórica
 * Ventana histórica por defecto: 12 meses hacia atrás.
 */
function cartera(db, { empresaId, periodo, ventana = 12 }) {
  const previo = periodoPrevio(periodo)
  const y = Number(String(periodo).slice(0, 4))
  const m = Number(String(periodo).slice(4))
  let yy = y, mm = m
  for (let i = 0; i < ventana; i++) { mm--; if (mm <= 0) { mm += 12; yy-- } }
  const desdeHist = `${yy}${String(mm).padStart(2, '0')}`

  const filas = db.prepare(`
    SELECT rut_contraparte AS rut, MAX(razon_social) AS razon_social,
           SUM(CASE WHEN periodo_ingesta = ? THEN 1 ELSE 0 END) AS docs_act,
           SUM(CASE WHEN periodo_ingesta = ? THEN 1 ELSE 0 END) AS docs_prev,
           SUM(CASE WHEN periodo_ingesta = ? THEN ${SIGNO_NC}(monto_neto) ELSE 0 END) AS neto_act,
           SUM(CASE WHEN periodo_ingesta = ? THEN ${SIGNO_NC}(monto_neto) ELSE 0 END) AS neto_prev,
           MAX(CASE WHEN periodo_ingesta >= ? THEN 1 ELSE 0 END) AS historico
    FROM documentos
    WHERE empresa_id = ? AND tipo_flujo = 'venta' AND ${WHERE_VIVOS}
      AND periodo_ingesta >= ?
    GROUP BY rut_contraparte
  `).all(periodo, previo, periodo, previo, desdeHist, empresaId, desdeHist)

  const clientes = filas.map((f) => {
    let segmento
    if (f.docs_act > 0 && f.docs_prev > 0) segmento = 'cuidar'
    else if (f.docs_act > 0) segmento = 'desarrollar'
    else if (f.docs_prev > 0) segmento = 'recuperar'
    else if (f.historico) segmento = 'controlar'
    else segmento = 'sin_datos'
    return {
      rut: f.rut,
      razon_social: f.razon_social,
      docs_periodo: f.docs_act,
      docs_previo: f.docs_prev,
      neto_periodo: f.neto_act,
      neto_previo: f.neto_prev,
      variacion_pct: (f.docs_act > 0 && f.docs_prev > 0 && f.neto_prev > 0)
        ? Math.round(((f.neto_act - f.neto_prev) / f.neto_prev) * 1000) / 10
        : null,
      segmento,
    }
  })

  const resumenSegmentos = { cuidar: 0, desarrollar: 0, recuperar: 0, controlar: 0, sin_datos: 0 }
  for (const c of clientes) resumenSegmentos[c.segmento]++

  return {
    periodo,
    periodo_previo: previo,
    regla: 'cuidar = compró período y previo; desarrollar = solo el período; recuperar = solo el previo; controlar = sin compras en ambos pero activo en los últimos 12 meses; sin_datos = sin documentos en la ventana (no se califica como perdido)',
    resumen: resumenSegmentos,
    clientes,
  }
}

/** Catálogo para el constructor de reportes (§H). */
function catalogo() {
  return CATALOGO
}

/**
 * Serie mensual INTERACTIVA (dashboard §A): los últimos `meses` (1..24) a
 * partir del mes ancla `hasta` (AAAAMM; default: el último con RCV de ese
 * flujo, o el mes en curso si la empresa recién parte). Meses SIN documentos
 * quedan en `null` (nunca 0: sin datos ≠ cero, §7) — el front los pinta vacíos.
 * Difiere de serie_anual del resumen (que fija el año calendario): esta es la
 * que alimenta el rango móvil y las DOS series del dashboard (hasta 36 meses
 * = los 3 años que el botón SINCRONIZAR trae del SII).
 */
function serie(db, { empresaId, meses = 12, hasta = null, flujo = 'venta' }) {
  const f = flujo === 'compra' ? 'compra' : 'venta'
  const n = Math.min(Math.max(Number(meses) || 12, 1), 36)

  // Ancla: mes explícito > último con datos del flujo > mes en curso.
  let fin = String(hasta || '').replace(/\D/g, '').slice(0, 6)
  if (!/^\d{6}$/.test(fin)) {
    const r = db.prepare(
      `SELECT MAX(periodo_ingesta) AS p FROM documentos WHERE empresa_id = ? AND tipo_flujo = ?`
    ).get(empresaId, f)
    if (r && r.p) fin = String(r.p)
  }
  if (!/^\d{6}$/.test(fin)) {
    const d = new Date()
    fin = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  // Lista de períodos descendente desde `fin` hacia atrás, luego ascendente.
  let y = Number(fin.slice(0, 4)), m = Number(fin.slice(4))
  const periodos = []
  for (let i = 0; i < n; i++) {
    periodos.push(`${y}${String(m).padStart(2, '0')}`)
    m--; if (m <= 0) { m += 12; y-- }
  }
  periodos.reverse()
  const desde = periodos[0]

  const rows = db.prepare(`
    SELECT periodo_ingesta AS p, COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto, COUNT(*) AS docs
    FROM documentos
    WHERE empresa_id = ? AND tipo_flujo = ? AND ${WHERE_VIVOS}
      AND periodo_ingesta >= ? AND periodo_ingesta <= ?
    GROUP BY 1
  `).all(empresaId, f, desde, fin)
  const mapa = new Map(rows.map((r) => [r.p, r]))

  return {
    flujo: f,
    desde,
    hasta: fin,
    meses: periodos.map((p) => {
      const r = mapa.get(p)
      return { periodo: p, neto: r ? r.neto : null, docs: r ? r.docs : 0 }
    }),
  }
}

module.exports = { CATALOGO, resumen, resumenDuo, movimientos, cartera, catalogo, serie, periodoPrevio }
