/**
 * VISTA AUTOMATIZACIÓN — el corazón de la promesa "del SII al balance sin pasos
 * manuales": muestra dónde está cada documento del período en la cadena
 * PENDIENTE → CLASIFICADO → PROPUESTO → CONTABILIZADO y ejecuta el pipeline
 * completo (clasificar → proponer → contabilizar) en un clic.
 */

VIEWS.automatizacion = {
  titulo: 'Automatización',
  async render(cont) {
    const periodo = window._autoPeriodo || periodoGlobal()
    const eid = S.empresa.id

    let estado = null
    let ultima = null
    try {
      const r = await apiGet(`/api/contable/empresas/${eid}/automatizacion/${periodo}/estado`)
      estado = r.estado
      ultima = r.ultima_ejecucion
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    // Resultado de una ejecución recién terminada (sobrevive al re-render de ruta;
    // se liga a empresa+período para no mostrar residuos al cambiar de empresa)
    const resultado = (window._autoResultado && window._autoResultado.periodo === periodo && String(window._autoResultado.empresaId) === String(eid)) ? window._autoResultado : null
    window._autoResultado = null

    const d = estado.documentos || {}
    const cuenta = (k) => d[k] || 0
    const puedeEjecutar = tiene('automatizacion:ejecutar')
    const puedeSemilla = tiene('reglas:editar')

    cont.innerHTML = `
     <div class="frm-row mb pg-toolbar">
       <div><span class="frm-label">Período</span>${inputPeriodoHTML('auto-periodo', periodo)}</div>
       <span class="spacer"></span>
       <span class="chip ${estado.periodo_abierto ? 'contabilizado' : 'anulado'}">Período ${estado.periodo_abierto ? 'ABIERTO' : 'CERRADO'}</span>
        ${puedeEjecutar ? `<button class="btn btn-primary" id="auto-run">Contabilizar automáticamente</button>` : ''}
     </div>
      ${estado.periodo_abierto ? '' : `<p class="hint" id="auto-cerrado">El período está <b>CERRADO</b>: el pipeline puede clasificar y proponer, pero el núcleo contable <b>no crea asientos</b> en un período cerrado — esos documentos saldrán como omitidos con su motivo. Para contabilizarlos hay que reabrir el período.</p>`}

     <div class="kpi-grid">
       <div class="kpi"><small>⏳ Pendientes (sin cuenta)</small><strong>${cuenta('PENDIENTE')}</strong><span class="sub">esperando reglas o clasificación</span></div>
       <div class="kpi acc"><small>Clasificados</small><strong>${cuenta('CLASIFICADO')}</strong><span class="sub">con cuenta imputable asignada</span></div>
       <div class="kpi"><small>Propuestos</small><strong>${cuenta('PROPUESTO')}</strong><span class="sub">${estado.propuestas_pendientes} propuesta(s) viva(s)</span></div>
       <div class="kpi up"><small>Contabilizados</small><strong>${cuenta('CONTABILIZADO')}</strong><span class="sub">${estado.asientos_del_periodo} asiento(s) en el diario</span></div>
     </div>

     <div class="grid-2 mt">
       <div class="card">
         <h3>Cómo funciona</h3>
         <p class="muted" style="font-size:var(--fs-sm);margin:0 0 var(--space-3)">
            La conexión con el SII (IVA Mensual) ingesta los documentos del RCV; el motor de reglas
            les asigna cuenta contable; el núcleo genera la propuesta en partida doble y la contabiliza
            — todo auditado, sin digitar una sola línea.
         </p>
         <div class="checkline ${cuenta('PENDIENTE') === 0 ? 'ok' : 'warn'}">Ingesta SII: ${cuenta('PENDIENTE')} documento(s) esperando clasificación</div>
         <div class="checkline ${cuenta('CLASIFICADO') === 0 ? 'ok' : 'warn'}">Reglas contables: ${estado.reglas_activas} activa(s) · ${cuenta('CLASIFICADO')} sin propuesta</div>
         <div class="checkline ${estado.propuestas_pendientes === 0 ? 'ok' : 'warn'}">Propuestas: ${estado.propuestas_pendientes} pendiente(s) de confirmar</div>
          ${estado.reglas_activas === 0 && puedeSemilla
            ? `<div class="mt"><button class="btn btn-secondary btn-sm" id="auto-semilla">Instalar reglas iniciales</button>
              <p class="hint mt">Tu empresa no tiene reglas todavía: sin ellas nada se puede clasificar solo.</p></div>`
            : ''}
         <p class="hint mt">¿Un documento quedó mal? Revierte su asiento en Contabilidad, reclasifícalo en Documentos y vuelve a ejecutar.</p>
       </div>
       <div class="card">
         <h3>Última ejecución</h3>
          ${ultima ? `
           <p class="sub">${esc((ultima.cuando || '').replace('T', ' ').slice(0, 16))} · ${esc(ultima.usuario || '')}</p>
            ${filaResumen('Clasificados por reglas', ultima.resumen?.clasificados)}
            ${filaResumen('Propuestas generadas', ultima.resumen?.propuestas_nuevas)}
            ${filaResumen('Contabilizados', ultima.resumen?.contabilizadas)}
            ${filaResumen('Omitidos', ultima.resumen?.omitidas)}
          ` : '<div class="empty">Este período aún no se automatiza.</div>'}
       </div>
     </div>

     <div id="auto-out" class="mt">
        ${resultado ? tarjetaResultado(resultado) : ''}
     </div>`

    document.getElementById('auto-periodo').addEventListener('change', () => {
      const p = leerPeriodo('auto-periodo') || periodo
      // Un solo período: el selector del header, la URL y las demás vistas
      // siguen al que se elige aquí (antes solo movía esta vista).
      aplicarPeriodoGlobal(p)
      escribirHash(location.hash)
      sincronizarSelectorPeriodo(p)
      renderRoute()
    })

    const btnRun = document.getElementById('auto-run')
    if (btnRun) btnRun.addEventListener('click', () => confirmarPipeline(eid, periodo, estado))

    const btnSemilla = document.getElementById('auto-semilla')
    if (btnSemilla) btnSemilla.addEventListener('click', async () => {
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/automatizacion/semilla`, {})
        showToast(r.instaladas
          ? `Reglas iniciales instaladas: ${r.instaladas}`
          : 'La empresa ya tiene reglas — no se instaló la semilla', r.instaladas ? 'success' : 'info')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })
  },
}

function filaResumen(label, valor) {
  return `<div class="checkline ${valor ? 'ok' : ''}">${esc(label)}: <b class="mono">${valor ?? 0}</b></div>`
}

function tarjetaResultado(res) {
  const fallos = (res.propuestas_fallidas || []).concat((res.omitidas || []).map((o) => ({ motivo: o.motivo, propuesta_id: o.propuesta_id })))
  return `
   <div class="card" style="border-color:var(--success)">
     <h3 style="color:var(--success)">Pipeline completado — ${perDisplay(res.periodo)}</h3>
     <div class="kpi-grid mt">
       <div class="kpi up"><small>Contabilizados</small><strong>${res.contabilizadas}</strong><span class="sub">asientos en partida doble</span></div>
       <div class="kpi acc"><small>Propuestas nuevas</small><strong>${res.propuestas_nuevas}</strong></div>
       <div class="kpi"><small>Clasificados por reglas</small><strong>${res.clasificados}</strong><span class="sub">${res.sin_regla} sin regla</span></div>
       <div class="kpi ${fallos.length ? 'warn' : 'up'}"><small>Omitidos / fallidos</small><strong>${fallos.length}</strong></div>
     </div>
      ${res.total_asientos ? `<p class="hint mt">Monto total contabilizado: <b class="mono">${fmtM(res.total_asientos)}</b></p>` : ''}
      ${fallos.length ? `
       <div class="tbl-wrap mt" style="max-height:220px;overflow:auto"><table class="tbl">
         <thead><tr><th>Documento / propuesta</th><th>Motivo</th></tr></thead>
         <tbody>${fallos.map((f) => `<tr>
           <td class="mono sub">${esc(f.folio ? `Doc ${f.documento_id} (folio ${f.folio})` : f.propuesta_id ? `Propuesta ${f.propuesta_id}` : `Doc ${f.documento_id}`)}</td>
           <td class="sub">${esc(f.motivo || '')}</td>
         </tr>`).join('')}</tbody>
       </table></div>
       <p class="hint mt">Los omitidos siguen visibles en Documentos / Propuestas para resolución manual.</p>` : ''}
     <div class="flex mt">
       <a href="#asientos" class="btn btn-secondary btn-sm">Ver libro diario</a>
       <a href="#propuestas" class="btn btn-secondary btn-sm">Revisar propuestas</a>
     </div>
   </div>`
}

/**
 * Confirmación con ALCANCE antes de ejecutar (auditoría §2: el botón corría a
 * ciegas). Muestra cuántos documentos entrarán en cada eslabón de la cadena y
 * advierte cuando el período está cerrado; cancelar no envía ninguna petición.
 */
async function confirmarPipeline(eid, periodo, estado) {
  const d = estado.documentos || {}
  const n = (k) => d[k] || 0
  const porClasificar = n('PENDIENTE') + n('REVISION')
  const sinPropuesta = n('CLASIFICADO')
  const porContabilizar = estado.propuestas_pendientes || 0
  const total = porClasificar + sinPropuesta + porContabilizar
  const cerrado = estado.periodo_abierto === false

  if (total === 0) {
    showToast(`No hay nada por contabilizar en ${perDisplay(periodo)}: sin documentos pendientes ni propuestas vivas`, 'info')
    return
  }

  const confirmado = await UIEstado.confirmar({
    titulo: `Contabilizar ${perDisplay(periodo)}`,
    cuerpo: `
      <dl>
        ${UIEstado.dato('Documentos por clasificar', `<b class="mono">${porClasificar}</b>`)}
        ${UIEstado.dato('Clasificados sin propuesta', `<b class="mono">${sinPropuesta}</b>`)}
        ${UIEstado.dato('Propuestas por contabilizar', `<b class="mono">${porContabilizar}</b>`)}
        ${UIEstado.dato('Período', cerrado ? 'CERRADO' : 'ABIERTO')}
      </dl>
      ${cerrado
        ? '<p class="hint" style="color:var(--danger)">El período está cerrado: los asientos se van a omitir y el resultado dirá cuántos. Reabre el período si necesitas contabilizarlos.</p>'
        : '<p class="hint">Se crearán asientos definitivos en partida doble (auditado). Nada se envía al SII.</p>'}`,
    texto: `Contabilizar ${total}`,
  })
  if (!confirmado) return
  await ejecutarPipeline(eid, periodo)
}

/** Ejecuta el pipeline: feedback de progreso y, al terminar, re-render con KPIs frescos + resumen. */
async function ejecutarPipeline(eid, periodo) {
  const out = document.getElementById('auto-out')
  const btn = document.getElementById('auto-run')
  btn.disabled = true
  out.innerHTML = `
   <div class="card">
     <h3>⏳ Ejecutando pipeline de ${perDisplay(periodo)}…</h3>
     <div class="prog"><i style="width:30%"></i></div>
     <div class="hint mt">1/3 · Clasificando con reglas → 2/3 · Generando propuestas → 3/3 · Contabilizando</div>
   </div>`
  try {
    const r = await apiPost(`/api/contable/empresas/${eid}/automatizacion/${periodo}/ejecutar`, {})
    const res = { ...r.resultado, empresaId: eid }
    window._autoResultado = res
    showToast(`Automatización: ${res.contabilizadas} documento(s) contabilizado(s)`, res.contabilizadas ? 'success' : 'info')
    refrescarPillDocs()
    renderRoute() // re-render con KPIs actualizados + tarjeta de resultado
  } catch (err) {
    out.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
    btn.disabled = false
    showToast(err.message, 'error')
  }
}
