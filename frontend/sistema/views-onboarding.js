/**
 * VISTA ONBOARDING (SAAS-2) — ficha tributaria autónoma desde el SII.
 *
 * Checklist §43: cada dato muestraconfirmado opendiente humano.
 * Acciones (requieren onboarding:ejecutar):
 *   - Consultar SII → propuesta de razón social + inicio de actividades
 *     (derivado del RCV) → confirmación humana antes de persistir.
 *   - Formulario de ficha: actividades, régimen y socios (lo que el SII no
 *     entrega por vía existente — sin scraping).
 *   - Ingesta del histórico: N meses hacia atrás vía pipeline FASE 3,
 *     idempotente, con progreso en vivo (job en background).
 */

VIEWS.onboarding = {
  titulo: 'Onboarding',
  async render(cont) {
    const eid = S.empresa.id
    const puede = tiene('onboarding:ejecutar')

    let f
    try {
      f = await apiGet(`/api/contable/empresas/${eid}/onboarding/ficha`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const LABELS = {
      razon_social_sii: 'Razón social (desde el SII)',
      inicio_actividades: 'Inicio de actividades',
      actividades_economicas: 'Actividades económicas',
      regimen_tributario: 'Régimen tributario',
      socios_representante: 'Socios y representante legal',
      documentos_historicos: 'Documentos históricos (RCV)',
    }
    const chip = (estado) => estado === 'confirmado'
      ? '<span class="chip contabilizado">Confirmado</span>'
      : estado === 'parcial'
        ? '<span class="chip propuesto">◐ Parcial</span>'
        : '<span class="chip pendiente">Pendiente</span>'

    const fich = f.ficha || {}
    const desdeDef = window._onbDesde || ultimosPeriodos(12)[0]
    const hastaDef = window._onbHasta || periodoActual()

    cont.innerHTML = `
     <div class="card">
       <div class="flex" style="justify-content:space-between">
         <div>
           <h3 style="margin:0">Completa tu empresa</h3>
           <p class="muted" style="font-size:var(--fs-sm);margin:var(--space-2) 0 0">
              Traemos lo que el SII puede entregarnos solo (con tu clave, sin scraping) y te pedimos
              confirmar lo demás. Al terminar, tu contabilidad queda operando sin intervención de JMV.
           </p>
         </div>
          ${f.completo ? '<span class="chip contabilizado">Completa</span>' : `<span class="chip pendiente">${f.pendientes_humano.length} pendiente(s)</span>`}
       </div>
       <div class="mt">
          ${Object.keys(LABELS).map((k) => `<div class="checkline ${f.checklist[k] === 'confirmado' ? 'ok' : 'warn'}">${LABELS[k]} ${chip(f.checklist[k])}</div>`).join('')}
       </div>
     </div>

     <div class="grid-2 mt">
       <div class="card">
         <h3>Ficha tributaria</h3>
         <p class="hint" style="margin-top:0">Los datos ya confirmados quedan guardados; puedes corregirlos aquí.</p>
         <div class="form-group">
           <label class="form-label">Razón social (SII)</label>
           <input id="ob-razon" class="form-input" value="${esc(fich.razon_social_sii || '')}" placeholder="Ej: Comercial SpA">
         </div>
         <div class="form-group">
           <label class="form-label">Inicio de actividades</label>
           <input id="ob-inicio" type="date" class="form-input" value="${esc(fich.inicio_actividades || '')}">
         </div>
         <div class="form-group">
           <label class="form-label">Régimen tributario</label>
           <select id="ob-regimen" class="form-input">
              ${selectOptions([
                { v: '', t: '— sin definir —' },
                { v: 'Pro Pyme General (14 D)', t: 'Pro Pyme General (14 D)' },
                { v: 'Pro Pyme Transparente (14 D)', t: 'Pro Pyme Transparente (14 D)' },
                { v: 'Régimen General (14 A)', t: 'Régimen General (14 A)' },
                { v: 'Régimen Semintegrado (14 A)', t: 'Régimen Semintegrado (14 A)' },
              ], 'v', (o) => o.t, fich.regimen_tributario)}
           </select>
         </div>
         <div class="form-group">
           <label class="form-label">Actividades económicas (una por línea, con código si lo tienes)</label>
           <textarea id="ob-actividades" class="form-input" rows="3" placeholder="620100 — Venta al por mayor de computadores">${esc((fich.actividades || []).join('\n'))}</textarea>
         </div>
         <div class="form-group">
           <label class="form-label">Socios / representante (uno por línea: RUT — Nombre — rol)</label>
           <textarea id="ob-socios" class="form-input" rows="3" placeholder="12.345.678-9 — María Pérez — Representante legal">${esc((fich.socios || []).join('\n'))}</textarea>
         </div>
         <div class="flex" style="gap:var(--space-2)">
            ${puede ? '<button class="btn btn-primary" id="ob-guardar">Guardar ficha</button>' : ''}
            ${puede ? '<button class="btn btn-secondary" id="ob-sii">Consultar SII</button>' : '<span class="hint">Solo lectura: tu rol no ejecuta el onboarding.</span>'}
         </div>
       </div>

       <div class="card">
         <h3>⇅ Traer el histórico desde el SII</h3>
         <p class="muted" style="font-size:var(--fs-sm);margin:0 0 var(--space-3)">
            Descarga el RCV de compras y ventas de cada período (idempotente: repetir no duplica).
         </p>
          ${puede ? `
         <div class="frm-row">
           <div><span class="frm-label">Desde</span>${inputPeriodoHTML('ob-desde', desdeDef)}</div>
           <div><span class="frm-label">Hasta</span>${inputPeriodoHTML('ob-hasta', hastaDef)}</div>
           <div style="align-self:flex-end"><button class="btn btn-primary" id="ob-historico">Ingesta del histórico</button></div>
         </div>
         <div id="ob-progreso" class="mt"></div>` : '<p class="hint">Solo lectura: tu rol no ejecuta la ingesta.</p>'}
         <p class="hint mt">Máximo 24 períodos por corrida. La primera vez puede tardar varios minutos (el SII se consulta con pausa entre consultas).</p>
       </div>
     </div>`

    if (!puede) return

    document.getElementById('ob-guardar').addEventListener('click', async () => {
      const val = (id) => document.getElementById(id).value.trim()
      const lineas = (id) => val(id) ? val(id).split('\n').map((s) => s.trim()).filter(Boolean) : []
      try {
        await apiPost(`/api/contable/empresas/${eid}/onboarding/confirmar-ficha`, {
          razon_social_sii: val('ob-razon') || null,
          inicio_actividades: val('ob-inicio') || null,
          regimen_tributario: val('ob-regimen') || null,
          actividades: lineas('ob-actividades'),
          socios: lineas('ob-socios'),
        })
        showToast('Ficha guardada', 'success')
        renderRoute()
      } catch (err) { showToast(err.message, 'error') }
    })

    document.getElementById('ob-sii').addEventListener('click', async () => {
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/onboarding/consultar-sii`, {})
        const p = r.propuesta
        openModal(`
         <h3>Propuesta desde el SII</h3>
         <p class="sub">RCV ${esc(p.documentos_analizados?.periodo || '')}: ${p.documentos_analizados?.ventas || 0} ventas, ${p.documentos_analizados?.compras || 0} compras analizadas.</p>
         <div class="checkline ok">Razón social: <b>${esc(p.razon_social_sii || '—')}</b></div>
         <div class="checkline ${p.inicio_actividades_propuesto ? 'ok' : 'warn'}">Inicio de actividades propuesto: <b>${esc(p.inicio_actividades_propuesto || 'no determinable')}</b>${p.documentos_analizados?.periodo_historico ? ` (primer documento desde ${perDisplay(p.documentos_analizados.periodo_historico)})` : ''}</div>
          ${(p.avisos || []).map((a) => `<div class="checkline warn">${esc(a)}</div>`).join('')}
         <div class="modal-foot">
           <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
           <button class="btn btn-primary" id="ob-aplicar">Aplicar propuesta</button>
         </div>`)
        document.getElementById('ob-aplicar').addEventListener('click', async () => {
          try {
            await apiPost(`/api/contable/empresas/${eid}/onboarding/confirmar-ficha`, {
              razon_social_sii: p.razon_social_sii || null,
              inicio_actividades: p.inicio_actividades_propuesto || null,
            })
            showToast('Propuesta aplicada', 'success')
            cerrarModal()
            renderRoute()
          } catch (err) { showToast(err.message, 'error') }
        })
      } catch (err) { showToast(err.message, 'error') }
    })

    document.getElementById('ob-historico').addEventListener('click', async () => {
      const desde = leerPeriodo('ob-desde')
      const hasta = leerPeriodo('ob-hasta')
      window._onbDesde = desde
      window._onbHasta = hasta
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/onboarding/ingesta-historica`, { desde, hasta })
        window._onbJobId = r.jobId
        showToast(`Ingesta lanzada: ${r.periodos.length} período(s)`, 'success')
        escucharProgreso()
      } catch (err) { showToast(err.message, 'error') }
    })

    // Re-attach: si hay un job previo de esta sesión, sigue el progreso tras re-render.
    escucharProgreso()

    function escucharProgreso() {
      const jobId = window._onbJobId
      const zona = document.getElementById('ob-progreso')
      if (!jobId || !zona) return
      iniciarPolling(
        () => apiGet(`/api/contable/empresas/${eid}/onboarding/ingesta-historica/${jobId}`),
        {
          intervalo: 2000,
          esTerminal: (d) => ['completado', 'completado_con_errores', 'error'].includes(d.job?.estado),
          // ISSUE-002: al terminar, refresca TODA la vista — el polling solo
          // pinta la zona de progreso y el checklist quedaba desactualizado.
          onUpdate: (d) => {
            if (['completado', 'completado_con_errores'].includes(d.job?.estado)) {
              setTimeout(() => renderRoute(), 1200)
              return
            }
            const j = d.job
            const pct = j.total ? Math.round((j.procesados / j.total) * 100) : 0
            zona.innerHTML = `
             <div class="checkline ${j.estado === 'error' ? 'warn' : 'ok'}">Job <span class="mono">${esc(j.jobId)}</span> — ${esc(j.estado)} (${j.procesados}/${j.total})</div>
             <div style="height:6px;background:var(--c-slate-200);border-radius:3px;overflow:hidden;margin:6px 0">
               <div style="height:100%;width:${pct}%;background:var(--accent)"></div>
             </div>
              ${j.periodo_actual ? `<p class="hint">Consultando ${perDisplay(j.periodo_actual)}…</p>` : ''}
              ${j.resultado?.periodos?.length ? j.resultado.periodos.map((pr) => {
                const det = [pr.compra, pr.venta]
                const ok = det.filter((x) => x && x.insertados !== undefined)
                  .map((x) => `${x.insertados} nuevos / ${x.duplicados} dup`)
                  .join(' · ')
                const mal = det.filter((x) => x && x.error).map((x) => x.error)
                return `<div class="checkline ${mal.length ? 'warn' : 'ok'}">${perDisplay(pr.periodo)} — ${esc(ok || mal.join(' · '))}</div>`
              }).join('') : ''}`
          },
        }
      ).catch(() => { /* el poll lanza si la sesión expira; el job sigue en el server */ })
    }
  },
}
