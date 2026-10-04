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
    const alertaConfig = Object.values(faltantes).some((arr) => arr.length)

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
        ${puedeEmitir ? `<button class="btn btn-primary" id="dte-sync">Sincronizar contabilidad</button>` : ''}
     </div>

      ${alertaConfig ? `
       <div class="card" style="border-color:var(--warning);margin-bottom:var(--space-5)">
         <h3>Emisor incompleto — lo que falta, por tipo de documento</h3>
          ${Object.entries(faltantes).map(([t, lista]) => lista.length ? `
           <div class="checkline warn">Tipo ${t} (${esc(ETIQUETA_TIPO_DTE[t] || t)}): ${esc(lista.join('; '))}</div>
          ` : '').join('')}
         <p class="hint mt">Completa la ficha del emisor, sube el certificado y carga los CAFs en <a href="#dte-config">Facturación → Configuración</a>. Hasta entonces, la emisión de esos tipos será rechazada nombrando exactamente lo que falta.</p>
       </div>` : ''}

     <div class="kpi-grid">
       <div class="kpi"><small>Aceptados por el SII</small><strong>${porEstado('ACEPTADO')}</strong><span class="sub">${dtes.filter((d) => d.estado === 'ACEPTADO' && !d.asiento_id).length} sin contabilizar vía sincronización</span></div>
       <div class="kpi warn"><small>Enviados / pendientes</small><strong>${porEstado('ENVIADO') + porEstado('PENDIENTE')}</strong><span class="sub">${porEstado('ENVIADO')} esperando consulta SII · ${porEstado('PENDIENTE')} sin track-id</span></div>
       <div class="kpi bad"><small>Rechazados o con error</small><strong>${porEstado('RECHAZADO') + porEstado('ERROR')}</strong><span class="sub">reintento con el mismo folio</span></div>
       <div class="kpi acc"><small>Total emitido (filtro actual)</small><strong>${fmt(dtes.reduce((a, d) => a + (d.monto_total || 0), 0))}</strong><span class="sub">${dtes.length} documento(s) listado(s)</span></div>
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

     <div id="dte-sync-out" class="mt"></div>
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
        const r = await apiPost(`/api/dte/empresas/${eid}/sincronizar-contabilidad`, {})
        const s = r.sincronizacion || {}
        const fila = (label, v) => `<div class="checkline ok">${esc(label)}: <b>&nbsp;${v}</b></div>`
        document.getElementById('dte-sync-out').innerHTML = `
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
        showToast('Sincronización completada', 'ok')
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
        showToast('Reintento enviado al SII con el mismo folio', 'ok')
        renderRoute()
      } catch (err) {
        b.disabled = false
        showToast(err.message, 'error')
      }
    }))
  },
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
         <div class="grid-2 mt">
           <label class="muted">Certificado .pfx (subir archivo)<input type="file" class="form-input" id="dc-pfx" accept=".pfx,.p12"></label>
           <label class="muted">Contraseña del certificado<input type="password" class="form-input" id="dc-pass" placeholder="${c && c.tiene_certificado ? 'sin cambio — dejar vacío conserva la actual' : 'requerida con el certificado'}"></label>
         </div>
         <button class="btn btn-primary mt" id="dc-guardar">Guardar ficha</button>
         <p class="hint mt">El certificado y su contraseña se guardan CIFRADOS en el servidor (bóveda AES-256-GCM) y jamás vuelven al browser. Dejar la contraseña vacía la mantiene sin cambio.</p>
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
      btn.disabled = true
      try {
        const pfxB64 = await lectorPfx()
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
        const pass = document.getElementById('dc-pass').value
        if (pass) body.cert_pass = pass
        await apiPut(`/api/dte/empresas/${eid}/config`, body)
        showToast('Ficha del emisor guardada', 'ok')
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
        showToast(`CAF cargado: tipo ${r.caf.tipo_dte}, folios ${r.caf.folio_desde}–${r.caf.folio_hasta}`, 'ok')
        renderRoute()
      } catch (err) {
        btn.disabled = false
        showToast(err.message, 'error')
      }
    })
  },
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
         <div class="kpi"><small>Neto</small><strong id="de-neto">$0</strong></div>
         <div class="kpi warn"><small>IVA (${TASA_IVA_UI * 100}%)</small><strong id="de-iva">$0</strong></div>
         <div class="kpi"><small>Exento</small><strong id="de-exento">$0</strong></div>
         <div class="kpi acc"><small>Total</small><strong id="de-total">$0</strong></div>
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
      btn.disabled = true
      try {
        const r = await apiPost(`/api/dte/empresas/${eid}/emitir`, body)
        if (r.deduplicado) {
          showToast('Este DTE ya había sido emitido — se muestra el original (idempotencia)', 'ok')
        } else {
          showToast(`DTE ${r.dte.tipo_dte} folio ${r.dte.folio}: ${r.dte.estado}${r.dte.track_id ? ` — track ${r.dte.track_id}` : ''}`, 'ok')
        }
        location.hash = '#dte'
      } catch (err) {
        btn.disabled = false
        showToast(err.message, 'error')
      }
    })
  },
}
