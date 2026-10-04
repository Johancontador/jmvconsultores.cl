/**
 * Restauración VERIFICADA de backups (BLOQUE 1bis — P6).
 *
 * Flujo: manifest → SHA-256 del archivo → descifrado → SHA-256 del original
 * → escritura en destino AISLADO → PRAGMA integrity_check → conteos de
 * tablas críticas → verificación de que las claves SII v1: descifran.
 * NUNCA imprime secretos (solo conteos y estados). NUNCA toca la BD real.
 *
 * Módulo puro: recibe rutas/clave/fn de descifrado como parámetros.
 */

const fs = require('fs')
const path = require('path')

const TABLAS_CRITICAS = [
  'users', 'empresas', 'clientes', 'auditoria', 'asientos', 'asiento_lineas',
  'documentos', 'periodos_contables', 'bancos_cuentas', 'suscripciones',
]

/**
 * Restaura y verifica un backup. Devuelve un reporte (sin secretos).
 * @param {object} p
 *  - rutaBackup:     ruta del .db.enc o .db
 *  - dirDestino:     carpeta AISLADA donde escribir la copia restaurada
 *  - claveBackup:    valor de BACKUP_ENCRYPTION_KEY (o null si no cifrado)
 *  - descifrarSii:   fn(v1:string)→clave real (boveda.descifrar) o null
 *  - nombreDestino:  nombre del archivo restaurado (default iva_mensual_restaurada.db)
 */
function restaurar(p) {
  const rutaBackup = String(p.rutaBackup || '')
  const dirDestino = String(p.dirDestino || '')
  if (!fs.existsSync(rutaBackup)) throw new Error(`Backup no encontrado: ${rutaBackup}`)
  if (!dirDestino) throw new Error('dirDestino es obligatorio (entorno de restauración aislado)')

  // 1) Manifest + SHA-256 del archivo
  const rutaManifest = rutaBackup.replace(/\.(db\.enc|db)$/, '.manifest.json')
  if (!fs.existsSync(rutaManifest)) throw new Error(`Manifest no encontrado: ${rutaManifest}`)
  const manifest = JSON.parse(fs.readFileSync(rutaManifest, 'utf8'))
  if (!manifest.archivo || !manifest.sha256) throw new Error('Manifest incompleto (falta archivo o sha256)')

  const cifrador = require('./backup-cifrado')
  const enc = fs.readFileSync(rutaBackup)
  const shaArchivo = cifrador.sha256Buffer(enc)
  if (shaArchivo !== manifest.sha256) {
    throw new Error(`Integridad del archivo FALLIDA: sha256 real ${shaArchivo} ≠ manifest ${manifest.sha256}`)
  }

  // 2) Descifrado si corresponde + verificación del sha256 del ORIGINAL
  let plano
  if (cifrador.esBackupCifrado(enc)) {
    if (!p.claveBackup) throw new Error('El backup está cifrado y BACKUP_ENCRYPTION_KEY no fue provista')
    plano = cifrador.descifrarBuffer(enc, p.claveBackup)
    if (manifest.sha256_original && cifrador.sha256Buffer(plano) !== manifest.sha256_original) {
      throw new Error('El contenido descifrado NO coincide con el sha256 original del manifest')
    }
  } else {
    plano = enc
    if (manifest.cifrado) throw new Error('El manifest dice cifrado pero el archivo no lo está')
  }

  // 3) Escritura en el entorno aislado
  fs.mkdirSync(dirDestino, { recursive: true })
  const destino = path.join(dirDestino, p.nombreDestino || 'iva_mensual_restaurada.db')
  fs.writeFileSync(destino, plano)

  // 4) Integridad SQLite + conteos de tablas críticas
  const Database = require('better-sqlite3')
  const db = new Database(destino, { readonly: true })
  let integrity = null
  try {
    integrity = db.pragma('integrity_check', { simple: true })
  } catch (e) {
    integrity = `ERROR: ${e.message}`
  }

  const tablas = {}
  for (const tabla of TABLAS_CRITICAS) {
    const existe = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tabla)
    tablas[tabla] = existe ? db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n : 'inexistente'
  }

  // 5) Claves SII v1: deben descifrar con la clave maestra vigente
  const claves = { clientes_v1: 0, empresas_v1: 0, descifrables: 0, error: null }
  if (typeof p.descifrarSii === 'function') {
    try {
      const filasC = db.prepare(`SELECT id, clave_sii FROM clientes WHERE clave_sii LIKE 'v1:%'`).all()
      const filasE = db.prepare(`SELECT id, clave_sii FROM empresas WHERE clave_sii LIKE 'v1:%'`).all()
      claves.clientes_v1 = filasC.length
      claves.empresas_v1 = filasE.length
      for (const f of [...filasC, ...filasE]) {
        const v = p.descifrarSii(f.clave_sii)
        if (!v || v.startsWith('v1:')) throw new Error(`clave de registro id=${f.id} no descifra a valor real`)
        claves.descifrables++
      }
    } catch (e) {
      claves.error = e.message
    }
  }
  db.close()

  const ok = integrity === 'ok' && !claves.error
  return { ok, destino, manifest: { creado_en: manifest.creado_en, cifrado: !!manifest.cifrado, formato: manifest.formato }, integrity, tablas, claves }
}

module.exports = { restaurar, TABLAS_CRITICAS }
