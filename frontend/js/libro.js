const $cliente = document.getElementById('select-cliente')
const $mes = document.getElementById('select-mes')
const $anio = document.getElementById('select-anio')
const $checkCompras = document.getElementById('check-compras')
const $checkVentas = document.getElementById('check-ventas')
const $btnConsultar = document.getElementById('btn-consultar')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $result = document.getElementById('libro-result')

// MESES, NOMBRES_TIPO_DOC, fmt, showToast, formatRut, periodoDisplay vienen de
// shared/format.js y shared/toast.js (cargados antes que este script).

function llenarSelectores() {
  MESES.forEach((nombre, idx) => {
    $mes.innerHTML += `<option value="${idx + 1}">${nombre}</option>`
  })
  const ahora = new Date()
  for (let y = 2023; y <= ahora.getFullYear(); y++) {
    $anio.innerHTML += `<option value="${y}">${y}</option>`
  }
  $mes.value = String(ahora.getMonth() + 1)
  $anio.value = String(ahora.getFullYear())
}

async function cargarClientes() {
  try {
    const res = await fetch('/api/clientes')
    const clientes = await res.json()
    if (clientes.length === 0) {
      $cliente.innerHTML = '<option value="">Sin clientes — agregue uno primero</option>'
      return
    }
    $cliente.innerHTML = clientes.map(c =>
      `<option value="${c.id}">${escapeHtml(c.nombre)} (${formatRut(c.rut)})</option>`
    ).join('')
  } catch {
    $cliente.innerHTML = '<option value="">Error al cargar</option>'
  }
}

function csvDescargable(filas, nombreArchivo) {
  const contenido = filas.map(f => f.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function descargarResumenCSV(libro) {
  const filas = [
    ['Tipo Documento', 'Total Documentos', 'Monto Exento', 'Monto Neto', 'IVA Recuperable', 'IVA Uso Común', 'IVA No Recuperable', 'Monto Total'],
    ...libro.resumen.map(r => [
      `${r.nombreTipoDoc} (${r.tipoDoc})`, r.cantidad, r.exento, r.neto, r.iva, r.ivaUsoComun, r.ivaNoRecuperable, r.total,
    ]),
  ]
  csvDescargable(filas, `resumen_${libro.tipo}_${libro.periodo}_${libro.cliente.rut}.csv`)
}

function descargarDetalleCSV(libro) {
  const conFechaReclamo = libro.tipo === 'ventas'
  const encabezado = ['Folio', 'Tipo Doc', 'RUT', 'Razón Social', 'Fecha Documento', 'Monto Exento', 'Monto Neto', 'Monto IVA', 'Monto Total']
  if (conFechaReclamo) encabezado.push('Fecha Reclamo')

  const filas = [
    encabezado,
    // NC en negativo — sumar la columna en Excel ya da el neto real.
    ...libro.detalle.map(conSignoNC).map(d => {
      const fila = [d.folio, d.tipoDoc, d.rutDoc, d.razonSocial, d.fechaDocto || '', d.montoExento || 0, d.montoNeto, d.montoIVA, d.montoTotal]
      if (conFechaReclamo) fila.push(d.fechaReclamo || '')
      return fila
    }),
  ]
  csvDescargable(filas, `detalle_${libro.tipo}_${libro.periodo}_${libro.cliente.rut}.csv`)
}

function renderAlertaReclamadas(libro) {
  if (libro.tipo !== 'ventas') return ''

  const reclamadas = libro.detalle.filter((d) => d.fechaReclamo)
  const periodoLabel = periodoDisplay(libro.periodo)

  if (reclamadas.length === 0) {
    return `<p class="libro-nota">✅ Sin facturas de venta reclamadas en ${periodoLabel}.</p>`
  }

  return `
    <div class="libro-warning libro-warning-reclamo">
      ⚠ Se encontraron ${reclamadas.length} factura${reclamadas.length > 1 ? 's' : ''} de venta
      <strong>reclamada${reclamadas.length > 1 ? 's' : ''}</strong> en ${periodoLabel} —
      normalmente hay que emitir Nota de Crédito o volver a facturar.
    </div>
    <table class="informe-table libro-table">
      <thead>
        <tr>
          <th>Mes</th><th>Fecha</th><th>Cliente</th><th>N° Factura</th>
          <th>Neto</th><th>IVA</th><th>Total</th><th>Fecha Reclamo</th>
        </tr>
      </thead>
      <tbody>
        ${reclamadas.map((d) => `
          <tr>
            <td>${periodoLabel}</td>
            <td>${escapeHtml(d.fechaDocto || '—')}</td>
            <td>${escapeHtml(d.razonSocial || '')}</td>
            <td>${escapeHtml(String(d.folio ?? ''))}</td>
            <td>${fmt(d.montoNeto)}</td>
            <td>${fmt(d.montoIVA)}</td>
            <td>${fmt(d.montoTotal)}</td>
            <td>${escapeHtml(d.fechaReclamo || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`
}

function renderLibro(libro) {
  const tituloTipo = libro.tipo === 'compras' ? '📦 Compras' : '🧾 Ventas'
  const idDetalle = `detalle-${libro.tipo}`

  const filasResumen = libro.resumen.map(r => `
    <tr>
      <td>${r.nombreTipoDoc} (${r.tipoDoc})</td>
      <td>${r.cantidad}</td>
      <td>${fmt(r.exento)}</td>
      <td>${fmt(r.neto)}</td>
      <td>${fmt(r.iva)}</td>
      <td>${fmt(r.ivaUsoComun)}</td>
      <td>${fmt(r.ivaNoRecuperable)}</td>
      <td>${fmt(r.total)}</td>
    </tr>`).join('')

  const t = libro.totales.neto || libro.totales.resumen

  return `
    <section class="libro-block">
      <div class="libro-block-header">
        <h2>${tituloTipo} — ${periodoDisplay(libro.periodo)}</h2>
        <div class="libro-block-actions">
          <button type="button" class="btn btn-secondary btn-sm btn-descargar-resumen" data-tipo="${libro.tipo}">⬇ Resumen CSV</button>
          <button type="button" class="btn btn-secondary btn-sm btn-descargar-detalle" data-tipo="${libro.tipo}">⬇ Detalle CSV</button>
        </div>
      </div>

      ${renderAlertaReclamadas(libro)}

      ${!libro.totales.cuadra ? `<p class="libro-warning">⚠ El total del resumen y el total del detalle no coinciden exactamente — revisar documentos con estado distinto de "registro".</p>` : ''}

      <h3 class="libro-subtitle">Resúmenes por tipo de documento</h3>
      <table class="informe-table libro-table">
        <thead>
          <tr>
            <th>Tipo Documento</th>
            <th>Total Documentos</th>
            <th>Monto Exento</th>
            <th>Monto Neto</th>
            <th>IVA Recuperable</th>
            <th>IVA Uso Común</th>
            <th>IVA No Recuperable</th>
            <th>Monto Total</th>
          </tr>
        </thead>
        <tbody>
          ${filasResumen || '<tr><td colspan="8" class="libro-empty">Sin documentos en este período</td></tr>'}
        </tbody>
        ${libro.resumen.length > 0 ? `
        <tfoot>
          <tr class="row-total">
            <td>TOTAL${libro.totales.tieneNotaCredito ? ' (NC descontada)' : ''}</td>
            <td>${libro.resumen.reduce((s, r) => s + r.cantidad, 0)}</td>
            <td>${fmt(t.exento)}</td>
            <td>${fmt(t.neto)}</td>
            <td>${fmt(t.iva)}</td>
            <td colspan="1"></td>
            <td colspan="1"></td>
            <td>${fmt(t.total)}</td>
          </tr>
        </tfoot>` : ''}
      </table>
      ${libro.totales.tieneNotaCredito ? `<p class="libro-nota">El total ya resta las Notas de Crédito (corrigen documentos anteriores). Cada fila de la tabla muestra el monto tal cual lo categoriza el SII, sin netear.</p>` : ''}

      <button type="button" class="btn btn-secondary btn-sm libro-toggle-detalle" data-target="${idDetalle}">Ver detalle (${libro.detalle.length} documentos)</button>

      <div class="libro-detalle" id="${idDetalle}" hidden></div>
    </section>`
}

function montarGridDetalle(tipo) {
  const libro = librosCargados[tipo]
  const contenedor = document.getElementById(`detalle-${tipo}`)
  if (!libro || !contenedor) return

  // NC en negativo — sumar la columna Neto/IVA/Total ya da el resultado neto real.
  const detalleConSigno = libro.detalle.map(conSignoNC)
  const detalleOriginal = detalleConSigno // salva la lista base para resetear filtros

  const gridControl = renderDataGrid(contenedor, {
    columnas: [
      { key: 'folio', label: 'Folio', congelar: true },
      { key: 'tipoDoc', label: 'Tipo', format: (v) => nombreTipoDoc(v) },
      { key: 'rutDoc', label: 'RUT' },
      { key: 'razonSocial', label: 'Razón Social' },
      { key: 'montoExento', label: 'Exento', align: 'right', format: fmt },
      { key: 'montoNeto', label: 'Neto', align: 'right', format: fmt },
      { key: 'montoIVA', label: 'IVA', align: 'right', format: fmt },
      { key: 'montoTotal', label: 'Total', align: 'right', format: fmt },
    ],
    filas: detalleConSigno,
    agrupar: { key: 'tipoDoc', label: 'tipo de documento' },
    nombreGrupo: (v) => nombreTipoDoc(v),
    totales: (filas) => filas.reduce((acc, f) => ({
      montoExento: (acc.montoExento || 0) + (f.montoExento || 0),
      montoNeto: (acc.montoNeto || 0) + f.montoNeto,
      montoIVA: (acc.montoIVA || 0) + f.montoIVA,
      montoTotal: (acc.montoTotal || 0) + f.montoTotal,
    }), {}),
    onDobleClick: (fila) => mostrarModalDetalle(`Documento ${fila.folio}`, [
      ['Folio', fila.folio],
      ['Tipo de documento', nombreTipoDoc(fila.tipoDoc)],
      ['RUT contraparte', formatRut(fila.rutDoc)],
      ['Razón social', fila.razonSocial],
      ['Fecha documento', fila.fechaDocto || '—'],
      ['Monto exento', fmt(fila.montoExento || 0)],
      ['Monto neto', fmt(fila.montoNeto)],
      ['Monto IVA', fmt(fila.montoIVA)],
      ['Monto total', fmt(fila.montoTotal)],
      ...(fila.fechaReclamo ? [['⚠ Fecha reclamo', fila.fechaReclamo]] : []),
    ]),
    menuContextual: (fila) => [
      { label: '👁 Ver detalle', accion: () => mostrarModalDetalle(`Documento ${fila.folio}`, [
        ['Folio', fila.folio], ['Tipo de documento', nombreTipoDoc(fila.tipoDoc)],
        ['RUT contraparte', formatRut(fila.rutDoc)], ['Razón social', fila.razonSocial],
        ['Monto neto', fmt(fila.montoNeto)], ['Monto IVA', fmt(fila.montoIVA)], ['Monto total', fmt(fila.montoTotal)],
      ]) },
      { label: '📋 Copiar RUT', accion: () => copiarAlPortapapeles(fila.rutDoc, 'RUT copiado') },
      { label: '📋 Copiar Folio', accion: () => copiarAlPortapapeles(fila.folio, 'Folio copiado') },
      { label: '⬇ Exportar esta fila', accion: () => exportarCSV(
        [
          { key: 'folio', label: 'Folio' }, { key: 'tipoDoc', label: 'Tipo Doc' },
          { key: 'rutDoc', label: 'RUT' }, { key: 'razonSocial', label: 'Razón Social' },
          { key: 'montoNeto', label: 'Neto' }, { key: 'montoIVA', label: 'IVA' }, { key: 'montoTotal', label: 'Total' },
        ],
        [fila], `documento_${fila.folio}`
      ) },
    ],
  })

  // Barra de filtros sobre el detalle (RUT/folio/tipo/monto) — usa shared/filters.js.
  const tiposDocUnicos = [...new Set(detalleOriginal.map((d) => d.tipoDoc))]
    .sort((a, b) => String(a).localeCompare(String(b), 'es'))
  const definicionFiltros = [
    { key: 'rut', label: 'RUT', type: 'text', placeholder: 'Ej: 12345678' },
    { key: 'folio', label: 'Folio', type: 'text', placeholder: 'N° folio' },
    { key: 'tipoDoc', label: 'Tipo', type: 'select', options: [{ value: '', label: 'Todos' }, ...tiposDocUnicos.map((v) => ({ value: v, label: nombreTipoDoc(v) }))] },
    { key: 'montoMin', label: 'Neto mín', type: 'number', placeholder: '0' },
    { key: 'montoMax', label: 'Neto máx', type: 'number', placeholder: '∞' },
  ]
  const filtrosHost = document.createElement('div')
  filtrosHost.className = 'libro-filtros'
  contenedor.insertBefore(filtrosHost, contenedor.firstChild)
  renderFiltros(filtrosHost, definicionFiltros, {}, (valores) => {
    const filtradas = aplicarFiltros(detalleOriginal, valores)
    gridControl.actualizar(filtradas)
  })
}

const librosCargados = {}

async function consultarLibro() {
  const clienteId = $cliente.value
  if (!clienteId) {
    showToast('Seleccione una empresa', 'error')
    return
  }

  const tipos = []
  if ($checkCompras.checked) tipos.push('compras')
  if ($checkVentas.checked) tipos.push('ventas')
  if (tipos.length === 0) {
    showToast('Seleccione al menos Compras o Ventas', 'error')
    return
  }

  const periodo = `${$anio.value}${String($mes.value).padStart(2, '0')}`

  $btnConsultar.disabled = true
  $progress.hidden = false
  $result.innerHTML = ''

  try {
    let html = ''
    for (const tipo of tipos) {
      $progressLabel.textContent = `Consultando ${tipo} en el SII...`
      const res = await fetch(`/api/sii/libro?cliente_id=${clienteId}&periodo=${periodo}&tipo=${tipo}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || `Error al consultar ${tipo}`)
      librosCargados[tipo] = data
      html += renderLibro(data)
    }
    $result.innerHTML = html
    activarBotonesResultado()
    tipos.forEach((tipo) => montarGridDetalle(tipo))
    showToast('Libro actualizado')
  } catch (err) {
    showToast(err.message, 'error')
  } finally {
    $progress.hidden = true
    $btnConsultar.disabled = false
  }
}

function activarBotonesResultado() {
  $result.querySelectorAll('.libro-toggle-detalle').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.dataset.target)
      el.hidden = !el.hidden
      btn.textContent = btn.textContent.replace(el.hidden ? 'Ocultar' : 'Ver', el.hidden ? 'Ver' : 'Ocultar')
    })
  })
  $result.querySelectorAll('.btn-descargar-resumen').forEach(btn => {
    btn.addEventListener('click', () => descargarResumenCSV(librosCargados[btn.dataset.tipo]))
  })
  $result.querySelectorAll('.btn-descargar-detalle').forEach(btn => {
    btn.addEventListener('click', () => descargarDetalleCSV(librosCargados[btn.dataset.tipo]))
  })
}

$btnConsultar.addEventListener('click', consultarLibro)

// Si se llega desde el Centro de Reportes (Libro Compra / Libro Venta),
// preseleccionar solo el checkbox correspondiente.
const tipoPreseleccionado = new URLSearchParams(location.search).get('tipo')
if (tipoPreseleccionado === 'compras') { $checkCompras.checked = true; $checkVentas.checked = false }
if (tipoPreseleccionado === 'ventas') { $checkCompras.checked = false; $checkVentas.checked = true }

llenarSelectores()
cargarClientes()
