'use strict'
/**
 * F5-C — VIGILANCIA DE BACKUPS: frescura e integridad.
 *
 * El cron del VPS estuvo 7 noches sin generar backup (2026-10-10 → 16) sin que
 * nada avisara. Este módulo + CLI permiten que un monitor (cron, systemd,
 * alerta externa) detecte: no hay copias, la última es vieja, falta el
 * manifest, el archivo no coincide o está alterado.
 *
 * Todo se prueba con directorios temporales y archivos ficticios: no se usa la
 * BD real ni se descifra nada.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { evaluar, listarCopias, resumenTexto } = require('../backend/core/backup-vigilancia')
const cifrador = require('../backend/core/backup-cifrado')

const ROOT = path.resolve(__dirname, '..')
const dirs = []

function dirTemporal() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'f5-backup-'))
  dirs.push(d)
  return d
}

test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

/** Crea una copia ficticia con su manifest (contenido arbitrario, no cifrado real). */
function sembrar(dir, { stamp, contenido = 'contenido-ficticio-de-backup', cifrado = true, manifest = true, alterar = false } = {}) {
  const archivo = `iva_mensual_${stamp}.db${cifrado ? '.enc' : ''}`
  const ruta = path.join(dir, archivo)
  fs.writeFileSync(ruta, contenido)
  if (!manifest) return { ruta, archivo }
  const sha = cifrador.sha256Archivo(ruta)
  const m = {
    archivo,
    sha256: sha,
    tamano_bytes: fs.statSync(ruta).size,
    creado_en: new Date().toISOString(),
    formato: 'jmv-backup-v1',
    cifrado,
    base_datos: 'iva_mensual.db',
    secretos: 'ninguno',
  }
  fs.writeFileSync(ruta.replace(/\.(db|db\.enc)$/, '.manifest.json'), JSON.stringify(m, null, 2))
  if (alterar) {
    // Cambia un byte EN EL LUGAR: el tamaño se mantiene y solo el SHA-256 lo
    // delata (si se agregara un byte, también fallaría el control de tamaño).
    const buf = fs.readFileSync(ruta)
    buf[0] = buf[0] ^ 0xff
    fs.writeFileSync(ruta, buf)
  }
  return { ruta, archivo }
}

/** Stamp UTC del instante actual, en el formato del backup. */
function stampAhora(offsetHoras = 0) {
  return new Date(Date.now() - offsetHoras * 3600000).toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

test('F5-C/1: copia reciente e íntegra → ok', () => {
  const dir = dirTemporal()
  sembrar(dir, { stamp: stampAhora() })
  const r = evaluar({ dir })
  assert.strictEqual(r.estado, 'ok')
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.total, 1)
  assert.strictEqual(r.copia.cifrado, true)
  assert.ok(r.copia.horas >= 0 && r.copia.horas < 1)
  assert.deepStrictEqual(r.problemas, [])
})

test('F5-C/2: sin directorio / sin copias → estados distintos y accionables', () => {
  const inexistente = path.join(dirTemporal(), 'no-existe')
  assert.strictEqual(evaluar({ dir: inexistente }).estado, 'sin_directorio')
  const vacio = dirTemporal()
  const r = evaluar({ dir: vacio })
  assert.strictEqual(r.estado, 'ausente')
  assert.match(r.problemas[0], /No hay ninguna copia/)
  assert.match(resumenTexto(r), /SIN BACKUPS/)
})

test('F5-C/3: la copia más reciente es vieja → antiguo (con las horas medidas)', () => {
  const dir = dirTemporal()
  sembrar(dir, { stamp: stampAhora(30) })
  const r = evaluar({ dir, maxHoras: 26 })
  assert.strictEqual(r.estado, 'antiguo')
  assert.ok(r.copia.horas >= 29 && r.copia.horas <= 31, `horas=${r.copia.horas}`)
  assert.match(r.problemas[0], /límite 26 h/)
  // Con un límite más holgado, la misma copia es aceptable.
  assert.strictEqual(evaluar({ dir, maxHoras: 48 }).estado, 'ok')
})

test('F5-C/4: falta el manifest o el archivo → incompleto', () => {
  const sinManifest = dirTemporal()
  sembrar(sinManifest, { stamp: stampAhora(), manifest: false })
  const r1 = evaluar({ dir: sinManifest })
  assert.strictEqual(r1.estado, 'incompleto')
  assert.match(r1.problemas[0], /manifest/)

  const sinArchivo = dirTemporal()
  const { ruta } = sembrar(sinArchivo, { stamp: stampAhora() })
  fs.rmSync(ruta)
  const r2 = evaluar({ dir: sinArchivo })
  assert.strictEqual(r2.estado, 'incompleto')
  assert.match(r2.problemas.join(' '), /sin su archivo|el archivo no/)
})

test('F5-C/5: archivo alterado o manifest inválido → corrupto (no se declara recuperable)', () => {
  const alterado = dirTemporal()
  sembrar(alterado, { stamp: stampAhora(), alterar: true })
  const r1 = evaluar({ dir: alterado })
  assert.strictEqual(r1.estado, 'corrupto')
  assert.match(r1.problemas.join(' '), /SHA-256/)

  // Con hash:false el chequeo de contenido se omite (documentado: más rápido,
  // menos estricto) pero el resto se mantiene.
  assert.strictEqual(evaluar({ dir: alterado, hash: false }).estado, 'ok')

  const malJson = dirTemporal()
  const { ruta } = sembrar(malJson, { stamp: stampAhora() })
  fs.writeFileSync(ruta.replace(/\.(db|db\.enc)$/, '.manifest.json'), '{ roto')
  const r2 = evaluar({ dir: malJson })
  assert.strictEqual(r2.estado, 'corrupto')
  assert.match(r2.problemas[0], /JSON/)
})

test('F5-C/6: manifest que declara otro archivo → corrupto (manifest/archivo no coinciden)', () => {
  const dir = dirTemporal()
  const { ruta } = sembrar(dir, { stamp: stampAhora() })
  const rutaManifest = ruta.replace(/\.(db|db\.enc)$/, '.manifest.json')
  const m = JSON.parse(fs.readFileSync(rutaManifest, 'utf8'))
  m.archivo = 'iva_mensual_2020-01-01T03-00-00.db.enc'
  fs.writeFileSync(rutaManifest, JSON.stringify(m))
  const r = evaluar({ dir })
  assert.strictEqual(r.estado, 'corrupto')
  assert.match(r.problemas.join(' '), /declara/)
})

test('F5-C/7: ordena por stamp y no por mtime (varias copias)', () => {
  const dir = dirTemporal()
  const vieja = sembrar(dir, { stamp: stampAhora(72) })
  const nueva = sembrar(dir, { stamp: stampAhora(2) })
  // mtime "invertido": la vieja parece más reciente en el filesystem.
  const futuro = new Date(Date.now() + 3600000)
  fs.utimesSync(vieja.ruta, futuro, futuro)
  const copias = listarCopias(dir)
  assert.strictEqual(copias[0].archivo, nueva.archivo, 'la más reciente es la del stamp mayor')
  assert.strictEqual(evaluar({ dir }).estado, 'ok')
})

test('F5-C/8: el CLI devuelve 0 con backup sano y 1 con backup viejo (para el monitor)', () => {
  const sano = dirTemporal()
  sembrar(sano, { stamp: stampAhora() })
  const ok = execFileSync(process.execPath, ['scripts/verificar-backup.js', '--dir', sano, '--json'], { cwd: ROOT, encoding: 'utf8' })
  assert.strictEqual(JSON.parse(ok).estado, 'ok')

  const viejo = dirTemporal()
  sembrar(viejo, { stamp: stampAhora(100) })
  let salida = ''
  let codigo = 0
  try {
    execFileSync(process.execPath, ['scripts/verificar-backup.js', '--dir', viejo], { cwd: ROOT, encoding: 'utf8' })
  } catch (err) {
    codigo = err.status
    salida = String(err.stdout || '')
  }
  assert.strictEqual(codigo, 1, 'exit 1 cuando el backup no es aceptable')
  assert.match(salida, /ANTIGUO/)
})
