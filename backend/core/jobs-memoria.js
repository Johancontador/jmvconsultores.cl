/**
 * Limpieza de jobs en memoria (BLOQUE 1 — seguridad, P2/P3).
 *
 * Los Map de trabajos en segundo plano (ingesta, onboarding, informes,
 * procesos masivos, exportaciones) crecían sin límite: cada job quedaba para
 * siempre en el proceso. Reglas:
 *
 *  - TTL 24 HORAS: las entradas más viejas se purgan perezosamente en cada
 *    registro y en cada consulta de estado (SIN timers — cero riesgo de
 *    mantener vivo el event loop en tests o colgar el shutdown).
 *  - TOPE de 200 entradas: si se supera, se eliminan las más viejas.
 *  - El contrato /:id/estado NO cambia: un job vivo sigue consultable
 *    mientras el proceso exista; la purga solo remueve lo viejo.
 *  - Restricción explícita (CURRENT_STATE §8.2): esto sigue siendo estado de
 *    UN proceso (mono-proceso). Un reinicio pierde los jobs en curso; no se
 *    migra a Redis/BD sin decisión explícita del dueño.
 *
 * Módulo puro: recibe el Map como parámetro, sin BD ni Express.
 */

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRADAS = 200

/** Elimina las entradas sin timestamp o más viejas que el TTL. */
function purgar(trabajos, ahora = Date.now()) {
  for (const [clave, t] of trabajos) {
    if (!t || typeof t !== 'object' || !t.__ts || ahora - t.__ts > TTL_MS) {
      trabajos.delete(clave)
    }
  }
}

/**
 * Registra un job con su timestamp y aplica purga + tope.
 * El objeto conservas su identidad (referencia intacta para los .catch y
 * las actualizaciones de estado en curso).
 */
function registrar(trabajos, clave, estado, ahora = Date.now()) {
  purgar(trabajos, ahora)
  estado.__ts = ahora
  trabajos.set(clave, estado)

  if (trabajos.size > MAX_ENTRADAS) {
    const ordenados = [...trabajos.entries()]
      .filter(([, t]) => t && typeof t === 'object' && t.__ts != null)
      .sort((a, b) => a[1].__ts - b[1].__ts)
    const excedente = trabajos.size - MAX_ENTRADAS
    for (let i = 0; i < excedente; i++) trabajos.delete(ordenados[i][0])
  }
}

module.exports = { purgar, registrar, TTL_MS, MAX_ENTRADAS }
