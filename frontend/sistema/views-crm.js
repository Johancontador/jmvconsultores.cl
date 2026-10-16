/**
 * views-crm.js — CRM del despacho (rediseño 2026-10-15).
 *
 * Vista CROSS-EMPRESA (rol contador/super_admin; el backend lo revalida en
 * cada request con guardCrm/accesoEmpresa). Pestañas:
 *
 *   Panel         KPIs comerciales + seguimiento + salud del portafolio
 *   Oportunidades Kanban ↔ Tabla (MISMOS datos, un endpoint), filtros
 *                 combinables, CSV con los permisos vigentes
 *   Fichas        ficha comercial por empresa (maestro `empresas`, RUT real)
 *   Contactos     personas por empresa con dedupe server-side
 *   Prospectos    leads + conversión controlada + importación CSV
 *   Actividades   tareas/llamadas/reuniones/notas con vencimientos
 *   Informes      embudo, conversión, responsable, causas de pérdida
 *   Fidelización  retención/campañas/engagement (módulo existente, intacto)
 *
 * Patrón: mismo shell, VIEWS.crm con render(). Estados vacíos/carga/error
 * con los tokens del sistema; sin librería de drag: cambio de etapa con
 * control en la tarjeta/registro (consistente con cero-dependencias).
 */
/* global VIEWS, esc, apiGet, apiPost, apiDelete, apiPut, showToast, S, renderRoute, openModal, cerrarModal, fmt */

VIEWS.crm = {
  titulo: 'CRM Comercial',
  render() { renderCrm() },
}

const SALUD_CHIP = { SANO: 'contabilizado', ATENCION: 'pendiente', CRITICO: 'anulado' }

/** Maestro de empresas del despacho (llena renderCrm desde /api/crm/pipeline);
 * variable DE MÓDULO — nunca en VIEWS (el escáner T1 interpreta sus claves). */
let _pipelineCache = []

/* ---------- estado de UI persisted por usuario (vistas guardadas) ---------- */
const tabClave = () => `jmv.crm.tab.${S.user.id}`
function tabActual() { return localStorage.getItem(tabClave()) || 'panel' }
function setTab(t) { localStorage.setItem(tabClave(), t); renderCrm() }
const vistasClave = (t) => `jmv.crm.vistas.${S.user.id}.${t}`
function filtroTab(t) {
  try { return JSON.parse(localStorage.getItem(vistasClave(t)) || '{}') } catch { return {} }
}
function setFiltroTab(t, f) { localStorage.setItem(vistasClave(t), JSON.stringify(f)) }

async function renderCrm() {
  const wrap = document.getElementById('sys-view')
  if (!wrap) return
  wrap.innerHTML = `<div class="empty">Cargando CRM…</div>`

  const TABS = [
    ['panel', 'Panel comercial'],
    ['oportunidades', 'Oportunidades'],
    ['fichas', 'Fichas'],
    ['contactos', 'Contactos'],
    ['prospectos', 'Prospectos'],
    ['actividades', 'Actividades'],
    ['informes', 'Informes'],
    ['fidelizacion', 'Fidelización'],
  ]
  const tab = tabActual()

  // Datos base SIEMPRE: pipeline (maestro de empresas) — por tab común.
  let base
  try {
    base = { pipeline: await apiGet('/api/crm/pipeline') }
  } catch (err) {
    wrap.innerHTML = `<div class="empty">${esc(err.message)}</div>`
    return
  }

  wrap.innerHTML = `
    <div class="crm-tabs" role="tablist">
      ${TABS.map(([k, lbl]) => `<button class="crm-tab ${k === tab ? 'activa' : ''}" role="tab" data-tab="${k}">${esc(lbl)}</button>`).join('')}
    </div>
    <div id="crm-cuerpo"></div>`

  wrap.querySelectorAll('.crm-tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)))

  const cuerpo = document.getElementById('crm-cuerpo')
  try {
    if (tab === 'panel') await renderPanel(cuerpo, base)
    else if (tab === 'oportunidades') await renderOportunidades(cuerpo, base)
    else if (tab === 'fichas') await renderFichas(cuerpo, base)
    else if (tab === 'contactos') await renderContactos(cuerpo, base)
    else if (tab === 'prospectos') await renderProspectos(cuerpo, base)
    else if (tab === 'actividades') await renderActividades(cuerpo, base)
    else if (tab === 'informes') await renderInformes(cuerpo)
    else if (tab === 'fidelizacion') await renderFidelizacion(cuerpo, base)
  } catch (err) {
    cuerpo.innerHTML = `<div class="empty"><b>Error</b><p class="muted">${esc(err.message)}</p></div>`
  }
}

/* ================================ PANEL ================================ */

async function renderPanel(cuerpo, base) {
  const [inf, engagement, proximos] = await Promise.all([
    apiGet('/api/crm/informes'),
    apiGet('/api/crm/engagement'),
    apiGet('/api/crm/oportunidades?estado=abiertas&limit=200'),
  ])
  const resumen = engagement.resumen || {}
  const candidatos = (base.pipeline.pipeline || []).filter((p) => p.etapa === 'PROSPECTO')
  // §A: próximos seguimientos (fecha futura u hoy) y vencidos, de oportunidades ABIERTAS.
  const hoy = new Date().toISOString().slice(0, 10)
  const conSeguimiento = (proximos.oportunidades || []).filter((o) => o.fecha_seguimiento)
  const proximas = conSeguimiento.filter((o) => o.fecha_seguimiento >= hoy).sort((a, b) => a.fecha_seguimiento.localeCompare(b.fecha_seguimiento)).slice(0, 6)
  const seguimientoVencido = conSeguimiento.filter((o) => o.fecha_seguimiento < hoy).length
  const porResp = (inf.por_responsable || []).slice(0, 5)

  cuerpo.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><small>Abiertas</small><strong>${inf.abiertas}</strong><div class="sub">de ${inf.total} oportunidades</div></div>
      <div class="kpi up"><small>Ganadas</small><strong style="color:var(--success)">${inf.ganadas}</strong></div>
      <div class="kpi"><small>Perdidas</small><strong style="color:var(--danger)">${inf.perdidas}</strong></div>
      <div class="kpi acc"><small>Conversión</small><strong>${inf.conversion_pct == null ? '—' : inf.conversion_pct + '%'}</strong></div>
      <div class="kpi acc"><small>Proyección ponderada</small><strong>${fmt(inf.proyeccion_ponderada || 0)}</strong></div>
    </div>

    <div class="grid-2 mt">
      <div class="card">
        <h3>Seguimiento pendiente</h3>
        <p class="sub">Vencidas y próximas de <b>actividades</b> reales del CRM.</p>
        <div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
          ${(inf.seguimiento_pendiente.vencidas || []).slice(0, 6).map((a) => `<tr>
            <td><span class="chip anulado">vencida</span> <b>${esc(a.titulo)}</b><div class="sub">${esc(a.empresa_nombre || '')} · ${esc(a.tipo)}</div></td>
            <td class="mono">${esc(a.vencimiento || '')}</td></tr>`).join('') || '<tr><td class="muted">Sin seguimientos vencidos.</td></tr>'}
        </tbody></table></div>
        <div class="frm-row mt"><button class="btn btn-secondary btn-sm" data-ir="actividades">Ir a Actividades →</button></div>
      </div>
      <div class="card">
        <h3>Próximos seguimientos${seguimientoVencido ? ` <span class="chip anulado">${seguimientoVencido} atrasada(s)</span>` : ''}</h3>
        <p class="sub">Fechas de seguimiento de oportunidades ABIERTAS, ordenadas por fecha.</p>
        <div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
          ${proximas.map((o) => `<tr data-id="${o.id}" style="cursor:pointer" class="crm-panel-opo">
            <td><b>${esc(o.nombre)}</b><div class="sub">${esc(o.empresa_nombre)}${o.responsable ? ' · ' + esc(o.responsable) : ''}</div></td>
            <td class="mono">${esc(o.fecha_seguimiento)}</td></tr>`).join('') || '<tr><td class="muted">Sin seguimientos agendados: define «fecha de seguimiento» en tus oportunidades abiertas.</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="card">
        <h3>Salud del portafolio (engagement)</h3>
        <p class="sub">Score 0-100 con datos reales: sync SII, documentos pendientes, cierre y contacto.</p>
        <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="kpi up"><small>Sanos</small><strong style="color:var(--success)">${resumen.SANO ?? 0}</strong></div>
          <div class="kpi"><small>Atención</small><strong style="color:var(--warning)">${resumen.ATENCION ?? 0}</strong></div>
          <div class="kpi"><small>Críticos</small><strong style="color:var(--danger)">${resumen.CRITICO ?? 0}</strong></div>
          <div class="kpi acc"><small>Score medio</small><strong>${resumen.promedio ?? 0}</strong></div>
        </div>
        <div class="frm-row mt"><button class="btn btn-secondary btn-sm" data-ir="fidelizacion">Ver retención y campañas →</button></div>
      </div>
    </div>

    ${(porResp.length ? `
    <div class="card mt">
      <h3>Por responsable</h3>
      <p class="sub">Top ${porResp.length} por proyección ponderada — el detalle completo en Informes.</p>
      <div class="tbl-wrap" style="border:none"><table class="tbl">
        <thead><tr><th>Responsable</th><th>Abiertas</th><th>Ganadas</th><th>Perdidas</th><th>Proyección</th></tr></thead>
        <tbody>${porResp.map((r) => `<tr>
          <td><b>${esc(r.responsable)}</b></td>
          <td class="mono">${r.abiertas}</td><td class="mono">${r.ganadas}</td><td class="mono">${r.perdidas}</td>
          <td class="mono">${fmt(r.proyeccion)}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>` : '')}

    <div class="card mt">
      <h3>Prospectos nuevos sin gestión (${candidatos.length})</h3>
      <div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${candidatos.slice(0, 8).map((p) => `<tr>
          <td><b>${esc(p.nombre)}</b><div class="sub mono">${esc(p.rut)}</div></td>
          <td class="mono">${esc(p.ultima_interaccion ? 'contactado' : 'sin contacto')}</td>
          <td><a class="btn btn-secondary btn-sm" href="#crm" data-pros="">Gestionar en Prospectos →</a></td></tr>`).join('') || '<tr><td class="muted">Sin prospectos en fila.</td></tr>'}
      </tbody></table></div>
      <div class="frm-row mt"><button class="btn btn-primary btn-sm" data-ir="prospectos">Ir a Prospectos →</button></div>
    </div>`
  conectarAtajos(cuerpo)
  // Panel: abrir la oportunidad directamente desde la fila de seguimientos
  cuerpo.querySelectorAll('.crm-panel-opo').forEach((tr) =>
    tr.addEventListener('click', () => modalDetalleOportunidad(Number(tr.dataset.id))))
}

function ladoIzq(fecha) {
  // los fecha_docto guardados son ISO o YYYY-MM-DD — mostramos sólo la parte fecha
  return String(fecha).slice(0, 10)
}

/* ============================ OPORTUNIDADES ============================ */

async function renderOportunidades(cuerpo, base) {
  const f = filtroTab('oportunidades')
  const qs = new URLSearchParams()
  if (f.estado) qs.set('estado', f.estado)
  if (f.etapa) qs.set('etapa', f.etapa)
  if (f.responsable) qs.set('responsable', f.responsable)
  if (f.desde) qs.set('desde', f.desde)
  if (f.hasta) qs.set('hasta', f.hasta)
  if (f.q) qs.set('q', f.q)
  const data = await apiGet(`/api/crm/oportunidades${qs.toString() ? '?' + qs.toString() : ''}`)
  const vista = f.vista || 'kanban'

  const opcionesResponsable = [...new Set((data.oportunidades || []).map((o) => o.responsable).filter(Boolean))]

  cuerpo.innerHTML = `
    <div class="card">
      <div class="crm-toolbar">
        <div class="crm-toolbar-fila">
          <div class="crm-seg">
            <button class="crm-seg-btn ${vista === 'kanban' ? 'activa' : ''}" data-vista="kanban" aria-pressed="${vista === 'kanban'}">Kanban</button>
            <button class="crm-seg-btn ${vista === 'tabla' ? 'activa' : ''}" data-vista="tabla" aria-pressed="${vista === 'tabla'}">Tabla</button>
          </div>
          <input id="crm-opo-q" class="form-input crm-buscar" placeholder="Buscar nombre o cliente…" value="${esc(f.q || '')}" aria-label="Buscar oportunidades">
          <span class="spacer"></span>
          <button id="crm-opo-export" class="btn btn-secondary btn-sm">Exportar CSV</button>
          <button id="crm-opo-nueva" class="btn btn-primary btn-sm">+ Oportunidad</button>
        </div>
        <div class="crm-toolbar-fila crm-filtros">
          <select id="crm-opo-estado" class="form-input crm-ft" aria-label="Estado">
            <option value="">Estado: todos</option>
            ${['abiertas', 'ganadas', 'perdidas'].map((v) => `<option value="${v}" ${f.estado === v ? 'selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}
          </select>
          <select id="crm-opo-etapa" class="form-input crm-ft" aria-label="Etapa">
            <option value="">Etapa: todas</option>
            ${(data.etapas || []).map((e) => `<option value="${esc(e.nombre)}" ${f.etapa === e.nombre ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select>
          <select id="crm-opo-resp" class="form-input crm-ft" aria-label="Responsable">
            <option value="">Responsable: todos</option>
            ${opcionesResponsable.map((r) => `<option ${f.responsable === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
          </select>
          <input id="crm-opo-desde" type="date" class="form-input crm-ft" value="${esc(f.desde || '')}" aria-label="Cierre desde">
          <input id="crm-opo-hasta" type="date" class="form-input crm-ft" value="${esc(f.hasta || '')}" aria-label="Cierre hasta">
        </div>
      </div>
      <div class="sub mt" id="crm-opo-resumen">${data.total} oportunidad(es) filtradas · etapas configurables del embudo</div>
    </div>
    <div id="crm-opo-cuerpo" class="mt"></div>`

  const cambiar = (extra) => { setFiltroTab('oportunidades', { ...f, ...extra }); renderCrm() }
  cuerpo.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => cambiar({ vista: b.dataset.vista })))
  cuerpo.querySelectorAll('#crm-opo-q').forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') cambiar({ q: i.value.trim() }) }))
  ;['crm-opo-estado', 'crm-opo-etapa', 'crm-opo-resp', 'crm-opo-desde', 'crm-opo-hasta'].forEach((id) => {
    const el = document.getElementById(id)
    el?.addEventListener('change', () => cambiar({
      estado: document.getElementById('crm-opo-estado').value || null,
      etapa: document.getElementById('crm-opo-etapa').value || null,
      responsable: document.getElementById('crm-opo-resp').value || null,
      desde: document.getElementById('crm-opo-desde').value || null,
      hasta: document.getElementById('crm-opo-hasta').value || null,
    }))
  })
  document.getElementById('crm-opo-export')?.addEventListener('click', () => exportarCsv('oportunidades', data.oportunidades))
  document.getElementById('crm-opo-nueva')?.addEventListener('click', () => modalNuevaOportunidad(data.etapas))

  const cuerpoOpo = document.getElementById('crm-opo-cuerpo')
  if (vista === 'kanban') pintarKanban(cuerpoOpo, data)
  else pintarTablaOportunidades(cuerpoOpo, data)
}

function pintarKanban(cont, data) {
  const porEtapa = new Map((data.oportunidades || []).map((o) => [o.id, o]))
  const kbg = new Map((data.kanban || []).map((k) => [k.etapa, k]))
  cont.innerHTML = `
    <div class="crm-kanban">
      ${(data.etapas || []).map((e) => {
        const k = kbg.get(e.nombre) || { n: 0, monto: 0, monto_ponderado: 0 }
        const cartas = (data.oportunidades || []).filter((o) => o.etapa === e.nombre)
        return `<div class="crm-kcol" data-etapa="${esc(e.nombre)}">
          <div class="crm-kcol-h">
            <b>${esc(e.nombre)}</b> <span class="chip neutral">${k.n}</span>
          </div>
          <div class="sub mono">${fmt(k.monto)} · pesado ${fmt(k.monto_ponderado)}</div>
          <div class="crm-kcards">
            ${cartas.map((o) => `
              <div class="crm-kcard ${o.terminal ? 'terminal' : ''}" data-id="${o.id}" role="button" tabindex="0" aria-label="Abrir ${esc(o.nombre)}">
                <div class="crm-kcard-top">
                  <b>${esc(o.nombre)}</b>
                  <span class="chip ${o.terminal ? (o.ganada ? 'contabilizado' : 'anulado') : 'pendiente'}">${o.probabilidad}%</span>
                </div>
                <div class="sub">${esc(o.empresa_nombre)}${o.contacto_nombre ? ' · ' + esc(o.contacto_nombre) : ''}</div>
                <div class="crm-kcard-monto mono">${fmt(o.monto)}<span class="sub"> · pesado ${fmt(o.monto_ponderado)}</span></div>
                <div class="crm-kcard-meta">
                  ${o.responsable ? `<span class="crm-kwho" title="Responsable">👤 ${esc(o.responsable)}</span>` : ''}
                  ${o.fecha_cierre_estimada ? `<span class="mono">cierre ${esc(o.fecha_cierre_estimada)}</span>` : ''}
                </div>
                ${!o.terminal ? `<select class="form-input crm-ketapa" data-id="${o.id}" aria-label="Cambiar etapa">
                  ${(data.etapas || []).filter((x) => !x.terminal || x.nombre === 'PERDIDA' || x.nombre === 'GANADA').map((x) => `<option value="${esc(x.nombre)}" ${x.nombre === o.etapa ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}
                </select>` : ''}
              </div>`).join('') || '<div class="sub" style="padding:var(--space-2)">— vacío —</div>'}
          </div>
        </div>`
      }).join('')}
    </div>`
  cont.querySelectorAll('.crm-kcard select.crm-ketapa').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const id = sel.dataset.id
      try {
        const r = await apiPost(`/api/crm/oportunidades/${id}/etapa`, { etapa: sel.value })
        showToast(`Etapa → ${r.etapa} (${r.probabilidad}%)`, 'success')
        renderCrm()
      } catch (e) { showToast(e.message, 'error'); renderCrm() }
    })
  })
  const abrir = (el) => modalDetalleOportunidad(Number(el.dataset.id))
  cont.querySelectorAll('.crm-kcard').forEach((c) => {
    c.addEventListener('dblclick', () => abrir(c))
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(c) })
    c.addEventListener('click', (e) => { if (e.target.closest('.crm-ketapa')) return; abrir(c) })
  })
}

function pintarTablaOportunidades(cont, data) {
  cont.innerHTML = `
    <div class="card"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Nombre</th><th>Cliente</th><th>Etapa</th><th>Prob.</th><th>Ponderado</th><th>Monto</th><th>Responsable</th><th>Cierre est.</th><th>Seguim.</th></tr></thead>
      <tbody>${(data.oportunidades || []).map((o) => `<tr data-id="${o.id}" style="cursor:pointer">
        <td><b>${esc(o.nombre)}</b>${o.primera_accion ? `<div class="sub">${esc(o.primera_accion)}</div>` : ''}</td>
        <td>${esc(o.empresa_nombre)}<div class="sub mono">${esc(o.rut)}</div></td>
        <td><span class="chip ${o.terminal ? (o.ganada ? 'contabilizado' : 'anulado') : 'pendiente'}">${esc(o.etapa)}</span></td>
        <td class="mono">${o.probabilidad}%</td>
        <td class="mono">${fmt(o.monto_ponderado)}</td>
        <td class="mono">${fmt(o.monto)}</td>
        <td>${esc(o.responsable || '—')}</td>
        <td class="mono">${esc(o.fecha_cierre_estimada || '—')}</td>
        <td class="mono">${esc(o.fecha_seguimiento || '—')}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="muted">Sin oportunidades con estos filtros.</td></tr>'}</tbody>
    </table></div></div>`
  cont.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => modalDetalleOportunidad(Number(tr.dataset.id))))
}

async function modalDetalleOportunidad(id) {
  let r
  try { r = await apiGet(`/api/crm/oportunidades/${id}`) } catch (e) { showToast(e.message, 'error'); return }
  const o = r.oportunidad
  openModal(`
    <h3>${esc(o.nombre)}</h3>
    <div class="sub">${esc(o.empresa_nombre)} · ${esc(o.rut)}${o.contacto_nombre ? ' · contacto: ' + esc(o.contacto_nombre) : ''}</div>
    <div class="frm-row mt" style="flex-wrap:wrap">
      <span class="chip ${o.terminal ? (o.ganada ? 'contabilizado' : 'anulado') : 'pendiente'}">${esc(o.etapa)} ${o.probabilidad}%</span>
      <span class="chip neutral">mantcl ${fmt(o.monto)}</span>
      <span class="chip neutral">pesado ${fmt(o.monto_ponderado)}</span>
      ${o.responsable ? `<span class="chip neutral">${esc(o.responsable)}</span>` : ''}
    </div>
    <div class="grid-2 mt">
      <div><b>Historial de etapa</b><div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${(o.historial || []).map((h) => `<tr><td class="mono">${esc(h.creado_en || '')}</td><td>${esc(h.desde || '—')} → <b>${esc(h.hasta || '')}</b>${h.comentario ? `<div class="sub">${esc(h.comentario)}${h.usuario_nombre ? ' · ' + esc(h.usuario_nombre) : ''}</div>` : ''}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div><b>Actividades</b><div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${(o.actividades || []).map((a) => `<tr><td><b>${esc(a.titulo)}</b><div class="sub">${esc(a.tipo)} · ${esc(a.estado)}</div></td><td class="mono">${esc(a.vencimiento || '—')}</td></tr>`).join('') || '<tr><td class="muted">Sin actividades.</td></tr>'}
      </tbody></table></div>
      <button class="btn btn-secondary btn-sm" id="crm-opo-add-act">+ Actividad en esta oportunidad</button></div>
    </div>
    ${o.motivo_perdida ? `<div class="banner-lic mt" style="background:var(--danger-soft);color:var(--danger)">Pérdida: ${esc(o.motivo_perdida)}</div>` : ''}
    <div class="frm-row mt" style="justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cerrar</button>
    </div>`)
  document.getElementById('crm-opo-add-act')?.addEventListener('click', () => modalNuevaActividad({ oportunidadId: o.id, empresaId: o.empresa_id, empresaNombre: o.empresa_nombre }))
}

function modalNuevaOportunidad(etapas) {
  openModal(`
    <h3>Nueva oportunidad</h3>
    <p class="sub">Monto en CLP entero. La probabilidad la fija la etapa salvo que la ajustes.</p>
    <div class="form-group"><label class="form-label">Cliente (empresa)</label><select id="nopp-emp" class="form-input">${(_pipelineCache || []).map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Nombre</label><input id="nopp-nom" class="form-input" placeholder="p. ej. Renovación contabilidad 2027"></div>
    <div class="form-group"><label class="form-label">Monto CLP</label><input id="nopp-monto" class="form-input" type="number" min="0" step="1000"></div>
    <div class="form-group"><label class="form-label">Etapa inicial</label><select id="nopp-etapa" class="form-input">${(etapas || []).filter((e) => !e.terminal).map((e) => `<option>${esc(e.nombre)}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Responsable</label><input id="nopp-resp" class="form-input" placeholder="quién lleva la venta"></div>
    <div class="form-group"><label class="form-label">Cierre estimado</label><input id="nopp-cierre" class="form-input" type="date"></div>
    <div class="frm-row" style="justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="nopp-crear">Crear</button>
    </div>`)
  document.getElementById('nopp-crear').addEventListener('click', async () => {
    try {
      await apiPost('/api/crm/oportunidades', {
        empresa_id: Number(document.getElementById('nopp-emp').value),
        nombre: document.getElementById('nopp-nom').value.trim(),
        monto: Number(document.getElementById('nopp-monto').value || 0),
        etapa: document.getElementById('nopp-etapa').value,
        responsable: document.getElementById('nopp-resp').value.trim() || null,
        fecha_cierre_estimada: document.getElementById('nopp-cierre').value || null,
      })
      cerrarModal(); showToast('Oportunidad creada', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
}

/* ================================ FICHAS ================================ */

async function renderFichas(cuerpo, base) {
  const f = filtroTab('fichas')
  const empresas = (_pipelineCache = base.pipeline.pipeline || [])
  const q = (f.q || '').toLowerCase()
  const lista = empresas.filter((p) => !q || (p.nombre + ' ' + (p.rut || '')).toLowerCase().includes(q))

  cuerpo.innerHTML = `
    <div class="card">
      <div class="frm-row" style="flex-wrap:wrap;align-items:center">
        <input id="crm-fich-q" class="form-input" placeholder="Buscar por nombre o RUT…" value="${esc(f.q || '')}" style="width:240px">
        <span class="sub">${lista.length} empresa(s)</span>
      </div>
    </div>
    <div class="grid-2 mt">
      <div class="card"><div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${lista.map((p) => `<tr data-emp="${p.empresa_id}" style="cursor:pointer">
          <td><b>${esc(p.nombre)}</b><div class="sub mono">${esc(p.rut)}</div></td>
          <td><span class="chip neutral">${esc(p.etapa)}</span></td></tr>`).join('') || '<tr><td class="muted">Sin resultados.</td></tr>'}
      </tbody></table></div></div>
      <div id="crm-ficha-det"><div class="card"><div class="empty">Selecciona una empresa para ver su ficha comercial.</div></div></div>
    </div>`

  const inp = document.getElementById('crm-fich-q')
  inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setFiltroTab('fichas', { q: inp.value.trim() }); renderCrm() } })
  cuerpo.querySelectorAll('tr[data-emp]').forEach((tr) => tr.addEventListener('click', () => pintarFicha(tr.dataset.emp)))
  if (lista.length) pintarFicha(lista[0].empresa_id)
}

async function pintarFicha(empresaId) {
  const det = document.getElementById('crm-ficha-det')
  if (!det) return
  det.innerHTML = '<div class="card"><div class="empty">Cargando ficha…</div></div>'
  let r
  try { r = await apiGet(`/api/crm/fichas/${empresaId}`) } catch (e) { det.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return }
  const fi = r.ficha || {}
  det.innerHTML = `
    <div class="card">
      <h3>${esc(r.empresa.nombre)}</h3>
      <div class="sub mono">${esc(r.empresa.rut)} · etapa ${esc(r.etapa)}</div>
      <div class="frm-row mt" style="flex-wrap:wrap">
        <span class="chip neutral">${r.oportunidades.total} oportunidad(es)</span>
        <span class="chip neutral">pesado ${fmt(r.oportunidades.monto_ponderado)}</span>
      </div>
      <div class="grid-2 mt">
        <div class="form-group"><label class="form-label">Nombre comercial</label><input id="fich-nc" class="form-input" value="${esc(fi.nombre_comercial || '')}"></div>
        <div class="form-group"><label class="form-label">Giro</label><input id="fich-giro" class="form-input" value="${esc(fi.giro || '')}"></div>
        <div class="form-group"><label class="form-label">Correo</label><input id="fich-correo" class="form-input" value="${esc(fi.correo || '')}"></div>
        <div class="form-group"><label class="form-label">Dirección</label><input id="fich-dir" class="form-input" value="${esc(fi.direccion || '')}"></div>
        <div class="form-group"><label class="form-label">Fuente</label><select id="fich-fuente" class="form-input">
          ${['', 'prospeccion', 'referencia', 'sii', 'web', 'whatsapp', 'otro'].map((v) => `<option value="${v}" ${(fi.fuente || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}
        </select></div>
        <div class="form-group"><label class="form-label">Prioridad</label><select id="fich-prio" class="form-input">
          ${['', 'alta', 'media', 'baja'].map((v) => `<option value="${v}" ${(fi.prioridad || '') === v ? 'selected' : ''}>${v || '—'}</option>`).join('')}
        </select></div>
      </div>
      <div class="frm-row"><button id="fich-guardar" class="btn btn-primary btn-sm">Guardar ficha</button><span class="sub" id="fich-msg"></span></div>
      <h3 class="mt">Contactos (${r.contactos.length})</h3>
      <div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${r.contactos.map((c) => `<tr>
          <td><b>${esc(c.nombre)}</b>${c.principal ? ' <span class="chip contabilizado">principal</span>' : ''}<div class="sub">${esc(c.cargo || '—')} · ${esc(c.correo || 'sin correo')} · ${esc(c.telefono || '—')}</div></td>
          <td><button class="btn btn-sm crm-ok crm-c-ed" data-id="${c.id}">Editar</button></td></tr>`).join('') || '<tr><td class="muted">Sin contactos registrados.</td></tr>'}
      </tbody></table></div>
      <div class="frm-row mt"><button id="fich-c-nuevo" class="btn btn-secondary btn-sm">+ Contacto</button></div>

      <h3 class="mt">Referencias en el sistema</h3>
      <p class="sub">Meta-datos de bandeja SII y contabilidad de ESTA empresa (el contenido con números sigue en Compras y Ventas / Informes, con sus permisos).</p>
      <div class="kpi-grid mt" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
        <div class="kpi"><small>Docs en bandeja</small><strong>${r.documentos?.total ?? 0}</strong></div>
        <div class="kpi ${r.documentos?.pendientes > 0 ? 'up' : ''}"><small>Pendientes</small><strong style="color:${r.documentos?.pendientes > 0 ? 'var(--warning)' : 'var(--success)'}">${r.documentos?.pendientes ?? 0}</strong></div>
        <div class="kpi"><small>Compras / Ventas</small><strong>${r.documentos?.compras ?? 0} / ${r.documentos?.ventas ?? 0}</strong></div>
        <div class="kpi"><small>Último doc</small><strong class="mono" style="font-size:var(--fs-md)">${r.documentos?.ultimo_docto ? esc(ladoIzq(r.documentos.ultimo_docto)) : '—'}</strong></div>
        <div class="kpi"><small>Período ${r.periodo_contable?.periodo ? esc(r.periodo_contable.periodo) : ''}</small><strong>${r.periodo_contable ? `<span class="chip ${r.periodo_contable.estado === 'ABIERTO' ? 'pendiente' : 'contabilizado'}">${esc(r.periodo_contable.estado)}</span>` : '—'}</strong></div>
      </div>
      <div class="frm-row mt">
        <button class="btn btn-secondary btn-sm" data-hash="documentos">Ver bandeja de documentos →</button>
        <button class="btn btn-secondary btn-sm" data-hash="reportes">Ver informes contables →</button>
      </div>
    </div>`

  document.getElementById('fich-guardar').addEventListener('click', async () => {
    try {
      await apiPut(`/api/crm/fichas/${empresaId}`, {
        nombre_comercial: document.getElementById('fich-nc').value.trim() || null,
        giro: document.getElementById('fich-giro').value.trim() || null,
        correo: document.getElementById('fich-correo').value.trim() || null,
        direccion: document.getElementById('fich-dir').value.trim() || null,
        fuente: document.getElementById('fich-fuente').value || null,
        prioridad: document.getElementById('fich-prio').value || null,
      })
      showToast('Ficha guardada', 'success'); pintarFicha(empresaId)
    } catch (e) { showToast(e.message, 'error') }
  })
  document.getElementById('fich-c-nuevo').addEventListener('click', () => modalContacto(empresaId, r.empresa.nombre, null))
  det.querySelectorAll('[data-hash]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.hash }))
  det.querySelectorAll('.crm-c-ed').forEach((b) => {
    const contacto = r.contactos.find((c) => String(c.id) === b.dataset.id)
    b.addEventListener('click', () => modalContacto(empresaId, r.empresa.nombre, contacto))
  })
}

function modalContacto(empresaId, empresaNombre, contacto) {
  openModal(`
    <h3>${contacto ? 'Editar contacto' : 'Nuevo contacto'} — ${esc(empresaNombre)}</h3>
    <div class="form-group"><label class="form-label">Nombre</label><input id="mc-nom" class="form-input" value="${esc(contacto?.nombre || '')}"></div>
    <div class="form-group"><label class="form-label">Cargo</label><input id="mc-cargo" class="form-input" value="${esc(contacto?.cargo || '')}"></div>
    <div class="form-group"><label class="form-label">Correo</label><input id="mc-correo" class="form-input" value="${esc(contacto?.correo || '')}"></div>
    <div class="form-group"><label class="form-label">Teléfono</label><input id="mc-tel" class="form-input" value="${esc(contacto?.telefono || '')}"></div>
    <div class="form-group"><label class="form-label">Responsable interno</label><input id="mc-resp" class="form-input" value="${esc(contacto?.responsable || '')}"></div>
    <div class="form-group"><label class="form-label"><input type="checkbox" id="mc-principal" ${contacto?.principal ? 'checked' : ''}> Contacto principal</label></div>
    <div class="frm-row" style="justify-content:flex-end">
      ${contacto ? `<button class="btn btn-sm crm-ok" style="border-color:var(--danger);color:var(--danger)" id="mc-elim">Eliminar</button>` : ''}
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mc-guardar">${contacto ? 'Guardar' : 'Crear'}</button>
    </div>`)
  document.getElementById('mc-guardar').addEventListener('click', async () => {
    const cuerpo = {
      nombre: document.getElementById('mc-nom').value.trim(),
      cargo: document.getElementById('mc-cargo').value.trim() || null,
      correo: document.getElementById('mc-correo').value.trim() || null,
      telefono: document.getElementById('mc-tel').value.trim() || null,
      responsable: document.getElementById('mc-resp').value.trim() || null,
      principal: document.getElementById('mc-principal').checked,
    }
    try {
      if (contacto) await apiPatch(`/api/crm/contactos/${contacto.id}`, cuerpo)
      else await apiPost('/api/crm/contactos', { ...cuerpo, empresa_id: Number(empresaId) })
      cerrarModal(); showToast('Contacto guardado', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
  document.getElementById('mc-elim')?.addEventListener('click', async () => {
    try {
      await apiDelete(`/api/crm/contactos/${contacto.id}`)
      cerrarModal(); showToast('Contacto eliminado', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
}

/* ============================== CONTACTOS ============================== */

async function renderContactos(cuerpo) {
  const f = filtroTab('contactos')
  const qs = new URLSearchParams(); if (f.q) qs.set('q', f.q)
  const data = await apiGet(`/api/crm/contactos${qs.toString() ? '?' + qs : ''}`)
  cuerpo.innerHTML = `
    <div class="card">
      <div class="frm-row" style="align-items:center">
        <input id="crm-con-q" class="form-input" placeholder="Buscar contacto, correo, teléfono o empresa…" value="${esc(f.q || '')}" style="width:280px">
        <span class="sub">${(data.contactos || []).length} contacto(s)</span>
        <span class="spacer"></span>
        <button id="crm-con-nuevo" class="btn btn-primary btn-sm">+ Contacto</button>
      </div>
    </div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Contacto</th><th>Empresa</th><th>Cargo</th><th>Correo</th><th>Teléfono</th><th></th></tr></thead>
      <tbody>${(data.contactos || []).map((c) => `<tr>
        <td><b>${esc(c.nombre)}</b>${c.principal ? ' <span class="chip contabilizado">principal</span>' : ''}${c.responsable ? `<div class="sub">👤 ${esc(c.responsable)}</div>` : ''}</td>
        <td>${esc(c.empresa_nombre)}<div class="sub mono">${esc(c.rut)}</div></td>
        <td>${esc(c.cargo || '—')}</td>
        <td class="mono">${esc(c.correo || '—')}</td>
        <td class="mono">${esc(c.telefono || '—')}</td>
        <td><button class="btn btn-sm crm-con-ed" data-id="${c.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin contactos aún. Créalos desde una ficha o el botón +.</td></tr>'}</tbody>
    </table></div></div>`
  const inp = document.getElementById('crm-con-q')
  inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setFiltroTab('contactos', { q: inp.value.trim() }); renderCrm() } })
  document.getElementById('crm-con-nuevo')?.addEventListener('click', () => {
    const primera = (_pipelineCache || [])[0]
    if (!primera) return showToast('Sin empresas para asignar', 'error')
    modalContactoSelector(data.contactos)
  })
  cuerpo.querySelectorAll('.crm-con-ed').forEach((b) => b.addEventListener('click', () => {
    const c = (data.contactos || []).find((x) => String(x.id) === b.dataset.id)
    if (c) modalContacto(c.empresa_id, c.empresa_nombre, c)
  }))
}

function modalContactoSelector(contactos) {
  const empresas = _pipelineCache || []
  openModal(`
    <h3>Nuevo contacto</h3>
    <div class="form-group"><label class="form-label">Empresa</label><select id="ms-emp" class="form-input">${empresas.map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}</select></div>
    <div id="ms-form"></div>
    <div class="frm-row" style="justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="ms-guardar">Crear</button>
    </div>`)
  const zona = document.getElementById('ms-form')
  zona.innerHTML = `
    <div class="form-group"><label class="form-label">Nombre</label><input id="ms-nom" class="form-input"></div>
    <div class="form-group"><label class="form-label">Cargo</label><input id="ms-cargo" class="form-input"></div>
    <div class="form-group"><label class="form-label">Correo</label><input id="ms-correo" class="form-input"></div>
    <div class="form-group"><label class="form-label">Teléfono</label><input id="ms-tel" class="form-input"></div>
    <div class="form-group"><label class="form-label"><input type="checkbox" id="ms-principal"> Principal</label></div>`
  document.getElementById('ms-guardar').addEventListener('click', async () => {
    try {
      await apiPost('/api/crm/contactos', {
        empresa_id: Number(document.getElementById('ms-emp').value),
        nombre: document.getElementById('ms-nom').value.trim(),
        cargo: document.getElementById('ms-cargo').value.trim() || null,
        correo: document.getElementById('ms-correo').value.trim() || null,
        telefono: document.getElementById('ms-tel').value.trim() || null,
        principal: document.getElementById('ms-principal').checked,
      })
      cerrarModal(); showToast('Contacto creado', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
}

/* ============================== PROSPECTOS ============================= */

async function renderProspectos(cuerpo) {
  const f = filtroTab('prospectos')
  const qs = new URLSearchParams(); if (f.estado) qs.set('estado', f.estado); if (f.q) qs.set('q', f.q)
  const data = await apiGet(`/api/crm/prospectos${qs.toString() ? '?' + qs : ''}`)

  cuerpo.innerHTML = `
    <div class="card">
      <div class="frm-row" style="flex-wrap:wrap;align-items:center">
        <select id="crm-pro-estado" class="form-input" style="width:auto">
          <option value="">Todos</option>
          ${['NUEVO', 'EN_CONTACTO', 'DESCARTADO', 'CONVERTIDO'].map((v) => `<option ${f.estado === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <input id="crm-pro-q" class="form-input" placeholder="Buscar prospecto…" value="${esc(f.q || '')}" style="width:200px">
        <span class="sub">${data.total} prospecto(s)</span>
        <span class="spacer"></span>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer">Importar CSV<input id="crm-pro-imp" type="file" accept=".csv,text/csv" style="display:none"></label>
        <button id="crm-pro-nuevo" class="btn btn-primary btn-sm">+ Prospecto</button>
      </div>
    </div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Prospecto</th><th>Fuente</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th></th></tr></thead>
      <tbody>${(data.prospectos || []).map((p) => `<tr>
        <td><b>${esc(p.nombre)}</b>${p.rut ? `<div class="sub mono">${esc(p.rut)}</div>` : ''}${p.correo ? `<div class="sub mono">${esc(p.correo)}</div>` : ''}${p.necesidad ? `<div class="sub">${esc(p.necesidad)}</div>` : ''}</td>
        <td>${esc(p.fuente || '—')}</td>
        <td><span class="chip ${p.prioridad === 'alta' ? 'anulado' : 'neutral'}">${esc(p.prioridad)}</span></td>
        <td><span class="chip ${p.estado === 'CONVERTIDO' ? 'contabilizado' : p.estado === 'DESCARTADO' ? 'anulado' : 'pendiente'}">${esc(p.estado)}</span>${p.empresa_nombre ? `<div class="sub">→ ${esc(p.empresa_nombre)}</div>` : ''}</td>
        <td>${esc(p.responsable || '—')}</td>
        <td class="acc">${p.estado !== 'CONVERTIDO' ? `
          <button class="btn btn-sm crm-pro-conv" data-id="${p.id}">Convertir</button>
          <button class="btn btn-sm crm-pro-ed" data-id="${p.id}">Editar</button>` : 'convertido'}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin prospectos: cuando te contacten, regístralos acá (botón + o importación CSV).</td></tr>'}</tbody>
    </table></div></div>
    <p class="sub mt" id="crm-pro-out"></p>`

  const recargar = () => renderCrm()
  document.getElementById('crm-pro-estado')?.addEventListener('change', (e) => { setFiltroTab('prospectos', { ...f, estado: e.target.value || null }); })
  const qinp = document.getElementById('crm-pro-q')
  qinp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setFiltroTab('prospectos', { ...f, q: qinp.value.trim() }); recargar() } })

  document.getElementById('crm-pro-nuevo')?.addEventListener('click', () => modalProspecto(null))
  cuerpo.querySelectorAll('.crm-pro-ed').forEach((b) => b.addEventListener('click', () => {
    const p = (data.prospectos || []).find((x) => String(x.id) === b.dataset.id)
    if (p) modalProspecto(p)
  }))
  cuerpo.querySelectorAll('.crm-pro-conv').forEach((b) => b.addEventListener('click', async () => {
    const p = (data.prospectos || []).find((x) => String(x.id) === b.dataset.id)
    if (!p) return
    try {
      const r = await apiPost(`/api/crm/prospectos/${p.id}/convertir`, {})
      showToast(r.empresa_id != null ? `Convertido y vinculado a empresa ${r.empresa_id} (ONBOARDING)` : 'Convertido: registra su empresa vía onboarding con su clave SII', 'success')
      recargar()
    } catch (e) { showToast(e.message, 'error') }
  }))
  document.getElementById('crm-pro-imp')?.addEventListener('click', (e) => {
    const file = e.target.files[0]
    if (!file) return
    const lector = new FileReader()
    lector.onload = async () => {
      const filas = csvProspectos(String(lector.result))
      try {
        const r = await apiPost('/api/crm/prospectos/importar', { prospectos: filas })
        document.getElementById('crm-pro-out').textContent =
          `Importación: ${r.aceptados.length} aceptados, ${r.errores.length} rechazados${r.errores.length ? ' — primera: ' + r.errores[0].error : ''}`
        showToast(`Importados ${r.aceptados.length}/${r.total}`, r.errores.length ? 'info' : 'success')
        recargar()
      } catch (err) { showToast(err.message, 'error') }
    }
    lector.readAsText(file, 'UTF-8')
  })
}

function csvProspectos(texto) {
  // CSV simple: nombre,rut,correo,telefono,fuente,necesidad,prioridad
  // (encabezado opcional; comillas básicas; tolerante a ; como separador)
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim())
  const out = []
  for (const linea of lineas) {
    const sep = linea.includes(';') ? ';' : ','
    const cols = []
    let cur = '', enQ = false
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i]
      if (ch === '"') { enQ = !enQ; continue }
      if (ch === sep && !enQ) { cols.push(cur); cur = '' } else cur += ch
    }
    cols.push(cur)
    if (/^nombre$/i.test((cols[0] || '').trim())) continue
    out.push({
      nombre: (cols[0] || '').trim(),
      rut: (cols[1] || '').trim() || null,
      correo: (cols[2] || '').trim() || null,
      telefono: (cols[3] || '').trim() || null,
      fuente: (cols[4] || 'otro').trim().toLowerCase() || 'otro',
      necesidad: (cols[5] || '').trim() || null,
      prioridad: (cols[6] || 'media').trim().toLowerCase(),
    })
  }
  return out
}

function modalProspecto(p) {
  openModal(`
    <h3>${p ? 'Editar prospecto' : 'Nuevo prospecto'}</h3>
    ${p && p.estado === 'CONVERTIDO' ? '<div class="banner-lic" style="background:var(--success-soft);color:var(--success)">CONVERTIDO — su historial queda conservado; solo datos de contacto editables de estado previo</div>' : ''}
    <div class="form-group"><label class="form-label">Nombre / empresa</label><input id="mp-nom" class="form-input" value="${esc(p?.nombre || '')}"></div>
    <div class="form-group"><label class="form-label">RUT (opcional; validado M11)</label><input id="mp-rut" class="form-input" value="${esc(p?.rut || '')}" placeholder="76.312.274-3"></div>
    <div class="form-group"><label class="form-label">Correo</label><input id="mp-correo" class="form-input" value="${esc(p?.correo || '')}"></div>
    <div class="form-group"><label class="form-label">Teléfono</label><input id="mp-tel" class="form-input" value="${esc(p?.telefono || '')}"></div>
    <div class="form-group"><label class="form-label">Fuente</label><select id="mp-fuente" class="form-input">${['prospeccion', 'referencia', 'sii', 'web', 'whatsapp', 'otro'].map((v) => `<option ${p?.fuente === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Necesidad / interés</label><input id="mp-nec" class="form-input" value="${esc(p?.necesidad || '')}"></div>
    <div class="form-group"><label class="form-label">Prioridad</label><select id="mp-prio" class="form-input">${['alta', 'media', 'baja'].map((v) => `<option ${p?.prioridad === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Responsable</label><input id="mp-resp" class="form-input" value="${esc(p?.responsable || '')}"></div>
    ${p ? `<div class="form-group"><label class="form-label">Estado</label><select id="mp-estado" class="form-input">${['NUEVO', 'EN_CONTACTO', 'DESCARTADO'].concat(p.estado === 'CONVERTIDO' ? ['CONVERTIDO'] : []).map((v) => `<option ${p.estado === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}
    <div class="frm-row" style="justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mp-guardar">${p ? 'Guardar' : 'Crear'}</button>
    </div>`)
  document.getElementById('mp-guardar').addEventListener('click', async () => {
    const cuerpo = {
      nombre: document.getElementById('mp-nom').value.trim(),
      rut: document.getElementById('mp-rut').value.trim() || null,
      correo: document.getElementById('mp-correo').value.trim() || null,
      telefono: document.getElementById('mp-tel').value.trim() || null,
      fuente: document.getElementById('mp-fuente').value,
      necesidad: document.getElementById('mp-nec').value.trim() || null,
      prioridad: document.getElementById('mp-prio').value,
      responsable: document.getElementById('mp-resp').value.trim() || null,
    }
    if (p) cuerpo.estado = document.getElementById('mp-estado').value
    try {
      if (p) await apiPatch(`/api/crm/prospectos/${p.id}`, cuerpo)
      else await apiPost('/api/crm/prospectos', cuerpo)
      cerrarModal(); showToast(p ? 'Prospecto actualizado' : 'Prospecto creado', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
}

/* ============================== ACTIVIDADES ============================ */

async function renderActividades(cuerpo) {
  const f = filtroTab('actividades')
  const qs = new URLSearchParams()
  if (f.estado) qs.set('estado', f.estado)
  if (f.vencidas) qs.set('vencidas', '1')
  const data = await apiGet(`/api/crm/actividades${qs.toString() ? '?' + qs : ''}`)
  const acts = data.actividades || []
  const vencidas = acts.filter((a) => a.vencida)

  cuerpo.innerHTML = `
    <div class="card">
      <div class="frm-row" style="flex-wrap:wrap;align-items:center">
        <select id="crm-act-estado" class="form-input" style="width:auto">
          ${['PENDIENTE', 'COMPLETADA', 'CANCELADA'].map((v) => `<option ${f.estado === v ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <label class="sub" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="crm-act-venc" ${f.vencidas ? 'checked' : ''}> solo vencidas</label>
        <span class="sub">${acts.length} · ${vencidas.length} vencida(s)</span>
        <span class="spacer"></span>
        <button id="crm-act-nueva" class="btn btn-primary btn-sm">+ Actividad</button>
      </div>
    </div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Actividad</th><th>Ancla</th><th>Vence</th><th>Prioridad</th><th>Responsable</th><th></th></tr></thead>
      <tbody>${acts.map((a) => `<tr>
        <td><b>${esc(a.titulo)}</b><div class="sub">${esc(a.tipo)}${a.detalle ? ' · ' + esc(a.detalle) : ''}</div></td>
        <td>${a.oportunidad_id ? `<span class="chip pendiente">${esc(a.oportunidad_nombre || 'op.' + a.oportunidad_id)}</span>` : ''}
            ${a.empresa_nombre ? `<span class="chip neutral">${esc(a.empresa_nombre)}</span>` : ''}</td>
        <td class="mono" ${a.vencida ? 'style="color:var(--danger)"' : ''}>${esc(a.vencimiento || '—')}${a.vencida ? ' ⚠' : ''}</td>
        <td><span class="chip ${a.prioridad === 'alta' ? 'anulado' : 'neutral'}">${esc(a.prioridad)}</span></td>
        <td>${esc(a.responsable || '—')}</td>
        <td class="acc">${a.estado === 'PENDIENTE' ? `
          <button class="btn btn-sm crm-act-ok" data-id="${a.id}">✓ Listo</button>` : esc(a.estado)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin actividades con este filtro.</td></tr>'}</tbody>
    </table></div></div>`

  document.getElementById('crm-act-estado')?.addEventListener('change', (e) => { setFiltroTab('actividades', { ...f, estado: e.target.value }); renderCrm() })
  document.getElementById('crm-act-venc')?.addEventListener('change', (e) => { setFiltroTab('actividades', { ...f, vencidas: e.target.checked }); renderCrm() })
  document.getElementById('crm-act-nueva')?.addEventListener('click', () => modalNuevaActividad({}))
  cuerpo.querySelectorAll('.crm-act-ok').forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiPatch(`/api/crm/actividades/${b.dataset.id}`, { estado: 'COMPLETADA' })
      showToast('Actividad completada', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  }))
}

function modalNuevaActividad({ oportunidadId = null, empresaId = null, empresaNombre = '' } = {}) {
  const empresas = _pipelineCache || []
  openModal(`
    <h3>Nueva actividad</h3>
    ${empresaNombre ? `<p class="sub">Anclada a: ${esc(empresaNombre)}</p>` : ''}
    <div class="form-group"><label class="form-label">Tipo</label><select id="na-tipo" class="form-input">${['tarea', 'llamada', 'reunion', 'nota'].map((t) => `<option>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Título</label><input id="na-titulo" class="form-input"></div>
    <div class="form-group"><label class="form-label">Detalle</label><input id="na-detalle" class="form-input"></div>
    <div class="form-group"><label class="form-label">Vencimiento</label><input id="na-vence" class="form-input" type="date"></div>
    <div class="form-group"><label class="form-label">Prioridad</label><select id="na-prio" class="form-input">${['alta', 'media', 'baja'].map((v) => `<option ${v === 'media' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Responsable</label><input id="na-resp" class="form-input"></div>
    ${!empresaId && !oportunidadId ? `<div class="form-group"><label class="form-label">Anclar a empresa</label><select id="na-emp" class="form-input">${empresas.map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}</select></div>` : ''}
    <div class="frm-row" style="justify-content:flex-end">
      <button class="btn btn-secondary btn-sm" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="na-crear">Crear</button>
    </div>`)
  document.getElementById('na-crear').addEventListener('click', async () => {
    try {
      await apiPost('/api/crm/actividades', {
        tipo: document.getElementById('na-tipo').value,
        titulo: document.getElementById('na-titulo').value.trim(),
        detalle: document.getElementById('na-detalle').value.trim() || null,
        vencimiento: document.getElementById('na-vence').value || null,
        prioridad: document.getElementById('na-prio').value,
        responsable: document.getElementById('na-resp').value.trim() || null,
        empresa_id: empresaId != null ? empresaId : (document.getElementById('na-emp') ? Number(document.getElementById('na-emp').value) : null),
        oportunidad_id: oportunidadId,
      })
      cerrarModal(); showToast('Actividad creada', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
}

/* ================================ INFORMES ============================= */

async function renderInformes(cuerpo) {
  const f = filtroTab('informes')
  const qs = new URLSearchParams()
  if (f.desde) qs.set('desde', f.desde); if (f.hasta) qs.set('hasta', f.hasta); if (f.responsable) qs.set('responsable', f.responsable)
  const inf = await apiGet(`/api/crm/informes${qs.toString() ? '?' + qs : ''}`)

  cuerpo.innerHTML = `
    <div class="card">
      <div class="frm-row" style="flex-wrap:wrap;align-items:center">
        <label class="sub">Creadas desde</label><input id="crm-inf-desde" type="date" class="form-input" style="width:auto" value="${esc(f.desde || '')}">
        <label class="sub">hasta</label><input id="crm-inf-hasta" type="date" class="form-input" style="width:auto" value="${esc(f.hasta || '')}">
        <input id="crm-inf-resp" class="form-input" placeholder="responsable" value="${esc(f.responsable || '')}" style="width:160px">
        <button class="btn btn-secondary btn-sm" id="crm-inf-filtrar">Aplicar</button>
        <span class="spacer"></span>
        <button class="btn btn-secondary btn-sm" id="crm-inf-export">Exportar CSV</button>
      </div>
    </div>
    <div class="kpi-grid mt">
      <div class="kpi"><small>Abiertas</small><strong>${inf.abiertas}</strong></div>
      <div class="kpi up"><small>Ganadas</small><strong style="color:var(--success)">${inf.ganadas}</strong></div>
      <div class="kpi"><small>Perdidas</small><strong style="color:var(--danger)">${inf.perdidas}</strong></div>
      <div class="kpi acc"><small>Conversión</small><strong>${inf.conversion_pct == null ? '—' : inf.conversion_pct + '%'}</strong></div>
      <div class="kpi acc"><small>Proyección</small><strong>${fmt(inf.proyeccion_ponderada || 0)}</strong></div>
      <div class="kpi"><small>Clientes nuevos</small><strong>${inf.clientes_nuevos}</strong></div>
    </div>
    <div class="grid-2 mt">
      <div class="card"><h3>Embudo por etapa</h3><div class="tbl-wrap" style="border:none"><table class="tbl">
        <thead><tr><th>Etapa</th><th>Nº</th><th>Monto</th><th>Ponderado</th></tr></thead>
        <tbody>${inf.embudo.map((e) => `<tr>
          <td>${esc(e.etapa)}${e.terminal ? (e.ganada ? ' 🏁' : ' ✖') : ''}</td>
          <td class="mono">${e.n}</td><td class="mono">${fmt(e.monto)}</td><td class="mono">${fmt(e.monto_ponderado)}</td></tr>`).join('')}
        <tr><td><b>Total</b></td><td class="mono"><b>${inf.total}</b></td><td></td><td class="mono"><b>${fmt(inf.monto_ponderado_total || 0)}</b></td></tr>
      </tbody></table></div></div>
      <div class="card"><h3>Por responsable</h3><div class="tbl-wrap" style="border:none"><table class="tbl">
        <thead><tr><th>Responsable</th><th>Total</th><th>Abiertas</th><th>Ganadas</th><th>Perdidas</th><th>Proyección</th></tr></thead>
        <tbody>${inf.por_responsable.map((r) => `<tr>
          <td>${esc(r.responsable)}</td><td class="mono">${r.total}</td><td class="mono">${r.abiertas}</td>
          <td class="mono">${r.ganadas}</td><td class="mono">${r.perdidas}</td><td class="mono">${fmt(r.proyeccion)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin oportunidades en el rango.</td></tr>'}
      </tbody></table></div>
      <h3 class="mt">Causas de pérdida</h3><div class="tbl-wrap" style="border:none"><table class="tbl"><tbody>
        ${inf.perdidas_causa.map((p) => `<tr><td>${esc(p.motivo)}</td><td class="mono">${p.n}</td><td class="mono">${fmt(p.monto_perdido)}</td></tr>`).join('') || '<tr><td class="muted">Sin pérdidas registradas.</td></tr>'}
      </tbody></table></div></div>
    </div>`

  document.getElementById('crm-inf-filtrar')?.addEventListener('click', () => {
    setFiltroTab('informes', {
      desde: document.getElementById('crm-inf-desde').value || null,
      hasta: document.getElementById('crm-inf-hasta').value || null,
      responsable: document.getElementById('crm-inf-resp').value.trim() || null,
    }); renderCrm()
  })
  document.getElementById('crm-inf-export')?.addEventListener('click', () => exportarCsv('embudo', inf.embudo))
}

/* ============================== FIDELIZACIÓN =========================== */
/* Las tarjetas de retención/campañas/recordatorios existentes, preservadas 1:1 */

async function renderFidelizacion(cuerpo, base) {
  const [recordatorios, campanas, engagement, alertas] = await Promise.all([
    apiGet('/api/crm/recordatorios'),
    apiGet('/api/crm/campanas'),
    apiGet('/api/crm/engagement'),
    apiGet('/api/crm/alertas'),
  ])
  const saludPorEmpresa = new Map((engagement.clientes || []).map((x) => [x.empresa_id, x]))
  const resumen = engagement.resumen || {}

  cuerpo.innerHTML = `
    <div class="card" id="crm-retencion">
      <h3>Retención proactiva</h3>
      <p class="sub">Clientes con señales reales de riesgo: sync SII &gt; 30 d, ≥5 docs pendientes, contacto &gt; 60 d o último período vencido aún ABIERTO.</p>
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
      <h3>Pipeline de clientes (etapa de ciclo del despacho)</h3>
      <div class="tbl-wrap" style="border:none"><table class="tbl" id="crm-tabla">
        <thead><tr><th>Empresa</th><th>Etapa</th><th>Salud</th><th>Últ. sync SII</th><th>Docs pend.</th><th>Últ. contacto</th><th>Próx. contacto</th><th>Acciones</th></tr></thead>
        <tbody>
          ${(base.pipeline.pipeline || []).map((p) => {
            const s = saludPorEmpresa.get(p.empresa_id) || {}
            return `<tr data-empresa="${p.empresa_id}">
              <td><b>${esc(p.nombre)}</b><div class="sub mono">${esc(p.rut)}</div></td>
              <td><span class="chip neutral">${esc(p.etapa)}</span></td>
              <td>${s.etiqueta ? `<span class="chip ${SALUD_CHIP[s.etiqueta]}">${s.etiqueta} ${s.score}</span>` : '<span class="sub">—</span>'}</td>
              <td class="mono">${s.dias_desde_sincronizacion == null ? '—' : s.dias_desde_sincronizacion + ' d'}</td>
              <td class="mono">${s.documentos_pendientes ?? '—'}</td>
              <td class="mono">${s.dias_desde_contacto == null ? '—' : s.dias_desde_contacto + ' d'}</td>
              <td class="mono">${esc(p.proximo_contacto || '—')}</td>
              <td class="acc">
                <button class="btn btn-sm crm-inter" data-id="${p.empresa_id}">+ Interacción</button>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table></div>
      <p class="sub">La etapa del ciclo se gestiona en Introducción administración / pipeline — manteniendo compatibilidad con la API anterior.</p>
    </div>

    <div class="grid-2 mt">
      <div class="card">
        <h3>Recordatorios del calendario (cierre, F29, PPM…)</h3>
        <div class="tbl-wrap" style="border:none"><table class="tbl">
          <tbody>${(recordatorios.recordatorios || []).map((r) => `<tr>
            <td><b>${esc(r.titulo)}</b><div class="sub">${esc(r.empresa_nombre)} · ${esc(r.tipo)}</div></td>
            <td class="mono">${esc(r.fecha)}</td>
            <td><button class="btn btn-sm crm-rec-done" data-id="${r.id}">✓</button></td>
          </tr>`).join('') || '<tr><td class="muted">Sin pendientes.</td></tr>'}</tbody>
        </table></div>
        <div class="frm-row mt">
          <select id="crm-rec-empresa" class="form-input" style="width:auto">
            ${(base.pipeline.pipeline || []).map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}
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
            ${(base.pipeline.pipeline || []).map((p) => `<option value="${p.empresa_id}">${esc(p.nombre)}</option>`).join('')}
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

  // ---- recordatorios (API anterior, sin cambios) ----
  document.getElementById('crm-rec-add')?.addEventListener('click', async () => {
    try {
      await apiPost('/api/crm/recordatorios', {
        empresa_id: Number(document.getElementById('crm-rec-empresa').value),
        tipo: document.getElementById('crm-rec-tipo').value,
        titulo: document.getElementById('crm-rec-titulo').value.trim(),
        fecha: document.getElementById('crm-rec-fecha').value,
      })
      showToast('Recordatorio creado', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
  cuerpo.querySelectorAll('.crm-rec-done').forEach((b) => b.addEventListener('click', async () => {
    try { await apiPost(`/api/crm/recordatorios/${b.dataset.id}/completar`, {}); showToast('Completado', 'success'); renderCrm() }
    catch (e) { showToast(e.message, 'error') }
  }))
  // ---- campañas ----
  document.getElementById('crm-cam-gen')?.addEventListener('click', async () => {
    try {
      const r = await apiPost('/api/crm/campanas', {
        empresa_id: Number(document.getElementById('crm-cam-empresa').value),
        plantilla: document.getElementById('crm-cam-plantilla').value,
      })
      document.getElementById('crm-cam-previa').innerHTML = `<b>Previsualización:</b> ${esc(r.mensaje)}`
      renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
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
      renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  })
  cuerpo.querySelectorAll('.crm-cam-env').forEach((b) => b.addEventListener('click', async () => {
    try { await apiPost(`/api/crm/campanas/${b.dataset.id}/enviar`, {}); showToast('Marcada como enviada', 'success'); renderCrm() }
    catch (e) { showToast(e.message, 'error') }
  }))
  // ---- interacción de pipeline del ciclo (API anterior) ----
  cuerpo.querySelectorAll('.crm-inter').forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiPost(`/api/crm/pipeline/${b.dataset.id}/interaccion`, {})
      showToast('Interacción registrada (hoy)', 'success'); renderCrm()
    } catch (e) { showToast(e.message, 'error') }
  }))
}

/* ============================== UTILIDADES ============================= */

function conectarAtajos(cuerpo) {
  cuerpo.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.ir)))
}

/**
 * Exportación CSV (§H) SOLO de datos ya autorizados (mismos fetch con
 * guardCrm). genera el archivo en el navegador: no cruza por otras rutas.
 */
function exportarCsv(nombre, filas) {
  if (!filas || !filas.length) return showToast('Nada que exportar con el filtro actual', 'info')
  const claves = Object.keys(filas[0])
  const esc2 = (v) => { if (v == null) return ''; const s = String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = [claves.join(';'), ...filas.map((f) => claves.map((k) => esc2(f[k])).join(';'))].join('\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `jmv-crm-${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
