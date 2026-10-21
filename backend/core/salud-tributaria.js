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

const { calcularIVA, calcularPPM, calcularTotalF29 } = require('../services/calculos')

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
    id: 'renta_f22',
    nombre: 'Estado de declaraciones de renta (F22)',
    estado: 'no_integrado',
    fuente: 'SII Renta',
    evidencia: null,
    detalle: 'No se encontró una consulta de estado F22 por RUT en los portales accesibles con el login simple; el flujo de Renta exige la operación renta. Queda «no consultado».',
  },
  {
    id: 'declaraciones_juradas',
    nombre: 'Estado de declaraciones juradas',
    estado: 'no_integrado',
    fuente: 'SII Declaraciones Juradas',
    evidencia: null,
    detalle: 'La Consulta Integral permite buscarlas formulario a formulario, no por RUT. No se implementó para no inventar resultados.',
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
    mapa.set(String(f.periodo), { ...f, periodo: String(f.periodo), datos })
  }
  return mapa
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

/**
 * Construye el informe. `ficha` es opcional: si no se pasa, usa la guardada
 * en empresas (y lo declara). No hace red.
 */
function construirInforme(db, { empresaId, periodo, meses = 12, ficha = null }) {
  const emp = db.prepare(`SELECT * FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  if (!periodoValido(periodo)) throw new Error('Período inválido (YYYYMM)')

  const f = ficha || fichaDesdeEmpresa(emp)
  const periodoFinal = periodo
  const periodoLista = ultimosPeriodos(meses, periodoFinal)
  const desde = periodoLista[0]
  const porPeriodo = docsPorPeriodo(db, empresaId, desde, periodoFinal)
  const tasa = Number(emp.tasa_ppm) || 0

  // Declaraciones OFICIALES ya consultadas al SII (si las hay).
  const anioHasta = Number(periodoFinal.slice(0, 4))
  const anioDesde = anioHasta - 5
  const f29Oficial = leerDeclaraciones(db, empresaId, 'F29', desde, periodoFinal)
  const f22Oficial = leerDeclaraciones(db, empresaId, 'F22', anioDesde, anioHasta)
  const bheOficial = leerDeclaraciones(db, empresaId, 'BHE', anioDesde, anioHasta)

  const mensuales = periodoLista.map((p) => {
    const reg = porPeriodo.get(p) || {}
    const v = reg.ventas
    const c = reg.compras
    const ventasNeto = v ? v.neto : 0
    const ventasIva = v ? v.iva : 0
    const comprasNeto = c ? c.neto : 0
    const comprasIva = c ? c.iva : 0
    const documentos = (v ? v.n : 0) + (c ? c.n : 0)
    const iva = calcularIVA(ventasIva, comprasIva)
    const ppm = calcularPPM(ventasNeto, tasa)
    const totalF29 = calcularTotalF29(iva, ppm)

    let estado = 'sin_datos'
    if (documentos > 0) estado = 'con_datos'
    else if (cacheVacio(db, emp.rut, p, 'ventas') && cacheVacio(db, emp.rut, p, 'compras')) {
      estado = 'sin_movimiento'
    }

    const of = f29Oficial.get(p) || null
    return {
      periodo: p,
      nombre: nombrePeriodo(p),
      ventas_neto: Math.round(ventasNeto),
      ventas_iva: Math.round(ventasIva),
      compras_neto: Math.round(comprasNeto),
      compras_iva: Math.round(comprasIva),
      iva_estimado: Math.round(iva),
      ppm_estimado: Math.round(ppm),
      f29_estimado: Math.round(totalF29),
      documentos,
      estado,
      // El F29 estimado sale del RCV: no es la declaración presentada.
      fuente: 'RCV (estimación propia)',
      // Declaración OFICIAL leída del SII para este período (null si no se ha
      // consultado). `diferencia` = estimado − declarado; solo se calcula
      // cuando el SII informó un monto.
      f29_oficial: of ? {
        estado: of.estado || 'sin_informacion',
        etiqueta: ETIQUETA_ESTADO_DECL[of.estado] || 'Sin información',
        folio: of.folio || null,
        fecha_presentacion: of.fecha_presentacion || null,
        monto_total: of.monto_total == null ? null : Number(of.monto_total),
        consultado_en: of.consultado_en || null,
      } : null,
      f29_estado: of ? (of.estado || 'sin_informacion') : 'no_consultado',
      // La diferencia solo es válida si el RCV de ese período está ingerido:
      // sin RCV la estimación es 0 por falta de datos, no por falta de ventas,
      // y compararla con lo declarado inventaría una discrepancia.
      f29_diferencia: of && of.monto_total != null && estado === 'con_datos'
        ? Math.round(totalF29) - Number(of.monto_total)
        : null,
    }
  })

  const conDatos = mensuales.filter((m) => m.estado === 'con_datos').length
  const sinDatos = mensuales.filter((m) => m.estado === 'sin_datos').length
  const sinMovimiento = mensuales.filter((m) => m.estado === 'sin_movimiento').length
  const anios = ingresosPorAnio(db, empresaId)

  const hallazgos = []

  // ---- Declaraciones oficiales F29 ----
  const f29Declaradas = mensuales.filter((m) => m.f29_estado === 'declarada' || m.f29_estado === 'rectificada')
  const f29Pendientes = mensuales.filter((m) => m.f29_estado === 'pendiente' || m.f29_estado === 'no_presentada')
  const f29Consultados = mensuales.filter((m) => m.f29_estado !== 'no_consultado')

  // No consultar NO es un hallazgo: es una limitación de cobertura (va en
  // `limitaciones`). Marcarlo como observación haría que todo informe sin
  // sincronización con el SII pareciera un problema del contribuyente.
  if (f29Pendientes.length) {
    const lista = f29Pendientes.slice(0, 6).map((m) => m.nombre).join(', ')
    hallazgos.push(hallazgo('F29_PENDIENTE', 'alta', 'F29 pendiente de presentación',
      `El SII registra ${f29Pendientes.length} período(s) sin declaración vigente: ${lista}${f29Pendientes.length > 6 ? '…' : ''}. Regulariza antes de que el SII aplique sanciones o intereses.`,
      'Consulta Integral F29 (SII)'))
  }

  const diferencias = mensuales.filter((m) => m.estado === 'con_datos' && m.f29_diferencia != null && Math.abs(m.f29_diferencia) >= 1000)
  if (diferencias.length) {
    const total = diferencias.reduce((s, m) => s + m.f29_diferencia, 0)
    hallazgos.push(hallazgo('F29_DIFERENCIA', 'media', 'Diferencia entre F29 declarado y estimación del RCV',
      `${diferencias.length} período(s) con diferencia de al menos $1.000 (suma ${Math.round(total).toLocaleString('es-CL')} CLP). La estimación sale del RCV: si la diferencia se repite, revisa documentos faltantes o declaraciones rectificatorias.`,
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
      f29Consultados.length ? 'F29 estimado y F29 declarado disponibles' : 'F29 estimado disponible, estado oficial no consultado',
      f29Consultados.length
        ? `${ivaPorPagar.length} período(s) con IVA estimado a pagar desde el RCV. El monto declarado se lee del SII y se compara en el detalle mensual; la estimación sigue siendo propia.`
        : `${ivaPorPagar.length} período(s) con IVA estimado a pagar. No se consultó la declaración F29 del SII para este rango: el monto mostrado es una estimación desde el RCV.`,
      'services/calculos + RCV' + (f29Consultados.length ? ' + Consulta Integral F29' : '')))
  }

  // ---- Opinión ----
  const altas = hallazgos.filter((h) => h.severidad === 'alta').length
  const medias = hallazgos.filter((h) => h.severidad === 'media').length
  const bajas = hallazgos.filter((h) => h.severidad === 'baja').length
  const score = Math.max(0, Math.min(100, 100 - altas * 25 - medias * 10 - bajas * 3))

  let nivel = 'AL_DIA'
  if (conDatos === 0 && !f.inicioActividades) nivel = 'SIN_INFORMACION'
  else if (altas > 0) nivel = 'REQUIERE_REVISION'
  else if (medias > 0 || bajas > 0) nivel = 'CON_OBSERVACIONES'

  const resumen = (() => {
    if (nivel === 'SIN_INFORMACION') {
      return 'No hay información suficiente para emitir una opinión: falta la ficha del SII y no hay RCV ingerido. Sincroniza la ficha y los libros antes de usar este informe.'
    }
    if (nivel === 'REQUIERE_REVISION') {
      return `La empresa presenta ${altas} hallazgo(s) de atención alta. Antes de declarar o emitir documentos, revisa los puntos marcados en rojo.`
    }
    if (nivel === 'CON_OBSERVACIONES') {
      return `Sin hallazgos críticos, pero hay ${medias + bajas} observación(es) que conviene corregir para dejar la situación tributaria documentada.`
    }
    return 'Los antecedentes disponibles se ven consistentes: ficha SII completa y RCV con cobertura en el período analizado. Esto no reemplaza la revisión de las declaraciones oficiales.'
  })()

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
      f29Consultados.length
        ? `F29 oficial: ${f29Declaradas.length} período(s) declarado(s) y ${f29Pendientes.length} pendiente(s) según el SII (${f29Consultados.length} período(s) consultados).`
        : 'F29 oficial: sin consultar; los montos mensuales son estimaciones desde el RCV.',
      f22Consultado
        ? `Renta: ${f22Anios.filter((d) => d.estado === 'declarada' || d.estado === 'rectificada').length} año(s) con F22 declarado de ${f22Anios.length} consultados.`
        : 'Renta (F22): sin consultar.',
    ],
    recomendaciones: hallazgos
      .filter((h) => h.severidad === 'alta' || h.severidad === 'media')
      .map((h) => h.titulo),
    limitaciones: [
      'Opinión automatizada sobre datos verificables. No es una certificación tributaria ni reemplaza la revisión de un asesor.',
      ...(f29Consultados.length
        ? ['El estado del F29 se lee de la Consulta Integral del SII; los montos de IVA y PPM siguen siendo estimaciones propias desde el RCV.']
        : ['No se consultó el estado oficial del F29: los montos mensuales son estimaciones desde el RCV.']),
      ...(f22Consultado ? [] : ['No se consultó el F22 (renta): la existencia de la declaración anual no está verificada.']),
      ...(bheAnios.length ? [] : ['No se consultaron las boletas de honorarios: su ausencia en el informe no significa que no existan.']),
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
      f29: resumenTipoDeclaraciones(f29Oficial, { desde, hasta: periodoFinal, etiquetaBase: 'Consulta Integral F29' }),
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
            monto_total: f22.monto_total == null ? null : Number(f22.monto_total),
          } : null,
          boletas_honorarios: bhe ? {
            emitidas: bhe.datos?.emitidas || null,
            recibidas: bhe.datos?.recibidas || null,
          } : null,
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
    opinion,
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
  construirInforme,
  resumenInforme,
  olvidarResumen,
  guardarSnapshot,
  ultimoSnapshot,
  periodoValido,
  ultimosPeriodos,
}
