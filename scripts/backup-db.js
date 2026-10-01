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
    console.log(`[BACKUP] OK → ${destino} (${(fs.statSync(destino).size / 1024).toFixed(0)} KB)`)

    // Retención: borra los backups más antiguos que la cantidad configurada
    const archivos = fs.readdirSync(DIR)
      .filter((f) => /^iva_mensual_.*\.db$/.test(f))
      .sort() // el stamp ISO ordena cronológicamente
      .reverse()
    for (const viejo of archivos.slice(RETENCION)) {
      fs.rmSync(path.join(DIR, viejo), { force: true })
      console.log(`[BACKUP] retención: eliminado ${viejo}`)
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
