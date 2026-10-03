/**
 * VISTA ACTIVOS FIJOS (FASE 7): registro con cuenta del plan, venta/baja con
 * su asiento (utilidad/pérdida) y depreciación mensual del período — propuesta
 * visible y confirmación humana, como todo lo que contabiliza en el sistema.
 */

VIEWS.activos = {
  titulo: 'Activos Fijos y Depreciación',
  async render(cont) {
    const eid = S.empresa.id
    const tab = window._activosTab || 'activos'

    let resumen = null
    try {
      resumen = (await apiGet(`/api/contable/empresas/${eid}/activos/resumen`)).resumen
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const puedeOperar = tiene('activos:operar')

    cont.innerHTML = `
      <div class="tabs">
        <button data-t="activos" class="${tab === 'activos' ? 'active' : ''}">🏢 Activos</button>
        <button data-t="depreciacion" class="${tab === 'depreciacion' ? 'active' : ''}">📆 Depreciación del período</button>
      </div>
      <div id="activos-body"></div>`

    cont.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      window._activosTab = b.dataset.t
      renderRoute()
    }))

    const body = document.getElementById('activos-body')
    if (tab === 'activos') await renderActivos(body, { eid, resumen, puedeOperar })
    else await renderDepreciacion(body, { eid, puedeOperar })
  },
}

/* ============================ ACTIVOS ============================ */

async function renderActivos(cont, { eid, resumen, puedeOperar }) {
  let data = null
  let imputables = []
  try {
    data = await apiGet(`/api/contable/empresas/${eid}/activos`)
    imputables = (await getCuentasImputables()).cuentas
  } catch (err) { showToast(err.message, 'error') }
  const activos = data.activos || []

  const cuentasActivo = imputables.filter((c) => String(c.codigo).startsWith('1.'))
  const cuentasPatrimonio = imputables.filter((c) => String(c.codigo).startsWith('3.'))

  const chipEstado = (e) => `<span class="chip ${e === 'ACTIVO' ? 'contabilizado' : e === 'VENDIDO' ? 'propuesto' : 'pendiente'}">${e === 'ACTIVO' ? 'en uso' : e === 'VENDIDO' ? 'vendido' : 'baja'}</span>`

  cont.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi"><small>Activos en uso</small><strong>${resumen.activos}</strong><span class="sub">adquisición ${fmtCorto(resumen.valor_adquisicion)}</span></div>
      <div class="kpi"><small>Depreciación acumulada</small><strong>${fmtCorto(resumen.depreciacion_acumulada)}</strong><span class="sub">todos los activos</span></div>
      <div class="kpi ${resumen.valor_libro >= 0 ? 'up' : 'bad'}"><small>Valor libro</small><strong>${fmtCorto(resumen.valor_libro)}</strong><span class="sub">adquisición − depreciación</span></div>
      <div class="kpi ${resumen.cuota_mensual_proyectada > 0 ? 'acc' : ''}"><small>Cuota mensual</small><strong>${fmtCorto(resumen.cuota_mensual_proyectada)}</strong><span class="sub">pendiente de ${esc(resumen.periodo_actual.slice(4))}/${esc(resumen.periodo_actual.slice(0, 4))}: ${fmtCorto(resumen.depreciacion_periodo_actual)}</span></div>
    </div>

    <div class="card mt">
      <h3>Registro de activos</h3>
      ${activos.length ? `
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Código</th><th>Descripción</th><th>Cuenta</th><th>Adquisición</th><th class="num">Valor</th><th class="num">Vida</th><th class="num">Cuota/mes</th><th class="num">Dep. acum.</th><th class="num">Valor libro</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${activos.map((a) => `
              <tr>
                <td class="mono">${esc(a.codigo)}</td>
                <td>${esc(a.descripcion)}</td>
                <td class="sub">${esc(a.cuenta_activo || '—')}</td>
                <td class="sub">${esc(a.fecha_adquisicion)}</td>
                <td class="num">${fmtM(a.valor_adquisicion)}</td>
                <td class="num sub">${a.vida_util_meses} m</td>
                <td class="num">${a.cuota_base ? fmtM(a.cuota_base) : '—'}</td>
                <td class="num">${fmtM(a.depreciacion_acumulada)}</td>
                <td class="num"><b>${fmtM(a.valor_libro)}</b></td>
                <td>${chipEstado(a.estado)}</td>
                <td>${puedeOperar && a.estado === 'ACTIVO' ? `<button class="btn btn-secondary btn-sm vb-btn" data-id="${a.id}" data-codigo="${esc(a.codigo)}" data-libro="${a.valor_libro}">Venta/Baja</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="empty">Sin activos registrados todavía.</div>'}
    </div>

    <div id="vb-panel"></div>

    ${puedeOperar ? `
    <div class="card mt">
      <h3>Nuevo activo fijo</h3>
      <p class="hint" style="margin-top:-6px">La depreciación es por línea recta: (valor − valor residual) ÷ vida útil. Cada mes se propone un asiento gasto ↔ depreciación acumulada para confirmar en un clic.</p>
      <div class="frm-row mt">
        <div><span class="frm-label">Código</span><input id="a-codigo" class="form-input" placeholder="AF-001"></div>
        <div style="flex:2"><span class="frm-label">Descripción</span><input id="a-desc" class="form-input" placeholder="Camioneta reparto"></div>
        <div><span class="frm-label">Cuenta del activo</span>
          <select id="a-cuenta" class="form-input">${cuentasActivo.map((c) => `<option value="${c.id}">${esc(c.codigo)} ${esc(c.nombre)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="frm-row mt">
        <div><span class="frm-label">Fecha adquisición</span><input id="a-fecha" class="form-input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div><span class="frm-label">Valor adquisición</span><input id="a-valor" class="form-input" type="number" min="1"></div>
        <div><span class="frm-label">Vida útil (meses)</span><input id="a-vida" class="form-input" type="number" min="1" value="60"></div>
        <div><span class="frm-label">Valor residual</span><input id="a-residual" class="form-input" type="number" min="0" value="0"></div>
      </div>
      <div class="frm-row mt">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="a-alta"> <label for="a-alta" style="white-space:nowrap">Contabilizar alta</label>
        </div>
        <div style="flex:1"><span class="frm-label">Contraparte del alta (si ya está en los libros, no marques esta casilla)</span>
          <select id="a-contra" class="form-input" disabled>${cuentasPatrimonio.map((c) => `<option value="${c.id}">${esc(c.codigo)} ${esc(c.nombre)}</option>`).join('')}</select>
        </div>
        <div style="align-self:flex-end"><button class="btn btn-primary" id="a-crear">Registrar activo</button></div>
      </div>
    </div>` : '<div class="card mt"><p class="hint">Solo lectura: tu rol no registra activos ni ejecuta depreciaciones.</p></div>'}`

  if (puedeOperar) {
    document.getElementById('a-alta').addEventListener('change', (e) => {
      document.getElementById('a-contra').disabled = !e.target.checked
    })
    document.getElementById('a-crear').addEventListener('click', async () => {
      try {
        const conAlta = document.getElementById('a-alta').checked
        await apiPost(`/api/contable/empresas/${eid}/activos`, {
          codigo: document.getElementById('a-codigo').value.trim(),
          descripcion: document.getElementById('a-desc').value.trim(),
          cuenta_activo_id: Number(document.getElementById('a-cuenta').value),
          fecha_adquisicion: document.getElementById('a-fecha').value,
          valor_adquisicion: Number(document.getElementById('a-valor').value),
          vida_util_meses: Number(document.getElementById('a-vida').value),
          valor_residual: Number(document.getElementById('a-residual').value || 0),
          contabilizar_alta: conAlta,
          cuenta_contra_id: conAlta ? Number(document.getElementById('a-contra').value) : null,
        })
        showToast('Activo registrado', 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })

    // Panel de venta/baja inline
    cont.querySelectorAll('.vb-btn').forEach((btn) => btn.addEventListener('click', () => {
      const panel = document.getElementById('vb-panel')
      const destinoOpts = cuentasActivo.map((c) => `<option value="${c.id}">${esc(c.codigo)} ${esc(c.nombre)}</option>`).join('')
      panel.innerHTML = `
        <div class="card" style="border-color:var(--accent)">
          <h3>Venta o baja — ${esc(btn.dataset.codigo)} <span class="sub">(valor libro ${fmtM(Number(btn.dataset.libro))})</span></h3>
          <div class="frm-row mt">
            <div><span class="frm-label">Operación</span>
              <select id="vb-tipo" class="form-input"><option value="VENTA">Venta (con contraprestación)</option><option value="BAJA">Baja (sin contraprestación)</option></select>
            </div>
            <div><span class="frm-label">Fecha</span><input id="vb-fecha" class="form-input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
            <div><span class="frm-label">Precio de venta</span><input id="vb-precio" class="form-input" type="number" min="1"></div>
            <div style="flex:1"><span class="frm-label">Cuenta destino (banco, cliente…)</span>
              <select id="vb-destino" class="form-input">${destinoOpts}</select>
            </div>
            <div style="align-self:flex-end">
              <button class="btn btn-primary" id="vb-confirmar">Confirmar</button>
              <button class="btn btn-secondary" id="vb-cancelar">Cancelar</button>
            </div>
          </div>
          <p class="hint mt">El asiento limpia el costo y la depreciación acumulada del activo y lleva la diferencia a utilidad o pérdida. El activo deja de depreciarse.</p>
        </div>`
      const syncPrecio = () => {
        const esVenta = document.getElementById('vb-tipo').value === 'VENTA'
        document.getElementById('vb-precio').disabled = !esVenta
        document.getElementById('vb-destino').disabled = !esVenta
      }
      document.getElementById('vb-tipo').addEventListener('change', syncPrecio)
      syncPrecio()
      document.getElementById('vb-cancelar').addEventListener('click', () => { panel.innerHTML = '' })
      document.getElementById('vb-confirmar').addEventListener('click', async () => {
        try {
          const esVenta = document.getElementById('vb-tipo').value === 'VENTA'
          const r = await apiPost(`/api/contable/empresas/${eid}/activos/${btn.dataset.id}/venta-baja`, {
            tipo: document.getElementById('vb-tipo').value,
            fecha: document.getElementById('vb-fecha').value,
            precio_venta: esVenta ? Number(document.getElementById('vb-precio').value) : 0,
            cuenta_destino_id: esVenta ? Number(document.getElementById('vb-destino').value) : null,
          })
          const dif = r.utilidad_perdida || 0
          showToast(`Asiento F${r.folio}/${r.anio} registrado${dif ? ` — ${dif > 0 ? 'utilidad' : 'pérdida'} ${fmtM(Math.abs(dif))}` : ''}`, 'success')
          if (r.aviso) showToast(r.aviso, 'info')
          renderRoute()
        } catch (err) { showToast(err.message, 'error') }
      })
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }))
  }
}

/* ========================== DEPRECIACIÓN ========================== */

async function renderDepreciacion(cont, { eid, puedeOperar }) {
  const periodo = window._activosDepPeriodo || periodoActual()
  cont.innerHTML = `
    <div class="frm-row mb">
      <div><span class="frm-label">Período</span>${inputPeriodoHTML('dep-periodo', periodo)}</div>
      <span class="sub">Se propone un asiento al último día del mes: gasto por depreciación ↔ depreciación acumulada</span>
    </div>
    <div id="dep-out"><div class="empty">Calcula la depreciación del período.</div></div>`

  document.getElementById('dep-periodo').addEventListener('change', () => {
    window._activosDepPeriodo = leerPeriodo('dep-periodo') || periodo
    calcular()
  })

  const calcular = async () => {
    const per = window._activosDepPeriodo || periodo
    const out = document.getElementById('dep-out')
    out.innerHTML = '<div class="empty">Calculando…</div>'
    let d
    try { d = (await apiGet(`/api/contable/empresas/${eid}/activos-depreciacion/${per}`)).depreciacion }
    catch (err) { out.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }

    out.innerHTML = `
      ${d.periodo_cerrado ? '<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">El período está CERRADO: no admite depreciación.</div>' : ''}
      <div class="kpi-grid mb">
        <div class="kpi ${d.total > 0 ? 'acc' : ''}"><small>Total a depreciar</small><strong>${fmtM(d.total)}</strong><span class="sub">${d.items.length} activo(s)</span></div>
        <div class="kpi"><small>Fecha del asiento</small><strong class="mono" style="font-size:var(--fs-lg)">${esc(d.fecha_asiento)}</strong><span class="sub">último día del período</span></div>
        <div class="kpi ${d.omitidos.length ? 'warn' : 'up'}"><small>Omitidos</small><strong>${d.omitidos.length}</strong><span class="sub">con motivo explicado</span></div>
      </div>
      ${d.items.length ? `
      <div class="card">
        <h3>Activos a depreciar — ${esc(per)}</h3>
        <div class="tbl-wrap mt"><table class="tbl">
          <thead><tr><th>Código</th><th>Descripción</th><th class="num">Cuota</th>${d.items.some((i) => i.motivo) ? '<th>Nota</th>' : ''}</tr></thead>
          <tbody>${d.items.map((it) => `
            <tr>
              <td class="mono">${esc(it.codigo)}</td><td>${esc(it.descripcion)}</td>
              <td class="num">${fmtM(it.cuota)}</td>
              ${d.items.some((i) => i.motivo) ? `<td class="sub">${esc(it.motivo || '')}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table></div>
        ${puedeOperar && d.puede_confirmar ? `<div class="mt"><button class="btn btn-primary" id="dep-confirmar">Confirmar depreciación de ${esc(per)}</button></div>
        <p class="hint mt">La confirmación crea el asiento en partida doble y registra la cuota de cada activo — no se puede repetir el mismo mes.</p>` : ''}
      </div>` : '<div class="card"><div class="empty">No hay activos para depreciar en este período.</div></div>'}
      ${d.omitidos.length ? `
      <div class="card mt"><h3>Omitidos (${d.omitidos.length})</h3>
        <div class="tbl-wrap mt"><table class="tbl">
          <thead><tr><th>Código</th><th>Descripción</th><th>Motivo</th></tr></thead>
          <tbody>${d.omitidos.map((o) => `<tr><td class="mono">${esc(o.codigo)}</td><td>${esc(o.descripcion)}</td><td class="sub">${esc(o.motivo)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>` : ''}`

    const btn = document.getElementById('dep-confirmar')
    if (btn) btn.addEventListener('click', async () => {
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/activos-depreciacion/${per}/confirmar`, {})
        showToast(`Depreciación registrada: asiento F${r.folio}/${r.anio} por ${fmtM(r.total)}`, 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  }

  await calcular()
}
