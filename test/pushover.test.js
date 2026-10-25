'use strict'
/**
 * A6 — AVISO DE RESPALDO POR PUSHOVER.
 *
 * Todo se prueba con un `fetch` simulado y (para el CLI) con un servidor HTTP
 * local en 127.0.0.1. No se contacta la API real, no hay credenciales reales y
 * ningún test imprime o compara contra valores de token/user.
 *
 * Lo que estos tests fijan:
 *  - HTTP 200 + status 1 → aceptado; 4xx → rechazo definitivo (no reintentar);
 *    429 → cuota; 5xx/timeout → reintentable.
 *  - La respuesta del servidor no puede arrastrar credenciales al log.
 *  - Un fallo del canal NO cambia el código de salida del verificador.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')

const { crearNotificador, inspeccionar, leerConfig, esClaveValida } = require('../backend/core/pushover')
const cifrador = require('../backend/core/backup-cifrado')

const ROOT = path.resolve(__dirname, '..')
const TOKEN = 'aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0' // 30 caracteres, formato válido, ficticio
const USER = 'zY9xW8vU7tS6rQ5pO4nM3lK2jI1hG0'
const SECRETOS = { PUSHOVER_APP_TOKEN: TOKEN, PUSHOVER_USER_KEY: USER }
const temporales = []

function dirTemporal() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'a6-pushover-'))
  temporales.push(d)
  return d
}

test.after(() => {
  for (const d of temporales) fs.rmSync(d, { recursive: true, force: true })
})

/** fetch simulado: devuelve `{status, body}` sin red ni TLS. */
function fetchFalso({ status = 200, body = '{"status":1,"request":"req-1"}', lanzar = null } = {}) {
  const llamadas = []
  const impl = async (url, opciones) => {
    llamadas.push({ url, opciones })
    if (lanzar) throw lanzar
    return { status, text: async () => body }
  }
  impl.llamadas = llamadas
  return impl
}

function cuerpoDe(llamada) {
  return new URLSearchParams(llamada.opciones.body)
}

test('A6/1: envío correcto → aceptado con id y sin filtrar credenciales', async () => {
  const fetchImpl = fetchFalso()
  const n = crearNotificador({ env: SECRETOS, fetchImpl, timeoutMs: 3000 })
  assert.strictEqual(n.configurado, true)

  const r = await n.enviar({ titulo: 'JMV: respaldo con problemas', mensaje: 'SIN BACKUPS en iva-mensual', prioridad: 1 })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.estado, 'enviado')
  assert.strictEqual(r.id, 'req-1')

  const cuerpo = cuerpoDe(fetchImpl.llamadas[0])
  assert.strictEqual(cuerpo.get('token'), TOKEN)
  assert.strictEqual(cuerpo.get('user'), USER)
  assert.strictEqual(cuerpo.get('message'), 'SIN BACKUPS en iva-mensual')
  assert.strictEqual(cuerpo.get('priority'), '1')

  const serializado = JSON.stringify(r)
  assert.ok(!serializado.includes(TOKEN), 'el resultado no puede contener el token')
  assert.ok(!serializado.includes(USER), 'el resultado no puede contener la user key')
})

test('A6/2: rechazo 4xx → fallo definitivo, con los errores de la API y sin secretos', async () => {
  const body = JSON.stringify({ status: 0, errors: ['user identifier is invalid'], request: 'req-2' })
  const fetchImpl = fetchFalso({ status: 400, body })
  const n = crearNotificador({ env: SECRETOS, fetchImpl })

  const r = await n.enviar({ mensaje: 'hola' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.estado, 'rechazada')
  assert.strictEqual(r.status, 400)
  assert.strictEqual(r.reintentable, false, 'repetir la misma petición no arregla una entrada inválida')
  assert.match(r.detalle, /user identifier is invalid/)
})

test('A6/3: timeout → fallo reintentable, no cuelga el cron', async () => {
  const err = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
  const fetchImpl = fetchFalso({ lanzar: err })
  const n = crearNotificador({ env: SECRETOS, fetchImpl, timeoutMs: 1500 })

  const r = await n.enviar({ mensaje: 'hola' })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.estado, 'timeout')
  assert.strictEqual(r.reintentable, true)
  assert.match(r.detalle, /1500 ms/)
})

test('A6/4: respuesta inválida y errores de servidor → no se declara enviado', async () => {
  const noJson = await crearNotificador({ env: SECRETOS, fetchImpl: fetchFalso({ body: '<html>oops</html>' }) }).enviar({ mensaje: 'x' })
  assert.strictEqual(noJson.ok, false)
  assert.strictEqual(noJson.estado, 'respuesta_invalida')
  assert.strictEqual(noJson.reintentable, true)

  const statusCero = await crearNotificador({ env: SECRETOS, fetchImpl: fetchFalso({ body: '{"status":0}' }) }).enviar({ mensaje: 'x' })
  assert.strictEqual(statusCero.ok, false, 'HTTP 200 con status 0 no es un envío correcto')
  assert.strictEqual(statusCero.estado, 'respuesta_invalida')

  const caido = await crearNotificador({ env: SECRETOS, fetchImpl: fetchFalso({ status: 502, body: 'bad gateway' }) }).enviar({ mensaje: 'x' })
  assert.strictEqual(caido.estado, 'http')
  assert.strictEqual(caido.reintentable, true)

  const cuota = await crearNotificador({ env: SECRETOS, fetchImpl: fetchFalso({ status: 429, body: '{"status":0}' }) }).enviar({ mensaje: 'x' })
  assert.strictEqual(cuota.estado, 'cuota')
  assert.strictEqual(cuota.reintentable, false, 'la cuota mensual no se recupera reintentando hoy')
})

test('A6/5: sin credenciales no se intenta la red y el motivo no revela valores', async () => {
  for (const env of [{}, { PUSHOVER_APP_TOKEN: TOKEN }, { PUSHOVER_APP_TOKEN: TOKEN, PUSHOVER_USER_KEY: 'corta' }]) {
    const fetchImpl = fetchFalso()
    const n = crearNotificador({ env, fetchImpl })
    assert.strictEqual(n.configurado, false)
    const r = await n.enviar({ mensaje: 'x' })
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.estado, 'no_configurado')
    assert.strictEqual(fetchImpl.llamadas.length, 0, 'no debe llamarse a la API sin configuración')
    assert.ok(!JSON.stringify(r).includes(TOKEN))
    assert.ok(!JSON.stringify(r).includes('corta'))
  }
  // Una clave de 30 caracteres con espacios o guiones tampoco vale.
  assert.strictEqual(esClaveValida(TOKEN), true)
  assert.strictEqual(esClaveValida('x'.repeat(29)), false)
  assert.strictEqual(esClaveValida('x'.repeat(31)), false)
  assert.strictEqual(esClaveValida(`${'x'.repeat(29)}-`), false)
  assert.strictEqual(leerConfig({ PUSHOVER_APP_TOKEN: '  ', PUSHOVER_USER_KEY: USER }).faltantes.includes('PUSHOVER_APP_TOKEN'), true)
  assert.strictEqual(inspeccionar({}).configurado, false)
  assert.ok(!JSON.stringify(inspeccionar(SECRETOS)).includes(TOKEN))
})

test('A6/6: si la API devuelve el secreto en un error, se redacta antes de salir', async () => {
  const body = JSON.stringify({ status: 0, errors: [`token ${TOKEN} is invalid`] })
  const r = await crearNotificador({ env: SECRETOS, fetchImpl: fetchFalso({ status: 400, body }) }).enviar({ mensaje: 'x' })
  const serializado = JSON.stringify(r)
  assert.ok(!serializado.includes(TOKEN), 'el token no puede aparecer en el error')
  assert.match(serializado, /REDACTADO/)
})

test('A6/7: mensaje y título se recortan a los límites de la API', async () => {
  const fetchImpl = fetchFalso()
  const n = crearNotificador({ env: SECRETOS, fetchImpl })
  await n.enviar({ titulo: 'T'.repeat(400), mensaje: 'M'.repeat(5000) })
  const cuerpo = cuerpoDe(fetchImpl.llamadas[0])
  assert.strictEqual(cuerpo.get('message').length, 1024)
  assert.strictEqual(cuerpo.get('title').length, 250)
})

/* --------------------------- CLI de extremo a extremo --------------------------- */

/** Copia ficticia cifrada (no descifrable) con manifest y hash correctos. */
function sembrarBackup(dir, { horasAtras = 0 } = {}) {
  const stamp = new Date(Date.now() - horasAtras * 3600000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const archivo = `iva_mensual_${stamp}.db.enc`
  const ruta = path.join(dir, archivo)
  fs.writeFileSync(ruta, 'contenido-ficticio-cifrado')
  const manifest = {
    archivo,
    sha256: cifrador.sha256Archivo(ruta),
    tamano_bytes: fs.statSync(ruta).size,
    creado_en: new Date().toISOString(),
    formato: 'jmv-backup-v1',
    cifrado: true,
    base_datos: 'iva_mensual.db',
    secretos: 'ninguno',
  }
  fs.writeFileSync(ruta.replace(/\.db\.enc$/, '.manifest.json'), JSON.stringify(manifest, null, 2))
  return { ruta, archivo, stamp }
}

async function conServidorPushover(responder, fn) {
  const peticiones = []
  const server = http.createServer((req, res) => {
    let cuerpo = ''
    req.on('data', (d) => (cuerpo += d))
    req.on('end', () => {
      peticiones.push({ metodo: req.method, url: req.url, cuerpo: new URLSearchParams(cuerpo) })
      const { status, body } = responder()
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    })
  })
  await new Promise((resolver) => server.listen(0, '127.0.0.1', resolver))
  const { port } = server.address()
  try {
    return await fn({ endpoint: `http://127.0.0.1:${port}/1/messages.json`, peticiones })
  } finally {
    await new Promise((resolver) => server.close(resolver))
  }
}

function archivoSecretos(contenido) {
  const ruta = path.join(dirTemporal(), 'pushover.env')
  fs.writeFileSync(ruta, contenido, { mode: 0o600 })
  return ruta
}

/**
 * Ejecuta el CLI de forma ASÍNCRONA a propósito: con `execFileSync` el proceso de
 * prueba queda bloqueado y el servidor HTTP local (que vive aquí) no puede atender
 * la petición del hijo, así que todo termina en timeout falso.
 */
function ejecutarCLI(args, entorno = {}) {
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, ['scripts/notificar-backup.js', ...args], {
      cwd: ROOT,
      env: { ...process.env, ...entorno },
    })
    let stdout = ''
    let stderr = ''
    hijo.stdout.on('data', (d) => (stdout += d))
    hijo.stderr.on('data', (d) => (stderr += d))
    hijo.on('close', (codigo) => resolver({ codigo, stdout, stderr }))
  })
}

test('A6/8: CLI — respaldo sano → exit 0 y NO se envía aviso', async () => {
  const dir = dirTemporal()
  sembrarBackup(dir)
  await conServidorPushover(
    () => ({ status: 200, body: '{"status":1,"request":"req-ok"}' }),
    async ({ endpoint, peticiones }) => {
      const r = await ejecutarCLI(['--dir', dir, '--secretos', archivoSecretos('')], { PUSHOVER_ENDPOINT: endpoint, ...SECRETOS })
      assert.strictEqual(r.codigo, 0, r.stderr)
      assert.match(r.stdout, /OK/)
      assert.strictEqual(peticiones.length, 0, 'un respaldo sano no debe generar notificaciones')
    }
  )
})

test('A6/9: CLI — respaldo ausente → exit 1 y la alerta llega al canal', async () => {
  const dir = dirTemporal()
  await conServidorPushover(
    () => ({ status: 200, body: '{"status":1,"request":"req-alerta"}' }),
    async ({ endpoint, peticiones }) => {
      const r = await ejecutarCLI(['--dir', dir, '--secretos', archivoSecretos('')], { PUSHOVER_ENDPOINT: endpoint, ...SECRETOS })
      assert.strictEqual(r.codigo, 1, 'el código del verificador se conserva')
      assert.match(r.stdout, /SIN BACKUPS/)
      assert.match(r.stderr, /\[ALERTA\] enviada/)
      assert.strictEqual(peticiones.length, 1)
      assert.strictEqual(peticiones[0].metodo, 'POST')
      assert.match(peticiones[0].cuerpo.get('message'), /SIN BACKUPS/)
      assert.strictEqual(peticiones[0].cuerpo.get('token'), TOKEN)
    }
  )
})

test('A6/10: CLI — si el canal falla, el respaldo roto SIGUE saliendo 1 (no se maquilla)', async () => {
  const dir = dirTemporal()
  await conServidorPushover(
    () => ({ status: 500, body: '{"status":0,"errors":["internal"]}' }),
    async ({ endpoint }) => {
      const r = await ejecutarCLI(['--dir', dir, '--secretos', archivoSecretos(''), '--json'], {
        PUSHOVER_ENDPOINT: endpoint,
        ...SECRETOS,
      })
      assert.strictEqual(r.codigo, 1, 'un fallo de notificación no puede convertir el fallo en éxito')
      const salida = JSON.parse(r.stdout)
      assert.strictEqual(salida.verificacion.ok, false)
      assert.strictEqual(salida.notificacion.ok, false)
      assert.strictEqual(salida.notificacion.estado, 'http')
      assert.strictEqual(salida.notificacion.reintentable, true)
      assert.ok(!r.stdout.includes(TOKEN), 'el JSON no puede contener el token')
    }
  )
})

test('A6/11: CLI — sin archivo de secretos avisa que NO se entregó, con el mismo exit 1', async () => {
  const dir = dirTemporal()
  const r = await ejecutarCLI(['--dir', dir, '--secretos', path.join(dirTemporal(), 'no-existe.env')], {
    PUSHOVER_APP_TOKEN: '',
    PUSHOVER_USER_KEY: '',
  })
  assert.strictEqual(r.codigo, 1)
  assert.match(r.stdout, /SIN BACKUPS/)
  assert.match(r.stderr, /NO ENTREGADA/)
  assert.match(r.stderr, /no_configurado/)
})

test('A6/12: CLI — el archivo de secretos dentro del repositorio se rechaza (exit 2)', async () => {
  const dentro = path.join(ROOT, 'pushover-temporal.env')
  const r = await ejecutarCLI(['--dir', dirTemporal(), '--secretos', dentro])
  assert.strictEqual(r.codigo, 2)
  assert.match(r.stderr, /no puede vivir dentro del repositorio/)
  assert.strictEqual(fs.existsSync(dentro), false)
})

test('A6/13: CLI — `--sin-alerta` conserva la verificación y no intenta red', async () => {
  const dir = dirTemporal()
  await conServidorPushover(
    () => ({ status: 200, body: '{"status":1,"request":"x"}' }),
    async ({ endpoint, peticiones }) => {
      const r = await ejecutarCLI(['--dir', dir, '--sin-alerta'], { PUSHOVER_ENDPOINT: endpoint, ...SECRETOS })
      assert.strictEqual(r.codigo, 1)
      assert.strictEqual(peticiones.length, 0)
    }
  )
})
