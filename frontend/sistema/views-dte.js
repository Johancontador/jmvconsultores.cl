/**
 * VISTA FACTURACIÓN ELECTRÓNICA — BLOQUE 4 (UI sobre la API /api/dte de los
 * bloques 2 y 3). Dos rutas:
 *
 *   #dte          → Bandeja de DTEs emitidos + estado SII + vínculo contable +
 *                   sincronización DTE→contabilidad (BLOQUE 3) + faltantes
 *                   de configuración por tipo de documento (honestidad §42).
 *   #dte-emision  → Formulario de emisión (Factura 33, Exenta 34, ND 56,
 *                   NC 61) con ítems dinámicos, referencia obligatoria en
 *                   notas, totales calculados en vivo (mismo criterio que
 *                   calcularMontos: neto + IVA 19% TASA_IVA; 34 exenta) y
 *                   CLAVE DE IDEMPOTENCIA: se genera al abrir el formulario
 *                   (crypto.randomUUID) y viaja en cada envío — un doble
 *                   click jamás consume un segundo folio (routes/dte.js la
 *                   deduplica en el servidor con UNIQUE parcial).
 *
 * Secretos jamás tocan el browser: la config pública es flags de presencia
 * (tiene_certificado); el certificado se sube una vez (base64 en el PUT) y
 * el CAF se pega como XML — el backend lo cifra en la bóveda.
 */

const ETIQUETA_TIPO_DTE = { 33: 'Factura', 34: 'Exenta', 56: 'Nota de Débito', 61: 'Nota de Crédito' }
const COD_REF_TXT = { 1: 'Anula documento', 2: 'Corrige texto', 3: 'Corrige montos' }
const CHIP_ESTADO_DTE = {
  PENDIENTE: 'pendiente', ENVIADO: 'neutral', ACEPTADO: 'contabilizado',
  RECHAZADO: 'error', ERROR: 'error',
}
const TASA_IVA_UI = 0.19 // espejo de calcularMontos (TASA_IVA, D.L. 825)

/**
 * Tarjeta del resultado de una sincronización DTE → contabilidad. El resumen
 * vive en window._dteSyncResultado (ligado a empresa, como _autoResultado en
 * views-autom.js) para SOBREVIVIR al re-render de la ruta: si se pintara solo
 * en #dte-sync-out, renderRoute() lo borra de inmediato y el contador jamás
 * ve qué hizo la sincronización (bug hallado por /qa).
 */
/**
 * Alcance REAL de la sincronización DTE → contabilidad, antes de ejecutarla.
 * Antes el botón corría a ciegas: no había forma de saber cuántos documentos
 * iba a crear ni cuánto dinero había en juego (auditoría UX §2.4).
 * `sinVinculo` usa el MISMO criterio que el KPI de la bandeja (aceptado y sin
 * `asiento_id`); el backend resume todo lo demás de forma idempotente.
 */
async function dteAlcanceSincronizacion(eid) {
  const r = await apiGet(`/api/dte/empresas/${eid}/dtes?estado=ACEPTADO&limit=500`)
  const dtes = r.dtes || []
  const sinVinculo = dtes.filter((d) => !d.asiento_id)
  return {
    aceptados: dtes.length,
    pendientes: sinVinculo.length,
    conDocumento: sinVinculo.filter((d) => d.documento_id).length,
    monto: sinVinculo.reduce((a, d) => a + (d.monto_total || 0), 0),
  }
}

function dteSyncTarjetaHTML(s) {
  const fila = (label, v) => `<div class="checkline ok">${esc(label)}: <b>&nbsp;${v}</b></div>`
  return `
   <div class="card" style="border-color:var(--success)">
     <h3>Sincronización DTE → contabilidad</h3>
      ${fila('Aceptados procesados', s.aceptados_procesados)}
      ${fila('Documentos de bandeja creados', s.documentos_creados)}
      ${fila('Enlazados a documentos ya ingestados por el RCV (dedupe)', s.documentos_enlazados_por_dedupe)}
      ${fila('Propuestas creadas (esperan confirmación humana)', s.propuestas_creadas)}
      ${fila('Sin regla → quedan PENDIENTES en la bandeja', s.sin_regla)}
      ${fila('Asientos vinculados', s.asientos_vinculados)}
      ${(s.fallidos || []).map((f) => `<div class="checkline warn">Fallido: DTE ${esc(String(f.dte_id))} — ${esc(f.motivo || f.etapa || '')}</div>`).join('')}
     <p class="hint mt">Idempotente: re-ejecutar no duplica documentos ni asientos. Propuestas y confirmaciones se hacen en Contabilizaciones → Propuestas y Conciliación.</p>
   </div>`
}

VIEWS.dte = {
  titulo: 'Facturación Electrónica',
  async render(cont) {
    const eid = S.empresa.id
    let data
    try {
      data = await apiGet(`/api/dte/empresas/${eid}/config`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const puedeEmitir = tiene('dte:emitir')
    const config = data.config
    const faltantes = data.faltantes || {}

    // ---- filtros (persisten en el re-render tras cada acción) ----
    const params = new URLSearchParams(location.hash.split('?')[1] || '')
    let fTipo = params.get('tipo') || ''
    let fEstado = params.get('estado') || ''

    let dtes = []
    try {
      const qs = new URLSearchParams()
      if (fTipo) qs.set('tipo', fTipo)
      if (fEstado) qs.set('estado', fEstado)
      const r = await apiGet(`/api/dte/empresas/${eid}/dtes?${qs.toString()}`)
      dtes = r.dtes || []
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const porEstado = (e) => dtes.filter((d) => d.estado === e).length
    // Matriz compacta: lo que falta a TODOS los tipos incompletos se nombra UNA
    // vez; por tipo queda solo lo específico. Cero repetición, misma honestidad §42.
    const incompletos = Object.entries(faltantes).filter(([, l]) => l.length)
    const alertaConfig = incompletos.length > 0
    const listas = incompletos.map(([, l]) => l)
    const comunes = listas.length ? listas[0].filter((x) => listas.every((l) => l.includes(x))) : []

    cont.innerHTML = `
     <div class="frm-row mb">
       <div>
         <span class="frm-label">Tipo</span>
         <select id="dte-f-tipo" class="form-input" style="width:auto">
            <option value="">Todos los tipos</option>
            ${Object.entries(ETIQUETA_TIPO_DTE).map(([t, n]) => `<option value="${t}" ${String(fTipo) === t ? 'selected' : ''}>${t} — ${n}</option>`).join('')}
         </select>
       </div>
       <div>
         <span class="frm-label">Estado</span>
         <select id="dte-f-estado" class="form-input" style="width:auto">
            <option value="">Todos los estados</option>
            ${Object.keys(CHIP_ESTADO_DTE).map((e) => `<option value="${e}" ${fEstado === e ? 'selected' : ''}>${e}</option>`).join('')}
         </select>
       </div>
       <span class="spacer"></span>
       <a class="btn btn-secondary" href="#dte-emision">Emitir DTE</a>
        ${puedeEmitir ? `       <button class="btn btn-secondary" id="dte-sync">Sincronizar contabilidad</button>` : ''}
     </div>

      ${alertaConfig ? `
       <div class="card" style="border-color:var(--warning);margin-bottom:var(--space-5)">
         <h3>Emisor incompleto — matriz de requisitos por tipo</h3>
         <div class="tbl-wrap"><table class="tbl">
           <thead><tr><th>Requisito</th><th>Detalle</th><th>Estado</th></tr></thead>
           <tbody>
            ${comunes.length ? `
             <tr>
               <td><b>Todos los tipos</b></td>
               <td>${esc(comunes.join('; '))}</td>
               <td><span class="chip pendiente">Incompleto</span></td>
             </tr>` : ''}
            ${Object.entries(faltantes).map(([t, lista]) => {
              const extra = lista.filter((x) => !comunes.includes(x))
              return `
             <tr>
               <td>Tipo ${t} — ${esc(ETIQUETA_TIPO_DTE[t] || t)}</td>
               <td>${lista.length === 0 ? '—' : (extra.length ? esc(extra.join('; ')) : (comunes.length ? 'solo los requisitos comunes' : esc(lista.join('; '))))}</td>
               <td>${lista.length === 0 ? '<span class="chip contabilizado">Listo</span>' : '<span class="chip pendiente">Incompleto</span>'}</td>
             </tr>`
            }).join('')}
           </tbody>
         </table></div>
         <p class="hint mt">Completa la ficha del emisor, sube el certificado y carga los CAFs en <a href="#dte-config">Facturación → Configuración</a>. Hasta entonces, la emisión de esos tipos será rechazada nombrando exactamente lo que falta.</p>
       </div>` : ''}

     <div class="kpi-grid">
       <div class="kpi"><small>Aceptados por el SII</small><strong>${porEstado('ACEPTADO')}</strong><span class="sub">${dtes.filter((d) => d.estado === 'ACEPTADO' && !d.asiento_id).length} sin contabilizar vía sincronización</span></div>
       <div class="kpi warn"><small>Enviados / pendientes</small><strong>${porEstado('ENVIADO') + porEstado('PENDIENTE')}</strong><span class="sub">${porEstado('ENVIADO')} esperando consulta SII · ${porEstado('PENDIENTE')} sin track-id</span></div>
       <div class="kpi bad"><small>Rechazados o con error</small><strong>${porEstado('RECHAZADO') + porEstado('ERROR')}</strong><span class="sub">reintento con el mismo folio</span></div>
       <div class="kpi acc"><small>Total emitido (filtro actual)</small><strong class="mono">${fmt(dtes.reduce((a, d) => a + (d.monto_total || 0), 0))}</strong><span class="sub">${dtes.length} documento(s) listado(s)</span></div>
     </div>

     <div class="card mt">
       <h3>DTEs emitidos</h3>
        ${dtes.length ? `
         <div class="tbl-wrap"><table class="tbl">
           <thead><tr>
             <th>Folio</th><th>Tipo</th><th>Fecha</th><th>Receptor</th>
             <th class="num">Total</th><th>Estado</th><th>SII</th><th>Contabilidad</th>
              ${puedeEmitir ? '<th></th>' : ''}
           </tr></thead>
           <tbody>
            ${dtes.map((d) => `
             <tr>
               <td><b>${d.folio}</b></td>
               <td>${d.tipo_dte} · ${esc(ETIQUETA_TIPO_DTE[d.tipo_dte] || '')}</td>
               <td>${esc(d.fecha_emision || '—')}</td>
               <td>${esc(d.receptor_razon_social || d.receptor_rut || '—')}<div class="sub">${esc(d.receptor_rut ? formatRut(d.receptor_rut) : '')}</div></td>
               <td class="num">${fmt(d.monto_total)}</td>
               <td><span class="chip ${CHIP_ESTADO_DTE[d.estado] || 'neutral'}">${esc(d.estado)}</span></td>
               <td>${d.sii_codigo ? esc(String(d.sii_codigo)) : '—'}${d.sii_glosa ? `<div class="sub">${esc(d.sii_glosa)}</div>` : ''}</td>
               <td>${d.asiento_id
                 ? `Asiento ${d.asiento_id}`
                 : (d.documento_id ? `Bandeja doc ${d.documento_id} — sin asiento aún` : 'Sin documento')}</td>
                ${puedeEmitir ? `
                 <td>
                  ${d.estado === 'ENVIADO' ? `<button class="btn btn-secondary btn-sm" data-estado="${d.id}">Consultar SII</button>` : ''}
                  ${['PENDIENTE', 'ERROR', 'RECHAZADO'].includes(d.estado) ? `<button class="btn btn-secondary btn-sm" data-reintentar="${d.id}">Reintentar</button>` : ''}
                 </td>` : ''}
             </tr>`).join('')}
           </tbody>
         </table></div>
         <p class="hint mt">La fuente de verdad del estado es el SII: «Consultar SII» guarda el código VERBATIM (EPR/RPR/RLV…). El vínculo contable se crea con «Sincronizar contabilidad»: DTE aceptado → bandeja → reglas → propuesta → confirmación humana → asiento.</p>
        ` : `<div class="empty">Sin DTEs para el filtro actual. Empieza en <a href="#dte-emision">Emitir DTE</a>.</div>`}
     </div>

     <div id="dte-sync-out" class="mt">
        ${(window._dteSyncResultado && String(window._dteSyncResultado.empresaId) === String(eid)) ? dteSyncTarjetaHTML(window._dteSyncResultado.s) : ''}
     </div>
    `

    // ---- filtros: re-render de la misma ruta ----
    const volver = () => { location.hash = `#dte${fTipo || fEstado ? `?tipo=${fTipo}&estado=${fEstado}` : ''}` }
    document.getElementById('dte-f-tipo').addEventListener('change', (e) => {
      fTipo = e.target.value
      volver()
    })
    document.getElementById('dte-f-estado').addEventListener('change', (e) => {
      fEstado = e.target.value
      volver()
    })

    // ---- sincronizar contabilidad (BLOQUE 3) ----
    const syncBtn = document.getElementById('dte-sync')
    if (syncBtn) syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true
      try {
        // 1) Alcance real consultado ANTES de escribir: cuántos aceptados hay,
        //    cuántos siguen sin vínculo contable y cuánto suman.
        const alcance = await dteAlcanceSincronizacion(eid)
        if (!alcance.aceptados) {
          showToast('No hay DTEs aceptados por el SII: nada que sincronizar', 'info')
          syncBtn.disabled = false
          return
        }
        // 2) Confirmación con el alcance: la sincronización crea documentos,
        //    propuestas y enlaces contables — no es una consulta.
        const ok = await UIEstado.confirmar({
          titulo: 'Sincronizar los DTE aceptados con la contabilidad',
          texto: `Sincronizar ${alcance.aceptados}`,
          idBoton: 'dte-sync-ok',
          cuerpo: `
            <p>Se recorren los DTE <b>aceptados por el SII</b> de ${esc(S.empresa.nombre)}: cada uno se lleva a la bandeja como documento, se clasifica con tus reglas y genera una propuesta que <b>tú</b> confirmas después.</p>
            <dl>
              ${UIEstado.dato('Aceptados por el SII', `<b class="mono">${alcance.aceptados}</b>`)}
              ${UIEstado.dato('Sin vínculo contable', `<b class="mono">${alcance.pendientes}</b>`)}
              ${UIEstado.dato('Ya con documento en la bandeja', `<span class="mono">${alcance.conDocumento}</span>`)}
              ${UIEstado.dato('Monto de los no vinculados', `<b class="mono">${fmtM(alcance.monto)}</b>`)}
            </dl>
            <p class="hint mt">Idempotente: lo ya sincronizado no se duplica (misma clave de dedupe del RCV). Nada se contabiliza aquí: las propuestas esperan tu confirmación.</p>`,
        })
        if (!ok) { syncBtn.disabled = false; return }
        const r = await apiPost(`/api/dte/empresas/${eid}/sincronizar-contabilidad`, {})
        const s = r.sincronizacion || {}
        window._dteSyncResultado = { empresaId: eid, s }
        showToast('Sincronización completada', 'success')
        renderRoute()
      } catch (err) {
        syncBtn.disabled = false
        showToast(err.message, 'error')
      }
    })

    // ---- acciones por fila ----
    cont.querySelectorAll('[data-estado]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true
      try {
        const r = await apiPost(`/api/dte/empresas/${eid}/dtes/${b.dataset.estado}/estado`, {})
        showToast(`SII: ${r.dte.estado} — código ${r.dte.sii_codigo || 'sin código'}`, r.dte.estado === 'ACEPTADO' ? 'ok' : 'error')
        renderRoute()
      } catch (err) {
        b.disabled = false
        showToast(err.message, 'error')
      }
    }))
    cont.querySelectorAll('[data-reintentar]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true
      try {
        await apiPost(`/api/dte/empresas/${eid}/dtes/${b.dataset.reintentar}/reintentar`, {})
        showToast('Reintento enviado al SII con el mismo folio', 'success')
        renderRoute()
      } catch (err) {
        b.disabled = false
        showToast(err.message, 'error')
      }
    }))
  },
}

/** Etiqueta legible de las acciones del emisor que se muestran en su historial. */
function dteAccionLegible(accion) {
  if (accion === 'dte.config.guardar') return 'Ficha del emisor'
  if (accion === 'dte.caf.guardar') return 'CAF de folios'
  return accion
}

/** Campos que tocó un cambio auditado (el backend guarda `despues.campos`). */
function dteCamposAuditoria(json) {
  try {
    const d = JSON.parse(json || '{}')
    return Array.isArray(d.campos) ? d.campos.filter((c) => c !== 'cert_pass').join(', ') : ''
  } catch { return '' }
}

VIEWS['dte-config'] = {
  titulo: 'Configuración del Emisor',
  async render(cont) {
    const eid = S.empresa.id
    let data, folios
    try {
      ;[data, folios] = await Promise.all([
        apiGet(`/api/dte/empresas/${eid}/config`),
        apiGet(`/api/dte/empresas/${eid}/folios`),
      ])
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }
    const c = data.config
    const puede = tiene('dte:configurar')
    const v = (x) => esc(x ?? '')
    const siNo = (b) => (b ? '<span class="chip contabilizado">Sí</span>' : '<span class="chip error">No</span>')

    // Historial de cambios del emisor: la bitácora ya existe, pero hasta ahora
    // no había forma de ver desde aquí quién cambió el certificado, los CAFs o
    // el ambiente (auditoría UX §2.4). Se muestran los últimos movimientos
    // filtrados de la propia empresa; no se pide un endpoint nuevo.
    let historial = []
    let historialError = ''
    if (tiene('auditoria:ver')) {
      try {
        const regs = (await apiGet(`/api/contable/empresas/${eid}/auditoria?limit=200`)).registros || []
        historial = regs.filter((r) => /^dte\.(config|caf)\./.test(String(r.accion))).slice(0, 5)
      } catch (err) { historialError = err.message }
    }

    cont.innerHTML = `
     <div class="frm-row mb"><span class="spacer"></span><a class="btn btn-secondary" href="#dte">Volver a la bandeja</a></div>

      ${puede ? `
       <div class="grid-2">
        <div class="card">
         <h3>Ficha del emisor</h3>
          ${c ? `
           <div class="kpi-grid" style="margin-bottom:var(--space-4)">
             <div class="kpi"><small>Ambiente</small><strong>${v(c.ambiente)}</strong></div>
             <div class="kpi"><small>Resolución</small><strong>${v(c.fch_resol)}</strong><span class="sub">Nro ${v(c.nro_resol)}</span></div>
             <div class="kpi"><small>Certificado</small><strong>${c.tiene_certificado ? 'Cargado' : 'Sin cargar'}</strong></div>
           </div>` : '<p class="muted">El emisor aún no tiene ficha: guárdala para empezar.</p>'}
         <div class="grid-2">
           <label class="muted">Razón social<input class="form-input" id="dc-razon" value="${v(c && c.razon_social)}"></label>
           <label class="muted">Giro<input class="form-input" id="dc-giro" value="${v(c && c.giro)}"></label>
           <label class="muted">Dirección<input class="form-input" id="dc-dir" value="${v(c && c.direccion)}"></label>
           <label class="muted">Comuna<input class="form-input" id="dc-com" value="${v(c && c.comuna)}"></label>
           <label class="muted">ACTECO (código SII)<input class="form-input" id="dc-acteco" value="${v(c && c.acteco)}"></label>
           <label class="muted">Ambiente
             <select class="form-input" id="dc-amb">
                <option value="certificacion" ${c && c.ambiente === 'certificacion' ? 'selected' : ''}>Certificación</option>
                <option value="produccion" ${c && c.ambiente === 'produccion' ? 'selected' : ''}>Producción</option>
             </select>
           </label>
           <label class="muted">Fecha resolución (FchResol)<input class="form-input" id="dc-fch" placeholder="YYYY-MM-DD" value="${v(c && c.fch_resol)}"></label>
           <label class="muted">Nº resolución (NroResol)<input class="form-input" id="dc-nro" value="${v(c && c.nro_resol)}"></label>
         </div>
         <button class="btn btn-primary mt" id="dc-guardar">Guardar ficha</button>
         <div class="card mt" style="border-color:var(--danger)">
           <h4 style="margin:0 0 var(--space-1);font-family:var(--font-display)">Certificado de firma — zona de alto riesgo</h4>
           <p class="hint" style="margin-top:0">Con este certificado se firman TODOS los DTE de la empresa. Reemplazarlo por uno equivocado deja la emisión fallando hasta corregirlo, y se pide confirmación escribiendo el RUT de la empresa.</p>
           <div class="grid-2">
             <label class="muted">Certificado .pfx (subir archivo)<input type="file" class="form-input" id="dc-pfx" accept=".pfx,.p12"></label>
             <label class="muted">Contraseña del certificado<input type="password" class="form-input" id="dc-pass" autocomplete="new-password" placeholder="${c && c.tiene_certificado ? 'sin cambio — dejar vacío conserva la actual' : 'requerida con el certificado'}"></label>
           </div>
           <p class="hint mt">Certificado y contraseña se guardan CIFRADOS (bóveda AES-256-GCM) y jamás vuelven al navegador. «Guardar ficha» aplica también lo que subas aquí.</p>
         </div>
        </div>

        <div class="card">
         <h3>CAFs de folios</h3>
          ${data.faltantes ? Object.entries(data.faltantes).map(([t, lista]) => lista.length ? `
           <div class="checkline warn">Tipo ${t}: falta ${esc(lista.join('; '))}</div>` : '').join('') : ''}
         <div class="tbl-wrap mt"><table class="tbl">
           <thead><tr><th>Tipo</th><th>Rango</th><th class="num">Usados</th><th>Estado</th><th>Cargado</th></tr></thead>
           <tbody>
            ${folios.folios.length ? folios.folios.map((f) => `
             <tr>
               <td>${f.tipo_dte}</td>
               <td>${f.folio_desde}–${f.folio_hasta}</td>
               <td class="num">${f.folios_usados}</td>
               <td>${f.activo ? siNo(true) : siNo(false)}</td>
               <td class="sub">${esc((f.creado_en || '').slice(0, 10))}</td>
             </tr>`).join('') : '<tr><td colspan="5"><div class="empty">Sin CAFs cargados.</div></td></tr>'}
           </tbody>
         </table></div>
         <div class="mt">
           <label class="muted">Cargar CAF (XML del SII)<textarea class="form-input" id="dc-caf" rows="6" placeholder="Pega aquí el XML del CAF descargado del SII"></textarea></label>
           <button class="btn btn-primary mt" id="dc-caf-guardar">Cargar CAF</button>
           <p class="hint mt">El XML del CAF contiene la clave privada de los folios: se valida contra el RUT de la empresa, se guarda CIFRADO y nunca se muestra de nuevo. Recargar el mismo rango es idempotente.</p>
         </div>
        </div>
       </div>
       ${tiene('auditoria:ver') ? `
       <div class="card mt">
         <h3>Últimos cambios del emisor</h3>
          ${historialError ? `<p class="hint" style="color:var(--warning)">No se pudo leer la auditoría: ${esc(historialError)}</p>`
            : historial.length ? `<div class="tbl-wrap"><table class="tbl">
           <thead><tr><th>Fecha</th><th>Cambio</th><th>Campos</th><th>Usuario</th></tr></thead>
           <tbody>${historial.map((r) => `<tr>
             <td class="sub mono">${esc(String(r.creado_en || '').replace('T', ' ').slice(0, 16))}</td>
             <td>${esc(dteAccionLegible(r.accion))}</td>
             <td class="sub">${esc(dteCamposAuditoria(r.despues_json) || '—')}</td>
             <td class="sub">${esc(r.username || '—')}</td>
           </tr>`).join('')}</tbody>
         </table></div><p class="hint mt">De la bitácora de la empresa (últimos 200 movimientos, filtrados a la configuración de emisión). Solo lectura.</p>`
            : '<p class="hint">Sin cambios registrados de la ficha ni de los CAFs.</p>'}
       </div>` : ''}
      ` : `
       <div class="card">
         <h3>Ficha del emisor (solo lectura)</h3>
         <p class="muted">Tu rol no tiene dte:configurar: puedes consultar la ficha y los CAFs, pero no modificarlos.</p>
         <div class="checkline ok">Ambiente: ${v(c && c.ambiente)}</div>
         <div class="checkline ok">Resolución: ${v(c && c.fch_resol)} — Nro ${v(c && c.nro_resol)}</div>
         <div class="checkline ${c && c.tiene_certificado ? 'ok' : 'warn'}">Certificado: ${c && c.tiene_certificado ? 'cargado' : 'sin cargar'}</div>
       </div>`}
    `

    if (!puede) return

    const lectorPfx = () => new Promise((resolve, reject) => {
      const f = document.getElementById('dc-pfx').files[0]
      if (!f) return resolve(null)
      const rd = new FileReader()
      rd.onload = () => resolve(String(rd.result).split(',')[1] || '')
      rd.onerror = () => reject(new Error('No se pudo leer el archivo .pfx'))
      rd.readAsDataURL(f)
    })

    document.getElementById('dc-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('dc-guardar')
      try {
        const pfxB64 = await lectorPfx()
        const pass = document.getElementById('dc-pass').value
        const body = {
          razon_social: document.getElementById('dc-razon').value,
          giro: document.getElementById('dc-giro').value,
          direccion: document.getElementById('dc-dir').value,
          comuna: document.getElementById('dc-com').value,
          acteco: document.getElementById('dc-acteco').value,
          ambiente: document.getElementById('dc-amb').value,
          fch_resol: document.getElementById('dc-fch').value,
          nro_resol: document.getElementById('dc-nro').value,
        }
        if (pfxB64) body.cert_pfx = pfxB64
        if (pass) body.cert_pass = pass
        // ISSUE-003 (qa): no mandar un guardado sin cambios — con el formulario
        // vacío el PUT llevaba solo ambiente y creaba una ficha inútil (todo
        // null) celebrada como éxito. Ficha NUEVA exige al menos un campo de
        // texto (ambiente va siempre elegido: solo no cuenta como contenido);
        // ficha EXISTENTE exige que algo difiera, o certificado/contraseña
        // nuevos (secretos que no se pueden releer).
        const base = c || {}
        const texto = (k) => String(body[k] ?? '').trim()
        const cambia = (k) => texto(k) !== String(base[k] ?? '').trim()
        const campos = ['razon_social', 'giro', 'direccion', 'comuna', 'acteco', 'fch_resol', 'nro_resol']
        const hayCambios = Boolean(pfxB64 || pass)
          || (c ? campos.some(cambia) || body.ambiente !== base.ambiente : campos.some((k) => texto(k) !== ''))
        if (!hayCambios) {
          showToast(c
            ? 'Sin cambios que guardar'
            : 'La ficha está vacía: completa al menos un dato del emisor', 'warning')
          return
        }
        // Reemplazar el certificado es la acción más delicada del módulo: se
        // confirma tecleando el RUT de la empresa (antes se guardaba con un
        // clic, mezclado con los campos comunes — auditoría §2.4).
        if (pfxB64 || pass) {
          const archivo = document.getElementById('dc-pfx').files && document.getElementById('dc-pfx').files[0]
          const rutEmpresa = formatRut(S.empresa.rut || '')
          const ok = await UIEstado.confirmar({
            titulo: 'Reemplazar el certificado de firma',
            texto: 'Reemplazar certificado',
            peligro: true,
            requiere: rutEmpresa,
            idBoton: 'dc-cert-ok',
            cuerpo: `
              <p>El certificado vigente de <b>${esc(S.empresa.nombre)}</b> se reemplaza por el que acabas de subir. Todos los DTE se firmarán con el nuevo.</p>
              <dl>
                ${UIEstado.dato('Archivo', esc(archivo ? archivo.name : 'sin archivo (solo contraseña)'))}
                ${UIEstado.dato('Contraseña', pass ? 'se reemplaza' : 'sin cambio')}
                ${UIEstado.dato('Ambiente', esc(body.ambiente))}
                ${UIEstado.dato('Certificado actual', c && c.tiene_certificado ? 'cargado — se reemplaza' : 'no había')}
              </dl>
              <p class="hint mt">Si la contraseña no calza con el .pfx, la emisión fallará hasta corregirlo: no hay forma de probarlo sin emitir.</p>`,
          })
          if (!ok) return
        }
        btn.disabled = true
        await apiPut(`/api/dte/empresas/${eid}/config`, body)
        showToast('Ficha del emisor guardada', 'success')
        renderRoute()
      } catch (err) {
        btn.disabled = false
        showToast(err.message, 'error')
      }
    })

    document.getElementById('dc-caf-guardar').addEventListener('click', async () => {
      const btn = document.getElementById('dc-caf-guardar')
      btn.disabled = true
      try {
        const xml = document.getElementById('dc-caf').value
        const r = await apiPost(`/api/dte/empresas/${eid}/folios`, { caf_xml: xml })
        showToast(`CAF cargado: tipo ${r.caf.tipo_dte}, folios ${r.caf.folio_desde}–${r.caf.folio_hasta}`, 'success')
        renderRoute()
      } catch (err) {
        btn.disabled = false
        showToast(err.message, 'error')
      }
    })
  },
}

/* ---------------- borrador local del formulario de emisión ----------------
 * El formulario es largo (receptor + ítems + referencia) y antes se perdía
 * todo al cambiar de ruta o cerrar la pestaña (auditoría UX §2.4). El borrador
 * vive SOLO en este navegador y por empresa; se borra al emitir o al pedirlo.
 * No guarda secretos ni el certificado: solo lo que el usuario escribió.
 */

const DTE_BORRADOR_PREFIJO = 'jmv.dte.borrador'

function dteBorradorKey(eid) {
  return `${DTE_BORRADOR_PREFIJO}.${eid}`
}

function dteBorradorLeer(eid) {
  try {
    const raw = localStorage.getItem(dteBorradorKey(eid))
    const b = raw ? JSON.parse(raw) : null
    return b && typeof b === 'object' ? b : null
  } catch { return null }
}

function dteBorradorGuardar(eid, datos) {
  try { localStorage.setItem(dteBorradorKey(eid), JSON.stringify({ ...datos, guardado_en: new Date().toISOString() })) }
  catch { /* cuota o modo privado del navegador: el borrador es una comodidad, el formulario sigue usable */ }
}

function dteBorradorBorrar(eid) {
  try { localStorage.removeItem(dteBorradorKey(eid)) } catch { /* idem */ }
}

VIEWS['dte-emision'] = {
  titulo: 'Emitir DTE',
  async render(cont) {
    const eid = S.empresa.id
    let data
    try {
      data = await apiGet(`/api/dte/empresas/${eid}/config`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }
    const faltantes = data.faltantes || {}

    const tSel = () => document.getElementById('de-tipo').value
    const esNotaSel = () => tSel() === '56' || tSel() === '61'

    cont.innerHTML = `
     <div class="frm-row mb">
       <button class="btn btn-secondary" id="de-volver">← Volver a la bandeja</button>
       <span class="spacer"></span>
       <a class="btn btn-secondary" href="#dte-config">Configuración del emisor</a>
     </div>

      ${Object.entries(faltantes).some(([, l]) => l.length) ? `
       <div class="card" style="border-color:var(--warning);margin-bottom:var(--space-5)">
         <h3>Emisor incompleto</h3>
          ${Object.entries(faltantes).map(([t, lista]) => lista.length ? `
           <div class="checkline warn">Tipo ${t}: ${esc(lista.join('; '))}</div>` : '').join('')}
       </div>` : ''}

     <div class="card">
       <h3>Nuevo documento</h3>
       <div id="de-borrador"></div>
       <div class="frm-row mb">
         <label class="muted">Tipo de documento
           <select class="form-input" id="de-tipo" style="width:auto">
              ${Object.entries(ETIQUETA_TIPO_DTE).map(([t, n]) => `<option value="${t}">${t} — ${n}</option>`).join('')}
           </select>
         </label>
       </div>

       <h3>Receptor</h3>
       <div class="grid-3">
         <label class="muted">RUT<input class="form-input" id="de-rut" placeholder="76123456-0"></label>
         <label class="muted">Razón social<input class="form-input" id="de-rz"></label>
         <label class="muted">Giro<input class="form-input" id="de-giro"></label>
         <label class="muted">Dirección<input class="form-input" id="de-dir"></label>
         <label class="muted">Comuna<input class="form-input" id="de-com"></label>
       </div>

       <div id="de-ref-wrap" class="mt" hidden>
         <h3>Referencia (obligatoria en notas)</h3>
         <p class="muted" style="font-size:var(--fs-sm)">La nota corrige o anula UN documento: indica cuál. CodRef: 1 anula, 2 corrige texto, 3 corrige montos (XSD del SII).</p>
         <div class="grid-3">
           <label class="muted">Tipo doc. referenciado
             <select class="form-input" id="de-ref-tpo">
                ${Object.entries(ETIQUETA_TIPO_DTE).map(([t, n]) => `<option value="${t}">${t} — ${n}</option>`).join('')}
             </select>
           </label>
           <label class="muted">Folio referenciado<input class="form-input" id="de-ref-folio" placeholder="1234"></label>
           <label class="muted">Fecha referencia<input class="form-input" id="de-ref-fch" placeholder="YYYY-MM-DD (opcional)"></label>
           <label class="muted">Código (CodRef)
             <select class="form-input" id="de-ref-cod">
                ${Object.entries(COD_REF_TXT).map(([k, n]) => `<option value="${k}">${k} — ${n}</option>`).join('')}
             </select>
           </label>
           <label class="muted">Razón (RazonRef)<input class="form-input" id="de-ref-razon" placeholder="Motivo de la nota"></label>
         </div>
       </div>

       <h3 class="mt">Ítems</h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Nombre</th><th class="num">Cantidad</th><th class="num">Precio</th><th>Exento</th><th></th></tr></thead>
         <tbody id="de-items"><tr>
           <td><input class="form-input de-nombre"></td>
           <td><input class="form-input de-cant num" type="number" min="0" step="any" value="1"></td>
           <td><input class="form-input de-precio num" type="number" min="0" step="any" value="0"></td>
           <td><input type="checkbox" class="de-exento"></td>
           <td><button class="btn btn-ghost btn-sm de-del" hidden>Quitar</button></td>
         </tr></tbody>
       </table></div>
       <button class="btn btn-ghost btn-sm mt" id="de-add">+ Agregar ítem</button>

       <div class="kpi-grid mt">
         <div class="kpi"><small>Neto</small><strong class="mono" id="de-neto">$0</strong></div>
         <div class="kpi warn"><small>IVA (${TASA_IVA_UI * 100}%)</small><strong class="mono" id="de-iva">$0</strong></div>
         <div class="kpi"><small>Exento</small><strong class="mono" id="de-exento">$0</strong></div>
         <div class="kpi acc"><small>Total</small><strong class="mono" id="de-total">$0</strong></div>
       </div>

       <button class="btn btn-primary btn-lg mt" id="de-emitir">Emitir DTE al SII</button>
       <p class="hint mt">La emisión consume un folio del CAF y envía el sobre al SII (ambiente de la ficha). Una clave de idempotencia acompaña cada envío: un doble click o un reintentar del navegador jamás emite dos veces el mismo documento.</p>
     </div>`

    document.getElementById('de-volver').addEventListener('click', () => { location.hash = '#dte' })

    const refWrap = document.getElementById('de-ref-wrap')
    const syncRef = () => { refWrap.hidden = !esNotaSel() }
    document.getElementById('de-tipo').addEventListener('change', syncRef)
    syncRef()

    const itemRowHTML = () => `
      <tr>
        <td><input class="form-input de-nombre"></td>
        <td><input class="form-input de-cant num" type="number" min="0" step="any" value="1"></td>
        <td><input class="form-input de-precio num" type="number" min="0" step="any" value="0"></td>
        <td><input type="checkbox" class="de-exento"></td>
        <td><button class="btn btn-ghost btn-sm de-del">Quitar</button></td>
      </tr>`
    document.getElementById('de-add').addEventListener('click', () => {
      document.getElementById('de-items').insertAdjacentHTML('beforeend', itemRowHTML())
    })
    document.getElementById('de-items').addEventListener('click', (e) => {
      const btn = e.target.closest('.de-del')
      if (!btn) return
      const tbody = document.getElementById('de-items')
      if (tbody.querySelectorAll('tr').length > 1) btn.closest('tr').remove()
      else showToast('Debe existir al menos un ítem', 'error')
    })

    const recalc = () => {
      let neto = 0, exento = 0
      document.querySelectorAll('#de-items tr').forEach((tr) => {
        const cant = Number(tr.querySelector('.de-cant').value) || 0
        const pre = Number(tr.querySelector('.de-precio').value) || 0
        const monto = Math.round(cant * pre)
        if (tSel() === '34' || tr.querySelector('.de-exento').checked) exento += monto
        else neto += monto
      })
      const iva = neto > 0 ? Math.round(neto * TASA_IVA_UI) : 0
      document.getElementById('de-neto').textContent = fmt(neto)
      document.getElementById('de-iva').textContent = fmt(iva)
      document.getElementById('de-exento').textContent = fmt(exento)
      document.getElementById('de-total').textContent = fmt(neto + iva + exento)
    }
    document.getElementById('de-items').addEventListener('input', recalc)
    document.getElementById('de-tipo').addEventListener('change', recalc)
    recalc()

    // ---- borrador: restaurar, guardar solo si el usuario escribe, descartar ----
    const leerCampos = () => ({
      tipo: tSel(),
      receptor: {
        rut: document.getElementById('de-rut').value,
        razon_social: document.getElementById('de-rz').value,
        giro: document.getElementById('de-giro').value,
        direccion: document.getElementById('de-dir').value,
        comuna: document.getElementById('de-com').value,
      },
      items: [...document.querySelectorAll('#de-items tr')].map((tr) => ({
        nombre: tr.querySelector('.de-nombre').value,
        cantidad: tr.querySelector('.de-cant').value,
        precio: tr.querySelector('.de-precio').value,
        exento: tr.querySelector('.de-exento').checked,
      })),
      referencia: esNotaSel() ? {
        tipo: document.getElementById('de-ref-tpo').value,
        folio: document.getElementById('de-ref-folio').value,
        fecha: document.getElementById('de-ref-fch').value,
        cod: document.getElementById('de-ref-cod').value,
        razon: document.getElementById('de-ref-razon').value,
      } : null,
    })

    const aplicarBorrador = (b) => {
      if (b.tipo && ETIQUETA_TIPO_DTE[b.tipo]) {
        document.getElementById('de-tipo').value = String(b.tipo)
        syncRef()
      }
      const rec = b.receptor || {}
      document.getElementById('de-rut').value = rec.rut || ''
      document.getElementById('de-rz').value = rec.razon_social || ''
      document.getElementById('de-giro').value = rec.giro || ''
      document.getElementById('de-dir').value = rec.direccion || ''
      document.getElementById('de-com').value = rec.comuna || ''
      if (Array.isArray(b.items) && b.items.length && document.getElementById('de-items')) {
        document.getElementById('de-items').innerHTML = b.items.map((it) => `
          <tr>
            <td><input class="form-input de-nombre" value="${esc(it.nombre || '')}"></td>
            <td><input class="form-input de-cant num" type="number" min="0" step="any" value="${esc(it.cantidad ?? 1)}"></td>
            <td><input class="form-input de-precio num" type="number" min="0" step="any" value="${esc(it.precio ?? 0)}"></td>
            <td><input type="checkbox" class="de-exento"${it.exento ? ' checked' : ''}></td>
            <td><button class="btn btn-ghost btn-sm de-del">Quitar</button></td>
          </tr>`).join('')
      }
      const ref = b.referencia
      if (ref && esNotaSel()) {
        document.getElementById('de-ref-tpo').value = String(ref.tipo || '33')
        document.getElementById('de-ref-folio').value = ref.folio || ''
        document.getElementById('de-ref-fch').value = ref.fecha || ''
        document.getElementById('de-ref-cod').value = String(ref.cod || '1')
        document.getElementById('de-ref-razon').value = ref.razon || ''
      }
      recalc()
    }

    const borrador = dteBorradorLeer(eid)
    const tieneContenido = borrador && (
      (borrador.receptor && (borrador.receptor.rut || borrador.receptor.razon_social))
      || (Array.isArray(borrador.items) && borrador.items.some((it) => String(it.nombre || '').trim()))
    )
    if (tieneContenido) {
      aplicarBorrador(borrador)
      const aviso = document.getElementById('de-borrador')
      aviso.innerHTML = `
        <div class="banner-lic" style="background:var(--accent-soft);color:var(--accent)">
          Borrador restaurado${borrador.guardado_en ? ` (guardado el ${esc(String(borrador.guardado_en).slice(0, 16).replace('T', ' '))})` : ''}. Nada se ha enviado al SII.
          <button class="btn btn-secondary btn-sm" id="de-borrador-x" style="margin-left:var(--space-3)">Descartar borrador</button>
        </div>`
      document.getElementById('de-borrador-x').addEventListener('click', () => {
        dteBorradorBorrar(eid)
        showToast('Borrador descartado', 'info')
        renderRoute()
      })
    }

    let guardadoTimer = null
    const programarGuardado = () => {
      clearTimeout(guardadoTimer)
      guardadoTimer = setTimeout(() => dteBorradorGuardar(eid, leerCampos()), 400)
    }
    cont.addEventListener('input', programarGuardado)
    cont.addEventListener('change', programarGuardado)

    // Clave de idempotencia por INTENTO de emisión: sobrevive doble click y
    // reintentos del navegador; se renueva al reabrir el formulario (nuevo DTE).
    const idempotencia = (crypto && crypto.randomUUID) ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`

    document.getElementById('de-emitir').addEventListener('click', async () => {
      const btn = document.getElementById('de-emitir')
      const items = []
      document.querySelectorAll('#de-items tr').forEach((tr) => {
        const nombre = tr.querySelector('.de-nombre').value.trim()
        if (!nombre) return
        items.push({
          nombre,
          cantidad: Number(tr.querySelector('.de-cant').value) || 0,
          precio: Number(tr.querySelector('.de-precio').value) || 0,
          exento: tr.querySelector('.de-exento').checked || undefined,
        })
      })
      const receptor = {
        rut: document.getElementById('de-rut').value.trim(),
        razon_social: document.getElementById('de-rz').value.trim(),
        giro: document.getElementById('de-giro').value.trim(),
        direccion: document.getElementById('de-dir').value.trim(),
        comuna: document.getElementById('de-com').value.trim(),
      }
      const body = { tipo: Number(tSel()), items, receptor, idempotencia }
      if (esNotaSel()) {
        const folioRef = Number(document.getElementById('de-ref-folio').value) || 0
        body.referencia = {
          TpoDocRef: Number(document.getElementById('de-ref-tpo').value),
          FolioRef: folioRef,
          CodRef: Number(document.getElementById('de-ref-cod').value),
          RazonRef: document.getElementById('de-ref-razon').value.trim() || 'Nota de referencia',
          ...(document.getElementById('de-ref-fch').value.trim() ? { FchRef: document.getElementById('de-ref-fch').value.trim() } : {}),
        }
      }
      // Emitir consume un folio del CAF y firma contra el SII: se dice qué se
      // manda (documento, receptor y totales) antes de gastar el folio.
      const ok = await UIEstado.confirmar({
        titulo: `Emitir ${ETIQUETA_TIPO_DTE[body.tipo] || 'DTE'} al SII`,
        texto: 'Emitir DTE',
        idBoton: 'de-emitir-ok',
        cuerpo: `
          <p>Se firmará el documento y se enviará al SII en ambiente <b>${esc(data.config && data.config.ambiente ? data.config.ambiente : 'sin ficha')}</b>. Consume un folio del CAF y no se puede deshacer.</p>
          <dl>
            ${UIEstado.dato('Tipo', `${body.tipo} — ${esc(ETIQUETA_TIPO_DTE[body.tipo] || '')}`)}
            ${UIEstado.dato('Receptor', `${esc(receptor.razon_social || '—')}<br><span class="sub mono">${esc(receptor.rut || 'sin RUT')}</span>`)}
            ${UIEstado.dato('Ítems', String(items.length))}
            ${UIEstado.dato('Neto', `<span class="mono">${document.getElementById('de-neto').textContent}</span>`)}
            ${UIEstado.dato('IVA', `<span class="mono">${document.getElementById('de-iva').textContent}</span>`)}
            ${UIEstado.dato('Exento', `<span class="mono">${document.getElementById('de-exento').textContent}</span>`)}
            ${UIEstado.dato('Total', `<b class="mono">${document.getElementById('de-total').textContent}</b>`)}
          </dl>`,
      })
      if (!ok) return
      btn.disabled = true
      try {
        const r = await apiPost(`/api/dte/empresas/${eid}/emitir`, body)
        if (r.deduplicado) {
          showToast('Este DTE ya había sido emitido — se muestra el original (idempotencia)', 'success')
        } else {
          showToast(`DTE ${r.dte.tipo_dte} folio ${r.dte.folio}: ${r.dte.estado}${r.dte.track_id ? ` — track ${r.dte.track_id}` : ''}`, 'success')
        }
        // Emitido (o deduplicado) → el borrador ya no representa trabajo pendiente.
        dteBorradorBorrar(eid)
        location.hash = '#dte'
      } catch (err) {
        btn.disabled = false
        showToast(err.message, 'error')
      }
    })
  },
}
