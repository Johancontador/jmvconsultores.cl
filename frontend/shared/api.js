/**
 * Wrapper de fetch con manejo de errores consistente: siempre devuelve el
 * JSON parseado, y lanza Error(mensaje) si { ok: false } o si la petición
 * falla, para que cada página solo necesite un try/catch alrededor.
 */
async function apiGet(url) {
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`)
  return data
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`)
  return data
}

async function apiPut(url, body) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`)
  return data
}

async function apiDelete(url) {
  const res = await fetch(url, { method: 'DELETE' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) throw new Error(data.error || `Error ${res.status}`)
  return data
}

/** Polling genérico: llama fetchFn() cada `intervalo` ms hasta que devuelva estado terminal.
 * Devuelve una función stop() para cancelar el polling. */
function iniciarPolling(fetchFn, { onUpdate, esTerminal, intervalo = 2000 }) {
  let activo = true
  const tick = async () => {
    if (!activo) return
    try {
      const data = await fetchFn()
      onUpdate(data)
      if (esTerminal(data)) {
        activo = false
        return
      }
    } catch (err) {
      activo = false
      throw err
    }
    if (activo) setTimeout(tick, intervalo)
  }
  tick()
  return () => { activo = false }
}

// Exponer globalmente para scripts que no usan módulos
window.iniciarPolling = iniciarPolling
