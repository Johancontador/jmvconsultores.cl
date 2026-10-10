/**
 * VISTAS FISCALES — Inicio (KPIs), Libros Compras/Ventas, Documentos e
 * Integraciones (IVA Mensual como conector SII oculto).
 */

/* ============================ INICIO ============================ */

VIEWS.inicio = {
  titulo: 'Inicio',
  async render(cont) {
    const eid = S.empresa.id
    const pedido = window._inicioPeriodo || null
    let d, cobranzaRes = null
    try {
      const r = await apiGet(`/api/contable/empresas/${eid}/dashboard${pedido ? `?periodo=${pedido}` : ''}`)
      d = r.dashboard
      // Fase 4: KPI de cobranza en el Inicio — fallo silencioso si el rol no
      // incluye tesorería:ver (el dashboard no se rompe por eso).
      try { cobranzaRes = await apiGet(`/api/contable/empresas/${eid}/cobranza?limit=1`) } catch { }
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }
    window._inicioPeriodo = d.periodo

    const k = d.kpis
    const pct = k.docs_total ? Math.round((k.docs_contabilizados / k.docs_total) * 100) : 0
    const nPendientes = d.alertas.filter((a) => a.nivel === 'error' || a.nivel === 'warn').length
    const maxBarra = Math.max(1, ...d.serie.flatMap((m) => [m.ventas, m.compras]))

    cont.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Período</span>${inputPeriodoHTML('inicio-periodo', d.periodo)}</div>
       <span class="chip ${d.periodo_cerrado ? 'anulado' : 'contabilizado'}">${d.periodo_cerrado ? 'CERRADO' : 'ABIERTO'}</span>
       <span class="spacer"></span>
       <span class="muted" style="font-size:var(--fs-sm)"><b>${esc(S.empresa.nombre)}</b> · ${esc(formatRut(S.empresa.rut))}</span>
     </div>

     <div class="kpi-grid">
       <div class="kpi up"><small>Ingresos ${perDisplay(d.periodo)}</small><strong>${fmtCorto(k.ingresos)}</strong><span class="sub">acumulado año: ${fmtCorto(k.ingresos_acum)}</span></div>
       <div class="kpi"><small>Gastos ${perDisplay(d.periodo)}</small><strong>${fmtCorto(k.gastos)}</strong><span class="sub">pre-cierre (el PPM se devenga al cerrar)</span></div>
       <div class="kpi ${k.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado ${perDisplay(d.periodo)}</small><strong>${fmtCorto(k.resultado)}</strong><span class="sub">acumulado año: ${fmtCorto(k.resultado_acum)}</span></div>
       <div class="kpi acc"><small>IVA determinado</small><strong>${fmtCorto(k.iva_determinado)}</strong><span class="sub">débito − crédito del RCV</span></div>
     </div>

     <div class="kpi-grid mt">
       ${cobranzaRes ? `<div class="kpi ${cobranzaRes.total_pendiente > 0 ? 'warn' : 'up'}" style="cursor:pointer" onclick="location.hash='#cobranza'"><small>Cobranza pendiente</small><strong>${fmtCorto(cobranzaRes.total_pendiente || 0)}</strong><span class="sub">${(cobranzaRes.clientes || []).length} cliente(s) en mora → Cobranza</span></div>` : ''}
       <div class="kpi ${k.docs_total === 0 ? '' : (k.docs_sin_contabilizar ? 'warn' : 'up')}"><small>Contabilizados</small><strong>${k.docs_contabilizados}/${k.docs_total}</strong><span class="sub">${pct}% del período · ${k.docs_sin_contabilizar} por decisión humana (§43)</span></div>
       <div class="kpi ${k.asientos_cuadrado ? 'up' : 'bad'}"><small>Asientos del período</small><strong>${k.asientos_n}</strong><span class="sub">ΣD = ΣH ${k.asientos_cuadrado ? '' : 'DESCUADRE'}</span></div>
       <div class="kpi"><small>Cuentas por pagar</small><strong>${k.cxp === null ? '—' : fmtCorto(k.cxp)}</strong><span class="sub">proveedores · saldo acumulado</span></div>
       <div class="kpi"><small>Cuentas por cobrar</small><strong>${k.cxc === null ? '—' : fmtCorto(k.cxc)}</strong><span class="sub">clientes · saldo acumulado</span></div>
     </div>

     <div class="card mt">
       <div class="flex" style="justify-content:space-between">
         <h3 style="margin:0">${nPendientes ? `${nPendientes} acción(es) pendiente(s) — ${perDisplay(d.periodo)}` : `Al día — ${perDisplay(d.periodo)}`}</h3>
         <span class="muted" style="font-size:var(--fs-xs)">automático: ${k.docs_contabilizados} contabilizados · humano: ${k.docs_sin_contabilizar} por decidir</span>
       </div>
       <div class="alerta-lista mt">
          ${d.alertas.map((a) => `
           <div class="alerta ${a.nivel}">
                      <div class="tx"><b>${esc(a.mensaje)}</b>${a.detalle ? `<span class="muted"> — ${esc(a.detalle)}</span>` : ''}</div>
             <a class="btn btn-secondary btn-sm" href="#${a.vista}">${esc(a.etiqueta)}</a>
           </div>`).join('')}
       </div>
     </div>

     <div class="card mt">
       <div class="flex" style="justify-content:space-between">
         <h3 style="margin:0">Ventas vs compras — últimos 6 meses</h3>
         <div class="legend"><span><i style="background:var(--accent)"></i>Ventas</span><span><i style="background:var(--c-slate-500)"></i>Compras</span></div>
       </div>
       <div class="bars mt">
          ${d.serie.map((m) => `
           <div class="b" title="${perDisplay(m.periodo)} — ${fmtM(m.ventas)} vs ${fmtM(m.compras)}">
             <i class="v" style="height:${Math.round((m.ventas / maxBarra) * 100)}%"></i>
             <i class="c" style="height:${Math.round((m.compras / maxBarra) * 100)}%"></i>
           </div>`).join('')}
       </div>
       <div class="bars-lbl">${d.serie.map((m) => `<span>${m.periodo.slice(4)}/${m.periodo.slice(2, 4)}</span>`).join('')}</div>
     </div>

     <div class="card mt">
       <div class="flex" style="justify-content:space-between">
         <div>
           <h3 style="margin:0">Contabilización automática</h3>
           <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Clasifica con reglas, genera propuestas en partida doble y contabiliza el período completo en un clic.
              ${d.automatizacion.reglas_activas ? `${d.automatizacion.reglas_activas} regla(s) activa(s).` : 'Tu empresa aún no tiene reglas.'}
           </p>
         </div>
         <a href="#automatizacion" class="btn btn-primary btn-sm">Abrir</a>
       </div>
     </div>

      ${d.onboarding && !d.onboarding.completo ? `
     <div class="card mt">
       <div class="flex" style="justify-content:space-between">
         <div>
           <h3 style="margin:0">Onboarding — ${d.onboarding.pendientes} dato(s) por completar</h3>
           <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Ficha tributaria desde el SII con tu confirmación + ingesta del histórico. Todo autónomo, sin esperar a JMV.
           </p>
         </div>
         <a href="#onboarding" class="btn btn-primary btn-sm">Completar</a>
       </div>
     </div>` : ''}

     <div class="grid-2 mt">
       <div class="card">
         <h3>Integración SII (IVA Mensual)</h3>
         <p class="muted" style="font-size:var(--fs-sm);margin:0 0 var(--space-3)">
            La conexión con el SII corre sobre IVA Mensual, como integración oculta:
            descarga el RCV de compras y ventas y alimenta estos libros automáticamente.
         </p>
         <div class="checkline ${d.clave_sii_configurada ? 'ok' : 'warn'}">${d.clave_sii_configurada ? 'Clave SII configurada' : 'Sin clave SII configurada'}</div>
         <div class="checkline ${k.docs_total ? 'ok' : 'warn'}">${perDisplay(d.periodo)}: ${k.docs_total} documentos sincronizados</div>
         <div class="mt"><a href="#libros" class="btn btn-primary btn-sm">Sincronizar un período</a></div>
       </div>
       <div class="card">
         <h3>Atajos</h3>
         <div class="flex" style="gap:var(--space-2)">
           <a href="#libros" class="btn btn-secondary btn-sm">Libros</a>
           <a href="#documentos" class="btn btn-secondary btn-sm">Documentos</a>
           <a href="#asientos" class="btn btn-secondary btn-sm">Contabilidad</a>
           <a href="#propuestas" class="btn btn-secondary btn-sm">Propuestas</a>
           <a href="#reportes" class="btn btn-secondary btn-sm">Reportes</a>
         </div>
         <p class="hint mt">Empresa activa: <b>${esc(S.empresa.nombre)}</b> · RUT ${esc(formatRut(S.empresa.rut))}</p>
       </div>
     </div>`

    document.getElementById('inicio-periodo').addEventListener('change', () => {
      window._inicioPeriodo = leerPeriodo('inicio-periodo') || null
      renderRoute()
    })
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
  const suma = (filas, campo) => filas.reduce((acc, d) => acc + (d[campo] || 0), 0)

  body.innerHTML = `
   <div id="lb-tabla"></div>
   ${(r.total || 0) > docs.length ? `<p class="hint mt">El período tiene ${r.total} documentos; se cargaron los primeros ${docs.length}. Refina por texto en la sección Documentos.</p>` : ''}`

  UITabla.montar({
    mount: document.getElementById('lb-tabla'),
    columnas: [
      { key: 'fecha_docto', label: 'Fecha', valor: (d) => (d.fecha_docto || '').slice(0, 10) },
      { key: 'tipo_doc', label: 'Tipo', valor: (d) => NOMBRES_TIPO_DOC[d.tipo_doc] || `Tipo ${d.tipo_doc}` },
      { key: 'folio', label: 'Folio' },
      { key: 'rut_contraparte', label: 'RUT', valor: (d) => formatRut(d.rut_contraparte) },
      { key: 'razon_social', label: 'Razón social' },
      { key: 'monto_exento', label: 'Exento', num: true, valor: (d) => (d.monto_exento ? fmtM(d.monto_exento) : '—'), crudo: (d) => d.monto_exento || 0 },
      { key: 'monto_neto', label: 'Neto', num: true, valor: (d) => fmtM(d.monto_neto), crudo: (d) => d.monto_neto },
      { key: 'monto_iva', label: 'IVA', num: true, valor: (d) => fmtM(d.monto_iva), crudo: (d) => d.monto_iva },
      { key: 'monto_total', label: 'Total', num: true, valor: (d) => fmtM(d.monto_total), crudo: (d) => d.monto_total },
      { key: 'estado', label: 'Estado', orden: false, valor: (d) => d.estado },
    ],
    filas: docs,
    nombreArchivo: `libro-${tab}-${periodo}`,
    porPagina: 100,
    vacio: `Sin documentos de ${tab === 'compra' ? 'compras' : 'ventas'} en ${perDisplay(periodo)}.`,
    filaHTML: (d, hl) => `<tr>
      <td class="sub">${hl((d.fecha_docto || '').slice(0, 10))}</td>
      <td class="sub">${hl(NOMBRES_TIPO_DOC[d.tipo_doc] || `Tipo ${d.tipo_doc}`)}</td>
      <td class="mono">${hl(d.folio)}</td>
      <td class="mono sub">${hl(formatRut(d.rut_contraparte))}</td>
      <td>${hl((d.razon_social || '').slice(0, 42))}</td>
      <td class="num">${d.monto_exento ? fmtM(d.monto_exento) : '—'}</td>
      <td class="num">${fmtM(d.monto_neto)}</td>
      <td class="num">${fmtM(d.monto_iva)}</td>
      <td class="num"><b>${fmtM(d.monto_total)}</b></td>
      <td>${chipEstado(d.estado)}</td>
    </tr>`,
    totalesHTML: (filas) => `<tr>
      <td colspan="6">Totales de lo filtrado (${filas.length} docs) · período completo: ${fmtM(r.sumas?.total)}</td>
      <td class="num">${fmtM(suma(filas, 'monto_neto'))}</td>
      <td class="num">${fmtM(suma(filas, 'monto_iva'))}</td>
      <td class="num">${fmtM(suma(filas, 'monto_total'))}</td><td></td>
    </tr>`,
  })
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
       ${tiene('documentos:clasificar') ? `<button class="btn btn-primary btn-sm" id="doc-auto">Clasificar automático</button>` : ''}
       <button class="btn btn-secondary btn-sm" id="doc-reglas">Reglas</button>
     </div>
     <div id="doc-tabla"></div>`

    UITabla.montar({
      mount: document.getElementById('doc-tabla'),
      columnas: [
        { key: 'tipo_doc', label: 'Doc', valor: (d) => `${d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'} ${NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc}` },
        { key: 'folio', label: 'Folio' },
        { key: 'razon_social', label: 'Contraparte' },
        { key: 'rut_contraparte', label: 'RUT', valor: (d) => formatRut(d.rut_contraparte) },
        { key: 'monto_total', label: 'Total', num: true, valor: (d) => fmtM(d.monto_total), crudo: (d) => d.monto_total },
        { key: 'estado', label: 'Estado', orden: false },
        { key: 'cuenta', label: 'Cuenta', valor: (d) => (d.cuenta_codigo ? `${d.cuenta_codigo} ${d.cuenta_nombre || ''}` : '—') },
      ],
      filas: r.documentos || [],
      nombreArchivo: `documentos-${filtros.estado || 'todos'}`,
      porPagina: 100,
      vacio: 'Sin documentos con estos filtros.',
      filaHTML: (d, hl) => `<tr>
        <td class="sub">${hl(d.tipo_flujo === 'compra' ? 'Compra' : 'Venta')} ${hl(NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc)}</td>
        <td class="mono">${hl(d.folio)}</td>
        <td>${hl((d.razon_social || '—').slice(0, 38))}<div class="sub mono">${hl(formatRut(d.rut_contraparte))}</div></td>
        <td class="num"><b>${fmtM(d.monto_total)}</b></td>
        <td>${chipEstado(d.estado)}</td>
        <td class="sub">${hl(d.cuenta_codigo ? `${d.cuenta_codigo} ${d.cuenta_nombre || ''}` : '—')}</td>
        <td>${tiene('documentos:clasificar') && !['CONTABILIZADO', 'ANULADO'].includes(d.estado)
          ? `<button class="btn btn-secondary btn-sm" data-clas="${d.id}">Clasificar</button>` : ''}</td>
      </tr>`,
      totalesHTML: (filas) => `<tr><td colspan="4">Sumas de lo filtrado (${filas.length} docs)</td>
        <td class="num">${fmtM(filas.reduce((a, d) => a + (d.monto_total || 0), 0))}</td>
        <td colspan="2" class="sub">neto ${fmtM(filas.reduce((a, d) => a + (d.monto_neto || 0), 0))} · IVA ${fmtM(filas.reduce((a, d) => a + (d.monto_iva || 0), 0))}</td>
      </tr>`,
      accionesExtra: '',
    })

    cont.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', () => {
      window._docFiltros = { ...filtros, estado: b.dataset.est }
      renderRoute()
    }))
    // Delegación: UITabla re-renderiza el tbody al paginar/ordenar.
    document.getElementById('doc-tabla').addEventListener('click', (e) => {
      const b = e.target.closest('[data-clas]')
      if (b) modalClasificar(Number(b.dataset.clas))
    })
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
           <h3 style="margin:0">IVA Mensual — Conexión SII</h3>
           <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Integración interna que descarga el Registro de Compras y Ventas (RCV) del SII
              y llena los libros automáticamente. No requiere intervención salvo renovar la clave.
           </p>
         </div>
         <span class="chip contabilizado">Conectado</span>
       </div>
       <div class="kpi-grid mt">
         <div class="kpi"><small>Empresa</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">${esc(S.empresa.nombre)}</strong></div>
         <div class="kpi"><small>Clave SII</small><strong style="font-size:var(--fs-md);font-family:var(--font-sans)">${empresa?.clave_sii_configurada ? 'Configurada' : 'Sin clave'}</strong></div>
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
