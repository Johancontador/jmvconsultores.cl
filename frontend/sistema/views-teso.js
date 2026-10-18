/**
 * VISTA TESORERÍA (FASE 6 — §22): bancos, libro banco (pagos/cobros/
 * transferencias con asiento del núcleo) y conciliación bancaria report-only.
 * La pata contable de cada movimiento es un asiento real: aquí nunca se
 * "paga fuera de los libros".
 */

VIEWS.tesoreria = {
  titulo: 'Tesorería',
  async render(cont) {
    const eid = S.empresa.id
    const tab = window._tesoTab || 'bancos'

    let resumen = null
    try {
      resumen = (await apiGet(`/api/contable/empresas/${eid}/tesoreria/resumen`)).resumen
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const puedeOperar = tiene('tesoreria:operar')
    const puedeConciliar = tiene('bancos:conciliar')

    cont.innerHTML = `
     <p class="pg-flow"><b>Flujo:</b> Bancos y cartola → Conciliación → <a href="#cobranza">Cobranza y mora</a></p>
     <div class="tabs">
       <button data-t="bancos" class="${tab === 'bancos' ? 'active' : ''}">Bancos</button>
       <button data-t="movimientos" class="${tab === 'movimientos' ? 'active' : ''}">Libro banco</button>
       <button data-t="conciliacion" class="${tab === 'conciliacion' ? 'active' : ''}">Conciliación</button>
     </div>
     <div id="teso-body"></div>`

    cont.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      window._tesoTab = b.dataset.t
      renderRoute()
    }))

    const body = document.getElementById('teso-body')
    if (tab === 'bancos') await renderBancos(body, { eid, resumen, puedeOperar })
    else if (tab === 'movimientos') await renderMovimientos(body, { eid, resumen, puedeOperar })
    else await renderConciliacion(body, { eid, puedeConciliar })
  },
}

/* ============================ BANCOS ============================ */

async function renderBancos(cont, { eid, resumen, puedeOperar }) {
  let bancos = []
  let cuentas = []
  try {
    bancos = (await apiGet(`/api/contable/empresas/${eid}/bancos`)).bancos
    cuentas = (await apiGet(`/api/contable/empresas/${eid}/cuentas-imputables`)).cuentas
  } catch (err) { showToast(err.message, 'error') }

  const cuenta1_1 = cuentas.filter((c) => String(c.codigo).startsWith('1.1.1'))

  cont.innerHTML = `
   <div class="kpi-grid">
     <div class="kpi up"><small>Total bancos</small><strong>${fmtCorto(resumen.total_bancos)}</strong><span class="sub">${bancos.length} cuenta(s) bancaria(s)</span></div>
     <div class="kpi"><small>Caja</small><strong>${resumen.caja === null ? '—' : fmtCorto(resumen.caja)}</strong><span class="sub">saldo contable (alias CAJA)</span></div>
     <div class="kpi ${resumen.mes_actual.ingresos >= resumen.mes_actual.egresos ? 'up' : 'warn'}"><small>Ingresos del mes</small><strong>${fmtCorto(resumen.mes_actual.ingresos)}</strong><span class="sub">${resumen.mes_actual.movimientos} movimiento(s)</span></div>
     <div class="kpi warn"><small>Egresos del mes</small><strong>${fmtCorto(resumen.mes_actual.egresos)}</strong><span class="sub">pagos + transferencias</span></div>
   </div>

   <div class="card mt">
     <h3>Cuentas bancarias</h3>
      ${bancos.length ? `
     <div class="tbl-wrap">
       <table class="tbl">
         <thead><tr><th>Banco</th><th>Número</th><th>Cuenta contable</th><th class="num">Saldo inicial</th><th class="num">Ingresos</th><th class="num">Egresos</th><th class="num">Saldo</th></tr></thead>
         <tbody>
            ${bancos.map((b) => `
             <tr>
               <td><b>${esc(b.banco)}</b></td>
               <td class="mono">${esc(b.numero || '—')}</td>
               <td class="sub">${esc(b.cuenta_codigo)} ${esc(b.cuenta_nombre)}</td>
               <td class="num">${fmtM(b.saldo_inicial)}</td>
               <td class="num">${fmtM(b.ingresos)}</td>
               <td class="num">${fmtM(b.egresos)}</td>
               <td class="num"><b>${fmtM(b.saldo)}</b></td>
             </tr>`).join('')}
         </tbody>
       </table>
     </div>` : '<div class="empty">Sin cuentas bancarias registradas.</div>'}
   </div>

    ${puedeOperar ? `
   <div class="card mt">
     <h3>Nueva cuenta bancaria</h3>
     <p class="hint" style="margin-top:-6px">El saldo inicial se contabiliza como asiento de apertura: libro banco y mayor siempre de la mano.</p>
     <div class="frm-row mt">
       <div><span class="frm-label">Banco</span><input id="b-banco" class="form-input" placeholder="Banco de Chile"></div>
       <div><span class="frm-label">Número</span><input id="b-numero" class="form-input" placeholder="001-2345678"></div>
       <div><span class="frm-label">Cuenta contable</span>
         <select id="b-cuenta" class="form-input">${(cuenta1_1.length ? cuenta1_1 : cuentas).map((c) => `<option value="${c.id}">${esc(c.codigo)} ${esc(c.nombre)}</option>`).join('')}</select>
       </div>
       <div><span class="frm-label">Saldo inicial</span><input id="b-saldo" class="form-input" type="number" value="0"></div>
       <button class="btn btn-primary" id="b-crear">Crear</button>
     </div>
   </div>` : ''}`

  const btn = document.getElementById('b-crear')
  if (btn) btn.addEventListener('click', async () => {
    try {
      await apiPost(`/api/contable/empresas/${eid}/bancos`, {
        banco: document.getElementById('b-banco').value,
        numero: document.getElementById('b-numero').value,
        cuenta_contable_id: Number(document.getElementById('b-cuenta').value),
        saldo_inicial: Number(document.getElementById('b-saldo').value || 0),
      })
      showToast('Cuenta bancaria creada', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
}

/* ========================== MOVIMIENTOS ========================== */

async function renderMovimientos(cont, { eid, puedeOperar }) {
  let bancos = []
  let cuentas = []
  try {
    bancos = (await apiGet(`/api/contable/empresas/${eid}/bancos`)).bancos
    cuentas = (await apiGet(`/api/contable/empresas/${eid}/cuentas-imputables`)).cuentas
  } catch (err) { showToast(err.message, 'error') }

  if (!bancos.length) {
    cont.innerHTML = '<div class="card"><div class="empty">Primero crea una cuenta bancaria en la pestaña Bancos.</div></div>'
    return
  }
  const bancoId = window._tesoBanco || bancos[0].id
  const banco = bancos.find((b) => String(b.id) === String(bancoId)) || bancos[0]

  let libro = { filas: [] }
  try {
    libro = await apiGet(`/api/contable/empresas/${eid}/tesoreria/movimientos?banco_cuenta_id=${banco.id}`)
  } catch (err) { showToast(err.message, 'error') }

  const contrapartes = cuentas.filter((c) => !String(c.codigo).startsWith('1.1.1'))

  cont.innerHTML = `
   <div class="frm-row mb">
     <div><span class="frm-label">Cuenta</span>
       <select id="m-banco" class="form-input">${bancos.map((b) => `<option value="${b.id}" ${String(b.id) === String(banco.id) ? 'selected' : ''}>${esc(b.banco)} ${esc(b.numero || '')}</option>`).join('')}</select>
     </div>
     <span class="spacer"></span>
     <span class="chip contabilizado">Saldo: <b class="mono">&nbsp;${fmtM(banco.saldo)}</b></span>
   </div>

   <div class="card">
     <h3>Libro banco — ${esc(banco.banco)} ${esc(banco.numero || '')}</h3>
      ${libro.filas.length ? `
     <div class="tbl-wrap">
       <table class="tbl">
         <thead><tr><th>Fecha</th><th>Tipo</th><th>Glosa</th><th>Asiento</th><th class="num">Ingreso</th><th class="num">Egreso</th><th class="num">Saldo</th></tr></thead>
         <tbody>
            ${libro.filas.map((f) => `
             <tr>
               <td>${esc(f.fecha)}</td>
               <td><span class="chip ${f.tipo === 'PAGO' ? 'error' : f.tipo === 'COBRO' ? 'contabilizado' : 'propuesto'}">${f.tipo}</span></td>
               <td>${esc(f.glosa)}${f.folio_doc ? ` <span class="sub">· doc ${f.tipo_doc}/${f.folio_doc}</span>` : ''}</td>
               <td class="sub">F${f.folio_asiento}/${f.anio_asiento}</td>
               <td class="num">${f.monto > 0 ? fmtM(f.monto) : ''}</td>
               <td class="num">${f.monto < 0 ? fmtM(-f.monto) : ''}</td>
               <td class="num"><b>${fmtM(f.saldo_despues)}</b></td>
             </tr>`).join('')}
         </tbody>
       </table>
     </div>` : '<div class="empty">Sin movimientos todavía.</div>'}
   </div>

    ${puedeOperar ? `
   <div class="grid-2 mt">
     <div class="card">
       <h3>Pago o cobro</h3>
       <div class="frm-row">
         <div><span class="frm-label">Tipo</span>
           <select id="mv-tipo" class="form-input"><option value="PAGO">Pago (egreso)</option><option value="COBRO">Cobro (ingreso)</option></select>
         </div>
         <div><span class="frm-label">Fecha</span><input id="mv-fecha" class="form-input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
         <div><span class="frm-label">Monto</span><input id="mv-monto" class="form-input" type="number" min="1"></div>
       </div>
       <div class="frm-row mt">
         <div style="flex:1"><span class="frm-label">Glosa</span><input id="mv-glosa" class="form-input" placeholder="Pago factura 123 — Proveedor"></div>
         <div><span class="frm-label">Contraparte</span>
           <select id="mv-cuenta" class="form-input">
             <option value="">Automática (proveedores/clientes)</option>
              ${contrapartes.map((c) => `<option value="${c.id}">${esc(c.codigo)} ${esc(c.nombre)}</option>`).join('')}
           </select>
         </div>
         <button class="btn btn-primary" id="mv-registrar">Registrar</button>
       </div>
       <p class="hint mt">El movimiento genera su asiento en partida doble al momento: nada sale de los libros.</p>
     </div>
     <div class="card">
       <h3>Transferencia entre cuentas</h3>
       <div class="frm-row">
         <div><span class="frm-label">Origen</span>
           <select id="tr-origen" class="form-input">${bancos.map((b) => `<option value="${b.id}">${esc(b.banco)} ${esc(b.numero || '')}</option>`).join('')}</select>
         </div>
         <div><span class="frm-label">Destino</span>
           <select id="tr-destino" class="form-input">${bancos.map((b) => `<option value="${b.id}">${esc(b.banco)} ${esc(b.numero || '')}</option>`).join('')}</select>
         </div>
       </div>
       <div class="frm-row mt">
         <div><span class="frm-label">Fecha</span><input id="tr-fecha" class="form-input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
         <div><span class="frm-label">Monto</span><input id="tr-monto" class="form-input" type="number" min="1"></div>
         <div><span class="frm-label">Glosa</span><input id="tr-glosa" class="form-input" placeholder="Traspaso a inversión"></div>
         <button class="btn btn-primary" id="tr-registrar">Transferir</button>
       </div>
       <p class="hint mt">Un solo asiento con las dos patas bancarias — la partida doble es natural.</p>
     </div>
   </div>` : '<div class="card mt"><p class="hint">Solo lectura: tu rol no registra movimientos de tesorería.</p></div>'}`

  document.getElementById('m-banco').addEventListener('change', (e) => {
    window._tesoBanco = e.target.value
    renderRoute()
  })

  const btnMV = document.getElementById('mv-registrar')
  if (btnMV) btnMV.addEventListener('click', async () => {
    try {
      const tipo = document.getElementById('mv-tipo').value
      const cuerpo = {
        banco_cuenta_id: Number(banco.id),
        fecha: document.getElementById('mv-fecha').value,
        monto: Number(document.getElementById('mv-monto').value),
        glosa: document.getElementById('mv-glosa').value,
      }
      const cta = document.getElementById('mv-cuenta').value
      if (cta) cuerpo.cuenta_contraparte_id = Number(cta)
      await apiPost(`/api/contable/empresas/${eid}/tesoreria/${tipo === 'PAGO' ? 'pagos' : 'cobros'}`, cuerpo)
      showToast('Movimiento registrado con su asiento', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })

  const btnTR = document.getElementById('tr-registrar')
  if (btnTR) btnTR.addEventListener('click', async () => {
    try {
      await apiPost(`/api/contable/empresas/${eid}/tesoreria/transferencias`, {
        banco_cuenta_id: Number(document.getElementById('tr-origen').value),
        banco_destino_id: Number(document.getElementById('tr-destino').value),
        fecha: document.getElementById('tr-fecha').value,
        monto: Number(document.getElementById('tr-monto').value),
        glosa: document.getElementById('tr-glosa').value,
      })
      showToast('Transferencia registrada', 'success')
      renderRoute()
    } catch (err) { showToast(err.message, 'error') }
  })
}

/* ========================== CONCILIACIÓN ========================== */

async function renderConciliacion(cont, { eid, puedeConciliar }) {
  let bancos = []
  try { bancos = (await apiGet(`/api/contable/empresas/${eid}/bancos`)).bancos } catch (err) { showToast(err.message, 'error') }
  if (!bancos.length) {
    cont.innerHTML = '<div class="card"><div class="empty">Primero crea una cuenta bancaria en la pestaña Bancos.</div></div>'
    return
  }
  const bancoId = window._tesoBancoConc || bancos[0].id
  const banco = bancos.find((b) => String(b.id) === String(bancoId)) || bancos[0]

  let modoSimple = false
  try { modoSimple = (await apiGet(`/api/contable/empresas/${eid}/config`)).config.modo_conciliacion === 'simple' } catch { /* default */ }

  cont.innerHTML = `
    ${modoSimple ? `<div class="banner-lic" style="background:var(--accent-soft);color:var(--accent)">Modo simple activo: tus compras y ventas se netean automáticamente contra la cuenta regular — la conciliación bancaria es opcional. Cámbialo en <a href="#memoria" style="font-weight:600">Memoria de Contabilización</a>.</div>` : ''}
   <div class="frm-row mb">
     <div><span class="frm-label">Cuenta</span>
       <select id="c-banco" class="form-input">${bancos.map((b) => `<option value="${b.id}" ${String(b.id) === String(banco.id) ? 'selected' : ''}>${esc(b.banco)} ${esc(b.numero || '')}</option>`).join('')}</select>
     </div>
     <div><span class="frm-label">Conciliar hasta</span><input id="c-hasta" class="form-input" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      ${puedeConciliar ? `<button class="btn btn-primary" id="c-ejecutar">Conciliar</button>` : ''}
   </div>
    ${puedeConciliar ? `
   <div class="card">
     <h3>Importar cartola</h3>
     <p class="hint" style="margin-top:-6px">Pega las líneas del cartola bancario (CSV: fecha, monto, glosa — el monto firmado: cargo negativo, abono positivo). Re-importar no duplica.</p>
     <textarea id="c-cartola" class="form-input" rows="4" placeholder="2026-10-05, -400000, Cargo proveedor\n2026-10-06, 700000, Abono cliente" style="font-family:var(--font-mono);font-size:var(--fs-sm)"></textarea>
     <div class="mt"><button class="btn btn-secondary btn-sm" id="c-importar">Importar cartola</button></div>
   </div>
   <div class="card mt">
     <h3>Importar archivo del banco (Excel/CSV)</h3>
     <p class="hint" style="margin-top:-6px">Sube la cartola exportada del portal del banco: el sistema detecta el formato (fecha, monto firmado, glosa), te muestra lo que va a importar y nada entra sin tu confirmación. Si el formato no se reconoce, mapeas las columnas a mano y lo guardas para siempre.</p>
     <div class="frm-row mt">
       <input type="file" id="c-archivo" class="form-input" accept=".csv,.xlsx,.xls" style="max-width:360px">
       <button class="btn btn-secondary btn-sm" id="c-archivo-ver" disabled>Analizar archivo</button>
     </div>
     <div id="c-archivo-out"></div>
   </div>` : ''}
   <div id="c-out"></div>`

  document.getElementById('c-banco').addEventListener('change', (e) => { window._tesoBancoConc = e.target.value })

  const btn = document.getElementById('c-ejecutar')
  if (btn) btn.addEventListener('click', conciliar)

  async function conciliar() {
    try {
      const r = (await apiPost(`/api/contable/empresas/${eid}/tesoreria/conciliar`, {
        banco_cuenta_id: Number(document.getElementById('c-banco').value),
        hasta: document.getElementById('c-hasta').value,
      })).conciliacion
      pintarResultado(r)
    } catch (err) { showToast(err.message, 'error') }
  }

  const btnImp = document.getElementById('c-importar')
  if (btnImp) btnImp.addEventListener('click', async () => {
    try {
      const filas = document.getElementById('c-cartola').value
        .split('\n').map((l) => l.trim()).filter(Boolean)
        .map((l) => {
          const p = l.split(/[;,]/).map((x) => x.trim())
          return { fecha: p[0], monto: Number(p[1]), glosa: p.slice(2).join(', ') }
        })
      if (!filas.length) { showToast('No hay líneas para importar', 'info'); return }
      const r = await apiPost(`/api/contable/empresas/${eid}/tesoreria/cartola`, {
        banco_cuenta_id: Number(document.getElementById('c-banco').value),
        filas,
      })
      showToast(`Cartola importada: ${r.insertadas} nueva(s), ${r.duplicadas} duplicada(s) saltada(s)`, 'success')
      conciliar()
    } catch (err) { showToast(err.message, 'error') }
  })

  /* --- 9.2: cartola por archivo (Excel/CSV) con preview y mapeo manual --- */
  const inputArchivo = document.getElementById('c-archivo')
  const btnVer = document.getElementById('c-archivo-ver')
  const outArchivo = document.getElementById('c-archivo-out')
  let archivoBase64 = null
  let archivoNombre = ''
  let ultimoResultado = null

  if (inputArchivo) {
    inputArchivo.addEventListener('change', () => {
      const file = inputArchivo.files && inputArchivo.files[0]
      btnVer.disabled = !file
      outArchivo.innerHTML = ''
      archivoBase64 = null
      if (!file) return
      archivoNombre = file.name
      const lector = new FileReader()
      lector.onload = () => { archivoBase64 = String(lector.result).split(',')[1] || null }
      lector.readAsDataURL(file)
    })
  }

  const pedirParseo = async (extra) => apiPost(`/api/contable/empresas/${eid}/tesoreria/cartola-archivo`, {
    banco_cuenta_id: Number(document.getElementById('c-banco').value),
    nombre_archivo: archivoNombre,
    contenido_base64: archivoBase64,
    ...extra,
  })

  async function analizarArchivo() {
    if (!archivoBase64) { showToast('Elige primero el archivo', 'error'); return }
    outArchivo.innerHTML = '<p class="hint mt">Analizando archivo…</p>'
    try {
      const r = await pedirParseo({})
      ultimoResultado = r
      pintarPreview(r)
    } catch (err) { showToast(err.message, 'error'); outArchivo.innerHTML = '' }
  }

  function pintarPreview(r) {
    const fuente = r.fuente_mapeo === 'encabezado' ? 'detectado por encabezado'
      : r.fuente_mapeo === 'estadistico' ? 'detectado por estructura de columnas'
      : r.fuente_mapeo === 'manual' ? 'mapeo manual tuyo' : 'no reconocido'
    outArchivo.innerHTML = `
     <p class="hint mt">Archivo <b>${esc(archivoNombre)}</b> (${esc(r.tipo_archivo)}) — formato: <b>${esc(fuente)}</b>. Detectadas <b>${r.filas_detectadas}</b> de ${r.filas_totales} fila(s)${r.saltadas.length ? `, ${r.saltadas.length} saltada(s) con motivo` : ''}.</p>
      ${r.filas.length ? `
     <div class="tbl-wrap mt" style="max-height:260px;overflow:auto"><table class="tbl">
       <thead><tr><th>Fecha</th><th>Monto</th><th>Glosa</th></tr></thead>
       <tbody>${r.filas.slice(0, 50).map((f) => `
         <tr><td>${esc(f.fecha)}</td><td class="num ${f.monto > 0 ? 'up' : ''}">${fmtM(f.monto)}</td><td class="sub">${esc(f.glosa || '')}</td></tr>`).join('')}
       </tbody></table></div>
      ${r.filas.length > 50 ? `<p class="hint">…y ${r.filas.length - 50} más.</p>` : ''}` : '<p class="hint mt warn">No se reconoció ninguna fila: mapea las columnas a mano abajo.</p>'}
     <div class="frm-row mt">
       <div><span class="frm-label">Col. fecha</span><input id="cm-fecha" class="form-input" type="number" min="0" style="width:90px" placeholder="0"></div>
       <div><span class="frm-label">Col. monto</span><input id="cm-monto" class="form-input" type="number" min="0" style="width:90px" placeholder="1"></div>
       <div><span class="frm-label">Col. glosa</span><input id="cm-glosa" class="form-input" type="number" min="0" style="width:90px" placeholder="2"></div>
       <div style="align-self:flex-end"><button class="btn btn-secondary btn-sm" id="cm-aplicar">Re-analizar con este mapeo</button></div>
       <div><span class="frm-label">Guardar formato como</span><input id="cm-nombre" class="form-input" placeholder="Banco X — cartola mensual" style="width:220px"></div>
     </div>
      ${r.filas_detectadas ? `<div class="mt"><button class="btn btn-primary" id="cm-importar">Importar ${r.filas_detectadas} movimiento(s)</button></div>` : ''}`

    document.getElementById('cm-aplicar').addEventListener('click', async () => {
      // el usuario define QUÉ COLUMNA es cada cosa; el archivo se re-analiza completo
      const mapeoReal = {
        fila_inicio: 0,
        col_fecha: Number(document.getElementById('cm-fecha').value) || 0,
        col_monto: Number(document.getElementById('cm-monto').value) || 1,
        col_glosa: Number(document.getElementById('cm-glosa').value) || 2,
      }
      try {
        const nombre = document.getElementById('cm-nombre').value.trim()
        const r2 = await pedirParseo({ mapeo: mapeoReal, guardar_formato: nombre || undefined })
        ultimoResultado = r2
        pintarPreview(r2)
        if (nombre) showToast(`Formato "${nombre}" guardado para esta empresa`, 'success')
      } catch (err) { showToast(err.message, 'error') }
    })

    const btnImportar = document.getElementById('cm-importar')
    if (btnImportar) btnImportar.addEventListener('click', async () => {
      try {
        const r2 = await pedirParseo({ importar: true })
        showToast(`Cartola importada: ${r2.importacion.insertadas} nueva(s), ${r2.importacion.duplicadas} duplicada(s) saltada(s)`, 'success')
        outArchivo.innerHTML = ''
        inputArchivo.value = ''
        btnVer.disabled = true
        conciliar()
      } catch (err) { showToast(err.message, 'error') }
    })
  }

  if (btnVer) btnVer.addEventListener('click', analizarArchivo)

  function pintarResultado(r) {
    document.getElementById('c-out').innerHTML = `
     <div class="kpi-grid mt">
       <div class="kpi ${r.cuadrado ? 'up' : 'warn'}"><small>Saldo libro</small><strong>${fmtCorto(r.saldo_libro)}</strong><span class="sub">hasta ${esc(r.hasta)}</span></div>
       <div class="kpi ${r.cuadrado ? 'up' : 'warn'}"><small>Saldo cartola</small><strong>${fmtCorto(r.saldo_cartola)}</strong><span class="sub">importada del banco</span></div>
       <div class="kpi ${r.cuadrado ? 'up' : 'bad'}"><small>Diferencia</small><strong>${fmtCorto(r.diferencia)}</strong><span class="sub">${r.cuadrado ? 'cuadrado' : 'requiere ajuste manual'}</span></div>
       <div class="kpi"><small>Emparejados</small><strong>${r.emparejados}</strong><span class="sub">${r.no_conciliado_libro.length} en libro · ${r.no_conciliado_cartola.length} en cartola sin match</span></div>
     </div>
     <div class="grid-2 mt">
       <div class="card"><h3>En el libro, sin cartola (${r.no_conciliado_libro.length})</h3>
          ${r.no_conciliado_libro.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Glosa</th><th class="num">Monto</th></tr></thead><tbody>
            ${r.no_conciliado_libro.map((m) => `<tr><td>${esc(m.fecha)}</td><td>${esc(m.tipo)}</td><td>${esc(m.glosa)}</td><td class="num">${fmtM(m.monto)}</td></tr>`).join('')}
         </tbody></table></div>` : '<p class="hint">Todo el libro está respaldado por cartola.</p>'}
       </div>
       <div class="card"><h3>En la cartola, sin libro (${r.no_conciliado_cartola.length})</h3>
          ${r.no_conciliado_cartola.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Fecha</th><th>Glosa</th><th class="num">Monto</th></tr></thead><tbody>
            ${r.no_conciliado_cartola.map((c) => `<tr><td>${esc(c.fecha)}</td><td>${esc(c.glosa || '')}</td><td class="num">${fmtM(c.monto)}</td></tr>`).join('')}
         </tbody></table></div><p class="hint mt">Si corresponde, regístralo como movimiento (o asiento de ajuste): la conciliación reporta, nunca corrige.</p>`
            : '<p class="hint">Toda la cartola está en el libro.</p>'}
       </div>
     </div>`
  }
}
