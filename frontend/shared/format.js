/**
 * Helpers de formato compartidos por toda la app.
 * Se carga como <script src="/shared/format.js"></script> (variable global, sin módulos ES
 * para poder abrir cada página con doble clic / file:// si hace falta y no complicar el build).
 */
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

const NOMBRES_TIPO_DOC = {
  30: 'Factura', 32: 'Factura de Ventas y Servicios No Afectos o Exentos de IVA',
  33: 'Factura Electrónica', 34: 'Factura no Afecta o Exenta Electrónica',
  39: 'Boleta Electrónica', 41: 'Boleta no Afecta o Exenta Electrónica',
  43: 'Liquidación Factura Electrónica', 46: 'Factura de Compra Electrónica',
  52: 'Guía de Despacho Electrónica', 56: 'Nota de Débito Electrónica',
  60: 'Nota de Crédito', 61: 'Nota de Crédito Electrónica',
}

function fmt(monto) {
  return '$' + Math.round(monto || 0).toLocaleString('es-CL')
}

function fmtCorto(monto) {
  const abs = Math.abs(monto || 0)
  if (abs >= 1e9) return (monto / 1e9).toFixed(1) + 'MM$'
  if (abs >= 1e6) return (monto / 1e6).toFixed(1) + 'M$'
  if (abs >= 1e3) return (monto / 1e3).toFixed(0) + 'K$'
  return fmt(monto)
}

function formatRut(rut) {
  if (!rut) return ''
  const clean = String(rut).replace(/[.\-\s]/g, '')
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1)
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}

function validarRut(rut) {
  const clean = String(rut).replace(/[.\-]/g, '')
  if (clean.length < 8 || clean.length > 9) return false
  const body = clean.slice(0, -1)
  const dv = clean.slice(-1).toUpperCase()

  let suma = 0
  let multiplo = 2
  for (let i = body.length - 1; i >= 0; i--) {
    suma += parseInt(body[i], 10) * multiplo
    multiplo = multiplo < 7 ? multiplo + 1 : 2
  }
  const dvEsperado = 11 - (suma % 11)
  const dvCalc = dvEsperado === 11 ? '0' : dvEsperado === 10 ? 'K' : String(dvEsperado)
  return dv === dvCalc
}

function formatTelefono(tel) {
  if (!tel) return ''
  const clean = String(tel).replace(/\D/g, '')
  if (clean.startsWith('56') && clean.length >= 11) {
    const rest = clean.slice(2)
    return `+56 ${rest[0]} ${rest.slice(1, 5)} ${rest.slice(5)}`
  }
  return tel
}

function formatPpm(tasa) {
  return `${(tasa * 100).toFixed(1).replace(/\.0$/, '')}%`
}

function periodoDisplay(periodo) {
  const mes = Number(String(periodo).slice(4, 6))
  const anio = String(periodo).slice(0, 4)
  return `${MESES[mes - 1] || ''} ${anio}`
}

function periodoDesde(anio, mes) {
  return `${anio}${String(mes).padStart(2, '0')}`
}

function nombreTipoDoc(tipoDoc) {
  return NOMBRES_TIPO_DOC[Number(tipoDoc)] || `Tipo ${tipoDoc}`
}

const TIPOS_NOTA_CREDITO = new Set([60, 61])

/**
 * Devuelve el documento con neto/IVA/total/exento en negativo si es Nota de
 * Crédito — así al sumar la columna en Excel o en la grilla el resultado ya
 * queda neteado, sin tener que recordar que las NC restan. Solo se usa en
 * vistas de detalle documento a documento (Libro); el resumen por tipo de
 * documento sigue mostrando los montos tal cual los entrega el SII, para que
 * calce visualmente con la pantalla del SII.
 */
function conSignoNC(doc) {
  const signo = TIPOS_NOTA_CREDITO.has(Number(doc.tipoDoc)) ? -1 : 1
  const montos = {}
  for (const [k, v] of Object.entries(doc.montos || {})) montos[k] = signo * v
  return {
    ...doc,
    montoExento: signo * (doc.montoExento || 0),
    montoNeto: signo * (doc.montoNeto || 0),
    montoIVA: signo * (doc.montoIVA || 0),
    montoTotal: signo * (doc.montoTotal || 0),
    montos,
  }
}

function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str == null ? '' : String(str)
  return div.innerHTML
}
