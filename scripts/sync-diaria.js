#!/usr/bin/env node
/**
 * scripts/sync-diaria.js — Disparador de la sincronización diaria (BLOQUE 5).
 *
 * Uso:
 *   node scripts/sync-diaria.js              # corrida normal (empresas activas)
 *   node scripts/sync-diaria.js --reanudar   # reanudar pendientes del día
 *   node scripts/sync-diaria.js --empresa 5  # solo esa empresa
 *   node scripts/sync-diaria.js --usuario 1  # a quién se atribuye la auditoría
 *
 * Cron real en el VPS (croneado en la sesión 2026-10-17; el contenedor es la
 * única copia con dependencias instaladas, así que se ejecuta con `docker exec`
 * igual que el backup de las 03:00):
 *   30 7 * * * /usr/bin/docker exec iva-mensual node scripts/sync-diaria.js >> /home/johan/apps/iva-mensual/logs-sync.log 2>&1
 *
 * Auditoría: sin `--usuario` firma el admin semilla (`licencias.usuarioSistema`)
 * y `ip` queda como `script:sync-diaria`, para distinguir la corrida del cron
 * de un login en la UI (el auto-sync al login sí lleva el usuario real).
 *
 * Garantías: idempotente (jobs_persistentes no duplica), recuperable
 * (`--reanudar` reproduce lo que la corrida anterior dejó incompleto), y
 * observable (imprime el resumen JSON; errores por empresa visibles).
 */
require('dotenv').config()

const db = require('../backend/db')
const sync = require('../backend/core/sync-diaria')
const jobsP = require('../backend/core/jobs-persistentes')
const licencias = require('../backend/core/licencias')

const IP = 'script:sync-diaria'

async function main() {
  const args = process.argv.slice(2)
  const reanudar = args.includes('--reanudar')
  const idx = args.indexOf('--empresa')
  const empresaIds = idx >= 0 && args[idx + 1] ? [Number(args[idx + 1])] : null

  // Actor de la corrida: explícito por argumento o el admin semilla. Sin actor
  // la auditoría lanza y la corrida termina en error DESPUÉS de consultar el
  // SII (el resumen nunca se imprimía y el cron fallaba todos los días).
  const idxU = args.indexOf('--usuario')
  const usuarioId = (idxU >= 0 && args[idxU + 1] ? Number(args[idxU + 1]) : licencias.usuarioSistema(db)) || null
  if (!usuarioId) {
    console.error('[SYNC] No hay usuario para firmar la auditoría: crea el admin del sistema o pasa --usuario <id>')
    process.exit(2)
  }

  // Recuperación genérica al entrar: libera locks vencidos (crash previo)
  const liberados = jobsP.liberarLocksVencidos(db)
  if (liberados) console.log(`[SYNC] ${liberados} lock(s) huérfano(s) liberados`)

  const r = reanudar
    ? await sync.reanudarSyncDiaria(db, { usuarioId })
    : await sync.ejecutarSyncDiaria(db, { empresaIds, usuarioId, ip: IP })

  console.log(JSON.stringify({ ok: true, usuario_id: usuarioId, ...r }, null, 2))
  db.close()
  // Exit code: 0 si OK o nada por hacer; 1 si hubo errores (visible en cron).
  process.exit(r.con_errores > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('[SYNC] falló:', err.message)
  process.exit(2)
})
