/**
 * VISTA SUSCRIPCIÓN Y PAGOS (SAAS-3): estado de la licencia, contratación de
 * planes por checkout (MercadoPago — webhook idempotente → activarPlan),
 * historial de pagos y emisión de la factura electrónica (DTE 33) de cada
 * pago aprobado. El pago jamás queda bloqueado por la propia licencia:
 * una empresa suspendida debe poder pagarse para reactivarse.
 */

const PLANES_INFO = {
  PYME: '1 empresa · 5 usuarios · 300 docs/mes',
  PRO: '3 empresas · 10 usuarios · 2.000 docs/mes',
  DESPACHO: '10 empresas · usuarios ilimitados · sin límite de docs',
}

const ESTADO_PAGO = {
  PENDIENTE: 'pendiente', APROBADO: 'contabilizado', RECHAZADO: 'error',
}

VIEWS.suscripcion = {
  titulo: 'Suscripción y Pagos',
  async render(cont) {
    const eid = S.empresa.id
    let data
    try {
      data = await apiGet(`/api/pagos/empresas/${eid}/pagos`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const lic = data.suscripcion || {}
    const puedePagar = tiene('licencias:pagar')
    const puedeFacturar = tiene('facturacion:emitir')

    cont.innerHTML = `
      <div class="card">
        <h3>Licencia de la empresa</h3>
        ${lic.plan ? `
          <div class="kpis" style="margin-top:8px">
            <div class="kpi"><div class="kpi-label">Plan</div><div class="kpi-val">${esc(lic.plan)}</div></div>
            <div class="kpi"><div class="kpi-label">Estado</div><div class="kpi-val">${esc(lic.estado)}</div></div>
            <div class="kpi"><div class="kpi-label">Vence</div><div class="kpi-val">${esc(lic.fin || '—')}</div></div>
            <div class="kpi"><div class="kpi-label">Días restantes</div><div class="kpi-val">${lic.dias_restantes ?? '—'}</div></div>
          </div>
          ${lic.gracia_hasta ? `<p class="muted" style="margin-top:6px">⚠ Gracia hasta <b>${esc(lic.gracia_hasta)}</b> — contrata un plan para evitar la suspensión.</p>` : ''}
        ` : `<p class="muted">La empresa no tiene licencia asignada.</p>`}
      </div>

      ${puedePagar ? `
        <div class="card">
          <h3>Contratar o renovar plan</h3>
          ${data.checkout_disponible ? `
            <p class="muted">El pago se procesa con MercadoPago (Checkout Pro). Al aprobarse, la licencia se activa sola — no hace falta esperar a JMV.</p>
            <div class="grid-3" style="margin-top:10px">
              ${data.planes.filter((p) => p.plan !== 'PRUEBA').map((p) => `
                <div class="card" style="margin:0">
                  <b>${esc(p.plan)}</b>
                  <div class="kpi-val" style="font-size:1.4rem">$${fmtM(p.monto_clp)}<small class="muted">/mes</small></div>
                  <p class="muted">${PLANES_INFO[p.plan] || ''}</p>
                  <label class="muted">Período:
                    <select class="form-input" data-meses="${p.plan}" style="max-width:130px">
                      <option value="1">1 mes</option>
                      <option value="3">3 meses</option>
                      <option value="12">12 meses</option>
                    </select>
                  </label>
                  <button class="btn btn-primary" data-plan="${p.plan}" style="margin-top:8px">Contratar ${esc(p.plan)}</button>
                </div>
              `).join('')}
            </div>
            <p class="muted" style="margin-top:8px">Serás redirigido a MercadoPago para pagar. Vuelve aquí después: el estado se actualiza con el webhook del pago.</p>
          ` : `<p class="muted">El checkout no está disponible todavía (falta MP_ACCESS_TOKEN en el servidor). Habla con JMV para activar tu plan.</p>`}
        </div>
      ` : ''}

      <div id="factura-panel"></div>

      <div class="card">
        <h3>Historial de pagos</h3>
        ${data.pagos.length ? `
          <table class="tbl">
            <thead><tr><th>Fecha</th><th>Plan</th><th>Período</th><th>Monto</th><th>Pasarela</th><th>Estado</th><th>Factura</th>${puedeFacturar ? '<th></th>' : ''}</tr></thead>
            <tbody>
              ${data.pagos.map((p) => {
                const fac = (data.facturas || []).find((f) => f.pago_id === p.id)
                return `
                  <tr>
                    <td>${esc((p.creado_en || '').slice(0, 10))}</td>
                    <td>${esc(p.plan)}</td>
                    <td>${p.meses} mes(es)</td>
                    <td>$${fmtM(p.monto_clp)}</td>
                    <td>${esc(p.gateway)}</td>
                    <td><span class="chip ${ESTADO_PAGO[p.estado] || 'neutral'}">${esc(p.estado)}</span></td>
                    <td>${fac ? (fac.estado === 'EMITIDA' ? `Emitida · folio ${fac.folio}` : esc(fac.estado)) : '—'}</td>
                    ${puedeFacturar ? `<td>${p.estado === 'APROBADO' && (!fac || fac.estado !== 'EMITIDA')
                      ? `<button class="btn btn-secondary" data-facturar="${p.id}">Emitir factura</button>` : ''}</td>` : ''}
                  </tr>
                `
              }).join('')}
            </tbody>
          </table>
        ` : `<p class="muted">Sin pagos registrados todavía.</p>`}
      </div>`

    // Checkout → redirigir a MercadoPago
    cont.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
      const plan = b.dataset.plan
      const meses = Number(cont.querySelector(`[data-meses="${plan}"]`).value) || 1
      if (!confirm(`¿Contratar el plan ${plan} por ${meses} mes(es)? Serás redirigido a MercadoPago.`)) return
      try {
        const r = await apiPost(`/api/pagos/empresas/${eid}/checkout`, { plan, meses })
        showToast('Checkout creado — redirigiendo a MercadoPago…', 'ok')
        window.location.href = r.checkout.init_point
      } catch (err) { showToast(err.message, 'error') }
    }))

    // Emitir factura: panel inline con giro/dirección/comuna (el SII los exige
    // y pueden no estar en la ficha — se piden, no se adivinan, §42).
    cont.querySelectorAll('[data-facturar]').forEach((b) => b.addEventListener('click', () => {
      const pagoId = b.dataset.facturar
      const panel = document.getElementById('factura-panel')
      panel.innerHTML = `
        <div class="card" style="border-color:var(--primary)">
          <h3>Emitir factura electrónica — pago #${esc(pagoId)}</h3>
          <p class="muted">Datos del receptor para el DTE 33 (se precargan si la ficha ya los tiene; el emisor es la configuración DTE del servidor).</p>
          <div class="grid-3">
            <label class="muted">Giro<input class="form-input" id="f-giro" placeholder="Actividad económica"></label>
            <label class="muted">Dirección<input class="form-input" id="f-dir" placeholder="Calle y número"></label>
            <label class="muted">Comuna<input class="form-input" id="f-com" placeholder="Comuna"></label>
          </div>
          <button class="btn btn-primary" id="f-emitir" style="margin-top:8px">Emitir DTE</button>
          <button class="btn btn-secondary" id="f-cancelar">Cancelar</button>
        </div>`
      panel.scrollIntoView({ behavior: 'smooth' })
      document.getElementById('f-cancelar').addEventListener('click', () => { panel.innerHTML = '' })
      document.getElementById('f-emitir').addEventListener('click', async () => {
        try {
          const r = await apiPost(`/api/pagos/empresas/${eid}/pagos/${pagoId}/factura`, {
            giro: document.getElementById('f-giro').value,
            direccion: document.getElementById('f-dir').value,
            comuna: document.getElementById('f-com').value,
          })
          showToast(`Factura emitida — folio ${r.factura.folio}, track ${r.factura.track_id}`, 'ok')
          renderRoute()
        } catch (err) { showToast(err.message, 'error') }
      })
    }))
  },
}
