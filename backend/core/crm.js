/**
 * crm.js — Fidelización de clientes / CRM (Fase B).
 *
 * Cuatro módulos sobre la base existente (empresas, documentos, auditoría):
 *
 *  1. PIPELINE: etapa de cada cliente/empresa en el ciclo del despacho
 *     (PROSPECTO → ONBOARDING → OPERATIVO → RIESGO → PERDIDO), con notas y
 *     próximo contacto. Sin leads inventados: la fuente es `empresas`.
 *  2. RECORDATORIOS: tareas programadas (cierre de período, F29, PPM,
 *     llamada, sincronización) con fecha, done y auditoría al completar.
 *  3. CAMPAÑAS: mensajes de fidelización generados (base WhatsApp como la
 *     herramienta de cobranza existente) por plantilla + período; se marcan
 *     enviados por el despacho, nunca automáticos.
 *  4. ENGAGEMENT: salud por cliente calculada de datos REALES — días desde la
 *     última sincronización SII, documentos pendientes de contabilizar,
 *     cierre de período atrasado, días desde el último contacto (pipeline) —
 *     con score 0-100 y etiqueta (SANO/ATENCIÓN/CRÍTICO). Nada adivinado.
 *
 * Módulo puro: BD por parámetro, aislamiento por empresa (llamador valida
 * acceso y licencia igual que el resto de las fases). Todo auditado.
 */

const { registrarAccion } = require('./auditoria')

const ETAPAS = ['PROSPECTO', 'ONBOARDING', 'OPERATIVO', 'RIESGO', 'PERDIDO']

const TIPOS_RECORDATORIO = ['cierre_periodo', 'f29', 'ppm', 'llamada', 'sincronizacion', 'otro']

const PLANTILLAS_CAMPANA = {
  bienvenida: (d) => `Hola ${d.contacto || d.empresa}: le damos la bienvenida a JMV Consultores. Su contabilidad ya está siendo administrada en nuestro sistema. ¡Éxitos en este nuevo ciclo!`,
  ppm_f29: (d) => `Hola ${d.contacto || d.empresa}: está próximo el pago de PPM (mes ${d.periodo}). Su F29 estimado ya está listo en el sistema — cualquier ajuste lo revisamos juntos antes de declarar.`,
  cierre: (d) => `Hola ${d.contacto || d.empresa}: el cierre del período ${d.periodo} está listo para su revisión. Confirme su checklist en el sistema para bloquear el mes.`,
  reactivacion: (d) => `Hola ${d.contacto || d.empresa}: hemos notado que su sincronización con el SII lleva ${d.dias} días sin actualizar. ¿Agendamos una revisión rápida?`,
  frost: (d) => `Hola ${d.contacto || d.empresa}: le recordamos que tiene documentos pendientes de contabilizar (${d.cantidad}). Los revisamos y los procesamos en los próximos días.`,
}

function periodoActual() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function parseJson(texto, defecto = null) {
  if (!texto) return defecto
  try { return JSON.parse(texto) } catch { return defecto }
}

/* ============================ 1. PIPELINE ============================ */

/** Etapa actual de cada empresa (crea fila CRM si no existe, PENDIENTE aumenta). */
function listarPipeline(db, { usuarioId, ip = null }) {
  const filas = db.prepare(`
    SELECT e.id AS empresa_id, e.rut, e.nombre, e.activo,
           c.etapa, c.notas, c.proximo_contacto, c.ultima_interaccion,
           c.actualizado_en
    FROM empresas e
    LEFT JOIN crm_pipeline c ON c.empresa_id = e.id
    ORDER BY e.nombre
  `).all()
  return filas.map((f) => ({
    empresa_id: f.empresa_id, rut: f.rut, nombre: f.nombre, activo: !!f.activo,
    etapa: f.etapa || 'PROSPECTO', notas: f.notas || null,
    proximo_contacto: f.proximo_contacto || null, ultima_interaccion: f.ultima_interaccion || null,
    actualizado_en: f.actualizado_en || null,
  }))
}

function actualizarEtapa(db, { usuarioId, empresaId, etapa, notas = null, proximoContacto = null, ip = null }) {
  if (!ETAPAS.includes(etapa)) throw new Error(`Etapa inválida: ${etapa} (válidas: ${ETAPAS.join(', ')})`)
  const emp = db.prepare(`SELECT id, nombre FROM empresas WHERE id = ?`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const previa = db.prepare(`SELECT etapa, notas FROM crm_pipeline WHERE empresa_id = ?`).get(empresaId)
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO crm_pipeline (empresa_id, etapa, notas, proximo_contacto, ultima_interaccion, actualizado_en)
      VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(empresa_id) DO UPDATE SET
        etapa = excluded.etapa,
        notas = COALESCE(excluded.notas, crm_pipeline.notas),
        proximo_contacto = excluded.proximo_contacto,
        actualizado_en = datetime('now')
    `).run(empresaId, etapa, notas, proximoContacto)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'crm.etapa_cambiar', entidad: 'crm_pipeline', entidadId: String(empresaId),
      antes: previa ? { etapa: previa.etapa } : null,
      despues: { etapa, notas, proximo_contacto: proximoContacto }, ip,
    })
  })
  tx()
  return { ok: true, empresa_id: empresaId, etapa }
}

function registrarInteraccion(db, { usuarioId, empresaId, notas = null, ip = null }) {
  const emp = db.prepare(`SELECT id FROM empresas WHERE id = ?`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  db.prepare(`
    INSERT INTO crm_pipeline (empresa_id, etapa, ultima_interaccion, notas, actualizado_en)
    VALUES (?, 'OPERATIVO', datetime('now'), ?, datetime('now'))
    ON CONFLICT(empresa_id) DO UPDATE SET
      ultima_interaccion = datetime('now'),
      notas = COALESCE(?, crm_pipeline.notas),
      actualizado_en = datetime('now')
  `).run(empresaId, notas, notas)
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'crm.interaccion', entidad: 'crm_pipeline', entidadId: String(empresaId),
    despues: { notas }, ip,
  })
  return { ok: true }
}

/* ========================== 2. RECORDATORIOS ========================== */

function listarRecordatorios(db, { usuarioId, soloPendientes = true, ip = null }) {
  const lim = soloPendientes ? 'WHERE r.done = 0' : ''
  return db.prepare(`
    SELECT r.id, r.empresa_id, e.nombre AS empresa_nombre, r.tipo, r.titulo,
           r.fecha, r.done, r.completado_en, r.notas, r.creado_en
    FROM crm_recordatorios r JOIN empresas e ON e.id = r.empresa_id
    ${lim}
    ORDER BY r.fecha ASC, r.id ASC
  `).all()
}

function crearRecordatorio(db, { usuarioId, empresaId, tipo, titulo, fecha, notas = null, ip = null }) {
  if (!TIPOS_RECORDATORIO.includes(tipo)) throw new Error(`Tipo inválido: ${tipo}`)
  if (!titulo || !String(titulo).trim()) throw new Error('Título obligatorio')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) throw new Error('Fecha inválida (YYYY-MM-DD)')
  const emp = db.prepare(`SELECT id FROM empresas WHERE id = ?`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO crm_recordatorios (empresa_id, tipo, titulo, fecha, notas)
      VALUES (?, ?, ?, ?, ?)
    `).run(empresaId, tipo, String(titulo).trim(), fecha, notas)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'crm.recordatorio_crear', entidad: 'crm_recordatorios', entidadId: String(info.lastInsertRowid),
      despues: { tipo, titulo, fecha }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx() }
}

function completarRecordatorio(db, { usuarioId, recordatorioId, ip = null }) {
  const row = db.prepare(`
    SELECT r.id, r.empresa_id, r.done FROM crm_recordatorios r WHERE r.id = ?
  `).get(recordatorioId)
  if (!row) throw new Error('Recordatorio no encontrado')
  if (row.done) return { ok: true, ya_completado: true }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE crm_recordatorios SET done = 1, completado_en = datetime('now') WHERE id = ?`).run(recordatorioId)
    registrarAccion(db, {
      empresaId: row.empresa_id, usuarioId, accion: 'crm.recordatorio_completar', entidad: 'crm_recordatorios', entidadId: String(recordatorioId),
      ip,
    })
  })
  tx()
  return { ok: true }
}

/* ============================= 3. CAMPAÑAS ============================= */

function listarCampanas(db) {
  return db.prepare(`
    SELECT c.id, c.empresa_id, e.nombre AS empresa_nombre, c.plantilla,
           c.periodo, c.mensaje, c.enviado, c.enviado_en, c.creado_en
    FROM crm_campanas c JOIN empresas e ON e.id = c.empresa_id
    ORDER BY c.creado_en DESC, c.id DESC
  `).all()
}

/**
 * Genera el mensaje desde la plantilla con datos reales (nombre de empresa,
 * período). No lo envía automáticamente nada: el despacho copia/pega a
 * WhatsApp o correo; registrarlo como enviado es una acción humana aquí.
 */
function generarCampana(db, { usuarioId, empresaId, plantilla, periodo = null, contacto = null, ip = null }) {
  const fn = PLANTILLAS_CAMPANA[plantilla]
  if (!fn) throw new Error(`Plantilla inválida: ${plantilla} (válidas: ${Object.keys(PLANTILLAS_CAMPANA).join(', ')})`)
  const emp = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ?`).get(empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const per = periodo || periodoActual()
  const datos = { empresa: emp.nombre, contacto, periodo: per, dias: 0, cantidad: 0 }
  // Para reactivación / recordatorio se inyectan datos reales del engagement.
  if (plantilla === 'reactivacion') {
    const sal = diasUltimaSincronizacion(db, empresaId)
    datos.dias = sal
  }
  if (plantilla === 'frost') {
    const pend = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ? AND estado = 'PENDIENTE'`).get(empresaId)
    datos.cantidad = pend?.n || 0
  }
  const mensaje = fn(datos)
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO crm_campanas (empresa_id, plantilla, periodo, mensaje)
      VALUES (?, ?, ?, ?)
    `).run(empresaId, plantilla, per, mensaje)
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'crm.campana_generar', entidad: 'crm_campanas', entidadId: String(info.lastInsertRowid),
      despues: { plantilla, periodo: per }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx(), mensaje, plantilla, periodo: per }
}

function marcarEnviado(db, { usuarioId, campanaId, ip = null }) {
  const row = db.prepare(`SELECT id, empresa_id, enviado FROM crm_campanas WHERE id = ?`).get(campanaId)
  if (!row) throw new Error('Campaña no encontrada')
  if (row.enviado) return { ok: true, ya_enviado: true }
  const tx = db.transaction(() => {
    db.prepare(`UPDATE crm_campanas SET enviado = 1, enviado_en = datetime('now') WHERE id = ?`).run(campanaId)
    registrarAccion(db, {
      empresaId: row.empresa_id, usuarioId, accion: 'crm.campana_enviar', entidad: 'crm_campanas', entidadId: String(campanaId),
      ip,
    })
  })
  tx()
  return { ok: true }
}

/* ============================ 4. ENGAGEMENT ============================ */

/** Días desde la última ingesta/documento descargado de la empresa. */
function diasUltimaSincronizacion(db, empresaId) {
  const row = db.prepare(`
    SELECT MAX(creado_en) AS ultima FROM documentos WHERE empresa_id = ?
  `).get(empresaId)
  if (!row?.ultima) return null
  const fecha = new Date(String(row.ultima).replace(' ', 'T') + (row.ultima.includes('Z') ? '' : 'Z'))
  if (Number.isNaN(fecha.getTime())) return null
  return Math.max(0, Math.floor((Date.now() - fecha.getTime()) / 86400e3))
}

/**
 * Score de salud 0-100 por empresa. Datos REALES:
 *  +40 si sincronización ≤ 15 días, +20 si ≤ 30, 0 si más o nula
 *  +20 si documentos pendientes = 0; +10 si < 5; 0 si ≥ 5
 *  +20 si período actual está CERRADO o hay cierre; ONBOARDING cuenta medio
 *  +20 si contacto del pipeline ≤ 30 días; +10 ≤ 60; 0 si más
 */
function engagement(db, { usuarioId, ip = null }) {
  const out = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE activo = 1 ORDER BY nombre`).all().map((e) => {
    const dias = diasUltimaSincronizacion(db, e.id)
    const pendientes = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ? AND estado = 'PENDIENTE'`).get(e.id)?.n || 0
    const etapaRow = db.prepare(`SELECT etapa, ultima_interaccion FROM crm_pipeline WHERE empresa_id = ?`).get(e.id)
    const cierre = db.prepare(`SELECT estado FROM periodos_contables WHERE empresa_id = ? ORDER BY periodo DESC LIMIT 1`).get(e.id)
    const diasContacto = (() => {
      if (!etapaRow?.ultima_interaccion) return null
      const f = new Date(String(etapaRow.ultima_interaccion).replace(' ', 'T') + 'Z')
      return Math.max(0, Math.floor((Date.now() - f.getTime()) / 86400e3))
    })()

    let score = 0
    let detalle = {}
    if (dias === null) detalle.sincronizacion = 'sin datos'
    else if (dias <= 15) { score += 40; detalle.sincronizacion = 'reciente' }
    else if (dias <= 30) { score += 20; detalle.sincronizacion = 'rezagada' }
    else detalle.sincronizacion = 'atrasada'

    if (pendientes === 0) { score += 20; detalle.pendientes = 'en cero' }
    else if (pendientes < 5) { score += 10; detalle.pendientes = `${pendientes} pendientes` }
    else detalle.pendientes = `${pendientes} pendientes (crítico)`

    if (cierre?.estado === 'CERRADO') { score += 20; detalle.cierre = 'al día' }
    else if (cierre?.estado === 'ABIERTO' && dias !== null && dias <= 10) { score += 10; detalle.cierre = 'en curso' }
    else detalle.cierre = 'sin cierre del período'

    if (diasContacto === null) detalle.contacto = 'sin registro'
    else if (diasContacto <= 30) { score += 20; detalle.contacto = 'reciente' }
    else if (diasContacto <= 60) { score += 10; detalle.contacto = 'rezagado' }
    else detalle.contacto = 'lejos'

    const etiqueta = score >= 75 ? 'SANO' : (score >= 45 ? 'ATENCION' : 'CRITICO')
    return {
      empresa_id: e.id, rut: e.rut, nombre: e.nombre,
      etapa: etapaRow?.etapa || 'PROSPECTO',
      dias_desde_sincronizacion: dias,
      documentos_pendientes: pendientes,
      dias_desde_contacto: diasContacto,
      periodo_estado: cierre?.estado || null,
      score, etiqueta, detalle,
    }
  })
  return {
    ok: true,
    generado_en: new Date().toISOString(),
    clientes: out,
    resumen: {
      SANO: out.filter((x) => x.etiqueta === 'SANO').length,
      ATENCION: out.filter((x) => x.etiqueta === 'ATENCION').length,
      CRITICO: out.filter((x) => x.etiqueta === 'CRITICO').length,
      promedio: out.length ? Math.round(out.reduce((s, x) => s + x.score, 0) / out.length) : 0,
    },
  }
}

/* ========================= 5. MIGRACIONES ========================= */

function migracionesCrm(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_pipeline (
      empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
      etapa TEXT NOT NULL DEFAULT 'PROSPECTO',
      notas TEXT,
      proximo_contacto TEXT,
      ultima_interaccion TEXT,
      actualizado_en TEXT
    );
    CREATE TABLE IF NOT EXISTS crm_recordatorios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      fecha TEXT NOT NULL,
      notas TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      completado_en TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_recordatorios_empresa ON crm_recordatorios(empresa_id, done, fecha);
    CREATE TABLE IF NOT EXISTS crm_campanas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      plantilla TEXT NOT NULL,
      periodo TEXT NOT NULL,
      mensaje TEXT NOT NULL,
      enviado INTEGER NOT NULL DEFAULT 0,
      enviado_en TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_campanas_empresa ON crm_campanas(empresa_id, creado_en);
  `)
}

module.exports = {
  ETAPAS, TIPOS_RECORDATORIO, PLANTILLAS_CAMPANA,
  listarPipeline, actualizarEtapa, registrarInteraccion,
  listarRecordatorios, crearRecordatorio, completarRecordatorio,
  listarCampanas, generarCampana, marcarEnviado,
  engagement, diasUltimaSincronizacion,
  migracionesCrm,
}
