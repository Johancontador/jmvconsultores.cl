/**
 * empresas-sii.js — Alta de empresa con solo RUT + clave SII.
 *
 * Flujo (todo con módulos oficiales y auditoría):
 *  1. Login en el SII con la clave tributaria (sii-session.js).
 *  2. GET https://misiir.sii.cl/cgi_misii/siihome.cgi → el HTML trae embebido
 *     el JSON `DatosCntrNow = {...}` con la ficha oficial del contribuyente:
 *     razón social, tipo, constitución, inicio de actividades, email, teléfono,
 *     unidad operativa, capital, segmento, glosa de actividad, direcciones y
 *     atributos (régimen, boleta electrónica, etc.).
 *  3. empresas.crear() siembra la empresa (clave cifrada en bóveda, plan PUC,
 *     licencia heredada, auditoría).
 *  4. onboarding.confirmarFicha() con lo que el SII entrega; lo que el SII no
 *     entrega (socios) queda pendiente para el humano — jamás se inventa.
 *
 * La ficha SII cruda se persiste en data/sii-fichas/<rut>.json (fuera del repo).
 */
const fs = require('fs')
const path = require('path')
const { obtenerSesion, loginSII, fetchConCookies, parseRut } = require('../services/sii-session')
const empresas = require('./empresas')
const onboarding = require('./onboarding')

const SII_HOME = process.env.SII_HOME_URL || 'https://misiir.sii.cl/cgi_misii/siihome.cgi'

/** Extrae el objeto JSON embebido tras `marcador` con llaves balanceadas. */
function extraerJsonEmbebido(html, marcador) {
  const ini = html.indexOf(marcador)
  if (ini < 0) return null
  const desde = html.indexOf('{', ini)
  if (desde < 0) return null
  let prof = 0
  let fin = -1
  let enCadena = false
  let esc = false
  for (let i = desde; i < html.length && i - desde < 100000; i++) {
    const c = html[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { enCadena = !enCadena; continue }
    if (enCadena) continue
    if (c === '{') prof++
    else if (c === '}') {
      prof--
      if (prof === 0) { fin = i + 1; break }
    }
  }
  if (fin < 0) return null
  try { return JSON.parse(html.slice(desde, fin)) } catch { return null }
}

/** Convierte la ficha SII en los datos que piden empresas.crear y confirmarFicha. */
function fichaSiiARegistro(ficha) {
  const c = ficha?.contribuyente || {}
  // Empresa: razonSocial. Persona natural: nombres + apellidos (lo registrado en el SII).
  const nombre = String(
    c.razonSocial || [c.nombres, c.apellidoPaterno, c.apellidoMaterno].filter(Boolean).join(' ') || ''
  ).trim()
  if (!c.rut || !nombre) {
    throw new Error('La ficha SII no trae RUT ni nombre/razón social — no se puede registrar la empresa')
  }
  // Régimen desde atributos: 14TT = Pro Pyme Transparente; 14GG = Pro Pyme General.
  // El valor debe calzar EXACTO con las opciones del formulario de onboarding.
  const atributos = Array.isArray(ficha.atributos) ? ficha.atributos : []
  const tiene14TT = atributos.some((a) => a.atrCodigo === '14TT')
  const tiene14GG = atributos.some((a) => a.atrCodigo === '14GG')
  const regimen = tiene14TT
    ? 'Pro Pyme Transparente (14 D)'
    : (tiene14GG ? 'Pro Pyme General (14 D)' : null)

  return {
    rut: `${c.rut}-${c.dv}`,
    nombre,
    inicioActividades: String(c.fechaInicioActividades || '').slice(0, 10) || null,
    regimen,
    actividades: c.glosaActividad ? [String(c.glosaActividad)] : [],
    telefono: String(c.telefonoMovil || '').trim(),
    email: String(c.eMail || '').trim(),
    tipoContribuyente: c.tipoContribuyenteDescripcion || null,
    fechaConstitucion: String(c.fechaConstitucion || '').slice(0, 10) || null,
    fichaCruda: ficha,
  }
}

/**
 * Alta completa de empresa con solo RUT + clave SII.
 * usuarioId: super admin que ejecuta (para empresas.crear y la auditoría).
 */
async function crearDesdeSii(db, { usuarioId, rut, clave, tasaPpm = 0.01, ip = null }) {
  if (!rut || !clave) throw new Error('RUT y clave SII son obligatorios')
  const tasa = Number(tasaPpm === undefined || tasaPpm === null ? 0.01 : tasaPpm)
  if (!Number.isFinite(tasa) || tasa < 0 || tasa > 1) {
    throw new Error('Tasa PPM inválida (0..1, ej: 0.01)')
  }

  // 1) Login SII (lanza 'Clave SII incorrecta' si la credencial es mala) + ficha
  // Obtener sesión: la vía normal pide token RCV; si el SII no habilita el RCV
  // para esta cuenta (sin TOKEN ni conversationId), caemos al login básico,
  // suficiente para leer la ficha del contribuyente.
  let jar
  try {
    const ses = await obtenerSesion(rut, clave)
    jar = ses.jar
  } catch (e) {
    if (!/token de sesión RCV|no habilita el RCV/i.test(e.message)) throw e
    console.log(`[SII] ${rut}: sin token RCV → fallback a login básico para ficha`)
    jar = await loginSII(rut, clave)
  }
  const res = await fetchConCookies(SII_HOME, { method: 'GET' }, jar)
  const html = await res.text()
  const ficha = extraerJsonEmbebido(html, 'DatosCntrNow = ')
  if (!ficha?.contribuyente?.rut) {
    // El SII, ante clave rechazada que el login no detecta (variante "no es
    // correcta" vs "clave incorrecta"), responde el home con una redirección
    // JS de vuelta al formulario de autenticación.
    if (/location\.replace\([^)]*IngresoRutClave/i.test(html) || /Clave Tributaria ingresada no es correcta/i.test(html)) {
      throw new Error('Clave SII incorrecta para este RUT')
    }
    throw new Error('No se pudo obtener la ficha del contribuyente desde el SII (login válido pero el home no entregó datos)')
  }

  const datos = fichaSiiARegistro(ficha)

  // El SII debe confirmar que la clave consultada corresponde a este RUT
  // (evita registrar un RUT distinto al de la credencial entregada).
  const { completo } = parseRut(rut)
  if (datos.rut !== completo) {
    throw new Error(`La ficha SII corresponde al RUT ${datos.rut}, no a ${completo}`)
  }

  // 2) Crear empresa (clave cifrada, plan PUC, licencia heredada, auditoría)
  const empresa = empresas.crear(db, {
    usuarioId,
    rut: datos.rut,
    nombre: datos.nombre,
    claveSii: clave,
    tasaPpm: tasa,
    telefono: datos.telefono,
  })
  const empresaId = typeof empresa === 'object' ? empresa.id : empresa

  // 3) Ficha de onboarding con lo que el SII entrega; socios quedan pendientes
  onboarding.confirmarFicha(db, {
    empresaId,
    usuarioId,
    razonSocialSii: datos.nombre,
    inicioActividades: datos.inicioActividades,
    actividades: datos.actividades,
    regimenTributario: datos.regimen,
    ip,
  })

  // 4) Ficha SII cruda a data/sii-fichas/ (fuera del repo, junto a la BD)
  try {
    const dir = path.join(process.cwd(), 'data', 'sii-fichas')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${datos.rut}.json`), JSON.stringify(ficha, null, 2))
  } catch (e) {
    console.warn(`[SII-ALTA] No se pudo guardar la ficha cruda de ${datos.rut}: ${e.message}`)
  }

  return {
    empresaId,
    rut: datos.rut,
    nombre: datos.nombre,
    inicio_actividades: datos.inicioActividades,
    regimen: datos.regimen,
    email: datos.email,
    tipo_contribuyente: datos.tipoContribuyente,
    fecha_constitucion: datos.fechaConstitucion,
    actividades: datos.actividades,
  }
}

module.exports = { crearDesdeSii, fichaSiiARegistro, extraerJsonEmbebido }
