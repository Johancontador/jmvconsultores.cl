/**
 * cobranza.js — Cobranza de clientes (Fase 3 del plan JMV aprobado 2026-10-10).
 *
 * SOBRE lo que ya existe, SIN re-implementar nada del núcleo:
 *  - La cuenta corriente (reportes.cuentaCorriente rol 'cliente') ya calcula
 *    saldos por RUT de cada documento CONTABILIZADO menos sus cobros aplicados.
 *  - Tesorería (tesoreria.registrarPagoCobro tipo 'COBRO') ya crea el asiento
 *    del núcleo (Debe banco / Haber CLIENTES) y registra el movimiento con
 *    documento_id = la factura.
 *
 *  Lo que agrega este módulo:
 *  1. saldosClientes: la vista de cobranza — cada cliente con saldo pendiente,
 *     documentos abiertos con antigüedad y detalle, ordenado por mora.
 *  2. marcarPagada: la acción del botón «Pagada» — flujo automático que
 *     registra el COBRO completo (asiento del núcleo + movimiento de banco +
 *     vínculo al documento) en UNA transacción auditada. Nunca borra ni
 *     materializa nada fuera de la contabilidad.
 *
 *  Pago pasivo (detección de transferencias entrantes) queda como Fase 3b:
 *  la importación de cartolas ya entra por FASE 9.2 y la conciliación FASE 6
 *  empareja movimiento↔libro; este módulo quedará conectado ahí.
 */

const tesoreria = require('./tesoreria')
const reportes = require('./reportes')

/**
 * Clientes con saldo pendiente (la lista de cobranza). Cada fila:
 * rut, razon_social, saldo, documentos abiertos [{id,folio,fecha,monto,mora_dias}...]
 */
function saldosClientes(db, { empresaId, diasMoraAmarillo = 15, diasMoraRojo = 30, limit = 500 } = {}) {
  const cc = reportes.cuentaCorriente(db, empresaId, { rol: 'cliente', limit: 2000 })
  const hoy = new Date().toISOString().slice(0, 10)
  const salida = []

  for (const cli of cc.resumen) {
    if (cli.saldo <= 0) continue // al día o con crédito a favor: no es cobranza
    // documentos abiertos del cliente (CONTABILIZADOS de venta, sin cobro completo)
    const abiertos = db.prepare(`
      SELECT d.id, d.folio, d.fecha_docto, d.monto_total
      FROM documentos d
      WHERE d.empresa_id = ? AND d.tipo_flujo = 'venta' AND d.estado = 'CONTABILIZADO'
        AND d.asiento_id IS NOT NULL AND d.rut_contraparte = ?
        AND NOT EXISTS (
          SELECT 1 FROM teso_movimientos m
          WHERE m.documento_id = d.id AND ABS(m.monto) >= ABS(d.monto_total) - 1
        )
      ORDER BY d.fecha_docto ASC
    `).all(empresaId, cli.rut).map((d) => {
      const mora_dias = Math.max(0, Math.floor((new Date(hoy) - new Date(d.fecha_docto || hoy)) / 86400e3))
      return { ...d, mora_dias }
    })
    const maxMora = abiertos.reduce((m, d) => Math.max(m, d.mora_dias), 0)
    const nivel = maxMora >= diasMoraRojo ? 'rojo' : (maxMora >= diasMoraAmarillo ? 'amarillo' : 'verde')
    salida.push({
      rut: cli.rut, razon_social: cli.razon_social, saldo: cli.saldo,
      documentos_abiertos: abiertos, mora_max_dias: maxMora, nivel,
    })
  }
  salida.sort((a, b) => b.saldo - a.saldo)
  return { ok: true, generado: new Date().toISOString(), clientes: salida.slice(0, limit),
    total_pendiente: salida.reduce((s, c) => s + c.saldo, 0) }
}

/**
 * Botón «Pagada»: registra el cobro de un documento de venta ya contabilizado.
 * Reusa registrarPagoCobro (transacción: asiento núcleo + teso_movimientos +
 * auditoría). En la misma llamada o ya vía cartola, el saldo de la cuenta
 * corriente baja al aplicar el movimiento.
 */
function marcarPagada(db, { empresaId, usuarioId, documentoId, bancoCuentaId, fecha = null, monto = null, glosa = null, ip = null }) {
  const doc = db.prepare(`
    SELECT d.id, d.tipo_flujo, d.tipo_doc, d.folio, d.monto_total, d.rut_contraparte, d.estado
    FROM documentos d WHERE d.id = ? AND d.empresa_id = ?
  `).get(Number(documentoId), empresaId)
  if (!doc) throw new Error('Documento no encontrado')
  if (doc.tipo_flujo !== 'venta') throw new Error('La cobranza aplica solo a documentos de venta')
  if (doc.estado !== 'CONTABILIZADO') throw new Error(`El documento está ${doc.estado} — debe estar CONTABILIZADO para cobrar`)

  const montoCobro = monto !== null && monto !== undefined ? Math.round(Number(monto)) : Math.round(Number(doc.monto_total))
  if (!Number.isFinite(montoCobro) || montoCobro <= 0) throw new Error('Monto de cobro inválido')
  const yaCobrado = db.prepare(`
    SELECT COALESCE(SUM(ABS(m.monto)),0) AS n FROM teso_movimientos m WHERE m.documento_id = ? AND m.tipo = 'COBRO'
  `).get(doc.id).n
  if (yaCobrado + montoCobro > Math.round(Number(doc.monto_total)) + 1) {
    throw new Error(`El documento ya tiene ${yaCobrado} cobrado — el monto excede su total ${doc.monto_total}`)
  }

  const fecha_ = fecha || new Date().toISOString().slice(0, 10)
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId, bancoCuentaId: Number(bancoCuentaId),
    tipo: 'COBRO', fecha: fecha_, monto: montoCobro,
    glosa: glosa || `Cobro F${doc.folio} ${doc.rut_contraparte}`,
    documentoId: doc.id, ip,
  })
  return {
    ok: true, documento_id: doc.id, folio: doc.folio, rut: doc.rut_contraparte,
    cobrado_antes: yaCobrado, cobrado_ahora: montoCobro, saldo_restante: Math.max(0, doc.monto_total - yaCobrado - montoCobro),
    movimiento_id: r.movimientoId, asiento_folio: r.asiento?.folio,
  }
}

module.exports = { saldosClientes, marcarPagada }
