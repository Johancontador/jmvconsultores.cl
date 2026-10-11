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

/* global VIEWS, esc, apiGet, apiPost, apiDelete, S, UIEstado, inputPeriodoHTML, leerPeriodo, periodoActual */

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

/** Canvas simple de barras (SVG, sin dependencias): serie {meses[], neto[]} */
function barrasSerieHTML(serie) {
  const conDatos = serie.filter((s) => s.neto !== null && s.neto !== undefined)
  if (!conDatos.length) {
    return UIEstado.vacio('Sin datos en el año', 'Todavía no hay documentos de venta vivos en este período.')
  }
  const max = Math.max(...conDatos.map((s) => Math.abs(s.neto)), 1)
  const W = 720, H = 200, bw = W / 12
  const barras = serie.map((s, i) => {
    if (s.neto === null || s.neto === undefined) {
      return `<rect x="${i * bw + bw * 0.15}" y="${H - 4}" width="${bw * 0.7}" height="4" fill="var(--border)"/>`
    }
    const h = Math.max(4, Math.round((Math.abs(s.neto) / max) * (H - 20)))
    return `<rect x="${i * bw + bw * 0.15}" y="${H - h}" width="${bw * 0.7}" height="${h}" rx="3" fill="var(--primary)" opacity="0.85"><title>${perLabelPortal(s.periodo)}: ${fmtCLP(s.neto)}</title></rect>`
  }).join('')
  const labels = serie.map((s, i) =>
    `<text x="${i * bw + bw / 2}" y="${H - 0}" font-size="10" text-anchor="start" fill="var(--muted)" transform="rotate(45 ${i * bw + bw / 2} ${H})">${s.periodo.slice(4)}</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H + 16}" role="img" aria-label="Venta neta mensual" style="width:100%;height:auto">${barras}${labels}</svg><div class="hint" style="margin-top:6px">${conDatos.length} mes(es) con datos de ${serie.length}. Escala máx: ${fmtCLP(max)}.</div>`
}

/* ------------------------------ §A: INICIO ------------------------------ */

window.VIEWS['portal-inicio'] = {
  titulo: 'Portal — Inicio ejecutivo',
  async render(cont) {
    const eid = S.empresa.id
    const periodo = leerPeriodo('portal-periodo') || periodoActual()
    cont.innerHTML = `
      <div class="card">
        <div class="frm-row" style="align-items:end;justify-content:space-between">
          <div>
            <span class="frm-label">Período</span>
            ${inputPeriodoHTML('portal-periodo', periodo)}
          </div>
          <button class="btn btn-secondary" id="portal-recargar">Actualizar</button>
        </div>
      </div>
      <div id="portal-resumen">${UIEstado.cargando('Consultando métricas de tu empresa…')}</div>`

    const cargar = async () => {
      const zona = document.getElementById('portal-resumen')
      if (!zona) return
      zona.innerHTML = UIEstado.cargando('Consultando métricas de tu empresa…')
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/resumen?periodo=${leerPeriodo('portal-periodo')}`)
        if (r.sin_datos || !r.resumen) {
          zona.innerHTML = UIEstado.vacio(
            'Sin RCV de ventas para este período',
            'Cuando tu empresa tenga documentos de venta sincronizados del SII, aquí verás el resumen. Esto NO es cero: significa que no hay datos que mostrar.')
          return
        }
        const R = r.resumen
        const vari = R.ventas.variacion_pct
        zona.innerHTML = `
          <div class="card">
            <h3>Venta neta de ${perLabelPortal(R.periodo)}</h3>
            <div style="font-size:var(--fs-xl);font-weight:700">${fmtCLP(R.ventas.neta)}</div>
            <p class="muted">Variación vs. ${perLabelPortal(R.periodo_previo)}: <b>${fmtPctPortal(vari)}</b>
              ${vari === null ? '<span class="hint">(sin datos del mes comparable — no se muestra como 0%)</span>' : ''}</p>
            <div class="frm-row mt" style="gap:24px">
              <div><span class="frm-label">Clientes compradores</span><div style="font-weight:600">${fmtCLP(R.clientes_compradores)}</div></div>
              <div><span class="frm-label">Ticket prom. por documento</span><div style="font-weight:600">${fmtCLP(R.ticket_promedio_documento)}</div></div>
              <div><span class="frm-label">Ticket prom. por cliente</span><div style="font-weight:600">${fmtCLP(R.ticket_promedio_cliente)}</div></div>
              <div><span class="frm-label">Concentración top 5</span><div style="font-weight:600">${fmtPctPortal(R.concentracion_top5_pct)}</div></div>
            </div>
          </div>
          <div class="card mt">
            <h3>Evolución mensual del ${String(R.periodo).slice(0, 4)}</h3>
            ${barrasSerieHTML(R.serie_anual)}
          </div>
          <div class="card mt">
            <h3>Principales clientes por venta neta</h3>
            ${R.top_clientes.length ? `
              <table class="tbl">
                <thead><tr><th>Cliente</th><th style="text-align:right">Docs</th><th style="text-align:right">Venta neta</th></tr></thead>
                <tbody>
                  ${R.top_clientes.map((c) => `
                    <tr>
                      <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                      <td style="text-align:right">${c.docs}</td>
                      <td style="text-align:right">${fmtCLP(c.neto)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : UIEstado.vacio('Sin clientes en el período', '')}
          </div>
          <p class="hint mt">Fuente: RCV del SII (último período con datos: <b>${perLabelPortal(R.cobertura.ultimo_periodo_con_datos)}</b>).
            Vendedor, productos (SKU), costos, morosidad y cotizaciones no existen en esta fuente todavía — ese análisis no se ofrece para no inventar datos.
            Los montos son los informados al SII; las notas de crédito (60/61) descuentan una vez.</p>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message, '<button class="btn btn-secondary mt" onclick="location.reload()">Reintentar</button>')
      }
    }

    document.getElementById('portal-recargar').addEventListener('click', cargar)
    document.getElementById('portal-periodo').addEventListener('change', cargar)
    await cargar()
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
        zona.innerHTML = `
          <div class="card">
            <h3>Segmentos (regla explícita)</h3>
            <p class="hint">${esc(C.regla)}</p>
            <div class="frm-row mt" style="gap:18px">
              ${Object.entries(C.resumen).map(([k, n]) => `
                <div><span class="frm-label">${SEGMENTOS[k][0]}</span>
                  <div style="font-size:var(--fs-lg);font-weight:700">${n}</div></div>`).join('')}
            </div>
          </div>
          <div class="card mt" style="overflow:auto">
            <table class="tbl">
              <thead><tr><th>Cliente</th><th>Segmento</th><th style="text-align:right">Docs (per.)</th><th style="text-align:right">Neto per.</th><th style="text-align:right">Neto prev.</th><th style="text-align:right">Variación</th></tr></thead>
              <tbody>
                ${C.clientes.map((c) => `
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
            <p class="hint mt">Un cliente «sin_datos» NO significa que se haya perdido: significa que la ventana consultada no registra compras suyas. Umbrales: período = ${perLabelPortal(C.periodo)}, previo = ${perLabelPortal(C.periodo_previo)}, ventana = 12 meses.</p>
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    document.getElementById('pc-cargar').addEventListener('click', cargar)
    document.getElementById('pc-periodo').addEventListener('change', cargar)
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
