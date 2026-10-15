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

/* ------------------------------ §A: INICIO (dashboard tipo panel) ------------------------------ */
/**
 * Power BI-like del portal de cliente: KPIs de VENTA y COMPRA lado a lado con
 * gráfico de dos series multicolor, cantidades de dinero SIN exclusión en
 * miles y montos completos, y el botón SINCRONIZAR (RCV de los últimos 3
 * años, compra+venta) arriba con progreso en vivo. Todo el cálculo vive en
 * el servidor (resumen-duo + serie); el front solo presenta y navega.
 */

// Paleta del dashboard (Power BI: series con color propio, KPIs acentuados).
const PD_PALETA = {
  venta: '#2563eb',      // azul — serie de ventas
  compra: '#ea580c',     // naranja — serie de compras
  ventaSuave: 'rgba(37, 99, 235, 0.14)',
  compraSuave: 'rgba(234, 88, 12, 0.14)',
  grid: 'var(--border)',
  positivo: '#16a34a',
  negativo: '#dc2626',
  iva: '#7c3aed',
}

function fmtCero(v) {
  return (v === null || v === undefined) ? '—' : fmtCLP(v)
}

/** Montos abreviados para el EJE del gráfico (ole completa vive en tooltips/tabla). */
function fmtEscala(n) {
  return new Intl.NumberFormat('es-CL', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

function chipVariacion(pct) {
  if (pct === null || pct === undefined) return '<span class="hint">sin comparable</span>'
  const sube = pct >= 0
  const color = sube ? PD_PALETA.positivo : PD_PALETA.negativo
  const flecha = sube ? '▲' : '▼'
  return `<span style="color:${color};font-weight:700">${flecha} ${Math.abs(pct).toFixed(1)}%</span>`
}

/**
 * Banda reutilizable de SINCRONIZACIÓN (RCV 3 años) para CUALQUIER pestaña del
 * portal alimentada por la BANDEJA (movimientos, cartera, cobranza, crédito,
 * reportes) — mismo contrato que el dashboard: POST /api/portal/empresas/:eid/
 * sincronizar (solo el dueño; el resto ve el porqué del rechazo server-side)
 * → job en background con polling de 3 s y re-attach al montar si ya hay un
 * job en curso. `recargar` es el loader de la vista: al terminar, esa pestaña
 * se repinta con los datos nuevos con un clic.
 */
function montarSyncPortal(eid, mount, { etiqueta = '⇄ Sincronizar 3 años', recargar = null } = {}) {
  if (!mount) return
  const uid = Math.random().toString(36).slice(2, 7)
  mount.innerHTML = `
    <div class="pd-sync">
      <div class="pd-sync-zona"></div>
      <button class="btn btn-primary">${esc(etiqueta)}</button>
    </div>`
  const zona = mount.querySelector('.pd-sync-zona')
  const btn = mount.querySelector('button')
  let timer = null
  const terminados = ['completado', 'completado_con_errores']
  const activo = (E) => E && E.estado && !terminados.includes(E.estado) && E.estado !== 'error'
  window.addEventListener('hashchange', () => clearInterval(timer), { once: true })

  function pintar(E) {
    if (!E) { zona.innerHTML = ''; return }
    if (E.estado === 'error') {
      zona.innerHTML = UIEstado.error(`Sincronización interrumpida: ${esc(E.error || '')} <button class="btn btn-secondary mt" data-reintentar>Reintentar</button>`)
      const r = zona.querySelector('[data-reintentar]')
      if (r) r.addEventListener('click', iniciar)
      btn.disabled = false
      return
    }
    if (terminados.includes(E.estado)) {
      clearInterval(timer)
      btn.disabled = false
      const R = E.resultado || {}
      zona.innerHTML = `<p class="hint">Sincronización ${E.estado === 'completado' ? 'completa' : 'con errores'}: ${fmtCero(R.insertados_total)} documento(s) nuevo(s), ${fmtCero(R.duplicados_total)} ya existentes (idempotencia), ${fmtCero(R.errores_totales)} con error del SII.${recargar ? ` <button class="btn btn-secondary btn-sm" data-repintar>Repintar con los datos nuevos</button>` : ''}</p>`
      const b = zona.querySelector('[data-repintar]')
      if (b && recargar) b.addEventListener('click', recargar)
      return
    }
    const t = E.total || 0, p = E.procesados || 0
    const pct = t > 0 ? Math.round((p / t) * 100) : 0
    const periodo = E.periodo_actual ? ` — descargando ${perLabelPortal(E.periodo_actual)} (compras y ventas)` : ''
    zona.innerHTML = `
      <p class="hint">Sincronizando RCV ${perLabelPortal(E.desde || '')} → ${perLabelPortal(E.hasta || '')}: ${p}/${t} meses${esc(periodo)}</p>
      <div class="pd-sync-bar"><div style="width:${pct}%"></div></div>`
  }

  function poll(jobId) {
    clearInterval(timer)
    timer = setInterval(async () => {
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/sincronizar/estado?job=${encodeURIComponent(jobId)}`)
        pintar(r.estado)
        if (!activo(r.estado)) clearInterval(timer)
      } catch { /* un poll perdido no aborta el ciclo; el siguiente reintenta */ }
    }, 3000)
  }

  async function iniciar() {
    try {
      btn.disabled = true
      zona.innerHTML = UIEstado.cargando('Abriendo sesión del SII y pidiendo RCV de compras y ventas de 36 meses…')
      const r = await apiPost(`/api/portal/empresas/${eid}/sincronizar`, {})
      pintar({ jobId: r.jobId, desde: r.rango.desde, hasta: r.rango.hasta, total: r.periodos.length, procesados: 0, estado: 'procesando' })
      poll(r.jobId)
    } catch (err) {
      btn.disabled = false
      zona.innerHTML = UIEstado.error(err.message)
    }
  }

  btn.addEventListener('click', iniciar)
  // Re-attach: si llegamos a la pestaña con un job ya en curso, vemos su progreso.
  ;(async () => {
    try {
      const s = await apiGet(`/api/portal/empresas/${eid}/sincronizar/estado`)
      if (activo(s.estado) && s.estado.jobId) {
        btn.disabled = true
        pintar(s.estado)
        poll(s.estado.jobId)
      }
    } catch { /* estado opcional */ }
  })()
}

/**
 * Barras dobles mensuales tipo Power BI (SVG con sol rezelé CSS puro):
 * dos series por período con paleta propia, barra TOCABLE por clic
 * (drill-down al detalle de ese mes+flujo), meses sin datos como celda
 * vacía (sin datos ≠ cero) yToolTip con montos COMPLETOS. Los períodos con
 * neto NEGATIVO (mes de solo-NC) dibujan la barra hacia abajo del eje 0.
 */
function barrasDuoHTML(serieVenta, serieCompra, alClic) {
  const accion = alClic || (() => {})
  const periodos = serieVenta.map((m) => m.periodo)
  const porPeriodo = (serie, p) => serie.find((m) => m.periodo === p) || { neto: null, docs: 0 }
  const datos = periodos.map((p) => ({ periodo: p, v: porPeriodo(serieVenta, p).neto, c: porPeriodo(serieCompra, p).neto }))
  if (!datos.some((d) => d.v !== null || d.c !== null)) {
    return UIEstado.vacio('Sin RCV sincronizado en el rango', 'Usa SINCRONIZAR para traer los últimos 3 años de compras y ventas del SII; hasta entonces no hay datos que graficar (no es cero: es ausencia).')
  }
  const W = 760, H = 260, padLeft = 54, padTop = 16, padBottom = 44
  const alturaUtiles = H - padTop - padBottom
  const cero = padTop + alturaUtiles / 2
  const max = Math.max(...datos.flatMap((d) => [d.v, d.c]).map((x) => Math.abs(x || 0)), 1)
  const bw = (W - padLeft) / datos.length
  const barw = (bw * 0.32)
  const altoValor = (x) => Math.max(2, Math.round((Math.abs(x) / max) * (alturaUtiles / 2)) - 1)

  // Escala visual: rejilla horizontal con ticks del EJE (montos abreviados),
  // línea CERO sólida — el gráfico se lee sin leer los montos de abajo.
  let rejilla = ''
  for (let k = 1; k <= 4; k++) {
    const yy = Math.round(cero - (k / 4) * (alturaUtiles / 2))
    rejilla += `<line x1="${padLeft}" y1="${yy}" x2="${W}" y2="${yy}" stroke="${PD_PALETA.grid}" stroke-dasharray="3 4"/>`
    rejilla += `<text x="${padLeft - 7}" y="${yy + 3}" font-size="10" text-anchor="end" fill="var(--fg-muted)">${fmtEscala(Math.round((max * k) / 4))}</text>`
  }
  rejilla += `<text x="${padLeft - 7}" y="${Math.round(cero + alturaUtiles / 2) + 3}" font-size="10" text-anchor="end" fill="var(--fg-muted)">−${fmtEscala(Math.round(max))}</text>`
  let svg = rejilla + `<line x1="${padLeft}" y1="${cero}" x2="${W}" y2="${cero}" stroke="${PD_PALETA.grid}" stroke-width="1"/>`
  let etiquetas = ''
  datos.forEach((d, i) => {
    const x = padLeft + i * bw + bw / 2
    for (const [key, color, suave] of [['v', PD_PALETA.venta, PD_PALETA.ventaSuave], ['c', PD_PALETA.compra, PD_PALETA.compraSuave]]) {
      const val = d[key]
      if (val === null || val === undefined) {
        svg += `<rect x="${x + (key === 'v' ? -barw : 1)}" y="${cero - 2}" width="${barw}" height="4" fill="${PD_PALETA.grid}" opacity="0.5"/>`
        continue
      }
      const h = altoValor(val)
      const y = val >= 0 ? cero - h : cero
      const xBar = key === 'v' ? x - barw - 1 : x + 1
      svg += `<rect data-flujo="${key === 'v' ? 'venta' : 'compra'}" data-periodo="${d.periodo}" class="pb-duo-bar" x="${xBar}" y="${y}" width="${barw}" height="${h}" rx="2" fill="${color}" opacity="${val >= 0 ? '0.88' : '0.55'}" style="cursor:pointer"><title>${perLabelPortal(d.periodo)} · ${key === 'v' ? 'Ventas' : 'Compras'}: ${fmtCLP(val)} — clic para detalle</title></rect>`
    }
    etiquetas += `<text x="${x}" y="${H - 26}" font-size="10" text-anchor="middle" fill="var(--muted)">${d.periodo.slice(4)}/${d.periodo.slice(2, 4)}</text>`
  })
  const leyenda = `
    <div class="frm-row" style="gap:18px;margin-top:6px">
      <span class="hint"><i class="lg-dot" style="background:${PD_PALETA.venta}"></i>Ventas netas</span>
      <span class="hint"><i class="lg-dot" style="background:${PD_PALETA.compra}"></i>Compras netas</span>
      <span class="hint">Barra vacía = sin datos del mes en el SII (no es cero)</span>
    </div>`
  return {
    svg: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ventas y compras mensuales" style="width:100%;height:auto">${svg}${etiquetas}</svg>`,
    leyenda,
    clickable: datos.some((d) => d.v !== null || d.c !== null),
  }
}

window.VIEWS['portal-inicio'] = {
  titulo: 'Portal — Dashboard interactivo',
  async render(cont) {
    const eid = S.empresa.id
    const estado = { meses: 12 }

    cont.innerHTML = `
      <div class="card">
        <div class="pd-head">
          <div class="pd-head-txt">
            <span class="kicker">Ventas y compras · RCV SII</span>
            <div class="pd-title">${esc(S.empresa.nombre || '')}</div>
          </div>
          <div class="pd-head-actions">
            <button class="btn btn-primary" id="pd-sync">⇄ Sincronizar 3 años</button>
            <p class="hint">36 meses de compras y ventas del SII (idempotente)</p>
          </div>
        </div>
        <div id="pd-sync-zona"></div>
      </div>

      <div id="pd-kpis">${UIEstado.cargando('Calculando indicadores…')}</div>

      <div class="card mt">
        <div class="pd-card-head">
          <h3 id="pd-titulo-grafico">Ventas vs Compras</h3>
          <div class="pd-mini">
            <label class="hint" for="pd-meses">Rango</label>
            <select id="pd-meses" class="form-input" style="width:auto">
              <option value="6">6 meses</option>
              <option value="12" selected>12 meses</option>
              <option value="24">24 meses</option>
              <option value="36">36 meses</option>
            </select>
          </div>
        </div>
        <div id="pd-grafico">${UIEstado.cargando()}</div>
      </div>

      <div class="card mt" style="overflow:auto">
        <h3>Resumen mensual completo</h3>
        <div id="pd-tabla">${UIEstado.cargando()}</div>
      </div>

      <div class="card mt">
        <div class="frm-row" style="align-items:baseline;justify-content:space-between">
          <h3>Principales clientes del mes ancla</h3>
          <span class="hint">Clic en «Ver detalle» para el drill-down del cliente</span>
        </div>
        <div id="pd-top">${UIEstado.cargando()}</div>
      </div>

      <div id="pd-detalle"></div>`

    /* --------------------- SINCRONIZACIÓN (RCV 3 años) --------------------- */

    let timerSync = null

    function renderSyncEstado(E) {
      const zona = document.getElementById('pd-sync-zona')
      if (!zona) return false // la vista cambia y no: el polling se detiene
      if (!E) { zona.innerHTML = ''; return true }
      const t = E.total || 0, p = E.procesados || 0
      const pct = t > 0 ? Math.round((p / t) * 100) : 0
      const terminado = ['completado', 'completado_con_errores', 'error'].includes(E.estado)
      if (E.estado === 'error') {
        zona.innerHTML = UIEstado.error(`Sincronización interrumpida: ${esc(E.error || '')} <br><button class="btn btn-secondary mt" id="pd-sync-reintentar">Reintentar</button>`)
        const b = document.getElementById('pd-sync-reintentar')
        if (b) b.addEventListener('click', iniciarSync)
        return false
      }
      if (terminado) {
        const R = E.resultado || {}
        zona.innerHTML = `<p class="hint">Sincronización ${esc(E.estado === 'completado' ? 'completa' : 'con errores')}: ${fmtCero(R.insertados_total)} documento(s) nuevos, ${fmtCero(R.duplicados_total)} ya existentes (idempotencia), ${fmtCero(R.errores_totales)} con error del SII. <button class="btn btn-secondary btn-sm" id="pd-sync-refresh">Repintar con los datos nuevos</button></p>`
        const b = document.getElementById('pd-sync-refresh')
        if (b) b.addEventListener('click', pintarDashboard)
        return false
      }
      const periodo = E.periodo_actual ? ` — descargando ${perLabelPortal(E.periodo_actual)} (compras y ventas)` : ''
      zona.innerHTML = `
        <p class="hint">Sincronizando RCV ${perLabelPortal(E.desde || '')} → ${perLabelPortal(E.hasta || '')}: ${p}/${t} meses${esc(periodo)}</p>
        <div style="height:8px;background:var(--border);border-radius:4px;overflow:auto">
          <div style="height:100%;width:${pct}%;background:${PD_PALETA.venta};border-radius:4px"></div>
        </div>`
      return true
    }

    async function pollSync(jobId) {
      if (timerSync) clearInterval(timerSync)
      timerSync = setInterval(async () => {
        try {
          const r = await apiGet(`/api/portal/empresas/${eid}/sincronizar/estado?job=${encodeURIComponent(jobId)}`)
          const sigue = renderSyncEstado(r.estado)
          if (!sigue) clearInterval(timerSync)
        } catch { /* un poll perdido no aborta el ciclo; el siguiente reintenta */ }
      }, 3000)
    }

    async function iniciarSync() {
      const zona = document.getElementById('pd-sync-zona')
      try {
        const btn = document.getElementById('pd-sync')
        btn.disabled = true
        zona.innerHTML = UIEstado.cargando('Abriendo sesión del SII y pidiendo RCV compración/venta de 36 meses…')
        const r = await apiPost(`/api/portal/empresas/${eid}/sincronizar`, {})
        renderSyncEstado({ jobId: r.jobId, desde: r.rango.desde, hasta: r.rango.hasta, total: r.periodos.length, procesados: 0, estado: 'procesando' })
        await pollSync(r.jobId)
      } catch (err) {
        btn && (btn.disabled = false)
        zona.innerHTML = UIEstado.error(err.message)
      } finally {
        const b = document.getElementById('pd-sync')
        if (b) b.disabled = false
      }
    }

    /* ----------------------------- KPIs DUO ----------------------------- */

    async function pintarKPIs(ancla) {
      const zona = document.getElementById('pd-kpis')
      if (!zona) return
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/resumen-duo?periodo=${ancla}`)
        const { venta: V, compra: C, diferencia_bruta: D } = r
        if (V.neto === null && C.neto === null) {
          zona.innerHTML = UIEstado.vacio(
            'Sin RCV sincronizado',
            'Tu empresa no tiene documentos de venta ni de compra vivos en este mes ancla. SINCRONIZA los últimos 3 años (botón arriba) para alimentar el panel — el vacío del SII NO es cero.')
          return
        }
        const colorDif = D && D.neto >= 0 ? PD_PALETA.positivo : (D ? PD_PALETA.negativo : '')
        const dotDif = D ? (D.neto >= 0 ? PD_PALETA.positivo : PD_PALETA.negativo) : 'var(--fg-muted)'
        const kpi = (dot, label, valor, sub, colorValor = '') => `
          <div class="pd-kpi">
            <div class="pd-kpi-top"><i class="pd-dot" style="background:${dot}"></i><span>${esc(label)}</span></div>
            <strong ${colorValor ? `style="color:${colorValor}"` : ''}>${valor}</strong>
            <span class="sub">${sub}</span>
          </div>`
        zona.innerHTML = `
          <div class="pd-kpis">
            ${kpi(PD_PALETA.venta, `Ventas netas · ${perLabelPortal(r.periodo)}`, fmtCero(V.neto), `IVA ${fmtCero(V.iva)} · ${fmtCero(V.docs)} doctos · ${chipVariacion(V.variacion_neta_pct)}`, PD_PALETA.venta)}
            ${kpi(PD_PALETA.compra, `Compras netas · ${perLabelPortal(r.periodo)}`, fmtCero(C.neto), `IVA ${fmtCero(C.iva)} · ${fmtCero(C.docs)} doctos · ${chipVariacion(C.variacion_neta_pct)}`, PD_PALETA.compra)}
            ${kpi(dotDif, 'Diferencia bruta (venta − compra)', D ? fmtCLP(D.neto) : '—', `IVA determinado provisional ${D ? fmtCLP(D.iva_det) : '—'} · NO incluye PPM ni retenciones`, colorDif)}
            ${kpi(PD_PALETA.iva, `IVA potencial · ${perLabelPortal(r.periodo)}`, `débito ${fmtCero(V.iva)} / crédito ${fmtCero(C.iva)}`, 'Las NC restan una vez en ambos flujos', PD_PALETA.iva)}
          </div>`
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    /* ----------------------- GRÁFICO Y TABLA DUO ----------------------- */

    async function pintarGrafico(anclaVenta) {
      const zona = document.getElementById('pd-grafico')
      if (!zona) return
      zona.innerHTML = UIEstado.cargando('Consultando las dos series…')
      try {
        const [rv, rc] = await Promise.all([
          apiGet(`/api/portal/empresas/${eid}/serie?meses=${estado.meses}&flujo=venta&hasta=${anclaVenta}`),
          apiGet(`/api/portal/empresas/${eid}/serie?meses=${estado.meses}&flujo=compra&hasta=${anclaVenta}`),
        ])
        const g = barrasDuoHTML(rv.serie.meses, rc.serie.meses, (periodo, flujo) => abrirDetalle(periodo, flujo))
        zona.innerHTML = `${g.svg}
          ${g.leyenda}
          <p class="hint mt">Eje del gráfico abreviado (M = millones); el monto COMPLETO se muestra al pasar el mouse sobre cada barra. Barra hacia abajo = mes con más notas de crédito que facturas.</p>`
        const titulo = document.getElementById('pd-titulo-grafico')
        if (titulo) titulo.textContent = `Ventas vs Compras — ${perLabelPortal(rv.serie.desde)} a ${perLabelPortal(rv.serie.hasta)}`
        zona.querySelectorAll('.pb-duo-bar').forEach((r) =>
          r.addEventListener('click', () => abrirDetalle(r.dataset.periodo, r.dataset.flujo)))
        await pintarTabla(rv.serie.meses, rc.serie.meses)
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    async function pintarTabla(mesesVenta, mesesCompra) {
      const zona = document.getElementById('pd-tabla')
      if (!zona) return
      const porP = (serie, p) => serie.find((m) => m.periodo === p) || { neto: null, docs: 0 }
      const filas = mesesVenta.map((m) => {
        const c = porP(mesesCompra, m.periodo)
        const v = porP(mesesVenta, m.periodo)
        return { periodo: m.periodo, v: v.neto, vd: v.docs, c: c.neto, cd: c.docs }
      }).reverse()
      zona.innerHTML = `
        <table class="tbl pd-tbl">
          <thead><tr><th>Mes</th><th style="text-align:right;color:${PD_PALETA.venta}">Ventas netas</th><th style="text-align:right">Docs</th><th style="text-align:right;color:${PD_PALETA.compra}">Compras netas</th><th style="text-align:right">Docs</th><th style="text-align:right">Diferencia bruta</th></tr></thead>
          <tbody>${filas.map((f) => {
            const dif = (f.v !== null && f.c !== null) ? f.v - f.c : null
            const color = dif === null ? 'var(--muted)' : (dif >= 0 ? PD_PALETA.positivo : PD_PALETA.negativo)
            return `<tr style="cursor:pointer" data-ver="${f.periodo}">
              <td>${perLabelPortal(f.periodo)}</td>
              <td style="text-align:right;font-weight:600;color:${PD_PALETA.venta}">${fmtCero(f.v)}</td>
              <td style="text-align:right">${f.vd}</td>
              <td style="text-align:right;font-weight:600;color:${PD_PALETA.compra}">${fmtCero(f.c)}</td>
              <td style="text-align:right">${f.cd}</td>
              <td style="text-align:right;font-weight:700;color:${color}">${fmtCero(dif)}</td>
            </tr>`
          }).join('')}</tbody>
        </table>
        <p class="hint mt">Clic en una fila para el detalle del mes (ambos flujos). Las NC restan una vez en las dos columnas.</p>`
      zona.querySelectorAll('[data-ver]').forEach((tr) => tr.addEventListener('click', () => abrirDetalle(tr.dataset.ver, 'venta')))
    }

    /* --------------------------- DETALLE (drill-down) --------------------------- */

    async function abrirDetalle(periodo, flujo = 'venta') {
      estado.flujoDrill = flujo
      const zona = document.getElementById('pd-detalle')
      if (!zona) return
      zona.innerHTML = UIEstado.cargando(`Consultando detalle de ${perLabelPortal(periodo)}…`)
      try {
        const qs = `desde=${periodo}&hasta=${periodo}&tipo_flujo=${flujo}${estado.rutDrill ? `&rut=${encodeURIComponent(estado.rutDrill)}` : ''}`
        const r = await apiGet(`/api/portal/empresas/${eid}/movimientos?${qs}&limit=100`)
        estado.rutDrill = null
        if (!r.total) {
          zona.innerHTML = UIEstado.vacio(`Sin documentos de ${flujo === 'venta' ? 'ventas' : 'compras'} en ${perLabelPortal(periodo)}`, 'El SII no reporta vivos para este filtro; sin datos ≠ cero.')
          return
        }
        zona.innerHTML = `
          <div class="card mt" style="overflow:auto">
            <div class="frm-row" style="justify-content:space-between;align-items:baseline">
              <h3 style="color:${flujo === 'venta' ? PD_PALETA.venta : PD_PALETA.compra}">Detalle ${flujo === 'venta' ? 'ventas' : 'compras'} · ${perLabelPortal(periodo)}${estado.nombreRut ? ` — ${esc(estado.nombreRut)}` : ''}</h3>
              <button class="btn btn-secondary" id="pd-detalle-cerrar">Cerrar</button>
            </div>
            <div class="frm-row" style="gap:24px">
              <div><span class="frm-label">Documentos</span><div style="font-weight:700">${fmtCLP(r.total)}</div></div>
              <div><span class="frm-label">Neto del filtro</span><div style="font-weight:700">${fmtCLP(r.neto)}</div></div>
              <div><span class="frm-label">Total (con IVA)</span><div style="font-weight:700">${fmtCLP(r.monto_total)}</div></div>
            </div>
            <table class="tbl mt">
              <thead><tr><th>Fecha</th><th>Folio</th><th>Tipo</th><th>Contraparte</th><th style="text-align:right">Neto</th><th style="text-align:right">IVA</th><th style="text-align:right">Total</th></tr></thead>
              <tbody>${r.movimientos.map((m) => `
                <tr>
                  <td class="mono">${esc(m.fecha_docto || '')}</td>
                  <td class="mono">${esc(m.folio)}</td>
                  <td>${Number(m.tipo_doc) === 61 || Number(m.tipo_doc) === 60 ? UIEstado.chip('NC', 'advertencia') : esc(m.tipo_doc)}</td>
                  <td>${esc(m.razon_social || '')}<span class="hint"> ${esc(m.rut_contraparte)}</span></td>
                  <td style="text-align:right;font-weight:600">${fmtCLP(m.monto_neto)}</td>
                  <td style="text-align:right">${fmtCLP(m.monto_iva)}</td>
                  <td style="text-align:right">${fmtCLP(m.monto_total)}</td>
                </tr>`).join('')}</tbody>
            </table>
            <p class="hint mt">Hasta 100 documentos de ${fmtCero(r.total)} del filtro. Las filas de NOTAS DE CRÉDITO aparecen con montos NEGATIVOS: así es la rebaja una vez del RCV.</p>
          </div>`
        zona.querySelector('#pd-detalle-cerrar').addEventListener('click', () => { zona.innerHTML = '' })
        zona.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } catch (err) {
        estado.rutDrill = null
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    /* ------------------------- CLIENTES DEL MES ANCLA ------------------------- */

    async function pintarTop(p) {
      const zona = document.getElementById('pd-top')
      if (!zona) return
      try {
        const r = await apiGet(`/api/portal/empresas/${eid}/resumen?periodo=${p}`)
        if (!r.resumen || !r.resumen.top_clientes.length) {
          zona.innerHTML = UIEstado.vacio('Sin clientes en el período ancla', 'No hay ventas vivas en el mes en el RCV (o falta sincronizar).')
          return
        }
        zona.innerHTML = `
          <table class="tbl">
            <thead><tr><th>Cliente</th><th style="text-align:right">Docs</th><th style="text-align:right;color:${PD_PALETA.venta}">Venta neta</th><th style="text-align:right">Total (IVA)</th><th></th></tr></thead>
            <tbody>${r.resumen.top_clientes.map((c) => `
              <tr>
                <td>${esc(c.razon_social || c.rut)}<span class="hint"> ${esc(c.rut)}</span></td>
                <td style="text-align:right">${c.docs}</td>
                <td style="text-align:right;font-weight:600;color:${PD_PALETA.venta}">${fmtCLP(c.neto)}</td>
                <td style="text-align:right">${fmtCLP(c.total)}</td>
                <td><button class="btn btn-secondary btn-sm" data-ver-mes="${p}" data-ver-rut="${esc(c.rut)}" data-nombre="${esc(c.razon_social || c.rut)}">Ver detalle</button></td>
              </tr>`).join('')}</tbody>
          </table>`
        zona.querySelectorAll('[data-ver-mes]').forEach((b) => b.addEventListener('click', () => {
          estado.rutDrill = b.dataset.verRut
          estado.nombreRut = b.dataset.nombre || null
          abrirDetalle(b.dataset.verMes, 'venta')
        }))
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
    }

    /* ------------------------------- ORQUESTACIÓN ------------------------------- */

    async function pintarDashboard() {
      try {
        // Mes ancla: el último con RCV de venta (misma decisión que /serie server-side).
        const rv = await apiGet(`/api/portal/empresas/${eid}/serie?meses=1&flujo=venta`)
        const ancla = rv.serie.hasta
        await Promise.all([pintarKPIs(ancla)])
        await pintarGrafico(ancla)
        await pintarTop(ancla)
        // el re-attach del job en curso: si el usuario recarga a mitad de una sync.
        try {
          const s = await apiGet(`/api/portal/empresas/${eid}/sincronizar/estado`)
          if (s.estado && !['completado', 'completado_con_errores', 'error'].includes(s.estado.estado)) {
            renderSyncEstado(s.estado)
            await pollSync(s.estado.jobId)
            document.getElementById('pd-sync').disabled = true
          }
        } catch { /* estado opcional */ }
      } finally {
        // (antes aquí se habilitaba el botón «Aplicar»; el rango aplica al cambiar el select)
      }
    }

    document.getElementById('pd-sync').addEventListener('click', iniciarSync)
    document.getElementById('pd-meses').addEventListener('change', (e) => { estado.meses = Number(e.target.value); pintarDashboard() })
    await pintarDashboard()
    window._pd_timerSync = timerSync
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
      <div id="pv-sync" class="mt"></div>
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
    montarSyncPortal(eid, document.getElementById('pv-sync'), { recargar: cargar })
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
      <div id="pc-sync" class="mt"></div>
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
    montarSyncPortal(eid, document.getElementById('pc-sync'), { recargar: cargar })
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
      <div id="pcb-sync" class="mt"></div>
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
    montarSyncPortal(eid, document.getElementById('pcb-sync'), { recargar: cargar })
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
      <div id="pr-sync" class="mt"></div>
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
    montarSyncPortal(eid, document.getElementById('pr-sync'), { recargar: ejecutar })
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
      <div id="pcr-sync" class="mt"></div>
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
    montarSyncPortal(eid, document.getElementById('pcr-sync'), { recargar: cargar })
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
        <details class="mt">
          <summary class="hint" style="cursor:pointer">Carga masiva: importar CSV (producto;costo)</summary>
          <p class="hint mt">Un par por línea, separado por <b>;</b> (también acepta coma). Encabezado opcional. Valores chilenos con puntos de miles ok (<i>Mensualidad Contable;20.000</i>). Upsert idempotente: re-importar no duplica y las líneas inválidas se reportan sin abortar el resto.</p>
          <div class="frm-row" style="align-items:end">
            <div style="flex:2"><textarea id="pcs-csv" class="form-input" rows="4" placeholder="Mensualidad Contable;20000\nMensualidad Tributaria;10000"></textarea></div>
            <button class="btn btn-secondary" id="pcs-csv-btn">Importar CSV</button>
          </div>
          <div id="pcs-csv-res" class="mt"></div>
        </details>
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

    async function importarCSV() {
      const zona = document.getElementById('pcs-csv-res')
      const texto = document.getElementById('pcs-csv').value
      if (!texto.trim()) { alert('Pega el CSV primero'); return }
      zona.innerHTML = UIEstado.cargando('Importando…')
      try {
        const r = await apiPost(`/api/portal/empresas/${eid}/costos-csv`, { texto_csv: texto })
        zona.innerHTML = `<p class="hint">✅ ${r.importados} nuevo(s) + ${r.actualizados} actualizado(s)${r.saltadas.length ? ` · ⚠ ${r.saltadas.length} saltadas: ${r.saltadas.map((x) => `L${x.linea} (${esc(x.motivo)})`).join(', ')}` : ''}</p>`
        document.getElementById('pcs-csv').value = ''
        await cargar()
      } catch (err) {
        zona.innerHTML = UIEstado.error(err.message)
      }
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
    document.getElementById('pcs-csv-btn').addEventListener('click', importarCSV)
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
