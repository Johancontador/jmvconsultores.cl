/**
 * VISTA NIIF (FASE 8): mapeo cuentas → rubros de presentación (editable y
 * auditado) + Estado de Situación Financiera y Estado de Resultados por
 * rubros, 100% derivados del mayor. Una cuenta sin rubro aparece en
 * SIN_CLASIFICAR — el sistema nunca adivina la presentación.
 */

VIEWS.niif = {
  titulo: 'NIIF — Estados por Rubros',
  async render(cont) {
    const eid = S.empresa.id
    const tab = window._niifTab || 'situacion'

    cont.innerHTML = `
      <div class="tabs">
        <button data-t="situacion" class="${tab === 'situacion' ? 'active' : ''}">⚖️ Situación Financiera</button>
        <button data-t="resultados" class="${tab === 'resultados' ? 'active' : ''}">📈 Resultados (por naturaleza)</button>
        <button data-t="mapeo" class="${tab === 'mapeo' ? 'active' : ''}">🗺️ Mapeo de cuentas</button>
      </div>
      <div id="niif-body"></div>`

    cont.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      window._niifTab = b.dataset.t
      renderRoute()
    }))

    const body = document.getElementById('niif-body')
    if (tab === 'mapeo') await renderMapeo(body, { eid })
    else if (tab === 'resultados') await renderResultados(body, { eid })
    else await renderSituacion(body, { eid })
  },
}

/* ===================== SITUACIÓN FINANCIERA ===================== */

async function renderSituacion(cont, { eid }) {
  const periodo = window._niifPeriodo || periodoActual()
  cont.innerHTML = `
    <div class="frm-row mb">
      <div><span class="frm-label">Período</span>${inputPeriodoHTML('niif-periodo', periodo)}</div>
      <span class="sub">Acumulado al último día del mes — PYE presentado neto de depreciación acumulada</span>
    </div>
    <div id="niif-out"><div class="empty">Cargando…</div></div>`

  document.getElementById('niif-periodo').addEventListener('change', () => {
    window._niifPeriodo = leerPeriodo('niif-periodo') || periodo
    renderRoute()
  })

  let s
  try { s = (await apiGet(`/api/contable/empresas/${eid}/niif/situacion/${window._niifPeriodo || periodo}`)).situacion }
  catch (err) { document.getElementById('niif-out').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }

  const grupo = (titulo, g) => `
    <div class="card mb">
      <h3>${esc(titulo)} <span class="num" style="float:right;font-family:var(--font-mono)">${fmtM(g.total)}</span></h3>
      ${g.rubros.length ? g.rubros.map((r) => `
        <div class="mt">
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--border-subtle)">
            <b>${esc(r.nombre)}</b><span class="num mono">${fmtM(r.saldo)}</span>
          </div>
          <table class="tbl" style="margin-bottom:10px">
            <tbody>${r.cuentas.map((c) => `
              <tr><td class="mono sub" style="width:110px">${esc(c.codigo)}</td><td style="padding-left:12px">${esc(c.nombre)}</td><td class="num sub">${fmtM(c.saldo)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>`).join('') : '<p class="hint mt">Sin saldos en esta sección.</p>'}
    </div>`

  document.getElementById('niif-out').innerHTML = `
    <div class="kpi-grid mb">
      <div class="kpi"><small>Activo corriente</small><strong>${fmtCorto(s.activo_corriente.total)}</strong></div>
      <div class="kpi"><small>Activo no corriente</small><strong>${fmtCorto(s.activo_no_corriente.total)}</strong></div>
      <div class="kpi"><small>Pasivo corriente</small><strong>${fmtCorto(s.pasivo_corriente.total)}</strong></div>
      <div class="kpi"><small>Patrimonio + resultado</small><strong>${fmtCorto(s.patrimonio.total)}</strong></div>
      <div class="kpi ${s.ecuacion.cuadra ? 'up' : 'bad'}"><small>A = P + PN</small><strong>${s.ecuacion.cuadra ? 'Cuadra' : fmtM(s.ecuacion.diferencia)}</strong></div>
    </div>
    ${s.sin_clasificar ? `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">${s.sin_clasificar} cuenta(s) con movimiento sin rubro NIIF: aparecen como SIN CLASIFICAR — mapea en la pestaña 🗺️ Mapeo de cuentas.</div>` : ''}
    ${grupo('Activo corriente', s.activo_corriente)}
    ${grupo('Activo no corriente', s.activo_no_corriente)}
    ${grupo('Pasivo corriente', s.pasivo_corriente)}
    ${grupo('Pasivo no corriente', s.pasivo_no_corriente)}
    ${grupo('Patrimonio', s.patrimonio)}
    <p class="hint">El resultado del período (${fmtM(s.patrimonio.resultado_periodo)}) se incorpora al patrimonio sin asiento de cierre: la ecuación cuadra en todo estado.</p>`
}

/* ===================== RESULTADOS POR NATURALEZA ===================== */

async function renderResultados(cont, { eid }) {
  const periodo = window._niifResPeriodo || periodoActual()
  cont.innerHTML = `
    <div class="frm-row mb">
      <div><span class="frm-label">Período</span>${inputPeriodoHTML('niifr-periodo', periodo)}</div>
      <span class="sub">Por naturaleza: ingresos − costos − gastos por rubro, del mes y acumulado del año</span>
    </div>
    <div id="niifr-out"><div class="empty">Cargando…</div></div>`

  document.getElementById('niifr-periodo').addEventListener('change', () => {
    window._niifResPeriodo = leerPeriodo('niifr-periodo') || periodo
    renderRoute()
  })

  let r
  try { r = (await apiGet(`/api/contable/empresas/${eid}/niif/resultados/${window._niifResPeriodo || periodo}`)).resultados }
  catch (err) { document.getElementById('niifr-out').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }

  const bloque = (titulo, d) => `
    <div class="card mb"><h3>${esc(titulo)}</h3>
      ${['ingresos', 'costos', 'gastos'].map((k) => d[k] && (d[k].rubros.length || d[k].total) ? `
        <p class="hint mt" style="margin-bottom:4px"><b>${k === 'ingresos' ? '+' : '−'} ${k.toUpperCase()}</b> ${fmtM(d[k].total)}</p>
        <table class="tbl"><tbody>${d[k].rubros.map((g) => `
          <tr><td>${esc(g.nombre)}</td><td class="num mono">${fmtM(g.saldo)}</td></tr>`).join('')}
        </tbody></table>` : '').join('')}
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid var(--border-subtle);margin-top:8px">
        <b>Resultado</b><b class="num mono" style="color:${d.resultado >= 0 ? 'var(--success)' : 'var(--danger)'}">${fmtM(d.resultado)}</b>
      </div>
      ${d.sin_clasificar ? `<p class="hint" style="color:var(--warning)">${d.sin_clasificar} cuenta(s) de resultado sin rubro NIIF — ver 🗺️ Mapeo.</p>` : ''}
    </div>`

  document.getElementById('niifr-out').innerHTML = `
    <div class="kpi-grid mb">
      <div class="kpi up"><small>Ingresos del mes</small><strong>${fmtCorto(r.periodo_mes.ingresos.total)}</strong></div>
      <div class="kpi ${r.periodo_mes.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado del mes</small><strong>${fmtCorto(r.periodo_mes.resultado)}</strong></div>
      <div class="kpi ${r.acumulado.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado acumulado</small><strong>${fmtCorto(r.acumulado.resultado)}</strong><span class="sub">${esc(r.rango_acumulado.desde)} → ${esc(r.rango_acumulado.hasta)}</span></div>
    </div>
    ${bloque('Del período ' + r.periodo, r.periodo_mes)}
    ${bloque('Acumulado del año ' + r.anio, r.acumulado)}`
}

/* ========================== MAPEO ========================== */

async function renderMapeo(cont, { eid }) {
  let m = null
  try { m = await apiGet(`/api/contable/empresas/${eid}/niif/mapeo`) }
  catch (err) { cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }

  const puedeEditar = tiene('cuentas:editar')
  const opciones = (rubro, seccion) => `
    <option value="">— sin rubro (SIN CLASIFICAR) —</option>
    ${m.rubros.map((r) => `<option value="${r.key}" ${rubro === r.key ? 'selected' : ''}>${esc(r.nombre)}</option>`).join('')}`

  cont.innerHTML = `
    ${m.sin_clasificar ? `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">${m.sin_clasificar} cuenta(s) sin rubro NIIF: aparecen como SIN CLASIFICAR en los estados hasta que les asignes un rubro.</div>` : ''}
    <p class="hint mb" style="max-width:780px">Cada cuenta pertenece a UN rubro de presentación NIIF. El mapeo nace sembrado con el plan PUC; cámbialo libremente — queda auditado. Los estados nunca adivinan: lo sin mapear se reporta visible.</p>
    <div class="card">
      <div class="frm-row mb" style="align-items:center">
        <input id="nm-filtro" class="form-input" placeholder="Filtrar por código, nombre o rubro…" style="max-width:340px">
        <span class="spacer"></span>
        <span class="sub" id="nm-resumen">${m.cuentas.length} cuentas · ${m.sin_clasificar} sin clasificar</span>
        ${puedeEditar ? '<button class="btn btn-primary" id="nm-guardar" disabled>Guardar cambios</button>' : ''}
      </div>
      <div class="tbl-wrap" style="max-height:560px;overflow:auto">
        <table class="tbl">
          <thead><tr><th>Código</th><th>Cuenta</th><th>Sección</th><th>Rubro NIIF</th></tr></thead>
          <tbody id="nm-filas">
            ${m.cuentas.map((c) => `
              <tr data-busca="${esc(`${c.codigo} ${c.nombre} ${c.rubro_nombre || ''}`.toLowerCase())}">
                <td class="mono sub">${esc(c.codigo)}</td>
                <td>${esc(c.nombre)}</td>
                <td class="sub">${esc({ activo_corriente: 'Act. corriente', activo_no_corriente: 'Act. no corriente', pasivo_corriente: 'Pas. corriente', pasivo_no_corriente: 'Pas. no corriente', patrimonio: 'Patrimonio', resultado: 'Resultado' }[c.seccion] || c.seccion)}</td>
                <td>${puedeEditar
                  ? `<select class="form-input nm-rubro" data-id="${c.id}" data-original="${esc(c.rubro_niif || '')}" style="min-width:280px">${opciones(c.rubro_niif, c.seccion)}</select>`
                  : `<span class="sub">${esc(c.rubro_nombre || 'SIN CLASIFICAR')}</span>`}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`

  const filtro = document.getElementById('nm-filtro')
  filtro.addEventListener('input', () => {
    const q = filtro.value.trim().toLowerCase()
    document.querySelectorAll('#nm-filas tr').forEach((tr) => {
      tr.style.display = !q || (tr.dataset.busca || '').includes(q) ? '' : 'none'
    })
  })

  const btn = document.getElementById('nm-guardar')
  if (btn) {
    document.querySelectorAll('.nm-rubro').forEach((sel) => sel.addEventListener('change', () => {
      const cambiado = sel.value !== sel.dataset.original
      sel.style.outline = cambiado ? '2px solid var(--accent)' : ''
      const hay = [...document.querySelectorAll('.nm-rubro')].some((s) => s.value !== s.dataset.original)
      btn.disabled = !hay
    }))
    btn.addEventListener('click', async () => {
      const cambios = [...document.querySelectorAll('.nm-rubro')]
        .filter((s) => s.value !== s.dataset.original)
        .map((s) => ({ cuenta_id: Number(s.dataset.id), rubro: s.value || null }))
      if (!cambios.length) return
      try {
        const r = await apiPut(`/api/contable/empresas/${eid}/niif/mapeo`, { mapeos: cambios })
        showToast(`Mapeo guardado: ${r.cambios} cuenta(s)`, 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  }
}
