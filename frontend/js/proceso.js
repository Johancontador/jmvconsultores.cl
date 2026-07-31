// MESES, fmt, formatRut, showToast, escapeHtml vienen de shared/format.js y
// shared/toast.js (cargados antes que este script).

const $mes = document.getElementById('select-mes')
const $anio = document.getElementById('select-anio')
const $ready = document.getElementById('clientes-ready')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $progressPct = document.getElementById('progress-pct')
const $progressFill = document.getElementById('progress-fill')
const $progressDetail = document.getElementById('progress-detail')
const $progressLog = document.getElementById('progress-log')
const $resultadosHeader = document.getElementById('resultados-header')
const $resultadosSummary = document.getElementById('resultados-summary')
const $resultadosList = document.getElementById('resultados-list')
const $btnReintentar = document.getElementById('btn-reintentar-errores')
const $toast = document.getElementById('toast')

let pollingTimer = null
let procesoId = null
let periodoActual = null
let ultimosResultados = []

function getPeriodo() {
  const mes = String($mes.value).padStart(2, '0')
  return `${$anio.value}${mes}`
}

function llenarSelectores() {
  MESES.forEach((nombre, i) => {
    const opt = document.createElement('option')
    opt.value = i + 1
    opt.textContent = nombre
    $mes.appendChild(opt)
  })

  const ahora = new Date()
  for (let y = ahora.getFullYear(); y >= ahora.getFullYear() - 3; y--) {
    const opt = document.createElement('option')
    opt.value = y
    opt.textContent = y
    $anio.appendChild(opt)
  }

  $mes.value = ahora.getMonth() + 1
  $anio.value = ahora.getFullYear()
}

async function cargarClientes() {
  try {
    const res = await fetch('/api/clientes')
    const clientes = await res.json()
    const n = clientes.length
    $ready.textContent = n === 1
      ? '1 cliente activo listo para procesar'
      : `${n} clientes activos listos para procesar`
    document.getElementById('btn-generar').disabled = n === 0
  } catch {
    $ready.textContent = 'Error al cargar clientes'
  }
}

function renderProgressLog(resultados) {
  $progressLog.innerHTML = resultados.map(r => {
    if (r.estado === 'ok') {
      return `<li class="log-ok">✅ ${escapeHtml(r.nombre)} — ok</li>`
    }
    if (r.estado === 'error') {
      return `<li class="log-error">❌ ${escapeHtml(r.nombre)} — ${escapeHtml(r.error_msg || '')}</li>`
    }
    return ''
  }).join('')
}

function renderResultados(resultados, periodo) {
  ultimosResultados = resultados
  const ok = resultados.filter(r => r.estado === 'ok').length
  const errores = resultados.filter(r => r.estado === 'error').length

  $resultadosHeader.hidden = false
  $resultadosSummary.innerHTML = `
    <span class="summary-ok">✅ ${ok}/${resultados.length} procesados</span>
    ${errores > 0 ? `<span class="summary-error">⚠️ ${errores} error${errores > 1 ? 'es' : ''}</span>` : ''}
  `
  $btnReintentar.hidden = errores === 0

  $resultadosList.innerHTML = resultados.map((r, idx) => renderCard(r, idx)).join('')

  $resultadosList.querySelectorAll('.btn-ver-mensaje').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`mensaje-${btn.dataset.idx}`)
      panel.hidden = !panel.hidden
      btn.textContent = panel.hidden ? 'Ver mensaje' : 'Ocultar mensaje'
    })
  })

  $resultadosList.querySelectorAll('.btn-copiar').forEach(btn => {
    btn.addEventListener('click', () => copiarMensaje(Number(btn.dataset.idx)))
  })

  $resultadosList.querySelectorAll('.btn-whatsapp').forEach(btn => {
    btn.addEventListener('click', () => abrirWhatsApp(Number(btn.dataset.idx)))
  })

  $resultadosList.querySelectorAll('.btn-reintentar').forEach(btn => {
    btn.addEventListener('click', () => reintentarCliente(Number(btn.dataset.id)))
  })
}

function renderCard(r, idx) {
  const borderClass = r.estado === 'error' ? 'card-error' : (r.exento ? 'card-exento' : 'card-ok')

  if (r.estado === 'error') {
    return `
      <article class="resultado-card ${borderClass}">
        <div class="resultado-header">
          <div>
            <h3 class="resultado-nombre">${escapeHtml(r.nombre)}</h3>
            <span class="resultado-rut">${formatRut(r.rut)}</span>
          </div>
          <span class="badge badge-error">ERROR</span>
        </div>
        <p class="resultado-error-msg">${escapeHtml(r.error_msg)}</p>
        <div class="resultado-actions">
          <button type="button" class="btn btn-secondary btn-reintentar" data-id="${r.cliente_id}">Reintentar</button>
        </div>
      </article>`
  }

  const ivaLabel = r.iva_pagar < 0 ? 'Remanente' : 'IVA a pagar'
  const ivaValor = Math.abs(r.iva_pagar)

  let cuerpo = ''
  if (r.exento) {
    cuerpo = `
      <div class="resultado-linea">📦 Compras &nbsp; Neto ${fmt(r.compras_neto)} &nbsp; IVA ${fmt(r.compras_iva)}</div>
      <div class="resultado-linea">🧾 Ventas &nbsp; Neto ${fmt(r.ventas_neto)} &nbsp; IVA ${fmt(r.ventas_iva)}</div>
      <div class="resultado-divider"></div>
      <div class="resultado-linea muted">Sin IVA determinado (exento)</div>
      <div class="resultado-total">TOTAL F29 &nbsp; ${fmt(0)}</div>`
  } else {
    cuerpo = `
      <div class="resultado-linea">📦 Compras &nbsp; Neto ${fmt(r.compras_neto)} &nbsp; IVA ${fmt(r.compras_iva)}</div>
      <div class="resultado-linea">🧾 Ventas &nbsp; Neto ${fmt(r.ventas_neto)} &nbsp; IVA ${fmt(r.ventas_iva)}</div>
      <div class="resultado-divider"></div>
      <div class="resultado-linea">Débito &nbsp; ${fmt(r.debito_fiscal)}</div>
      <div class="resultado-linea">Crédito &nbsp; -${fmt(r.credito_fiscal)}</div>
      <div class="resultado-linea">${ivaLabel} &nbsp; ${fmt(ivaValor)}</div>
      <div class="resultado-linea">PPM ${(r.ppm_monto / r.ventas_neto * 100 || 0).toFixed(1)}% &nbsp; ${fmt(r.ppm_monto)}</div>
      <div class="resultado-divider"></div>
      <div class="resultado-total">TOTAL F29 &nbsp; ${fmt(r.total_f29)}</div>`
  }

  return `
    <article class="resultado-card ${borderClass}">
      <div class="resultado-header">
        <div>
          <h3 class="resultado-nombre">${escapeHtml(r.nombre)}</h3>
          <span class="resultado-rut">${formatRut(r.rut)}</span>
        </div>
        ${r.exento ? '<span class="badge badge-exento">EXENTO</span>' : ''}
      </div>
      <div class="resultado-body">${cuerpo}</div>
      <div class="resultado-actions">
        <button type="button" class="btn btn-secondary btn-ver-mensaje" data-idx="${idx}">Ver mensaje</button>
        <button type="button" class="btn btn-secondary btn-copiar" data-idx="${idx}">📋 Copiar</button>
        <button type="button" class="btn btn-whatsapp btn-whatsapp-action" data-idx="${idx}">💬 WhatsApp</button>
      </div>
      <pre class="mensaje-panel" id="mensaje-${idx}" hidden>${escapeHtml(r.mensaje_whatsapp || '')}</pre>
    </article>`
}

function copiarMensaje(idx) {
  const r = ultimosResultados[idx]
  if (!r?.mensaje_whatsapp) return
  navigator.clipboard.writeText(r.mensaje_whatsapp)
    .then(() => showToast('Mensaje copiado'))
    .catch(() => showToast('No se pudo copiar', 'error'))
}

function abrirWhatsApp(idx) {
  const r = ultimosResultados[idx]
  if (!r?.mensaje_whatsapp || !r.telefono) return
  const tel = r.telefono.replace(/\D/g, '')
  const url = `https://wa.me/${tel}?text=${encodeURIComponent(r.mensaje_whatsapp)}`
  window.open(url, '_blank')
}

async function pollEstado() {
  if (!procesoId) return

  try {
    const res = await fetch(`/api/proceso/${procesoId}/estado`)
    const data = await res.json()
    if (!data.ok) throw new Error(data.error)

    const pct = data.total > 0 ? Math.round((data.procesados / data.total) * 100) : 0
    $progressLabel.textContent = `Procesando clientes... ${data.procesados} de ${data.total}`
    $progressPct.textContent = `${pct}%`
    $progressFill.style.width = `${pct}%`
    $progressDetail.textContent = data.procesando ? `Consultando: ${data.procesando}` : ''
    renderProgressLog(data.resultados)

    if (data.estado === 'completado') {
      clearInterval(pollingTimer)
      $progress.hidden = true
      renderResultados(data.resultados, data.periodo)
      showToast('Proceso completado')
      document.getElementById('btn-generar').disabled = false
    } else if (data.estado === 'error') {
      clearInterval(pollingTimer)
      $progress.hidden = true
      showToast(data.error_msg || 'Error en el proceso', 'error')
      document.getElementById('btn-generar').disabled = false
    }
  } catch (err) {
    clearInterval(pollingTimer)
    $progress.hidden = true
    showToast(err.message, 'error')
    document.getElementById('btn-generar').disabled = false
  }
}

async function generarTodo() {
  periodoActual = getPeriodo()
  document.getElementById('btn-generar').disabled = true
  $resultadosHeader.hidden = true
  $resultadosList.innerHTML = ''
  $progress.hidden = false
  $progressFill.style.width = '0%'
  $progressLog.innerHTML = ''

  try {
    const res = await fetch('/api/proceso/generar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodo: periodoActual }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    procesoId = data.proceso_id

    // Usar el polling compartido
    const stopPolling = iniciarPolling(
      () => apiGet(`/api/proceso/${procesoId}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressLabel.textContent = `Procesando clientes... ${estado.procesados} de ${estado.total}`
          $progressPct.textContent = `${pct}%`
          $progressFill.style.width = `${pct}%`
          $progressDetail.textContent = estado.procesando ? `Consultando: ${estado.procesando}` : ''
          renderProgressLog(estado.resultados)

          if (estado.estado === 'completado') {
            stopPolling()
            $progress.hidden = true
            renderResultados(estado.resultados, estado.periodo)
            showToast('Proceso completado')
            document.getElementById('btn-generar').disabled = false
          } else if (estado.estado === 'error') {
            stopPolling()
            $progress.hidden = true
            showToast(estado.error_msg || 'Error en el proceso', 'error')
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

async function reintentarCliente(clienteId) {
  if (!periodoActual) periodoActual = getPeriodo()

  try {
    const res = await fetch(`/api/proceso/reintentar/${clienteId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ periodo: periodoActual }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)

    const idx = ultimosResultados.findIndex(r => r.cliente_id === clienteId)
    if (idx >= 0) ultimosResultados[idx] = data.resultado
    renderResultados(ultimosResultados, periodoActual)
    showToast(data.resultado.estado === 'ok' ? 'Cliente reintentado con éxito' : data.resultado.error_msg, data.resultado.estado === 'ok' ? 'success' : 'error')
  } catch (err) {
    showToast(err.message, 'error')
  }
}

async function reintentarErrores() {
  const errores = ultimosResultados.filter(r => r.estado === 'error')
  for (const r of errores) {
    await reintentarCliente(r.cliente_id)
  }
}

document.getElementById('btn-generar').addEventListener('click', generarTodo)
$btnReintentar.addEventListener('click', reintentarErrores)

llenarSelectores()
cargarClientes()
