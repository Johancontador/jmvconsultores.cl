const db = require('../db')
const { obtenerSesion, invalidarSesion, fetchConCookies, parseRut, siiFacadeHeaders, SII_RCV_UI } = require('./sii-session')
const { sleep, INTERVALO_MS } = require('./simpleapi')

let ultimaConsulta = 0

async function esperarRateLimit() {
  const ahora = Date.now()
  const diff = ahora - ultimaConsulta
  if (diff < INTERVALO_MS) await sleep(INTERVALO_MS - diff)
  ultimaConsulta = Date.now()
}

const METODOS = {
  compras: 'getDetalleCompraExport',
  ventas: 'getDetalleVentaExport',
}

const OPERACIONES = {
  compras: 'COMPRA',
  ventas: 'VENTA',
}

// Los métodos "Export" del SII devuelven el detalle como CSV empaquetado en un
// array de strings dentro de data[]: data[0] son los encabezados separados por
// ";", data[1..] son las filas (también separadas por ";"). No son objetos JSON.
function parsearFilasCSV(dataArray) {
  if (!Array.isArray(dataArray) || dataArray.length < 1) return []
  const headers = dataArray[0].split(';').map((h) => h.trim())
  const filas = []
  for (let i = 1; i < dataArray.length; i++) {
    const linea = dataArray[i]
    if (!linea) continue
    const valores = linea.split(';')
    const fila = {}
    headers.forEach((h, idx) => {
      fila[h] = valores[idx] !== undefined ? valores[idx].trim() : ''
    })
    filas.push(fila)
  }
  return filas
}

function parseMonto(valor) {
  if (valor === undefined || valor === null || valor === '') return 0
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

// Nombres de columna difieren entre el export de ventas y el de compras.
// "Fecha Reclamo" solo existe en ventas: si viene con fecha, el cliente
// reclamó (rechazó) la factura — normalmente implica emitir NC o refacturar.
const COLUMNAS = {
  ventas: {
    folio: 'Folio',
    rutDoc: 'Rut cliente',
    razonSocial: 'Razon Social',
    montoExento: 'Monto Exento',
    montoNeto: 'Monto Neto',
    montoIVA: 'Monto IVA',
    montoTotal: 'Monto total',
    tipoDoc: 'Tipo Doc',
    fechaDocto: 'Fecha Docto',
    fechaReclamo: 'Fecha Reclamo',
  },
  compras: {
    folio: 'Folio',
    rutDoc: 'RUT Proveedor',
    razonSocial: 'Razon Social',
    montoExento: 'Monto Exento',
    montoNeto: 'Monto Neto',
    montoIVA: 'Monto IVA Recuperable',
    montoTotal: 'Monto Total',
    tipoDoc: 'Tipo Doc',
    fechaDocto: 'Fecha Docto',
  },
}

// Detecta columnas monetarias por exclusión, no por prefijo: se confirmó con
// una consulta real al SII (libro de compras) que el SII no prefija todas
// sus columnas de dinero con "Monto"/"Valor"/"IVA" — ej. "Tabacos Puros" o
// "Impto. Sin Derecho a Credito" son montos sin ese prefijo. Es más seguro
// excluir lo claramente no-monetario (identificadores, códigos, fechas,
// tasas) y tratar el resto como monto, que intentar enumerar todos los
// prefijos monetarios posibles y arriesgarse a dejar alguno fuera en
// silencio.
function esColumnaMonto(header) {
  const h = header.toLowerCase()
  return !/^nro$|folio|fecha|^tipo|rut|raz[oó]n|c[oó]digo|tasa|^nce|num[eé]ro|\bnum\.|ident|nacionalidad|indicador/.test(h)
}

function normalizarFila(fila, tipo) {
  const c = COLUMNAS[tipo]
  const montos = {}
  for (const [header, valor] of Object.entries(fila)) {
    if (esColumnaMonto(header)) montos[header] = parseMonto(valor)
  }

  return {
    folio: fila[c.folio] || '',
    rutDoc: fila[c.rutDoc] || '',
    razonSocial: fila[c.razonSocial] || '',
    montoExento: parseMonto(fila[c.montoExento]),
    montoNeto: parseMonto(fila[c.montoNeto]),
    montoIVA: parseMonto(fila[c.montoIVA]),
    montoTotal: parseMonto(fila[c.montoTotal]),
    tipoDoc: Number(fila[c.tipoDoc]) || 0,
    fechaDocto: fila[c.fechaDocto] || '',
    fechaReclamo: c.fechaReclamo ? (fila[c.fechaReclamo] || '') : '',
    // El export ya viene filtrado por estadoContab=REGISTRO en la consulta,
    // no trae una columna de estado explícita por documento.
    estadoDocumento: 'REGISTRO',
    // Todas las columnas con monto detectadas, con su nombre de columna SII
    // original como clave — base para reportes de gestión (IVA no
    // recuperable, uso común, activo fijo, etc.) sin depender de mapeos
    // adivinados.
    montos,
    // Fila cruda completa tal como la entregó el SII (fechas de recepción/
    // acuse, documento de referencia, código sucursal, etc.) — nada se
    // descarta aunque no tenga un campo normalizado propio arriba.
    detalleSII: fila,
  }
}

function extraerDocumentos(json, tipo) {
  if (!json || !Array.isArray(json.data)) return []
  return parsearFilasCSV(json.data).map((fila) => normalizarFila(fila, tipo))
}

async function consultarDetalleRCV(jar, token, rut, tipo, periodo, pagina = null) {
  const { cuerpo, dv } = parseRut(rut)
  const metodo = METODOS[tipo]
  const operacion = OPERACIONES[tipo]
  if (!metodo) throw new Error(`Tipo RCV inválido: ${tipo}`)

  const body = {
    metaData: {
      namespace: `cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/${metodo}`,
      conversationId: token,
      transactionId: crypto.randomUUID(),
      page: pagina,
    },
    data: {
      rutEmisor: cuerpo,
      dvEmisor: dv,
      ptributario: periodo,
      operacion,
      estadoContab: 'REGISTRO',
      codTipoDoc: '0',
      busquedaInicial: pagina === null,
    },
  }

  const url = `${SII_RCV_UI}/services/data/facadeService/${metodo}`
  const res = await fetchConCookies(
    url,
    {
      method: 'POST',
      headers: siiFacadeHeaders(),
      body: JSON.stringify(body),
    },
    jar
  )

  console.log(`[SII] ${metodo} (${periodo}) → HTTP ${res.status}`)

  if (res.status === 401) throw new Error('Sesión SII expirada')
  if (!res.ok) {
    const raw = await res.text()
    console.log(`[SII] ${metodo} error, cuerpo (primeros 300 chars): ${raw.slice(0, 300)}`)
    throw new Error(`Error SII: HTTP ${res.status}`)
  }

  const rawText = await res.text()
  let json
  try {
    json = JSON.parse(rawText)
  } catch {
    console.log(`[SII] ${metodo} respuesta no-JSON (primeros 300 chars): ${rawText.slice(0, 300)}`)
    throw new Error('SII devolvió una respuesta inesperada (no-JSON) — probablemente la sesión no es válida')
  }

  if (json?.respEstado?.codRespuesta && json.respEstado.codRespuesta !== 0) {
    const msg = json.respEstado.msgeRespuesta || json.respEstado.codError
    console.log(`[SII] ${metodo} respEstado no-ok: ${JSON.stringify(json.respEstado)}`)
    if (String(msg).toLowerCase().includes('autentic')) {
      throw new Error('Sesión SII expirada')
    }
    throw new Error(msg || 'Error al consultar RCV en SII')
  }

  const filas = Array.isArray(json?.data) ? json.data.length - 1 : 0
  console.log(`[SII] ${metodo} (${periodo}) → ${Math.max(filas, 0)} documentos`)

  return json
}

async function consultarRCV(rut, clave, tipo, periodo, reintento = false) {
  await esperarRateLimit()

  try {
    const { jar, token } = await obtenerSesion(rut, clave)
    const json = await consultarDetalleRCV(jar, token, rut, tipo, periodo)
    let docs = extraerDocumentos(json, tipo)

    const totalPaginas = json?.metaData?.page?.totalPages || 1
    const paginaActual = json?.metaData?.page?.pageNro || 1

    if (totalPaginas > paginaActual) {
      for (let p = paginaActual + 1; p <= totalPaginas; p++) {
        await esperarRateLimit()
        const next = await consultarDetalleRCV(jar, token, rut, tipo, periodo, {
          pageNro: p,
          totalPages: totalPaginas,
        })
        docs = docs.concat(extraerDocumentos(next, tipo))
      }
    }

    return docs
  } catch (err) {
    if (!reintento && (err.message.includes('Sesión') || err.message.includes('expirada'))) {
      invalidarSesion(rut)
      return consultarRCV(rut, clave, tipo, periodo, true)
    }
    if (err.message.includes('Clave SII')) throw err
    if (err.name === 'TimeoutError') throw new Error('Timeout — reintentar')
    throw err
  }
}

// Resumen por tipo de documento — el mismo que arma SII en su propia pantalla
// (getResumen). Usamos esto como fuente de verdad para "cuadrar", en vez de
// re-sumar nosotros mismos el detalle línea a línea.
async function consultarResumen(rut, clave, periodo, tipo, reintento = false) {
  await esperarRateLimit()
  const operacion = OPERACIONES[tipo]
  if (!operacion) throw new Error(`Tipo RCV inválido: ${tipo}`)

  // Cache para períodos cerrados (no el mes actual)
  const cerrado = periodoCerrado(periodo)
  if (cerrado) {
    const cacheKey = `resumen:${rut}:${periodo}:${tipo}`
    const cached = obtenerDeCache('cache', periodo, cacheKey) || obtenerDeCache(rut, periodo, cacheKey)
    if (cached) return cached
  }

  try {
    const { jar, token } = await obtenerSesion(rut, clave)
    const { cuerpo, dv } = parseRut(rut)

    const body = {
      metaData: {
        namespace: 'cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getResumen',
        conversationId: token,
        transactionId: crypto.randomUUID(),
        page: null,
      },
      data: {
        rutEmisor: cuerpo,
        dvEmisor: dv,
        ptributario: periodo,
        estadoContab: 'REGISTRO',
        operacion,
        busquedaInicial: true,
      },
    }

    const url = `${SII_RCV_UI}/services/data/facadeService/getResumen`
    const res = await fetchConCookies(
      url,
      { method: 'POST', headers: siiFacadeHeaders(), body: JSON.stringify(body) },
      jar
    )

    console.log(`[SII] getResumen (${tipo}, ${periodo}) → HTTP ${res.status}`)
    if (res.status === 401) throw new Error('Sesión SII expirada')
    if (!res.ok) throw new Error(`Error SII: HTTP ${res.status}`)

    const json = await res.json()
    if (json?.respEstado?.codRespuesta && json.respEstado.codRespuesta !== 0) {
      const msg = json.respEstado.msgeRespuesta || json.respEstado.codError
      if (String(msg).toLowerCase().includes('autentic')) throw new Error('Sesión SII expirada')
      throw new Error(msg || 'Error al consultar resumen RCV en SII')
    }

    if (!Array.isArray(json.data)) return []

    const result = json.data.map((r) => ({
      tipoDoc: r.rsmnTipoDocInteger,
      nombreTipoDoc: r.dcvNombreTipoDoc || '',
      cantidad: r.rsmnTotDoc || 0,
      exento: r.rsmnMntExe || 0,
      neto: r.rsmnMntNeto || 0,
      iva: r.rsmnMntIVA || 0,
      ivaUsoComun: r.rsmnIVAUsoComun || 0,
      ivaNoRecuperable: r.rsmnMntIVANoRec || 0,
      total: r.rsmnMntTotal || 0,
    }))

    if (cerrado) {
      guardarEnCache(rut, periodo, `resumen:${tipo}`, result)
    }

    return result
  } catch (err) {
    if (!reintento && (err.message.includes('Sesión') || err.message.includes('expirada'))) {
      invalidarSesion(rut)
      return consultarResumen(rut, clave, periodo, tipo, true)
    }
    throw err
  }
}

async function probarConexion(rut, clave) {
  const pasos = []
  try {
    pasos.push({ paso: 'login', estado: 'iniciando' })
    const { jar, token } = await obtenerSesion(rut, clave)
    pasos[0] = { paso: 'login', estado: 'ok', detalle: 'Sesión SII obtenida' }

    const ahora = new Date()
    const periodo = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}`

    pasos.push({ paso: 'rcv_compras', estado: 'iniciando', periodo })
    const compras = await consultarRCV(rut, clave, 'compras', periodo)
    pasos[1] = {
      paso: 'rcv_compras',
      estado: 'ok',
      periodo,
      documentos: compras.length,
    }

    pasos.push({ paso: 'rcv_ventas', estado: 'iniciando', periodo })
    const ventas = await consultarRCV(rut, clave, 'ventas', periodo)
    pasos[2] = {
      paso: 'rcv_ventas',
      estado: 'ok',
      periodo,
      documentos: ventas.length,
    }

    return {
      ok: true,
      proveedor: 'sii',
      periodo,
      compras: compras.length,
      ventas: ventas.length,
      pasos,
      portal_rcv: `${SII_RCV_UI}/#/index`,
    }
  } catch (err) {
    invalidarSesion(rut)
    pasos.push({ paso: 'error', estado: 'error', detalle: err.message })
    return { ok: false, error: err.message, pasos, proveedor: 'sii' }
  }
}

module.exports = { consultarRCV, consultarResumen, probarConexion }
