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
  const periodo = window._ctaPeriodo || periodoGlobal()
  const eid = S.empresa.id
  const puedeRevertir = tiene('asientos:revertir')
  const r = await apiGet(`/api/contable/empresas/${eid}/asientos?periodo=${periodo}&limit=200`)
  const asientos = r.asientos || []
  // La reversión es un asiento NUEVO que apunta al original (`asiento_revertido_id`).
  // Con los ids ya apuntados en la página no se ofrece "Revertir" sobre uno que el
  // backend rechazaría ("ya fue revertido por el asiento X"); fuera de la página el
  // aviso real del backend sigue siendo el que manda.
  const revertidos = new Set(asientos.map((a) => Number(a.asiento_revertido_id)).filter(Boolean))
  const folioPorId = new Map(asientos.map((a) => [Number(a.id), a.folio]))
  const chipTipo = (a) => (a.tipo === 'reversion'
    ? `<span class="chip revision" title="Asiento que revierte a otro">reversión${a.asiento_revertido_id ? ` de #${esc(folioPorId.get(Number(a.asiento_revertido_id)) ?? a.asiento_revertido_id)}` : ''}</span>`
    : `<span class="chip ${a.tipo === 'cierre' ? 'propuesto' : 'neutral'}">${esc(a.tipo)}</span>`)
  body.innerHTML = `
   <div class="frm-row mb">
     <div><span class="frm-label">Período</span>${inputPeriodoHTML('cta-periodo', periodo)}</div>
     <span class="sub">${r.total} asiento(s)</span>
     ${(Number(r.total) || 0) > asientos.length ? `<span class="hint">Se muestran los ${asientos.length} más recientes del período.</span>` : ''}
   </div>
    ${asientos.map((a) => {
      const monto = (a.lineas || []).reduce((s, l) => s + l.debe, 0)
      const yaRevertido = revertidos.has(Number(a.id))
      return `
     <div class="card mb" style="padding:var(--space-4)">
       <div class="flex" style="justify-content:space-between;gap:var(--space-2)">
         <div><b class="mono">#${a.folio}</b> · <span class="sub">${esc(a.fecha)}</span> · ${chipTipo(a)}${yaRevertido ? ' <span class="chip anulado">revertido</span>' : ''}</div>
         <div class="flex" style="gap:var(--space-3)">
           <div class="num" style="font-family:var(--font-mono)">${fmtM(monto)}</div>
           ${puedeRevertir && !yaRevertido ? `<button class="btn btn-secondary btn-sm" type="button" data-rev="${Number(a.id)}" aria-label="Revertir asiento ${esc(a.folio)}">Revertir</button>` : ''}
         </div>
       </div>
       <div class="mt" style="font-size:var(--fs-sm)">${esc(a.glosa)}</div>
       <div class="tbl-wrap mt" style="border-radius:var(--radius-md)">
         <table class="tbl">
           <thead><tr><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th><th>Glosa</th></tr></thead>
           <tbody>${(a.lineas || []).map((l) => `<tr>
             <td class="mono sub">${esc(l.cuenta_codigo)} ${esc(l.cuenta_nombre || '')}</td>
             <td class="num">${l.debe ? fmtM(l.debe) : '—'}</td>
             <td class="num">${l.haber ? fmtM(l.haber) : '—'}</td>
             <td class="sub">${esc(l.glosa || '')}</td>
           </tr>`).join('')}</tbody>
         </table>
       </div>
     </div>`
    }).join('') || '<div class="empty">Sin asientos en este período.</div>'}`

  body.querySelectorAll?.('[data-rev]').forEach((b) => b.addEventListener('click', () => {
    const a = asientos.find((x) => Number(x.id) === Number(b.dataset.rev))
    if (a) modalRevertirAsiento(a)
  }))
  document.getElementById('cta-periodo').addEventListener('change', () => {
    const p = leerPeriodo('cta-periodo') || periodo
    aplicarPeriodoGlobal(p)
    escribirHash(location.hash)
    sincronizarSelectorPeriodo(p)
    renderRoute()
  })
}

/**
 * Reversión de un asiento: el backend registra un asiento NUEVO con las patas
 * invertidas y `asiento_revertido_id` apuntando al original (core/asientos.js).
 * La capacidad existía desde FASE 2 sin ninguna entrada en la interfaz: aquí se
 * confirma el alcance (monto, fecha de hoy) antes de escribir y se muestra el
 * mensaje real del backend si ya estaba revertido.
 */
function modalRevertirAsiento(a) {
  const monto = (a.lineas || []).reduce((s, l) => s + (l.debe || 0), 0)
  const hoy = new Date().toISOString().slice(0, 10)
  const glosaSugerida = `Reversión del asiento ${a.folio}/${a.anio ?? ''} — ${a.glosa || ''}`.trim()
  openModal(`
    <h3>Revertir asiento #${esc(a.folio)}</h3>
    <p class="sub">${esc(a.fecha || '—')} · ${esc(a.glosa || '')} · ${fmtM(monto)}</p>
    <p class="hint">Se registra un asiento <b>nuevo</b> con las patas invertidas, fechado hoy (${esc(hoy)}). El original no se borra: queda auditado y un asiento solo se puede revertir una vez.</p>
    <div class="form-group">
      <label class="form-label" for="rev-glosa">Glosa de la reversión (opcional)</label>
      <input id="rev-glosa" class="form-input" maxlength="200" placeholder="${esc(glosaSugerida)}">
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-danger" id="rev-ok">Revertir asiento</button>
    </div>`)
  const ok = document.getElementById('rev-ok')
  if (!ok) return
  ok.addEventListener('click', async () => {
    ok.disabled = true
    try {
      const r = await apiPost(`/api/contable/empresas/${S.empresa.id}/asientos/${a.id}/revertir`, {
        glosa: (document.getElementById('rev-glosa')?.value || '').trim() || null,
      })
      cerrarModal()
      showToast(`Reversión registrada — asiento folio ${r?.asiento?.folio ?? ''}`, 'success')
      renderRoute()
    } catch (err) {
      // El backend explica el motivo exacto (p. ej. "ya fue revertido por ...").
      ok.disabled = false
      showToast(err.message, 'error')
    }
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
    const periodo = window._propPeriodo || periodoGlobal()
    cont.innerHTML = `
     <p class="pg-flow"><b>Flujo:</b> <a href="#documentos">Documentos</a> → Propuestas → <a href="#asientos">Asientos</a> → <a href="#automatizacion">Contabilización</a></p>
     <div class="frm-row mb pg-toolbar">
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
      const p = leerPeriodo('prop-periodo') || periodo
      aplicarPeriodoGlobal(p)
      escribirHash(location.hash)
      sincronizarSelectorPeriodo(p)
      renderRoute()
    })
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      if (e.target.dataset.t) { window._propTab = e.target.dataset.t; renderRoute() }
    })
    const gen = document.getElementById('prop-gen')
    if (gen) gen.addEventListener('click', generarPropuestas)
    const lote = document.getElementById('prop-lote')
    if (lote) lote.addEventListener('click', () => confirmarLotePropuestas(periodo))

    const body = document.getElementById('prop-body')
    if (tab === 'conciliacion') return vistaConciliacion(body, periodo)
    const estadoQ = tab === 'pendientes' ? 'PENDIENTE' : null
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/propuestas?periodo=${periodo}${estadoQ ? `&estado=${estadoQ}` : ''}&limit=200`)
    // Cantidad y monto del FILTRO (no de la página): `sumas` ya viene calculado
    // por el servidor con el mismo where de la lista.
    const totalFiltro = Number(r.total) || (r.propuestas || []).length
    const montoFiltro = Number(r.sumas?.total) || 0
    body.innerHTML = `
     <p class="doc-resumen" role="status">
       <b>${totalFiltro}</b> propuesta(s) ${tab === 'pendientes' ? 'pendientes' : 'en el período'}
       · monto de los documentos <b class="mono">${fmtM(montoFiltro)}</b>
       ${totalFiltro > (r.propuestas || []).length ? `<span class="doc-resumen-nota">la tabla muestra las ${(r.propuestas || []).length} más recientes</span>` : ''}
     </p>
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
              ${p.estado === 'PENDIENTE' && tiene('propuestas:generar') ? `<button class="btn btn-secondary btn-sm" data-no="${p.id}" aria-label="Descartar la propuesta del folio ${esc(p.doc_folio ?? '')}">Descartar</button>` : ''}
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
  const periodo = window._propPeriodo || periodoGlobal()
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

/**
 * Confirmación del lote con ALCANCE antes de escribir: cuántas propuestas y
 * cuánto monto. Antes el botón disparaba el lote a ciegas y el resumen leía
 * `fallidas`, un campo que el backend no devuelve (devuelve `omitidos`), así
 * que las omitidas se informaban siempre como 0.
 */
async function confirmarLotePropuestas(periodo) {
  let r
  try {
    r = await apiGet(`/api/contable/empresas/${S.empresa.id}/propuestas?periodo=${periodo}&estado=PENDIENTE&limit=1000`)
  } catch (err) { return showToast(err.message, 'error') }

  const cantidad = Number(r.total) || (r.propuestas || []).length
  const monto = Number(r.sumas?.total) || 0
  if (!cantidad) return showToast(`No hay propuestas pendientes en ${perDisplay(periodo)}`, 'success')

  openModal(`
    <h3>Confirmar lote del período</h3>
    <p class="sub">${esc(S.empresa.nombre)} · ${esc(perDisplay(periodo))}</p>
    <dl class="doc-dl">
      <div class="doc-dato"><dt>Propuestas pendientes</dt><dd><b class="mono">${cantidad}</b></dd></div>
      <div class="doc-dato"><dt>Monto de los documentos</dt><dd><b class="mono">${fmtM(monto)}</b></dd></div>
    </dl>
    <p class="hint">Cada propuesta se contabiliza por separado con su partida doble. Las que no cuadren (período cerrado, cuentas del plan cambiadas) se omiten y se informan al final: el lote nunca queda aplicado a medias en silencio.</p>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
      <button class="btn btn-primary" id="prop-lote-ok">Contabilizar ${cantidad}</button>
    </div>`)

  document.getElementById('prop-lote-ok')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    try {
      const res = await apiPost(`/api/contable/empresas/${S.empresa.id}/propuestas/confirmar-lote`, { periodo })
      const omitidas = (res.omitidos || []).length
      const detalle = omitidas
        ? ` · ${omitidas} omitida(s): ${(res.omitidos || []).slice(0, 3).map((o) => o.motivo).filter(Boolean).join('; ')}`
        : ''
      showToast(`Lote: ${res.aplicadas ?? 0} contabilizada(s)${detalle}`, omitidas ? 'error' : 'success')
      cerrarModal()
      refrescarPillDocs()
      renderRoute()
    } catch (err) {
      btn.disabled = false
      showToast(err.message, 'error')
    }
  })
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

/* ================ BALANCE DE COMPROBACIÓN (vista propia) ================
 * Era la pestaña "balance" del antiguo #reportes ("Reportes y Cierre").
 * #reportes es ahora el Centro de Reportes; situación/resultados/cierre ya
 * tienen vistas propias (#situacion/#resultados/#cierre), así que el balance
 * de comprobación se conserva íntegro aquí como #comprobacion — misma API
 * (reportes/balance/:periodo) y mismo cuadre ΣD = ΣH del mes y acumulado.
 */

VIEWS.comprobacion = {
  titulo: 'Balance de Comprobación',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(
      body,
      'Balance de comprobación — cuadre ΣD = ΣH, mes y acumulado',
      'comprobacion',
      'Es un <b>control de cuadre</b>, no un estado financiero: muestra sumas y saldos por cuenta. Para la hoja de trabajo con Pérdida/Utilidad abre el <a href="#balance8">Balance de 8 columnas</a>.',
    )
    let r
    try { r = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/balance/${periodo}`)).balance }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const tabla = (b, titulo) => `
     <div class="card mb"><h3>${titulo} <span class="chip ${b.cuadra ? 'contabilizado' : 'error'}">${b.cuadra ? 'Cuadra ΣD = ΣH' : 'DESCUADRE'}</span></h3>
       <div class="tbl-wrap"><table class="tbl">
         <thead><tr><th>Código</th><th>Cuenta</th><th class="num">Debe</th><th class="num">Haber</th></tr></thead>
         <tbody>${b.filas.map((f) => `<tr>
           <td class="mono sub">${esc(f.codigo)}</td><td>${esc(f.nombre)}</td>
           <td class="num">${f.debe ? fmtM(f.debe) : '—'}</td><td class="num">${f.haber ? fmtM(f.haber) : '—'}</td>
         </tr>`).join('')}</tbody>
         <tfoot><tr><td colspan="2">Sumas iguales</td>
           <td class="num">${fmtM(b.debe)}</td><td class="num">${fmtM(b.haber)}</td></tr></tfoot>
       </table></div></div>`
    document.getElementById('rep-body').innerHTML = tabla(r.acumulado, `Acumulado al ${perDisplay(periodo)}`) + tabla(r.periodo_mes, 'Movimientos del mes')
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
    // Con propuestas en pantalla, cerrar con CERO seleccionados cerraría el
    // período sin asientos de cierre (el backend acepta `claves: []`). No es
    // un cierre válido para el usuario: se le dice y no se abre el diálogo.
    if (!claves.length && (cierre.cierres_propuestos || []).length) {
      showToast('Selecciona al menos un asiento de cierre antes de cerrar el período', 'error')
      return
    }
    try {
      const r = await confirmarCierre({ eid, periodo, cierre, claves, forzar })
      if (!r) return // cancelado: no se envió nada
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
  if (btnF) btnF.addEventListener('click', () => ejecutar(true))
}

/**
 * Cierre con confirmación fuerte (F3, auditoría §2.7).
 *
 * Antes era un clic (y `confirm()` para forzar) sobre una acción que genera
 * asientos y bloquea el período: el impacto no se veía. El diálogo lista el
 * alcance real — pendientes, asientos propuestos y monto — y exige teclear el
 * período exacto, para que cerrar el mes equivocado no sea un accidente.
 * No escribe nada por sí solo: devuelve el resultado del POST o null.
 */
async function confirmarCierre({ eid, periodo, cierre, claves = [], forzar = false }) {
  // Solo lo SELECCIONADO: un `claves: []` NO significa "todos" (el backend lo
  // interpreta como "ninguno" y cerraría el período sin asientos de cierre).
  const propuestos = (cierre.cierres_propuestos || []).filter((c) => claves.includes(c.clave))
  if (!propuestos.length && (cierre.cierres_propuestos || []).length) {
    showToast('No hay asientos de cierre seleccionados: el período no se cierra sin asientos', 'error')
    return null
  }
  const totalDebe = propuestos.reduce((s, c) => s + (c.lineas || []).reduce((a, l) => a + (l.debe || 0), 0), 0)
  const ch = cierre.checklist || {}
  const ok = await UIEstado.confirmar({
    titulo: `Cerrar ${perDisplay(periodo)}`,
    texto: forzar ? 'Cerrar de todas formas' : 'Cerrar período',
    peligro: true,
    requiere: periodo,
    idBoton: 'ci-conf-ok',
    cuerpo: `
      <p>Al cerrar se generan los asientos de cierre y el período queda bloqueado para nuevas mutaciones. <b>No se reabre desde la interfaz.</b></p>
      <dl>
        ${UIEstado.dato('Período', `<b class="mono">${esc(periodo)}</b>`)}
        ${UIEstado.dato('Documentos sin contabilizar', ch.documentos_pendientes ? `<b style="color:var(--danger)">${ch.documentos_pendientes}</b> — se cierra con pendientes` : '0')}
        ${UIEstado.dato('Conciliación', ch.conciliacion_ejecutada ? `ejecutada · ${ch.conciliacion_diferencias || 0} diferencia(s), no bloquea` : 'no ejecutada')}
        ${UIEstado.dato('Asientos de cierre', `${propuestos.length}<br><span class="sub">${propuestos.map((c) => esc(c.clave)).join(' · ') || 'ninguno'}</span>`)}
        ${UIEstado.dato('Monto total (Debe)', `<b class="mono">${fmtM(totalDebe)}</b>`)}
      </dl>
      ${forzar ? '<p class="hint mt" style="color:var(--danger)">Forzar: el período se cierra CON documentos pendientes y queda auditado como decisión explícita.</p>' : ''}`,
  })
  if (!ok) return null
  return apiPost(`/api/contable/empresas/${eid}/cierre/${periodo}/ejecutar`, { claves, forzar })
}

/* ==================== CIERRE DE PERÍODO (vista propia) ====================
 * Antes era la pestaña "cierre" de #reportes. Vista dedicada porque es una
 * OPERACIÓN con consecuencias (asientos de cierre + snapshot), no un reporte.
 * La lógica (vistaCierre) se reutiliza intacta: misma API, mismos permisos.
 */

VIEWS.cierre = {
  titulo: 'Cierre de Período',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const periodo = window._cierrePeriodo || window._repPeriodo || periodoGlobal()
    cont.innerHTML = `
     <div class="frm-row mb pg-toolbar">
       <div><span class="frm-label">Período a cerrar</span>${inputPeriodoHTML('cierre-periodo', periodo)}</div>
     </div>
     <div id="cierre-body"><div class="empty">Preparando checklist…</div></div>`
    document.getElementById('cierre-periodo').addEventListener('change', () => {
      window._cierrePeriodo = leerPeriodo('cierre-periodo') || periodo
      renderRoute()
    })
    await vistaCierre(document.getElementById('cierre-body'), window._cierrePeriodo || periodo)
  },
}

/* ==================== AUDITORÍA (vista propia con UITabla) ====================
 * Antes: pestaña dentro de Administración (sigue disponible ahí). Vista propia
 * porque la auditoría es transversal: asientos, documentos, SII, seguridad.
 */

VIEWS.auditoria = {
  titulo: 'Auditoría',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    let r
    try { r = await apiGet(`/api/contable/empresas/${S.empresa.id}/auditoria?limit=200`) }
    catch (err) { cont.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const registros = (r.registros || []).map((a) => ({
      ...a,
      fecha_txt: (a.creado_en || '').replace('T', ' ').slice(0, 16),
      entidad_txt: `${a.entidad || ''} ${a.entidad_id || ''}`.trim(),
      detalle_txt: a.despues_json || a.antes_json || '',
    }))
    cont.innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi"><small>Eventos cargados</small><strong>${registros.length}</strong><span class="sub">últimos 200 del período de retención</span></div>
       <div class="kpi"><small>Usuarios distintos</small><strong>${new Set(registros.map((x) => x.usuario_id)).size}</strong></div>
       <div class="kpi"><small>Acciones distintas</small><strong>${new Set(registros.map((x) => x.accion)).size}</strong></div>
     </div>
     <div id="aud-tabla"></div>`
    UITabla.montar({
      mount: document.getElementById('aud-tabla'),
      // B3 extendido: la bitácora agrupa por acción (clic en el encabezado del
      // grupo colapsa/expande) y congela la fecha al cruzar horizontalmente.
      congelar: true,
      agrupar: { key: 'accion', label: 'acción' },
      agrupadoPorDefecto: false,
      columnas: [
        { key: 'fecha_txt', label: 'Fecha' },
        { key: 'username', label: 'Usuario', valor: (a) => a.username || String(a.usuario_id || '') },
        { key: 'accion', label: 'Acción' },
        { key: 'entidad_txt', label: 'Entidad' },
        { key: 'detalle_txt', label: 'Detalle', buscar: true },
      ],
      filas: registros,
      nombreArchivo: `auditoria-${periodoActual()}`,
      porPagina: 100,
      vacio: 'Sin eventos registrados.',
      filaHTML: (a, hl) => `<tr>
       <td class="sub mono">${hl(a.fecha_txt)}</td>
       <td>${hl(a.username || String(a.usuario_id || ''))}</td>
       <td><span class="chip neutral">${hl(a.accion)}</span></td>
       <td class="sub">${hl(a.entidad_txt)}</td>
       <td class="sub" style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${hl(a.detalle_txt)}</td>
     </tr>`,
    })
  },
}

/* ==================== CENTRO DE REPORTES ====================
 * Antes: 8 botones sueltos en el menú. Ahora un índice con filtros globales
 * (período + estado) que reutiliza las vistas existentes vía atajos.
 * Los grupos sin funcionalidad real hoy (flujo de efectivo, inventario,
 * cobranza por antigüedad) se muestran como "En preparación" — §4 HANDOFF:
 * nada se presenta como implementado si no lo está.
 */

VIEWS.reportes = {
  titulo: 'Centro de Reportes',
  async render(cont) {
    const periodo = window._repPeriodo || periodoGlobal()
    const tienePerm = (p) => tiene(p)
    // Solo reportes REALES en los grupos. Lo que el sistema todavía no calcula
    // vive aparte (bloque «Próximamente» al final): mezclar tarjetas falsas con
    // reales hacía que el usuario buscara funciones inexistentes (auditoría §1.4).
    const grupos = [
      { titulo: 'Contabilidad', items: [
        { hash: '#comprobacion', label: 'Balance de comprobación', desc: 'Sumas y saldos con cuadre ΣD = ΣH (mes y acumulado)' },
        { hash: '#balance8', label: 'Balance de 8 columnas', desc: 'Hoja de trabajo completa con Pérdida/Utilidad' },
        { hash: '#asientos', tabVar: '_ctaTab', tabVal: 'mayor', label: 'Libro mayor', desc: 'Movimientos y saldos por cuenta' },
        { hash: '#cierre', label: 'Cierre del período', desc: 'Checklist, asientos de cierre propuestos y cierre auditado' },
      ] },
      { titulo: 'Estados financieros', items: [
        // La jerarquía se dice en la tarjeta: la presentación OFICIAL es la
        // situación financiera; las otras dos son la misma información abierta
        // para análisis/presentación (auditoría §5: tres vistas que parecían
        // tres verdades distintas).
        { hash: '#situacion', label: 'Estado de situación financiera', desc: 'Presentación oficial · A = P + Patrimonio, con saldos bancarios' },
        { hash: '#resultados', label: 'Estado de resultados', desc: 'Por período y acumulado, con detalle por cuenta' },
        { hash: '#clasificado', label: 'Balance clasificado', desc: 'Variante oficial: corriente / no corriente + capital de trabajo' },
        { hash: '#niif', label: 'Estados NIIF por rubros', desc: 'Variante de presentación por rubros, con mapeo editable' },
      ] },
      { titulo: 'Tributarios', items: [
        { hash: '#analitica', label: 'IVA — dashboard tributario', desc: 'Débito, crédito, determinado anual y por mes' },
        { hash: '#libros', label: 'RCV — libros de compra y venta', desc: 'Documento a documento desde el SII' },
      ] },
      { titulo: 'Clientes y proveedores', items: [
        { hash: '#cclientes', label: 'Cuenta corriente — clientes', desc: 'Cargos, abonos y saldo corrido por cliente' },
        { hash: '#cproveedores', label: 'Cuenta corriente — proveedores', desc: 'Cargos, abonos y saldo corrido por proveedor' },
      ] },
      { titulo: 'Tesorería', items: [
        { hash: '#tesoreria', tabVar: '_tesoTab', tabVal: 'movimientos', label: 'Libro banco', desc: 'Saldo corrido con folio por movimiento' },
        { hash: '#tesoreria', tabVar: '_tesoTab', tabVal: 'conciliacion', label: 'Conciliación bancaria', desc: 'Libro vs cartola, diferencias explicadas' },
      ] },
      { titulo: 'Gestión', items: [
        { hash: '#analitica', label: 'Comparativos anuales', desc: 'Ventas, compras e IVA vs año anterior' },
      ] },
    ]
    const proximos = [
      { label: 'Flujo de efectivo', desc: 'No disponible todavía' },
      { label: 'Cambios en patrimonio', desc: 'No disponible todavía' },
      { label: 'F29', desc: 'No disponible todavía' },
      { label: 'PPM', desc: 'No disponible todavía' },
      { label: 'Antigüedad de saldos', desc: 'No disponible todavía' },
      { label: 'Centros de costo', desc: 'No disponible todavía' },
    ]
    // Favoritos y recientes (§10 mandato): en localStorage, sin backend — son
    // accesos, no módulos nuevos. Cada entrada guarda anchor+tab.
    const KEY_FAV = 'jmv_fav_reports'
    const KEY_REC = 'jmv_recent_reports'
    const leerLista = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]').slice(0, 6) } catch { return [] } }
    const favs = leerLista(KEY_FAV)
    const recientes = leerLista(KEY_REC)
    const firma = (it) => it.hash + (it.tabVal ? `@${it.tabVal}` : '')
    const esFav = (it) => favs.some((f) => (typeof f === 'string' ? f : f.hash) === firma(it))
    // registrar 'recientes' al abrir un reporte real (no al cargar el centro)
    const registrarReciente = (it) => {
      if (!it || !it.hash) return
      try {
        const lista = leerLista(KEY_REC).filter((r) => (typeof r === 'string' ? r : r.hash) !== firma(it))
        lista.unshift({ hash: it.hash, tabVar: it.tabVar, tabVal: it.tabVal, label: it.label })
        localStorage.setItem(KEY_REC, JSON.stringify(lista.slice(0, 6)))
      } catch { /* localStorage lleno/bloqueado: no fatalo */ }
    }

    cont.innerHTML = `
     <div class="frm-row mb">
       <div><span class="frm-label">Período de trabajo</span>${inputPeriodoHTML('rep-periodo-global', periodo)}</div>
       <div style="min-width:220px"><span class="frm-label">Buscar reporte</span><input id="rep-buscar" type="search" class="form-input" placeholder="p. ej. balance, IVA, clientes…" style="width:100%"></div>
       <span class="hint" style="align-self:end">Los reportes abren con este período preseleccionado.</span>
     </div>
     <p class="hint" id="rep-jerarquia">Este Centro es el catálogo único de reportes: cada uno se abre desde aquí con el período ya puesto. En los estados financieros, la <b>presentación oficial</b> es la Situación Financiera; el Balance clasificado y los estados NIIF son variantes de la misma información.</p>
     <div id="rep-filas">
     ${favs.length ? `
       <div class="card mb">
         <h3>Favoritos</h3>
         <div class="rep-grid">
           ${favs.map((f) => {
             const h = typeof f === 'string' ? f : f.hash
             const tv = typeof f === 'string' ? null : f.tabVar
             const tvl = typeof f === 'string' ? null : f.tabVal
             const lbl = typeof f === 'string' ? h : (f.label || h)
             return `<a class="rep-card" href="${h}"${tv ? ` data-tabvar="${tv}" data-tabval="${tvl}"` : ''}><b>${esc(lbl)}</b><span class="chip neutral">favorito</span></a>`
           }).join('')}
         </div>
       </div>` : ''}
     ${recientes.length && !favs.length ? `
       <div class="card mb">
         <h3>Recientes</h3>
         <div class="rep-grid">
           ${recientes.map((f) => {
             const h = typeof f === 'string' ? f : f.hash
             const tv = typeof f === 'string' ? null : f.tabVar
             const tvl = typeof f === 'string' ? null : f.tabVal
             const lbl = typeof f === 'string' ? h : (f.label || h)
             return `<a class="rep-card" href="${h}"${tv ? ` data-tabvar="${tv}" data-tabval="${tvl}"` : ''}><b>${esc(lbl)}</b><span class="chip neutral">reciente</span></a>`
           }).join('')}
         </div>
       </div>` : ''}
     ${grupos.map((g) => `
       <div class="card mb rep-grupo" data-grupo="${esc(g.titulo.toLowerCase())}">
         <h3>${esc(g.titulo)}</h3>
         <div class="rep-grid">
           ${g.items.map((it) => it.hash
             ? `<a class="rep-card" href="${it.hash}" data-firma="${esc(firma(it))}"${it.tabVar ? ` data-tabvar="${it.tabVar}" data-tabval="${it.tabVal}"` : ''}><b>${esc(it.label)}</b><span>${esc(it.desc)}</span><button type="button" class="rep-fav" title="Favorito" aria-label="Alternar favorito" data-firma="${esc(firma(it))}" style="background:none;border:none;cursor:pointer;color:${esFav(it) ? 'var(--accent)' : 'var(--fg-muted)'};font-weight:700;padding:0 4px">${esFav(it) ? '★' : '☆'}</button></a>`
             : `<div class="rep-card rep-card-off"><b>${esc(it.label)}</b><span class="chip neutral">${esc(it.desc)}</span></div>`).join('')}
         </div>
       </div>`).join('')}
       <div class="card mb rep-grupo rep-proximos" data-grupo="próximamente">
         <h3>Próximamente <span class="chip neutral">no disponible</span></h3>
         <p class="hint" style="margin-top:-6px">Estas funciones NO existen todavía en el sistema. Se listan separadas de los reportes reales para que la navegación no prometa lo que no se calcula; no son enlaces.</p>
         <div class="rep-grid">
           ${proximos.map((it) => `<div class="rep-card rep-card-off"><b>${esc(it.label)}</b><span class="chip neutral">${esc(it.desc)}</span></div>`).join('')}
         </div>
       </div>
     </div>
     <div id="rep-sin-resultados" style="display:none">${window.UIEstado ? UIEstado.vacio('Ningún reporte coincide con la búsqueda', 'Prueba con otro término: balance, IVA, clientes, banco…', '') : ''}</div>`
    document.getElementById('rep-periodo-global').addEventListener('change', () => {
      window._repPeriodo = leerPeriodo('rep-periodo-global') || periodo
      // Propaga el período del centro a los reportes que lo respetan.
      window._balance8Periodo = window._repPeriodo; window._clasificadoPeriodo = window._repPeriodo
      window._situacionPeriodo = window._repPeriodo; window._resultadosPeriodo = window._repPeriodo
      window._inicioPeriodo = window._repPeriodo
      localStorage.setItem('iva_periodo_activo', window._repPeriodo)
      renderRoute()
    })
    // Búsqueda client-side sobre las tarjetas (§10): filtra por label/desc y
    // muestra estado vacío del bloque cuando nada coincide.
    const inputBuscar = document.getElementById('rep-buscar')
    if (inputBuscar) inputBuscar.addEventListener('input', () => {
      const q = inputBuscar.value.trim().toLowerCase()
      let visibles = 0
      cont.querySelectorAll('.rep-grupo').forEach((grp) => {
        let grupoVisibles = 0
        grp.querySelectorAll('.rep-card').forEach((card) => {
          const texto = (card.textContent || '').toLowerCase()
          const ok = !q || texto.includes(q)
          card.style.display = ok ? '' : 'none'
          if (ok && !card.classList.contains('rep-card-off')) grupoVisibles += 1
        })
        grp.style.display = grupoVisibles || !q ? '' : 'none'
        visibles += grupoVisibles
      })
      const sin = document.getElementById('rep-sin-resultados')
      if (sin) sin.style.display = (q && visibles === 0) ? '' : 'none'
    })

    // Favoritos: toggle persistente (localStorage) — el click del botón NO
    // navega (stopPropagation + preventDefault del anchor).
    cont.querySelectorAll('button.rep-fav').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const firmaBtn = btn.dataset.firma
        const lista = (() => { try { return JSON.parse(localStorage.getItem(KEY_FAV) || '[]') } catch { return [] } })()
        const idx = lista.findIndex((f) => (typeof f === 'string' ? f : f.hash) === firmaBtn)
        if (idx >= 0) lista.splice(idx, 1)
        else {
          // guarda la fila completa (label/tab) para re-render de la sección Favoritos
          const src = btn.closest('.rep-card')
          lista.unshift({ hash: firmaBtn.split('@')[0], tabVal: firmaBtn.includes('@') ? firmaBtn.split('@')[1] : null, label: src ? (src.querySelector('b')?.textContent || firmaBtn) : firmaBtn })
        }
        try { localStorage.setItem(KEY_FAV, JSON.stringify(lista.slice(0, 6))) } catch { /* lleno */ }
        renderRoute()
      })
    })

    // Recientes: registrar al navegar a un reporte real (click en tarjeta con hash)
    cont.querySelectorAll('a.rep-card[href]').forEach((a) => {
      a.addEventListener('click', () => {
        const firmaA = a.dataset.firma || a.getAttribute('href')
        const item = { hash: a.getAttribute('href'), tabVar: a.dataset.tabvar, tabVal: a.dataset.tabval, label: a.querySelector('b')?.textContent || '' }
        try {
          const lista = leerLista(KEY_REC).filter((r) => (typeof r === 'string' ? r : r.hash) !== firmaA)
          lista.unshift(item)
          localStorage.setItem(KEY_REC, JSON.stringify(lista.slice(0, 6)))
        } catch { /* lleno */ }
        if (a.dataset.tabvar) window[a.dataset.tabvar] = a.dataset.tabval
      })
    })
  },
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
       <button data-t="seguridad" class="${tab === 'seguridad' ? 'active' : ''}">Seguridad</button>
     </div>
     <div id="adm-body"></div>`
    cont.querySelector('.tabs').addEventListener('click', (e) => {
      if (e.target.dataset.t) { window._admTab = e.target.dataset.t; renderRoute() }
    })
    const body = document.getElementById('adm-body')
    if (tab === 'periodos') return admPeriodos(body)
    if (tab === 'usuarios' && S.user.is_admin) return admUsuarios(body)
    if (tab === 'auditoria') return admAuditoria(body)
    if (tab === 'seguridad') return admSeguridad(body)
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
     <h3>Nueva empresa — solo RUT y clave SII</h3>
     <p class="sub">El sistema ingresa al SII con esa clave, extrae la ficha oficial del contribuyente (razón social, inicio de actividades, régimen, actividad, domicilio, contacto) y deja la empresa creada con todo eso. La clave se guarda cifrada (bóveda AES-256-GCM) y el plan de cuentas se precarga. Solo falta confirmar socios e histórico de documentos.</p>
     <div class="form-group"><label class="frm-label">RUT del contribuyente</label><input id="ne-rut" class="form-input" placeholder="76.123.456-7" autocomplete="off"></div>
     <div class="form-group"><label class="frm-label">Clave SII (tributaria)</label><input id="ne-clave" type="password" class="form-input" placeholder="Tu clave de 3ra clave del SII" autocomplete="new-password"></div>
     <div class="login-err" id="ne-err" hidden></div>
     <div class="modal-foot">
       <button class="btn btn-secondary" onclick="cerrarModal()">Cancelar</button>
       <button class="btn btn-primary" id="ne-ok">Consultar SII y crear</button>
     </div>`)
    document.getElementById('ne-ok').addEventListener('click', async () => {
      const btnOk = document.getElementById('ne-ok')
      const err = document.getElementById('ne-err')
      const raiz = document.querySelector('.modal-card')
      err.hidden = true
      const v = UIForms.validar(raiz, {
        'ne-rut': [['requerido'], ['rut']],
        'ne-clave': [['requerido'], [['min', 4]]],
      })
      if (!v.ok) return
      const rut = document.getElementById('ne-rut').value.trim()
      const clave = document.getElementById('ne-clave').value
      btnOk.disabled = true
      btnOk.textContent = 'Consultando el SII…'
      try {
        const r = await apiPost('/api/contable/empresas/desde-sii', { rut, clave_sii: clave })
        showToast(`Empresa creada: ${r.nombre} (RUT ${formatRut(r.rut)})`, 'success')
        cerrarModal()
        boot()
      } catch (ex) {
        err.textContent = ex.message
        err.hidden = false
        btnOk.disabled = false
        btnOk.textContent = 'Consultar SII y crear'
      }
    })
  })
}

/* P5 (BLOQUE 1bis): cambio de contraseña propio + revocación de sesiones. */
async function admSeguridad(body) {
  body.innerHTML = `
   <div class="card" style="max-width:520px">
     <h3>Cambiar contraseña</h3>
     <p class="hint" style="margin:0 0 var(--space-4)">Al cambiarla se cierran TODAS tus sesiones (incluida esta) y deberás volver a ingresar.</p>
     <div class="form-group"><label class="frm-label" for="pw-actual">Contraseña actual</label>
       <input id="pw-actual" type="password" class="form-input" autocomplete="current-password"></div>
     <div class="form-group"><label class="frm-label" for="pw-nueva">Nueva contraseña (mínimo 8 caracteres)</label>
       <input id="pw-nueva" type="password" class="form-input" autocomplete="new-password"></div>
     <div class="form-group"><label class="frm-label" for="pw-conf">Confirmar nueva contraseña</label>
       <input id="pw-conf" type="password" class="form-input" autocomplete="new-password"></div>
     <div class="login-err" id="pw-err" hidden style="margin:var(--space-3) 0"></div>
     <div class="login-err" id="pw-ok" hidden style="margin:var(--space-3) 0;background:var(--success-soft);color:var(--success)">Contraseña actualizada. Se cerraron todas tus sesiones; redirigiendo al login…</div>
     <button class="btn btn-primary" id="pw-btn">Cambiar contraseña</button>
   </div>`
  document.getElementById('pw-btn').addEventListener('click', async () => {
    const err = document.getElementById('pw-err')
    const ok = document.getElementById('pw-ok')
    const btn = document.getElementById('pw-btn')
    const actual = document.getElementById('pw-actual').value
    const nueva = document.getElementById('pw-nueva').value
    const conf = document.getElementById('pw-conf').value
    err.hidden = true
    if (!actual || !nueva) { err.textContent = 'Completa todos los campos.'; err.hidden = false; return }
    if (nueva.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; err.hidden = false; return }
    if (nueva !== conf) { err.textContent = 'La confirmación no coincide con la nueva contraseña.'; err.hidden = false; return }
    btn.disabled = true
    btn.textContent = 'Procesando…'
    try {
      const r = await apiPost('/api/auth/password', { password_actual: actual, password_nueva: nueva })
      ok.hidden = false
      showToast(r.mensaje || 'Contraseña actualizada', 'success')
      localStorage.removeItem('iva_empresa_activa')
      setTimeout(() => renderLogin(r.mensaje || 'Contraseña actualizada. Ingresa con tu nueva contraseña.'), 1200)
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
      btn.disabled = false
      btn.textContent = 'Cambiar contraseña'
    }
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
         <thead><tr><th>Usuario</th><th>Estado</th><th>Alta</th><th>Acciones</th></tr></thead>
         <tbody>${(us.usuarios || []).map((u) => `<tr data-uid="${u.id}">
           <td><b>${esc(u.username)}</b>${u.is_admin ? ' <span class="chip clasificado">admin</span>' : ''}</td>
           <td><span class="chip ${u.activo ? 'contabilizado' : 'anulado'}">${u.activo ? 'activo' : 'inactivo'}</span></td>
           <td class="sub mono">${esc((u.creado_en || '').slice(0, 10))}</td>
           <td>
             <button class="btn btn-secondary btn-sm" data-modo="reset" data-uid="${u.id}" ${u.id === S.user.id ? 'disabled title="Usa el cambio de clave normal"' : ''}>Reset clave</button>
             ${u.activo
               ? `<button class="btn btn-secondary btn-sm" data-modo="desactivar" data-uid="${u.id}" ${u.id === S.user.id ? 'disabled title="No puedes desactivar tu propia cuenta"' : ''}>Desactivar</button>`
               : `<button class="btn btn-secondary btn-sm" data-modo="reactivar" data-uid="${u.id}">Reactivar</button>`}
             <button class="btn btn-secondary btn-sm" data-modo="definitivo" data-uid="${u.id}" ${u.id === S.user.id ? 'disabled' : ''}>Eliminar</button>
           </td>
         </tr>`).join('')}</tbody>
       </table></div>
       <p class="sub">Reset clave → genera provisional nueva (se muestra una vez, el usuario la cambia al entrar). Desactivar → conservado para historial. Eliminar → irrecuperable y auditado; no se puede borrar al admin principal ni a ti mismo.</p>
       <div class="frm-row mt">
         <input id="us-new" class="form-input" placeholder="usuario nuevo" style="width:150px">
         <input id="us-pass" class="form-input" type="password" placeholder="contraseña (8+)" style="width:170px">
         <button class="btn btn-primary btn-sm" id="us-add">Crear usuario</button>
       </div>
       <h3 class="mt">Cliente con acceso exclusivo a su empresa</h3>
       <p class="sub">Ingresa el correo del cliente: el sistema genera una clave provisional (se muestra una sola vez), el usuario la cambia en su primer login, y luego ingresa RUT + clave SII para que su empresa se forme sola desde el SII. Quedará ligado a esa empresa y a ninguna otra.</p>
       <div class="frm-row mt">
         <input id="us-cli" class="form-input" placeholder="correo del cliente" style="width:220px">
         <button class="btn btn-primary btn-sm" id="us-cli-add">Crear con clave provisional</button>
       </div>
       <div id="us-cli-resultado" class="mt"></div>
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
   </div>
   <div class="card mt">
     <h3>Perfiles de usuario — qué puede hacer cada uno</h3>
     <p class="sub">Un PERFIL (rol) define qué capacidades tiene el usuario DENTRO de cada empresa. Un mismo usuario puede tener roles distintos en empresas distintas (ej: contador en tu despacho, auditor en otra). El rol lo asigna el super admin desde esta pantalla.</p>
     <div class="tbl-wrap"><table class="tbl">
       <thead><tr><th>Perfil</th><th>Para quién</th><th>Puede</th><th>No puede</th></tr></thead>
       <tbody>
         <tr><td><b>super_admin</b></td><td>JMV (dueño del sistema)</td><td>TODO: crear empresas y usuarios, perfiles, licencias, DTE, todas las empresas</td><td>—</td></tr>
         <tr><td><b>contador</b></td><td>El contador JMV que atiende al cliente</td><td>Conta completa: clasificar, contabilizar, cerrar período, conciliar, tesorería, activos, emitir DTEs de sus clientes, ver auditoría</td><td>Crear/eliminar usuarios del sistema ni licencias</td></tr>
         <tr><td><b>admin_empresa</b></td><td>El dueño de la empresa cliente</td><td>SU empresa: onboarding SII, traer su histórico, ver reportes, configurar SU emisor DTE, pagar SU suscripción, editar su ficha</td><td>Ver OTRAS empresas, cerrar período, operar tesorería</td></tr>
         <tr><td><b>auditor</b></td><td>Revisión externa (fiscalizador, SII, contador externo)</td><td>SOLO LECTURA de todo: documentos, asientos, reportes, banco</td><td>Nada de escritura: sin clasificar, sin contabilizar, sin emitir</td></tr>
         <tr><td><b>tesorería</b></td><td>Asistente de pagos/cobranzas de la empresa</td><td>Bancos, libro banco, conciliación bancaria, reportes</td><td>Contabilizar, emitir DTE, registros de compras/ventas</td></tr>
       </tbody>
     </table></div>
     <p class="sub">El rol se asigna POR EMPRESA en «Roles en [empresa]» arriba. Un super_admin también necesita una empresa activa para ver datos; por eso el selector de empresa muestra todas cuando es super_admin.</p>
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

  // Acciones por usuario: reset de clave, desactivar/reactivar, eliminar definitivo.
  document.querySelectorAll('#adm-body button[data-modo]').forEach((b) => {
    b.addEventListener('click', async () => {
      const uid = b.dataset.uid
      const modo = b.dataset.modo
      const nombre = b.closest('tr')?.querySelector('td b')?.textContent || `usuario ${uid}`
      if (modo === 'definitivo') {
        if (!confirm(`¿ELIMINAR DEFINITIVAMENTE a ${nombre}? Esta acción es irrecuperable (borra auditoría, sesiones y roles). Préferible desactivar si solo pausa el acceso.`)) return
      } else if (modo === 'desactivar') {
        if (!confirm(`¿Desactivar a ${nombre}? Sus sesiones vivas se cierran y no podrá entrar, pero los datos se conservan.`)) return
      }
      const out = document.getElementById('us-cli-resultado')
      try {
        if (modo === 'reset') {
          const r = await apiPost(`/api/auth/usuarios/${uid}/reset-clave`, {})
          out.innerHTML = `
            <div class="card" style="border:1px solid var(--ok)">
              <h3>🔑 Clave de ${esc(r.username)} reseteada</h3>
              <p>Clave provisional (muéstrala al usuario, no queda registrada):</p>
              <p style="font-family:var(--mono);font-size:1.15rem"><b>${esc(r.clave_provisional)}</b></p>
              <p class="sub">El usuario la cambia de inmediato en su próximo login y sigue su flujo normal.</p>
            </div>`
        } else if (modo === 'desactivar') {
          await apiDelete(`/api/auth/usuarios/${uid}`)
          showToast('Usuario desactivado', 'success')
          renderRoute()
        } else if (modo === 'reactivar') {
          await apiPost(`/api/auth/usuarios/${uid}/reactivar`, {})
          showToast('Usuario reactivado', 'success')
          renderRoute()
        } else if (modo === 'definitivo') {
          await apiDelete(`/api/auth/usuarios/${uid}/definitivo`)
          showToast('Usuario eliminado definitivamente', 'success')
          renderRoute()
        }
      } catch (err) { showToast(err.message, 'error') }
    })
  })
  document.getElementById('us-cli-add').addEventListener('click', async () => {
    const email = document.getElementById('us-cli').value.trim()
    const out = document.getElementById('us-cli-resultado')
    out.innerHTML = ''
    try {
      const r = await apiPost('/api/auth/usuarios-empresa', { username: email })
      showToast('Cliente creado con clave provisional', 'success')
      out.innerHTML = `
        <div class="card" style="border:1px solid var(--ok)">
          <h3>✅ ${esc(r.username)} creado — id ${r.usuarioId}</h3>
          <p>Clave provisional (muéstrala SOLO a tu cliente, no quede registrada en el sistema):</p>
          <p style="font-family:var(--mono); font-size:1.15rem; letter-spacing:.5px"><b>${esc(r.clave_provisional)}</b></p>
          <p class="sub">El cliente entra con esta clave, se le exigirá cambiarla de inmediato, y luego ingresa RUT + clave SII para formar su empresa.</p>
        </div>`
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

function vistaPeriodoPlantilla(body, titulo, vistaKey, nota = '') {
  const periodo = window[`_${vistaKey}Periodo`] || window._repPeriodo || periodoGlobal()
  body.innerHTML = `
   <div class="frm-row mb">
     <div><span class="frm-label">Período</span>${inputPeriodoHTML('rep-periodo', periodo)}</div>
     <span class="sub">${esc(titulo)} — acumulado al último día del mes</span>
   </div>
   ${nota ? `<p class="hint" id="rep-nota">${nota}</p>` : ''}
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
    const periodo = vistaPeriodoPlantilla(
      body,
      'Balance de 8 columnas',
      'balance8',
      'Es la <b>hoja de trabajo</b> (saldos, movimientos y resultado). Si solo necesitas verificar que el mayor cuadra, usa el <a href="#comprobacion">Balance de comprobación</a>.',
    )
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
       <div id="b8-tabla" class="mt"></div>
       <p class="hint mt">El cuadre clásico de la hoja de trabajo: saldos deudores + pérdidas = saldos acreedores + utilidades. Las columnas Pérdida/Utilidad muestran el neto de las cuentas de resultado (ingresos, costos y gastos) pendientes de cierre.</p>
     </div>`
    const colNum8 = (key, label) => ({ key, label, num: true, valor: (f) => (f[key] ? fmtM(f[key]) : '—'), crudo: (f) => f[key] || 0 })
    UITabla.montar({
      mount: document.getElementById('b8-tabla'),
      // B3 extendido: 8 columnas numéricas — código/cuenta congeladas al cruzar.
      congelar: true,
      columnas: [
        { key: 'codigo', label: 'Código' },
        { key: 'nombre', label: 'Cuenta' },
        colNum8('anterior_deudor', 'Ant. Deudor'),
        colNum8('anterior_acreedor', 'Ant. Acreedor'),
        colNum8('debe', 'Débitos'),
        colNum8('haber', 'Créditos'),
        colNum8('saldo_deudor', 'Saldo Deudor'),
        colNum8('saldo_acreedor', 'Saldo Acreedor'),
        colNum8('perdida', 'Pérdida'),
        colNum8('utilidad', 'Utilidad'),
      ],
      filas: b.filas,
      nombreArchivo: `balance8-${periodo}`,
      porPagina: 100,
      vacio: 'Sin movimientos en este período.',
      filaHTML: (f, hl) => `<tr>
       <td class="mono sub">${hl(f.codigo)}</td><td>${hl(f.nombre)}</td>
       ${['anterior_deudor', 'anterior_acreedor', 'debe', 'haber', 'saldo_deudor', 'saldo_acreedor', 'perdida', 'utilidad'].map((k) => `<td class="num">${f[k] ? fmtM(f[k]) : '—'}</td>`).join('')}
     </tr>`,
      totalesHTML: `<tr>
         <td colspan="2"><b>SUMAS IGUALES</b></td>
         <td class="num">${fmtM(s.anterior_deudor)}</td><td class="num">${fmtM(s.anterior_acreedor)}</td>
         <td class="num">${fmtM(s.debe)}</td><td class="num">${fmtM(s.haber)}</td>
         <td class="num">${fmtM(s.saldo_deudor)}</td><td class="num">${fmtM(s.saldo_acreedor)}</td>
         <td class="num">${fmtM(s.perdida)}</td><td class="num">${fmtM(s.utilidad)}</td>
       </tr>`,
    })
  },
}

VIEWS.clasificado = {
  titulo: 'Balance Clasificado',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(
      body,
      'Balance clasificado',
      'clasificado',
      'Mismos saldos que la <a href="#situacion">Situación Financiera</a> (la presentación oficial), abiertos en corriente / no corriente con capital de trabajo.',
    )
    let c
    try { c = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/clasificado/${periodo}`)).clasificado }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const tablasClasif = []
    let seqSec = 0
    const seccion = (titulo, filas, total) => {
      const id = `clasif-${++seqSec}`
      if (filas.length) tablasClasif.push({ id, filas })
      return `
     <div class="card mb">
       <h3>${esc(titulo)} <span class="num" style="float:right;font-family:var(--font-mono)">${fmtM(total)}</span></h3>
        ${filas.length ? `<div id="${id}" class="mt"></div>` : '<p class="hint mt">Sin saldos en esta sección.</p>'}
     </div>`
    }
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
    for (const t of tablasClasif) {
      UITabla.montar({
        mount: document.getElementById(t.id),
        columnas: [
          { key: 'codigo', label: 'Código' },
          { key: 'nombre', label: 'Cuenta' },
          { key: 'saldo', label: 'Saldo', num: true, valor: (f) => fmtM(f.saldo), crudo: (f) => f.saldo },
        ],
        filas: t.filas,
        nombreArchivo: `balance-clasificado-${periodo}`,
        vacio: 'Sin saldos en esta sección.',
        filaHTML: (f, hl) => `<tr><td class="mono sub">${hl(f.codigo)}</td><td>${hl(f.nombre)}</td><td class="num">${fmtM(f.saldo)}</td></tr>`,
      })
    }
  },
}

VIEWS.situacion = {
  titulo: 'Situación Financiera',
  async render(cont) {
    cont.innerHTML = '<div class="empty">Cargando…</div>'
    const body = cont
    const periodo = vistaPeriodoPlantilla(
      body,
      'Estado de situación financiera',
      'situacion',
      'Es la <b>presentación oficial</b> (A = P + Patrimonio). El <a href="#clasificado">Balance clasificado</a> y los <a href="#niif">estados NIIF por rubros</a> son variantes de la misma información para análisis y presentación.',
    )
    let s
    try { s = (await apiGet(`/api/contable/empresas/${S.empresa.id}/reportes/situacion/${periodo}`)).situacion }
    catch (err) { document.getElementById('rep-body').innerHTML = `<div class="empty">${esc(err.message)}</div>`; return }
    const tablasSit = []
    let seqSit = 0
    const tabla = (titulo, filas, total) => {
      const id = `sit-${++seqSit}`
      if (filas.length) tablasSit.push({ id, filas, titulo })
      return `
     <div class="card mb"><h3>${esc(titulo)} <span class="num" style="float:right;font-family:var(--font-mono)">${fmtM(total)}</span></h3>
        ${filas.length ? `<div id="${id}" class="mt"></div>` : '<p class="hint mt">Sin saldos.</p>'}
     </div>`
    }
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
    for (const t of tablasSit) {
      UITabla.montar({
        mount: document.getElementById(t.id),
        columnas: [
          { key: 'codigo', label: 'Código' },
          { key: 'nombre', label: 'Cuenta' },
          { key: 'saldo', label: 'Saldo', num: true, valor: (f) => fmtM(f.saldo), crudo: (f) => f.saldo },
        ],
        filas: t.filas,
        nombreArchivo: `situacion-${t.titulo.toLowerCase()}-${periodo}`,
        vacio: 'Sin saldos.',
        filaHTML: (f, hl) => `<tr><td class="mono sub">${hl(f.codigo)}</td><td>${hl(f.nombre)}</td><td class="num">${fmtM(f.saldo)}</td></tr>`,
      })
    }
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
    const tablasRes = []
    const bloque = (titulo, d, idx) => {
      const id = `res-${idx}`
      const filas = [
        ...d.detalle.ingresos.map((f) => ({ ...f, signo: 1, claseTxt: 'Ingreso' })),
        ...d.detalle.costos.map((f) => ({ ...f, signo: -1, claseTxt: 'Costo' })),
        ...d.detalle.gastos.map((f) => ({ ...f, signo: -1, claseTxt: 'Gasto' })),
      ]
      tablasRes.push({ id, filas, d })
      return `
     <div class="card mb"><h3>${esc(titulo)}</h3>
       <div id="${id}" class="mt"></div>
     </div>`
    }
    document.getElementById('rep-body').innerHTML = `
     <div class="kpi-grid mb">
       <div class="kpi up"><small>Ingresos del mes</small><strong>${fmtM(r.periodo_mes.ingresos)}</strong></div>
       <div class="kpi ${r.periodo_mes.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado del mes</small><strong>${fmtM(r.periodo_mes.resultado)}</strong></div>
       <div class="kpi ${r.acumulado.resultado >= 0 ? 'up' : 'bad'}"><small>Resultado acumulado</small><strong>${fmtM(r.acumulado.resultado)}</strong><span class="sub">${esc(r.rango_acumulado.desde)} → ${esc(r.rango_acumulado.hasta)}</span></div>
     </div>
      ${bloque('Del período ' + r.periodo, r.periodo_mes, 1)}
      ${bloque('Acumulado del año ' + r.anio, r.acumulado, 2)}`
    for (const t of tablasRes) {
      UITabla.montar({
        mount: document.getElementById(t.id),
        // B3 extendido: congela código/cuenta en los dos bloques del ER.
        congelar: true,
        columnas: [
          { key: 'codigo', label: 'Código' },
          { key: 'nombre', label: 'Cuenta' },
          { key: 'clase', label: 'Clase', orden: false, valor: (f) => f.claseTxt },
          { key: 'saldo', label: 'Saldo', num: true, valor: (f) => (f.signo === 1 ? fmtM(f.saldo) : `(−) ${fmtM(f.saldo)}`), crudo: (f) => f.signo * f.saldo },
        ],
        filas: t.filas,
        nombreArchivo: `resultados-${t.d === r.periodo_mes ? 'periodo-' + r.periodo : 'acumulado-' + r.anio}`,
        vacio: 'Sin cuentas de resultado en este rango.',
        filaHTML: (f, hl) => `<tr><td class="mono sub">${hl(f.codigo)}</td><td>${hl(f.nombre)}</td><td><span class="chip ${f.signo === 1 ? 'contabilizado' : 'neutral'}">${esc(f.claseTxt)}</span></td><td class="num">${f.signo === 1 ? fmtM(f.saldo) : `(−) ${fmtM(f.saldo)}`}</td></tr>`,
        totalesHTML: `<tr><td colspan="3"><b>Resultado</b></td><td class="num"><b>${fmtM(t.d.resultado)}</b></td></tr>`,
      })
    }
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
         <div id="cc-resumen" class="mt"></div>
       </div>
        ${cc.detalle ? `
       <div class="card mt">
         <h3>Detalle de ${esc(cc.rut)} — saldo corrido</h3>
         <div id="cc-detalle-tabla" class="mt"></div>
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
      UITabla.montar({
        mount: document.getElementById('cc-resumen'),
        // B3 extendido: congela el RUT al cruzar hacia los saldos.
        congelar: true,
        columnas: [
          { key: 'rut', label: 'RUT' },
          { key: 'razon_social', label: 'Razón social', valor: (r) => r.razon_social || '—' },
          { key: 'cargos', label: 'Cargos', num: true, valor: (r) => fmtM(r.cargos), crudo: (r) => r.cargos },
          { key: 'abonos', label: 'Abonos', num: true, valor: (r) => fmtM(r.abonos), crudo: (r) => r.abonos },
          { key: 'saldo', label: 'Saldo', num: true, valor: (r) => fmtM(r.saldo), crudo: (r) => r.saldo },
          { key: 'acciones', label: '', orden: false, buscar: false },
        ],
        filas: cc.resumen,
        nombreArchivo: `cuenta-corriente-${rol}-${f.desde || 'inicio'}_${f.hasta || 'hoy'}`,
        vacio: 'Sin documentos contabilizados con esos filtros.',
        filaHTML: (r, hl) => `<tr>
             <td class="mono">${hl(r.rut)}</td><td>${hl(r.razon_social || '—')}</td>
             <td class="num">${fmtM(r.cargos)}</td><td class="num">${fmtM(r.abonos)}</td>
             <td class="num"><b>${fmtM(r.saldo)}</b></td>
             <td><button class="btn btn-secondary btn-sm cc-detalle" data-rut="${esc(r.rut)}">Ver detalle</button></td>
           </tr>`,
        totalesHTML: `<tr><td colspan="2"><b>Total</b></td>
             <td class="num"><b>${fmtM(cc.total_cargos)}</b></td>
             <td class="num"><b>${fmtM(cc.total_abonos)}</b></td>
             <td class="num"><b>${fmtM(cc.total_saldo)}</b></td><td></td></tr>`,
      })
      // Delegación: UITabla re-renderiza el tbody al buscar/ordenar/paginar.
      document.getElementById('cc-resumen').addEventListener('click', (e) => {
        const btn = e.target.closest('.cc-detalle')
        if (!btn) return
        window._ccRut = btn.dataset.rut
        renderRoute()
      })
      if (cc.detalle) {
        UITabla.montar({
          mount: document.getElementById('cc-detalle-tabla'),
          // B3 extendido: saldo corrido — fecha y tipo fijas al cruzar.
          congelar: true,
          columnas: [
            { key: 'fecha', label: 'Fecha', orden: false },
            { key: 'tipo', label: 'Tipo', orden: false },
            { key: 'referencia', label: 'Referencia', orden: false },
            { key: 'cargo', label: 'Cargo', num: true, orden: false, valor: (d) => (d.cargo ? fmtM(d.cargo) : '—'), crudo: (d) => d.cargo || 0 },
            { key: 'abono', label: 'Abono', num: true, orden: false, valor: (d) => (d.abono ? fmtM(d.abono) : '—'), crudo: (d) => d.abono || 0 },
            { key: 'saldo_despues', label: 'Saldo', num: true, orden: false, valor: (d) => fmtM(d.saldo_despues), crudo: (d) => d.saldo_despues },
          ],
          filas: cc.detalle,
          nombreArchivo: `cc-detalle-${cc.rut || 'contraparte'}`,
          vacio: 'Sin movimientos.',
          filaHTML: (d) => `<tr>
             <td class="sub">${esc(d.fecha || '')}</td>
             <td><span class="chip ${d.tipo === 'DOCTO' ? 'clasificado' : d.tipo === 'NC' ? 'propuesto' : 'contabilizado'}">${esc(d.tipo)}</span></td>
             <td class="mono sub">${esc(d.referencia || '')}</td>
             <td class="num">${d.cargo ? fmtM(d.cargo) : '—'}</td>
             <td class="num">${d.abono ? fmtM(d.abono) : '—'}</td>
             <td class="num"><b>${fmtM(d.saldo_despues)}</b></td>
           </tr>`,
        })
      }
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

