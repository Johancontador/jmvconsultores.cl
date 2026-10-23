/**
 * VISTA SALUD TRIBUTARIA v2 — «JMV Tax Health Intelligence».
 *
 * Misma promesa que antes (nada se inventa: lo no verificado aparece como
 * «no evaluable», nunca como un cero ni como un verde) pero con la lectura
 * de un informe ejecutivo:
 *
 *   1. Portada con índice, cobertura, confianza, exposición y acciones.
 *   2. KPI de portada (los 8 del informe) con su fórmula a la vista.
 *   3. Gráficos (los MISMOS SVG que el PDF: una sola fuente de verdad).
 *   4. Comparación con el informe anterior («qué cambió»).
 *   5. Plan de acción con responsable, plazo y evidencia de cierre.
 *   6. Emisión del informe imprimible (HTML → PDF desde el navegador).
 *
 * Un solo botón «Reunir antecedentes» ejecuta la sincronización completa
 * (ficha + RCV + declaraciones + Formulario Compacto + renta) y va mostrando
 * el avance paso a paso.
 */

VIEWS.salud = {
  titulo: 'Salud Tributaria',
  async render(cont) {
    const eid = S.empresa.id
    const periodo = periodoGlobal()
    let inf = null
    let graficos = null
    // La ventana de análisis NO se fija acá: se usa la del backend (12 meses),
    // la misma que leen el resumen del menú y el informe imprimible. Antes
    // esta vista pedía 60 meses y el menú 12: el mismo índice se veía como
    // 95 en el menú y 75 en la vista, porque la cobertura de RCV se diluía
    // contra meses que el sistema nunca ingiere.
    try {
      const [r, g] = await Promise.all([
        apiGet(`/api/contable/empresas/${eid}/salud-tributaria?periodo=${periodo}`),
        apiGet(`/api/contable/empresas/${eid}/salud-tributaria/graficos?periodo=${periodo}`),
      ])
      inf = r.informe
      graficos = g.graficos || {}
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">No se pudo cargar el diagnóstico</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const op = inf.opinion
    const kpis = inf.kpis || {}
    const puede = tiene('salud:sincronizar')

    // ---------------------------------------------------------
    // KPI de portada. Si no hay antecedentes, NO se inventa un 0:
    // se declara «no evaluable con los antecedentes disponibles».
    // ---------------------------------------------------------
    const calendario = op.calendario || []
    const revisados = calendario.filter((c) => c.revisada).length
    const cumplidos = calendario.filter((c) => c.cumplida).length
    const conFormulario = (inf.mensuales || []).filter((m) => m.f29_formulario)
    const observados = conFormulario.filter((m) => (m.f29_formulario.monto_observado || 0) > 0
      || /observ/i.test(m.f29_formulario.situacion || '')).length
    const comparables = (inf.mensuales || []).filter((m) => m.comparacion && m.comparacion.comparable)
    const conciliables = comparables.filter((m) => Math.abs(m.comparacion.diferencia_ventas || 0) < 1000).length
    const remanenteRenta = (inf.renta?.anios || []).reduce((s, r) => s + (r.remanente_devuelto || 0), 0)
    const altas = (op.hallazgos || []).filter((h) => h.severidad === 'alta').length
    const noEval = 'No evaluable con los antecedentes disponibles'

    const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : noEval)
    const tarjetas = [
      {
        k: 'Índice de Salud Tributaria',
        v: op.indice_evaluable === false ? noEval : `${op.score}/100`,
        s: op.clasificacion?.titulo || op.titulo || '—',
        t: 'Promedio ponderado de cinco dimensiones evaluables (cumplimiento 25%, consistencia 25%, riesgos 20%, calidad de datos 15%, controles 15%).',
      },
      {
        k: 'Cumplimiento oportuno',
        v: pct(cumplidos, revisados),
        s: `${cumplidos} de ${revisados} período(s) con declaración vigente`,
        t: 'Obligaciones presentadas dentro de plazo ÷ obligaciones exigibles. Sin consulta oficial no se afirma cumplimiento.',
      },
      {
        k: 'Tasa de declaraciones observadas',
        v: pct(observados, conFormulario.length),
        s: `${observados} de ${conFormulario.length} F29 con casillas leídas`,
        t: 'Declaraciones con observaciones ÷ declaraciones revisadas × 100.',
      },
      {
        k: 'Tasa de conciliación',
        v: pct(conciliables, comparables.length),
        s: `${conciliables} de ${comparables.length} período(s) conciliados`,
        t: 'Períodos sin diferencias inexplicables ÷ períodos comparables × 100.',
      },
      {
        k: 'Exposición tributaria',
        v: (op.exposicion?.total || 0) > 0 ? fmtCorto(op.exposicion.total) : noEval,
        s: 'Suma sin duplicidad de conceptos',
        t: 'Contingencias estimadas y diferencias por investigar, sin sumar multas ni créditos que no son pérdida real.',
      },
      {
        k: 'Créditos y remanentes',
        v: remanenteRenta > 0 ? fmtCorto(remanenteRenta) : noEval,
        s: 'Remanente devuelto en renta (F22)',
        t: 'Créditos y remanentes respaldados y vigentes que requieren seguimiento.',
      },
      {
        k: 'Riesgos críticos abiertos',
        v: String(altas),
        s: altas ? 'Requieren actuación inmediata' : 'Ninguno en severidad alta',
        t: 'Riesgos de severidad alta que impiden una lectura de conformidad plena.',
      },
      {
        k: 'Resolución de alertas',
        v: noEval,
        s: 'El seguimiento de cierre aún no está disponible',
        t: 'Alertas cerradas con evidencia ÷ alertas que correspondía resolver × 100.',
      },
    ]
    // KPIs mejorados con contexto SII y comparaciones
    const kpiContextoSII = (tipo, label, valor, subtipo) => {
      const ctx = { ventas: 'Ventas declaradas en F29 vs. estimadas RCV', iva: 'IVA determinado vs. estimado', ppm: 'PPM declarado vs. estimado' }[tipo]
      return `${ctx || ''} ${label}: ${valor}`.trim()
    }
    const kpiComparacionF29 = (m) => {
      if (!m.comparacion) return ''
      const { diferencia_ventas, diferencia_iva, diferencia_ppm, diferencia_total } = m.comparacion
      const partes = []
      if (diferencia_ventas != null) partes.push(`Ventas: ${fmtM(diferencia_ventas)}`)
      if (diferencia_iva != null) partes.push(`IVA: ${fmtM(diferencia_iva)}`)
      if (diferencia_ppm != null) partes.push(`PPM: ${fmtM(diferencia_ppm)}`)
      if (diferencia_total != null) partes.push(`Total: ${fmtM(diferencia_total)}`)
      return partes.length ? `<div class="kpi-comparison">• ${partes.join(' · ')}</div>` : ''
    }
    const kpiF29Declarado = (m) => {
      if (!m.f29_formulario) return ''
      const { indicadores } = m.f29_formulario
      if (!indicadores) return ''
      const totalPagar = indicadores.total_a_pagar ?? null
      return totalPagar != null ? `<div class="kpi-f29-declared">Total F29 declarado: ${fmtCorto(totalPagar)}</div>` : ''
    }
    const kpiUltimaActualizacion = () => `
      <div class="kpi-ultima-actualizacion">
        <small>Última actualización SII:</small> ${new Date().toLocaleDateString('es-CL')}
      </div>
    `
    const kpiModuloSeleccion = (indice) => `
      <style>
        .sl-kpi-selection-anim { animation: kpiPulse 2s ease-in-out infinite; }
        @keyframes kpiPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      </style>
      <span class="sl-kpi-selection-badge" title="Módulo ${indice}">${indice}</span>
    `


    const chipSev = (s) => ({ alta: 'error', media: 'propuesto', baja: 'pendiente' }[s] || 'neutral')
    const chipEstado = (e) => ({
      declarada: 'contabilizado', rectificada: 'contabilizado', vigente: 'contabilizado',
      pendiente: 'error', no_presentada: 'error', observada: 'error',
    }[e] || 'neutral')
    const fmtM = (v) => (v == null ? '—' : fmt(v))
    const sub = '<span class="sub">—</span>'

    // ---------------------------------------------------------
    // Bloques
    // ---------------------------------------------------------
    const opinionProf = op.opinion_profesional || {}
    const queCambio = op.que_cambio

    const panelResumen = `
      <div class="sl-opinion">
        <p class="sl-opinion-lead">${esc(opinionProf.conclusion || op.resumen || '')}</p>
        <div class="sl-opinion-grid">
          <div><h4>Hechos comprobados</h4>${listaHtml(opinionProf.hechos, 'Sin hechos comprobables con los antecedentes disponibles.')}</div>
          <div><h4>Diferencias detectadas</h4>${listaHtml(opinionProf.diferencias, 'Sin diferencias detectadas.')}</div>
          <div><h4>Riesgos potenciales</h4>${listaHtml(opinionProf.riesgos, 'Sin riesgos potenciales identificados.')}</div>
          <div><h4>Recomendación</h4><p class="muted">${esc(opinionProf.recomendacion || '')}</p></div>
        </div>
        ${(opinionProf.advertencias || []).length ? `<div class="sl-adv"><h4>Advertencias</h4>${listaHtml(opinionProf.advertencias, '')}</div>` : ''}
      </div>
      <div class="grid-2 mt">
        <div class="card">
          <h3>Fortalezas verificadas</h3>
          ${listaHtml(op.fortalezas, 'Sin fortalezas verificables con los antecedentes disponibles.')}
        </div>
        <div class="card">
          <h3>Qué cambió</h3>
          ${queCambio ? `
            <p class="muted">${esc(queCambio.lectura || '')}</p>
            <div class="kpi-grid">
              <div class="kpi"><small>Informe anterior</small><strong>${queCambio.indice_anterior != null ? `${queCambio.indice_anterior}/100` : '—'}</strong></div>
              <div class="kpi ${(queCambio.variacion_indice || 0) > 0 ? 'up' : (queCambio.variacion_indice || 0) < 0 ? 'bad' : ''}">
                <small>Variación</small><strong>${queCambio.variacion_indice != null ? `${queCambio.variacion_indice > 0 ? '+' : ''}${queCambio.variacion_indice}` : '—'}</strong>
              </div>
              <div class="kpi"><small>Alertas nuevas</small><strong>${(queCambio.alertas_nuevas || []).length}</strong></div>
            </div>
            ${(queCambio.alertas_nuevas || []).length ? `<h4 class="mt">Nuevas</h4>${listaHtml(queCambio.alertas_nuevas.map((a) => `${a.titulo} (${a.severidad})`), '')}` : ''}
            ${(queCambio.alertas_resueltas || []).length ? `<h4 class="mt">Resueltas</h4>${listaHtml(queCambio.alertas_resueltas.map((a) => a.titulo), '')}` : ''}
          ` : '<p class="hint">Primer informe de la serie: todavía no hay un informe anterior con el cual comparar.</p>'}
        </div>
      </div>
      <!-- Expert tax opinion badge -->
      <div class="sl-opinion-expert" style="margin: var(--space-3) 0; padding: var(--space-3); background: var(--bg-elevated); border-radius: var(--radius-lg); border-left: 4px solid var(--accent);">
        <h4 style="margin: 0 0 var(--space-2); display: flex; align-items: center; gap: var(--space-2);"><span class="chip contabilizado" style="font-size: var(--fs-xs)">📋</span> Opinión Tributaria Profesional</h4>
        <p class="muted" style="font-size: var(--fs-sm); line-height: 1.5; margin: 0">${esc(opinionProf.conclusion || 'Opinión tributaria en proceso de generación')}</p>
        ${opinionProf.recomendacion ? `<p class="muted" style="font-size: var(--fs-xs); margin: var(--space-1) 0 0">Recomendación: ${esc(opinionProf.recomendacion)}</p>` : ''}
        ${opinionProf.hechos && opinionProf.hechos.length > 0 ? `<p class="muted" style="font-size: var(--fs-xs); margin: var(--space-1) 0 0">Hechos clave: ${listaHtml(opinionProf.hechos.slice(0, 3), '')}</p>` : ''}
      </div>`

    const panelCumplimiento = `
      <div class="card">
        <h3>Calendario de cumplimiento</h3>
        <div class="sl-chart">${graficos.calendario || ''}</div>
        <p class="hint">Los meses no consultados no se cuentan como incumplimientos; los meses futuros no se evalúan.</p>
      </div>
      <div class="card mt">
        <h3>Estado de las declaraciones</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Declaración</th><th>Consulta</th><th>Resultado</th><th>Última consulta</th></tr></thead>
          <tbody>
            ${['f29', 'renta_f22', 'juradas', 'boletas_honorarios'].map((k) => {
      const d = inf.declaraciones[k] || {}
      const nombre = { f29: 'Mensual F29', renta_f22: 'Renta F22', juradas: 'Declaraciones juradas', boletas_honorarios: 'Boletas de honorarios' }[k]
      return `<tr><td>${nombre}</td>
                <td><span class="chip ${d.estado === 'disponible' ? 'contabilizado' : 'neutral'}">${d.estado === 'disponible' ? 'Consultado' : 'No consultado'}</span></td>
                <td class="sub">${esc(d.detalle || '')}</td>
                <td class="sub">${esc(d.ultima_consulta || '—')}</td></tr>`
    }).join('')}
          </tbody>
        </table></div>
        <p class="hint">«Consultado» significa que el dato se leyó del portal autenticado del SII. «No consultado» no es «al día»: es ausencia de información.</p>
      </div>
      <div class="card mt">
        <h3>Declaraciones juradas presentadas (SII)</h3>
        ${(() => {
          const dj = inf.declaraciones_juradas || {}
          if (dj.estado !== 'disponible') {
            return '<div class="empty">Declaraciones juradas no consultadas. Ejecuta «Reunir antecedentes» para leerlas de «Mis Declaraciones Juradas» del SII.</div>'
          }
          const lista = dj.presentadas || []
          return `
            <div class="kpi-grid">
              <div class="kpi"><small>Años consultados</small><strong>${dj.anios_consultados || 0}</strong></div>
              <div class="kpi"><small>Presentadas</small><strong>${dj.total_presentadas || 0}</strong></div>
              <div class="kpi ${(dj.total_pendientes || 0) > 0 ? 'bad' : 'up'}"><small>Sin presentación registrada</small><strong>${dj.total_pendientes || 0}</strong><span class="sub">${(dj.vencidas || 0) > 0 ? `${dj.vencidas} vencida(s)` : 'dentro de plazo'}</span></div>
              <div class="kpi ${(dj.observadas || 0) > 0 ? 'bad' : 'up'}"><small>Observadas / rechazadas</small><strong>${dj.observadas || 0}</strong></div>
            </div>
            ${lista.length ? `<div class="tbl-wrap mt"><table class="tbl">
              <thead><tr><th>Año</th><th>DJ</th><th>Título</th><th>Estado</th><th>Folio</th><th>Presentada</th><th>Vencimiento</th></tr></thead>
              <tbody>${lista.map((d) => `<tr>
                <td class="mono">${esc(d.anio || '—')}</td>
                <td class="mono">${esc(d.dj || '—')}</td>
                <td class="sub">${esc(d.titulo || '—')}</td>
                <td><span class="chip ${/acept/i.test(d.estado || '') ? 'contabilizado' : 'propuesto'}">${esc(d.estado || 'sin estado')}</span></td>
                <td class="mono">${esc(d.folio || '—')}</td>
                <td class="mono">${esc(d.fecha_presentacion || '—')}</td>
                <td class="mono">${esc(d.fecha_vencimiento || '—')}</td>
              </tr>`).join('')}</tbody>
            </table></div>` : '<div class="empty">El SII no registra declaraciones juradas presentadas en los años consultados.</div>'}
            ${(dj.pendientes || []).length ? `<h4 class="mt">Sin presentación registrada según el SII</h4>
              <div class="tbl-wrap"><table class="tbl">
                <thead><tr><th>Año</th><th>DJ</th><th>Título</th><th>Vencimiento</th><th>Estado</th></tr></thead>
                <tbody>${dj.pendientes.map((d) => `<tr>
                  <td class="mono">${esc(d.anio || '—')}</td>
                  <td class="mono">${esc(d.dj || '—')}</td>
                  <td class="sub">${esc(d.titulo || '—')}</td>
                  <td class="mono">${esc(d.fecha_vencimiento || '—')}</td>
                  <td><span class="chip ${d.fecha_vencimiento && d.fecha_vencimiento < new Date().toISOString().slice(0, 10) ? 'error' : 'propuesto'}">${d.fecha_vencimiento && d.fecha_vencimiento < new Date().toISOString().slice(0, 10) ? 'Vencida' : 'En plazo'}</span></td>
                </tr>`).join('')}</tbody>
              </table></div>` : ''}
            <p class="hint">${esc(dj.nota || '')}</p>`
        })()}
      </div>
      <div class="card mt">
        <h3>Detalle por período · declarado (SII) vs. estimado (RCV)</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Período</th><th>F29 SII</th><th class="num">Ventas netas</th><th class="num">IVA est.</th>
            <th class="num">PPM est.</th><th class="num">F29 declarado</th><th class="num">Dif. total</th><th class="num">Dif. ventas</th></tr></thead>
          <tbody>${(inf.mensuales || []).map((m) => `<tr>
            <td>${esc(m.nombre)}</td>
            <td><span class="chip ${chipEstado(m.f29_estado)}">${esc(m.f29_oficial?.etiqueta || 'No consultado')}</span></td>
            <td class="num mono">${m.estado === 'sin_datos' ? sub : fmtM(m.ventas_neto)}</td>
            <td class="num mono">${m.estado === 'sin_datos' ? sub : fmtM(m.iva_estimado)}</td>
            <td class="num mono">${m.estado === 'sin_datos' ? sub : fmtM(m.ppm_estimado)}</td>
            <td class="num mono">${m.f29_oficial?.monto_total != null ? fmtM(m.f29_oficial.monto_total) : sub}</td>
            <td class="num mono">${m.f29_diferencia != null ? fmtM(m.f29_diferencia) : sub}</td>
            <td class="num mono">${m.comparacion?.diferencia_ventas != null ? fmtM(m.comparacion.diferencia_ventas) : sub}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">«IVA est.» es una estimación propia desde el RCV; «F29 declarado» es lo que informa el SII. «Dif. total» = estimado − declarado y solo aparece cuando el mes tiene RCV ingerido y el SII entregó el monto; «Dif. ventas» = ventas declaradas − ventas del RCV (solo con Formulario Compacto del F29). Un «—» en las columnas estimadas significa que no hay RCV ingerido para ese mes: no se estima nada, no se afirma que no hubo movimiento.</p>
      </div>
      <!-- Nueva sección: Comparativa F29 vs RCV -->
      <div class="card mt">
        <h3>Comparativa F29 (SII) vs. RCV (Sistema)</h3>
        ${(inf.mensuales || []).length > 0 ? `
          <div class="kpi-grid kpi-grid-comparison">
            <div class="kpi kpi-comparative"><small>Período</small><strong>Actual</strong></div>
            <div class="kpi kpi-comparative"><small>F29 declarado</small><strong>${inf.f29_declarado?.estado === 'disponible' ? 'Disponible' : 'No consultado'}</strong></div>
            <div class="kpi kpi-comparative"><small>Estimado RCV</small><strong>${fmtCorto(kpis.declarado?.ventas || 0)}</strong></div>
            <div class="kpi kpi-comparative"><small>Diferencia</small><strong>${fmtCorto(kpis.declarado?.total_a_pagar || 0)}</strong></div>
          </div>
          <div class="tbl-wrap mt"><table class="tbl">
            <thead><tr><th>Período</th><th class="num">Ventas F29</th><th class="num">Ventas RCV</th><th class="num">Dif. Ventas</th><th class="num">Dif. %</th></tr></thead>
            <tbody>${(inf.mensuales || []).slice(0, 6).map((m) => `<tr>
              <td>${esc(m.nombre)}</td>
              <td class="num mono">${m.comparacion?.ventas_declaradas != null ? fmtM(m.comparacion.ventas_declaradas) : sub}</td>
              <td class="num mono">${fmtM(m.ventas_neto)}</td>
              <td class="num mono">${m.comparacion?.diferencia_ventas != null ? fmtM(m.comparacion.diferencia_ventas) : '—'}</td>
              <td class="num mono">${m.comparacion?.diferencia_ventas != null ? `${Math.round((m.comparacion.diferencia_ventas / Math.max(1, m.ventas_neto)) * 1000) / 10}%` : '—'}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        ` : ''}
      </div>`

    const panelIva = `
      <div class="card">
        <h3>Evolución mensual del IVA</h3>
        <div class="sl-chart">${graficos.iva || ''}</div>
        <p class="hint">Débito y crédito fiscal desde el RCV ingerido. El IVA determinado es una estimación propia y no sustituye la determinación del F29.</p>
      </div>
      <div class="card mt">
        <h3>Puente de conciliación</h3>
        <div class="sl-chart">${graficos.puente || ''}</div>
        <p class="hint">${(kpis.declarado?.periodos || 0) > 0
        ? 'Construido con las casillas del Formulario Compacto del F29 leídas del SII.'
        : 'Construido con estimaciones del RCV: no hay Formulario Compacto del F29 disponible.'}</p>
      </div>
      <div class="card mt">
        <h3>Formulario Compacto del F29 (datos declarados)</h3>
        ${inf.f29_declarado?.estado === 'disponible' ? `
          <div class="kpi-grid">
            <div class="kpi"><small>Períodos leídos</small><strong>${inf.f29_declarado.periodos.length}</strong></div>
            <div class="kpi ${inf.f29_declarado.verificaciones_ok === inf.f29_declarado.verificaciones_total ? 'up' : 'bad'}">
              <small>Verificaciones internas</small><strong>${inf.f29_declarado.verificaciones_ok}/${inf.f29_declarado.verificaciones_total}</strong></div>
            <div class="kpi"><small>Ventas declaradas</small><strong>${fmtCorto(kpis.declarado?.ventas || 0)}</strong></div>
            <div class="kpi"><small>Total a pagar declarado</small><strong>${fmtCorto(kpis.declarado?.total_a_pagar || 0)}</strong></div>
          </div>
          <div class="tbl-wrap mt"><table class="tbl">
            <thead><tr><th>Período</th><th>Folio</th><th>Situación</th><th class="num">IVA determinado</th><th class="num">PPM neto</th><th class="num">Total a pagar</th><th class="num">Observado</th></tr></thead>
            <tbody>${(inf.f29_declarado.periodos || []).map((p) => `<tr>
              <td>${esc(p.periodo)}</td><td class="mono">${esc(p.folio || '—')}</td>
              <td class="sub">${esc(p.situacion || '—')}</td>
              <td class="num mono">${p.indicadores?.iva_determinado != null ? fmt(p.indicadores.iva_determinado) : sub}</td>
              <td class="num mono">${p.indicadores?.ppm_neto != null ? fmt(p.indicadores.ppm_neto) : sub}</td>
              <td class="num mono">${p.indicadores?.total_a_pagar != null ? fmt(p.indicadores.total_a_pagar) : sub}</td>
              <td class="num mono">${p.monto_observado ? fmt(p.monto_observado) : sub}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        ` : '<div class="empty">Formulario Compacto no consultado. Ejecuta «Reunir antecedentes» para leer las casillas declaradas del F29.</div>'}
      </div>`

    // ---------------------------------------------------------
    // Deuda FISCAL (TGR). Se rotula como Fisco: no es deuda comercial.
    // ---------------------------------------------------------
    const deuda = inf.deudas?.fiscal_tgr || { estado: 'no_consultado' }
    const puedeDeuda = tiene('tesoreria:operar')
    const chipDeuda = deuda.estado === 'sin_deuda' ? 'contabilizado' : deuda.estado === 'con_deuda' ? 'error' : 'neutral'
    const panelDeuda = `
      <div class="card">
        <h3>Deuda fiscal (TGR) <span class="chip ${chipDeuda}">${esc(deuda.etiqueta || 'No consultada')}</span></h3>
        <p class="muted">${esc(deuda.detalle || 'Sin consulta registrada en la Tesorería General de la República.')}</p>
        <div class="tbl-wrap"><table class="tbl"><tbody>
          <tr><th>Monto certificado</th><td class="num mono">${deuda.total != null ? fmt(deuda.total) : '—'}</td></tr>
          <tr><th>Fecha de emisión</th><td class="mono">${esc(deuda.fecha_emision || '—')}</td></tr>
          <tr><th>Liquidada al</th><td class="mono">${esc(deuda.liquidada_al || '—')}</td></tr>
          <tr><th>Código de verificación</th><td class="mono">${esc(deuda.codigo_verificacion || '—')}</td></tr>
          <tr><th>Última consulta</th><td class="mono">${esc(deuda.consultado_en || '—')}</td></tr>
          <tr><th>Fuente</th><td class="sub">${esc(deuda.fuente || 'TGR — Certificado de Deuda Fiscal')}</td></tr>
        </tbody></table></div>
        ${(deuda.documentos || []).length ? `
        <h4 class="mt">Detalle por documento (según el certificado)</h4>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Documento</th><th>Período</th><th class="num">Monto</th><th>Glosa del certificado</th></tr></thead>
          <tbody>${deuda.documentos.map((d) => `<tr>
            <td>${esc(d.documento || '—')}</td>
            <td class="mono">${esc(d.periodo || '—')}</td>
            <td class="num mono">${d.monto != null ? fmt(d.monto) : '—'}</td>
            <td class="sub">${esc(d.glosa || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        ${deuda.total == null && deuda.total_calculado != null ? `<p class="hint">El total no venía rotulado; la suma de las filas es ${fmt(deuda.total_calculado)} y NO se usa como total oficial.</p>` : ''}` : ''}
        <div class="sl-acciones" style="margin-top: var(--space-3)">
          ${deuda.pdf ? '<button class="btn btn-secondary" id="sl-certificado">Ver certificado (PDF)</button>' : ''}
          ${puedeDeuda ? '<button class="btn btn-primary" id="sl-deuda">Consultar deuda fiscal</button>' : ''}
        </div>
        <p class="hint">${esc(deuda.nota || 'La deuda fiscal del Fisco (TGR) es distinta de la deuda comercial del sistema.')}</p>
      </div>`

    const panelRiesgos = `
      <div class="grid-2">
        <div class="card"><h3>Distribución por severidad</h3><div class="sl-chart">${graficos.riesgos || ''}</div></div>
        <div class="card"><h3>Exposición por materia</h3><div class="sl-chart">${graficos.exposicion || ''}</div></div>
      </div>
      <div class="card mt">
        <h3>Matriz de riesgos</h3>
        ${(op.matriz_riesgos || []).length ? `<div class="tbl-wrap"><table class="tbl sl-tbl-riesgos">
          <thead><tr><th>Severidad</th><th>Materia</th><th>Riesgo</th><th>Período</th><th class="num">Exposición</th>
            <th>Triage</th><th>Evidencia</th></tr></thead>
          <tbody>${op.matriz_riesgos.map((r) => `<tr>
            <td><span class="chip ${chipSev(r.severidad)}">${esc(String(r.severidad).toUpperCase())}</span></td>
            <td>${esc(r.materia || '—')}</td><td>${esc(r.titulo || '—')}</td><td>${esc(r.periodo || '—')}</td>
            <td class="num mono">${r.importe ? fmt(r.importe) : sub}${r.cuenta_exposicion === false && r.importe ? '<span class="sub">no suma al total</span>' : ''}</td>
            <td class="sub"><span>${esc(r.naturaleza || '—')}</span><span>${esc(r.responsable || '—')} · ${esc(r.plazo || '—')}</span></td>
            <td class="sub">${esc(r.evidencia || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Sin riesgos cuantificados en la ventana analizada.</div>'}
        <p class="hint">${esc(op.exposicion?.nota || '')}</p>
      </div>`

    const panelTendencias = `
      <div class="card">
        <h3>Tendencia mensual</h3>
        <div class="sl-chart">${graficos.tendencia || ''}</div>
        <p class="hint">Ventas netas e IVA determinado por período, desde el RCV ingerido.</p>
      </div>
      <div class="card mt">
        <h3>Ingresos por año (RCV)</h3>
        <p class="hint" style="margin-top:0">${esc(inf.ingresos_historicos?.nota || '')}</p>
        ${(inf.ingresos_historicos?.anios || []).length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Año</th><th class="num">Ventas neto</th><th class="num">IVA ventas</th><th class="num">Compras neto</th><th class="num">IVA compras</th><th class="num">Meses</th></tr></thead>
          <tbody>${inf.ingresos_historicos.anios.map((a) => `<tr>
            <td><b>${esc(a.anio)}</b></td><td class="num mono">${fmtM(a.ventas_neto)}</td><td class="num mono">${fmtM(a.ventas_iva)}</td>
            <td class="num mono">${fmtM(a.compras_neto)}</td><td class="num mono">${fmtM(a.compras_iva)}</td><td class="num">${a.meses_con_datos}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Sin años con RCV ingerido.</div>'}
      </div>`

    const teso = inf.tesoreria || {}
    const panelImpacto = `
      <div class="card">
        <h3>Impacto financiero del período</h3>
        <div class="kpi-grid">
          <div class="kpi"><small>Ventas netas</small><strong>${fmtCorto(kpis.ventas_periodo || 0)}</strong></div>
          <div class="kpi"><small>IVA estimado</small><strong>${fmtCorto(kpis.iva_periodo || 0)}</strong></div>
          <div class="kpi"><small>PPM estimado</small><strong>${fmtCorto(kpis.ppm_periodo || 0)}</strong></div>
          <div class="kpi"><small>Margen bruto</small><strong>${kpis.margen_bruto_pct != null ? `${kpis.margen_bruto_pct}%` : '—'}</strong></div>
          <div class="kpi"><small>Fondos disponibles</small><strong>${teso.total_bancos != null ? fmtCorto(teso.total_bancos) : '—'}</strong></div>
          <div class="kpi ${(teso.cobranza?.vencido_30_dias || 0) > 0 ? 'bad' : ''}"><small>Cartera vencida &gt;30 días</small><strong>${teso.cobranza?.vencido_30_dias != null ? fmtCorto(teso.cobranza.vencido_30_dias) : '—'}</strong></div>
        </div>
      </div>
      <div class="grid-2 mt">
        <div class="card">
          <h3>Escenarios de caja</h3>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            <tr><th>Cobertura de obligaciones del período</th><td class="num">${(teso.total_bancos != null && (kpis.iva_periodo || 0) + (kpis.ppm_periodo || 0) > 0)
        ? `${Math.round((teso.total_bancos / ((kpis.iva_periodo || 0) + (kpis.ppm_periodo || 0))) * 1000) / 10}%` : '—'}</td></tr>
            <tr><th>DSO estimado (cobranza)</th><td class="num">${kpis.tesoreria?.dso_estimado != null ? `${kpis.tesoreria.dso_estimado} días` : '—'}</td></tr>
            <tr><th>Conciliación bancaria</th><td class="num">${teso.conciliacion?.ratio != null ? `${teso.conciliacion.ratio}%` : '—'}</td></tr>
            <tr><th>Cuentas por pagar</th><td class="num">${teso.proveedores?.total != null ? fmtCorto(teso.proveedores.total) : '—'}</td></tr>
            <tr><th>Exposición tributaria identificada</th><td class="num">${(op.exposicion?.total || 0) > 0 ? fmtCorto(op.exposicion.total) : '—'}</td></tr>
          </tbody></table></div>
          <p class="hint">Escenarios derivados de la caja registrada. Requieren validación del contador.</p>
        </div>
        <div class="card">
          <h3>Renta (F22)</h3>
          ${(inf.renta?.anios || []).length ? `<div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Año</th><th>Estado</th><th class="num">Monto declarado</th><th class="num">Remanente devuelto</th></tr></thead>
            <tbody>${inf.renta.anios.map((r) => `<tr>
              <td>${esc(r.anio)}</td>
              <td><span class="chip ${chipEstado(r.estado)}">${esc(r.estado || '—')}</span></td>
              <td class="num mono">${r.monto_total != null ? fmt(r.monto_total) : sub}</td>
              <td class="num mono">${r.remanente_devuelto ? fmt(r.remanente_devuelto) : sub}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty">Renta no consultada: la existencia de la declaración anual no está verificada.</div>'}
        </div>
      </div>`

    const panelPlan = `
      <div class="card">
        <h3>Plan de acción (${(op.plan_accion || []).length})</h3>
        ${(op.plan_accion || []).length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>#</th><th>Acción</th><th>Motivo</th><th>Evidencia de cierre</th><th>Responsable</th><th>Plazo</th><th class="num">Impacto estimado</th></tr></thead>
          <tbody>${op.plan_accion.map((a, i) => `<tr>
            <td>${a.prioridad ?? i + 1}</td>
            <td>${esc(a.accion || '—')}</td>
            <td class="sub">${esc(a.motivo || '—')}</td>
            <td class="sub">${esc(a.evidencia || '—')}</td>
            <td>${esc(a.responsable || '—')}</td>
            <td>${esc(a.plazo || '—')}</td>
            <td class="num mono">${a.impacto_estimado ? fmt(a.impacto_estimado) : sub}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="empty">Sin acciones pendientes: mantener el control mensual.</div>'}
        <p class="hint">Cada acción se cierra con la evidencia señalada; el siguiente informe verifica el resultado.</p>
      </div>
      <!-- Plan de acción con opinión experta tributaria -->
      <div class="card mt">
        <h3>Plan de acción tributario</h3>
        <p class="muted" style="font-size: var(--fs-sm); margin: var(--space-2) 0 0">Basado en la opinión tributaria profesional y los hallazgos del informe, se recomienda:</p>
        ${(op.plan_accion || []).length ? `
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>#</th><th>Acción</th><th>Razón tributaria</th><th>Evidencia</th><th>Responsable</th><th>Plazo</th><th class="num">Impacto estimado</th></tr></thead>
            <tbody>${op.plan_accion.map((a, i) => `<tr>
              <td>${a.prioridad ?? i + 1}</td>
              <td>${esc(a.accion || '—')}</td>
              <td class="sub">${esc(a.motivo || '—')}</td>
              <td class="sub">${esc(a.evidencia || '—')}</td>
              <td>${esc(a.responsable || '—')}</td>
              <td>${esc(a.plazo || '—')}</td>
              <td class="num mono">${a.impacto_estimado ? fmt(a.impacto_estimado) : sub}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty">No hay acciones pendientes: el informe actual está al día.</div>'}
        <p class="muted" style="font-size: var(--fs-xs); margin: var(--space-3) 0 0">«Mantener el control mensual de declaraciones y conciliación para evitar sanciones del SII.»</p>
        <p class="muted" style="font-size: var(--fs-xs); margin: var(--space-2) 0 0; color: var(--fg-muted)">— Opinión tributaria profesional generada automáticamente a partir de los antecedentes SII reunidos.</p>
      </div>`

    const met = inf.metodologia || {}
    const panelMetodologia = `
      <div class="grid-2">
        <div class="card">
          <h3>Índice por dimensiones</h3>
          <div class="sl-chart">${graficos.indice || ''}</div>
          <p class="hint">${esc(met.regla_no_evaluable || '')}</p>
          <p class="hint">${esc(met.regla_alerta_critica || '')}</p>
          <p class="hint">Escala: ${esc(met.clasificacion || '')}</p>
        </div>
        <div class="card">
          <h3>Identificación del contribuyente</h3>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            <tr><th>RUT</th><td class="mono">${esc(formatRut(inf.identidad?.rut || ''))}</td></tr>
            <tr><th>Razón social</th><td>${esc(inf.identidad?.razon_social || '')}</td></tr>
            <tr><th>Régimen</th><td>${esc(inf.identidad?.regimen || '—')}</td></tr>
            <tr><th>Inicio de actividades</th><td>${esc(inf.identidad?.inicio_actividades || '—')}</td></tr>
            <tr><th>Fuente de la ficha</th><td class="sub">${esc(inf.identidad?.fuente || '—')}</td></tr>
            <tr><th>Período evaluado</th><td>${esc(inf.cobertura?.desde || '—')} → ${esc(inf.cobertura?.hasta || '—')}</td></tr>
            <tr><th>Cobertura del diagnóstico</th><td>${op.cobertura_diagnostico}% · confianza ${esc(op.nivel_confianza || '—')}</td></tr>
          </tbody></table></div>
        </div>
      </div>
      <div class="card mt">
        <h3>Origen de los datos</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Categoría</th><th>Qué significa</th></tr></thead>
          <tbody>${(met.origen_datos || []).map((o) => `<tr><td><b>${esc(o.nombre)}</b></td><td class="sub">${esc(o.detalle)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="grid-2 mt">
        <div class="card">
          <h3>Limitaciones</h3>
          ${listaHtml([...(met.limitaciones_generales || []), ...(op.limitaciones || [])], '')}
        </div>
        <div class="card">
          <h3>Base normativa de referencia</h3>
          ${listaHtml(op.base_normativa, '')}
          <h3 class="mt">Capacidades reales de la conexión SII</h3>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Consulta</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody>${(inf.capacidades_sii || []).map((c) => `<tr>
              <td><b>${esc(c.nombre)}</b></td>
              <td><span class="chip ${c.estado === 'disponible' ? 'contabilizado' : c.estado === 'parcial' ? 'propuesto' : 'error'}">${esc(c.estado)}</span></td>
              <td class="sub">${esc(c.detalle || '')}</td></tr>`).join('')}</tbody>
          </table></div>
          <h3 class="mt">Capacidades reales de la conexión TGR (Tesorería)</h3>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Consulta</th><th>Estado</th><th>Detalle</th></tr></thead>
            <tbody>${(inf.capacidades_tgr || []).map((c) => `<tr>
              <td><b>${esc(c.nombre)}</b></td>
              <td><span class="chip ${c.estado === 'disponible' ? 'contabilizado' : c.estado === 'parcial' ? 'propuesto' : 'error'}">${esc(c.estado)}</span></td>
              <td class="sub">${esc(c.detalle || '')}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>`

    const panelIdentidad = `
      <div class="grid-2">
        <div class="card">
          <h3>Identificación y actividad</h3>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            <tr><th>RUT</th><td class="mono">${esc(formatRut(inf.identidad?.rut || ''))}</td></tr>
            <tr><th>Razón social</th><td>${esc(inf.identidad?.razon_social || '')}</td></tr>
            <tr><th>Tipo</th><td>${esc(inf.identidad?.tipo_contribuyente || '—')}</td></tr>
            <tr><th>Inicio de actividades</th><td>${esc(inf.identidad?.inicio_actividades || '—')}</td></tr>
            <tr><th>Actividad económica</th><td>${esc((inf.identidad?.actividades || []).join(' · ') || '—')}</td></tr>
            <tr><th>Dirección</th><td>${esc(inf.identidad?.direccion || '—')}</td></tr>
          </tbody></table></div>
        </div>
        <div class="card">
          <h3>Régimen y atributos del SII</h3>
          ${inf.identidad?.regimen
        ? `<div class="checkline ok">Régimen vigente: <b>${esc(inf.identidad.regimen)}</b></div>`
        : '<div class="checkline warn">Régimen no determinado en la ficha.</div>'}
          ${(inf.identidad?.atributos || []).length ? `<div class="tbl-wrap mt"><table class="tbl">
            <thead><tr><th>Código</th><th>Atributo</th><th>Vigencia</th></tr></thead>
            <tbody>${inf.identidad.atributos.map((a) => `<tr><td class="mono">${esc(a.codigo)}</td><td>${esc(a.descripcion || '')}</td>
              <td class="sub">${esc(a.fechaInicio || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="hint">Sin atributos en la ficha guardada.</p>'}
          ${(inf.identidad?.alertas_sii || []).length ? `<h4 class="mt">Alertas del SII (verbatim)</h4>
            ${inf.identidad.alertas_sii.map((a) => `<div class="checkline warn">${esc(a.descripcion || a.descripcionAlerta || 'Alerta sin descripción')}</div>`).join('')}` : ''}
        </div>
      </div>`

    const tabs = [
      { id: 'resumen', label: 'Resumen', html: panelResumen },
      { id: 'cumplimiento', label: 'Cumplimiento', html: panelCumplimiento },
      { id: 'iva', label: 'IVA y conciliación', html: panelIva },
      { id: 'riesgos', label: 'Riesgos', html: panelRiesgos },
      { id: 'tendencias', label: 'Tendencias', html: panelTendencias },
      { id: 'deuda', label: 'Deuda fiscal (TGR)', html: panelDeuda },
      { id: 'impacto', label: 'Impacto financiero', html: panelImpacto },
      { id: 'plan', label: 'Plan de acción', html: panelPlan },
      { id: 'metodologia', label: 'Metodología', html: panelMetodologia },
      { id: 'identidad', label: 'Identificación', html: panelIdentidad },
    ]

    const color = op.nivel === 'AL_DIA' ? 'var(--success)' : op.nivel === 'CON_OBSERVACIONES' ? 'var(--warning)' : op.nivel === 'REQUIERE_REVISION' ? 'var(--danger)' : 'var(--fg-muted)'

    // ---------------------------------------------------------
    // Portada profesional con imagen de bienvenida y índice
    // ---------------------------------------------------------
    const bienvenida = `
      <div class="sl-portada-bienvenida">
        <img class="sl-portada-robot" src="/assets/robot-jmv.svg" alt="Robot de bienvenida JMV" width="64" height="64" aria-hidden="true">
        <h1 class="sl-portada-titulo">Salud Tributaria</h1>
        <p class="sl-portada-subtitulo">Diagnóstico inteligente de cumplimiento tributario</p>
      </div>`
    
    const perDisplay = inf.periodo ? `${inf.periodo.slice(4, 6)}/${inf.periodo.slice(0, 4)}` : '—/—'

    cont.innerHTML = `
      <div class="card sl-portada">
        <div class="sl-portada-grid">
          <div>
            <span class="sys-kicker">JMV Tax Health Intelligence · ${esc(perDisplay)}</span>
            <h2 class="sl-titulo">Diagnóstico de Salud Tributaria</h2>
            <p class="muted" style="max-width:64ch;margin:6px 0 12px">${esc(op.clasificacion?.titulo || op.titulo || '')} — ${esc(op.resumen || '')}</p>
            ${op.alerta_critica ? `<p class="opinion-nota" style="font-size: var(--fs-sm); color: var(--rojo); border-left: 3px solid var(--rojo); padding: 2px 0 2px 10px; margin: 0 0 12px; font-weight: 600">${esc(op.clasificacion?.nota || op.opinion_profesional?.conclusion || 'Alerta de severidad alta detectada: revisar antes de emitir documentos')}</p>` : ''}
            <div class="sl-indice">
              <div class="sl-indice-num" style="color:${color}">${op.indice_evaluable === false ? '—' : esc(op.score)}<small>/100</small></div>
              <div class="sl-indice-meta">
                <div><b>Cobertura</b> ${op.cobertura_diagnostico}%</div>
                <div><b>Confianza</b> ${esc(op.nivel_confianza || '—')}</div>
                <div><b>Alertas altas</b> ${altas}</div>
                <div><b>Acciones</b> ${(op.plan_accion || []).length}</div>
              </div>
            </div>
          </div>
          ${bienvenida}
          <div class="sl-indice">
            <div class="sl-indice-num" style="color:${color}">${op.indice_evaluable === false ? '—' : esc(op.score)}<small>/100</small></div>
            <div class="sl-indice-meta">
              <div><b>Cobertura</b> ${op.cobertura_diagnostico}%</div>
              <div><b>Confianza</b> ${esc(op.nivel_confianza || '—')}</div>
              <div><b>Alertas altas</b> ${altas}</div>
              <div><b>Acciones</b> ${(op.plan_accion || []).length}</div>
            </div>
          </div>
        </div>
        <div class="sl-acciones">
            ${puede ? '<button class="btn btn-primary" id="sl-reunion">Reunir antecedentes</button>' : ''}
            <button class="btn btn-secondary" id="sl-emitir">Emitir informe (PDF)</button>
            <p class="hint" style="text-align:right;margin:6px 0 0">«Reunir antecedentes» consulta el SII (ficha, compras y ventas, declaraciones, F29 compacto, juradas y renta) y la deuda fiscal en la TGR, y rehace el informe. Puede tardar varios minutos.</p>
          </div>
        </div>
        <div id="sl-progreso" class="sl-progreso"></div>
      </div>

      <div class="sl-kpis">
        ${tarjetas.map((t) => `
          <div class="sl-kpi" title="${esc(t.t)}">
            <div class="sl-kpi-k">${esc(t.k)}</div>
            <div class="sl-kpi-v">${esc(t.v)}</div>
            <div class="sl-kpi-s">${esc(t.s)}</div>
            ${kpiContextoSII(t.k, '', t.v, t.s)}
          </div>`).join('')}
      </div>

      <div class="sl-kpi-animaciones">
        ${tarjetas.map((t, i) => `
          <div class="sl-kpi-anim sl-kpi-selection-anim" data-index="${i}">${kpiModuloSeleccion(i)}</div>`).join('')}
      </div>

      <div class="sl-kpi-contexto-sii">
        ${inf.mensuales && inf.mensuales.length > 0 ? `
          <div class="sl-kpi-f29-comparison">
            <small>Comparación F29 declarado vs. RCV estimado</small>
            ${inf.mensuales.slice(0, 3).map((m) => kpiF29Declarado(m)).join('')}
            ${inf.mensuales.slice(0, 3).map((m) => kpiComparacionF29(m)).join('')}
          </div>` : ''}
      </div>

      <div class="sl-tabs" role="tablist">
        ${tabs.map((t, i) => `<button class="sl-tab ${i === 0 ? 'active' : ''}" data-tab="${t.id}" role="tab">${esc(t.label)}</button>`).join('')}
      </div>
      ${tabs.map((t, i) => `<div class="sl-panel ${i === 0 ? '' : 'hidden'}" data-panel="${t.id}">${t.html}</div>`).join('')}
    `

    // ---------------------------------------------------------
    // Tabs
    // ---------------------------------------------------------
    const botones = cont.querySelectorAll('.sl-tab')
    const paneles = cont.querySelectorAll('.sl-panel')
    botones.forEach((b) => b.addEventListener('click', () => {
      botones.forEach((x) => x.classList.toggle('active', x === b))
      paneles.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }))

    // ---------------------------------------------------------
    // Emitir informe imprimible (HTML → PDF del navegador)
    // ---------------------------------------------------------
    document.getElementById('sl-emitir')?.addEventListener('click', () => {
      const url = `/api/contable/empresas/${eid}/salud-tributaria/informe?periodo=${periodo}`
      const w = window.open(url, '_blank')
      if (!w) showToast('El navegador bloqueó la ventana emergente: abre el informe desde el enlace.', 'error')
    })

    // Certificado de deuda de la TGR: el PDF oficial tal como lo entregó la
    // Tesorería (evidencia descargable, no una reconstrucción).
    document.getElementById('sl-certificado')?.addEventListener('click', () => {
      const url = `/api/contable/empresas/${eid}/tesoreria/deuda-fiscal/certificado`
      const w = window.open(url, '_blank')
      if (!w) showToast('El navegador bloqueó la ventana emergente: abre el certificado desde el enlace.', 'error')
    })

    document.getElementById('sl-deuda')?.addEventListener('click', async (ev) => {
      const b = ev.currentTarget
      b.disabled = true
      b.textContent = 'Consultando la TGR…'
      try {
        await apiPost(`/api/contable/empresas/${eid}/tesoreria/deuda-fiscal/consultar`, {})
        showToast('Certificado de deuda consultado en la TGR.', 'success')
        renderRoute()
      } catch (err) {
        showToast(err.message, 'error')
        b.disabled = false
        b.textContent = 'Consultar deuda fiscal'
      }
    })

    // Agregar estilo para la portada y animaciones
    const estilo = `
      <style>
        .sl-portada { position: relative; }
        .sl-portada-bienvenida { text-align: center; padding: var(--space-4) var(--space-3); margin-bottom: var(--space-4); }
        .sl-portada-robot { width: 64px; height: 64px; margin: 0 auto var(--space-2); }
        .sl-portada-titulo { font-family: var(--font-display); font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.01em; margin: 0; color: var(--fg-primary); }
        .sl-portada-subtitulo { color: var(--fg-muted); font-size: var(--fs-sm); margin: 4px 0 0; }
        .sl-kpi-animaciones { position: absolute; top: var(--space-2); right: var(--space-2); display: flex; gap: var(--space-2); }
        .sl-kpi-selection-badge {
          background: var(--accent-soft); color: var(--accent);
          padding: 2px 8px; border-radius: var(--radius-full);
          font-size: var(--fs-xs); font-weight: var(--fw-semibold);
        }
        .sl-kpi-f29-comparison {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-4);
          margin-top: var(--space-3);
        }
        .sl-kpi-f29-declared {
          background: var(--accent-soft);
          color: var(--accent);
          padding: var(--space-1) var(--space-2);
          border-radius: var(--radius-md);
          font-size: var(--fs-xs);
          margin: var(--space-1) 0;
        }
        .sl-kpi-contexto-sii {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-lg);
          padding: var(--space-3) var(--space-4);
          margin: var(--space-3) 0;
        }
        .sl-kpi-contexto-sii small {
          color: var(--fg-muted);
          display: block;
          margin-bottom: var(--space-1);
        }
        @keyframes kpiPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      </style>`
    cont.insertAdjacentHTML('afterbegin', estilo)

    // ---------------------------------------------------------
    // Botón único: reunión de antecedentes
    // ---------------------------------------------------------
    const cajaProgreso = document.getElementById('sl-progreso')
    document.getElementById('sl-reunion')?.addEventListener('click', async () => {
      const boton = document.getElementById('sl-reunion')
      boton.disabled = true
      boton.textContent = 'Reuniendo…'
      cajaProgreso.innerHTML = '<div class="sl-prog"><b>Iniciando la consulta al SII…</b></div>'
      try {
        const r = await apiPost(`/api/contable/empresas/${eid}/salud-tributaria/reunion`, { periodo })
        const jobId = r.jobId
        const pintar = (est) => {
          const pasos = est.pasos || []
          cajaProgreso.innerHTML = `
            <div class="sl-prog">
              <div class="sl-prog-estado">${est.estado === 'en_curso' ? 'Consultando el SII…' : est.estado === 'completado' ? 'Antecedentes reunidos' : est.estado === 'completado_con_errores' ? 'Reunido con errores parciales' : 'Error'}</div>
              <ul class="sl-prog-pasos">${pasos.map((p) => `<li class="sl-prog-paso is-${p.estado}">
                <span class="sl-prog-dot"></span>
                <span class="sl-prog-nombre">${esc(p.nombre)}</span>
                <span class="sl-prog-detalle">${esc(p.detalle || p.error || '')}</span>
              </li>`).join('')}</ul>
            </div>`
        }
        await new Promise((resolve) => {
          const stop = iniciarPolling(
            () => apiGet(`/api/contable/empresas/${eid}/salud-tributaria/reunion/${jobId}`).then((x) => x.estado),
            {
              onUpdate: pintar,
              esTerminal: (est) => est.estado !== 'en_curso',
              intervalo: 3000,
            },
          )
          setTimeout(() => { stop(); resolve() }, 30 * 60 * 1000)
        })
        const final = await apiGet(`/api/contable/empresas/${eid}/salud-tributaria/reunion/${jobId}`)
        const fallidos = (final.estado.pasos || []).filter((p) => p.estado === 'error')
        showToast(
          fallidos.length
            ? `Antecedentes reunidos con ${fallidos.length} paso(s) con error: ${fallidos.map((p) => p.nombre).join(', ')}`
            : 'Antecedentes reunidos. El informe fue actualizado.',
          fallidos.length ? 'error' : 'success',
        )
        renderRoute()
      } catch (err) {
        cajaProgreso.innerHTML = `<div class="sl-prog"><b style="color:var(--danger)">${esc(err.message)}</b></div>`
        boton.disabled = false
        boton.textContent = 'Reunir antecedentes'
      }
    })
  },
}

/** Lista HTML tolerante: sin datos NO inventa contenido. */
function listaHtml(items, vacio = '') {
  if (!items || !items.length) return vacio ? `<p class="hint">${esc(vacio)}</p>` : ''
  return `<ul class="sl-lista">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
}
