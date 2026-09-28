/**
 * Vista de aterrizaje (landing) del shell: 5 KPIs, barra Ventas vs Compras,
 * línea de evolución de IVA, y dona de compras por proveedor. Reutiliza la
 * MISMA respuesta de /api/informe (igual dato que consumen los reportes de
 * reportes.js) — no hay cálculos nuevos en el backend.
 */
const COLOR_ACCENT = '#2563eb'
const COLOR_ACCENT_HOVER = '#3b82f6'
const COLOR_SUCCESS = '#10b981'
const COLOR_ERROR = '#ef4444'
const COLOR_TEXT_SECONDARY = '#94a3b8'
const COLOR_GRID = 'rgba(255,255,255,0.06)'
const COLORES_DONA = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#10b981', '#f59e0b', '#94a3b8']

let _charts = {}
let _ultimoDato = null

function _chartDefaults() {
  return {
    plugins: { legend: { labels: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } } } },
    scales: {
      x: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } }, grid: { color: COLOR_GRID } },
      y: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' }, callback: (v) => fmtCorto(v) }, grid: { color: COLOR_GRID } },
    },
  }
}

function _destruirCharts() {
  Object.values(_charts).forEach((c) => c && c.destroy())
  _charts = {}
}

function _variacionPct(actual, previo) {
  if (!previo) return null
  return Math.round(((actual - previo) / Math.abs(previo)) * 1000) / 10
}

function _kpiHtml(icono, label, valor, variacion) {
  const tendenciaHtml = variacion === null ? '' : `
    <span class="kpi-tendencia ${variacion >= 0 ? 'kpi-tendencia-up' : 'kpi-tendencia-down'}">
      ${variacion >= 0 ? '▲' : '▼'} ${Math.abs(variacion)}%
    </span>`
  return `
    <div class="kpi-card kpi-card-bi">
      <div class="kpi-icono">${icono}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-valor">${valor}</div>
      ${tendenciaHtml}
    </div>`
}

function _renderKPIs(data) {
  const r = data.resumen
  const meses = data.meses.filter((m) => m.estado === 'ok')
  const penultimo = meses.length > 1 ? meses[meses.length - 2] : null
  const ultimo = meses.length > 0 ? meses[meses.length - 1] : null

  const $grid = document.getElementById('kpi-grid')
  $grid.innerHTML = [
    _kpiHtml('💰', 'Ventas del Mes', fmt(r.ventas_neto), ultimo && penultimo ? _variacionPct(ultimo.ventas_neto, penultimo.ventas_neto) : null),
    _kpiHtml('🛒', 'Compras', fmt(r.compras_neto), ultimo && penultimo ? _variacionPct(ultimo.compras_neto, penultimo.compras_neto) : null),
    _kpiHtml('📤', 'IVA Débito', fmt(r.debito_fiscal), null),
    _kpiHtml('📥', 'IVA Crédito', fmt(r.credito_fiscal), null),
    _kpiHtml('⚖️', 'Resultado', r.iva_pagar < 0 ? `Remanente ${fmt(Math.abs(r.iva_pagar))}` : `A pagar ${fmt(r.iva_pagar)}`, null),
  ].join('')
}

function _renderGraficos(data) {
  const meses = data.meses.filter((m) => m.estado === 'ok')
  const labels = meses.map((m) => `${m.mes_nombre.slice(0, 3)} ${m.anio}`)

  _destruirCharts()
  const defaults = _chartDefaults()

  _charts.comparativo = new Chart(document.getElementById('chart-comparativo'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ventas', data: meses.map((m) => m.ventas_neto), backgroundColor: COLOR_ACCENT, borderRadius: 6 },
        { label: 'Compras', data: meses.map((m) => m.compras_neto), backgroundColor: COLOR_TEXT_SECONDARY, borderRadius: 6 },
      ],
    },
    options: {
      ...defaults,
      onClick: (evt, elementos) => {
        if (!elementos.length) return
        const m = meses[elementos[0].index]
        window.ShellState.setRango({ anioInicio: m.anio, mesInicio: m.mes, anioFin: m.anio, mesFin: m.mes })
      },
    },
  })

  _charts.ivaEvolucion = new Chart(document.getElementById('chart-iva-evolucion'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Débito Fiscal', data: meses.map((m) => m.debito_fiscal), borderColor: COLOR_ACCENT, tension: 0.3 },
        { label: 'Crédito Fiscal', data: meses.map((m) => m.credito_fiscal), borderColor: COLOR_SUCCESS, tension: 0.3 },
        { label: 'IVA a Pagar', data: meses.map((m) => m.iva_pagar), borderColor: COLOR_ERROR, tension: 0.3 },
      ],
    },
    options: defaults,
  })

  const proveedores = (data.top_proveedores || []).slice(0, 7)
  const $donaCard = document.getElementById('dash-card-dona')
  if (proveedores.length > 0) {
    $donaCard.hidden = false
    _charts.dona = new Chart(document.getElementById('chart-dona-proveedores'), {
      type: 'doughnut',
      data: {
        labels: proveedores.map((p) => p.razonSocial),
        datasets: [{ data: proveedores.map((p) => p.neto), backgroundColor: COLORES_DONA, borderWidth: 0 }],
      },
      options: {
        plugins: {
          legend: { position: 'right', labels: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' }, boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}` } },
        },
      },
    })
  } else {
    $donaCard.hidden = true
  }
}

async function _pintar(data) {
  _ultimoDato = data
  document.getElementById('dash-empty').hidden = true
  document.getElementById('dash-content').hidden = false
  // Subtítulo con contexto: qué empresa y qué período se está mirando —
  // así el usuario nunca duda de qué está viendo el dashboard.
  const rango = window.ShellState.getRango()
  document.getElementById('dash-subtitulo').textContent = data.cliente?.nombre
    ? `${data.cliente.nombre} · ${etiquetaRangoMesAnio(rango)} — cifras netas en CLP`
    : 'Ventas, compras y margen — vista comparativa por período'
  _renderKPIs(data)
  _renderGraficos(data)
}

function _mostrarVacio(mensaje, { conCta = false } = {}) {
  document.getElementById('dash-empty').hidden = false
  document.getElementById('dash-content').hidden = true
  document.getElementById('dash-empty-desc').textContent = mensaje
  document.getElementById('dash-empty-cta').hidden = !conCta
  document.getElementById('dash-subtitulo').textContent = 'Ventas, compras y margen — vista comparativa por período'
}

// El CTA del empty state dispara la misma sincronización que "Conectar" del header —
// dos entradas, una sola acción, sin duplicar lógica.
document.getElementById('btn-conectar-empty')?.addEventListener('click', () => conectar())

async function mostrar() {
  const clienteId = window.ShellState.getClienteId()
  const $porta = document.getElementById('portafolio')
  if (!clienteId) {
    // Landing con portafolio: si hay empresas registradas, mostrar el estado
    // de todas en vez de un empty state vacío.
    try {
      const clientes = await apiGet('/api/clientes')
      if (clientes.length > 0 && window.Portafolio) {
        window.Portafolio.mostrar()
        window.LayoutHeader.setBadge('sin-datos')
        return
      }
    } catch { /* sin sesión o error: cae al empty state */ }
    if ($porta) $porta.hidden = true
    _mostrarVacio('Selecciona una empresa en la barra superior para ver sus cifras.')
    window.LayoutHeader.setBadge('sin-datos')
    return
  }
  if ($porta) $porta.hidden = true
  const r = window.ShellState.getRango()
  try {
    const lista = await apiGet(`/api/informe?cliente_id=${clienteId}&limit=1`)
    const ultimo = lista.informes && lista.informes[0]
    if (ultimo && ultimo.estado === 'completado' && window.ShellState.cubreRango(ultimo, r)) {
      const data = await apiPost(`/api/informe/${ultimo.id}/cargar`, {})
      await _pintar(data)
      window.LayoutHeader.setBadge('conectado')
    } else {
      _mostrarVacio(`No hay datos sincronizados para ${etiquetaRangoMesAnio(r)} — tráelos del SII con un clic.`, { conCta: true })
      window.LayoutHeader.setBadge('sin-datos')
    }
  } catch (err) {
    _mostrarVacio('Sin datos todavía — sincroniza con el SII para poblar el dashboard.', { conCta: true })
    window.LayoutHeader.setBadge('sin-datos')
  }
}

async function conectar() {
  const clienteId = window.ShellState.getClienteId()
  if (!clienteId) { showToast('Selecciona una empresa primero', 'error'); return }
  const r = window.ShellState.getRango()

  window.LayoutHeader.setBadge('sincronizando')
  window.LayoutHeader.setProgreso(0)
  document.getElementById('progress-section-dashboard').hidden = false

  try {
    const data = await apiPost('/api/informe/generar', {
      cliente_id: clienteId, anio_inicio: r.anioInicio, anio_fin: r.anioFin,
      mes_inicio: r.mesInicio, mes_fin: r.mesFin, modo: 'detalle',
    })
    iniciarPolling(
      () => apiGet(`/api/informe/${data.informe_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          window.LayoutHeader.setProgreso(pct)
          document.getElementById('progress-label-dashboard').textContent = `Consultando SII... ${estado.procesados} de ${estado.total} meses`
          if (estado.estado === 'completado') {
            document.getElementById('progress-section-dashboard').hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('conectado')
            _pintar(estado)
            showToast('Dashboard actualizado')
          } else if (estado.estado === 'error') {
            document.getElementById('progress-section-dashboard').hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('sin-datos')
            showToast(estado.error_msg || 'Error al generar dashboard', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    document.getElementById('progress-section-dashboard').hidden = true
    window.LayoutHeader.setProgreso(null)
    window.LayoutHeader.setBadge('sin-datos')
    showToast(err.message, 'error')
  }
}

window.DashboardBI = { mostrar, conectar }
