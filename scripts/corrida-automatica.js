#!/usr/bin/env node
/**
 * CORRIDA AUTOMÁTICA DE CONTABILIZACIÓN (operación server-side, VPS).
 *
 * Ejecuta el pipeline completo de un período SIN sesión HTTP, reutilizando
 * EXACTAMENTE los módulos core que usa la UI (misma auditoría, mismas
 * validaciones, mismo núcleo de partida doble):
 *
 *   [--ingesta]  SII → bandeja (core/ingesta, dedupe idempotente)
 *   [siempre]    normalización de fecha_docto (DD/MM/YYYY del RCV → ISO; un doc
 *                con fecha no-ISO se confirmaría con fecha HOY, rompiendo el devengo)
 *                reglas semilla si la empresa no tiene (core/reglas-semilla)
 *                pipeline (core/automatizacion: clasificar → proponer → contabilizar)
 *                conciliación (core/conciliacion: concilia y REPORTA, nunca corrige)
 *                verificación Σdébitos = Σhaber de los asientos del período
 *
 * Auditoría: cada escritura registra usuario_id (--usuario, por defecto 1)
 * e ip = 'script:corrida-automatica' para distinguir la corrida server-side
 * de un click en la UI. La confirmación de asientos es la del núcleo FASE 4
 * (partida doble validada asiento por asiento). El CIERRE del período sigue
 * siendo decisión humana desde la UI (Reportes y Cierre) — este script no
 * cierra nada.
 *
 * Uso:
 *   node scripts/corrida-automatica.js --empresa 1 --periodo 202609 [--ingesta] [--usuario 1]
 *
 * Seguro de re-ejecutar: la ingesta no duplica (dedupe), el pipeline solo
 * toca PENDIENTE/REVISIÓN/CLASIFICADO y propuestas PENDIENTE — nunca pisa
 * decisiones humanas ni documentos ya contabilizados.
 */

const db = require('../backend/db')
const ingesta = require('../backend/core/ingesta')
const automatizacion = require('../backend/core/automatizacion')
const conciliacion = require('../backend/core/conciliacion')
const semilla = require('../backend/core/reglas-semilla')
const documentosCore = require('../backend/core/documentos')
const { registrarAccion } = require('../backend/core/auditoria')

const IP = 'script:corrida-automatica'
const TIMEOUT_INGESTA_MS = 15 * 60 * 1000

function parseArgs(argv) {
  const args = { ingesta: false, usuario: 1 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--ingesta') args.ingesta = true
    else if (a === '--empresa') args.empresa = Number(argv[++i])
    else if (a === '--periodo') args.periodo = String(argv[++i] || '')
    else if (a === '--usuario') args.usuario = Number(argv[++i])
    else {
      console.error(`Argumento desconocido: ${a}`)
      process.exit(1)
    }
  }
  return args
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ingestar(args) {
  console.log(`\n[1/5] INGESTA SII ${args.periodo} (compras + ventas)...`)
  let job
  try {
    job = ingesta.iniciar(db, {
      empresaId: args.empresa, usuarioId: args.usuario, periodo: args.periodo, ip: IP,
    })
  } catch (err) {
    console.error(`  ✗ No se pudo iniciar la ingesta: ${err.message}`)
    process.exit(1)
  }
  const t0 = Date.now()
  let est = null
  while (Date.now() - t0 < TIMEOUT_INGESTA_MS) {
    await sleep(2000)
    est = ingesta.obtenerEstado(job.jobId, args.usuario)
    if (!est) continue
    if (est.estado !== 'procesando' && !est.estado.startsWith('consultando_') && !est.estado.startsWith('ingestando_')) break
  }
  if (!est || est.estado === 'procesando') {
    console.error('  ✗ La ingesta no terminó dentro del tiempo límite (el job puede seguir; re-ejecutar es seguro por dedupe)')
    process.exit(1)
  }
  if (est.estado === 'error') {
    console.error(`  ✗ Ingesta falló: ${est.error}`)
    process.exit(1)
  }
  const r = est.resultado || {}
  console.log(`  ✓ ${est.estado}: insertados ${r.insertados_total}, duplicados saltados ${r.duplicados_total}` +
    (r.compra?.error ? ` | compra: ${r.compra.error}` : '') + (r.venta?.error ? ` | venta: ${r.venta.error}` : ''))
  return est
}

function normalizarFechas(args) {
  const docs = db.prepare(`
    SELECT id, fecha_docto FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta = ?
  `).all(args.empresa, args.periodo)
  let corregidas = 0
  const tx = db.transaction(() => {
    for (const d of docs) {
      const iso = documentosCore.normalizarFechaSII(d.fecha_docto)
      if (iso && iso !== d.fecha_docto) {
        db.prepare(`UPDATE documentos SET fecha_docto = ?, actualizado_en = datetime('now') WHERE id = ?`).run(iso, d.id)
        corregidas++
      }
    }
    if (corregidas > 0) {
      registrarAccion(db, {
        empresaId: args.empresa, usuarioId: args.usuario,
        accion: 'documentos.normalizar_fechas', entidad: 'documentos', entidadId: args.periodo,
        despues: { corregidas, regla: 'DD/MM/YYYY del RCV → ISO (misma frontera que ingesta)' }, ip: IP,
      })
    }
  })
  tx()
  return corregidas
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.empresa || !/^\d{6}$/.test(args.periodo)) {
    console.error('Uso: node scripts/corrida-automatica.js --empresa <id> --periodo <AAAAMM> [--ingesta] [--usuario <id>]')
    process.exit(1)
  }
  const empresa = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(args.empresa)
  if (!empresa) {
    console.error(`✗ Empresa ${args.empresa} no encontrada o inactiva`)
    process.exit(1)
  }
  console.log(`CORRIDA AUTOMÁTICA — ${empresa.nombre} (${empresa.rut}) — período ${args.periodo}`)
  console.log(`Auditoría atribuida a usuario_id ${args.usuario} · ip ${IP} · el cierre del período sigue siendo humano`)

  if (args.ingesta) await ingestar(args)
  else console.log('\n[1/5] INGESTA omitida (--ingesta no presente)')

  console.log('\n[2/5] NORMALIZACIÓN DE FECHAS (DD/MM/YYYY → ISO)...')
  const corregidas = normalizarFechas(args)
  console.log(corregidas > 0 ? `  ✓ ${corregidas} fechas corregidas (sin esto, los asientos se fechaban HOY)` : '  · Todas las fechas ya son ISO — nada que corregir')

  console.log('\n[3/5] REGLAS SEMILLA...')
  const s = semilla.instalarSiVacia(db, { empresaId: args.empresa, usuarioId: args.usuario, ip: IP })
  console.log(s.instaladas > 0 ? `  ✓ Semilla instalada (${s.instaladas} reglas${s.omitidas.length ? `, omitidas: ${s.omitidas.length}` : ''})` : '  · La empresa ya tenía reglas — no se toca nada')

  console.log('\n[4/5] PIPELINE (clasificar → proponer → contabilizar)...')
  let r
  try {
    r = automatizacion.ejecutar(db, {
      empresaId: args.empresa, usuarioId: args.usuario, periodo: args.periodo, ip: IP,
    })
  } catch (err) {
    console.error(`  ✗ Pipeline falló: ${err.message}`)
    process.exit(1)
  }
  console.log(`  Clasificados ${r.clasificados}/${r.evaluados} (sin regla: ${r.sin_regla})`)
  console.log(`  Propuestas nuevas ${r.propuestas_nuevas}${r.propuestas_fallidas.length ? ` · fallidas: ${r.propuestas_fallidas.map((f) => `#${f.documento_id} ${f.motivo}`).join('; ')}` : ''}`)
  console.log(`  Contabilizadas ${r.contabilizadas} de ${r.contabilizadas + r.omitidas.length} (monto $${r.total_asientos})`)
  if (r.omitidas.length) {
    console.log('  Omitidas (no silenciosas):')
    for (const o of r.omitidas.slice(0, 20)) console.log(`    · propuesta #${o.propuesta_id}: ${o.motivo}`)
  }

  console.log('\n[5/5] CONCILIACIÓN + VERIFICACIÓN...')
  const c = conciliacion.ejecutar(db, {
    empresaId: args.empresa, usuarioId: args.usuario, periodo: args.periodo, ip: IP,
  })
  console.log(`  Σdébitos = Σhaber del período: ${c.totales.cuadre_contable ? '✓ CUADRA' : '✗ DESCUADRE'} (D ${c.totales.contable.asientos_debe} / H ${c.totales.contable.asientos_haber})`)
  console.log(`  Documentos: ${(c.resumen_estado || []).map((r) => `${r.estado} ${r.n}`).join(', ') || 'ninguno'}`)
  const conteo = c.conteo_diferencias || {}
  console.log(`  Diferencias conciliación: ${c.diferencias_count || 0}` +
    (Object.keys(conteo).length ? ` (${Object.entries(conteo).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''))
  if (c.ajustes_sin_documento.length) {
    console.log(`  Asientos sin documento (ajustes/cierre): ${c.ajustes_sin_documento.length}`)
  }

  const asientos = db.prepare(`
    SELECT COUNT(*) AS n, MIN(folio) AS folio_min, MAX(folio) AS folio_max
    FROM asientos WHERE empresa_id = ? AND periodo = ?
  `).get(args.empresa, args.periodo)
  console.log(`\nRESULTADO: ${asientos.n} asientos (folios ${asientos.folio_min}–${asientos.folio_max}) · ${r.contabilizadas} contabilizadas en esta corrida · ${c.diferencias_count || 0} diferencias reportadas`)
  console.log('Siguiente paso humano: revisar REVISIÓN/SOLO_SII en la bandeja y cerrar el período desde Reportes y Cierre.')
}

main().then(() => {
  try { db.close() } catch {}
  process.exit(0)
}).catch((err) => {
  console.error('ERROR INESPERADO:', err)
  process.exit(1)
})
