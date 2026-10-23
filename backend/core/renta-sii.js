/**
 * renta-sii.js — Estado de la declaración ANUAL de renta (F22) en el SII.
 *
 * Por años el SII publicación la «Consulta de Estado de Renta»
 * (www4.sii.cl/consultaestadof22ui). Es una fachada JSON (no GWT): con la
 * misma sesión del login tributario alcanza con POST a
 * `services/data/facadeService/<metodo>` con el sobre `metaData/data`.
 * Esto permits leer, sin navegador y sin intervención manual:
 *
 *   · buscaDeclVgte      → las declaraciones del período: folio, código de
 *                          concordancia, situación (vigente o no), fecha de
 *                         {tramitación}, remanente solicitado/devuelto, giro.
 *   · buscaEventos       → el HISTORIAL de eventos ("Declaración recibida a
 *                          través de Internet, solicita Devolución por $X",
 *                          "Declaración autorizada…"), con fecha y detalle.
 *   · situacionObservacion → observaciones (vacío en la mayoría de los casos).
 *
 * Cada respuesta trae `glosas`: el texto EXACTAMENTE como el SII lo escribe
 * para el código de concordancia de esa declaración (por ejemplo, la
 * autorización de una devolución total con el monto reajustado). Es la
 * evidencia más rica que entrega el SII y se conserva verbatim.
 *
 * REGLA DE ORO (igual que el resto del proyecto): nada se inventa. Si el SII
 * no responde, el informe declara «no consultado»; si responde, se guarda
 * tal cual, con su folio y su fecha.
 */

const { loginSII, fetchConCookies } = require('../services/sii-session')

const BASE = 'https://www4.sii.cl/consultaestadof22ui/services/data/facadeService/'
const NS = 'cl.sii.sdi.lob.renta.consultaestadof22.data.api.interfaces.FacadeService'

/**
 * Códigos de concordancia (codConc) y situations (evigCodigo) del SII.
 * No son inventados: salen de las respuestas reales de la consulta.
 *   1100004 → declaración vigente y válida (evigCodigo OPG)
 *   1100020 → declaración con autorización de giro/devolución (evigCodigo ODT)
 *   1100104 → no vigente: la presentación quedó solo para guardar (NST)
 */
const ETIQUETA_CONCORDANCIA = {
  1100004: 'Declaración vigente y válida',
  1100020: 'Declaración con resolución de giro/devolución',
  1100104: 'Presentación no vigente (solo para guardar)',
}

const ETIQUETA_SITUACION = {
  OPG: 'Declaración vigente',
  ODT: 'Operación de devolución/giro autorizada',
  NST: 'No vigente',
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

function sobre(metodo, data) {
  return {
    metaData: {
      namespace: `${NS}/${metodo}`,
      conversationId: 'JMVCONSULTORIAS',
      transactionId: `jmv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      page: null,
    },
    data,
  }
}

/** Convierte '24/04/2024' o '2024-04-24' a ISO 'YYYY-MM-DD'. */
function normalizarFecha(txt) {
  const t = String(txt || '').trim()
  if (!t) return null
  let m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[1]}-${m[2]}`
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

/**
 * POST a la fachada de la consulta de renta.
 * @returns {Promise<object>} la respuesta parseada (o { data: [] } si no hay).
 */
async function llamar(metodo, data, jar) {
  const res = await fetchConCookies(BASE + metodo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sobre(metodo, data)),
  }, jar)
  const texto = await res.text()
  if (!res.ok) {
    const err = new Error(`El SII rechazó ${metodo} (HTTP ${res.status})`)
    err.codigo = 'SII_RENTA_ERROR'
    err.detalle = texto.slice(0, 200)
    throw err
  }
  try {
    return JSON.parse(texto)
  } catch {
    const err = new Error(`Respuesta ilegible del SII en ${metodo}`)
    err.codigo = 'SII_RENTA_ERROR'
    throw err
  }
}

/**
 * Consulta el estado de la declaración de renta de un período (año).
 * @returns {Promise<object>} declaración normalizada.
 */
async function consultarAnio(jar, { rut, dv, anio }) {
  const decls = await llamar('buscaDeclVgte', { periodo: Number(anio), rut: String(rut), dv: String(dv) }, jar)
  const data = decls?.data || {}
  const lista = Array.isArray(data.decls) ? data.decls : []
  const glosas = Array.isArray(data.glosas) ? data.glosas : []

  // La declaración vigente es la que el SII marca con vgte=1; si no hay
  // ninguna, se toman todas las que existen para ese período (rectificaciones).
  const vigentes = lista.filter((d) => String(d.vgte) === '1')
  const principal = vigentes[0] || lista[0] || null

  const eventos = []
  if (principal && principal.folio) {
    try {
      const ev = await llamar('buscaEventos', {
        periodo: Number(anio), rut: String(rut), dv: String(dv), folio: String(principal.folio),
      }, jar)
      for (const e of (Array.isArray(ev?.data) ? ev.data : [])) {
        eventos.push({
          fecha: normalizarFecha(e.fechaEvento),
          codigo: e.codEvento || null,
          nombre: e.nombre || null,
          referencia: e.referencia || null,
          codigo_carta: e.codCarta || null,
        })
      }
    } catch {
      // Sin historial no se inventa: se deja la lista vacía.
    }
  }

  let observaciones = []
  try {
    const ob = await llamar('situacionObservacion', {
      periodo: Number(anio), rut: String(rut), dv: String(dv), folio: String(principal?.folio || ''),
    }, jar)
    observaciones = Array.isArray(ob?.data) ? ob.data : []
  } catch {
    observaciones = []
  }

  const codConc = principal?.codConc != null ? String(principal.codConc) : null
  const glosa = glosas.find((g) => String(g.codConclusion) === codConc)?.descripcion || null

  return {
    anio: String(anio),
    folio: principal?.folio != null ? String(principal.folio) : null,
    cod_concordancia: codConc,
    concordancia: codConc ? (ETIQUETA_CONCORDANCIA[codConc] || `Código ${codConc}`) : null,
    situacion: principal?.evigCodigo || null,
    situacion_etiqueta: principal?.evigCodigo ? (ETIQUETA_SITUACION[principal.evigCodigo] || principal.evigCodigo) : null,
    vigente: vigentes.length > 0,
    declaradas: lista.length,
    fecha_tramitacion: normalizarFecha(principal?.tramFecha),
    fecha_vencimiento: normalizarFecha(principal?.fechaVencimiento),
    remanente_solicitado: principal?.remanenteSolicitado != null ? Number(principal.remanenteSolicitado) : null,
    remanente_devuelto: principal?.remanenteDevuelto != null ? Number(principal.remanenteDevuelto) : null,
    monto_giro: principal?.montoGiro != null ? Number(principal.montoGiro) : null,
    glosa,
    eventos,
    observaciones,
    // Se conservan TODAS las declaraciones del período (rectificaciones
    // incluidas) como evidencia, tal como las devolvió el SII.
    declaraciones: lista.map((d) => ({
      folio: d.folio != null ? String(d.folio) : null,
      cod_concordancia: d.codConc != null ? String(d.codConc) : null,
      situacion: d.evigCodigo || null,
      vigente: String(d.vgte) === '1',
      fecha_tramitacion: normalizarFecha(d.tramFecha),
      remanente_solicitado: d.remanenteSolicitado != null ? Number(d.remanenteSolicitado) : null,
      remanente_devuelto: d.remanenteDevuelto != null ? Number(d.remanenteDevuelto) : null,
      monto_giro: d.montoGiro != null ? Number(d.montoGiro) : null,
    })),
    glosas,
    consultado_en: new Date().toISOString(),
  }
}

/**
 * Consulta la renta de varios años con UNA sola sesión.
 * @param {object} opts { rut, dv, anios:number[], jar?, clave?, cierre? }
 *   `jar`: sesión ya autenticada (recomendado: reusa la del portal).
 *   `clave`: clave tributaria para abrir sesión propia. Sin jar NI clave se
 *   rechaza en vez de mandar el dígito verificador como clave (era el bug que
 *   dejaba la Renta «no consultada» en la reunión de antecedentes).
 */
async function consultarRenta({ rut, dv, anios, jar = null, clave = null, cierre = true }) {
  const [cuerpo, ...resto] = String(rut).split('-')
  const dvRut = resto.join('-') || dv || '0'
  let sesion = jar
  let propia = false
  if (!sesion) {
    if (!clave) throw new Error('Falta la clave SII para consultar la renta (o una sesión ya abierta)')
    sesion = await loginSII(rut, clave)
    propia = true
  }
  const resultado = { anios: [], aviso: null }
  try {
    for (const anio of anios) {
      try {
        resultado.anios.push(await consultarAnio(sesion, { rut: cuerpo, dv: dvRut, anio }))
      } catch (err) {
        resultado.anios.push({
          anio: String(anio), error: err.message, folio: null, vigente: false,
          eventos: [], observaciones: [], declaraciones: [], glosas: [],
        })
      }
    }
  } finally {
    if (propia && cierre) {
      try {
        await fetchConCookies('https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi', { method: 'GET' }, sesion)
      } catch { /* el cierre nunca debe romper la operación */ }
    }
  }
  const conError = resultado.anios.filter((a) => a.error)
  if (conError.length) {
    resultado.aviso = conError.map((a) => `${a.anio}: ${a.error}`).join(' · ')
  }
  return resultado
}

/**
 * Guarda el resultado en `declaraciones_sii` (tipo 'F22'), reusando la tabla
 * que ya existe: una fila por empresa, tipo y período (el período es el año).
 * @returns {number} cantidad de años guardados.
 */
function guardar(db, { empresaId, rut, anios }) {
  let guardados = 0
  for (const a of anios || []) {
    if (!a || a.error) continue
    const estado = a.vigente ? 'declarada' : (a.declaradas ? 'no_presentada' : 'sin_informacion')
    db.prepare(`
      INSERT INTO declaraciones_sii
        (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json, consultado_en)
      VALUES (?, ?, 'F22', ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(empresa_id, tipo, periodo) DO UPDATE SET
        estado = excluded.estado,
        folio = excluded.folio,
        fecha_presentacion = excluded.fecha_presentacion,
        monto_total = excluded.monto_total,
        datos_json = excluded.datos_json,
        consultado_en = datetime('now')
    `).run(
      empresaId, rut, String(a.anio), estado,
      a.folio || null,
      a.fecha_tramitacion || null,
      a.remanente_devuelto ?? a.monto_giro ?? null,
      JSON.stringify({
        cod_concordancia: a.cod_concordancia,
        concordancia: a.concordancia,
        situacion: a.situacion,
        situacion_etiqueta: a.situacion_etiqueta,
        fecha_vencimiento: a.fecha_vencimiento,
        remanente_solicitado: a.remanente_solicitado,
        remanente_devuelto: a.remanente_devuelto,
        monto_giro: a.monto_giro,
        glosa: a.glosa,
        eventos: a.eventos,
        observaciones: a.observaciones,
        declaraciones: a.declaraciones,
        origen: 'SII Consulta de Estado de Renta (consultaestadof22ui)',
      }),
    )
    guardados++
  }
  return guardados
}

module.exports = {
  consultarAnio,
  consultarRenta,
  guardar,
  // helpers puros (tests)
  normalizarFecha,
  ETIQUETA_CONCORDANCIA,
  ETIQUETA_SITUACION,
}
