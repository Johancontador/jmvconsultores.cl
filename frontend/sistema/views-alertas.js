/**
 * views-alertas.js — Centro de Alertas (Fase 2 onboarding JMV, aprobado 2026-10-10).
 *
 * Tres grupos con datos REALES del backend (core/alertas.js):
 *  1. Facturas/docs RECLAMADOS (fecha_reclamo del RCV) — crítico: no fiarse como
 *     gasto/crédito hasta resolver con la contraparte.
 *  2. PENDIENTES: sin contabilizar (monto comprometido) y EN REVISIÓN (inconsistencia).
 *  3. SINCRONIZACIÓN atrasada (>30 días sin bajar RCV, o nunca bajada).
 *
 * Cada fila enlaza a la bandeja con el filtro aplicado para actuar.
 */
/* global VIEWS, esc, apiGet, showToast, fmt */

VIEWS.alertas = {
  titulo: 'Alertas — Reclamadas y Pendientes',
  render(cnt) { return renderAlertas(cnt) },
}

async function renderAlertas(cnt) {
  const cont = cnt || document.getElementById('sys-view')
  cont.innerHTML = '<div class="empty">Cargando alertas…</div>'
  let a
  try {
    a = await apiGet(`/api/contable/empresas/${S.empresa.id}/alertas`)
  } catch (err) {
    cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`
    return
  }

  const filaDoc = (d) => `<tr>
    <td><b>${esc(d.razon_social || '—')}</b><div class="sub mono">${esc(d.rut_contraparte || '')}</div></td>
    <td class="mono">${esc(d.tipo_flujo)} ${esc(d.tipo_doc)} · F${esc(d.folio)}</td>
    <td class="mono">${esc(d.fecha_docto || '—')} ${d.fecha_reclamo ? '· <span style="color:var(--danger)">reclamado ' + esc(d.fecha_reclamo) + '</span>' : ''}</td>
    <td class="mono" style="text-align:right">${fmt(d.monto_total || 0)}</td>
    <td><span class="chip ${d.estado === 'REVISION' ? 'anulado' : 'neutral'}">${esc(d.estado)}</span></td>
  </tr>`

  const pend = a.pendientes || {}
  const recl = a.reclamadas || {}
  const sync = a.sincronizacion || {}

  cont.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi ${recl.cantidad ? 'down' : 'up'}"><small>Documentos reclamados</small><strong style="color:${recl.cantidad ? 'var(--danger)' : 'var(--success)'}">${recl.cantidad ?? 0}</strong></div>
      <div class="kpi ${pend.en_revision?.cantidad ? 'down' : ''}"><small>En revisión (inconsistencias)</small><strong style="color:${pend.en_revision?.cantidad ? 'var(--danger)' : 'var(--muted)'}">${pend.en_revision?.cantidad ?? 0}</strong></div>
      <div class="kpi"><small>Sin contabilizar</small><strong>${pend.sin_contabilizar?.cantidad ?? 0}</strong></div>
      <div class="kpi ${sync.atrasada ? 'down' : 'up'}"><small>Sync SII</small><strong style="color:${sync.atrasada ? 'var(--danger)' : 'var(--success)'}">${sync.dias_desde_ultima == null ? 'nunca' : sync.dias_desde_ultima + ' d'}</strong></div>
    </div>

    <div class="card mt">
      <h3>🚨 Documentos reclamados (${recl.cantidad ?? 0}) — monto en juego ${fmt(recl.total || 0)}</h3>
      ${(recl.cantidad ?? 0) > 0 ? `
      <p class="sub">El SII informa estos documentos con <b>reclamo de la contraparte</b> (conflicto formal). No los contabilices como gasto/crédito hasta resolver: el cierre los bloquea.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Contraparte</th><th>Documento</th><th>Fecha</th><th style="text-align:right">Total</th><th>Estado</th></tr></thead>
        <tbody>${(recl.documentos || []).map(filaDoc).join('')}</tbody>
      </table></div>` : '<p class="muted">Sin reclamados — todo en orden.</p>'}
    </div>

    <div class="card mt">
      <h3>⚠️ En revisión (${pend.en_revision?.cantidad ?? 0}) — ${fmt(pend.en_revision?.monto || 0)}</h3>
      ${(pend.en_revision?.cantidad ?? 0) > 0 ? `
      <p class="sub">Documentos con inconsistencia de montos del RCV (neto+IVA ≠ total). Revisar en la bandeja antes de contabilizar.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Contraparte</th><th>Documento</th><th>Fecha</th><th style="text-align:right">Total</th><th>Estado</th></tr></thead>
        <tbody>${(pend.en_revision.documentos || []).map(filaDoc).join('')}</tbody>
      </table></div>` : '<p class="muted">Sin inconsistencias.</p>'}
    </div>

    <div class="card mt">
      <h3>📋 Sin contabilizar (${pend.sin_contabilizar?.cantidad ?? 0}) — ${fmt(pend.sin_contabilizar?.monto || 0)}</h3>
      ${(pend.sin_contabilizar?.cantidad ?? 0) > 0 ? `
      <p class="sub">Los primeros 50 por fecha. Acción: ⚡ Contabilización y Pendientes.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Contraparte</th><th>Documento</th><th>Fecha</th><th style="text-align:right">Total</th><th>Estado</th></tr></thead>
        <tbody>${(pend.sin_contabilizar.documentos || []).map(filaDoc).join('')}</tbody>
      </table></div>` : '<p class="muted">Bandeja al día.</p>'}
    </div>

    ${sync.atrasada ? `<div class="card mt" style="border-color:var(--warning)">
      <h3>📡 Sincronización atrasada</h3>
      <p class="muted">${sync.dias_desde_ultima == null
        ? 'Este período no tiene documentos ingestado: baja el RCV para poblar el dashboard.'
        : `${sync.dias_desde_ultima} días sin actualizar (> ${sync.umbral_dias}): los reportes pueden reflejar datos viejos. Baja el RCV en la Bandeja de Documentos.`}</p>
    </div>` : ''}
  `
}
