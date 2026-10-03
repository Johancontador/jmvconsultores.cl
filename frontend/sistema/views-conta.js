/**
 * VISTAS CONTABLES — Contabilidad (asientos/diario/mayor/plan), Propuestas y
 * Conciliación, Reportes y Cierre, Administración (empresas/períodos/usuarios/auditoría).
 */

/* ============================ CONTABILIDAD ============================ */

VIEWS.asientos = {
  titulo: 'Contabilidad',
  async render(cont) {
    const tab = window._ctaTab || 'diario'
    cont.innerHTML = `
     <div class="tabs">
       <button data-t="diario" class="${tab === 'diario' ? 'active' : ''}">Libro Diario</button>
        ${tiene('asientos:crear') ? `<button data-t="nuevo" class="${tab === 'nuevo' ? 'active' : ''}">Nuevo asiento</button>` : ''}
       <button data-t="mayor" class="${tab === 'mayor' ? 'active' : ''}">Mayor</button>
       <button data-t="plan" class="${tab === 'plan' ? 'active' : ''}">Plan de cuentas</button>
     </div>
     <div id="cta-body"></div>`
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      const t = e.target.dataset.t
      if (t) { window._ctaTab = t; renderRoute() }
    })
    const body = document.getElementById('cta-body')
    if (tab === 'nuevo') return vistaAsientoNuevo(body)
    if (tab === 'mayor') return vistaMayor(body)
    if (tab === 'plan') return vistaPlan(body)
    return vistaDiario(body)
  },
}

async function vistaDiario(body) {
  const periodo = window._ctaPeriodo || periodoActual()
  const eid = S.empresa.id
  const r = await apiGet(`/api/contable/empresas/${eid}/asientos?periodo=${periodo}&limit=200`)
  body.innerHTML = `
   <div class="frm-row mb">
     <div><span class="frm-label">Período</span>${inputPeriodoHTML('cta-periodo', periodo)}</div>
     <span class="sub">${r.total} asiento(s)</span>
   </div>
    ${(r.asientos || []).map((a) => `
     <div class="card mb" style="padding:var(--space-4)">
       <div class="flex" style="justify-content:space-between">
         <div><b class="mono">#${a.folio}</b> · <span class="sub">${esc(a.fecha)}</span> · <span class="chip ${a.tipo === 'cierre' ? 'propuesto' : 'neutral'}">${esc(a.tipo)}</span></div>
         <div class="num" style="font-family:var(--font-mono)">${fmtM(a.lineas.reduce((s, l) => s + l.debe, 0))}</div>
       </div>
       <div class="mt" style="font-size:var(--fs-sm)">${esc(a.glosa)}</div>
       <div class="tbl-wrap mt" style="border-radius:var(--radius-md)">
         <table class="tbl">
           <thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th><th>Glosa</th></tr></thead>
           <tbody>${a.lineas.map((l) => `<tr>
             <td class="mono sub">${esc(l.cuenta_codigo)} ${esc(l.cuenta_nombre || '')}</td>
             <td class="num">${l.debe ? fmtM(l.debe) : '—'}</td>
             <td class="num">${l.haber ? fmtM(l.haber) : '—'}</td>
             <td class="sub">${esc(l.glosa || '')}</td>
           </tr>`).join('')}</tbody>
         </table>
       </div>
     </div>`).join('') || '<div class="empty">Sin asientos en este período.</div>'}`

  document.getElementById('cta-periodo').addEventListener('change', (e) => {
    window._ctaPeriodo = leerPeriodo('cta-periodo') || periodo
    renderRoute()
  })
}

async function vistaAsientoNuevo(body) {
  const imputables = await getCuentasImputables()
  if (!window._ctaLineas || !window._ctaLineas.length) {
    window._ctaLineas = [
      { cuenta_id: '', debe: '', haber: '' },
      { cuenta_id: '', debe: '', haber: '' },
    ]
  }
  const pintar = () => {
    const lineas = window._ctaLineas
    const totalD = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0)
    const totalH = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0)
    const cuadra = totalD === totalH && totalD > 0
    body.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Fecha</span><input type="date" id="na-fecha" class="form-input" value="${new Date().toISOString().slice(0, 10)}"></div>
       <div style="flex:1;min-width:240px"><span class="frm-label">Glosa</span><input id="na-glosa" class="form-input" placeholder="Descripción del movimiento"></div>
       <span class="chip ${cuadra ? 'contabilizado' : 'pendiente'}" id="na-chip">${cuadra ? 'Cuadrado' : `Dif. ${fmtM(totalD - totalH)}`}</span>
     </div>
     <div class="tbl-wrap">
       <table class="tbl">
         <thead><tr><th style="width:45%">Cuenta</th><th class="num">Debe</th><th class="num">Haber</th><th></th></tr></thead>
         <tbody>${lineas.map((l, i) => `<tr>
           <td><select class="form-input na-cuenta" data-i="${i}" style="width:100%">
             <option value="">— selecciona cuenta —</option>
              ${selectOptions(imputables, 'id', (c) => `${c.codigo} — ${c.nombre}`, l.cuenta_id)}
           </select></td>
           <td><input type="number" class="form-input na-debe" data-i="${i}" value="${l.debe}" min="0" style="width:130px;text-align:right"></td>
           <td><input type="number" class="form-input na-haber" data-i="${i}" value="${l.haber}" min="0" style="width:130px;text-align:right"></td>
           <td>${lineas.length > 2 ? `<button class="btn btn-secondary btn-sm" data-del="${i}">Quitar</button>` : ''}</td>
         </tr>`).join('')}</tbody>
         <tfoot><tr><td>Totales</td><td class="num">${fmtM(totalD)}</td><td class="num">${fmtM(totalH)}</td><td></td></tr></tfoot>
       </table>
     </div>
     <div class="flex mt">
       <button class="btn btn-secondary btn-sm" id="na-add">+ Agregar línea</button>
       <span class="spacer" style="flex:1"></span>
       <button class="btn btn-primary" id="na-save" ${cuadra ? '' : 'disabled'}>Registrar asiento</button>
     </div>`

    // Sincroniza el estado global desde el DOM SIN re-render: los inputs
    // conservan foco y selección, y el chip de cuadre se actualiza en vivo.
    const sincronizar = () => {
      window._ctaLineas = window._ctaLineas.map((_, i) => ({
        cuenta_id: body.querySelector(`.na-cuenta[data-i="${i}"]`)?.value || '',
        debe: body.querySelector(`.na-debe[data-i="${i}"]`)?.value || '',
        haber: body.querySelector(`.na-haber[data-i="${i}"]`)?.value || '',
      }))
      const lineas = window._ctaLineas
      const totalD = lineas.reduce((s, l) => s + (Number(l.debe) || 0), 0)
      const totalH = lineas.reduce((s, l) => s + (Number(l.haber) || 0), 0)
      const cuadra = totalD === totalH && totalD > 0
      const chip = body.querySelector('#na-chip')
      if (chip) {
        chip.className = `chip ${cuadra ? 'contabilizado' : 'pendiente'}`
        chip.textContent = cuadra ? 'Cuadrado' : `Dif. ${fmtM(totalD - totalH)}`
      }
      const btnSave = document.getElementById('na-save')
      if (btnSave) btnSave.disabled = !cuadra
    }
    body.addEventListener('input', sincronizar)
    body.addEventListener('change', sincronizar)

    document.getElementById('na-add').addEventListener('click', () => {
      window._ctaLineas.push({ cuenta_id: '', debe: '', haber: '' })
      pintar()
    })
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      window._ctaLineas.splice(Number(b.dataset.del), 1)
      pintar()
    }))
    document.getElementById('na-save').addEventListener('click', async () => {
      const lineasOk = window._ctaLineas
        .map((l) => ({ cuenta_id: Number(l.cuenta_id), debe: Math.round(Number(l.debe) || 0), haber: Math.round(Number(l.haber) || 0) }))
        .filter((l) => l.cuenta_id && (l.debe || l.haber))
      try {
        await apiPost(`/api/contable/empresas/${S.empresa.id}/asientos`, {
          fecha: document.getElementById('na-fecha').value,
          glosa: document.getElementById('na-glosa').value || 'Asiento manual',
          lineas: lineasOk,
        })
        window._ctaLineas = null
        showToast('Asiento registrado', 'success')
        window._ctaTab = 'diario'
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  }
  pintar()
}

async function vistaMayor(body) {
  const imputables = await getCuentasImputables()
  const cuentaId = window._mayorCuenta || (imputables[0] && imputables[0].id)
  if (!cuentaId) { body.innerHTML = '<div class="empty">Sin cuentas imputables.</div>'; return }
  const qs = new URLSearchParams({ cuenta_id: cuentaId })
  if (window._mayorDesde) qs.set('desde', window._mayorDesde)
  if (window._mayorHasta) qs.set('hasta', window._mayorHasta)
  if (window._mayorRut) qs.set('rut', window._mayorRut)
  const m = await apiGet(`/api/contable/empresas/${S.empresa.id}/mayor?${qs}`)
  body.innerHTML = `
   <div class="frm-row mb">
     <div style="flex:1;min-width:240px"><span class="frm-label">Cuenta</span>
       <select id="may-cuenta" class="form-input" style="width:100%">
          ${selectOptions(imputables, 'id', (c) => `${c.codigo} — ${c.nombre}`, cuentaId)}
       </select></div>
     <div><span class="frm-label">Desde</span><input type="date" id="may-desde" class="form-input" value="${esc(window._mayorDesde || '')}"></div>
     <div><span class="frm-label">Hasta</span><input type="date" id="may-hasta" class="form-input" value="${esc(window._mayorHasta || '')}"></div>
     <div><span class="frm-label">Cliente / Proveedor (RUT)</span><input id="may-rut" class="form-input" placeholder="76.123.456-7" value="${esc(window._mayorRut || '')}" style="width:170px"></div>
     <button class="btn btn-secondary btn-sm" id="may-limpiar">Limpiar filtros</button>
     <div class="kpi" style="min-width:200px"><small>Saldo (${esc(m.cuenta?.naturaleza || '')})</small>
       <strong style="color:var(--accent)">${fmtM(m.saldo)}</strong></div>
   </div>
   <div class="tbl-wrap">
     <table class="tbl">
       <thead><tr><th>Fecha</th><th>Folio</th><th>Glosa</th><th class="num">Debe</th><th class="num">Haber</th><th class="num">Saldo</th></tr></thead>
       <tbody>${(m.movimientos || []).map((mv) => `<tr>
         <td class="sub">${esc(mv.fecha)}</td>
         <td class="mono">#${mv.folio}</td>
         <td>${esc(mv.linea_glosa || mv.asiento_glosa || '')}</td>
         <td class="num">${mv.debe ? fmtM(mv.debe) : '—'}</td>
         <td class="num">${mv.haber ? fmtM(mv.haber) : '—'}</td>
         <td class="num"><b>${fmtM(mv.saldo)}</b></td>
       </tr>`).join('') || '<tr><td colspan="6"><div class="empty">Sin movimientos con esos filtros.</div></td></tr>'}</tbody>
     </table>
   </div>`
  const aplicar = () => {
    window._mayorDesde = document.getElementById('may-desde').value || null
    window._mayorHasta = document.getElementById('may-hasta').value || null
    window._mayorRut = document.getElementById('may-rut').value.trim() || null
    renderRoute()
  }
  document.getElementById('may-cuenta').addEventListener('change', (e) => { window._mayorCuenta = e.target.value; renderRoute() })
  document.getElementById('may-desde').addEventListener('change', aplicar)
  document.getElementById('may-hasta').addEventListener('change', aplicar)
  document.getElementById('may-rut').addEventListener('change', aplicar)
  document.getElementById('may-limpiar').addEventListener('click', () => {
    window._mayorDesde = null; window._mayorHasta = null; window._mayorRut = null
    renderRoute()
  })
}

async function vistaPlan(body) {
  const cuentas = await getCuentas()
  body.innerHTML = `
   <div class="tbl-wrap">
     <table class="tbl">
       <thead><tr><th>Código</th><th>Cuenta</th><th>Naturaleza</th><th>Tipo</th><th>Alias de control</th></tr></thead>
       <tbody>${cuentas.map((c) => `<tr>
         <td class="mono">${esc(c.codigo)}</td>
         <td>${esc(c.nombre)}</td>
         <td class="sub">${esc(c.naturaleza)}</td>
         <td>${c.es_resumen ? '<span class="chip neutral">resumen</span>' : '<span class="chip clasificado">imputable</span>'}</td>
         <td class="sub mono">${esc(c.alias || '—')}</td>
       </tr>`).join('')}</tbody>
     </table>
   </div>`
}

/* ====================== PROPUESTAS Y CONCILIACIÓN ====================== */

VIEWS.propuestas = {
  titulo: 'Propuestas',
  async render(cont) {
    const tab = window._propTab || 'pendientes'
    const periodo = window._propPeriodo || periodoActual()
    cont.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Período</span>${inputPeriodoHTML('prop-periodo', periodo)}</div>
        ${tiene('propuestas:generar') ? `<button class="btn btn-primary btn-sm" id="prop-gen">Generar propuestas</button>` : ''}
        ${tiene('propuestas:confirmar') ? `<button class="btn btn-primary btn-sm" id="prop-lote">Confirmar lote del período</button>` : ''}
     </div>
     <div class="tabs">
       <button data-t="pendientes" class="${tab === 'pendientes' ? 'active' : ''}">Pendientes</button>
       <button data-t="historial" class="${tab === 'historial' ? 'active' : ''}">Historial</button>
       <button data-t="conciliacion" class="${tab === 'conciliacion' ? 'active' : ''}">Conciliación</button>
     </div>
     <div id="prop-body"></div>`

    document.getElementById('prop-periodo').addEventListener('change', () => {
      window._propPeriodo = leerPeriodo('prop-periodo') || periodo
      renderRoute()
    })
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      if (e.target.dataset.t) { window._propTab = e.target.dataset.t; renderRoute() }
    })
    const gen = document.getElementById('prop-gen')
    if (gen) gen.addEventListener('click', generarPropuestas)
    const lote = document.getElementById('prop-lote')
    if (lote) lote.addEventListener('click', async () => {
      try {
        const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/propuestas/confirmar-lote`, { periodo })
        showToast(`Lote: ${r.aplicadas ?? 0} aplicadas, ${r.fallidas?.length || 0} fallidas`, (r.fallidas?.length || 0) ? 'error' : 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })

    const body = document.getElementById('prop-body')
    if (tab === 'conciliacion') return vistaConciliacion(body, periodo)
    const estadoQ = tab === 'pendientes' ? 'PENDIENTE' : null
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/propuestas?periodo=${periodo}${estadoQ ? `&estado=${estadoQ}` : ''}&limit=200`)
    body.innerHTML = `
     <div class="tbl-wrap">
       <table class="tbl">
         <thead><tr><th>Documento</th><th>Contraparte</th><th class="num">Total</th><th>Cuenta</th><th>Estado</th><th></th></tr></thead>
         <tbody>${(r.propuestas || []).map((p) => `<tr>
           <td class="sub">${esc(p.doc_tipo_flujo === 'compra' ? 'Compra' : 'Venta')} folio ${esc(p.doc_folio ?? '')}</td>
           <td>${esc((p.doc_razon_social || p.doc_rut_contraparte || '—').slice(0, 34))}</td>
           <td class="num"><b>${fmtM(p.doc_monto_total)}</b></td>
           <td class="sub mono">${esc(p.cuenta_codigo || '')}</td>
           <td>${chipEstado(p.estado === 'PENDIENTE' ? 'PROPUESTO' : p.estado)}</td>
           <td class="flex" style="gap:6px">
             <button class="btn btn-secondary btn-sm" data-ver="${p.id}">Ver</button>
              ${p.estado === 'PENDIENTE' && tiene('propuestas:confirmar') ? `<button class="btn btn-primary btn-sm" data-ok="${p.id}">Contabilizar</button>` : ''}
              ${p.estado === 'PENDIENTE' && tiene('propuestas:generar') ? `<button class="btn btn-secondary btn-sm" data-no="${p.id}"></button>` : ''}
           </td>
         </tr>`).join('') || `<tr><td colspan="6"><div class="empty">Sin propuestas ${tab === 'pendientes' ? 'pendientes' : 'en el período'}.</div></td></tr>`}</tbody>
       </table>
     </div>`

    body.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verPropuesta(Number(b.dataset.ver))))
    body.querySelectorAll('[data-ok]').forEach((b) => b.addEventListener('click', () => confirmarPropuesta(Number(b.dataset.ok))))
    body.querySelectorAll('[data-no]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await apiPost(`/api/contable/empresas/${S.empresa.id}/propuestas/${b.dataset.no}/descartar`, {})
        showToast('Propuesta descartada — documento vuelve a clasificado', 'success')
        refrescarPillDocs()
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    }))
  },
}

async function generarPropuestas() {
  const periodo = window._propPeriodo || periodoActual()
  const eid = S.empresa.id
  try {
    const docs = await apiGet(`/api/contable/empresas/${eid}/documentos?periodo=${periodo}&estado=CLASIFICADO&limit=1000`)
    const lista = docs.documentos || []
    if (!lista.length) return showToast('No hay documentos clasificados sin propuesta en el período', 'success')
    let ok = 0, fallo = 0
    for (const d of lista) {
      try {
        await apiPost(`/api/contable/empresas/${eid}/documentos/${d.id}/propuesta`, {})
        ok++
      } catch { fallo++ }
    }
    showToast(`Propuestas generadas: ${ok}${fallo ? ` · ${fallo} con error` : ''}`, fallo ? 'error' : 'success')
    renderRoute()
  } catch (err) { showToast(err.message, 'error') }
}

async function verPropuesta(id) {
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/propuestas/${id}`)
    const p = r.propuesta
    const lineas = r.lineas?.lineas || []
    openModal(`
     <h3>Propuesta #${p.id} — ${esc(p.doc_razon_social || p.doc_rut_contraparte || '')}</h3>
     <p class="sub">Estado ${esc(p.estado)} · total ${fmtM(p.doc_monto_total)}</p>
     <div class="tbl-wrap"><table class="tbl">
       <thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
       <tbody>${lineas.map((l) => `<tr>
         <td class="mono sub">${esc(l.cuenta_codigo || l.cuenta_id)} ${esc(l.cuenta_nombre || '')}</td>
         <td class="num">${l.debe ? fmtM(l.debe) : '—'}</td>
         <td class="num">${l.haber ? fmtM(l.haber) : '—'}</td>
       </tr>`).join('')}</tbody>
     </table></div>
      ${r.lineas?.error ? `<p class="hint" style="color:var(--warning)">${esc(r.lineas.error)}</p>` : ''}`)
  } catch (err) { showToast(err.message, 'error') }
}

async function confirmarPropuesta(id) {
  openModal(`
   <h3>Contabilizar propuesta</h3>
   <p class="sub">Registra el asiento en partida doble y marca el documento como contabilizado. Deja la fecha vacía para usar la fecha del documento (devengo).</p>
   <div class="form-group"><label class="frm-label">Fecha (opcional)</label>
     <input type="date" id="cf-fecha" class="form-input"></div>
   <div class="modal-foot">
     <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
     <button class="btn btn-primary" id="cf-ok">Contabilizar</button>
   </div>`)
  document.getElementById('cf-ok').addEventListener('click', async () => {
    try {
      const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/propuestas/${id}/confirmar`, {
        fecha: document.getElementById('cf-fecha').value || null,
      })
      showToast(`Contabilizado — asiento folio ${r.asiento?.folio ?? ''}`, 'success')
      cerrarModal()
      refrescarPillDocs()
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
}

async function vistaConciliacion(body, periodo) {
  body.innerHTML = `
   <div class="frm-row mb">
     <button class="btn btn-primary btn-sm" id="conc-run" ${tiene('conciliacion:ejecutar') ? '' : 'disabled'}>Ejecutar conciliación ${perDisplay(periodo)}</button>
     <span class="sub">Bandeja vs contabilidad del período</span>
   </div>
   <div id="conc-out"></div>`
  const out = document.getElementById('conc-out')
  try {
    const hist = await apiGet(`/api/contable/empresas/${S.empresa.id}/conciliaciones`)
    const ultima = (hist.conciliaciones || []).find((c) => c.periodo === periodo)
    if (ultima) pintarConciliacion(out, ultima)
    else out.innerHTML = `<div class="empty">Sin conciliación guardada para ${perDisplay(periodo)}.</div>`
  } catch (err) {
    out.innerHTML = `<div class="empty">${esc(err.message)}</div>`
  }
  document.getElementById('conc-run').addEventListener('click', async () => {
    try {
      const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/conciliacion/${periodo}/ejecutar`, {})
      pintarConciliacion(out, r.conciliacion)
      showToast('Conciliación ejecutada', 'success')
    } catch (err) { showToast(err.message, 'error') }
  })
}

function pintarConciliacion(out, c) {
  let res = null
  try { res = typeof c.resultado_json === 'string' ? JSON.parse(c.resultado_json) : c.resultado_json } catch { /* */ }
  const difs = res?.diferencias || []
  const conteo = res?.conteo_diferencias || {}
  // Monto legible por tipo: SOLO_SII trae monto_total del doc; IMPUESTO_DIVERGENTE
  // trae iva_sii vs iva_contable (su diferencia es el impuesto en disputa).
  const monto = (d) => {
    if (d.diferencia != null) return d.diferencia
    if (d.monto_total != null) return d.monto_total
    if (d.iva_sii != null || d.iva_contable != null) return (d.iva_sii || 0) - (d.iva_contable || 0)
    return null
  }
  out.innerHTML = `
   <div class="kpi-grid mb">
     <div class="kpi ${c.diferencias ? 'warn' : 'up'}"><small>Diferencias</small><strong>${c.diferencias}</strong></div>
      ${Object.entries(conteo).map(([k, v]) => `<div class="kpi"><small>${esc(k)}</small><strong>${v}</strong></div>`).join('')}
   </div>
   <div class="tbl-wrap"><table class="tbl">
     <thead><tr><th>Tipo</th><th>Documento</th><th>Detalle</th><th class="num">Monto</th></tr></thead>
     <tbody>${difs.map((d) => `<tr>
       <td><span class="chip ${String(d.tipo).includes('SOLO') ? 'pendiente' : 'revision'}">${esc(d.tipo)}</span></td>
       <td>${d.tipo_flujo ? `<span class="sub">${d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'}</span> ` : ''}<span class="mono">${esc(d.folio || '—')}</span>
          ${d.razon_social ? `<div class="sub" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.razon_social)}</div>` : ''}</td>
       <td class="sub">${esc(d.detalle || (d.estado ? `documento en ${d.estado}` : ''))}</td>
       <td class="num">${monto(d) != null ? fmtM(monto(d)) : '—'}</td>
     </tr>`).join('') || '<tr><td colspan="4"><div class="empty">Sin diferencias — cuadra perfecto</div></td></tr>'}</tbody>
   </table></div>`
}

/* ========================= REPORTES Y CIERRE ========================= */

VIEWS.reportes = {
  titulo: 'Reportes y Cierre',
  async render(cont) {
    const tab = window._repTab || 'balance'
    const periodo = window._repPeriodo || periodoActual()
    cont.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Período</span>${inputPeriodoHTML('rep-periodo', periodo)}</div>
     </div>
     <div class="tabs">
       <button data-t="balance" class="${tab === 'balance' ? 'active' : ''}">Balance de comprobación</button>
       <button data-t="situacion" class="${tab === 'situacion' ? 'active' : ''}">Situación financiera</button>
       <button data-t="resultados" class="${tab === 'resultados' ? 'active' : ''}">Resultados</button>
       <button data-t="cierre" class="${tab === 'cierre' ? 'active' : ''}">Cierre de período</button>
     </div>
     <div id="rep-body"></div>`

    document.getElementById('rep-periodo').addEventListener('change', () => {
      window._repPeriodo = leerPeriodo('rep-periodo') || periodo
      renderRoute()
    })
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      if (e.target.dataset.t) { window._repTab = e.target.dataset.t; renderRoute() }
    })
    const body = document.getElementById('rep-body')
    const eid = S.empresa.id
    if (tab === 'balance') {
      const { balance: r } = await apiGet(`/api/contable/empresas/${eid}/reportes/balance/${periodo}`)
      const tabla = (b, titulo) => `
       <h3 class="section-title">${titulo} <span class="chip ${b.cuadra ? 'contabilizado' : 'error'}">${b.cuadra ? 'Cuadra ΣD = ΣH' : 'DESCUADRE'}</span></h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Código</th><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
         <tbody>${b.filas.map((f) => `<tr>
           <td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td>
           <td class="num">${f.debe ? fmtM(f.debe) : '—'}</td><td class="num">${f.haber ? fmtM(f.haber) : '—'}</td>
         </tr>`).join('')}</tbody>
         <tfoot><tr><td colspan="2">Sumas iguales</td>
           <td class="num">${fmtM(b.debe)}</td><td class="num">${fmtM(b.haber)}</td></tr></tfoot>
       </table></div>`
      body.innerHTML = tabla(r.acumulado, `Acumulado al ${perDisplay(periodo)}`) + tabla(r.periodo_mes, 'Movimientos del mes')
    } else if (tab === 'situacion') {
      const { situacion: r } = await apiGet(`/api/contable/empresas/${eid}/reportes/situacion/${periodo}`)
      body.innerHTML = `
       <div class="kpi-grid mb">
         <div class="kpi up"><small>Activos</small><strong>${fmtCorto(r.totales.activos)}</strong></div>
         <div class="kpi bad"><small>Pasivos</small><strong>${fmtCorto(r.totales.pasivos)}</strong></div>
         <div class="kpi acc"><small>Patrimonio</small><strong>${fmtCorto(r.totales.patrimonio)}</strong></div>
         <div class="kpi ${r.ecuacion.cuadra ? 'up' : 'bad'}"><small>Ecuación A = P + Pat.</small><strong>${r.ecuacion.cuadra ? '' : fmtM(r.ecuacion.diferencia)}</strong></div>
       </div>
        ${[['Activos', r.activos], ['Pasivos', r.pasivos], ['Patrimonio', r.patrimonio]].map(([t, lista]) => `
         <h3 class="section-title">${t}</h3>
         <div class="tbl-wrap"><table class="tbl">
           <tbody>${(lista || []).map((x) => `<tr>
             <td class="mono sub">${esc(x.cuenta?.codigo || x.codigo || '')}</td>
             <td>${esc(x.cuenta?.nombre || x.nombre || '')}</td>
             <td class="num"><b>${fmtM(x.saldo)}</b></td>
           </tr>`).join('') || '<tr><td><div class="empty">Sin saldos.</div></td></tr>'}</tbody>
         </table></div>`).join('')}`
    } else if (tab === 'resultados') {
      const { resultados: r } = await apiGet(`/api/contable/empresas/${eid}/reportes/resultados/${periodo}`)
      const cards = (d, t) => `
       <div class="kpi-grid mb">
         <div class="kpi up"><small>${t} · Ingresos</small><strong>${fmtCorto(d.ingresos)}</strong></div>
         <div class="kpi"><small>${t} · Costos</small><strong>${fmtCorto(d.costos)}</strong></div>
         <div class="kpi"><small>${t} · Gastos</small><strong>${fmtCorto(d.gastos)}</strong></div>
         <div class="kpi ${d.resultado >= 0 ? 'up' : 'bad'}"><small>${t} · Resultado</small><strong>${fmtM(d.resultado)}</strong></div>
       </div>`
      body.innerHTML = cards(r.periodo_mes, 'Mes') + cards(r.acumulado, `Acumulado ${r.anio}`)
    } else {
      await vistaCierre(body, periodo)
    }
  },
}

async function vistaCierre(body, periodo) {
  const eid = S.empresa.id
  let cierre = null
  try {
    cierre = (await apiGet(`/api/contable/empresas/${eid}/cierre/${periodo}/preparar`)).cierre
  } catch (err) {
    body.innerHTML = `<div class="empty">${esc(err.message)}</div>`
    return
  }
  const ch = cierre.checklist || {}
  body.innerHTML = `
   <div class="card mb">
     <h3>Checklist de cierre — ${perDisplay(periodo)}</h3>
     <div class="checkline ${ch.periodo_abierto ? 'ok' : 'bad'}">Período abierto</div>
     <div class="checkline ${ch.documentos_pendientes === 0 ? 'ok' : 'bad'}">Documentos sin contabilizar: <b class="mono">${ch.documentos_pendientes ?? 0}</b>${ch.documentos_pendientes ? ' (bloquea — usa forzar solo si es decisión explícita)' : ''}</div>
     <div class="checkline ${ch.conciliacion_ejecutada ? 'ok' : 'warn'}">Conciliación ejecutada: ${ch.conciliacion_ejecutada ? `sí — ${ch.conciliacion_diferencias} diferencia(s) (no bloquea, §7.2)` : 'no ejecutada'}</div>
   </div>
    ${(cierre.cierres_propuestos || []).length ? `
     <div class="card mb">
       <h3>Asientos de cierre propuestos</h3>
        ${(cierre.cierres_propuestos || []).map((c) => `
         <label class="flex" style="padding:var(--space-2) 0">
           <input type="checkbox" class="ci-clave" value="${esc(c.clave)}" checked>
           <span><b>${esc(c.clave)}</b> — ${esc(c.glosa)} <span class="sub">(${fmtM(c.lineas.reduce((s, l) => s + (l.debe || 0), 0))})</span></span>
         </label>`).join('')}
     </div>
     <div class="flex">
        ${tiene('periodos:cerrar') ? `
         <button class="btn btn-primary" id="ci-ejec">Cerrar ${perDisplay(periodo)}</button>
          ${cierre.puede_cerrar ? '' : `<button class="btn btn-secondary" id="ci-forzar">Forzar con pendientes</button>`}` : '<span class="muted">Tu rol no puede cerrar períodos.</span>'}
     </div>` : '<div class="empty">No hay asientos de cierre propuestos para este período.</div>'}
   <div id="ci-out"></div>`

  const ejecutar = async (forzar) => {
    const claves = [...body.querySelectorAll('.ci-clave:checked')].map((c) => c.value)
    try {
      const r = await apiPost(`/api/contable/empresas/${eid}/cierre/${periodo}/ejecutar`, { claves, forzar })
      document.getElementById('ci-out').innerHTML = `
       <div class="card" style="border-color:var(--success)">
         <h3>Período cerrado</h3>
         <p class="sub">Asientos de cierre: ${(r.cierre?.asientos || r.cierre?.cierres || []).length} · snapshot persistido y auditado.</p>
       </div>`
      showToast('Cierre ejecutado y auditado', 'success')
    } catch (err) { showToast(err.message, 'error') }
  }
  const btnE = document.getElementById('ci-ejec')
  if (btnE) btnE.addEventListener('click', () => ejecutar(false))
  const btnF = document.getElementById('ci-forzar')
  if (btnF) btnF.addEventListener('click', () => {
    if (confirm('¿Cerrar con documentos pendientes? Quedará auditado como decisión explícita.')) ejecutar(true)
  })
}

/* ============================ ADMINISTRACIÓN ============================ */

VIEWS.admin = {
  titulo: 'Administración',
  async render(cont) {
    const tab = window._admTab || 'empresas'
    cont.innerHTML = `
     <div class="tabs">
       <button data-t="empresas" class="${tab === 'empresas' ? 'active' : ''}">Empresas</button>
       <button data-t="periodos" class="${tab === 'periodos' ? 'active' : ''}">Períodos</button>
        ${S.user.is_admin ? `<button data-t="usuarios" class="${tab === 'usuarios' ? 'active' : ''}">Usuarios y roles</button>` : ''}
        ${tiene('auditoria:ver') ? `<button data-t="auditoria" class="${tab === 'auditoria' ? 'active' : ''}">Auditoría</button>` : ''}
     </div>
     <div id="adm-body"></div>`
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      if (e.target.dataset.t) { window._admTab = e.target.dataset.t; renderRoute() }
    })
    const body = document.getElementById('adm-body')
    if (tab === 'periodos') return admPeriodos(body)
    if (tab === 'usuarios' && S.user.is_admin) return admUsuarios(body)
    if (tab === 'auditoria') return admAuditoria(body)
    return admEmpresas(body)
  },
}

async function admEmpresas(body) {
  const puedeCrear = tiene('empresas:crear')
  body.innerHTML = `
    ${puedeCrear ? `<div class="frm-row mb"><button class="btn btn-primary btn-sm" id="emp-new">+ Nueva empresa</button></div>` : ''}
   <div class="tbl-wrap"><table class="tbl">
     <thead><tr><th>Empresa</th><th>RUT</th><th>PPM</th><th>Regimen</th><th>Licencia</th></tr></thead>
     <tbody>${S.empresas.map((e) => `<tr>
       <td><b>${esc(e.nombre)}</b></td>
       <td class="mono sub">${esc(formatRut(e.rut))}</td>
       <td class="num">${(e.tasa_ppm * 100).toFixed(1)}%</td>
       <td class="sub">${e.exento ? 'Exenta' : 'Afecta'}</td>
       <td><span class="chip ${e.licencia?.estado === 'ACTIVA' ? 'contabilizado' : e.licencia?.estado === 'PRUEBA' ? 'pendiente' : 'neutral'}">${esc(e.licencia?.estado || '—')}</span></td>
     </tr>`).join('')}</tbody>
   </table></div>`
  const btn = document.getElementById('emp-new')
  if (btn) btn.addEventListener('click', () => {
    openModal(`
     <h3>Nueva empresa</h3>
     <p class="sub">La clave SII se guarda cifrada (bóveda AES-256-GCM) y el plan de cuentas se precarga.</p>
     <div class="form-group"><label class="frm-label">RUT</label><input id="ne-rut" class="form-input" placeholder="76.123.456-7"></div>
     <div class="form-group"><label class="frm-label">Razón social</label><input id="ne-nombre" class="form-input"></div>
     <div class="form-group"><label class="frm-label">Clave SII</label><input id="ne-clave" type="password" class="form-input"></div>
     <div class="form-group"><label class="frm-label">Tasa PPM (ej. 0.015)</label><input id="ne-ppm" class="form-input" value="0.015"></div>
     <div class="form-group"><label class="frm-label">Teléfono</label><input id="ne-tel" class="form-input"></div>
     <label class="flex" style="font-size:var(--fs-sm)"><input type="checkbox" id="ne-exento"> Empresa exenta de IVA</label>
     <div class="modal-foot">
       <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
       <button class="btn btn-primary" id="ne-ok">Crear</button>
     </div>`)
    document.getElementById('ne-ok').addEventListener('click', async () => {
      try {
        await apiPost('/api/contable/empresas', {
          rut: document.getElementById('ne-rut').value,
          nombre: document.getElementById('ne-nombre').value,
          clave_sii: document.getElementById('ne-clave').value,
          tasa_ppm: Number(document.getElementById('ne-ppm').value) || 0,
          telefono: document.getElementById('ne-tel').value,
          exento: document.getElementById('ne-exento').checked,
        })
        showToast('Empresa creada', 'success')
        cerrarModal()
        boot()
      } catch (err) { showToast(err.message, 'error') }
    })
  })
}

async function admPeriodos(body) {
  const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/periodos`)
  body.innerHTML = `
   <div class="frm-row mb">
      ${inputPeriodoHTML('per-new', periodoActual())}
     <button class="btn btn-primary btn-sm" id="per-add">Crear / abrir período</button>
   </div>
   <div class="tbl-wrap"><table class="tbl">
     <thead><tr><th>Período</th><th>Estado</th><th>Cerrado por</th><th></th></tr></thead>
     <tbody>${(r.periodos || []).map((p) => `<tr>
       <td><b>${perDisplay(p.periodo)}</b></td>
       <td><span class="chip ${p.estado === 'ABIERTO' ? 'contabilizado' : 'anulado'}">${esc(p.estado)}</span></td>
       <td class="sub">${esc(p.cerrado_por || '—')}</td>
       <td class="flex" style="gap:6px">
          ${p.estado === 'ABIERTO' && tiene('periodos:cerrar') ? `<button class="btn btn-secondary btn-sm" data-close="${p.periodo}">Cerrar</button>` : ''}
          ${p.estado === 'CERRADO' && tiene('periodos:reabrir') ? `<button class="btn btn-secondary btn-sm" data-open="${p.periodo}">Reabrir</button>` : ''}
       </td>
     </tr>`).join('') || '<tr><td colspan="4"><div class="empty">Sin períodos.</div></td></tr>'}</tbody>
   </table></div>`

  document.getElementById('per-add').addEventListener('click', async () => {
    try {
      await apiPost(`/api/contable/empresas/${S.empresa.id}/periodos`, { periodo: leerPeriodo('per-new') })
      showToast('Período listo', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
  body.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await apiPost(`/api/contable/empresas/${S.empresa.id}/periodos/${b.dataset.close}/cerrar`, {})
      showToast('Período cerrado', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  }))
  body.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    const motivo = prompt('Motivo de la reapertura (queda auditado):')
    if (!motivo) return
    try {
      await apiPost(`/api/contable/empresas/${S.empresa.id}/periodos/${b.dataset.open}/reabrir`, { motivo })
      showToast('Período reabierto (auditado)', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  }))
}

async function admUsuarios(body) {
  const [us, asig] = await Promise.all([
    apiGet('/api/auth/usuarios'),
    apiGet(`/api/contable/empresas/${S.empresa.id}/usuarios`),
  ])
  const roles = ['super_admin', 'contador', 'admin_empresa', 'auditor', 'tesoreria']
  body.innerHTML = `
   <div class="grid-2">
     <div class="card">
       <h3>Usuarios del sistema</h3>
       <div class="tbl-wrap" style="border:none"><table class="tbl">
         <tbody>${(us.usuarios || []).map((u) => `<tr>
           <td><b>${esc(u.username)}</b>${u.is_admin ? ' <span class="chip clasificado">admin</span>' : ''}</td>
           <td><span class="chip ${u.activo ? 'contabilizado' : 'anulado'}">${u.activo ? 'activo' : 'inactivo'}</span></td>
           <td class="sub mono">${esc((u.creado_en || '').slice(0, 10))}</td>
         </tr>`).join('')}</tbody>
       </table></div>
       <div class="frm-row mt">
         <input id="us-new" class="form-input" placeholder="usuario nuevo" style="width:150px">
         <input id="us-pass" class="form-input" type="password" placeholder="contraseña (8+)" style="width:170px">
         <button class="btn btn-primary btn-sm" id="us-add">Crear usuario</button>
       </div>
     </div>
     <div class="card">
       <h3>Roles en ${esc(S.empresa.nombre)}</h3>
       <div class="tbl-wrap" style="border:none"><table class="tbl">
         <tbody>${(asig.usuarios || []).map((a) => `<tr>
           <td><b>${esc(a.username)}</b></td>
           <td><span class="chip neutral">${esc(a.rol)}</span></td>
           <td>${a.activo ? '' : '<span class="chip anulado">inactivo</span>'}</td>
         </tr>`).join('') || '<tr><td class="muted">Sin asignaciones.</td></tr>'}</tbody>
       </table></div>
       <div class="frm-row mt">
         <input id="as-user" class="form-input" placeholder="id usuario" style="width:110px">
         <select id="as-rol" class="form-input" style="width:auto">
            ${roles.map((r) => `<option>${r}</option>`).join('')}
         </select>
         <button class="btn btn-primary btn-sm" id="as-add">Asignar rol</button>
       </div>
     </div>
   </div>`

  document.getElementById('us-add').addEventListener('click', async () => {
    try {
      await apiPost('/api/auth/usuarios', {
        username: document.getElementById('us-new').value.trim(),
        password: document.getElementById('us-pass').value,
      })
      showToast('Usuario creado', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
  document.getElementById('as-add').addEventListener('click', async () => {
    try {
      await apiPost(`/api/contable/empresas/${S.empresa.id}/usuarios`, {
        usuario_id: Number(document.getElementById('as-user').value),
        rol: document.getElementById('as-rol').value,
      })
      showToast('Rol asignado', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
}

async function admAuditoria(body) {
  const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/auditoria?limit=100`)
  body.innerHTML = `
   <div class="tbl-wrap"><table class="tbl">
     <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
     <tbody>${(r.registros || []).map((a) => `<tr>
       <td class="sub mono">${esc((a.creado_en || '').replace('T', ' ').slice(0, 16))}</td>
       <td>${esc(a.username || a.usuario_id || '')}</td>
       <td><span class="chip neutral">${esc(a.accion)}</span></td>
       <td class="sub">${esc(a.entidad)} ${esc(a.entidad_id || '')}</td>
       <td class="sub" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.despues_json || a.antes_json || '')}</td>
     </tr>`).join('')}</tbody>
   </table></div>`
}

/* ==================== MEMORIA DE CONTABILIZACIÓN ====================
 * La cuenta regular por empresa (gastos/ingresos) + la memoria RUT → cuenta:
 * el auxiliar/proveedor/cliente se vincula solo el mes siguiente; si aparece
 * uno nuevo, aquí se elige a dónde contabilizar y se recuerda.
 */

VIEWS.memoria = {
  titulo: 'Memoria de Contabilización',
  async render(cont) {
    const eid = S.empresa.id
    let config = null, mem = null
    try {
      config = (await apiGet(`/api/contable/empresas/${eid}/config`)).config
      mem = await apiGet(`/api/contable/empresas/${eid}/memoria`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }
    const puedeConfig = tiene('config:editar')
    const puedeClasificar = tiene('documentos:clasificar')
    const imputables = await getCuentasImputables()
    const selCuentas = (id) => `<option value="">— sin cuenta regular —</option>${selectOptions(imputables, 'id', (c) => `${c.codigo} — ${c.nombre}`, id)}`

    cont.innerHTML = `
     <p class="hint mb" style="max-width:760px">El sistema recuerda dónde se contabilizó cada proveedor y cliente: el próximo mes ese auxiliar se vincula automáticamente. Si aparece una contraparte nueva, se te ofrece elegir a dónde enviarla — y queda memorizada.</p>

     <div class="card">
       <h3>Cuenta regular de la empresa</h3>
       <p class="hint" style="margin-top:-6px">La mayoría de las empresas pequeñas no concilia banco: en modo simple las compras y ventas se netean directamente contra estas cuentas (típicamente la cuenta del banco).</p>
       <div class="frm-row mt">
         <div><span class="frm-label">Modo</span>
           <select id="cfg-modo" class="form-input" ${puedeConfig ? '' : 'disabled'}>
             <option value="simple" ${config.modo_conciliacion === 'simple' ? 'selected' : ''}>Simple — neteo contra cuenta regular (sin conciliación)</option>
             <option value="completa" ${config.modo_conciliacion === 'completa' ? 'selected' : ''}>Completa — CxC/CxP por contraparte + conciliación</option>
           </select>
         </div>
         <div><span class="frm-label">Cuenta regular de GASTOS (compras)</span>
           <select id="cfg-gastos" class="form-input" ${puedeConfig ? '' : 'disabled'}>${selCuentas(config.cuenta_regular_gastos_id)}</select>
         </div>
         <div><span class="frm-label">Cuenta regular de INGRESOS (ventas)</span>
           <select id="cfg-ingresos" class="form-input" ${puedeConfig ? '' : 'disabled'}>${selCuentas(config.cuenta_regular_ingresos_id)}</select>
         </div>
          ${puedeConfig ? '<button class="btn btn-primary" id="cfg-guardar">Guardar</button>' : ''}
       </div>
     </div>

      ${mem.nuevos.length ? `
     <div class="card mt">
       <h3>Contrapartes nuevas por ubicar (${mem.nuevos.length})</h3>
       <p class="hint" style="margin-top:-6px">Documentos de clientes/proveedores sin memoria: elige la cuenta y el sistema la recuerda para siempre.</p>
       <div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>RUT</th><th>Razón social</th><th>Flujo</th><th class="num">Total</th><th>Cuenta destino</th><th></th></tr></thead>
         <tbody>${mem.nuevos.map((d) => `
           <tr>
             <td class="mono">${esc(d.rut_contraparte)}</td>
             <td>${esc(d.razon_social || '—')}</td>
             <td><span class="chip ${d.tipo_flujo === 'venta' ? 'contabilizado' : 'clasificado'}">${esc(d.tipo_flujo)}</span></td>
             <td class="num">${fmtM(d.monto_total)}</td>
             <td><select class="form-input mem-cuenta" data-rut="${esc(d.rut_contraparte)}" style="min-width:240px">
               <option value="">— elegir cuenta —</option>${selectOptions(imputables, 'id', (c) => `${c.codigo} — ${c.nombre}`)}
             </select></td>
             <td>${puedeClasificar ? `<button class="btn btn-primary btn-sm mem-recordar" data-rut="${esc(d.rut_contraparte)}">Recordar</button>` : ''}</td>
           </tr>`).join('')}</tbody>
       </table></div>
     </div>` : ''}

     <div class="card mt">
       <h3>Memoria por contraparte (${mem.memoria.length})</h3>
       <div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>RUT</th><th>Razón social</th><th>Tipo</th><th>Cuenta memorizada</th><th class="num">Documentos</th></tr></thead>
         <tbody>${mem.memoria.map((m) => `
           <tr>
             <td class="mono">${esc(m.rut)}</td>
             <td>${esc(m.razon_social || '—')}</td>
             <td class="sub">${esc(m.clasificacion || '—')}</td>
             <td>${m.cuenta_id ? `<span class="mono">${esc(m.cuenta_codigo || '')}</span> ${esc(m.cuenta_nombre || '')}` : '<span class="chip pendiente">sin memoria</span>'}</td>
             <td class="num">${m.documentos}</td>
           </tr>`).join('') || '<tr><td colspan="5"><div class="empty">Aún no hay contrapartes. Ingresa documentos del SII primero.</div></td></tr>'}</tbody>
       </table></div>
     </div>`

    const btnCfg = document.getElementById('cfg-guardar')
    if (btnCfg) btnCfg.addEventListener('click', async () => {
      try {
        await apiPut(`/api/contable/empresas/${eid}/config`, {
          modo_conciliacion: document.getElementById('cfg-modo').value,
          cuenta_regular_gastos_id: Number(document.getElementById('cfg-gastos').value) || null,
          cuenta_regular_ingresos_id: Number(document.getElementById('cfg-ingresos').value) || null,
        })
        showToast('Configuración guardada', 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })

    cont.querySelectorAll('.mem-recordar').forEach((btn) => btn.addEventListener('click', async () => {
      const rut = btn.dataset.rut
      const sel = cont.querySelector(`.mem-cuenta[data-rut="${rut}"]`)
      if (!sel || !sel.value) { showToast('Elige primero la cuenta destino', 'error'); return }
      try {
        await apiPost(`/api/contable/empresas/${eid}/memoria`, { rut, cuenta_id: Number(sel.value) })
        showToast(`Memoria guardada para ${rut}`, 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    }))
  },
}

/* ========================= REPORTES NUEVOS ========================= */

function filaCuenta8(f) {
  const num = (v) => (v ? fmtM(v) : '—')
  return `<tr>
   <td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td>
   <td class="num">${num(f.anterior_deudor)}</td><td class="num">${num(f.anterior_acreedor)}</td>
   <td class="num">${num(f.debe)}</td><td class="num">${num(f.haber)}</td>
   <td class="num">${num(f.saldo_deudor)}</td><td class="num">${num(f.saldo_acreedor)}</td>
   <td class="num">${num(f.perdida)}</td><td class="num">${num(f.utilidad)}</td>
 </tr>`
}

function vistaPeriodoPlantilla(body, titulo, vistaKey) {
  const periodo = window[`_${vistaKey}Periodo`] || periodoActual()
  body.innerHTML = `
   <div class="frm-row mb">
     <div><span class="frm-label">Período</span>${inputPeriodoHTML('rep-periodo', periodo)}</div>
     <span class="sub">${esc(titulo)} — acumulado al último día del mes</span>
   </div>
   <div id="rep-body"></div>`
  document.getElementById('rep-periodo').addEventListener('change', (e) => {
    window[`_${vistaKey}Periodo`] = leerPeriodo('rep-periodo') || periodo
    renderRoute()
  })
  return periodo
}

VIEWS.balance8 = {
  titulo: 'Balance de 8 Columnas',
  async render(cont) {
    cont.innerHTML = '<div class="frm-row mb"><div class="tbl-wrap" style="flex:1;padding:var(--space-5)">Cargando…</div></div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(body, 'Balance de 8 columnas', 'balance8')
    let b
    try { b = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/balance8/${periodo}`)).balance8 }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const s = b.sumas
    document.getElementById('rep-body').innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi ${b.cuadres.sumas_debe_haber ? 'up' : 'bad'}"><small>Débitos = Créditos</small><strong>${fmtM(s.debe)}</strong><span class="sub">${b.cuadres.sumas_debe_haber ? 'cuadrado' : 'DESCUADRADO'}</span></div>
       <div class="kpi ${b.cuadres.saldos_cuadran ? 'up' : 'bad'}"><small>Saldos + Resultado</small><strong>${fmtM(s.saldo_deudor + s.perdida)}</strong><span class="sub">${b.cuadres.saldos_cuadran ? 'hoja cuadrada' : 'descuadrada'}</span></div>
       <div class="kpi ${b.cuadres.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado del período</small><strong>${fmtM(b.cuadres.resultado)}</strong><span class="sub">utilidad ${fmtM(s.utilidad)} − pérdida ${fmtM(s.perdida)}</span></div>
     </div>
     <div class="card">
       <h3>Sumas y saldos — ${esc(periodo)}</h3>
       <div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>Código</th><th>Cuenta</th><th class="num">Ant. Deudor</th><th class="num">Ant. Acreedor</th><th class="num">Débitos</th><th class="num">Créditos</th><th class="num">Saldo Deudor</th><th class="num">Saldo Acreedor</th><th class="num">Pérdida</th><th class="num">Utilidad</th></tr></thead>
         <tbody>${b.filas.map(filaCuenta8).join('') || '<tr><td colspan="10"><div class="empty">Sin movimientos en este período.</div></td></tr>'}</tbody>
         <tfoot><tr>
           <td colspan="2">SUMAS IGUALES</td>
           <td class="num">${fmtM(s.anterior_deudor)}</td><td class="num">${fmtM(s.anterior_acreedor)}</td>
           <td class="num">${fmtM(s.debe)}</td><td class="num">${fmtM(s.haber)}</td>
           <td class="num">${fmtM(s.saldo_deudor)}</td><td class="num">${fmtM(s.saldo_acreedor)}</td>
           <td class="num">${fmtM(s.perdida)}</td><td class="num">${fmtM(s.utilidad)}</td>
         </tr></tfoot>
       </table></div>
       <p class="hint mt">El cuadre clásico de la hoja de trabajo: saldos deudores + pérdidas = saldos acreedores + utilidades. Las columnas Pérdida/Utilidad muestran el neto de las cuentas de resultado (ingresos, costos y gastos) pendientes de cierre.</p>
     </div>`
  },
}

VIEWS.clasificado = {
  titulo: 'Balance Clasificado',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(body, 'Balance clasificado', 'clasificado')
    let c
    try { c = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/clasificado/${periodo}`)).clasificado }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const seccion = (titulo, filas, total) => `
     <div class="card mb">
       <h3>${esc(titulo)} <span class="num" style="float:right;font-family:var(--font-mono)">${fmtM(total)}</span></h3>
        ${filas.length ? `<div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>Código</th><th>Cuenta</th><th class="num">Saldo</th></tr></thead>
         <tbody>${filas.map((f) => `<tr><td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td><td class="num">${fmtM(f.saldo)}</td></tr>`).join('')}</tbody>
       </table></div>` : '<p class="hint mt">Sin saldos en esta sección.</p>'}
     </div>`
    document.getElementById('rep-body').innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi"><small>Activo corriente</small><strong>${fmtM(c.activo.corriente.reduce((x, f) => x + f.saldo, 0))}</strong><span class="sub">disponible en el año</span></div>
       <div class="kpi ${c.capital_trabajo >= 0 ? 'up' : 'bad'}"><small>Capital de trabajo</small><strong>${fmtM(c.capital_trabajo)}</strong><span class="sub">activo corriente − pasivo corriente</span></div>
       <div class="kpi ${c.ecuacion.cuadra ? 'up' : 'bad'}"><small>A = P + Patrimonio</small><strong>${c.ecuacion.cuadra ? 'Cuadra' : fmtM(c.ecuacion.diferencia || 0)}</strong><span class="sub">activos ${fmtM(c.ecuacion.activos)}</span></div>
     </div>
      ${seccion('Activo corriente (1.1)', c.activo.corriente, c.activo.corriente.reduce((x, f) => x + f.saldo, 0))}
      ${seccion('Activo no corriente (1.2+)', c.activo.no_corriente, c.activo.no_corriente.reduce((x, f) => x + f.saldo, 0))}
      ${seccion('Pasivo corriente (2.1)', c.pasivo.corriente, c.pasivo.corriente.reduce((x, f) => x + f.saldo, 0))}
      ${seccion('Pasivo no corriente (2.2+)', c.pasivo.no_corriente, c.pasivo.no_corriente.reduce((x, f) => x + f.saldo, 0))}
      ${seccion('Patrimonio (3) + resultado del período', c.patrimonio.cuentas, c.patrimonio.total)}
     <p class="hint">Resultado del período incluido en patrimonio: ${fmtM(c.patrimonio.resultado_periodo)} (sin asiento de cierre: la ecuación cuadra en todo estado).</p>`
  },
}

VIEWS.situacion = {
  titulo: 'Situación Financiera',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(body, 'Estado de situación financiera', 'situacion')
    let s
    try { s = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/situacion/${periodo}`)).situacion }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const tabla = (titulo, filas, total) => `
     <div class="card mb"><h3>${esc(titulo)} <span class="num" style="float:right;font-family:var(--font-mono)">${fmtM(total)}</span></h3>
        ${filas.length ? `<div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Código</th><th>Cuenta</th><th class="num">Saldo</th></tr></thead>
       <tbody>${filas.map((f) => `<tr><td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td><td class="num">${fmtM(f.saldo)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint mt">Sin saldos.</p>'}
     </div>`
    document.getElementById('rep-body').innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi"><small>Activos</small><strong>${fmtM(s.totales.activos)}</strong></div>
       <div class="kpi"><small>Pasivos</small><strong>${fmtM(s.totales.pasivos)}</strong></div>
       <div class="kpi"><small>Patrimonio</small><strong>${fmtM(s.totales.patrimonio)}</strong></div>
       <div class="kpi ${s.ecuacion.cuadra ? 'up' : 'bad'}"><small>Ecuación</small><strong>${s.ecuacion.cuadra ? 'A = P + P' : 'DESCUADRA'}</strong><span class="sub">dif. ${fmtM(s.ecuacion.diferencia)}</span></div>
     </div>
      ${tabla('Activos', s.activos, s.totales.activos)}
      ${tabla('Pasivos', s.pasivos, s.totales.pasivos)}
      ${tabla('Patrimonio', s.patrimonio, s.totales.patrimonio_cuentas)}
     <div class="card"><h3>Resultado del período (clases 4/5/6)</h3>
       <p>Ingresos ${fmtM(s.resultados.ingresos)} − costos ${fmtM(s.resultados.costos)} − gastos ${fmtM(s.resultados.gastos)} = <b class="mono">${fmtM(s.resultados.resultado)}</b></p>
     </div>`
  },
}

VIEWS.resultados = {
  titulo: 'Estado de Resultados',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(body, 'Estado de resultados', 'resultados')
    let r
    try { r = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/resultados/${periodo}`)).resultados }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const bloque = (titulo, d) => `
     <div class="card mb"><h3>${esc(titulo)}</h3>
       <div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>Código</th><th>Cuenta</th><th class="num">Saldo</th></tr></thead>
         <tbody>
            ${d.detalle.ingresos.map((f) => `<tr><td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td><td class="num up">${fmtM(f.saldo)}</td></tr>`).join('')}
            ${d.detalle.costos.map((f) => `<tr><td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td><td class="num">(−) ${fmtM(f.saldo)}</td></tr>`).join('')}
            ${d.detalle.gastos.map((f) => `<tr><td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td><td class="num">(−) ${fmtM(f.saldo)}</td></tr>`).join('')}
           <tr><td colspan="2"><b>Resultado</b></td><td class="num"><b>${fmtM(d.resultado)}</b></td></tr>
         </tbody>
       </table></div>
     </div>`
    document.getElementById('rep-body').innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi up"><small>Ingresos del mes</small><strong>${fmtM(r.periodo_mes.ingresos)}</strong></div>
       <div class="kpi ${r.periodo_mes.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado del mes</small><strong>${fmtM(r.periodo_mes.resultado)}</strong></div>
       <div class="kpi ${r.acumulado.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado acumulado</small><strong>${fmtM(r.acumulado.resultado)}</strong><span class="sub">${esc(r.rango_acumulado.desde)} → ${esc(r.rango_acumulado.hasta)}</span></div>
     </div>
      ${bloque('Del período ' + r.periodo, r.periodo_mes)}
      ${bloque('Acumulado del año ' + r.anio, r.acumulado)}`
  },
}

function vistaCuentaCorriente(rol) {
  return {
    titulo: rol === 'proveedor' ? 'Cuenta Corriente — Proveedores' : 'Cuenta Corriente — Clientes',
    async render(cont) {
      const eid = S.empresa.id
      const f = {
        desde: window._ccDesde || '', hasta: window._ccHasta || '', rut: window._ccRut || '',
      }
      const qs = new URLSearchParams({ rol })
      if (f.desde) qs.set('desde', f.desde)
      if (f.hasta) qs.set('hasta', f.hasta)
      if (f.rut) qs.set('rut', f.rut)
      let cc
      try { cc = (await apiGet(`/api/contable/empresas/${eid}/reportes/cuenta-corriente?${qs}`)).cuenta_corriente }
      catch (err) { cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }

      cont.innerHTML = `
       <div class="frm-row mb">
         <div><span class="frm-label">Desde</span><input type="date" id="cc-desde" class="form-input" value="${esc(f.desde)}"></div>
         <div><span class="frm-label">Hasta</span><input type="date" id="cc-hasta" class="form-input" value="${esc(f.hasta)}"></div>
         <div><span class="frm-label">RUT de ${rol === 'proveedor' ? 'proveedor' : 'cliente'}</span><input id="cc-rut" class="form-input" placeholder="76.123.456-7" value="${esc(f.rut)}" style="width:180px"></div>
         <button class="btn btn-secondary btn-sm" id="cc-aplicar">Aplicar</button>
         <button class="btn btn-secondary btn-sm" id="cc-limpiar">Limpiar</button>
       </div>
       <div class="kpi-grid mb">
         <div class="kpi"><small>Cargos (facturas)</small><strong>${fmtM(cc.total_cargos)}</strong></div>
         <div class="kpi up"><small>Abonos (NC + ${rol === 'proveedor' ? 'pagos' : 'cobros'})</small><strong>${fmtM(cc.total_abonos)}</strong></div>
         <div class="kpi ${cc.total_saldo > 0 ? 'warn' : 'up'}"><small>Saldo ${rol === 'proveedor' ? 'por pagar' : 'por cobrar'}</small><strong>${fmtM(cc.total_saldo)}</strong><span class="sub">${cc.resumen.length} contraparte(s)</span></div>
       </div>
       <div class="card">
         <h3>Resumen por contraparte</h3>
         <div class="tbl-wrap mt"><table class="tbl">
           <thead><tr><th>RUT</th><th>Razón social</th><th class="num">Cargos</th><th class="num">Abonos</th><th class="num">Saldo</th><th></th></tr></thead>
           <tbody>${cc.resumen.map((r) => `<tr>
             <td class="mono">${esc(r.rut)}</td><td>${esc(r.razon_social || '—')}</td>
             <td class="num">${fmtM(r.cargos)}</td><td class="num">${fmtM(r.abonos)}</td>
             <td class="num"><b>${fmtM(r.saldo)}</b></td>
             <td><button class="btn btn-secondary btn-sm cc-detalle" data-rut="${esc(r.rut)}">Ver detalle</button></td>
           </tr>`).join('') || '<tr><td colspan="6"><div class="empty">Sin documentos contabilizados con esos filtros.</div></td></tr>'}</tbody>
         </table></div>
       </div>
        ${cc.detalle ? `
       <div class="card mt">
         <h3>Detalle de ${esc(cc.rut)} — saldo corrido</h3>
         <div class="tbl-wrap mt"><table class="tbl">
           <thead><tr><th>Fecha</th><th>Tipo</th><th>Referencia</th><th class="num">Cargo</th><th class="num">Abono</th><th class="num">Saldo</th></tr></thead>
           <tbody>${cc.detalle.map((d) => `<tr>
             <td class="sub">${esc(d.fecha || '')}</td>
             <td><span class="chip ${d.tipo === 'DOCTO' ? 'clasificado' : d.tipo === 'NC' ? 'propuesto' : 'contabilizado'}">${esc(d.tipo)}</span></td>
             <td class="mono sub">${esc(d.referencia || '')}</td>
             <td class="num">${d.cargo ? fmtM(d.cargo) : '—'}</td>
             <td class="num">${d.abono ? fmtM(d.abono) : '—'}</td>
             <td class="num"><b>${fmtM(d.saldo_despues)}</b></td>
           </tr>`).join('')}</tbody>
         </table></div>
       </div>` : ''}
       <p class="hint mt">Cargos/abonos derivados de la partida doble real: facturas contabilizadas (devengo en fecha_docto) y pagos/cobros de tesorería aplicados al documento.</p>`

      const aplicar = () => {
        window._ccDesde = document.getElementById('cc-desde').value || null
        window._ccHasta = document.getElementById('cc-hasta').value || null
        window._ccRut = document.getElementById('cc-rut').value.trim() || null
        renderRoute()
      }
      document.getElementById('cc-aplicar').addEventListener('click', aplicar)
      document.getElementById('cc-hasta').addEventListener('change', aplicar)
      document.getElementById('cc-desde').addEventListener('change', aplicar)
      document.getElementById('cc-rut').addEventListener('change', aplicar)
      document.getElementById('cc-limpiar').addEventListener('click', () => {
        window._ccDesde = null; window._ccHasta = null; window._ccRut = null; renderRoute()
      })
      cont.querySelectorAll('.cc-detalle').forEach((btn) => btn.addEventListener('click', () => {
        window._ccRut = btn.dataset.rut
        renderRoute()
      }))
    },
  }
}

VIEWS.cclientes = vistaCuentaCorriente('cliente')
VIEWS.cproveedores = vistaCuentaCorriente('proveedor')

/* ==================== RECEPTOR EXTERNO (FASE 9.1) ====================
 * Centralizaciones de asientos recibidas de sistemas externos (Geo Daniela
 * y otros), con el contrato de integración visible para el integrador.
 */

VIEWS.externos = {
  titulo: 'Receptor Externo de Asientos',
  async render(cont) {
    const eid = S.empresa.id
    let recibidos = []
    try {
      const r = await apiGet(`/api/contable/asientos-externos?empresa_rut=${encodeURIComponent(S.empresa.rut || '')}`)
      recibidos = r.recibidos || []
    } catch (err) {
      cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`
      return
    }
    void eid

    cont.innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi"><small>Centralizaciones recibidas</small><strong>${recibidos.length}</strong><span class="sub">de sistemas externos</span></div>
       <div class="kpi"><small>Última recepción</small><strong class="mono" style="font-size:var(--fs-lg)">${recibidos[0] ? esc((recibidos[0].creado_en || '').slice(0, 10)) : '—'}</strong><span class="sub">${recibidos[0] ? esc(recibidos[0].remitente) : ''}</span></div>
     </div>
     <div class="card">
       <h3>Centralizaciones recibidas</h3>
        ${recibidos.length ? `
       <div class="tbl-wrap mt"><table class="tbl">
         <thead><tr><th>Recepción</th><th>Remitente</th><th>Período</th><th>Glosa</th><th>Asiento</th><th>Fecha</th></tr></thead>
         <tbody>${recibidos.map((r) => `
           <tr>
             <td class="sub">${esc((r.creado_en || '').slice(0, 16).replace('T', ' '))}</td>
             <td><span class="chip contabilizado">${esc(r.remitente)}</span></td>
             <td class="mono">${esc(r.periodo)}</td>
             <td>${esc(r.glosa)}</td>
             <td class="mono">F${r.folio}/${r.anio}</td>
             <td class="sub">${esc(r.fecha || '')}</td>
           </tr>`).join('')}</tbody>
       </table></div>` : '<div class="empty">Sin centralizaciones externas todavía. Cuando Geo Daniela (u otro sistema) envíe su asiento cuadrado, aparecerá aquí y en el diario.</div>'}
     </div>
     <div class="card mt">
       <h3>Contrato para el integrador</h3>
       <p class="hint" style="margin-top:-6px">Cualquier sistema externo contabiliza con un POST autenticado (usuario con permiso de asientos): el núcleo valida la partida doble — el rechazo es completo si no cuadra, y el re-envío de la misma centralización no duplica.</p>
       <pre class="mono sub" style="white-space:pre-wrap;font-size:var(--fs-sm)">POST /api/contable/asientos-externos
{ "empresa_rut": "${esc(S.empresa.rut || '76123456-7')}",
  "idempotencia": "centralizacion-202610-v1",   // opcional, recomendada
  "glosa": "Centralización remuneraciones octubre 2026",
  "fecha": "2026-10-31",
  "lineas": [ { "cuenta_codigo": "6.1.1.01", "debe": 5000000, "haber": 0 },
              { "cuenta_codigo": "2.1.3.01", "debe": 0, "haber": 3550000 },
              { "cuenta_codigo": "2.1.3.02", "debe": 0, "haber": 1450000 } ] }</pre>
       <p class="hint">Auxiliar: <span class="mono">GET /api/contable/asientos-externos/validar-codigos?empresa_rut=…&codigos=6.1.1,2.1.4</span> — valida que los códigos existan en el plan SIN crearlos. Detalle completo: docs INTEGRATIONS §4.</p>
     </div>`
  },
}

