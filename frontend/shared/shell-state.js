/**
 * Estado compartido entre header, barra de filtros global y el panel central:
 * cliente activo y rango Año/Mes. Persistido en sessionStorage para sobrevivir
 * un F5 dentro de la misma pestaña, sin depender de la URL.
 */
const ShellState = (() => {
  const KEY_CLIENTE = 'iva_shell_cliente_id'
  const KEY_RANGO = 'iva_shell_rango'
  const listeners = []

  function getClienteId() {
    const v = sessionStorage.getItem(KEY_CLIENTE)
    return v ? Number(v) : null
  }

  function setClienteId(id) {
    sessionStorage.setItem(KEY_CLIENTE, String(id))
    notificar()
  }

  function getRango() {
    const raw = sessionStorage.getItem(KEY_RANGO)
    if (raw) {
      try { return JSON.parse(raw) } catch { /* cae al default */ }
    }
    const ahora = new Date()
    return {
      anioInicio: ahora.getFullYear(),
      mesInicio: 1,
      anioFin: ahora.getFullYear(),
      mesFin: ahora.getMonth() + 1,
    }
  }

  function setRango(rango) {
    sessionStorage.setItem(KEY_RANGO, JSON.stringify(rango))
    notificar()
  }

  function onCambio(fn) {
    listeners.push(fn)
  }

  function notificar() {
    listeners.forEach((fn) => fn())
  }

  // Único lugar que decide si un informe ya guardado (fila de GET /api/informe,
  // con anio_inicio/anio_fin/mes_inicio/mes_fin) alcanza para cubrir el rango
  // pedido — reportes.js y dashboard.js comparten esta misma función en vez de
  // cada uno definir su propia copia.
  function cubreRango(informe, rango) {
    const inicioOk = informe.anio_inicio < rango.anioInicio ||
      (informe.anio_inicio === rango.anioInicio && informe.mes_inicio <= rango.mesInicio)
    const finOk = informe.anio_fin > rango.anioFin ||
      (informe.anio_fin === rango.anioFin && informe.mes_fin >= rango.mesFin)
    return inicioOk && finOk
  }

  return { getClienteId, setClienteId, getRango, setRango, onCambio, cubreRango }
})()

window.ShellState = ShellState
