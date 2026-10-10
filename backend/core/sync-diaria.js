/**
 * sync-diaria.js (BLOQUE 5 del masterplan 2026-10-10) — Sincronización diaria
 * programada, RECUPERABLE, IDEMPOTENTE y OBSERVABLE.
 *
 * Qué hace cada día (por cada empresa activa con clave SII):
 *   1. job persistente 'sync_diaria' con clave de unicidad = empresa:periodo
 *      → un reinicio no duplica ni re-solicita (crear() es exclusivo; los
 *      períodos con checkpoint se saltan en la reanudación).
 *   2. ingesta RCV del período (compras+ventas) vía el pipeline FASE 3 ya
 *      existente (documentos.ingestarBatch — dedupe idempotente).
 *   3. checkpoint por período en jobs_persistentes, latido del lock, y errores
 *      por período VISIBLES en progreso_json (un error no se confunde con
 *      "período sin movimientos": 0 documentos + error ≠ 0 documentos OK).
 *   4. límites SII respetados: pausa entre consultas (SII_PAUSA_MS) y máx
 *      empresas por corrida (SII_MAX_EMPRESAS) — la corrida que sobra queda
 *      pendiente para la siguiente reanudación/cron.
 *
 * Disparo (services/server.js o cron externo): scripts/sync-diaria.js
 *
 * Módulo puro: BD por parámetro. Nunca imprime secretos.
 */

const documentosCore = require('./documentos')
const { claveSiiDescifrada } = require('./empresas')
const { registrarAccion } = require('./auditoria')
const jobsP = require('./jobs-persistentes')
const rcv = require('../services/rcv')

const PAUSA_MS = Number(process.env.SII_PAUSA_MS || 2000)   // entre consultas al SII
const MAX_EMPRESAS = Number(process.env.SII_MAX_EMPRESAS || 20) // techo por corrida

function periodoActual() {
  // El período BD objetivo es el MES EN CURSO (el RCV del mes se llena en vivo).
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function dormir(ms) { return new Promise((r) => setTimeout(r, ms)) }

/**
 * Ejecuta la sincronización diaria de TODAS las empresas activas con clave
 * SII (o de las empresaIds recibidas). Devuelve el resumen observable.
 * Idempotente: si el job (empresa, período) ya vive, se salta — sin duplicar.
 */
async function ejecutarSyncDiaria(db, { usuarioId = null, empresaIds = null, ip = null } = {}) {
  const periodo = periodoActual()
  const empresas = db.prepare(`
    SELECT id, rut, nombre FROM empresas WHERE activo = 1
  `).all().filter((e) => {
    if (empresaIds && !empresaIds.includes(e.id)) return false
    // con clave SII (cifrada v1: o legacy) — jamás imprime nada
    const k = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(e.id)?.clave_sii
    return !!k
  })

  const resumen = { periodo, procesadas: 0, ok: 0, con_errores: 0, saltadas: 0, errores: {} }
  let tope = MAX_EMPRESAS

  for (const emp of empresas) {
    if (tope-- <= 0) break // el resto queda pendiente para la próxima corrida

    // Exclusión mutua + idempotencia: el job vivo del mismo (empresa, periodo)
    // se REUSA; crear() también libera locks vencidos al pasar.
    const job = jobsP.crear(db, {
      tipo: 'sync_diaria',
      claveUnicidad: `${emp.id}:${periodo}`,
      empresaId: emp.id,
      usuarioId,
      periodoDesde: periodo,
      periodoHasta: periodo,
    })
    const fila = jobsP.obtener(db, job.id)
    if (!job.creado) {
      // Distinto destino según el estado del job devuelto:
      //  - ejecutando (lock activo en otro proceso) → saltar sin tocarlo
      //  - completado (ventana de idempotencia) → saltar: ya echo hoy
      //  - PENDIENTE (crash/reintento) → REINTENTAR AHORA (es justamente
      //    la reanudación: ni failido silencioso ni doble ejecución)
      if (job.estado !== 'pendiente') { resumen.saltadas += 1; continue }
      if (fila.progreso?.periodos_completados?.includes(periodo)) {
        resumen.saltadas += 1
        continue
      }
    } else if (fila.progreso?.periodos_completados?.includes(periodo)) {
      // (no debería pasar: job nuevo no tiene checkpoints)
      resumen.saltadas += 1
      continue
    }
    jobsP.tomar(db, job.id)

    let clave
    try {
      clave = claveSiiDescifrada(db, emp.id)
    } catch (err) {
      jobsP.errorPeriodo(db, job.id, periodo, `clave SII: ${err.message}`)
      jobsP.finalizar(db, job.id, 'fallido', `clave SII: ${err.message}`)
      resumen.con_errores += 1
      resumen.errores[emp.id] = 'clave SII indescifrable'
      continue
    }

    const detalle = { compra: null, venta: null }
    let fallo = false
    for (const [tipo, flujo] of [['compras', 'compra'], ['ventas', 'venta']]) {
      try {
        const docs = await rcv.consultarRCV(emp.rut, clave, tipo, periodo)
        detalle[flujo] = documentosCore.ingestarBatch(db, {
          empresaId: emp.id, usuarioId, tipoFlujo: flujo, periodo, documentos: docs, ip,
        })
      } catch (err) {
        detalle[flujo] = { error: err.message }
        fallo = true
      }
      await dormir(PAUSA_MS)
    }

    const nErrores = (detalle.compra?.error ? 1 : 0) + (detalle.venta?.error ? 1 : 0)
      + (detalle.compra?.errores?.length || 0) + (detalle.venta?.errores?.length || 0)

    if (fallo) {
      jobsP.errorPeriodo(db, job.id, periodo,
        (detalle.compra?.error || detalle.venta?.error || 'errores de fila').slice(0, 300))
      jobsP.finalizar(db, job.id, 'fallido', `${nErrores} error(es) en ${periodo}`)
      resumen.con_errores += 1
      resumen.errores[emp.id] = (detalle.compra?.error || detalle.venta?.error || 'errores de fila').slice(0, 100)
    } else {
      jobsP.checkpointPeriodo(db, job.id, periodo, {
        compra: detalle.compra && { insertados: detalle.compra.insertados, duplicados: detalle.compra.duplicados },
        venta: detalle.venta && { insertados: detalle.venta.insertados, duplicados: detalle.venta.duplicados },
      })
      jobsP.finalizar(db, job.id, 'completado')
      resumen.ok += 1
    }
    resumen.procesadas += 1
  }

  registrarAccion(db, {
    empresaId: null, usuarioId,
    accion: 'sync_diaria.ejecutar', entidad: 'jobs_persistentes', entidadId: periodo,
    despues: { procesadas: resumen.procesadas, ok: resumen.ok, con_errores: resumen.con_errores, saltadas: resumen.saltadas },
    ip,
  })
  return resumen
}

/**
 * Reanudación al arranque: los 'sync_diaria' pendientes del día se re-ejecutan
 * (períodos sin checkpoint). También libera locks vencidos de cualquier tipo.
 */
async function reanudarSyncDiaria(db, { usuarioId = null } = {}) {
  const pendientes = jobsP.listar(db, { tipo: 'sync_diaria', limit: 100 })
    .filter((j) => j.estado === 'pendiente' && j.empresa_id)
  if (!pendientes.length) return { reanudadas: 0 }

  const hoy = periodoActual()
  const delDia = pendientes.filter((j) => j.periodo_desde === hoy)
  if (!delDia.length) return { reanudadas: 0 }

  const r = await ejecutarSyncDiaria(db, {
    usuarioId, empresaIds: delDia.map((j) => j.empresa_id),
  })
  return { reanudadas: delDia.length, ...r }
}

module.exports = { ejecutarSyncDiaria, reanudarSyncDiaria, periodoActual, PAUSA_MS, MAX_EMPRESAS }
