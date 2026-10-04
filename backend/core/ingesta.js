/**
 * Ingesta SII → bandeja (FASE 3).
 *
 * Consume la integración SII EXISTENTE (services/rcv.js → consultarRCV) y
 * escribe en la bandeja contable vía documentos.core — nunca toca
 * sii-session.js ni llama endpoints del SII por su cuenta (INTEGRATIONS).
 *
 * Patrón de trabajo en background igual al de informes: Map en memoria con
 * estado/progreso para que la UI haga polling sin bloquear el request HTTP.
 * Un reinicio del proceso pierde el estado del job (documentado en
 * CURRENT_STATE §8.2); los documentos ya insertados quedan en BD y la
 * re-ingesta es idempotente por diseño (dedupe), así que "reiniciar el job"
 * es seguro: no duplica nada.
 */

const db = require('../db')
const rcv = require('../services/rcv')
const { claveSiiDescifrada } = require('./empresas')
const documentosCore = require('./documentos')
const { registrarAccion } = require('./auditoria')
const jobsMemoria = require('./jobs-memoria')

// claveSiiDescifrada y registrarAccion reciben la BD como parámetro en el core;
// aquí el módulo de ingesta trabaja con la BD del proceso (singleton db.js).
const dbInstancia = db

const trabajos = new Map() // jobId → estado {empresaId, usuarioId, ...}

function generarJobId() {
  return `ing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function estadoInterno(jobId) {
  jobsMemoria.purgar(trabajos)
  return trabajos.get(jobId) || null
}

/** Estado seguro para exponer por API (sin claves ni datos internos). */
function obtenerEstado(jobId, usuarioId) {
  jobsMemoria.purgar(trabajos)
  const t = trabajos.get(jobId)
  if (!t || t.usuarioId !== usuarioId) return null
  return {
    jobId,
    empresa_id: t.empresaId,
    periodo: t.periodo,
    estado: t.estado,
    total: t.total,
    procesados: t.procesados,
    resultado: t.resultado,
    error: t.error,
  }
}

/**
 * Lanza la ingesta de un período (compras + ventas) en background.
 * Valida acceso y parámetros de forma síncrona; devuelve el jobId de inmediato.
 */
function iniciar(dbParam, { empresaId, usuarioId, periodo, ip = null }) {
  const empresa = dbParam.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  // Pre-chequeo de clave descifrable ANTES de aceptar el job (error temprano)
  const clave = claveSiiDescifrada(dbParam, empresaId)
  if (!clave) throw new Error('La empresa no tiene clave SII configurada')

  const jobId = generarJobId()
  jobsMemoria.registrar(trabajos, jobId, {
    jobId, empresaId, usuarioId, periodo, ip,
    estado: 'procesando', total: 2, procesados: 0,
    resultado: null, error: null,
    empresa: { id: empresa.id, rut: empresa.rut, nombre: empresa.nombre },
  })

  ejecutar(jobId).catch((err) => {
    const t = trabajos.get(jobId)
    if (t) {
      t.estado = 'error'
      t.error = err.message
      registrarAccion(dbInstancia, {
        empresaId, usuarioId,
        accion: 'documentos.ingesta_error', entidad: 'documentos', entidadId: periodo,
        despues: { error: err.message }, ip,
      })
    }
  })

  return { jobId, empresa: { id: empresa.id, nombre: empresa.nombre }, periodo }
}

async function ejecutar(jobId) {
  const t = trabajos.get(jobId)
  if (!t) return

  const { empresaId, usuarioId, periodo, ip } = t
  let clave
  try {
    clave = claveSiiDescifrada(dbInstancia, empresaId)
  } catch (err) {
    t.estado = 'error'
    t.error = `No se pudo descifrar la clave SII: ${err.message}`
    return
  }
  const rut = dbInstancia.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)?.rut
  if (!rut) {
    t.estado = 'error'
    t.error = 'Empresa no encontrada'
    return
  }

  const resultado = { compra: null, venta: null }
  const tipos = ['compras', 'ventas']

  for (let i = 0; i < tipos.length; i++) {
    const tipo = tipos[i]
    const flujo = tipo === 'compras' ? 'compra' : 'venta'
    t.estado = `consultando_${tipo}`
    try {
      // La integración SII existente (rcv.js) devuelve documentos normalizados
      // y aplica su propio caché para períodos cerrados.
      const docs = await rcv.consultarRCV(rut, clave, tipo, periodo)
      t.estado = `ingestando_${tipo}`
      resultado[flujo] = documentosCore.ingestarBatch(dbInstancia, {
        empresaId, usuarioId, tipoFlujo: flujo, periodo, documentos: docs, ip,
      })
    } catch (err) {
      // Un tipo que falla no aborta el otro: la bandeja queda parcial y visible.
      resultado[flujo] = { error: err.message }
    }
    t.procesados = i + 1
  }

  const huboError = Boolean(resultado.compra?.error) || Boolean(resultado.venta?.error)
  const insertados = (resultado.compra?.insertados || 0) + (resultado.venta?.insertados || 0)
  const duplicados = (resultado.compra?.duplicados || 0) + (resultado.venta?.duplicados || 0)

  t.resultado = {
    ...resultado,
    insertados_total: insertados,
    duplicados_total: duplicados,
    errores_totales: (resultado.compra?.errores?.length || 0) + (resultado.venta?.errores?.length || 0),
  }
  t.estado = huboError ? 'completado_con_errores' : 'completado'

  registrarAccion(dbInstancia, {
    empresaId, usuarioId,
    accion: 'documentos.ingesta_completada', entidad: 'documentos', entidadId: periodo,
    despues: { estado: t.estado, insertados: insertados, duplicados, detalle: t.resultado },
    ip,
  })
}

/** Trabajos activos/terminados de un usuario (para re-attach de la UI). */
function listarDeUsuario(usuarioId) {
  const lista = []
  for (const t of trabajos.values()) {
    if (t.usuarioId === usuarioId) {
      lista.push(obtenerEstado(t.jobId, usuarioId))
    }
  }
  return lista.sort((a, b) => (a.jobId < b.jobId ? 1 : -1))
}

module.exports = { iniciar, obtenerEstado, listarDeUsuario, trabajos }
