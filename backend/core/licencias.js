/**
 * Licencias / suscripciones — acomplamiento comercial SaaS (SAAS-ACCESO §5).
 *
 * Principios:
 *  - La licencia se ata a la EMPRESA (RUT), no al usuario: UNIQUE(empresa_id).
 *  - Un plan limita EMPRESAS activas, no usuarios internos de esa empresa.
 *  - El paso del tiempo se resuelve al LEER (refrescarEstado), sin cron.
 *  - El gate (exigirVigente) bloquea ESCRITURAS, jamás la lectura: los datos
 *    siempre se ven (mismo espíritu que el bloqueo de período cerrado).
 *  - Toda mutación queda auditada.
 *
 * Módulo puro: recibe la BD como parámetro.
 */

const { registrarAccion } = require('./auditoria')

/** Planes del catálogo (SAAS-ACCESO §5.3). Precio CLP con IVA incluido. */
const PLANES = {
  PRUEBA: { empresas: 1, usuarios: 3, docs_mes: 600, monto_clp: 0, dias: 90 },
  PYME: { empresas: 1, usuarios: 5, docs_mes: 300, monto_clp: 29900 },
  PRO: { empresas: 3, usuarios: 10, docs_mes: 2000, monto_clp: 59900 },
  DESPACHO: { empresas: 10, usuarios: null, docs_mes: null, monto_clp: 119900 }, // null = sin límite
}

const GRACIA_DIAS = 7 // días de gracia tras vencer antes de SUSPENDIDA

function hoyISO() {
  // UTC, no local: SQLite date('now') (usado en INSERT/UPDATE de suscripciones y
  // en los tests) es UTC — mezclar con la fecha local rompía las transiciones
  // de estado cerca de medianoche en zonas UTC-negativas (VENCIDA vs SUSPENDIDA).
  return new Date().toISOString().slice(0, 10)
}

function sumaDias(fechaISO, dias) {
  const [y, m, d] = String(fechaISO).split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + dias))
  return t.toISOString().slice(0, 10)
}

function esPlanValido(plan) {
  return Object.prototype.hasOwnProperty.call(PLANES, String(plan || ''))
}

/**
 * Usuario "sistema" para transiciones automáticas (el paso del tiempo no tiene
 * autor humano): el admin semilla representa al servicio/JMV en la auditoría.
 */
function usuarioSistema(db) {
  return db.prepare(`SELECT id FROM users WHERE is_admin = 1 AND activo = 1 ORDER BY id LIMIT 1`).get()?.id || null
}

/** Suscripción de una empresa (con estado refrescado) o null. */
function suscripcionDe(db, empresaId) {
  const s = db.prepare(`SELECT * FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  if (!s) return null
  return refrescarEstado(db, empresaId, s)
}

/**
 * Aplica el paso del tiempo sobre la fila (idempotente, auditado solo si cambia):
 *  fin < hoy y estado PRUEBA|ACTIVA → VENCIDA, con gracia_hasta = fin + 7 días.
 *  VENCIDA con gracia vencida → SUSPENDIDA (ya no admite escrituras).
 */
function refrescarEstado(db, empresaId, fila = null) {
  const s = fila || db.prepare(`SELECT * FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  if (!s) return null
  const hoy = hoyISO()

  const sistema = usuarioSistema(db)

  if ((s.estado === 'PRUEBA' || s.estado === 'ACTIVA') && s.fin < hoy) {
    const nuevo = {
      estado: 'VENCIDA',
      gracia_hasta: s.gracia_hasta || sumaDias(s.fin, GRACIA_DIAS),
    }
    db.prepare(`UPDATE suscripciones SET estado = @estado, gracia_hasta = @gracia_hasta WHERE id = @id`)
      .run({ id: s.id, ...nuevo })
    registrarAccion(db, {
      empresaId, usuarioId: sistema, accion: 'licencia.estado', entidad: 'suscripciones', entidadId: String(s.id),
      antes: { estado: s.estado }, despues: { estado: nuevo.estado, fin: s.fin, gracia_hasta: nuevo.gracia_hasta, automatico: true },
    })
    return { ...s, ...nuevo }
  }

  if (s.estado === 'VENCIDA' && s.gracia_hasta && s.gracia_hasta < hoy) {
    db.prepare(`UPDATE suscripciones SET estado = 'SUSPENDIDA' WHERE id = ?`).run(s.id)
    registrarAccion(db, {
      empresaId, usuarioId: sistema, accion: 'licencia.estado', entidad: 'suscripciones', entidadId: String(s.id),
      antes: { estado: 'VENCIDA' }, despues: { estado: 'SUSPENDIDA', gracia_vencida: s.gracia_hasta, automatico: true },
    })
    return { ...s, estado: 'SUSPENDIDA' }
  }

  return s
}

/** ¿La empresa puede ESCRIBIR (contabilizar, ingestar, clasificar, cerrar)? */
function puedeEscribir(db, empresaId) {
  const s = suscripcionDe(db, empresaId)
  if (!s) return { ok: false, motivo: 'sin_licencia', mensaje: 'La empresa no tiene licencia asignada' }
  if (s.estado === 'PRUEBA' || s.estado === 'ACTIVA') return { ok: true, suscripcion: s }
  if (s.estado === 'VENCIDA') {
    // Gracia: sigue operando (cortesía para pagar), con aviso visible en la UI.
    return {
      ok: true, en_gracia: true, suscripcion: s,
      mensaje: `Licencia vencida el ${s.fin} — gracia hasta ${s.gracia_hasta}: activa un plan para evitar la suspensión`,
    }
  }
  return {
    ok: false, motivo: s.estado === 'SUSPENDIDA' ? 'suspendida' : s.estado.toLowerCase(), suscripcion: s,
    mensaje: `Licencia ${s.estado}: la lectura sigue disponible, la escritura no`,
  }
}

/** Gate para rutas/core de escritura: lanza si la licencia no lo permite. */
function exigirVigente(db, empresaId) {
  const r = puedeEscribir(db, empresaId)
  if (!r.ok) throw new Error(r.mensaje)
  return r.suscripcion
}

/** Resumen para la UI (banner de la app): días restantes, plan, precio. */
function estadoParaUI(db, empresaId) {
  const r = puedeEscribir(db, empresaId)
  if (!r.suscripcion) return r
  const s = r.suscripcion
  const diasRestantes = Math.max(0, Math.ceil((new Date(s.fin + 'T23:59:59Z') - new Date()) / 86400000))
  return {
    ...r,
    plan: s.plan, estado: s.estado, fin: s.fin,
    dias_restantes: diasRestantes, monto_clp: s.monto_clp,
    gracia_hasta: s.gracia_hasta || null,
  }
}

/**
 * Crea la PRUEBA de 90 días (una sola por empresa — UNIQUE(empresa_id)).
 * La confirma el llamador dentro de su transacción mayor.
 */
function crearPrueba(db, empresaId, usuarioId = null) {
  const existente = db.prepare(`SELECT id FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  if (existente) throw new Error('La empresa ya tiene una licencia')
  const inicio = hoyISO()
  const info = db.prepare(`
    INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp)
    VALUES (?, 'PRUEBA', 'PRUEBA', ?, ?, 0)
  `).run(empresaId, inicio, sumaDias(inicio, PLANES.PRUEBA.dias))
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'licencia.crear', entidad: 'suscripciones', entidadId: String(info.lastInsertRowid),
    despues: { plan: 'PRUEBA', inicio, fin: sumaDias(inicio, PLANES.PRUEBA.dias), dias: PLANES.PRUEBA.dias },
  })
  return db.prepare(`SELECT * FROM suscripciones WHERE id = ?`).get(info.lastInsertRowid)
}

/**
 * Licencia HEREDADA para empresas creadas manualmente por JMV (super_admin,
 * empresas.crear): son clientes de servicio contable cobrados fuera del
 * sistema — nunca debe bloquearlas el gate. Si algún día ese cliente pasa a
 * pagar plan propio, activarPlan la reemplaza.
 * La confirma el llamador dentro de su transacción mayor.
 */
function crearHeredada(db, empresaId, usuarioId = null) {
  const existente = db.prepare(`SELECT id FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  if (existente) return existente
  const info = db.prepare(`
    INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp, notas)
    VALUES (?, 'DESPACHO', 'ACTIVA', ?, date(?, '+3650 days'), 0, 'Heredada: cliente de servicio (creada por JMV)')
  `).run(empresaId, hoyISO(), hoyISO())
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'licencia.crear', entidad: 'suscripciones', entidadId: String(info.lastInsertRowid),
    despues: { plan: 'DESPACHO', estado: 'ACTIVA', tipo: 'heredada' },
  })
  return db.prepare(`SELECT * FROM suscripciones WHERE id = ?`).get(info.lastInsertRowid)
}

/**
 * Activa (o renueva) un plan pagado sobre la empresa. Si ya hay fila (PRUEBA o
 * plan anterior vencido), la ACTUALIZA — la licencia es una sola por empresa.
 * En SAAS-3 el webhook de pago llama esto con usuarioId del sistema.
 */
function activarPlan(db, { empresaId, plan, usuarioId, meses = 1, notas = null, ip = null }) {
  if (!esPlanValido(plan)) throw new Error(`Plan inválido: ${plan} (usar: ${Object.keys(PLANES).join(', ')})`)
  if (plan === 'PRUEBA') throw new Error('La prueba se crea solo con crearPrueba (una por empresa)')
  if (!Number.isInteger(meses) || meses < 1 || meses > 36) throw new Error('Meses inválido (1..36)')

  const empresa = db.prepare(`SELECT id FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')

  const p = PLANES[plan]
  const hoy = hoyISO()
  // Si el plan actual sigue vigente (ACTIVA con fin >= hoy), la renovación se
  // suma al fin existente; si no, parte desde hoy.
  const actual = db.prepare(`SELECT * FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  const baseFin = actual && actual.estado === 'ACTIVA' && actual.fin >= hoy ? actual.fin : hoy
  const [y, m, d] = baseFin.split('-').map(Number)
  const fin = new Date(Date.UTC(y, m - 1 + meses, d)).toISOString().slice(0, 10)

  let id
  if (actual) {
    db.prepare(`
      UPDATE suscripciones
      SET plan = ?, estado = 'ACTIVA', fin = ?, gracia_hasta = NULL, monto_clp = ?,
          activada_por = ?, activada_en = datetime('now'), cancelada_en = NULL,
          notas = COALESCE(?, notas)
      WHERE empresa_id = ?
    `).run(plan, fin, p.monto_clp, usuarioId, notas, empresaId)
    id = actual.id
  } else {
    const info = db.prepare(`
      INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp, activada_por, activada_en, notas)
      VALUES (?, ?, 'ACTIVA', ?, ?, ?, ?, datetime('now'), ?)
    `).run(empresaId, plan, hoy, fin, p.monto_clp, usuarioId, notas)
    id = info.lastInsertRowid
  }
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'licencia.activar', entidad: 'suscripciones', entidadId: String(id),
    antes: actual ? { plan: actual.plan, estado: actual.estado, fin: actual.fin } : null,
    despues: { plan, estado: 'ACTIVA', fin, monto_clp: p.monto_clp, meses }, ip,
  })
  return db.prepare(`SELECT * FROM suscripciones WHERE id = ?`).get(id)
}

/** Cancela al término del período pagado (no suspende de inmediato). */
function cancelar(db, { empresaId, usuarioId, notas = null, ip = null }) {
  const s = db.prepare(`SELECT * FROM suscripciones WHERE empresa_id = ?`).get(empresaId)
  if (!s) throw new Error('La empresa no tiene licencia')
  db.prepare(`UPDATE suscripciones SET notas = COALESCE(?, notas), cancelada_en = datetime('now') WHERE id = ?`)
    .run(notas, s.id)
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'licencia.cancelar', entidad: 'suscripciones', entidadId: String(s.id),
    antes: { estado: s.estado, fin: s.fin },
    // CANCELADA = no se renueva; sigue usable hasta su fin (refrescarEstado la vencerá).
    despues: { estado: s.estado === 'ACTIVA' ? 'ACTIVA (no se renueva)' : s.estado, fin: s.fin, notas }, ip,
  })
  return db.prepare(`SELECT * FROM suscripciones WHERE id = ?`).get(s.id)
}

module.exports = {
  PLANES, GRACIA_DIAS,
  esPlanValido, suscripcionDe, refrescarEstado,
  puedeEscribir, exigirVigente, estadoParaUI,
  crearPrueba, crearHeredada, activarPlan, cancelar,
  usuarioSistema,
  hoyISO, sumaDias,
}
