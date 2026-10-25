'use strict'
/**
 * A6 — AVISO DE RESPALDO POR PUSHOVER (API oficial de mensajes).
 *
 * Contrato con la API (https://pushover.net/api):
 *   POST https://api.pushover.net/1/messages.json
 *   Content-Type: application/x-www-form-urlencoded
 *   token + user (ambos de 30 caracteres [A-Za-z0-9]) + message (≤1024) + title (≤250)
 *
 *   - HTTP 200 y `status === 1`  → mensaje ACEPTADO y en cola (no «entregado al
 *     dispositivo»: eso no lo confirma esta API sin receipt).
 *   - HTTP 4xx o `status !== 1`  → entrada inválida (token, usuario, cuota). Repetir
 *     la MISMA petición nunca funciona: `reintentable: false`.
 *   - HTTP 429                   → cuota mensual de la cuenta agotada (10.000/mes
 *     compartidos por todas las apps del usuario). No se arregla reintentando hoy.
 *   - HTTP 5xx, timeout o error de red → problema temporal: `reintentable: true`
 *     (la documentación pide no repetir antes de 5 s y no abrir más de 2 conexiones).
 *
 * PRIORIDAD 2 (emergencia)
 *   La API **exige** `retry` (segundos entre reintentos, mínimo 30) y `expire`
 *   (cuánto sigue reintentando, máximo 10.800) cuando `priority=2`. Enviarla sin
 *   esos parámetros devuelve 400, así que aquí se completan con valores por
 *   defecto (60 s / 3600 s) y se validan ANTES de tocar la red: una alerta de
 *   emergencia que la API rechaza por contrato es peor que un error local claro.
 *
 * REGLAS DE SEGURIDAD DE ESTE MÓDULO
 *  1. El token y la user key NUNCA se incluyen en el resultado, ni en los mensajes
 *     de error, ni en los `detalle`. Todo texto que sale de aquí pasa por `redactar`.
 *  2. No imprime nada: quien lo usa decide qué registrar.
 *  3. No define valores por defecto de credenciales ni las lee de la BD.
 *  4. `PUSHOVER_ENDPOINT` solo existe para pruebas/staging contra un servidor local;
 *     en producción no se define y el endpoint es el oficial.
 *
 * Módulo puro (sin Express, sin BD, sin fs): testeable con un `fetch` simulado.
 */

const URL_API = 'https://api.pushover.net/1/messages.json'
const MAX_MENSAJE = 1024
const MAX_TITULO = 250
/** Las claves de Pushover son exactamente 30 caracteres alfanuméricos. */
const PATRON_CLAVE = /^[A-Za-z0-9]{30}$/
/** Prioridad 2: `retry` ≥ 30 s y `expire` ≤ 10.800 s (contrato oficial). */
const RETRY_MINIMO = 30
const EXPIRE_MAXIMO = 10800
const RETRY_POR_DEFECTO = 60
const EXPIRE_POR_DEFECTO = 3600

function esClaveValida(valor) {
  return PATRON_CLAVE.test(String(valor == null ? '' : valor).trim())
}

/**
 * Lee y valida las dos variables SIN devolverlas en ningún resumen imprimible.
 * @param {object} env
 * @returns {{token:string, user:string, faltantes:string[], invalidas:string[], configurado:boolean}}
 */
function leerConfig(env = process.env) {
  const token = String(env.PUSHOVER_APP_TOKEN || '').trim()
  const user = String(env.PUSHOVER_USER_KEY || '').trim()
  const faltantes = []
  const invalidas = []
  if (!token) faltantes.push('PUSHOVER_APP_TOKEN')
  if (!user) faltantes.push('PUSHOVER_USER_KEY')
  if (token && !esClaveValida(token)) invalidas.push('PUSHOVER_APP_TOKEN')
  if (user && !esClaveValida(user)) invalidas.push('PUSHOVER_USER_KEY')
  return { token, user, faltantes, invalidas, configurado: faltantes.length === 0 && invalidas.length === 0 }
}

/** Resumen apto para logs: dice qué falta, jamás qué valor hay. */
function inspeccionar(env = process.env) {
  const c = leerConfig(env)
  return {
    configurado: c.configurado,
    faltantes: c.faltantes,
    formatoInvalido: c.invalidas,
    motivo: c.configurado
      ? null
      : [
          c.faltantes.length ? `faltan ${c.faltantes.join(', ')}` : null,
          c.invalidas.length ? `formato inválido en ${c.invalidas.join(', ')} (deben ser 30 caracteres alfanuméricos)` : null,
        ].filter(Boolean).join('; '),
  }
}

/** Sustituye cualquier aparición de un secreto por [REDACTADO]. */
function crearRedactor(valores) {
  const lista = valores.filter((v) => typeof v === 'string' && v.length >= 8)
  return (texto) => {
    let salida = String(texto == null ? '' : texto)
    for (const v of lista) salida = salida.split(v).join('[REDACTADO]')
    return salida
  }
}

function recortar(texto, maximo) {
  const s = String(texto == null ? '' : texto)
  return s.length > maximo ? s.slice(0, maximo - 1) + '…' : s
}

/**
 * Crea un notificador. `fetchImpl` permite inyectar un `fetch` de prueba.
 * @param {{env?:object, endpoint?:string, timeoutMs?:number, fetchImpl?:Function}} opciones
 */
function crearNotificador(opciones = {}) {
  const env = opciones.env || process.env
  const conf = leerConfig(env)
  const endpoint = opciones.endpoint || env.PUSHOVER_ENDPOINT || URL_API
  const timeoutMs = Number.isFinite(opciones.timeoutMs) ? opciones.timeoutMs : 8000
  const fetchImpl = opciones.fetchImpl || globalThis.fetch
  const redactar = crearRedactor([conf.token, conf.user])
  const resumen = inspeccionar(env)

  /**
   * Envía una notificación. Nunca lanza: devuelve un resultado verificable.
   * @returns {Promise<{ok:boolean, estado:string, status?:number, id?:string|null,
   *                    detalle?:string, errores?:string[], reintentable:boolean}>}
   */
  async function enviar({ titulo, mensaje, prioridad = 1, sonido, retry, expire } = {}) {
    if (!conf.configurado) {
      return { ok: false, estado: 'no_configurado', detalle: resumen.motivo || 'canal no configurado', reintentable: false }
    }
    if (!mensaje || !String(mensaje).trim()) {
      return { ok: false, estado: 'entrada_invalida', detalle: 'el mensaje no puede estar vacío', reintentable: false }
    }

    // Prioridad 2 sin retry/expire es un 400 garantizado: se resuelve aquí.
    let retryFinal = null
    let expireFinal = null
    if (prioridad === 2) {
      retryFinal = retry == null ? RETRY_POR_DEFECTO : retry
      expireFinal = expire == null ? EXPIRE_POR_DEFECTO : expire
      if (!Number.isInteger(retryFinal) || retryFinal < RETRY_MINIMO) {
        return {
          ok: false,
          estado: 'entrada_invalida',
          detalle: `prioridad 2 exige retry ≥ ${RETRY_MINIMO} s (recibido ${retryFinal})`,
          reintentable: false,
        }
      }
      if (!Number.isInteger(expireFinal) || expireFinal < retryFinal || expireFinal > EXPIRE_MAXIMO) {
        return {
          ok: false,
          estado: 'entrada_invalida',
          detalle: `prioridad 2 exige expire entre retry (${retryFinal} s) y ${EXPIRE_MAXIMO} s (recibido ${expireFinal})`,
          reintentable: false,
        }
      }
    }

    if (typeof fetchImpl !== 'function') {
      return { ok: false, estado: 'sin_fetch', detalle: 'no hay implementación de fetch disponible', reintentable: true }
    }

    const cuerpo = new URLSearchParams()
    cuerpo.set('token', conf.token)
    cuerpo.set('user', conf.user)
    cuerpo.set('message', recortar(mensaje, MAX_MENSAJE))
    if (titulo) cuerpo.set('title', recortar(titulo, MAX_TITULO))
    if (Number.isInteger(prioridad) && prioridad >= -2 && prioridad <= 2) cuerpo.set('priority', String(prioridad))
    if (retryFinal != null) {
      cuerpo.set('retry', String(retryFinal))
      cuerpo.set('expire', String(expireFinal))
    }
    if (sonido) cuerpo.set('sound', String(sonido))

    let res
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: cuerpo.toString(),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      const nombre = err && err.name
      if (nombre === 'TimeoutError' || nombre === 'AbortError') {
        return { ok: false, estado: 'timeout', detalle: `sin respuesta en ${timeoutMs} ms`, reintentable: true }
      }
      return { ok: false, estado: 'red', detalle: redactar((err && err.message) || 'error de red'), reintentable: true }
    }

    const status = Number(res && res.status)
    let texto = ''
    try {
      texto = await res.text()
    } catch {
      texto = ''
    }
    let json = null
    if (texto) {
      try {
        json = JSON.parse(texto)
      } catch {
        json = null
      }
    }

    const erroresApi = json && Array.isArray(json.errors) ? json.errors.slice(0, 5).map((e) => redactar(String(e))) : []

    if (status === 200 && json && Number(json.status) === 1) {
      return { ok: true, estado: 'enviado', status, id: (json && json.request) || null, reintentable: false }
    }
    if (status === 429) {
      return { ok: false, estado: 'cuota', status, detalle: 'cuota mensual de mensajes agotada', errores: erroresApi, reintentable: false }
    }
    if (status >= 400 && status < 500) {
      return {
        ok: false,
        estado: 'rechazada',
        status,
        detalle: erroresApi.join('; ') || 'la API rechazó la petición',
        errores: erroresApi,
        reintentable: false,
      }
    }
    if (status >= 500) {
      return { ok: false, estado: 'http', status, detalle: `error del servidor (${status})`, errores: erroresApi, reintentable: true }
    }
    if (status === 200) {
      return { ok: false, estado: 'respuesta_invalida', status, detalle: 'HTTP 200 sin status=1 en el cuerpo', reintentable: true }
    }
    return { ok: false, estado: 'respuesta_invalida', status, detalle: `respuesta inesperada (${status || 'sin código'})`, reintentable: true }
  }

  return {
    /** ¿Hay credenciales válidas? (sin exponerlas) */
    configurado: conf.configurado,
    motivoNoConfigurado: resumen.motivo,
    endpoint,
    timeoutMs,
    enviar,
  }
}

module.exports = {
  URL_API,
  MAX_MENSAJE,
  MAX_TITULO,
  PATRON_CLAVE,
  RETRY_MINIMO,
  EXPIRE_MAXIMO,
  RETRY_POR_DEFECTO,
  EXPIRE_POR_DEFECTO,
  esClaveValida,
  leerConfig,
  inspeccionar,
  recortar,
  crearNotificador,
}
