/**
 * Motor de reportes: una sola página, parametrizada por ?tipo=, que reutiliza
 * los datos que ya se obtienen de /api/informe (un cliente, rango de años) o
 * /api/proceso (todos los clientes, un período) — no se agregan más llamadas
 * al SII de las que ya hacían esas dos pantallas.
 */

function _mesLabel(m) { return `${m.mes_nombre} ${m.anio}` }

// Columnas de "montos" que ya se muestran con su propio campo normalizado
// (Exento/Neto/IVA/Total) — el resto de lo que el SII entregue como monto
// (IVA no recuperable, activo fijo, uso común, tabacos, otro impuesto, etc.)
// se agrega como columnas dinámicas, sin necesidad de conocer sus nombres de
// antemano — son la base de gestión para contabilizar.
const _MONTOS_YA_CUBIERTOS = /exento|^monto\s*neto$|^monto\s*total$|^monto\s*iva$|^monto\s*iva\s*recuperable$/i

function columnasMontosGestion(docs) {
  const vistos = new Map()
  docs.forEach((d) => {
    Object.keys(d.montos || {}).forEach((k) => {
      if (_MONTOS_YA_CUBIERTOS.test(k)) return
      if (!vistos.has(k)) vistos.set(k, `mg__${k}`)
    })
  })
  return [...vistos.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, key]) => ({ key, label, align: 'right', format: fmt }))
}

function conMontosGestionAplanados(doc, columnasExtra) {
  const plano = { ...doc }
  for (const col of columnasExtra) {
    const nombreOriginal = col.label
    plano[col.key] = (doc.montos || {})[nombreOriginal] || 0
  }
  return plano
}

const CATALOGO = {
  'iva-mensual': {
    titulo: 'IVA Mensual', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'debito_fiscal', label: 'Débito Fiscal', align: 'right', format: fmt },
      { key: 'credito_fiscal', label: 'Crédito Fiscal', align: 'right', format: fmt },
      { key: 'iva_pagar', label: 'IVA a Pagar / Remanente', align: 'right', format: (v) => (v < 0 ? `Remanente ${fmt(Math.abs(v))}` : fmt(v)) },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    chart: { tipo: 'line', label: 'IVA a pagar', valueKey: 'iva_pagar', labelKey: 'mes_label' },
    filtroMonto: { key: 'iva_pagar', label: 'IVA a pagar' },
  },
  'iva-anual': {
    titulo: 'IVA Anual', fuente: 'informe',
    columnas: [
      { key: 'anio', label: 'Año' },
      { key: 'debito_fiscal', label: 'Débito Fiscal', align: 'right', format: fmt },
      { key: 'credito_fiscal', label: 'Crédito Fiscal', align: 'right', format: fmt },
      { key: 'iva_pagar', label: 'IVA a Pagar / Remanente', align: 'right', format: fmt },
    ],
    filas: (d) => d.por_anio,
    chart: { tipo: 'bar', label: 'IVA a pagar', valueKey: 'iva_pagar', labelKey: 'anio' },
    filtroMonto: { key: 'iva_pagar', label: 'IVA a pagar' },
  },
  'iva-por-cliente': {
    titulo: 'IVA por Cliente (período)', fuente: 'proceso',
    columnas: [
      { key: 'nombre', label: 'Cliente' },
      { key: 'debito_fiscal', label: 'Débito', align: 'right', format: fmt },
      { key: 'credito_fiscal', label: 'Crédito', align: 'right', format: fmt },
      { key: 'iva_pagar', label: 'IVA a Pagar', align: 'right', format: fmt },
      { key: 'ppm_monto', label: 'PPM', align: 'right', format: fmt },
      { key: 'total_f29', label: 'Total F29', align: 'right', format: fmt },
    ],
    filas: (d) => d.resultados.filter((r) => r.estado === 'ok' && !r.exento),
    chart: { tipo: 'bar', label: 'Total F29', valueKey: 'total_f29', labelKey: 'nombre' },
    filtroTexto: { key: 'nombre', label: 'Buscar cliente' },
    filtroMonto: { key: 'total_f29', label: 'Total F29' },
  },
  'estado-iva': {
    titulo: 'Estado IVA', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'monto_abs', label: 'Monto', align: 'right', format: fmt },
      { key: 'estado_iva', label: 'Estado' },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({
      ...m, mes_label: _mesLabel(m), monto_abs: Math.abs(m.iva_pagar), estado_iva: m.iva_pagar < 0 ? 'Remanente' : 'A pagar',
    })),
    filtroEstado: { key: 'estado_iva', label: 'Estado', options: [{ value: '', label: 'Todos' }, { value: 'A pagar', label: 'A pagar' }, { value: 'Remanente', label: 'Remanente' }] },
    filtroMonto: { key: 'monto_abs', label: 'Monto' },
  },
  'ventas-mes': {
    titulo: 'Ventas por Mes', fuente: 'informe',
    columnas: [{ key: 'mes_label', label: 'Mes' }, { key: 'ventas_neto', label: 'Ventas Netas', align: 'right', format: fmt }],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    chart: { tipo: 'bar', label: 'Ventas Netas', valueKey: 'ventas_neto', labelKey: 'mes_label' },
    filtroMonto: { key: 'ventas_neto', label: 'Ventas Netas' },
  },
  'ventas-anio': {
    titulo: 'Ventas por Año', fuente: 'informe',
    columnas: [{ key: 'anio', label: 'Año' }, { key: 'ventas_neto', label: 'Ventas Netas', align: 'right', format: fmt }],
    filas: (d) => d.por_anio,
    chart: { tipo: 'bar', label: 'Ventas Netas', valueKey: 'ventas_neto', labelKey: 'anio' },
    filtroMonto: { key: 'ventas_neto', label: 'Ventas Netas' },
  },
  'compras-mes': {
    titulo: 'Compras por Mes', fuente: 'informe',
    columnas: [{ key: 'mes_label', label: 'Mes' }, { key: 'compras_neto', label: 'Compras Netas', align: 'right', format: fmt }],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    chart: { tipo: 'bar', label: 'Compras Netas', valueKey: 'compras_neto', labelKey: 'mes_label' },
    filtroMonto: { key: 'compras_neto', label: 'Compras Netas' },
  },
  'compras-anio': {
    titulo: 'Compras por Año', fuente: 'informe',
    columnas: [{ key: 'anio', label: 'Año' }, { key: 'compras_neto', label: 'Compras Netas', align: 'right', format: fmt }],
    filas: (d) => d.por_anio,
    chart: { tipo: 'bar', label: 'Compras Netas', valueKey: 'compras_neto', labelKey: 'anio' },
    filtroMonto: { key: 'compras_neto', label: 'Compras Netas' },
  },
  'comparativo-mensual': {
    titulo: 'Comparativo Mensual — Ventas vs Compras', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'ventas_neto', label: 'Ventas', align: 'right', format: fmt },
      { key: 'compras_neto', label: 'Compras', align: 'right', format: fmt },
      { key: 'margen', label: 'Margen', align: 'right', format: fmt },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    chart: { tipo: 'bar-doble', label1: 'Ventas', valueKey1: 'ventas_neto', label2: 'Compras', valueKey2: 'compras_neto', labelKey: 'mes_label' },
    filtroMonto: { key: 'margen', label: 'Margen' },
  },
  'comparativo-anual': {
    titulo: 'Comparativo Anual — Ventas vs Compras', fuente: 'informe',
    columnas: [
      { key: 'anio', label: 'Año' },
      { key: 'ventas_neto', label: 'Ventas', align: 'right', format: fmt },
      { key: 'compras_neto', label: 'Compras', align: 'right', format: fmt },
      { key: 'margen', label: 'Margen', align: 'right', format: fmt },
    ],
    filas: (d) => d.por_anio,
    chart: { tipo: 'bar-doble', label1: 'Ventas', valueKey1: 'ventas_neto', label2: 'Compras', valueKey2: 'compras_neto', labelKey: 'anio' },
    filtroMonto: { key: 'margen', label: 'Margen' },
  },
  'tendencias': {
    titulo: 'Tendencias (Ventas, Compras y Margen en el tiempo)', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'ventas_neto', label: 'Ventas', align: 'right', format: fmt },
      { key: 'compras_neto', label: 'Compras', align: 'right', format: fmt },
      { key: 'margen', label: 'Margen', align: 'right', format: fmt },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    chart: { tipo: 'linea-triple' },
    filtroMonto: { key: 'ventas_neto', label: 'Ventas Netas' },
  },
  'variaciones': {
    titulo: 'Variaciones Mes a Mes', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'ventas_neto', label: 'Ventas', align: 'right', format: fmt },
      { key: 'var_ventas', label: '% Variación Ventas', align: 'right', format: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`) },
      { key: 'var_compras', label: '% Variación Compras', align: 'right', format: (v) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v}%`) },
    ],
    filas: (d) => {
      const ok = d.meses.filter((m) => m.estado === 'ok')
      return ok.map((m, i) => {
        const anterior = ok[i - 1]
        const variacion = (actual, previo) => (previo ? Math.round(((actual - previo) / Math.abs(previo)) * 1000) / 10 : null)
        return {
          ...m, mes_label: _mesLabel(m),
          var_ventas: anterior ? variacion(m.ventas_neto, anterior.ventas_neto) : null,
          var_compras: anterior ? variacion(m.compras_neto, anterior.compras_neto) : null,
        }
      })
    },
    filtroMonto: { key: 'var_ventas', label: '% Variación Ventas' },
  },
  'ranking-mensual': {
    titulo: 'Ranking Mensual por Ventas', fuente: 'informe',
    columnas: [
      { key: 'puesto', label: '#' }, { key: 'mes_label', label: 'Mes' },
      { key: 'ventas_neto', label: 'Ventas Netas', align: 'right', format: fmt },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok')
      .map((m) => ({ ...m, mes_label: _mesLabel(m) }))
      .sort((a, b) => b.ventas_neto - a.ventas_neto)
      .map((m, i) => ({ ...m, puesto: i + 1 })),
    filtroMonto: { key: 'ventas_neto', label: 'Ventas Netas' },
  },
  'ranking-anual': {
    titulo: 'Ranking Anual por Ventas', fuente: 'informe',
    columnas: [
      { key: 'puesto', label: '#' }, { key: 'anio', label: 'Año' },
      { key: 'ventas_neto', label: 'Ventas Netas', align: 'right', format: fmt },
    ],
    filas: (d) => [...d.por_anio].sort((a, b) => b.ventas_neto - a.ventas_neto).map((a, i) => ({ ...a, puesto: i + 1 })),
    filtroMonto: { key: 'ventas_neto', label: 'Ventas Netas' },
  },
  'resumen-tributario': {
    titulo: 'Resumen Tributario', fuente: 'informe',
    columnas: [
      { key: 'mes_label', label: 'Mes' },
      { key: 'ventas_neto', label: 'Ventas Netas', align: 'right', format: fmt },
      { key: 'compras_neto', label: 'Compras Netas', align: 'right', format: fmt },
      { key: 'debito_fiscal', label: 'Débito', align: 'right', format: fmt },
      { key: 'credito_fiscal', label: 'Crédito', align: 'right', format: fmt },
      { key: 'iva_pagar', label: 'IVA a Pagar', align: 'right', format: fmt },
    ],
    filas: (d) => d.meses.filter((m) => m.estado === 'ok').map((m) => ({ ...m, mes_label: _mesLabel(m) })),
    filtroMonto: { key: 'iva_pagar', label: 'IVA a pagar' },
  },
  'top-clientes': {
    titulo: 'Top Clientes', fuente: 'informe',
    columnas: [
      { key: 'razonSocial', label: 'Cliente' }, { key: 'rut', label: 'RUT', format: formatRut },
      { key: 'cantidad', label: 'Documentos', align: 'right' },
      { key: 'neto', label: 'Neto', align: 'right', format: fmt },
      { key: 'iva', label: 'IVA', align: 'right', format: fmt },
      { key: 'total', label: 'Total', align: 'right', format: fmt },
    ],
    filas: (d) => d.top_clientes || [],
    chart: { tipo: 'bar-horizontal', label: 'Ventas Netas', valueKey: 'neto', labelKey: 'razonSocial' },
    filtroTexto: { key: 'razonSocial', label: 'Buscar cliente o RUT' },
    filtroMonto: { key: 'neto', label: 'Monto Neto' },
  },
  'top-proveedores': {
    titulo: 'Top Proveedores', fuente: 'informe',
    columnas: [
      { key: 'razonSocial', label: 'Proveedor' }, { key: 'rut', label: 'RUT', format: formatRut },
      { key: 'cantidad', label: 'Documentos', align: 'right' },
      { key: 'neto', label: 'Neto', align: 'right', format: fmt },
      { key: 'iva', label: 'IVA', align: 'right', format: fmt },
      { key: 'total', label: 'Total', align: 'right', format: fmt },
    ],
    filas: (d) => d.top_proveedores || [],
    chart: { tipo: 'bar-horizontal', label: 'Compras Netas', valueKey: 'neto', labelKey: 'razonSocial' },
    filtroTexto: { key: 'razonSocial', label: 'Buscar proveedor o RUT' },
    filtroMonto: { key: 'neto', label: 'Monto Neto' },
  },
  'kpis': {
    titulo: 'KPIs', fuente: 'informe', esKpi: true,
  },
  'alertas': {
    titulo: 'Alertas', fuente: 'informe', esAlertas: true,
  },
  'exportaciones': {
    titulo: 'Exportaciones', esInfo: true,
  },
  'libro-compras-rango': {
    titulo: 'Libro Compra (rango de meses/años)', fuente: 'informe', esLibroRango: true, tipoLibro: 'compras',
  },
  'libro-ventas-rango': {
    titulo: 'Libro Venta (rango de meses/años)', fuente: 'informe', esLibroRango: true, tipoLibro: 'ventas',
  },
  'desglose-gestion-compras': {
    titulo: 'Desglose de Gestión — Compras', fuente: 'informe', esDesgloseGestion: true, tipoLibro: 'compras',
  },
  'desglose-gestion-ventas': {
    titulo: 'Desglose de Gestión — Ventas', fuente: 'informe', esDesgloseGestion: true, tipoLibro: 'ventas',
  },
  'informe-gestion': {
    titulo: 'Informe de Gestión', fuente: 'informe', esInformeGestion: true,
  },
}

// Centro de Reportes: categorías con los ítems que se ven en el nav interno.
// "tipo" apunta a una clave de CATALOGO; "externo" navega a otra página
// (Libro de un solo mes sigue existiendo aparte, para consultas rápidas);
// "hijos" arma un desplegable (ej. IVA con sus 4 variantes).
const CATEGORIAS = [
  {
    label: 'Tributarios',
    items: [
      {
        label: 'IVA', hijos: [
          { label: 'Mensual', tipo: 'iva-mensual' },
          { label: 'Anual', tipo: 'iva-anual' },
          { label: 'Por Cliente', tipo: 'iva-por-cliente' },
          { label: 'Estado', tipo: 'estado-iva' },
        ],
      },
      { label: 'Libro Compra', tipo: 'libro-compras-rango' },
      { label: 'Libro Venta', tipo: 'libro-ventas-rango' },
      { label: 'Desglose Compras', tipo: 'desglose-gestion-compras' },
      { label: 'Desglose Ventas', tipo: 'desglose-gestion-ventas' },
      { label: 'Resumen', tipo: 'resumen-tributario' },
      { label: 'Exportaciones', tipo: 'exportaciones' },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { label: 'Clientes', tipo: 'top-clientes' },
      { label: 'Proveedores', tipo: 'top-proveedores' },
      {
        label: 'Ranking', hijos: [
          { label: 'Mensual', tipo: 'ranking-mensual' },
          { label: 'Anual', tipo: 'ranking-anual' },
        ],
      },
      { label: 'Evolución', tipo: 'ventas-mes' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      {
        label: 'Comparativos', hijos: [
          { label: 'Mensual', tipo: 'comparativo-mensual' },
          { label: 'Anual', tipo: 'comparativo-anual' },
        ],
      },
      { label: 'Tendencias', tipo: 'tendencias' },
      { label: 'Variaciones', tipo: 'variaciones' },
      { label: 'KPIs', tipo: 'kpis' },
      { label: 'Alertas', tipo: 'alertas' },
      { label: 'Informe de Gestión', tipo: 'informe-gestion' },
    ],
  },
]

const $titulo = document.getElementById('reporte-titulo')
const $controles = document.getElementById('reporte-controles')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $resultado = document.getElementById('reporte-resultado')
const $nav = document.getElementById('centro-nav')

let tipo = null
let reporte = null
let ultimoDato = null
let chartInstancia = null

function renderControlesInforme() {
  $controles.innerHTML = `
    <div class="controls-row">
      <div class="control-group">
        <label for="select-cliente">Empresa</label>
        <select id="select-cliente"><option value="">Cargando...</option></select>
      </div>
      ${rangoMesAnioHtml('rep')}
      <button type="button" class="btn btn-primary" id="btn-generar">Generar</button>
    </div>`

  inicializarRangoMesAnio('rep')
  cargarClientesEnSelect(document.getElementById('select-cliente'))

  document.getElementById('btn-generar').addEventListener('click', async () => {
    const clienteId = document.getElementById('select-cliente').value
    if (!clienteId) return showToast('Seleccione una empresa', 'error')
    const r = leerRangoMesAnio('rep')
    const errorRango = validarRangoMesAnio(r)
    if (errorRango) return showToast(errorRango, 'error')

    await ejecutarInforme(clienteId, r.anioInicio, r.anioFin, r.mesInicio, r.mesFin)
  })
}

function renderControlesProceso() {
  $controles.innerHTML = `
    <div class="controls-row">
      <div class="control-group">
        <label for="select-mes">Mes</label>
        <select id="select-mes"></select>
      </div>
      <div class="control-group">
        <label for="select-anio">Año</label>
        <select id="select-anio"></select>
      </div>
      <button type="button" class="btn btn-primary" id="btn-generar">Generar</button>
    </div>`

  const $mes = document.getElementById('select-mes')
  const $anio = document.getElementById('select-anio')
  MESES.forEach((n, i) => { $mes.innerHTML += `<option value="${i + 1}">${n}</option>` })
  const ahora = new Date()
  for (let y = ahora.getFullYear(); y >= ahora.getFullYear() - 3; y--) $anio.innerHTML += `<option value="${y}">${y}</option>`
  $mes.value = String(ahora.getMonth() + 1)
  $anio.value = String(ahora.getFullYear())

  document.getElementById('btn-generar').addEventListener('click', async () => {
    const periodo = periodoDesde($anio.value, $mes.value)
    await ejecutarProceso(periodo)
  })
}

async function cargarClientesEnSelect(select) {
  try {
    const clientes = await apiGet('/api/clientes')
    if (clientes.length === 0) {
      select.innerHTML = '<option value="">Sin clientes — agregue uno primero</option>'
      return
    }
    select.innerHTML = clientes.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')
  } catch {
    select.innerHTML = '<option value="">Error al cargar</option>'
  }
}

async function ejecutarInforme(clienteId, anioInicio, anioFin, mesInicio = 1, mesFin = 12) {
  $progress.hidden = false
  $resultado.innerHTML = ''
  try {
    const data = await apiPost('/api/informe/generar', {
      cliente_id: Number(clienteId), anio_inicio: anioInicio, anio_fin: anioFin,
      mes_inicio: mesInicio, mes_fin: mesFin, modo: 'resumen',
    })
    iniciarPolling(
      () => apiGet(`/api/informe/${data.informe_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressLabel.textContent = `Consultando SII... ${estado.procesados} de ${estado.total} (${pct}%)`
          if (estado.estado === 'completado') {
            $progress.hidden = true
            ultimoDato = estado
            renderReporte(estado)
          } else if (estado.estado === 'error') {
            $progress.hidden = true
            showToast(estado.error_msg || 'Error al generar el reporte', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    $progress.hidden = true
    showToast(err.message, 'error')
  }
}

async function ejecutarProceso(periodo) {
  $progress.hidden = false
  $resultado.innerHTML = ''
  try {
    const data = await apiPost('/api/proceso/generar', { periodo })
    iniciarPolling(
      () => apiGet(`/api/proceso/${data.proceso_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressLabel.textContent = `Procesando clientes... ${estado.procesados} de ${estado.total} (${pct}%)`
          if (estado.estado === 'completado') {
            $progress.hidden = true
            ultimoDato = estado
            renderReporte(estado)
          } else if (estado.estado === 'error') {
            $progress.hidden = true
            showToast(estado.error_msg || 'Error al generar el reporte', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    $progress.hidden = true
    showToast(err.message, 'error')
  }
}

// Construye la definición declarativa de filtros a partir de lo que cada
// reporte necesita (filtroTexto / filtroMonto / filtroEstado) — cada hoja
// termina con filtros distintos porque sus filas tienen campos distintos.
function definicionFiltros(rep) {
  const campos = []
  if (rep.filtroTexto) campos.push({ key: rep.filtroTexto.key, label: rep.filtroTexto.label, type: 'text', placeholder: 'Buscar...' })
  if (rep.filtroMonto) {
    campos.push({ key: `${rep.filtroMonto.key}__min`, label: `${rep.filtroMonto.label} mín.`, type: 'number' })
    campos.push({ key: `${rep.filtroMonto.key}__max`, label: `${rep.filtroMonto.label} máx.`, type: 'number' })
  }
  if (rep.filtroEstado) campos.push({ key: rep.filtroEstado.key, label: rep.filtroEstado.label, type: 'select', options: rep.filtroEstado.options })
  return campos
}

function aplicarFiltrosReporte(filas, rep, valores) {
  return filas.filter((fila) => {
    if (rep.filtroTexto && valores[rep.filtroTexto.key]) {
      const q = String(valores[rep.filtroTexto.key]).toLowerCase()
      const campo = String(fila[rep.filtroTexto.key] || '').toLowerCase()
      const campoRut = String(fila.rut || '').toLowerCase()
      if (!campo.includes(q) && !campoRut.includes(q)) return false
    }
    if (rep.filtroMonto) {
      const key = rep.filtroMonto.key
      const min = valores[`${key}__min`]
      const max = valores[`${key}__max`]
      if (min !== undefined && min !== '' && fila[key] < Number(min)) return false
      if (max !== undefined && max !== '' && fila[key] > Number(max)) return false
    }
    if (rep.filtroEstado && valores[rep.filtroEstado.key]) {
      if (String(fila[rep.filtroEstado.key]) !== String(valores[rep.filtroEstado.key])) return false
    }
    return true
  })
}

// Los meses/clientes que fallaron al consultar el SII no deben desaparecer en
// silencio — Informe de Gestión ya avisaba esto, el resto de los reportes no.
function calcularErroresParciales(data, rep) {
  if (rep.fuente === 'proceso') {
    return (data.resultados || [])
      .filter((r) => r.estado === 'error')
      .map((r) => ({ label: r.nombre, detalle: r.error_msg || 'Error desconocido' }))
  }
  return (data.meses || [])
    .filter((m) => m.estado === 'error')
    .map((m) => ({ label: `${m.mes_nombre} ${m.anio}`, detalle: m.error_msg || 'Error desconocido' }))
}

function bannerErroresHtml(errores) {
  if (errores.length === 0) return ''
  const plural = errores.length > 1
  return `
    <div class="libro-warning">
      ⚠ ${errores.length} período${plural ? 's' : ''} no se pud${plural ? 'ieron' : 'o'} consultar al SII:
      ${errores.map((e) => `<strong>${escapeHtml(e.label)}</strong> (${escapeHtml(e.detalle)})`).join(', ')}
    </div>`
}

function renderReporte(data) {
  const bannerErrores = bannerErroresHtml(calcularErroresParciales(data, reporte))

  if (reporte.esKpi) return renderKpis(data, bannerErrores)
  // Alertas ya lista los meses con error como una alerta más (tipo "error"),
  // no se duplica con el banner genérico.
  if (reporte.esAlertas) return renderAlertas(data)
  if (reporte.esLibroRango) return renderLibroRango(data, reporte, bannerErrores)
  if (reporte.esDesgloseGestion) return renderDesgloseGestion(data, reporte, bannerErrores)
  if (reporte.esInformeGestion) return renderInformeGestion(data, bannerErrores)

  const filasCompletas = reporte.filas(data)
  const tieneFiltros = reporte.filtroTexto || reporte.filtroMonto || reporte.filtroEstado

  $resultado.innerHTML = `
    ${bannerErrores}
    ${tieneFiltros ? '<div id="reporte-filtros"></div>' : ''}
    <div class="reporte-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-csv">⬇ CSV</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-excel">⬇ Excel</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-pdf">⬇ PDF</button>
    </div>
    ${reporte.chart ? `<div class="dash-card"><div class="chart-wrap"><canvas id="reporte-chart"></canvas></div></div>` : ''}
    <div id="reporte-tabla"></div>`

  let filasActuales = filasCompletas

  function repintar() {
    renderTabla(document.getElementById('reporte-tabla'), reporte.columnas, filasActuales, { vacio: 'Sin datos con estos filtros' })
    if (reporte.chart) dibujarChart(reporte.chart, filasActuales)
  }

  if (tieneFiltros) {
    renderFiltros(document.getElementById('reporte-filtros'), definicionFiltros(reporte), {}, (valores) => {
      filasActuales = aplicarFiltrosReporte(filasCompletas, reporte, valores)
      repintar()
    })
  }

  repintar()

  document.getElementById('btn-export-csv').addEventListener('click', () => exportarCSV(reporte.columnas, filasActuales, tipo))
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    try { exportarExcel(reporte.columnas, filasActuales, tipo) } catch (err) { showToast(err.message, 'error') }
  })
  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    try { exportarPDF(reporte.columnas, filasActuales, tipo, reporte.titulo) } catch (err) { showToast(err.message, 'error') }
  })
}

// Libro Compra/Venta como reporte de RANGO: documento a documento, a través
// de todos los meses/años seleccionados (no solo uno, como el Libro normal).
// Reutiliza la misma grilla estilo Excel (buscar/ordenar/agrupar/congelar/
// columnas/doble-click/click derecho) que ya usa libro.html para un mes solo.
function renderLibroRango(data, reporte, bannerErrores) {
  const crudos = reporte.tipoLibro === 'compras' ? (data.documentos_compras || []) : (data.documentos_ventas || [])
  const conSigno = crudos.map(conSignoNC) // NC en negativo — sumar la columna ya da el neto real
  const columnasGestion = columnasMontosGestion(conSigno)
  const docs = conSigno.map((d) => conMontosGestionAplanados(d, columnasGestion))
  const esVentas = reporte.tipoLibro === 'ventas'

  const totalExento = docs.reduce((s, d) => s + (d.montoExento || 0), 0)
  const totalNeto = docs.reduce((s, d) => s + d.montoNeto, 0)
  const totalIva = docs.reduce((s, d) => s + d.montoIVA, 0)
  const totalTotal = docs.reduce((s, d) => s + d.montoTotal, 0)

  $resultado.innerHTML = `
    ${bannerErrores}
    <div class="reporte-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-csv">⬇ CSV</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-excel">⬇ Excel</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-pdf">⬇ PDF</button>
    </div>
    <div class="kpi-grid" style="margin-bottom:1.5rem">
      <div class="kpi-card"><div class="kpi-label">Documentos</div><div class="kpi-valor">${docs.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Exento</div><div class="kpi-valor">${fmt(totalExento)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Neto</div><div class="kpi-valor" style="color:var(--accent)">${fmt(totalNeto)}</div></div>
      <div class="kpi-card"><div class="kpi-label">IVA</div><div class="kpi-valor">${fmt(totalIva)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total</div><div class="kpi-valor">${fmt(totalTotal)}</div></div>
    </div>
    <div id="reporte-grid"></div>`

  const columnas = [
    { key: 'periodo', label: 'Mes', congelar: true, format: (v) => periodoDisplay(v) },
    { key: 'folio', label: 'Folio' },
    { key: 'tipoDoc', label: 'Tipo', format: (v) => nombreTipoDoc(v) },
    { key: 'rutDoc', label: 'RUT', format: (v) => formatRut(v) },
    { key: 'razonSocial', label: 'Razón Social' },
    { key: 'montoExento', label: 'Exento', align: 'right', format: fmt },
    { key: 'montoNeto', label: 'Neto', align: 'right', format: fmt },
    { key: 'montoIVA', label: 'IVA', align: 'right', format: fmt },
    { key: 'montoTotal', label: 'Total', align: 'right', format: fmt },
  ]
  if (esVentas) columnas.push({ key: 'fechaReclamo', label: 'Fecha Reclamo', format: (v) => v || '—' })
  columnas.push(...columnasGestion)

  const columnasExport = columnas.map(({ key, label }) => ({ key, label }))

  renderDataGrid(document.getElementById('reporte-grid'), {
    columnas,
    filas: docs,
    agrupar: { key: 'periodo', label: 'mes' },
    nombreGrupo: (v) => periodoDisplay(v),
    totales: (filas) => filas.reduce((acc, f) => {
      const t = {
        montoExento: (acc.montoExento || 0) + (f.montoExento || 0),
        montoNeto: (acc.montoNeto || 0) + f.montoNeto,
        montoIVA: (acc.montoIVA || 0) + f.montoIVA,
        montoTotal: (acc.montoTotal || 0) + f.montoTotal,
      }
      for (const col of columnasGestion) t[col.key] = (acc[col.key] || 0) + (f[col.key] || 0)
      return t
    }, {}),
    onDobleClick: (fila) => mostrarModalDetalle(`Documento ${fila.folio}`, [
      ['Mes', periodoDisplay(fila.periodo)], ['Folio', fila.folio],
      ['Tipo de documento', nombreTipoDoc(fila.tipoDoc)], ['RUT contraparte', formatRut(fila.rutDoc)],
      ['Razón social', fila.razonSocial], ['Fecha documento', fila.fechaDocto || '—'],
      ['Monto exento', fmt(fila.montoExento || 0)],
      ['Monto neto', fmt(fila.montoNeto)], ['Monto IVA', fmt(fila.montoIVA)], ['Monto total', fmt(fila.montoTotal)],
      ...columnasGestion.filter((c) => fila[c.key]).map((c) => [c.label, fmt(fila[c.key])]),
      ...(fila.fechaReclamo ? [['⚠ Fecha reclamo', fila.fechaReclamo]] : []),
    ]),
    menuContextual: (fila) => [
      { label: '📋 Copiar RUT', accion: () => copiarAlPortapapeles(fila.rutDoc, 'RUT copiado') },
      { label: '📋 Copiar Folio', accion: () => copiarAlPortapapeles(fila.folio, 'Folio copiado') },
    ],
  })

  document.getElementById('btn-export-csv').addEventListener('click', () => exportarCSV(columnasExport, docs, tipo))
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    try { exportarExcel(columnasExport, docs, tipo) } catch (err) { showToast(err.message, 'error') }
  })
  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    try { exportarPDF(columnasExport, docs, tipo, reporte.titulo) } catch (err) { showToast(err.message, 'error') }
  })
}

// Desglose de Gestión: a diferencia del Libro (documento a documento), esto
// suma por mes todas las columnas con monto que entregó el SII — IVA no
// recuperable, activo fijo, uso común, tabacos, otro impuesto, etc. — para
// poder tomarlo directo y contabilizarlo, sin tener que sumar línea a línea.
function renderDesgloseGestion(data, reporte, bannerErrores) {
  const crudos = reporte.tipoLibro === 'compras' ? (data.documentos_compras || []) : (data.documentos_ventas || [])
  const conSigno = crudos.map(conSignoNC)
  const columnasGestion = columnasMontosGestion(conSigno)

  const porPeriodo = new Map()
  for (const d of conSigno) {
    if (!porPeriodo.has(d.periodo)) {
      const base = { periodo: d.periodo, mes_label: periodoDisplay(d.periodo), montoExento: 0, montoNeto: 0, montoIVA: 0, montoTotal: 0 }
      columnasGestion.forEach((c) => { base[c.key] = 0 })
      porPeriodo.set(d.periodo, base)
    }
    const acc = porPeriodo.get(d.periodo)
    acc.montoExento += d.montoExento || 0
    acc.montoNeto += d.montoNeto || 0
    acc.montoIVA += d.montoIVA || 0
    acc.montoTotal += d.montoTotal || 0
    columnasGestion.forEach((c) => { acc[c.key] += (d.montos || {})[c.label] || 0 })
  }

  const filas = [...porPeriodo.values()].sort((a, b) => a.periodo.localeCompare(b.periodo))

  const columnas = [
    { key: 'mes_label', label: 'Mes' },
    { key: 'montoExento', label: 'Exento', align: 'right', format: fmt },
    { key: 'montoNeto', label: 'Neto', align: 'right', format: fmt },
    { key: 'montoIVA', label: 'IVA', align: 'right', format: fmt },
    { key: 'montoTotal', label: 'Total', align: 'right', format: fmt },
    ...columnasGestion,
  ]

  $resultado.innerHTML = `
    ${bannerErrores}
    ${filas.length === 0 ? '' : `
    <div class="reporte-actions">
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-csv">⬇ CSV</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-excel">⬇ Excel</button>
      <button type="button" class="btn btn-secondary btn-sm" id="btn-export-pdf">⬇ PDF</button>
    </div>`}
    <div id="reporte-tabla"></div>`

  renderTabla(document.getElementById('reporte-tabla'), columnas, filas, { vacio: 'Sin documentos en este rango' })

  if (filas.length === 0) return

  document.getElementById('btn-export-csv').addEventListener('click', () => exportarCSV(columnas, filas, tipo))
  document.getElementById('btn-export-excel').addEventListener('click', () => {
    try { exportarExcel(columnas, filas, tipo) } catch (err) { showToast(err.message, 'error') }
  })
  document.getElementById('btn-export-pdf').addEventListener('click', () => {
    try { exportarPDF(columnas, filas, tipo, reporte.titulo) } catch (err) { showToast(err.message, 'error') }
  })
}

function renderKpis(data, bannerErrores = '') {
  const r = data.resumen
  $resultado.innerHTML = `
    ${bannerErrores}
    <section class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Ventas Netas</div><div class="kpi-valor" style="color:var(--accent)">${fmt(r.ventas_neto)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Compras Netas</div><div class="kpi-valor">${fmt(r.compras_neto)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Margen Bruto</div><div class="kpi-valor" style="color:var(--success)">${fmt(r.margen)}</div></div>
      <div class="kpi-card"><div class="kpi-label">% Margen</div><div class="kpi-valor" style="color:var(--success)">${r.pct_margen}%</div></div>
      <div class="kpi-card"><div class="kpi-label">Débito Fiscal</div><div class="kpi-valor">${fmt(r.debito_fiscal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Crédito Fiscal</div><div class="kpi-valor">${fmt(r.credito_fiscal)}</div></div>
      <div class="kpi-card"><div class="kpi-label">IVA a Pagar / Remanente</div><div class="kpi-valor" style="color:var(--warning)">${fmt(r.iva_pagar)}</div></div>
    </section>`
}

// Detección automática de inconsistencias a partir de los mismos datos que ya
// se descargaron para el Informe — no hace consultas adicionales al SII.
function calcularAlertas(data) {
  const alertas = []
  const ok = data.meses.filter((m) => m.estado === 'ok')
  const errores = data.meses.filter((m) => m.estado === 'error')

  errores.forEach((m) => alertas.push({
    tipo: 'error', titulo: `${m.mes_nombre} ${m.anio} no se pudo consultar`,
    detalle: m.error_msg || 'Error desconocido al consultar el SII',
  }))

  for (let i = 1; i < ok.length; i++) {
    const actual = ok[i]
    const anterior = ok[i - 1]
    if (anterior.ventas_neto > 0) {
      const variacion = Math.round(((actual.ventas_neto - anterior.ventas_neto) / anterior.ventas_neto) * 1000) / 10
      if (variacion <= -30) {
        alertas.push({
          tipo: 'advertencia', titulo: `Caída de ventas en ${actual.mes_nombre} ${actual.anio}`,
          detalle: `Las ventas cayeron ${Math.abs(variacion)}% respecto al mes anterior (${fmt(anterior.ventas_neto)} → ${fmt(actual.ventas_neto)})`,
        })
      }
    }
  }

  let remanenteSeguidos = 0
  for (const m of ok) {
    if (m.iva_pagar < 0) {
      remanenteSeguidos++
      if (remanenteSeguidos === 3) {
        alertas.push({
          tipo: 'info', titulo: `Remanente de IVA 3 meses seguidos (hasta ${m.mes_nombre} ${m.anio})`,
          detalle: 'El crédito fiscal ha superado al débito fiscal por 3 meses consecutivos — revisar si es un patrón esperado del negocio.',
        })
      }
    } else {
      remanenteSeguidos = 0
    }
  }

  const sinRut = [...(data.top_clientes || []), ...(data.top_proveedores || [])].filter((c) => c.rut === 'Sin RUT')
  sinRut.forEach((c) => alertas.push({
    tipo: 'advertencia', titulo: `Documento(s) sin RUT de contraparte`,
    detalle: `${c.cantidad} documento(s) por ${fmt(c.neto)} sin RUT identificado — revisar en el Libro del período correspondiente.`,
  }))

  const reclamadas = data.documentos_reclamados || []
  if (reclamadas.length > 0) {
    alertas.push({
      tipo: 'advertencia',
      titulo: `${reclamadas.length} factura${reclamadas.length > 1 ? 's' : ''} de venta reclamada${reclamadas.length > 1 ? 's' : ''} en el período`,
      detalle: 'Normalmente implica emitir Nota de Crédito o volver a facturar — ver detalle en la tabla de abajo.',
    })
  }

  return alertas
}

function renderAlertas(data) {
  const alertas = calcularAlertas(data)
  const iconos = { error: '🔴', advertencia: '🟡', info: '🔵' }
  const reclamadas = data.documentos_reclamados || []

  const listaHtml = alertas.length === 0
    ? `<div class="empty-state"><p>✅ No se detectaron inconsistencias en este período.</p></div>`
    : `<div class="alertas-list">
        ${alertas.map((a) => `
          <div class="alerta-card alerta-${a.tipo}">
            <span class="alerta-icono">${iconos[a.tipo]}</span>
            <div>
              <div class="alerta-titulo">${escapeHtml(a.titulo)}</div>
              <div class="alerta-detalle">${escapeHtml(a.detalle)}</div>
            </div>
          </div>`).join('')}
      </div>`

  const tablaReclamadasHtml = reclamadas.length === 0 ? '' : `
    <h3 class="libro-subtitle" style="margin-top:1.5rem">Facturas de venta reclamadas</h3>
    <table class="informe-table libro-table">
      <thead>
        <tr>
          <th>Mes</th><th>Fecha</th><th>Cliente</th><th>N° Factura</th>
          <th>Neto</th><th>IVA</th><th>Total</th><th>Fecha Reclamo</th>
        </tr>
      </thead>
      <tbody>
        ${reclamadas.map((r) => `
          <tr>
            <td>${r.mes_nombre} ${r.anio}</td>
            <td>${r.fechaDocto || '—'}</td>
            <td>${escapeHtml(r.razonSocial)}</td>
            <td>${r.folio}</td>
            <td>${fmt(r.montoNeto)}</td>
            <td>${fmt(r.montoIVA)}</td>
            <td>${fmt(r.montoTotal)}</td>
            <td>${r.fechaReclamo}</td>
          </tr>`).join('')}
      </tbody>
    </table>`

  $resultado.innerHTML = listaHtml + tablaReclamadasHtml
}

function renderInfoExportaciones() {
  $resultado.innerHTML = `
    <div class="empty-state">
      <p>Cada reporte de este centro trae sus propios botones ⬇ CSV / ⬇ Excel / ⬇ PDF arriba de la tabla —
      no es un reporte aparte, es una capacidad de todos. Selecciona cualquier reporte del menú de arriba,
      ajústalo con los filtros si quieres, y exporta desde ahí.</p>
    </div>`
}

function dibujarChart(cfg, filas) {
  if (typeof Chart === 'undefined') return
  if (chartInstancia) chartInstancia.destroy()
  const ctx = document.getElementById('reporte-chart')
  const defaults = {
    plugins: { legend: { labels: { color: '#94a3b8' } } },
    scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.06)' } },
      y: { ticks: { color: '#94a3b8', callback: (v) => fmtCorto(v) }, grid: { color: 'rgba(255,255,255,0.06)' } },
    },
  }

  if (cfg.tipo === 'bar-doble') {
    chartInstancia = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: filas.map((f) => f[cfg.labelKey]),
        datasets: [
          { label: cfg.label1, data: filas.map((f) => f[cfg.valueKey1]), backgroundColor: '#2563eb', borderRadius: 6 },
          { label: cfg.label2, data: filas.map((f) => f[cfg.valueKey2]), backgroundColor: '#94a3b8', borderRadius: 6 },
        ],
      },
      options: defaults,
    })
  } else if (cfg.tipo === 'linea-triple') {
    chartInstancia = new Chart(ctx, {
      type: 'line',
      data: {
        labels: filas.map((f) => f.mes_label),
        datasets: [
          { label: 'Ventas', data: filas.map((f) => f.ventas_neto), borderColor: '#2563eb', tension: 0.3 },
          { label: 'Compras', data: filas.map((f) => f.compras_neto), borderColor: '#94a3b8', tension: 0.3 },
          { label: 'Margen', data: filas.map((f) => f.margen), borderColor: '#10b981', tension: 0.3 },
        ],
      },
      options: defaults,
    })
  } else if (cfg.tipo === 'bar-horizontal') {
    chartInstancia = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: filas.slice(0, 10).map((f) => f[cfg.labelKey]),
        datasets: [{ label: cfg.label, data: filas.slice(0, 10).map((f) => f[cfg.valueKey]), backgroundColor: '#2563eb', borderRadius: 6 }],
      },
      options: { ...defaults, indexAxis: 'y' },
    })
  } else {
    chartInstancia = new Chart(ctx, {
      type: cfg.tipo,
      data: {
        labels: filas.map((f) => f[cfg.labelKey]),
        datasets: [{
          label: cfg.label, data: filas.map((f) => f[cfg.valueKey]),
          backgroundColor: cfg.tipo === 'line' ? 'rgba(37,99,235,0.15)' : '#2563eb',
          borderColor: '#2563eb', fill: cfg.tipo === 'line', tension: 0.3, borderRadius: 6,
        }],
      },
      options: defaults,
    })
  }
}

// --- Nav interno del Centro de Reportes ---

function itemHtml(item) {
  if (item.hijos) {
    const abierto = item.hijos.some((h) => h.tipo === tipo)
    return `
      <div class="centro-item-grupo">
        <button type="button" class="centro-item centro-item-toggle" data-grupo="${item.label}">${item.label} ▾</button>
        <div class="centro-item-hijos ${abierto ? 'open' : ''}">
          ${item.hijos.map((h) => `<button type="button" class="centro-item ${h.tipo === tipo ? 'active' : ''}" data-tipo="${h.tipo}">${h.label}</button>`).join('')}
        </div>
      </div>`
  }
  if (item.externo) {
    return `<a href="${item.externo}" class="centro-item">${item.label} ↗</a>`
  }
  return `<button type="button" class="centro-item ${item.tipo === tipo ? 'active' : ''}" data-tipo="${item.tipo}">${item.label}</button>`
}

function renderNav() {
  $nav.innerHTML = CATEGORIAS.map((cat) => `
    <div class="centro-categoria">
      <div class="centro-categoria-titulo">${cat.label}</div>
      ${cat.items.map(itemHtml).join('')}
    </div>`).join('')

  $nav.querySelectorAll('.centro-item-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.nextElementSibling.classList.toggle('open')
    })
  })

  $nav.querySelectorAll('.centro-item[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => seleccionarReporte(btn.dataset.tipo))
  })
}

function seleccionarReporte(nuevoTipo) {
  if (!CATALOGO[nuevoTipo]) return
  tipo = nuevoTipo
  reporte = CATALOGO[tipo]

  history.pushState(null, '', `?tipo=${tipo}`)
  document.title = `${reporte.titulo} — IVA Mensual`
  $titulo.textContent = reporte.titulo
  $progress.hidden = true
  $resultado.innerHTML = ''
  renderNav()

  if (reporte.esInfo) {
    $controles.innerHTML = ''
    renderInfoExportaciones()
    return
  }

  if (reporte.fuente === 'proceso') renderControlesProceso()
  else renderControlesInforme()
}

function init() {
  renderNav()
  const params = new URLSearchParams(location.search)
  const tipoInicial = params.get('tipo')
  if (tipoInicial && CATALOGO[tipoInicial]) {
    seleccionarReporte(tipoInicial)
  } else {
    $titulo.textContent = 'Selecciona un reporte'
    $resultado.innerHTML = `<div class="empty-state"><p>Elige un reporte del menú de arriba para empezar.</p></div>`
  }
}

window.addEventListener('popstate', () => {
  const params = new URLSearchParams(location.search)
  const t = params.get('tipo')
  if (t && CATALOGO[t]) seleccionarReporte(t)
})

// Cierra los desplegables del nav (IVA, Ranking, Comparativos) al hacer click
// fuera de ellos — la barra ahora es horizontal y se nota mucho más si quedan abiertos.
document.addEventListener('click', (e) => {
  document.querySelectorAll('.centro-item-hijos.open').forEach((hijos) => {
    if (!hijos.parentElement.contains(e.target)) hijos.classList.remove('open')
  })
})

// ============ INFORME DE GESTIÓN NARRATIVO ============
function renderInformeGestion(data, bannerErrores = '') {
  const { cliente, anio_inicio, anio_fin, mes_inicio, mes_fin, resumen, por_anio, meses, observaciones, modo } = data
  const inicioLabel = mes_inicio ? `${MESES[mes_inicio - 1]} ${anio_inicio}` : String(anio_inicio)
  const finLabel = mes_fin ? `${MESES[mes_fin - 1]} ${anio_fin}` : String(anio_fin)
  const periodoLabel = inicioLabel === finLabel ? inicioLabel : `${inicioLabel} — ${finLabel}`

  let html = `
    ${bannerErrores}
    <div class="informe-doc">
      <header class="informe-doc-header">
        <h2 class="informe-doc-title">Análisis de Ventas, Compras y Margen Bruto</h2>
        <p class="informe-doc-subtitle">${cliente.nombre} · RUT ${formatRut(cliente.rut)}</p>
        <p class="informe-doc-subtitle">Período: ${periodoLabel} · Cifras en pesos chilenos (CLP) — Montos Netos sin IVA</p>
      </header>

      <section class="informe-section">
        <h3 class="informe-section-title">1. Resumen Ejecutivo</h3>
        <p class="informe-text">
          En el período ${periodoLabel}, el negocio registró ventas netas acumuladas de
          <strong>${fmt(resumen.ventas_neto)}</strong> frente a compras netas de
          <strong>${fmt(resumen.compras_neto)}</strong>, generando un margen bruto de
          <strong>${fmt(resumen.margen)}</strong> equivalente al
          <strong>${resumen.pct_margen}%</strong> sobre las ventas.
        </p>
        <table class="informe-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th>Ventas Netas</th>
              <th>Compras Netas</th>
              <th>Margen Bruto</th>
              <th>% Margen</th>
            </tr>
          </thead>
          <tbody>`

  for (const grupo of por_anio) {
    if (por_anio.length > 1) {
      html += `<tr><td colspan="5" class="informe-anio-title">${grupo.anio}</td></tr>`
    }
    for (const m of grupo.meses) {
      html += `
        <tr>
          <td>${m.mes_nombre}${por_anio.length > 1 ? '' : ' ' + m.anio}</td>
          <td>${fmt(m.ventas_neto)}</td>
          <td>${fmt(m.compras_neto)}</td>
          <td class="margen-destacado">${fmt(m.margen)}</td>
          <td>${m.pct_margen}%</td>
        </tr>`
    }
    if (por_anio.length > 1) {
      html += `
        <tr class="row-total">
          <td>Total ${grupo.anio}</td>
          <td>${fmt(grupo.ventas_neto)}</td>
          <td>${fmt(grupo.compras_neto)}</td>
          <td class="margen-destacado">${fmt(grupo.margen)}</td>
          <td>${grupo.pct_margen}%</td>
        </tr>`
    }
  }

  html += `
        <tr class="row-total">
          <td>TOTAL ACUMULADO</td>
          <td>${fmt(resumen.ventas_neto)}</td>
          <td>${fmt(resumen.compras_neto)}</td>
          <td class="margen-destacado">${fmt(resumen.margen)}</td>
          <td>${resumen.pct_margen}%</td>
        </tr>
      </tbody></table>
    </section>`

  if (modo === 'detalle') {
    html += `<section class="informe-section"><h3 class="informe-section-title">2. Análisis por Mes</h3>`
    const okMeses = meses.filter(m => m.estado === 'ok')
    for (const m of okMeses) {
      const dv = m.detalle_ventas
      const dc = m.detalle_compras
      html += `
        <div class="mes-detalle">
          <h4>${m.mes_nombre} ${m.anio}</h4>
          <table class="detalle-table">
            <tr><td colspan="2"><strong>Ventas</strong></td></tr>
            <tr><td>Facturas emitidas</td><td>${fmt(dv.facturas)}</td></tr>
            ${dv.notas_debito ? `<tr><td>Notas de débito emitidas</td><td>${fmt(dv.notas_debito)}</td></tr>` : ''}
            ${dv.notas_credito ? `<tr><td>Notas de crédito emitidas</td><td>${fmt(dv.notas_credito)}</td></tr>` : ''}
            <tr class="row-total"><td>Total Ventas Netas</td><td>${fmt(m.ventas_neto)}</td></tr>
            <tr><td colspan="2" style="padding-top:0.75rem"><strong>Compras</strong></td></tr>
            <tr><td>Facturas recibidas</td><td>${fmt(dc.facturas)}</td></tr>
            ${dc.notas_credito ? `<tr><td>Notas de crédito recibidas</td><td>${fmt(dc.notas_credito)}</td></tr>` : ''}
            <tr class="row-total"><td>Total Compras Netas</td><td>${fmt(m.compras_neto)}</td></tr>
            <tr class="row-total"><td>MARGEN BRUTO</td><td class="margen-destacado">${fmt(m.margen)} (${m.pct_margen}%)</td></tr>
          </table>
        </div>`
    }
    html += `</section>`
  }

  const errores = meses.filter(m => m.estado === 'error')
  if (errores.length > 0) {
    html += `<section class="informe-section"><h3 class="informe-section-title">Meses con error</h3><table class="informe-table"><tbody>`
    for (const e of errores) {
      html += `<tr class="row-error"><td>${e.mes_nombre} ${e.anio}</td><td colspan="4">${e.error_msg}</td></tr>`
    }
    html += `</tbody></table></section>`
  }

  html += `
    <section class="informe-section">
      <h3 class="informe-section-title">${modo === 'detalle' ? '3' : '2'}. Tendencias y Observaciones</h3>
      <ul class="obs-list">
        ${observaciones.map(o => `<li>${o}</li>`).join('')}
      </ul>
      <p class="informe-text" style="margin-top:1rem;font-size:0.8125rem">
        Nota: Informe preparado en base a los libros de compras y ventas del período.
        Todos los montos son netos de IVA. Las notas de crédito se presentan como valores negativos.
      </p>
    </section>
    <div class="informe-actions">
      <button type="button" class="btn btn-primary" id="btn-print-informe"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5"/><path d="M18 18h2a2 2 0 0 0 2-2v-5"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>Imprimir / PDF</button>
      <button type="button" class="btn btn-secondary" id="btn-export-pdf-informe"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>Exportar PDF (jsPDF)</button>
    </div>`

  $resultado.innerHTML = html
  $resultado.hidden = false

  // Botón imprimir (usa estilos @media print del CSS)
  document.getElementById('btn-print-informe').addEventListener('click', () => window.print())

  // Botón exportar PDF con jsPDF (calidad profesional)
  document.getElementById('btn-export-pdf-informe').addEventListener('click', () => exportarInformeGestionPDF(data))
}

// Generar PDF profesional del Informe de Gestión usando jsPDF + autotable
async function exportarInformeGestionPDF(data) {
  if (typeof window.jspdf === 'undefined') {
    showToast('Falta cargar la librería de PDF (jsPDF) en esta página', 'error')
    return
  }
  const { jsPDF } = window.jspdf
  if (typeof jsPDF.API.autoTable !== 'function') {
    showToast('Falta cargar el plugin jspdf-autotable en esta página', 'error')
    return
  }

  try {
    const { cliente, anio_inicio, anio_fin, mes_inicio, mes_fin, resumen, por_anio, meses, observaciones, modo } = data
    const inicioLabel = mes_inicio ? `${MESES[mes_inicio - 1]} ${anio_inicio}` : String(anio_inicio)
    const finLabel = mes_fin ? `${MESES[mes_fin - 1]} ${anio_fin}` : String(anio_fin)
    const periodoLabel = inicioLabel === finLabel ? inicioLabel : `${inicioLabel} — ${finLabel}`

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const margin = 20
    let y = 20

    // Header
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(15, 23, 42) // slate-900
    doc.text('Análisis de Ventas, Compras y Margen Bruto', pageW / 2, y, { align: 'center' })
    y += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(71, 85, 105) // slate-500
    doc.text(`${cliente.nombre} · RUT ${formatRut(cliente.rut)}`, pageW / 2, y, { align: 'center' })
    y += 6
    doc.text(`Período: ${periodoLabel} · Cifras en pesos chilenos (CLP) — Montos Netos sin IVA`, pageW / 2, y, { align: 'center' })
    y += 12

    // Resumen ejecutivo
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text('1. Resumen Ejecutivo', margin, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(51, 65, 85) // slate-600
    const resumenText = `En el período ${periodoLabel}, el negocio registró ventas netas acumuladas de ${fmt(resumen.ventas_neto)} frente a compras netas de ${fmt(resumen.compras_neto)}, generando un margen bruto de ${fmt(resumen.margen)} equivalente al ${resumen.pct_margen}% sobre las ventas.`
    const splitResumen = doc.splitTextToSize(resumenText, pageW - 2 * margin)
    doc.text(splitResumen, margin, y)
    y += splitResumen.length * 5 + 4

    // Tabla mensual
    const tableHead = [['Mes', 'Ventas Netas', 'Compras Netas', 'Margen Bruto', '% Margen']]
    const tableBody = []
    for (const grupo of por_anio) {
      if (por_anio.length > 1) {
        tableBody.push([{ content: String(grupo.anio), colSpan: 5, styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: [15, 23, 42] } }])
      }
      for (const m of grupo.meses) {
        tableBody.push([
          `${m.mes_nombre}${por_anio.length > 1 ? '' : ' ' + m.anio}`,
          fmt(m.ventas_neto),
          fmt(m.compras_neto),
          fmt(m.margen),
          `${m.pct_margen}%`
        ])
      }
      if (por_anio.length > 1) {
        tableBody.push([
          `Total ${grupo.anio}`,
          fmt(grupo.ventas_neto),
          fmt(grupo.compras_neto),
          fmt(grupo.margen),
          `${grupo.pct_margen}%`
        ])
      }
    }
    tableBody.push([
      'TOTAL ACUMULADO',
      fmt(resumen.ventas_neto),
      fmt(resumen.compras_neto),
      fmt(resumen.margen),
      `${resumen.pct_margen}%`
    ])

    doc.autoTable({
      head: tableHead,
      body: tableBody,
      startY: y,
      margin: { left: margin, right: margin },
      styles: { fontSize: 9, cellPadding: 3, font: 'helvetica' },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        1: { halign: 'right', fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold', textColor: [37, 99, 235] },
        4: { halign: 'right' },
      },
      didDrawPage: (data) => {
        // Footer con número de página
        doc.setFontSize(8)
        doc.setTextColor(148, 163, 184)
        doc.text(`Página ${doc.internal.getNumberOfPages()}`, pageW / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' })
      }
    })

    y = doc.lastAutoTable.finalY + 8

    // Detalle por mes si modo === 'detalle'
    if (modo === 'detalle') {
      doc.addPage()
      y = 20
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(15, 23, 42)
      doc.text('2. Análisis por Mes', margin, y)
      y += 8

      const okMeses = meses.filter(m => m.estado === 'ok')
      for (const m of okMeses) {
        const dv = m.detalle_ventas
        const dc = m.detalle_compras
        doc.setFontSize(10)
        doc.setTextColor(15, 23, 42)
        doc.text(`${m.mes_nombre} ${m.anio}`, margin, y)
        y += 6

        const detHead = [['Concepto', 'Monto']]
        const detBody = [
          ['Facturas emitidas', fmt(dv.facturas)],
        ]
        if (dv.notas_debito) detBody.push(['Notas de débito emitidas', fmt(dv.notas_debito)])
        if (dv.notas_credito) detBody.push(['Notas de crédito emitidas', fmt(dv.notas_credito)])
        detBody.push(['Total Ventas Netas', fmt(m.ventas_neto)])
        detBody.push(['', ''])
        detBody.push(['Facturas recibidas', fmt(dc.facturas)])
        if (dc.notas_credito) detBody.push(['Notas de crédito recibidas', fmt(dc.notas_credito)])
        detBody.push(['Total Compras Netas', fmt(m.compras_neto)])
        detBody.push(['MARGEN BRUTO', `${fmt(m.margen)} (${m.pct_margen}%)`])

        doc.autoTable({
          head: detHead,
          body: detBody,
          startY: y,
          margin: { left: margin, right: margin },
          styles: { fontSize: 9, cellPadding: 2 },
          headStyles: { fillColor: [100, 116, 139], textColor: 255 },
          columnStyles: { 1: { halign: 'right' } },
        })
        y = doc.lastAutoTable.finalY + 10
        if (y > 260) { doc.addPage(); y = 20; }
      }
    }

    // Observaciones
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    doc.text(`${modo === 'detalle' ? '3' : '2'}. Tendencias y Observaciones`, margin, y)
    y += 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(51, 65, 85)
    for (const o of observaciones) {
      const splitObs = doc.splitTextToSize(`▸ ${o}`, pageW - 2 * margin)
      doc.text(splitObs, margin + 4, y)
      y += splitObs.length * 5 + 2
      if (y > 270) { doc.addPage(); y = 20; }
    }

    y += 6
    doc.setFontSize(8)
    doc.setTextColor(100, 116, 139)
    const notaText = 'Nota: Informe preparado en base a los libros de compras y ventas del período. Todos los montos son netos de IVA. Las notas de crédito se presentan como valores negativos.'
    const splitNota = doc.splitTextToSize(notaText, pageW - 2 * margin)
    doc.text(splitNota, margin, y)

    // Guardar
    const fileName = `Informe_Gestion_${cliente.rut.replace(/[.-]/g, '')}_${periodoLabel.replace(/\s/g, '_')}.pdf`
    doc.save(fileName)
    showToast('PDF generado correctamente')
  } catch (err) {
    console.error('Error generando PDF:', err)
    showToast('Error al generar PDF: ' + err.message, 'error')
  }
}

init()
