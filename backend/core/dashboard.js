/**
 * DASHBOARD OPERATIVO (PROMPT MAESTRO §9/§10/§35) — agregación de un período.
 *
 * Una sola función que junta lo que el Inicio necesita para priorizar acciones:
 *   - KPIs financieros: ER del mes + acumulado del año (derivado de asiento_lineas,
 *     nada digitado) y deuda CxP/CxC por alias de control.
 *   - Situación contable: documentos por estado (§5), asientos del período con
 *     ΣD = ΣH, distinguiendo lo contabilizado de lo pendiente de decisión humana (§43).
 *   - Conciliación SII↔contable del período (¿ejecutada?, ¿cuántas diferencias?).
 *   - Serie ventas/compras de los últimos 6 meses (para que el Inicio pinte la
 *     barra con UN solo fetch, no seis).
 *   - ALERTAS ACCIONABLES (§35): cada alerta nombra el problema, el porqué y a
 *     qué vista ir. Nada de módulos no implementados presentados como funcionales (§34).
 *
 * Módulo puro: recibe la BD como parámetro (testeable) y NUNCA muta — leer el
 * dashboard es siempre seguro. El resumen del resultado es PRE-cierre: el PPM
 * solo se devenga en el asiento de cierre (reportes.prepararCierre).
 */

const reportes = require('./reportes')
const conciliacion = require('./conciliacion')
const automatizacion = require('./automatizacion')
const onboarding = require('./onboarding')
const { SIGNO_NC } = require('./sii-convenios')

/** Estados que aún requieren trabajo humano antes de ser asiento (§5). */
const ESTADOS_PENDIENTES = ['PENDIENTE', 'CLASIFICADO', 'PROPUESTO', 'REVISION']
/** Orden canónico de la bandeja (§5) para presentar los conteos. */
const ORDEN_ESTADOS = ['PENDIENTE', 'CLASIFICADO', 'PROPUESTO', 'CONTABILIZADO', 'REVISION', 'ERROR', 'ANULADO']

function ultimoDiaDe(periodo) {
  const y = Number(periodo.slice(0, 4))
  const m = Number(periodo.slice(4))
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Últimos n períodos AAAAMM terminando en `hasta`, ascendente. */
function ultimosPeriodos(n, hasta) {
  const y = Number(hasta.slice(0, 4))
  const m = Number(hasta.slice(4))
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i
    let yy = y
    while (mm <= 0) { mm += 12; yy-- }
    out.push(`${yy}${String(mm).padStart(2, '0')}`)
  }
  return out
}

/**
 * Período a mostrar: el pedido si es AAAAMM válido; si no, el último con
 * actividad (documentos, asientos o períodos); si no hay nada, el mes actual UTC.
 */
function resolverPeriodo(db, empresaId, pedido) {
  if (pedido && /^\d{6}$/.test(String(pedido))) return String(pedido)
  const fila = db.prepare(`
    SELECT periodo FROM (
      SELECT periodo_ingesta AS periodo FROM documentos WHERE empresa_id = ?
      UNION SELECT periodo FROM asientos WHERE empresa_id = ?
      UNION SELECT periodo FROM periodos_contables WHERE empresa_id = ?
    ) ORDER BY periodo DESC LIMIT 1
  `).get(empresaId, empresaId, empresaId)
  if (fila) return fila.periodo
  const d = new Date()
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Saldo natural acumulado de un alias de control hasta `hasta` (ambas patas). */
function saldoAliasHasta(db, empresaId, alias, hasta) {
  const cta = db.prepare(
    `SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ? AND activa = 1 LIMIT 1`
  ).get(empresaId, alias)
  if (!cta) return null
  const s = db.prepare(`
    SELECT COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber
    FROM asiento_lineas al
    WHERE al.empresa_id = ? AND al.cuenta_id = ? AND EXISTS (
      SELECT 1 FROM asientos a WHERE a.id = al.asiento_id AND a.fecha <= ?
    )
  `).get(empresaId, cta.id, hasta)
  return { debe: s.debe, haber: s.haber }
}

/**
 * Alertas accionables del período (§35): severidad → mensaje → vista destino.
 * Orden final: error → warn → info → ok. Cada alerta es VERIFICADA contra la BD
 * (§43: nunca afirmar sin verificar) y su acción existe hoy (§34).
 */
function construirAlertas({ porEstado, totalAsientos, periodoAbierto, hayAnterioresSinCerrar, conc, reglas, onb, hayActividad }) {
  const get = (e) => porEstado.find((r) => r.estado === e)?.n || 0
  const sinClasificar = get('PENDIENTE')
  const enRevision = get('REVISION')
  const listosParaContabilizar = get('CLASIFICADO') + get('PROPUESTO')
  const alertas = []

  if (get('ERROR') > 0) {
    alertas.push({
      nivel: 'error',
      mensaje: `${get('ERROR')} documento(s) con error de ingesta`,
      detalle: 'Datos inconsistentes del RCV: revisa el período y anula o re-ingesta.',
      vista: 'documentos', etiqueta: 'Ver bandeja',
    })
  }
  if (reglas === 0) {
    alertas.push({
      nivel: 'warn',
      mensaje: 'Sin reglas contables',
      detalle: 'Sin reglas ningún documento se clasifica solo: instala las iniciales en un clic.',
      vista: 'automatizacion', etiqueta: 'Automatizar',
    })
  }
  if (sinClasificar > 0) {
    alertas.push({
      nivel: 'warn',
      mensaje: `${sinClasificar} documento(s) sin clasificar`,
      detalle: 'El motor de reglas los resuelve en un clic; lo que quede queda visible para decisión humana.',
      vista: 'automatizacion', etiqueta: 'Contabilizar ⚡',
    })
  }
  if (enRevision > 0) {
    alertas.push({
      nivel: 'warn',
      mensaje: `${enRevision} documento(s) en revisión`,
      detalle: 'Requieren decisión humana: el sistema jamás los contabiliza solo (§14).',
      vista: 'documentos', etiqueta: 'Revisar',
    })
  }
  if (listosParaContabilizar > 0) {
    alertas.push({
      nivel: 'info',
      mensaje: `${listosParaContabilizar} documento(s) listos para contabilizar`,
      detalle: 'Con cuenta asignada y propuesta pendiente de confirmar.',
      vista: 'automatizacion', etiqueta: 'Contabilizar ⚡',
    })
  }
  if (totalAsientos > 0 && !conc) {
    alertas.push({
      nivel: 'info',
      mensaje: 'Conciliación SII↔contable sin ejecutar',
      detalle: 'Compara la bandeja del RCV contra los asientos del período y explica cada diferencia.',
      vista: 'propuestas', etiqueta: 'Ejecutar',
    })
  }
  if (conc && conc.diferencias > 0) {
    const conteo = conc.resultado?.conteo_diferencias || {}
    const detalle = Object.entries(conteo).map(([k, v]) => `${k}: ${v}`).join(' · ')
    alertas.push({
      nivel: 'warn',
      mensaje: `${conc.diferencias} diferencia(s) SII↔contable`,
      detalle: detalle || 'Revisa el detalle documento a documento antes de cerrar.',
      vista: 'propuestas', etiqueta: 'Revisar',
    })
  }
  for (const p of hayAnterioresSinCerrar.slice(0, 2)) {
    alertas.push({
      nivel: 'info',
      mensaje: `Período ${p} con movimiento, sin cerrar`,
      detalle: 'Revisa el checklist y ciérralo: congela el período con asientos de cierre auditados.',
      vista: 'reportes', etiqueta: 'Ir a cierres',
    })
  }
  if (onb && !onb.completo) {
    alertas.push({
      nivel: 'warn',
      mensaje: `Onboarding: ${onb.pendientes} dato(s) por confirmar`,
      detalle: 'La ficha tributaria y el histórico alimentan libros y alertas; confírmalos cuando quieras.',
      vista: 'onboarding', etiqueta: 'Completar',
    })
  }
  if (!periodoAbierto && hayActividad) {
    alertas.push({
      nivel: 'info',
      mensaje: 'Período CERRADO — solo consulta',
      detalle: 'Toda mutación está bloqueada; una reapertura queda auditada con motivo.',
      vista: 'reportes', etiqueta: 'Ver snapshot',
    })
  }
  if (alertas.length === 0) {
    alertas.push({
      nivel: 'ok',
      mensaje: periodoAbierto
        ? 'Período al día: todo contabilizado y conciliado'
        : 'Período cerrado y conciliado',
      detalle: periodoAbierto
        ? 'Puedes cerrarlo: asientos de IVA, PPM y resultado propuestos y auditados.'
        : 'Los asientos de cierre quedaron en el snapshot del período.',
      vista: 'reportes', etiqueta: periodoAbierto ? 'Cerrar período' : 'Ver snapshot',
    })
  }
  const orden = { error: 0, warn: 1, info: 2, ok: 3 }
  return alertas.sort((a, b) => orden[a.nivel] - orden[b.nivel])
}

/**
 * Agregado completo del dashboard de una empresa para un período.
 */
function dashboard(db, { empresaId, periodo = null }) {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')

  const per = resolverPeriodo(db, empresaId, periodo)
  const hasta = ultimoDiaDe(per)

  // ---------- documentos (bandeja §5) ----------
  const porEstado = db.prepare(`
    SELECT estado, COUNT(*) AS n FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? GROUP BY estado
  `).all(empresaId, per)
  const get = (e) => porEstado.find((r) => r.estado === e)?.n || 0
  const docsTotal = porEstado.reduce((s, r) => s + r.n, 0)
  const docsContabilizados = get('CONTABILIZADO')
  const docsSinContabilizar = ESTADOS_PENDIENTES.reduce((s, e) => s + get(e), 0)

  // Totales del RCV del período, excluyendo lo anulado/error (evidencia real).
  // Convención SII compartida (sii-convenios.SIGNO_NC): las NC (60/61) ALCANZAN
  // la bandeja con montos positivos — restan UNA vez aquí, igual que en portal,
  // reportes y libro del sii.js.
  const tot = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo_flujo = 'venta' THEN ${SIGNO_NC}(monto_total) ELSE 0 END), 0) AS ventas,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'compra' THEN ${SIGNO_NC}(monto_total) ELSE 0 END), 0) AS compras,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'venta' THEN ${SIGNO_NC}(monto_iva) ELSE 0 END), 0) AS iva_ventas,
      COALESCE(SUM(CASE WHEN tipo_flujo = 'compra' THEN ${SIGNO_NC}(monto_iva) ELSE 0 END), 0) AS iva_compras
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ? AND estado NOT IN ('ANULADO', 'ERROR')
  `).get(empresaId, per)

  // ---------- asientos del período ----------
  const nAsientos = db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ? AND periodo = ?`).get(empresaId, per).n
  const dh = db.prepare(`
    SELECT COALESCE(SUM(al.debe), 0) AS debe, COALESCE(SUM(al.haber), 0) AS haber
    FROM asiento_lineas al JOIN asientos a ON a.id = al.asiento_id
    WHERE a.empresa_id = ? AND a.periodo = ?
  `).get(empresaId, per)

  // ---------- estado del período + períodos ----------
  const filaPeriodo = db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id = ? AND periodo = ?`).get(empresaId, per)
  const periodoAbierto = !filaPeriodo || filaPeriodo.estado === 'ABIERTO'
  const periodosDisponibles = db.prepare(`
    SELECT p.periodo, p.estado FROM (
      SELECT periodo_ingesta AS periodo FROM documentos WHERE empresa_id = ?
      UNION SELECT periodo FROM asientos WHERE empresa_id = ?
      UNION SELECT periodo FROM periodos_contables WHERE empresa_id = ?
    ) pp LEFT JOIN periodos_contables p ON p.empresa_id = ? AND p.periodo = pp.periodo
    GROUP BY pp.periodo ORDER BY pp.periodo DESC LIMIT 12
  `).all(empresaId, empresaId, empresaId, empresaId)

  const movPorPeriodo = new Map(
    db.prepare(`SELECT periodo, COUNT(*) AS n FROM asientos WHERE empresa_id = ? GROUP BY periodo`).all(empresaId).map((r) => [r.periodo, r.n])
  )
  const hayAnterioresSinCerrar = periodosDisponibles
    .filter((p) => p.periodo < per && (!p.estado || p.estado === 'ABIERTO') && (movPorPeriodo.get(p.periodo) || 0) > 0)
    .map((p) => p.periodo)

  // ---------- reportes (ER derivado de asiento_lineas) ----------
  const er = reportes.estadoResultados(db, empresaId, per)

  // ---------- deuda por alias de control (§20/§21) ----------
  const prov = saldoAliasHasta(db, empresaId, 'PROVEEDORES', hasta)
  const cli = saldoAliasHasta(db, empresaId, 'CLIENTES', hasta)

  // ---------- conciliación (última persistida del período) ----------
  const conc = conciliacion.obtener(db, empresaId, per)

  // ---------- automatización (§43: distinción automático vs humano) ----------
  const auto = automatizacion.estado(db, { empresaId, periodo: per })

  // ---------- onboarding (SAAS-2) — resiliente: si falla, el dashboard sigue ----------
  let onb = null
  try {
    const f = onboarding.ficha(db, empresaId)
    onb = { completo: f.completo, pendientes: f.pendientes_humano.length }
  } catch { onb = null }

  // ---------- serie de los últimos 6 meses (un fetch para la barra) ----------
  const desde = ultimosPeriodos(6, per)[0]
  const filasSerie = db.prepare(`
    SELECT periodo_ingesta AS p, tipo_flujo AS f, SUM(${SIGNO_NC}(monto_total)) AS t
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta BETWEEN ? AND ? AND estado NOT IN ('ANULADO', 'ERROR')
    GROUP BY 1, 2
  `).all(empresaId, desde, per)
  const serie = ultimosPeriodos(6, per).map((p) => ({
    periodo: p,
    ventas: filasSerie.find((r) => r.p === p && r.f === 'venta')?.t || 0,
    compras: filasSerie.find((r) => r.p === p && r.f === 'compra')?.t || 0,
  }))

  const claveSiiConfigurada = !!db.prepare(
    `SELECT clave_sii FROM empresas WHERE id = ? AND clave_sii IS NOT NULL AND clave_sii != ''`
  ).get(empresaId)

  const alertas = construirAlertas({
    porEstado,
    totalAsientos: nAsientos,
    periodoAbierto,
    hayAnterioresSinCerrar,
    conc: conc ? { diferencias: conc.diferencias, resultado: conc.resultado } : null,
    reglas: auto.reglas_activas,
    onb,
    hayActividad: docsTotal > 0 || nAsientos > 0,
  })

  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    clave_sii_configurada: claveSiiConfigurada,
    periodo: per,
    periodo_cerrado: !periodoAbierto,
    periodos_disponibles: periodosDisponibles.map((p) => ({ periodo: p.periodo, estado: p.estado || null })),
    kpis: {
      ventas: tot.ventas,
      compras: tot.compras,
      iva_determinado: tot.iva_ventas - tot.iva_compras,
      ingresos: er.periodo_mes.ingresos,
      costos: er.periodo_mes.costos,
      gastos: er.periodo_mes.gastos,
      resultado: er.periodo_mes.resultado,
      ingresos_acum: er.acumulado.ingresos,
      resultado_acum: er.acumulado.resultado,
      docs_total: docsTotal,
      docs_contabilizados: docsContabilizados,
      docs_sin_contabilizar: docsSinContabilizar,
      docs_error: get('ERROR'),
      asientos_n: nAsientos,
      asientos_cuadrado: dh.debe === dh.haber,
      cxp: prov ? prov.haber - prov.debe : null, // saldo acreedor de proveedores
      cxc: cli ? cli.debe - cli.haber : null,    // saldo deudor de clientes
    },
    conciliacion: conc
      ? { ejecutada: true, ejecutada_en: conc.ejecutado_en, diferencias: conc.diferencias, conteo: conc.resultado?.conteo_diferencias || {} }
      : { ejecutada: false, ejecutada_en: null, diferencias: null, conteo: {} },
    automatizacion: {
      reglas_activas: auto.reglas_activas,
      sin_resolver: auto.sin_resolver,
      propuestas_pendientes: auto.propuestas_pendientes,
    },
    serie,
    onboarding: onb,
    alertas,
  }
}

module.exports = { dashboard, resolverPeriodo, ultimosPeriodos, ultimoDiaDe, ORDEN_ESTADOS, ESTADOS_PENDIENTES }
