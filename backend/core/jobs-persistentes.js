/**
 * jobs-persistentes.js — Persistencia de trabajos largos en SQLite
 * (BLOQUE 2 del plan de corrección de riesgos, masterplan 2026-10-10).
 *
 * Problema que resuelve (auditoría R2): los jobs largos (ingesta histórica de
 * 36 meses, sync diaria) viven en Map del proceso; un reinicio a mitad los
 * pierde. Esta capa persiste ESTADO y PROGRESO en SQLite y permite:
 *
 *  - Estados explícitos: pendiente | ejecutando | completado | fallido | cancelado
 *  - Checkpoint por período (progreso fino: qué período quedó hecho)
 *  - REANUDACIÓN tras reinicio: los trabajos "ejecutando" al arrancar pasan a
 *    "pendiente" (estado señal con motivo 'restart') y pueden re-ejecutarse
 *    desde el último período completado (idempotencia la aporta el dedupe
 *    de la ingesta, no esta capa).
 *  - EXCLUSIÓN MUTUA: no habilita re-executar mientras exista otro job vivo
 *    (`pendiente`/`ejecutando`) con el MISMO tipo y payload-clave — el llamador
 *    decide (lanzar reanudación explícita o esperar).
 *  - Errores por período quedan en checkpoint_json (nunca invisibles).
 *  - Compatible con jobs-memoria.js: esta capa NO sustituye el patrón Map
 *    para los jobs EN VIVO (la promesa sigue esperándose en tests); persiste
 *    el estado y permite reanudar lo que el Map perdió.
 *
 * Módulo puro: BD por parámetro. Nada de Express. Jamás imprime secretos.
 */

const JOB_LOCK_TIMEOUT_MIN = 30 // lock huérfano (crash sin marcar) libera tras 30 min

function migrar(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs_persistentes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,                 -- 'historico_rcv' | 'sync_diaria' | ...
      clave_unicidad TEXT NOT NULL,       -- anti-doble-ejecución: tipo+empresa+payload
      empresa_id INTEGER,
      usuario_id INTEGER,
      periodo_desde TEXT,
      periodo_hasta TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente','ejecutando','completado','fallido','cancelado')),
      progreso_json TEXT,                 -- { periodos_completados: [], errores: {} }
      intentos INTEGER NOT NULL DEFAULT 0,
      max_intentos INTEGER NOT NULL DEFAULT 3,
      error TEXT,
      iniciado_en TEXT,
      actualizado_en TEXT,
      terminado_en TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_p_estado ON jobs_persistentes(estado);
    CREATE INDEX IF NOT EXISTS idx_jobs_p_clave ON jobs_persistentes(tipo, clave_unicidad, estado);
  `)
}

function ahoraISO() { return new Date().toISOString() }

/** Limpia locks huérfanos: jobs 'ejecutando' cuyo latido venció → 'fallido'
 *  con error 'lock expirado (crash?)' y re-landizables a 'pendiente'. */
function liberarLocksVencidos(db) {
  const limite = new Date(Date.now() - JOB_LOCK_TIMEOUT_MIN * 60000).toISOString()
  const rows = db.prepare(`
    SELECT id FROM jobs_persistentes
    WHERE estado = 'ejecutando' AND COALESCE(actualizado_en, '') < ?
  `).all(limite)
  for (const r of rows) {
    db.prepare(`
      UPDATE jobs_persistentes
      SET estado = CASE
            WHEN intentos + 1 < max_intentos THEN 'pendiente'
            ELSE 'fallido' END,
        intentos = intentos + 1,
        error = COALESCE(error, 'lock expirado tras ' || ? || ' min — posible crash'),
        terminado_en = CASE WHEN intentos + 1 >= max_intentos THEN ? ELSE terminado_en END,
        actualizado_en = ?
      WHERE id = ?
    `).run(JOB_LOCK_TIMEOUT_MIN, ahoraISO(), ahoraISO(), r.id)
  }
  if (rows.length) console.log(`[JOBS] ${rows.length} lock(s) huérfano(s) liberados.`)
  return rows.length
}

/**
 * Crea (o devuelve el vivo) un job con exclusión mutua por clave.
 * Devuelve { id, estado, creado: bool, ya_existia: { id, estado } }.
 *
 * BLOQUE 5: un job COMPLETADO de la MISMA clave dentro del día calendario
 * (UTC) también bloquea — es la idempotencia de la sync diaria: re-corridas
 * del mismo día NO re-ejecutan el mismo (empresa, período). Un job fallido
 * o de otro día sí permite crear uno nuevo (reintento natural).
 */
function crear(db, { tipo, claveUnicidad, empresaId = null, usuarioId = null, periodoDesde = null, periodoHasta = null, maxIntentos = 3, ventanaIdempotenciaMin = 24 * 60 }) {
  liberarLocksVencidos(db)
  const vivo = db.prepare(`
    SELECT id, estado FROM jobs_persistentes
    WHERE tipo = ? AND clave_unicidad = ? AND estado IN ('pendiente','ejecutando')
    ORDER BY id DESC LIMIT 1
  `).get(tipo, claveUnicidad)
  if (vivo) return { id: vivo.id, estado: vivo.estado, creado: false, ya_existia: vivo }

  // Completado recientemente con la misma clave → ventana de idempotencia.
  const limite = new Date(Date.now() - ventanaIdempotenciaMin * 60000).toISOString()
  const hecho = db.prepare(`
    SELECT id, estado FROM jobs_persistentes
    WHERE tipo = ? AND clave_unicidad = ? AND estado = 'completado' AND COALESCE(terminado_en, '') >= ?
    ORDER BY id DESC LIMIT 1
  `).get(tipo, claveUnicidad, limite)
  if (hecho) return { id: hecho.id, estado: hecho.estado, creado: false, ya_existia: hecho }

  const info = db.prepare(`
    INSERT INTO jobs_persistentes (tipo, clave_unicidad, empresa_id, usuario_id, periodo_desde, periodo_hasta, estado, progreso_json, max_intentos, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, 'pendiente', ?, ?, ?)
  `).run(tipo, claveUnicidad, empresaId, usuarioId, periodoDesde, periodoHasta,
         JSON.stringify({ periodos_completados: [], errores: {} }),
         Number(maxIntentos) || 3, ahoraISO())
  return { id: Number(info.lastInsertRowid), estado: 'pendiente', creado: true, ya_existia: null }
}

/** Toma el job para ejecutarlo: pendiente→ejecutando (transacción defensiva). */
function tomar(db, jobId) {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  if (fila.estado === 'ejecutando') {
    // podría ser otro proceso o un lock huérfano no vencido: rechazo explícito
    throw new Error(`El job ${jobId} ya está ejecutándose (lock activo)`)
  }
  if (fila.estado === 'cancelado') throw new Error(`El job ${jobId} fue cancelado`)
  if (fila.estado === 'completado') throw new Error(`El job ${jobId} ya está completado`)
  db.prepare(`UPDATE jobs_persistentes SET estado = 'ejecutando', iniciado_en = COALESCE(iniciado_en, ?), actualizado_en = ? WHERE id = ?`)
    .run(ahoraISO(), ahoraISO(), jobId)
  fila.estado = 'ejecutando'
  fila.iniciado_en = fila.iniciado_en || ahoraISO()
  return fila
}

function obtener(db, jobId) {
  const fila = db.prepare(`SELECT * FROM jobs_persistentes WHERE id = ?`).get(Number(jobId))
  if (!fila) return null
  fila.progreso = JSON.parse(fila.progreso_json || '{}')
  return fila
}

/** Espresso checkpoint: marca un período COMPLETADO (idempotente). */
function checkpointPeriodo(db, jobId, periodo, detalle = {}) {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  const p = fila.progreso || { periodos_completados: [], errores: {} }
  if (!p.periodos_completados.includes(periodo)) p.periodos_completados.push(periodo)
  delete p.errores[periodo]
  db.prepare(`UPDATE jobs_persistentes SET progreso_json = ?, actualizado_en = ? WHERE id = ?`)
    .run(JSON.stringify(p), ahoraISO(), jobId)
  return p.periodos_completados.length
}

/** Registra el error de un período (reintentos después lo borran). */
function errorPeriodo(db, jobId, periodo, mensaje) {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  const p = fila.progreso || { periodos_completados: [], errores: {} }
  p.errores[periodo] = String(mensaje).slice(0, 500)
  db.prepare(`UPDATE jobs_persistentes SET progreso_json = ?, actualizado_en = ? WHERE id = ?`)
    .run(JSON.stringify(p), ahoraISO(), jobId)
}

/** Péndientes de un job: períodos del rango SIN checkpoint (los que faltan). */
function periodosFaltantes(db, jobId, periodosTotales) {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  const done = new Set((fila.progreso?.periodos_completados || []))
  return periodosTotales.filter((p) => !done.has(String(p)))
}

/** Finaliza: completado|fallido|cancelado. Intento extra si falla para retry. */
function finalizar(db, jobId, estadoFinal, error = null) {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  const esCompletado = estadoFinal === 'completado'
  const esCancelado = estadoFinal === 'cancelado'
  const intentos = fila.intentos + 1
  const puedeReintentar = !esCompletado && !esCancelado && intentos < fila.max_intentos
  db.prepare(`
    UPDATE jobs_persistentes
    SET estado = CASE WHEN ? != 'completado' AND ? != 'cancelado' AND ? < max_intentos THEN 'pendiente' ELSE ? END,
        intentos = ?, error = ?, terminado_en = CASE WHEN ? = 'completado' OR ? = 'cancelado' OR ? >= max_intentos THEN ? ELSE NULL END, actualizado_en = ?
    WHERE id = ?
  `).run(estadoFinal, estadoFinal, intentos, estadoFinal, intentos, error, estadoFinal, estadoFinal, intentos, ahoraISO(), ahoraISO(), jobId)
  return { id: jobId, estado: puedeReintentar && estadoFinal !== 'completado' ? 'pendiente (reintento)' : estadoFinal, intentos }
}

/** Cancelación humana: solo si no está completado. */
function cancelar(db, jobId, motivo = 'cancelado por el usuario') {
  const fila = obtener(db, jobId)
  if (!fila) throw new Error('Job no encontrado')
  if (fila.estado === 'completado') throw new Error('El job ya completó — nada que cancelar')
  if (fila.estado === 'cancelado') throw new Error('El job ya está cancelado')
  db.prepare(`UPDATE jobs_persistentes SET estado = 'cancelado', error = ?, terminado_en = ?, actualizado_en = ? WHERE id = ?`)
    .run(motivo, ahoraISO(), ahoraISO(), jobId)
  return { ok: true }
}

/** Listado para observar (dashboard de jobs): últimos primero. */
function listar(db, { tipo = null, empresaId = null, limit = 50 } = {}) {
  const where = []
  const params = []
  if (tipo) { where.push('tipo = ?'); params.push(tipo) }
  if (empresaId) { where.push('empresa_id = ?'); params.push(empresaId) }
  const rows = db.prepare(`
    SELECT * FROM jobs_persistentes ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ?`).all(...params, Number(limit) || 50)
  return rows.map((r) => ({ ...r, progreso: JSON.parse(r.progreso_json || '{}') }))
}

/** Recuperación al arranque: trabaja "ejecutando" que quedaron colgados. */
function recuperarAlArranque(db) {
  const liberados = liberarLocksVencidos(db)
  // Los 'ejecutando' con latido reciente (crash MUY reciente o процес vivo):
  // NO los tocamos (el proceso dueño seguirá latiendo). Solo liberamos vencidos.
  return { locksLiberados: liberados }
}

module.exports = {
  migrar, crear, tomar, obtener, checkpointPeriodo, errorPeriodo,
  periodosFaltantes, finalizar, cancelar, listar, recuperarAlArranque,
  liberarLocksVencidos, JOB_LOCK_TIMEOUT_MIN,
}
