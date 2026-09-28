/**
 * Centro Tributario: herramientas de análisis y control que reutilizan el
 * MISMO informe ya sincronizado (meses + documentos detalle) — sin consultas
 * nuevas al SII. Cinco vistas:
 *   validador-iva      → IVA débito/crédito recalculado doc a doc vs informe
 *   calculadora-ppm    → estimación PPM + F29 con escenarios
 *   calendario-tributario → vencimientos F29/F22 del rango sincronizado
 *   pendientes         → documentos que requieren revisión (reclamadas, sin RUT…)
 *   observaciones      → panel resumen: ¿mi empresa tiene observaciones?
 *
 * Este archivo se carga DESPUÉS de reportes.js y usa sus helpers globales
 * (registrarExport, botonesExportHtml, enlazarBotonesExport, calcularAlertas).
 */

const $resultadoTrib = document.getElementById('reporte-resultado')

function _fmtPct(n) { return `${n > 0 ? '+' : ''}${n}%` }

function _tablaHtml(headers, filas, clase = '') {
  return `
    <table class="informe-table ${clase}">
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${filas.join('')}</tbody>
    </table>`
}

function _kpiMini(label, valor, color = '') {
  return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-valor" style="${color ? `color:${color}` : ''}">${valor}</div></div>`
}

// ============ 1. VALIDADOR DE IVA ============
// El informe declara débito/crédito por mes (backend, sumarDocumentos). Aquí se
// recalcula lo mismo desde los documentos detalle que llegaron al navegador —
// si ambas rutas cuadran, el dato es confiable; si difieren, algo se perdió en
// el camino (parseo, NC, redondeo) y se muestra en rojo en vez de ocultarse.
function renderValidadorIva(data, bannerErrores) {
  const ventas = (data.documentos_ventas || []).map(conSignoNC)
  const compras = (data.documentos_compras || []).map(conSignoNC)

  if (ventas.length === 0 && compras.length === 0) {
    return renderTribSinDetalle('El validador necesita el detalle documento a documento.')
  }

  const porMes = new Map()
  const asegurar = (periodo, nombre) => {
    if (!porMes.has(periodo)) {
      porMes.set(periodo, {
        periodo, nombre,
        debDocs: 0, credDocs: 0, docsV: 0, docsC: 0,
        debInf: 0, credInf: 0,
      })
    }
    return porMes.get(periodo)
  }
  for (const m of data.meses.filter((x) => x.estado === 'ok')) {
    const f = asegurar(m.periodo, `${m.mes_nombre} ${m.anio}`)
    f.debInf = m.debito_fiscal || 0
    f.credInf = m.credito_fiscal || 0
  }
  for (const d of ventas) {
    const f = asegurar(d.periodo, `${d.mes_nombre || periodoDisplay(d.periodo)} ${d.anio || ''}`.trim())
    f.debDocs += d.montoIVA
    f.docsV++
  }
  for (const d of compras) {
    const f = asegurar(d.periodo, `${d.mes_nombre || periodoDisplay(d.periodo)} ${d.anio || ''}`.trim())
    f.credDocs += d.montoIVA
    f.docsC++
  }

  const filas = [...porMes.values()].sort((a, b) => a.periodo.localeCompare(b.periodo)).map((f) => {
    const dDeb = Math.round(f.debDocs - f.debInf)
    const dCred = Math.round(f.credDocs - f.credInf)
    const ok = dDeb === 0 && dCred === 0
    const color = ok ? 'var(--success)' : 'var(--danger)'
    return `
      <tr>
        <td>${escapeHtml(f.nombre || periodoDisplay(f.periodo))}</td>
        <td class="text-mono">${f.docsV}</td>
        <td class="text-mono" style="color:${color}">${fmt(f.debDocs)}</td>
        <td class="text-mono">${fmt(f.debInf)}</td>
        <td class="text-mono" style="color:${color}">${dDeb === 0 ? '✓' : fmt(dDeb)}</td>
        <td class="text-mono">${f.docsC}</td>
        <td class="text-mono" style="color:${color}">${fmt(f.credDocs)}</td>
        <td class="text-mono">${fmt(f.credInf)}</td>
        <td class="text-mono" style="color:${color}">${dCred === 0 ? '✓' : fmt(dCred)}</td>
      </tr>`
  })

  const totDebDocs = filas.reduce((s) => 0, 0) // (se recalcula abajo desde docs)
  const totalDebDocs = ventas.reduce((s, d) => s + d.montoIVA, 0)
  const totalCredDocs = compras.reduce((s, d) => s + d.montoIVA, 0)
  const totalDebInf = data.meses.filter((m) => m.estado === 'ok').reduce((s, m) => s + (m.debito_fiscal || 0), 0)
  const totalCredInf = data.meses.filter((m) => m.estado === 'ok').reduce((s, m) => s + (m.credito_fiscal || 0), 0)
  const concilia = Math.round(totalDebDocs - totalDebInf) === 0 && Math.round(totalCredDocs - totalCredInf) === 0
  void totDebDocs

  $resultadoTrib.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <section class="kpi-grid">
      ${_kpiMini('Débito según documentos', fmt(totalDebDocs), concilia ? 'var(--success)' : 'var(--danger)')}
      ${_kpiMini('Débito según informe', fmt(totalDebInf))}
      ${_kpiMini('Crédito según documentos', fmt(totalCredDocs), concilia ? 'var(--success)' : 'var(--danger)')}
      ${_kpiMini('Crédito según informe', fmt(totalCredInf))}
      ${_kpiMini('Veredicto', concilia ? '✓ Concilia' : '⚠ Diferencias', concilia ? 'var(--success)' : 'var(--danger)')}
    </section>
    ${_tablaHtml(
      ['Mes', 'Docs Vta', 'Débito docs', 'Débito informe', 'Δ débito', 'Docs Cmp', 'Crédito docs', 'Crédito informe', 'Δ crédito'],
      filas,
      'libro-table'
    )}
    <p class="libro-nota">El recalculo documento a documento usa las Notas de Crédito con signo negativo. Diferencias distintas de $0 indican documentos faltantes o montos mal clasificados — revisar el Libro del mes.</p>`

  registrarExport({
    columnas: [
      { key: 'nombre', label: 'Mes' },
      { key: 'docsV', label: 'Docs Ventas' },
      { key: 'debDocs', label: 'Débito según documentos' },
      { key: 'debInf', label: 'Débito según informe' },
      { key: 'dDeb', label: 'Δ Débito' },
      { key: 'docsC', label: 'Docs Compras' },
      { key: 'credDocs', label: 'Crédito según documentos' },
      { key: 'credInf', label: 'Crédito según informe' },
      { key: 'dCred', label: 'Δ Crédito' },
    ],
    filas: [...porMes.values()].map((f) => ({
      ...f,
      nombre: f.nombre || periodoDisplay(f.periodo),
      dDeb: Math.round(f.debDocs - f.debInf),
      dCred: Math.round(f.credDocs - f.credInf),
    })),
    titulo: 'Validador de IVA',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// ============ 2. CALCULADORA DE PPM ============
function renderCalculadoraPpm(data, bannerErrores) {
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const r = data.resumen

  $resultadoTrib.innerHTML = `
    ${bannerErrores}
    <div class="dash-card" style="margin-bottom:1.5rem">
      <h3>Estimación de PPM y F29 — usa las ventas ya sincronizadas como base editable</h3>
      <div class="controls-row" style="margin-top:1rem">
        <div class="control-group">
          <label class="form-label" for="ppm-ventas">Ventas netas del mes (CLP)</label>
          <input type="number" id="ppm-ventas" class="form-input" min="0" step="1000"
            value="${Math.round(r.ventas_neto / Math.max(ok.length, 1))}">
        </div>
        <div class="control-group">
          <label class="form-label" for="ppm-tasa">Tasa PPM</label>
          <select id="ppm-tasa" class="form-select">
            <option value="0.004">0,4% (rendimientos ≥ $50.000 UF/año)</option>
            <option value="0.005" selected>0,5% (1ª categoría)</option>
            <option value="0.01">1% (actividades especiales)</option>
          </select>
        </div>
        <div class="control-group">
          <label class="form-label" for="ppm-iva">IVA determinado del mes (CLP)</label>
          <input type="number" id="ppm-iva" class="form-input" step="1000"
            value="${Math.max(Math.round(r.iva_pagar / Math.max(ok.length, 1)), 0)}">
        </div>
      </div>
      <div class="kpi-grid" style="margin-top:1.5rem" id="ppm-resultados"></div>
      <p class="libro-nota">PPM = pago mínimo mensual (código 44 del F29). El F29 estimado es IVA determinado + PPM. Cifras referenciales — la tasa exacta depende de tu inicio de actividades y código de actividad.</p>
    </div>
    <h3 class="section-title">Escenarios con las ventas del período sincronizado</h3>
    <div id="ppm-escenarios"></div>`

  const $ventas = document.getElementById('ppm-ventas')
  const $tasa = document.getElementById('ppm-tasa')
  const $iva = document.getElementById('ppm-iva')

  function pintar() {
    const ventas = Number($ventas.value) || 0
    const tasa = Number($tasa.value)
    const iva = Number($iva.value) || 0
    const ppm = Math.round(ventas * tasa)
    const f29 = iva + ppm
    document.getElementById('ppm-resultados').innerHTML = [
      _kpiMini('PPM del mes', fmt(ppm), 'var(--warning)'),
      _kpiMini('IVA determinado', fmt(iva), iva === 0 ? 'var(--success)' : ''),
      _kpiF29(f29),
    ].join('')

    const anual = Math.round(r.ventas_neto)
    document.getElementById('ppm-escenarios').innerHTML = _tablaHtml(
      ['Tasa', 'PPM mensual promedio', 'PPM anual estimado', 'Ventas anuales base'],
      [0.004, 0.005, 0.01].map((t) => `
        <tr class="${t === tasa ? 'row-total' : ''}">
          <td>${(t * 100).toLocaleString('es-CL')}%</td>
          <td class="text-mono">${fmt((anual / Math.max(ok.length, 1)) * t)}</td>
          <td class="text-mono">${fmt(anual * t)}</td>
          <td class="text-mono">${fmt(anual)}</td>
        </tr>`)
    )
  }
  ;[$ventas, $tasa, $iva].forEach((el) => el.addEventListener('input', pintar))
  pintar()
}

function _kpiF29(f29) {
  return _kpiMini('F29 estimado a pagar', fmt(f29), 'var(--accent)')
}

// ============ 3. CALENDARIO TRIBUTARIO ============
function renderCalendarioTributario(data, bannerErrores) {
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
  const ANIO_F22 = new Date().getFullYear() // F22 de la operación 2025 se declara en abril 2026

  const filasCal = ok.map((m) => {
    // F29 del mes M se declara en M+1: vence el día 20 (electrónico).
    const venc = new Date(m.anio, m.mes, 0) // último día del mes de declaración... se calcula bien abajo
    const mesDecl = m.mes === 12 ? { y: m.anio + 1, m: 1 } : { y: m.anio, m: m.mes + 1 }
    const f29 = new Date(mesDecl.y, mesDecl.m - 1, 20)
    void venc
    const atrasado = f29 < hoy
    const proximo = !atrasado && (f29 - hoy) / 86400000 <= 7
    const badge = atrasado
      ? '<span class="cal-badge cal-vencido">Venció</span>'
      : proximo ? '<span class="cal-badge cal-proximo">Esta semana</span>' : '<span class="cal-badge cal-ok">En plazo</span>'
    const f29Label = `${String(f29.getDate()).padStart(2, '0')}/${String(f29.getMonth() + 1).padStart(2, '0')}/${f29.getFullYear()}`
    const iva = m.iva_pagar
    const ppm = Math.round(m.ventas_neto * 0.005)
    return `
      <tr>
        <td>${escapeHtml(m.mes_nombre)} ${m.anio}</td>
        <td class="text-mono">${f29Label}</td>
        <td>${badge}</td>
        <td class="text-mono">${iva < 0 ? `Remanente ${fmt(Math.abs(iva))}` : fmt(iva)}</td>
        <td class="text-mono">${fmt(ppm)}</td>
        <td class="text-mono" style="font-weight:600">${iva < 0 ? fmt(ppm) : fmt(iva + ppm)}</td>
      </tr>`
  })

  $resultadoTrib.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <div class="libro-warning">📅 El F29 del mes se declara el mes siguiente, vencimiento electrónico día 20 (papel día 12). El plazo exacto puede ajustar 1–3 días según el rol del RUT — confirma siempre en sii.cl. El PPM mostrado usa la tasa 0,5% referencial.</div>
    ${_tablaHtml(['Período declarado', 'Vence F29', 'Estado', 'IVA determinado', 'PPM (ref.)', 'Total F29 est.'], filasCal, 'libro-table')}
    <h3 class="section-title" style="margin-top:1.5rem">Declaración anual de renta (F22)</h3>
    ${_tablaHtml(
      ['Operación', 'Vence', 'Estado'],
      [`<tr>
        <td>Renta ${ANIO_F22 - 1} (operación ${ANIO_F22})</td>
        <td class="text-mono">Abril ${ANIO_F22} (según vencimiento del rol)</td>
        <td>${new Date(ANIO_F22, 3, 30) >= hoy ? '<span class="cal-badge cal-ok">En plazo</span>' : '<span class="cal-badge cal-vencido">Pasó</span>'}</td>
      </tr>`
      ])}
    <p class="libro-nota">Calendario construido solo con períodos que ya están sincronizados — sincroniza más meses para extenderlo.</p>`

  registrarExport({
    columnas: [
      { key: 'mes_label', label: 'Período declarado' },
      { key: 'vencimiento', label: 'Vence F29' },
      { key: 'estado', label: 'Estado', exportFormat: (v) => String(v).replace(/<[^>]+>/g, '').trim() },
      { key: 'iva', label: 'IVA determinado' },
      { key: 'ppm', label: 'PPM ref. 0,5%' },
      { key: 'total', label: 'Total F29 est.' },
    ],
    filas: ok.map((m) => {
      const mesDecl = m.mes === 12 ? { y: m.anio + 1, m: 1 } : { y: m.anio, m: m.mes + 1 }
      const f29 = new Date(mesDecl.y, mesDecl.m - 1, 20)
      const ppm = Math.round(m.ventas_neto * 0.005)
      return {
        mes_label: `${m.mes_nombre} ${m.anio}`,
        vencimiento: `${String(f29.getDate()).padStart(2, '0')}/${String(f29.getMonth() + 1).padStart(2, '0')}/${f29.getFullYear()}`,
        estado: f29 < hoy ? 'Venció' : 'En plazo',
        iva: m.iva_pagar, ppm, total: m.iva_pagar < 0 ? ppm : m.iva_pagar + ppm,
      }
    }),
    titulo: 'Calendario tributario',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// ============ 4. DETECTOR DE DOCUMENTOS PENDIENTES ============
function renderPendientes(data, bannerErrores) {
  const ventas = (data.documentos_ventas || []).map(conSignoNC)
  const compras = (data.documentos_compras || []).map(conSignoNC)
  if (ventas.length === 0 && compras.length === 0) {
    return renderTribSinDetalle('El detector necesita el detalle documento a documento.')
  }

  const grupos = []

  const reclamadas = ventas.filter((d) => d.fechaReclamo)
  if (reclamadas.length) grupos.push({
    titulo: `🔴 Facturas de venta reclamadas (${reclamadas.length})`,
    detalle: 'El cliente las rechazó — hay que emitir Nota de Crédito o volver a facturar.',
    docs: reclamadas, cols: ['Folio', 'Cliente', 'Fecha', 'Neto'],
    fila: (d) => `<td>${escapeHtml(String(d.folio))}</td><td>${escapeHtml(d.razonSocial)}</td><td>${escapeHtml(d.fechaDocto || '')}</td><td class="text-mono">${fmt(d.montoNeto)}</td>`,
  })

  const sinRutV = ventas.filter((d) => !d.rutDoc || /sin rut/i.test(d.rutDoc))
  if (sinRutV.length) grupos.push({
    titulo: `🟡 Ventas sin RUT de cliente (${sinRutV.length})`,
    detalle: 'Boletas u documentos sin identificación — normal en boletas, revisar si debían ser facturas.',
    docs: sinRutV, cols: ['Folio', 'Razón social', 'Fecha', 'Neto'],
    fila: (d) => `<td>${escapeHtml(String(d.folio))}</td><td>${escapeHtml(d.razonSocial || '—')}</td><td>${escapeHtml(d.fechaDocto || '')}</td><td class="text-mono">${fmt(d.montoNeto)}</td>`,
  })

  const ncCompras = compras.filter((d) => TIPOS_NOTA_CREDITO.has(Number(d.tipoDoc)))
  if (ncCompras.length) grupos.push({
    titulo: `🔵 Notas de crédito en compras (${ncCompras.length})`,
    detalle: 'Reducen tu crédito fiscal del mes — verificar que tengan documento de referencia válido.',
    docs: ncCompras, cols: ['Folio', 'Proveedor', 'Fecha', 'IVA'],
    fila: (d) => `<td>${escapeHtml(String(d.folio))}</td><td>${escapeHtml(d.razonSocial)}</td><td>${escapeHtml(d.fechaDocto || '')}</td><td class="text-mono">${fmt(d.montoIVA)}</td>`,
  })

  const sinIvaCompras = compras.filter((d) => !TIPOS_NOTA_CREDITO.has(Number(d.tipoDoc)) && d.montoNeto > 0 && d.montoIVA === 0 && d.montoExento === 0)
  if (sinIvaCompras.length) grupos.push({
    titulo: `🟡 Compras con neto sin IVA recuperable (${sinIvaCompras.length})`,
    detalle: 'IVA no recuperable, uso común o activo fijo — no genera crédito. Confirmar la clasificación para contabilizar.',
    docs: sinIvaCompras, cols: ['Folio', 'Proveedor', 'Fecha', 'Neto'],
    fila: (d) => `<td>${escapeHtml(String(d.folio))}</td><td>${escapeHtml(d.razonSocial)}</td><td>${escapeHtml(d.fechaDocto || '')}</td><td class="text-mono">${fmt(d.montoNeto)}</td>`,
  })

  const totalPend = grupos.reduce((s, g) => s + g.docs.length, 0)

  $resultadoTrib.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <section class="kpi-grid">
      ${_kpiMini('Documentos revisados', (ventas.length + compras.length).toLocaleString('es-CL'))}
      ${_kpiMini('Requieren revisión', totalPend.toLocaleString('es-CL'), totalPend ? 'var(--warning)' : 'var(--success)')}
      ${_kpiMini('Estado', totalPend === 0 ? '✓ Todo al día' : `${grupos.length} tipo(s) detectado(s)`, totalPend ? 'var(--warning)' : 'var(--success)')}
    </section>
    ${grupos.map((g) => `
      <div class="dash-card" style="margin-bottom:1.25rem">
        <h3>${g.titulo}</h3>
        <p class="libro-nota">${g.detalle}</p>
        ${_tablaHtml(g.cols, g.docs.slice(0, 50).map(g.fila), 'libro-table')}
        ${g.docs.length > 50 ? `<p class="libro-nota">Mostrando 50 de ${g.docs.length}.</p>` : ''}
      </div>`).join('')}
    ${totalPend === 0 ? '<div class="empty-state"><div class="empty-state-icon">✅</div><h3 class="empty-state-title">Sin pendientes</h3><p class="empty-state-desc">No se detectaron documentos que requieran revisión en este rango.</p></div>' : ''}`

  const todasFilas = grupos.flatMap((g) => g.docs.map((d) => ({ tipo: g.titulo.replace(/^\S+\s/, ''), folio: d.folio, contraparte: d.razonSocial, fecha: d.fechaDocto, neto: d.montoNeto, iva: d.montoIVA, periodo: d.periodo })))
  registrarExport({
    columnas: [
      { key: 'tipo', label: 'Tipo de pendiente' },
      { key: 'periodo', label: 'Mes', exportFormat: (v) => periodoDisplay(v) },
      { key: 'folio', label: 'Folio' },
      { key: 'contraparte', label: 'Contraparte' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'neto', label: 'Neto' },
      { key: 'iva', label: 'IVA' },
    ],
    filas: todasFilas,
    titulo: 'Documentos pendientes',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// ============ 5. PANEL DE OBSERVACIONES ============
function renderObservaciones(data, bannerErrores) {
  const r = data.resumen
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const errores = data.meses.filter((m) => m.estado === 'error')
  const alertas = calcularAlertas(data)
  const top3 = (data.top_clientes || []).slice(0, 3)
  const sumaTop3 = top3.reduce((s, c) => s + c.neto, 0)
  const pctConc = r.ventas_neto > 0 ? Math.round((sumaTop3 / r.ventas_neto) * 100) : 0
  const criticas = alertas.filter((a) => a.tipo === 'error').length

  const checklist = [
    { icon: errores.length ? '🔴' : '✅', texto: errores.length ? `${errores.length} mes(es) del rango NO se pudieron sincronizar — el informe tiene huecos.` : 'Todos los meses del rango están sincronizados.' },
    { icon: pctConc > 60 ? '🟡' : '✅', texto: `Los 3 mayores clientes concentran ${pctConc}% de las ventas${pctConc > 60 ? ' — concentración alta, dependencia de pocos clientes.' : '.'}` },
    { icon: r.iva_pagar < 0 ? '🔵' : '✅', texto: r.iva_pagar < 0 ? `Remanente de crédito fiscal acumulado de ${fmt(Math.abs(r.iva_pagar))} — se arrastra al próximo F29.` : 'No hay remanente de crédito fiscal pendiente.' },
    { icon: (data.documentos_reclamados || []).length ? '🔴' : '✅', texto: (data.documentos_reclamados || []).length ? `${data.documentos_reclamados.length} factura(s) de venta reclamada(s) — pendiente NC o refacturación.` : 'Sin facturas de venta reclamadas.' },
    { icon: criticas ? '🔴' : '✅', texto: criticas ? `${criticas} alerta(s) crítica(s) en el detector automático.` : `${alertas.length} alerta(s) informativa(s), ninguna crítica.` },
  ]

  $resultadoTrib.innerHTML = `
    ${bannerErrores}
    ${botonesExportHtml()}
    <h3 class="section-title">${r.iva_pagar < 0 || criticas || errores.length ? '🟡 Sí — hay observaciones para revisar' : '✅ Sin observaciones críticas'}</h3>
    <section class="kpi-grid">
      ${_kpiMini('Ventas del período', fmt(r.ventas_neto))}
      ${_kpiMini('Compras del período', fmt(r.compras_neto))}
      ${_kpiMini('Margen', `${fmt(r.margen)} (${r.pct_margen}%)`, 'var(--success)')}
      ${_kpiMini('IVA neto del período', r.iva_pagar < 0 ? `Remanente ${fmt(Math.abs(r.iva_pagar))}` : fmt(r.iva_pagar), r.iva_pagar < 0 ? 'var(--accent)' : 'var(--warning)')}
    </section>
    <div class="dash-card">
      <h3>Checklist tributaria del período</h3>
      <ul class="obs-list">
        ${checklist.map((c) => `<li>${c.icon} ${escapeHtml(c.texto)}</li>`).join('')}
      </ul>
    </div>
    ${alertas.length ? `
      <h3 class="section-title" style="margin-top:1.5rem">Alertas detectadas (${alertas.length})</h3>
      <div class="alertas-list">
        ${alertas.map((a) => `
          <div class="alerta-card alerta-${a.tipo}">
            <span class="alerta-icono">${{ error: '🔴', advertencia: '🟡', info: '🔵' }[a.tipo] || '🔵'}</span>
            <div>
              <div class="alerta-titulo">${escapeHtml(a.titulo)}</div>
              <div class="alerta-detalle">${escapeHtml(a.detalle)}</div>
            </div>
          </div>`).join('')}
      </div>` : ''}`

  registrarExport({
    columnas: [
      { key: 'concepto', label: 'Concepto' },
      { key: 'valor', label: 'Detalle', exportFormat: (v) => String(v).replace(/<[^>]+>/g, '') },
    ],
    filas: [
      ...checklist.map((c) => ({ concepto: 'Checklist', valor: c.texto })),
      ...alertas.map((a) => ({ concepto: `Alerta ${a.tipo}`, valor: `${a.titulo} — ${a.detalle}` })),
    ],
    titulo: 'Observaciones tributarias',
    data,
    esDetalleDocumentos: false,
  })
  enlazarBotonesExport()
}

// Mensaje común cuando el informe activo no trae detalle de documentos
// (sincronizado en modo resumen con una versión antigua).
function renderTribSinDetalle(motivo) {
  $resultadoTrib.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">📄</div>
      <h3 class="empty-state-title">Falta el detalle de documentos</h3>
      <p class="empty-state-desc">${escapeHtml(motivo)} Los informes sincronizados antes del modo detalle no lo trajeron. Presiona "⚡ Sincronizar con el SII": los meses cerrados ya están en caché, así que la regeneración es casi instantánea.</p>
      <div class="empty-state-cta">
        <button type="button" class="btn btn-primary" id="btn-sincronizar-trib">⚡ Sincronizar con el SII</button>
      </div>
    </div>`
  document.getElementById('btn-sincronizar-trib').addEventListener('click', () => {
    const clienteId = window.ShellState.getClienteId()
    if (!clienteId) { showToast('Selecciona una empresa primero', 'error'); return }
    window.ReportesEngine.ejecutarInformeReal(clienteId, window.ShellState.getRango())
  })
}

// Despachador único que reportes.js llama para las vistas esTributario
window.Tributario = {
  render(reporte, data, bannerErrores) {
    if (reporte.esValidadorIva) return renderValidadorIva(data, bannerErrores)
    if (reporte.esCalculadoraPpm) return renderCalculadoraPpm(data, bannerErrores)
    if (reporte.esCalendario) return renderCalendarioTributario(data, bannerErrores)
    if (reporte.esPendientes) return renderPendientes(data, bannerErrores)
    if (reporte.esObservaciones) return renderObservaciones(data, bannerErrores)
  },
}
