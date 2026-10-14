/**
 * portal-costos.js — FASE D del portal (§7.3 del doc maestro):
 * Hoja de costos por SKU/producto Y margen sobre lo vendido.
 *
 * FUENTE HONESTA (§42/§10): el costo NO existe en el SII ni en la bandeja — es
 * dato de negocio que la empresa DIGITA (desde su ERP, cotización de proveedor
 * o libro de compras) como costo UNITARIO por producto. Lo sin costear NO se
 * estima ni se promedia: el producto aparece sin margen y la cobertura declara
 * qué parte de la venta quedó con margen calculado.
 *
 * PRINCIPIOS:
 *  - Módulo puro (db por parámetro), writes auditados.
 *  - El margen se calcula sobre `portal-productos.productosVendidos` EXACTO
 *    (misma agregación NC descuenta una vez, ERROR fuera) — nada reaparece.
 *  - Costo y neto van con el MISMO signo (productos solo-NC quedan coherentes).
 */

const { registrarAccion } = require('./auditoria')
const portalProductos = require('./portal-productos')

function ensureTablas(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portal_costos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      producto_norm TEXT NOT NULL,
      producto_original TEXT NOT NULL,
      costo_unitario INTEGER NOT NULL,
      notas TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT,
      actualizado_por INTEGER NOT NULL REFERENCES users(id),
      UNIQUE(empresa_id, producto_norm)
    )
  `).run()
}

/** Clave de correspondencia estable del nombre de producto. */
function normalizarProducto(p) {
  return String(p || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Fija/actualiza el costo unitario de UN producto de LA empresa. */
function fijarCosto(db, { empresaId, usuarioId, producto, costoUnitario, notas = null, ip = null }) {
  const nombre = String(producto || '').trim()
  const prodNorm = normalizarProducto(nombre)
  if (!prodNorm) throw new Error('Falta el nombre del producto')
  const costo = Number(costoUnitario)
  if (!Number.isInteger(costo) || costo < 0) throw new Error('Costo unitario inválido (entero ≥ 0)')
  const antes = db.prepare(`
    SELECT id, costo_unitario FROM portal_costos WHERE empresa_id = ? AND producto_norm = ?
  `).get(empresaId, prodNorm)

  const tx = db.transaction(() => {
    if (antes) {
      db.prepare(`
        UPDATE portal_costos
        SET producto_original = ?, costo_unitario = ?, notas = ?, actualizado_en = datetime('now'), actualizado_por = ?
        WHERE id = ?
      `).run(nombre, costo, notas, usuarioId, antes.id)
    } else {
      db.prepare(`
        INSERT INTO portal_costos (empresa_id, producto_norm, producto_original, costo_unitario, notas, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(empresaId, prodNorm, nombre, costo, notas, usuarioId)
    }
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'portal.costos.fijar', entidad: 'portal_costos', entidadId: prodNorm,
      antes: antes ? { costo_unitario: antes.costo_unitario } : null,
      despues: { costo_unitario: costo, producto: prodNorm }, ip,
    })
  })
  tx()
  return { ok: true, producto_norm: prodNorm, costo_unitario: costo, actualizado: Boolean(antes) }
}

function listar(db, { empresaId, limit = 500 } = {}) {
  return db.prepare(`
    SELECT id, producto_norm, producto_original, costo_unitario, notas, creado_en, actualizado_en
    FROM portal_costos WHERE empresa_id = ?
    ORDER BY producto_norm
    LIMIT ?
  `).all(Number(empresaId), Math.min(Number(limit) || 500, 2000))
}

/**
 * Margen sobre lo vendido (rango inclusive por mes de emisión):
 *  - margen solo cuando HAY costo digitado del producto (margen = null si no);
 *  - coberturas: qué parte de la venta neta quedó con margen (neto>0 cubiertos
 *    / neto>0 total) y cuántos productos de la lista tienen costo.
 */
function margen(db, { empresaId, desde = null, hasta = null, limit = 100 } = {}) {
  const vendidos = portalProductos.productosVendidos(db, { empresaId, desde, hasta, limit: Math.min(Number(limit) || 100, 500) })
  const costos = new Map(listar(db, { empresaId }).map((c) => [c.producto_norm, c.costo_unitario]))

  let venta_cubierta = 0, venta_total_positiva = 0
  const productos = vendidos.productos.map((p) => {
    const costoUnit = costos.get(normalizarProducto(p.nombre))
    if (costoUnit === undefined) {
      if (p.neto > 0) venta_total_positiva += p.neto
      return { ...p, costo_unitario: null, costo_total: null, margen: null }
    }
    const costoTotal = Math.round(costoUnit * p.cantidad) // firma igual que el neto (NC descuenta una vez)
    const margen_ = p.neto - costoTotal
    if (p.neto > 0) { venta_cubierta += p.neto; venta_total_positiva += p.neto }
    return { ...p, costo_unitario: costoUnit, costo_total: costoTotal, margen: margen_ }
  })

  return {
    ok: true,
    desde: vendidos.desde, hasta: vendidos.hasta,
    periodo_cobertura: vendidos.periodo_cobertura,
    dtes_analizados: vendidos.dtes_analizados,
    cobertura: {
      productos_con_costo: productos.filter((p) => p.margen !== null).length,
      productos_total: productos.length,
      venta_con_margen: venta_cubierta,
      venta_positiva_total: venta_total_positiva,
      pct_venta_con_margen: venta_total_positiva > 0 ? Math.round((venta_cubierta / venta_total_positiva) * 1000) / 10 : null,
      regla: 'Solo productos con costo digitado llevan margen. Lo sin costear NO se estima: hasta que se registre su costo, no suma margen ni coberturas.',
    },
    productos,
  }
}

module.exports = { ensureTablas, fijarCosto, listar, margen, normalizarProducto }
