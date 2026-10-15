/**
 * ANALÍTICA TRIBUTARIA — dashboard de libros de compra y venta (agregaciones).
 *
 * Deriva TODO de la bandeja `documentos` (misma fuente que los libros): nada
 * digitado, nada inventado. Agregaciones en SQL + validaciones locales:
 *   - Resumen mensual del año (ventas, compras, IVA débito/crédito, docs).
 *   - Top 20 clientes y proveedores por monto total del año.
 *   - Alertas de calidad de datos: folios duplicados por contraparte+tipo y
 *     RUTs con DV inválido (M11) detectados en las contrapartes del RCV.
 *   - Resumen ejecutivo (variaciones mes a mes del último tramo).
 *
 * Módulo puro: recibe la BD por parámetro (testeable) y NUNCA muta.
 */

const ORDEN_MESES = ['01','02','03','04','05','06','07','08','09','10','11','12']
const { SIGNO_NC } = require('./sii-convenios')

/** Validación de dígito verificador chileno (M11). Acepta cuerpo string numérico + dv. */
function dvM11(cuerpo) {
  let sum = 0
  let mult = 2
  const c = String(cuerpo)
  for (let i = c.length - 1; i >= 0; i--) {
    sum += Number(c[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const resto = 11 - (sum % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

/** Normaliza RUT crudo a {cuerpo, dv} o null si no tiene forma de RUT. */
function parseRutCrudo(rut) {
  const limpio = String(rut || '').replace(/[.\-\s]/g, '').toUpperCase()
  if (!/^\d{7,8}[\dK]$/.test(limpio)) return null
  return { cuerpo: limpio.slice(0, -1), dv: limpio.slice(-1) }
}

/**
 * Alertas de calidad sobre los documentos del año:
 *   - Facturas duplicadas: misma contraparte + tipo + folio (>1 documento vivo).
 *   - RUT inválidos: contraparte cuyo DV no calza con M11 (o RUT no parseable).
 * Solo cuenta documentos vigentes (excluye ANULADO y ERROR).
 */
function alertasCalidad(db, empresaId, desde, hasta) {
  const vivos = `empresa_id = ? AND periodo_ingesta BETWEEN ? AND ? AND estado NOT IN ('ANULADO','ERROR')`

  const duplicados = db.prepare(`
    SELECT rut_contraparte, tipo_doc, folio, COUNT(*) AS n,
           GROUP_CONCAT(razon_social, ' / ') AS razones
    FROM documentos
    WHERE ${vivos} AND folio IS NOT NULL AND folio != ''
      AND rut_contraparte != ''  -- boletas sin contraparte no son duplicado
    GROUP BY rut_contraparte, tipo_doc, folio
    HAVING COUNT(*) > 1
    ORDER BY n DESC, folio
    LIMIT 50
  `).all(empresaId, desde, hasta)

  const rutsFilas = db.prepare(`
    SELECT DISTINCT rut_contraparte, MAX(razon_social) AS razon_social
    FROM documentos
    WHERE ${vivos} AND rut_contraparte != ''  -- '' es boleta de consumidor final
    GROUP BY rut_contraparte
  `).all(empresaId, desde, hasta)

  const rutsInvalidos = rutsFilas
    .map((r) => {
      const p = parseRutCrudo(r.rut_contraparte)
      if (!p) return { rut: r.rut_contraparte, razon_social: r.razon_social, motivo: 'formato no reconocido' }
      const dvOk = dvM11(p.cuerpo)
      if (dvOk !== p.dv) return { rut: r.rut_contraparte, razon_social: r.razon_social, motivo: `DV esperado ${dvOk}, recibido ${p.dv}` }
      return null
    })
    .filter(Boolean)
    .slice(0, 50)

  return {
    duplicados: duplicados.map((d) => ({
      rut: d.rut_contraparte,
      tipo_doc: d.tipo_doc,
      folio: d.folio,
      n: d.n,
      razon_social: (d.razones || '').split(' / ')[0] || '',
    })),
    ruts_invalidos: rutsInvalidos,
  }
}

/**
 * Analítica completa de la empresa para un año (YYYY) o el año del período dado.
 */
function analitica(db, { empresaId, periodo = null }) {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')

  const per = String(periodo || '').replace(/\D/g, '').slice(0, 6)
  const anio = /^\d{6}$/.test(per) ? per.slice(0, 4) : String(new Date().getUTCFullYear())
  const desde = `${anio}01`
  const hasta = `${anio}12`
  const vivos = `empresa_id = ? AND periodo_ingesta BETWEEN ? AND ? AND estado NOT IN ('ANULADO','ERROR')`

  // ---------- resumen mensual del año ----------
  const filas = db.prepare(`
    SELECT periodo_ingesta AS p, tipo_flujo AS f,
           COUNT(*) AS docs,
           COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto,
           COALESCE(SUM(${SIGNO_NC}(monto_iva)), 0) AS iva,
           COALESCE(SUM(${SIGNO_NC}(monto_total)), 0) AS total
    FROM documentos
    WHERE ${vivos}
    GROUP BY 1, 2
  `).all(empresaId, desde, hasta)

  const meses = ORDEN_MESES.map((m) => {
    const p = `${anio}${m}`
    const v = filas.find((r) => r.p === p && r.f === 'venta') || { docs: 0, neto: 0, iva: 0, total: 0 }
    const c = filas.find((r) => r.p === p && r.f === 'compra') || { docs: 0, neto: 0, iva: 0, total: 0 }
    return {
      periodo: p,
      mes: Number(m),
      ventas: v.total,
      compras: c.total,
      iva_debito: v.iva,
      iva_credito: c.iva,
      iva_determinado: v.iva - c.iva,
      docs_venta: v.docs,
      docs_compra: c.docs,
    }
  })

  // ---------- top 20 clientes / proveedores (por total del año) ----------
  function top(flujos, limite = 20) {
    const filasTop = db.prepare(`
      SELECT rut_contraparte AS rut, MAX(razon_social) AS razon_social,
             COUNT(*) AS docs, COALESCE(SUM(${SIGNO_NC}(monto_total)), 0) AS total,
             COALESCE(SUM(${SIGNO_NC}(monto_neto)), 0) AS neto
      FROM documentos
      WHERE ${vivos} AND tipo_flujo IN (${flujos.map(() => '?').join(',')})
        AND rut_contraparte != ''  -- top de CONTRAPARTES REALES; las boletas sin RUT ya cuentan en las sumas globales
      GROUP BY rut_contraparte
      ORDER BY total DESC
      LIMIT ?
    `).all(empresaId, desde, hasta, ...flujos, limite)
    return filasTop
  }
  const topClientes = top(['venta'])
  const topProveedores = top(['compra'])

  // ---------- comparativo con el año anterior (variaciones) ----------
  const prev = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo_flujo = 'venta' THEN ${SIGNO_NC}(monto_total) ELSE 0 END), 0) AS ventas,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'compra' THEN ${SIGNO_NC}(monto_total) ELSE 0 END), 0) AS compras,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'venta' THEN ${SIGNO_NC}(monto_iva) ELSE 0 END), 0) AS iva_ventas,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'compra' THEN ${SIGNO_NC}(monto_iva) ELSE 0 END), 0) AS iva_compras
    FROM documentos
    WHERE ${vivos}
  `).get(empresaId, `${Number(anio) - 1}01`, `${Number(anio) - 1}12`)

  const actuales = meses.reduce((a, m) => ({
    ventas: a.ventas + m.ventas,
    compras: a.compras + m.compras,
    iva_debito: a.iva_debito + m.iva_debito,
    iva_credito: a.iva_credito + m.iva_credito,
    docs: a.docs + m.docs_venta + m.docs_compra,
  }), { ventas: 0, compras: 0, iva_debito: 0, iva_credito: 0, docs: 0 })

  const variacion = (actual, anterior) =>
    anterior > 0 ? Math.round(((actual - anterior) / anterior) * 100) : null

  // ---------- alertas de calidad ----------
  const calidad = alertasCalidad(db, empresaId, desde, hasta)

  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    anio,
    meses,
    anual: {
      ventas: actuales.ventas,
      compras: actuales.compras,
      iva_debito: actuales.iva_debito,
      iva_credito: actuales.iva_credito,
      iva_determinado: actuales.iva_debito - actuales.iva_credito,
      docs: actuales.docs,
      anio_anterior: {
        ventas: prev.ventas,
        compras: prev.compras,
        iva_determinado: prev.iva_ventas - prev.iva_compras,
      },
      variacion_ventas_pct: variacion(actuales.ventas, prev.ventas),
      variacion_compras_pct: variacion(actuales.compras, prev.compras),
      variacion_iva_pct: variacion(actuales.iva_debito - actuales.iva_credito, prev.iva_ventas - prev.iva_compras),
    },
    top_clientes: topClientes,
    top_proveedores: topProveedores,
    calidad,
    resumen_ejecutivo: {
      ventas: actuales.ventas,
      compras: actuales.compras,
      resultado_comercial: actuales.ventas - actuales.compras,
      iva_determinado: actuales.iva_debito - actuales.iva_credito,
      alertas_n: calidad.duplicados.length + calidad.ruts_invalidos.length,
    },
  }
}

module.exports = { analitica, alertasCalidad, dvM11, parseRutCrudo }
