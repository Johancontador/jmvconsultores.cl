/**
 * Conectores de cartolas bancarias por FORMATO (FASE 9.2).
 *
 * Los bancos chilenos exportan la cartola del portal como CSV o Excel. Este
 * módulo convierte ese archivo en las filas que `tesoreria.importarCartola`
 * ya sabe ingestar (fecha ISO, monto FIRMADO, glosa) — SIN scraping: el
 * archivo lo descarga el humano del portal del banco; aquí solo se lee.
 *
 * Tres vías de mapeo, en orden de precisión:
 *  1. Encabezado por NOMBRE (fecha/monto/importe/cargo/abono/glosa/detalle…).
 *  2. Detección ESTADÍSTICA: la columna donde casi todo parsea como fecha es
 *     la fecha; la numérica pura es el monto (o el par cargo/abono, cuando en
 *     cada fila uno de los dos viene vacío/cero); la de texto largo es la glosa.
 *  3. MAPEO MANUAL del usuario, que puede guardarse como formato con nombre
 *     (`teso_cartola_formatos`) y queda disponible para siempre en la empresa.
 *
 * Un formato no reconocido NO inventa nada: devuelve filas vacías y la UI
 * ofrece el mapeo manual (report-only, mismo principio del resto del sistema).
 *
 * Montos: acepta '$1.234.567', '-$56.789', '1.234,56', '(2.500)' (contable),
 * números y celdas Excel — siempre INTEGER firmado (abono − cargo).
 * Fechas: Date de Excel, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD y serial de Excel.
 *
 * Módulo puro: las funciones de archivo son async (exceljs); las de matriz,
 * síncronas y testeables.
 */

let _exceljs = null
function exceljs() {
  if (!_exceljs) _exceljs = require('exceljs')
  return _exceljs
}

// ============================================================
// Normalización de celdas
// ============================================================

/** Celda Excel/CSV → valor plano (string/number/Date). */
function celdaPlana(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if (typeof v.text === 'string') return v.text
    if (v.result !== undefined) return v.result
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    return ''
  }
  return v
}

function celdaTexto(v) {
  const p = celdaPlana(v)
  return p instanceof Date ? p.toISOString().slice(0, 10) : String(p).trim()
}

/** Fecha en ISO YYYY-MM-DD o null. Acepta Date, ISO, DD/MM/YYYY, serial Excel. */
function parsearFecha(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v ?? '').trim()
  if (!s) return null
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) return construirFecha(+m[1], +m[2], +m[3])
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]
    return construirFecha(y, +m[2], +m[1])
  }
  const serial = Number(s)
  if (Number.isInteger(serial) && serial >= 20000 && serial <= 60000) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
  }
  return null
}

function construirFecha(y, mes, d) {
  if (mes < 1 || mes > 12 || d < 1 || d > 31) return null
  const f = new Date(Date.UTC(y, mes - 1, d))
  // rechazar rollover (31/02 → 03/03): el día debe ser REAL del mes
  if (isNaN(f) || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== d) return null
  return f.toISOString().slice(0, 10)
}

/** Monto firmado INTEGER o null. Cargo contable entre paréntesis = negativo. */
function parsearMonto(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null
  let s = String(v ?? '').trim().replace(/[\s$]/g, '')
  if (!s) return null
  let negativo = false
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1) }
  if (s.endsWith('-')) { negativo = true; s = s.slice(0, -1) }
  if (s.startsWith('-')) { negativo = true; s = s.slice(1) }
  if (!/^[\d.,]+$/.test(s)) return null
  const tieneComa = s.includes(',')
  const tienePunto = s.includes('.')
  if (tieneComa && tienePunto) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (tieneComa) {
    s = /,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '')
  } else if (tienePunto) {
    if (!/\.\d{3}(\.|$)/.test(s) && /\.\d{1,2}$/.test(s)) { /* decimal: se deja */ } else s = s.replace(/\./g, '')
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return Math.round(negativo ? -n : n)
}

/** Línea CSV respetando comillas dobles ("1.234";"glosa, con coma";...). */
function parsearLineaCSV(linea, sep) {
  const out = []
  let actual = ''
  let enComillas = false
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i]
    if (enComillas) {
      if (ch === '"') {
        if (linea[i + 1] === '"') { actual += '"'; i++ } else enComillas = false
      } else actual += ch
    } else if (ch === '"') enComillas = true
    else if (ch === sep) { out.push(actual); actual = '' }
    else actual += ch
  }
  out.push(actual)
  return out.map((c) => c.trim())
}

function detectarSeparador(texto) {
  const muestra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5).join('\n')
  const cuenta = (ch) => (muestra.match(new RegExp(`\\${ch}`, 'g')) || []).length
  const candidatos = [[';', cuenta(';')], [',', cuenta(',')], ['\t', cuenta('\t')]]
  candidatos.sort((a, b) => b[1] - a[1])
  return candidatos[0][1] > 0 ? candidatos[0][0] : ';'
}

// ============================================================
// Detección de formato
// ============================================================

function esFilaVacia(fila) {
  return !fila || fila.every((c) => celdaTexto(c) === '')
}

/**
 * Detecta el mapeo de columnas. Devuelve { mapeo, fuente } o null si no hay
 * ninguna columna de fecha confiable (formato no reconocido).
 */
function detectarMapeo(matriz) {
  // 1) Por nombres de encabezado (más preciso cuando el banco rotula).
  for (let i = 0; i < Math.min(matriz.length, 15); i++) {
    const fila = matriz[i].map(celdaTexto)
    const buscar = (re) => fila.findIndex((t) => re.test(t))
    const cFecha = buscar(/^fecha|fecha contable|^f\. *fecha/i)
    const cMonto = buscar(/^(monto|importe|valor|movimiento \$)/i)
    const cCargo = buscar(/cargo|débito|debito|egreso/i)
    const cAbono = buscar(/abono|crédito|credito|ingreso/i)
    const cGlosa = buscar(/glosa|descripción|descripcion|detalle|concepto|movimiento/i)
    if (cFecha >= 0 && (cMonto >= 0 || (cCargo >= 0 && cAbono >= 0))) {
      const mapeo = { fila_inicio: i + 1, col_fecha: cFecha, col_glosa: cGlosa >= 0 ? cGlosa : null }
      if (cMonto >= 0) mapeo.col_monto = cMonto
      else { mapeo.col_cargo = Math.min(cCargo, cAbono); mapeo.col_abono = Math.max(cCargo, cAbono) }
      return { mapeo, fuente: 'encabezado' }
    }
  }

  // 2) Estadístico: probar inicios de datos y medir cada columna.
  for (let inicio = 0; inicio < Math.min(matriz.length, 15); inicio++) {
    const muestra = matriz.slice(inicio + 1, inicio + 31).filter((f) => !esFilaVacia(f))
    if (muestra.length < 3) continue
    const nCols = Math.max(...muestra.map((f) => f.length))
    const stats = []
    for (let c = 0; c < nCols; c++) {
      let fechas = 0, nums = 0, textos = 0, largo = 0
      for (const fila of muestra) {
        const plano = celdaPlana(fila[c])
        const t = celdaTexto(plano)
        if (t === '') continue
        if (plano instanceof Date || parsearFecha(plano)) { fechas++; continue }
        const num = parsearMonto(plano)
        if (num !== null) { nums++; largo += Math.abs(num) }
        else { textos++; largo += t.length }
      }
      stats.push({ col: c, ratioFecha: fechas / muestra.length, ratioNum: nums / muestra.length, textoScore: textos * 10 + largo / 1000 })
    }
    const candidatosFecha = stats.filter((s) => s.ratioFecha >= 0.6).sort((a, b) => b.ratioFecha - a.ratioFecha)
    if (!candidatosFecha.length) continue
    const colFecha = candidatosFecha[0].col
    const numericas = stats.filter((s) => s.col !== colFecha && s.ratioNum >= 0.6)
    if (!numericas.length) continue
    const mapeo = { fila_inicio: inicio + 1, col_fecha: colFecha }
    if (numericas.length === 1) {
      mapeo.col_monto = numericas[0].col
    } else {
      // dos columnas numéricas: ¿patrón cargo/abono (una de las dos en cero por fila)?
      const [a, b] = numericas
      let pares = 0, complementarias = 0
      for (const fila of muestra) {
        const va = parsearMonto(celdaPlana(fila[a.col]))
        const vb = parsearMonto(celdaPlana(fila[b.col]))
        if ((va == null && vb != null) || (vb == null && va != null) || (va === 0 && vb) || (vb === 0 && va)) complementarias++
        pares++
      }
      if (complementarias / pares >= 0.6) {
        mapeo.col_cargo = a.col; mapeo.col_abono = b.col
      } else {
        mapeo.col_monto = a.col // la de mayor proporción numérica
      }
    }
    const glosas = stats.filter((s) => s.col !== colFecha && !(mapeo.col_monto === s.col || mapeo.col_cargo === s.col || mapeo.col_abono === s.col))
      .sort((x, y) => y.textoScore - x.textoScore)
    if (glosas.length && glosas[0].textoScore > 0) mapeo.col_glosa = glosas[0].col
    // ¿el archivo NO tiene encabezado? Si la fila `inicio` ya es dato (parsea
    // fecha + monto), los datos empiezan ahí y no en la fila siguiente.
    const filaCero = matriz[inicio] || []
    const fechaCero = parsearFecha(celdaPlana(filaCero[colFecha]))
    const montoCero = mapeo.col_monto != null
      ? parsearMonto(celdaPlana(filaCero[mapeo.col_monto]))
      : (parsearMonto(celdaPlana(filaCero[mapeo.col_cargo])) ?? parsearMonto(celdaPlana(filaCero[mapeo.col_abono])))
    if (fechaCero && montoCero !== null) mapeo.fila_inicio = inicio
    return { mapeo, fuente: 'estadistico' }
  }
  return null
}

/** Valida un mapeo (guardado o manual) contra la estructura mínima. */
function validarMapeo(mapeo) {
  const m = mapeo || {}
  const entero = (v) => Number.isInteger(Number(v)) && Number(v) >= 0
  if (!entero(m.fila_inicio) || !entero(m.col_fecha)) {
    throw new Error('El mapeo requiere fila_inicio y col_fecha (índices enteros ≥ 0)')
  }
  const tieneMonto = entero(m.col_monto)
  const tieneCargoAbono = entero(m.col_cargo) && entero(m.col_abono)
  if (!tieneMonto && !tieneCargoAbono) {
    throw new Error('El mapeo requiere col_monto, o el par col_cargo + col_abono')
  }
  return {
    fila_inicio: Number(m.fila_inicio),
    col_fecha: Number(m.col_fecha),
    col_monto: tieneMonto ? Number(m.col_monto) : null,
    col_cargo: tieneCargoAbono ? Number(m.col_cargo) : null,
    col_abono: tieneCargoAbono ? Number(m.col_abono) : null,
    col_glosa: entero(m.col_glosa) ? Number(m.col_glosa) : null,
  }
}

/** Convierte la matriz con un mapeo dado → filas {fecha, monto, glosa}. */
function parsearConMapeo(matriz, mapeo) {
  const m = validarMapeo(mapeo)
  const filas = []
  const saltadas = []
  for (let i = m.fila_inicio; i < matriz.length; i++) {
    const fila = matriz[i] || []
    if (esFilaVacia(fila)) continue
    const planoFecha = celdaPlana(fila[m.col_fecha])
    const fecha = parsearFecha(planoFecha)
    if (!fecha) { saltadas.push({ fila: i + 1, motivo: 'sin fecha legible' }); continue }
    let monto = null
    if (m.col_monto !== null) {
      monto = parsearMonto(celdaPlana(fila[m.col_monto]))
    } else {
      const cargo = parsearMonto(celdaPlana(fila[m.col_cargo]))
      const abono = parsearMonto(celdaPlana(fila[m.col_abono]))
      if (cargo !== null || abono !== null) monto = (abono || 0) - (cargo || 0)
    }
    if (monto === null || monto === 0) {
      saltadas.push({ fila: i + 1, motivo: monto === 0 ? 'monto en cero' : 'monto ilegible' })
      continue
    }
    const glosa = m.col_glosa !== null ? celdaTexto(fila[m.col_glosa]) : ''
    filas.push({ fecha, monto, glosa: (glosa || '').slice(0, 300) })
  }
  return { filas, saltadas }
}

// ============================================================
// Archivos (CSV / XLSX) + formatos guardados
// ============================================================

async function matrizDesdeXlsx(buffer) {
  const ExcelJS = exceljs()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const hoja = workbook.worksheets[0]
  if (!hoja) return []
  const matriz = []
  hoja.eachRow({ includeEmpty: false }, (row) => {
    const valores = row.values || []
    const fila = []
    for (let c = 1; c < valores.length; c++) fila.push(celdaPlana(valores[c]))
    if (!fila.every((c) => c === '')) matriz.push(fila)
  })
  return matriz
}

/** Lee un archivo (base64) → matriz de celdas planas. */
async function leerArchivo({ nombre = '', contenidoBase64 }) {
  const buffer = Buffer.from(String(contenidoBase64 || ''), 'base64')
  if (!buffer.length) throw new Error('El archivo está vacío')
  const esXlsx = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
  if (esXlsx) return { tipo: 'xlsx', matriz: await matrizDesdeXlsx(buffer) }
  const texto = buffer.toString('utf8').replace(/^\uFEFF/, '')
  const sep = detectarSeparador(texto)
  const matriz = texto.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => parsearLineaCSV(l, sep))
  return { tipo: 'csv', matriz }
}

/**
 * Flujo completo de preview: archivo → detección → filas.
 * Devuelve también la matriz para permitir un mapeo manual posterior.
 */
async function parsearArchivo({ nombre = '', contenidoBase64 }) {
  const { tipo, matriz } = await leerArchivo({ nombre, contenidoBase64 })
  const det = detectarMapeo(matriz)
  if (!det) {
    return { tipo_archivo: tipo, formato_detectado: null, filas: [], filas_detectadas: 0, saltadas: [], filas_totales: matriz.length, matriz }
  }
  const { filas, saltadas } = parsearConMapeo(matriz, det.mapeo)
  return { tipo_archivo: tipo, formato_detectado: det, filas, filas_detectadas: filas.length, saltadas, filas_totales: matriz.length, matriz }
}

// ---------- Formatos guardados por empresa ----------

function guardarFormato(db, { empresaId, usuarioId, nombre, mapeo, ip = null }) {
  const nombreLimpio = String(nombre || '').trim()
  if (!nombreLimpio) throw new Error('El nombre del formato es obligatorio')
  const m = validarMapeo(mapeo)
  const { registrarAccion } = require('./auditoria')
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO teso_cartola_formatos (empresa_id, nombre, mapeo_json)
      VALUES (?, ?, ?)
      ON CONFLICT(empresa_id, nombre) DO UPDATE SET mapeo_json = excluded.mapeo_json
    `).run(empresaId, nombreLimpio, JSON.stringify(m))
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'tesoreria.formato_guardar', entidad: 'teso_cartola_formatos', entidadId: nombreLimpio,
      despues: { nombre: nombreLimpio, mapeo: m }, ip,
    })
  })
  tx()
  return { nombre: nombreLimpio, mapeo: m }
}

function listarFormatos(db, empresaId) {
  return db.prepare(`
    SELECT id, nombre, mapeo_json, creado_en FROM teso_cartola_formatos
    WHERE empresa_id = ? ORDER BY nombre
  `).all(empresaId).map((f) => ({ id: f.id, nombre: f.nombre, mapeo: JSON.parse(f.mapeo_json), creado_en: f.creado_en }))
}

module.exports = {
  parsearArchivo, parsearConMapeo, detectarMapeo, validarMapeo,
  parsearMonto, parsearFecha, parsearLineaCSV, detectarSeparador, celdaPlana,
  guardarFormato, listarFormatos,
}
