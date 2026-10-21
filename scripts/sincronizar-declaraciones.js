#!/usr/bin/env node
/**
 * scripts/sincronizar-declaraciones.js — Declaraciones oficiales del SII.
 *
 * Consulta la Consulta Integral F29 y el Informe Anual de Boletas de
 * Honorarios con la clave SII de la empresa, guarda el resultado en
 * `declaraciones_sii` y cierra la sesión al terminar (obligatorio: el SII
 * limita las sesiones simultáneas por RUT).
 *
 * Uso:
 *   node scripts/sincronizar-declaraciones.js --empresa=1 [--periodo=YYYYMM] [--anios=5]
 *
 * Requiere Chrome/Chromium (CHROME_PATH si no está en una ruta estándar).
 */
require('dotenv').config()
const db = require('../backend/db')
const declaraciones = require('../backend/core/declaraciones-sii')

function arg(nombre, def = null) {
  const p = process.argv.find((a) => a.startsWith(`--${nombre}=`))
  return p ? p.split('=').slice(1).join('=') : def
}

const empresaId = Number(arg('empresa', 0))
if (!empresaId) {
  console.error('Falta --empresa=<id>')
  process.exit(1)
}
const ahora = new Date()
const periodo = String(arg('periodo', `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}`))
const anios = Number(arg('anios', 5))

;(async () => {
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ?`).get(empresaId)
  if (!emp) throw new Error(`Empresa ${empresaId} no encontrada`)
  console.log(`Consultando declaraciones de ${emp.nombre} (${emp.rut}) — ${anios} año(s) hasta ${periodo}`)

  const r = await declaraciones.sincronizar(db, { empresaId, periodo, anios })
  const filas = db.prepare(`
    SELECT tipo, COUNT(*) n, SUM(CASE WHEN estado IN ('declarada','rectificada') THEN 1 ELSE 0 END) declaradas,
           SUM(CASE WHEN estado IN ('pendiente','no_presentada') THEN 1 ELSE 0 END) pendientes
    FROM declaraciones_sii WHERE empresa_id = ? GROUP BY tipo
  `).all(empresaId)
  console.log(JSON.stringify({ resultado: r.resultado, aviso: r.aviso, filas }, null, 2))
  db.close()
})().catch((err) => {
  console.error(`[ERROR] ${err.codigo ? `${err.codigo}: ` : ''}${err.message}`)
  process.exit(1)
})
