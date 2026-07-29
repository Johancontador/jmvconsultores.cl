const $cliente = document.getElementById('select-cliente')
const $modo = document.getElementById('select-modo')
const $estimacion = document.getElementById('estimacion-meta')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $progressPct = document.getElementById('progress-pct')
const $progressFill = document.getElementById('progress-fill')
const $progressDetail = document.getElementById('progress-detail')
const $result = document.getElementById('informe-result')

// fmt, showToast, formatRut vienen de shared/format.js y shared/toast.js
// (cargados antes que este script).

async function cargarClientes() {
  try {
    const res = await fetch('/api/clientes')
    const clientes = await res.json()
    if (clientes.length === 0) {
      $cliente.innerHTML = '<option value="">Sin clientes — agregue uno primero</option>'
      return
    }
    $cliente.innerHTML = clientes.map(c =>
      `<option value="${c.id}">${c.nombre} (${c.rut})</option>`
    ).join('')
  } catch {
    $cliente.innerHTML = '<option value="">Error al cargar</option>'
  }
}

async function actualizarEstimacion() {
  const r = leerRangoMesAnio('informe')
  try {
    const res = await fetch(`/api/informe/estimacion?anio_inicio=${r.anioInicio}&anio_fin=${r.anioFin}&mes_inicio=${r.mesInicio}&mes_fin=${r.mesFin}`)
    const data = await res.json()
    if (!data.ok) return

    $estimacion.textContent = `${data.total_meses} meses · ${data.consultas_estimadas} consultas al SII`
  } catch {
    $estimacion.textContent = ''
  }
}

function renderInforme(data) {
  const { cliente, anio_inicio, anio_fin, mes_inicio, mes_fin, resumen, por_anio, meses, observaciones, modo } = data
  const inicioLabel = mes_inicio ? `${MESES[mes_inicio - 1]} ${anio_inicio}` : String(anio_inicio)
  const finLabel = mes_fin ? `${MESES[mes_fin - 1]} ${anio_fin}` : String(anio_fin)
  const periodoLabel = inicioLabel === finLabel ? inicioLabel : `${inicioLabel} — ${finLabel}`

  let html = `
    <div class="informe-doc-header">
      <h2 class="informe-doc-title">Análisis de Ventas, Compras y Margen Bruto</h2>
      <p class="informe-doc-subtitle">${cliente.nombre} · RUT ${formatRut(cliente.rut)}</p>
      <p class="informe-doc-subtitle">Período: ${periodoLabel} · Cifras en pesos chilenos (CLP) — Montos Netos sin IVA</p>
    </div>

    <div class="informe-section">
      <h3>1. Resumen Ejecutivo</h3>
      <p class="informe-resumen-text">
        En el período ${periodoLabel}, el negocio registró ventas netas acumuladas de
        <strong>${fmt(resumen.ventas_neto)}</strong> frente a compras netas de
        <strong>${fmt(resumen.compras_neto)}</strong>, generando un margen bruto de
        <strong>${fmt(resumen.margen)}</strong> equivalente al
        <strong>${resumen.pct_margen}%</strong> sobre las ventas.
      </p>
      <table class="informe-table">
        <thead>
          <tr>
            <th>Mes</th>
            <th>Ventas Netas</th>
            <th>Compras Netas</th>
            <th>Margen Bruto</th>
            <th>% Margen</th>
          </tr>
        </thead>
        <tbody>`

  for (const grupo of por_anio) {
    if (por_anio.length > 1) {
      html += `<tr><td colspan="5" class="informe-anio-title">${grupo.anio}</td></tr>`
    }
    for (const m of grupo.meses) {
      html += `
        <tr>
          <td>${m.mes_nombre}${por_anio.length > 1 ? '' : ' ' + m.anio}</td>
          <td>${fmt(m.ventas_neto)}</td>
          <td>${fmt(m.compras_neto)}</td>
          <td class="margen-destacado">${fmt(m.margen)}</td>
          <td>${m.pct_margen}%</td>
        </tr>`
    }
    if (por_anio.length > 1) {
      html += `
        <tr class="row-total">
          <td>Total ${grupo.anio}</td>
          <td>${fmt(grupo.ventas_neto)}</td>
          <td>${fmt(grupo.compras_neto)}</td>
          <td class="margen-destacado">${fmt(grupo.margen)}</td>
          <td>${grupo.pct_margen}%</td>
        </tr>`
    }
  }

  html += `
        <tr class="row-total">
          <td>TOTAL ACUMULADO</td>
          <td>${fmt(resumen.ventas_neto)}</td>
          <td>${fmt(resumen.compras_neto)}</td>
          <td class="margen-destacado">${fmt(resumen.margen)}</td>
          <td>${resumen.pct_margen}%</td>
        </tr>
      </tbody></table>
    </div>`

  if (modo === 'detalle') {
    html += `<div class="informe-section"><h3>2. Análisis por Mes</h3>`
    const okMeses = meses.filter(m => m.estado === 'ok')
    for (const m of okMeses) {
      const dv = m.detalle_ventas
      const dc = m.detalle_compras
      html += `
        <div class="mes-detalle">
          <h4>${m.mes_nombre} ${m.anio}</h4>
          <table class="detalle-table">
            <tr><td colspan="2"><strong>Ventas</strong></td></tr>
            <tr><td>Facturas emitidas</td><td>${fmt(dv.facturas)}</td></tr>
            ${dv.notas_debito ? `<tr><td>Notas de débito emitidas</td><td>${fmt(dv.notas_debito)}</td></tr>` : ''}
            ${dv.notas_credito ? `<tr><td>Notas de crédito emitidas</td><td>${fmt(dv.notas_credito)}</td></tr>` : ''}
            <tr class="row-total"><td>Total Ventas Netas</td><td>${fmt(m.ventas_neto)}</td></tr>
            <tr><td colspan="2" style="padding-top:0.75rem"><strong>Compras</strong></td></tr>
            <tr><td>Facturas recibidas</td><td>${fmt(dc.facturas)}</td></tr>
            ${dc.notas_credito ? `<tr><td>Notas de crédito recibidas</td><td>${fmt(dc.notas_credito)}</td></tr>` : ''}
            <tr class="row-total"><td>Total Compras Netas</td><td>${fmt(m.compras_neto)}</td></tr>
            <tr class="row-total"><td>MARGEN BRUTO</td><td class="margen-destacado">${fmt(m.margen)} (${m.pct_margen}%)</td></tr>
          </table>
        </div>`
    }
    html += `</div>`
  }

  const errores = meses.filter(m => m.estado === 'error')
  if (errores.length > 0) {
    html += `<div class="informe-section"><h3>Meses con error</h3><table class="informe-table"><tbody>`
    for (const e of errores) {
      html += `<tr class="row-error"><td>${e.mes_nombre} ${e.anio}</td><td colspan="4">${e.error_msg}</td></tr>`
    }
    html += `</tbody></table></div>`
  }

  html += `
    <div class="informe-section">
      <h3>${modo === 'detalle' ? '3' : '2'}. Tendencias y Observaciones</h3>
      <ul class="obs-list">
        ${observaciones.map(o => `<li>${o}</li>`).join('')}
      </ul>
      <p class="informe-resumen-text" style="margin-top:1rem;font-size:0.8125rem">
        Nota: Informe preparado en base a los libros de compras y ventas del período.
        Todos los montos son netos de IVA. Las notas de crédito se presentan como valores negativos.
      </p>
    </div>
    <div class="informe-actions">
      <button type="button" class="btn btn-secondary" onclick="window.print()">Imprimir / PDF</button>
    </div>`

  $result.innerHTML = html
  $result.hidden = false
}

async function probarSii() {
  const clienteId = $cliente.value
  if (!clienteId) {
    showToast('Seleccione una empresa', 'error')
    return
  }

  const r = leerRangoMesAnio('informe')
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
    modo: $modo.value,
  }

  document.getElementById('btn-generar').disabled = true
  $result.hidden = true
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
          $progressDetail.textContent = estado.procesando
            ? `Consultando: ${estado.procesando}`
            : ''
          if (estado.estado === 'completado') {
            stopPolling()
            $progress.hidden = true
            renderInforme(data)
            showToast('Informe generado')
            document.getElementById('btn-generar').disabled = false
          } else if (estado.estado === 'error') {
            stopPolling()
            $progress.hidden = true
            showToast(estado.error_msg || 'Error al generar informe', 'error')
            document.getElementById('btn-generar').disabled = false
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    $progress.hidden = true
    showToast(err.message, 'error')
    document.getElementById('btn-generar').disabled = false
  }
}

async function probarSii() {
  const clienteId = $cliente.value
  if (!clienteId) {
    showToast('Seleccione una empresa', 'error')
    return
  }

  document.getElementById('btn-probar-sii').disabled = true
  try {
    const res = await fetch('/api/sii/probar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: Number(clienteId) }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Error de conexión')

    showToast(`SII OK — ${data.compras} compras, ${data.ventas} ventas (${data.periodo})`)
    console.log('Pasos conexión SII:', data.pasos)
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    document.getElementById('btn-probar-sii').disabled = false
  }
}

document.getElementById('btn-generar').addEventListener('click', generarInforme)
document.getElementById('btn-probar-sii').addEventListener('click', probarSii)

inicializarRangoMesAnio('informe')
;['informe-mes-inicio', 'informe-anio-inicio', 'informe-mes-fin', 'informe-anio-fin'].forEach((id) => {
  document.getElementById(id).addEventListener('change', actualizarEstimacion)
})

cargarClientes()
actualizarEstimacion()
