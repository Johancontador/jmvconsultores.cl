/**
 * Herramientas tributarias adicionales del Centro Tributario — todas leen de
 * lo ya sincronizado/persistido; ninguna consulta el SII al abrirlas:
 *   duplicadas      → facturas duplicadas (folio+tipoDoc+contraparte) en el rango
 *   comparador-f29  → F29 estimado mes a mes (IVA + PPM) con comparación
 *   intereses       → calculadora de interés penal del SII sobre un F29 vencido
 *   checklist-cierre→ checklist de cierre de mes, persistido en localStorage por cliente+período
 *   cobranza        → generador de mensaje de cobranza con wa.me (con plantillas)
 *   conversor-dte   → conversor XML DTE → Excel (client-side, sin subir nada a un servidor)
 *
 * Se carga después de reportes.js (usa registrarExport, botonesExportHtml…).
 */

// ============ 1. FACTURAS DUPLICADAS ============
function renderDuplicadas(data, bannerErrores) {
  const todas = [
    ...(data.documentos_ventas || []).map(conSignoNC).map((d) => ({ ...d, libro: 'Venta' })),
    ...(data.documentos_compras || []).map(conSignoNC).map((d) => ({ ...d, libro: 'Compra' })),
  ]
  if (!todas.length) return renderTribSinDetalle('El detector necesita el detalle documento a documento.')

  // Clave de duplicidad: tipo + folio + RUT contraparte (un folio por tipo y
  // contraparte es único por definición tributaria). Se ignoran boletas (39/41)
  // porque comparten folio con muchas ventas.
  const esFactura = (t) => [30, 32, 33, 34, 43, 46, 52].includes(Number(t))
  const grupos = new Map()
  for (const d of todas) {
    if (!esFactura(d.tipoDoc)) continue
    const clave = `${Number(d.tipoDoc)}|${String(d.folio)}|${String(d.rutDoc || '').toUpperCase()}`
    if (!grupos.has(clave)) grupos.set(clave, [])
    grupos.get(clave).push(d)
  }

  const dupes = [...grupos.values()].filter((g) => g.length > 1)
  const $res = document.getElementById('reporte-resultado')
  const filas = dupes.flatMap((g) => g.map((d, i) => ({
    ...d,
    ocurrencia: i + 1,
    de: g.length,
    montoOtro: g[0] === d ? 0 : g[0].montoTotal,
  })))

  $res.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <section class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Facturas analizadas</div><div class="kpi-valor">${todas.filter((d) => esFactura(d.tipoDoc)).length.toLocaleString('es-CL')}</div></div>
      <div class="kpi-card"><div class="kpi-label" >Folios duplicados</div><div class="kpi-valor" style="${dupes.length ? 'color:var(--danger)' : 'color:var(--success)'}">${dupes.length.toLocaleString('es-CL')}</div></div>
      <div class="kpi-card"><div class="kpi-label">Monto involucrado</div><div class="kpi-valor">${fmt(dupes.reduce((s, g) => s + g[0].montoTotal, 0))}</div></div>
    </section>
    ${dupes.length === 0
      ? '<div class="empty-state"><div class="empty-state-icon">✅</div><h3 class="empty-state-title">Sin duplicados</h3><p class="empty-state-desc">Ninguna factura (30/32/33/34/43/46/52) repite folio+contraparte en el rango analizado.</p></div>'
      : `
      <div class="libro-warning">🔍 Se detectaron ${dupes.length} folio(s) con más de una ocurrencia — puede ser el mismo documento visto en dos meses, o un error de digitación/doble emisión. Revisa folio y montos antes de corregir.</div>
      <table class="informe-table libro-table">
        <thead><tr><th>Libro</th><th>Tipo</th><th>Folio</th><th>Contraparte</th><th>Fecha</th><th>Neto</th><th>IVA</th><th>Total</th><th>Ocurrencia</th></tr></thead>
        <tbody>
          ${filas.map((d) => `
            <tr>
              <td>${d.libro}</td>
              <td>${escapeHtml(nombreTipoDoc(d.tipoDoc))}</td>
              <td class="text-mono">${escapeHtml(String(d.folio))}</td>
              <td>${escapeHtml(d.razonSocial || '')}</td>
              <td>${escapeHtml(d.fechaDocto || '')}</td>
              <td class="text-mono">${fmt(d.montoNeto)}</td>
              <td class="text-mono">${fmt(d.montoIVA)}</td>
              <td class="text-mono">${fmt(d.montoTotal)}</td>
              <td>${d.ocurrencia}/${d.de}</td>
            </tr>`).join('')}
        </tbody>
      </table>`}`

  registrarExport({
    columnas: [
      { key: 'libro', label: 'Libro' },
      { key: 'tipo', label: 'Tipo', exportFormat: (v) => nombreTipoDoc(v) },
      { key: 'folio', label: 'Folio' },
      { key: 'razonSocial', label: 'Contraparte' },
      { key: 'fechaDocto', label: 'Fecha' },
      { key: 'montoNeto', label: 'Neto' },
      { key: 'montoIVA', label: 'IVA' },
      { key: 'montoTotal', label: 'Total' },
      { key: 'ocurrencia', label: 'Ocurrencia', exportFormat: (v, f) => `${v}/${f.de}` },
    ],
    filas,
    titulo: 'Facturas duplicadas',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// ============ 2. COMPARADOR F29 HISTÓRICO ============
function renderComparadorF29(data, bannerErrores) {
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const $res = document.getElementById('reporte-resultado')

  const filas = ok.map((m) => {
    const ppm = Math.round((m.ventas_neto || 0) * 0.005)
    const iva = m.iva_pagar || 0
    const total = iva < 0 ? ppm : iva + ppm
    return { mes_label: `${m.mes_nombre} ${m.anio}`, ventas: m.ventas_neto, debito: m.debito_fiscal, credito: m.credito_fiscal, iva, ppm, total }
  })
  const promedio = filas.length ? Math.round(filas.reduce((s, f) => s + f.total, 0) / filas.length) : 0

  $res.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <section class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Meses con datos</div><div class="kpi-valor">${filas.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">F29 promedio del período</div><div class="kpi-valor">${fmt(promedio)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total pagado est. del rango</div><div class="kpi-valor">${fmt(filas.reduce((s, f) => s + f.total, 0))}</div></div>
    </section>
    ${filas.length === 0 ? '<div class="empty-state"><p>Sin meses sincronizados.</p></div>' : `
    <div class="dash-card" style="margin-bottom:1.5rem"><div class="chart-wrap"><canvas id="chart-f29"></canvas></div></div>
    <table class="informe-table libro-table">
      <thead><tr><th>Mes</th><th>Ventas</th><th>Débito</th><th>Crédito</th><th>IVA determ.</th><th>PPM 0,5%</th><th>F29 est.</th><th>vs promedio</th></tr></thead>
      <tbody>
        ${filas.map((f) => {
          const delta = promedio ? Math.round(((f.total - promedio) / promedio) * 100) : 0
          const color = delta > 15 ? 'var(--danger)' : delta < -15 ? 'var(--success)' : ''
          return `
          <tr>
            <td>${f.mes_label}</td>
            <td class="text-mono">${fmt(f.ventas)}</td>
            <td class="text-mono">${fmt(f.debito)}</td>
            <td class="text-mono">${fmt(f.credito)}</td>
            <td class="text-mono">${f.iva < 0 ? `Rem. ${fmt(Math.abs(f.iva))}` : fmt(f.iva)}</td>
            <td class="text-mono">${fmt(f.ppm)}</td>
            <td class="text-mono" style="font-weight:600">${fmt(f.total)}</td>
            <td class="text-mono" style="${color ? `color:${color}` : ''}">${delta > 0 ? '+' : ''}${delta}%</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>`}`

  // Gráfico de barras F29 por mes
  if (filas.length && typeof Chart !== 'undefined') {
    const ctx = document.getElementById('chart-f29')
    if (ctx) {
      new Chart(ctx, {
        type: 'bar',
        data: {
          labels: filas.map((f) => f.mes_label),
          datasets: [
            { label: 'IVA determinado', data: filas.map((f) => Math.max(f.iva, 0)), backgroundColor: '#6366f1', borderRadius: 6 },
            { label: 'PPM', data: filas.map((f) => f.ppm), backgroundColor: '#f59e0b', borderRadius: 6 },
          ],
        },
        options: {
          plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
            y: { ticks: { color: '#94a3b8', callback: (v) => fmtCorto(v) }, grid: { color: 'rgba(255,255,255,0.06)' } },
          },
        },
      })
    }
  }

  registrarExport({
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'ventas', label: 'Ventas' },
      { key: 'debito', label: 'Débito' },
      { key: 'credito', label: 'Crédito' },
      { key: 'iva', label: 'IVA determinado' },
      { key: 'ppm', label: 'PPM 0,5%' },
      { key: 'total', label: 'F29 estimado' },
    ],
    filas,
    titulo: 'Comparador F29',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// ============ 3. CALCULADORA DE INTERÉS PENAL SII ============
function renderIntereses(data, bannerErrores) {
  const $res = document.getElementById('reporte-resultado')
  $res.innerHTML = `
    ${bannerErrores}
    <div class="dash-card">
      <h3>Cálculo de interés penal SII (art. 53 Código Tributario)</h3>
      <p class="libro-nota">El interés penal es el interés corriente + 1,1 puntos porcentuales. La tasa se publica mensualmente en sii.cl — el valor prellenado es referencial (≈ 2,69% anual en 2026); confírmala antes de pagar.</p>
      <div class="controls-row" style="margin-top:1rem">
        <div class="control-group">
          <label class="form-label" for="int-monto">Monto adeudado (CLP)</label>
          <input type="number" id="int-monto" class="form-input" min="0" step="1000" placeholder="Ej: 1500000">
        </div>
        <div class="control-group">
          <label class="form-label" for="int-venc">Fecha de vencimiento</label>
          <input type="date" id="int-venc" class="form-input">
        </div>
        <div class="control-group">
          <label class="form-label" for="int-pago">Fecha de pago</label>
          <input type="date" id="int-pago" class="form-input">
        </div>
        <div class="control-group">
          <label class="form-label" for="int-tasa">Tasa interés penal anual (%)</label>
          <input type="number" id="int-tasa" class="form-input" step="0.01" value="2.69">
        </div>
      </div>
      <div class="kpi-grid" style="margin-top:1.5rem" id="int-resultados"></div>
      <p class="libro-nota">Fórmula: interés = monto × (tasa_anual/365) × días de atraso. La tasa la publica el SII cada mes — confírmala en sii.cl antes de pagar.</p>
    </div>`

  const $monto = document.getElementById('int-monto')
  const $venc = document.getElementById('int-venc')
  const $pago = document.getElementById('int-pago')
  const $tasa = document.getElementById('int-tasa')
  const $out = document.getElementById('int-resultados')

  function pintar() {
    const monto = Number($monto.value) || 0
    const tasa = Number($tasa.value) || 0
    const hoy = new Date()
    const venc = $venc.value ? new Date($venc.value + 'T00:00:00') : null
    const pago = $pago.value ? new Date($pago.value + 'T00:00:00') : hoy
    const dias = venc ? Math.max(Math.round((pago - venc) / 86400000), 0) : 0
    const interes = Math.round(monto * (tasa / 100 / 365) * dias)
    const total = monto + interes
    const kpi = (l, v, c = '') => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-valor" style="${c ? `color:${c}` : ''}">${v}</div></div>`
    $out.innerHTML = [
      kpi('Días de atraso', dias.toLocaleString('es-CL')),
      kpi('Interés penal', fmt(interes), 'var(--danger)'),
      kpi('Total a pagar', fmt(total), 'var(--accent)'),
    ].join('')
  }
  ;[$monto, $venc, $pago, $tasa].forEach((el) => el.addEventListener('input', pintar))

  // Prellenar vencimiento con el último F29 vencido del informe activo (si hay)
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const ultimo = ok[ok.length - 1]
  if (ultimo && !$venc.value) {
    const mesDecl = ultimo.mes === 12 ? { y: ultimo.anio + 1, m: 1 } : { y: ultimo.anio, m: ultimo.mes + 1 }
    $venc.value = `${mesDecl.y}-${String(mesDecl.m).padStart(2, '0')}-20`
  }
  pintar()
}

// ============ 4. CHECKLIST DE CIERRE MENSUAL ============
function renderChecklistCierre(data, bannerErrores) {
  const $res = document.getElementById('reporte-resultado')
  const cliente = data.cliente
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const ultimo = ok[ok.length - 1]
  const periodo = ultimo ? `${ultimo.anio}-${String(ultimo.mes).padStart(2, '0')}` : new Date().toISOString().slice(0, 7)
  const periodoLabel = ultimo ? `${ultimo.mes_nombre} ${ultimo.anio}` : 'Mes en curso'
  const key = `iva_checklist_${cliente?.id || 0}_${periodo}`

  const ITEMS = [
    { id: 'rcv', texto: 'Libros RCV sincronizados sin errores' },
    { id: 'nc', texto: 'Notas de crédito del mes revisadas (documento de referencia)' },
    { id: 'reclamadas', texto: 'Facturas reclamadas gestionadas (NC o refacturación)' },
    { id: 'duplicadas', texto: 'Folios duplicados verificados en el detector' },
    { id: 'sinrut', texto: 'Documentos sin RUT identificado revisados' },
    { id: 'f29', texto: 'F29 confeccionado: IVA determinado + PPM' },
    { id: 'ppm', texto: 'PPM pagado (o remanente aplicado)' },
    { id: 'f29venc', texto: 'F29 enviado antes del día 20' },
    { id: 'compras', texto: 'Compras con crédito fiscal respaldado por documento' },
    { id: 'backup', texto: 'Respaldo del mes exportado (CSV/Excel/PDF)' },
  ]

  let estado = {}
  try { estado = JSON.parse(localStorage.getItem(key) || '{}') } catch { estado = {} }

  function pintar() {
    const hechos = ITEMS.filter((i) => estado[i.id]).length
    const pct = Math.round((hechos / ITEMS.length) * 100)
    $res.innerHTML = `
      ${bannerErrores}
      <section class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Cierre de</div><div class="kpi-valor" style="font-size:var(--fs-xl)">${periodoLabel}</div></div>
        <div class="kpi-card"><div class="kpi-label">Progreso</div><div class="kpi-valor" style="color:${pct === 100 ? 'var(--success)' : 'var(--accent)'}">${pct}%</div></div>
        <div class="kpi-card"><div class="kpi-label">Pendientes</div><div class="kpi-valor">${ITEMS.length - hechos}</div></div>
      </section>
      <div class="dash-card">
        <h3>Checklist ${escapeHtml(cliente?.nombre || '')} — ${periodoLabel}</h3>
        <p class="libro-nota">Se guarda por empresa y mes en este navegador (localStorage). Regenerar el informe no lo borra.</p>
        <div class="checklist">
          ${ITEMS.map((i) => `
            <label class="checklist-item">
              <input type="checkbox" id="chk-${i.id}" ${estado[i.id] ? 'checked' : ''}>
              <span>${i.texto}</span>
            </label>`).join('')}
        </div>
        <div class="reporte-actions" style="margin-top:1rem">
          <button type="button" class="btn btn-secondary btn-sm" id="chk-reset">↺ Reiniciar mes</button>
        </div>
      </div>`

    ITEMS.forEach((i) => {
      document.getElementById(`chk-${i.id}`)?.addEventListener('change', (e) => {
        estado[i.id] = e.target.checked
        localStorage.setItem(key, JSON.stringify(estado))
        const hechos = ITEMS.filter((x) => estado[x.id]).length
        const pct = Math.round((hechos / ITEMS.length) * 100)
        const $pct = $res.querySelector('.kpi-valor')
        if ($pct) { $pct.textContent = `${pct}%`; $pct.style.color = pct === 100 ? 'var(--success)' : 'var(--accent)' }
      })
    })
    document.getElementById('chk-reset')?.addEventListener('click', () => {
      estado = {}
      localStorage.removeItem(key)
      pintar()
    })
  }
  pintar()
}

// ============ 5. GENERADOR DE MENSAJE DE COBRANZA ============
function renderCobranza(data, bannerErrores) {
  const $res = document.getElementById('reporte-resultado')
  const clientesPend = (data.top_clientes || [])

  $res.innerHTML = `
    ${bannerErrores}
    <div class="dash-card">
      <h3>Generador de mensaje de cobranza</h3>
      <p class="libro-nota">Escribe el mensaje con los datos del cliente — se abre WhatsApp (wa.me) con el texto listo. Los clientes cargados son los del Top del informe sincronizado; edita el destinatario libremente.</p>
      <div class="controls-row" style="margin-top:1rem">
        <div class="control-group" style="flex:2">
          <label class="form-label" for="cob-tel">Teléfono (código país + número, ej: 56912345678)</label>
          <input type="text" id="cob-tel" class="form-input" placeholder="56912345678">
        </div>
        <div class="control-group">
          <label class="form-label" for="cob-tono">Tono</label>
          <select id="cob-tono" class="form-select">
            <option value="cordial">Cordial</option>
            <option value="formal">Formal</option>
            <option value="firme">Firme</option>
          </select>
        </div>
      </div>
      <div class="control-group" style="margin-top:0.75rem">
        <label class="form-label" for="cob-datos">Datos de la deuda</label>
        <input type="text" id="cob-datos" class="form-input" placeholder="Ej: Factura 12345 — $850.000 — vencida desde 15/08">
      </div>
      <div class="control-group" style="margin-top:0.75rem">
        <label class="form-label" for="cob-msg">Mensaje (editable)</label>
        <textarea id="cob-msg" class="form-input" rows="6" style="resize:vertical"></textarea>
      </div>
      <div class="reporte-actions" style="margin-top:1rem">
        <button type="button" class="btn btn-secondary btn-sm" id="cob-copiar">📋 Copiar</button>
        <button type="button" class="btn btn-whatsapp btn-sm" id="cob-enviar">💬 Abrir WhatsApp</button>
      </div>
    </div>`

  const $msg = document.getElementById('cob-msg')
  const $datos = document.getElementById('cob-datos')
  const $tono = document.getElementById('cob-tono')
  const $tel = document.getElementById('cob-tel')

  const PLANTILLAS = {
    cordial: (d) => `Hola! 👋 ¿Cómo están? Te escribo por la deuda registrada: ${d || '[detalle]'}.\n\n¿Me confirmas cuándo podrían regularizarla? Cualquier duda con el documento, me avisas y lo revisamos juntos. ¡Gracias!`,
    formal: (d) => `Estimado cliente:\n\nJunto con saludar, informamos que según nuestros registros mantiene pendiente el siguiente documento: ${d || '[detalle]'}.\n\nAgradeceremos regularizarlo a la brevedad o indicarnos una fecha estimada de pago. Quedamos atentos a cualquier consulta.\n\nSaludos cordiales.`,
    firme: (d) => `Estimado cliente:\n\nSegún nuestros registros, el documento ${d || '[detalle]'} se encuentra VENCIDO.\n\nSolicitamos su pago inmediato dentro de las próximas 48 horas, o la comunicación de una fecha cierta de pago, para evitar acciones de cobranza.\n\nSe adjuntará copia del documento si se requiere.`,
  }

  function regenerar() {
    $msg.value = PLANTILLAS[$tono.value]($datos.value.trim())
  }
  ;[$datos, $tono].forEach((el) => el.addEventListener('input', regenerar))
  $tono.addEventListener('change', regenerar)
  regenerar()

  document.getElementById('cob-copiar').addEventListener('click', () => {
    navigator.clipboard.writeText($msg.value)
    showToast('Mensaje copiado', 'success')
  })
  document.getElementById('cob-enviar').addEventListener('click', () => {
    const tel = $tel.value.replace(/\D/g, '')
    if (!tel) { showToast('Ingresa un teléfono con código país', 'error'); return }
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent($msg.value)}`, '_blank')
  })
}

// ============ 6. CONVERSOR XML DTE → EXCEL ============
function renderConversorDte(data, bannerErrores) {
  const $res = document.getElementById('reporte-resultado')
  $res.innerHTML = `
    ${bannerErrores}
    <div class="dash-card">
      <h3>Conversor XML DTE → Excel</h3>
      <p class="libro-nota">Arrastra los archivos XML de DTE descargados del SII (o del facturador): se procesan <strong>en tu navegador</strong> — no se suben a ningún servidor. Soporta múltiples archivos y genera un Excel con una fila por documento.</p>
      <input type="file" id="dte-input" accept=".xml,text/xml" multiple style="display:none">
      <div id="dte-drop" class="dte-drop">
        <div class="empty-state-icon" style="margin-bottom:0.5rem">📥</div>
        <p><strong>Haz clic o arrastra aquí los XML</strong></p>
        <p class="libro-nota">Los archivos nunca salen de tu computador.</p>
      </div>
      <div id="dte-out"></div>
    </div>`

  const $input = document.getElementById('dte-input')
  const $drop = document.getElementById('dte-drop')
  const $out = document.getElementById('dte-out')

  const CAMPOS = [
    ['Folio', './DTE/Documento/Encabezado/IdDoc/Folio'],
    ['TipoDTE', './DTE/Documento/Encabezado/IdDoc/TipoDTE'],
    ['FechaEmision', './DTE/Documento/Encabezado/IdDoc/FchEmis'],
    ['RUTEmisor', './DTE/Documento/Encabezado/Emisor/RUTEmisor'],
    ['RazonSocialEmisor', './DTE/Documento/Encabezado/Emisor/RznSoc'],
    ['RUTReceptor', './DTE/Documento/Encabezado/Receptor/RUTRecep'],
    ['RazonSocialReceptor', './DTE/Documento/Encabezado/Receptor/RznSocRecep'],
    ['MontoNeto', './DTE/Documento/Encabezado/Totales/MntNeto'],
    ['MontoExento', './DTE/Documento/Encabezado/Totales/MntExe'],
    ['MontoIVA', './DTE/Documento/Encabezado/Totales/IVA'],
    ['MontoTotal', './DTE/Documento/Encabezado/Totales/MntTotal'],
  ]

  function _txt(xml, path) {
    try { return xml.evaluate(path, xml, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue?.textContent ?? '' } catch { return '' }
  }

  $drop.addEventListener('click', () => $input.click())
  ;['dragover', 'dragenter'].forEach((ev) => $drop.addEventListener(ev, (e) => { e.preventDefault(); $drop.classList.add('drag') }))
  ;['dragleave', 'drop'].forEach((ev) => $drop.addEventListener(ev, (e) => { e.preventDefault(); $drop.classList.remove('drag') }))
  $drop.addEventListener('drop', (e) => procesar(e.dataTransfer.files))
  $input.addEventListener('change', () => procesar($input.files))

  async function procesar(files) {
    const filas = []
    for (const file of files) {
      try {
        const texto = await file.text()
        const xml = new DOMParser().parseFromString(texto, 'application/xml')
        if (xml.querySelector('parsererror')) throw new Error('XML inválido')
        // Un DTE envío puede traer 1..N documentos (SetDte)
        const docs = xml.getElementsByTagName('Documento')
        for (const doc of docs) {
          const fila = { Archivo: file.name }
          for (const [nombre, path] of CAMPOS) {
            const node = doc.evaluate(path.replace('./DTE/Documento/', './'), doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
            fila[nombre] = node?.textContent ?? ''
          }
          filas.push(fila)
        }
      } catch (err) {
        showToast(`${file.name}: ${err.message}`, 'error')
      }
    }
    if (!filas.length) { $out.innerHTML = '<p class="libro-nota">No se extrajo ningún documento.</p>'; return }
    $out.innerHTML = `
      <p class="libro-nota" style="margin-top:1rem">✅ ${filas.length} documento(s) extraído(s) de ${files.length} archivo(s).</p>
      <div class="reporte-actions"><button type="button" class="btn btn-primary btn-sm" id="dte-excel">⬇ Descargar Excel</button></div>`
    document.getElementById('dte-excel').addEventListener('click', () => {
      const columnas = Object.keys(filas[0]).map((k) => ({ key: k, label: k }))
      exportarExcel(columnas, filas, 'DTE_convertido', 'DTE')
    })
  }
}

// ============ Despachador ============
window.Herramientas = {
  render(reporte, data, bannerErrores) {
    if (reporte.esDuplicadas) return renderDuplicadas(data, bannerErrores)
    if (reporte.esComparadorF29) return renderComparadorF29(data, bannerErrores)
    if (reporte.esIntereses) return renderIntereses(data, bannerErrores)
    if (reporte.esChecklist) return renderChecklistCierre(data, bannerErrores)
    if (reporte.esCobranza) return renderCobranza(data, bannerErrores)
    if (reporte.esConversorDte) return renderConversorDte(data, bannerErrores)
  },
}
