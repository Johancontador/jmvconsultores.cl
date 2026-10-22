/**
 * f29-formulario.js — Lectura del FORMULARIO 29 DECLARADO (2026-10-21).
 *
 * Qué resuelve: la Consulta Integral del SII entrega el ESTADO y el MONTO
 * total de cada F29 declarado, pero NO el detalle de las casillas. El detalle
 * vive en el «Formulario Compacto» que el SII genera en PDF desde la página
 * de estado de cada declaración:
 *
 *   https://www4.sii.cl/rfiInternet/formCompacto?folio=<folio>&rut=<rut>&form=029&codInt=<codInt>
 *
 * La URL exige `codInt`: sin él el SII devuelve una página de error HTML, no
 * el PDF. Por eso la lectura se hace navigating con la sesión abierta
 * (services/sii-session.js) y NO con un simple fetch.
 *
 * Reglas del módulo:
 *  - No inventa casillas: lo que no está en el PDF no existe en el resultado.
 *  - Cada indicador declara la CASILLA del SII de la que sale.
 *  - Los valores se leen con el separador de miles del SII («31.071.015»).
 *  - Es un módulo PURO respecto de la red: recibe el PDF (Buffer) y devuelve
 *    datos. Quien descarga es declarations-sii.js.
 */

// ---------------------------------------------------------------------------
// PDF: streams, cadenas y operadores (subconjunto suficiente para el F29)
// ---------------------------------------------------------------------------

function streamsFlate(buf) {
  const s = buf.toString('latin1')
  const out = []
  const re = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g
  let m
  while ((m = re.exec(s)) !== null) {
    const body = m[2]
    const i = body.indexOf('stream')
    if (i < 0) continue
    const head = body.slice(0, i)
    if (!/\/FlateDecode/.test(head)) continue
    let data = body.slice(i + 6).replace(/^\r?\n/, '')
    const e = data.lastIndexOf('endstream')
    if (e >= 0) data = data.slice(0, e)
    try {
      out.push(zlib.inflateSync(Buffer.from(data, 'latin1')).toString('latin1'))
    } catch {
      // No es un stream de contenido (puede ser un perfil de color): se ignora.
    }
  }
  return out
}

/** Decodifica escapes de cadena PDF (octal, \n, \\, etc.). */
function decodificar(s) {
  return String(s || '').replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, g) => {
    if (g === 'n') return '\n'
    if (g === 'r') return '\r'
    if (g === 't') return '\t'
    if (g === 'b') return '\b'
    if (g === 'f') return '\f'
    if (g === '(') return '('
    if (g === ')') return ')'
    if (g === '\\') return '\\'
    return String.fromCharCode(parseInt(g, 8))
  })
}

const TOKEN = /\((?:[^\\()]|\\.)*\)|\[(?:[^\]\\]|\\.)*\]|[-+]?[\d.]+|\/[^\s/[\]()<>]+|[A-Za-z'"*]+/g

/** Ancho aproximado de un texto en Helvetica (para saber dónde TERMINA). */
function anchoEstimado(texto, tamano) {
  let w = 0
  for (const ch of String(texto || '')) {
    if (ch >= '0' && ch <= '9') w += 0.556
    else if (ch === '.' || ch === ',' || ch === ' ') w += 0.278
    else if (ch === 'Ñ' || ch === 'Á' || ch === 'É' || ch === 'Í' || ch === 'Ó' || ch === 'Ú') w += 0.72
    else if (ch >= 'A' && ch <= 'Z') w += 0.68
    else w += 0.53
  }
  return w * (tamano || 8)
}

function tokenizar(cont) {
  const out = []
  TOKEN.lastIndex = 0
  let m
  while ((m = TOKEN.exec(cont)) !== null) out.push(m[0])
  return out
}

function mult(m1, m2) {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  }
}

/** Extrae los fragmentos de texto con su posición en la página. */
function extraerItems(cont) {
  const items = []
  const pilaCtm = []
  let ctm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  let tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  let tlm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  let tamano = 8
  const ops = []
  const textoDe = (tok) => {
    if (tok.startsWith('(')) return decodificar(tok.slice(1, -1))
    return tok.slice(1, -1).replace(/\\([()\\])/g, '$1')
  }

  for (const tok of tokenizar(cont)) {
    if (/^[-+]?[\d.]+$/.test(tok)) { ops.push(Number(tok)); continue }
    if (tok.startsWith('(') || tok.startsWith('[') || tok.startsWith('/')) { ops.push(tok); continue }

    switch (tok) {
      case 'q': pilaCtm.push(ctm); break
      case 'Q': ctm = pilaCtm.pop() || ctm; break
      case 'cm': {
        const [a, b, c, d, e, f] = ops.slice(-6)
        ctm = mult({ a, b, c, d, e, f }, ctm)
        break
      }
      case 'Tm': {
        const [a, b, c, d, e, f] = ops.slice(-6)
        tm = { a, b, c, d, e, f }
        tlm = { a, b, c, d, e, f }
        break
      }
      case 'Td':
      case 'TD': {
        const [tx, ty] = ops.slice(-2)
        tlm = { ...tlm, e: tlm.e + tx, f: tlm.f + ty }
        tm = { ...tlm }
        break
      }
      case 'BT': tm = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; tlm = { ...tm }; break
      case 'Tf': {
        const tam = ops[ops.length - 1]
        if (typeof tam === 'number') tamano = tam
        break
      }
      case 'Tj': {
        const ultimo = ops[ops.length - 1]
        const s = typeof ultimo === 'string' ? textoDe(ultimo) : ''
        const p = mult(tm, ctm)
        if (s) items.push({ x: p.e, y: p.f, s, w: anchoEstimado(s, tamano) })
        break
      }
      case 'TJ': {
        const arr = ops[ops.length - 1]
        let s = ''
        if (typeof arr === 'string') {
          const rr = /\((?:[^\\()]|\\.)*\)|(-?[\d.]+)/g
          let q
          while ((q = rr.exec(arr)) !== null) {
            if (q[1] !== undefined) { if (parseFloat(q[1]) < -180) s += ' ' } else s += textoDe(q[0])
          }
        }
        const p = mult(tm, ctm)
        if (s) items.push({ x: p.e, y: p.f, s, w: anchoEstimado(s, tamano) })
        break
      }
      default: break
    }
    if (/^(q|Q|cm|Tm|Td|TD|BT|Tj|TJ|Tf)$/.test(tok)) ops.length = 0
  }
  return items
}

/** Agrupa los fragmentos por línea (misma coordenada vertical). */
function agruparLineas(items, tolerancia = 1.2) {
  const filas = []
  for (const it of items) {
    const y = it.y
    let fila = filas.find((f) => Math.abs(f.y - y) <= tolerancia)
    if (!fila) { fila = { y, items: [] }; filas.push(fila) }
    fila.items.push({ x: it.x, s: it.s })
  }
  for (const f of filas) f.items.sort((a, b) => a.x - b.x)
  return filas.sort((a, b) => b.y - a.y)
}

/** El SII escribe «31.071.015»; el número real es 31071015. */
function numeroChileno(txt) {
  let t = String(txt == null ? '' : txt).trim()
  if (!t) return null
  // Separador de miles chileno: «31.071.015» (PDF) o «31,071,015» (pantalla).
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '')
  else t = t.replace(/[^\d.-]/g, '')
  if (!t || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Detecta las columnas del encabezado «Código | Glosa | Valor | …» para saber
 * a qué casilla pertenece cada valor. Sin esto, una fila con dos pares
 * (código, glosa, valor) se mezcla y las cifras se asignan al código
 * equivocado.
 */
function detectarColumnas(lineas) {
  for (const fila of lineas) {
    const textos = fila.items.map((i) => i.s.trim().toUpperCase())
    const nCodigo = textos.filter((t) => t === 'CÓDIGO' || t === 'CODIGO').length
    if (nCodigo < 1) continue
    if (!textos.some((t) => t === 'GLOSA')) continue
    if (!textos.some((t) => t === 'VALOR')) continue

    // Orden de las anclas: código, glosa, valor, código, glosa, valor…
    const anclas = []
    let ultimo = -Infinity
    for (const it of fila.items) {
      const t = it.s.trim().toUpperCase()
      if (t === 'CÓDIGO' || t === 'CODIGO' || t === 'GLOSA' || t === 'VALOR') {
        if (it.x > ultimo + 1) { anclas.push({ tipo: t, x: it.x }); ultimo = it.x }
      }
    }
    if (anclas.length >= 3) return anclas
  }
  return null
}

/**
 * Aprende de los propios datos dónde están las columnas de CÓDIGO.
 *
 * En el Formulario Compacto los códigos se dibujan SIEMPRE en el mismo x
 * (alineados a la izquierda: x≈39 y x≈339) y los valores se dibujan
 * alineados a la DERECHA de su celda (por eso un valor corto como «5» o
 * «388» empieza más a la derecha que uno largo como «159.896.479»). Por eso
 * no sirve «la columna más cercana a la izquierda»: la moda de los x de los
 * números pegados al encabezado «Código» sí da la columna real.
 */
function aprenderColumnasCodigo(lineas, anclas) {
  const cols = []
  if (!anclas) return cols
  const ventanas = anclas
    .filter((a) => a.tipo === 'CÓDIGO' || a.tipo === 'CODIGO')
    .map((a) => a.x)
  for (const ax of ventanas) {
    const cands = []
    for (const fila of lineas) {
      for (const it of fila.items) {
        const t = it.s.trim()
        if (!/^\d{1,4}$/.test(t)) continue
        if (it.x >= ax - 4 && it.x <= ax + 18) cands.push(Math.round(it.x))
      }
    }
    if (!cands.length) continue
    // moda con tolerancia 2 (los códigos comparten x exacto)
    const candsSorted = [...cands].sort((a, b) => a - b)
    let mejor = null
    let mejorN = 0
    for (let i = 0; i < candsSorted.length; i++) {
      const v = candsSorted[i]
      let j = i
      while (j < candsSorted.length && candsSorted[j] - v <= 2) j++
      if (j - i > mejorN) { mejorN = j - i; mejor = v }
    }
    if (mejor != null && !cols.some((c) => Math.abs(c - mejor) <= 2)) cols.push(mejor)
  }
  return cols.sort((a, b) => a - b)
}

const ES_NUMERO = /^\d{1,4}$/
const ES_MONTO = /^\d{1,3}(\.\d{3})*$/

/**
 * Códigos de casilla del F29 (bloque de notificación y bloque «Total a
 * pagar»). En esas filas el SII usa una maquetación propia: los códigos NO
 * están en la columna del encabezado, así que se reconocen por ser códigos
 * conocidos y estar seguidos de su glosa.
 */
const CODIGOS_F29 = new Set([
  '091', '092', '093', '094', '115', '502', '503', '509', '510', '511', '519', '520',
  '527', '528', '537', '538', '544', '547', '562', '563', '584', '589', '595', '622',
  '048', '049', '779', '795', '915', '922', '931', '932', '9311', '9312',
])

/**
 * Agrupa los fragmentos de una línea en casillas [código, glosa, valor].
 *
 * Reglas (en orden):
 *  1. Número pegado a una columna de código (±2) ⇒ CÓDIGO.
 *  2. Fila del bloque «Total a pagar» (rótulo propio) ⇒ el número de la
 *     columna 299 es CÓDIGO (91, 92, 93, 795, 94) y el de la columna 405 su
 *     VALOR.
 *  3. Número seguido de texto y que sea un código conocido del F29 ⇒
 *     CÓDIGO (notificaciones: 931, 932, 922, 915…).
 *  4. Cualquier otro número ⇒ VALOR de la casilla abierta.
 */
function casillasDeLinea(items, columnasCodigo) {
  const grupos = []
  let actual = null
  const textos = items.map((i) => i.s.trim())
  const rotulo = textos.find((t) => t) || ''
  const bloqueTotal = /^(TOTAL A PAGAR|MÁS |MAS |CONDONACI)/i.test(rotulo)
  // Texto que aparece ANTES de cualquier código de la fila: es el rótulo de
  // la línea («TOTAL A PAGAR DENTRO DEL PLAZO LEGAL»), no la glosa de la
  // casilla anterior.
  let etiquetaFila = null
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx]
    const t = it.s.trim()
    if (!t) continue
    const siguiente = textos.slice(idx + 1).find((x) => x) || null
    let esCodigo = false
    if (ES_NUMERO.test(t)) {
      if (columnasCodigo.some((c) => Math.abs(it.x - c) <= 2)) esCodigo = true
      else if (bloqueTotal && it.x >= 285 && it.x <= 315) esCodigo = true
      else if (siguiente && CODIGOS_F29.has(t)) esCodigo = true
    }
    if (esCodigo) {
      actual = { codigo: t, glosa: [], etiqueta: etiquetaFila, valor: null, valor_texto: null }
      grupos.push(actual)
      etiquetaFila = null
      continue
    }
    const esValor = ES_MONTO.test(t)
    if (esValor) {
      if (!actual) continue
      if (actual.valor == null) { actual.valor = numeroChileno(t); actual.valor_texto = t }
      continue
    }
    if (/^[+\-=]+$/.test(t)) continue // símbolos de suma del bloque «Total a pagar»
    if (!actual) { etiquetaFila = etiquetaFila || t; continue }
    actual.glosa.push(t)
  }
  return grupos
}

/**
 * Parsea el PDF del Formulario Compacto y devuelve las casillas del SII.
 * @returns {{casillas: Array, lineas: Array, texto: string}}
 */
function parsearFormularioF29(buffer) {
  if (!buffer || !buffer.length) return { casillas: [], lineas: [], texto: '' }
  const contenidos = streamsFlate(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).filter((t) => /\bBT\b/.test(t))
  if (!contenidos.length) return { casillas: [], lineas: [], texto: '' }
  const items = extraerItems(contenidos.join('\n'))
  const lineas = agruparLineas(items)
  const anclas = detectarColumnas(lineas)
  const columnasCodigo = aprenderColumnasCodigo(lineas, anclas)

  const casillas = []
  const lineasTexto = []
  for (const fila of lineas) {
    const partes = fila.items.map((i) => i.s.trim()).filter(Boolean)
    if (!partes.length) continue
    lineasTexto.push(partes.join(' '))

    const grupos = casillasDeLinea(fila.items, columnasCodigo)
    for (const g of grupos) {
      if (!g.codigo || !/^\d{2,4}$/.test(g.codigo)) continue
      const glosa = g.glosa.join(' ').replace(/\s+/g, ' ').trim() || (g.etiqueta || '')
      casillas.push({
        codigo: g.codigo,
        glosa,
        valor_texto: g.valor_texto,
        valor: g.valor,
      })
    }
  }

  return { casillas, lineas: lineasTexto, texto: lineasTexto.join('\n'), filas: lineas, columnas_codigo: columnasCodigo }
}

// ---------------------------------------------------------------------------
// Semántica: cada indicador dice de qué casilla del SII sale
// ---------------------------------------------------------------------------

/**
 * Catálogo de casillas del Formulario Compacto que usamos. La glosa es la
 * VERBATIM del SII (así aparece en el PDF) para que el informe pueda
 * mostrar la fuente exacta sin parafrasear.
 */
const CASILLAS_F29 = {
  503: { clave: 'facturas_emitidas', glosa: 'CANTIDAD FACTURAS EMITIDAS', tipo: 'cantidad' },
  502: { clave: 'debitos_facturas', glosa: 'DÉBITOS FACTURAS EMITIDAS', tipo: 'monto' },
  509: { clave: 'notas_credito_emitidas', glosa: 'CANT. DCTOS. NOTAS DE CRÉDITOS EMITIDAS', tipo: 'cantidad' },
  510: { clave: 'debitos_notas_credito', glosa: 'DÉBITOS NOTAS DE CRÉDITOS EMITIDAS', tipo: 'monto' },
  538: { clave: 'total_debitos', glosa: 'TOTAL DÉBITOS', tipo: 'monto' },
  511: { clave: 'creditos_iva_electronicos', glosa: 'CRÉD. IVA POR DCTOS. ELECTRÓNICOS', tipo: 'monto' },
  537: { clave: 'total_creditos', glosa: 'TOTAL CRÉDITOS', tipo: 'monto' },
  563: { clave: 'base_imponible', glosa: 'BASE IMPONIBLE', tipo: 'monto' },
  519: { clave: 'documentos_recibidos', glosa: 'CANT. DE DCTOS. FACT. RECIB. DEL GIRO', tipo: 'cantidad' },
  520: { clave: 'monto_recibido', glosa: 'CRÉDITO REC. Y REINT./FACT. DEL GIRO', tipo: 'monto' },
  527: { clave: 'nc_recibidas', glosa: 'CANT. NOTAS DE CRÉDITO RECIBIDAS', tipo: 'cantidad' },
  528: { clave: 'monto_nc_recibidas', glosa: 'CRÉDITO RECUP. Y REINT NOTAS DE CRÉD', tipo: 'monto' },
  '048': { clave: 'retencion_unico_trabajador', glosa: 'RET. IMP. ÚNICO TRAB. ART. 74 N 1 LIR', tipo: 'monto' },
  '049': { clave: 'retencion_terceros', glosa: 'Ret. 3% Rta 42 N°1 reint. prest.', tipo: 'monto' },
  115: { clave: 'tasa_ppm', glosa: 'TASA PPM 1ra. CATEGORÍA', tipo: 'porcentaje' },
  '089': { clave: 'iva_determinado', glosa: 'IMP. DETERM. IVA', tipo: 'monto' },
  '062': { clave: 'ppm_neto', glosa: 'PPM NETO DETERMINADO', tipo: 'monto' },
  595: { clave: 'subtotal_determinado', glosa: 'SUB TOTAL IMP. DETERMINADO ANVERSO', tipo: 'monto' },
  547: { clave: 'total_determinado', glosa: 'TOTAL DETERMINADO', tipo: 'monto' },
  '091': { clave: 'total_a_pagar', glosa: 'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL', tipo: 'monto' },
  '092': { clave: 'ipc', glosa: 'Más IPC', tipo: 'monto' },
  '093': { clave: 'interes_multa_total', glosa: 'Más Interes y Multas', tipo: 'monto' },
  '094': { clave: 'total_a_pagar_con_recargo', glosa: 'TOTAL A PAGAR CON RECARGO', tipo: 'monto' },
  795: { clave: 'condonacion', glosa: 'CONDONACIÓN', tipo: 'monto' },
  931: { clave: 'interes', glosa: 'Monto Interés', tipo: 'monto' },
  932: { clave: 'multa', glosa: 'Monto Multa', tipo: 'monto' },
  9311: { clave: 'interes_base', glosa: 'Monto Interés Base', tipo: 'monto' },
  9312: { clave: 'interes_spread', glosa: 'Monto Interés Spread', tipo: 'monto' },
  922: { clave: 'numero_resolucion', glosa: 'Número Resolución', tipo: 'texto' },
  915: { clave: 'fecha_condonacion', glosa: 'Fecha Condonación', tipo: 'fecha' },
}

/**
 * Convierte las casillas en indicadores con su origen declarado.
 *
 * Identidades verificadas contra el F29 real (2025-01, RUT 76312274-3):
 *   · 502 − 510 = 538   (débitos netos: ventas declaradas del período)
 *   · 538 − 537 = 089   (IVA determinado)
 *   · 520 − 528 = 537   (créditos netos del giro)
 *   · 563 × tasa(115) = 062  (PPM determinado)
 *   · 547 = 91          (total determinado = total a pagar)
 */
function indicadores(casillas) {
  const porClave = new Map()
  for (const c of casillas || []) {
    // El código del SII siempre se compara como texto de 3 dígitos: «91» es
    // la casilla 091 y «062» la 062 (con cero a la izquierda).
    const def = CASILLAS_F29[String(c.codigo).padStart(3, '0')]
    if (!def) continue
    if (!porClave.has(def.clave)) porClave.set(def.clave, { ...def, codigo: c.codigo, valor: c.valor, valor_texto: c.valor_texto })
  }

  const salida = { casillas: [...porClave.values()], indicadores: {}, verificaciones: [] }
  const v = (clave) => {
    const c = porClave.get(clave)
    return c && c.valor != null ? c.valor : null
  }

  const totalDebitos = v('total_debitos')
  const totalCreditos = v('total_creditos')
  const ivaDet = v('iva_determinado')
  const base = v('base_imponible')
  const tasa = v('tasa_ppm')
  const ppm = v('ppm_neto')

  salida.indicadores = {
    base_imponible: base,
    total_debitos: totalDebitos,
    total_creditos: totalCreditos,
    iva_determinado: ivaDet,
    ppm_neto: ppm,
    tasa_ppm: tasa,
    total_determinado: v('total_determinado'),
    total_a_pagar: v('total_a_pagar'),
    facturas_emitidas: v('facturas_emitidas'),
    notas_credito_emitidas: v('notas_credito_emitidas'),
    debitos_facturas: v('debitos_facturas'),
    debitos_notas_credito: v('debitos_notas_credito'),
    documentos_recibidos: v('documentos_recibidos'),
    monto_recibido: v('monto_recibido'),
    nc_recibidas: v('nc_recibidas'),
    monto_nc_recibidas: v('monto_nc_recibidas'),
    retenciones: (v('retencion_unico_trabajador') || 0) + (v('retencion_terceros') || 0) || null,
    interes_multa: (v('interes') || 0) + (v('multa') || 0) || null,
  }

  const verif = (codigo, ok, detalle) => salida.verificaciones.push({ codigo, ok, detalle })

  const d502 = v('debitos_facturas')
  const d510 = v('debitos_notas_credito')
  if (d502 != null && d510 != null && totalDebitos != null) {
    verif('DEBITOS_NETOS', Math.abs((d502 - d510) - totalDebitos) <= 1000,
      `502 (${d502}) − 510 (${d510}) = ${d502 - d510} vs 538 total débitos (${totalDebitos}).`)
  }
  if (totalDebitos != null && totalCreditos != null && ivaDet != null) {
    verif('IVA_DETERMINADO', Math.abs((totalDebitos - totalCreditos) - ivaDet) <= 1000,
      `538 (${totalDebitos}) − 537 (${totalCreditos}) = ${totalDebitos - totalCreditos} vs 089 IVA determinado (${ivaDet}).`)
  }
  const c520 = v('monto_recibido')
  const c528 = v('monto_nc_recibidas')
  if (c520 != null && c528 != null && totalCreditos != null) {
    verif('CREDITOS_NETOS', Math.abs((c520 - c528) - totalCreditos) <= 1000,
      `520 (${c520}) − 528 (${c528}) = ${c520 - c528} vs 537 total créditos (${totalCreditos}).`)
  }
  if (base != null && tasa != null && ppm != null) {
    const esperado = Math.round((base * tasa) / 100)
    verif('PPM_DETERMINADO', Math.abs(esperado - ppm) <= Math.max(1000, Math.round(ppm * 0.01)),
      `563 base imponible (${base}) × tasa ${tasa}% = ${esperado} vs 062 PPM neto (${ppm}).`)
  }
  const totalDet = v('total_determinado')
  const totalPagar = v('total_a_pagar')
  if (totalDet != null && totalPagar != null) {
    verif('TOTAL_A_PAGAR', Math.abs(totalDet - totalPagar) <= 1000,
      `547 total determinado (${totalDet}) vs 91 total a pagar (${totalPagar}).`)
  }

  return salida
}

module.exports = {
  parsearFormularioF29,
  indicadores,
  CASILLAS_F29,
  // helpers puros (tests)
  numeroChileno,
  decodificar,
  agruparLineas,
  extraerItems,
  detectarColumnas,
}
