const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let ultimaConsulta = 0
const INTERVALO_MS = 1200

async function esperarRateLimit() {
  const ahora = Date.now()
  const transcurrido = ahora - ultimaConsulta
  if (transcurrido < INTERVALO_MS) {
    await sleep(INTERVALO_MS - transcurrido)
  }
  ultimaConsulta = Date.now()
}

async function consultarRCV(rut, clave, tipo, periodo, reintento = false) {
  await esperarRateLimit()

  const url = `https://api.simpleapi.cl/api/v1/rcv/${tipo}`
  const params = new URLSearchParams({ rut, clave, periodo })

  let res
  try {
    res = await fetch(`${url}?${params}`, {
      headers: { Authorization: process.env.SIMPLEAPI_KEY },
      signal: AbortSignal.timeout(30000),
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('Timeout — reintentar')
    }
    throw new Error('SII no disponible')
  }

  if (res.status === 401) throw new Error('Clave SII incorrecta')
  if (res.status === 429) {
    if (!reintento) {
      await sleep(5000)
      return consultarRCV(rut, clave, tipo, periodo, true)
    }
    throw new Error('Límite de consultas alcanzado')
  }
  if (res.status >= 500) throw new Error('SII no disponible')
  if (!res.ok) throw new Error(`Error SII: HTTP ${res.status}`)

  const data = await res.json()
  return Array.isArray(data) ? data : []
}

module.exports = { consultarRCV, sleep, INTERVALO_MS }
