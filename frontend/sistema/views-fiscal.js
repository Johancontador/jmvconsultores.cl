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
    let d, cobranzaRes = null, saludRes = null
    try {
      const r = await apiGet(`/api/contable/empresas/${eid}/dashboard${pedido ? `?periodo=${pedido}` : ''}`)
      d = r.dashboard
      // Fase 4: KPI de cobranza en el Inicio. Se pide SOLO si el rol puede
      // leerla (`tesoreria:ver`): antes la consulta se hacía igual para el
      // dueño cliente, que no tiene esa capacidad, y cada visita al panel le
      // dejaba un 403 en la consola (sin romper la vista, pero ruido real).
      if (tiene('tesoreria:ver')) {
        try { cobranzaRes = await apiGet(`/api/contable/empresas/${eid}/cobranza?limit=1`) } catch { /* el KPI es opcional: el panel sigue */ }
      }
      // Destacado: salud tributaria del período (score + hallazgos + acceso).
      // Resumen cacheado 60 s en el servidor: no encarece el panel.
      if (tiene('salud:ver')) {
        try { saludRes = (await apiGet(`/api/contable/empresas/${eid}/salud-tributaria/resumen?periodo=${periodoGlobal()}&meses=12`)).resumen } catch { /* opcional */ }
      }
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
     <div class="frm-row mb pg-toolbar">
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

     ${saludRes ? `
     <div class="card mt" id="inicio-salud">
       <div class="flex" style="justify-content:space-between;align-items:center;gap:var(--space-3);flex-wrap:wrap">
         <div style="min-width:0">
           <span class="sys-kicker">Salud tributaria · ${perDisplay(saludRes.periodo)}</span>
           <h3 style="margin:var(--space-1) 0">${esc(saludRes.titulo)} <span class="chip ${({ AL_DIA: 'contabilizado', CON_OBSERVACIONES: 'propuesto', REQUIERE_REVISION: 'error', SIN_INFORMACION: 'neutral' })[saludRes.nivel] || 'neutral'}">${esc(saludRes.nivel.replaceAll('_', ' '))}</span></h3>
           <p class="sub" style="margin:0">
             ${saludRes.hallazgos} hallazgo(s)${saludRes.hallazgos_altos ? ` · <b style="color:var(--danger)">${saludRes.hallazgos_altos} de atención alta</b>` : ''}
             · RCV ${saludRes.cobertura.con_datos}/12 mes(es)${saludRes.cobertura.sin_datos ? ` · ${saludRes.cobertura.sin_datos} sin sincronizar` : ''}
             · ${saludRes.f29_oficial ? 'F29 oficial consultado' : 'F29 oficial sin consultar'}
             ${saludRes.ficha ? '' : ' · <b>ficha SII pendiente</b>'}
           </p>
         </div>
         <div class="flex" style="align-items:center;gap:var(--space-3)">
           <div class="kpi ${saludRes.score >= 80 ? 'up' : saludRes.score >= 50 ? '' : 'bad'}" style="min-width:110px"><small>Score</small><strong>${saludRes.score}/100</strong></div>
           <a class="btn btn-primary" href="#salud">Ver informe de salud</a>
         </div>
       </div>
     </div>` : ''}

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

     <!-- BLOQUE 4 (unificación UX): trabajos largos y última sincronización —
          observabilidad real sin disparar nada (endpoint de lectura pura). -->
     <div class="card mt" id="inicio-jobs">
       <div class="flex" style="justify-content:space-between">
         <h3 style="margin:0">Trabajos y sincronización</h3>
         <span class="muted" id="jobs-sub" style="font-size:var(--fs-xs)">cargando…</span>
       </div>
       <div id="jobs-cuerpo" class="mt">${window.UIEstado ? UIEstado.cargando('Consultando estado de trabajos…') : ''}</div>
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

    // Trabajos y sincronización: 1 fetch de lectura pura; si falla, el bloque
    // muestra el error SIN romper el dashboard (no es un KPI crítico).
    apiGet(`/api/contable/empresas/${eid}/jobs/estado`).then((r) => {
      const j = r.resumen
      const sub = document.getElementById('jobs-sub')
      const cuerpo = document.getElementById('jobs-cuerpo')
      if (!cuerpo) return
      sub.textContent = j.ultima_sync
        ? `última sync: ${perDisplay(j.ultima_sync.periodo)} (${(j.ultima_sync.cuando || '').slice(0, 16).replace('T', ' ')})`
        : 'sin sincronización registrada'
      if (!r.trabajos.length) {
        cuerpo.innerHTML = window.UIEstado
          ? UIEstado.vacio('Sin trabajos registrados', 'Cuando se lance una extracción del histórico o la sincronización diaria, aparecerá aquí su avance.', '')
          : '<p class="muted">Sin trabajos.</p>'
        return
      }
      // Sin jobs CRÍTICOS: tarjetas resumen; con jobs: línea de estado por job
      const filas = r.trabajos.map((t) => {
        const familia = t.estado === 'completado' ? 'contabilizado' : (t.estado === 'fallido' ? 'error' : (t.estado === 'ejecutando' ? 'propuesto' : 'pendiente'))
        const tipo = t.tipo === 'historico_rcv' ? 'Histórico RCV' : (t.tipo === 'sync_diaria' ? 'Sync diaria' : esc(t.tipo))
        return `
          <div class="alerta ${t.estado === 'fallido' ? 'error' : (t.estado === 'completado' ? 'ok' : 'info')}">
            <div class="tx"><b>${tipo}</b><span class="muted"> — ${esc(t.periodo)}</span>${t.error ? `<span class="muted" style="display:block">${esc(t.error)}</span>` : ''}</div>
            ${window.UIEstado ? UIEstado.chip(esc(t.estado), familia) : esc(t.estado)}
          </div>`
      }).join('')
      cuerpo.innerHTML = `<div class="alerta-lista">${filas}</div>`
    }).catch(() => {
      const cuerpo = document.getElementById('jobs-cuerpo')
      if (cuerpo) cuerpo.innerHTML = window.UIEstado ? UIEstado.vacio('No se pudo consultar el estado de trabajos', 'El resto del panel funciona normalmente; reintenta más tarde.', '') : '<p class="muted">Sin estado de trabajos.</p>'
    })
  },
}

/* ====================== LIBROS COMPRAS Y VENTAS ====================== */

/**
 * Las notas de crédito (tipos 60 y 61) RESTAN en los libros. El backend lo
 * aplica en SQL con `SIGNO_NC` (core/sii-convenios.js); sumar las filas en crudo
 * inflaba neto, IVA y total justo en los libros que se comparan con el F29.
 */
function signoDoc(d) {
  return [60, 61].includes(Number(d.tipo_doc)) ? -1 : 1
}

/** Totales de un libro: sin anulados/error y con las NC restando. */
function sumaLibro(filas, campo) {
  return (filas || [])
    .filter((d) => !['ANULADO', 'ERROR'].includes(d.estado))
    .reduce((acc, d) => acc + signoDoc(d) * (d[campo] || 0), 0)
}

VIEWS.libros = {
  titulo: 'Libros Compras y Ventas',
  async render(cont) {
    const periodo = window._librosPeriodo || periodoGlobal()
    const tab = window._librosTab || 'compra'
    const puedeIngestar = tiene('documentos:ingestar')

    cont.innerHTML = `
     <div class="frm-row mb pg-toolbar">
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
      const p = leerPeriodo('lb-periodo') || periodo
      aplicarPeriodoGlobal(p)
      escribirHash(location.hash)
      sincronizarSelectorPeriodo(p)
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
    const s = (r, campo) => sumaLibro(r.documentos, campo)
    // El resumen se calcula sobre lo CARGADO (tope 1000 del endpoint): si el
    // período tiene más, se dice — un total silenciosamente corto es peor que
    // uno declarado.
    const cargados = [c, v].map((r) => (r.documentos || []).length)
    const declarados = [c, v].map((r) => Number(r.total) || (r.documentos || []).length)
    const truncado = declarados.some((n, i) => n > cargados[i])
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
     </div>
     ${truncado ? `<p class="hint mt">El período tiene más documentos que los ${Math.max(...cargados)} cargados: el resumen suma solo esos. Acota el período o revisa la Bandeja para el total del servidor.</p>` : ''}
     <p class="hint mt">Los montos excluyen documentos anulados o con error y restan las notas de crédito (tipos 60 y 61), igual que el F29.</p>`
    return
  }

  const r = await apiGet(`/api/contable/empresas/${eid}/documentos?periodo=${periodo}&tipo_flujo=${tab}&limit=1000`)
  const docs = r.documentos || []

  body.innerHTML = `
   <div id="lb-tabla"></div>
   ${(r.total || 0) > docs.length ? `<p class="hint mt">El período tiene ${r.total} documentos; se cargaron los primeros ${docs.length}. Refina por texto en la sección Documentos.</p>` : ''}`

  UITabla.montar({
    mount: document.getElementById('lb-tabla'),
    // B3 (masterplan unificación): el libro agrupa por tipo de documento con
    // subtotal por grupo y congela la fecha — capacidades del datagrid
    // integradas en UITabla.
    congelar: true,
    agrupar: {
      key: 'tipo_doc',
      label: 'tipo de documento',
      nombreGrupo: (v) => NOMBRES_TIPO_DOC[v] || `Tipo ${v}`,
      subtotal: (fs) => `neto ${fmtM(fs.reduce((a, d) => a + (d.monto_neto || 0), 0))} · IVA ${fmtM(fs.reduce((a, d) => a + (d.monto_iva || 0), 0))} · total ${fmtM(fs.reduce((a, d) => a + (d.monto_total || 0), 0))}`,
    },
    agrupadoPorDefecto: true,
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
    totalesHTML: (filas) => {
      const incluidos = filas.filter((d) => !['ANULADO', 'ERROR'].includes(d.estado)).length
      return `<tr>
      <td colspan="5">Totales del libro (${incluidos} docs · sin anulados · NC restan) · período completo: ${fmtM(r.sumas?.total)}</td>
      <td class="num">${fmtM(sumaLibro(filas, 'monto_exento'))}</td>
      <td class="num">${fmtM(sumaLibro(filas, 'monto_neto'))}</td>
      <td class="num">${fmtM(sumaLibro(filas, 'monto_iva'))}</td>
      <td class="num">${fmtM(sumaLibro(filas, 'monto_total'))}</td><td></td>
    </tr>`
    },
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

/* ------------------------- Bandeja de Documentos ------------------------- */

const DOC_POR_PAGINA = 50
const DOC_LIMITE_EXPORT = 1000
// El backend usa REVISION (sin tilde) — core/documentos.js. El filtro con
// "REVISIÓN" no calzaba con ningún documento: mostraba 0 y dejaba esos
// documentos sin chip propio. La etiqueta visible sigue siendo "Revisión".
const DOC_ADMITEN_CLASIFICACION = ['PENDIENTE', 'CLASIFICADO', 'REVISION']
const DOC_ESTADOS_CHIP = [
  { v: 'PENDIENTE', t: 'Pendientes' },
  { v: 'CLASIFICADO', t: 'Clasificados' },
  // PROPUESTO lo escribe el motor de propuestas (core/propuestas.js); sin chip
  // propio solo se podía ver entrando a "Todos" y el conteo quedaba escondido.
  { v: 'PROPUESTO', t: 'Propuestos' },
  { v: 'CONTABILIZADO', t: 'Contabilizados' },
  { v: 'REVISION', t: 'Revisión' },
  { v: 'ANULADO', t: 'Anulados' },
  { v: '', t: 'Todos' },
]
const DOC_TRATAMIENTOS = {
  credito: 'Crédito fiscal (recuperable)',
  debito: 'Débito fiscal',
  exento: 'Exento / sin IVA',
  comun: 'Uso común (sin crédito)',
  no_recuperable: 'No recuperable (gasto total)',
}
// Columnas exportables (sin la columna de acciones, que es solo de pantalla).
const DOC_COLUMNAS = [
  { key: 'tipo_doc', label: 'Doc', valor: (d) => `${d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'} ${NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc}` },
  { key: 'folio', label: 'Folio' },
  { key: 'fecha_docto', label: 'Fecha', valor: (d) => (d.fecha_docto || '').slice(0, 10) },
  { key: 'razon_social', label: 'Contraparte' },
  { key: 'rut_contraparte', label: 'RUT', valor: (d) => formatRut(d.rut_contraparte) },
  { key: 'monto_neto', label: 'Neto', num: true, valor: (d) => fmtM(d.monto_neto), crudo: (d) => d.monto_neto },
  { key: 'monto_iva', label: 'IVA', num: true, valor: (d) => fmtM(d.monto_iva), crudo: (d) => d.monto_iva },
  { key: 'monto_total', label: 'Total', num: true, valor: (d) => fmtM(d.monto_total), crudo: (d) => d.monto_total },
  { key: 'estado', label: 'Estado', orden: false },
  { key: 'cuenta', label: 'Cuenta', orden: false, valor: (d) => (d.cuenta_codigo ? `${d.cuenta_codigo} ${d.cuenta_nombre || ''}`.trim() : '—') },
]

/** Etiqueta legible de la columna de orden (la key del backend no va al usuario). */
function docEtiquetaOrden(clave) {
  return (DOC_COLUMNAS.find((c) => c.key === clave) || {}).label || clave
}

function docEstadoCanonico(estado) {
  const v = String(estado ?? '')
  return v === 'REVISIÓN' ? 'REVISION' : v
}

/** Filtros desde la URL (compartible/atrás) con `_docFiltros` como respaldo. */
function docFiltrosDeURL() {
  let q = new URLSearchParams()
  try { q = new URLSearchParams(location.hash.split('?')[1] || '') } catch { /* hash raro */ }
  const previo = window._docFiltros || {}
  // Si la URL trae alguna de nuestras claves, DESCRIBE el filtro completo y
  // manda ella: una clave ausente vale vacío. Colgar del `_docFiltros` viejo
  // (Atrás del navegador) reescribiría la entrada de historial con el filtro
  // que se acaba de abandonar. El respaldo aplica solo a `#documentos` pelado.
  const CLAVES_URL = ['estado', 'flujo', 'tipo', 'cuenta', 'texto', 'rut', 'orden', 'dir', 'p']
  const describe = CLAVES_URL.some((k) => q.has(k))
  const dato = (k, base = '') => (describe ? (q.get(k) ?? base) : (previo[k] ?? base))
  return {
    estado: docEstadoCanonico(describe ? (q.get('estado') ?? 'PENDIENTE') : (previo.estado ?? 'PENDIENTE')),
    flujo: dato('flujo'),
    tipo: dato('tipo'),
    cuenta: dato('cuenta'),
    texto: dato('texto'),
    rut: dato('rut'),
    // Orden de servidor (columna + sentido): vacío = orden por id descendente.
    // Una columna que no existe en la tabla se descarta (la URL es libre).
    orden: DOC_COLUMNAS.some((c) => c.key === dato('orden') && c.orden !== false) ? dato('orden') : '',
    dir: dato('dir') === 'asc' ? 'asc' : (dato('dir') === 'desc' ? 'desc' : ''),
    pagina: (() => {
      // ?p=abc no debe dejar la página en NaN (fetch con offset "NaN").
      const n = Number(q.get('p') || 1)
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
    })(),
  }
}

function docHash(f) {
  const q = new URLSearchParams()
  // `estado` va SIEMPRE (aunque esté vacío = Todos): si se omitiera, volver a
  // la vista o recargar caería otra vez en PENDIENTE y se perdería el filtro.
  q.set('estado', f.estado)
  if (f.flujo) q.set('flujo', f.flujo)
  if (f.tipo) q.set('tipo', f.tipo)
  if (f.cuenta) q.set('cuenta', f.cuenta)
  if (f.texto) q.set('texto', f.texto)
  if (f.rut) q.set('rut', f.rut)
  if (f.orden) { q.set('orden', f.orden); q.set('dir', f.dir || 'asc') }
  if (f.pagina > 1) q.set('p', String(f.pagina))
  // `conContexto` (app.js) suma empresa y período: reescribir el hash con los
  // filtros NO debe borrar el contexto de la sesión ni el de un enlace
  // compartido.
  return conContexto(`#documentos?${q.toString()}`)
}

/**
 * Sincroniza la URL con los filtros. `pushState` no dispara hashchange, así
 * que no re-renderiza ni roba el foco; crea una entrada de historial para los
 * cambios discretos (chip, select, orden, página) y así el botón Atrás/Adelante
 * del navegador restaura el filtro anterior. El texto/RUT, que cambia en cada
 * pulsación, solo reemplaza la entrada (no inunda el historial).
 */
function docSincronizarURL(f, { historial = false } = {}) {
  const hash = docHash(f)
  if (location.hash === hash) return
  try {
    if (historial) history.pushState(null, '', hash)
    else history.replaceState(null, '', hash)
  } catch { location.hash = hash }
}

/** Parámetros reales del endpoint GET /documentos (los que ya soporta). */
function docParametros(f, { limit = DOC_POR_PAGINA, offset = (Math.max(1, f.pagina) - 1) * DOC_POR_PAGINA } = {}) {
  const qs = new URLSearchParams({ periodo: periodoGlobal(), limit: String(limit), offset: String(offset) })
  if (f.estado) qs.set('estado', f.estado)
  if (f.flujo) qs.set('tipo_flujo', f.flujo)
  if (f.tipo) qs.set('tipo_doc', f.tipo)
  if (f.cuenta) qs.set('cuenta_id', f.cuenta)
  if (f.texto) qs.set('texto', f.texto)
  if (f.rut) qs.set('rut', f.rut)
  if (f.orden) { qs.set('orden', f.orden); qs.set('dir', f.dir || 'asc') }
  return qs
}

function docDescripcionFiltros(f) {
  const partes = []
  const chip = DOC_ESTADOS_CHIP.find((e) => e.v === f.estado)
  partes.push(chip ? chip.t : (f.estado || 'Todos'))
  if (f.flujo) partes.push(f.flujo === 'compra' ? 'Compras' : 'Ventas')
  if (f.tipo) partes.push(NOMBRES_TIPO_DOC[f.tipo] || `Tipo ${f.tipo}`)
  if (f.texto) partes.push(`texto «${f.texto}»`)
  if (f.rut) partes.push(`RUT ${f.rut}`)
  return partes.join(' · ')
}

function docSkeletonHTML() {
  const celda = '<td><span class="doc-skel"></span></td>'
  // Una celda por columna de la tabla real (DOC_COLUMNAS + acciones).
  return `<div class="tbl-wrap"><table class="tbl" aria-hidden="true"><tbody>${`<tr>${celda.repeat(DOC_COLUMNAS.length + 1)}</tr>`.repeat(8)}</tbody></table></div>`
}

function docFilaDato(etiqueta, valorHTML) {
  return `<div class="doc-dato"><dt>${esc(etiqueta)}</dt><dd>${valorHTML}</dd></div>`
}

function docCopiar(texto) {
  if (!texto) return
  const listo = () => showToast('Copiado al portapapeles', 'success')
  const fallo = () => showToast('No se pudo copiar', 'error')
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(String(texto)).then(listo).catch(fallo)
  else fallo()
}

function docCerrarMenu() {
  document.getElementById('doc-menu-back')?.remove()
}

/**
 * Menú flotante de acciones. Vive en <body> con position:fixed para que el
 * scroll horizontal de `.tbl-wrap` no lo recorte.
 */
function docAbrirMenu(ancla, etiqueta, items) {
  docCerrarMenu()
  const back = document.createElement('div')
  back.className = 'doc-menu-back'
  back.id = 'doc-menu-back'
  back.innerHTML = `<div class="doc-menu" role="menu" aria-label="${esc(etiqueta)}">${items.map((it, i) =>
    `<button type="button" class="doc-menu-item${it.peligro ? ' peligro' : ''}" role="menuitem" data-i="${i}">${esc(it.label)}</button>`).join('')}</div>`
  document.body.appendChild(back)
  const menu = back.querySelector('.doc-menu')
  const rect = ancla.getBoundingClientRect?.() || { bottom: 0, left: 0 }
  const alto = menu.offsetHeight || (items.length * 36 + 12)
  const anchoVista = window.innerWidth || 1280
  const altoVista = window.innerHeight || 800
  menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, altoVista - alto - 8))}px`
  menu.style.left = `${Math.max(8, Math.min(rect.left, anchoVista - 288))}px`
  ancla.setAttribute?.('aria-expanded', 'true')

  const cerrar = () => {
    ancla.setAttribute?.('aria-expanded', 'false')
    back.remove()
    document.removeEventListener('keydown', onKey)
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); ancla.focus?.() }
  }
  const botones = [...menu.querySelectorAll('.doc-menu-item')]
  botones.forEach((b, i) => b.addEventListener('click', () => { cerrar(); items[i].onClick() }))
  back.addEventListener('click', (e) => { if (e.target === back) cerrar() })
  document.addEventListener('keydown', onKey)
  botones[0]?.focus()
  return cerrar
}

/** Acciones del documento en la fila (solo las que el backend aceptaría). */
function docMenuFila(ancla, d) {
  const puede = tiene('documentos:clasificar')
  const items = [{ label: 'Ver detalle', onClick: () => abrirDetalleDocumento(d.id, ancla) }]
  if (puede && DOC_ADMITEN_CLASIFICACION.includes(d.estado)) {
    items.push({ label: 'Clasificar…', onClick: () => modalClasificar(d.id) })
  }
  if (puede && !['CONTABILIZADO', 'ANULADO'].includes(d.estado)) {
    items.push({ label: 'Anular documento…', peligro: true, onClick: () => modalAnular(d) })
  }
  items.push({ label: 'Copiar folio', onClick: () => docCopiar(d.folio) })
  items.push({ label: 'Copiar RUT', onClick: () => docCopiar(formatRut(d.rut_contraparte)) })
  docAbrirMenu(ancla, `Acciones del documento ${d.folio}`, items)
}

function docFilaHTML(d, hl) {
  const tipo = NOMBRES_TIPO_DOC[d.tipo_doc] || d.tipo_doc
  const flujo = d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'
  const cuenta = d.cuenta_codigo ? `${d.cuenta_codigo} ${d.cuenta_nombre || ''}`.trim() : '—'
  const clasificable = tiene('documentos:clasificar') && DOC_ADMITEN_CLASIFICACION.includes(d.estado)
  const contraparte = d.razon_social || d.rut_contraparte || '—'
  return `<tr tabindex="0" data-doc="${Number(d.id)}">
    <td class="sub doc-tipo-cel" title="${esc(`${flujo} ${tipo}`)}">${hl(`${flujo} ${tipo}`)}</td>
    <td class="mono">${hl(d.folio)}</td>
    <td class="sub">${hl((d.fecha_docto || '—').slice(0, 10))}</td>
    <td class="doc-contra-cel" title="${esc(contraparte)}">${hl(contraparte)}</td>
    <td class="mono doc-rut-cel">${hl(formatRut(d.rut_contraparte) || '—')}</td>
    <td class="num">${fmtM(d.monto_neto)}</td>
    <td class="num">${fmtM(d.monto_iva)}</td>
    <td class="num"><b>${fmtM(d.monto_total)}</b></td>
    <td>${chipEstado(d.estado)}</td>
    <td class="sub doc-cuenta-cel" title="${esc(cuenta)}">${hl(cuenta.slice(0, 22))}</td>
    <td class="doc-acciones">
      ${clasificable ? `<button class="btn btn-secondary btn-sm" type="button" data-clas="${Number(d.id)}">Clasificar</button>` : ''}
      <button class="btn btn-secondary btn-sm" type="button" data-menu="${Number(d.id)}" aria-haspopup="menu" aria-expanded="false" aria-label="Más acciones para el folio ${esc(d.folio)}">⋮</button>
    </td>
  </tr>`
}

/**
 * Estado vacío de la tabla. `sinDocsEnPeriodo` usa los conteos del servidor
 * (que ignoran el filtro de estado) para distinguir un período SIN documentos
 * de un filtro sin resultados: con el chip por defecto PENDIENTE, ambos casos
 * devuelven 0 filas y antes se mostraba siempre "no coincide con los filtros".
 */
function docVacioHTML(sinDocsEnPeriodo, soloBusqueda = false) {
  const ui = window.UIEstado
  if (sinDocsEnPeriodo) {
    const accion = tiene('documentos:ingestar') ? '<a class="btn btn-primary btn-sm" href="#libros">Ir a Libros a sincronizar</a>' : ''
    return ui ? ui.vacio(`Aún no hay documentos en ${perDisplay(periodoGlobal())}`, 'El período está vacío: sincroniza el RCV desde Libros para traer compras y ventas.', accion)
      : '<div class="empty">Sin documentos en el período.</div>'
  }
  // La búsqueda sin resultados no es lo mismo que un filtro sin coincidencias:
  // el usuario necesita saber que el término es lo que no calzó.
  if (soloBusqueda) {
    return ui ? ui.vacio('La búsqueda no encontró documentos', 'Se busca por razón social y folio; el RUT contraparte tiene su propio campo. Revisa el término o límpialo.',
      '<button class="btn btn-secondary btn-sm" type="button" id="doc-vacio-limpiar">Limpiar búsqueda</button>')
      : '<div class="empty">La búsqueda no encontró documentos.</div>'
  }
  return ui ? ui.vacio('Ningún documento coincide con estos filtros', 'Prueba con otro estado, flujo o término de búsqueda.',
    '<button class="btn btn-secondary btn-sm" type="button" id="doc-vacio-limpiar">Limpiar filtros</button>')
    : '<div class="empty">Sin resultados.</div>'
}

/** Última apertura pedida: si el usuario abre otro documento mientras el
 *  anterior viaja, la respuesta vieja no debe pintarse encima de la nueva. */
let docDetalleSeq = 0

async function abrirDetalleDocumento(docId, disparador) {
  const mio = ++docDetalleSeq
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos/${docId}`)
    if (mio !== docDetalleSeq) return
    if (!r || !r.documento) return showToast('Documento no encontrado', 'error')
    docAbrirDrawer(r.documento, disparador)
  } catch (err) {
    if (mio === docDetalleSeq) showToast(err.message, 'error')
  }
}

/** Panel lateral de detalle: lectura + las acciones que correspondan. */
function docAbrirDrawer(d, disparador) {
  // Un solo panel a la vez: evita IDs duplicados si se abre otro documento
  // mientras el anterior sigue montado.
  document.getElementById('doc-drawer-back')?.remove()
  const previo = disparador || (typeof document !== 'undefined' ? document.activeElement : null)
  const tipo = NOMBRES_TIPO_DOC[d.tipo_doc] || `Tipo ${d.tipo_doc}`
  const flujo = d.tipo_flujo === 'compra' ? 'Compra' : 'Venta'
  const cuenta = d.cuenta_codigo ? `${d.cuenta_codigo} — ${d.cuenta_nombre || ''}` : '—'
  const cc = d.cc_codigo ? `${d.cc_codigo} — ${d.cc_nombre || ''}` : '—'
  const asiento = d.asiento_id ? `Folio ${d.asiento_folio ?? '—'} · ${d.asiento_anio ?? '—'}` : 'Sin asiento vinculado'

  let detalle = '<p class="muted">Sin detalle SII registrado.</p>'
  if (d.detalle_sii_json) {
    try {
      const obj = JSON.parse(d.detalle_sii_json)
      const pares = Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')
      if (pares.length) {
        detalle = `<dl class="doc-dl">${pares.slice(0, 24).map(([k, v]) =>
          docFilaDato(k, esc(typeof v === 'object' ? JSON.stringify(v) : v))).join('')}</dl>`
          + (pares.length > 24 ? `<p class="hint">Se muestran 24 de ${pares.length} campos del SII.</p>` : '')
      }
    } catch {
      detalle = `<pre class="doc-json">${esc(String(d.detalle_sii_json).slice(0, 800))}</pre>`
    }
  }

  const acciones = []
  if (tiene('documentos:clasificar') && DOC_ADMITEN_CLASIFICACION.includes(d.estado)) {
    acciones.push('<button class="btn btn-primary btn-sm" type="button" id="doc-det-clas">Clasificar</button>')
  }
  if (tiene('documentos:clasificar') && !['CONTABILIZADO', 'ANULADO'].includes(d.estado)) {
    acciones.push('<button class="btn btn-secondary btn-sm" type="button" id="doc-det-anular">Anular…</button>')
  }

  const back = document.createElement('div')
  back.className = 'doc-drawer-back'
  back.id = 'doc-drawer-back'
  back.innerHTML = `<aside class="doc-drawer" role="dialog" aria-modal="true" aria-labelledby="doc-det-t">
    <div class="doc-drawer-head">
      <div>
        <p class="doc-drawer-kicker">${esc(flujo)} · ${esc(tipo)}</p>
        <h2 id="doc-det-t">Folio ${esc(d.folio)}</h2>
        <p class="muted">${esc(d.razon_social || d.rut_contraparte || 'Sin contraparte')} · ${esc(formatRut(d.rut_contraparte) || '—')}</p>
      </div>
      <div class="flex">${chipEstado(d.estado)}<button class="btn btn-secondary btn-sm" type="button" id="doc-det-cerrar" aria-label="Cerrar detalle">Cerrar</button></div>
    </div>
    <div class="doc-drawer-body">
      <h3>Montos</h3>
      <dl class="doc-dl doc-montos">
        ${docFilaDato('Exento', `<span class="mono">${fmtM(d.monto_exento)}</span>`)}
        ${docFilaDato('Neto', `<span class="mono">${fmtM(d.monto_neto)}</span>`)}
        ${docFilaDato('IVA', `<span class="mono">${fmtM(d.monto_iva)}</span>`)}
        ${docFilaDato('Total', `<b class="mono">${fmtM(d.monto_total)}</b>`)}
      </dl>
      <h3>Documento</h3>
      <dl class="doc-dl">
        ${docFilaDato('Fecha del documento', esc((d.fecha_docto || '—').slice(0, 10)))}
        ${d.fecha_reclamo ? docFilaDato('Fecha de reclamo', esc(String(d.fecha_reclamo).slice(0, 10))) : ''}
        ${docFilaDato('Período de ingesta', esc(perDisplay(d.periodo_ingesta) || '—'))}
        ${docFilaDato('Origen', esc(d.origen || '—'))}
      </dl>
      <h3>Clasificación</h3>
      <dl class="doc-dl">
        ${docFilaDato('Cuenta', esc(cuenta))}
        ${docFilaDato('Centro de costo', esc(cc))}
        ${docFilaDato('Tratamiento IVA', esc(DOC_TRATAMIENTOS[d.tratamiento_iva] || d.tratamiento_iva || '—'))}
        ${docFilaDato('Regla aplicada', esc(d.regla_nombre || 'Manual / sin regla'))}
      </dl>
      <h3>Contabilidad</h3>
      <dl class="doc-dl">${docFilaDato('Asiento', esc(asiento))}</dl>
      <h3>Detalle SII</h3>
      ${detalle}
    </div>
    <div class="doc-drawer-foot">
      ${acciones.join('')}<span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" type="button" id="doc-det-cerrar-2">Cerrar</button>
    </div>
  </aside>`
  document.body.appendChild(back)

  const cerrar = () => {
    back.remove()
    document.removeEventListener('keydown', onKey)
    window.removeEventListener?.('hashchange', cerrar)
    previo?.focus?.()
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return }
    if (e.key !== 'Tab') return
    const focos = [...back.querySelectorAll('button, [href], input, select, textarea')].filter((x) => !x.disabled)
    if (!focos.length) return
    const i = focos.indexOf(document.activeElement)
    if (e.shiftKey && i <= 0) { e.preventDefault(); focos[focos.length - 1].focus() }
    else if (!e.shiftKey && (i === -1 || i === focos.length - 1)) { e.preventDefault(); focos[0].focus() }
  }
  document.addEventListener('keydown', onKey)
  // Navegar a otra vista cierra el panel (vive en <body>, fuera del shell).
  window.addEventListener?.('hashchange', cerrar, { once: true })
  back.addEventListener('click', (e) => { if (e.target === back) cerrar() })
  document.getElementById('doc-det-cerrar')?.addEventListener('click', cerrar)
  document.getElementById('doc-det-cerrar-2')?.addEventListener('click', cerrar)
  document.getElementById('doc-det-clas')?.addEventListener('click', () => { cerrar(); modalClasificar(d.id) })
  document.getElementById('doc-det-anular')?.addEventListener('click', () => { cerrar(); modalAnular(d) })
  document.getElementById('doc-det-cerrar')?.focus()
}

/** Anulación: motivo obligatorio + confirmación explícita (backend lo exige). */
function modalAnular(d) {
  const tipo = NOMBRES_TIPO_DOC[d.tipo_doc] || `Tipo ${d.tipo_doc}`
  openModal(`
    <h3>Anular documento</h3>
    <p class="sub">${esc(d.tipo_flujo === 'compra' ? 'Compra' : 'Venta')} ${esc(tipo)} folio ${esc(d.folio)} · ${esc(d.razon_social || d.rut_contraparte || '')} · ${fmtM(d.monto_total)}</p>
    <div class="form-group">
      <label class="form-label" for="an-motivo">Motivo de la anulación (obligatorio)</label>
      <textarea id="an-motivo" class="form-input" rows="3" maxlength="500" placeholder="Ej.: documento duplicado en el RCV"></textarea>
      <small class="hint">Queda auditado con tu usuario y no se puede deshacer.</small>
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-danger" id="an-ok" disabled>Anular documento</button>
    </div>`)
  const motivo = document.getElementById('an-motivo')
  const ok = document.getElementById('an-ok')
  if (!motivo || !ok) return
  motivo.addEventListener('input', () => { ok.disabled = !motivo.value.trim() })
  motivo.focus()
  ok.addEventListener('click', async () => {
    ok.disabled = true
    try {
      await apiPost(`/api/contable/empresas/${S.empresa.id}/documentos/${d.id}/anular`, { motivo: motivo.value.trim() })
      cerrarModal()
      showToast('Documento anulado', 'success')
      refrescarPillDocs()
      renderRoute()
    } catch (err) {
      ok.disabled = false
      showToast(err.message, 'error')
    }
  })
}

/** Clasificación automática: empresa, período y alcance ANTES de ejecutar. */
async function modalAutoClasificar(f) {
  const periodo = periodoGlobal()
  let alcance = null
  try {
    const qs = new URLSearchParams({ periodo, limit: '1' })
    if (f.flujo) qs.set('tipo_flujo', f.flujo)
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos?${qs}`)
    const m = Object.fromEntries((r.estados || []).map((e) => [e.estado, Number(e.n) || 0]))
    // Mismo universo que evalúa el endpoint: PENDIENTE + REVISION del período.
    alcance = (m.PENDIENTE || 0) + (m.REVISION || 0)
  } catch { alcance = null }

  openModal(`
    <h3>Clasificar automáticamente</h3>
    <p class="sub">Revisa el alcance antes de ejecutar. Se aplican las reglas contables vigentes y no se pisa una clasificación manual.</p>
    <dl class="doc-dl">
      ${docFilaDato('Empresa', esc(S.empresa.nombre))}
      ${docFilaDato('Período', esc(perDisplay(periodo)))}
      ${docFilaDato('Flujo', esc(f.flujo ? (f.flujo === 'compra' ? 'Solo compras' : 'Solo ventas') : 'Compras y ventas'))}
      ${docFilaDato('Documentos a evaluar', alcance === null ? '—' : `<b class="mono">${alcance}</b> (PENDIENTE + REVISIÓN)`)}
    </dl>
    <p class="hint">Los documentos sin regla que calce quedan como están y se informan al final.</p>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" id="doc-auto-ok"${alcance === 0 ? ' disabled' : ''}>Clasificar${alcance ? ` ${alcance}` : ''}</button>
    </div>`)

  document.getElementById('doc-auto-ok')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    try {
      const res = await apiPost(`/api/contable/empresas/${S.empresa.id}/documentos/clasificar-automatico`, {
        periodo,
        tipo_flujo: f.flujo || null,
      })
      const sinRegla = (res.sin_regla || []).length
      showToast(`Clasificación automática: ${res.clasificados ?? 0} de ${res.evaluados ?? 0} documento(s)${sinRegla ? ` · ${sinRegla} sin regla` : ''}`, 'success')
      cerrarModal()
      refrescarPillDocs()
      renderRoute()
    } catch (err) {
      btn.disabled = false
      showToast(err.message, 'error')
    }
  })
}

/** Exportación del FILTRO COMPLETO (hasta el tope real del endpoint). */
async function modalExportar(f) {
  const periodo = periodoGlobal()
  let r
  try {
    r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos?${docParametros(f, { limit: DOC_LIMITE_EXPORT, offset: 0 })}`)
  } catch (err) { return showToast(err.message, 'error') }

  const total = Number(r.total) || 0
  const filas = Array.isArray(r.documentos) ? r.documentos : []
  const truncado = total > filas.length
  const nombre = `documentos-${periodo}-${f.estado || 'todos'}`

  openModal(`
    <h3>Exportar documentos</h3>
    <p class="sub">${esc(perDisplay(periodo))} · ${esc(docDescripcionFiltros(f))}</p>
    <p>El filtro tiene <b class="mono">${total}</b> documento(s). ${truncado
      ? `El servidor entrega hasta <b>${DOC_LIMITE_EXPORT}</b>: el archivo incluirá los <b>primeros ${filas.length}</b>, no el total. Para el resto, acota por período, flujo o estado.`
      : `Se exportarán los <b>${filas.length}</b> documentos del filtro.`}</p>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-secondary" id="doc-exp-xls"${filas.length ? '' : ' disabled'}>Excel</button>
      <button class="btn btn-primary" id="doc-exp-csv"${filas.length ? '' : ' disabled'}>Exportar CSV</button>
    </div>`)

  let aviso = false
  for (const [id, formato] of [['doc-exp-csv', 'csv'], ['doc-exp-xls', 'xls']]) {
    document.getElementById(id)?.addEventListener('click', () => {
      UITabla.exportar({ columnas: DOC_COLUMNAS, filas, nombre, formato })
      cerrarModal()
      if (!aviso) {
        aviso = true
        showToast(truncado ? `${filas.length} de ${total} documento(s) exportados (tope ${DOC_LIMITE_EXPORT})` : `${filas.length} documento(s) exportados`, 'success')
      }
    })
  }
}

VIEWS.documentos = {
  titulo: 'Bandeja de Documentos',
  async render(cont) {
    const eid = S.empresa.id
    const f = docFiltrosDeURL()
    window._docFiltros = { ...f }
    // La entrada de historial actual debe describir el filtro completo: si
    // entramos con #documentos pelado, Atrás no tendría a qué volver.
    docSincronizarURL(f)
    const puedeClasificar = tiene('documentos:clasificar')
    const periodo = periodoGlobal()
    let porId = new Map()
    let seq = 0

    cont.innerHTML = `
     <p class="pg-flow"><b>Flujo:</b> Bandeja → <a href="#libros">Libros</a> → <a href="#propuestas">Propuestas</a> → <a href="#automatizacion">Contabilizar</a></p>

     <div class="doc-toolbar">
       ${puedeClasificar ? '<button class="btn btn-primary btn-sm" id="doc-auto" type="button">Clasificar automático</button>' : ''}
       ${tiene('reglas:ver') ? '<button class="btn btn-secondary btn-sm" id="doc-reglas" type="button">Reglas</button>' : ''}
       <button class="btn btn-secondary btn-sm" id="doc-mas" type="button" aria-haspopup="menu" aria-expanded="false">Más acciones</button>
       <span class="spacer"></span>
       <span class="doc-nota">${puedeClasificar ? 'Clasificar y anular exigen permiso de escritura.' : 'Tu rol es de solo lectura en esta bandeja.'}</span>
     </div>

     <div class="doc-estados" id="doc-estados" role="group" aria-label="Filtrar por estado">
       ${DOC_ESTADOS_CHIP.map((e) =>
         `<button class="btn btn-secondary btn-sm" type="button" data-est="${e.v}" aria-pressed="false">${e.t} <b class="mono doc-chip-n" data-n="${e.v}">—</b></button>`).join('')}
     </div>

     <div class="doc-filtros">
       <div class="doc-f">
         <label class="frm-label" for="doc-flujo">Flujo</label>
         <select id="doc-flujo" class="form-input">
           <option value="">Compras y ventas</option>
           <option value="compra">Compras</option>
           <option value="venta">Ventas</option>
         </select>
       </div>
       <div class="doc-f">
         <label class="frm-label" for="doc-tipo">Tipo de documento</label>
         <select id="doc-tipo" class="form-input">
           <option value="">Todos</option>
           ${Object.entries(NOMBRES_TIPO_DOC).sort((a, b) => Number(a[0]) - Number(b[0]))
             .map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}
         </select>
       </div>
       ${tiene('cuentas:ver') ? `<div class="doc-f">
         <label class="frm-label" for="doc-cuenta">Cuenta contable</label>
         <select id="doc-cuenta" class="form-input"><option value="">Todas</option></select>
       </div>` : ''}
       <div class="doc-f doc-f-busca">
         <label class="frm-label" for="doc-buscar">Buscar</label>
         <input id="doc-buscar" class="form-input" type="search" placeholder="Razón social o folio" value="${esc(f.texto)}">
       </div>
       <div class="doc-f doc-f-rut">
         <label class="frm-label" for="doc-rut">RUT contraparte</label>
         <input id="doc-rut" class="form-input" type="text" inputmode="numeric" placeholder="12345678-9" value="${esc(f.rut)}">
       </div>
       <button class="btn btn-secondary btn-sm" id="doc-limpiar" type="button">Limpiar filtros</button>
     </div>

     <p class="doc-resumen" id="doc-resumen" role="status" aria-live="polite">Cargando documentos…</p>
     <div id="doc-tabla" aria-busy="true">${docSkeletonHTML()}</div>`

    const setValor = (id, v) => { const el = document.getElementById(id); if (el) el.value = v }
    setValor('doc-flujo', f.flujo)
    setValor('doc-tipo', f.tipo)
    setValor('doc-buscar', f.texto)
    setValor('doc-rut', f.rut)

    function pintarChips() {
      document.querySelectorAll('[data-est]').forEach((b) => {
        const on = docEstadoCanonico(b.dataset.est) === f.estado
        b.classList.toggle('btn-on', on)
        b.setAttribute?.('aria-pressed', on ? 'true' : 'false')
      })
    }

    function pintarConteos(r) {
      const m = Object.fromEntries((r.estados || []).map((e) => [e.estado, Number(e.n) || 0]))
      // El backend calcula `estados` SIN el filtro de estado: los conteos de
      // cada chip (y "Todos") son comparables entre sí.
      const conEstado = Object.values(m).reduce((a, b) => a + b, 0)
      document.querySelectorAll('.doc-chip-n').forEach((n) => {
        const clave = docEstadoCanonico(n.dataset.n)
        n.textContent = String(clave === '' ? (conEstado || Number(r.total) || 0) : (m[clave] ?? 0))
      })
    }

    function pintarResumen(el, total, sumas, mostradas) {
      const s = sumas || {}
      el.innerHTML = `<b>${total}</b> documento(s) en <b>${esc(perDisplay(periodoGlobal()))}</b>`
        + ` · neto <b class="mono">${fmtM(s.neto)}</b>`
        + ` · IVA <b class="mono">${fmtM(s.iva)}</b>`
        + ` · total <b class="mono">${fmtM(s.total)}</b>`
        // Sin documentos no hay tabla: la nota de totales/orden sobra.
        + (total ? `<span class="doc-resumen-nota">Totales calculados por el servidor sobre el filtro completo${total > mostradas ? ` · la tabla muestra ${mostradas}` : ''} · el orden abarca todo el filtro${f.orden ? ` (${esc(docEtiquetaOrden(f.orden))} ${f.dir === 'desc' ? '↓' : '↑'})` : ''}</span>` : '')
    }

    function montarTabla(mount, total, paginas, filas, sumas) {
      const s = sumas || {}
      UITabla.montar({
        mount,
        congelar: true,
        caption: `Documentos de ${perDisplay(periodo)} — ${total} en el filtro`,
        placeholderBusqueda: 'Filtrar en esta página…',
        columnas: [...DOC_COLUMNAS, { key: 'acciones', label: 'Acciones', orden: false, buscar: false, exportable: false, valor: () => '' }],
        filas,
        nombreArchivo: `documentos-${periodo}-${f.estado || 'todos'}`,
        servidor: {
          total,
          pagina: f.pagina,
          paginas,
          // Orden de SERVIDOR: UITabla no reordena la página, pide otro orden
          // (con el desempate por id de core/documentos.js la paginación es
          // estable, así que aria-sort puede anunciar el orden real).
          orden: f.orden || null,
          dir: f.dir || null,
          onOrden: (k, d) => {
            f.orden = k
            f.dir = d
            f.pagina = 1
            window._docFiltros = { ...f }
            docSincronizarURL(f, { historial: true })
            cargar()
          },
          onPagina: (n) => { f.pagina = n; docSincronizarURL(f, { historial: true }); cargar() },
        },
        vacio: 'Sin documentos en esta página.',
        filaHTML: (d, hl) => docFilaHTML(d, hl),
        // 5 celdas de contexto (Doc…RUT) + neto/IVA/total + 3 de cierre = 11
        // columnas: el pie queda alineado con la cabecera y con cada fila.
        totalesHTML: () => `<tr>
          <td colspan="5">Totales del filtro · <b>${total}</b> documento(s)</td>
          <td class="num">${fmtM(s.neto)}</td>
          <td class="num">${fmtM(s.iva)}</td>
          <td class="num">${fmtM(s.total)}</td>
          <td colspan="3" class="sub">Servidor · las NC restan · no es la suma de esta página</td>
        </tr>`,
      })
    }

    async function cargar() {
      const tablaEl = document.getElementById('doc-tabla')
      const resumen = document.getElementById('doc-resumen')
      if (!tablaEl) return
      const mio = ++seq
      if (!tablaEl.querySelector?.('table')) tablaEl.innerHTML = docSkeletonHTML()
      tablaEl.setAttribute?.('aria-busy', 'true')
      if (resumen) resumen.textContent = 'Actualizando…'
      try {
        const r = await apiGet(`/api/contable/empresas/${eid}/documentos?${docParametros(f)}`)
        if (mio !== seq) return
        const total = Number(r.total) || 0
        const filas = Array.isArray(r.documentos) ? r.documentos : []
        const paginas = Math.max(1, Math.ceil(total / DOC_POR_PAGINA))
        // Si la página pedida quedó fuera de rango (cambió el filtro), volver a la última.
        if (!filas.length && total > 0 && f.pagina > paginas) {
          f.pagina = paginas
          docSincronizarURL(f)
          return cargar()
        }
        porId = new Map(filas.map((d) => [Number(d.id), d]))
        pintarChips()
        pintarConteos(r)
        if (resumen) pintarResumen(resumen, total, r.sumas, filas.length)
        if (!total) {
          // `estados` viene sin el filtro de estado: si además no hay filtros de
          // tabla y suma 0, el período completo está vacío (no es el filtro).
          const filtrosDeTabla = !!(f.flujo || f.tipo || f.cuenta || f.texto || f.rut)
          const soloBusqueda = !!(f.texto || f.rut) && !f.flujo && !f.tipo && !f.cuenta
          const enPeriodo = (r.estados || []).reduce((a, e) => a + (Number(e.n) || 0), 0)
          tablaEl.innerHTML = docVacioHTML(!filtrosDeTabla && enPeriodo === 0, soloBusqueda)
          document.getElementById('doc-vacio-limpiar')?.addEventListener('click', () => document.getElementById('doc-limpiar')?.click())
          return
        }
        montarTabla(tablaEl, total, paginas, filas, r.sumas)
      } catch (err) {
        if (mio !== seq) return
        if (resumen) resumen.textContent = 'No se pudieron cargar los documentos.'
        const reintento = '<button class="btn btn-secondary btn-sm" id="doc-reintentar" type="button">Reintentar</button>'
        tablaEl.innerHTML = window.UIEstado
          ? UIEstado.error(err.message, reintento)
          : `<div class="ui-error"><b>Error</b><p class="muted">${esc(err.message)}</p>${reintento}</div>`
        document.getElementById('doc-reintentar')?.addEventListener('click', () => cargar())
      } finally {
        if (mio === seq) tablaEl.removeAttribute?.('aria-busy')
      }
    }

    // --- filtros ---
    document.querySelectorAll('[data-est]').forEach((b) => b.addEventListener('click', () => {
      f.estado = docEstadoCanonico(b.dataset.est)
      f.pagina = 1
      window._docFiltros = { ...f }
      pintarChips()
      docSincronizarURL(f, { historial: true })
      cargar()
    }))

    const conectarSelect = (id, campo) => document.getElementById(id)?.addEventListener('change', (e) => {
      f[campo] = e.target.value
      f.pagina = 1
      window._docFiltros = { ...f }
      docSincronizarURL(f, { historial: true })
      cargar()
    })
    conectarSelect('doc-flujo', 'flujo')
    conectarSelect('doc-tipo', 'tipo')
    conectarSelect('doc-cuenta', 'cuenta')

    // Búsqueda de servidor con debounce (no re-renderiza: conserva el foco).
    let temporizador = null
    const conectarBusqueda = (id, campo) => document.getElementById(id)?.addEventListener('input', (e) => {
      const valor = e.target.value.trim()
      clearTimeout(temporizador)
      temporizador = setTimeout(() => {
        f[campo] = valor
        f.pagina = 1
        window._docFiltros = { ...f }
        docSincronizarURL(f)
        cargar()
      }, 300)
    })
    conectarBusqueda('doc-buscar', 'texto')
    conectarBusqueda('doc-rut', 'rut')

    document.getElementById('doc-limpiar')?.addEventListener('click', () => {
      Object.assign(f, { estado: '', flujo: '', tipo: '', cuenta: '', texto: '', rut: '', orden: '', dir: '', pagina: 1 })
      window._docFiltros = { ...f }
      for (const [id, v] of [['doc-flujo', ''], ['doc-tipo', ''], ['doc-cuenta', ''], ['doc-buscar', ''], ['doc-rut', '']]) setValor(id, v)
      pintarChips()
      docSincronizarURL(f, { historial: true })
      cargar()
    })

    // --- acciones de la bandeja ---
    document.getElementById('doc-reglas')?.addEventListener('click', modalReglas)
    document.getElementById('doc-auto')?.addEventListener('click', () => modalAutoClasificar(f))
    document.getElementById('doc-mas')?.addEventListener('click', (e) => {
      const items = [
        { label: 'Exportar el filtro completo…', onClick: () => modalExportar(f) },
        ...(tiene('documentos:ingestar') ? [{ label: 'Ingestar documentos (Libros)', onClick: () => { location.hash = '#libros' } }] : []),
        { label: 'Actualizar', onClick: () => cargar() },
      ]
      docAbrirMenu(e.currentTarget, 'Más acciones de la bandeja', items)
    })

    // --- tabla: delegación (UITabla re-renderiza el tbody al ordenar/filtrar) ---
    const tabla = document.getElementById('doc-tabla')
    tabla.addEventListener('click', (e) => {
      const clas = e.target.closest?.('[data-clas]')
      if (clas) { e.stopPropagation(); return modalClasificar(Number(clas.dataset.clas)) }
      const botonMenu = e.target.closest?.('[data-menu]')
      if (botonMenu) {
        e.stopPropagation()
        const d = porId.get(Number(botonMenu.dataset.menu))
        if (d) docMenuFila(botonMenu, d)
        return
      }
      const tr = e.target.closest?.('tr[data-doc]')
      if (tr) abrirDetalleDocumento(Number(tr.dataset.doc), tr)
    })
    tabla.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return
      const tr = e.target.closest?.('tr[data-doc]')
      if (tr && e.target === tr) { e.preventDefault(); abrirDetalleDocumento(Number(tr.dataset.doc), tr) }
    })

    // Cuentas imputables: catálogo ya cacheado por el modal de clasificación.
    pintarChips()

    if (tiene('cuentas:ver')) {
      getCuentasImputables().then((cuentas) => {
        const sel = document.getElementById('doc-cuenta')
        if (!sel || !Array.isArray(cuentas)) return
        sel.innerHTML = '<option value="">Todas</option>'
          + cuentas.map((c) => `<option value="${esc(c.id)}">${esc(c.codigo)} — ${esc(c.nombre)}</option>`).join('')
        sel.value = f.cuenta
      }).catch(() => { document.getElementById('doc-cuenta')?.closest?.('.doc-f')?.remove() })
    }

    await cargar()
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
    const guardar = document.getElementById('cl-save')
    guardar.addEventListener('click', async () => {
      // Doble clic no debe enviar dos clasificaciones.
      guardar.disabled = true
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
      } catch (err) {
        guardar.disabled = false
        showToast(err.message, 'error')
      }
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
