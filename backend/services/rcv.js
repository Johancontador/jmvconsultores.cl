const db = require('../db')

const PROVIDER = (process.env.RCV_PROVIDER || 'sii').toLowerCase()

// Un período se considera "cerrado" si ya no es el mes en curso — los meses
// cerrados no deberían tener documentos nuevos apareciendo en el SII, así que
// se pueden cachear. El mes actual nunca se cachea (puede seguir cambiando).
function periodoCerrado(periodo) {
  const ahora = new Date()
  const periodoActual = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}`
  return periodo < periodoActual
}

function obtenerDeCache(rut, periodo, tipo) {
  const fila = db
    .prepare(`SELECT datos FROM rcv_cache WHERE rut = ? AND periodo = ? AND tipo = ?`)
    .get(rut, periodo, tipo)
  if (!fila) return null
  try {
    return JSON.parse(fila.datos)
  } catch {
    return null
  }
}

function guardarEnCache(rut, periodo, tipo, datos) {
  db.prepare(`
    INSERT INTO rcv_cache (rut, periodo, tipo, datos, consultado_en)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(rut, periodo, tipo) DO UPDATE SET datos = excluded.datos, consultado_en = excluded.consultado_en
  `).run(rut, periodo, tipo, JSON.stringify(datos))
}

async function consultarRCV(rut, clave, tipo, periodo) {
  const cerrado = periodoCerrado(periodo)

  if (cerrado) {
    const cache = obtenerDeCache(rut, periodo, tipo)
    if (cache) return cache
  }

  const datos = PROVIDER === 'simpleapi'
    ? await require('./simpleapi').consultarRCV(rut, clave, tipo, periodo)
    : await require('./sii-rcv').consultarRCV(rut, clave, tipo, periodo)

  if (cerrado) guardarEnCache(rut, periodo, tipo, datos)

  return datos
}

function getProvider() {
  return PROVIDER
}

module.exports = { consultarRCV, getProvider, periodoCerrado, obtenerDeCache, guardarEnCache }
