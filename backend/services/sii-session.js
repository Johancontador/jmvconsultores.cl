const crypto = require('crypto')

const SII_AUTH_URL =
  process.env.SII_AUTH_URL || 'https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi'
const SII_RCV_UI = process.env.SII_RCV_UI || 'https://www4.sii.cl/consdcvinternetui'

// Headers exactos que usa el frontend Angular real del SII para llamar al
// facadeService. Confirmado con captura HAR: el Accept "application/json" a
// secas hace que RESTEasy responda 500 "No match for accept header".
function siiFacadeHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www4.sii.cl',
    Referer: `${SII_RCV_UI}/`,
  }
}

const sesiones = new Map()
const TTL_MS = 25 * 60 * 1000

class CookieJar {
  constructor() {
    this.cookies = new Map()
  }

  setFromResponse(res) {
    const raw = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : []
    for (const line of raw) {
      const [pair] = line.split(';')
      const idx = pair.indexOf('=')
      if (idx > 0) {
        this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
      }
    }
    const single = res.headers.get('set-cookie')
    if (single && raw.length === 0) {
      for (const part of single.split(/,(?=[^;]+?=)/)) {
        const [pair] = part.split(';')
        const idx = pair.indexOf('=')
        if (idx > 0) {
          this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
        }
      }
    }
  }

  get(name) {
    return this.cookies.get(name)
  }

  set(name, value) {
    this.cookies.set(name, value)
  }

  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

function parseRut(rut) {
  const clean = rut.replace(/[.\-\s]/g, '').toUpperCase()
  const dv = clean.slice(-1)
  const cuerpo = clean.slice(0, -1)
  return { cuerpo, dv, completo: `${cuerpo}-${dv}` }
}

// Sigue redirecciones manualmente para poder capturar Set-Cookie en CADA salto.
// Con redirect:'follow' automático, fetch() solo expone los headers de la
// respuesta final — si el SII fija la cookie de sesión real en un 302
// intermedio (muy común en logins), se pierde por completo.
async function fetchConCookies(url, options, jar, _hop = 0) {
  const headers = { ...(options.headers || {}) }
  const cookieHeader = jar.header()
  if (cookieHeader) headers.Cookie = cookieHeader

  let res
  try {
    res = await fetch(url, {
      ...options,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeout || 30000),
    })
  } catch (err) {
    // Un fallo de transporte (DNS, TLS, reset) NO es "fetch failed" a secas:
    // sin el cause la corrida del cron no distingue «el SII no responde» de
    // «la clave es mala» y es imposible de diagnosticar desde el log.
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw err
    const causa = err.cause?.code || err.cause?.errno || ''
    const host = (() => {
      try { return new URL(url).host } catch { return url }
    })()
    throw new Error(`Red SII inaccesible${causa ? ` (${causa})` : ''} al llamar a ${host}`)
  }

  jar.setFromResponse(res)

  const isRedirect = res.status >= 300 && res.status < 400
  const location = res.headers.get('location')
  const seguirRedirects = options.redirect !== 'manual'

  if (isRedirect && location && seguirRedirects && _hop < 10) {
    const nextUrl = new URL(location, url).toString()
    console.log(`[SII] redirect ${res.status} → ${nextUrl} (cookies hasta ahora: [${[...jar.cookies.keys()].join(', ')}])`)
    // Tras un 302 de un POST, el siguiente salto siempre es GET (semántica estándar).
    const nextOptions = res.status === 303 || options.method === 'POST'
      ? { headers: options.headers, redirect: options.redirect }
      : options
    return fetchConCookies(nextUrl, { ...nextOptions, method: 'GET', body: undefined }, jar, _hop + 1)
  }

  return res
}

async function loginSII(rut, clave) {
  const { cuerpo, dv, completo } = parseRut(rut)
  const jar = new CookieJar()

  // Flujo real capturado por HAR: primero se visita la página de login (para que
  // el SII fije sus cookies iniciales de balanceador/sesión), y LUEGO se hace un
  // POST form-urlencoded a CAutInicio.cgi — nunca un GET.
  const referencia = `${SII_RCV_UI}/#/index`
  const loginPageUrl = `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html?${referencia}`
  await fetchConCookies(loginPageUrl, { method: 'GET' }, jar)

  const body = new URLSearchParams({
    rut: cuerpo,
    dv,
    referencia,
    '411': '',
    rutcntr: completo,
    clave,
  })

  const res = await fetchConCookies(
    SII_AUTH_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://zeusr.sii.cl',
        Referer: loginPageUrl,
      },
      body: body.toString(),
    },
    jar
  )
  const texto = await res.text()

  console.log(
    `[SII] login → HTTP ${res.status}, cookies recibidas: [${[...jar.cookies.keys()].join(', ') || 'ninguna'}]`
  )

  // Credencial rechazada: el SII NO responde 401 ni un texto de error; redirige
  // de vuelta al formulario. Si no se detecta aquí, el flujo sigue a
  // obtenerTokenRCV y el 401 del facadeService se reporta como «sesión
  // expirada», lo que hace que el reintento vuelva a autenticarse con la misma
  // clave mala (2 logins por empresa y por corrida, con riesgo de bloqueo).
  const urlFinal = res.url || ''
  const volvioAlLogin = /IngresoRutClave/i.test(urlFinal) || /location\.replace\([^)]*IngresoRutClave/i.test(texto)
  const mensajeRechazo = /clave incorrecta|clave tributaria ingresada no es correcta|no existe/i.test(texto)

  if (volvioAlLogin || mensajeRechazo) {
    console.log('[SII] login rechazado: el SII devolvió al formulario de autenticación (RUT/clave inválidos)')
    throw new Error('Clave SII incorrecta')
  }

  if (!jar.header()) {
    throw new Error('No se obtuvo sesión del SII — verifique credenciales')
  }

  return jar
}

async function obtenerTokenRCV(jar, rut) {
  const { cuerpo, dv } = parseRut(rut)

  // Nota: no usar fragmentos "#/..." aquí — fetch nunca los envía al servidor,
  // solo sirven para rutas del lado del cliente (Angular). Se pide la raíz de la SPA
  // por si el servidor fija ahí alguna cookie adicional, pero no es garantía.
  const initUrl = `${SII_RCV_UI}/`
  const initRes = await fetchConCookies(initUrl, { method: 'GET' }, jar)
  console.log(`[SII] init RCV UI → HTTP ${initRes.status}`)

  const menuUrl = `${SII_RCV_UI}/services/data/facadeService/getResumen`
  const body = {
    metaData: {
      namespace:
        'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen',
      conversationId: jar.get('TOKEN') || `${Date.now()}`,
      transactionId: crypto.randomUUID(),
      page: null,
    },
    data: {
      rutEmisor: cuerpo,
      dvEmisor: dv,
      ptributario: new Date().toISOString().slice(0, 7).replace('-', ''),
      estadoContab: 'REGISTRO',
      operacion: 'COMPRA',
      busquedaInicial: true,
    },
  }

  const res = await fetchConCookies(
    menuUrl,
    {
      method: 'POST',
      headers: siiFacadeHeaders(),
      body: JSON.stringify(body),
    },
    jar
  )

  const token = jar.get('TOKEN')
  console.log(
    `[SII] getResumen → HTTP ${res.status}, cookie TOKEN presente: ${token ? 'sí' : 'no'}`
  )

  if (token) return { jar, token }

  let raw = ''
  try {
    raw = await res.clone().text()
    const data = JSON.parse(raw)
    const convId = data?.metaData?.conversationId
    if (convId) {
      jar.set('TOKEN', convId)
      return { jar, token: convId }
    }
  } catch {
    /* respuesta no JSON */
  }

  console.log(`[SII] getResumen sin TOKEN ni conversationId. Cuerpo (primeros 300 chars): ${raw.slice(0, 300)}`)
  throw new Error(
    'No se pudo obtener token de sesión RCV — el SII no devolvió TOKEN ni conversationId (login básico probablemente ok, pero la sesión no habilita el RCV)'
  )
}

async function obtenerSesion(rut, clave) {
  const key = parseRut(rut).completo
  const cached = sesiones.get(key)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached
  }

  const jar = await loginSII(rut, clave)
  const { token } = await obtenerTokenRCV(jar, rut)
  const sesion = { jar, token, ts: Date.now() }
  sesiones.set(key, sesion)
  return sesion
}

function invalidarSesion(rut) {
  sesiones.delete(parseRut(rut).completo)
}

module.exports = {
  CookieJar,
  parseRut,
  loginSII,
  obtenerSesion,
  invalidarSesion,
  fetchConCookies,
  siiFacadeHeaders,
  SII_RCV_UI,
}
