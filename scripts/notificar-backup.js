#!/usr/bin/env node
'use strict'
/**
 * A6 — VERIFICAR EL RESPALDO Y, SOLO SI HAY UN PROBLEMA, AVISAR POR PUSHOVER.
 *
 *   node scripts/notificar-backup.js --secretos /home/johan/ops-verificacion/pushover.env
 *   node scripts/notificar-backup.js --dir ./data/backups --json
 *   node scripts/notificar-backup.js --avisar-ok        # heartbeat diario opcional
 *   node scripts/notificar-backup.js --prioridad 2 --retry 60 --expire 3600
 *   node scripts/notificar-backup.js --sin-alerta       # solo verifica (equivale a verificar-backup.js)
 *
 * PRIORIDAD 2: Pushover exige `retry` (≥30 s) y `expire` (≤10.800 s). El CLI los
 * pasa cuando se indican y el módulo los completa/valida antes de la red; sin
 * ellos, la API devolvería 400 y la alerta de emergencia se perdería.
 *
 * El parámetro se llama `--secretos` y NO `--env-file` porque Node 24 intercepta
 * `--env-file` como opción propia incluso después del nombre del script: el
 * proceso muere con exit 9 ("not found") antes de ejecutar una sola línea. Ese
 * choque se detectó en las pruebas, no en producción.
 *
 * CÓDIGOS DE SALIDA (los mismos de `verificar-backup.js`, a propósito):
 *   0 = respaldo reciente e íntegro
 *   1 = hay un problema con el respaldo
 *   2 = error de uso / configuración del propio comando
 *
 * REGLA QUE NO SE ROMPE: el resultado de la NOTIFICACIÓN no altera el código de
 * salida. Si el backup falla y el aviso también falla, se sale con 1 y se imprime
 * `[ALERTA] NO ENTREGADA …` — nunca 0, nunca 2 por culpa del canal. Un problema de
 * Pushover no puede maquillar un backup roto ni convertir un backup sano en fallo.
 *
 * EL ARCHIVO DE SECRETOS VIVE FUERA DEL REPOSITORIO. Si la ruta cae dentro del
 * árbol de trabajo, el comando se niega a arrancar (exit 2): así un `pushover.env`
 * con credenciales reales no puede terminar versionado por descuido.
 *
 * No imprime ni registra PUSHOVER_APP_TOKEN ni PUSHOVER_USER_KEY: el módulo
 * `backend/core/pushover.js` redacta cualquier aparición antes de devolver un error.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { evaluar, resumenTexto } = require('../backend/core/backup-vigilancia')
const { crearNotificador, inspeccionar } = require('../backend/core/pushover')

const RAIZ_REPO = path.resolve(__dirname, '..')
const RUTA_SECRETOS_POR_DEFECTO = process.env.PUSHOVER_ENV_FILE || '/home/johan/ops-verificacion/pushover.env'

const USO =
  'Uso: node scripts/notificar-backup.js [--dir <carpeta>] [--max-horas N] [--sin-hash] ' +
  '[--secretos <ruta>] [--sin-alerta] [--avisar-ok] [--prioridad N] [--retry N] [--expire N] ' +
  '[--timeout-ms N] [--json]'

function morir(mensaje) {
  console.error(`ERROR: ${mensaje}`)
  console.error(USO)
  process.exit(2)
}

function parsearArgumentos(argv) {
  const o = {
    dir: process.env.BACKUP_DIR || './data/backups',
    maxHoras: 26,
    hash: true,
    json: false,
    sinAlerta: false,
    avisarOk: false,
    prioridad: 1,
    retry: null,
    expire: null,
    timeoutMs: 8000,
    envFile: RUTA_SECRETOS_POR_DEFECTO,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') o.dir = argv[++i]
    else if (a === '--max-horas') o.maxHoras = Number(argv[++i])
    else if (a === '--sin-hash') o.hash = false
    else if (a === '--secretos') o.envFile = argv[++i]
    else if (a === '--sin-alerta') o.sinAlerta = true
    else if (a === '--avisar-ok') o.avisarOk = true
    else if (a === '--prioridad') o.prioridad = Number(argv[++i])
    else if (a === '--retry') o.retry = Number(argv[++i])
    else if (a === '--expire') o.expire = Number(argv[++i])
    else if (a === '--timeout-ms') o.timeoutMs = Number(argv[++i])
    else if (a === '--json') o.json = true
    else return morir(`argumento desconocido: ${a}`)
  }
  if (!o.dir) morir('--dir necesita una ruta')
  if (!Number.isFinite(o.maxHoras) || o.maxHoras <= 0) morir('--max-horas debe ser un número mayor que 0')
  if (!Number.isInteger(o.prioridad) || o.prioridad < -2 || o.prioridad > 2) morir('--prioridad debe ser un entero entre -2 y 2')
  if (o.retry != null && (!Number.isInteger(o.retry) || o.retry < 30)) morir('--retry debe ser un entero de al menos 30 segundos (requisito de prioridad 2)')
  if (o.expire != null && (!Number.isInteger(o.expire) || o.expire > 10800 || o.expire < (o.retry == null ? 30 : o.retry))) {
    morir('--expire debe ser un entero entre retry y 10800 segundos (requisito de prioridad 2)')
  }
  if (!Number.isFinite(o.timeoutMs) || o.timeoutMs <= 0) morir('--timeout-ms debe ser un número mayor que 0')
  return o
}

/** ¿La ruta cae dentro del árbol de trabajo del repositorio? */
function dentroDelRepo(ruta) {
  const absoluta = path.resolve(ruta)
  const relativa = path.relative(RAIZ_REPO, absoluta)
  return relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))
}

/**
 * Parser mínimo de `CLAVE=valor` (sin expansión, sin `source`, sin dotenv).
 * Ignora comentarios y líneas vacías; acepta comillas simples o dobles.
 */
function parsearArchivoEnv(texto) {
  const datos = {}
  for (const linea of String(texto).split(/\r?\n/)) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#')) continue
    const m = limpia.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let valor = m[2].trim()
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1)
    }
    datos[m[1]] = valor
  }
  return datos
}

/** Carga las variables del archivo de secretos sin pisar el entorno ya definido. */
function cargarSecretos(ruta) {
  if (!ruta) return { datos: {}, origen: null, problema: 'sin archivo de secretos' }
  if (dentroDelRepo(ruta)) {
    morir(`el archivo de secretos no puede vivir dentro del repositorio: ${path.resolve(ruta)}`)
  }
  if (!fs.existsSync(ruta)) {
    return { datos: {}, origen: ruta, problema: `no existe ${ruta}` }
  }
  let texto
  try {
    texto = fs.readFileSync(ruta, 'utf8')
  } catch (err) {
    return { datos: {}, origen: ruta, problema: `no se pudo leer ${ruta} (${err.code || 'error'})` }
  }
  return { datos: parsearArchivoEnv(texto), origen: ruta, problema: null }
}

function mensajeDeAlerta(informe, hostname) {
  const partes = [resumenTexto(informe)]
  if (informe.copia && informe.copia.archivo) partes.push(`última copia: ${informe.copia.archivo}`)
  partes.push(`host: ${hostname}`)
  partes.push(`revisado: ${new Date().toISOString()}`)
  return partes.join('\n')
}

async function main() {
  const o = parsearArgumentos(process.argv.slice(2))
  const secreto = cargarSecretos(o.envFile)

  const informe = evaluar({
    dir: path.resolve(o.dir),
    maxHoras: o.maxHoras,
    hash: o.hash,
  })

  // El entorno del proceso manda; el archivo solo rellena lo que falte.
  const env = { ...secreto.datos, ...process.env }
  const canal = inspeccionar(env)

  let notificacion = null
  const debeAvisar = !informe.ok || o.avisarOk

  if (!debeAvisar) {
    notificacion = { ok: true, estado: 'omitida', detalle: 'respaldo sano: no se envía aviso', reintentable: false }
  } else if (o.sinAlerta) {
    notificacion = { ok: false, estado: 'omitida', detalle: '--sin-alerta: no se intentó enviar', reintentable: false }
  } else if (!canal.configurado) {
    notificacion = {
      ok: false,
      estado: 'no_configurado',
      detalle: `${canal.motivo}${secreto.problema ? ` (${secreto.problema})` : ''}`,
      reintentable: false,
    }
  } else {
    const notificador = crearNotificador({ env, timeoutMs: o.timeoutMs })
    notificacion = await notificador.enviar({
      titulo: informe.ok ? 'JMV: respaldo correcto' : 'JMV: respaldo con problemas',
      mensaje: mensajeDeAlerta(informe, process.env.HOSTNAME || os.hostname()),
      prioridad: o.prioridad,
      retry: o.retry == null ? undefined : o.retry,
      expire: o.expire == null ? undefined : o.expire,
    })
  }

  const codigo = informe.ok ? 0 : 1

  if (o.json) {
    console.log(JSON.stringify({ verificacion: informe, notificacion: { ...notificacion, canal } }, null, 2))
  } else {
    console.log(resumenTexto(informe))
    if (notificacion.estado === 'enviado') {
      console.error(`[ALERTA] enviada a Pushover (id ${notificacion.id || 'sin id'})`)
    } else if (notificacion.estado === 'omitida') {
      if (!informe.ok) console.error(`[ALERTA] NO ENTREGADA: ${notificacion.detalle}`)
    } else {
      console.error(`[ALERTA] NO ENTREGADA (${notificacion.estado}): ${notificacion.detalle || 'sin detalle'}${notificacion.reintentable ? ' — reintentable' : ''}`)
    }
  }

  process.exit(codigo)
}

main().catch((err) => {
  // Nunca se imprime el error crudo: podría arrastrar credenciales en un stack.
  console.error(`[ALERTA] fallo interno del notificador: ${err && err.message ? err.message : 'error desconocido'}`)
  process.exit(2)
})
