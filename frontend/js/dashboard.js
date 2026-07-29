const $cliente = document.getElementById('select-cliente')
const $btnGenerar = document.getElementById('btn-generar')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $progressPct = document.getElementById('progress-pct')
const $progressFill = document.getElementById('progress-fill')
const $progressDetail = document.getElementById('progress-detail')
const $empty = document.getElementById('dash-empty')
const $content = document.getElementById('dash-content')
const $kpiGrid = document.getElementById('kpi-grid')

// fmt, fmtCorto, showToast vienen de shared/format.js y shared/toast.js
// (cargados antes que este script).

const COLOR_ACCENT = '#2563eb'
const COLOR_ACCENT_HOVER = '#3b82f6'
const COLOR_SUCCESS = '#10b981'
const COLOR_TEXT_SECONDARY = '#94a3b8'
const COLOR_GRID = 'rgba(255,255,255,0.06)'

let charts = {}

async function cargarClientes() {
  try {
    const res = await fetch('/api/clientes')
    const clientes = await res.json()
    if (clientes.length === 0) {
      $cliente.innerHTML = '<option value="">Sin clientes — agregue uno primero</option>'
      return
    }
    $cliente.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')
  } catch {
    $cliente.innerHTML = '<option value="">Error al cargar</option>'
  }
}

function chartDefaults() {
  return {
    plugins: {
      legend: { labels: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } } },
    },
    scales: {
      x: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } }, grid: { color: COLOR_GRID } },
      y: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' }, callback: v => fmtCorto(v) }, grid: { color: COLOR_GRID } },
    },
  }
}

function destruirCharts() {
  Object.values(charts).forEach(c => c && c.destroy())
  charts = {}
}

function renderKPIs(data) {
  const r = data.resumen
  const items = [
    { label: 'Ventas netas', valor: fmt(r.ventas_neto), color: COLOR_ACCENT },
    { label: 'Compras netas', valor: fmt(r.compras_neto), color: COLOR_TEXT_SECONDARY },
    { label: 'Margen bruto', valor: fmt(r.margen), color: COLOR_SUCCESS },
    { label: '% Margen', valor: `${r.pct_margen}%`, color: COLOR_SUCCESS },
  ]
  $kpiGrid.innerHTML = items.map(i => `
    <div class="kpi-card">
      <div class="kpi-label">${i.label}</div>
      <div class="kpi-valor" style="color:${i.color}">${i.valor}</div>
    </div>`).join('')
}

function renderCharts(data) {
  const meses = data.meses.filter(m => m.estado === 'ok')
  const labels = meses.map(m => `${m.mes_nombre.slice(0, 3)} ${m.anio}`)

  destruirCharts()
  const defaults = chartDefaults()

  charts.ventas = new Chart(document.getElementById('chart-ventas'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Ventas Netas', data: meses.map(m => m.ventas_neto), backgroundColor: COLOR_ACCENT, borderRadius: 6 }] },
    options: { ...defaults, plugins: { ...defaults.plugins, legend: { display: false } } },
  })

  charts.compras = new Chart(document.getElementById('chart-compras'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Compras Netas', data: meses.map(m => m.compras_neto), backgroundColor: COLOR_TEXT_SECONDARY, borderRadius: 6 }] },
    options: { ...defaults, plugins: { ...defaults.plugins, legend: { display: false } } },
  })

  charts.comparativo = new Chart(document.getElementById('chart-comparativo'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ventas', data: meses.map(m => m.ventas_neto), backgroundColor: COLOR_ACCENT, borderRadius: 6 },
        { label: 'Compras', data: meses.map(m => m.compras_neto), backgroundColor: COLOR_TEXT_SECONDARY, borderRadius: 6 },
      ],
    },
    options: defaults,
  })

  charts.margen = new Chart(document.getElementById('chart-margen'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Margen Bruto',
        data: meses.map(m => m.margen),
        borderColor: COLOR_SUCCESS,
        backgroundColor: 'rgba(16,185,129,0.15)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: COLOR_SUCCESS,
      }],
    },
    options: defaults,
  })

  const cardAnual = document.getElementById('dash-card-anual')
  if (data.por_anio.length > 1) {
    cardAnual.hidden = false
    charts.anual = new Chart(document.getElementById('chart-anual'), {
      type: 'bar',
      data: {
        labels: data.por_anio.map(a => String(a.anio)),
        datasets: [
          { label: 'Ventas', data: data.por_anio.map(a => a.ventas_neto), backgroundColor: COLOR_ACCENT, borderRadius: 6 },
          { label: 'Compras', data: data.por_anio.map(a => a.compras_neto), backgroundColor: COLOR_TEXT_SECONDARY, borderRadius: 6 },
          { label: 'Margen', data: data.por_anio.map(a => a.margen), backgroundColor: COLOR_SUCCESS, borderRadius: 6 },
        ],
      },
      options: defaults,
    })
  } else {
    cardAnual.hidden = true
  }
}

async function generarDashboard() {
  const clienteId = $cliente.value
  if (!clienteId) {
    showToast('Seleccione una empresa', 'error')
    return
  }

  const r = leerRangoMesAnio('dash')
  const errorRango = validarRangoMesAnio(r)
  if (errorRango) {
    showToast(errorRango, 'error')
    return
  }

  const body = {
    cliente_id: Number(clienteId),
    anio_inicio: r.anioInicio,
    anio_fin: r.anioFin,
    mes_inicio: r.mesInicio,
    mes_fin: r.mesFin,
    modo: 'resumen',
  }

  $btnGenerar.disabled = true
  $progress.hidden = false
  $progressFill.style.width = '0%'

  try {
    const res = await fetch('/api/informe/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    // Usar el polling compartido
    const stopPolling = iniciarPolling(
      () => apiGet(`/api/informe/${data.informe_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressLabel.textContent = `Consultando SII... ${estado.procesados} de ${estado.total} meses`
          $progressPct.textContent = `${pct}%`
          $progressFill.style.width = `${pct}%`
          $progressDetail.textContent = estado.procesando ? `Consultando: ${estado.procesando}` : ''
          if (estado.estado === 'completado') {
            stopPolling()
            $progress.hidden = true
            $empty.hidden = true
            $content.hidden = false
            renderKPIs(estado)
            if (typeof Chart === 'undefined') {
              throw new Error('No se pudo cargar la librería de gráficos (Chart.js) — revisa tu conexión a internet')
            }
            renderCharts(estado)
            showToast('Dashboard actualizado')
            $btnGenerar.disabled = false
          } else if (estado.estado === 'error') {
            stopPolling()
            $progress.hidden = true
            showToast(estado.error_msg || 'Error al generar dashboard', 'error')
            $btnGenerar.disabled = false
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    $progress.hidden = true
    showToast(err.message, 'error')
    $btnGenerar.disabled = false
  }
}

$btnGenerar.addEventListener('click', generarDashboard)

inicializarRangoMesAnio('dash')
cargarClientes()
