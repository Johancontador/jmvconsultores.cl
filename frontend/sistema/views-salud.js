/**
 * VISTA SALUD TRIBUTARIA — «Consulta Salud Tributaria».
 *
 * Consume GET /api/contable/empresas/:id/salud-tributaria. Todo lo que se
 * muestra viene del backend con su fuente declarada; lo NO integrado (F29
 * oficial, F22, juradas, boletas de honorarios) se pinta como tal y nunca
 * como un cero. La opinión es automatizada y el propio informe lo advierte.
 */

VIEWS.salud = {
  titulo: 'Consulta Salud Tributaria',
  async render(cont) {
    const eid = S.empresa.id
    const periodo = periodoGlobal()
    let inf
    try {
      const r = await apiGet(`/api/contable/empresas/${eid}/salud-tributaria?periodo=${periodo}&meses=60`)
      inf = r.informe
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const op = inf.opinion
    const chipOp = {
      AL_DIA: 'contabilizado', CON_OBSERVACIONES: 'propuesto',
      REQUIERE_REVISION: 'error', SIN_INFORMACION: 'neutral',
    }[op.nivel] || 'neutral'
    const fmtM = (v) => fmt(v || 0)
    const sinDato = '<span class="sub">sin dato</span>'
    const id = inf.identidad
    const puede = tiene('salud:sincronizar')

    const sevChip = (s) => ({ alta: 'error', media: 'propuesto', baja: 'pendiente', info: 'neutral' }[s] || 'neutral')
    const estadoDecl = (d) => d.estado === 'disponible'
      ? `<span class="chip contabilizado" title="${esc(d.detalle)}">Consultado</span>`
      : `<span class="chip neutral" title="${esc(d.detalle)}">No consultado</span>`
    const f29Chip = (m) => {
      if (m.f29_estado === 'declarada') return '<span class="chip contabilizado">Declarada</span>'
      if (m.f29_estado === 'rectificada') return '<span class="chip contabilizado">Rectificada</span>'
      if (m.f29_estado === 'pendiente' || m.f29_estado === 'no_presentada') return '<span class="chip error">Pendiente</span>'
      if (m.f29_estado === 'sin_informacion') return '<span class="chip neutral">S/I</span>'
      return '<span class="sub">—</span>'
    }
    const estadoMes = (m) => {
      if (m.estado === 'con_datos') return '<span class="chip contabilizado">Con RCV</span>'
      if (m.estado === 'sin_movimiento') return '<span class="chip neutral">Sin movimiento</span>'
      return '<span class="chip pendiente">Sin sincronizar</span>'
    }

    const capChip = (e) => ({
      disponible: '<span class="chip contabilizado">Disponible</span>',
      parcial: '<span class="chip propuesto">Parcial</span>',
      no_integrado: '<span class="chip error">No integrado</span>',
    }[e] || '<span class="chip neutral">—</span>')

    const capital = id.capital
      ? `$${Number(id.capital.enterado_miles_clp || 0).toLocaleString('es-CL')} miles enterados · $${Number(id.capital.por_enterar_miles_clp || 0).toLocaleString('es-CL')} miles por enterar`
      : sinDato

    cont.innerHTML = `
     <div class="card" id="sl-top">
       <div class="flex" style="justify-content:space-between;align-items:flex-start;gap:var(--space-3);flex-wrap:wrap">
         <div>
           <span class="sys-kicker">Opinión automatizada · ${esc(perDisplay(inf.periodo))}</span>
           <h2 style="margin:var(--space-1) 0">${esc(op.titulo)} <span class="chip ${chipOp}">${esc(op.nivel.replaceAll('_', ' '))}</span></h2>
           <p class="muted" style="max-width:70ch;margin:0">${esc(op.resumen)}</p>
         </div>
         <div style="text-align:right">
           <div class="kpi ${op.score >= 80 ? 'up' : op.score >= 50 ? '' : 'bad'}" style="min-width:130px">
             <small>Score de salud</small><strong>${op.score}/100</strong>
           </div>
           <div class="flex mt" style="gap:var(--space-2);justify-content:flex-end;flex-wrap:wrap">
             <button class="btn btn-secondary" id="sl-print">Imprimir / PDF</button>
             ${puede ? '<button class="btn btn-primary" id="sl-sync">Sincronizar ficha SII</button>' : ''}
             ${puede ? '<button class="btn btn-secondary" id="sl-sync-rcv">Ficha + RCV del período</button>' : ''}
             ${puede ? '<button class="btn btn-secondary" id="sl-sync-decl">Consultar declaraciones SII (5 años)</button>' : ''}
           </div>
         </div>
       </div>
       <div class="mt" id="sl-aviso"></div>
       <p class="hint mt">Opinión sobre datos verificables. No es certificación tributaria ni asesoría legal personalizada.
         El F29 y las boletas de honorarios se leen del SII al consultar declaraciones; el F22 y las juradas todavía <b>no están conectados</b>
         y se muestran como «no consultado». Abajo se declara qué fuente respalda cada dato.</p>
     </div>

     <div class="grid-2 mt">
       <div class="card">
         <h3>Identificación y actividad</h3>
         <div class="tbl-wrap"><table class="tbl">
           <tbody>
             <tr><th>RUT</th><td class="mono">${esc(formatRut(id.rut))}</td></tr>
             <tr><th>Razón social</th><td>${esc(id.razon_social || '')}</td></tr>
             <tr><th>Tipo</th><td>${esc(id.tipo_contribuyente || '—')}${id.subtipo_contribuyente ? ` · ${esc(id.subtipo_contribuyente)}` : ''}</td></tr>
             <tr><th>Inicio de actividades</th><td>${id.inicio_actividades ? esc(id.inicio_actividades) : sinDato}</td></tr>
             <tr><th>Término de giro</th><td>${id.termino_giro ? `<b style="color:var(--danger)">${esc(id.termino_giro)}</b>` : '<span class="sub">sin término registrado</span>'}</td></tr>
             <tr><th>Actividad económica</th><td>${(id.actividades || []).length ? esc(id.actividades.join(' · ')) : sinDato}</td></tr>
             <tr><th>Dirección</th><td>${id.direccion ? esc(id.direccion) : sinDato}</td></tr>
             <tr><th>Unidad operativa</th><td>${id.unidad_operativa ? esc(`${id.unidad_operativa.descripcion || ''} (${id.unidad_operativa.codigo || 's/c'})`) : sinDato}</td></tr>
             <tr><th>Capital</th><td>${capital}</td></tr>
             <tr><th>Segmento</th><td>${esc(id.segmento || '—')}</td></tr>
             <tr><th>Contacto SII</th><td>${esc(id.email || '')}${id.telefono ? ` · ${esc(id.telefono)}` : ''}${!id.email && !id.telefono ? sinDato : ''}</td></tr>
             <tr><th>Fuente</th><td class="sub">${esc(id.fuente || '')}</td></tr>
           </tbody>
         </table></div>
       </div>

       <div class="card">
         <h3>Régimen y atributos del SII</h3>
         ${id.regimen
           ? `<div class="checkline ok">Régimen vigente: <b>${esc(id.regimen)}</b>${id.regimen_atributo ? ` <span class="sub">(${esc(id.regimen_atributo.codigo)})</span>` : ''}</div>`
           : '<div class="checkline warn">Régimen no determinado en la ficha. Revisa los atributos en el SII.</div>'}
         ${(id.atributos || []).length ? `
           <div class="tbl-wrap mt"><table class="tbl"><thead><tr><th>Código</th><th>Atributo</th><th>Vigencia</th></tr></thead>
           <tbody>${id.atributos.map((a) => `<tr><td class="mono">${esc(a.codigo)}</td><td>${esc(a.descripcion || '')}</td>
             <td class="sub">${esc(a.fechaInicio || '—')}${a.fechaTermino ? ` → ${esc(a.fechaTermino)}` : ''}</td></tr>`).join('')}</tbody></table></div>`
           : '<p class="hint">Sin atributos en la ficha guardada.</p>'}
         ${(id.alertas_sii || []).length ? `
           <h4 class="mt">Alertas del SII (verbatim)</h4>
           ${id.alertas_sii.map((a) => `<div class="checkline warn">${esc(a.descripcion || a.descripcionAlerta || 'Alerta sin descripción')}
             <span class="sub">· código ${esc(a.codigo || 's/c')} · ${esc(a.fechaActiv || 's/f')}</span></div>`).join('')}` : ''}
       </div>
     </div>

     <div class="card mt">
       <h3>Declaraciones</h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Declaración</th><th>Estado de la consulta</th><th>Resultado</th><th>Última consulta</th></tr></thead>
         <tbody>
           <tr><td>Mensual F29</td><td>${estadoDecl(inf.declaraciones.f29)}</td><td class="sub">${esc(inf.declaraciones.f29.detalle)}</td><td class="sub">${esc(inf.declaraciones.f29.ultima_consulta || '—')}</td></tr>
           <tr><td>Renta F22</td><td>${estadoDecl(inf.declaraciones.renta_f22)}</td><td class="sub">${esc(inf.declaraciones.renta_f22.detalle)}</td><td class="sub">${esc(inf.declaraciones.renta_f22.ultima_consulta || '—')}</td></tr>
           <tr><td>Declaraciones juradas</td><td>${estadoDecl(inf.declaraciones.juradas)}</td><td class="sub">${esc(inf.declaraciones.juradas.detalle)}</td><td class="sub">${esc(inf.declaraciones.juradas.ultima_consulta || '—')}</td></tr>
           <tr><td>Boletas de honorarios</td><td>${estadoDecl(inf.declaraciones.boletas_honorarios)}</td><td class="sub">${esc(inf.declaraciones.boletas_honorarios.detalle)}</td><td class="sub">${esc(inf.declaraciones.boletas_honorarios.ultima_consulta || '—')}</td></tr>
         </tbody>
       </table></div>
       <p class="hint mt">«Consultado» significa que el dato se leyó del portal autenticado del SII en la fecha indicada. «No consultado» no es «al día»: es ausencia de información.</p>
     </div>

     <div class="grid-2 mt">
       <div class="card">
         <h3>Ingresos por año (RCV)</h3>
         <p class="hint" style="margin-top:0">${esc(inf.ingresos_historicos.nota)}</p>
         ${(inf.ingresos_historicos.anios || []).length ? `
           <div class="tbl-wrap"><table class="tbl">
             <thead><tr><th>Año</th><th class="num">Ventas neto</th><th class="num">IVA ventas</th><th class="num">Compras neto</th><th class="num">IVA compras</th><th class="num">Meses</th></tr></thead>
             <tbody>${inf.ingresos_historicos.anios.map((a) => `<tr>
               <td><b>${esc(a.anio)}</b></td><td class="num mono">${fmtM(a.ventas_neto)}</td><td class="num mono">${fmtM(a.ventas_iva)}</td>
               <td class="num mono">${fmtM(a.compras_neto)}</td><td class="num mono">${fmtM(a.compras_iva)}</td><td class="num">${a.meses_con_datos}</td></tr>`).join('')}</tbody>
           </table></div>` : '<div class="empty">Sin años con RCV ingerido.</div>'}
       </div>

       <div class="card">
         <h3>Cobertura del período</h3>
         <div class="kpi-grid">
           <div class="kpi up"><small>Meses con RCV</small><strong>${inf.cobertura.con_datos}</strong></div>
           <div class="kpi"><small>Sin movimiento confirmado</small><strong>${inf.cobertura.sin_movimiento}</strong></div>
           <div class="kpi ${inf.cobertura.sin_datos ? 'bad' : 'up'}"><small>Sin sincronizar</small><strong>${inf.cobertura.sin_datos}</strong></div>
         </div>
         <p class="hint mt">Ventana ${esc(inf.cobertura.desde)} → ${esc(inf.cobertura.hasta)}. «Sin movimiento» solo se marca cuando el SII ya fue consultado y devolvió cero documentos; si no, es «sin sincronizar».</p>
       </div>
     </div>

     <div class="card mt">
       <h3>Declaraciones anuales (${esc(inf.declaraciones_anuales.desde)}–${esc(inf.declaraciones_anuales.hasta)})</h3>
       <p class="hint" style="margin-top:0">F22 y boletas de honorarios leídos del SII. «—» significa que ese año no se consultó, no que no exista declaración.</p>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Año</th><th class="num">Ventas RCV (neto)</th><th>F22</th><th class="num">F22 monto</th><th class="num">BHE emitidas</th><th class="num">BHE recibidas</th></tr></thead>
         <tbody>${(inf.declaraciones_anuales.anios || []).map((a) => `<tr>
           <td><b>${esc(a.anio)}</b></td>
           <td class="num mono">${a.rcv ? fmtM(a.rcv.ventas_neto) : '<span class="sub">—</span>'}</td>
           <td>${a.f22 ? `<span class="chip ${a.f22.estado === 'declarada' || a.f22.estado === 'rectificada' ? 'contabilizado' : a.f22.estado === 'pendiente' || a.f22.estado === 'no_presentada' ? 'error' : 'neutral'}">${esc(a.f22.etiqueta)}</span>` : '<span class="sub">no consultado</span>'}</td>
           <td class="num mono">${a.f22 && a.f22.monto_total != null ? fmtM(a.f22.monto_total) : '<span class="sub">—</span>'}</td>
           <td class="num mono">${a.boletas_honorarios?.emitidas?.totales ? fmtM(a.boletas_honorarios.emitidas.totales.honorario_bruto) : '<span class="sub">—</span>'}</td>
           <td class="num mono">${a.boletas_honorarios?.recibidas?.totales ? fmtM(a.boletas_honorarios.recibidas.totales.honorario_bruto) : '<span class="sub">—</span>'}</td></tr>`).join('')}</tbody>
       </table></div>
     </div>

     <div class="card mt">
       <h3>Mensuales — RCV y estimación F29</h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Período</th><th>RCV</th><th>F29 SII</th><th class="num">Ventas neto</th><th class="num">IVA ventas</th><th class="num">Compras neto</th><th class="num">IVA compras</th><th class="num">IVA estimado</th><th class="num">PPM est.</th><th class="num">F29 est.</th><th class="num">F29 declarado</th><th class="num">Dif.</th></tr></thead>
         <tbody>${inf.mensuales.map((m) => `<tr>
           <td>${esc(m.nombre)}</td><td>${estadoMes(m)}</td><td>${f29Chip(m)}</td>
           <td class="num mono">${fmtM(m.ventas_neto)}</td><td class="num mono">${fmtM(m.ventas_iva)}</td>
           <td class="num mono">${fmtM(m.compras_neto)}</td><td class="num mono">${fmtM(m.compras_iva)}</td>
           <td class="num mono"><b>${fmtM(m.iva_estimado)}</b></td><td class="num mono">${fmtM(m.ppm_estimado)}</td>
           <td class="num mono">${fmtM(m.f29_estimado)}</td>
           <td class="num mono">${m.f29_oficial && m.f29_oficial.monto_total != null ? fmtM(m.f29_oficial.monto_total) : '<span class="sub">—</span>'}</td>
           <td class="num mono">${m.f29_diferencia == null ? '<span class="sub">—</span>' : `<span class="${Math.abs(m.f29_diferencia) >= 1000 ? '' : 'sub'}">${fmtM(m.f29_diferencia)}</span>`}</td></tr>`).join('')}</tbody>
       </table></div>
       <p class="hint mt">«F29 est.» es una estimación propia desde el RCV; «F29 declarado» es lo que informa el SII. La diferencia solo aparece cuando el SII entrega el monto de la declaración.</p>
     </div>

     <div class="grid-2 mt">
       <div class="card">
         <h3>Hallazgos (${(op.hallazgos || []).length})</h3>
         ${(op.hallazgos || []).length ? op.hallazgos.map((h) => `
           <div class="checkline ${h.severidad === 'alta' ? 'warn' : ''}">
             <span class="chip ${sevChip(h.severidad)}">${esc(h.severidad)}</span>
             <b>${esc(h.titulo)}</b> — ${esc(h.detalle)}
             <div class="sub">Fuente: ${esc(h.fuente || '—')}</div>
           </div>`).join('') : '<div class="empty">Sin hallazgos.</div>'}
       </div>

       <div class="card">
         <h3>Fundamentos y limitaciones</h3>
         <h4>Fundamentos</h4>
         <ul>${(op.fundamentos || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
         <h4 class="mt">Recomendaciones</h4>
         ${(op.recomendaciones || []).length ? `<ul>${op.recomendaciones.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '<p class="hint">Sin recomendaciones pendientes.</p>'}
         <h4 class="mt">Limitaciones</h4>
         <ul>${(op.limitaciones || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
         <h4 class="mt">Base normativa citada</h4>
         <ul class="sub">${(op.base_normativa || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
       </div>
     </div>

     <div class="card mt">
       <h3>Capacidades reales de la conexión SII</h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Consulta</th><th>Estado</th><th>Fuente</th><th>Detalle</th></tr></thead>
         <tbody>${(inf.capacidades_sii || []).map((c) => `<tr>
           <td><b>${esc(c.nombre)}</b></td><td>${capChip(c.estado)}</td>
           <td class="sub">${esc(c.fuente || '—')}${c.evidencia ? `<br><span class="mono" style="font-size:var(--fs-xs)">${esc(c.evidencia)}</span>` : ''}</td>
           <td class="sub">${esc(c.detalle || '')}</td></tr>`).join('')}</tbody>
       </table></div>
     </div>`

    document.getElementById('sl-print').addEventListener('click', () => window.print())

    const sincronizar = async (incluirRcv) => {
      const aviso = document.getElementById('sl-aviso')
      aviso.innerHTML = '<div class="banner-lic">Consultando el SII… puede tardar unos segundos.</div>'
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/salud-tributaria/sincronizar`, {
          periodo, meses: 12, incluir_rcv: incluirRcv,
        })
        const partes = ['Informe generado']
        if (r.ficha && !r.ficha.sincronizada) partes.push(`ficha SII no actualizada: ${r.ficha.advertencia}`)
        if (r.rcv && r.rcv.job_id) partes.push('ingesta RCV iniciada en segundo plano')
        if (r.rcv && r.rcv.advertencia) partes.push(`RCV no iniciado: ${r.rcv.advertencia}`)
        showToast(partes.join(' · '), r.ficha && r.ficha.sincronizada ? 'success' : 'error')
        renderRoute()
      } catch (err) {
        aviso.innerHTML = `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">${esc(err.message)}</div>`
      }
    }
    document.getElementById('sl-sync')?.addEventListener('click', () => sincronizar(false))
    document.getElementById('sl-sync-rcv')?.addEventListener('click', () => sincronizar(true))
    document.getElementById('sl-sync-decl')?.addEventListener('click', async () => {
      const aviso = document.getElementById('sl-aviso')
      aviso.innerHTML = '<div class="banner-lic">Leyendo las declaraciones del SII (5 años)… puede tardar varios minutos.</div>'
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/salud-tributaria/declaraciones`, { periodo, anios: 5 })
        const partes = [`Declaraciones consultadas: F29 ${r.resultado.f29?.periodos ?? 0} período(s)`]
        if (r.resultado.f22) partes.push(`F22 ${r.resultado.f22.anios} año(s)`)
        if (r.resultado.boletas) partes.push(`BHE ${r.resultado.boletas.anios} año(s)`)
        if (r.aviso) partes.push(r.aviso)
        showToast(partes.join(' · '), r.aviso ? 'error' : 'success')
        renderRoute()
      } catch (err) {
        aviso.innerHTML = `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">${esc(err.message)}</div>`
      }
    })
  },
}
