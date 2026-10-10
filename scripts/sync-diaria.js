#!/usr/bin/env node
/**
 * scripts/sync-diaria.js — Disparador de la sincronización diaria (BLOQUE 5).
 *
 * Uso:
 *   node scripts/sync-diaria.js              # corrida normal (empresas activas)
 *   node scripts/sync-diaria.js --reanudar   # reanudar pendientes del día
 *   node scripts/sync-diaria.js --empresa 5  # solo esa empresa
 *
 * Cron sugerido (VPS, crontab -e) — cada día 07:30:
 *   30 7 * * * cd /srv/iva-mensual && /usr/bin/node scripts/sync-diaria.js >> /var/log/iva-sync.log 2>&1
 *
 * Garantías: idempotente (jobs_persistentes no duplica), recuperable
 * (--reanudar reproduce lo que la corrida anterior dejó incompleto), y
 * observable (imprime el resumen JSON; errores por empresa visibles).
 */
require('dotenv').config()

const db = require('../backend/db')
const sync = require('../backend/core/sync-diaria')
const jobsP = require('../backend/core/jobs-persistentes')

async function main() {
  const args = process.argv.slice(2)
  const reanudar = args.includes('--reanudar')
  const idx = args.indexOf('--empresa')
  const empresaIds = idx >= 0 && args[idx + 1] ? [Number(args[idx + 1])] : null

  // Recuperación genérica al entrar: libera locks vencidos (crash previo)
  const liberados = jobsP.liberarLocksVencidos(db)
  if (liberados) console.log(`[SYNC] ${liberados} lock(s) huérfano(s) liberados`)

  const r = reanudar
    ? await sync.reanudarSyncDiaria(db)
    : await sync.ejecutarSyncDiaria(db, { empresaIds })

  console.log(JSON.stringify({ ok: true, ...r }, null, 2))
  db.close()
  // Exit code: 0 si OK o nada por hacer; 1 si hubo errores (visible en cron).
  process.exit(r.con_errores > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[SYNC] falló:', err.message)
  process.exit(2)
})
