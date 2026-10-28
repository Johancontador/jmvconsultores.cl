/**
 * dj-sii.js — Declaraciones Juradas de Renta presentadas en el SII.
 *
 * Fuente REAL (verificada con la sesión autenticada del contribuyente el
 * 2026-10-22): la aplicación «Mis declaraciones Juradas» del SII
 * (www4.sii.cl/perfilamientodjui) es una fachada JSON, no un portal GWT:
 *
 *   POST https://www4.sii.cl/perfilamientodjui/services/data/facadeService/<metodo>
 *   { metaData: { namespace, conversationId, transactionId, page }, data: {...} }
 *
 * Métodos usados:
 *   · obtenerInfoContribuyente   → actividad económica y tipo de contribuyente.
 *   · obtenerAtributosContribuyente → régimen (14TT/14D1/14A) y segmento.
 *   · obtenerDeclaracionesJuradas → las DJ PRESENTADAS del período: código de
 *     formulario (1947, 1887, 1879…), título, estado («Aceptada»), folio,
 *     fecha de presentación, vencimiento, tipo (Original/Rectificatoria) y
 *     clasificación (régimen / comunes / previsionales).
 *
 * El SII responde por AÑO tributario; por eso se consulta año a año con la
 * misma sesión. Nada se inventa: si un año no responde, se guarda el error y
 * el informe lo declara. Si el SII responde que no hay DJ, el año queda
 * consultado con lista vacía (no es lo mismo que «no consultado»).
 */

const { loginSII, fetchConCookies } = require('../services/sii-session')

const BASE = 'https://www4.sii.cl/perfilamientodjui/services/data/facadeService/'
const NS = 'cl.sii.sdi.lob.renta.perfilamientodj.data.api.interfaces.FacadeService'

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

async function llamar(metodo, data, jar) {
  const res = await fetchConCookies(BASE + metodo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*' },
    body: JSON.stringify(sobre(metodo, data)),
  }, jar)
  const texto = await res.text()
  if (!res.ok) {
    const err = new Error(`El SII rechazó ${metodo} (HTTP ${res.status})`)
    err.codigo = 'SII_DJ_ERROR'
    err.detalle = texto.slice(0, 200)
    throw err
  }
  try {
    return JSON.parse(texto)
  } catch {
    const err = new Error(`Respuesta ilegible del SII en ${metodo}`)
    err.codigo = 'SII_DJ_ERROR'
    throw err
  }
}

/** '2026-03-22T19:59:08' o '2026-03-27 00:00:00.0' → 'YYYY-MM-DD'. */
function normalizarFecha(txt) {
  const t = String(txt || '').trim()
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function normalizarDj(d) {
  const folio = Number(d?.folio) || 0
  return {
    dj: d?.dj != null ? String(d.dj) : null,
    titulo: d?.titulo ? String(d.titulo).trim() : null,
    estado: d?.estado ? String(d.estado).trim() : '',
    presentada: folio > 0 || Boolean(d?.fechaPresentacion),
    // Observación del SII sobre la DJ (el estado es la fuente: «Aceptada»,
    // «Observada»…). Se conserva verbatim.
    folio: folio > 0 ? String(folio) : null,
    fecha_presentacion: normalizarFecha(d?.fechaPresentacion),
    fecha_vencimiento: normalizarFecha(d?.fechaVencimiento),
    tipo_declaracion: d?.tipoDeclaracion ? String(d.tipoDeclaracion).trim() : null,
    clasificacion: d?.tipoClasificacion ? String(d.tipoClasificacion).trim() : null,
    codigo_riac: d?.codigoRiac || null,
  }
}

/**
 * Consulta las DJ de un año tributario.
 * @returns {Promise<object>} { anio, presentadas: [], estado, error? }
 */
async function consultarAnio(jar, { rut, dv, anio }) {
  const base = { rut: String(rut), dv: String(dv), periodo: Number(anio) }
  let atributos = []
  let tipoContribuyente = null
  const erroresPerfil = []

  // El perfil (régimen/segmento) filtra las DJ aplicables. Si no se puede
  // leer, consultar con filtros vacíos devolvería una lista parcial como si
  // fuera completa; se conserva el error del SII para que el job no la acepte.
  try {
    const info = await llamar('obtenerInfoContribuyente', base, jar)
    if (info?.data?.tipoContribuyente == null) throw new Error('El SII no devolvió tipo de contribuyente para las DJ')
    tipoContribuyente = info.data.tipoContribuyente
  } catch (err) { erroresPerfil.push(`perfil contribuyente: ${err.message}`) }
  try {
    const at = await llamar('obtenerAtributosContribuyente', base, jar)
    if (!Array.isArray(at?.data?.atributos)) throw new Error('El SII no devolvió la lista de atributos del contribuyente')
    atributos = at.data.atributos
  } catch (err) { erroresPerfil.push(`atributos: ${err.message}`) }
  if (erroresPerfil.length) throw new Error(`Perfil requerido para consulta DJ incompleto: ${erroresPerfil.join('; ')}`)

  // SOLO los atributos de RÉGIMEN. Verificado contra el SII (2026-10-22): si
  // se manda también el SEGMENTO (SGPM), la consulta responde «No Existen
  // Datos para la Consulta» aunque la DJ exista; con el régimen (14TT/14D1/
  // 14A) responde la lista correcta.
  const atributosRegimen = atributos.filter((a) => String(a?.tipo || '').toUpperCase() === 'REGIMEN')

  const r = await llamar('obtenerDeclaracionesJuradas', {
    ...base,
    atributos: atributosRegimen,
    tipoContribuyente,
  }, jar)

  if (!Array.isArray(r?.data)) throw new Error('El SII no devolvió una lista de declaraciones juradas para el año')
  const filas = r.data
  const todas = filas.map(normalizarDj).filter((d) => d.dj)
  const presentadas = todas.filter((d) => d.presentada)
  // Filas con folio 0 y sin fecha: el SII las lista como DJ aplicables al
  // contribuyente SIN presentación registrada. No es una invención propia:
  // es exactamente lo que la consulta devuelve (comprobado en 2024 y 2025).
  const pendientes = todas.filter((d) => !d.presentada)
  return {
    anio: String(anio),
    estado: presentadas.length ? 'con_declaraciones' : (pendientes.length ? 'sin_presentacion' : 'sin_declaraciones'),
    presentadas,
    pendientes,
    // Todas las filas tal como las entregó el SII (evidencia).
    filas: filas.length,
    consultado_en: new Date().toISOString(),
  }
}

/**
 * Consulta varios años con UNA sola sesión.
 * @param {object} opts { rut, dv, anios:number[]|string[], jar?, cierre? }
 */
async function consultarDj({ rut, dv, anios = [], jar = null, cierre = true }) {
  const [cuerpo, ...resto] = String(rut).split('-')
  const dvRut = resto.join('-') || dv || '0'
  let sesion = jar
  let propia = false
  if (!sesion) {
    sesion = await loginSII(rut, dv)
    propia = true
  }
  const resultado = { anios: [], aviso: null }
  try {
    for (const anio of anios) {
      try {
        resultado.anios.push(await consultarAnio(sesion, { rut: cuerpo, dv: dvRut, anio }))
      } catch (err) {
        resultado.anios.push({
          anio: String(anio), estado: 'error', presentadas: [], error: err.message,
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
  if (conError.length) resultado.aviso = conError.map((a) => `${a.anio}: ${a.error}`).join(' · ')
  return resultado
}

/**
 * Guarda el resultado en `declaraciones_sii` (tipo 'DJ', período = año).
 * `estado` se guarda como 'declarada' cuando el SII registra al menos una DJ
 * presentada y 'sin_informacion' cuando respondió sin declaraciones (no se
 * usa 'no_presentada': un año sin DJ no es una obligación incumplida).
 * @returns {number} años guardados.
 */
function guardar(db, { empresaId, rut, anios }) {
  let guardados = 0
  for (const a of anios || []) {
    if (!a || a.error) continue
    db.prepare(`
      INSERT INTO declaraciones_sii
        (empresa_id, rut, tipo, periodo, estado, folio, fecha_presentacion, monto_total, datos_json, consultado_en)
      VALUES (?, ?, 'DJ', ?, ?, ?, ?, NULL, ?, datetime('now'))
      ON CONFLICT(empresa_id, tipo, periodo) DO UPDATE SET
        estado = excluded.estado,
        folio = excluded.folio,
        fecha_presentacion = excluded.fecha_presentacion,
        datos_json = excluded.datos_json,
        consultado_en = datetime('now')
    `).run(
      empresaId, rut, String(a.anio),
      a.presentadas.length ? 'declarada' : 'sin_informacion',
      a.presentadas[0]?.folio || null,
      a.presentadas[0]?.fecha_presentacion || null,
      JSON.stringify({
        presentadas: a.presentadas,
        pendientes: a.pendientes || [],
        estado_sii: a.estado,
        origen: 'SII Mis Declaraciones Juradas (perfilamientodjui)',
      }),
    )
    guardados++
  }
  return guardados
}

module.exports = {
  consultarAnio,
  consultarDj,
  guardar,
  normalizarDj,
  normalizarFecha,
}
