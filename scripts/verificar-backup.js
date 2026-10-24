#!/usr/bin/env node
/**
 * F5-C — VERIFICACIÓN DEL BACKUP MÁS RECIENTE (frescura + integridad).
 *
 *   node scripts/verificar-backup.js                 # usa BACKUP_DIR (default ./data/backups)
 *   node scripts/verificar-backup.js --max-horas 30
 *   node scripts/verificar-backup.js --sin-hash       # no recalcula SHA-256 (más rápido)
 *   node scripts/verificar-backup.js --json
 *
 * Códigos de salida (para el cron / monitor):
 *   0 = backup reciente e íntegro
 *   1 = hay un problema (ausente, antiguo, incompleto o corrupto)
 *   2 = error de uso / configuración
 *
 * NO descifra nada, NO imprime secretos y NO hace red. La alerta se dispara
 * con lo que el operador conecte al exit code (cron con MAILTO, systemd
 * OnFailure o un monitor externo) — ver docs/handoff-integral/26.
 *
 * Programar DESPUÉS del backup:
 *   15 3 * * * cd /ruta/iva-mensual && /usr/bin/node scripts/verificar-backup.js \
 *              >> logs-backup.log 2>&1 || /usr/bin/curl -fsS -m 10 "$ALERTA_WEBHOOK" -d 'backup con problemas'
 */

require('dotenv').config()
const path = require('path')
const { evaluar, resumenTexto } = require('../backend/core/backup-vigilancia')

const argv = process.argv.slice(2)
const opciones = { dir: process.env.BACKUP_DIR || './data/backups', maxHoras: 26, hash: true, json: false }

for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--dir') opciones.dir = argv[++i]
  else if (a === '--max-horas') opciones.maxHoras = Number(argv[++i])
  else if (a === '--sin-hash') opciones.hash = false
  else if (a === '--json') opciones.json = true
  else {
    console.error(`Argumento desconocido: ${a}`)
    console.error('Uso: node scripts/verificar-backup.js [--dir <carpeta>] [--max-horas N] [--sin-hash] [--json]')
    process.exit(2)
  }
}

if (!Number.isFinite(opciones.maxHoras) || opciones.maxHoras <= 0) {
  console.error('ERROR: --max-horas debe ser un número mayor que 0')
  process.exit(2)
}

const informe = evaluar({ dir: path.resolve(opciones.dir), maxHoras: opciones.maxHoras, hash: opciones.hash })

if (opciones.json) console.log(JSON.stringify(informe, null, 2))
else console.log(resumenTexto(informe))

process.exit(informe.ok ? 0 : 1)
