const db = require('../db')
const { consultarRCV } = require('./rcv')
const {
  sumarDocumentos,
  calcularIVA,
  calcularPPM,
  calcularTotalF29,
} = require('./calculos')

const procesos = new Map()

function crearProcesoId() {
  return `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatPeriodoDisplay(periodo) {
  const mes = periodo.slice(4, 6)
  const anio = periodo.slice(0, 4)
  return `${mes}-${anio}`
}

function generarMensajeWhatsApp(cliente, datos, periodo) {
  const p = formatPeriodoDisplay(periodo)
  const signo = datos.iva_pagar < 0 ? 'REMANENTE' : 'IVA a pagar'
  const ivaDisplay = Math.abs(datos.iva_pagar)
  const fmt = (m) => '$' + Math.round(m).toLocaleString('es-CL')

  if (cliente.exento) {
    return `Hola ${cliente.nombre} 👋

A continuación le envío información correspondiente a la declaración de IVA del período ${p}:

📦 COMPRAS DEL MES
  Neto:    ${fmt(datos.compras_neto)}
  IVA:     ${fmt(datos.compras_iva)}
  Total:   ${fmt(datos.compras_total)}

🧾 VENTAS DEL MES
  Neto:    ${fmt(datos.ventas_neto)}
  IVA:     ${fmt(datos.ventas_iva)}
  Total:   ${fmt(datos.ventas_total)}

Cliente exento de IVA — sin impuesto determinado.

💰 TOTAL A PAGAR F29: ${fmt(0)}

Saludos,
${process.env.NOMBRE_CONTADOR || 'Contador'}`
  }

  return `Hola ${cliente.nombre} 👋

A continuación le envío información correspondiente a la declaración de IVA del período ${p}:

📦 COMPRAS DEL MES
  Neto:    ${fmt(datos.compras_neto)}
  IVA:     ${fmt(datos.compras_iva)}
  Total:   ${fmt(datos.compras_total)}

🧾 VENTAS DEL MES
  Neto:    ${fmt(datos.ventas_neto)}
  IVA:     ${fmt(datos.ventas_iva)}
  Total:   ${fmt(datos.ventas_total)}

📊 IMPUESTO DETERMINADO
  Débito fiscal:    ${fmt(datos.debito_fiscal)}
  Crédito fiscal:  -${fmt(datos.credito_fiscal)}
  ${signo}:         ${fmt(ivaDisplay)}

💼 PPM (${(cliente.tasa_ppm * 100).toFixed(1)}%)
  Monto PPM:        ${fmt(datos.ppm_monto)}

💰 TOTAL A PAGAR F29: ${fmt(datos.total_f29)}

Saludos,
${process.env.NOMBRE_CONTADOR || 'Contador'}`
}

function calcularResultado(cliente, ventasDocs, comprasDocs) {
  const ventas = sumarDocumentos(ventasDocs)
  const compras = sumarDocumentos(comprasDocs)

  if (cliente.exento) {
    return {
      ventas_neto: ventas.neto,
      ventas_iva: ventas.iva,
      ventas_total: ventas.total,
      compras_neto: compras.neto,
      compras_iva: compras.iva,
      compras_total: compras.total,
      debito_fiscal: 0,
      credito_fiscal: 0,
      iva_pagar: 0,
      ppm_monto: 0,
      total_f29: 0,
    }
  }

  const debito_fiscal = ventas.iva
  const credito_fiscal = compras.iva
  const iva_pagar = calcularIVA(ventas.iva, compras.iva)
  const ppm_monto = calcularPPM(ventas.neto, cliente.tasa_ppm)
  const total_f29 =
    iva_pagar < 0 ? ppm_monto : calcularTotalF29(iva_pagar, ppm_monto)

  return {
    ventas_neto: ventas.neto,
    ventas_iva: ventas.iva,
    ventas_total: ventas.total,
    compras_neto: compras.neto,
    compras_iva: compras.iva,
    compras_total: compras.total,
    debito_fiscal,
    credito_fiscal,
    iva_pagar,
    ppm_monto,
    total_f29,
  }
}

function guardarProcesoBD(periodo, clienteId, datos, estado, errorMsg = null) {
  db.prepare(
    `INSERT INTO procesos (
      periodo, cliente_id, ventas_neto, ventas_iva, ventas_total,
      compras_neto, compras_iva, compras_total, iva_determinado,
      ppm_monto, total_pagar, estado, error_msg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    periodo,
    clienteId,
    datos?.ventas_neto || 0,
    datos?.ventas_iva || 0,
    datos?.ventas_total || 0,
    datos?.compras_neto || 0,
    datos?.compras_iva || 0,
    datos?.compras_total || 0,
    datos?.iva_pagar || 0,
    datos?.ppm_monto || 0,
    datos?.total_f29 || 0,
    estado,
    errorMsg
  )
}

function toResultado(cliente, datos, periodo, estado, errorMsg = null) {
  const base = {
    cliente_id: cliente.id,
    nombre: cliente.nombre,
    rut: cliente.rut,
    telefono: cliente.telefono,
    exento: cliente.exento === 1,
    estado,
    error_msg: errorMsg,
  }
  if (estado !== 'ok') return base
  return {
    ...base,
    ...datos,
    mensaje_whatsapp: generarMensajeWhatsApp(cliente, datos, periodo),
  }
}

async function procesarUnCliente(cliente, periodo) {
  const ventasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'ventas', periodo)
  const comprasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'compras', periodo)
  const datos = calcularResultado(cliente, ventasDocs, comprasDocs)
  guardarProcesoBD(periodo, cliente.id, datos, 'ok')
  return toResultado(cliente, datos, periodo, 'ok')
}

async function ejecutarProceso(procesoId, periodo, userId) {
  const estado = procesos.get(procesoId)
  if (!estado) return

  const clientes = db
    .prepare(
      `SELECT id, rut, nombre, clave_sii, tasa_ppm, telefono, exento
       FROM clientes WHERE activo = 1 AND user_id = ? ORDER BY nombre`
    )
    .all(userId)

  estado.total = clientes.length
  estado.periodo = periodo

  for (let i = 0; i < clientes.length; i++) {
    const cliente = clientes[i]
    estado.procesando = cliente.nombre

    try {
      const resultado = await procesarUnCliente(cliente, periodo)
      estado.resultados.push(resultado)
    } catch (err) {
      guardarProcesoBD(periodo, cliente.id, null, 'error', err.message)
      estado.resultados.push(toResultado(cliente, null, periodo, 'error', err.message))
    }

    estado.procesados = i + 1
  }

  estado.estado = 'completado'
  estado.procesando = null
}

function iniciarProceso(periodo, userId) {
  const clientes = db
    .prepare(`SELECT id, nombre FROM clientes WHERE activo = 1 AND user_id = ? ORDER BY nombre`)
    .all(userId)

  const procesoId = crearProcesoId()
  procesos.set(procesoId, {
    id: procesoId,
    userId,
    estado: 'procesando',
    periodo,
    total: clientes.length,
    procesados: 0,
    procesando: null,
    resultados: [],
  })

  ejecutarProceso(procesoId, periodo, userId).catch((err) => {
    const e = procesos.get(procesoId)
    if (e) {
      e.estado = 'error'
      e.error_msg = err.message
    }
  })

  return { procesoId, clientes }
}

async function reintentarCliente(clienteId, periodo, userId) {
  const cliente = db
    .prepare(
      `SELECT id, rut, nombre, clave_sii, tasa_ppm, telefono, exento
       FROM clientes WHERE id = ? AND activo = 1 AND user_id = ?`
    )
    .get(clienteId, userId)

  if (!cliente) throw new Error('Cliente no encontrado')

  try {
    const resultado = await procesarUnCliente(cliente, periodo)
    return resultado
  } catch (err) {
    guardarProcesoBD(periodo, cliente.id, null, 'error', err.message)
    return toResultado(cliente, null, periodo, 'error', err.message)
  }
}

function obtenerEstado(procesoId, userId) {
  const estado = procesos.get(procesoId)
  if (!estado || estado.userId !== userId) return null
  return {
    id: estado.id,
    estado: estado.estado,
    periodo: estado.periodo,
    total: estado.total,
    procesados: estado.procesados,
    procesando: estado.procesando,
    resultados: estado.resultados,
    error_msg: estado.error_msg,
  }
}

module.exports = {
  iniciarProceso,
  obtenerEstado,
  reintentarCliente,
  generarMensajeWhatsApp,
}
