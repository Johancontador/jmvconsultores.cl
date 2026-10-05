/**
 * VISTA ANALÍTICA — Dashboard tributario de los libros de compra y venta.
 *
 * Deriva de GET /api/contable/empresas/:id/analitica (core/analitica.js):
 * resumen mensual del año, IVA anual vs año anterior, top 20 clientes y
 * proveedores, y alertas de calidad (facturas duplicadas, RUTs inválidos).
 * Todo calculado por el backend sobre la bandeja: nada digitado aquí.
 */

VIEWS.analitica = {
  titulo: 'Dashboard Tributario',
  async render(cont) {
    const anioSel = window._analiticaAnio || String(new Date().getFullYear())
    let a
    try {
      const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/analitica?periodo=${anioSel}01`)
      a = r.analitica
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const anios = []
    for (let y = Number(a.anio); y >= Number(a.anio) - 4; y--) anios.push(String(y))
    const maxBar = Math.max(1, ...a.meses.map((m) => Math.max(m.ventas, m.compras)))
    const fmtPct = (p) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p}%`)

    const kpiVariacion = (pct) => {
      if (pct === null) return '<span class="sub">sin año anterior</span>'
      const cls = pct >= 0 ? 'up' : 'bad'
      return `<span class="sub fg-${pct >= 0 ? 'success' : 'danger'}">${fmtPct(pct)} vs año anterior</span>`
    }

    cont.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Año tributario</span>
         <select id="an-anio" class="form-input" style="width:auto">
           ${anios.map((y) => `<option value="${y}" ${y === a.anio ? 'selected' : ''}>${y}</option>`).join('')}
         </select>
       </div>
       <span class="chip contabilizado">Año ${a.anio}</span>
       <span class="spacer"></span>
       <span class="muted" style="font-size:var(--fs-sm)"><b>${esc(a.empresa.nombre)}</b> · ${esc(formatRut(a.empresa.rut))}</span>
     </div>

     <div class="kpi-grid">
       <div class="kpi up"><small>Ventas del año</small><strong>${fmtCorto(a.anual.ventas)}</strong>${kpiVariacion(a.anual.variacion_ventas_pct)}</div>
       <div class="kpi"><small>Compras del año</small><strong>${fmtCorto(a.anual.compras)}</strong>${kpiVariacion(a.anual.variacion_compras_pct)}</div>
       <div class="kpi acc"><small>IVA determinado</small><strong>${fmtCorto(a.anual.iva_determinado)}</strong>${kpiVariacion(a.anual.variacion_iva_pct)}</div>
       <div class="kpi ${a.resumen_ejecutivo.resultado_comercial >= 0 ? 'up' : 'bad'}"><small>Resultado comercial</small><strong>${fmtCorto(a.resumen_ejecutivo.resultado_comercial)}</strong><span class="sub">ventas − compras (${a.anual.docs} docs)</span></div>
     </div>

     ${a.calidad.duplicados.length || a.calidad.ruts_invalidos.length ? `
     <div class="card mt" id="an-alertas">
       <h3>Alertas de calidad de datos</h3>
       ${a.calidad.duplicados.length ? `
         <p class="hint">${a.calidad.duplicados.length} folio(s) duplicado(s) — misma contraparte, tipo y folio. Revisa si son errores de carga del SII.</p>
         <div class="tbl-wrap mt">
           <table class="tbl"><thead><tr><th>Tipo</th><th>Folio</th><th>Contraparte</th><th>Razón social</th><th class="num">Repeticiones</th></tr></thead>
           <tbody>${a.calidad.duplicados.map((d) => `
             <tr><td class="sub">${esc(NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc)}</td><td class="mono">${esc(d.folio)}</td>
                 <td class="mono sub">${esc(formatRut(d.rut))}</td><td>${esc(d.razon_social)}</td><td class="num"><b>${d.n}</b></td></tr>`).join('')}</tbody>
           </table></div>` : ''}
       ${a.calidad.ruts_invalidos.length ? `
         <p class="hint mt">${a.calidad.ruts_invalidos.length} RUT(s) con dígito verificador inválido en las contrapartes del RCV:</p>
         <div class="tbl-wrap mt">
           <table class="tbl"><thead><tr><th>RUT</th><th>Razón social</th><th>Motivo</th></tr></thead>
           <tbody>${a.calidad.ruts_invalidos.map((r) => `
             <tr><td class="mono">${esc(r.rut)}</td><td>${esc(r.razon_social || '—')}</td><td class="sub">${esc(r.motivo)}</td></tr>`).join('')}</tbody>
           </table></div>` : ''}
     </div>` : `<div class="card mt"><div class="checkline ok">Calidad de datos: sin duplicados ni RUTs inválidos en ${a.anio}</div></div>`}

     <div class="card mt">
       <div class="flex" style="justify-content:space-between">
         <h3 style="margin:0">Ventas vs compras — ${a.anio}</h3>
         <div class="legend"><span><i style="background:var(--accent)"></i>Ventas</span><span><i style="background:var(--c-slate-500)"></i>Compras</span></div>
       </div>
       <div class="bars mt">
         ${a.meses.map((m) => `
           <div class="b" title="${perDisplay(m.periodo)} — ${fmtM(m.ventas)} vs ${fmtM(m.compras)}">
             <i class="v" style="height:${Math.round((m.ventas / maxBar) * 100)}%"></i>
             <i class="c" style="height:${Math.round((m.compras / maxBar) * 100)}%"></i>
           </div>`).join('')}
       </div>
       <div class="bars-lbl">${a.meses.map((m) => `<span title="${perDisplay(m.periodo)}">${m.mes}</span>`).join('')}</div>
     </div>

     <div class="card mt">
       <h3>Resumen mensual e IVA</h3>
       <div class="tbl-wrap">
         <table class="tbl">
           <thead><tr><th>Mes</th><th class="num">Ventas</th><th class="num">Compras</th><th class="num">IVA débito</th><th class="num">IVA crédito</th><th class="num">IVA determinado</th><th class="num">Docs</th></tr></thead>
           <tbody>
             ${a.meses.filter((m) => m.docs_venta + m.docs_compra > 0).map((m) => `
               <tr><td class="sub">${perDisplay(m.periodo)}</td>
                 <td class="num">${fmtM(m.ventas)}</td><td class="num">${fmtM(m.compras)}</td>
                 <td class="num">${fmtM(m.iva_debito)}</td><td class="num">${fmtM(m.iva_credito)}</td>
                 <td class="num"><b style="color:${m.iva_determinado >= 0 ? 'var(--danger)' : 'var(--success)'}">${fmtM(m.iva_determinado)}</b></td>
                 <td class="num sub">${m.docs_venta + m.docs_compra}</td></tr>`).join('')
                || '<tr><td colspan="7"><div class="empty">Sin documentos este año.</div></td></tr>'}
           </tbody>
           <tfoot><tr><td>Total ${a.anio}</td>
             <td class="num">${fmtM(a.anual.ventas)}</td><td class="num">${fmtM(a.anual.compras)}</td>
             <td class="num">${fmtM(a.anual.iva_debito)}</td><td class="num">${fmtM(a.anual.iva_credito)}</td>
             <td class="num">${fmtM(a.anual.iva_determinado)}</td>
             <td class="num">${a.anual.docs}</td></tr></tfoot>
         </table>
       </div>
     </div>

     <div class="grid-2 mt">
       <div id="an-top-cli"></div>
       <div id="an-top-prov"></div>
     </div>`

    // ---------- top 20 con UITabla (búsqueda/orden/exportación) ----------
    const colTop = [
      { key: 'rut', label: 'RUT', crudo: (f) => f.rut, valor: (f) => formatRut(f.rut) },
      { key: 'razon_social', label: 'Razón social' },
      { key: 'docs', label: 'Docs', num: true },
      { key: 'total', label: 'Total', num: true, valor: (f) => fmtM(f.total), crudo: (f) => f.total },
      { key: 'neto', label: 'Neto', num: true, valor: (f) => fmtM(f.neto), crudo: (f) => f.neto },
    ]
    const filaTop = (f, hl) => `<tr>
      <td class="mono">${f.rut ? hl(formatRut(f.rut)) : '—'}</td>
      <td>${hl(f.razon_social || '—')}</td>
      <td class="num">${f.docs}</td>
      <td class="num"><b>${hl(fmtM(f.total))}</b></td>
      <td class="num sub">${fmtM(f.neto)}</td>
    </tr>`

    UITabla.montar({
      mount: document.getElementById('an-top-cli'),
      columnas: colTop, filas: a.top_clientes, nombreArchivo: `top-clientes-${a.anio}`,
      filaHTML: filaTop, vacio: 'Sin ventas registradas este año',
      accionesExtra: `<span class="hint">Top ${a.top_clientes.length} clientes por facturación</span>`,
    })
    UITabla.montar({
      mount: document.getElementById('an-top-prov'),
      columnas: colTop, filas: a.top_proveedores, nombreArchivo: `top-proveedores-${a.anio}`,
      filaHTML: filaTop, vacio: 'Sin compras registradas este año',
      accionesExtra: `<span class="hint">Top ${a.top_proveedores.length} proveedores por facturación</span>`,
    })

    document.getElementById('an-anio').addEventListener('change', (e) => {
      window._analiticaAnio = e.target.value
      renderRoute()
    })
  },
}
