#!/usr/bin/env node
'use strict'
/**
 * A5 — COPIA EXTERNA CIFRADA A CLOUDFLARE R2.
 *
 *   node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups
 *   node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --ejecutar
 *   node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --solo retencion-remota --ejecutar
 *   node scripts/respaldo-r2.js --remoto jmv-r2 --bucket jmv-backups --estimar
 *
 * SEGURO POR DEFECTO: sin `--ejecutar` solo imprime los comandos (`--dry-run`
 * implícito). No sube, no borra, no valida credenciales y no crea el remoto.
 *
 * PLAN (el orden importa): copia → copia del heredado → verificación de hashes →
 * auditoría de restaurabilidad → INVENTARIO de lo elegible para purga → purga
 * con lista explícita → comprobación posterior. La purga va después de todas
 * las comprobaciones: si cualquiera falla, el CLI sale 1 y **no se borra nada**.
 *
 * LA PURGA NO USA `--max-delete`
 *   Ese tope hacía que rclone borrara N objetos y NO TERMINARA cuando había más
 *   elegibles que el tope (medido con 1.74.3: 30 elegibles con tope 6 quedó
 *   colgado). Aquí primero se inventaría (`lsjson --min-age`), se decide en
 *   memoria qué sellos completos se pueden borrar (`analizarPurga`) y recién
 *   entonces se lanza `delete --files-from-raw <lista>` con los nombres exactos.
 *   Si el inventario supera el tope, se aborta sin borrar y se informa cuántos
 *   objetos hay. `--solo retencion-remota` arrastra el preflight completo: no
 *   existe una purga sin verificación, auditoría e inventario previos.
 *
 * `--cada-dias` declara la cadencia real del cron de retención y decide el tope
 * mínimo de purga que converge (3 objetos por copia × cadencia). Con un tope
 * menor, la cola de pendientes crecería para siempre y la retención de 90 días
 * dejaría de cumplirse.
 *
 * UN SOLO PROCESO
 *   Cada `--ejecutar` toma un lock (`<origen>/.respaldo-r2.lock`). Si hay otra
 *   corrida viva, sale 1 sin tocar el remoto; un lock de un proceso muerto o de
 *   más de 12 h se retira. Todo comando lleva timeout: un rclone bloqueado no
 *   deja el cron esperando para siempre.
 *
 * CÓDIGOS DE SALIDA
 *   0 = plan generado (dry-run) o todos los comandos terminaron bien
 *   1 = `rclone` falló o se agotó su tiempo, la auditoría encontró copias no
 *       restaurables, el inventario supera el tope, la purga dejó un estado
 *       incoherente, o hay otra ejecución en curso
 *   2 = configuración incompleta o inválida (no se ejecutó nada)
 *
 * `rclone` guarda las credenciales en ~/.config/rclone/rclone.conf (600). Este
 * script no las lee, no las imprime y no acepta claves por parámetro.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  construirPlan,
  comandoRetencion,
  comandoVerificacionPurga,
  estimarAlmacenamiento,
  estimarPurga,
  analizarObjetosRemotos,
  analizarPurga,
  verificarPurga,
  MAX_BORRADO_POR_DEFECTO,
  MAX_BORRADO_MINIMO,
  OBJETOS_POR_COPIA,
} = require('../backend/core/r2-plan')

const USO =
  'Uso: node scripts/respaldo-r2.js --remoto <nombre> --bucket <bucket> [--prefijo iva-mensual]\n' +
  '       [--origen data/backups] [--heredado data/archivo-heredado] [--dias 90]\n' +
  `       [--cada-dias 7] [--max-borrado ${MAX_BORRADO_POR_DEFECTO}]\n` +
  '       [--solo <comando>] [--estimar] [--ejecutar] [--bin rclone] [--lock <ruta>]'

/** Un lock más viejo que esto se considera residual aunque el pid siga existiendo. */
const LOCK_MAX_MS = 12 * 60 * 60 * 1000

function morir(mensaje) {
  console.error(`ERROR: ${mensaje}`)
  console.error(USO)
  process.exit(2)
}

function parsearArgumentos(argv) {
  const o = {
    remoto: process.env.R2_REMOTE || '',
    bucket: process.env.R2_BUCKET || '',
    prefijo: process.env.R2_PREFIX || 'iva-mensual',
    origen: 'data/backups',
    heredado: 'data/archivo-heredado',
    diasRetencion: 90,
    maxBorrado: null,
    cadaDias: 7,
    solo: null,
    estimar: false,
    ejecutar: false,
    bin: process.env.RCLONE_BIN || 'rclone',
    lock: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remoto') o.remoto = argv[++i]
    else if (a === '--bucket') o.bucket = argv[++i]
    else if (a === '--prefijo') o.prefijo = argv[++i]
    else if (a === '--origen') o.origen = argv[++i]
    else if (a === '--heredado') o.heredado = argv[++i]
    else if (a === '--dias') o.diasRetencion = Number(argv[++i])
    else if (a === '--cada-dias') o.cadaDias = Number(argv[++i])
    else if (a === '--max-borrado') o.maxBorrado = Number(argv[++i])
    else if (a === '--solo') o.solo = argv[++i]
    else if (a === '--bin') o.bin = argv[++i]
    else if (a === '--lock') o.lock = argv[++i]
    else if (a === '--estimar') o.estimar = true
    else if (a === '--ejecutar') o.ejecutar = true
    else if (a === '--dry-run') o.ejecutar = false
    else return morir(`argumento desconocido: ${a}`)
  }
  if (!o.lock) o.lock = path.join(path.resolve(o.origen), '.respaldo-r2.lock')
  return o
}

/** Tamaño del .enc más reciente (lo que se sube cada noche) y del archivo heredado. */
function medirOrigenes({ origen, heredado }) {
  const dir = path.resolve(origen)
  if (!fs.existsSync(dir)) morir(`no existe la carpeta de origen ${dir}`)
  const cifrados = fs
    .readdirSync(dir)
    .filter((f) => /^iva_mensual_.*\.db\.enc$/.test(f))
    .map((f) => fs.statSync(path.join(dir, f)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  if (!cifrados.length) morir(`no hay copias .db.enc en ${dir}`)

  let heredadoBytes = 0
  const dirHeredado = path.resolve(heredado)
  if (fs.existsSync(dirHeredado)) {
    for (const f of fs.readdirSync(dirHeredado)) {
      const st = fs.statSync(path.join(dirHeredado, f))
      if (st.isFile()) heredadoBytes += st.size
    }
  }
  return { tamanoDiarioBytes: cifrados[0].size, heredadoBytes, copiasLocales: cifrados.length }
}

/** `.db.enc` de la raíz local: lo que la auditoría espera encontrar también en el remoto. */
function leerLocales(dir) {
  try {
    return fs.readdirSync(path.resolve(dir)).filter((f) => /^iva_mensual_.*\.db\.enc$/.test(f))
  } catch {
    return []
  }
}

function imprimirAuditoria(informe) {
  console.log(
    `[R2] auditoría remota: ${informe.sellos} sellos (${informe.objetosRaiz} objetos en raíz, ${informe.heredado} en heredado), ` +
      `${informe.noRestaurables.length} no restaurables, ${informe.incompletos.length} incompletos, ` +
      `${informe.huerfanos.length} huérfanos, ${informe.faltantes.length} faltantes`
  )
  for (const n of informe.noRestaurables) console.log(`[R2] NO RESTAURABLE ${n.sello} — falta ${n.falta.join(', ')}`)
  for (const i of informe.incompletos) console.log(`[R2] INCOMPLETO ${i.sello} — falta ${i.falta.join(', ')}`)
  for (const h of informe.huerfanos) console.log(`[R2] HUÉRFANO ${h} (sin .db.enc)`)
  for (const f of informe.faltantes) console.log(`[R2] FALTANTE en remoto ${f}`)
  if (informe.ok) console.log('[R2] auditoría remota: todas las copias auditadas son restaurables')
}

function imprimirPurga(decision) {
  console.log(
    `[R2] inventario de purga: ${decision.total} objetos elegibles, ${decision.completos.length} sellos completos, ` +
      `${decision.parciales.length} parciales, ${decision.inesperados.length} en subdirectorios, tope ${decision.maxBorrado}`
  )
  for (const p of decision.problemas) console.log(`[R2] PURGA BLOQUEADA — ${p}`)
}

/* ---------------------------------- lock ---------------------------------- */

function pidVivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM = existe pero no tenemos permiso de señalizarlo: sigue vivo.
    return err.code === 'EPERM'
  }
}

/**
 * Toma el lock con `wx` (creación exclusiva). Un lock de otra corrida viva se
 * respeta; uno de un proceso muerto o de más de 12 h es residual y se retira.
 * @returns {{ok:boolean, motivo?:string, recuperado?:boolean}}
 */
function adquirirLock(ruta) {
  const contenido = JSON.stringify({ pid: process.pid, inicio: new Date().toISOString(), script: 'respaldo-r2' }) + '\n'
  try {
    fs.writeFileSync(ruta, contenido, { mode: 0o600, flag: 'wx' })
    return { ok: true }
  } catch (err) {
    if (err.code !== 'EEXIST') return { ok: false, motivo: `no se pudo crear el lock ${ruta}: ${err.message}` }
  }

  let previo = null
  try {
    previo = JSON.parse(fs.readFileSync(ruta, 'utf8'))
  } catch {
    previo = null
  }
  let edad = Infinity
  try {
    edad = Date.now() - fs.statSync(ruta).mtimeMs
  } catch {
    edad = Infinity
  }
  const pid = previo ? Number(previo.pid) : NaN
  if (pidVivo(pid) && edad < LOCK_MAX_MS) {
    return { ok: false, motivo: `ya hay otra ejecución en curso (pid ${pid} desde ${previo.inicio || 'desconocido'}); no se toca el remoto` }
  }

  // Residual (proceso muerto o corrida eterna): se retira y se reintenta UNA vez.
  try {
    fs.rmSync(ruta, { force: true })
    fs.writeFileSync(ruta, contenido, { mode: 0o600, flag: 'wx' })
    return { ok: true, recuperado: true }
  } catch (err) {
    return { ok: false, motivo: `no se pudo recuperar el lock ${ruta}: ${err.message}` }
  }
}

function liberarLock(ruta) {
  try {
    fs.rmSync(ruta, { force: true })
  } catch {
    // Si no se puede borrar, el próximo arranque lo verá residual por edad/pid.
  }
}

/* ------------------------------- ejecución -------------------------------- */

function minutos(ms) {
  return Math.max(1, Math.round(ms / 60000))
}

/** `rclone` con timeout: un proceso bloqueado se mata y se informa como fallo. */
function lanzar(o, c, argv) {
  const opciones = c.capturar
    ? { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: c.timeoutMs, killSignal: 'SIGKILL' }
    : { stdio: 'inherit', timeout: c.timeoutMs, killSignal: 'SIGKILL' }
  return spawnSync(o.bin, argv, opciones)
}

/** Motivo de fallo legible, o null si el comando terminó bien. */
function falloDeLanzamiento(o, c, res) {
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') return `${c.nombre}: se agotó el tiempo (${minutos(c.timeoutMs)} min) y el proceso se terminó`
    return `${c.nombre}: no se pudo lanzar ${o.bin} (${res.error.code || res.error.message})`
  }
  if (res.status !== 0) return `${c.nombre} falló con código ${res.status}`
  return null
}

/** Lista de purga: un nombre por línea, en un archivo 0600 dentro del origen. */
function escribirListaPurga(o, nombres) {
  for (const n of nombres) {
    if (!n || /[\r\n]/.test(n) || n.startsWith('/') || n.includes('..')) {
      throw new Error(`nombre inválido en la lista de purga: ${JSON.stringify(n)}`)
    }
    if (n.split('/').length > 1) throw new Error(`la purga no acepta objetos de subdirectorios: ${n}`)
  }
  const ruta = path.join(path.resolve(o.origen), `.purga-r2-${process.pid}-${Date.now()}.txt`)
  fs.writeFileSync(ruta, nombres.join('\n') + '\n', { mode: 0o600, flag: 'wx' })
  try {
    fs.chmodSync(ruta, 0o600)
  } catch {
    // NTFS: se controla por ACL del directorio.
  }
  return ruta
}

/**
 * Tras un `delete` fallido no se sabe si borró todo, parte o nada: se lista el
 * remoto y se informa si el estado quedó coherente. No cambia el código de
 * salida (ya es 1); sirve para no dejar un sello partido sin diagnóstico.
 */
function comprobarEstadoTrasFallo(o, destino, antes, borrados) {
  const cmd = comandoVerificacionPurga({ destino })
  const res = lanzar(o, cmd, cmd.argv)
  if (falloDeLanzamiento(o, cmd, res)) return
  try {
    const control = verificarPurga({ antes, despues: res.stdout, borrados })
    for (const p of control.problemas) console.error(`[R2] PURGA INCOHERENTE — ${p}`)
    if (control.ok) console.error('[R2] estado posterior coherente: lo que falta coincide con la lista de purga')
  } catch (err) {
    console.error(`[R2] no se pudo comprobar el estado posterior: ${err.message}`)
  }
}

/**
 * Ejecuta los comandos del plan. Devuelve el código de salida; nunca llama a
 * `process.exit`, para que el `finally` del lock y de la lista se ejecute.
 */
function ejecutarPlan(o, plan, destino) {
  const capturas = {}
  const tope = o.maxBorrado == null ? MAX_BORRADO_POR_DEFECTO : o.maxBorrado
  let borrados = []
  let rutaLista = null

  try {
    for (const c of plan.comandos) {
      let argv = c.argv

      if (c.nombre === 'retencion-remota') {
        if (capturas['inventario-purga'] == null) {
          console.error('[R2] purga sin inventario previo: el preflight es obligatorio, no se borra nada')
          return 1
        }
        let decision
        try {
          decision = analizarPurga(capturas['inventario-purga'], { maxBorrado: tope })
        } catch (err) {
          console.error(`[R2] inventario de purga ilegible: ${err.message}`)
          return 1
        }
        imprimirPurga(decision)
        if (!decision.ok) {
          console.error('[R2] purga abortada: no se borra NADA')
          return 1
        }
        if (!decision.borrar.length) {
          console.log('[R2] purga: no hay objetos elegibles fuera de retención; no se ejecuta delete')
          continue
        }
        try {
          rutaLista = escribirListaPurga(o, decision.borrar)
        } catch (err) {
          console.error(`[R2] no se pudo escribir la lista de purga: ${err.message}`)
          return 1
        }
        borrados = decision.borrar
        argv = comandoRetencion({ destino, diasRetencion: o.diasRetencion, objetos: borrados.length, rutaLista }).argv
      }

      if (c.nombre === 'verificacion-purga' && !borrados.length) {
        console.log('\n[R2] verificacion-purga: no hubo purga; se omite la comparación')
        continue
      }

      console.log(`\n[R2] ejecutando ${c.nombre}…`)
      const res = lanzar(o, c, argv)
      const fallo = falloDeLanzamiento(o, c, res)
      if (fallo) {
        console.error(`[R2] ${fallo}`)
        if (c.nombre === 'retencion-remota' && borrados.length && capturas['auditoria-remota'] != null) {
          comprobarEstadoTrasFallo(o, destino, capturas['auditoria-remota'], borrados)
        }
        return 1
      }

      if (!c.capturar) continue
      capturas[c.nombre] = res.stdout

      if (c.nombre === 'auditoria-remota') {
        let informe
        try {
          informe = analizarObjetosRemotos(res.stdout, { locales: leerLocales(o.origen) })
        } catch (err) {
          console.error(`[R2] ${c.nombre}: ${err.message}`)
          return 1
        }
        imprimirAuditoria(informe)
        if (!informe.ok) {
          console.error('[R2] auditoría remota: hay copias no restaurables o incompletas; se detiene ANTES de purgar')
          return 1
        }
      }

      if (c.nombre === 'verificacion-purga') {
        let control
        try {
          control = verificarPurga({ antes: capturas['auditoria-remota'], despues: res.stdout, borrados })
        } catch (err) {
          console.error(`[R2] ${c.nombre}: ${err.message}`)
          return 1
        }
        if (!control.ok) {
          for (const p of control.problemas) console.error(`[R2] PURGA INCOHERENTE — ${p}`)
          console.error('[R2] el estado del remoto no es el esperado: revisa el bucket antes de la próxima corrida')
          return 1
        }
        console.log(`[R2] verificación posterior: ${control.borrados} objetos borrados, ${control.sellos} sellos restantes coherentes`)
      }
    }

    console.log('\n[R2] OK: copia, verificación, auditoría, purga y comprobación posterior completadas')
    return 0
  } finally {
    if (rutaLista) {
      try {
        fs.rmSync(rutaLista, { force: true })
      } catch {
        // Queda un archivo oculto 0600 con nombres de objetos; sin contenido sensible.
      }
    }
  }
}

function main() {
  const o = parsearArgumentos(process.argv.slice(2))
  const plan = construirPlan({
    ...o,
    maxBorrado: o.maxBorrado == null ? MAX_BORRADO_POR_DEFECTO : o.maxBorrado,
    diasEntreRetenciones: o.cadaDias,
  })

  if (!plan.ok) {
    console.error('ERROR: configuración incompleta o inválida:')
    for (const e of plan.errores) console.error(`  - ${e}`)
    console.error(USO)
    return 2
  }

  console.log(`[R2] destino: ${plan.destino}`)
  console.log(`[R2] modo: ${o.ejecutar ? 'EJECUTAR' : 'DRY-RUN (no se ejecuta nada)'}`)

  if (o.estimar) {
    const medidas = medirOrigenes(o)
    const est = estimarAlmacenamiento({ ...medidas, diasRetencion: o.diasRetencion })
    console.log(
      `[R2] estimación: ${est.copias} copias × ${medidas.tamanoDiarioBytes} B + heredado ${medidas.heredadoBytes} B ` +
        `= ${est.gb} GB (${est.gib} GiB); cuota libre ${est.cuotaLibreGb} GB → ` +
        (est.dentroCuotaLibre ? 'dentro' : `excede ${est.excesoGb} GB (~${est.costoMensualUsd} USD/mes)`)
    )
    console.log(`[R2] operaciones/mes: clase A ${est.operaciones.claseA}, clase B ${est.operaciones.claseB}`)
    console.log(`[R2] tamaño diario máximo que aún cabe en la cuota libre: ${est.tamanoDiarioMaximo} B`)

    const purga = estimarPurga({
      maxBorrado: o.maxBorrado == null ? MAX_BORRADO_POR_DEFECTO : o.maxBorrado,
      diasEntreCorridas: o.cadaDias,
    })
    console.log(
      `[R2] purga: ${purga.porCorrida} objetos/corrida (${OBJETOS_POR_COPIA} por copia × ${purga.diasEntreCorridas} días), ` +
        `tope ${purga.maxBorrado} (mínimo ${MAX_BORRADO_MINIMO}) → ` +
        (purga.converge ? `converge, pendientes ${purga.pendientesFinales} en 52 semanas` : `NO converge: quedarían ${purga.pendientesFinales} pendientes`)
    )
  }

  for (const c of plan.comandos) {
    console.log(`\n# ${c.nombre} — ${c.descripcion}`)
    console.log(`${o.bin} ${c.argv.join(' ')}`)
  }

  if (plan.advertencias.length) {
    console.log('\n# advertencias')
    for (const a of plan.advertencias) console.log(`# - ${a}`)
  }

  if (!o.ejecutar) {
    console.log('\n[R2] nada ejecutado (agrega --ejecutar cuando el bucket y las credenciales existan)')
    return 0
  }

  const dirOrigen = path.resolve(o.origen)
  if (!fs.existsSync(dirOrigen)) {
    console.error(`ERROR: no existe la carpeta de origen ${dirOrigen}`)
    return 1
  }

  const lock = adquirirLock(path.resolve(o.lock))
  if (!lock.ok) {
    console.error(`[R2] ${lock.motivo}`)
    return 1
  }
  if (lock.recuperado) console.log('[R2] lock residual de una corrida anterior: se retiró y se tomó uno nuevo')

  try {
    return ejecutarPlan(o, plan, plan.destino)
  } finally {
    liberarLock(path.resolve(o.lock))
  }
}

try {
  process.exit(main())
} catch (err) {
  console.error(`[R2] ERROR inesperado: ${err.message}`)
  process.exit(1)
}
