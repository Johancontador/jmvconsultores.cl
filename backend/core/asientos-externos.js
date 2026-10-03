/**
 * Receptor de asientos EXTERNOS (FASE 9.1) — Geo Daniela y otros sistemas.
 *
 * Cumple INTEGRATIONS §4: este lado recibe centralizaciones YA CUADRADAS y las
 * valida con el MISMO núcleo de partida doble — no sabe nada de remuneraciones
 * (el mapa de cuentas 6.1.x/2.1.x lo maneja el remitente enviando códigos del
 * plan). Reglas del contrato:
 *  - empresa resuelta por RUT DENTRO de las empresas del usuario autenticado
 *    (la resolución de acceso vive en las rutas; aquí se revalida el rol).
 *  - Σdebe = Σhaber ANTES de tocar BD; el rechazo es COMPLETO (nunca parcial).
 *  - período ABIERTO (la autocreación del núcleo queda intacta).
 *  - asiento tipo 'externo' con origen `${remitente}:${periodo}`, folio
 *    correlativo, transacción atómica y auditoría.
 *  - IDEMPOTENCIA: clave provista por el remitente (`idempotencia`) o SHA-256
 *    del payload canónico. Re-envío devuelve el asiento YA creado sin
 *    duplicar (UNIQUE empresa+clave, en asientos_externos y en asientos).
 *
 * Errores con `status`/`codigo` para que la ruta responda 422 con detalle:
 *  PAYLOAD_INVALIDO · PERIODO_CERRADO · CUENTA_INEXISTENTE · SIN_ACCESO.
 *
 * Módulo puro: recibe la BD como parámetro (testeable, usable en transacciones).
 */

const crypto = require('crypto')
const { registrarAccion } = require('./auditoria')
const periodos = require('./periodos')
const asientos = require('./asientos')

function errorDe(status, codigo, mensaje) {
  const e = new Error(mensaje)
  e.status = status
  e.codigo = codigo
  return e
}

/** SHA-256 del payload canónico (líneas ordenadas, montos enteros). */
function hashPayload({ periodo, glosa, lineas }) {
  const canonico = {
    periodo: String(periodo),
    glosa: String(glosa || '').trim(),
    lineas: (lineas || [])
      .map((l) => ({
        cuenta_codigo: String(l.cuenta_codigo || '').trim(),
        debe: Math.round(Number(l.debe) || 0),
        haber: Math.round(Number(l.haber) || 0),
        glosa: String(l.glosa || '').trim(),
      }))
      .sort((a, b) => `${a.cuenta_codigo}|${a.debe}|${a.haber}|${a.glosa}`.localeCompare(`${b.cuenta_codigo}|${b.debe}|${b.haber}|${b.glosa}`)),
  }
  return crypto.createHash('sha256').update(JSON.stringify(canonico)).digest('hex')
}

/** Clave de idempotencia final: provista por el remitente o hash del payload. */
function resolverIdempotencia(remitente, clave, payload) {
  const claveLimpia = clave ? String(clave).trim() : ''
  return claveLimpia
    ? `${remitente}:${claveLimpia}`
    : `${remitente}:${hashPayload(payload)}`
}

/** Valida la forma del payload (sin tocar BD): formato, patas y cuadre. */
function validarForma({ periodo, fecha, glosa, lineas }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) {
    throw errorDe(422, 'PAYLOAD_INVALIDO', 'Fecha inválida (esperado YYYY-MM-DD)')
  }
  const p = periodos.periodoDesdeFecha(fecha)
  if (periodo !== null && periodo !== undefined && String(periodo) !== p) {
    throw errorDe(422, 'PAYLOAD_INVALIDO', `El período ${periodo} no corresponde a la fecha ${fecha} (esperado ${p})`)
  }
  const glosaLimpia = String(glosa || '').trim()
  if (!glosaLimpia) throw errorDe(422, 'PAYLOAD_INVALIDO', 'La glosa es obligatoria')
  if (!Array.isArray(lineas) || lineas.length < 2) {
    throw errorDe(422, 'PAYLOAD_INVALIDO', 'Se requieren al menos 2 líneas (partida doble)')
  }
  const normalizadas = lineas.map((l, idx) => {
    const i = idx + 1
    const codigo = String(l && l.cuenta_codigo || '').trim()
    if (!/^\d(\.\d+)*$/.test(codigo)) {
      throw errorDe(422, 'PAYLOAD_INVALIDO', `Línea ${i}: cuenta_codigo inválido (${JSON.stringify(l && l.cuenta_codigo)})`)
    }
    const debe = Math.round(Number(l && l.debe) || 0)
    const haber = Math.round(Number(l && l.haber) || 0)
    if (!Number.isInteger(debe) || !Number.isInteger(haber) || debe < 0 || haber < 0) {
      throw errorDe(422, 'PAYLOAD_INVALIDO', `Línea ${i}: montos deben ser enteros en pesos ≥ 0`)
    }
    if (debe > 0 && haber > 0) {
      throw errorDe(422, 'PAYLOAD_INVALIDO', `Línea ${i}: una línea no puede tener débito Y crédito a la vez`)
    }
    if (debe === 0 && haber === 0) {
      throw errorDe(422, 'PAYLOAD_INVALIDO', `Línea ${i}: la línea está en cero`)
    }
    return { cuenta_codigo: codigo, debe, haber, glosa: String(l.glosa || '').trim() || null }
  })
  const totalDebe = normalizadas.reduce((s, l) => s + l.debe, 0)
  const totalHaber = normalizadas.reduce((s, l) => s + l.haber, 0)
  if (totalDebe !== totalHaber) {
    throw errorDe(422, 'PAYLOAD_INVALIDO', `Centralización DESCUADRADO: débitos ${totalDebe} ≠ créditos ${totalHaber} — se rechaza COMPLETO, corríjala y reenvíe`)
  }
  if (totalDebe === 0) throw errorDe(422, 'PAYLOAD_INVALIDO', 'La centralización está en cero')
  return { periodo: p, glosa: glosaLimpia, lineas: normalizadas, total: totalDebe }
}

/**
 * Recibe una centralización externa y la contabiliza. Idempotente:
 * misma clave (o mismo payload) → el asiento ya creado, sin duplicar.
 */
function recibir(db, { empresaId, usuarioId, remitente = 'geodaniela', idempotencia = null, periodo = null, glosa, fecha, lineas, ip = null }) {
  const remitenteLimpio = String(remitente || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'geodaniela'
  const { periodo: periodoDerivado, glosa: glosaLimpia, lineas: norm, total } = validarForma({ periodo, fecha, glosa, lineas })
  const clave = resolverIdempotencia(remitenteLimpio, idempotencia, { periodo: periodoDerivado, glosa: glosaLimpia, lineas: norm })

  // Idempotencia ANTES de todo: misma centralización → asiento ya creado.
  const previa = db.prepare(`
    SELECT ae.*, a.folio, a.anio FROM asientos_externos ae
    JOIN asientos a ON a.id = ae.asiento_id
    WHERE ae.empresa_id = ? AND ae.idempotencia = ?
  `).get(empresaId, clave)
  if (previa) {
    return { deduplicado: true, asiento_id: previa.asiento_id, folio: previa.folio, anio: previa.anio, periodo: previa.periodo, total: null }
  }

  // Acceso del usuario a ESTA empresa (el remitente opera bajo su sesión).
  const { rolEnEmpresa } = require('./empresas')
  if (!rolEnEmpresa(db, usuarioId, empresaId)) {
    throw errorDe(403, 'SIN_ACCESO', 'El usuario autenticado no tiene acceso a esta empresa')
  }

  // Período ABIERTO (mensaje con el período, para el 422 del contrato).
  const p = periodos.obtenerOCrear(db, empresaId, periodoDerivado)
  if (p.estado !== 'ABIERTO') {
    throw errorDe(422, 'PERIODO_CERRADO', `El período ${periodoDerivado} está CERRADO: no admite modificaciones`)
  }

  // Cuentas por código — rechazo COMPLETO con la lista exacta de inválidos.
  const faltantes = []
  const resueltas = norm.map((l) => {
    const c = db.prepare(`SELECT id, activa, es_resumen FROM cuentas WHERE empresa_id = ? AND codigo = ?`).get(empresaId, l.cuenta_codigo)
    if (!c || !c.activa || c.es_resumen) faltantes.push(l.cuenta_codigo)
    return { ...l, cuenta_id: c ? c.id : null }
  })
  if (faltantes.length) {
    throw errorDe(422, 'CUENTA_INEXISTENTE', `Cuentas inexistentes/inactivas/resumen para esta empresa: ${[...new Set(faltantes)].join(', ')} — el remitente debe mapear a códigos del plan (o el contador crearlas)`)
  }

  const asiento = asientos.crear(db, {
    empresaId, usuarioId, fecha, glosa: glosaLimpia,
    tipo: 'externo',
    origen: `${remitenteLimpio}:${periodoDerivado}`,
    idempotencia: clave,
    lineas: resueltas.map((l) => ({ cuenta_id: l.cuenta_id, debe: l.debe, haber: l.haber, glosa: l.glosa })),
    ip,
  })

  db.prepare(`
    INSERT INTO asientos_externos (empresa_id, remitente, idempotencia, periodo, glosa, lineas_json, asiento_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(empresaId, remitenteLimpio, clave, periodoDerivado, glosaLimpia, JSON.stringify(norm), asiento.id)

  registrarAccion(db, {
    empresaId, usuarioId,
    accion: 'asiento_externo.recibir', entidad: 'asientos_externos', entidadId: String(asiento.id),
    despues: { remitente: remitenteLimpio, periodo: periodoDerivado, idempotencia: clave, total, folio: asiento.folio },
    ip,
  })

  return { deduplicado: false, asiento_id: asiento.id, folio: asiento.folio, anio: asiento.anio, periodo: periodoDerivado, total }
}

/** Centralizaciones externas recibidas (histórico para el contador). */
function listar(db, empresaId, { remitente = null, limit = 100 } = {}) {
  const where = ['ae.empresa_id = ?']
  const params = [empresaId]
  if (remitente) { where.push('ae.remitente = ?'); params.push(String(remitente)) }
  return db.prepare(`
    SELECT ae.id, ae.remitente, ae.idempotencia, ae.periodo, ae.glosa, ae.creado_en,
           a.id AS asiento_id, a.folio, a.anio, a.fecha
    FROM asientos_externos ae
    JOIN asientos a ON a.id = ae.asiento_id
    WHERE ${where.join(' AND ')}
    ORDER BY ae.id DESC
    LIMIT ?
  `).all(...params, Math.min(Number(limit) || 100, 500))
}

/** Auxiliar para el remitente: valida existencia de códigos SIN crear cuentas. */
function validarCodigos(db, empresaId, codigos) {
  const lista = String(codigos || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 200)
  return lista.map((codigo) => {
    const c = db.prepare(`SELECT id, nombre, activa, es_resumen FROM cuentas WHERE empresa_id = ? AND codigo = ?`).get(empresaId, codigo)
    return {
      codigo,
      existe: !!c,
      imputable: !!c && c.activa === 1 && c.es_resumen === 0,
      cuenta_id: c ? c.id : null,
      nombre: c ? c.nombre : null,
    }
  })
}

module.exports = { recibir, listar, validarCodigos, hashPayload, resolverIdempotencia, validarForma }
