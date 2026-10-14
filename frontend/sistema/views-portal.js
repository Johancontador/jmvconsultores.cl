/**
 * views-portal.js — PORTAL DE INTELIGENCIA COMERCIAL (§A, §B, §C y §H).
 *
 * Capa de CONSULTA para la empresa cliente: consume /api/portal (read-only,
 * aislamiento server-side). Estados honestos en TODA vista: cargando, error,
 * sin datos (null del motor ≠ cero §7). Formato CLP chileno.
 *
 * NOTA DE DATOS (§3, catálogo A-E): vendedor, SKU, costo, morosidad y
 * cotizaciones NO existen en la fuente (bandeja RCV) — sus secciones NO se
 * dibujan como si existieran; el constructor (§H) solo ofrece métricas del
 * catálogo REAL expuesto en /api/portal/metricas.
 */

/* global VIEWS, esc, apiGet, apiPost, apiPut, apiDelete, S, UIEstado, inputPeriodoHTML, leerPeriodo, periodoActual */

/* Helpers compartidos del portal */

function fmtCLP(n) {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n))
}
function fmtPctPortal(v) {
  if (v === null || v === undefined) return '—'
  const signo = v > 0 ? '+' : ''
  return `${signo}${v.toFixed(1)}%`
}
function perLabelPortal(p) {
  if (!p || p.length < 6) return p || ''
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${meses[Number(p.slice(4)) - 1] || ''} ${p.slice(0, 4)}`
}

/**
 * Canvas simple de barras (SVG, sin dependencias): serie {meses[], neto[]}.
 * INTERACTIVO: cada barra con datos es un rect clicable (`data-periodo`);
 * `alClic(periodo)` dispara el drill-down del dashboard. Meses sin datos
 * (null) quedan como raya vacía NO clicable.
 */
function barrasSerieHTML(serie, alClic = null) {
  const conDatos = serie.filter((s) => s.neto !== null && s.neto !== undefined)
  const accion = alClic || (() => {})
  if (!conDatos.length) {
    return UIEstado.vacio('Sin datos en el rango', 'Todavía no hay documentos vivos en los períodos consultados.')
  }
  const max = Math.max(...conDatos.map((s) => Math.abs(s.neto)), 1)
  const W = 720, H = 200, bw = W / serie.length
  const barras = serie.map((s, i) => {
    if (s.neto === null || s.neto === undefined) {
      return `<rect x="${i * bw + bw * 0.15}" y="${H - 4}" width="${bw * 0.7}" height="4" fill="var(--border)"/>`
    }
    const h = Math.max(4, Math.round((Math.abs(s.neto) / max) * (H - 20)))
    const clicable = alClic ? ` class="pb-barra" data-periodo="${s.periodo}" style="cursor:pointer"` : ''
    return `<rect${clicable} x="${i * bw + bw * 0.15}" y="${H - h}" width="${bw * 0.7}" height="${h}" rx="3" fill="var(--primary)" opacity="0.85"><title>${perLabelPortal(s.periodo)}: ${fmtCLP(s.neto)} — clic para ver detalle</title></rect>`
  }).join('')
  const labels = serie.map((s, i) =>
    `<text x="${i * bw + bw / 2}" y="${H - 0}" font-size="10" text-anchor="start" fill="var(--muted)" transform="rotate(45 ${i * bw + bw / 2} ${H})">${s.periodo.slice(4)}</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Ventas mensuales" style="width:100%;height:auto">${barras}${labels}</svg><div class="hint" style="margin-top:6px">${conDatos.length} mes(es) con datos de ${serie.length}${alClic ? ' — clic en una barra para ver el detalle del mes' : ''}. Escala máx: ${fmtCLP(max)}.</div>`
}

/* ------------------------------ §A: INICIO ------------------------------ */

window.VIEWS['portal-inicio'] = {
  titulo: 'Portal — Dashboard',
  async render(cont) {
    const eid = S.empresa.id
    // Estado INTERACTIVO del dashboard: vive solo dentro de la vista. Cada
    // control (rango, flujo, drill-down) muta este objeto y repinta la zona
    // afectada sin recargar todo.
    const estado = { flujo: 'venta', meses: 12 }

    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end;gap:16px">
          <div><span class="frm-label">Flujo</span>
            <div class="frm-row" style="gap:0">
              <button class="btn ${estado.flujo === 'venta' ? 'btn-primary' : 'btn-secondary'}" id="pd-flujo-venta">Ventas</button>
              <button class="btn ${estado.flujo === 'compra' ? 'btn-primary' : 'btn-secondary'}" id="pd-flujo-compra">Compras</button>
            </div></div>
          <div><span class="frm-label">Rango</span>
            <select id="pd-meses" class="form-input" style="width:auto">
              <option value="6">Últimos 6 meses</option>
              <option value="12" selected>Últimos 12 meses</option>
              <option value="24">Últimos 24 meses</option>
            </select></div>
          <div><span class="frm-label">Hasta (mes ancla)</span>${inputPeriodoHTML('pd-hasta', '')}</div>
          <button class="btn btn-secondary" id="pd-recargar">Aplicar</button>
        </div>
        <p class="hint mt">Todo es consultable: el gráfico, los clientes y el detalle de mes provienen SIEMPRE del servidor (aislamiento §8); nada se calcula en el navegador.</p>
      </div>
      <div id="pd-zona">${UIEstado.cargando('Consultando métricas de tu empresa…')}</div>
      <div id="pd-detalle"></div>`

    // — KPIs del flujo activo — llama /serie (rango móvil) y /resumen (KPI del
    // flujo activo, período ancla). El resumen es de venta por diseño (§A);
    // si el flujo es compra, se ocultan los KPIs de clientes de venta.
    const flujoLabel = () => (estado.flujo === 'venta' ? 'Venta neta' : 'Compras netas')

    async function pintarDashboard() {
      const zona = document.getElementById('pd-zona')
      if (!zona) return
      zona.innerHTML = UIEstado.cargando('Consultando serie y KPIs…')
      try {
        const qsSerie = `meses=${estado.meses}&flujo=${estado.flujo}&hasta=${leerPeriodo('pd-hasta') || ''}`
        const sr = await apiGet(`/api/portal/empresas/${eid}/serie?${qsSerie}`)
        const S_ = sr.serie
        if (!S_.meses.length || S_.meses.every((m) => m.neto === null)) {
          zona.innerHTML = UIEstado.vacio(
            `Sin RCV de ${estado.flujo === 'venta' ? 'ventas' : 'compras'} en el rango`,
            'Cuando tu empresa tenga documentos sincronizados del SII en los últimos meses, aquí verás el dashboard. Esto NO es cero: significa que no hay datos que mostrar.')
          return
        }
        // KPIs del mes ancla (último con datos de la serie): usamos /resumen
        // solo para venta; para compra mostramos solo la serie + totales.
        let kpis = ''
        if (estado.flujo === 'venta') {
          const r = await apiGet(`/api/portal/empresas/${eid}/resumen?periodo=${S_.hasta}`)
          if (r.resumen) {
            const R = r.resumen
            const vari = R.ventas.variacion_pct
            kpis = `
              <div class="card">
                <h3>${flujoLabel()} de ${perLabelPortal(R.periodo)}</h3>
                <div style="font-size:var(--fs-xl);font-weight:700">${fmtCLP(R.ventas.neta)}</div>
                <p class="muted">Variación vs. ${perLabelPortal(R.periodo_previo)}: <b>${fmtPctPortal(vari)}</b>
                  ${vari === null ? '<span class="hint">(sin datos del mes comparable — no se muestra como 0%)</span>' : ''}</p>
                <div class="frm-row mt" style="gap:24px">
                  <div><span class="frm-label">Clientes compradores</span><div style="font-weight:600">${fmtCLP(R.clientes_compradores)}</div></div>
                  <div><span class="frm-label">Ticket prom. por documento</span><div style="font-weight:600">${fmtCLP(R.ticket_promedio_documento)}</div></div>
                  <div><span class="frm-label">Ticket prom. por cliente</span><div style="font-weight:600">${fmtCLP(R.ticket_promedio_cliente)}</div></div>
                  <div><span class="frm-label">Concentración top 5</span><div style="font-weight:600">${fmtPctPortal(R.concentracion_top5_pct)}</div></div>
                </div>
              </div>`
          }
        } else {
          const r = await apiGet(`/api/portal/empresas/${eid}/movimientos?flujo=compra&desde=&hasta=${S_.hasta}&limit=1`)
          const neto = r.neto || 0
          kpis = `
            <div class="card">
              <h3>Compras netas de ${perLabelPortal(S_.hasta)}</h3>
              <div style="font-size:var(--fs-xl);font-weight:700">${fmtCLP(neto)}</div>
              <p class="hint">Total del período ancla; el detalle mes a mes está en el gráfico. Las NC de compra (60/61) descuentan una vez.</p>
            </div>`
        }
        zona.innerHTML = `${kpis}
          <div class="card mt">
            <div class="frm-row" style="align-items:baseline;justify-content:space-between">
              <h3>${estado.flujo === 'venta' ? 'Ventas' : 'Compras'} netas — ${perLabelPortal(S_.desde)} a ${perLabelPortal(S_.hasta)}</h3>
              <span class="hint">Clic en una barra para ver el detalle del mes</span>
            </div>
            <div id="pd-grafico">${barrasSerieHTML(S_.meses, (p) => abrirDetalle(p))}</div>
            ${estado.flujo === 'venta' ? `<div class="card mt">
              <h3>Principales clientes de ${perLabelPortal(S_.hasta)}</h3>
              <div id="pd-top">${UIEstado.cargando()}</div>
            </div>` : ''}
          </div>
          <p class="hint mt">Fuente: RCV del SII. Vendedor, productos (SKU), costos, morosidad y cotizaciones no existen en esta fuente todavía — ese análisis no se ofrece para no inventar datos.
            Los montos son los informados al SII; las notas de crédito (60/61) descuentan una vez.</p>`
        if (estado.flujo === 'venta') await pintarTop(S_.hasta)
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message, '<button class="btn btn-secondary mt" onclick="location.reload()">Reintentar</button>')
      }
    }

    async function pintarTop(p) {
      const zona = document.getElementById('pd-top')
      if (!zona) return
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/resumen?periodo=${p}`)
        if (!r.resumen || !r.resumen.top_clientes.length) {
          zona.innerHTML = UIEstado.vacio('Sin clientes en el período', 'No hay documentos de venta vivos en ese mes para listar clientes.')
          return
        }
        zona.innerHTML = `
          <table class="tbl">
            <thead><tr><th>Cliente</th><th style="text-align:right">Docs</th><th style="text-align:right">Venta neta</th><th></th></tr></thead>
            <tbody>
              ${r.resumen.top_clientes.map((c) => `
                <tr>
                  <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                  <td style="text-align:right">${c.docs}</td>
                  <td style="text-align:right">${fmtCLP(c.neto)}</td>
                  <td><button class="btn btn-secondary" data-ver-mes="${p}" data-ver-rut="${esc(c.rut)}">Ver detalle</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`
        zona.querySelectorAll('[data-ver-mes]').forEach((b) =>
          b.addEventListener('click', () => abrirDetalle(b.dataset.verMes, b.dataset.verRut)))
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    /** Drill-down: detalle de UN mes (y opcionalmente de UN RUT) en /pd-detalle. */
    async function abrirDetalle(periodo, rut = null) {
      const zona = document.getElementById('pd-detalle')
      if (!zona) return
      zona.innerHTML = UIEstado.cargando(`Consultando detalle de ${perLabelPortal(periodo)}…`)
      try {
        const qs = `desde=${periodo}&hasta=${periodo}&tipo_flujo=${estado.flujo}${rut ? `&rut=${encodeURIComponent(rut)}` : ''}`
        const r = await apiGet(`/api/portal/empresas/${eid}/movimientos?${qs}&limit=100`)
        if (!r.total) {
          zona.innerHTML = UIEstado.vacio(
            `Sin documentos en ${perLabelPortal(periodo)}${rut ? ` de ${rut}` : ''}`,
            'El filtro no tiene documentos vivos que listar. Sin datos ≠ cero.')
          return
        }
        zona.innerHTML = `
          <div class="card mt" style="overflow:auto">
            <div class="frm-row" style="justify-content:space-between;align-items:baseline">
              <h3>Detalle: ${estado.flujo === 'venta' ? 'ventas' : 'compras'} de ${perLabelPortal(periodo)}${rut ? ` — ${esc(rut)}` : ''}</h3>
              <button class="btn btn-secondary" id="pd-detalle-cerrar">Cerrar</button>
            </div>
            <div class="frm-row" style="gap:24px">
              <div><span class="frm-label">Documentos</span><div style="font-weight:600">${fmtCLP(r.total)}</div></div>
              <div><span class="frm-label">Neto del filtro</span><div style="font-weight:600">${fmtCLP(r.neto)}</div></div>
              <div><span class="frm-label">Total (con IVA)</span><div style="font-weight:600">${fmtCLP(r.monto_total)}</div></div>
            </div>
            <table class="tbl mt">
              <thead><tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th>Contraparte</th><th style="text-align:right">Neto</th><th style="text-align:right">Total</th></tr></thead>
              <tbody>
                ${r.movimientos.map((m) => `
                  <tr>
                    <td>${esc(m.fecha_docto || '')}</td>
                    <td class="mono">${esc(m.folio)}</td>
                    <td>${Number(m.tipo_doc) === 61 ? UIEstado.chip('NC', 'advertencia') : esc(m.tipo_doc)}</td>
                    <td>${esc(m.razon_social || '')}<span class="hint"> ${esc(m.rut_contraparte)}</span></td>
                    <td style="text-align:right">${fmtCLP(m.monto_neto)}</td>
                    <td style="text-align:right">${fmtCLP(m.monto_total)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            <p class="hint mt">Mostrando hasta 100 documentos de ${fmtCLP(r.total)} del filtro del mes. Exportar desde «Ventas y movimientos» con el mismo filtro.</p>
          </div>`
        zona.querySelector('#pd-detalle-cerrar').addEventListener('click', () => { zona.innerHTML = '' })
        zona.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    // Controles del dashboard — cada uno repinta sin recargar la vista.
    document.getElementById('pd-flujo-venta').addEventListener('click', () => {
      estado.flujo = 'venta'
      document.getElementById('pd-flujo-venta').className = 'btn btn-primary'
      document.getElementById('pd-flujo-compra').className = 'btn btn-secondary'
      pintarDashboard()
    })
    document.getElementById('pd-flujo-compra').addEventListener('click', () => {
      estado.flujo = 'compra'
      document.getElementById('pd-flujo-compra').className = 'btn btn-primary'
      document.getElementById('pd-flujo-venta').className = 'btn btn-secondary'
      pintarDashboard()
    })
    document.getElementById('pd-meses').addEventListener('change', (e) => {
      estado.meses = Number(e.target.value)
      pintarDashboard()
    })
    document.getElementById('pd-hasta').addEventListener('change', pintarDashboard)
    document.getElementById('pd-recargar').addEventListener('click', pintarDashboard)
    await pintarDashboard()
  },
}

/* --------------------------- §B: VENTAS --------------------------- */

window.VIEWS['portal-ventas'] = {
  titulo: 'Portal — Ventas y movimientos',
  async render(cont) {
    const eid = S.empresa.id
    const periodo = leerPeriodo('pv-desde') || periodoActual()
    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">Desde</span>${inputPeriodoHTML('pv-desde', periodo)}</div>
          <div><span class="frm-label">Hasta</span>${inputPeriodoHTML('pv-hasta', periodo)}</div>
          <div style="flex:1;min-width:180px"><span class="frm-label">Cliente (RUT) o texto (razón social/folio)</span>
            <input id="pv-texto" class="form-input" placeholder="Ej: 11111111-1 o «Comercial»"></div>
          <div><span class="frm-label">Tipo doc</span>
            <select id="pv-tipo" class="form-input" style="width:auto">
              <option value="">Todos</option>
              <option value="33">Factura (33)</option>
              <option value="61">Nota de crédito (61)</option>
              <option value="34">Factura exenta (34)</option>
              <option value="56">Nota de débito (56)</option>
            </select></div>
          <button class="btn btn-primary" id="pv-buscar">Buscar</button>
          <a class="btn btn-secondary" id="pv-export" href="#" download>Exportar CSV</a>
        </div>
        <p class="hint mt">Los filtros se aplican en el SERVIDOR al exportar también. Los montos de las notas de crédito se muestran con signo negativo (descuentan una vez).</p>
      </div>
      <div id="pv-result">${UIEstado.cargando()}</div>`

    const paramsDe = () => ({
      desde: leerPeriodo('pv-desde'),
      hasta: leerPeriodo('pv-hasta'),
      tipo_doc: document.getElementById('pv-tipo').value,
      texto: document.getElementById('pv-texto').value.trim(),
    })
    const qsDe = (f) => `desde=${f.desde || ''}&hasta=${f.hasta || ''}&tipo_doc=${f.tipo_doc || ''}&texto=${encodeURIComponent(f.texto)}`

    const cargar = async () => {
      const zona = document.getElementById('pv-result')
      zona.innerHTML = UIEstado.cargando('Buscando en tu bandeja de ventas…')
      try {
        const f = paramsDe()
        document.getElementById('pv-export').href =
          `/api/portal/empresas/${eid}/exportar.csv?${qsDe(f)}`
        const r = await apiGet(`/api/portal/empresas/${eid}/movimientos?${qsDe(f)}&limit=200`)
        if (!r.total) {
          zona.innerHTML = UIEstado.vacio(
            'Sin documentos de venta para este filtro',
            'Ningún documento de venta vivo coincide con los filtros. Prueba ampliar el rango de fechas o limpiar el texto. (Sin datos ≠ cero: no hay documentos que listar).')
          return
        }
        zona.innerHTML = `
          <div class="card">
            <div class="frm-row" style="gap:24px">
              <div><span class="frm-label">Documentos</span><div style="font-weight:600">${fmtCLP(r.total)}</div></div>
              <div><span class="frm-label">Venta neta (filtro completo)</span><div style="font-weight:600">${fmtCLP(r.neto)}</div></div>
              <div><span class="frm-label">Total (con IVA)</span><div style="font-weight:600">${fmtCLP(r.monto_total)}</div></div>
            </div>
          </div>
          <div class="card mt" style="overflow:auto">
            <table class="tbl">
              <thead><tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th>Cliente</th><th style="text-align:right">Neto</th><th style="text-align:right">IVA</th><th style="text-align:right">Total</th></tr></thead>
              <tbody>
                ${r.movimientos.map((m) => `
                  <tr>
                    <td>${esc(m.fecha_docto || '')}</td>
                    <td class="mono">${esc(m.folio)}</td>
                    <td>${Number(m.tipo_doc) === 61 ? UIEstado.chip('NC', 'advertencia') : esc(m.tipo_doc)}</td>
                    <td>${esc(m.razon_social || '')}<span class="hint"> ${esc(m.rut_contraparte)}</span></td>
                    <td style="text-align:right">${fmtCLP(m.monto_neto)}</td>
                    <td style="text-align:right">${fmtCLP(m.monto_iva)}</td>
                    <td style="text-align:right">${fmtCLP(m.monto_total)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
            <p class="hint mt">Mostrando hasta 200 documentos de ${fmtCLP(r.total)} del filtro. Los totales consideran TODO el filtro, no solo la página.</p>
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pv-buscar').addEventListener('click', cargar)
    ;['pv-desde', 'pv-hasta'].forEach((id) => document.getElementById(id).addEventListener('change', cargar))
    await cargar()
  },
}

/* ------------------------------ §C: CARTERA ------------------------------ */

window.VIEWS['portal-cartera'] = {
  titulo: 'Portal — Cartera de clientes',
  async render(cont) {
    const eid = S.empresa.id
    const periodo = leerPeriodo('pc-periodo') || periodoActual()
    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">Período</span>${inputPeriodoHTML('pc-periodo', periodo)}</div>
          <button class="btn btn-secondary" id="pc-cargar">Ver cartera</button>
        </div>
      </div>
      <div id="pc-result">${UIEstado.cargando()}</div>`

    const SEGMENTOS = {
      cuidar: ['Cuidar', 'success'],
      desarrollar: ['Desarrollar', 'info'],
      recuperar: ['Recuperar', 'advertencia'],
      controlar: ['Controlar', 'neutral'],
      sin_datos: ['Sin datos en la ventana', 'neutral'],
    }
    // Filtro INTERACTIVO de segmento: null = todos; el chip activo se pinta
    // distinto y la tabla se re-renderiza localmente (los datos ya están en
    // memoria; el backend no se vuelve a llamar).
    let segmentoActivo = null
    let clientesCache = []

    function tablaCarteraHTML() {
      const fila = clientesCache.filter((c) => !segmentoActivo || c.segmento === segmentoActivo)
      if (!fila.length) {
        return UIEstado.vacio('Ningún cliente en este segmento', 'Quita el filtro para ver toda la cartera.')
      }
      return `
        <table class="tbl">
          <thead><tr><th>Cliente</th><th>Segmento</th><th style="text-align:right">Docs (per.)</th><th style="text-align:right">Neto per.</th><th style="text-align:right">Neto prev.</th><th style="text-align:right">Variación</th></tr></thead>
          <tbody>
            ${fila.map((c) => `
              <tr>
                <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                <td>${UIEstado.chip(SEGMENTOS[c.segmento] ? SEGMENTOS[c.segmento][0] : c.segmento, SEGMENTOS[c.segmento] ? SEGMENTOS[c.segmento][1] : 'neutral')}</td>
                <td style="text-align:right">${c.docs_periodo}</td>
                <td style="text-align:right">${fmtCLP(c.neto_periodo)}</td>
                <td style="text-align:right">${fmtCLP(c.neto_previo)}</td>
                <td style="text-align:right">${fmtPctPortal(c.variacion_pct)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="hint mt">Mostrando ${fila.length} de ${clientesCache.length} cliente(s). Un cliente «sin_datos» NO significa que se haya perdido: significa que la ventana consultada no registra compras suyas. Umbrales: período = ${perLabelPortal(C.periodo)}, previo = ${perLabelPortal(C.periodo_previo)}, ventana = 12 meses.</p>`
    }

    function conectarFiltroSegmentos() {
      const zonaTabla = document.getElementById('pc-tabla')
      if (!zonaTabla) return
      zonaTabla.querySelectorAll('[data-seg]').forEach((ch) => {
        ch.addEventListener('click', () => {
          const k = ch.dataset.seg
          segmentoActivo = (segmentoActivo === k) ? null : k
          zonaTabla.querySelectorAll('[data-seg]').forEach((x) => {
            x.className = `btn ${x.dataset.seg === segmentoActivo ? 'btn-primary' : 'btn-secondary'}`
          })
          zonaTabla.querySelector('#pc-tabla-body').innerHTML = tablaCarteraHTML()
        })
      })
      zonaTabla.querySelector('#pc-tabla-body').innerHTML = tablaCarteraHTML()
    }

    const cargar = async () => {
      const zona = document.getElementById('pc-result')
      zona.innerHTML = UIEstado.cargando('Segmentando tu cartera…')
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/cartera?periodo=${leerPeriodo('pc-periodo')}&ventana=12`)
        if (r.sin_datos || !r.cartera) {
          zona.innerHTML = UIEstado.vacio('Sin RCV de ventas para este período', 'La cartera se construye SOLO con documentos reales sincronizados del SII.')
          return
        }
        const C = r.cartera
        segmentoActivo = null
        clientesCache = C.clientes
        zona.innerHTML = `
          <div class="card">
            <h3>Segmentos (regla explícita) — clic en un segmento para filtrar la tabla</h3>
            <p class="hint">${esc(C.regla)}</p>
            <div id="pc-tabla">
              <div class="frm-row mt" style="gap:18px">
                ${Object.entries(C.resumen).map(([k, n]) => `
                  <button class="btn btn-secondary" data-seg="${k}" title="Filtrar por ${SEGMENTOS[k][0]}">
                    ${SEGMENTOS[k][0]}: <b>${n}</b>
                  </button>`).join('')}
              </div>
              <div id="pc-tabla-body" class="mt" style="overflow:auto"></div>
            </div>
          </div>`
        conectarFiltroSegmentos()
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pc-cargar').addEventListener('click', cargar)
    document.getElementById('pc-periodo').addEventListener('change', cargar)
    await cargar()
  },
}

/* ----------------------- FASE A: PRODUCTOS (§7.2) ----------------------- */

window.VIEWS['portal-productos'] = {
  titulo: 'Portal — Productos vendidos',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">Desde</span>${inputPeriodoHTML('pp-desde', periodoActual())}</div>
          <div><span class="frm-label">Hasta</span>${inputPeriodoHTML('pp-hasta', periodoActual())}</div>
          <button class="btn btn-primary" id="pp-buscar">Buscar</button>
        </div>
        <p class="hint mt">Fuente REAL: los ítems de los DTE que tu empresa EMITE con el sistema (emisor propio). NO incluye lo registrado solo vía RCV de terceros: esa fuente no existe en el SII — no se inventa.</p>
      </div>
      <div id="pp-result">${UIEstado.cargando()}</div>`

    const cargar = async () => {
      const zona = document.getElementById('pp-result')
      zona.innerHTML = UIEstado.cargando('Agregando ítems de tus DTE emitidos…')
      try {
        const desde = leerPeriodo('pp-desde'), hasta = leerPeriodo('pp-hasta')
        const r = await apiGet(`/api/portal/empresas/${eid}/productos?desde=${desde}&hasta=${hasta}&limit=200`)
        if (!r.dtes_analizados || !r.productos.length) {
          zona.innerHTML = UIEstado.vacio(
            'Sin DTE emitidos con ítems en el rango',
            'La sección de productos se construye SOLO con lo emitido por tu empresa en estos meses. Si facturas siempre fuera del sistema, aquí no hay datos que mostrar (no es cero: no hay fuente).')
          return
        }
        // FASE D: margen SOLO con costo digitado (hoja de costos); lo sin costear no se estima.
        let conMargen = null
        try {
          conMargen = await apiGet(`/api/portal/empresas/${eid}/margen?desde=${desde}&hasta=${hasta}&limit=200`)
        } catch { /* el margen es incremento: si falla, la vista sigue mostrando productos */ }
        const filas = conMargen ? conMargen.productos : r.productos
        zona.innerHTML = `
          <div class="card">
            <h3>Productos ordenados por venta neta (${perLabelPortal(desde)} a ${perLabelPortal(hasta)})</h3>
            <p class="hint">${r.dtes_analizados} DTE(s) analizados. Las notas de crédito (61) descuentan de cantidades y netos una vez.</p>
            ${conMargen && conMargen.cobertura ? `<p class="hint">Margen con costo digitado: ${conMargen.cobertura.pct_venta_con_margen === null ? 'aún sin costos en la hoja' : conMargen.cobertura.pct_venta_con_margen + '% de la venta neta con margen calculado'} (${conMargen.cobertura.productos_con_costo}/${conMargen.cobertura.productos_total} productos costeados). Lo sin costo NO se estima — dígitalo en Hoja de costos.</p>` : '<p class="hint mt">El costo y el margen NO se muestran aún: fija costos unitarios en la Hoja de costos — sin fuente digitada no se estima (§7.3).</p>'}
            <table class="tbl mt">
              <thead><tr><th>Producto</th><th style="text-align:right">Cantidad</th><th style="text-align:right">Venta neta</th><th style="text-align:right">Precio prom.</th>${conMargen ? '<th style="text-align:right">Costo total</th><th style="text-align:right">Margen</th>' : ''}</tr></thead>
              <tbody>
                ${filas.map((p) => `
                  <tr>
                    <td>${esc(p.nombre)}</td>
                    <td style="text-align:right">${p.cantidad}</td>
                    <td style="text-align:right">${fmtCLP(p.neto)}</td>
                    <td style="text-align:right">${p.precio_promedio === null ? '—' : fmtCLP(p.precio_promedio)}</td>
                    ${conMargen ? `
                    <td style="text-align:right">${p.costo_total === null ? UIEstado.chip('sin costo', 'neutral') : fmtCLP(p.costo_total)}</td>
                    <td style="text-align:right">${p.margen === null ? '—' : fmtCLP(p.margen)}</td>` : ''}
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pp-buscar').addEventListener('click', cargar)
    ;['pp-desde', 'pp-hasta'].forEach((id) => document.getElementById(id).addEventListener('change', cargar))
    await cargar()
  },
}

/* ----------------------- FASE B: COBRANZA (§7.4) ----------------------- */

window.VIEWS['portal-cobranza'] = {
  titulo: 'Portal — Cobranza',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">Mora amarilla (días)</span><input id="pcb-amar" type="number" class="form-input" value="15" style="width:auto"></div>
          <div><span class="frm-label">Mora roja (días)</span><input id="pcb-rojo" type="number" class="form-input" value="30" style="width:auto"></div>
          <button class="btn btn-primary" id="pcb-cargar">Ver cobranza</button>
        </div>
        <p class="hint mt">Vista de SALDOS de documentos de venta CONTABILIZADOS sin cobro completo (misma fuente de cuenta corriente del sistema). Para cobrar/pagar usa el sistema interno — el portal es solo lectura.</p>
      </div>
      <div id="pcb-result">${UIEstado.cargando()}</div>`

    const cargar = async () => {
      const zona = document.getElementById('pcb-result')
      zona.innerHTML = UIEstado.cargando('Consultando saldos de tu cuenta corriente…')
      try {
        const amar = Number(document.getElementById('pcb-amar').value) || 15
        const rojo = Number(document.getElementById('pcb-rojo').value) || 30
        const r = await apiGet(`/api/portal/empresas/${eid}/cobranza?dias_amarillo=${amar}&dias_rojo=${rojo}`)
        const C = r.cobranza
        if (!C.clientes.length) {
          zona.innerHTML = UIEstado.vacio(
            'Ningún cliente con saldo pendiente',
            'Tu cuenta corriente no tiene documentos contabilizados con cobro pendiente. Si acabas de contabilizar, vuelve a consultar en unos segundos.')
          return
        }
        const NIVEL = { rojo: 'danger', amarillo: 'advertencia', verde: 'success' }
        zona.innerHTML = `
          <div class="card">
            <h3>Total pendiente de cobro</h3>
            <div style="font-size:var(--fs-xl);font-weight:700">${fmtCLP(C.total_pendiente)}</div>
            <p class="hint">${C.clientes.length} cliente(s) con saldo. Umbrales aplicados: amarillo ≥ ${C.umbrales.amarillo} días, rojo ≥ ${C.umbrales.rojo} días. Fuente: cuenta corriente interna (generado ${esc((C.generado || '').slice(0, 16).replace('T', ' '))}).</p>
          </div>
          <div class="card mt" style="overflow:auto">
            <table class="tbl">
              <thead><tr><th>Cliente</th><th>Mora</th><th style="text-align:right">Saldo</th><th style="text-align:right">Días mora máx.</th><th>Docs abiertos</th></tr></thead>
              <tbody>
                ${C.clientes.map((c) => `
                  <tr>
                    <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                    <td>${UIEstado.chip(c.nivel, NIVEL[c.nivel] || 'neutral')}</td>
                    <td style="text-align:right">${fmtCLP(c.saldo)}</td>
                    <td style="text-align:right">${c.mora_max_dias}</td>
                    <td>${c.documentos_abiertos.map((d) =>
                      `<span class="hint mono">F${esc(d.folio)} ${esc(d.fecha_docto)} ${fmtCLP(d.monto)} (${d.mora_dias}d)</span>`).join('<br>')}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pcb-cargar').addEventListener('click', cargar)
    await cargar()
  },
}

/* ------------------------- §H: REPORTES GUARDADOS ------------------------- */

window.VIEWS['portal-reportes'] = {
  titulo: 'Portal — Reportes guardados',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <h3>Constructor guiado de reportes</h3>
        <p class="hint">Eliges UNA métrica del catálogo oficial (misma fuente que el resto del portal), aplicas filtros y guardas la <b>configuración</b> (no copias de datos): al abrir el reporte, siempre recalcula sobre tu bandeja real.</p>
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">Métrica</span>
            <select id="pr-metrica" class="form-input" style="width:auto"><option>Cargando catálogo…</option></select></div>
          <div><span class="frm-label">Desde</span>${inputPeriodoHTML('pr-desde', periodoActual())}</div>
          <div><span class="frm-label">Hasta</span>${inputPeriodoHTML('pr-hasta', periodoActual())}</div>
          <div><span class="frm-label">Tipo doc (opcional)</span>
            <select id="pr-tipo" class="form-input" style="width:auto">
              <option value="">Todos</option><option value="33">33</option><option value="61">61</option>
            </select></div>
          <button class="btn btn-primary" id="pr-ejecutar">Ejecutar</button>
        </div>
        <div class="frm-row mt" style="align-items:end">
          <div style="flex:1"><span class="frm-label">Guardar esta consulta como…</span>
            <input id="pr-nombre" class="form-input" placeholder="Ej: Ventas del semestre"></div>
          <button class="btn btn-secondary" id="pr-guardar">Guardar reporte</button>
        </div>
      </div>
      <div id="pr-result" class="mt"></div>
      <div class="card mt">
        <h3>Mis reportes guardados</h3>
        <div id="pr-lista">${UIEstado.cargando()}</div>
      </div>`

    const ZONA = 'pr-result'

    /** Ejecuta la consulta ACTUAL del constructor: tabla de movimientos filtrada. */
    async function ejecutar() {
      const zona = document.getElementById(ZONA)
      zona.innerHTML = UIEstado.cargando('Ejecutando reporte…')
      try {
        const desde = leerPeriodo('pr-desde'), hasta = leerPeriodo('pr-hasta')
        const tipo = document.getElementById('pr-tipo').value
        const r = await apiGet(`/api/portal/empresas/${eid}/movimientos?desde=${desde}&hasta=${hasta}&tipo_doc=${tipo}&limit=500`)
        if (!r.total) {
          zona.innerHTML = UIEstado.vacio('Sin documentos para el filtro del reporte', 'Ajusta el rango o el tipo de documento. Sin datos ≠ cero.')
          return
        }
        zona.innerHTML = `
          <div class="card">
            <div class="frm-row" style="gap:24px">
              <div><span class="frm-label">Docs</span><div style="font-weight:600">${fmtCLP(r.total)}</div></div>
              <div><span class="frm-label">Neto</span><div style="font-weight:600">${fmtCLP(r.neto)}</div></div>
              <div><span class="frm-label">Total</span><div style="font-weight:600">${fmtCLP(r.monto_total)}</div></div>
            </div>
            <p class="hint mt">${esc((document.getElementById('pr-metrica').selectedOptions[0] || {}).textContent || '')} — desde ${desde} hasta ${hasta}${tipo ? `, tipo ${tipo}` : ''}.</p>
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    async function guardar() {
      const nombre = document.getElementById('pr-nombre').value.trim()
      if (!nombre) { alert('Escribe un nombre para el reporte'); return }
      try {
        await apiPost(`/api/portal/empresas/${eid}/reportes`, {
          nombre,
          config: {
            metrica: document.getElementById('pr-metrica').value,
            desde: leerPeriodo('pr-desde'),
            hasta: leerPeriodo('pr-hasta'),
            tipo_doc: document.getElementById('pr-tipo').value,
          },
        })
        document.getElementById('pr-nombre').value = ''
        await listar()
      } catch (err) { alert(err.message) }
    }

    async function listar() {
      const zona = document.getElementById('pr-lista')
      zona.innerHTML = UIEstado.cargando()
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/reportes`)
        if (!r.reportes.length) {
          zona.innerHTML = UIEstado.vacio('Aún no guardas reportes', 'Configura una consulta arriba y dale «Guardar reporte».')
          return
        }
        zona.innerHTML = `
          <table class="tbl">
            <thead><tr><th>Nombre</th><th>Config</th><th>Actualizado</th><th></th></tr></thead>
            <tbody>
              ${r.reportes.map((x) => {
                let cfg = {}
                try { cfg = JSON.parse(x.config_json || '{}') } catch { /* config rota no revienta la lista */ }
                return `<tr>
                  <td><b>${esc(x.nombre)}</b></td>
                  <td class="mono" style="font-size:var(--fs-sm)">${esc(`${cfg.metrica || '?'} ${cfg.desde || ''}…${cfg.hasta || ''}`)}</td>
                  <td>${esc(x.actualizado_en || x.creado_en || '')}</td>
                  <td>
                    <button class="btn btn-secondary" data-abrir="${x.id}" data-cfg='${x.config_json}'>Abrir</button>
                    <button class="btn btn-danger" data-borrar="${x.id}">Eliminar</button>
                  </td>
                </tr>`
              }).join('')}
            </tbody>
          </table>`
        zona.querySelectorAll('[data-abrir]').forEach((b) => b.addEventListener('click', async () => {
          const cfg = JSON.parse(b.dataset.cfg || '{}')
          if (cfg.desde) document.getElementById('pr-desde').value = `${cfg.desde.slice(0, 4)}-${cfg.desde.slice(4)}`
          if (cfg.hasta) document.getElementById('pr-hasta').value = `${cfg.hasta.slice(0, 4)}-${cfg.hasta.slice(4)}`
          document.getElementById('pr-tipo').value = cfg.tipo_doc || ''
          if (cfg.metrica) document.getElementById('pr-metrica').value = cfg.metrica
          await ejecutar()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }))
        zona.querySelectorAll('[data-borrar]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('¿Eliminar este reporte guardado? (solo borra la config, no tus datos)')) return
          try {
            await apiDelete(`/api/portal/empresas/${eid}/reportes/${b.dataset.borrar}`)
            await listar()
          } catch (err) { alert(err.message) }
        }))
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pr-ejecutar').addEventListener('click', ejecutar)
    document.getElementById('pr-guardar').addEventListener('click', guardar)
    await (async () => {
      // Catálogo REAL del backend (no hardcodeado en el front).
      try {
        const c = await apiGet('/api/portal/metricas')
        const sel = document.getElementById('pr-metrica')
        sel.innerHTML = c.metricas.map((m) => `<option value="${esc(m.id)}">${esc(m.nombre)}</option>`).join('')
      } catch { /* el botón Ejecutar funciona sin catálogo (usa movimientos) */ }
      await ejecutar()
      await listar()
    })()
  },
}

/* ---------------- FASE C: CRÉDITO AUTORIZADO (§7.1) ---------------- */

window.VIEWS['portal-credito'] = {
  titulo: 'Portal — Crédito autorizado',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <h3>Ficha de crédito por cliente</h3>
        <p class="hint">El crédito que tu empresa le autoriza a cada cliente NO llega del SII — es dato de negocio que se digita aquí. La exposición (saldo de cobranza vs autorizado) se calcula SIEMPRE con esa ficha; cliente sin ficha figura <b>SIN_CREDITO</b>: no se estima (§7.1).</p>
        <div class="frm-row mt" style="align-items:end">
          <div><span class="frm-label">RUT cliente</span><input id="pcr-rut" class="form-input" placeholder="12.345.678-5" style="width:auto"></div>
          <div><span class="frm-label">Razón social (opcional)</span><input id="pcr-razon" class="form-input" style="width:auto"></div>
          <div><span class="frm-label">Crédito autorizado <span class="hint">(entero)</span></span><input id="pcr-monto" type="number" min="0" step="1" class="form-input" style="width:auto"></div>
          <button class="btn btn-primary" id="pcr-guardar">Fijar / actualizar</button>
        </div>
      </div>
      <div id="pcr-result" class="mt">${UIEstado.cargando()}</div>`

    async function guardar() {
      try {
        await apiPut(`/api/portal/empresas/${eid}/credito`, {
          rut: document.getElementById('pcr-rut').value.trim(),
          razon_social: document.getElementById('pcr-razon').value.trim() || null,
          monto_autorizado: Number(document.getElementById('pcr-monto').value),
        })
        document.getElementById('pcr-monto').value = ''
        await cargar()
      } catch (err) { alert(err.message) }
    }

    async function cargar() {
      const zona = document.getElementById('pcr-result')
      zona.innerHTML = UIEstado.cargando('Calculando exposición de cartera…')
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/credito`)
        const E = r.exposicion
        const CHIPS = { SOBREPASADO: 'danger', SIN_CREDITO: 'advertencia', DISPONIBLE: 'success' }
        zona.innerHTML = `
          <div class="card">
            <h3>Exposición de cartera</h3>
            <div class="frm-row" style="gap:24px">
              <div><span class="frm-label">Saldo pendiente total</span><div style="font-weight:600">${fmtCLP(E.resumen.total_saldo)}</div></div>
              <div><span class="frm-label">Crédito autorizado total</span><div style="font-weight:600">${fmtCLP(E.resumen.total_autorizado)}</div></div>
              <div><span class="frm-label">Sobrepasados</span><div style="font-weight:600">${E.resumen.sobrepasados}</div></div>
              <div><span class="frm-label">Sin ficha</span><div style="font-weight:600">${E.resumen.sin_credito}</div></div>
            </div>
            <p class="hint mt">Uso = saldo de documentos de venta CONTABILIZADOS sin cobro completo (misma fuente de Cobranza). ${esc(E.regla || '')}</p>
          </div>
          <div class="card mt" style="overflow:auto">
            <h3>Clientes</h3>
            ${E.clientes.length ? `
            <table class="tbl">
              <thead><tr><th>Cliente</th><th>Exposición</th><th style="text-align:right">Saldo</th><th style="text-align:right">Autorizado</th><th style="text-align:right">Disponible</th><th>Mora</th></tr></thead>
              <tbody>
                ${E.clientes.map((c) => `
                  <tr>
                    <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                    <td>${UIEstado.chip(c.estado, CHIPS[c.estado] || 'neutral')}</td>
                    <td style="text-align:right">${fmtCLP(c.saldo)}</td>
                    <td style="text-align:right">${c.autorizado === null ? UIEstado.chip('sin ficha', 'neutral') : fmtCLP(c.autorizado)}</td>
                    <td style="text-align:right">${c.disponible === null ? '—' : fmtCLP(c.disponible)}</td>
                    <td style="text-align:right">${c.mora_max_dias}d</td>
                  </tr>`).join('')}
              </tbody>
            </table>` : UIEstado.vacio('Sin clientes en exposición', 'Cuando haya ventas contabilizadas con saldo o fichas de crédito, aparecen aquí.')}
          </div>
          <div class="card mt">
            <h3>Fichas digitadas (${r.fichas.length})</h3>
            ${r.fichas.length ? `
            <table class="tbl">
              <thead><tr><th>RUT</th><th>Razón social</th><th style="text-align:right">Autorizado</th><th>Actualizado</th></tr></thead>
              <tbody>${r.fichas.map((f) => `
                <tr>
                  <td class="mono">${esc(f.rut_original)}</td>
                  <td>${esc(f.razon_social || '—')}</td>
                  <td style="text-align:right">${fmtCLP(f.monto_autorizado)}</td>
                  <td class="hint">${esc(f.actualizado_en || f.creado_en || '')}</td>
                </tr>`).join('')}</tbody>
            </table>` : UIEstado.vacio('Sin fichas de crédito', 'Digita el primer crédito con el formulario de arriba.')}
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pcr-guardar').addEventListener('click', guardar)
    await cargar()
  },
}

/* ---------------- FASE D: HOJA DE COSTOS (§7.3) ---------------- */

window.VIEWS['portal-costos'] = {
  titulo: 'Portal — Hoja de costos',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <h3>Costo unitario por producto</h3>
        <p class="hint">El costo NO existe en el SII ni en la bandeja: se digita acá (de tu ERP, proveedor o libro de compras) como costo <b>unitario</b> y entero. Solo los productos con costo llevan margen en Productos vendidos — lo sin costear NO se estima (§7.3). El margen calculado se ve en <b>Portal — Productos vendidos</b>.</p>
        <div class="frm-row mt" style="align-items:end">
          <div style="flex:1"><span class="frm-label">Producto</span><input id="pcs-prod" class="form-input" list="pcs-nombres" placeholder="Nombre exacto como se factura"><datalist id="pcs-nombres"></datalist></div>
          <div><span class="frm-label">Costo unitario <span class="hint">(entero)</span></span><input id="pcs-costo" type="number" min="0" step="1" class="form-input" style="width:auto"></div>
          <button class="btn btn-primary" id="pcs-guardar">Fijar / actualizar</button>
        </div>
      </div>
      <div id="pcs-result" class="mt">${UIEstado.cargando()}</div>`

    async function guardar() {
      try {
        await apiPut(`/api/portal/empresas/${eid}/costos`, {
          producto: document.getElementById('pcs-prod').value,
          costo_unitario: Number(document.getElementById('pcs-costo').value),
        })
        document.getElementById('pcs-costo').value = ''
        await cargar()
      } catch (err) { alert(err.message) }
    }

    async function cargar() {
      const zona = document.getElementById('pcs-result')
      zona.innerHTML = UIEstado.cargando()
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/costos`)
        // Nombres vendidos (fuente real) para el datalist del formulario.
        try {
          const hoy = periodoActual()
          const p = await apiGet(`/api/portal/empresas/${eid}/productos?desde=${hoy.slice(0, 4)}01&hasta=${hoy}&limit=200`)
          document.getElementById('pcs-nombres').innerHTML =
            p.productos.map((x) => `<option value="${esc(x.nombre)}">`).join('')
        } catch { /* el datalist es comodidad, no requisito */ }
        zona.innerHTML = `
          <div class="card">
            <h3>Costos digitados (${r.costos.length})</h3>
            ${r.costos.length ? `
            <table class="tbl">
              <thead><tr><th>Producto</th><th style="text-align:right">Costo unitario</th><th>Actualizado</th></tr></thead>
              <tbody>${r.costos.map((c) => `
                <tr><td>${esc(c.producto_original)}</td>
                  <td style="text-align:right">${fmtCLP(c.costo_unitario)}</td>
                  <td class="hint">${esc(c.actualizado_en || c.creado_en || '')}</td></tr>`).join('')}</tbody>
            </table>` : UIEstado.vacio('Hoja de costos vacía', 'Digita el costo unitario de tus productos vendidos; el margen aparece en Productos vendidos solo cuando el costo existe — sin estimaciones.')}
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pcs-guardar').addEventListener('click', guardar)
    await cargar()
  },
}

/* ---------------- FASE E: COTIZACIONES / EMBUDO (§7.5) ---------------- */

window.VIEWS['portal-cotizaciones'] = {
  titulo: 'Portal — Cotizaciones y embudo',
  async render(cont) {
    const eid = S.empresa.id
    cont.innerHTML = `
      <div class="card">
        <h3>Embudo comercial</h3>
        <p class="hint">El RCV solo ve lo FACTURADO: las oportunidades previas se registran aquí con estados reales. La tasa de conversión se calcula sobre lo ENVIADO de tu registro — no se proyecta ni se infiere de las ventas facturadas (§7.5).</p>
        <div id="pt-embudo">${UIEstado.cargando()}</div>
      </div>
      <div class="card mt">
        <h3>Nueva cotización</h3>
        <div class="frm-row" style="align-items:end">
          <div><span class="frm-label">RUT cliente</span><input id="pt-rut" class="form-input" style="width:auto"></div>
          <div><span class="frm-label">Razón social</span><input id="pt-razon" class="form-input" style="width:auto"></div>
          <div style="flex:1"><span class="frm-label">Descripción (opcional)</span><input id="pt-desc" class="form-input"></div>
          <div><span class="frm-label">Monto <span class="hint">(entero)</span></span><input id="pt-monto" type="number" min="0" step="1" class="form-input" style="width:auto"></div>
          <button class="btn btn-primary" id="pt-crear">Registrar (BORRADOR)</button>
        </div>
      </div>
      <div id="pt-result" class="mt">${UIEstado.cargando()}</div>`

    async function crear() {
      try {
        await apiPost(`/api/portal/empresas/${eid}/cotizaciones`, {
          cliente_rut: document.getElementById('pt-rut').value.trim() || null,
          cliente_razon: document.getElementById('pt-razon').value.trim() || null,
          descripcion: document.getElementById('pt-desc').value.trim() || null,
          monto: Number(document.getElementById('pt-monto').value),
        })
        document.getElementById('pt-monto').value = ''
        await cargar()
      } catch (err) { alert(err.message) }
    }

    async function cargar() {
      const embZona = document.getElementById('pt-embudo')
      const zona = document.getElementById('pt-result')
      embZona.innerHTML = UIEstado.cargando()
      zona.innerHTML = UIEstado.cargando()
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/cotizaciones`)
        const E = r.embudo
        if (!E.hay_datos) {
          embZona.innerHTML = UIEstado.vacio('Sin cotizaciones registradas', 'El embudo se arma con lo que registres — no se infiere de las facturas del RCV.')
        } else {
          const t = E.tasa_conversion
          embZona.innerHTML = `
            <div class="frm-row" style="gap:16px">
              ${E.por_estado.map((c) => `
                <div style="flex:1;border:1px solid var(--border);border-radius:8px;padding:10px 12px">
                  <span class="frm-label">${esc(c.estado)}</span>
                  <div style="font-weight:600">${fmtCLP(c.monto)}</div>
                  <span class="hint">${c.count} cotización(es)</span>
                </div>`).join('')}
            </div>
            <p class="hint mt">Tasa de conversión ACEPTADA/ENVIADA — por monto: ${t.por_monto === null ? '—' : t.por_monto + '%'}, por conteo: ${t.por_conteo === null ? '—' : t.por_conteo + '%'} · Monto pendiente (borrador+enviada): ${fmtCLP(E.monto_pendiente)}.</p>`
        }

        if (!r.cotizaciones.length) {
          zona.innerHTML = UIEstado.vacio('No hay cotizaciones', 'Registra la primera con el formulario de arriba.')
          return
        }
        zona.innerHTML = `
          <div class="card" style="overflow:auto">
            <table class="tbl">
              <thead><tr><th>#</th><th>Cliente</th><th>Descripción</th><th style="text-align:right">Monto</th><th>Estado</th><th>Cierre</th><th></th></tr></thead>
              <tbody>${r.cotizaciones.map((c) => `
                <tr>
                  <td class="mono">${c.id}</td>
                  <td>${esc(c.cliente_razon || c.cliente_rut || '—')}</td>
                  <td>${esc(c.descripcion || '')}</td>
                  <td style="text-align:right">${fmtCLP(c.monto)}</td>
                  <td>
                    <select data-est="${c.id}" class="form-input" style="width:auto" ${['ACEPTADA', 'PERDIDA'].includes(c.estado) ? 'disabled title="Cerrada — crea una nueva si la oportunidad revive"' : ''}>
                      ${r.estados.map((e) => `<option ${e === c.estado ? 'selected' : ''}>${e}</option>`).join('')}
                    </select>
                  </td>
                  <td class="hint">${esc(c.fecha_cierre || '')}</td>
                  <td><button class="btn btn-danger" data-del="${c.id}">Eliminar</button></td>
                </tr>`).join('')}</tbody>
            </table>
          </div>`
        zona.querySelectorAll('[data-est]').forEach((sel) => sel.addEventListener('change', async () => {
          try {
            await apiPut(`/api/portal/empresas/${eid}/cotizaciones/${sel.dataset.est}`, { estado: sel.value })
            await cargar()
          } catch (err) { alert(err.message); await cargar() }
        }))
        zona.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta cotización? (queda en la auditoría del sistema)')) return
          try {
            await apiDelete(`/api/portal/empresas/${eid}/cotizaciones/${b.dataset.del}`)
            await cargar()
          } catch (err) { alert(err.message) }
        }))
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pt-crear').addEventListener('click', crear)
    await cargar()
  },
}
