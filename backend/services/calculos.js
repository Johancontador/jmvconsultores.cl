const TIPOS_FACTURA = new Set([30, 33, 34, 39, 41, 43, 46])
const TIPO_NOTA_DEBITO = 56
const TIPO_NOTA_CREDITO = 61
const TIPOS_NOTA_CREDITO = new Set([60, 61]) // 60: NC manual, 61: NC electrónica

// Una Nota de Crédito corrige (reduce) un documento anterior — debe restar del
// neto/IVA/total, no sumar. Si se suma como si fuera una venta o compra más,
// el IVA determinado y los netos quedan sobrestimados frente al F29 real.
function sumarDocumentos(docs) {
  if (!docs || docs.length === 0) {
    return { neto: 0, iva: 0, total: 0 }
  }
  return docs.reduce((acc, doc) => {
    const signo = TIPOS_NOTA_CREDITO.has(Number(doc.tipoDoc)) ? -1 : 1
    return {
      neto: acc.neto + signo * (doc.montoNeto || 0),
      iva: acc.iva + signo * (doc.montoIVA || 0),
      total: acc.total + signo * (doc.montoTotal || 0),
    }
  }, { neto: 0, iva: 0, total: 0 })
}

function categorizarVentas(docs) {
  const categorias = {
    facturas: 0,
    notas_debito: 0,
    notas_credito: 0,
    otros: 0,
  }

  for (const doc of docs || []) {
    const tipo = Number(doc.tipoDoc)
    const neto = doc.montoNeto || 0
    if (TIPOS_FACTURA.has(tipo)) categorias.facturas += neto
    else if (tipo === TIPO_NOTA_DEBITO) categorias.notas_debito += neto
    else if (TIPOS_NOTA_CREDITO.has(tipo)) categorias.notas_credito += neto
    else categorias.otros += neto
  }

  return categorias
}

function categorizarCompras(docs) {
  const categorias = {
    facturas: 0,
    notas_credito: 0,
    otros: 0,
  }

  for (const doc of docs || []) {
    const tipo = Number(doc.tipoDoc)
    const neto = doc.montoNeto || 0
    if (TIPOS_FACTURA.has(tipo)) categorias.facturas += neto
    else if (tipo === TIPO_NOTA_CREDITO) categorias.notas_credito += neto
    else categorias.otros += neto
  }

  return categorias
}

// Agrupa documentos por RUT contraparte (cliente en ventas, proveedor en
// compras) — base para reportes "Top clientes" / "Top proveedores". Las NC
// restan del total de esa contraparte, igual que en sumarDocumentos.
function agruparPorContraparte(docs) {
  const porRut = new Map()
  for (const doc of docs || []) {
    const rut = doc.rutDoc || 'Sin RUT'
    const signo = TIPOS_NOTA_CREDITO.has(Number(doc.tipoDoc)) ? -1 : 1
    const actual = porRut.get(rut) || { rut, razonSocial: doc.razonSocial || '', neto: 0, iva: 0, total: 0, cantidad: 0 }
    actual.neto += signo * (doc.montoNeto || 0)
    actual.iva += signo * (doc.montoIVA || 0)
    actual.total += signo * (doc.montoTotal || 0)
    actual.cantidad += 1
    if (!actual.razonSocial && doc.razonSocial) actual.razonSocial = doc.razonSocial
    porRut.set(rut, actual)
  }
  return [...porRut.values()]
}

/** Combina un array de resultados de agruparPorContraparte (de distintos meses) en uno solo. */
function combinarContrapartes(listas) {
  const porRut = new Map()
  for (const lista of listas) {
    for (const c of lista) {
      const actual = porRut.get(c.rut) || { rut: c.rut, razonSocial: c.razonSocial, neto: 0, iva: 0, total: 0, cantidad: 0 }
      actual.neto += c.neto
      actual.iva += c.iva
      actual.total += c.total
      actual.cantidad += c.cantidad
      if (!actual.razonSocial && c.razonSocial) actual.razonSocial = c.razonSocial
      porRut.set(c.rut, actual)
    }
  }
  return [...porRut.values()].sort((a, b) => b.neto - a.neto)
}

function calcularMargen(ventasNeto, comprasNeto) {
  const margen = ventasNeto - comprasNeto
  const pct =
    ventasNeto > 0 ? Math.round((margen / ventasNeto) * 1000) / 10 : 0
  return { margen, pct }
}

function calcularIVA(ventasIva, comprasIva) {
  return ventasIva - comprasIva
}

function calcularPPM(ventasNeto, tasa) {
  return ventasNeto * tasa
}

function calcularTotalF29(ivaPagar, ppmMonto) {
  if (ivaPagar < 0) return ppmMonto
  return ivaPagar + ppmMonto
}

function fmt(monto) {
  if (monto === null || monto === undefined || !Number.isFinite(monto)) return '$0'
  return '$' + Math.round(monto).toLocaleString('es-CL')
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function nombreMes(mes) {
  return MESES[mes - 1] || ''
}

function periodoDesde(anio, mes) {
  return `${anio}${String(mes).padStart(2, '0')}`
}

// mesInicio/mesFin son opcionales (por compatibilidad): si no vienen, se
// asume todo el año (1 a 12), igual que el comportamiento anterior.
function generarPeriodos(anioInicio, anioFin, mesInicio = 1, mesFin = 12) {
  const ahora = new Date()
  const anioActual = ahora.getFullYear()
  const mesActual = ahora.getMonth() + 1
  const periodos = []

  for (let anio = anioInicio; anio <= anioFin; anio++) {
    const mesDesde = anio === anioInicio ? mesInicio : 1
    let mesHasta = anio === anioFin ? mesFin : 12
    if (anio === anioActual) mesHasta = Math.min(mesHasta, mesActual) // nunca pedir meses futuros
    for (let mes = mesDesde; mes <= mesHasta; mes++) {
      periodos.push({ anio, mes, periodo: periodoDesde(anio, mes) })
    }
  }

  return periodos
}

module.exports = {
  sumarDocumentos,
  agruparPorContraparte,
  combinarContrapartes,
  categorizarVentas,
  categorizarCompras,
  calcularMargen,
  calcularIVA,
  calcularPPM,
  calcularTotalF29,
  fmt,
  nombreMes,
  periodoDesde,
  generarPeriodos,
  MESES,
  TIPOS_FACTURA,
  TIPO_NOTA_DEBITO,
  TIPO_NOTA_CREDITO,
  TIPOS_NOTA_CREDITO,
}
