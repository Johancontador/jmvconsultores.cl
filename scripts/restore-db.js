#!/usr/bin/env node
/**
 * RESTAURACIÓN VERIFICADA de backups (BLOQUE 1bis — P6).
 *
 *   node scripts/restore-db.js --backup data/backups/iva_mensual_XXXX.db.enc --dest "$TEMP/restore-test"
 *   node scripts/restore-db.js --backup <ruta> --dest data --nombre iva_mensual.db --sobrescribir
 *
 * Flujo: manifest + SHA-256 → descifrado (BACKUP_ENCRYPTION_KEY) →
 * SHA-256 del original → validación en TEMPORAL (integrity_check + foreign_key_check) →
 * conteos de tablas críticas → claves SII v1: (SECRETOS_MASTER_KEY) → publicación atómica.
 *
 * GUARDAS: nunca escribe sobre DB_PATH y nunca reemplaza un archivo existente sin
 * `--sobrescribir`; ante cualquier fallo el destino queda intacto y el temporal se borra.
 * NUNCA imprime secretos. Procedimiento completo: docs/SEGURIDAD.md (P6).
 *
 * Códigos de salida: 0 = restaurada y publicada; 1 = error o copia no válida.
 */

require('dotenv').config()
const { restaurar } = require('../backend/core/backup-restaurar')
const boveda = require('../backend/core/boveda')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--backup') args.backup = argv[++i]
    else if (argv[i] === '--dest') args.dest = argv[++i]
    else if (argv[i] === '--nombre') args.nombre = argv[++i]
    else if (argv[i] === '--sobrescribir') args.sobrescribir = true
    else { console.error(`Argumento desconocido: ${argv[i]}`); process.exit(1) }
  }
  if (!args.backup || !args.dest) {
    console.error('Uso: node scripts/restore-db.js --backup <ruta.db[.enc]> --dest <carpeta-aislada> [--nombre archivo.db] [--sobrescribir]')
    process.exit(1)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

try {
  const reporte = restaurar({
    rutaBackup: args.backup,
    dirDestino: args.dest,
    nombreDestino: args.nombre,
    sobrescribir: args.sobrescribir === true,
    dbPathActivo: process.env.DB_PATH || null,
    claveBackup: process.env.BACKUP_ENCRYPTION_KEY || null,
    // Descifrado de claves SII v1: con la clave maestra de APLICACIÓN
    // (SECRETOS_MASTER_KEY) — si no está, se reporta como no-verificado.
    descifrarSii: process.env.SECRETOS_MASTER_KEY ? (v) => boveda.descifrar(v) : null,
  })

  console.log('[RESTORE] ' + (reporte.ok ? 'OK' : 'CON PROBLEMAS'))
  console.log(`[RESTORE] publicado: ${reporte.publicado ? 'sí' : 'NO (el destino quedó intacto)'}`)
  console.log(`[RESTORE] destino aislado: ${reporte.destino}`)
  console.log(`[RESTORE] integridad SQLite: ${reporte.integrity}`)
  console.log(`[RESTORE] integridad referencial: ${reporte.foreignKey.ok ? 'ok' : `FALLIDA (${reporte.foreignKey.violaciones} violaciones)`}`)
  console.log('[RESTORE] tablas críticas: ' + JSON.stringify(reporte.tablas))
  console.log('[RESTORE] claves SII: ' + JSON.stringify(reporte.claves))
  process.exit(reporte.ok ? 0 : 1)
} catch (err) {
  console.error('[RESTORE] ERROR:', err.message)
  process.exit(1)
}
