/**
 * portal-cotizaciones.js — FASE E del portal (§7.5 del doc maestro):
 * Cotizaciones/embudo. El RCV solo ve lo FACTURADO: las oportunidades que aún
 * no son factura NO existen en ninguna fuente automática — aquí el dueño las
 * REGISTRA con estados reales (BORRADOR/ENVIADA/ACEPTADA/PERDIDA) y el embudo
 * se calcula sobre lo registrado, sin inventar tasas de conversión globales ni
 * proyectar facturas.
 *
 * PRINCIPIOS:
 *  - Módulo puro (db por parámetro); toda mutación audited con registrarAccion.
 *  - Montos INTEGER ≥ 0. Estados de ciclo REAL.optional Aceptación/Perdida
 *    registran fecha_cierre; una CERRADA no vuelve a BORRADOR (se re-crea si
 *    se necesita — la historia del ciclo queda integro en auditoría).
 *  - Cobertura embudo: tasa_conversión = aceptadas / enviadas (monto y conteo),
 *    null si no hay enviadas (nunca 0%).
 */

const { registrarAccion } = require('./auditoria')

const ESTADOS = ['BORRADOR', 'ENVIADA', 'ACEPTADA', 'PERDIDA']
const CERRADOS = new Set(['ACEPTADA', 'PERDIDA'])

function ensureTablas(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portal_cotizaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      cliente_rut TEXT,
      cliente_razon TEXT,
      descripcion TEXT,
      monto INTEGER NOT NULL,
      estado TEXT NOT NULL CHECK (estado IN ('BORRADOR','ENVIADA','ACEPTADA','PERDIDA')),
      notas TEXT,
      creada_por INTEGER NOT NULL REFERENCES users(id),
      creada_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT,
      fecha_cierre TEXT,
      UNIQUE(empresa_id, id)
    )
  `).run()
}

function _cargar(db, empresaId, id) {
  return db.prepare(`
    SELECT * FROM portal_cotizaciones WHERE id = ? AND empresa_id = ?
  `).get(Number(id), Number(empresaId))
}

/** Crea una cotización (estado inicial BORRADOR o ENVIADA si ya se despachó). */
function crear(db, { empresaId, usuarioId, clienteRut = null, clienteRazon = null, descripcion = null, monto, estado = 'BORRADOR', notas = null, ip = null }) {
  if (!ESTADOS.includes(estado)) throw new Error(`Estado inicial inválido: ${estado}`)
  const rut = String(clienteRut || '').trim() || null
  const razon = String(clienteRazon || '').trim() || null
  if (!rut && !razon) throw new Error('La cotización necesita al menos el RUT o la razón social del cliente')
  const monto_ = Number(monto)
  if (!Number.isInteger(monto_) || monto_ < 0) throw new Error('Monto inválido (entero ≥ 0)')

  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO portal_cotizaciones (empresa_id, cliente_rut, cliente_razon, descripcion, monto, estado, notas, creada_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(empresaId, rut, razon, descripcion == null ? null : String(descripcion).trim() || null, monto_, estado, notas, usuarioId)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'portal.cotizacion.crear', entidad: 'portal_cotizaciones',
      entidadId: String(r.lastInsertRowid), despues: { estado, monto: monto_ }, ip,
    })
    return Number(r.lastInsertRowid)
  })
  const id = tx()
  return { ok: true, cotizacion: _cargar(db, empresaId, id) }
}

/** Actualiza estado/detalle. Las transiciones se registran antes→después. */
function actualizar(db, { empresaId, usuarioId, id, estado = null, monto = null, descripcion = null, notas = null, fechaCierre = null, ip = null }) {
  const fila = _cargar(db, empresaId, id)
  if (!fila) throw new Error('Cotización no encontrada')
  if (CERRADOS.has(fila.estado) && estado && estado !== fila.estado) {
    throw new Error(`La cotización está ${fila.estado} (cerrada): no vuelve a estados abiertos — crea una nueva si la oportunidad revive`)
  }
  if (estado && !ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`)
  let monto_ = fila.monto
  if (monto !== null && monto !== undefined) {
    monto_ = Number(monto)
    if (!Number.isInteger(monto_) || monto_ < 0) throw new Error('Monto inválido (entero ≥ 0)')
  }
  const cierre = fechaCierre && /^\d{4}-\d{2}-\d{2}$/.test(String(fechaCierre))
    ? String(fechaCierre)
    : (estado && CERRADOS.has(estado) ? new Date().toISOString().slice(0, 10) : fila.fecha_cierre)
  const nuevoEstado = estado || fila.estado
  const nuevaDesc = descripcion === null ? fila.descripcion : (String(descripcion).trim() || null)
  const nuevasNotas = notas === null ? fila.notas : (String(notas).trim() || null)

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE portal_cotizaciones
      SET estado = ?, monto = ?, descripcion = ?, notas = ?, fecha_cierre = ?,
          actualizado_en = datetime('now')
      WHERE id = ? AND empresa_id = ?
    `).run(nuevoEstado, monto_, nuevaDesc, nuevasNotas, cierre, Number(id), Number(empresaId))
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'portal.cotizacion.actualizar', entidad: 'portal_cotizaciones', entidadId: String(fila.id),
      antes: { estado: fila.estado, monto: fila.monto },
      despues: { estado: nuevoEstado, monto: monto_ }, ip,
    })
  })
  tx()
  return { ok: true, cotizacion: _cargar(db, empresaId, id) }
}

/** Elimina UNA cotización digitada (auditada; no toca datos contables). */
function eliminar(db, { empresaId, usuarioId, id, ip = null }) {
  const fila = _cargar(db, empresaId, id)
  if (!fila) throw new Error('Cotización no encontrada')
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM portal_cotizaciones WHERE id = ? AND empresa_id = ?`).run(Number(id), Number(empresaId))
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'portal.cotizacion.eliminar', entidad: 'portal_cotizaciones', entidadId: String(fila.id),
      antes: { estado: fila.estado, monto: fila.monto }, ip,
    })
  })
  tx()
  return { ok: true }
}

/** Lista con filtros opcional de estado (server-side, nunca SQL del front). */
function listar(db, { empresaId, estado = null, limit = 500 } = {}) {
  if (estado && !ESTADOS.includes(estado)) throw new Error(`Estado inválido: ${estado}`)
  const where = ['empresa_id = ?']
  const params = [Number(empresaId)]
  if (estado) { where.push('estado = ?'); params.push(estado) }
  const filas = db.prepare(`
    SELECT id, cliente_rut, cliente_razon, descripcion, monto, estado, notas,
           creada_en, actualizado_en, fecha_cierre
    FROM portal_cotizaciones WHERE ${where.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).all(...params, Math.min(Number(limit) || 500, 2000))
  return filas
}

/**
 * Embudo: montos y conteos por estado + tasa de conversión aceptadas/enviadas.
 * Sin enviadas → tasa null (no 0%); sin registros → embudo vacío, nunca ceros.
 */
function embudo(db, { empresaId } = {}) {
  const filas = listar(db, { empresaId })
  const porEstado = {}
  for (const e of ESTADOS) porEstado[e] = { estado: e, count: 0, monto: 0 }
  let hayAlguna = false
  for (const f of filas) {
    hayAlguna = true
    const c = porEstado[f.estado]
    c.count += 1
    c.monto += f.monto
  }
  const enviadas = porEstado.ENVIADA, aceptadas = porEstado.ACEPTADA
  if (!hayAlguna) return { ok: true, hay_datos: false, por_estado: null, tasa_conversion: null, monto_pendiente: 0, regla: 'Sin cotizaciones registradas. El embudo se construye con lo que la empresa registra — no se inferir de las ventas facturadas.' }
  return {
    ok: true,
    hay_datos: true,
    // Los 4 estados del ciclo apareciece completo en filas en 0
    // — se lee el embudo aun cuando recién hay cotizaciones ajenas.
    por_estado: Object.values(porEstado),
    tasa_conversion: {
      por_monto: enviadas.monto > 0 ? Math.round((aceptadas.monto / enviadas.monto) * 1000) / 10 : null,
      por_conteo: enviadas.count > 0 ? Math.round((aceptadas.count / enviadas.count) * 1000) / 10 : null,
    },
    monto_pendiente: porEstado.BORRADOR.monto + porEstado.ENVIADA.monto,
  }
}

module.exports = { ensureTablas, ESTADOS, crear, actualizar, eliminar, listar, embudo }
