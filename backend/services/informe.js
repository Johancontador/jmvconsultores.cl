const db = require('../db')
const { consultarRCV } = require('./rcv')
const {
  sumarDocumentos,
  agruparPorContraparte,
  categorizarVentas,
  categorizarCompras,
  calcularMargen,
  calcularIVA,
  generarPeriodos,
  nombreMes,
  fmt,
} = require('./calculos')

const informes = new Map()

// Columns fetched by listarInformesDeBD
const INFORME_LISTA_COLUMNS = 'id, cliente_id, cliente_nombre, cliente_rut, anio_inicio, anio_fin, mes_inicio, mes_fin, modo, estado, total_meses, consultas_estimadas, resumen_json, creado_en'

function crearInformeId() {
  return `inf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ============ PERSISTENCIA DE INFORMES ============

function guardarInformeEnBD(informe) {
  const stmtInforme = db.prepare(`
    INSERT INTO informes (id, user_id, cliente_id, anio_inicio, anio_fin, mes_inicio, mes_fin, modo, estado, total_meses, consultas_estimadas, cliente_nombre, cliente_rut, resumen_json, observaciones_json, creado_en, completado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      estado = excluded.estado,
      total_meses = excluded.total_meses,
      resumen_json = excluded.resumen_json,
      observaciones_json = excluded.observaciones_json,
      completado_en = datetime('now')
  `)

  const stmtMes = db.prepare(`
    INSERT INTO informe_meses (informe_id, anio, mes, periodo, mes_nombre, ventas_neto, ventas_iva, compras_neto, compras_iva, margen, pct_margen, debito_fiscal, credito_fiscal, iva_pagar, estado, error_msg, detalle_ventas_json, detalle_compras_json, docs_ventas, docs_compras, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(informe_id, periodo) DO UPDATE SET
      ventas_neto = excluded.ventas_neto,
      ventas_iva = excluded.ventas_iva,
      compras_neto = excluded.compras_neto,
      compras_iva = excluded.compras_iva,
      margen = excluded.margen,
      pct_margen = excluded.pct_margen,
      debito_fiscal = excluded.debito_fiscal,
      credito_fiscal = excluded.credito_fiscal,
      iva_pagar = excluded.iva_pagar,
      estado = excluded.estado,
      error_msg = excluded.error_msg,
      detalle_ventas_json = excluded.detalle_ventas_json,
      detalle_compras_json = excluded.detalle_compras_json,
      docs_ventas = excluded.docs_ventas,
      docs_compras = excluded.docs_compras, actualizado_en = datetime('now')
  `)

  const stmtTop = db.prepare(`
    INSERT INTO informe_top_contrapartes (informe_id, tipo, rut, razon_social, cantidad, neto, iva, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const stmtRecl = db.prepare(`
    INSERT INTO informe_reclamadas (informe_id, mes_nombre, anio, periodo, folio, razon_social, rut_doc, fecha_docto, monto_neto, monto_iva, monto_total, fecha_reclamo)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Detalle documento a documento: la tabla informe_documentos existía en el
  // esquema pero nunca se escribía — cargarInformeDeBD intentaba reconstruir
  // los documentos desde detalle_*_json (que guarda un resumen por categorías,
  // un OBJETO, no un array) y revientaba con "docs is not iterable" al cargar
  // cualquier informe en modo detalle. Aquí se persiste la fuente de verdad.
  const stmtDoc = db.prepare(`
    INSERT INTO informe_documentos (informe_id, tipo, periodo, anio, mes, mes_nombre, folio, rut_doc, razon_social, monto_exento, monto_neto, monto_iva, monto_total, tipo_doc, fecha_docto, fecha_reclamo, estado_documento, montos_json, detalle_sii_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertarDocs = (tipo, docs) => {
    for (const d of docs || []) {
      // mes/anio se derivan del periodo (AAAAMM) si el documento no los trae —
      // la tabla exige NOT NULL y hay rutas que solo etiquetan periodo.
      const periodo = d.periodo || null
      const anio = d.anio ?? (periodo ? Number(String(periodo).slice(0, 4)) : null)
      const mes = d.mes ?? (periodo ? Number(String(periodo).slice(4, 6)) : null)
      stmtDoc.run(
        informe.id, tipo, periodo, anio, mes, d.mes_nombre || null,
        String(d.folio ?? ''), d.rutDoc || null, d.razonSocial || null,
        d.montoExento || 0, d.montoNeto || 0, d.montoIVA || 0, d.montoTotal || 0,
        d.tipoDoc || 0, d.fechaDocto || null, d.fechaReclamo || null,
        d.estadoDocumento || 'REGISTRO',
        JSON.stringify(d.montos || {}), JSON.stringify(d.detalleSII || {})
      )
    }
  }

  const tx = db.transaction(() => {
    // El detalle se reescribe completo en cada guardado (el informe puede
    // regenerarse con rango distinto) — sin delete, se acumularían duplicados.
    db.prepare(`DELETE FROM informe_documentos WHERE informe_id = ?`).run(informe.id)
    stmtInforme.run(
      informe.id,
      informe.userId,
      informe.cliente?.id || null,
      informe.anio_inicio,
      informe.anio_fin,
      informe.mes_inicio,
      informe.mes_fin,
      informe.modo,
      informe.estado,
      informe.total,
      informe.consultas_estimadas,
      informe.cliente?.nombre || null,
      informe.cliente?.rut || null,
      informe.resumen ? JSON.stringify(informe.resumen) : null,
      informe.observaciones ? JSON.stringify(informe.observaciones) : null
    )

    if (informe.meses && informe.meses.length) {
      for (const m of informe.meses) {
        stmtMes.run(
          informe.id, m.anio, m.mes, m.periodo, m.mes_nombre,
          m.ventas_neto || 0, m.ventas_iva || 0, m.compras_neto || 0, m.compras_iva || 0,
          m.margen || 0, m.pct_margen || 0, m.debito_fiscal || 0, m.credito_fiscal || 0, m.iva_pagar || 0,
          m.estado || 'ok', m.error_msg || null,
          m.detalle_ventas ? JSON.stringify(m.detalle_ventas) : null,
          m.detalle_compras ? JSON.stringify(m.detalle_compras) : null,
          m.documentos_ventas || 0, m.documentos_compras || 0,
          new Date().toISOString(), new Date().toISOString()
        )
      }
    }

    if (informe.top_clientes && informe.top_clientes.length) {
      for (const c of informe.top_clientes) {
        stmtTop.run(informe.id, 'cliente', c.rut, c.razonSocial, c.cantidad, c.neto, c.iva, c.total)
      }
    }
    if (informe.top_proveedores && informe.top_proveedores.length) {
      for (const c of informe.top_proveedores) {
        stmtTop.run(informe.id, 'proveedor', c.rut, c.razonSocial, c.cantidad, c.neto, c.iva, c.total)
      }
    }

    if (informe.documentos_reclamados && informe.documentos_reclamados.length) {
      for (const r of informe.documentos_reclamados) {
        stmtRecl.run(informe.id, r.mes_nombre, r.anio, r.periodo, r.folio, r.razonSocial, r.rutDoc, r.fechaDocto, r.montoNeto, r.montoIVA, r.montoTotal, r.fechaReclamo)
      }
    }

    insertarDocs('ventas', informe.documentos_ventas)
    insertarDocs('compras', informe.documentos_compras)
  })()
}

function cargarInformeDeBD(informeId, userId) {
  const row = db.prepare(`SELECT * FROM informes WHERE id = ? AND user_id = ?`).get(informeId, userId)
  if (!row) return null

  const meses = db.prepare(`SELECT * FROM informe_meses WHERE informe_id = ? ORDER BY anio, mes`).all(informeId)
  const topClientes = db.prepare(`SELECT rut, razon_social as razonSocial, cantidad, neto, iva, total FROM informe_top_contrapartes WHERE informe_id = ? AND tipo = 'cliente' ORDER BY neto DESC`).all(informeId)
  const topProveedores = db.prepare(`SELECT rut, razon_social as razonSocial, cantidad, neto, iva, total FROM informe_top_contrapartes WHERE informe_id = ? AND tipo = 'proveedor' ORDER BY neto DESC`).all(informeId)
  const reclamadas = db.prepare(`
    SELECT mes_nombre, anio, periodo, folio, razon_social as razonSocial, rut_doc as rutDoc,
           fecha_docto as fechaDocto, monto_neto as montoNeto, monto_iva as montoIVA,
           monto_total as montoTotal, fecha_reclamo as fechaReclamo
    FROM informe_reclamadas WHERE informe_id = ? ORDER BY anio, periodo
  `).all(informeId)

  // Documentos del rango: fuente de verdad es informe_documentos (escrita en
  // guardarInformeEnBD). Antes se intentaba reconstruirlos desde detalle_*_json
  // de informe_meses, que guarda un resumen por categorías (objeto), no un
  // array — reventaba con "docs is not iterable".
  const mapearDoc = (fila) => ({
    folio: fila.folio, rutDoc: fila.rut_doc, razonSocial: fila.razon_social,
    montoExento: fila.monto_exento, montoNeto: fila.monto_neto, montoIVA: fila.monto_iva,
    montoTotal: fila.monto_total, tipoDoc: fila.tipo_doc, fechaDocto: fila.fecha_docto,
    fechaReclamo: fila.fecha_reclamo || '', estadoDocumento: fila.estado_documento || 'REGISTRO',
    montos: fila.montos_json ? JSON.parse(fila.montos_json) : {},
    detalleSII: fila.detalle_sii_json ? JSON.parse(fila.detalle_sii_json) : {},
    periodo: fila.periodo, mes_nombre: fila.mes_nombre, anio: fila.anio,
  })
  const documentos_ventas = db.prepare(`SELECT * FROM informe_documentos WHERE informe_id = ? AND tipo = 'ventas' ORDER BY anio, mes, folio`).all(informeId).map(mapearDoc)
  const documentos_compras = db.prepare(`SELECT * FROM informe_documentos WHERE informe_id = ? AND tipo = 'compras' ORDER BY anio, mes, folio`).all(informeId).map(mapearDoc)

  return {
    id: row.id,
    userId: row.user_id,
    estado: row.estado,
    total: row.total_meses,
    procesados: row.total_meses,
    cliente: row.cliente_id ? { id: row.cliente_id, nombre: row.cliente_nombre, rut: row.cliente_rut } : null,
    anio_inicio: row.anio_inicio,
    anio_fin: row.anio_fin,
    mes_inicio: row.mes_inicio,
    mes_fin: row.mes_fin,
    modo: row.modo,
    meses: meses.map(m => ({
      anio: m.anio,
      mes: m.mes,
      periodo: m.periodo,
      mes_nombre: m.mes_nombre,
      ventas_neto: m.ventas_neto,
      ventas_iva: m.ventas_iva,
      compras_neto: m.compras_neto,
      compras_iva: m.compras_iva,
      margen: m.margen,
      pct_margen: m.pct_margen,
      debito_fiscal: m.debito_fiscal,
      credito_fiscal: m.credito_fiscal,
      iva_pagar: m.iva_pagar,
      estado: m.estado,
      error_msg: m.error_msg,
      detalle_ventas: m.detalle_ventas_json ? JSON.parse(m.detalle_ventas_json) : undefined,
      detalle_compras: m.detalle_compras_json ? JSON.parse(m.detalle_compras_json) : undefined,
      documentos_ventas: m.docs_ventas,
      documentos_compras: m.docs_compras,
    })),
    por_anio: [], // Se recalcula al cargar
    resumen: row.resumen_json ? JSON.parse(row.resumen_json) : null,
    observaciones: row.observaciones_json ? JSON.parse(row.observaciones_json) : [],
    top_clientes: topClientes,
    top_proveedores: topProveedores,
    documentos_reclamados: reclamadas,
    documentos_ventas,
    documentos_compras,
    error_msg: null,
    consultas_estimadas: row.consultas_estimadas,
  }
}

function listarInformesDeBD(userId, limit = 50, offset = 0, clienteId = null) {
  if (clienteId) {
    return db.prepare(`
      SELECT ${INFORME_LISTA_COLUMNS}
      FROM informes WHERE user_id = ? AND cliente_id = ? ORDER BY creado_en DESC LIMIT ? OFFSET ?
    `).all(userId, clienteId, limit, offset)
  }
  return db.prepare(`
    SELECT ${INFORME_LISTA_COLUMNS}
    FROM informes WHERE user_id = ? ORDER BY creado_en DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset)
}

function eliminarInformeDeBD(informeId, userId) {
  return db.prepare(`DELETE FROM informes WHERE id = ? AND user_id = ?`).run(informeId, userId)
}

function obtenerCliente(clienteId, userId) {
  return db
    .prepare(
      `SELECT id, rut, nombre, clave_sii FROM clientes WHERE id = ? AND activo = 1 AND user_id = ?`
    )
    .get(clienteId, userId)
}

async function procesarMes(cliente, periodoInfo, modo) {
  const { anio, mes, periodo } = periodoInfo

  const ventasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'ventas', periodo)
  const comprasDocs = await consultarRCV(cliente.rut, cliente.clave_sii, 'compras', periodo)

  const ventas = sumarDocumentos(ventasDocs)
  const compras = sumarDocumentos(comprasDocs)
  const { margen, pct } = calcularMargen(ventas.neto, compras.neto)
  const iva_pagar = calcularIVA(ventas.iva, compras.iva)

  const mesData = {
    anio,
    mes,
    periodo,
    mes_nombre: nombreMes(mes),
    ventas_neto: ventas.neto,
    ventas_iva: ventas.iva,
    compras_neto: compras.neto,
    compras_iva: compras.iva,
    margen,
    pct_margen: pct,
    debito_fiscal: ventas.iva,
    credito_fiscal: compras.iva,
    iva_pagar,
    estado: 'ok',
  }

  if (modo === 'detalle') {
    mesData.detalle_ventas = categorizarVentas(ventasDocs)
    mesData.detalle_compras = categorizarCompras(comprasDocs)
    mesData.documentos_ventas = ventasDocs.length
    mesData.documentos_compras = comprasDocs.length
  }

  return { mesData, ventasDocs, comprasDocs }
}

async function generarInforme(informeId, clienteId, anioInicio, anioFin, modo, mesInicio = 1, mesFin = 12, userId) {
  const estado = informes.get(informeId)
  if (!estado) return

  const cliente = obtenerCliente(clienteId, userId)
  if (!cliente) {
    estado.estado = 'error'
    estado.error_msg = 'Cliente no encontrado'
    return
  }

  const periodos = generarPeriodos(anioInicio, anioFin, mesInicio, mesFin)
  estado.total = periodos.length
  estado.cliente = { id: cliente.id, nombre: cliente.nombre, rut: cliente.rut }
  estado.anio_inicio = anioInicio
  estado.anio_fin = anioFin
  estado.mes_inicio = mesInicio
  estado.mes_fin = mesFin
  estado.modo = modo

  const todosVentasDocs = []
  const todosComprasDocs = []
  const reclamadas = []

  for (let i = 0; i < periodos.length; i++) {
    const p = periodos[i]
    estado.procesando = `${nombreMes(p.mes)} ${p.anio}`

    try {
      const { mesData, ventasDocs, comprasDocs } = await procesarMes(cliente, p, modo)
      estado.meses.push(mesData)

      // Se etiqueta cada documento con su período para poder agrupar/mostrar
      // "Mes" en el Centro de Reportes cuando se pide un rango de varios meses.
      const tag = (docs) => docs.map((d) => ({ ...d, periodo: p.periodo, mes: p.mes, mes_nombre: nombreMes(p.mes), anio: p.anio }))
      todosVentasDocs.push(...tag(ventasDocs))
      todosComprasDocs.push(...tag(comprasDocs))

      ventasDocs.filter((d) => d.fechaReclamo).forEach((d) => reclamadas.push({
        mes_nombre: nombreMes(p.mes), anio: p.anio, periodo: p.periodo,
        folio: d.folio, razonSocial: d.razonSocial, rutDoc: d.rutDoc,
        fechaDocto: d.fechaDocto, montoNeto: d.montoNeto, montoIVA: d.montoIVA,
        montoTotal: d.montoTotal, fechaReclamo: d.fechaReclamo,
      }))
    } catch (err) {
      estado.meses.push({
        anio: p.anio,
        mes: p.mes,
        periodo: p.periodo,
        mes_nombre: nombreMes(p.mes),
        estado: 'error',
        error_msg: err.message,
      })
    }

    estado.procesados = i + 1
    estado.por_anio = agruparPorAnio(estado.meses.filter((m) => m.estado === 'ok'))
    estado.resumen = calcularResumenGlobal(estado.meses.filter((m) => m.estado === 'ok'))
  }

  // Top clientes (de ventas) / top proveedores (de compras), agregado por RUT
  // contraparte a través de todo el rango de años consultado.
  estado.top_clientes = agruparPorContraparte(todosVentasDocs)
    .sort((a, b) => b.neto - a.neto)
    .slice(0, 20)
  estado.top_proveedores = agruparPorContraparte(todosComprasDocs)
    .sort((a, b) => b.neto - a.neto)
    .slice(0, 20)
  estado.documentos_reclamados = reclamadas
  // Documento a documento, todo el rango — para "Libro Compra"/"Libro Venta"
  // como reporte de rango en el Centro de Reportes (no solo un mes).
  estado.documentos_ventas = todosVentasDocs
  estado.documentos_compras = todosComprasDocs

  estado.estado = 'completado'
    estado.procesando = null
    estado.observaciones = generarObservaciones(estado)

    // Persistir en BD al completar
    guardarInformeEnBD(estado)
  }

function agruparPorAnio(meses) {
  const porAnio = {}

  for (const m of meses) {
    if (!porAnio[m.anio]) {
      porAnio[m.anio] = {
        anio: m.anio,
        meses: [],
        ventas_neto: 0,
        compras_neto: 0,
        margen: 0,
        pct_margen: 0,
        debito_fiscal: 0,
        credito_fiscal: 0,
        iva_pagar: 0,
      }
    }
    const g = porAnio[m.anio]
    g.meses.push(m)
    g.ventas_neto += m.ventas_neto
    g.compras_neto += m.compras_neto
    g.margen += m.margen
    g.debito_fiscal += m.debito_fiscal || 0
    g.credito_fiscal += m.credito_fiscal || 0
    g.iva_pagar += m.iva_pagar || 0
  }

  for (const g of Object.values(porAnio)) {
    g.pct_margen =
      g.ventas_neto > 0
        ? Math.round((g.margen / g.ventas_neto) * 1000) / 10
        : 0
  }

  return Object.values(porAnio).sort((a, b) => a.anio - b.anio)
}

function calcularResumenGlobal(meses) {
  const ventas = meses.reduce((s, m) => s + m.ventas_neto, 0)
  const compras = meses.reduce((s, m) => s + m.compras_neto, 0)
  const margen = ventas - compras
  const pct = ventas > 0 ? Math.round((margen / ventas) * 1000) / 10 : 0
  const debito_fiscal = meses.reduce((s, m) => s + (m.debito_fiscal || 0), 0)
  const credito_fiscal = meses.reduce((s, m) => s + (m.credito_fiscal || 0), 0)
  const iva_pagar = meses.reduce((s, m) => s + (m.iva_pagar || 0), 0)
  return { ventas_neto: ventas, compras_neto: compras, margen, pct_margen: pct, debito_fiscal, credito_fiscal, iva_pagar }
}

function generarObservaciones(estado) {
  const ok = estado.meses.filter((m) => m.estado === 'ok')
  if (ok.length === 0) return []

  const obs = []
  const mejorVenta = [...ok].sort((a, b) => b.ventas_neto - a.ventas_neto)[0]
  const menorVenta = [...ok].sort((a, b) => a.ventas_neto - b.ventas_neto)[0]
  const mejorMargen = [...ok].sort((a, b) => b.pct_margen - a.pct_margen)[0]
  const errores = estado.meses.filter((m) => m.estado === 'error')

  obs.push(
    `El mes con mayor volumen de ventas fue ${mejorVenta.mes_nombre} ${mejorVenta.anio} con ${fmt(mejorVenta.ventas_neto)}.`
  )
  obs.push(
    `El mes de menor venta fue ${menorVenta.mes_nombre} ${menorVenta.anio} con ${fmt(menorVenta.ventas_neto)}.`
  )
  obs.push(
    `El mejor margen mensual se obtuvo en ${mejorMargen.mes_nombre} ${mejorMargen.anio} con ${mejorMargen.pct_margen}%.`
  )
  obs.push(
    `El margen bruto acumulado del período es ${estado.resumen.pct_margen}%.`
  )

  if (errores.length > 0) {
    obs.push(`${errores.length} mes(es) no pudieron consultarse al SII.`)
  }

  obs.push(
    'Este informe no incluye gastos operacionales; el resultado final puede diferir del margen bruto aquí presentado.'
  )

  return obs
}

function iniciarInforme(clienteId, anioInicio, anioFin, modo = 'resumen', mesInicio = 1, mesFin = 12, userId) {
  const periodos = generarPeriodos(anioInicio, anioFin, mesInicio, mesFin)
  const consultasEstimadas = periodos.length * 2

  const informeId = crearInformeId()
  informes.set(informeId, {
    id: informeId,
    userId,
    estado: 'procesando',
    total: periodos.length,
    procesados: 0,
    procesando: null,
    consultas_estimadas: consultasEstimadas,
    meses: [],
    por_anio: [],
    resumen: null,
    observaciones: [],
    top_clientes: [],
    top_proveedores: [],
    documentos_reclamados: [],
    documentos_ventas: [],
    documentos_compras: [],
    cliente: null,
    anio_inicio: anioInicio,
    anio_fin: anioFin,
    mes_inicio: mesInicio,
    mes_fin: mesFin,
    modo,
    error_msg: null,
  })

  generarInforme(informeId, clienteId, anioInicio, anioFin, modo, mesInicio, mesFin, userId).catch((err) => {
      const e = informes.get(informeId)
      if (e) {
        e.estado = 'error'
        e.error_msg = err.message
        // Persistir error en BD
        guardarInformeEnBD(e)
      }
    })

  return { informeId, consultasEstimadas, totalMeses: periodos.length }
}

function obtenerEstado(informeId, userId) {
  const estado = informes.get(informeId)
  if (!estado || estado.userId !== userId) return null

  return {
    id: estado.id,
    estado: estado.estado,
    total: estado.total,
    procesados: estado.procesados,
    procesando: estado.procesando,
    consultas_estimadas: estado.consultas_estimadas,
    cliente: estado.cliente,
    anio_inicio: estado.anio_inicio,
    anio_fin: estado.anio_fin,
    mes_inicio: estado.mes_inicio,
    mes_fin: estado.mes_fin,
    modo: estado.modo,
    meses: estado.meses,
    por_anio: estado.por_anio,
    resumen: estado.resumen,
    observaciones: estado.observaciones,
    top_clientes: estado.top_clientes || [],
    top_proveedores: estado.top_proveedores || [],
    documentos_reclamados: estado.documentos_reclamados || [],
    documentos_ventas: estado.documentos_ventas || [],
    documentos_compras: estado.documentos_compras || [],
    error_msg: estado.error_msg,
  }
}

module.exports = { iniciarInforme, obtenerEstado, generarPeriodos, guardarInformeEnBD, cargarInformeDeBD, listarInformesDeBD, eliminarInformeDeBD, informes, agruparPorAnio, calcularResumenGlobal }
