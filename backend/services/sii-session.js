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

  // Credencial rechazada: el SII NO responde 401. Lo hace de dos formas
  // observadas contra el servicio real (empresa 4, 2026-10-19):
  //   a) 302 de vuelta al formulario de autenticación, o
  //   b) 200 con una página genérica (título vacío) y SOLO la cookie del
  //      balanceador — sin redirección ni texto de error.
  // La señal inequívoca de sesión abierta son las cookies de autenticación
  // (NETSCAPE_LIVEWIRE.*, X-SII-STATE-*, TOKEN, CSESSIONID), que el login
  // válido fija siempre. Sin ellas, el 401 posterior del facadeService se
  // reportaba como «sesión expirada»: el reintento volvía a autenticarse con la
  // misma clave mala (2 logins por empresa y corrida, con riesgo de bloqueo).
  const urlFinal = res.url || ''
  const volvioAlLogin = /IngresoRutClave/i.test(urlFinal) || /location\.replace\([^)]*IngresoRutClave/i.test(texto)
  const mensajeRechazo = /clave incorrecta|clave tributaria ingresada no es correcta|no existe/i.test(texto)
  // Tope de sesiones simultáneas del SII (código 01.01.2xx.500.720.27): NO es
  // una clave mala. Se confunde con ella porque también responde 200 sin
  // cookies de sesión. Sin este mensaje, el usuario cambiaba la clave en vano
  // y cada reintento automático consumía otra ventana de espera.
  const topeSesiones = /m[aá]ximo de sesiones autenticadas/i.test(texto)
  const cookiesSesion = [...jar.cookies.keys()].filter((k) =>
    /^(TOKEN|CSESSIONID|RUT_NS|DV_NS)$|^(NETSCAPE_LIVEWIRE|X-SII-STATE)[.-]/.test(k)
  )

  if (topeSesiones) {
    console.log('[SII] login rechazado: tope de sesiones autenticadas simultáneas')
    const err = new Error(
      'El SII rechazó el ingreso por tope de sesiones abiertas (no es la clave). ' +
      'Cierra sesión en el sitio del SII —incluidas las sesiones que quedaron abiertas desde otros equipos— y reintenta en unos minutos.'
    )
    err.codigo = 'SII_TOPE_SESIONES'
    throw err
  }

  if (volvioAlLogin || mensajeRechazo || cookiesSesion.length === 0) {
    console.log(
      `[SII] login rechazado: sin cookies de sesión (${volvioAlLogin ? 'redirigió al formulario' : mensajeRechazo ? 'mensaje de clave inválida' : 'solo cookies de balanceador'})`
    )
    throw new Error('Clave SII incorrecta (el SII no abrió sesión con estas credenciales)')
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

/**
 * Cierra la sesión EN EL SII (no solo en memoria).
 *
 * El SII limita las sesiones simultáneas por RUT (código 01.01.2xx.500.720.27)
 * y NO las libera al cerrar el navegador: solo al presionar «Cerrar Sesión» o
 * cuando expiran por inactividad. No hacerlo dejaba una sesión colgada por
 * cada sincronización y, tras varias corridas, el cliente quedaba bloqueado
 * sin poder ingresar ni con la clave correcta.
 */
async function cerrarJar(jar) {
  if (!jar) return
  try {
    await fetchConCookies('https://zeusr.sii.cl/cgi_AUT2000/autTermino.cgi', { method: 'GET' }, jar)
  } catch { /* el cierre nunca debe romper la operación en curso */ }
}

async function obtenerSesion(rut, clave) {
  const key = parseRut(rut).completo
  const cached = sesiones.get(key)
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return cached
  }
  // Sesión vencida: se cierra en el SII antes de pedir otra, para no acumular.
  if (cached) {
    sesiones.delete(key)
    await cerrarJar(cached.jar)
  }

  const jar = await loginSII(rut, clave)
  const { token } = await obtenerTokenRCV(jar, rut)
  const sesion = { jar, token, ts: Date.now() }
  sesiones.set(key, sesion)
  return sesion
}

async function invalidarSesion(rut) {
  const key = parseRut(rut).completo
  const s = sesiones.get(key)
  sesiones.delete(key)
  await cerrarJar(s && s.jar)
}

/** Cierra todas las sesiones SII abiertas por este proceso. */
async function cerrarTodas() {
  const abiertas = [...sesiones.values()]
  sesiones.clear()
  await Promise.all(abiertas.map((s) => cerrarJar(s.jar)))
}

module.exports = {
  CookieJar,
  parseRut,
  loginSII,
  obtenerSesion,
  invalidarSesion,
  cerrarTodas,
  cerrarJar,
  fetchConCookies,
  siiFacadeHeaders,
  SII_RCV_UI,
}
