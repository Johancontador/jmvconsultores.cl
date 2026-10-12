/**
 * portal-productos.js — FASE A del portal (§7.2 del doc maestro):
 * Productos vendidos, con fuente REAL = `dte_emitidos.items_json` del emisor
 * DTE propio (BLOQUE 2 masterplan). Cada emisión guarda el snapshot de ítems
 * { nombre, cantidad, precio } — este módulo SOLO LEE y agrega.
 *
 * PRINCIPIOS:
 *  - Aislamiento: toda función exige empresaId; solo consulta con filtro SQL.
 *  - NC emitidas (61) descuentan UNA vez: las cantidades y netos de una NC de
 *    venta devuelven lo vendido — misma convención que portal-metricas
 *    (CASE signo). Tipo 56 (nota de débito) suma como venta.
 *  - Sin datos ≠ cero: si la empresa no emitió DTEs en el rango, productoDe
 *    periodo devuelve lista vacía + periodo_cobertura null — NO ceros falsos.
 *  - Módulo puro (db por parámetro), NUNCA muta.
 *
 * LIMITACIÓN (declarada, §7 del doc): el RCV del SII NO trae ítems — esta
 * sección solo ve lo EMITIDO por el emisor DTE propio. Compras de proveedores
 * externos y ventas de terceros no están acá.
 */

const SIGNO_NC = `CASE WHEN tipo_dte IN (61) THEN -1 ELSE 1 END`

/**
 * Agrega ítems de los DTE emitidos de UN período (o rango [desde, hasta]
 * inclusive, por mes de emisión AAAAMM de fecha_emision).
 * Devuelve { periodo_cobertura, productos: [{ nombre, cantidad, neto, docs }] }.
 */
function productosVendidos(db, { empresaId, desde = null, hasta = null, limit = 100 }) {
  const where = ['empresa_id = ?', `estado != 'ERROR'`]
  const params = [empresaId]
  const fDesde = limpiar(desde), fHasta = limpiar(hasta)
  // fecha_emision es 'AAAA-MM-DD': translate() lo deja AAAAMMDD para poder
  // comparar contra el periodo AAAAMM del filtro (string a string, mismo formato).
  const MES_EMISION = `replace(substr(fecha_emision, 1, 7), '-', '')`
  if (fDesde) { where.push(`${MES_EMISION} >= ?`); params.push(fDesde) }
  if (fHasta) { where.push(`${MES_EMISION} <= ?`); params.push(fHasta) }

  const filas = db.prepare(`
    SELECT tipo_dte, items_json FROM dte_emitidos
    WHERE ${where.join(' AND ')} AND items_json IS NOT NULL
  `).all(...params)

  const agregado = new Map()
  for (const fila of filas) {
    let items
    try { items = JSON.parse(fila.items_json || '[]') } catch { continue } // snapshot roto no revienta el reporte
    if (!Array.isArray(items)) continue
    const signo = fila.tipo_dte === 61 ? -1 : 1
    for (const it of items) {
      const nombre = String(it && it.nombre || '').trim()
      if (!nombre) continue
      const cantidad = Number(it.cantidad) || 0
      const precio = Number(it.precio) || 0
      const netoLinea = signo * Math.round(cantidad * precio)
      const cantLinea = signo * cantidad
      const previo = agregado.get(nombre) || { nombre, cantidad: 0, neto: 0, docs: new Set() }
      previo.cantidad += cantLinea
      previo.neto += netoLinea
      agregado.set(nombre, previo)
    }
  }

  const productos = [...agregado.values()]
    .map((p) => ({
      nombre: p.nombre,
      cantidad: Math.round(p.cantidad * 100) / 100,
      neto: Math.round(p.neto),
      precio_promedio: p.cantidad > 0 ? Math.round(p.neto / p.cantidad) : null,
      por_periodo: null, // informado abajo por docs; no lo asumimos
      docs: null,
    }))
    .sort((a, b) => b.neto - a.neto)
    .slice(0, Math.min(Number(limit) || 100, 500))

  return {
    desde: fDesde, hasta: fHasta,
    periodo_cobertura: filas.length ? `${fDesde || ''}…${fHasta || ''}` : null,
    dtes_analizados: filas.length,
    productos,
  }
}


/** Limpia y valida un período AAAAMM (null si no cumple el formato). */
function limpiar(p) {
  const s = String(p || '').replace(/\D/g, '')
  return /^\d{6}$/.test(s) ? s : null
}


module.exports = { productosVendidos }
