'use strict'
/**
 * A5 — PLANIFICADOR DE LA COPIA EXTERNA A R2.
 *
 * Se prueba sin red, sin credenciales y sin `rclone` real: lo que se construye
 * es el plan (argumentos, inclusiones, exclusiones, purga, auditoría) y la
 * estimación de almacenamiento. La ejecución se prueba con un `spawnSync`
 * simulado inyectado por `--require`, que registra los comandos y permite hacer
 * fallar cualquiera de los pasos.
 *
 * Lo que estos tests fijan:
 *  - Solo viaja lo cifrado: `.db` en claro, `-wal`, `-shm` y `.env` quedan fuera.
 *  - Nunca se emite `sync` (propagaría una pérdida local al remoto).
 *  - `--immutable` está, pero se documenta como anti-sobrescritura, no como
 *    protección contra borrado.
 *  - No se puede apuntar al remoto de otra aplicación.
 *  - La purga converge: el tope por corrida no puede ser menor que los objetos
 *    que maduran entre corridas (3 por copia × cadencia), y el patrón está
 *    anclado a la raíz para no tocar `heredado/`.
 *  - La purga NUNCA usa `--max-delete` (con más elegibles que el tope, rclone
 *    borra N y no termina): inventario → decisión → `delete --files-from-raw`
 *    con lista explícita, y comprobación posterior del estado del remoto.
 *  - Si el inventario supera el tope, o un sello quedó partido, no se borra nada.
 *  - La purga no corre sin preflight (`--solo retencion-remota` lo obliga).
 *  - Todo comando lleva timeout y la ejecución toma un lock: dos corridas no se
 *    solapan y un lock residual de un proceso muerto no bloquea para siempre.
 *  - La verificación cubre manifold, hash y restaurabilidad, no solo el `.enc`.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const {
  validarConfiguracion,
  destinoRemoto,
  construirPlan,
  comandoRetencion,
  comandoCopia,
  comandoVerificacion,
  comandoListadoRemoto,
  analizarPurga,
  verificarPurga,
  LISTA_PURGA_PLACEHOLDER,
  estimarAlmacenamiento,
  estimarOperaciones,
  estimarPurga,
  analizarObjetosRemotos,
  PATRON_RETENCION,
  MAX_BORRADO_POR_DEFECTO,
  MAX_BORRADO_MINIMO,
  OBJETOS_POR_COPIA,
  CUOTA_LIBRE_BYTES,
} = require('../backend/core/r2-plan')

const ROOT = path.resolve(__dirname, '..')
const temporales = []

function dirTemporal(prefijo = 'a5-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefijo))
  temporales.push(d)
  return d
}

test.after(() => {
  for (const d of temporales) fs.rmSync(d, { recursive: true, force: true })
})

/* ------------------------------- helpers CLI ------------------------------- */

/**
 * Stub de `child_process.spawnSync` para el CLI. Se inyecta con `--require`, así
 * que el hijo registra cada comando y responde lo que diga la regla. Portátil:
 * no depende de un `rclone` falso ejecutable (Windows no puede lanzar un script
 * bash sin extensión).
 */
function stubRclone(reglas = []) {
  const dir = dirTemporal('a5-stub-')
  const log = path.join(dir, 'llamadas.log')
  const logCompleto = path.join(dir, 'llamadas.jsonl')
  const archivo = path.join(dir, 'rclone-stub.js')
  fs.writeFileSync(
    archivo,
    `const cp = require('child_process')
const fs = require('fs')
const reglas = ${JSON.stringify(reglas)}
const log = ${JSON.stringify(log)}
const logCompleto = ${JSON.stringify(logCompleto)}
const restantes = reglas.map((r) => (r.veces === undefined ? Infinity : r.veces))
cp.spawnSync = (bin, argv) => {
  const linea = argv.join(' ')
  fs.appendFileSync(log, (argv[0] || '') + ' | ' + (argv[1] || '') + '\\n')
  fs.appendFileSync(logCompleto, JSON.stringify(argv) + '\\n')
  for (let i = 0; i < reglas.length; i++) {
    if (restantes[i] <= 0) continue
    const r = reglas[i]
    if (r.comando && r.comando !== argv[0]) continue
    if (r.contiene && !String(argv[1] || '').includes(r.contiene)) continue
    if (r.argsContiene && !r.argsContiene.every((s) => linea.includes(s))) continue
    if (r.argsNoContiene && r.argsNoContiene.some((s) => linea.includes(s))) continue
    restantes[i]--
    return {
      status: r.status === undefined ? 0 : r.status,
      error: r.error ? { code: r.error } : null,
      stdout: r.stdout || '',
      stderr: '',
    }
  }
  return { status: 0, error: null, stdout: '', stderr: '' }
}
`
  )
  const llamadas = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [])
  const llamadasCompletas = () =>
    fs.existsSync(logCompleto)
      ? fs
          .readFileSync(logCompleto, 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : []
  return { stub: archivo, llamadas, llamadasCompletas }
}

function entornoOrigen({ conCopia = true } = {}) {
  const dir = dirTemporal('a5-origen-')
  const origen = path.join(dir, 'backups')
  const heredado = path.join(dir, 'heredado')
  fs.mkdirSync(origen)
  fs.mkdirSync(heredado)
  if (conCopia) fs.writeFileSync(path.join(origen, 'iva_mensual_2026-10-25T03-00-03.db.enc'), 'x')
  fs.writeFileSync(path.join(heredado, 'iva_mensual_2026-10-02T18-17-40.db.enc'), 'y')
  return { dir, origen, heredado }
}

function cliR2(args, { stub } = {}) {
  const argv = stub ? ['--require', stub, 'scripts/respaldo-r2.js', ...args] : ['scripts/respaldo-r2.js', ...args]
  return spawnSync(process.execPath, argv, { cwd: ROOT, encoding: 'utf8' })
}

function argumentosBase(entorno) {
  return [
    '--remoto', 'jmv-r2',
    '--bucket', 'jmv-backups',
    '--origen', entorno.origen,
    '--heredado', entorno.heredado,
  ]
}

const LISTADO_COMPLETO = JSON.stringify([
  { Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' },
  { Path: 'iva_mensual_2026-10-25T03-00-03.manifest.json' },
  { Path: 'iva_mensual_2026-10-25T03-00-03.sha256' },
])

/** Los tres objetos de un sello. */
function objetosSello(sello) {
  return ['.db.enc', '.manifest.json', '.sha256'].map((sufijo) => ({ Path: sello + sufijo }))
}

function objetosSellos(sellos) {
  return sellos.flatMap(objetosSello)
}

function selloViejo(dia) {
  return `iva_mensual_2026-07-${String(dia).padStart(2, '0')}T03-00-03`
}

/* ------------------------------ configuración ------------------------------ */

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

test('A5/3: el heredado va a su prefijo; el plan tiene 7 pasos y termina purgando', () => {
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
    ['copia-backups', 'copia-heredado', 'verificacion-espejo', 'auditoria-remota', 'inventario-purga', 'retencion-remota', 'verificacion-purga'],
    'la purga va después de todas las comprobaciones: si algo falla antes, no se borra nada'
  )
  const heredado = plan.comandos.find((c) => c.nombre === 'copia-heredado')
  assert.ok(heredado.argv.includes('jmv-r2:jmv-backups/iva-mensual/heredado'))

  const verificacion = plan.comandos.find((c) => c.nombre === 'verificacion-espejo')
  for (const patron of ['*.db.enc', '*.manifest.json', '*.sha256']) {
    assert.ok(verificacion.argv.includes(patron), `la verificación debe cubrir ${patron}`)
  }
  assert.ok(verificacion.argv.includes('--checksum'), 'compara contenido, no solo tamaño')

  const auditoria = plan.comandos.find((c) => c.nombre === 'auditoria-remota')
  assert.strictEqual(auditoria.capturar, true, 'lsjson se lee, no se hereda a stdio')
  assert.strictEqual(auditoria.argv[0], 'lsjson')
  assert.ok(auditoria.argv.includes('--files-only'))

  const inventario = plan.comandos.find((c) => c.nombre === 'inventario-purga')
  assert.strictEqual(inventario.argv[0], 'lsjson')
  assert.ok(inventario.argv.includes('--min-age'), 'el inventario solo lista lo que cruzó la retención')
  assert.ok(inventario.argv.includes('90d'))
  assert.ok(inventario.argv.includes(PATRON_RETENCION), 'el inventario no debe salir de la raíz')
  assert.strictEqual(inventario.capturar, true)

  const posterior = plan.comandos.find((c) => c.nombre === 'verificacion-purga')
  assert.strictEqual(posterior.argv[0], 'lsjson')
  assert.strictEqual(posterior.capturar, true)

  assert.ok(plan.advertencias.some((a) => /NO impide|no impide|no protege/i.test(a)))
  assert.ok(plan.advertencias.some((a) => /raíz/.test(a)))
  assert.ok(plan.advertencias.some((a) => /preflight/.test(a)))
})

/* --------------------------------- purga ---------------------------------- */

test('A5/4: la purga va con lista explícita y sin --max-delete (el tope que colgaba a rclone)', () => {
  const cmd = comandoRetencion({ destino: 'jmv-r2:jmv-backups/iva-mensual', objetos: 21, rutaLista: '/tmp/purga.txt' })
  assert.strictEqual(cmd.argv[0], 'delete')
  const argv = cmd.argv.join(' ')
  assert.ok(argv.includes('--files-from-raw /tmp/purga.txt'), 'el alcance es la lista, no un umbral')
  assert.ok(!argv.includes('--max-delete'), 'con más elegibles que el tope rclone borra N y no termina')
  assert.ok(!argv.includes('--include'), 'files-from-raw no admite otros filtros (error de rclone)')
  assert.ok(!argv.includes('--min-age'), 'la antigüedad ya se decidió en el inventario')
  assert.strictEqual(cmd.requiereInventario, true, 'sin inventario previo no se purga')
  assert.ok(cmd.timeoutMs > 0, 'todo comando debe poder cortarse por tiempo')

  assert.ok(comandoRetencion({ destino: 'x' }).argv.join(' ').includes(LISTA_PURGA_PLACEHOLDER))
  assert.strictEqual(PATRON_RETENCION, '/iva_mensual_*', 'sin la barra rclone alcanza heredado/')
  assert.ok(PATRON_RETENCION.startsWith('/'), 'el patrón debe estar anclado a la raíz')
  assert.strictEqual(MAX_BORRADO_MINIMO, OBJETOS_POR_COPIA * 7)
})

test('A5/5: un tope de purga que no converge se rechaza antes de ejecutar', () => {
  const plan = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    maxBorrado: 10,
  })
  assert.strictEqual(plan.ok, false)
  assert.match(plan.errores.join(' '), /no converge/)

  const justo = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    maxBorrado: MAX_BORRADO_MINIMO,
  })
  assert.strictEqual(justo.ok, true, justo.errores.join(' | '))

  const cadenciaDiaria = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    diasEntreRetenciones: 1,
    maxBorrado: 3,
  })
  assert.strictEqual(cadenciaDiaria.ok, true, 'con cadencia diaria bastan 3 objetos por corrida')

  const diariaCorta = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    diasEntreRetenciones: 1,
    maxBorrado: 2,
  })
  assert.strictEqual(diariaCorta.ok, false)

  // Configuración incompleta (antes A5/5): se rechaza con motivos, sin ejecutar nada.
  assert.ok(construirPlan({ remoto: 'jmv-r2', bucket: 'jmv-backups' }).errores.length >= 2)

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

  // F-03: `--solo retencion-remota` arrastra el preflight completo; nunca borra solo.
  const solo = construirPlan({
    origen: 'a',
    heredado: 'b',
    remoto: 'jmv-r2',
    bucket: 'jmv-backups',
    solo: 'retencion-remota',
  })
  assert.deepStrictEqual(solo.comandos.map((c) => c.nombre), [
    'verificacion-espejo',
    'auditoria-remota',
    'inventario-purga',
    'retencion-remota',
    'verificacion-purga',
  ])
})

test('A5/6: la cola de purga converge con el tope por defecto y crece con 10', () => {
  const porDefecto = estimarPurga({})
  assert.strictEqual(porDefecto.porCorrida, 21)
  assert.strictEqual(porDefecto.converge, true)
  assert.strictEqual(porDefecto.pendientesFinales, 0, 'tras 52 semanas no queda cola')

  const insuficiente = estimarPurga({ maxBorrado: 10 })
  assert.strictEqual(insuficiente.converge, false)
  assert.strictEqual(insuficiente.pendientesFinales, 52 * (21 - 10), 'la cola crece de forma lineal')

  const justo = estimarPurga({ maxBorrado: MAX_BORRADO_MINIMO })
  assert.strictEqual(justo.converge, true)
  assert.strictEqual(justo.pendientesFinales, 0)

  const diaria = estimarPurga({ diasEntreCorridas: 1, maxBorrado: 3 })
  assert.strictEqual(diaria.porCorrida, 3)
  assert.strictEqual(diaria.converge, true)

  assert.strictEqual(estimarOperaciones({ objetosPorCopia: 10, corridasPorMes: 4 }).claseA, 48)
})

test('A5/7: simulación de 400 días — converge y nunca purga copias dentro de retención', () => {
  // `dias` múltiplo de la cadencia: la última corrida de purga es la del último día.
  const simular = ({ maxBorrado, dias = 399, cada = 7, retencion = 90 }) => {
    const objetos = []
    const edadesAlPurgar = []
    for (let dia = 1; dia <= dias; dia++) {
      for (let i = 0; i < OBJETOS_POR_COPIA; i++) objetos.push({ dia, purgado: false })
      if (dia % cada !== 0) continue
      const elegibles = objetos.filter((o) => !o.purgado && dia - o.dia > retencion)
      for (const o of elegibles.slice(0, maxBorrado)) {
        o.purgado = true
        edadesAlPurgar.push(dia - o.dia)
      }
    }
    const pendientes = objetos.filter((o) => !o.purgado && dias - o.dia > retencion).length
    return { pendientes, edadesAlPurgar, total: objetos.length }
  }

  const porDefecto = simular({ maxBorrado: MAX_BORRADO_POR_DEFECTO })
  assert.strictEqual(porDefecto.pendientes, 0, 'con el tope por defecto no queda cola pendiente')
  assert.ok(porDefecto.edadesAlPurgar.length > 0)
  assert.ok(
    porDefecto.edadesAlPurgar.every((edad) => edad > 90),
    'ninguna copia con menos de 90 días se purga'
  )

  const insuficiente = simular({ maxBorrado: 10 })
  assert.ok(insuficiente.pendientes >= 90, `con tope 10 la cola no converge (pendientes=${insuficiente.pendientes})`)
  assert.ok(insuficiente.edadesAlPurgar.every((edad) => edad > 90))
})

test('A5/8: el patrón raíz no alcanza heredado (rclone real; se omite si no está)', (t) => {
  const bin = process.env.RCLONE_BIN || 'rclone'
  const sonda = spawnSync(bin, ['version'], { encoding: 'utf8' })
  if (sonda.error || sonda.status !== 0) return t.skip('rclone no está disponible en este entorno')

  const raiz = dirTemporal('a5-filtro-')
  fs.mkdirSync(path.join(raiz, 'heredado'))
  fs.writeFileSync(path.join(raiz, 'iva_mensual_2026-10-20T03-00-03.db.enc'), 'a')
  fs.writeFileSync(path.join(raiz, 'iva_mensual_2026-10-20T03-00-03.manifest.json'), 'b')
  fs.writeFileSync(path.join(raiz, 'heredado', 'iva_mensual_2026-10-02T18-17-40.db.enc'), 'c')

  const anclado = spawnSync(bin, ['ls', raiz, '--include', PATRON_RETENCION], { encoding: 'utf8' })
  assert.strictEqual(anclado.status, 0, anclado.stderr)
  assert.match(anclado.stdout, /iva_mensual_2026-10-20T03-00-03\.db\.enc/)
  assert.ok(!anclado.stdout.includes('heredado/'), 'heredado queda fuera de la purga')

  const sinAncla = spawnSync(bin, ['ls', raiz, '--include', 'iva_mensual_*'], { encoding: 'utf8' })
  assert.match(sinAncla.stdout, /heredado\/iva_mensual/, 'sin la barra el patrón sí alcanza el subdirectorio')
})

/* ---------------------------- auditoría remota ---------------------------- */

test('A5/9: la auditoría remota detecta sellos incompletos, huérfanos y faltantes', () => {
  const completo = analizarObjetosRemotos(LISTADO_COMPLETO)
  assert.strictEqual(completo.ok, true)
  assert.strictEqual(completo.sellos, 1)
  assert.strictEqual(completo.objetosRaiz, 3)

  const sinManifiesto = analizarObjetosRemotos(
    JSON.stringify([
      { Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' },
      { Path: 'iva_mensual_2026-10-25T03-00-03.sha256' },
    ])
  )
  assert.strictEqual(sinManifiesto.ok, false)
  assert.deepStrictEqual(sinManifiesto.noRestaurables[0].falta, ['.manifest.json'])

  const huerfano = analizarObjetosRemotos(
    JSON.stringify([
      { Path: 'iva_mensual_2026-10-25T03-00-03.manifest.json' },
      { Path: 'iva_mensual_2026-10-25T03-00-03.sha256' },
    ])
  )
  assert.strictEqual(huerfano.ok, false)
  assert.strictEqual(huerfano.huerfanos.length, 2, 'los dos objetos sin .db.enc son huérfanos')
  assert.deepStrictEqual(huerfano.noRestaurables[0].falta, ['.db.enc'])

  const incompleto = analizarObjetosRemotos(
    JSON.stringify([
      { Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' },
      { Path: 'iva_mensual_2026-10-25T03-00-03.manifest.json' },
    ])
  )
  assert.strictEqual(incompleto.ok, false)
  assert.deepStrictEqual(incompleto.incompletos[0].falta, ['.sha256'])

  const conHeredado = analizarObjetosRemotos(
    JSON.stringify([
      { Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' },
      { Path: 'iva_mensual_2026-10-25T03-00-03.manifest.json' },
      { Path: 'iva_mensual_2026-10-25T03-00-03.sha256' },
      { Path: 'heredado/iva_mensual_2026-10-02T18-17-40.db.enc' },
    ])
  )
  assert.strictEqual(conHeredado.ok, true, 'heredado no se juzga en la rotación diaria')
  assert.strictEqual(conHeredado.heredado, 1)

  const faltaLocal = analizarObjetosRemotos(LISTADO_COMPLETO, { locales: ['iva_mensual_2026-10-26T03-00-03.db.enc'] })
  assert.strictEqual(faltaLocal.ok, false)
  assert.strictEqual(faltaLocal.faltantes.length, 1)

  assert.throws(() => analizarObjetosRemotos('<html>error</html>'), /JSON válido/)
  assert.throws(() => analizarObjetosRemotos('{"no":"array"}'), /array/)
})

/* -------------------------------- estimación ------------------------------- */

test('A5/10: estimación con los tamaños reales del VPS (25-oct)', () => {
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
})

/* ----------------------------------- CLI ---------------------------------- */

test('A5/11: el CLI en dry-run imprime los pasos completos y no ejecuta rclone', () => {
  const salida = execFileSync(
    process.execPath,
    ['scripts/respaldo-r2.js', '--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--bin', 'rclone-que-no-existe'],
    { cwd: ROOT, encoding: 'utf8' }
  )
  assert.match(salida, /destino: jmv-r2:jmv-backups\/iva-mensual/)
  assert.match(salida, /DRY-RUN/)
  assert.match(salida, /rclone-que-no-existe copy/)
  assert.match(salida, /rclone-que-no-existe check/)
  assert.match(salida, /rclone-que-no-existe lsjson/)
  assert.match(salida, /--min-age 90d/)
  assert.match(salida, /rclone-que-no-existe delete .*--files-from-raw/)
  assert.ok(!salida.includes('--max-delete'), 'el dry-run no debe proponer el tope que cuelga')
  assert.match(salida, /nada ejecutado/)
  assert.ok(!salida.includes('ejecutando'), 'en dry-run no se lanza ningún comando')
})

test('A5/12: el CLI rechaza el remoto ajeno y la configuración incompleta (exit 2)', () => {
  const casos = [
    ['--remoto', 'gdrive_johan', '--bucket', 'jmv-backups'],
    ['--remoto', 'jmv-r2'],
    ['--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--dias', '3'],
    ['--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--max-borrado', '10'],
  ]
  for (const args of casos) {
    const r = cliR2(args)
    assert.strictEqual(r.status, 2, `esperaba exit 2 para ${args.join(' ')}`)
    assert.match(r.stderr, /ERROR/)
  }
})

test('A5/13: --ejecutar corre los pasos en orden y verifica el remoto tras purgar', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas, llamadasCompletas } = stubRclone([
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: '[]', veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.deepStrictEqual(
    llamadas().map((l) => l.split(' | ')[0]),
    ['copy', 'copy', 'check', 'lsjson', 'lsjson', 'delete', 'lsjson']
  )
  assert.match(r.stdout, /auditoría remota: 1 sellos/)
  assert.match(r.stdout, /inventario de purga: 3 objetos elegibles, 1 sellos completos/)
  assert.match(r.stdout, /verificación posterior: 3 objetos borrados/)
  assert.match(r.stdout, /OK: copia, verificación, auditoría, purga y comprobación posterior completadas/)

  const purga = llamadasCompletas().find((argv) => argv[0] === 'delete')
  assert.ok(purga.includes('--files-from-raw'))
  const rutaLista = purga[purga.indexOf('--files-from-raw') + 1]
  assert.ok(path.isAbsolute(rutaLista))
  assert.strictEqual(fs.existsSync(rutaLista), false, 'la lista de purga se borra al terminar')
})

test('A5/14: si falla cualquier paso, sale 1 y NO se ejecuta la purga', () => {
  const casos = [
    { nombre: 'copia inicial', reglas: [{ comando: 'copy', contiene: 'backups', status: 3 }], ultimo: 'copy' },
    { nombre: 'copia del heredado', reglas: [{ comando: 'copy', contiene: 'heredado', status: 3 }], ultimo: 'copy' },
    { nombre: 'verificación', reglas: [{ comando: 'check', status: 3 }], ultimo: 'check' },
    { nombre: 'auditoría', reglas: [{ comando: 'lsjson', argsNoContiene: ['--min-age'], status: 3 }], ultimo: 'lsjson' },
    {
      nombre: 'inventario',
      reglas: [
        { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
        { comando: 'lsjson', argsContiene: ['--min-age'], status: 3 },
      ],
      ultimo: 'lsjson',
    },
  ]
  for (const caso of casos) {
    const entorno = entornoOrigen()
    const { stub, llamadas } = stubRclone(caso.reglas)
    const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
    assert.strictEqual(r.status, 1, `${caso.nombre}: esperaba exit 1`)
    const nombres = llamadas().map((l) => l.split(' | ')[0])
    assert.strictEqual(nombres[nombres.length - 1], caso.ultimo, `${caso.nombre}: no debe seguir después del fallo`)
    assert.ok(!nombres.includes('delete'), `${caso.nombre}: la purga nunca corre tras un fallo`)
  }
})

test('A5/15: si el remoto tiene copias no restaurables, sale 1 y no purga', () => {
  const entorno = entornoOrigen()
  const sinManifiesto = JSON.stringify([
    { Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' },
    { Path: 'iva_mensual_2026-10-25T03-00-03.sha256' },
  ])
  const { stub, llamadas } = stubRclone([{ comando: 'lsjson', stdout: sinManifiesto }])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1)
  assert.match(r.stdout, /NO RESTAURABLE/)
  assert.ok(!llamadas().map((l) => l.split(' | ')[0]).includes('delete'))
  assert.match(r.stderr, /se detiene ANTES de purgar/)
})

test('A5/16: fallo al lanzar rclone (binario inexistente) → exit 1 con mensaje', () => {
  const entorno = entornoOrigen()
  const r = cliR2([...argumentosBase(entorno), '--bin', path.join(entorno.dir, 'no-existe-rclone'), '--ejecutar'])
  assert.strictEqual(r.status, 1)
  assert.match(r.stderr, /no se pudo lanzar/)
})

test('A5/17: --estimar mide la purga y falla con exit 2 si no hay copias', () => {
  const entorno = entornoOrigen()
  const r = cliR2([...argumentosBase(entorno), '--estimar'])
  assert.strictEqual(r.status, 0, r.stderr)
  assert.match(r.stdout, /estimación:/)
  assert.match(r.stdout, /purga: 21 objetos\/corrida/)
  assert.match(r.stdout, /converge/)

  const vacio = entornoOrigen({ conCopia: false })
  const sinCopias = cliR2([...argumentosBase(vacio), '--estimar'])
  assert.strictEqual(sinCopias.status, 2)
  assert.match(sinCopias.stderr, /no hay copias/)
})

test('A5/18 (F-03): --solo retencion-remota ejecuta el preflight y luego purga', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: '[]', veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--solo', 'retencion-remota', '--ejecutar'], { stub })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.deepStrictEqual(
    llamadas().map((l) => l.split(' | ')[0]),
    ['check', 'lsjson', 'lsjson', 'delete', 'lsjson'],
    'sin verificación, auditoría e inventario no hay purga'
  )
  assert.match(r.stdout, /auditoría remota/)
  assert.match(r.stdout, /inventario de purga/)
})

test('A5/19: si la purga falla, sale 1 y se revisa el estado que dejó', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'delete', status: 7 },
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: '[]', veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1)
  assert.match(r.stderr, /retencion-remota falló con código 7/)
  assert.match(r.stderr, /estado posterior coherente/)
  assert.deepStrictEqual(llamadas().map((l) => l.split(' | ')[0]), [
    'copy',
    'copy',
    'check',
    'lsjson',
    'lsjson',
    'delete',
    'lsjson',
  ])

  // Fallo a mitad de borrado: el remoto queda con un sello partido y hay que decirlo.
  const entorno2 = entornoOrigen()
  const parcial = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'delete', status: 7 },
    {
      comando: 'lsjson',
      argsNoContiene: ['--min-age'],
      stdout: JSON.stringify([{ Path: 'iva_mensual_2026-10-25T03-00-03.manifest.json' }]),
      veces: 1,
    },
  ])
  const r2 = cliR2([...argumentosBase(entorno2), '--ejecutar'], { stub: parcial.stub })
  assert.strictEqual(r2.status, 1)
  assert.match(r2.stderr, /PURGA INCOHERENTE/)
  assert.match(r2.stderr, /partidos/)
})

test('A5/20: la verificación detecta manifiesto ausente o alterado (rclone real)', (t) => {
  const bin = process.env.RCLONE_BIN || 'rclone'
  const sonda = spawnSync(bin, ['version'], { encoding: 'utf8' })
  if (sonda.error || sonda.status !== 0) return t.skip('rclone no está disponible en este entorno')

  const raiz = dirTemporal('a5-check-')
  const origen = path.join(raiz, 'origen')
  const destino = path.join(raiz, 'destino')
  fs.mkdirSync(origen)
  fs.mkdirSync(destino)
  const nombres = [
    'iva_mensual_2026-10-25T03-00-03.db.enc',
    'iva_mensual_2026-10-25T03-00-03.manifest.json',
    'iva_mensual_2026-10-25T03-00-03.sha256',
  ]
  for (const n of nombres) {
    fs.writeFileSync(path.join(origen, n), `contenido-${n}`)
    fs.writeFileSync(path.join(destino, n), `contenido-${n}`)
  }
  const verificar = () =>
    spawnSync(bin, ['check', origen, destino, '--one-way', '--checksum', '--include', '*.db.enc', '--include', '*.manifest.json', '--include', '*.sha256'], {
      encoding: 'utf8',
    })

  assert.strictEqual(verificar().status, 0, 'con los tres objetos iguales la verificación pasa')

  // Manifiesto ausente en el remoto: el .enc se verifica solo, pero el manifest no está.
  fs.rmSync(path.join(destino, 'iva_mensual_2026-10-25T03-00-03.manifest.json'))
  assert.strictEqual(verificar().status, 1, 'un manifiesto ausente debe fallar la verificación')
  fs.writeFileSync(path.join(destino, 'iva_mensual_2026-10-25T03-00-03.manifest.json'), 'contenido-iva_mensual_2026-10-25T03-00-03.manifest.json')

  // Mismo tamaño, contenido distinto: solo el hash lo detecta.
  const alterado = fs.readFileSync(path.join(origen, 'iva_mensual_2026-10-25T03-00-03.manifest.json'))
  const distinto = Buffer.from(alterado)
  distinto[0] = distinto[0] === 0x61 ? 0x62 : 0x61
  fs.writeFileSync(path.join(destino, 'iva_mensual_2026-10-25T03-00-03.manifest.json'), distinto)
  assert.strictEqual(verificar().status, 1, 'un hash distinto debe fallar aunque el tamaño coincida')
})

/* ---------------------- regresiones F-01 / F-02 / F-03 ---------------------- */

test('A5/21 (F-02): la purga exige sellos completos y rechaza lo que excede el tope', () => {
  const sellos = (n) => Array.from({ length: n }, (_, i) => selloViejo(i + 1))
  const treinta = analizarPurga(JSON.stringify(objetosSellos(sellos(10))), { maxBorrado: 6 })
  assert.strictEqual(treinta.ok, false, 'con más elegibles que el tope no se borra nada')
  assert.strictEqual(treinta.borrar.length, 30, 'se informa el total exacto, no se trunca en silencio')
  assert.strictEqual(treinta.completos.length, 10)
  assert.match(treinta.problemas.join(' '), /30 objetos/)
  assert.match(treinta.problemas.join(' '), /no se borra nada/)
  assert.match(treinta.problemas.join(' '), /--max-borrado a 30/)

  const ochenta = analizarPurga(JSON.stringify(objetosSellos(sellos(28))), { maxBorrado: MAX_BORRADO_POR_DEFECTO })
  assert.strictEqual(ochenta.borrar.length, 84, 'el caso 84 elegibles / tope 63')
  assert.strictEqual(ochenta.ok, false)
  assert.match(ochenta.problemas.join(' '), /84 objetos/)

  const justo = analizarPurga(JSON.stringify(objetosSellos(sellos(7))), { maxBorrado: 21 })
  assert.strictEqual(justo.ok, true, justo.problemas.join(' | '))
  assert.strictEqual(justo.borrar.length, 21)
  for (const nombre of justo.borrar) assert.match(nombre, /\.(db\.enc|manifest\.json|sha256)$/)
  assert.strictEqual(new Set(justo.borrar.map((n) => n.replace(/\.(db\.enc|manifest\.json|sha256)$/, ''))).size, 7)

  const media = analizarPurga(
    JSON.stringify([{ Path: `${selloViejo(1)}.db.enc` }, { Path: `${selloViejo(1)}.manifest.json` }])
  )
  assert.strictEqual(media.ok, false, 'borrar media copia la dejaría irrestaurable')
  assert.strictEqual(media.parciales.length, 1)
  assert.match(media.problemas.join(' '), /a medias/)
  assert.deepStrictEqual(media.borrar, [])

  const conHeredado = analizarPurga(
    JSON.stringify([...objetosSello(selloViejo(1)), { Path: `heredado/${selloViejo(2)}.db.enc` }])
  )
  assert.strictEqual(conHeredado.ok, false, 'un objeto de subdirectorio bloquea la purga entera')
  assert.strictEqual(conHeredado.borrar.length, 3)
  assert.ok(!conHeredado.borrar.some((n) => n.includes('/')), 'heredado nunca entra en la lista')

  const vacio = analizarPurga('')
  assert.strictEqual(vacio.ok, true)
  assert.deepStrictEqual(vacio.borrar, [])

  const ajeno = analizarPurga(JSON.stringify([{ Path: 'iva_mensual_2026-07-01T03-00-03.txt' }]))
  assert.strictEqual(ajeno.ok, true, 'un objeto desconocido no bloquea, pero tampoco se borra')
  assert.deepStrictEqual(ajeno.borrar, [])
  assert.deepStrictEqual(ajeno.ignorados, ['iva_mensual_2026-07-01T03-00-03.txt'])

  assert.throws(() => analizarPurga('<html>error</html>'), /JSON válido/)
})

test('A5/22 (F-02): la comprobación posterior detecta sellos partidos y objetos perdidos', () => {
  const sellos = [objetosSello(selloViejo(1)), objetosSello(selloViejo(2))]
  const antes = JSON.stringify(sellos.flat())
  const borrados = sellos[0].map((o) => o.Path)

  const esperado = verificarPurga({ antes, despues: JSON.stringify(sellos[1]), borrados })
  assert.strictEqual(esperado.ok, true, esperado.problemas.join(' | '))
  assert.strictEqual(esperado.borrados, 3)
  assert.strictEqual(esperado.sellos, 1)

  const partido = verificarPurga({ antes, despues: JSON.stringify(sellos[1].slice(1)), borrados })
  assert.strictEqual(partido.ok, false)
  assert.match(partido.problemas.join(' '), /partidos/)

  const siguen = verificarPurga({ antes, despues: antes, borrados })
  assert.strictEqual(siguen.ok, false)
  assert.match(siguen.problemas.join(' '), /siguen en el remoto/)

  const perdido = verificarPurga({ antes, despues: '[]', borrados })
  assert.strictEqual(perdido.ok, false)
  assert.match(perdido.problemas.join(' '), /desaparecieron/)

  assert.throws(() => verificarPurga({ antes: '{"no":"array"}', despues: '[]' }), /arrays/)
})

test('A5/23 (F-01): 30 elegibles con tope 6 → sale 1 y no lanza delete', () => {
  const entorno = entornoOrigen()
  const viejos = Array.from({ length: 10 }, (_, i) => selloViejo(i + 1))
  const auditoria = JSON.stringify(objetosSellos(['iva_mensual_2026-10-25T03-00-03', ...viejos]))
  const inventario = JSON.stringify(objetosSellos(viejos))
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: auditoria, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: inventario, veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--cada-dias', '1', '--max-borrado', '6', '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /inventario de purga: 30 objetos elegibles/)
  assert.match(r.stderr, /purga abortada/)
  assert.ok(!llamadas().some((l) => l.startsWith('delete')), 'no se borra nada cuando supera el tope')
})

test('A5/24 (F-01): 84 elegibles con el tope por defecto (63) → sale 1 y no lanza delete', () => {
  const entorno = entornoOrigen()
  const viejos = Array.from({ length: 28 }, (_, i) => selloViejo(i + 1))
  const auditoria = JSON.stringify(objetosSellos(['iva_mensual_2026-10-25T03-00-03', ...viejos]))
  const inventario = JSON.stringify(objetosSellos(viejos))
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: auditoria, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: inventario, veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /84 objetos elegibles/)
  assert.match(r.stdout, /tope 63/)
  assert.ok(!llamadas().some((l) => l.startsWith('delete')))
})

test('A5/25 (F-02): sin objetos elegibles no hay delete y la cuenta cierra en 0', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: '[]', veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.match(r.stdout, /no hay objetos elegibles fuera de retención/)
  assert.deepStrictEqual(llamadas().map((l) => l.split(' | ')[0]), ['copy', 'copy', 'check', 'lsjson', 'lsjson'])
})

test('A5/26 (F-01): un rclone que no termina se corta por timeout y no se purga', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'delete', error: 'ETIMEDOUT' },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1)
  assert.match(r.stderr, /se agotó el tiempo/)
  const nombres = llamadas().map((l) => l.split(' | ')[0])
  assert.strictEqual(nombres.filter((n) => n === 'delete').length, 1, 'no se reintenta el borrado')
  assert.strictEqual(nombres.at(-1), 'lsjson', 'tras el timeout se revisa el estado que quedó')

  const enPreflight = stubRclone([{ comando: 'check', error: 'ETIMEDOUT' }])
  const otro = entornoOrigen()
  const r2 = cliR2([...argumentosBase(otro), '--ejecutar'], { stub: enPreflight.stub })
  assert.strictEqual(r2.status, 1)
  assert.match(r2.stderr, /se agotó el tiempo/)
  assert.ok(!enPreflight.llamadas().some((l) => l.startsWith('delete')))
})

test('A5/27 (F-02): si la purga deja un sello partido, sale 1 en vez de darla por buena', () => {
  const entorno = entornoOrigen()
  const { stub, llamadas } = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    {
      comando: 'lsjson',
      argsNoContiene: ['--min-age'],
      stdout: JSON.stringify([{ Path: 'iva_mensual_2026-10-25T03-00-03.db.enc' }]),
      veces: 1,
    },
  ])
  const r = cliR2([...argumentosBase(entorno), '--ejecutar'], { stub })
  assert.strictEqual(r.status, 1)
  assert.match(r.stderr, /PURGA INCOHERENTE/)
  assert.match(r.stderr, /partidos/)
  assert.strictEqual(llamadas().map((l) => l.split(' | ')[0]).at(-1), 'lsjson')
})

test('A5/28 (F-01): dos corridas no se solapan y un lock residual no bloquea para siempre', () => {
  const entorno = entornoOrigen()
  const lock = path.join(entorno.dir, 'lock-r2.txt')
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, inicio: new Date().toISOString() }))

  const primero = stubRclone()
  const bloqueado = cliR2([...argumentosBase(entorno), '--lock', lock, '--ejecutar'], { stub: primero.stub })
  assert.strictEqual(bloqueado.status, 1)
  assert.match(bloqueado.stderr, /otra ejecución en curso/)
  assert.deepStrictEqual(primero.llamadas(), [], 'con el lock tomado no se lanza ningún rclone')
  assert.ok(fs.existsSync(lock), 'el lock de la corrida viva no se toca')

  fs.writeFileSync(lock, JSON.stringify({ pid: 999999, inicio: new Date(0).toISOString() }))
  fs.utimesSync(lock, new Date(), new Date(Date.now() - 13 * 3600 * 1000))
  const segundo = stubRclone([
    { comando: 'lsjson', argsNoContiene: ['--min-age'], stdout: LISTADO_COMPLETO, veces: 1 },
    { comando: 'lsjson', argsContiene: ['--min-age'], stdout: '[]', veces: 1 },
  ])
  const r = cliR2([...argumentosBase(entorno), '--lock', lock, '--ejecutar'], { stub: segundo.stub })
  assert.strictEqual(r.status, 0, r.stderr)
  assert.match(r.stdout, /lock residual/)
  assert.strictEqual(fs.existsSync(lock), false, 'al terminar, el lock se libera')
})

test('A5/29 (F-03): --solo retencion-remota en dry-run muestra el preflight completo', () => {
  const r = cliR2(['--remoto', 'jmv-r2', '--bucket', 'jmv-backups', '--solo', 'retencion-remota'])
  assert.strictEqual(r.status, 0, r.stderr)
  for (const nombre of ['verificacion-espejo', 'auditoria-remota', 'inventario-purga', 'retencion-remota', 'verificacion-purga']) {
    assert.match(r.stdout, new RegExp(`# ${nombre} —`), `falta ${nombre} en el plan de purga`)
  }
  assert.ok(!r.stdout.includes('copia-backups'), 'la purga no arrastra la copia')
})
