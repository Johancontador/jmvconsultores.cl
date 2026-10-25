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
 * CÓDIGOS DE SALIDA
 *   0 = plan generado (dry-run) o todos los comandos terminaron bien
 *   1 = `rclone` falló en alguno de los comandos
 *   2 = configuración incompleta o inválida (no se ejecutó nada)
 *
 * `rclone` guarda las credenciales en ~/.config/rclone/rclone.conf (600). Este
 * script no las lee, no las imprime y no acepta claves por parámetro.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const { construirPlan, estimarAlmacenamiento } = require('../backend/core/r2-plan')

const USO =
  'Uso: node scripts/respaldo-r2.js --remoto <nombre> --bucket <bucket> [--prefijo iva-mensual]\n' +
  '       [--origen data/backups] [--heredado data/archivo-heredado] [--dias 90] [--max-borrado 10]\n' +
  '       [--solo <comando>] [--estimar] [--ejecutar] [--bin rclone]'

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
    maxBorrado: 10,
    solo: null,
    estimar: false,
    ejecutar: false,
    bin: process.env.RCLONE_BIN || 'rclone',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--remoto') o.remoto = argv[++i]
    else if (a === '--bucket') o.bucket = argv[++i]
    else if (a === '--prefijo') o.prefijo = argv[++i]
    else if (a === '--origen') o.origen = argv[++i]
    else if (a === '--heredado') o.heredado = argv[++i]
    else if (a === '--dias') o.diasRetencion = Number(argv[++i])
    else if (a === '--max-borrado') o.maxBorrado = Number(argv[++i])
    else if (a === '--solo') o.solo = argv[++i]
    else if (a === '--bin') o.bin = argv[++i]
    else if (a === '--estimar') o.estimar = true
    else if (a === '--ejecutar') o.ejecutar = true
    else if (a === '--dry-run') o.ejecutar = false
    else return morir(`argumento desconocido: ${a}`)
  }
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

function main() {
  const o = parsearArgumentos(process.argv.slice(2))
  const plan = construirPlan(o)

  if (!plan.ok) {
    console.error('ERROR: configuración incompleta o inválida:')
    for (const e of plan.errores) console.error(`  - ${e}`)
    console.error(USO)
    process.exit(2)
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
    process.exit(0)
  }

  for (const c of plan.comandos) {
    console.log(`\n[R2] ejecutando ${c.nombre}…`)
    const res = spawnSync(o.bin, c.argv, { stdio: 'inherit' })
    if (res.error) {
      console.error(`[R2] no se pudo lanzar ${o.bin}: ${res.error.code || res.error.message}`)
      process.exit(1)
    }
    if (res.status !== 0) {
      console.error(`[R2] ${c.nombre} falló con código ${res.status}`)
      process.exit(1)
    }
  }
  console.log('\n[R2] OK: copia, verificación y retención completadas')
  process.exit(0)
}

main()
