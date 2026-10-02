/**
 * Onboarding autónomo (SAAS-ACCESO §4 — SAAS-2).
 *
 * El registro self-service (SAAS-1) dejó la empresa creada con licencia PRUEBA.
 * SAAS-2 completa la ficha tributaria SIN que JMV toque nada:
 *
 *  1. Ficha desde el SII: la MISMA sesión que valida el RCV es la prueba de
 *     que el dueño controla la empresa ante el SII. Fuente de cada dato:
 *     - razón social    → el login exitoso del portal (sesión RCV válida).
 *     - inicio actividades → 'Fecha Docto' más antigua de SU RCV de ventas
 *       (la primera factura que emitió: evidencia de la propia integración,
 *       confirmación humana antes de persistir — nunca scraping).
 *     - actividades económicas / régimen / socios → el SII no los entrega por
 *       una vía ya existente → quedan 'pendiente' (formularios, §43).
 *  2. Checklist ✓/⚠ (§43): cada dato marcado automático | pendiente | confirmado.
 *  3. Ingesta del histórico: N períodos hacia atrás usando el pipeline de
 *     FASE 3 (rcv.consultarRCV → documentos.ingestarBatch, dedupe idempotente:
 *     re-lanzar no duplica nada). Trabajo en background con progreso — el
 *     mismo patrón de core/ingesta.js.
 *
 * Regla dura: se CONSULTA al SII (fetch JSON de los facades ya existentes),
 * jamás se parsea HTML (§42). Todo queda auditado.
 */

const rcv = require('../services/rcv')
const { claveSiiDescifrada } = require('./empresas')
const documentosCore = require('./documentos')
const { registrarAccion } = require('./auditoria')

const CLAVES_CHECKLIST = [
  'razon_social_sii',
  'inicio_actividades',
  'actividades_economicas',
  'regimen_tributario',
  'socios_representante',
  'documentos_historicos',
]

/** Lista las claves del checklist §43 en orden estable. */
function clavesChecklist() {
  return [...CLAVES_CHECKLIST]
}

function leerEmpresa(db, empresaId) {
  const emp = db.prepare(`SELECT id, rut, nombre, razon_social_sii, inicio_actividades, actividades_json, regimen_tributario, socios_json, onboarding_json FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  return emp
}

function parseJsonSeguro(texto) {
  if (!texto) return null
  try { return JSON.parse(texto) } catch { return null }
}

/** onboarding_json garantizado (objeto con estado y checklist). */
function estadoOnboarding(emp) {
  const ob = parseJsonSeguro(emp.onboarding_json) || {}
  return {
    estado: ob.estado || 'pendiente',
    verificacion: ob.verificacion || null,
    checklist: { ...Object.fromEntries(CLAVES_CHECKLIST.map((k) => [k, 'pendiente'])), ...(ob.checklist || {}) },
  }
}

function guardarOnboarding(db, empresaId, siguiente) {
  db.prepare(`UPDATE empresas SET onboarding_json = ? WHERE id = ?`).run(JSON.stringify(siguiente), empresaId)
}

/** Ficha tributaria para la UI: columnas + checklist + qué sigue pendiente humano. */
function ficha(db, empresaId) {
  const emp = leerEmpresa(db, empresaId)
  const ob = estadoOnboarding(emp)
  const pendientes = CLAVES_CHECKLIST.filter((k) => ob.checklist[k] === 'pendiente')
  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    ficha: {
      razon_social_sii: emp.razon_social_sii,
      inicio_actividades: emp.inicio_actividades,
      actividades: parseJsonSeguro(emp.actividades_json) || [],
      regimen_tributario: emp.regimen_tributario,
      socios: parseJsonSeguro(emp.socios_json) || [],
    },
    checklist: ob.checklist,
    estado: ob.estado,
    pendientes_humano: pendientes,
    completo: pendientes.length === 0,
  }
}

/**
 * Consulta la ficha tributaria que el SII entrega por vías YA existentes
 * (la sesión del RCV). Solo propone: nada persiste sin confirmación humana
 * (§43). Devuelve propuestas + motivos de lo que no se puede automátizar.
 */
async function consultarSii(db, empresaId) {
  const emp = leerEmpresa(db, empresaId)
  const clave = claveSiiDescifrada(db, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada')

  // 1) Login exitoso del portal = prueba de control de la empresa (SAAS-ACCESO §4).
  //    consultarRCV lanza si la credencial no sirve.
  const periodoActual = (() => {
    const d = new Date()
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  })()
  const ventas = await rcv.consultarRCV(emp.rut, clave, 'ventas', periodoActual)
  const compras = await rcv.consultarRCV(emp.rut, clave, 'compras', periodoActual)

  // ISSUE-001: el mes actual solo muestra lo nuevo del mes — en una empresa que
  // opera hace años, el primer documento del mes NO es su inicio de actividades.
  // El primer período ingestado de la empresa (histórico SAAS-2) es la ventana
  // más antigua disponible: se consulta también y se propone lo más antiguo.
  const primerPeriodo = db
    .prepare(`SELECT MIN(periodo_ingesta) AS p FROM documentos WHERE empresa_id = ?`)
    .get(empresaId)?.p || null
  let ventasHistoricas = []
  let comprasHistoricas = []
  if (primerPeriodo && String(primerPeriodo) < periodoActual) {
    try {
      ventasHistoricas = await rcv.consultarRCV(emp.rut, clave, 'ventas', String(primerPeriodo))
      comprasHistoricas = await rcv.consultarRCV(emp.rut, clave, 'compras', String(primerPeriodo))
    } catch { /* sin histórico accesible: se propone con lo del mes actual */ }
  }

  const todasLasVentas = [...ventas, ...ventasHistoricas]
  const fechas = [...todasLasVentas, ...compras, ...comprasHistoricas]
    .map((d) => documentosCore.normalizarFechaSII(d.fechaDocto))
    .filter(Boolean)
    .sort()
  const primeraVenta = todasLasVentas
    .map((d) => documentosCore.normalizarFechaSII(d.fechaDocto))
    .filter(Boolean)
    .sort()[0] || null

  return {
    razon_social_sii: emp.razon_social_sii || emp.nombre, // identidad propia: el login válido ES la prueba
    // El inicio de actividades se evidencia con la primera venta emitida
    // (si solo hay compras, se propone el documento más antiguo igual).
    inicio_actividades_propuesto: primeraVenta || fechas[0] || null,
    primera_venta: primeraVenta,
    documentos_analizados: {
      ventas: todasLasVentas.length,
      compras: compras.length + comprasHistoricas.length,
      periodo: periodoActual,
      periodo_historico: (primerPeriodo && String(primerPeriodo) < periodoActual) ? String(primerPeriodo) : null,
    },
    fuente: 'sii_rcv',
    avisos: [
      fechas.length
        ? null
        : 'El RCV consultado no tiene documentos: no se puede proponer inicio de actividades (ingresa documentos o confirma la fecha a mano).',
      // ISSUE-001: dejar explícito que la fecha propuesta es un piso, no el dato legal.
      'La fecha propuesta es el primer documento visible en el RCV: revísala contra tu resolución de inicio de actividades antes de confirmar (no la sustituye).',
      'Actividades económicas, régimen tributario y socios: el SII no los entrega por una vía ya existente — se piden en el formulario (sin scraping).',
    ].filter(Boolean),
  }
}

/**
 * Confirma la ficha: SOLO datos marcados por el humano. Persiste razón social,
 * inicio de actividades y campos del formulario (actividades/régimen/socios),
 * actualiza el checklist ✓ y deja auditado antes→después.
 */
function confirmarFicha(db, { empresaId, usuarioId, razonSocialSii = null, inicioActividades = null, actividades = null, regimenTributario = null, socios = null, ip = null }) {
  const emp = leerEmpresa(db, empresaId)
  const ob = estadoOnboarding(emp)

  const limpiar = (v) => (v === undefined || v === null ? null : String(v).trim() || null)
  const razonSocial = limpiar(razonSocialSii)
  const inicio = limpiar(inicioActividades)
  const esFechaISO = (s) => !s || /^\d{4}-\d{2}-\d{2}$/.test(s)
  if (!esFechaISO(inicio)) throw new Error('inicio_actividades debe ser fecha ISO (YYYY-MM-DD)')

  const antes = {
    razon_social_sii: emp.razon_social_sii,
    inicio_actividades: emp.inicio_actividades,
    regimen_tributario: emp.regimen_tributario,
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE empresas SET
        razon_social_sii = COALESCE(?, razon_social_sii),
        inicio_actividades = COALESCE(?, inicio_actividades),
        actividades_json = COALESCE(?, actividades_json),
        regimen_tributario = COALESCE(?, regimen_tributario),
        socios_json = COALESCE(?, socios_json)
      WHERE id = ?
    `).run(
      razonSocial,
      inicio,
      actividades !== undefined && actividades !== null ? JSON.stringify(actividades) : null,
      limpiar(regimenTributario),
      socios !== undefined && socios !== null ? JSON.stringify(socios) : null,
      empresaId,
    )

    const checklist = { ...ob.checklist }
    if (razonSocial) checklist.razon_social_sii = 'confirmado'
    if (inicio) checklist.inicio_actividades = 'confirmado'
    if (actividades && Array.isArray(actividades) && actividades.length) checklist.actividades_economicas = 'confirmado'
    if (limpiar(regimenTributario)) checklist.regimen_tributario = 'confirmado'
    if (socios && Array.isArray(socios)) checklist.socios_representante = 'confirmado'

    guardarOnboarding(db, empresaId, { ...ob, checklist })
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'onboarding.ficha_confirmada', entidad: 'empresas', entidadId: String(empresaId),
      antes, despues: { checklist, razon_social_sii: razonSocial, inicio_actividades: inicio },
      ip,
    })
  })
  tx()

  return ficha(db, empresaId)
}

/**
 * Purga del checklist (uso interno de las demás funciones: marca un dato).
 */
function marcarChecklist(db, { empresaId, usuarioId, clave, valor, ip = null }) {
  if (!CLAVES_CHECKLIST.includes(clave)) throw new Error(`Clave de checklist inválida: ${clave}`)
  if (!['pendiente', 'confirmado', 'parcial'].includes(valor)) throw new Error(`Valor de checklist inválido: ${valor}`)
  const emp = leerEmpresa(db, empresaId)
  const ob = estadoOnboarding(emp)
  const tx = db.transaction(() => {
    guardarOnboarding(db, empresaId, { ...ob, checklist: { ...ob.checklist, [clave]: valor } })
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'onboarding.checklist', entidad: 'empresas', entidadId: String(empresaId),
      despues: { [clave]: valor }, ip,
    })
  })
  tx()
  return ficha(db, empresaId)
}

// ---------------- Ingesta del histórico (background) ----------------

const trabajos = new Map() // jobId → estado interno

function generarJobId() {
  return `onb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Estado seguro para exponer por API (sin claves ni objetos internos). */
function estadoIngestaHistorica(jobId, usuarioId) {
  const t = trabajos.get(jobId)
  if (!t || t.usuarioId !== usuarioId) return null
  return {
    jobId,
    empresa_id: t.empresaId,
    desde: t.desde,
    hasta: t.hasta,
    estado: t.estado,
    total: t.total,
    procesados: t.procesados,
    periodo_actual: t.periodoActual || null,
    resultado: t.resultado,
    error: t.error,
  }
}

function periodoSiguiente(p) {
  let y = Number(p.slice(0, 4)), m = Number(p.slice(4))
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}${String(m).padStart(2, '0')}`
}

/**
 * Lanza la ingesta del histórico [desde..hasta] (AAAAMM, inclusivo) en
 * background. Reusa el pipeline FASE 3: re-lanzarlo es seguro (dedupe).
 */
function ingestarHistorico(dbParam, { empresaId, usuarioId, desde, hasta, ip = null }) {
  const empresa = dbParam.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  if (!/^\d{6}$/.test(String(desde)) || !/^\d{6}$/.test(String(hasta))) {
    throw new Error('Períodos inválidos: se espera AAAAMM')
  }
  if (String(desde) > String(hasta)) throw new Error('El período inicial no puede ser posterior al final')
  const clave = claveSiiDescifrada(dbParam, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada')

  const periodos = []
  let p = String(desde)
  while (p <= String(hasta) && periodos.length < 24) {
    periodos.push(p)
    p = periodoSiguiente(p)
  }

  const jobId = generarJobId()
  trabajos.set(jobId, {
    jobId, empresaId, usuarioId, desde: String(desde), hasta: String(hasta), ip,
    periodos, total: periodos.length, procesados: 0, periodoActual: null,
    estado: 'procesando', resultado: [], error: null,
    empresa: { id: empresa.id, rut: empresa.rut, nombre: empresa.nombre },
  })

  // La promesa queda en el job: permite esperar la corrida en tests y evita
  // unhandledRejection si nadie la consulta.
  const promesa = ejecutarHistorico(jobId).catch((err) => {
    const t = trabajos.get(jobId)
    if (t) {
      t.estado = 'error'
      t.error = err.message
      registrarAccion(dbParam, {
        empresaId, usuarioId,
        accion: 'onboarding.historico_error', entidad: 'documentos', entidadId: `${desde}-${hasta}`,
        despues: { error: err.message }, ip,
      })
    }
  })
  trabajos.get(jobId).promise = promesa

  return { jobId, empresa: { id: empresa.id, nombre: empresa.nombre }, periodos }
}

async function ejecutarHistorico(jobId) {
  const t = trabajos.get(jobId)
  if (!t) return
  const { empresaId, usuarioId, ip } = t
  const dbInstancia = require('../db')

  let clave
  try {
    clave = claveSiiDescifrada(dbInstancia, empresaId)
  } catch (err) {
    t.estado = 'error'
    t.error = `No se pudo descifrar la clave SII: ${err.message}`
    return
  }
  const rut = dbInstancia.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)?.rut
  if (!rut) {
    t.estado = 'error'
    t.error = 'Empresa no encontrada'
    return
  }

  const resultado = []
  for (const periodo of t.periodos) {
    t.periodoActual = periodo
    t.estado = `ingestando_${periodo}`
    const detalle = { periodo, compra: null, venta: null }
    for (const [tipo, flujo] of [['compras', 'compra'], ['ventas', 'venta']]) {
      try {
        const docs = await rcv.consultarRCV(rut, clave, tipo, periodo)
        detalle[flujo] = documentosCore.ingestarBatch(dbInstancia, {
          empresaId, usuarioId, tipoFlujo: flujo, periodo, documentos: docs, ip,
        })
      } catch (err) {
        // Un tipo/período que falla no aborta el resto: queda visible en el resumen.
        detalle[flujo] = { error: err.message }
      }
    }
    resultado.push(detalle)
    t.procesados += 1
  }

  const insertados = resultado.reduce((s, r) =>
    s + (r.compra?.insertados || 0) + (r.venta?.insertados || 0), 0)
  const duplicados = resultado.reduce((s, r) =>
    s + (r.compra?.duplicados || 0) + (r.venta?.duplicados || 0), 0)
  const errores = resultado.reduce((s, r) =>
    s + (r.compra?.errores?.length || 0) + (r.venta?.errores?.length || 0)
      + (r.compra?.error ? 1 : 0) + (r.venta?.error ? 1 : 0), 0)

  t.resultado = { periodos: resultado, insertados_total: insertados, duplicados_total: duplicados, errores_totales: errores }
  t.estado = errores > 0 ? 'completado_con_errores' : 'completado'

  registrarAccion(dbInstancia, {
    empresaId, usuarioId,
    accion: 'onboarding.historico_completado', entidad: 'documentos', entidadId: `${t.desde}-${t.hasta}`,
    despues: { estado: t.estado, insertados: insertados, duplicados, errores, periodos: t.periodos.length },
    ip,
  })

  // Un run posterior con errores no degrada un histórico ya confirmado: solo
  // marca 'parcial' si aún no estaba completo.
  const previo = estadoOnboarding(leerEmpresa(dbInstancia, empresaId)).checklist.documentos_historicos
  const valorChecklist = errores > 0
    ? (previo === 'confirmado' ? 'confirmado' : 'parcial')
    : 'confirmado'
  marcarChecklist(dbInstancia, {
    empresaId, usuarioId,
    clave: 'documentos_historicos',
    valor: valorChecklist,
    ip,
  })
}

/** Lista trabajos del usuario (para re-attach de la UI). */
function listarIngestasDeUsuario(usuarioId) {
  const lista = []
  for (const t of trabajos.values()) {
    if (t.usuarioId === usuarioId) lista.push(estadoIngestaHistorica(t.jobId, usuarioId))
  }
  return lista.sort((a, b) => (a.jobId < b.jobId ? 1 : -1))
}

module.exports = {
  clavesChecklist, ficha, consultarSii, confirmarFicha, marcarChecklist,
  ingestarHistorico, estadoIngestaHistorica, listarIngestasDeUsuario, trabajos,
}
