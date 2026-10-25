'use strict'
/**
 * A5 — PLANIFICADOR DE LA COPIA EXTERNA A R2.
 *
 * Se prueba sin red y sin `rclone`: lo que se construye es el plan (argumentos,
 * inclusiones, exclusiones, retención) y la estimación de almacenamiento. El CLI
 * se prueba en dry-run, que por diseño no ejecuta nada.
 *
 * Lo que estos tests fijan:
 *  - Solo viaja lo cifrado: `.db` en claro, `-wal`, `-shm` y `.env` quedan fuera.
 *  - Nunca se emite `sync` (propagaría una pérdida local al remoto).
 *  - `--immutable` está, pero se documenta como anti-sobrescritura, no como
 *    protección contra borrado.
 *  - No se puede apuntar al remoto de otra aplicación.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const {
  validarConfiguracion,
  destinoRemoto,
  construirPlan,
  comandoRetencion,
  comandoCopia,
  estimarAlmacenamiento,
  estimarOperaciones,
  CUOTA_LIBRE_BYTES,
} = require('../backend/core/r2-plan')

const ROOT = path.resolve(__dirname, '..')

test('A5/1: destino válido; y vetado el remoto de otra aplicación', () => {
  const ok = validarConfiguracion({ remoto: 'jmv-r2:', bucket: 'jmv-backups', prefijo: 'iva-mensual' })
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(ok.normalizado.remoto, 'jmv-r2')
  assert.strictEqual(ok.normalizado.destino, 'jmv-r2:jmv-backups/iva-mensual')

  const vetado = validarConfiguracion({ remoto: 'gdrive_johan', bucket: 'jmv-backups' })
  assert.strictEqual(vetado.ok, false)
  assert.match(vetado.errores.join(' '), /otra aplicación/)

  const basura = validarConfiguracion({ remoto: 'JMVR2', bucket: 'B', prefijo: '../fuera' })
  assert.strictEqual(basura.ok, false)
  assert.strictEqual(basura.errores.length, 3, basura.errores.join(' | '))

  assert.strictEqual(destinoRemoto({ remoto: 'jmv-r2', bucket: 'b', prefijo: '' }), 'jmv-r2:b')
})

test('A5/2: la copia lleva solo lo cifrado y nunca usa sync', () => {
  const cmd = comandoCopia({ origen: '/srv/data/backups', destino: 'jmv-r2:jmv-backups/iva-mensual' })
  const argv = cmd.argv.join(' ')
  assert.strictEqual(cmd.argv[0], 'copy')
  assert.ok(!argv.includes('sync'), 'sync borraría el remoto cuando falte un archivo local')
  for (const patron of ['*.db.enc', '*.manifest.json', '*.sha256']) {
    assert.ok(argv.includes(`--include ${patron}`), `falta incluir ${patron}`)
  }
  for (const patron of ['*.db', '*.db-wal', '*.db-shm', '*.env']) {
    assert.ok(argv.includes(`--exclude ${patron}`), `falta excluir ${patron}`)
  }
  assert.ok(argv.includes('--immutable'))
  assert.ok(argv.includes('--checksum'))
})

test('A5/3: el archivo heredado va a su propio prefijo y el plan completo tiene 4 pasos', () => {
  const plan = construirPlan({
    origen: '/srv/data/backups',
    heredado: '/srv/data/archivo-heredado',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    prefijo: 'iva-mensual',
  })
  assert.strictEqual(plan.ok, true, plan.errores.join(' | '))
  assert.deepStrictEqual(
    plan.comandos.map((c) => c.nombre),
    ['copia-backups', 'copia-heredado', 'verificacion-espejo', 'retencion-remota']
  )
  const heredado = plan.comandos.find((c) => c.nombre === 'copia-heredado')
  assert.ok(heredado.argv.includes('jmv-r2:jmv-backups/iva-mensual/heredado'))
  // Las advertencias no deben vender --immutable como protección contra borrado.
  assert.ok(plan.advertencias.some((a) => /NO impide|no impide|no protege/i.test(a)))
})

test('A5/4: la retención es acotada (90 días por defecto y tope por corrida)', () => {
  const cmd = comandoRetencion({ destino: 'jmv-r2:jmv-backups/iva-mensual' })
  assert.strictEqual(cmd.argv[0], 'delete')
  const argv = cmd.argv.join(' ')
  assert.ok(argv.includes('--min-age 90d'))
  assert.ok(argv.includes('--max-delete 10'), 'sin tope, un --min-age equivocado vacía el bucket')
  assert.ok(argv.includes('--include iva_mensual_*'), 'los tres objetos de un stamp deben envejecer juntos')
})

test('A5/5: configuraciones incompletas se rechazan con motivos, sin ejecutar nada', () => {
  assert.strictEqual(construirPlan({ remoto: 'jmv-r2', bucket: 'jmv-backups' }).errores.length >= 2, true)

  const retencionCorta = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    diasRetencion: 7,
  })
  assert.strictEqual(retencionCorta.ok, false)
  assert.match(retencionCorta.errores.join(' '), /menor que 31/)

  const soloInexistente = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    solo: 'no-existe',
  })
  assert.strictEqual(soloInexistente.ok, false)

  const solo = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    solo: 'retencion-remota',
  })
  assert.deepStrictEqual(solo.comandos.map((c) => c.nombre), ['retencion-remota'])
})

test('A5/6: estimación con los tamaños reales del VPS (25-oct)', () => {
  const DIARIO = 72_224_807 // .enc del 2026-10-25T03-00-03
  const HEREDADO = 193_203_503 // data/archivo-heredado completo
  const est = estimarAlmacenamiento({ tamanoDiarioBytes: DIARIO, heredadoBytes: HEREDADO, diasRetencion: 90 })

  assert.strictEqual(est.copias, 90)
  assert.strictEqual(est.totalBytes, 90 * (DIARIO + 800) + HEREDADO)
  assert.strictEqual(est.gb, 6.69)
  assert.strictEqual(est.dentroCuotaLibre, true)
  assert.strictEqual(est.costoMensualUsd, 0)
  assert.strictEqual(est.tamanoDiarioMaximo, 108_963_605, 'a partir de este tamaño diario, 90 días rompen la cuota libre')
  assert.strictEqual(est.operaciones.claseA, 150)
  assert.strictEqual(est.operaciones.dentroCuotaLibre, true)

  // El escenario que sí cuesta: 110 MB diarios durante 90 días.
  const grande = estimarAlmacenamiento({ tamanoDiarioBytes: 110_000_000, heredadoBytes: HEREDADO })
  assert.strictEqual(grande.dentroCuotaLibre, false)
  assert.ok(grande.excesoGb > 0 && grande.excesoGb < 1, `exceso=${grande.excesoGb}`)
  assert.strictEqual(grande.costoMensualUsd, 0.001, 'el exceso cuesta fracciones de centavo, no cero')

  // Con 60 días de retención, incluso un diario de 160 MB cabe.
  const sesenta = estimarAlmacenamiento({ tamanoDiarioBytes: 160_000_000, heredadoBytes: HEREDADO, diasRetencion: 60 })
  assert.strictEqual(sesenta.dentroCuotaLibre, true)
  assert.ok(sesenta.totalBytes <= CUOTA_LIBRE_BYTES)

  assert.throws(() => estimarAlmacenamiento({ tamanoDiarioBytes: 0 }), /mayor que 0/)
  assert.strictEqual(estimarOperaciones({ objetosPorCopia: 10, corridasPorMes: 4 }).claseA, 48)
})

test('A5/7: el CLI en dry-run imprime el plan y no ejecuta rclone', () => {
  const salida = execFileSync(
    process.execPath,
    ['scripts/respaldo-r2.js', '--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--bin', 'rclone-que-no-existe'],
    { cwd: ROOT, encoding: 'utf8' }
  )
  assert.match(salida, /destino: jmv-r2:jmv-backups\/iva-mensual/)
  assert.match(salida, /DRY-RUN/)
  assert.match(salida, /rclone-que-no-existe copy/)
  assert.match(salida, /nada ejecutado/)
  assert.ok(!salida.includes('ejecutando'), 'en dry-run no se lanza ningún comando')
})

test('A5/8: el CLI rechaza el remoto de otra aplicación y la configuración incompleta (exit 2)', () => {
  const casos = [
    ['--remoto', 'gdrive_johan', '--bucket', 'jmv-backups'],
    ['--remoto', 'jmv-r2'],
    ['--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--dias', '3'],
  ]
  for (const args of casos) {
    let codigo = 0
    let salida = ''
    try {
      execFileSync(process.execPath, ['scripts/respaldo-r2.js', ...args], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' })
    } catch (err) {
      codigo = err.status
      salida = String(err.stderr || '')
    }
    assert.strictEqual(codigo, 2, `esperaba exit 2 para ${args.join(' ')}`)
    assert.match(salida, /ERROR/)
  }
})
