/**
 * informe-salud-html.js — Renderizador del INFORME EJECUTIVO DE SALUD TRIBUTARIA
 * (JMV Tax Health Intelligence).
 *
 * Por qué un renderizador propio y no una librería de PDF:
 *   - El PDF lo produce el NAVEGADOR (Imprimir → Guardar como PDF) sobre este
 *     mismo HTML: el informe impreso y el panel del sistema nunca se
 *     contradicen (mismo dato, misma fecha, mismo texto).
 *   - Cero dependencias nuevas: todo es HTML + CSS + SVG inline.
 *   - El SVG inline se imprime nítido a cualquier escala y se puede reusar en
 *     el panel (se expone `graficosSvg` para el front).
 *
 * Módulo PURO: recibe el objeto `informe` ya construido por
 * `salud-tributaria.construirInforme` y devuelve strings. No toca la BD, no
 * hace red y nunca imprime secretos.
 *
 * Paleta de marca: marfil (fondo), grafito (texto), bronce (acento). Verde,
 * ámbar y rojo quedan RESERVADOS para los estados de riesgo, de modo que un
 * color nunca es decorativo: siempre significa algo.
 */

const MARCA = {
  marfil: '#F7F2E9',
  papel: '#FFFDF9',
  grafito: '#232327',
  grafitoSuave: '#5C5C63',
  bronce: '#A87C3E',
  bronceClaro: '#D8BF99',
  verde: '#2F7D5D',
  ambar: '#B07A18',
  rojo: '#B3372B',
  linea: '#E3DACA',
  grisClaro: '#F1ECE2',
}

const RIESGO_COLOR = { alta: MARCA.rojo, media: MARCA.ambar, baja: MARCA.verde }

/**
 * Símbolo de marca (espiral de puntos) incrustado: el informe se imprime
 * solo, sin imágenes externas que el navegador del usuario tendría que
 * descargar. Es el mismo símbolo de frontend/assets/logo-ink.svg.
 */
const SIMBOLO_MARCA = `<svg class="marca-simbolo" viewBox="52 8 350 216" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="JMV Consultores">
  <g fill="#8a5a2b">
    <circle cx="392" cy="128" r="30"/><circle cx="368" cy="82" r="24"/><circle cx="330" cy="50" r="18"/>
    <circle cx="286" cy="34" r="13"/><circle cx="244" cy="36" r="9"/><circle cx="322" cy="96" r="10"/><circle cx="298" cy="130" r="7"/>
  </g>
  <g fill="#c2a077">
    <circle cx="128" cy="150" r="32"/><circle cx="172" cy="188" r="24"/><circle cx="222" cy="206" r="17"/>
    <circle cx="268" cy="208" r="11"/><circle cx="306" cy="196" r="7"/><circle cx="168" cy="120" r="12"/><circle cx="212" cy="102" r="8"/>
  </g>
</svg>`

// ============================================================
// UTILIDADES DE FORMATO
// ============================================================

function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function num(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-CL', { maximumFractionDigits: 0 })
}

/** Monto en pesos chilenos: $1.234.567 */
function clp(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `$${num(n)}`
}

/**
 * Monto compacto en millones: $1,2 MM.
 *
 * La unidad es SIEMPRE millones: un monto de miles de millones se imprime
 * «$3.000,0 MM» (3.000 millones), nunca «$3,0 MM» — dividir otra vez por mil
 * hacía que el informe mostrara un valor mil veces menor al real.
 */
function mm(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n) / 1000000
  return `$${v.toLocaleString('es-CL', { maximumFractionDigits: 1 })} MM`
}

/** Monto de boletas: compacto en millones si es grande, exacto si es menor. */
function montoBhe(n) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return Math.abs(v) >= 1000000 ? mm(v) : clp(v)
}

/**
 * Monto con puntos de corte SOLO tras un separador de miles: si la celda es
 * angosta, el número se parte en «$123.456.» / «789.012» en vez de cortarse a
 * media cifra. Devuelve HTML (solo para montos del renderer).
 */
function clpPartible(n) {
  // clp() no usa decimales, así que cada punto es un separador de miles.
  return esc(clp(n)).replace(/\./g, '.<wbr>')
}

function pct(n, decimales = 1) {
  if (n == null || Number.isNaN(Number(n))) return '—'
  return `${Number(n).toLocaleString('es-CL', { maximumFractionDigits: decimales })}%`
}

function fechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fechaLarga(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' })
}

function idInforme(informe) {
  const emp = informe?.empresa?.id ?? 'x'
  const per = informe?.periodo ?? '000000'
  const gen = (informe?.generado_en || '').replace(/\D/g, '').slice(0, 14) || '0'
  return `JMV-TH-${emp}-${per}-${gen}`
}

function nivelColor(nivel) {
  const s = String(nivel || '').toUpperCase()
  if (s === 'AL_DIA') return MARCA.verde
  if (s === 'CON_OBSERVACIONES') return MARCA.ambar
  if (s === 'REQUIERE_REVISION') return MARCA.rojo
  return MARCA.grafitoSuave
}

function severidadColor(sev) {
  return RIESGO_COLOR[String(sev || '').toLowerCase()] || MARCA.grafitoSuave
}

// ============================================================
// GRÁFICOS SVG (compartidos con el panel)
// ============================================================

const W = 720

const MES_ABREV = {
  enero: 'ene', febrero: 'feb', marzo: 'mar', abril: 'abr', mayo: 'may', junio: 'jun',
  julio: 'jul', agosto: 'ago', septiembre: 'sep', octubre: 'oct', noviembre: 'nov', diciembre: 'dic',
}

/**
 * Etiqueta del eje X. Con muchos períodos el nombre completo («noviembre
 * 2025») se solapa con el vecino y el eje queda ilegible: con más de 6
 * puntos se abrevia a «nov 25». El nombre completo sigue disponible en el
 * tooltip de cada barra y en las tablas del informe.
 */
function etiquetaEje(nombre, cantidad) {
  const completo = String(nombre || '')
  if (!completo || cantidad <= 6) return completo
  const partes = completo.split(' ')
  const mes = String(partes[0] || '').toLowerCase()
  const abrev = MES_ABREV[mes] || mes.slice(0, 3)
  const anio = String(partes[1] || '').slice(2)
  return anio ? `${abrev} ${anio}` : abrev
}

/**
 * Gráfico 1 — Evolución mensual del IVA: débito fiscal, crédito fiscal e
 * IVA determinado (todo desde el RCV ingerido).
 */
function svgIva(mensuales) {
  const datos = (mensuales || []).filter((m) => m.estado === 'con_datos')
  if (datos.length < 2) return svgVacio('Sin suficientes períodos con datos para graficar el IVA.')
  const H = 260
  const pad = { t: 24, r: 16, b: 46, l: 66 }
  const ancho = W - pad.l - pad.r
  const alto = H - pad.t - pad.b
  const max = Math.max(1, ...datos.map((m) => Math.max(m.ventas_iva || 0, m.compras_iva || 0, m.iva_estimado || 0)))
  const paso = ancho / datos.length
  const gw = Math.min(16, Math.max(5, paso / 3.4))
  const y = (v) => pad.t + alto - (v / max) * alto

  const barras = datos.map((m, i) => {
    const x = pad.l + i * paso + (paso - gw * 3 - 4) / 2
    const d = y(m.ventas_iva || 0)
    const c = y(m.compras_iva || 0)
    const det = y(m.iva_estimado || 0)
    return `<g>
      <rect x="${(x).toFixed(1)}" y="${d.toFixed(1)}" width="${gw.toFixed(1)}" height="${Math.max(0, pad.t + alto - d).toFixed(1)}" fill="${MARCA.bronce}" opacity="0.9"><title>${esc(m.nombre)} · débito fiscal ${clp(m.ventas_iva)}</title></rect>
      <rect x="${(x + gw + 2).toFixed(1)}" y="${c.toFixed(1)}" width="${gw.toFixed(1)}" height="${Math.max(0, pad.t + alto - c).toFixed(1)}" fill="${MARCA.bronceClaro}"><title>${esc(m.nombre)} · crédito fiscal ${clp(m.compras_iva)}</title></rect>
      <circle cx="${(x + gw + 2 + gw / 2).toFixed(1)}" cy="${det.toFixed(1)}" r="3.2" fill="${MARCA.grafito}"><title>${esc(m.nombre)} · IVA determinado ${clp(m.iva_estimado)}</title></circle>
      <text x="${(pad.l + i * paso + paso / 2).toFixed(1)}" y="${H - 26}" text-anchor="middle" font-size="10" fill="${MARCA.grafitoSuave}">${esc(etiquetaEje(m.nombre, datos.length))}</text>
    </g>`
  }).join('')

  const lineas = datos.map((m, i) => `${i === 0 ? 'M' : 'L'}${(pad.l + i * paso + paso / 2).toFixed(1)} ${y(m.iva_estimado || 0).toFixed(1)}`).join(' ')

  const eje = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = max * f
    return `<g><line x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${W - pad.r}" y2="${y(v).toFixed(1)}" stroke="${MARCA.linea}" stroke-width="1"/><text x="${pad.l - 8}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${MARCA.grafitoSuave}">${mm(v)}</text></g>`
  }).join('')

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución mensual del IVA" class="gfx">
    ${eje}
    ${barras}
    <path d="${lineas}" fill="none" stroke="${MARCA.grafito}" stroke-width="1.6" stroke-dasharray="4 3"/>
    <g transform="translate(${pad.l},${H - 8})" font-size="10" fill="${MARCA.grafitoSuave}">
      <rect x="0" y="-9" width="9" height="9" fill="${MARCA.bronce}"/><text x="14" y="0">Débito fiscal</text>
      <rect x="96" y="-9" width="9" height="9" fill="${MARCA.bronceClaro}"/><text x="110" y="0">Crédito fiscal</text>
      <line x1="200" y1="-5" x2="216" y2="-5" stroke="${MARCA.grafito}" stroke-dasharray="4 3"/><text x="222" y="0">IVA determinado</text>
    </g>
  </svg>`
}

/**
 * Gráfico 2 — Distribución de riesgos por severidad (conteo e importes).
 */
function svgRiesgos(matriz) {
  const filas = matriz || []
  if (!filas.length) return svgVacio('No hay riesgos identificados en la ventana analizada.')
  const grupos = { alta: [], media: [], baja: [] }
  for (const r of filas) {
    const s = String(r.severidad || 'baja').toLowerCase()
    ;(grupos[s] || grupos.baja).push(r)
  }
  const H = 190
  const pad = { t: 20, r: 90, b: 34, l: 84 }
  const ancho = W - pad.l - pad.r
  const alto = H - pad.t - pad.b
  const max = Math.max(1, ...Object.values(grupos).map((g) => g.length))
  const altoBarra = Math.min(40, alto / 3 - 14)
  const etiquetas = { alta: 'Alto', media: 'Medio', baja: 'Bajo' }
  const filas2 = ['alta', 'media', 'baja'].map((k, i) => {
    const g = grupos[k] || []
    const suma = g.reduce((s, r) => s + (Number(r.importe) || 0), 0)
    const y = pad.t + i * (altoBarra + 14)
    const w = g.length ? Math.max(4, (g.length / max) * ancho) : 0
    return `<g>
      <text x="${pad.l - 10}" y="${(y + altoBarra / 2 + 4).toFixed(1)}" text-anchor="end" font-size="12" fill="${MARCA.grafito}">${etiquetas[k]}</text>
      ${w ? `<rect x="${pad.l}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${altoBarra}" rx="4" fill="${RIESGO_COLOR[k]}" opacity="0.88"><title>${g.length} hallazgo(s) · ${clp(suma)}</title></rect>` : ''}
      <text x="${(pad.l + w + 8).toFixed(1)}" y="${(y + altoBarra / 2 + 4).toFixed(1)}" font-size="11" fill="${MARCA.grafitoSuave}">${g.length} hallazgo(s)${suma ? ` · ${mm(suma)}` : ''}</text>
    </g>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribución de riesgos por severidad" class="gfx">${filas2}</svg>`
}

/**
 * Gráfico 3 — Calendario de cumplimiento (12 meses, revisada vs cumplida).
 *
 * La abreviatura de cada celda se deriva del PERÍODO real (AAAAMM), no de la
 * posición en la grilla: antes se rotulaba ENE, FEB, MAR… por índice, así que
 * una ventana que arranca en noviembre mostraba «ENE / noviembre 2024». Y se
 * muestran los 12 meses MÁS RECIENTES (no los primeros de la lista): un
 * calendario de cumplimiento que arranca por el período más antiguo oculta
 * el estado actual, que es lo que el lector necesita.
 */
function svgCalendario(calendario) {
  const ABBREV = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
  const datos = (calendario || []).slice(-12)
  if (!datos.length) return svgVacio('Sin períodos evaluados: no hay calendario de cumplimiento que mostrar.')
  const cols = 6
  const filas = Math.ceil(datos.length / cols)
  const H = filas * 74 + 12
  const cw = W / cols
  const ch = 74
  const celdas = datos.map((d, i) => {
    const revisada = d?.revisada
    const cumplida = d?.cumplida
    const bg = !revisada ? MARCA.grisClaro : cumplida ? '#E7F0EA' : '#F7E4E1'
    const borde = !revisada ? MARCA.linea : cumplida ? MARCA.verde : MARCA.rojo
    const x = (i % cols) * cw + 6
    const y = Math.floor(i / cols) * ch + 6
    const glifo = !revisada ? '?' : cumplida ? '✓' : '!'
    const color = !revisada ? MARCA.grafitoSuave : cumplida ? MARCA.verde : MARCA.rojo
    // La abreviatura sale del período real del dato; sin período no se inventa.
    const mesNum = d?.periodo ? Number(String(d.periodo).slice(4, 6)) : null
    const abrev = mesNum >= 1 && mesNum <= 12 ? ABBREV[mesNum - 1] : '—'
    const det = d ? `${d.nombre}: ${cumplida ? 'declarado' : revisada ? 'pendiente' : 'no consultado'}` : 'no evaluado'
    return `<g><rect x="${x}" y="${y}" width="${cw - 12}" height="${ch - 12}" rx="8" fill="${bg}" stroke="${borde}" stroke-width="1.2"><title>${esc(det)}</title></rect>
      <text x="${x + 12}" y="${y + 22}" font-size="11" font-weight="700" fill="${MARCA.grafito}">${abrev}</text>
      <text x="${x + cw - 24}" y="${y + 24}" font-size="15" font-weight="700" fill="${color}" text-anchor="middle">${glifo}</text>
      ${d ? `<text x="${x + 12}" y="${y + 44}" font-size="10" fill="${MARCA.grafitoSuave}">${esc(d.nombre)}</text>` : `<text x="${x + 12}" y="${y + 44}" font-size="10" fill="${MARCA.grafitoSuave}">sin datos</text>`}
    </g>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Calendario de cumplimiento" class="gfx">${celdas}</svg>`
}

/**
 * Gráfico 4 — Exposición por materia (suma de importes, sin duplicidad).
 */
function svgExposicion(matriz) {
  const porMateria = new Map()
  for (const r of matriz || []) {
    // Solo suma al total la exposición CUANTIFICADA en pesos de impuesto: la
    // diferencia de ventas es un diagnóstico en pesos brutos y mezclarla en el
    // gráfico haría que el gráfico no cuadrara con el total del informe.
    if (r.cuenta_exposicion === false) continue
    const m = r.materia || 'Otras'
    porMateria.set(m, (porMateria.get(m) || 0) + (Number(r.importe) || 0))
  }
  const datos = [...porMateria.entries()].sort((a, b) => b[1] - a[1])
  if (!datos.length) return svgVacio('Sin exposición cuantificada: no hay contingencias identificadas.')
  const H = Math.max(140, datos.length * 42 + 30)
  const pad = { t: 16, r: 110, b: 20, l: 150 }
  const ancho = W - pad.l - pad.r
  const max = Math.max(1, ...datos.map((d) => d[1]))
  const barras = datos.map(([materia, valor], i) => {
    const y = pad.t + i * 42
    const w = valor ? Math.max(3, (valor / max) * ancho) : 0
    return `<g>
      <text x="${pad.l - 10}" y="${(y + 20).toFixed(1)}" text-anchor="end" font-size="12" fill="${MARCA.grafito}">${esc(materia)}</text>
      <rect x="${pad.l}" y="${y}" width="${w.toFixed(1)}" height="26" rx="4" fill="${MARCA.bronce}" opacity="0.9"><title>${esc(materia)}: ${clp(valor)}</title></rect>
      <text x="${(pad.l + w + 8).toFixed(1)}" y="${(y + 19).toFixed(1)}" font-size="11" fill="${MARCA.grafitoSuave}">${mm(valor)}</text>
    </g>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Exposición tributaria por materia" class="gfx">${barras}</svg>`
}

/**
 * Parte un rótulo en 2 líneas equilibradas. Repartir «palabras» a mano dejaba
 * líneas de un solo paréntesis pegadas a la anterior (texto superpuesto) y
 * otras de 4 palabras; aquí se equilibra minimizando la línea más larga.
 */
function partirEtiqueta(texto, maxLineas = 2) {
  const palabras = String(texto || '').split(' ').filter(Boolean)
  if (palabras.length <= 1) return [palabras.join(' '), '']
  if (maxLineas < 2) return [palabras.join(' '), '']
  let mejor = null
  for (let corte = 1; corte < palabras.length; corte++) {
    const a = palabras.slice(0, corte).join(' ')
    const b = palabras.slice(corte).join(' ')
    const largo = Math.max(a.length, b.length)
    if (!mejor || largo < mejor.largo) mejor = { a, b, largo }
  }
  return [mejor.a, mejor.b]
}

/**
 * Gráfico 5 — Puente de conciliación (waterfall) del IVA declarado.
 */
function svgPuente(declarado, estimados) {
  const d = declarado || {}
  const hayDeclarado = Number(d.total_a_pagar) > 0 || Number(d.iva_determinado) > 0
  const base = hayDeclarado
    ? [
      { label: 'Débito fiscal declarado', valor: Number(d.total_debitos) || 0, tipo: 'suma' },
      { label: 'Menos crédito fiscal validado', valor: -(Number(d.total_creditos) || 0), tipo: 'resta' },
      { label: 'Impuesto determinado', valor: Number(d.iva_determinado) || 0, tipo: 'total' },
      { label: 'PPM neto', valor: Number(d.ppm_neto) || 0, tipo: 'suma' },
      { label: 'Total declarado a pagar', valor: Number(d.total_a_pagar) || 0, tipo: 'total' },
    ]
    : [
      { label: 'Débito fiscal (RCV)', valor: Number(estimados?.ventas_iva) || 0, tipo: 'suma' },
      { label: 'Menos crédito fiscal (RCV)', valor: -(Number(estimados?.compras_iva) || 0), tipo: 'resta' },
      { label: 'IVA determinado estimado', valor: Number(estimados?.iva) || 0, tipo: 'total' },
      { label: 'PPM estimado', valor: Number(estimados?.ppm) || 0, tipo: 'suma' },
      { label: 'Total F29 estimado', valor: Number(estimados?.total) || 0, tipo: 'total' },
    ]
  const H = 262
  const pad = { t: 24, r: 16, b: 76, l: 66 }
  const ancho = W - pad.l - pad.r
  const alto = H - pad.t - pad.b
  const max = Math.max(1, ...base.map((b) => Math.abs(b.valor)))
  const paso = ancho / base.length
  const bw = Math.min(74, paso - 22)
  const y = (v) => pad.t + alto - (v / max) * alto

  let acumulado = 0
  const barras = base.map((b, i) => {
    const x = pad.l + i * paso + (paso - bw) / 2
    const y0 = y(acumulado)
    const y1 = y(acumulado + b.valor)
    const top = Math.min(y0, y1)
    const h = Math.max(2, Math.abs(y1 - y0))
    const color = b.tipo === 'total' ? MARCA.grafito : b.valor < 0 ? MARCA.bronceClaro : MARCA.bronce
    if (b.tipo !== 'total') acumulado += b.valor
    const [linea1, linea2] = partirEtiqueta(b.label, 2)
    const largo = Math.max(linea1.length, linea2.length)
    const fs = largo > 20 ? 8 : largo > 16 ? 8.8 : 9.5
    return `<g>
      <rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" opacity="0.9"><title>${esc(b.label)}: ${clp(b.valor)}</title></rect>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(top - 6).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${MARCA.grafito}">${mm(Math.abs(b.valor))}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 48}" text-anchor="middle" font-size="${fs}" fill="${MARCA.grafitoSuave}">${esc(linea1)}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${H - 36}" text-anchor="middle" font-size="${fs}" fill="${MARCA.grafitoSuave}">${esc(linea2)}</text>
    </g>`
  }).join('')

  const eje = [0, 0.5, 1].map((f) => {
    const v = max * f
    return `<line x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${W - pad.r}" y2="${y(v).toFixed(1)}" stroke="${MARCA.linea}"/><text x="${pad.l - 8}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${MARCA.grafitoSuave}">${mm(v)}</text>`
  }).join('')

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Puente de conciliación del IVA" class="gfx">${eje}${barras}</svg>`
}

/**
 * Gráfico 6 — Índice de salud: indicador de arco + desglose por dimensión.
 */
function svgIndice(opinion) {
  const score = Number(opinion?.score) || 0
  const evaluable = opinion?.indice_evaluable !== false
  const dims = opinion?.dimensiones || []
  const H = dims.length ? 210 : 170
  const R = 62
  const cx = 110
  const cy = 105
  const pct = Math.max(0, Math.min(100, score))
  const ang = (pct / 100) * Math.PI * 2 - Math.PI / 2
  const largo = R - 14
  const x = cx + Math.cos(ang) * largo
  const y = cy + Math.sin(ang) * largo
  const color = evaluable ? nivelColor(opinion?.nivel) : MARCA.grafitoSuave
  const circ = 2 * Math.PI * largo
  const dash = evaluable ? (pct / 100) * circ : 0

  const gauge = `<g>
    <circle cx="${cx}" cy="${cy}" r="${largo}" fill="none" stroke="${MARCA.linea}" stroke-width="12"/>
    <circle cx="${cx}" cy="${cy}" r="${largo}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="30" font-weight="700" fill="${MARCA.grafito}">${evaluable ? score : '—'}</text>
    <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="10" fill="${MARCA.grafitoSuave}">${evaluable ? 'de 100' : 'no evaluable'}</text>
  </g>`

  const lista = dims.map((d, i) => {
    const y0 = 26 + i * 32
    const w = Math.max(2, ((Number(d.puntaje) || 0) / 100) * 380)
    const c = d.estado === 'evaluable' ? nivelColor(d.nivel) : MARCA.grafitoSuave
    // El peso viene como fracción (0.25 = 25 % del índice): mostrarlo crudo
    // imprimía «0.25%», que se lee como un weighting mil veces menor.
    const pesoPct = Math.round((Number(d.peso) || 0) * 100)
    return `<g>
      <text x="230" y="${y0}" font-size="11.5" fill="${MARCA.grafito}">${esc(d.nombre)} <tspan fill="${MARCA.grafitoSuave}">(${pesoPct}%)</tspan></text>
      <rect x="230" y="${y0 + 6}" width="380" height="9" rx="4" fill="${MARCA.grisClaro}"/>
      <rect x="230" y="${y0 + 6}" width="${w.toFixed(1)}" height="9" rx="4" fill="${c}" opacity="0.9"/>
      <text x="618" y="${y0 + 15}" font-size="11" font-weight="700" fill="${c}">${d.estado === 'evaluable' ? d.puntaje : 'n/e'}</text>
    </g>`
  }).join('')

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Índice de salud tributaria por dimensión" class="gfx">${gauge}${lista}</svg>`
}

/** Gráfico 7 — Tendencia mensual de ventas e IVA. */
function svgTendencia(serie) {
  const datos = (serie || []).filter((s) => s.estado === 'con_datos')
  if (datos.length < 2) return svgVacio('Sin suficientes períodos con datos para graficar la tendencia.')
  const H = 240
  const pad = { t: 22, r: 16, b: 40, l: 66 }
  const ancho = W - pad.l - pad.r
  const alto = H - pad.t - pad.b
  const max = Math.max(1, ...datos.map((d) => Math.max(d.ventas || 0, d.iva || 0)))
  const paso = ancho / datos.length
  const y = (v) => pad.t + alto - (v / max) * alto
  const linea = (key) => datos.map((d, i) => `${i === 0 ? 'M' : 'L'}${(pad.l + i * paso + paso / 2).toFixed(1)} ${y(d[key] || 0).toFixed(1)}`).join(' ')
  const puntos = (key, color) => datos.map((d, i) => `<circle cx="${(pad.l + i * paso + paso / 2).toFixed(1)}" cy="${y(d[key] || 0).toFixed(1)}" r="3" fill="${color}"><title>${esc(d.nombre)}: ${clp(d[key])}</title></circle>`).join('')
  const eje = [0, 0.5, 1].map((f) => {
    const v = max * f
    return `<line x1="${pad.l}" y1="${y(v).toFixed(1)}" x2="${W - pad.r}" y2="${y(v).toFixed(1)}" stroke="${MARCA.linea}"/><text x="${pad.l - 8}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${MARCA.grafitoSuave}">${mm(v)}</text>`
  }).join('')
  const etiquetas = datos.map((d, i) => `<text x="${(pad.l + i * paso + paso / 2).toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="9.5" fill="${MARCA.grafitoSuave}">${esc(etiquetaEje(d.nombre, datos.length))}</text>`).join('')
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tendencia mensual de ventas e IVA" class="gfx">
    ${eje}
    <path d="${linea('ventas')}" fill="none" stroke="${MARCA.bronce}" stroke-width="2"/>
    ${puntos('ventas', MARCA.bronce)}
    <path d="${linea('iva')}" fill="none" stroke="${MARCA.grafito}" stroke-width="1.6" stroke-dasharray="4 3"/>
    ${puntos('iva', MARCA.grafito)}
    ${etiquetas}
  </svg>`
}

function svgVacio(mensaje) {
  return `<svg viewBox="0 0 ${W} 90" role="img" class="gfx"><rect x="0" y="0" width="${W}" height="90" rx="8" fill="${MARCA.grisClaro}"/><text x="${W / 2}" y="50" text-anchor="middle" font-size="12" fill="${MARCA.grafitoSuave}">${esc(mensaje)}</text></svg>`
}

/** Todos los gráficos del informe, listos para inyectar (HTML o panel). */
function graficosSvg(informe) {
  const op = informe?.opinion || {}
  const kpis = informe?.kpis || {}
  const meses = informe?.mensuales || []
  const conDatos = meses.filter((m) => m.estado === 'con_datos')
  const ultimo = conDatos[conDatos.length - 1] || null
  return {
    indice: svgIndice(op),
    iva: svgIva(meses),
    riesgos: svgRiesgos(op.matriz_riesgos),
    calendario: svgCalendario(op.calendario),
    exposicion: svgExposicion(op.matriz_riesgos),
    puente: svgPuente(kpis.declarado, ultimo
      ? { ventas_iva: ultimo.ventas_iva, compras_iva: ultimo.compras_iva, iva: ultimo.iva_estimado, ppm: ultimo.ppm_estimado, total: ultimo.f29_estimado }
      : null),
    tendencia: svgTendencia(informe?.serie),
  }
}

// ============================================================
// BLOQUES DE CONTENIDO
// ============================================================

function tablaKpiPortada(informe) {
  const op = informe?.opinion || {}
  const kpis = informe?.kpis || {}
  const exp = op.exposicion || { total: 0 }
  const cumplidos = (op.calendario || []).filter((c) => c.cumplida).length
  const revisados = (op.calendario || []).filter((c) => c.revisada).length
  const acciones = (op.plan_accion || []).length
  const alertasAltas = (op.hallazgos || []).filter((h) => h.severidad === 'alta').length
  const tarjetas = [
    { k: 'Índice de salud tributaria', v: op.indice_evaluable === false ? 'No evaluable' : `${op.score}/100`, s: op.clasificacion?.titulo || op.titulo || '—' },
    { k: 'Obligaciones revisadas', v: `${cumplidos}/${revisados}`, s: 'períodos con declaración vigente' },
    { k: 'Alertas críticas', v: String(alertasAltas), s: 'severidad alta sin resolver' },
    { k: 'Exposición cuantificada', v: mm(exp.total || 0), s: 'sin duplicidad de conceptos' },
    { k: 'Acciones prioritarias', v: String(acciones), s: 'en el plan de acción' },
    { k: 'Cobertura del diagnóstico', v: pct(op.cobertura_diagnostico), s: `confianza: ${op.nivel_confianza || '—'}` },
  ]
  return `<div class="kpi-grid">${tarjetas.map((t) => `
    <div class="kpi-card">
      <div class="kpi-k">${esc(t.k)}</div>
      <div class="kpi-v">${esc(t.v)}</div>
      <div class="kpi-s">${esc(t.s)}</div>
    </div>`).join('')}</div>`
}

/** Resumen de un tipo de declaración (F29 / F22 / BHE / DJ). */
function bloqueDeclaraciones(res, titulo, nota) {
  if (!res || res.estado === 'no_consultado') {
    return `<div class="decl-bloque"><h3>${esc(titulo)}</h3>
      <p class="nota">${esc(nota || '')}</p>
      <p class="nota"><span class="chip">No consultada</span> ${esc(res?.detalle || 'Sin consulta registrada: la existencia de estas declaraciones no está verificada.')}</p></div>`
  }
  // Antes era una tabla de 5 columnas dentro de una columna de ~294 px: su
  // ancho mínimo (379 px) desbordaba el papel 131 px al imprimir. Ahora son
  // fichas (etiqueta + valor) que fluyen con el ancho disponible.
  const rango = res.desde || res.hasta ? `${esc(res.desde || '—')} – ${esc(res.hasta || '—')}` : '—'
  return `<div class="decl-bloque"><h3>${esc(titulo)}</h3>
    <p class="nota">${esc(nota || '')}</p>
    <p class="nota">${esc(res.etiqueta || '')}${res.etiqueta && res.detalle ? ' · ' : ''}${esc(res.detalle || '')}</p>
    <dl class="decl-stats">
      <div><dt>Consultadas</dt><dd>${res.consultadas ?? '—'}</dd></div>
      <div><dt>Declaradas</dt><dd>${res.declaradas ?? '—'}</dd></div>
      <div><dt>Pendientes</dt><dd>${res.pendientes ?? '—'}</dd></div>
      <div><dt>Rango real</dt><dd>${rango}</dd></div>
      <div><dt>Última consulta</dt><dd>${esc(fechaCorta(res.ultima_consulta))}</dd></div>
    </dl></div>`
}

/**
 * Resumen de UN lado de las boletas de honorarios (emitidas o recibidas).
 *
 * El sincronizador guarda un OBJETO `{ meses: [...], totales: {...} }`, no un
 * número: imprimirlo crudo en el informe salía como «[object Object]». Aquí se
 * traduce a lo que el informe muestra (conteo de boletas vigentes y monto
 * bruto) y, si el SII no entregó ese lado, se declara ausente con «—».
 */
function resumenBoletas(lado) {
  if (lado == null) return null
  if (typeof lado === 'number') return { conteo: null, bruto: Number(lado) }
  const totales = lado.totales || null
  const meses = Array.isArray(lado.meses) ? lado.meses : []
  const suma = (campo) => meses.reduce((s, m) => s + (Number(m && m[campo]) || 0), 0)
  const conteo = totales && totales.vigentes != null ? Number(totales.vigentes)
    : (meses.length ? suma('vigentes') : null)
  const bruto = totales && totales.honorario_bruto != null ? Number(totales.honorario_bruto)
    : (meses.length ? suma('honorario_bruto') : null)
  return {
    conteo: Number.isFinite(conteo) ? conteo : null,
    bruto: Number.isFinite(bruto) ? bruto : null,
  }
}

/** Celda de boletas: «12 bol. · $1,2 MM» (solo lo que hay, o «—»). */
function celdaBoletas(b) {
  if (!b) return '—'
  const partes = []
  if (b.conteo != null) partes.push(`${b.conteo} bol.`)
  if (b.bruto != null) partes.push(montoBhe(b.bruto))
  return partes.length ? partes.join(' · ') : '—'
}

/** Tooltip con el detalle de las boletas de un lado. */
function detalleBoletas(b, etiqueta) {
  if (!b) return `${etiqueta}: sin datos`
  const partes = []
  if (b.conteo != null) partes.push(`${b.conteo} boleta(s) vigentes`)
  if (b.bruto != null) partes.push(`bruto ${clp(b.bruto)}`)
  return `${etiqueta}: ${partes.length ? partes.join(' · ') : 'sin datos'}`
}

/** Tabla de declaraciones anuales (F22, BHE) leídas del SII. */
function tablaDeclaracionesAnuales(anuales) {
  const filas = (anuales?.anios || []).filter((a) => a.f22 || a.boletas_honorarios)
  if (!filas.length) return '<p class="nota">Sin declaraciones anuales consultadas en el SII.</p>'
  return `<table class="tabla tabla-anuales">
    <thead><tr>
      <th style="width:7%">Año</th><th style="width:15%">F22</th><th style="width:11%">Presentada</th>
      <th style="width:15%" class="der">Monto declarado</th><th style="width:32%">Honorarios (emitidos / recibidos)</th>
      <th style="width:20%">RCV del año</th>
    </tr></thead>
    <tbody>${filas.map((a) => {
    const bh = a.boletas_honorarios || null
    const emitidas = resumenBoletas(bh?.emitidas)
    const recibidas = resumenBoletas(bh?.recibidas)
    return `
      <tr>
        <td>${esc(a.anio)}</td>
        <td><span class="chip chip-${String(a.f22?.estado || 'sin_informacion').toLowerCase()}">${esc(a.f22?.etiqueta || 'Sin información')}</span></td>
        <td>${esc(fechaCorta(a.f22?.fecha_presentacion))}</td>
        <td class="der">${a.f22?.monto_total == null ? '—' : clpPartible(a.f22.monto_total)}</td>
        <td title="${esc(detalleBoletas(emitidas, 'Emitidas'))} · ${esc(detalleBoletas(recibidas, 'Recibidas'))}">${celdaBoletas(emitidas)} / ${celdaBoletas(recibidas)}</td>
        <td>${a.rcv ? `${mm(a.rcv.ventas_neto)} · ${a.rcv.meses_con_datos} mes(es)` : '—'}</td>
      </tr>`
  }).join('')}</tbody>
  </table>`
}

function tablaMensual(mensuales) {
  if (!mensuales?.length) return '<p class="nota">Sin períodos analizados.</p>'
  // Nueve columnas no caben en los 608 px útiles de A4: la tabla se fija con
  // anchos en porcentaje (suma 100 %) y los montos se parten SOLO tras el
  // separador de miles, para que nunca se corte a media cifra ni desborde.
  return `<table class="tabla tabla-mensual">
    <thead><tr>
      <th style="width:13%">Período</th><th style="width:11%" class="der">Ventas netas</th>
      <th style="width:11%" class="der">Débito fiscal</th><th style="width:11%" class="der">Crédito fiscal</th>
      <th style="width:9%" class="der">IVA det.</th><th style="width:9%" class="der">PPM</th>
      <th style="width:12%" class="der">F29 declarado</th><th style="width:11%" class="der">Dif. (est. − decl.)</th>
      <th style="width:13%">Estado F29</th>
    </tr></thead>
    <tbody>${mensuales.map((m) => {
    // La diferencia es la MISMA que usa el capítulo 1 y el MANUAL: estimado
    // (RCV) − declarado (SII). Antes se tomaba `comparacion.diferencia_total`,
    // que solo existe cuando hay Formulario Compacto (casi nunca): la columna
    // quedaba en «—» mientras el informe reportaba diferencias.
    const dif = m.f29_diferencia
    // Sin RCV ingerido NO hay estimación posible: mostrar $0 affirmaría que
    // la empresa no vendió nada, cuando en realidad el dato no está. Es la
    // misma regla del informe: lo no verificado nunca se muestra como cero.
    // («sin_movimiento» sí es un cero verificado: el SII confirmó que no hubo
    // movimiento en ese período.)
    const sinRcv = m.estado === 'sin_datos'
    const est = (n) => (sinRcv ? '—' : clpPartible(n))
    return `<tr>
      <td>${esc(m.nombre)}</td>
      <td class="der">${est(m.ventas_neto)}</td>
      <td class="der">${est(m.ventas_iva)}</td>
      <td class="der">${est(m.compras_iva)}</td>
      <td class="der">${est(m.iva_estimado)}</td>
      <td class="der">${est(m.ppm_estimado)}</td>
      <td class="der">${m.f29_oficial?.monto_total == null ? '—' : clpPartible(m.f29_oficial.monto_total)}</td>
      <td class="der ${dif == null ? '' : (Math.abs(dif) >= 1000 ? 'dif-alerta' : 'dif-ok')}">${dif == null ? '—' : clpPartible(dif)}</td>
      <td>${esc(m.f29_oficial?.etiqueta || 'No consultado')}</td>
    </tr>`
  }).join('')}</tbody>
  </table>`
}

function tablaMatrizRiesgos(matriz) {
  if (!matriz?.length) return '<p class="nota">No se identificaron riesgos con exposición cuantificada en la ventana analizada.</p>'
  // La matriz tiene mucha información por riesgo: en A4 (182mm útiles) nueve
  // columnas no caben y el texto se corta al imprimir. Se agrupan naturaleza,
  // responsable y plazo en una sola columna «Triage» y la tabla se fija con
  // anchos en porcentaje para que NUNCA desborde la caja de impresión.
  return `<table class="tabla tabla-riesgos">
    <thead><tr>
      <th style="width:11%">Severidad</th>
      <th style="width:12%">Materia</th>
      <th style="width:22%">Riesgo</th>
      <th style="width:7%">Período</th>
      <th style="width:12%" class="der">Exposición</th>
      <th style="width:16%">Triage</th>
      <th style="width:20%">Evidencia</th>
    </tr></thead>
    <tbody>${matriz.map((r) => {
    const exp = r.importe ? clp(r.importe) : '—'
    // Las filas que NO suman al total (la diferencia de ventas es un
    // diagnóstico en pesos brutos) lo declaran: sin ese aviso, el lector suma
    // la columna y no llega al total del informe.
    const fuera = r.cuenta_exposicion === false && r.importe
    return `
      <tr>
        <td><span class="chip chip-${String(r.severidad).toLowerCase()}">${esc(String(r.severidad).toUpperCase())}</span></td>
        <td>${esc(r.materia || '—')}</td>
        <td>${esc(r.titulo || r.hallazgo || '—')}</td>
        <td>${esc(r.periodo || '—')}</td>
        <td class="der exposicion${exp.length > 9 ? ' long' : ''}">${r.importe ? clpPartible(r.importe) : '—'}${fuera ? '<span class="fuera-total">no suma al total</span>' : ''}</td>
        <td class="triage">
          <span>${esc(r.naturaleza || '—')}</span>
          <span>${esc(r.responsable || '—')} · ${esc(r.plazo || '—')}</span>
        </td>
        <td class="evid">${esc(r.evidencia || '—')}</td>
      </tr>`
  }).join('')}</tbody>
  </table>`
}

function tablaPlanAccion(plan) {
  if (!plan?.length) return '<p class="nota">Sin acciones pendientes: mantener el control mensual.</p>'
  return `<table class="tabla tabla-plan">
    <thead><tr>
      <th style="width:4%">#</th><th style="width:20%">Acción</th><th style="width:16%">Motivo</th>
      <th style="width:16%">Evidencia de cierre</th><th style="width:11%">Responsable</th>
      <th style="width:8%">Plazo</th><th style="width:13%" class="der">Impacto estimado</th>
      <th style="width:12%">Estado</th>
    </tr></thead>
    <tbody>${plan.map((a, i) => `
      <tr>
        <td>${a.prioridad ?? i + 1}</td>
        <td>${esc(a.accion || '—')}</td>
        <td>${esc(a.motivo || '—')}</td>
        <td>${esc(a.evidencia_requerida || a.evidencia || '—')}</td>
        <td>${esc(a.responsable || '—')}</td>
        <td>${esc(a.plazo || '—')}</td>
        <td class="der">${a.impacto_estimado ? clpPartible(a.impacto_estimado) : '—'}</td>
        <td><span class="chip chip-${a.estado === 'pendiente' ? 'media' : 'baja'}">${esc(a.estado || 'pendiente')}</span></td>
      </tr>`).join('')}</tbody>
  </table>`
}

function listaBloque(items, vacio = 'Sin elementos para este capítulo.') {
  if (!items?.length) return `<p class="nota">${esc(vacio)}</p>`
  return `<ul class="lista">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
}

function bloqueOpinion(op) {
  const p = op?.opinion_profesional || {}
  // Nota de alerta crítica: se muestra siempre que haya alerta de severidad
  // alta, independientemente de la clasificación (SOLIDA, FAVORABLE, ATENCIÓN,
  // RIESGO o CRÍTICA). El cálculo ya está en salud-tributaria.js líneas 1028-1032.
  const alertaCritica = op?.alerta_critica
  const notaAlerta = alertaCritica
    ? op?.clasificacion?.nota || 'Alerta de severidad alta detectada: revisar antes de emitir documentos'
    : ''
  return `
  <div class="opinion">
    ${notaAlerta ? `<p class="opinion-nota" style="color: var(--rojo); border-left: 3px solid var(--rojo); padding: 2px 0 2px 10px; font-weight: 600">${esc(notaAlerta)}</p>` : ''}
    <p class="opinion-lead">${esc(p.conclusion || op?.resumen || '')}</p>
    <div class="opinion-grid">
      <div><h4>Hechos comprobados</h4>${listaBloque(p.hechos, 'Sin hechos comprobables en la ventana analizada.')}</div>
      <div><h4>Diferencias detectadas</h4>${listaBloque(p.diferencias, 'Sin diferencias detectadas.')}</div>
      <div><h4>Riesgos potenciales</h4>${listaBloque(p.riesgos, 'Sin riesgos potenciales identificados.')}</div>
      <div><h4>Recomendación</h4><p class="nota">${esc(p.recomendacion || '')}</p></div>
    </div>
    ${p.advertencias?.length ? `<div class="adv"><h4>Advertencias</h4>${listaBloque(p.advertencias)}</div>` : ''}
  </div>`
}

function capitulo(numero, titulo, contenido) {
  return `<section class="cap">
    <h2><span class="cap-n">${String(numero).padStart(2, '0')}</span> ${esc(titulo)}</h2>
    ${contenido}
  </section>`
}

// ============================================================
// CSS
// ============================================================

function css() {
  return `
  @page { size: A4; margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Sora", "Segoe UI", system-ui, -apple-system, sans-serif;
    color: ${MARCA.grafito};
    background: ${MARCA.marfil};
    font-size: 10.5pt;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  .hoja { max-width: 900px; margin: 0 auto; background: ${MARCA.papel}; padding: 0 0 40px; }
  .gfx { width: 100%; height: auto; display: block; margin: 10px 0 4px; }
  h1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.01em; }
  .portada { padding: 34px 40px 30px; border-bottom: 3px solid ${MARCA.bronce}; }
  .marca-fila { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .marca { display: flex; align-items: center; gap: 10px; }
  .marca-simbolo { width: 54px; height: 34px; }
  .marca-txt { font-size: 10pt; letter-spacing: 0.18em; color: ${MARCA.grafitoSuave}; }
  .marca-txt b { color: ${MARCA.grafito}; font-size: 13pt; letter-spacing: 0.04em; }
  .marca-fila .kicker { font-size: 8.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: ${MARCA.grafitoSuave}; }
  .titulo-informe { font-size: 26pt; line-height: 1.15; margin: 26px 0 6px; }
  .subtitulo-informe { font-size: 11pt; color: ${MARCA.grafitoSuave}; margin: 0 0 22px; }
  .datos-empresa { display: flex; flex-wrap: wrap; gap: 8px 26px; font-size: 9.5pt; color: ${MARCA.grafitoSuave}; border-top: 1px solid ${MARCA.linea}; padding-top: 14px; }
  .datos-empresa b { color: ${MARCA.grafito}; font-weight: 600; }
  .semilla { margin-top: 18px; padding: 12px 14px; background: ${MARCA.grisClaro}; border-left: 3px solid ${MARCA.bronce}; font-size: 9pt; color: ${MARCA.grafitoSuave}; }
  .diagnostico { display: flex; gap: 22px; align-items: center; margin: 18px 0 6px; }
  .diagnostico .puntaje { font-size: 40pt; font-weight: 700; line-height: 1; }
  .diagnostico .estado { font-size: 13pt; font-weight: 600; }
  .diagnostico .meta { font-size: 9pt; color: ${MARCA.grafitoSuave}; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0 10px; }
  .kpi-card { border: 1px solid ${MARCA.linea}; border-radius: 10px; padding: 12px 14px; background: #fff; min-width: 0; }
  .kpi-k { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${MARCA.grafitoSuave}; }
  .kpi-v { font-size: 19pt; font-weight: 700; margin: 4px 0 2px; }
  .kpi-s { font-size: 8.5pt; color: ${MARCA.grafitoSuave}; }
  .hallazgo-prioritario { border: 1px solid ${MARCA.linea}; border-left: 4px solid ${MARCA.rojo}; border-radius: 10px; padding: 14px 16px; margin: 16px 0 6px; background: #fff; }
  .hallazgo-prioritario h4 { margin: 0 0 6px; font-size: 10.5pt; }
  .hallazgo-prioritario p { margin: 0; font-size: 9.5pt; color: ${MARCA.grafitoSuave}; }
  .cap { padding: 26px 40px 6px; border-top: 1px solid ${MARCA.linea}; margin-top: 22px; page-break-inside: auto; }
  .cap:first-of-type { border-top: none; }
  .cap h2 { font-size: 15pt; margin: 0 0 12px; display: flex; align-items: baseline; gap: 10px; }
  .cap-n { font-size: 9pt; color: ${MARCA.bronce}; letter-spacing: 0.1em; }
  .cap h3 { font-size: 11pt; margin: 18px 0 6px; }
  .nota { font-size: 9pt; color: ${MARCA.grafitoSuave}; margin: 6px 0 10px; }
  .tabla { width: 100%; border-collapse: collapse; font-size: 8.8pt; margin: 6px 0 12px; }
  .tabla th { text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; color: ${MARCA.grafitoSuave}; border-bottom: 1px solid ${MARCA.grafitoSuave}; padding: 6px 6px; }
  .tabla td { padding: 6px 6px; border-bottom: 1px solid ${MARCA.linea}; vertical-align: top; }
  .tabla .der { text-align: right; font-variant-numeric: tabular-nums; }
  /* Diferencia estimado − declarado: se marca en rojo cuando es MATERIAL
     (|dif| ≥ $1.000, el mismo umbral con el que el capítulo 1 cuenta
     períodos con diferencia). Antes se usaban clases .neg/.pos que NO
     existían en el CSS: el color nunca se aplicaba. */
  .tabla td.dif-alerta { color: ${MARCA.rojo}; font-weight: 600; }
  .tabla td.dif-ok { color: ${MARCA.grafitoSuave}; }
  .tabla .evid { color: ${MARCA.grafitoSuave}; font-size: 8pt; }
  .tabla tr { page-break-inside: avoid; }
  .tabla-riesgos { table-layout: fixed; }
  /* Nueve columnas (declarado vs. estimado) en A4: ancho fijo por porcentaje
     y montos que solo se parten tras el separador de miles. */
  .tabla-mensual { table-layout: fixed; }
  .tabla-mensual th { font-size: 7.2pt; padding: 6px 3px; letter-spacing: 0.01em; overflow-wrap: anywhere; }
  .tabla-mensual td { padding: 6px 3px; font-size: 8pt; }
  .tabla-mensual td.der { overflow-wrap: normal; word-break: normal; }
  .tabla-mensual td:first-child { font-size: 7.8pt; }
  /* Tablas de 6 y 8 columnas: también ancho fijo por porcentaje. */
  .tabla-anuales, .tabla-plan { table-layout: fixed; }
  .tabla-anuales th, .tabla-plan th { font-size: 7.4pt; padding: 6px 4px; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  .tabla-anuales td, .tabla-plan td { padding: 6px 4px; font-size: 8pt; overflow-wrap: anywhere; }
  .tabla-anuales td.der, .tabla-plan td.der { overflow-wrap: normal; word-break: normal; }
  .tabla-riesgos th { font-size: 7.4pt; padding: 6px 4px; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  .tabla-riesgos td { padding: 6px 4px; overflow-wrap: anywhere; word-break: normal; }
  .tabla-riesgos .triage span { display: block; }
  .tabla-riesgos .triage span + span { color: ${MARCA.grafitoSuave}; font-size: 7.8pt; }
  /* El monto se parte solo en los cortes marcados (separadores de miles),
     nunca a media cifra; si es muy largo baja de cuerpo. */
  .tabla-riesgos .exposicion { font-size: 8pt; overflow-wrap: normal; word-break: normal; }
  .tabla-riesgos .exposicion.long { font-size: 7pt; }
  .tabla-riesgos .fuera-total { display: block; font-size: 6.6pt; color: ${MARCA.grafitoSuave}; font-weight: 400; letter-spacing: 0.02em; }
  .chip { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 7.8pt; font-weight: 600; letter-spacing: 0.04em; border: 1px solid ${MARCA.linea}; color: ${MARCA.grafitoSuave}; }
  .chip-alta, .chip-pendiente, .chip-no_presentada, .chip-rechazada { color: ${MARCA.rojo}; border-color: ${MARCA.rojo}; background: #FBEDEB; }
  .chip-media, .chip-observada, .chip-parcial { color: ${MARCA.ambar}; border-color: ${MARCA.ambar}; background: #FCF3E2; }
  .chip-baja, .chip-declarada, .chip-aceptada, .chip-vigente { color: ${MARCA.verde}; border-color: ${MARCA.verde}; background: #EAF3EE; }
  .lista { margin: 6px 0 12px; padding-left: 18px; }
  .lista li { margin-bottom: 4px; font-size: 9.5pt; }
  .decl-bloque { margin-bottom: 16px; }
  /* Fichas de una declaración: etiqueta arriba, valor abajo. Fluyen con el
     ancho de la columna (una tabla de 5 columnas desbordaba el papel). */
  .decl-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 8px 12px; margin: 8px 0 4px; }
  .decl-stats > div { min-width: 0; border-top: 1px solid ${MARCA.linea}; padding-top: 4px; }
  .decl-stats dt { font-size: 7.2pt; text-transform: uppercase; letter-spacing: 0.06em; color: ${MARCA.grafitoSuave}; }
  .decl-stats dd { margin: 2px 0 0; font-size: 9pt; font-weight: 600; overflow-wrap: anywhere; }
  .opinion { border: 1px solid ${MARCA.linea}; border-radius: 12px; padding: 18px 20px; background: #fff; }
  .opinion-nota { font-size: 9.5pt; color: ${MARCA.rojo}; border-left: 3px solid ${MARCA.rojo}; padding: 2px 0 2px 10px; margin: 0 0 12px; font-weight: 600; }
  .opinion-lead { font-size: 11pt; line-height: 1.6; margin: 0 0 14px; }
  .opinion-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 26px; }
  .opinion-grid > div { min-width: 0; }
  .opinion h4 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${MARCA.bronce}; margin: 0 0 4px; }
  .adv { margin-top: 14px; padding-top: 12px; border-top: 1px dashed ${MARCA.linea}; }
  .idx { columns: 2; column-gap: 30px; font-size: 9.5pt; }
  .idx div { break-inside: avoid; padding: 3px 0; }
  .idx b { color: ${MARCA.bronce}; }
  .final { margin: 30px 40px 0; padding: 24px 26px; background: ${MARCA.marfil}; border: 1px solid ${MARCA.linea}; border-radius: 14px; text-align: center; }
  .final .marca { justify-content: center; margin-bottom: 10px; }
  .final p { font-size: 10pt; margin: 6px 0; }
  .final .firma { margin-top: 14px; font-size: 9pt; color: ${MARCA.grafitoSuave}; }
  .pie { margin: 26px 40px 0; padding-top: 10px; border-top: 1px solid ${MARCA.linea}; font-size: 8pt; color: ${MARCA.grafitoSuave}; display: flex; justify-content: space-between; gap: 12px; }
  /* minmax(0, 1fr): sin esto el ancho mínimo del contenido (min-width:auto)
     ensancha la columna y el bloque se sale del papel. */
  .dos-col { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; }
  .dos-col > div { min-width: 0; }
  @media print {
    body { background: #fff; }
    .hoja { max-width: none; }
    .cap, .final, .portada { page-break-inside: avoid; }
    .tabla thead { display: table-header-group; }
  }`
}

// ============================================================
// RENDER PRINCIPAL
// ============================================================

/**
 * Renderiza el informe ejecutivo completo en HTML.
 * @param {object} informe  objeto devuelto por salud-tributaria.construirInforme
 * @param {object} opts     { logoSvg, marca, titulo, subtitulo, mensajeFinal }
 */
function renderInformeHtml(informe, opts = {}) {
  const op = informe?.opinion || {}
  const gfx = graficosSvg(informe)
  const ident = informe?.identidad || {}
  const emp = informe?.empresa || {}
  const kpis = informe?.kpis || {}
  const tes = informe?.tesoreria || {}
  const idInf = idInforme(informe)
  const color = nivelColor(op.nivel)
  const logoSvg = opts.logoSvg || SIMBOLO_MARCA
  const marca = `<div class="marca" style="text-align: center; margin: var(--space-4) 0;">${logoSvg}<span class="marca-txt" style="font-size: var(--fs-sm);"><b>JMV</b> CONSULTORES</span></div>`

  const hallazgosAltos = (op.hallazgos || []).filter((h) => h.severidad === 'alta')
  const principal = hallazgosAltos[0] || (op.hallazgos || [])[0] || null
  const queCambio = op.que_cambio

  const cap1 = capitulo(1, 'Resumen ejecutivo', `
    ${bloqueOpinion(op)}
    <h3>Hallazgos principales</h3>
    ${(op.hallazgos || []).length ? `<ol class="lista">${op.hallazgos.slice(0, 5).map((h) => `<li><b>${esc(h.titulo)}</b> — ${esc(h.detalle || h.descripcion || '')}</li>`).join('')}</ol>` : '<p class="nota">Sin hallazgos registrados en la ventana analizada.</p>'}
    <h3>Fortalezas verificadas</h3>
    ${listaBloque(op.fortalezas, 'Sin fortalezas verificables con los antecedentes disponibles.')}
    ${queCambio ? `
    <h3>Qué cambió respecto del informe anterior</h3>
    <div class="opinion-grid">
      <div><h4>Alertas nuevas</h4>${(queCambio.alertas_nuevas || []).length ? `<ul class="lista">${queCambio.alertas_nuevas.map((a) => `<li><span class="chip chip-${String(a.severidad || 'media').toLowerCase()}">${esc(String(a.severidad || 'media').toUpperCase())}</span> ${esc(a.titulo || a.codigo || '')}</li>`).join('')}</ul>` : '<p class="nota">Sin alertas nuevas respecto del informe anterior.</p>'}
      ${(queCambio.alertas_resueltas || []).length ? `<h4 style="margin-top:10px">Alertas resueltas</h4><ul class="lista">${queCambio.alertas_resueltas.map((a) => `<li>${esc(a.titulo || a.codigo || '')}</li>`).join('')}</ul>` : ''}</div>
      <div><h4>Índice</h4><p class="nota">Informe anterior: ${queCambio.indice_anterior != null ? `${queCambio.indice_anterior}/100` : 'sin referencia'} · actual: ${op.indice_evaluable === false ? 'no evaluable' : `${op.score}/100`}${queCambio.variacion_indice != null ? ` · variación ${queCambio.variacion_indice > 0 ? '+' : ''}${queCambio.variacion_indice}` : ''}.</p>
      <p class="nota">${esc(queCambio.lectura || '')}</p></div>
    </div>` : ''}
  `)

  const cap2 = capitulo(2, 'Cumplimiento tributario y obligaciones', `
    ${gfx.calendario}
    <p class="nota">Calendario de cumplimiento: los meses no consultados no se cuentan como incumplimientos; los meses futuros no se evalúan.</p>
    <div class="dos-col">
      <div>
        ${bloqueDeclaraciones(informe?.declaraciones?.f29, 'F29 — IVA mensual', `Períodos con RCV en el período analizado: ${informe?.cobertura?.desde || '—'} a ${informe?.cobertura?.hasta || '—'}. El estado del F29 se lee en todo el rango disponible en el SII.`)}
        ${bloqueDeclaraciones(informe?.declaraciones?.juradas, 'Declaraciones juradas', '')}
      </div>
      <div>
        ${bloqueDeclaraciones(informe?.declaraciones?.renta_f22, 'F22 — Renta anual', '')}
        ${bloqueDeclaraciones(informe?.declaraciones?.boletas_honorarios, 'Boletas de honorarios', '')}
      </div>
    </div>
    <h3>Declaraciones anuales (F22 y boletas de honorarios)</h3>
    ${tablaDeclaracionesAnuales(informe?.declaraciones_anuales)}
    <h3>Cobertura del diagnóstico</h3>
    <p class="nota">
      Cobertura: <b>${pct(op.cobertura_diagnostico)}</b> · Nivel de confianza: <b>${esc(op.nivel_confianza || '—')}</b> ·
      Períodos con datos: ${informe?.cobertura?.con_datos ?? '—'} · sin movimiento: ${informe?.cobertura?.sin_movimiento ?? '—'} · sin sincronizar: ${informe?.cobertura?.sin_datos ?? '—'}.
    </p>
  `)

  const cap3 = capitulo(3, 'Análisis del IVA y conciliaciones', `
    ${gfx.iva}
    <p class="nota">Débito y crédito fiscal calculados desde el RCV ingerido; el IVA determinado es una estimación propia y no sustituye la determinación del F29.</p>
    ${gfx.puente}
    <p class="nota">${kpis.declarado?.periodos ? 'Puente construido con casillas del Formulario Compacto del F29 leídas del SII.' : 'Puente construido con estimaciones del RCV: no hay Formulario Compacto del F29 disponible.'}</p>
    <h3>Detalle por período (declarado vs. estimado)</h3>
    ${tablaMensual(informe?.mensuales)}
    <p class="nota">«—» en las columnas estimadas significa que no hay RCV ingerido para ese período: no se estima nada, no se afirma que no hubo movimiento. El monto declarado proviene del SII y se muestra igual.</p>
  `)

  const cap4 = capitulo(4, 'Matriz de riesgos tributarios', `
    ${gfx.riesgos}
    ${gfx.exposicion}
    <p class="nota">Exposición por materia: ${esc(op.exposicion?.nota || '')}</p>
    ${tablaMatrizRiesgos(op.matriz_riesgos)}
  `)

  const cap5 = capitulo(5, 'Tendencias y comportamiento tributario', `
    ${gfx.tendencia}
    <p class="nota">Ventas netas e IVA determinado por período, desde el RCV ingerido.</p>
    ${tablaMensual(informe?.mensuales)}
  `)

  const cap6 = capitulo(6, 'Impacto financiero y proyecciones', `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-k">Ventas del período</div><div class="kpi-v">${mm(kpis.ventas_periodo)}</div><div class="kpi-s">neto, ${informe?.cobertura?.con_datos ?? 0} mes(es) con datos</div></div>
      <div class="kpi-card"><div class="kpi-k">IVA del período</div><div class="kpi-v">${mm(kpis.iva_periodo)}</div><div class="kpi-s">estimado desde RCV</div></div>
      <div class="kpi-card"><div class="kpi-k">PPM del período</div><div class="kpi-v">${mm(kpis.ppm_periodo)}</div><div class="kpi-s">tasa ${pct((Number(kpis.tasa_ppm) || 0) * 100, 2)}</div></div>
      <div class="kpi-card"><div class="kpi-k">Margen bruto</div><div class="kpi-v">${pct(kpis.margen_bruto_pct)}</div><div class="kpi-s">(ventas − compras) / ventas</div></div>
      <div class="kpi-card"><div class="kpi-k">Fondos disponibles</div><div class="kpi-v">${mm(tes.total_bancos)}</div><div class="kpi-s">${tes.bancos?.length || 0} cuenta(s) bancaria(s)</div></div>
      <div class="kpi-card"><div class="kpi-k">Cartera por cobrar</div><div class="kpi-v">${mm(tes.cobranza?.total)}</div><div class="kpi-s">vencido &gt;30 días: ${mm(tes.cobranza?.vencido_30_dias)}</div></div>
    </div>
    <h3>Escenarios de caja (indicadores)</h3>
    <table class="tabla">
      <thead><tr><th>Indicador</th><th>Valor</th><th>Lectura</th></tr></thead>
      <tbody>
        <tr><td>Cobertura de obligaciones del período</td><td class="der">${tes.total_bancos && kpis.iva_periodo ? pct(Math.round((tes.total_bancos / (kpis.iva_periodo + kpis.ppm_periodo)) * 1000) / 10) : '—'}</td><td>Fondos disponibles sobre el IVA y PPM estimados del período.</td></tr>
        <tr><td>Días promedio de cobranza (DSO estimado)</td><td class="der">${kpis.tesoreria?.dso_estimado != null ? `${kpis.tesoreria.dso_estimado} días` : '—'}</td><td>Retraso en el ingreso del IVA pagado por los clientes.</td></tr>
        <tr><td>Cartera vencida sobre 30 días</td><td class="der">${mm(tes.cobranza?.vencido_30_dias)}</td><td>Riesgo directo sobre la capacidad de pago del IVA del período siguiente.</td></tr>
        <tr><td>Conciliación bancaria</td><td class="der">${pct(tes.conciliacion?.ratio)}</td><td>Cartola aplicada sobre el período revisado.</td></tr>
        <tr><td>Exposición tributaria identificada</td><td class="der">${mm(op.exposicion?.total)}</td><td>${esc(op.exposicion?.nota || '')}</td></tr>
      </tbody>
    </table>
    <h3>Renta (F22) y devoluciones</h3>
    ${informe?.renta?.anios?.length ? `<table class="tabla"><thead><tr><th>Año</th><th>Estado</th><th class="der">Monto declarado</th><th class="der">Remanente devuelto</th><th>Vencimiento</th></tr></thead><tbody>${informe.renta.anios.map((r) => `<tr><td>${esc(r.anio)}</td><td><span class="chip chip-${String(r.estado || 'sin_informacion').toLowerCase()}">${esc(r.estado || '—')}</span></td><td class="der">${r.monto_total == null ? '—' : clp(r.monto_total)}</td><td class="der">${r.remanente_devuelto ? clp(r.remanente_devuelto) : '—'}</td><td>${esc(fechaCorta(r.fecha_vencimiento))}</td></tr>`).join('')}</tbody></table>` : '<p class="nota">Renta no consultada: la existencia de la declaración anual no está verificada.</p>'}
  `)

  const cap7 = capitulo(7, 'Plan de acción y regularización', `
    ${tablaPlanAccion(op.plan_accion)}
    <p class="nota">Cada acción se cierra con la evidencia señalada; el siguiente informe verifica el resultado.</p>
  `)

  const cap8 = capitulo(8, 'Metodología, alcance y anexos', `
    <h3>Índice de Salud Tributaria JMV</h3>
    <p class="nota">${esc(informe?.metodologia?.indice || '')}</p>
    <p class="nota">${esc(informe?.metodologia?.regla_no_evaluable || '')}</p>
    <p class="nota">${esc(informe?.metodologia?.regla_alerta_critica || '')}</p>
    <p class="nota">Escala: ${esc(informe?.metodologia?.clasificacion || '')}</p>
    ${gfx.indice}
    <h3>Origen de los datos</h3>
    <table class="tabla"><thead><tr><th>Categoría</th><th>Qué significa</th></tr></thead><tbody>
      ${(informe?.metodologia?.origen_datos || []).map((o) => `<tr><td>${esc(o.nombre)}</td><td>${esc(o.detalle)}</td></tr>`).join('')}
    </tbody></table>
    <h3>Limitaciones</h3>
    ${listaBloque(informe?.metodologia?.limitaciones_generales, '')}
    ${listaBloque(op.limitaciones, '')}
    <h3>Base normativa de referencia</h3>
    ${listaBloque(op.base_normativa, '')}
    <h3>Documentos y fuentes consultadas</h3>
    <table class="tabla"><thead><tr><th>Fuente</th><th>Cobertura</th></tr></thead><tbody>
      <tr><td>Ficha del contribuyente (SII)</td><td>${esc(ident.fuente || '—')}</td></tr>
      <tr><td>Registro de Compras y Ventas (RCV)</td><td>${informe?.cobertura?.con_datos ?? 0} período(s) con datos entre ${informe?.cobertura?.desde || '—'} y ${informe?.cobertura?.hasta || '—'}</td></tr>
      <tr><td>Consulta Integral F29 (SII)</td><td>${informe?.declaraciones?.f29?.estado === 'no_consultado' ? 'No consultada' : 'Consultada'}</td></tr>
      <tr><td>Formulario Compacto del F29 (SII)</td><td>${informe?.f29_declarado?.estado === 'disponible' ? `${informe.f29_declarado.periodos.length} período(s), ${informe.f29_declarado.verificaciones_ok}/${informe.f29_declarado.verificaciones_total} verificaciones correctas` : 'No disponible'}</td></tr>
      <tr><td>Renta (F22)</td><td>${informe?.renta?.estado === 'disponible' ? `${informe.renta.anios.length} año(s)` : 'No consultada'}</td></tr>
      <tr><td>Tesorería y contabilidad del sistema</td><td>${esc(tes.estado === 'disponible' ? 'Disponible' : 'Sin movimientos registrados')}</td></tr>
    </tbody></table>
  `)

  const contenido = `
  <div class="hoja">
    <header class="portada">
      <div class="marca-fila">
        ${marca}
        <div class="kicker">Tax Health Intelligence</div>
      </div>
      <h1 class="titulo-informe">Informe Ejecutivo de Salud Tributaria</h1>
      <p class="subtitulo-informe">JMV Tax Health Intelligence · diagnóstico, riesgos, exposición y plan de acción</p>
      <div class="datos-empresa">
        <span><b>Contribuyente:</b> ${esc(ident.razon_social || emp.nombre || '—')}</span>
        <span><b>RUT:</b> ${esc(ident.rut || emp.rut || '—')}</span>
        <span><b>Período evaluado:</b> ${esc(informe?.cobertura?.desde || '—')} a ${esc(informe?.cobertura?.hasta || '—')}</span>
        <span><b>Emitido:</b> ${esc(fechaLarga(informe?.generado_en))}</span>
        <span><b>Informe:</b> ${esc(idInf)}</span>
        <span><b>Versión:</b> 2.0</span>
      </div>
      <div class="diagnostico">
        <div>
          <div class="puntaje" style="color:${color}">${op.indice_evaluable === false ? '—' : esc(op.score)}</div>
          <div class="meta">Índice de Salud Tributaria</div>
        </div>
        <div>
          <div class="estado" style="color:${color}">${esc(op.clasificacion?.titulo || op.titulo || '—')}</div>
          <div class="meta">${op.indice_evaluable === false ? 'Índice no evaluable con los antecedentes disponibles' : 'Clasificación según la escala JMV'}</div>
          <div class="meta">Cobertura ${pct(op.cobertura_diagnostico)} · Confianza ${esc(op.nivel_confianza || '—')}</div>
        </div>
      </div>
      ${tablaKpiPortada(informe)}
      ${principal ? `<div class="hallazgo-prioritario">
        <h4>Hallazgo prioritario</h4>
        <p>${esc(principal.detalle || principal.descripcion || principal.titulo || '')}</p>
      </div>` : ''}
      <div class="semilla">
        Este informe se emite sobre los antecedentes que el sistema pudo verificar. Los índices, coberturas y cantidades reflecten esa realidad:
        una materia sin datos aparece como «no evaluable», nunca como conforme. Documento de trabajo técnico; no constituye certificación tributaria.
      </div>
    </header>

    <section class="cap">
      <h2><span class="cap-n">—</span> Índice</h2>
      <div class="idx">
        <div><b>01</b> Resumen ejecutivo</div>
        <div><b>02</b> Cumplimiento tributario y obligaciones</div>
        <div><b>03</b> Análisis del IVA y conciliaciones</div>
        <div><b>04</b> Matriz de riesgos tributarios</div>
        <div><b>05</b> Tendencias y comportamiento tributario</div>
        <div><b>06</b> Impacto financiero y proyecciones</div>
        <div><b>07</b> Plan de acción y regularización</div>
        <div><b>08</b> Metodología, alcance y anexos</div>
      </div>
    </section>

    ${cap1}${cap2}${cap3}${cap4}${cap5}${cap6}${cap7}${cap8}

    <section class="final">
      ${marca}
      <p><b>JMV Tax Health Intelligence</b> — Informe Ejecutivo de Salud Tributaria</p>
      ${bloqueOpinion(op)}
      <p>Este informe se entrega al contribuyente identificado en la portada y recoge el estado de su situación tributaria
      a la fecha de emisión, sobre la base de los antecedentes verificados y de las limitaciones declaradas en el capítulo 08.</p>
      <p>Emisión profesional: Este informe técnico de salud tributaria considera el estado real de las obligaciones declaradas
      mediante consulta al SII (Formulario F29), el Registro de Compras y Ventas (RCV) y las declaraciones anuales (F22).
      Los indicadores y coberturas reflejan la realidad verificada; una materia sin datos aparece como «no evaluable»,
      nunca como conformidad. Se emite con la opinión profesional que sigue y las recomendaciones correspondientes.</p>
      <div class="opinion-expert" style="border-top: 1px solid ${MARCA.linea}; padding-top: 16px; margin: 16px 0;">
        <h3>Opinión Profesional Tributaria</h3>
        <p>${esc(op?.clasificacion?.nota || op?.opinion_profesional?.conclusion || 'No disponible')}</p>
        ${op?.opinion_profesional?.recomendacion ? `<p><b>Recomendación:</b> ${esc(op.opinion_profesional.recomendacion)}</p>` : ''}
        ${op?.opinion_profesional?.hechos ? `<p><b>Hechos relevantes:</b> ${esc(op.opinion_profesional.hechos)}</p>` : ''}
        ${op?.opinion_profesional?.riesgos ? `<p><b>Riesgos identificados:</b> ${esc(op.opinion_profesional.riesgos)}</p>` : ''}
      </div>
      <p>Se recomienda su uso como base de la conversación con el equipo contador, y su contraste con la documentación de respaldo
      antes de adoptar decisiones sobre regularizaciones o rediseño de procesos.</p>
      <p class="firma">Emitido por JMV Consultores · ${esc(fechaLarga(informe?.generado_en))} · ${esc(idInf)} · Documento confidencial</p>
    </section>

    <div class="pie">
      <span>JMV Consultores · Tax Health Intelligence</span>
      <span>${esc(idInf)} · Emitido el ${esc(fechaCorta(informe?.generado_en))}</span>
    </div>
  </div>`

  return `<!DOCTYPE html>
<html lang="es-CL">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Informe Ejecutivo de Salud Tributaria — ${esc(ident.razon_social || emp.nombre || '')}</title>
<style>${css()}</style>
</head>
<body>${contenido}</body>
</html>`
}

module.exports = {
  renderInformeHtml,
  graficosSvg,
  esc,
  clp,
  mm,
  pct,
  MARCA,
  RIESGO_COLOR,
  idInforme,
}
