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
  // Los documentos visibles, con su cliente: el diálogo de cobro necesita el
  // folio, el monto y el nombre para decir QUÉ se va a crear antes de escribir.
  const docsPorId = new Map()
  ;(cob.clientes || []).forEach((c) => (c.documentos_abiertos || []).forEach((d) => {
    docsPorId.set(String(d.id), { ...d, cliente: c.razon_social })
  }))
  const sel = (id) => `
    <select class="form-input ccb-banco" data-doc="${id}" style="max-width:230px; padding:3px 6px">
      ${(bancos.bancos || []).map((b) => `<option value="${b.id}">${esc(b.banco)}${b.numero ? ' ' + esc(b.numero) : ''}</option>`).join('')}</select>`

  cont.innerHTML = `
    <p class="pg-flow"><b>Flujo:</b> <a href="#tesoreria">Tesorería</a> → Cobranza → <a href="#cclientes">Cuenta corriente de clientes</a></p>
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
          <td>${sel(d.id)} <button class="btn btn-primary btn-sm ccb-pagada" data-doc="${d.id}" aria-label="Registrar pagada la factura ${esc(d.folio)}">Pagada</button>
            <button class="btn btn-secondary btn-sm ccb-apl" data-doc="${d.id}" data-ref="Factura ${esc(d.folio)}">Aplicaciones</button></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>`).join('')}

    <p class="sub mt">«Pagada» muestra antes el banco, el monto y el asiento que va a crear (Debe banco / Haber clientes); al confirmar, el cobro queda en Tesorería conectado a la factura y el saldo baja al instante — todo auditado. Cobros parciales: el botón paga el total; para parciales usa Tesorería → Cobros con el documento indicado. «Aplicaciones» muestra con qué movimientos se ha pagado cada factura.</p>
  `

  // acciones
  cont.querySelectorAll('.ccb-pagada').forEach((b) => b.addEventListener('click', async () => {
    const docId = String(b.dataset.doc)
    const doc = docsPorId.get(docId) || { id: docId, folio: '—', monto_total: 0, cliente: '' }
    const selB = cont.querySelector(`.ccb-banco[data-doc="${docId}"]`)
    const banco = (bancos.bancos || []).find((x) => String(x.id) === String(selB.value)) || { id: selB.value, banco: '—' }
    try { await modalPagadaCobranza(doc, banco) } catch (e) { showToast(e.message, 'error') }
  }))

  cont.querySelectorAll('.ccb-apl').forEach((b) => b.addEventListener('click', () => {
    modalAplicacionesDocumento(Number(b.dataset.doc), b.dataset.ref || '')
  }))
}

/**
 * Cobro de una factura: dice qué banco, qué monto y qué asiento se van a
 * crear ANTES de escribir (antes el botón creaba el movimiento a ciegas).
 * Solo escribe si la persona confirma; el backend sigue validando todo.
 */
async function modalPagadaCobranza(doc, banco) {
  const hoy = new Date().toISOString().slice(0, 10)
  const bancoTexto = `${banco?.banco || '—'}${banco?.numero ? ` ${banco.numero}` : ''}`
  const ok = await UIEstado.confirmar({
    titulo: `Cobrar folio ${doc.folio}`,
    texto: 'Registrar cobro',
    idBoton: 'ccb-conf-ok',
    cuerpo: `
      <p>Se registrará el cobro completo del documento y su asiento en partida doble.</p>
      <dl>
        ${UIEstado.dato('Cliente', esc(doc.cliente || '—'))}
        ${UIEstado.dato('Documento', `F${esc(doc.folio)} · ${esc(String(doc.fecha_docto || '').slice(0, 10) || 'sin fecha')}`)}
        ${UIEstado.dato('Monto', `<b class="mono">${fmt(doc.monto_total)}</b>`)}
        ${UIEstado.dato('Banco', esc(bancoTexto))}
        ${UIEstado.dato('Asiento', 'Debe banco / Haber clientes')}
        ${UIEstado.dato('Fecha del movimiento', esc(hoy))}
      </dl>
      <p class="hint mt">No se puede deshacer: queda auditado y baja el saldo del cliente.</p>`,
  })
  if (!ok) return null
  try {
    const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/cobranza/${doc.id}/pagada`, { banco_cuenta_id: Number(banco.id) })
    showToast(`Cobrado: asiento F${r.asiento_folio} · saldo restante ${fmt(r.saldo_restante)}`, 'success')
    renderRoute()
    return r
  } catch (e) {
    showToast(e.message, 'error')
    return null
  }
}
