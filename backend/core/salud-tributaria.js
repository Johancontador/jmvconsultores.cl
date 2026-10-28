/**
 * salud-tributaria.js — «Consulta Salud Tributaria» (2026-10-21).
 *
 * REGLA DE ORO: este módulo NUNCA inventa un dato del SII. Cada sección del
 * informe declara su FUENTE y, cuando el sistema no tiene una conexión
 * verificada, lo dice con estado `no_integrado` en vez de mostrar un cero o
 * un «al día» engañoso.
 *
 * Fuentes REALES disponibles hoy:
 *  1. Ficha oficial del contribuyente (mismo login de sii-session.js →
 *     misiir.sii.cl DatosCntrNow), guardada en data/sii-fichas/<rut>.json:
 *     identidad, inicio/término de giro, actividades, dirección, capital,
 *     atributos (régimen) y alertas del SII, verbatim.
 *  2. RCV de compras y ventas ya ingerido en `documentos` (o su caché de
 *     períodos cerrados). De ahí se derivan ingresos, IVA y PPM ESTIMADOS.
 *
 * Lo que NO existe como integración (y por eso se declara `no_integrado`):
 *  - Consulta del estado de declaraciones F29.
 *  - Estado de declaraciones de renta (F22).
 *  - Declaraciones juradas.
 *  - Boletas de honorarios emitidas/recibidas.
 *  - «Ingresos de años anteriores» como consulta oficial: solo se muestran
 *    los años que estén cubiertos por RCV ingerido (`parcial`).
 *
 * Módulo puro respecto de la red: recibe la BD y la ficha; la ruta decide si
 * refresca la ficha contra el SII (empresas-sii.consultarFichaSii).
 */

const { calcularIVA, calcularIVAConRemanente, calcularPPM, calcularTotalF29 } = require('../services/calculos')
const deudaTgr = require('./deuda-tgr')

const REGEX_PERIODO = /^\d{6}$/
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Matriz de capacidades REALES de la conexión SII de este repositorio.
// `evidencia` apunta al archivo que la implementa: si se agrega una conexión
// nueva, se actualiza aquí y el informe lo refleja sin tocar la UI.
const CAPACIDADES_SII = [
  {
    id: 'ficha_contribuyente',
    nombre: 'Ficha del contribuyente (identidad, giro, dirección, capital, régimen)',
    estado: 'disponible',
    fuente: 'misiir.sii.cl / DatosCntrNow',
    evidencia: 'backend/core/empresas-sii.js',
    detalle: 'Se obtiene con el login tributario ya existente y se guarda en data/sii-fichas/<rut>.json.',
  },
  {
    id: 'rcv',
    nombre: 'Registro de Compras y Ventas (RCV) por período',
    estado: 'disponible',
    fuente: 'www4.sii.cl facadeService (getResumen / getDetalle*Export)',
    evidencia: 'backend/services/sii-rcv.js',
    detalle: 'Compras y ventas documento a documento, con paginación y caché de períodos cerrados.',
  },
  {
    id: 'ingresos_historicos',
    nombre: 'Ingresos de años anteriores',
    estado: 'parcial',
    fuente: 'Derivado del RCV ingerido',
    evidencia: 'backend/core/salud-tributaria.js',
    detalle: 'Solo cubre los meses con RCV ingerado. NO existe una consulta oficial de ingresos históricos implementada.',
  },
  {
    id: 'f29_estado',
    nombre: 'Estado y monto de las declaraciones F29',
    estado: 'disponible',
    fuente: 'www4.sii.cl/sifmConsultaInternet — Consulta Integral F29 + Búsqueda de Formularios',
    evidencia: 'backend/core/declaraciones-sii.js',
    detalle: 'Fuente: SII. Por período: declarada/pendiente, folio, fecha de presentación y monto declarado (búsqueda anual, 6 años disponibles).',
  },
  {
    id: 'f29_formulario_compacto',
    nombre: 'Formulario Compacto del F29 (casillas declaradas)',
    estado: 'disponible',
    fuente: 'www4.sii.cl/rfiInternet/formCompacto (Consulta Integral F29 → Formulario Compacto)',
    evidencia: 'backend/core/declaraciones-sii.js + backend/core/f29-formulario.js',
    detalle: 'Descarga el PDF del F29 tal como se presentó y extrae sus casillas (ventas, compras, IVA, PPM, total a pagar). Es la verdad declarada: permite contrastar el RCV del sistema contra lo declarado.',
  },
  {
    id: 'renta_f22',
    nombre: 'Estado de declaraciones de renta (F22)',
    estado: 'disponible',
    fuente: 'www4.sii.cl/consultaestadof22ui — Consulta de Estado de Renta',
    evidencia: 'backend/core/renta-sii.js',
    detalle: 'Por año: folio, código de concordancia, situación vigente/no vigente, fecha de tramitación, remanente solicitado/devuelto, glosa textual del SII e historial de eventos.',
  },
  {
    id: 'declaraciones_juradas',
    nombre: 'Declaraciones juradas presentadas',
    estado: 'disponible',
    fuente: 'www4.sii.cl/perfilamientodjui — Mis Declaraciones Juradas',
    evidencia: 'backend/core/dj-sii.js',
    detalle: 'Por año tributario: formulario (1887, 1879, 1947…), estado (Aceptada), folio, fecha de presentación, vencimiento y clasificación. Se lee de la fachada JSON del SII con la misma sesión del contribuyente.',
  },
  {
    id: 'boletas_honorarios',
    nombre: 'Boletas de honorarios emitidas y recibidas',
    estado: 'disponible',
    fuente: 'loa.sii.cl — Informe Anual de Boletas de Honorarios Electrónicas',
    evidencia: 'backend/core/declaraciones-sii.js',
    detalle: 'Totales anuales por mes (honorario bruto, retenciones y líquido) para emitidas y recibidas, 5 años.',
  },
]

// Matriz de capacidades de la TESORERÍA (TGR). Va aparte de las del SII a
// propósito: la deuda fiscal NO la emite el SII, la emite la Tesorería, y el
// informe no debe atribuirle al SII un dato que no entrega.
const CAPACIDADES_TGR = [
  {
    id: 'deuda_fiscal',
    nombre: 'Deuda fiscal y certificado de deuda',
    estado: 'disponible',
    fuente: 'tgr.gob.cl — Certificado de Deuda Fiscal',
    evidencia: 'backend/core/deuda-tgr.js',
    detalle: 'Autentica en la TGR con la MISMA clave tributaria del SII (Clave Tributaria), descarga el certificado oficial en PDF y extrae su texto. El PDF se guarda como evidencia en data/certificados-tgr/.',
  },
]

function periodoValido(periodo) {
  if (!REGEX_PERIODO.test(String(periodo || ''))) return false
  const mes = Number(String(periodo).slice(4, 6))
  return mes >= 1 && mes <= 12
}

/** Últimos n períodos terminando en `hasta`, ascendente. */
function ultimosPeriodos(n, hasta) {
  const y = Number(hasta.slice(0, 4))
  const m = Number(hasta.slice(4, 6))
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i
    let yy = y
    while (mm <= 0) { mm += 12; yy-- }
    out.push(`${yy}${String(mm).padStart(2, '0')}`)
  }
  return out
}

function signoSQL(col) {
  return `SUM(CASE WHEN tipo_doc IN (60, 61) THEN -${col} ELSE ${col} END)`
}

function docsPorPeriodo(db, empresaId, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo_ingesta AS periodo, tipo_flujo,
           COUNT(*) AS n,
           ${signoSQL('monto_neto')} AS neto,
           ${signoSQL('monto_iva')} AS iva,
           ${signoSQL('monto_exento')} AS exento,
           ${signoSQL('monto_total')} AS total
    FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta BETWEEN ? AND ?
    GROUP BY periodo_ingesta, tipo_flujo
  `).all(empresaId, desde, hasta)
  const mapa = new Map()
  for (const f of filas) {
    const actual = mapa.get(f.periodo) || { compras: null, ventas: null }
    // tipo_flujo viene en singular ('compra' | 'venta'); el consumidor lee
    // plural. Sin esta normalización TODOS los meses quedaban en cero.
    actual[f.tipo_flujo === 'venta' ? 'ventas' : 'compras'] = f
    mapa.set(f.periodo, actual)
  }
  return mapa
}

function ingresosPorAnio(db, empresaId) {
  const filas = db.prepare(`
    SELECT substr(periodo_ingesta, 1, 4) AS anio, tipo_flujo,
           COUNT(*) AS n, COUNT(DISTINCT periodo_ingesta) AS meses,
           ${signoSQL('monto_neto')} AS neto,
           ${signoSQL('monto_iva')} AS iva
    FROM documentos
    WHERE empresa_id = ?
    GROUP BY anio, tipo_flujo
    ORDER BY anio DESC
  `).all(empresaId)
  const porAnio = new Map()
  for (const f of filas) {
    const a = porAnio.get(f.anio) || {
      anio: f.anio, ventas_neto: 0, ventas_iva: 0, compras_neto: 0, compras_iva: 0,
      documentos: 0, meses_con_datos: 0,
    }
    if (f.tipo_flujo === 'venta') {
      a.ventas_neto += f.neto || 0
      a.ventas_iva += f.iva || 0
    } else if (f.tipo_flujo === 'compra') {
      a.compras_neto += f.neto || 0
      a.compras_iva += f.iva || 0
    }
    a.documentos += f.n || 0
    porAnio.set(f.anio, a)
  }
  return [...porAnio.values()].map((a) => {
    // meses_con_datos: unión real de períodos con documentos (se recalcula
    // desde `documentos` para no depender de COUNT(DISTINCT) por flujo).
    const periodos = db.prepare(`
      SELECT COUNT(DISTINCT periodo_ingesta) AS n
      FROM documentos WHERE empresa_id = ? AND substr(periodo_ingesta, 1, 4) = ?
    `).get(empresaId, a.anio).n
    return { ...a, meses_con_datos: periodos, iva_estimado: calcularIVA(a.ventas_iva, a.compras_iva) }
  })
}

function cacheVacio(db, rut, periodo, flujo) {
  const fila = db.prepare(`SELECT datos FROM rcv_cache WHERE rut = ? AND periodo = ? AND tipo = ?`).get(rut, periodo, flujo)
  if (!fila) return false
  try {
    const datos = JSON.parse(fila.datos)
    return Array.isArray(datos) && datos.length === 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Declaraciones OFICIALES (tabla declaraciones_sii, escrita por
// core/declaraciones-sii.js a partir del portal autenticado del SII).
// Se leen por período; si no hay fila, el estado es `no_consultado` — nunca
// `al día` ni cero.
// ---------------------------------------------------------------------------

const ETIQUETA_ESTADO_DECL = {
  declarada: 'Declarada',
  rectificada: 'Declarada (con rectificatoria)',
  pendiente: 'Pendiente',
  no_presentada: 'No presentada',
  sin_informacion: 'Sin información',
}

function leerDeclaraciones(db, empresaId, tipo, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo, estado, folio, fecha_presentacion, monto_total, datos_json, consultado_en
    FROM declaraciones_sii
    WHERE empresa_id = ? AND tipo = ? AND periodo BETWEEN ? AND ?
    ORDER BY periodo
  `).all(empresaId, tipo, String(desde), String(hasta))
  const mapa = new Map()
  for (const f of filas) {
    let datos = null
    try { datos = JSON.parse(f.datos_json) } catch { datos = null }
    mapa.set(String(f.periodo), {
      ...f,
      periodo: String(f.periodo),
      // El F22 no expone un total a pagar en esta consulta; el campo histórico
      // guardaba devoluciones/giro y no es un total declarado.
      monto_total: tipo === 'F22' ? null : f.monto_total,
      datos,
    })
  }
  return mapa
}

/**
 * Un Formulario Compacto trae casillas sólo cuando el SII registra la
 * declaración; un período «No Declarante» llega con el folio y nada más.
 */
function compactoDeclarado(f) {
  return !!f && ((f.casillas || []).length > 0 || Object.keys(f.indicadores || {}).length > 0)
}

function resumenTipoDeclaraciones(mapa, { desde, hasta, etiquetaBase }) {
  if (!mapa.size) {
    return {
      estado: 'no_consultado',
      etiqueta: `${etiquetaBase} no consultada`,
      detalle: 'Sin consulta registrada para este rango. Ejecuta la sincronización de declaraciones.',
      consultadas: 0,
      ultima_consulta: null,
    }
  }
  const valores = [...mapa.values()]
  const declaradas = valores.filter((d) => d.estado === 'declarada' || d.estado === 'rectificada').length
  const pendientes = valores.filter((d) => d.estado === 'pendiente' || d.estado === 'no_presentada').length
  const ultima = valores.reduce((max, d) => (d.consultado_en > max ? d.consultado_en : max), '')
  // Rango REAL de lo consultado (no el pedido): si el SII solo tiene desde
  // 2022, decir «202111–202610» infla la cobertura ante el lector.
  const periodos = valores.map((d) => d.periodo).sort()
  return {
    estado: 'disponible',
    etiqueta: `${etiquetaBase} consultada`,
    detalle: `${declaradas} declarada(s), ${pendientes} pendiente(s) en ${periodos[0]}–${periodos[periodos.length - 1]}.`,
    consultadas: valores.length,
    declaradas,
    pendientes,
    ultima_consulta: ultima || null,
    desde: periodos[0],
    hasta: periodos[periodos.length - 1],
  }
}

function nombrePeriodo(periodo) {
  const mes = Number(periodo.slice(4, 6))
  return `${MESES[mes - 1] || mes} ${periodo.slice(0, 4)}`
}

/** Normaliza la ficha persistida en empresas cuando no hay JSON crudo. */
function fichaDesdeEmpresa(emp) {
  const parse = (v, fallback) => {
    try { return JSON.parse(v) } catch { return fallback }
  }
  return {
    rut: emp.rut,
    nombre: emp.razon_social_sii || emp.nombre,
    inicioActividades: emp.inicio_actividades || null,
    terminoGiro: null,
    regimen: emp.regimen_tributario || null,
    regimenAtributo: null,
    actividades: parse(emp.actividades_json, []) || [],
    telefono: emp.telefono || null,
    email: null,
    tipoContribuyente: null,
    direccion: null,
    direcciones: [],
    capital: null,
    unidadOperativa: null,
    alertas: [],
    atributos: [],
    origen: 'empresas (ficha SII no descargada)',
  }
}

function hallazgo(codigo, severidad, titulo, detalle, fuente) {
  return { codigo, severidad, titulo, detalle, fuente }
}

// ---------------------------------------------------------------------------
// LECTURAS NUEVAS (v2 del informe)
// ---------------------------------------------------------------------------

/**
 * Formularios Compactos leídos del SII: una fila por período con las CASILLAS
 * declaradas. Es la contraparte oficial del F29 estimado desde el RCV.
 */
function leerFormulariosF29(db, empresaId, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo, folio, estado, situacion, monto_observado, declaraciones_vigentes,
           intentos, indicadores_json, casillas_json, verificaciones_json, eventos_json,
           url, consultado_en
    FROM f29_formularios
    WHERE empresa_id = ? AND periodo BETWEEN ? AND ?
    ORDER BY periodo
  `).all(empresaId, String(desde), String(hasta))
  const mapa = new Map()
  for (const f of filas) {
    const parse = (v, def) => { try { return JSON.parse(v) } catch { return def } }
    mapa.set(String(f.periodo), {
      periodo: String(f.periodo),
      folio: f.folio || null,
      estado: f.estado || null,
      situacion: f.situacion || null,
      monto_observado: f.monto_observado == null ? null : Number(f.monto_observado),
      declaraciones_vigentes: f.declaraciones_vigentes == null ? null : Number(f.declaraciones_vigentes),
      intentos: f.intentos == null ? null : Number(f.intentos),
      indicadores: parse(f.indicadores_json, {}),
      casillas: parse(f.casillas_json, []),
      verificaciones: parse(f.verificaciones_json, []),
      eventos: parse(f.eventos_json, []),
      url: f.url || null,
      consultado_en: f.consultado_en || null,
    })
  }
  return mapa
}

/** Declaraciones de renta (F22) por año, con su glosa e historial de eventos. */
function leerRenta(db, empresaId, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo, estado, folio, fecha_presentacion, monto_total, datos_json, consultado_en
    FROM declaraciones_sii
    WHERE empresa_id = ? AND tipo = 'F22' AND periodo BETWEEN ? AND ?
    ORDER BY periodo
  `).all(empresaId, String(desde), String(hasta))
  const mapa = new Map()
  for (const f of filas) {
    let datos = null
    try { datos = JSON.parse(f.datos_json) } catch { datos = null }
    mapa.set(String(f.periodo), {
      anio: String(f.periodo),
      estado: f.estado || 'sin_informacion',
      folio: f.folio || null,
      fecha_presentacion: f.fecha_presentacion || null,
      // consultaestadof22ui no entrega el total a pagar del F22. La antigua
      // columna guardaba remanente/giro como si fuera monto total declarado.
      monto_total: null,
      resumen: {
        total_declarado: datos?.monto_total_declarado ?? null,
        remanente_solicitado: datos?.resumen?.remanente_solicitado ?? datos?.remanente_solicitado ?? null,
        remanente_devuelto: datos?.resumen?.remanente_devuelto ?? datos?.remanente_devuelto ?? null,
        monto_giro: datos?.resumen?.monto_giro ?? datos?.monto_giro ?? null,
      },
      glosa: datos?.glosa || null,
      concordancia: datos?.concordancia || null,
      cod_concordancia: datos?.cod_concordancia || null,
      situacion: datos?.situacion || null,
      situacion_etiqueta: datos?.situacion_etiqueta || null,
      fecha_vencimiento: datos?.fecha_vencimiento || null,
      remanente_solicitado: datos?.remanente_solicitado ?? null,
      remanente_devuelto: datos?.remanente_devuelto ?? null,
      monto_giro: datos?.monto_giro ?? null,
      url: datos?.url || (f.folio ? 'https://www4.sii.cl/consultaestadof22ui/' : null),
      eventos: Array.isArray(datos?.eventos) ? datos.eventos : [],
      observaciones: Array.isArray(datos?.observaciones) ? datos.observaciones : [],
      consultado_en: f.consultado_en || null,
    })
  }
  return mapa
}

/**
 * Declaraciones juradas PRESENTADAS (tipo 'DJ', una fila por año tributario).
 * La escribe core/dj-sii.js desde «Mis Declaraciones Juradas» del SII; si no
 * hay fila, el año no se consultó (no se asume que no existan).
 */
function leerJuradas(db, empresaId, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo, estado, consultado_en, datos_json
    FROM declaraciones_sii
    WHERE empresa_id = ? AND tipo = 'DJ' AND periodo BETWEEN ? AND ?
    ORDER BY periodo DESC
  `).all(empresaId, String(desde), String(hasta))
  const mapa = new Map()
  for (const f of filas) {
    let datos = {}
    try { datos = JSON.parse(f.datos_json || '{}') } catch { datos = {} }
    const presentadas = Array.isArray(datos.presentadas) ? datos.presentadas : []
    const pendientes = Array.isArray(datos.pendientes) ? datos.pendientes : []
    mapa.set(String(f.periodo), {
      anio: String(f.periodo),
      estado: f.estado || 'sin_informacion',
      presentadas,
      pendientes,
      total: presentadas.length,
      total_pendientes: pendientes.length,
      consultado_en: f.consultado_en || null,
    })
  }
  return mapa
}

/**
 * Estado de TESORERÍA para el informe: saldos bancarios, caja, movimientos del
 * mes, cobranza (con mora) y cuentas por pagar. Todo sale de las tablas del
 * sistema; si la empresa no usa tesorería, se declara 'sin_datos'.
 */
function resumenTesoreria(db, empresaId, { desde, hasta } = {}) {
  const salida = {
    estado: 'sin_datos',
    bancos: [],
    total_bancos: null,
    caja: null,
    mes_actual: null,
    cobranza: null,
    proveedores: null,
    conciliacion: null,
    nota: 'Sin movimientos de tesorería registrados para esta empresa.',
  }
  try {
    const bancos = db.prepare(`
      SELECT b.id, b.banco, b.numero, b.moneda, b.saldo, b.activo
      FROM bancos_cuentas b
      WHERE b.empresa_id = ? AND b.activo = 1
      ORDER BY b.saldo DESC
    `).all(empresaId)
    const total = bancos.reduce((s, b) => s + (Number(b.saldo) || 0), 0)
    salida.bancos = bancos.map((b) => ({ ...b, saldo: Number(b.saldo) || 0 }))
    salida.total_bancos = total
    if (bancos.length) salida.estado = 'disponible'

    // Caja (cuenta alias CAJA), si existe.
    const cta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'CAJA' AND activa = 1`).get(empresaId)
    if (cta) {
      const s = db.prepare(`
        SELECT COALESCE(SUM(debe),0) AS debe, COALESCE(SUM(haber),0) AS haber
        FROM asiento_lineas WHERE empresa_id = ? AND cuenta_id = ?
      `).get(empresaId, cta.id)
      salida.caja = (s.debe || 0) - (s.haber || 0)
    }

    // Flujos del mes en curso.
    const mes = new Date().toISOString().slice(0, 7)
    const flujos = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END), 0) AS ingresos,
        COALESCE(SUM(CASE WHEN monto < 0 THEN -monto ELSE 0 END), 0) AS egresos,
        COUNT(*) AS n
      FROM teso_movimientos WHERE empresa_id = ? AND substr(fecha,1,7) = ?
    `).get(empresaId, mes)
    salida.mes_actual = { mes, ingresos: flujos.ingresos, egresos: flujos.egresos, movimientos: flujos.n }

    // Cobranza (cuentas por cobrar) con nivel de mora.
    const cc = db.prepare(`
      SELECT d.rut_contraparte AS rut, d.razon_social, SUM(d.monto_total) AS saldo
      FROM documentos d
      WHERE d.empresa_id = ? AND d.tipo_flujo = 'venta' AND d.estado = 'CONTABILIZADO'
        AND d.asiento_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM teso_movimientos m
          WHERE m.documento_id = d.id AND ABS(m.monto) >= ABS(d.monto_total) - 1
        )
      GROUP BY d.rut_contraparte, d.razon_social
      HAVING saldo > 0
      ORDER BY saldo DESC
    `).all(empresaId)
    if (cc.length) {
      const hoy = new Date().toISOString().slice(0, 10)
      const vencidos = db.prepare(`
        SELECT d.rut_contraparte AS rut, d.fecha_docto, d.monto_total
        FROM documentos d
        WHERE d.empresa_id = ? AND d.tipo_flujo = 'venta' AND d.estado = 'CONTABILIZADO'
          AND d.asiento_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM teso_movimientos m
            WHERE m.documento_id = d.id AND ABS(m.monto) >= ABS(d.monto_total) - 1
          )
      `).all(empresaId)
      let dias = 0
      let vencidoPesos = 0
      let vencidos30 = 0
      for (const v of vencidos) {
        const d = Math.max(0, Math.floor((new Date(hoy) - new Date(v.fecha_docto || hoy)) / 86400e3))
        dias += d
        if (d > 30) { vencidoPesos += Number(v.monto_total) || 0; vencidos30++ }
      }
      const total = cc.reduce((s, c) => s + (Number(c.saldo) || 0), 0)
      salida.cobranza = {
        total,
        clientes: cc.length,
        dias_promedio: vencidos.length ? Math.round(dias / vencidos.length) : null,
        vencido_30_dias: vencidoPesos,
        documentos_vencidos_30: vencidos30,
        top: cc.slice(0, 5).map((c) => ({ rut: c.rut, razon_social: c.razon_social, saldo: Number(c.saldo) || 0 })),
      }
    }

    // Cuentas por pagar (compras contabilizadas sin pago).
    const cp = db.prepare(`
      SELECT d.rut_contraparte AS rut, d.razon_social, SUM(d.monto_total) AS saldo
      FROM documentos d
      WHERE d.empresa_id = ? AND d.tipo_flujo = 'compra' AND d.estado = 'CONTABILIZADO'
        AND d.asiento_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM teso_movimientos m
          WHERE m.documento_id = d.id AND ABS(m.monto) >= ABS(d.monto_total) - 1
        )
      GROUP BY d.rut_contraparte, d.razon_social
      HAVING saldo > 0
      ORDER BY saldo DESC
    `).all(empresaId)
    if (cp.length) {
      salida.proveedores = {
        total: cp.reduce((s, c) => s + (Number(c.saldo) || 0), 0),
        proveedores: cp.length,
        top: cp.slice(0, 5).map((c) => ({ rut: c.rut, razon_social: c.razon_social, saldo: Number(c.saldo) || 0 })),
      }
    }

    // Conciliación: movimientos de cartola pendientes vs. aplicados.
    const cartola = db.prepare(`
      SELECT COUNT(*) AS n, SUM(CASE WHEN aplicado = 1 THEN 1 ELSE 0 END) AS ok
      FROM teso_cartola WHERE empresa_id = ?
    `).get(empresaId)
    if (cartola && cartola.n) {
      salida.conciliacion = {
        total: cartola.n,
        conciliados: cartola.ok || 0,
        pendientes: cartola.n - (cartola.ok || 0),
        ratio: cartola.n ? Math.round(((cartola.ok || 0) / cartola.n) * 100) : 0,
      }
    }
  } catch (err) {
    salida.estado = 'sin_datos'
    salida.nota = `No se pudo leer la tesorería: ${err.message}`
  }
  return salida
}

/**
 * KPIs y comparaciones del período: magnitudes con contexto (contra el
 * promedio de 12 meses y contra el mismo mes del año anterior), no números
 * sueltos. Todo se deriva de los datos ya leídos; nada se estima.
 */
function calcularKpis(mensuales, { f29Formularios, tesoreria, tasa }) {
  const conDatos = mensuales.filter((m) => m.estado === 'con_datos')
  const ultimo = conDatos.length ? conDatos[conDatos.length - 1] : null
  const anterior = conDatos.length > 1 ? conDatos[conDatos.length - 2] : null
  const promedioVentas = conDatos.length
    ? Math.round(conDatos.reduce((s, m) => s + m.ventas_neto, 0) / conDatos.length)
    : null
  const promedioIva = conDatos.length
    ? Math.round(conDatos.reduce((s, m) => s + m.iva_estimado, 0) / conDatos.length)
    : null
  const promedioPpm = conDatos.length
    ? Math.round(conDatos.reduce((s, m) => s + m.ppm_estimado, 0) / conDatos.length)
    : null

  const ventasTotal = conDatos.reduce((s, m) => s + m.ventas_neto, 0)
  const comprasTotal = conDatos.reduce((s, m) => s + m.compras_neto, 0)
  const ivaTotal = conDatos.reduce((s, m) => s + m.iva_estimado, 0)
  const ppmTotal = conDatos.reduce((s, m) => s + m.ppm_estimado, 0)

  // Mismo mes del año anterior (para la comparación interanual).
  const mismoMes = (p) => {
    if (!p) return null
    const anio = Number(p.slice(0, 4)) - 1
    return conDatos.find((m) => m.periodo === `${anio}${p.slice(4)}`) || null
  }
  const previo = ultimo ? mismoMes(ultimo.periodo) : null

  // Lo DECLARADO en el F29 (Formulario Compacto): la verdad del SII.
  const declarados = [...f29Formularios.values()].filter((f) => f.indicadores && Object.keys(f.indicadores).length)
  const sumaDeclarado = (clave) => declarados.reduce((s, f) => s + (Number(f.indicadores?.[clave]) || 0), 0)

  const variacion = (actual, base) => {
    if (actual == null || base == null || !base) return null
    return Math.round(((actual - base) / Math.abs(base)) * 1000) / 10
  }

  const cob = tesoreria?.cobranza || null
  const dso = cob && cob.total && ventasTotal
    ? Math.round((cob.total / (ventasTotal / Math.max(1, conDatos.length))) * 30)
    : null

  // ST-06: el RCV de compras NO es costo de ventas (incluye bienes de capital
  // y compras sin relación con la venta). El ratio se publica como «diferencia
  // ventas − compras RCV», nunca como margen bruto, y queda NO EVALUABLE cuando
  // el denominador es insuficiente o el resultado no puede ser un margen
  // (|%| > 100): ahí el dato dice «faltan documentos», no «pierde 813%».
  const ratioVentasCompras = ventasTotal ? ((ventasTotal - comprasTotal) / ventasTotal) * 100 : null
  const margenEvaluable = ratioVentasCompras != null && ventasTotal >= 1000 && Math.abs(ratioVentasCompras) <= 100

  return {
    ventas_periodo: ventasTotal,
    compras_periodo: comprasTotal,
    iva_periodo: ivaTotal,
    ppm_periodo: ppmTotal,
    resultado_operativo: ventasTotal - comprasTotal - ivaTotal - ppmTotal,
    margen_bruto_pct: margenEvaluable ? Math.round(ratioVentasCompras * 10) / 10 : null,
    margen_bruto_evaluable: margenEvaluable,
    promedio_mensual_ventas: promedioVentas,
    promedio_mensual_iva: promedioIva,
    promedio_mensual_ppm: promedioPpm,
    ultimo_mes: ultimo ? {
      periodo: ultimo.periodo,
      ventas: ultimo.ventas_neto,
      iva: ultimo.iva_estimado,
      ppm: ultimo.ppm_estimado,
      variacion_vs_promedio: variacion(ultimo.ventas_neto, promedioVentas),
      variacion_vs_mes_anterior: variacion(ultimo.ventas_neto, previo ? previo.ventas_neto : null),
      variacion_iva_vs_mes_anterior: variacion(ultimo.iva_estimado, previo ? previo.iva_estimado : null),
    } : null,
    mismo_mes_anterior: previo ? { periodo: previo.periodo, ventas: previo.ventas_neto, iva: previo.iva_estimado } : null,
    // Lo declarado en el F29 (SII) vs. lo estimado desde el RCV.
    declarado: {
      periodos: declarados.length,
      ventas: sumaDeclarado('base_imponible'),
      compras: sumaDeclarado('total_creditos'),
      iva_determinado: sumaDeclarado('iva_determinado'),
      ppm_neto: sumaDeclarado('ppm_neto'),
      total_a_pagar: sumaDeclarado('total_a_pagar'),
      verificaciones_ok: declarados.reduce((s, f) => s + (f.verificaciones || []).filter((v) => v.ok).length, 0),
      verificaciones_total: declarados.reduce((s, f) => s + (f.verificaciones || []).length, 0),
    },
    tesoreria: {
      saldos_bancarios: tesoreria?.total_bancos ?? null,
      caja: tesoreria?.caja ?? null,
      cobranza_total: cob ? cob.total : null,
      cobranza_dias: cob ? cob.dias_promedio : null,
      cobranza_vencida_30: cob ? cob.vencido_30_dias : null,
      dso_estimado: dso,
      cuentas_por_pagar: tesoreria?.proveedores?.total ?? null,
      conciliacion_pct: tesoreria?.conciliacion?.ratio ?? null,
    },
    tasa_ppm: tasa,
  }
}

/** Serie mensual para los gráficos (SVG en el front) con su declarado. */
function serieMensual(mensuales, f29Formularios) {
  return mensuales.map((m) => {
    const f = f29Formularios.get(m.periodo)
    const ind = f?.indicadores || {}
    return {
      periodo: m.periodo,
      nombre: m.nombre,
      ventas: m.ventas_neto,
      compras: m.compras_neto,
      iva: m.iva_estimado,
      ppm: m.ppm_estimado,
      f29_estimado: m.f29_estimado,
      f29_declarado: ind.total_a_pagar ?? null,
      ventas_declaradas: ind.total_debitos ?? null,
      estado: m.estado,
    }
  })
}

/**
 * Construye el informe. `ficha` es opcional: si no se pasa, usa la guardada
 * en empresas (y lo declara). No hace red.
 */
// ---------------------------------------------------------------------------
// Agregados mensuales del RCV (boletas 39 y comprobantes de pago 48ública):
// el SII no entrega estos tipos documento a documento, solo el TOTAL del mes.
// Se guardan aparte (rcv_agregados, ver core/migraciones.js) y el informe los
// suma a las ventas: son venta real declarada. `documentos` NO se toca.
// ---------------------------------------------------------------------------

/** Guarda/actualiza los agregados de un período (UPSERT, idempotente). */
function guardarAgregados(db, { empresaId, rut, periodo, agregados }) {
  const filas = Array.isArray(agregados) ? agregados : []
  if (!filas.length) return { guardados: 0 }
  const upsert = db.prepare(`
    INSERT INTO rcv_agregados
      (empresa_id, rut, periodo, tipo_flujo, tipo_doc, tipo_venta, cantidad,
       monto_exento, monto_neto, monto_iva, monto_total, origen, fila_json, consultado_en)
    VALUES (?, ?, ?, 'venta', ?, ?, ?, ?, ?, ?, ?, 'sii_agregado', ?, datetime('now'))
    ON CONFLICT(empresa_id, periodo, tipo_flujo, tipo_doc, tipo_venta)
    DO UPDATE SET
      cantidad = excluded.cantidad,
      monto_exento = excluded.monto_exento,
      monto_neto = excluded.monto_neto,
      monto_iva = excluded.monto_iva,
      monto_total = excluded.monto_total,
      fila_json = excluded.fila_json,
      consultado_en = excluded.consultado_en
  `)
  const tx = db.transaction(() => {
    let guardados = 0
    for (const a of filas) {
      const r = upsert.run(
        empresaId, rut, String(periodo), Number(a.tipoDoc), a.tipoVenta || null,
        Math.round(Number(a.cantidad) || 0),
        Math.round(Number(a.montoExento) || 0),
        Math.round(Number(a.montoNeto) || 0),
        Math.round(Number(a.montoIVA) || 0),
        Math.round(Number(a.montoTotal) || 0),
        JSON.stringify(a.filaRaw || a || {})
      )
      guardados += r.changes
    }
    return guardados
  })
  return { guardados: tx() }
}

/** Agregados de un período, ya suma exento+neto: son ventas netas. */
function agregadosPorPeriodo(db, empresaId, desde, hasta) {
  const filas = db.prepare(`
    SELECT periodo, tipo_doc, tipo_venta, cantidad,
           (monto_exento + monto_neto) AS neto, monto_iva AS iva, monto_total AS total
    FROM rcv_agregados
    WHERE empresa_id = ? AND periodo BETWEEN ? AND ? AND tipo_flujo = 'venta'
  `).all(empresaId, desde, hasta)
  const mapa = new Map()
  for (const f of filas) {
    const actual = mapa.get(f.periodo) || { neto: 0, iva: 0, cantidad: 0, tipos: [] }
    actual.neto += f.neto || 0
    actual.iva += f.iva || 0
    actual.cantidad += f.cantidad || 0
    actual.tipos.push({ tipo_doc: f.tipo_doc, tipo_venta: f.tipo_venta, cantidad: f.cantidad, neto: f.neto, iva: f.iva })
    mapa.set(f.periodo, actual)
  }
  return mapa
}

function construirInforme(db, { empresaId, periodo, meses = 12, ficha = null }) {
  const emp = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  if (!periodoValido(periodo)) throw new Error('Período inválido (YYYYMM)')

  const f = ficha || fichaDesdeEmpresa(emp)
  const periodoFinal = periodo
  const periodoLista = ultimosPeriodos(meses, periodoFinal)
  const desde = periodoLista[0]
  const porPeriodo = docsPorPeriodo(db, empresaId, desde, periodoFinal)
  const agregadosPeriodo = agregadosPorPeriodo(db, empresaId, desde, periodoFinal)
  const tasa = Number(emp.tasa_ppm) || 0

  // Declaraciones OFICIALES ya consultadas al SII (si las hay).
  const anioHasta = Number(periodoFinal.slice(0, 4))
  const anioDesde = anioHasta - 4
  const desdeF29 = ultimosPeriodos(60, periodoFinal)[0]
  // F29 cubre 60 períodos mensuales; F22, DJ y boletas cubren los cinco años
  // tributarios que terminan en el año de análisis.
  const f29Oficial = leerDeclaraciones(db, empresaId, 'F29', desdeF29, periodoFinal)
  const f22Oficial = leerDeclaraciones(db, empresaId, 'F22', anioDesde, anioHasta)
  const bheOficial = leerDeclaraciones(db, empresaId, 'BHE', anioDesde, anioHasta)

  // NUEVO v2: Formulario Compacto del F29 (casillas DECLARADAS) y tesorería.
  const f29Formularios = leerFormulariosF29(db, empresaId, desdeF29, periodoFinal)
  const rentaAnual = leerRenta(db, empresaId, anioDesde, anioHasta)
  const juradas = leerJuradas(db, empresaId, anioDesde, anioHasta)
  const djPresentadas = [...juradas.values()].flatMap((j) =>
    j.presentadas.map((p) => ({ ...p, anio: j.anio, consultado_en: j.consultado_en })))
  const djPendientes = [...juradas.values()].flatMap((j) =>
    j.pendientes.map((p) => ({ ...p, anio: j.anio, consultado_en: j.consultado_en })))
  const tesoreria = resumenTesoreria(db, empresaId, { desde, hasta: periodoFinal })
  // Deuda FISCAL (TGR): se muestra junto a la tesorería, pero es una fuente
  // distinta (Fisco) y se rotula como tal. Nunca se suma a la deuda comercial.
  const deudaFiscal = deudaTgr.resumen(db, empresaId)
  tesoreria.deuda_fiscal = deudaFiscal

  // ST-01: el remanente de crédito fiscal viaja de un mes al siguiente. El
  // `map` recorre `periodoLista` en orden cronológico ascendente, así que el
  // arrastre se actualiza período a período.
  let remanenteArrastre = 0
  const mensuales = periodoLista.map((p) => {
    const reg = porPeriodo.get(p) || {}
    const v = reg.ventas
    const c = reg.compras
    // Boletas 39/41 y comprobantes 48 del mes (rcv_agregados): venta real que
    // el SII solo entrega como total. Se suman al RCV de ventas del informe —
    // sin esto la conciliación «declarado vs RCV» reportaba millones falsos
    // (Santa Camila 202603: 2,9M; 202606: 1,47M — corregido 2026-10-23).
    const ag = agregadosPeriodo.get(p) || { neto: 0, iva: 0, cantidad: 0, tipos: [] }
    const ventasNeto = (v ? v.neto : 0) + (ag.neto || 0)
    const ventasIva = (v ? v.iva : 0) + (ag.iva || 0)
    const comprasNeto = c ? c.neto : 0
    const comprasIva = c ? c.iva : 0
    const documentos = (v ? v.n : 0) + (c ? c.n : 0)
    const ppm = calcularPPM(ventasNeto, tasa)

    let estado = 'sin_datos'
    if (documentos > 0 || (ag.neto || 0) > 0 || (ag.iva || 0) > 0) estado = 'con_datos'
    else if (cacheVacio(db, emp.rut, p, 'ventas') && cacheVacio(db, emp.rut, p, 'compras')) {
      estado = 'sin_movimiento'
    }
    // Solo un mes con libros (o con «sin movimiento» CONFIRMADO por el SII)
    // mueve el arrastre. Un mes sin RCV ingerido no es un mes en cero: si se
    // usara como cero, se perdería el remanente acumulado.
    const conLibros = estado === 'con_datos' || estado === 'sin_movimiento'
    // Si el F29 declarado de ese período trae la casilla 504, esa cifra oficial
    // manda sobre el arrastre calculado.
    const declarado504 = f29Formularios.get(p)?.indicadores?.remanente_credito_anterior
    const remanenteAnterior = declarado504 == null ? remanenteArrastre : Math.max(0, Number(declarado504) || 0)
    const cft = calcularIVAConRemanente(ventasIva, comprasIva, remanenteAnterior)
    // `iva` sigue siendo débito − crédito del mes (puede ser negativo y es lo
    // que se muestra como «IVA est. RCV»); `ivaAPagar` es lo que se declara.
    const iva = cft.neto
    const ivaAPagar = conLibros ? cft.iva : null
    if (conLibros) remanenteArrastre = cft.remanente_siguiente
    const totalF29 = ivaAPagar == null ? 0 : calcularTotalF29(ivaAPagar, ppm)

    const of = f29Oficial.get(p) || null
    const ff = f29Formularios.get(p) || null
    const ind = ff?.indicadores || {}
    // La Consulta Integral F29 (`declaraciones_sii`) y el Formulario Compacto
    // son la MISMA declaración leída por dos vías. Si sólo hay compacto —lo que
    // pasa en toda empresa sincronizada con la versión nueva— el mes no puede
    // quedar como «no consultado»: el informe lo mostraría vacío junto a la
    // conciliación del mismo período.
    const oficial = of || (compactoDeclarado(ff)
      ? {
        estado: 'declarada',
        folio: ff.folio || null,
        fecha_presentacion: null,
        monto_total: ind.total_a_pagar ?? null,
        monto_concepto: ind.total_a_pagar != null ? 'total_a_pagar_091' : null,
        consultado_en: ff.consultado_en || null,
      }
      : null)
    // ST-02: el monto del F29 solo se compara si viene de una CASILLA
    // identificada (091, total a pagar). La Consulta Integral entrega un
    // «Monto» sin casilla y el Formulario Compacto sí trae el 091: sin 091 no
    // se calcula diferencia (`null`) ni se suma exposición. Antes se comparaba
    // ese monto a ciegas contra la estimación del RCV y una celda de otro
    // concepto fabricaba diferencias de millones.
    const monto091 = ind.total_a_pagar != null
      ? Number(ind.total_a_pagar)
      : (of?.datos?.monto_concepto === 'total_a_pagar_091' && of.monto_total != null ? Number(of.monto_total) : null)
    const montoConcepto = ind.total_a_pagar != null
      ? 'total_a_pagar_091'
      : (of ? (of.datos?.monto_concepto || 'no_identificado') : null)
    // Lo declarado en el F29 (SII) frente a lo estimado desde el RCV.
    // OJO con las casillas: `total_debitos` (538) es el IVA débito, NO las
    // ventas. Las ventas netas declaradas están en `base_imponible` (563).
    // Comparar 538 contra el neto del RCV inventaba una diferencia de millones
    // en cada período (verificado 2026-10-22 con el F29 real 202608).
    const declaradoVentas = ind.base_imponible ?? null
    const declaradoIva = ind.iva_determinado ?? null
    const declaradoPpm = ind.ppm_neto ?? null
    const declaradoTotal = ind.total_a_pagar ?? null
    return {
      periodo: p,
      nombre: nombrePeriodo(p),
      ventas_neto: Math.round(ventasNeto),
      ventas_iva: Math.round(ventasIva),
      // Transparencia: cuánto del mes viene de boletas/comprobantes agregados
      // (no hay folios individuales; el SII solo entrega el total del mes).
      ventas_agregados: {
        cantidad: ag.cantidad || 0,
        neto: Math.round(ag.neto || 0),
        iva: Math.round(ag.iva || 0),
        tipos: ag.tipos || [],
      },
      compras_neto: Math.round(comprasNeto),
      compras_iva: Math.round(comprasIva),
      iva_estimado: Math.round(iva),
      // ST-01: IVA a pagar después de aplicar el remanente de crédito fiscal,
      // y el remanente que pasa al mes siguiente (D.L. 825 art. 26).
      iva_a_pagar: ivaAPagar == null ? null : Math.round(ivaAPagar),
      remanente_anterior: conLibros ? Math.round(remanenteAnterior) : null,
      remanente_siguiente: conLibros ? Math.round(cft.remanente_siguiente) : null,
      remanente_origen: declarado504 != null ? 'casilla_504' : 'estimado_propio',
      ppm_estimado: Math.round(ppm),
      f29_estimado: Math.round(totalF29),
      documentos,
      estado,
      // El F29 estimado sale del RCV: no es la declaración presentada.
      fuente: 'RCV (estimación propia)',
      // Declaración OFICIAL leída del SII para este período (null si no se ha
      // consultado). `diferencia` = estimado − declarado; solo se calcula
      // cuando el SII informó un monto.
      f29_oficial: oficial ? {
        estado: oficial.estado || 'sin_informacion',
        etiqueta: ETIQUETA_ESTADO_DECL[oficial.estado] || 'Sin información',
        folio: oficial.folio || null,
        fecha_presentacion: oficial.fecha_presentacion || null,
        // Si hay 091 se muestra ESE monto (es el que se compara); si no, el
        // informado por el SII, marcado como no conciliable.
        monto_total: monto091 != null
          ? monto091
          : (oficial.monto_total == null ? null : Number(oficial.monto_total)),
        monto_concepto: montoConcepto,
        conciliable: monto091 != null,
        consultado_en: oficial.consultado_en || null,
        origen: of ? 'consulta_integral' : 'compacto',
      } : null,
      // Un período con compacto pero sin casillas («No Declarante») se informa
      // como «sin información»: el SII dice expresamente que ese registro no
      // constituye una declaración, así que tampoco se cuenta como pendiente.
      f29_estado: oficial ? (oficial.estado || 'sin_informacion') : (ff ? 'sin_informacion' : 'no_consultado'),
      // La diferencia solo es válida si el RCV de ese período está ingerido:
      // sin RCV la estimación es 0 por falta de datos, no por falta de ventas,
      // y compararla con lo declarado inventaría una discrepancia.
      f29_diferencia: oficial && monto091 != null && estado === 'con_datos'
        ? Math.round(totalF29) - monto091
        : null,
      // Formulario Compacto: las casillas del F29 tal como se presentó.
      f29_formulario: ff ? {
        folio: ff.folio,
        estado: ff.estado,
        situacion: ff.situacion,
        monto_observado: ff.monto_observado,
        declaraciones_vigentes: ff.declaraciones_vigentes,
        intentos: ff.intentos,
        indicadores: ff.indicadores,
        verificaciones: ff.verificaciones,
        eventos: ff.eventos,
        url: ff.url,
        consultado_en: ff.consultado_en,
      } : null,
      // Comparación DECLARADO (SII) vs. ESTIMADO (RCV del sistema).
      // Sin RCV del mes NO se calculan diferencias: la estimación sería 0 por
      // falta de datos (no porque no hubo ventas) y cualquier diferencia sería
      // un falso positivo. Se muestran los valores declarados y `comparable:
      // false`; las columnas de diferencia quedan en null.
      comparacion: ff ? (() => {
        const comparable = estado === 'con_datos'
        const dif = (declarado, estimado) => (comparable && declarado != null ? declarado - Math.round(estimado) : null)
        const diferenciaVentas = dif(declaradoVentas, ventasNeto)
        // Si la diferencia de ventas coincide con lo que el propio F29 declara
        // por boletas (111) o recibos de medios electrónicos (759), se dice: la
        // diferencia tiene explicación y no es un documento perdido. Se expresa
        // como aproximación porque la base se reconstruye con la tasa 19%.
        const explicacion = (() => {
          if (diferenciaVentas == null || Math.abs(diferenciaVentas) < 1000) return null
          const partes = []
          const porIva = (ivaDeclarado, etiqueta) => {
            if (!ivaDeclarado) return
            const base = Math.round(ivaDeclarado / 0.19)
            if (Math.abs(base - diferenciaVentas) <= Math.max(1000, Math.round(base * 0.02))) {
              partes.push(`${etiqueta} (casilla de IVA $${Math.round(ivaDeclarado).toLocaleString('es-CL')}, ≈ $${base.toLocaleString('es-CL')} de base) que no vienen en el RCV`)
            }
          }
          porIva(ind.debitos_boletas, `${ind.boletas_emitidas ?? 'las'} boleta(s) emitidas`)
          porIva(ind.debitos_recibos_medios, `${ind.recibos_medios_electronicos ?? 'los'} recibo(s) de medios electrónicos`)
          return partes.length ? partes.join(' y ') : null
        })()
        return {
          ventas_declaradas: declaradoVentas,
          ventas_estimadas: Math.round(ventasNeto),
          diferencia_ventas: diferenciaVentas,
          diferencia_ventas_explicada_por: explicacion,
          iva_declarado: declaradoIva,
          iva_estimado: Math.round(iva),
          diferencia_iva: dif(declaradoIva, iva),
          ppm_declarado: declaradoPpm,
          ppm_estimado: Math.round(ppm),
          diferencia_ppm: dif(declaradoPpm, ppm),
          total_declarado: declaradoTotal,
          total_estimado: Math.round(totalF29),
          diferencia_total: dif(declaradoTotal, totalF29),
          verificaciones: ff.verificaciones || [],
          // Solo hay comparación cuando el RCV del período está ingerido.
          comparable,
        }
      })() : null,
    }
  })

  const conDatos = mensuales.filter((m) => m.estado === 'con_datos').length
  const sinDatos = mensuales.filter((m) => m.estado === 'sin_datos').length
  const sinMovimiento = mensuales.filter((m) => m.estado === 'sin_movimiento').length
  const anios = ingresosPorAnio(db, empresaId)

  const hallazgos = []

  // ---- Declaraciones oficiales F29 (historial completo del SII) ----
  // El HISTORIAL alimenta el cumplimiento y los hallazgos (un F29 pendiente
  // de 2024 sigue siendo un F29 pendiente). La VENTANA sigue alimentando los
  // montos y la exposición: solo se puede cuantificar lo que tiene RCV.
  //
  // El historial une las DOS vías de lectura: la Consulta Integral
  // (`declaraciones_sii`) y el Formulario Compacto (`f29_formularios`). Los
  // períodos que sólo tienen compacto son declaraciones vigentes igual que las
  // otras: sin esto, una empresa con los 12 meses conciliados aparecía con
  // «F29 no consultado» y con la dimensión de cumplimiento no evaluable.
  const f29Historial = (() => {
    const porPeriodo = new Map(f29Oficial)
    for (const f of f29Formularios.values()) {
      if (porPeriodo.has(f.periodo) || !compactoDeclarado(f)) continue
      porPeriodo.set(f.periodo, {
        periodo: f.periodo,
        estado: 'declarada',
        folio: f.folio || null,
        fecha_presentacion: null,
        monto_total: f.indicadores?.total_a_pagar ?? null,
        monto_concepto: 'total_a_pagar_091',
        consultado_en: f.consultado_en || null,
        url: f.url || null,
        datos: null,
        origen: 'compacto',
      })
    }
    return [...porPeriodo.values()].sort((a, b) => a.periodo.localeCompare(b.periodo))
  })()
  const f29Declaradas = f29Historial.filter((d) => d.estado === 'declarada' || d.estado === 'rectificada')
  const f29Pendientes = f29Historial.filter((d) => d.estado === 'pendiente' || d.estado === 'no_presentada')
  const f29Consultados = f29Historial.length
  const f29EnVentana = mensuales.filter((m) => m.f29_estado !== 'no_consultado').length
  const f29PendientesVentana = mensuales.filter((m) => m.f29_estado === 'pendiente' || m.f29_estado === 'no_presentada')
  const rangoF29 = f29Historial.length
    ? `${f29Historial[0].periodo}–${f29Historial[f29Historial.length - 1].periodo}`
    : null

  // No consultar NO es un hallazgo: es una limitación de cobertura (va en
  // `limitaciones`). Marcarlo como observación haría que todo informe sin
  // sincronización con el SII pareciera un problema del contribuyente.
  if (f29Pendientes.length) {
    const lista = f29Pendientes.slice(0, 6).map((d) => nombrePeriodo(d.periodo)).join(', ')
    hallazgos.push(hallazgo('F29_PENDIENTE', 'alta', 'F29 pendiente de presentación',
      `El SII registra ${f29Pendientes.length} período(s) sin declaración vigente${rangoF29 ? ` (${rangoF29})` : ''}: ${lista}${f29Pendientes.length > 6 ? '…' : ''}. Regulariza antes de que el SII aplique sanciones o intereses.`,
      'Consulta Integral F29 (SII)'))
  }

  const diferencias = mensuales.filter((m) => m.estado === 'con_datos' && m.f29_diferencia != null && Math.abs(m.f29_diferencia) >= 1000)
  if (diferencias.length) {
    const total = diferencias.reduce((s, m) => s + m.f29_diferencia, 0)
    const bruto = diferencias.reduce((s, m) => s + Math.abs(m.f29_diferencia), 0)
    hallazgos.push(hallazgo('F29_DIFERENCIA', 'media', 'Diferencia entre F29 declarado y estimación del RCV',
      `${diferencias.length} período(s) con diferencia de al menos $1.000 (magnitud bruta ${Math.round(bruto).toLocaleString('es-CL')} CLP; diferencia neta ${Math.round(total).toLocaleString('es-CL')} CLP). Diferencia positiva = se declaró de MENOS (suma a la exposición); diferencia negativa = se declaró de MÁS (se informa, no es exposición). La estimación sale del RCV: si la diferencia se repite, revisa documentos faltantes o declaraciones rectificatorias.`,
      'Declaraciones F29 del SII vs RCV'))
  }

  // ---- Renta F22 y boletas de honorarios ----
  const f22Consultado = f22Oficial.size > 0
  const f22Anios = [...f22Oficial.values()]
  const f22Pendientes = f22Anios.filter((d) => d.estado === 'pendiente' || d.estado === 'no_presentada')
  if (f22Consultado && f22Pendientes.length) {
    hallazgos.push(hallazgo('F22_PENDIENTE', 'alta', 'Renta (F22) pendiente',
      `El SII registra ${f22Pendientes.length} año(s) con F22 pendiente o no presentado: ${f22Pendientes.map((d) => d.periodo).join(', ')}.`,
      'Consulta F22 (SII)'))
  }

  const bheAnios = [...bheOficial.values()]
  const bheEmitidas = bheAnios.reduce((s, d) => s + Number(d.datos?.emitidas?.totales?.honorario_bruto || 0), 0)
  const bheRecibidas = bheAnios.reduce((s, d) => s + Number(d.datos?.recibidas?.totales?.honorario_bruto || 0), 0)

  // ---- Declaraciones juradas presentadas (SII) ----
  const djObservadas = djPresentadas.filter((d) => d.estado && /rechaz|observ|no aceptada/i.test(d.estado))
  if (djObservadas.length) {
    const detalle = djObservadas.slice(0, 6)
      .map((d) => `DJ ${d.dj} ${d.anio}${d.folio ? ` (folio ${d.folio})` : ''}: «${d.estado}»`)
      .join('; ')
    hallazgos.push(hallazgo('DJ_OBSERVADA', 'media', 'Declaración jurada observada o rechazada por el SII',
      `${djObservadas.length} declaración(es) jurada(s) no están aceptadas: ${detalle}. Revisa la observación en «Mis Declaraciones Juradas» del SII y corrige o rectifica antes del cierre anual.`,
      'SII — Mis Declaraciones Juradas'))
  }

  // ---- Declaraciones juradas SIN presentación registrada ----
  // El SII lista las DJ aplicables al contribuyente por año; las que vienen
  // con folio 0 y sin fecha no tienen presentación registrada. Vencida la
  // fecha, es una contingencia (multa del art. 97 N°1 del Código Tributario).
  const hoyISO = new Date().toISOString().slice(0, 10)
  const djVencidas = djPendientes.filter((d) => d.fecha_vencimiento && d.fecha_vencimiento < hoyISO)
  if (djPendientes.length) {
    const detalle = djPendientes.slice(0, 6)
      .map((d) => `DJ ${d.dj} ${d.anio}${d.fecha_vencimiento ? ` (vence ${d.fecha_vencimiento})` : ''}`)
      .join('; ')
    hallazgos.push(hallazgo('DJ_PENDIENTE', djVencidas.length ? 'alta' : 'media',
      'Declaración jurada sin presentación registrada',
      `El SII lista ${djPendientes.length} declaración(es) jurada(s) aplicables sin presentación registrada${djVencidas.length ? `, ${djVencidas.length} ya vencida(s)` : ' (aún dentro de plazo)'}: ${detalle}${djPendientes.length > 6 ? '…' : ''}. Resolver antes del cierre del año tributario para no exponerse a multas e intereses.`,
      'SII — Mis Declaraciones Juradas'))
  }

  // ---- Deuda fiscal (TGR) ----
  // Es deuda EFECTIVA (no una estimación propia): entra a la exposición con
  // su monto del certificado. Nunca se suma dos veces con las diferencias del
  // F29, que son materia de investigación.
  let exposicionDeudaFiscal = 0
  if (deudaFiscal.estado === 'con_deuda') {
    exposicionDeudaFiscal = deudaFiscal.total || 0
    hallazgos.push(hallazgo('DEUDA_TGR', 'alta', 'Deuda fiscal registrada en la Tesorería (TGR)',
      `${deudaFiscal.detalle} Una deuda fiscal vigente devenga reajustes e intereses y puede trabar certificados y convenios. Revisa el certificado adjunto y regulariza o conviene el pago con la TGR.`,
      'TGR — Certificado de Deuda Fiscal'))
  }

  // ---- Identidad / ficha ----
  if (!ficha && !emp.razon_social_sii && !emp.inicio_actividades && !emp.regimen_tributario) {
    hallazgos.push(hallazgo('FICHA_AUSENTE', 'media', 'Ficha SII no descargada',
      'No hay ficha del contribuyente guardada ni datos de onboarding. El informe se limita a antecedentes internos.',
      'empresas / data/sii-fichas'))
  }
  if (!f.inicioActividades) {
    hallazgos.push(hallazgo('SIN_INICIO_ACTIVIDADES', 'media', 'Inicio de actividades no registrado',
      'La ficha disponible no trae fecha de inicio de actividades. Es un antecedente base para determinar obligaciones y plazos.',
      'Ficha SII'))
  }
  if (!f.regimen) {
    hallazgos.push(hallazgo('SIN_REGIMEN', 'media', 'Régimen tributario no determinado',
      'No hay atributo de régimen vigente en la ficha (14 TT / 14 D1 / 14 A). Sin régimen no se puede validar la tributación aplicable.',
      'Ficha SII / atributos'))
  }
  if (!f.actividades || !f.actividades.length) {
    hallazgos.push(hallazgo('SIN_ACTIVIDAD', 'media', 'Actividad económica no informada',
      'La ficha no trae glosa de actividad. Revisa el giro en el SII antes de emitir documentos o declarar.',
      'Ficha SII'))
  }
  if (!f.direccion && (!f.direcciones || !f.direcciones.length)) {
    hallazgos.push(hallazgo('SIN_DIRECCION', 'baja', 'Dirección no disponible',
      'No hay domicilio en la ficha. El SII exige domicilio actualizado para notificaciones.',
      'Ficha SII'))
  }
  if (!f.email && !emp.telefono) {
    hallazgos.push(hallazgo('SIN_CONTACTO', 'baja', 'Sin correo ni teléfono de contacto',
      'El SII notifica por correo electrónico; sin contacto la empresa queda expuesta a no enterarse de observaciones.',
      'Ficha SII'))
  }
  if (f.terminoGiro) {
    hallazgos.push(hallazgo('TERMINO_GIRO', 'alta', 'Término de giro registrado',
      `La ficha registra término de giro con fecha ${f.terminoGiro}. Verifica que no corresponda seguir emitiendo documentos o declarando.`,
      'Ficha SII'))
  }
  for (const a of f.alertas || []) {
    const desc = String(a.descripcion || a.descripcionAlerta || '').trim()
    if (!desc) continue
    const esTermino = /termino de giro|término de giro/i.test(desc)
    hallazgos.push(hallazgo('ALERTA_SII', esTermino ? 'alta' : 'media', 'Alerta del SII',
      desc, `Ficha SII (código ${a.codigo || 's/c'}, activada ${a.fechaActiv || 's/f'})`))
  }
  if (f.capital && Number(f.capital.por_enterar_miles_clp) > 0) {
    hallazgos.push(hallazgo('CAPITAL_POR_ENTERAR', 'baja', 'Capital por enterar',
      `La ficha registra ${f.capital.por_enterar_miles_clp} miles de CLP por enterar. Revisa el estatuto social y el registro de aportes.`,
      'Ficha SII'))
  }

  // ---- Cobertura RCV ----
  if (conDatos === 0) {
    hallazgos.push(hallazgo('SIN_RCV', 'alta', 'Sin RCV ingerido en el período analizado',
      `No hay documentos de compras ni ventas en los últimos ${meses} meses. Esto NO significa «sin movimiento»: el RCV no se ha sincronizado.`,
      'documentos (bandeja local)'))
  } else if (sinDatos > 0) {
    hallazgos.push(hallazgo('COBERTURA_RCV_PARCIAL', sinDatos >= Math.ceil(meses / 2) ? 'alta' : 'media',
      'Cobertura RCV incompleta',
      `${sinDatos} de ${meses} meses no tienen RCV ingerido. Las conclusiones sobre ingresos y IVA quedan limitadas a los meses con datos.`,
      'documentos (bandeja local)'))
  }
  const ultimos3 = mensuales.slice(-3)
  if (conDatos > 0 && ultimos3.every((m) => m.estado === 'sin_datos')) {
    hallazgos.push(hallazgo('SIN_RCV_RECIENTE', 'alta', 'Sin RCV en los últimos 3 meses',
      'Hay historia, pero los últimos tres períodos no tienen RCV sincronizado. La foto tributaria puede estar desactualizada.',
      'documentos (bandeja local)'))
  }

  // ---- F29 estimado ----
  const ivaPorPagar = mensuales.filter((m) => m.estado === 'con_datos' && m.iva_estimado > 0)
  if (ivaPorPagar.length) {
    hallazgos.push(hallazgo('F29_ESTIMADO', 'info',
      f29Consultados ? 'F29 estimado y F29 declarado disponibles' : 'F29 estimado disponible, estado oficial no consultado',
      f29Consultados
        ? `${ivaPorPagar.length} período(s) con IVA estimado a pagar desde el RCV. El monto declarado se lee del SII y se compara en el detalle mensual; la estimación sigue siendo propia.`
        : `${ivaPorPagar.length} período(s) con IVA estimado a pagar. No se consultó la declaración F29 del SII para este rango: el monto mostrado es una estimación desde el RCV.`,
      'backend/services/calculos.js + RCV ingerido' + (f29Consultados ? ' + Consulta Integral F29' : '')))
  }

  // ---- F29 DECLARADO (SII) vs RCV (sistema): la comparación de verdad ----
  const comparables = mensuales.filter((m) => m.comparacion && m.comparacion.comparable)
  const difVentas = comparables.filter((m) => m.comparacion.diferencia_ventas != null && Math.abs(m.comparacion.diferencia_ventas) >= 1000)
  if (difVentas.length) {
    const suma = difVentas.reduce((s, m) => s + m.comparacion.diferencia_ventas, 0)
    const bruto = difVentas.reduce((s, m) => s + Math.abs(m.comparacion.diferencia_ventas || 0), 0)
    const detalle = difVentas.slice(0, 6).map((m) => {
      const ex = m.comparacion.diferencia_ventas_explicada_por
      return `${m.nombre}: declarado ${Math.round(m.comparacion.ventas_declaradas).toLocaleString('es-CL')} vs RCV ${Math.round(m.comparacion.ventas_estimadas).toLocaleString('es-CL')}${ex ? ` (coincide con ${ex})` : ''}`
    }).join('; ')
    hallazgos.push(hallazgo('F29_VS_RCV', 'alta', 'Ventas del F29 declarado no coinciden con el RCV del sistema',
      `${difVentas.length} período(s) con diferencia de ventas de al menos $1.000 (magnitud bruta ${Math.round(bruto).toLocaleString('es-CL')} CLP; diferencia neta ${Math.round(suma).toLocaleString('es-CL')} CLP). ${detalle}${difVentas.length > 6 ? '…' : ''}. El F29 declarado es la verdad: la diferencia apunta a documentos que no están en el RCV (boletas o recibos de medios electrónicos propios), notas de crédito no leídas o a una rectificación pendiente de regularizar.`,
      'Formulario Compacto del F29 (SII) vs RCV ingerido'))
  }
  const verifFallidas = mensuales.flatMap((m) => (m.comparacion?.verificaciones || []).filter((v) => !v.ok).map((v) => ({ periodo: m.nombre, ...v })))
  if (verifFallidas.length) {
    hallazgos.push(hallazgo('F29_INCONSISTENTE', 'media', 'Casillas del F29 declarado que no cuadran entre sí',
      `${verifFallidas.length} verificación(es) internas del Formulario Compacto no cuadran (por ejemplo, débitos menos notas de crédito distinto del total, o IVA determinado que no coincide con la diferencia de débitos y créditos). Detalle: ${verifFallidas.slice(0, 3).map((v) => `${v.periodo}: ${v.detalle}`).join(' · ')}.`,
      'Formulario Compacto del F29 (SII) — verificaciones internas'))
  }

  // Verificaciones internas del Formulario Compacto (cuadran las casillas).
  const verifTotal = [...f29Formularios.values()].reduce((s, f) => s + (f.verificaciones || []).length, 0)
  const verifOk = [...f29Formularios.values()].reduce((s, f) => s + (f.verificaciones || []).filter((v) => v.ok).length, 0)
  const verificacionRatio = verifTotal ? (verifOk / verifTotal) * 100 : 0

  // ============================================================
  // ÍNDICE DE SALUD TRIBUTARIA — metodología por DIMENSIONES
  // ============================================================
  // Cinco dimensiones con pesos fijos. Una dimensión sin antecedentes NO se
  // puntúa con cero: se declara «no evaluable» y su peso se redistribuye.
  // El puntaje nunca oculta una contingencia crítica: el informe muestra el
  // índice global Y las alertas que obligan a actuar, y la cobertura del
  // diagnóstico viaja junto al número.
  const PESOS = { cumplimiento: 0.25, consistencia: 0.25, riesgos: 0.20, calidad: 0.15, controles: 0.15 }
  // Nivel de cada dimensión, con la misma escala del índice global: el gráfico
  // del índice colorea la barra con el color que SIGNIFICA algo (verde =
  // favorable, ámbar = requiere atención, rojo = riesgo). Sin este campo la
  // barra salía siempre gris, porque el color era decorativo.
  const nivelDimension = (puntaje) => {
    if (puntaje == null) return 'NO_EVALUABLE'
    if (puntaje >= 75) return 'AL_DIA'
    if (puntaje >= 60) return 'CON_OBSERVACIONES'
    return 'REQUIERE_REVISION'
  }
  const dimensiones = []
  const addDimension = (clave, nombre, puntaje, detalle, evidencia) => {
    const acotado = puntaje == null ? null : Math.max(0, Math.min(100, Math.round(puntaje)))
    dimensiones.push({
      clave,
      nombre,
      peso: PESOS[clave],
      puntaje: acotado,
      nivel: nivelDimension(acotado),
      estado: acotado == null ? 'no_evaluable' : 'evaluable',
      detalle,
      evidencia: evidencia || null,
    })
  }

  // --- 1) Cumplimiento de obligaciones (25%) ---
  let cumplPuntaje = null
  let cumplDetalle = 'Sin consulta oficial de declaraciones: no evaluable con los antecedentes disponibles.'
  if (f29Consultados) {
    cumplPuntaje = (f29Declaradas.length / f29Consultados) * 100
    cumplDetalle = `${f29Declaradas.length} de ${f29Consultados} períodos consultados en el SII (${rangoF29 || 'rango no informado'}) tienen F29 declarado vigente.`
  }
  addDimension('cumplimiento', 'Cumplimiento de obligaciones', cumplPuntaje, cumplDetalle, 'Consulta Integral F29 (SII)')

  // --- 2) Consistencia y conciliación (25%) ---
  let consPuntaje = null
  let consDetalle = 'Sin Formulario Compacto del F29 para conciliar: no evaluable con los antecedentes disponibles.'
  if (!comparables.length && f29Formularios.size) {
    // Hay F29 declarado, pero falta el RCV de esos meses: el motivo es otro y
    // el lector necesita saber qué sincronizar (no «no hay Formulario»).
    consDetalle = `Hay ${f29Formularios.size} Formulario(s) Compacto(s) del F29 con casillas declaradas, pero ningún período tiene RCV ingerido para comparar. Sincroniza compras y ventas de esos meses para conciliar.`
  }
  if (comparables.length) {
    const dif = comparables.filter((m) => Math.abs(m.comparacion.diferencia_ventas || 0) >= 1000).length
    const verifOkC = comparables.reduce((s, m) => s + (m.comparacion.verificaciones || []).filter((v) => v.ok).length, 0)
    const verifTotC = comparables.reduce((s, m) => s + (m.comparacion.verificaciones || []).length, 0)
    const puntos = 100 - Math.min(70, dif * 12) - Math.min(30, verifFallidas.length * 10)
    consPuntaje = puntos
    consDetalle = `${comparables.length} período(s) conciliados contra el F29 declarado: ${dif} con diferencia de ventas y ${verifFallidas.length} verificación(es) interna(s) fallida(s) (${verifOkC}/${verifTotC} verificaciones correctas).`
  }
  addDimension('consistencia', 'Consistencia y conciliación', consPuntaje, consDetalle, 'Formulario Compacto del F29 (SII) vs RCV ingerido')

  // --- 3) Riesgos y contingencias (20%) ---
  const altas = hallazgos.filter((h) => h.severidad === 'alta').length
  const medias = hallazgos.filter((h) => h.severidad === 'media').length
  const bajas = hallazgos.filter((h) => h.severidad === 'baja').length
  const riesgosPuntaje = Math.max(0, 100 - altas * 18 - medias * 6 - bajas * 2)
  addDimension('riesgos', 'Riesgos y contingencias', riesgosPuntaje,
    `${altas} riesgo(s) alto(s), ${medias} medio(s) y ${bajas} bajo(s) identificados en el período.`,
    'Hallazgos del informe')

  // --- 4) Calidad y cobertura de datos (15%) ---
  const coberturaRcv = meses ? Math.round((conDatos / meses) * 100) : 0
  // La cobertura de declaraciones se mide sobre la VENTANA analizada (los
  // meses del período): el historial de 5 años no puede dividirse por la
  // ventana o el indicador se iría de 100 %.
  const consultasPct = meses ? Math.min(100, Math.round((f29EnVentana / meses) * 100)) : 0
  const fichaPct = (f.inicioActividades ? 40 : 0) + (f.regimen ? 30 : 0) + (f.actividades && f.actividades.length ? 30 : 0)
  const calidadPuntaje = conDatos > 0 ? Math.round(coberturaRcv * 0.6 + consultasPct * 0.2 + fichaPct * 0.2) : null
  addDimension('calidad', 'Calidad y cobertura de datos', calidadPuntaje,
    `Cobertura RCV ${coberturaRcv}%, declaraciones oficiales consultadas ${consultasPct}% de los períodos, ficha del SII completa en ${fichaPct}%.`,
    'Documentos ingeridos + ficha del SII')

  // --- 5) Controles y regularización (15%) ---
  let controlesPuntaje = null
  let controlesDetalle = 'Sin evidencia de conciliación interna (Formulario Compacto ni conciliación bancaria): no evaluable con los antecedentes disponibles.'
  const controlesBase = []
  if (f29Formularios.size) controlesBase.push({ peso: 0.6, valor: verificacionRatio })
  if (tesoreria.conciliacion) controlesBase.push({ peso: 0.4, valor: (tesoreria.conciliacion.ratio / 100) * 100 })
  if (controlesBase.length) {
    const suma = controlesBase.reduce((s, c) => s + c.valor * c.peso, 0)
    const pesoTotal = controlesBase.reduce((s, c) => s + c.peso, 0)
    controlesPuntaje = suma / pesoTotal
    controlesDetalle = controlesBase.map((c) => c.peso === 0.6
      ? `verificaciones internas del F29 declarado: ${Math.round(c.valor)}% correctas`
      : `conciliación bancaria: ${Math.round(c.valor)}% de la cartola aplicada`).join(' · ')
  }
  addDimension('controles', 'Controles y regularización', controlesPuntaje, controlesDetalle, 'Verificaciones del F29 declarado + conciliación bancaria')

  // Índice global: promedio ponderado de las dimensiones EVALUABLES.
  const evaluables = dimensiones.filter((d) => d.estado === 'evaluable')
  const pesoEvaluable = evaluables.reduce((s, d) => s + d.peso, 0)
  const score = evaluables.length
    ? Math.round(evaluables.reduce((s, d) => s + d.puntaje * d.peso, 0) / pesoEvaluable)
    : 0
  // Regla de producto: sin antecedentes verificados NO hay índice. La
  // dimensión «riesgos» siempre es evaluable (los hallazgos existen), pero sin
  // ficha ni RCV ese puntaje mide la falta de datos, no la salud de la
  // empresa: mostrarlo como 54/100 sería inventar una lectura.
  const sinEvidencia = conDatos === 0 && !f.inicioActividades
  // ST-05: «riesgos» es SIEMPRE evaluable (los hallazgos existen), pero por sí
  // sola no mide salud tributaria: con la ficha y nada más, el índice sería el
  // puntaje de riesgos (≈80/100) sin una sola fuente de datos. Si la única
  // dimensión con evidencia es «riesgos», no hay índice.
  const soloRiesgos = evaluables.length > 0 && evaluables.every((d) => d.clave === 'riesgos')
  const indiceEvaluable = evaluables.length > 0 && !sinEvidencia && !soloRiesgos

  const CLASIFICACIONES = [
    { min: 90, clave: 'SOLIDA', titulo: 'Sólida', interpretacion: 'Controles y cumplimiento favorables dentro del alcance revisado.' },
    { min: 75, clave: 'FAVORABLE', titulo: 'Favorable con observaciones', interpretacion: 'Existen brechas que deben gestionarse.' },
    { min: 60, clave: 'ATENCION', titulo: 'Requiere atención', interpretacion: 'Deben corregirse debilidades relevantes.' },
    { min: 40, clave: 'RIESGO', titulo: 'Riesgo elevado', interpretacion: 'Se requiere un plan de regularización prioritario.' },
    { min: 0, clave: 'CRITICA', titulo: 'Crítica', interpretacion: 'Existen deficiencias importantes que requieren intervención.' },
  ]
  const SIN_EVALUABLE = {
    min: 0, clave: 'NO_EVALUABLE',
    titulo: 'No evaluable con los antecedentes disponibles',
    interpretacion: 'No hay antecedentes verificados suficientes para emitir un índice: una materia sin datos no se puntúa.',
  }
  const clasificacion = CLASIFICACIONES.find((c) => score >= c.min)
  // Regla de producto: el índice nunca oculta una contingencia crítica.
  // La nota se adjunta SIEMPRE que haya alerta alta (no solo en «Sólida»):
  // sin ella, la portada mostraba un «84» en rojo etiquetado «Favorable con
  // observaciones» sin explicar por qué, y la nota se calculaba pero nunca
  // se mostraba en ningún capítulo.
  const alertaCritica = altas > 0
  // La nota se adjunta SIEMPRE que haya alerta alta, pero su texto NO puede
  // afirmar que el índice es favorable cuando el índice dice «Crítica»: en F3
  // la portada mostraba «34/100 · Crítica» seguido de «El índice es favorable»
  // (dos lecturas opuestas en la misma pantalla). El texto se elige según la
  // clasificación real.
  const notaAlertaConIndiceBueno = 'El índice es favorable, pero existen alertas de severidad alta que impiden una lectura de conformidad plena.'
  const notaAlertaCritica = 'Existen alertas de severidad alta que impiden una lectura de conformidad plena: revísalas antes de declarar o emitir documentos.'
  const indiceBueno = clasificacion.clave === 'SOLIDA' || clasificacion.clave === 'FAVORABLE'
  const notaAlerta = indiceBueno ? notaAlertaConIndiceBueno : notaAlertaCritica
  const clasificacionEfectiva = !indiceEvaluable
    ? SIN_EVALUABLE
    : alertaCritica && clasificacion.clave === 'SOLIDA'
      ? { ...CLASIFICACIONES[1], nota: notaAlertaConIndiceBueno }
      : alertaCritica
        ? { ...clasificacion, nota: notaAlerta }
        : clasificacion

  let nivel = 'AL_DIA'
  if (sinEvidencia) nivel = 'SIN_INFORMACION'
  else if (altas > 0) nivel = 'REQUIERE_REVISION'
  else if (medias > 0 || bajas > 0) nivel = 'CON_OBSERVACIONES'

  // ============================================================
  // TRES INDICADORES SEPARADOS (ST-03)
  // ============================================================
  // 1) Índice (`score`): salud tributaria según dimensiones ponderadas.
  // 2) Cobertura del ÍNDICE (`cobertura_diagnostico`): qué peso del índice
  //    tiene evidencia. Se CONSERVA el nombre por compatibilidad, pero ya no
  //    se rotula «cobertura del diagnóstico»: medía otra cosa.
  // 3) Cobertura de FUENTES (`cobertura_fuentes`): cuántas fuentes del
  //    diagnóstico se consultaron, incluidas TGR, F22, DJ y boletas de
  //    honorarios, que NO participan del índice. Antes, un informe con la TGR
  //    sin consultar podía mostrar «Cobertura 100%».
  // 4) Confianza (`nivel_confianza`): se deriva de la cobertura de fuentes y
  //    de la calidad del RCV, nunca del peso de las dimensiones.
  const coberturaDiagnostico = indiceEvaluable ? Math.round((evaluables.reduce((s, d) => s + d.peso, 0) / 1) * 100) : 0

  const estadoFuente = (consultada, parcial) => (consultada ? 'consultada' : parcial ? 'parcial' : 'no_consultada')
  const fuentes = [
    {
      clave: 'ficha_sii', nombre: 'Ficha del contribuyente (SII)',
      estado: estadoFuente(fichaPct === 100, fichaPct > 0),
      detalle: `inicio de actividades ${f.inicioActividades ? 'informado' : 'no informado'}, régimen ${f.regimen || 'no determinado'}, ${(f.actividades || []).length} actividad(es)`,
    },
    {
      clave: 'rcv', nombre: 'Registro de Compras y Ventas (RCV)',
      estado: estadoFuente(meses > 0 && conDatos === meses, conDatos > 0),
      detalle: `${conDatos}/${meses} período(s) con datos`,
    },
    {
      clave: 'f29_consulta_integral', nombre: 'Consulta Integral F29 (SII)',
      estado: estadoFuente(meses > 0 && f29EnVentana === meses, f29EnVentana > 0),
      detalle: f29Consultados ? `${f29EnVentana}/${meses} en la ventana · ${f29Consultados} en el historial` : 'sin consulta registrada',
    },
    {
      clave: 'f29_compacto', nombre: 'Formulario Compacto del F29 (SII)',
      estado: estadoFuente(f29Formularios.size > 0 && comparables.length > 0, f29Formularios.size > 0),
      detalle: f29Formularios.size ? `${f29Formularios.size} formulario(s), ${comparables.length} conciliable(s) con RCV` : 'no disponible',
    },
    {
      clave: 'f22', nombre: 'Renta (F22)',
      estado: estadoFuente(rentaAnual.size > 0, false),
      detalle: rentaAnual.size ? `${rentaAnual.size} año(s) consultado(s)` : 'no consultada',
    },
    {
      clave: 'dj', nombre: 'Declaraciones juradas (SII)',
      estado: estadoFuente(juradas.size > 0, false),
      detalle: juradas.size ? `${juradas.size} año(s) consultado(s)` : 'no consultadas',
    },
    {
      clave: 'bhe', nombre: 'Boletas de honorarios (SII)',
      estado: estadoFuente(bheOficial.size > 0, false),
      detalle: bheOficial.size ? `${bheOficial.size} año(s) consultado(s)` : 'no consultadas',
    },
    {
      clave: 'tgr', nombre: 'Deuda fiscal (TGR)',
      estado: estadoFuente(deudaFiscal.estado !== 'no_consultado', false),
      detalle: deudaFiscal.estado === 'no_consultado' ? 'no consultada' : (deudaFiscal.etiqueta || deudaFiscal.estado),
    },
    {
      clave: 'tesoreria', nombre: 'Tesorería y contabilidad del sistema',
      estado: estadoFuente(tesoreria.estado === 'disponible', false),
      detalle: tesoreria.estado === 'disponible' ? 'disponible' : 'sin movimientos registrados',
    },
  ]
  const fuentesConsultadas = fuentes.filter((x) => x.estado === 'consultada').length
  const fuentesParciales = fuentes.filter((x) => x.estado === 'parcial').length
  const fuentesNoConsultadas = fuentes.filter((x) => x.estado === 'no_consultada')
  const coberturaFuentesPct = fuentes.length ? Math.round((fuentesConsultadas / fuentes.length) * 100) : 0
  const coberturaFuentes = {
    pct: coberturaFuentesPct,
    consultadas: fuentesConsultadas,
    parciales: fuentesParciales,
    no_consultadas: fuentesNoConsultadas.length,
    requeridas: fuentes.length,
    faltantes: fuentesNoConsultadas.map((x) => x.nombre),
    por_fuente: fuentes,
    nota: 'Cobertura de FUENTES del diagnóstico: cuántas se consultaron y con qué completitud. Es independiente del índice y de la cobertura ponderada de sus dimensiones.',
  }

  // La confianza NO puede ser alta si faltan fuentes: exige cobertura de
  // fuentes ≥ 80% y RCV de la ventana ≥ 75%.
  const nivelConfianza = coberturaFuentesPct >= 80 && coberturaRcv >= 75 ? 'ALTA' : coberturaFuentesPct >= 50 ? 'MEDIA' : 'BAJA'
  const confianzaMotivos = [
    `Cobertura de fuentes ${coberturaFuentesPct}% (${fuentesConsultadas}/${fuentes.length} consultadas${fuentesParciales ? `, ${fuentesParciales} parcial(es)` : ''}).`,
    `Cobertura RCV ${coberturaRcv}% de la ventana analizada.`,
    ...(fuentesNoConsultadas.length ? [`Fuentes no consultadas: ${fuentesNoConsultadas.map((x) => x.nombre).join(', ')}.`] : []),
  ]

  const resumen = (() => {
    if (nivel === 'SIN_INFORMACION') {
      return 'No hay información suficiente para emitir una opinión: falta la ficha del SII y no hay RCV ingerido. Sincroniza la ficha y los libros antes de usar este informe.'
    }
    if (!indiceEvaluable) {
      return `No hay antecedentes verificados suficientes para emitir un índice: la ficha del SII no basta.${altas ? ` Se identificaron ${altas} hallazgo(s) de severidad alta que deben revisarse igual.` : ''} Sincroniza los libros (RCV) o las declaraciones del SII y vuelve a generar el informe.`
    }
    if (nivel === 'REQUIERE_REVISION') {
      return `La empresa presenta ${altas} hallazgo(s) de atención alta. El índice global (${score}/100, ${clasificacionEfectiva.titulo}) no sustituye esa lectura: antes de declarar o emitir documentos, revisa los puntos marcados en rojo.`
    }
    if (nivel === 'CON_OBSERVACIONES') {
      return `Sin hallazgos críticos, pero hay ${medias + bajas} observación(es) que conviene corregir para dejar la situación tributaria documentada. Índice ${score}/100 (${clasificacionEfectiva.titulo}) con cobertura de fuentes ${coberturaFuentesPct}% (${nivelConfianza.toLowerCase()}).`
    }
    return `Los antecedentes disponibles se ven consistentes: ficha SII completa y RCV con cobertura en el período analizado. Índice ${score}/100 (${clasificacionEfectiva.titulo}), cobertura de fuentes ${coberturaFuentesPct}% (${nivelConfianza.toLowerCase()}). Esto no reemplaza la revisión de las declaraciones oficiales.`
  })()

  // ============================================================
  // MATRIZ DE RIESGOS con exposición cuantificada
  // ============================================================
  // La exposición NO suma magnitudes que puedan solaparse: se separa en
  // «deuda efectiva», «diferencia por investigar» y «contingencia estimada».
  // Exposición cuantificada. Hay DOS magnitudes distintas y no se suman:
  //   · la diferencia F29 declarado − estimación del RCV, en PESOS DE
  //     IMPUESTO (IVA + PPM): es el dinero en disputa. Antes solo se medía con
  //     el Formulario Compacto (casi nunca hay), y la portada decía «$0 MM»
  //     mientras el capítulo 1 reportaba 11 períodos con diferencia.
  //   · la diferencia de VENTAS declaradas vs. RCV, en pesos brutos: es el
  //     diagnóstico de la causa (documentos faltantes), no exposición
  //     tributaria. Se muestra en la matriz pero NO suma al total.
  // ST-04: solo la SUBDECLARACIÓN (estimado > declarado) es exposición. Una
  // sobre-declaración significa que el contribuyente declaró/pagó de más: no
  // es dinero en riesgo, así que se informa aparte y NO suma al total.
  const exposicionDiferencias = diferencias
    .filter((m) => m.f29_diferencia > 0)
    .reduce((s, m) => s + m.f29_diferencia, 0)
  const sobreDeclaracion = diferencias
    .filter((m) => m.f29_diferencia < 0)
    .reduce((s, m) => s + Math.abs(m.f29_diferencia), 0)
  // exposicionDeudaFiscal se calculó con los hallazgos (monto del certificado).
  const exposicionVentas = difVentas.reduce((s, m) => s + Math.abs(m.comparacion.diferencia_ventas || 0), 0)
  const exposicionPendientes = f29PendientesVentana
    .filter((m) => m.estado === 'con_datos')
    .reduce((s, m) => s + Math.abs((m.iva_a_pagar ?? m.iva_estimado) + m.ppm_estimado), 0)
  const matrizRiesgos = hallazgos.map((h) => {
    let importe = null
    let naturaleza = 'sin cuantificar'
    let cuentaExposicion = false
    if (h.codigo === 'F29_VS_RCV') { importe = exposicionVentas; naturaleza = 'diferencia de ventas por conciliar'; cuentaExposicion = false }
    else if (h.codigo === 'F29_DIFERENCIA') {
      // Solo suma la subdeclaración; si todo lo detectado fue declarar de más,
      // la fila queda informativa y sin importe de exposición.
      importe = exposicionDiferencias || (sobreDeclaracion ? sobreDeclaracion : null)
      naturaleza = exposicionDiferencias ? 'diferencia por investigar' : 'sobre-declaración informada (no suma)'
      cuentaExposicion = exposicionDiferencias > 0
    }
    else if (h.codigo === 'F29_PENDIENTE') { importe = exposicionPendientes; naturaleza = 'contingencia estimada'; cuentaExposicion = true }
    else if (h.codigo === 'DEUDA_TGR') { importe = deudaFiscal.total; naturaleza = 'deuda efectiva (TGR)'; cuentaExposicion = deudaFiscal.total != null }
    return {
      codigo: h.codigo,
      titulo: h.titulo,
      severidad: h.severidad,
      materia: h.codigo.startsWith('F29') ? 'IVA' : h.codigo.startsWith('F22') ? 'Renta' : h.codigo.startsWith('TES') ? 'Tesorería' : 'Cumplimiento',
      impacto: h.severidad === 'alta' ? 'alto' : h.severidad === 'media' ? 'medio' : 'bajo',
      probabilidad: h.severidad === 'alta' ? 'alta' : h.severidad === 'media' ? 'media' : 'baja',
      importe: importe ? Math.round(importe) : null,
      // Si el importe NO suma al total (la diferencia de ventas es un
      // diagnóstico en pesos brutos), el informe lo declara para que nadie
      // sume la fila y lo lea como exposición tributaria.
      cuenta_exposicion: cuentaExposicion,
      naturaleza,
      responsable: h.severidad === 'alta' ? 'Contador responsable' : 'Contador',
      plazo: h.severidad === 'alta' ? '5 días hábiles' : h.severidad === 'media' ? '15 días hábiles' : '30 días',
      evidencia: h.fuente,
    }
  })
  const exposicionTotal = matrizRiesgos.reduce((s, r) => s + (r.cuenta_exposicion ? (r.importe || 0) : 0), 0)

  // ============================================================
  // CALENDARIO DE CUMPLIMIENTO
  // ============================================================
  const calendario = mensuales.map((m) => ({
    periodo: m.periodo,
    nombre: m.nombre,
    revisada: m.f29_estado !== 'no_consultado',
    cumplida: m.f29_estado === 'declarada' || m.f29_estado === 'rectificada',
    estado: m.f29_estado,
    monto_declarado: m.f29_oficial?.monto_total ?? null,
  }))

  // ============================================================
  // QUÉ CAMBIÓ (respecto del informe anterior)
  // ============================================================
  const anterior = (() => {
    const fila = db.prepare(`
      SELECT id, periodo, generado_en, opinion_nivel, score, datos_json
      FROM salud_tributaria_snapshots WHERE empresa_id = ? ORDER BY id DESC LIMIT 1
    `).get(empresaId)
    if (!fila) return null
    let datos = null
    try { datos = JSON.parse(fila.datos_json) } catch { datos = null }
    const prev = Array.isArray(datos?.opinion?.hallazgos) ? datos.opinion.hallazgos : []
    const prevCodigos = new Set(prev.map((x) => x.codigo))
    const prevScore = Number.isFinite(Number(fila.score)) ? Number(fila.score) : null
    const nuevos = hallazgos.filter((h) => !prevCodigos.has(h.codigo)).map((h) => ({ codigo: h.codigo, titulo: h.titulo, severidad: h.severidad }))
    const resueltos = prev.filter((h) => !hallazgos.some((x) => x.codigo === h.codigo)).map((h) => ({ codigo: h.codigo, titulo: h.titulo, severidad: h.severidad }))
    return {
      snapshot_id: fila.id,
      periodo: fila.periodo,
      generado_en: fila.generado_en,
      indice_anterior: prevScore,
      variacion_indice: prevScore == null ? null : score - prevScore,
      alertas_nuevas: nuevos,
      alertas_resueltas: resueltos,
      lectura: prevScore == null
        ? 'Primer informe de la serie: no hay antecedente con el cual comparar.'
        : score === prevScore
          ? 'El índice se mantiene respecto del informe anterior.'
          : score > prevScore
            ? `El índice subió ${score - prevScore} puntos respecto del informe anterior. Verifica que el improvement provenga de una regularización real y no solo de mayor cobertura de información.`
            : `El índice bajó ${prevScore - score} puntos respecto del informe anterior. Revisa las alertas nuevas antes de cerrar el período.`,
    }
  })()

  // ============================================================
  // PLAN DE ACCIÓN
  // ============================================================
  const planAccion = matrizRiesgos
    .filter((r) => r.severidad === 'alta' || r.severidad === 'media')
    .map((r, i) => ({
      prioridad: i + 1,
      accion: r.codigo === 'F29_VS_RCV'
        ? 'Conciliar el RCV del período con las casillas del F29 declarado y regularizar los documentos que falten.'
        : r.codigo === 'F29_PENDIENTE'
          ? 'Presentar el F29 del período pendiente o Regularizar el Formulario Compacto en el portal del SII.'
          : r.codigo === 'F29_DIFERENCIA'
            ? 'Revisar la diferencia entre el F29 declarado y la estimación del sistema, documento a documento.'
            : r.codigo === 'DEUDA_TGR'
            ? 'Revisar el certificado de deuda de la TGR, pagar o convenir la deuda y repetir la consulta para dejar el certificado vigente como evidencia.'
          : r.codigo === 'COBERTURA_RCV_PARCIAL'
              ? 'Sincronizar el RCV de los meses sin datos antes de emitir el informe definitivo.'
              : r.codigo === 'SIN_RCV' || r.codigo === 'SIN_RCV_RECIENTE'
                ? 'Ejecutar la ingesta de compras y ventas desde el SII para completar el diagnóstico.'
                : `Resolver: ${r.titulo}.`,
      motivo: r.titulo,
      responsable: r.responsable,
      plazo: r.plazo,
      impacto_estimado: r.importe,
      evidencia: r.evidencia,
      estado: 'pendiente',
    }))

  // Fortalezas: lo que el diagnóstico confirma que está bien.
  const fortalezas = []
  if (f29Declaradas.length && !f29Pendientes.length) {
    fortalezas.push(`Cumplimiento sin brechas visibles: ${f29Declaradas.length} período(s) con F29 declarado vigente y sin pendientes registrados en el SII${rangoF29 ? ` (${rangoF29})` : ''}.`)
  }
  if (comparables.length && !comparables.some((m) => Math.abs(m.comparacion.diferencia_ventas || 0) >= 1000)) {
    fortalezas.push('Las ventas declaradas en el F29 coinciden con el RCV del sistema en los períodos conciliados.')
  }
  if (verifFallidas.length === 0 && f29Formularios.size) {
    fortalezas.push('Las casillas del Formulario Compacto son internamente consistentes (débito, crédito, IVA y PPM cuadran entre sí).')
  }
  if (coberturaRcv >= 90) {
    fortalezas.push(`Cobertura de libros casi completa: ${coberturaRcv}% de los períodos analizados con RCV ingerido.`)
  }
  if (fichaPct >= 70) {
    fortalezas.push('Ficha del contribuyente vigente en el SII: régimen, inicio de actividades y actividad económica acreditados.')
  }
  if (tesoreria.conciliacion && tesoreria.conciliacion.ratio >= 80) {
    fortalezas.push(`Conciliación bancaria al día: ${tesoreria.conciliacion.ratio}% de la cartola aplicada.`)
  }
  if (deudaFiscal.estado === 'sin_deuda') {
    fortalezas.push(`Sin deuda fiscal en la Tesorería: el certificado TGR emitido el ${deudaFiscal.fecha_emision || deudaFiscal.consultado_en} no registra deuda.`)
  }
  if (djPresentadas.length) {
    fortalezas.push(`${djPresentadas.length} declaración(es) jurada(s) presentada(s) en el SII: ${[...new Set(djPresentadas.map((d) => `DJ ${d.dj}`))].join(', ')}.`)
  }
  if (juradas.size && !djPendientes.length && !djObservadas.length) {
    fortalezas.push('Sin declaraciones juradas pendientes ni observadas para los años consultados.')
  }
  if (rentaAnual.size) {
    const devol = [...rentaAnual.values()].filter((r) => (r.remanente_devuelto || 0) > 0)
    if (devol.length) {
      const total = devol.reduce((s, r) => s + (r.remanente_devuelto || 0), 0)
      fortalezas.push(`Renta con devolución autorizada por el SII en ${devol.length} período(s), por ${total.toLocaleString('es-CL')} CLP: crédito fiscal disponible para seguimiento.`)
    }
  }

  const opinion = {
    nivel,
    titulo: {
      AL_DIA: 'Al día (según antecedentes disponibles)',
      CON_OBSERVACIONES: 'Con observaciones',
      REQUIERE_REVISION: 'Requiere revisión',
      SIN_INFORMACION: 'Sin información suficiente',
    }[nivel],
    resumen,
    fundamentos: [
      `Ficha SII: ${f.origen || 'ficha guardada'}; inicio de actividades ${f.inicioActividades || 'no informado'}; régimen ${f.regimen || 'no determinado'}.`,
      `Cobertura RCV: ${conDatos} mes(es) con datos, ${sinMovimiento} sin movimiento confirmado y ${sinDatos} sin sincronizar en los últimos ${meses} meses.`,
      `Ingresos por ventas en el período: ${mensuales.reduce((s, m) => s + m.ventas_neto, 0).toLocaleString('es-CL')} CLP (neto, RCV).`,
      f29Consultados
        ? `F29 oficial: ${f29Declaradas.length} período(s) declarado(s) y ${f29Pendientes.length} pendiente(s) según el SII (${f29Consultados} período(s) consultados${rangoF29 ? `, ${rangoF29}` : ''}).`
        : 'F29 oficial: sin consultar; los montos mensuales son estimaciones desde el RCV.',
      f22Consultado
        ? `Renta: ${f22Anios.filter((d) => d.estado === 'declarada' || d.estado === 'rectificada').length} año(s) con F22 declarado de ${f22Anios.length} consultados.`
        : 'Renta (F22): sin consultar.',
      juradas.size
        ? `Declaraciones juradas: ${djPresentadas.length} presentada(s) y ${djPendientes.length} sin presentación registrada en ${juradas.size} año(s) consultado(s) al SII.`
        : 'Declaraciones juradas: sin consultar.',
      deudaFiscal.estado === 'no_consultado'
        ? 'Deuda fiscal (TGR): sin consultar.'
        : `Deuda fiscal (TGR): ${deudaFiscal.etiqueta}${deudaFiscal.total != null ? ` por ${Number(deudaFiscal.total).toLocaleString('es-CL')} CLP` : ''}, certificado de ${deudaFiscal.fecha_emision || 'fecha no informada'}.`,
    ],
    recomendaciones: hallazgos
      .filter((h) => h.severidad === 'alta' || h.severidad === 'media')
      .map((h) => h.titulo),
    limitaciones: [
      'Opinión automatizada sobre datos verificables. No es una certificación tributaria ni reemplaza la revisión de un asesor.',
      ...(f29Consultados
        ? ['El estado del F29 se lee de la Consulta Integral del SII; los montos de IVA y PPM siguen siendo estimaciones propias desde el RCV.']
        : ['No se consultó el estado oficial del F29: los montos mensuales son estimaciones desde el RCV.']),
      ...(mensuales.some((m) => m.f29_oficial?.monto_total != null && m.f29_oficial.conciliable === false)
        ? ['Los montos del F29 leídos de la Consulta Integral no identifican la casilla declarada: se informan como dato del SII, pero no se comparan con la estimación del RCV. La conciliación exige el Formulario Compacto (casilla 091, total a pagar).']
        : []),
      ...(f22Consultado ? [] : ['No se consultó el F22 (renta): la existencia de la declaración anual no está verificada.']),
      ...(bheAnios.length ? [] : ['No se consultaron las boletas de honorarios: su ausencia en el informe no significa que no existan.']),
      ...(juradas.size ? [] : ['No se consultaron las declaraciones juradas: el informe no puede afirmar que estén presentadas.']),
      ...(deudaFiscal.estado === 'no_consultado'
        ? ['No se consultó la deuda fiscal en la TGR: la ausencia de deuda en este informe no significa que no exista.']
        : []),
      ...(deudaFiscal.estado === 'con_deuda'
        ? ['La deuda fiscal corresponde a la foto del certificado TGR: no incluye deuda posterior ni acuerdos de pago vigentes.']
        : []),
      'Los montos de IVA, PPM y F29 son ESTIMACIONES calculadas desde el RCV, no lo declarado.',
      'La prescripción y los plazos legales deben evaluarse caso a caso (Código Tributario art. 200 y normas especiales).',
    ],
    base_normativa: [
      'D.L. 825 art. 29 — declaración y pago mensual del IVA (F29).',
      'Ley de la Renta art. 65 — declaración anual de renta (F22).',
      'Ley 21.210 — regímenes Pro Pyme (14 D N°3 transparente y N°3 general).',
      'Ley 20.727 — boleta de honorarios electrónica.',
      'Código Tributario art. 200 — plazos de prescripción.',
    ],
    score,
    hallazgos,
    // ---- v2: índice por dimensiones, exposición, plan y opinión profesional ----
    indice_evaluable: indiceEvaluable,
    dimensiones,
    clasificacion: clasificacionEfectiva,
    clasificacion_escala: CLASIFICACIONES,
    cobertura_diagnostico: coberturaDiagnostico,
    cobertura_fuentes: coberturaFuentes,
    nivel_confianza: nivelConfianza,
    confianza_motivos: confianzaMotivos,
    alerta_critica: alertaCritica,
    exposicion: {
      total: Math.round(exposicionTotal),
      por_naturaleza: {
        // El dinero en disputa: diferencia entre el F29 declarado y la
        // estimación del RCV, en pesos de impuesto (IVA + PPM).
        diferencia_por_investigar: Math.round(exposicionDiferencias),
        // Sobre-declaración: el contribuyente pagó de más. Se informa, no suma.
        sobre_declaracion: Math.round(sobreDeclaracion),
        contingencia_estimada: Math.round(exposicionPendientes),
        deuda_fiscal_tgr: Math.round(exposicionDeudaFiscal),
        // Diagnóstico de la causa, en pesos brutos de ventas: NO suma al
        // total (contarían las mismas diferencias dos veces).
        diferencia_ventas_por_conciliar: Math.round(exposicionVentas),
      },
      nota: 'Suma sin duplicidad: el total suma la deuda fiscal del certificado TGR (deuda efectiva), la SUBDECLARACIÓN del F29 frente a la estimación del RCV (pesos de impuesto) y la contingencia de declaraciones pendientes. No suman: la diferencia de ventas (mide la causa en pesos brutos) ni la sobre-declaración (el contribuyente pagó de más), que se informan aparte.',
    },
    matriz_riesgos: matrizRiesgos,
    calendario,
    plan_accion: planAccion,
    fortalezas,
    que_cambio: anterior,
    opinion_profesional: {
      hechos: [
        ...(f29Declaradas.length ? [`El SII registra ${f29Declaradas.length} período(s) con F29 declarado vigente${rangoF29 ? ` (${rangoF29})` : ''}.`] : []),
        ...(comparables.length ? [`${comparables.length} período(s) tienen casillas del Formulario Compacto leídas directamente del SII, con ${verifOk}/${verifTotal} verificaciones internas correctas.`] : []),
        ...(rentaAnual.size ? [`El SII registra ${rentaAnual.size} año(s) con declaración de renta consultada en su consulta de estado.`] : []),
        ...(djPresentadas.length ? [`El SII registra ${djPresentadas.length} declaración(es) jurada(s) presentada(s) en ${juradas.size} año(s): ${[...new Set(djPresentadas.map((d) => `DJ ${d.dj}`))].join(', ')}.`] : []),
        ...(djPendientes.length ? [`El SII lista ${djPendientes.length} DJ aplicable(s) sin presentación registrada${djVencidas.length ? `, de las cuales ${djVencidas.length} ya venció` : ''}.`] : []),
        ...(deudaFiscal.estado === 'sin_deuda' ? [`La TGR certifica que el RUT no registra deuda fiscal al ${deudaFiscal.liquidada_al || deudaFiscal.fecha_emision || 'día de la consulta'}.`] : []),
        ...(deudaFiscal.estado === 'con_deuda' ? [`La TGR registra deuda fiscal${deudaFiscal.total != null ? ` por ${Number(deudaFiscal.total).toLocaleString('es-CL')} CLP` : ' (monto no legible en el certificado)'} al ${deudaFiscal.liquidada_al || deudaFiscal.fecha_emision || 'día de la consulta'}.`] : []),
      ],
      diferencias: [
        ...(difVentas.length ? [`${difVentas.length} período(s) presentan diferencias entre las ventas declaradas en el F29 y el RCV del sistema, por un total de ${Math.round(exposicionVentas).toLocaleString('es-CL')} CLP en ventas.`] : []),
        ...(diferencias.length ? [`${diferencias.length} período(s) presentan diferencias entre el F29 declarado y la estimación del RCV, por un total de ${Math.round(exposicionDiferencias).toLocaleString('es-CL')} CLP de impuesto declarado.`] : []),
        ...(f29Pendientes.length ? [`${f29Pendientes.length} período(s) sin declaración vigente en el SII${rangoF29 ? ` (${rangoF29})` : ''}, con un impuesto estimado no presentado de ${Math.round(exposicionPendientes).toLocaleString('es-CL')} CLP en los períodos con RCV del período analizado.`] : []),
      ],
      riesgos: [
        ...(altas ? [`${altas} hallazgo(s) de severidad alta requieren actuación: ${hallazgos.filter((h) => h.severidad === 'alta').map((h) => h.titulo).join('; ')}.`] : []),
        ...(tesoreria.cobranza && tesoreria.cobranza.vencido_30_dias ? [`Cartera vencida sobre 30 días por ${tesoreria.cobranza.vencido_30_dias.toLocaleString('es-CL')} CLP, que puede comprometer el IVA del período siguiente.`] : []),
        ...(deudaFiscal.estado === 'con_deuda' ? [`Deuda fiscal vigente ante la TGR${deudaFiscal.total != null ? ` por ${Number(deudaFiscal.total).toLocaleString('es-CL')} CLP` : ''}: devenga reajustes e intereses y puede impedir certificados y convenios.`] : []),
      ],
      conclusion: `Con base en los antecedentes examinados para el período comprendido entre ${nombrePeriodo(desde)} y ${nombrePeriodo(periodoFinal)}, la entidad presenta un índice de salud tributaria de ${indiceEvaluable ? `${score}/100 (${clasificacionEfectiva.titulo})` : 'no evaluable con los antecedentes disponibles'}, con una cobertura de fuentes de ${coberturaFuentesPct}% (índice evaluado sobre ${coberturaDiagnostico}% de su peso) y nivel de confianza ${nivelConfianza.toLowerCase()}. ${alertaCritica ? 'Existen alertas de severidad alta que impiden una lectura de conformidad plena, con independencia del índice.' : 'No se identificaron contingencias críticas dentro del alcance revisado.'}`,
      recomendacion: planAccion.length
        ? `Prioridad recomendada: ${planAccion[0].accion} (${planAccion[0].plazo}, ${planAccion[0].responsable}).${planAccion.length > 1 ? ` Le siguen ${planAccion.length - 1} acción(es) priorizadas en el plan de acción.` : ''}`
        : 'Mantener el control mensual: sincronizar los libros y las declaraciones en cada cierre de período.',
      advertencias: [
        'Los montos del RCV son los que el sistema tiene ingeridos; los del F29 son los declarados. La diferencia entre ambos es materia de investigación, no una conclusión de incumplimiento.',
        'Este documento es una opinión técnica automatizada sobre antecedentes verificables. No es una certificación tributaria, no constituye asesoría legal personalizada y no reemplaza la revisión profesional de un contador.',
      ],
    },
  }

  return {
    ok: true,
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre, tasa_ppm: tasa, exento: !!emp.exento },
    periodo: periodoFinal,
    generado_en: new Date().toISOString(),
    identidad: {
      rut: f.rut || emp.rut,
      razon_social: f.nombre || emp.razon_social_sii || emp.nombre,
      tipo_contribuyente: f.tipoContribuyente || null,
      subtipo_contribuyente: f.subtipoContribuyente || null,
      inicio_actividades: f.inicioActividades || null,
      termino_giro: f.terminoGiro || null,
      actividades: f.actividades || [],
      direccion: f.direccion || null,
      direcciones: f.direcciones || [],
      unidad_operativa: f.unidadOperativa || null,
      capital: f.capital || null,
      segmento: f.segmento || null,
      email: f.email || null,
      telefono: f.telefono || null,
      regimen: f.regimen || null,
      regimen_atributo: f.regimenAtributo || null,
      atributos: f.atributos || [],
      alertas_sii: f.alertas || [],
      fuente: f.origen || 'ficha guardada',
    },
    declaraciones: {
      f29: resumenTipoDeclaraciones(new Map(f29Historial.map((d) => [d.periodo, d])), { desde: desdeF29, hasta: periodoFinal, etiquetaBase: 'Consulta Integral F29' }),
      renta_f22: resumenTipoDeclaraciones(f22Oficial, { desde: anioDesde, hasta: anioHasta, etiquetaBase: 'Renta (F22)' }),
      juradas: resumenTipoDeclaraciones(leerDeclaraciones(db, empresaId, 'DJ', anioDesde, anioHasta), {
        desde: anioDesde, hasta: anioHasta, etiquetaBase: 'Declaraciones juradas',
      }),
      boletas_honorarios: resumenTipoDeclaraciones(bheOficial, { desde: anioDesde, hasta: anioHasta, etiquetaBase: 'Boletas de honorarios' }),
    },
    declaraciones_anuales: {
      desde: anioDesde,
      hasta: anioHasta,
      anios: Array.from({ length: anioHasta - anioDesde + 1 }, (_, i) => {
        const anio = String(anioHasta - i)
        const rcvAnio = anios.find((a) => a.anio === anio) || null
        const f22 = f22Oficial.get(anio) || null
        const bhe = bheOficial.get(anio) || null
        return {
          anio,
          rcv: rcvAnio ? { ventas_neto: rcvAnio.ventas_neto, iva_estimado: rcvAnio.iva_estimado, meses_con_datos: rcvAnio.meses_con_datos } : null,
          f22: f22 ? {
            estado: f22.estado || 'sin_informacion',
            etiqueta: ETIQUETA_ESTADO_DECL[f22.estado] || 'Sin información',
            folio: f22.folio || null,
            fecha_presentacion: f22.fecha_presentacion || null,
            // El total a pagar no está disponible en la consulta de estado F22.
            monto_total: null,
            resumen: f22.resumen || {
              total_declarado: null,
              remanente_solicitado: f22.remanente_solicitado ?? null,
              remanente_devuelto: f22.remanente_devuelto ?? null,
              monto_giro: f22.monto_giro ?? null,
            },
          } : null,

          boletas_honorarios: bhe ? {
            emitidas: bhe.datos?.emitidas || null,
            recibidas: bhe.datos?.recibidas || null,
          } : null,
          juradas: juradas.get(anio) || null,
        }
      }),
      totales_boletas: bheAnios.length ? { emitidas: bheEmitidas, recibidas: bheRecibidas } : null,
    },
    ingresos_historicos: {
      estado: 'parcial',
      fuente: 'RCV ingerido',
      anios,
      nota: 'Solo se muestran años con RCV ingerido. No es una consulta oficial de ingresos.',
    },
    mensuales,
    cobertura: {
      desde,
      hasta: periodoFinal,
      meses,
      con_datos: conDatos,
      sin_movimiento: sinMovimiento,
      sin_datos: sinDatos,
      completa: sinDatos === 0,
    },
    capacidades_sii: CAPACIDADES_SII,
    capacidades_tgr: CAPACIDADES_TGR,
    // Deuda FISCAL (TGR). Se declara aparte de la deuda comercial del sistema.
    deudas: {
      fiscal_tgr: deudaFiscal,
      comercial: {
        por_cobrar: tesoreria.cobranza ? tesoreria.cobranza.total : null,
        por_pagar: tesoreria.proveedores ? tesoreria.proveedores.total : null,
        nota: 'Deuda comercial derivada de los documentos y movimientos del sistema. No es deuda fiscal.',
      },
    },
    declaraciones_juradas: {
      estado: juradas.size ? 'disponible' : 'no_consultado',
      fuente: 'SII — Mis Declaraciones Juradas (perfilamientodjui)',
      anios_consultados: juradas.size,
      total_presentadas: djPresentadas.length,
      total_pendientes: djPendientes.length,
      vencidas: djVencidas.length,
      observadas: djObservadas.length,
      ultima_consulta: [...juradas.values()].reduce((max, j) => (j.consultado_en > max ? j.consultado_en : max), '') || null,
      anios: [...juradas.values()],
      presentadas: djPresentadas.sort((a, b) => String(b.anio).localeCompare(String(a.anio)) || String(b.fecha_presentacion).localeCompare(String(a.fecha_presentacion))),
      pendientes: djPendientes.sort((a, b) => String(b.anio).localeCompare(String(a.anio))),
      nota: 'El SII entrega las DJ presentadas y su estado, folio y fechas. Esta consulta no expone el detalle de casillas de cada formulario: el monto declarado en la DJ no se informa aquí.',
    },
    opinion,
    // ---- v2: inteligencia financiera, tesorería y declared vs RCV ----
    kpis: calcularKpis(mensuales, { f29Formularios, tesoreria, tasa }),
    serie: serieMensual(mensuales, f29Formularios),
    tesoreria,
    renta: {
      estado: rentaAnual.size ? 'disponible' : 'no_consultado',
      anios: [...rentaAnual.values()].sort((a, b) => b.anio.localeCompare(a.anio)),
      rango: { desde: anioDesde, hasta: anioHasta, anios: 5 },
    },
    f29_declarado: {
      estado: f29Formularios.size ? 'disponible' : 'no_consultado',
      fuente: 'Formulario Compacto del F29 (SII)',
      periodos: [...f29Formularios.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)),
      verificaciones_ok: verifOk,
      verificaciones_total: verifTotal,
    },
    // Historial completo del F29: TODAS las declaraciones leídas al SII (los
    // 5 años de la Consulta Integral), no solo la ventana de análisis. Cada
    // fila lleva el folio y la fecha de presentación del SII; las que tienen
    // Formulario Compacto agregan el resumen de casillas y el enlace al PDF
    // original, que se abre tal como se presentó ante el SII.
    f29_historial: {
      desde: desdeF29,
      hasta: periodoFinal,
      estado: f29Historial.length ? 'disponible' : 'no_consultado',
      fuente: 'Consulta Integral + Formulario Compacto del F29 (SII)',
      rango: rangoF29,
      consultados: f29Consultados,
      declaradas: f29Declaradas.length,
      pendientes: f29Pendientes.length,
      periodos: f29Historial.map((d) => {
        const ff = f29Formularios.get(d.periodo)
        return {
          periodo: d.periodo,
          estado: d.estado,
          folio: d.folio || null,
          fecha_presentacion: d.fecha_presentacion || null,
          monto_total: d.monto_total ?? null,
          monto_concepto: d.monto_concepto || d.datos?.monto_concepto || 'no_identificado',
          origen: d.origen || 'consulta_integral',
          url: (ff && ff.url) || d.url || null,
          resumen: ff ? {
            base_imponible: ff.indicadores?.base_imponible ?? null,
            iva_determinado: ff.indicadores?.iva_determinado ?? null,
            ppm_neto: ff.indicadores?.ppm_neto ?? null,
            total_a_pagar: ff.indicadores?.total_a_pagar ?? null,
            remanente_credito_fiscal: ff.indicadores?.remanente_credito_fiscal ?? null,
          } : null,
        }
      }).sort((a, b) => b.periodo.localeCompare(a.periodo)),
    },
    metodologia: {
      indice: 'JMV Tax Health — promedio ponderado de cinco dimensiones evaluables (cumplimiento 25%, consistencia y conciliación 25%, riesgos y contingencias 20%, calidad y cobertura de datos 15%, controles y regularización 15%).',
      regla_no_evaluable: 'Una dimensión sin antecedentes no se puntúa con cero: se declara «no evaluable» y su peso se redistribuye entre las demás.',
      regla_alerta_critica: 'El índice nunca oculta una contingencia crítica: las alertas de severidad alta se muestran siempre, con independencia del puntaje.',
      conciliacion_f29: 'La diferencia entre el F29 declarado y la estimación del RCV solo se calcula cuando el monto declarado proviene de la casilla 091 (total a pagar) del Formulario Compacto. El «Monto» de la Consulta Integral se informa como dato del SII, pero no se compara: esa grilla no identifica la casilla.',
      margen: 'La diferencia ventas − compras del RCV NO es margen bruto: las compras del RCV incluyen bienes de capital y compras sin relación con el costo de ventas. Se publica con ese nombre y queda «no evaluable» con ventas insuficientes o cuando el resultado no puede ser un margen (|%| > 100).',
      exposicion_signo: 'Solo la subdeclaración (estimado del RCV mayor que lo declarado) suma a la exposición. La sobre-declaración —el contribuyente pagó de más— se informa aparte y no suma.',
      cobertura: 'Se publican tres indicadores separados: (1) índice de salud tributaria; (2) cobertura del índice (peso de las dimensiones con evidencia); (3) cobertura de fuentes (fuentes del diagnóstico consultadas, incluidas TGR, F22, DJ y boletas de honorarios). El nivel de confianza se deriva de la cobertura de fuentes y de la calidad del RCV, no del índice.',
      clasificacion: '90–100 Sólida · 75–89 Favorable con observaciones · 60–74 Requiere atención · 40–59 Riesgo elevado · 0–39 Crítica.',
      origen_datos: [
        { clave: 'obtenidos', nombre: 'Datos obtenidos directamente', detalle: 'Ficha del contribuyente, RCV, estados y casillas de declaraciones: consultados desde el SII con la sesión del contribuyente.' },
        { clave: 'importados', nombre: 'Datos importados', detalle: 'Documentos y movimientos cargados por el cliente o su contador (bandeja, tesorería y contabilidad).' },
        { clave: 'calculados', nombre: 'Datos calculados', detalle: 'Indicadores derivados con fórmulas documentadas (IVA, PPM, ratios, aging de cobranza, índice de salud).' },
        { clave: 'estimados', nombre: 'Datos estimados', detalle: 'Proyecciones y escenarios que requieren validación del contador.' },
        { clave: 'no_disponibles', nombre: 'Datos no disponibles', detalle: 'Materias que no se pueden evaluar todavía (remuneraciones, retenciones,Declaraciones juradas).' },
      ],
      limitaciones_generales: [
        'El informe no constituye una auditoría de estados financieros ni una certificación tributaria.',
        'Las diferencias detectadas son materia de investigación: no prueban por sí mismas un incumplimiento.',
        'Los plazos legales y la prescripción deben evaluarse caso a caso.',
      ],
    },
  }
}

// ============================================================
// RESUMEN PARA EL PANEL Y EL MENÚ (KPI + pill)
// ============================================================
// Construir el informe completo cuesta ~0,8 s en la empresa más grande
// (13.000 documentos, 12 meses). El panel del período y el menú lo pedirían en
// CADA navegación, así que el resumen se cachea 60 s por empresa+período: sigue
// siendo el mismo dato y la vista de detalle nunca lee este caché. Cualquier
// sincronización llama a `olvidarResumen` y lo invalida de inmediato.
const CACHE_RESUMEN_MS = 60 * 1000
const cacheResumen = new Map()

function resumenInforme(db, { empresaId, periodo, meses = 12, ficha = null, ahora = Date.now() } = {}) {
  const clave = `${empresaId}|${periodo}|${meses}`
  const enCache = cacheResumen.get(clave)
  if (enCache && ahora - enCache.en < CACHE_RESUMEN_MS) return { ...enCache.valor, cache: true }

  const inf = construirInforme(db, { empresaId, periodo, meses, ficha })
  const op = inf.opinion
  const valor = {
    empresa_id: empresaId,
    periodo: inf.periodo,
    nivel: op.nivel,
    titulo: op.titulo,
    score: op.score,
    indice_evaluable: op.indice_evaluable,
    hallazgos: (op.hallazgos || []).length,
    hallazgos_altos: (op.hallazgos || []).filter((h) => h.severidad === 'alta').length,
    cobertura: {
      con_datos: inf.cobertura.con_datos,
      sin_datos: inf.cobertura.sin_datos,
      completa: inf.cobertura.completa,
    },
    // Qué se consultó de verdad: la UI no puede sugerir «al día» si el F29
    // oficial nunca se leyó.
    f29_oficial: inf.declaraciones.f29.estado !== 'no_consultado',
    boletas: inf.declaraciones.boletas_honorarios.estado !== 'no_consultado',
    juradas: inf.declaraciones_juradas.estado !== 'no_consultado',
    deuda_tgr: {
      estado: inf.deudas.fiscal_tgr.estado,
      total: inf.deudas.fiscal_tgr.total,
      fecha_emision: inf.deudas.fiscal_tgr.fecha_emision || null,
    },
    ficha: !!ficha,
    generado_en: inf.generado_en,
  }
  cacheResumen.set(clave, { en: ahora, valor })
  return { ...valor, cache: false }
}

/** Invalida el resumen cacheado de una empresa (o todos si se omite). */
function olvidarResumen(empresaId = null) {
  if (empresaId == null) { cacheResumen.clear(); return }
  for (const k of [...cacheResumen.keys()]) {
    if (k.startsWith(`${empresaId}|`)) cacheResumen.delete(k)
  }
}

/** Guarda el informe como evidencia inmutable (el JSON completo). */
function guardarSnapshot(db, { empresaId, periodo, usuarioId = null, informe }) {
  const info = db.prepare(`
    INSERT INTO salud_tributaria_snapshots
      (empresa_id, periodo, generado_por, opinion_nivel, score, datos_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    empresaId,
    periodo,
    usuarioId,
    informe.opinion.nivel,
    informe.opinion.score,
    JSON.stringify(informe),
  )
  return Number(info.lastInsertRowid)
}

function ultimoSnapshot(db, empresaId, periodo = null) {
  const fila = periodo
    ? db.prepare(`SELECT id, periodo, generado_en, opinion_nivel, score FROM salud_tributaria_snapshots WHERE empresa_id = ? AND periodo = ? ORDER BY id DESC LIMIT 1`).get(empresaId, periodo)
    : db.prepare(`SELECT id, periodo, generado_en, opinion_nivel, score FROM salud_tributaria_snapshots WHERE empresa_id = ? ORDER BY id DESC LIMIT 1`).get(empresaId)
  return fila || null
}

module.exports = {
  CAPACIDADES_SII,
  CAPACIDADES_TGR,
  construirInforme,
  guardarAgregados,
  agregadosPorPeriodo,
  resumenInforme,
  olvidarResumen,
  guardarSnapshot,
  ultimoSnapshot,
  periodoValido,
  ultimosPeriodos,
}
