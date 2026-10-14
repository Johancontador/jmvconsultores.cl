/**
 * portal-credito.js — FASE C del portal (§7.1 del doc maestro):
 * Crédito autorizado por cliente. El RCV/sistema NO conoce el crédito que la
 * empresa le autoriza a cada cliente — es dato de NEGOCIO que el dueño DIGITA
 * aquí (igual que la ficha de onboarding). Este módulo nunca lo adivina:
 * sin ficha → SIN_CREDITO (no 0 ni ∞).
 *
 * PRINCIPIOS:
 *  - Módulo puro (db por parámetro), writes auditados con registrarAccion.
 *  - Identidad de cliente = RUT normalizado (sin puntos ni guiones, mayúsculas,
 *    'K' válida) para que cuadre contra documentos, DTE y fichas digitadas.
 *  - La exposición (uso vs autorizado) se calcula sobre la MISMA fuente de
 *    cobranza del sistema (cobranzaCore.saldosClientes) inyectable para tests.
 *  - Sin estimar: el crédito no fijado JAMÁS se infiere de la venta histórica.
 */

const { registrarAccion } = require('./auditoria')
const cobranzaCore = require('./cobranza')

/** RUT → clave de correspondencia estable ('12.345.678-k' ≡ '12345678K'). */
function normalizarRut(rut) {
  return String(rut || '').replace(/[^0-9kK]/g, '').toUpperCase()
}

/** Tabla de fichas de crédito (fase C). Idempotente; se llama desde el router. */
function ensureTablas(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS portal_credito (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      rut_norm TEXT NOT NULL,
      rut_original TEXT NOT NULL,
      razon_social TEXT,
      monto_autorizado INTEGER NOT NULL,
      notas TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT,
      actualizado_por INTEGER NOT NULL REFERENCES users(id),
      UNIQUE(empresa_id, rut_norm)
    )
  `).run()
}

/** Fija/actualiza el crédito autorizado de UN cliente de LA empresa. */
function fijarAutorizado(db, { empresaId, usuarioId, rut, razonSocial = null, monto, notas = null, ip = null }) {
  const rutNorm = normalizarRut(rut)
  if (!rutNorm) throw new Error('Falta el RUT del cliente')
  const monto_ = Number(monto)
  if (!Number.isInteger(monto_) || monto_ < 0) throw new Error('Monto autorizado inválido (entero ≥ 0)')
  const antes = db.prepare(`
    SELECT id, monto_autorizado FROM portal_credito WHERE empresa_id = ? AND rut_norm = ?
  `).get(empresaId, rutNorm)

  const tx = db.transaction(() => {
    if (antes) {
      db.prepare(`
        UPDATE portal_credito
        SET rut_original = ?, razon_social = COALESCE(?, razon_social),
            monto_autorizado = ?, notas = ?, actualizado_en = datetime('now'), actualizado_por = ?
        WHERE id = ?
      `).run(String(rut).trim(), razonSocial, monto_, notas, usuarioId, antes.id)
    } else {
      db.prepare(`
        INSERT INTO portal_credito (empresa_id, rut_norm, rut_original, razon_social, monto_autorizado, notas, actualizado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(empresaId, rutNorm, String(rut).trim(), razonSocial, monto_, notas, usuarioId)
    }
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'portal.credito.fijar', entidad: 'portal_credito', entidadId: rutNorm,
      antes: antes ? { monto_autorizado: antes.monto_autorizado } : null,
      despues: { monto_autorizado: monto_, rut: rutNorm }, ip,
    })
  })
  tx()
  return { ok: true, rut_norm: rutNorm, monto_autorizado: monto_, actualizado: Boolean(antes) }
}

/** Fichas digitadas de la empresa (todas, incluso de clientes al día). */
function listar(db, { empresaId, limit = 500 } = {}) {
  const filas = db.prepare(`
    SELECT id, rut_norm, rut_original, razon_social, monto_autorizado, notas,
           creado_en, actualizado_en, actualizado_por
    FROM portal_credito WHERE empresa_id = ?
    ORDER BY monto_autorizado DESC, rut_norm
    LIMIT ?
  `).all(Number(empresaId), Math.min(Number(limit) || 500, 2000))
  return filas
}

/**
 * Exposición de la cartera: saldo de cobranza (misma fuente del sistema) vs
 * crédito autorizado digitado. `saldosFn` inyectable (por defecto el módulo
 * real) para tests — la evaluación nunca estima el crédito.
 *  - saldo > 0 y SIN ficha  → SIN_CREDITO (no computa disponible)
 *  - saldo <= autorizado    → DISPONIBLE (disponible = autorizado − saldo)
 *  - saldo >  autorizado    → SOBREPASADO (disponible negativo, explícito)
 */
function exposicion(db, { empresaId, diasMoraAmarillo = 15, diasMoraRojo = 30, saldosFn = null } = {}) {
  const saldos = (saldosFn || cobranzaCore.saldosClientes)(db, { empresaId, diasMoraAmarillo, diasMoraRojo })
  const fichas = new Map(listar(db, { empresaId }).map((f) => [f.rut_norm, f]))

  const clientes = []
  for (const c of saldos.clientes) {
    const rutNorm = normalizarRut(c.rut)
    const ficha = fichas.get(rutNorm) || null
    if (ficha) fichas.delete(rutNorm)
    clientes.push(_fila(c, ficha, null))
  }
  // Fichas de clientes sin saldo pendiente (al día): siguen en la lista con saldo 0.
  for (const restante of fichas.values()) {
    clientes.push(_fila({ rut: restante.rut_original, razon_social: restante.razon_social, saldo: 0, mora_max_dias: 0, nivel: 'verde', documentos_abiertos: [] }, restante, null))
  }
  clientes.sort((a, b) => b.saldo - a.saldo)

  const resumen = {
    total_saldo: saldos.total_pendiente,
    total_autorizado: clientes.reduce((s, c) => s + c.autorizado, 0),
    clientes: clientes.length,
    sobrepasados: clientes.filter((c) => c.estado === 'SOBREPASADO').length,
    sin_credito: clientes.filter((c) => c.estado === 'SIN_CREDITO').length,
    dias_rojo: diasMoraRojo,
  }
  return {
    ok: true,
    regla: 'El crédito autorizado es dato digitado por la empresa; sin ficha el cliente figura SIN_CREDITO y la exposición no se calcula (no se estima).',
    generado: new Date().toISOString(),
    resumen,
    clientes,
  }
}

function _fila(saldo, ficha, _unused) {
  const autorizado = ficha ? ficha.monto_autorizado : null
  const estado = ficha === null ? 'SIN_CREDITO'
    : (saldo.saldo > autorizado ? 'SOBREPASADO' : 'DISPONIBLE')
  return {
    rut: saldo.rut, rut_norm: normalizarRut(saldo.rut),
    razon_social: saldo.razon_social || (ficha && ficha.razon_social) || null,
    saldo: saldo.saldo, mora_max_dias: saldo.mora_max_dias, nivel: saldo.nivel,
    documentos_abiertos: saldo.documentos_abiertos || [],
    autorizado, disponible: ficha === null ? null : autorizado - saldo.saldo,
    estado, notas: ficha ? ficha.notas : null,
  }
}

/**
 * Enriquece UNA respuesta ya calculada de cobranza (saldosClientes) con el
 * crédito autorizado digitado: cada cliente gana `credito_autorizado` (null
 * si no tiene ficha — no se estima) y el resumen agrega `credito` con los
 * con-distancia: sobrepasados / sin_ficha / total autorizado. Lectura pura.
 */
function enriquecerConCredito(db, { empresaId, saldos }) {
  const fichas = new Map(listar(db, { empresaId }).map((f) => [f.rut_norm, f]))
  let sobre = 0, sin = 0, auto = 0
  const clientes = saldos.clientes.map((c) => {
    const ficha = fichas.get(normalizarRut(c.rut)) || null
    if (ficha === null) sin += 1
    else {
      auto += ficha.monto_autorizado
      if (Number(c.saldo) > ficha.monto_autorizado) sobre += 1
    }
    return { ...c, rut_norm: normalizarRut(c.rut), credito_autorizado: ficha === null ? null : ficha.monto_autorizado }
  })
  return {
    ...saldos,
    clientes,
    credito: {
      regla: 'Crédito autorizado digitado por la empresa (Portal — Crédito autorizado). Cliente sin ficha: null — no se estima.',
      total_autorizado: auto,
      sobrepasados: sobre,
      sin_ficha: sin,
    },
  }
}

module.exports = { ensureTablas, fijarAutorizado, listar, exposicion, enriquecerConCredito, normalizarRut }
