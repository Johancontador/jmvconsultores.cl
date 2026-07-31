inicializarRangoMesAnio('exp')

const $btnGenerar = document.getElementById('exp-btn-generar')
const $progress = document.getElementById('exp-progress')
const $progressFill = document.getElementById('exp-progress-fill')
const $progressDetail = document.getElementById('exp-progress-detail')
const $resultado = document.getElementById('exp-resultado')

$btnGenerar.addEventListener('click', async () => {
  const r = leerRangoMesAnio('exp')
  const errorValidacion = validarRangoMesAnio(r)
  if (errorValidacion) {
    showToast(errorValidacion, 'error')
    return
  }

  $btnGenerar.disabled = true
  $resultado.innerHTML = ''
  $progress.hidden = false
  $progressFill.style.width = '0%'
  $progressDetail.textContent = 'Iniciando…'

  try {
    const data = await apiPost('/api/exportacion-masiva/generar', {
      anio_inicio: r.anioInicio, anio_fin: r.anioFin, mes_inicio: r.mesInicio, mes_fin: r.mesFin,
    })

    iniciarPolling(
      () => apiGet(`/api/exportacion-masiva/${data.export_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressFill.style.width = `${pct}%`
          $progressDetail.textContent = estado.procesando
            ? `Cliente ${estado.procesados + 1} de ${estado.total}: ${estado.procesando}`
            : `${estado.procesados} de ${estado.total} clientes procesados`

          if (estado.estado === 'completado') {
            $progress.hidden = true
            $btnGenerar.disabled = false
            const erroresHtml = estado.errores.length === 0 ? '' : `
              <div class="libro-warning">
                ⚠ ${estado.errores.length} cliente${estado.errores.length > 1 ? 's' : ''} no se pud${estado.errores.length > 1 ? 'ieron' : 'o'} exportar:
                ${estado.errores.map((e) => `<strong>${escapeHtml(e.cliente)}</strong> (${escapeHtml(e.error)})`).join(', ')}
              </div>`
            $resultado.innerHTML = `
              ${erroresHtml}
              <div class="empty-state">
                <p>✅ Reporte listo.</p>
                <a class="btn btn-primary" href="/api/exportacion-masiva/${data.export_id}/descargar">⬇ Descargar ZIP</a>
              </div>`
          } else if (estado.estado === 'error') {
            $progress.hidden = true
            $btnGenerar.disabled = false
            showToast(estado.error_msg || 'Error al generar el reporte masivo', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
        intervalo: 2000,
      }
    )
  } catch (err) {
    $progress.hidden = true
    $btnGenerar.disabled = false
    showToast(err.message, 'error')
  }
})
