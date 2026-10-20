'use strict'
/**
 * SII — regresión de autenticación y errores diagnósticos (sin red real).
 *
 * Contexto: la sync diaria del 2026-10-19 reportó para una empresa
 * «No se pudo obtener token de sesión RCV …» y `fetch failed` para todas las
 * demás. Ninguno de los dos mensajes permitía saber qué pasaba:
 *
 * T1 — Credencial rechazada: el SII NO responde 401, redirige al formulario.
 *      `loginSII` lo daba por bueno (había cookies de balanceador) y el 401 del
 *      facadeService se reportaba como «sesión expirada», disparando un segundo
 *      login con la MISMA clave mala.
 * T2 — Login válido sigue funcionando (no se rompió el camino feliz).
 * T3 — Fallo de transporte: el mensaje debe llevar el cause (ENOTFOUND, etc.),
 *      no solo «fetch failed».
 * T4 — `consultarResumen` usaba `periodoCerrado`/`obtenerDeCache` sin
 *      importarlos (ReferenceError en TODA llamada) y leía la caché con una
 *      clave distinta de la que escribía.
 *
 * Ejecutar con: node --test test/sii-sesion.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-sii-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const siiSession = require('../backend/services/sii-session')
const siiRcv = require('../backend/services/sii-rcv')
const rcv = require('../backend/services/rcv')
const db = require('../backend/db')

const fetchOriginal = globalThis.fetch

test.after(() => {
  globalThis.fetch = fetchOriginal
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const LOGIN_URL = 'https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi'
const FORM_URL = 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html'

function respuesta(body, { status = 200, location = null, cookies = [], url = null } = {}) {
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' })
  if (location) headers.set('location', location)
  for (const c of cookies) headers.append('set-cookie', c)
  const res = new Response(body, { status, headers })
  // fetch() real trae la URL final en res.url; un Response construido a mano
  // la deja vacía. La detección de clave rechazada se apoya en ella.
  if (url) Object.defineProperty(res, 'url', { value: url })
  return res
}

// ================= T1: credencial rechazada =================

/**
 * Variante REAL observada el 2026-10-19 con la empresa 4: el POST responde 200
 * con una página genérica (título vacío) y NO redirige ni dice «clave
 * incorrecta»; la única cookie es la del balanceador. Un detector basado solo
 * en la URL o en el texto de la respuesta no la ve — por eso el arreglo se
 * apoya en la ausencia de cookies de sesión.
 */
test('T1: 200 sin cookies de sesión (caso real) → «Clave SII incorrecta»', async () => {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.startsWith(LOGIN_URL)) {
      return respuesta(
        '<!DOCTYPE html><html><head><title></title></head><body><script>mostrar(0,"0")</script></body></html>',
        { cookies: ['TS0161cd2b=balanceador; Path=/'], url: u }
      )
    }
    return respuesta('<html>login</html>', { cookies: ['TS0161cd2b=balanceador; Path=/'], url: u })
  }

  await assert.rejects(
    () => siiSession.loginSII('96987654-K', 'clave-mala'),
    /Clave SII incorrecta/,
    'una clave rechazada debe reportarse como tal, no como token ausente'
  )
})

test('T1b: el SII devuelve al formulario (302) → «Clave SII incorrecta»', async () => {
  const urls = []
  globalThis.fetch = async (url) => {
    const u = String(url)
    urls.push(u)
    if (u.startsWith(FORM_URL)) {
      // 1er GET (página de login) y 3er salto (de vuelta al formulario)
      return respuesta('<html><form action="CAutInicio.cgi">RUT y Clave</form></html>', {
        cookies: ['TS0161cd2b=balanceador; Path=/'],
        url: u,
      })
    }
    if (u.startsWith(LOGIN_URL)) {
      return respuesta('', { status: 302, location: `${FORM_URL}?https://www4.sii.cl/consdcvinternetui/` })
    }
    return respuesta('<html>otro</html>')
  }

  await assert.rejects(
    () => siiSession.loginSII('96987654-K', 'clave-mala'),
    /Clave SII incorrecta/,
    'una clave rechazada debe reportarse como tal, no como token ausente'
  )
  assert.ok(
    urls.some((u) => u.startsWith(FORM_URL)),
    'se siguió la redirección de vuelta al formulario'
  )
})

// ================= T2: login válido =================

test('T2: login válido devuelve el jar con la cookie de sesión (camino feliz intacto)', async () => {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.startsWith(LOGIN_URL)) {
    return respuesta('<html>home del contribuyente</html>', {
      url: u,
      cookies: [
          'TS0161cd2b=balanceador; Path=/',
          'NETSCAPE_LIVEWIRE.rut=96.987.654-K; Path=/',
          'TOKEN=token-ok; Path=/',
          'CSESSIONID=cs-1; Path=/',
        ],
      })
    }
    return respuesta('<html>login</html>', { cookies: ['TS0161cd2b=balanceador; Path=/'] })
  }

  const jar = await siiSession.loginSII('96987654-K', 'clave-buena')
  assert.strictEqual(jar.get('TOKEN'), 'token-ok', 'TOKEN disponible para el facadeService')
})

// ================= T3: fallo de red =================

test('T3: fallo de transporte incluye la causa (ENOTFOUND), no solo «fetch failed»', async () => {
  globalThis.fetch = async () => {
    const err = new TypeError('fetch failed')
    err.cause = { code: 'ENOTFOUND' }
    throw err
  }

  await assert.rejects(
    () => siiSession.loginSII('76312274-3', 'x'),
    /Red SII inaccesible \(ENOTFOUND\)/,
    'el log debe distinguir «el SII no responde» de una credencial mala'
  )
})

// ================= T4: caché de resumen =================

test('T4: consultarResumen sirve de caché un período cerrado sin tocar la red', async () => {
  const periodoCerrado = '202401'
  rcv.guardarEnCache('76312274-3', periodoCerrado, 'resumen:compras', [{ tipoDoc: 33, cantidad: 2 }])

  globalThis.fetch = async () => {
    throw new Error('no debería llamarse al SII con caché de período cerrado')
  }

  const resumen = await siiRcv.consultarResumen('76312274-3', 'x', periodoCerrado, 'compras')
  assert.deepStrictEqual(resumen, [{ tipoDoc: 33, cantidad: 2 }])
})
