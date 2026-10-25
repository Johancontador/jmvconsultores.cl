/**
 * Restauración VERIFICADA de backups (BLOQUE 1bis — P6).
 *
 * Flujo: manifest → SHA-256 del archivo → descifrado → SHA-256 del original →
 * escritura en un TEMPORAL del destino → PRAGMA integrity_check →
 * PRAGMA foreign_key_check → conteos de tablas críticas → claves SII v1 →
 * publicación atómica (rename) SOLO si todo pasó.
 *
 * GARANTÍAS DESTRUCTIVAS
 *  1. Nunca escribe sobre la base ACTIVA: si `destino` coincide con `dbPathActivo`
 *     (DB_PATH), aborta antes de leer nada.
 *  2. Nunca reemplaza un archivo existente sin `sobrescribir:true` explícito.
 *  3. Cualquier fallo (hash, descifrado, integridad, FK, claves) deja el destino
 *     INTACTO: lo escrito vive en un temporal con nombre oculto y prefijo `.`,
 *     con permiso 0600, que se borra al salir.
 *  4. Una base inválida (`integrity_check` o `foreign_key_check` no satisfactorios)
 *     no se publica jamás.
 *
 * NUNCA imprime secretos (solo conteos y estados).
 * Módulo puro: recibe rutas/clave/fn de descifrado como parámetros.
 */

const fs = require('fs')
const path = require('path')

const TABLAS_CRITICAS = [
  'users', 'empresas', 'clientes', 'auditoria', 'asientos', 'asiento_lineas',
  'documentos', 'periodos_contables', 'bancos_cuentas', 'suscripciones',
]

/** ¿Dos rutas apuntan al mismo archivo, aunque una no exista todavía? */
function mismaRuta(a, b) {
  if (!a || !b) return false
  const normalizar = (ruta) => {
    let absoluta = path.resolve(ruta)
    try {
      absoluta = fs.realpathSync.native ? fs.realpathSync.native(absoluta) : fs.realpathSync(absoluta)
    } catch {
      // La ruta puede no existir aún: basta con la resolución léxica.
    }
    return process.platform === 'win32' ? absoluta.toLowerCase() : absoluta
  }
  return normalizar(a) === normalizar(b)
}

/**
 * Restaura y verifica un backup. Devuelve un reporte (sin secretos).
 * @param {object} p
 *  - rutaBackup:     ruta del .db.enc o .db
 *  - dirDestino:     carpeta AISLADA donde escribir la copia restaurada
 *  - claveBackup:    valor de BACKUP_ENCRYPTION_KEY (o null si no cifrado)
 *  - descifrarSii:   fn(v1:string)→clave real (boveda.descifrar) o null
 *  - nombreDestino:  nombre del archivo restaurado (default iva_mensual_restaurada.db)
 *  - sobrescribir:   true para reemplazar un destino YA existente (default: rechazar)
 *  - dbPathActivo:   ruta de la BD en uso (DB_PATH); si coincide con el destino, aborta
 * @returns {{ok:boolean, publicado:boolean, destino:string, integrity:string|null,
 *            foreignKey:object, tablas:object, claves:object}}
 */
function restaurar(p) {
  const rutaBackup = String(p.rutaBackup || '')
  const dirDestino = String(p.dirDestino || '')
  if (!fs.existsSync(rutaBackup)) throw new Error(`Backup no encontrado: ${rutaBackup}`)
  if (!dirDestino) throw new Error('dirDestino es obligatorio (entorno de restauración aislado)')

  const nombreDestino = String(p.nombreDestino || 'iva_mensual_restaurada.db')
  const destino = path.resolve(dirDestino, nombreDestino)

  // 0) Guardas destructivas ANTES de leer o escribir nada.
  if (p.dbPathActivo && mismaRuta(destino, p.dbPathActivo)) {
    throw new Error(`El destino es la base de datos ACTIVA (${destino}): restaura en otra ruta, no se sobrescribe la BD en uso`)
  }
  if (fs.existsSync(destino)) {
    if (!fs.statSync(destino).isFile()) throw new Error(`El destino existe y no es un archivo: ${destino}`)
    if (p.sobrescribir !== true) throw new Error(`El destino ya existe: ${destino} (usa --sobrescribir para reemplazarlo)`)
  }

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

  // 3) Escritura en un TEMPORAL del mismo directorio: el destino no se toca
  //    hasta que la copia supere todas las validaciones (rename atómico).
  fs.mkdirSync(dirDestino, { recursive: true })
  const temp = path.join(dirDestino, `.${nombreDestino}.restaurando-${process.pid}-${Date.now()}`)
  const Database = require('better-sqlite3')
  let db = null
  let integrity = null
  const foreignKey = { ok: false, violaciones: 0, detalle: [] }
  const tablas = {}
  const claves = { clientes_v1: 0, empresas_v1: 0, descifrables: 0, error: null }

  try {
    fs.writeFileSync(temp, plano, { mode: 0o600, flag: 'wx' })
    try {
      fs.chmodSync(temp, 0o600)
    } catch {
      // Sistemas de archivos sin permisos POSIX: el temporal sigue siendo efímero.
    }

    db = new Database(temp, { readonly: true })

    // 4) Integridad estructural y referencial
    try {
      integrity = db.pragma('integrity_check', { simple: true })
    } catch (e) {
      integrity = `ERROR: ${e.message}`
    }
    try {
      const violaciones = db.pragma('foreign_key_check')
      const lista = Array.isArray(violaciones) ? violaciones : []
      foreignKey.violaciones = lista.length
      foreignKey.ok = lista.length === 0
      foreignKey.detalle = lista.slice(0, 5)
    } catch (e) {
      foreignKey.ok = false
      foreignKey.detalle = [`ERROR: ${e.message}`]
    }

    // 5) Conteos de tablas críticas
    for (const tabla of TABLAS_CRITICAS) {
      const existe = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(tabla)
      tablas[tabla] = existe ? db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n : 'inexistente'
    }

    // 6) Claves SII v1: deben descifrar con la clave maestra vigente
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
    db = null

    const ok = integrity === 'ok' && foreignKey.ok && !claves.error
    const reporte = {
      ok,
      publicado: false,
      destino,
      manifest: { creado_en: manifest.creado_en, cifrado: !!manifest.cifrado, formato: manifest.formato },
      integrity,
      foreignKey,
      tablas,
      claves,
    }
    if (!ok) return reporte

    // 7) Publicación atómica: solo aquí el destino cambia.
    fs.renameSync(temp, destino)
    try {
      fs.chmodSync(destino, 0o600)
    } catch {
      // idem
    }
    return { ...reporte, publicado: true }
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        // ya cerrada
      }
    }
    if (fs.existsSync(temp)) {
      try {
        fs.rmSync(temp, { force: true })
      } catch {
        // si no se puede borrar, queda en el directorio con permisos 0600 y prefijo oculto
      }
    }
  }
}

module.exports = { restaurar, TABLAS_CRITICAS }
