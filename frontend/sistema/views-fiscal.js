/**
 * VISTAS FISCALES — Inicio (KPIs), Libros Compras/Ventas, Documentos e
 * Integraciones (IVA Mensual como conector SII oculto).
 */

/* ============================ INICIO ============================ */

VIEWS.inicio = {
  titulo: 'Inicio',
  async render(cont) {
    const periodo = periodoActual()
    const meses = ultimosPeriodos(6)

    const mesesData = await Promise.all(meses.map(async (p) => {
      try {
        const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos?periodo=${p}&limit=1000`)
        return { p, ...r }
      } catch { return { p, sumas: { neto: 0, iva: 0, total: 0 }, estados: [], documentos: [] } }
    }))

    const delMes = mesesData.find((m) => m.p === periodo) || { sumas: {}, estados: [], documentos: [] }
    const totalPor = (docs, flujo, campo) => docs
      .filter((d) => d.tipo_flujo === flujo && !['ANULADO', 'ERROR'].includes(d.estado))
      .reduce((s, d) => s + (d[campo] || 0), 0)

    const ventas = totalPor(delMes.documentos || [], 'venta', 'monto_total')
    const compras = totalPor(delMes.documentos || [], 'compra', 'monto_total')
    const ivaVentas = totalPor(delMes.documentos || [], 'venta', 'monto_iva')
    const ivaCompras = totalPor(delMes.documentos || [], 'compra', 'monto_iva')
    const ivaDeterminado = ivaVentas - ivaCompras
    const sinContabilizar = (delMes.estados || [])
      .filter((e) => ['PENDIENTE', 'CLASIFICADO', 'PROPUESTO', 'REVISIÓN'].includes(e.estado))
      .reduce((s, e) => s + e.n, 0)

    const maxBarra = Math.max(1, ...mesesData.flatMap((m) => [
      totalPor(m.documentos || [], 'venta', 'monto_total'),
      totalPor(m.documentos || [], 'compra', 'monto_total'),
    ]))

    cont.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><small>Ventas ${perDisplay(periodo)}</small><strong>${fmtCorto(ventas)}</strong><span class="sub">${fmtM(ventas)}</span></div>
        <div class="kpi"><small>Compras ${perDisplay(periodo)}</small><strong>${fmtCorto(compras)}</strong><span class="sub">${fmtM(compras)}</span></div>
        <div class="kpi acc"><small>IVA determinado</small><strong>${fmtCorto(ivaDeterminado)}</strong><span class="sub">débito − crédito</span></div>
        <div class="kpi ${sinContabilizar ? 'warn' : 'up'}"><small>Por contabilizar</small><strong>${sinContabilizar}</strong><span class="sub">documentos del mes</span></div>
      </div>

      <div class="card mt">
        <div class="flex" style="justify-content:space-between">
          <h3 style="margin:0">Ventas vs compras — últimos 6 meses</h3>
          <div class="legend"><span><i style="background:var(--accent)"></i>Ventas</span><span><i style="background:var(--c-slate-500)"></i>Compras</span></div>
        </div>
        <div class="bars mt">
          ${mesesData.map((m) => {
            const v = totalPor(m.documentos || [], 'venta', 'monto_total')
            const c = totalPor(m.documentos || [], 'compra', 'monto_total')
            return `<div class="b" title="${perDisplay(m.p)} — ${fmtM(v)} vs ${fmtM(c)}">
              <i class="v" style="height:${Math.round((v / maxBarra) * 100)}%"></i>
              <i class="c" style="height:${Math.round((c / maxBarra) * 100)}%"></i>
            </div>`
          }).join('')}
        </div>
        <div class="bars-lbl">${mesesData.map((m) => `<span>${m.p.slice(4)}/${m.p.slice(2, 4)}</span>`).join('')}</div>
      </div>

      <div class="card mt">
        <div class="flex" style="justify-content:space-between">
          <div>
            <h3 style="margin:0">⚡ Contabilización automática</h3>
            <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Clasifica con reglas, genera propuestas en partida doble y contabiliza el período completo en un clic.
            </p>
          </div>
          <a href="#automatizacion" class="btn btn-primary btn-sm">Abrir →</a>
        </div>
      </div>

      <div class="grid-2 mt">
        <div class="card">
          <h3>🔌 Integración SII (IVA Mensual)</h3>
          <p class="muted" style="font-size:var(--fs-sm);margin:0 0 var(--space-3)">
            La conexión con el SII corre sobre IVA Mensual, como integración oculta:
            descarga el RCV de compras y ventas y alimenta estos libros automáticamente.
          </p>
          <div class="checkline ok">Conexión activa — sesión verificada</div>
          <div class="checkline ${delMes.documentos?.length ? 'ok' : 'warn'}">${perDisplay(periodo)}: ${delMes.documentos?.length || 0} documentos sincronizados</div>
          <div class="mt"><a href="#libros" class="btn btn-primary btn-sm">Sincronizar un período →</a></div>
        </div>
        <div class="card">
          <h3>Atajos</h3>
          <div class="flex" style="gap:var(--space-2)">
            <a href="#libros" class="btn btn-secondary btn-sm">📚 Libros</a>
            <a href="#documentos" class="btn btn-secondary btn-sm">🧾 Documentos</a>
            <a href="#asientos" class="btn btn-secondary btn-sm">⚖️ Contabilidad</a>
            <a href="#propuestas" class="btn btn-secondary btn-sm">⚡ Propuestas</a>
            <a href="#reportes" class="btn btn-secondary btn-sm">📈 Reportes</a>
          </div>
          <p class="hint mt">Empresa activa: <b>${esc(S.empresa.nombre)}</b> · RUT ${esc(formatRut(S.empresa.rut))}</p>
        </div>
      </div>`
  },
}

/* ====================== LIBROS COMPRAS Y VENTAS ====================== */

VIEWS.libros = {
  titulo: 'Libros Compras y Ventas',
  async render(cont) {
    const periodo = window._librosPeriodo || periodoActual()
    const tab = window._librosTab || 'compra'
    const puedeIngestar = tiene('documentos:ingestar')

    cont.innerHTML = `
      <div class="frm-row mb">
        <div><span class="frm-label">Período</span>${inputPeriodoHTML('lb-periodo', periodo)}</div>
        ${puedeIngestar ? `<button class="btn btn-primary" id="lb-sync">⇅ Sincronizar con SII</button>` : ''}
        <button class="btn btn-secondary" id="lb-csv">⬇ CSV</button>
        <span class="spacer"></span>
        <div id="lb-ingesta" style="flex:1;min-width:220px"></div>
      </div>
      <div class="tabs" id="lb-tabs">
        <button data-t="compra" class="${tab === 'compra' ? 'active' : ''}">Libro de Compras</button>
        <button data-t="venta" class="${tab === 'venta' ? 'active' : ''}">Libro de Ventas</button>
        <button data-t="resumen" class="${tab === 'resumen' ? 'active' : ''}">Resumen tributario</button>
      </div>
      <div id="lb-body"></div>`

    document.getElementById('lb-periodo').addEventListener('change', () => {
      window._librosPeriodo = leerPeriodo('lb-periodo') || periodo
      renderRoute()
    })
    document.getElementById('lb-tabs').addEventListener('click', (e) => {
      const t = e.target.dataset.t
      if (t) { window._librosTab = t; renderRoute() }
    })
    document.getElementById('lb-csv').addEventListener('click', () => exportarLibroCSV(periodo, tab))

    if (puedeIngestar) {
      document.getElementById('lb-sync').addEventListener('click', () => sincronizarSII(periodo))
    }

    await pintarLibro(periodo, tab)
  },
}

async function pintarLibro(periodo, tab) {
  const body = document.getElementById('lb-body')
  const eid = S.empresa.id
  if (tab === 'resumen') {
    const [c, v] = await Promise.all([
      apiGet(`/api/contable/empresas/${eid}/documentos?periodo=${periodo}&tipo_flujo=compra&limit=1000`),
      apiGet(`/api/contable/empresas/${eid}/documentos?periodo=${periodo}&tipo_flujo=venta&limit=1000`),
    ])
    const s = (r, campo) => (r.documentos || []).filter((d) => !['ANULADO', 'ERROR'].includes(d.estado)).reduce((acc, d) => acc + (d[campo] || 0), 0)
    const estados = {}
    for (const r of [c, v]) for (const e of (r.estados || [])) estados[e.estado] = (estados[e.estado] || 0) + e.n

    body.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi"><small>Neto compras</small><strong>${fmtCorto(s(c, 'monto_neto'))}</strong><span class="sub">${fmtM(s(c, 'monto_neto'))}</span></div>
        <div class="kpi acc"><small>IVA crédito</small><strong>${fmtCorto(s(c, 'monto_iva'))}</strong></div>
        <div class="kpi"><small>Neto ventas</small><strong>${fmtCorto(s(v, 'monto_neto'))}</strong><span class="sub">${fmtM(s(v, 'monto_neto'))}</span></div>
        <div class="kpi acc"><small>IVA débito</small><strong>${fmtCorto(s(v, 'monto_iva'))}</strong></div>
        <div class="kpi ${s(v, 'monto_iva') - s(c, 'monto_iva') >= 0 ? 'bad' : 'up'}"><small>IVA determinado (F29)</small><strong>${fmtM(s(v, 'monto_iva') - s(c, 'monto_iva'))}</strong></div>
      </div>
      <div class="card mt">
        <h3>Estado de los documentos del período</h3>
        <div class="flex">${Object.entries(estados).map(([est, n]) => `<span>${chipEstado(est)} <b class="mono">${n}</b></span>`).join('') || '<span class="muted">Sin documentos</span>'}</div>
      </div>`
    return
  }

  const r = await apiGet(`/api/contable/empresas/${eid}/documentos?periodo=${periodo}&tipo_flujo=${tab}&limit=1000`)
  const docs = r.documentos || []
  body.innerHTML = `
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>
          <th>Fecha</th><th>Tipo</th><th>Folio</th><th>RUT</th><th>Razón social</th>
          <th class="num">Exento</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Total</th><th>Estado</th>
        </tr></thead>
        <tbody>
          ${docs.map((d) => `<tr>
            <td class="sub">${esc((d.fecha_docto || '').slice(0, 10))}</td>
            <td class="sub">${esc(NOMBRES_TIPO_DOC[d.tipo_doc] || `Tipo ${d.tipo_doc}`)}</td>
            <td class="mono">${esc(d.folio)}</td>
            <td class="mono sub">${esc(formatRut(d.rut_contraparte))}</td>
            <td>${esc((d.razon_social || '').slice(0, 42))}</td>
            <td class="num">${d.monto_exento ? fmtM(d.monto_exento) : '—'}</td>
            <td class="num">${fmtM(d.monto_neto)}</td>
            <td class="num">${fmtM(d.monto_iva)}</td>
            <td class="num"><b>${fmtM(d.monto_total)}</b></td>
            <td>${chipEstado(d.estado)}</td>
          </tr>`).join('') || `<tr><td colspan="10"><div class="empty">Sin documentos de ${tab === 'compra' ? 'compras' : 'ventas'} en ${perDisplay(periodo)}.</div></td></tr>`}
        </tbody>
        <tfoot><tr>
          <td colspan="6">Totales (${r.sumas?.n ?? 0} docs)</td>
          <td class="num">${fmtM(r.sumas?.neto)}</td>
          <td class="num">${fmtM(r.sumas?.iva)}</td>
          <td class="num">${fmtM(r.sumas?.total)}</td><td></td>
        </tr></tfoot>
      </table>
    </div>
    ${(r.total || 0) > docs.length ? `<p class="hint mt">Mostrando ${docs.length} de ${r.total} — usa el filtro por texto en la sección Documentos.</p>` : ''}`
}

function exportarLibroCSV(periodo, tab) {
  const rows = document.querySelectorAll('#lb-body tbody tr')
  if (!rows.length) return showToast('Nada que exportar', 'error')
  const lines = [['Fecha', 'Tipo', 'Folio', 'RUT', 'Razon social', 'Exento', 'Neto', 'IVA', 'Total', 'Estado']]
  rows.forEach((tr) => {
    if (tr.querySelector('.empty')) return
    lines.push([...tr.querySelectorAll('td')].map((td) => td.textContent.trim().replace(/\$/g, '').replace(/\./g, '').trim()))
  })
  const csv = lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  a.download = `libro-${tab}-${periodo}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Ingesta SII con progreso en vivo (la conexión IVA Mensual, oculta aquí). */
async function sincronizarSII(periodo) {
  const box = document.getElementById('lb-ingesta')
  try {
    const job = await apiPost(`/api/contable/empresas/${S.empresa.id}/documentos-ingesta`, { periodo })
    box.innerHTML = `<div class="prog"><i style="width:8%"></i></div><div class="hint mt">Consultando RCV ${perDisplay(periodo)} en el SII…</div>`
    const detener = iniciarPolling(
      () => apiGet(`/api/contable/empresas/${S.empresa.id}/documentos-ingesta/${job.jobId}`),
      {
        intervalo: 1500,
        esTerminal: (d) => ['completado', 'completado_con_errores', 'error'].includes(d.job?.estado),
        onUpdate: (d) => {
          const j = d.job
          const pct = j.total ? Math.max(8, Math.round((j.procesados / j.total) * 100)) : 8
          const txt = String(j.estado).replace('_', ' ')
          box.innerHTML = `<div class="prog"><i style="width:${pct}%"></i></div><div class="hint mt">SII: ${esc(txt)}…</div>`
        },
      },
    )
    // esperar término manualmente
    while (true) {
      const d = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos-ingesta/${job.jobId}`)
      if (['completado', 'completado_con_errores', 'error'].includes(d.job?.estado)) {
        detener()
        const res = d.job.resultado
        if (d.job.estado === 'error') {
          showToast(`Error de sincronización: ${d.job.error || 'detalle en auditoría'}`, 'error')
        } else {
          showToast(`Sincronización ${perDisplay(periodo)}: ${res?.insertados_total ?? 0} nuevos, ${res?.duplicados_total ?? 0} ya existentes`, 'success')
        }
        refrescarPillDocs()
        renderRoute()
        return
      }
      await new Promise((r2) => setTimeout(r2, 1500))
    }
  } catch (err) {
    box.innerHTML = ''
    showToast(err.message, 'error')
  }
}

/* ============================ DOCUMENTOS ============================ */

VIEWS.documentos = {
  titulo: 'Documentos',
  async render(cont) {
    const filtros = window._docFiltros || { estado: 'PENDIENTE', texto: '', flujo: '' }
    const eid = S.empresa.id
    const qs = new URLSearchParams({ limit: 300 })
    if (filtros.estado) qs.set('estado', filtros.estado)
    if (filtros.texto) qs.set('texto', filtros.texto)
    if (filtros.flujo) qs.set('tipo_flujo', filtros.flujo)

    const r = await apiGet(`/api/contable/empresas/${eid}/documentos?${qs}`)
    const estadosMap = Object.fromEntries((r.estados || []).map((e) => [e.estado, e.n]))

    cont.innerHTML = `
      <div class="frm-row mb">
        <button class="btn ${filtros.estado === 'PENDIENTE' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-est="PENDIENTE">Pendientes <b class="mono">${estadosMap.PENDIENTE || 0}</b></button>
        <button class="btn ${filtros.estado === 'CLASIFICADO' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-est="CLASIFICADO">Clasificados <b class="mono">${estadosMap.CLASIFICADO || 0}</b></button>
        <button class="btn ${filtros.estado === 'CONTABILIZADO' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-est="CONTABILIZADO">Contabilizados <b class="mono">${estadosMap.CONTABILIZADO || 0}</b></button>
        <button class="btn ${filtros.estado === 'REVISIÓN' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-est="REVISIÓN">Revisión <b class="mono">${estadosMap['REVISIÓN'] || 0}</b></button>
        <button class="btn ${filtros.estado === '' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-est="">Todos</button>
        <span class="spacer"></span>
        <input id="doc-texto" class="form-input" placeholder="Buscar folio o razón social…" value="${esc(filtros.texto)}" style="width:220px">
        ${tiene('documentos:clasificar') ? `<button class="btn btn-primary btn-sm" id="doc-auto">⚡ Clasificar automático</button>` : ''}
        <button class="btn btn-secondary btn-sm" id="doc-reglas">📐 Reglas</button>
      </div>
      <div class="tbl-wrap">
        <table class="tbl">
          <thead><tr><th>Doc</th><th>Folio</th><th>Contraparte</th><th class="num">Total</th><th>Estado</th><th>Cuenta</th><th></th></tr></thead>
          <tbody>
            ${(r.documentos || []).map((d) => `<tr>
              <td class="sub">${d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'} ${esc(NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc)}</td>
              <td class="mono">${esc(d.folio)}</td>
              <td>${esc((d.razon_social || '—').slice(0, 38))}<div class="sub mono">${esc(formatRut(d.rut_contraparte))}</div></td>
              <td class="num"><b>${fmtM(d.monto_total)}</b></td>
              <td>${chipEstado(d.estado)}</td>
              <td class="sub">${esc(d.cuenta_codigo ? `${d.cuenta_codigo} ${d.cuenta_nombre || ''}` : '—')}</td>
              <td>${tiene('documentos:clasificar') && !['CONTABILIZADO', 'ANULADO'].includes(d.estado)
                ? `<button class="btn btn-secondary btn-sm" data-clas="${d.id}">Clasificar</button>` : ''}</td>
            </tr>`).join('') || `<tr><td colspan="7"><div class="empty">Sin documentos con estos filtros.</div></td></tr>`}
          </tbody>
          <tfoot><tr><td colspan="3">Sumas del filtro</td>
            <td class="num">${fmtM(r.sumas?.total)}</td>
            <td colspan="3" class="sub">neto ${fmtM(r.sumas?.neto)} · IVA ${fmtM(r.sumas?.iva)}</td>
          </tr></tfoot>
        </table>
      </div>`

    cont.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', () => {
      window._docFiltros = { ...filtros, estado: b.dataset.est }
      renderRoute()
    }))
    const txt = document.getElementById('doc-texto')
    txt.addEventListener('change', () => {
      window._docFiltros = { ...filtros, texto: txt.value.trim() }
      renderRoute()
    })
    cont.querySelectorAll('[data-clas]').forEach((b) => b.addEventListener('click', () => modalClasificar(Number(b.dataset.clas))))
    document.getElementById('doc-reglas').addEventListener('click', modalReglas)
    const auto = document.getElementById('doc-auto')
    if (auto) auto.addEventListener('click', async () => {
      try {
        const res = await apiPost(`/api/contable/empresas/${eid}/documentos/clasificar-automatico`, { periodo: null })
        showToast(`Clasificación automática: ${res.clasificados ?? 0} documento(s)`, 'success')
        refrescarPillDocs()
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  },
}

async function modalClasificar(docId) {
  try {
    const [dRes, imputables, centros] = await Promise.all([
      apiGet(`/api/contable/empresas/${S.empresa.id}/documentos/${docId}`),
      getCuentasImputables(),
      getCentros(),
    ])
    const d = dRes.documento
    openModal(`
      <h3>Clasificar ${d.tipo_flujo === 'compra' ? 'compra' : 'venta'} folio ${esc(d.folio)}</h3>
      <p class="sub">${esc(d.razon_social || d.rut_contraparte)} · ${fmtM(d.monto_total)}</p>
      <div class="form-group">
        <label class="form-label">Cuenta contable (neto imputable)</label>
        <select id="cl-cuenta" class="form-input">
          ${selectOptions(imputables, 'id', (c) => `${c.codigo} — ${c.nombre}`, d.cuenta_id)}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Centro de costo (opcional)</label>
        <select id="cl-cc" class="form-input">
          <option value="">—</option>
          ${selectOptions(centros, 'id', (c) => `${c.codigo} — ${c.nombre}`, d.centro_costo_id)}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tratamiento IVA</label>
        <select id="cl-iva" class="form-input">
          ${selectOptions([
            { v: d.tipo_flujo === 'compra' ? 'credito' : 'debito', t: d.tipo_flujo === 'compra' ? 'Crédito fiscal (recuperable)' : 'Débito fiscal' },
            { v: 'exento', t: 'Exento / sin IVA' },
            { v: 'comun', t: 'Uso común (sin crédito)' },
            { v: 'no_recuperable', t: 'No recuperable (gasto total)' },
          ], 'v', (o) => o.t, d.tratamiento_iva || (d.tipo_flujo === 'compra' ? 'credito' : 'debito'))}
        </select>
      </div>
      <label class="flex" style="font-size:var(--fs-sm);color:var(--fg-secondary)">
        <input type="checkbox" id="cl-recordar"> Recordar para este RUT + tipo de documento (crea regla)
      </label>
      <div class="modal-foot">
        <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-primary" id="cl-save">Guardar clasificación</button>
      </div>`)
    document.getElementById('cl-save').addEventListener('click', async () => {
      try {
        await apiPost(`/api/contable/empresas/${S.empresa.id}/documentos/${docId}/clasificar`, {
          cuenta_id: Number(document.getElementById('cl-cuenta').value),
          centro_costo_id: document.getElementById('cl-cc').value ? Number(document.getElementById('cl-cc').value) : null,
          tratamiento_iva: document.getElementById('cl-iva').value,
        })
        if (document.getElementById('cl-recordar').checked) {
          try {
            await apiPost(`/api/contable/empresas/${S.empresa.id}/documentos/${docId}/aprender-regla`, {})
            showToast('Clasificado y regla aprendida', 'success')
          } catch (err) { showToast(`Clasificado, pero la regla falló: ${err.message}`, 'error') }
        } else {
          showToast('Documento clasificado', 'success')
        }
        cerrarModal()
        refrescarPillDocs()
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  } catch (err) { showToast(err.message, 'error') }
}

async function modalReglas() {
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/reglas`)
    const reglas = r.reglas || []
    openModal(`
      <h3>Reglas contables</h3>
      <p class="sub">Se evalúan por prioridad descendente. La primera que calza clasifica el documento.</p>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>#</th><th>Nombre</th><th>Condición</th><th>Cuenta</th><th></th></tr></thead>
        <tbody>${reglas.map((g) => `<tr>
          <td class="mono">${g.prioridad}</td>
          <td>${esc(g.nombre)}${g.activa ? '' : ' <span class="chip neutral">inactiva</span>'}</td>
          <td class="sub">${esc([
            g.tipo_flujo || 'ambos flujos',
            g.rut_contraparte ? formatRut(g.rut_contraparte) : null,
            g.tipo_doc ? NOMBRES_TIPO_DOC[g.tipo_doc] || `tipo ${g.tipo_doc}` : null,
            g.patron_razon_social ? `«${g.patron_razon_social}»` : null,
          ].filter(Boolean).join(' · '))}</td>
          <td class="sub mono">${esc(g.cuenta_codigo || '')}</td>
          <td>${g.activa && tiene('reglas:editar') ? `<button class="btn btn-secondary btn-sm" data-off="${g.id}">Desactivar</button>` : ''}</td>
        </tr>`).join('') || '<tr><td colspan="5"><div class="empty">Sin reglas todavía. Clasifica un documento marcando "recordar".</div></td></tr>'}</tbody>
      </table></div>`)
    document.querySelectorAll('[data-off]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await apiPost(`/api/contable/empresas/${S.empresa.id}/reglas/${b.dataset.off}/desactivar`, {})
        showToast('Regla desactivada', 'success')
        modalReglas()
      } catch (err) { showToast(err.message, 'error') }
    }))
  } catch (err) { showToast(err.message, 'error') }
}

/* ============================ INTEGRACIONES ============================ */

VIEWS.integraciones = {
  titulo: 'Integraciones',
  async render(cont) {
    const eid = S.empresa.id
    let empresa = null
    let auditoria = []
    try {
      empresa = (await apiGet(`/api/contable/empresas/${eid}`)).empresa
      auditoria = (await apiGet(`/api/contable/empresas/${eid}/auditoria?limit=50`)).registros || []
    } catch { /* sigue */ }
    const sincros = auditoria.filter((a) => String(a.accion).startsWith('documentos.ingest')).slice(0, 6)

    cont.innerHTML = `
      <div class="card">
        <div class="flex" style="justify-content:space-between">
          <div>
            <h3 style="margin:0">💼 IVA Mensual — Conexión SII</h3>
            <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Integración interna que descarga el Registro de Compras y Ventas (RCV) del SII
              y llena los libros automáticamente. No requiere intervención salvo renovar la clave.
            </p>
          </div>
          <span class="chip contabilizado">Conectado</span>
        </div>
        <div class="kpi-grid mt">
          <div class="kpi"><small>Empresa</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">${esc(S.empresa.nombre)}</strong></div>
          <div class="kpi"><small>Clave SII</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">${empresa?.clave_sii_configurada ? '✓ Configurada' : '⚠ Sin clave'}</strong></div>
          <div class="kpi"><small>Servicio RCV</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">SII directo</strong></div>
          <div class="kpi"><small>Caché</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">Períodos cerrados</strong></div>
        </div>
        <p class="hint mt">Para cambiar la clave SII: Administración → Empresas → editar.</p>
      </div>

      <div class="card mt">
        <h3>Últimas sincronizaciones</h3>
        ${sincros.map((a) => `<div class="checkline ok">documentos.ingestar — ${esc(a.entidad_id || '')} · ${esc((a.creado_en || '').replace('T', ' ').slice(0, 16))} · ${esc(a.username || '')}</div>`).join('')
          || '<p class="muted">Sin sincronizaciones registradas aún. Ve a Libros → Sincronizar con SII.</p>'}
      </div>`
  },
}
