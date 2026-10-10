/**
 * views-crm.js — CRM del despacho (Fase B): pipeline, recordatorios,
 * campañas de fidelización y salud (engagement) de todos los clientes.
 *
 * Es una vista CROSS-EMPRESA: a diferencia del resto, no muestra una empresa
 * sino el portafolio completo (permiso empresas:ver + backend CRM es
 * exclusivo del rol contador/super_admin). Con VIEWS pattern del shell.
 */
/* global VIEWS, $app, esc, apiGet, apiPost, showToast, S, renderRoute */

VIEWS.crm = {
  titulo: 'CRM — Fidelización de Clientes',
  render() { renderCrm() },
}

const ETAPA_CHIP = {
  PROSPECTO: 'neutral', ONBOARDING: 'pendiente', OPERATIVO: 'contabilizado',
  RIESGO: 'anulado', PERDIDO: 'anulado',
}
const SALUD_CHIP = { SANO: 'contabilizado', ATENCION: 'pendiente', CRITICO: 'anulado' }

async function renderCrm() {
  const wrap = document.getElementById('sys-view')
  wrap.innerHTML = '<div class="empty">Cargando CRM…</div>'
  let pipeline, recordatorios, campanas, engagement, alertas
  try {
    ;[pipeline, recordatorios, campanas, engagement, alertas] = await Promise.all([
      apiGet('/api/crm/pipeline'),
      apiGet('/api/crm/recordatorios'),
      apiGet('/api/crm/campanas'),
      apiGet('/api/crm/engagement'),
      apiGet('/api/crm/alertas'),
    ])
  } catch (err) {
    wrap.innerHTML = `<div class="empty">${esc(err.message)}</div>`
    return
  }

  const saludPorEmpresa = new Map((engagement.clientes || []).map((x) => [x.empresa_id, x]))
  const resumen = engagement.resumen || {}

  wrap.innerHTML = `
    <div class="card" id="crm-retencion">
      <h3>Retención proactiva</h3>
      <p class="sub">Clientes con señales reales de riesgo (sin adivinar): sync SII &gt; 30 d, ≥5 docs pendientes, contacto &gt; 60 d o último período vencido aún ABIERTO.</p>
      <div class="tbl-wrap" style="border:none"><table class="tbl">
        <thead><tr><th>Cliente</th><th>Señales</th></tr></thead>
        <tbody>${(alertas.alertas || []).map((a) => `<tr>
          <td><b>${esc(a.nombre)}</b><div class="sub mono">${esc(a.rut)}</div></td>
          <td>${a.motivos.map((m) => `<span class="chip anulado">${esc(m.motivo)}</span> <span class="sub">${esc(m.detalle)}</span>`).join('<br>')}</td>
        </tr>`).join('') || '<tr><td class="muted">Sin alertas — portafolio al día.</td></tr>'}</tbody>
      </table></div>
      ${(alertas.alertas || []).length ? `<div class="frm-row mt">
        <span class="sub">Lote por segmento:</span>
        <select id="crm-lote-seg" class="form-input" style="width:auto">
          <option value="etiqueta:CRITICO">engagement: CRÍTICO</option>
          <option value="etiqueta:ATENCION">engagement: ATENCIÓN</option>
          <option value="etapa:OPERATIVO">etapa: OPERATIVO</option>
        </select>
        <select id="crm-lote-plantilla" class="form-input" style="width:auto">
          ${(campanas.plantillas || []).map((t) => `<option>${t}</option>`).join('')}
        </select>
        <button id="crm-lote-gen" class="btn btn-primary btn-sm">Generar mensajes por lote</button>
        <span id="crm-lote-out" class="sub"></span>
      </div>` : ''}
    </div>

    <div class="kpi-grid mt">
      <div class="kpi up"><small>Sanos</small><strong style="color:var(--success)">${resumen.SANO ?? 0}</strong></div>
      <div class="kpi"><small>Atención</small><strong style="color:var(--warning)">${resumen.ATENCION ?? 0}</strong></div>
      <div class="kpi"><small>Críticos</small><strong style="color:var(--danger)">${resumen.CRITICO ?? 0}</strong></div>
      <div class="kpi acc"><small>Score medio</small><strong>${resumen.promedio ?? 0}</strong></div>
    </div>

    <div class="card mt">
      <h3>Pipeline de clientes</h3>
      <div class="tbl-wrap" style="border:none"><table class="tbl" id="crm-tabla">
        <thead><tr><th>Empresa</th><th>Etapa</th><th>Salud</th><th>Últ. sync SII</th><th>Docs pend.</th><th>Últ. contacto</th><th>Próx. contacto</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(pipeline.pipeline || []).map((p) => {
            const s = saludPorEmpresa.get(p.empresa_id) || {}
            return `<tr data-empresa="${p.empresa_id}">
              <td><b>${esc(p.nombre)}</b><div class="sub mono">${esc(p.rut)}</div></td>
              <td><span class="chip ${ETAPA_CHIP[p.etapa] || 'neutral'}">${esc(p.etapa)}</span></td>
              <td>${s.etiqueta ? `<span class="chip ${SALUD_CHIP[s.etiqueta]}">${s.etiqueta} ${s.score}</span>` : '<span class="sub">—</span>'}</td>
              <td class="mono">${s.dias_desde_sincronizacion == null ? '—' : s.dias_desde_sincronizacion + ' d'}</td>
              <td class="mono">${s.documentos_pendientes ?? '—'}</td>
              <td class="mono">${s.dias_desde_contacto == null ? '—' : s.dias_desde_contacto + ' d'}</td>
              <td class="mono">${esc(p.proximo_contacto || '—')}</td>
              <td class="acc">
                <select class="form-input crm-etapa" style="width:auto; padding:2px 6px">
                  ${(pipeline.etapas || []).map((e) => `<option ${e === p.etapa ? 'selected' : ''}>${e}</option>`).join('')}
                </select>
                <button class="btn btn-sm crm-inter">+ Interacción</button>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table></div>
    </div>

    <div class="grid-2 mt">
      <div class="card">
        <h3>Recordatorios pendientes</h3>
        <div class="tbl-wrap" style="border:none"><table class="tbl">
          <tbody>${(recordatorios.recordatorios || []).map((r) => `<tr>
            <td><b>${esc(r.titulo)}</b><div class="sub">${esc(r.empresa_nombre)} · ${esc(r.tipo)}</div></td>
            <td class="mono">${esc(r.fecha)}</td>
            <td><button class="btn btn-sm crm-rec-done" data-id="${r.id}">✓</button></td>
          </tr>`).join('') || '<tr><td class="muted">Sin pendientes.</td></tr>'}</tbody>
        </table></div>
        <div class="frm-row mt">
          <select id="crm-rec-empresa" class="form-input" style="width:auto">
            ${(pipeline.pipeline || []).map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}
          </select>
          <select id="crm-rec-tipo" class="form-input" style="width:auto">
            ${(recordatorios.tipos || []).map((t) => `<option>${t}</option>`).join('')}
          </select>
          <input id="crm-rec-titulo" class="form-input" placeholder="título" style="width:160px">
          <input id="crm-rec-fecha" class="form-input" type="date" style="width:auto">
          <button id="crm-rec-add" class="btn btn-primary btn-sm">Agregar</button>
        </div>
      </div>
      <div class="card">
        <h3>Campañas de fidelización</h3>
        <div class="frm-row">
          <select id="crm-cam-empresa" class="form-input" style="width:auto">
            ${(pipeline.pipeline || []).map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}
          </select>
          <select id="crm-cam-plantilla" class="form-input" style="width:auto">
            ${(campanas.plantillas || []).map((t) => `<option>${t}</option>`).join('')}
          </select>
          <button id="crm-cam-gen" class="btn btn-primary btn-sm">Generar mensaje</button>
        </div>
        <div id="crm-cam-previa" class="mt sub"></div>
        <div class="tbl-wrap" style="border:none"><table class="tbl">
          <tbody>${(campanas.campanas || []).slice(0, 8).map((c) => `<tr>
            <td><b>${esc(c.empresa_nombre)}</b> · <span class="chip neutral">${esc(c.plantilla)}</span><div class="sub" style="white-space:pre-wrap">${esc(c.mensaje)}</div></td>
            <td>${c.enviado ? '<span class="chip contabilizado">enviado</span>' : `<button class="btn btn-sm crm-cam-env" data-id="${c.id}">Marcar enviado</button>`}</td>
          </tr>`).join('') || '<tr><td class="muted">Sin campañas aún.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`

  // ---- acciones pipeline ----
  wrap.querySelectorAll('tr[data-empresa]').forEach((tr) => {
    const empId = tr.dataset.empresa
    const sel = tr.querySelector('.crm-etapa')
    sel?.addEventListener('change', async () => {
      try {
        await apiPost(`/api/crm/pipeline/${empId}`, { etapa: sel.value })
        showToast('Etapa actualizada', 'success')
        renderRoute()
      } catch (e) { showToast(e.message, 'error') }
    })
    tr.querySelector('.crm-inter')?.addEventListener('click', async () => {
      try {
        await apiPost(`/api/crm/pipeline/${empId}/interaccion`, {})
        showToast('Interacción registrada (hoy)', 'success')
        renderRoute()
      } catch (e) { showToast(e.message, 'error') }
    })
  })

  // ---- recordatorios ----
  document.getElementById('crm-rec-add')?.addEventListener('click', async () => {
    try {
      await apiPost('/api/crm/recordatorios', {
        empresa_id: Number(document.getElementById('crm-rec-empresa').value),
        tipo: document.getElementById('crm-rec-tipo').value,
        titulo: document.getElementById('crm-rec-titulo').value.trim(),
        fecha: document.getElementById('crm-rec-fecha').value,
      })
      showToast('Recordatorio creado', 'success')
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  })
  wrap.querySelectorAll('.crm-rec-done').forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiPost(`/api/crm/recordatorios/${b.dataset.id}/completar`, {})
      showToast('Completado', 'success')
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  }))

  // ---- campañas ----
  document.getElementById('crm-cam-gen')?.addEventListener('click', async () => {
    try {
      const r = await apiPost('/api/crm/campanas', {
        empresa_id: Number(document.getElementById('crm-cam-empresa').value),
        plantilla: document.getElementById('crm-cam-plantilla').value,
      })
      document.getElementById('crm-cam-previa').innerHTML = `<b>Previsualización:</b> ${esc(r.mensaje)}`
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  })
  // ---- lote de retención (Fase C) ----
  document.getElementById('crm-lote-gen')?.addEventListener('click', async () => {
    const [kind, ...rest] = (document.getElementById('crm-lote-seg').value || '').split(':')
    const val = rest.join(':') || null
    const body = { plantilla: document.getElementById('crm-lote-plantilla').value }
    if (kind === 'etiqueta') body.etiqueta = val
    else if (kind === 'etapa') body.etapa = val
    try {
      const r = await apiPost('/api/crm/campanas/lote', body)
      document.getElementById('crm-lote-out').textContent =
        `${r.generadas} generadas · ${r.saltadas_dupe} ya existían · ${r.saltadas_nada} fuera del segmento`
      showToast(`Lote: ${r.generadas} campaña(s) generada(s)`, r.generadas ? 'success' : 'info')
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  })
  wrap.querySelectorAll('.crm-cam-env').forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiPost(`/api/crm/campanas/${b.dataset.id}/enviar`, {})
      showToast('Marcada como enviada', 'success')
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  }))
}
