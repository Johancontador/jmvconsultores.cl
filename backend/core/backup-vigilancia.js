/**
 * F5-C — VIGILANCIA DE BACKUPS (módulo puro, sin BD y sin red).
 *
 * Responde la pregunta que ningún componente respondía: «¿el backup más
 * reciente existe, es reciente y está íntegro?». Antes de F5 el cron podía
 * fallar durante días sin que nadie se enterara (pasó del 2026-10-10 al
 * 2026-10-16: 7 noches sin backup) porque el único rastro era una línea en
 * `logs-backup.log`.
 *
 * Qué verifica, en orden:
 *   1. Que el directorio exista y tenga copias (`iva_mensual_<stamp>.db[.enc]`).
 *   2. Que la copia MÁS RECIENTE tenga su `manifest.json` (el restore lo exige).
 *   3. Que el archivo exista y su tamaño coincida con el manifest.
 *   4. Que el SHA-256 del archivo coincida con el manifest (opcional, `hash`).
 *   5. Que la copia no sea más vieja que `maxHoras`.
 *
 * La antigüedad se calcula con el STAMP DEL NOMBRE (UTC), no con el mtime: el
 * nombre es lo que el restore y la retención usan como verdad.
 *
 * NO cifra, NO descifra y NO imprime secretos: solo metadatos y conteos.
 */

const fs = require('fs')
const path = require('path')
const cifrador = require('./backup-cifrado')

const PATRON = /^iva_mensual_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})\.(db|db\.enc)$/
const ESTADOS = ['ok', 'sin_directorio', 'ausente', 'incompleto', 'corrupto', 'antiguo']

/** Lista las copias del directorio con su fecha (UTC) tomada del nombre. */
function listarCopias(dir) {
  if (!fs.existsSync(dir)) return []
  const copias = []
  for (const nombre of fs.readdirSync(dir)) {
    const m = nombre.match(PATRON)
    if (!m) continue
    const [, y, mo, d, h, mi, s, ext] = m
    const fecha = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
    if (Number.isNaN(fecha.getTime())) continue
    copias.push({ archivo: nombre, cifrado: ext === 'db.enc', fecha })
  }
  return copias.sort((a, b) => b.fecha - a.fecha)
}

/**
 * Evalúa la salud del respaldo.
 * @param {{dir:string, ahora?:Date, maxHoras?:number, hash?:boolean}} opciones
 * @returns {{estado:string, ok:boolean, problemas:string[], copia:object|null,
 *            total:number, maxHoras:number}}
 */
function evaluar({ dir, ahora = new Date(), maxHoras = 26, hash = true } = {}) {
  const base = { estado: 'ausente', ok: false, problemas: [], copia: null, total: 0, maxHoras }

  if (!dir) return { ...base, estado: 'sin_directorio', problemas: ['No se indicó directorio de backups'] }
  if (!fs.existsSync(dir)) {
    return { ...base, estado: 'sin_directorio', problemas: [`El directorio de backups no existe: ${dir}`] }
  }

  const copias = listarCopias(dir)
  if (!copias.length) {
    // Un manifest sin su archivo (o al revés) no es «no hay backups»: es un
    // backup ROTO y hay que nombrarlo así, no como ausencia.
    const manifiestos = fs.readdirSync(dir).filter((f) => /^iva_mensual_.+\.manifest\.json$/.test(f))
    if (manifiestos.length) {
      return {
        ...base,
        estado: 'incompleto',
        problemas: [`Hay ${manifiestos.length} manifest(s) sin su archivo de backup (p. ej. ${manifiestos[0]})`],
      }
    }
    return { ...base, estado: 'ausente', problemas: ['No hay ninguna copia iva_mensual_<stamp>.db[.enc] en el directorio'] }
  }

  const ultima = copias[0]
  const ruta = path.join(dir, ultima.archivo)
  const rutaManifest = ruta.replace(/\.(db|db\.enc)$/, '.manifest.json')
  const horas = (ahora.getTime() - ultima.fecha.getTime()) / 3600000
  const copia = {
    archivo: ultima.archivo,
    fecha: ultima.fecha.toISOString(),
    horas: Math.round(horas * 10) / 10,
    cifrado: ultima.cifrado,
  }
  const problemas = []

  if (!fs.existsSync(rutaManifest)) {
    return { ...base, estado: 'incompleto', copia, total: copias.length, problemas: [`Falta el manifest de la copia más reciente: ${path.basename(rutaManifest)}`] }
  }

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(rutaManifest, 'utf8'))
  } catch {
    return { ...base, estado: 'corrupto', copia, total: copias.length, problemas: ['El manifest no es JSON válido'] }
  }
  if (!manifest || !manifest.sha256 || !manifest.archivo) {
    return { ...base, estado: 'corrupto', copia, total: copias.length, problemas: ['El manifest está incompleto (falta archivo o sha256)'] }
  }
  if (manifest.archivo !== ultima.archivo) {
    problemas.push(`El manifest declara ${manifest.archivo} pero la copia es ${ultima.archivo}`)
  }
  if (Boolean(manifest.cifrado) !== ultima.cifrado) {
    problemas.push('El manifest y el nombre del archivo no coinciden en si está cifrado')
  }
  if (!fs.existsSync(ruta)) {
    return { ...base, estado: 'incompleto', copia, total: copias.length, problemas: [...problemas, 'El manifest existe pero el archivo no'] }
  }
  const tamano = fs.statSync(ruta).size
  if (manifest.tamano_bytes && tamano !== manifest.tamano_bytes) {
    problemas.push(`El tamaño no coincide: archivo ${tamano} B vs manifest ${manifest.tamano_bytes} B`)
  }
  if (hash) {
    const real = cifrador.sha256Archivo(ruta)
    if (real !== manifest.sha256) problemas.push('El SHA-256 del archivo no coincide con el manifest (archivo alterado o copia incompleta)')
  }

  if (problemas.length) {
    return { ...base, estado: 'corrupto', copia, total: copias.length, problemas }
  }
  if (horas > maxHoras) {
    return {
      ...base,
      estado: 'antiguo',
      copia,
      total: copias.length,
      problemas: [`La copia más reciente tiene ${copia.horas} h (límite ${maxHoras} h)`],
    }
  }
  return { ...base, estado: 'ok', ok: true, copia, total: copias.length, problemas: [] }
}

function resumenTexto(r) {
  const cabecera = {
    ok: 'OK',
    sin_directorio: 'SIN DIRECTORIO',
    ausente: 'SIN BACKUPS',
    incompleto: 'INCOMPLETO',
    corrupto: 'CORRUPTO',
    antiguo: 'ANTIGUO',
  }[r.estado] || r.estado.toUpperCase()
  const partes = [`[BACKUP-CHECK] ${cabecera}`]
  if (r.copia) partes.push(`última=${r.copia.archivo} (${r.copia.horas} h, ${r.copia.cifrado ? 'cifrada' : 'SIN CIFRAR'}, total ${r.total})`)
  for (const p of r.problemas) partes.push(`- ${p}`)
  return partes.join(' ')
}

module.exports = { PATRON, ESTADOS, listarCopias, evaluar, resumenTexto }
