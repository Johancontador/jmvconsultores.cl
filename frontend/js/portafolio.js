/**
 * Landing / Portafolio multi-cliente ("Dashboard del Contador").
 *
 * Antes la pantalla inicial quedaba vacía hasta elegir cliente; ahora muestra
 * el estado de TODAS las empresas al instante: KPIs agregados, próximos
 * vencimientos F29, tarjetas por cliente y accesos rápidos. Solo lee datos ya
 * persistidos (GET /api/clientes, GET /api/informe) — cero consultas al SII.
 *
 * Se apoya en las funciones globales de dashboard.js (fmt, fmtCorto) y del
 * shell; se carga después de dashboard.js.
 */

const _portaCharts = {}

function _portaDestruirCharts() {
  Object.values(_portaCharts).forEach((c) => c && c.destroy())
  for (const k of Object.keys(_portaCharts)) delete _portaCharts[k]
}

function _portaIcono(estado) {
  return { conectado: '✅', 'sin-datos': '⚪', sincronizando: '🔄', error: '🔴' }[estado] || '⚪'
}

function _portaNombreMes(m) {
  return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][m - 1] || ''
}

function _portaVenceF29(anio, mes) {
  // F29 del mes M se declara en M+1, vence el día 20 (electrónico)
  const mesDecl = mes === 12 ? { y: anio + 1, m: 1 } : { y: anio, m: mes + 1 }
  return new Date(mesDecl.y, mesDecl.m - 1, 20)
}

// ============ CARGA DE DATOS ============

async function _portaCargar() {
  const [clientes, informes] = await Promise.all([
    apiGet('/api/clientes'),
    apiGet('/api/informe?limit=200'),
  ])

  // Último informe por cliente (la lista viene ordenada por creado_en DESC)
  const ultimoPorCliente = new Map()
  for (const inf of informes.informes || []) {
    if (!ultimoPorCliente.has(inf.cliente_id)) ultimoPorCliente.set(inf.cliente_id, inf)
  }

  const portafolio = []
  for (const c of clientes) {
    const inf = ultimoPorCliente.get(c.id) || null
    let meses = []
    let resumen = inf?.resumen || null
    // Cargar meses del último informe (los listados no traen meses — solo el resumen)
    if (inf && inf.estado === 'completado') {
      try {
        const det = await apiPost(`/api/informe/${inf.id}/cargar`, {})
        meses = (det.meses || []).filter((m) => m.estado === 'ok')
        resumen = det.resumen || resumen
      } catch { /* informe corrupto: queda sin meses */ }
    }
    portafolio.push({ cliente: c, informe: inf, meses, resumen })
  }
  return portafolio
}

// ============ RENDER ============

function _portaKpis(portafolio) {
  const conDatos = portafolio.filter((p) => p.resumen)
  const ventas = conDatos.reduce((s, p) => s + (p.resumen.ventas_neto || 0), 0)
  const compras = conDatos.reduce((s, p) => s + (p.resumen.compras_neto || 0), 0)
  const iva = conDatos.reduce((s, p) => s + (p.resumen.iva_pagar || 0), 0)

  const kpi = (label, valor, color = '') =>
    `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-valor" style="${color ? `color:${color}` : ''}">${valor}</div></div>`

  return `
    ${kpi('Empresas', portafolio.length)}
    ${kpi('Con datos sincronizados', `${conDatos.length}/${portafolio.length}`, conDatos.length === portafolio.length ? 'var(--success)' : 'var(--warning)')}
    ${kpi('Ventas agregadas (últ. informe c/u)', fmt(ventas), 'var(--accent)')}
    ${kpi('Compras agregadas', fmt(compras))}
    ${kpi('IVA neto agregado', iva < 0 ? `Remanente ${fmt(Math.abs(iva))}` : fmt(iva), iva < 0 ? 'var(--accent)' : 'var(--warning)')}`
}

function _portaVencimientos(portafolio) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const items = []
  for (const p of portafolio) {
    const ultimoMes = p.meses[p.meses.length - 1]
    if (!ultimoMes) continue
    const venc = _portaVenceF29(ultimoMes.anio, ultimoMes.mes)
    const dias = Math.ceil((venc - hoy) / 86400000)
    const atrasado = dias < 0
    const cerca = dias >= 0 && dias <= 7
    const iva = ultimoMes.iva_pagar
    items.push({ p, ultimoMes, venc, dias, atrasado, cerca, iva })
  }
  items.sort((a, b) => a.dias - b.dias)

  if (!items.length) {
    return '<p class="libro-nota">Sin informes sincronizados todavía — sincroniza una empresa para ver sus vencimientos aquí.</p>'
  }

  return `
    <table class="informe-table libro-table">
      <thead><tr><th>Empresa</th><th>Período</th><th>Vence F29</th><th>Días</th><th>IVA determinado</th></tr></thead>
      <tbody>
        ${items.map((it) => {
          const badge = it.atrasado
            ? `<span class="cal-badge cal-vencido">${Math.abs(it.dias)}d vencido</span>`
            : it.cerca
              ? `<span class="cal-badge cal-proximo">en ${it.dias}d</span>`
              : `<span class="cal-badge cal-ok">en ${it.dias}d</span>`
          return `
          <tr>
            <td>${_portaIcono(it.p.informe?.estado === 'completado' ? 'conectado' : 'sin-datos')} ${escapeHtml(it.p.cliente.nombre)}</td>
            <td>${_portaNombreMes(it.ultimoMes.mes)} ${it.ultimoMes.anio}</td>
            <td class="text-mono">${String(it.venc.getDate()).padStart(2, '0')}/${String(it.venc.getMonth() + 1).padStart(2, '0')}/${it.venc.getFullYear()}</td>
            <td>${badge}</td>
            <td class="text-mono">${it.iva < 0 ? `Remanente ${fmt(Math.abs(it.iva))}` : fmt(it.iva)}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`
}

function _portaAcciones() {
  const irA = (tipo, label) => `<button type="button" class="btn btn-secondary btn-sm porta-accion" data-tipo="${tipo}">${label}</button>`
  return `
    ${irA('validador-iva', '🛡️ Validador IVA')}
    ${irA('pendientes', '📄 Pendientes')}
    ${irA('duplicadas', '🔍 Duplicadas')}
    ${irA('comparador-f29', '📊 Comparador F29')}
    ${irA('intereses', '🧮 Interés penal')}
    ${irA('checklist-cierre', '☑️ Checklist cierre')}
    ${irA('cobranza', '💬 Cobranza')}
    ${irA('conversor-dte', '📥 Convertir DTE')}
    ${irA('calendario-tributario', '📅 Calendario')}
    ${irA('observaciones', '🛡️ Observaciones')}`
}

function _portaClientesHtml(portafolio) {
  if (!portafolio.length) {
    return `<div class="empty-state"><div class="empty-state-icon">👥</div><h3 class="empty-state-title">Sin empresas todavía</h3><p class="empty-state-desc">Agrega tu primera empresa en la sección Clientes para comenzar.</p></div>`
  }
  return portafolio.map((p) => {
    const r = p.resumen
    const estado = p.informe?.estado === 'completado' ? 'conectado' : 'sin-datos'
    const ultimo = p.meses[p.meses.length - 1]
    return `
      <div class="dash-card porta-cliente" data-cliente-id="${p.cliente.id}" role="button" tabindex="0" title="Abrir dashboard de ${escapeHtml(p.cliente.nombre)}">
        <div class="flex-between">
          <div class="porta-cliente-nombre">${_portaIcono(estado)} ${escapeHtml(p.cliente.nombre)}</div>
          <span class="reporte-chip">🆔 ${formatRut(p.cliente.rut)}</span>
        </div>
        <div class="porta-cliente-sub">${p.informe ? `Últ. sincronización: ${_portaNombreMes(p.informe.mes_inicio)} ${p.informe.anio_inicio} — ${_portaNombreMes(p.informe.mes_fin)} ${p.informe.anio_fin}` : 'Sin sincronizar — clic para conectar'}</div>
        ${r ? `
        <div class="porta-mini-kpis">
          <span>Ventas <strong>${fmt(r.ventas_neto)}</strong></span>
          <span>Margen <strong>${fmt(r.margen)}</strong> (${r.pct_margen}%)</span>
          <span>IVA <strong>${r.iva_pagar < 0 ? `Rem. ${fmt(Math.abs(r.iva_pagar))}` : fmt(r.iva_pagar)}</strong></span>
        </div>` : ''}
        ${ultimo ? `<div class="porta-cliente-sub" style="margin-top:0.5rem">F29 de ${_portaNombreMes(ultimo.mes)}: vence ${_portaVenceF29(ultimo.anio, ultimo.mes).getDate()}/${_portaVenceF29(ultimo.anio, ultimo.mes).getMonth() + 1} ${_portaVenceF29(ultimo.anio, ultimo.mes).getFullYear()}</div>` : ''}
      </div>`
  }).join('')
}

function _portaEnlazar(portafolio) {
  document.querySelectorAll('#porta-clientes .porta-cliente').forEach((el) => {
    const abrir = () => {
      const id = Number(el.dataset.clienteId)
      window.ShellState.setClienteId(id)
      document.getElementById('topbar-select-cliente').value = String(id)
      showToast(`Empresa seleccionada — presiona "⚡ Conectar" si necesitas actualizar datos`, 'info')
    }
    el.addEventListener('click', abrir)
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } })
  })
  document.querySelectorAll('#porta-acciones .porta-accion').forEach((btn) => {
    btn.addEventListener('click', () => window.ShellRouter.mostrarReporte(btn.dataset.tipo))
  })
}

async function portaMostrar() {
  const $porta = document.getElementById('portafolio')
  const $dash = document.getElementById('dash-content')
  const $empty = document.getElementById('dash-empty')
  if (!$porta) return

  $porta.hidden = false
  $porta.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="section-title">Portafolio de clientes</h2>
        <p class="page-subtitle">Cargando estado de tus empresas…</p>
      </div>
    </div>`

  let portafolio
  try {
    portafolio = await _portaCargar()
  } catch (err) {
    $porta.innerHTML = `<div class="empty-state"><p>No se pudo cargar el portafolio: ${escapeHtml(err.message)}</p></div>`
    return
  }

  const sinClienteActivo = !window.ShellState.getClienteId()
  if (sinClienteActivo && $dash) { $dash.hidden = true }
  if (sinClienteActivo && $empty) { $empty.hidden = true }

  $porta.innerHTML = `
    <div class="page-header">
      <div>
        <h2 class="section-title">Portafolio de clientes</h2>
        <p class="page-subtitle">Estado de sincronización y vencimientos de todas tus empresas — haz clic en una para trabajar con sus datos</p>
      </div>
    </div>
    <section class="kpi-grid">${_portaKpis(portafolio)}</section>
    <div class="dash-grid" style="margin-bottom:1.5rem">
      <div class="dash-card dash-card-wide">
        <h3>⏰ Próximos vencimientos F29</h3>
        ${_portaVencimientos(portafolio)}
      </div>
      <div class="dash-card dash-card-wide">
        <h3>⚡ Accesos rápidos</h3>
        <div class="porta-acciones">${_portaAcciones()}</div>
      </div>
    </div>
    <h3 class="section-title">Empresas</h3>
    <div class="dash-grid">${_portaClientesHtml(portafolio)}</div>`

  _portaEnlazar(portafolio)
}

function portaOcultar() {
  const $porta = document.getElementById('portafolio')
  if ($porta) $porta.hidden = true
  _portaDestruirCharts()
}

window.Portafolio = { mostrar: portaMostrar, ocultar: portaOcultar }
