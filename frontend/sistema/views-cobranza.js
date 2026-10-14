/**
 * views-cobranza.js — Cobranza de clientes (Fase 3 JMV).
 *
 * Tabla de clientes con saldo pendiente (mora por nivel), documentos abiertos
 * con antigüedad, y el botón «Pagada» por documento: registra el cobro
 * (backend: transacción única asiento núcleo + movimiento banco + vínculo)
 * y refresca sin recargar nada a mano.
 *//* global VIEWS, S, esc, apiGet, apiPost, showToast, renderRoute, fmt */

VIEWS.cobranza = {
  titulo: 'Cobranza de Clientes',
  render(cnt) { return renderCobranza(cnt) },
}

const NIVEL_CHIP = { rojo: 'anulado', amarillo: 'pendiente', verde: 'contabilizado' }

async function renderCobranza(cnt) {
  const cont = cnt || document.getElementById('sys-view')
  cont.innerHTML = '<div class="empty">Cargando cobranza…</div>'
  let cob, bancos
  try {
    ;[cob, bancos] = await Promise.all([
      apiGet(`/api/contable/empresas/${S.empresa.id}/cobranza`),
      apiGet(`/api/contable/empresas/${S.empresa.id}/bancos`),
    ])
  } catch (err) {
    cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`
    return
  }

  const CRED = cob.credito || null
  const sel = (id) => `
    <select class="form-input ccb-banco" data-doc="${id}" style="max-width:230px; padding:3px 6px">
      ${(bancos.bancos || []).map((b) => `<option value="${b.id}">${esc(b.banco)}${b.numero ? ' ' + esc(b.numero) : ''}</option>`).join('')}</select>`

  cont.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi down"><small>Pendiente de cobro</small><strong style="color:var(--danger)">${fmt(cob.total_pendiente || 0)}</strong></div>
      <div class="kpi"><small>Clientes en mora</small><strong>${(cob.clientes || []).length}</strong></div>
      <div class="kpi"><small>Rojos (>30 d)</small><strong style="color:var(--danger)">${(cob.clientes || []).filter(c => c.nivel === 'rojo').length}</strong></div>
      <div class="kpi up"><small>Amarillos (15–30 d)</small><strong style="color:var(--warning)">${(cob.clientes || []).filter(c => c.nivel === 'amarillo').length}</strong></div>
      ${CRED ? `<div class="kpi ${CRED.sobrepasados > 0 ? 'down' : 'up'}"><small>Sobre su crédito</small><strong style="color:var(--danger)">${CRED.sobrepasados}</strong><span class="sub">${CRED.sin_ficha} sin ficha · autorizado ${fmt(CRED.total_autorizado)}</span></div>` : ''}
    </div>

    ${(cob.clientes || []).length === 0
      ? '<div class="card mt"><p class="muted">Sin saldos pendientes — todos los clientes al día.</p></div>'
      : (cob.clientes || []).map((c) => `
    <div class="card mt">
      <div class="frm-row" style="align-items:center; justify-content:space-between">
        <div>
          <h3 style="margin-bottom:2px">${esc(c.razon_social)}</h3>
          <span class="sub mono">${esc(c.rut)} · mora máx ${c.mora_max_dias} d${c.credito_autorizado !== null && c.credito_autorizado !== undefined ? ` · crédito ${fmt(c.credito_autorizado)}` : ''}</span>
          ${c.credito_autorizado !== null && c.credito_autorizado !== undefined && Number(c.saldo) > Number(c.credito_autorizado) ? `<span class="chip anulado">Sobre su crédito (${fmt(Number(c.credito_autorizado) - Number(c.saldo))})</span>` : (c.credito_autorizado === null || c.credito_autorizado === undefined) && CRED ? '<span class="sub">sin ficha de crédito</span>' : ''}
        </div>
        <div style="text-align:right">
          <span class="chip ${NIVEL_CHIP[c.nivel]}">${c.nivel}</span>
          <div><b class="mono">${fmt(c.saldo)}</b></div>
        </div>
      </div>
      <div class="tbl-wrap mt"><table class="tbl">
        <thead><tr><th>Folio</th><th>Fecha</th><th style="text-align:right">Total</th><th>Mora</th><th>Acción</th></tr></thead>
        <tbody>${(c.documentos_abiertos || []).map((d) => `<tr data-doc="${d.id}">
          <td class="mono">F${esc(d.folio)}</td>
          <td class="mono">${esc(d.fecha_docto || '—')}</td>
          <td class="mono" style="text-align:right">${fmt(d.monto_total)}</td>
          <td class="mono">${d.mora_dias} d</td>
          <td>${sel(d.id)} <button class="btn btn-primary btn-sm ccb-pagada" data-doc="${d.id}">Pagada</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('')}

    <p class="sub mt">«Pagada» registra el cobro en Tesorería con asiento del núcleo (Debe banco / Haber clientes), lo conecta a la factura y baja el saldo al instante — todo auditado. Cobros parciales: el botón paga el total; para parciales usa Tesorería → Cobros con el documento indicado.</p>
  `

  // acciones
  cont.querySelectorAll('.ccb-pagada').forEach((b) => b.addEventListener('click', async () => {
    const docId = b.dataset.doc
    const selB = cont.querySelector(`.ccb-banco[data-doc="${docId}"]`)
    try {
      const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/cobranza/${docId}/pagada`, { banco_cuenta_id: Number(selB.value) })
      showToast(`Cobrado: asiento F${r.asiento_folio} · saldo restante ${fmt(r.saldo_restante)}`, 'success')
      renderRoute()
    } catch (e) { showToast(e.message, 'error') }
  }))
}
