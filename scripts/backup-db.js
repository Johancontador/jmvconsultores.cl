#!/usr/bin/env node
/**
 * Backup de la base de datos SQLite (operación crítica del software contable).
 *
 * Usa la API de backup online de better-sqlite3 (segura con WAL activo:
 * puede correr con el servidor en marcha). Retención configurable.
 *
 * Programar en el VPS (cron, diario a las 03:00):
 *   0 3 * * * cd /ruta/iva-mensual && /usr/bin/node scripts/backup-db.js >> logs-backup.log 2>&1
 *
 * Restaurar:
 *   1. Detener el servidor.
 *   2. Copiar el .db elegido a la ruta de DB_PATH (ej. data/iva_mensual.db).
 *   3. Arrancar el servidor.
 */

const path = require('path')
const fs = require('fs')
require('dotenv').config() // el cron debe ver BACKUP_ENCRYPTION_KEY/DB_PATH/BACKUP_DIR desde .env
const cifrador = require('../backend/core/backup-cifrado')

const RETENCION = Number(process.env.BACKUP_RETENCION || 30)
const DB_PATH = process.env.DB_PATH || './data/iva_mensual.db'
const DIR = process.env.BACKUP_DIR || './data/backups'

const dbPath = path.resolve(DB_PATH)
if (!fs.existsSync(dbPath)) {
  console.error(`[BACKUP] No existe la base de datos: ${dbPath}`)
  process.exit(1)
}

fs.mkdirSync(DIR, { recursive: true })

const db = require('better-sqlite3')(dbPath, { readonly: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const destino = path.join(DIR, `iva_mensual_${stamp}.db`)

try {
  db.backup(destino).then(() => {
    db.close()

    // BLOQUE 1bis (P6): sha256 + manifest + cifrado opcional con
    // BACKUP_ENCRYPTION_KEY (AES-256-GCM, formato JMVBACKUP1). La clave viene
    // del entorno — jamás hardcodeada, versionada ni impresa.
    const clave = process.env.BACKUP_ENCRYPTION_KEY || null
    let archivoFinal = destino
    let shaOriginal = cifrador.sha256Archivo(destino)

    if (clave) {
      const plano = fs.readFileSync(destino)
      const enc = cifrador.cifrarBuffer(plano, clave)
      // Verificación de round-trip ANTES de borrar el plano
      const planoVerificado = cifrador.descifrarBuffer(enc, clave)
      if (cifrador.sha256Buffer(planoVerificado) !== shaOriginal) {
        console.error('[BACKUP] ERROR: round-trip de cifrado no coincide — se conserva el .db en claro')
        process.exit(1)
      }
      archivoFinal = destino + '.enc'
      fs.writeFileSync(archivoFinal, enc)
      fs.rmSync(destino, { force: true }) // solo tras verificación: el plano no persiste
    } else {
      console.warn('[BACKUP] AVISO: BACKUP_ENCRYPTION_KEY no definida — backup SIN cifrar. Defínela en .env (P6).')
    }

    const shaFinal = cifrador.sha256Archivo(archivoFinal)
    const nombreFinal = path.basename(archivoFinal)

    // Manifest: metadatos verificables. NUNCA contiene secretos.
    const manifest = {
      archivo: nombreFinal,
      sha256: shaFinal,
      tamano_bytes: fs.statSync(archivoFinal).size,
      creado_en: new Date().toISOString(),
      formato: `jmv-backup-${cifrador.VERSION}`,
      cifrado: !!clave,
      sha256_original: clave ? shaOriginal : undefined,
      base_datos: path.basename(dbPath),
      secretos: 'ninguno',
    }
    const rutaManifest = destino.replace(/\.db$/, '') + '.manifest.json'
    fs.writeFileSync(rutaManifest, JSON.stringify(manifest, null, 2) + '\n')
    // sha256sum-compatible: '<hash>  <archivo>'
    const rutaSha = destino.replace(/\.db$/, '') + '.sha256'
    fs.writeFileSync(rutaSha, `${shaFinal}  ${nombreFinal}\n`)

    // Permisos restrictivos (best-effort: full en Linux/VPS, no-op en NTFS)
    for (const f of [archivoFinal, rutaManifest, rutaSha]) {
      try { fs.chmodSync(f, 0o600) } catch { /* NTFS: se controla por ACL del directorio */ }
    }

    console.log(`[BACKUP] OK → ${archivoFinal} (${manifest.tamano_bytes} bytes)`)
    console.log(`[BACKUP] cifrado: ${manifest.cifrado ? 'AES-256-GCM (JMVBACKUP1)' : 'NO'} · sha256 ${shaFinal.slice(0, 16)}… · manifest y .sha256 junto al backup`)

    // Retención: agrupa por stamp y borra los backups más antiguos que la
    // cantidad configurada — incluyendo .db / .db.enc / manifest / sha256.
    const porStamp = new Map()
    for (const f of fs.readdirSync(DIR)) {
      const m = f.match(/^iva_mensual_(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.(db|db\.enc|manifest\.json|sha256)$/)
      if (m) {
        if (!porStamp.has(m[1])) porStamp.set(m[1], [])
        porStamp.get(m[1]).push(f)
      }
    }
    const stamps = [...porStamp.keys()].sort().reverse()
    for (const viejo of stamps.slice(RETENCION)) {
      for (const f of porStamp.get(viejo)) {
        fs.rmSync(path.join(DIR, f), { force: true })
        console.log(`[BACKUP] retención: eliminado ${f}`)
      }
    }
  }).catch((err) => {
    console.error('[BACKUP] ERROR:', err.message)
    try { db.close() } catch {}
    process.exit(1)
  })
} catch (err) {
  console.error('[BACKUP] ERROR:', err.message)
  try { db.close() } catch {}
  process.exit(1)
}
