/**
 * crm-comercial.js — CRM comercial (rediseño 2026-10-15).
 *
 * Completa el módulo de fidelización (core/crm.js) con el lado COMERCIAL del
 * despacho, adaptando patrones de Twenty/Frappe/EspoCRM (AGPL-3.0: solo ideas,
 * cero código/dependencias) sobre la base EXISTENTE:
 *
 *  - FICHA COMERCIAL (1:1 `empresas`): nombre comercial, giro, correo,
 *    dirección, fuente, prioridad — SIN duplicar el maestro ni el RUT.
 *  - CONTACTOS: personas asociadas a una empresa (cargo/correo/teléfono),
 *    con dedupe parcial UNIQUE(empresa_id, correo).
 *  - PROSPECTOS: lead pre-empresa (fuente/necesidad/prioridad) con conversión
 *    controlada que VINCULA la empresa real si existe (nunca inventa
 *    `empresas` con clave SII falsa) y conserva el historial.
 *  - OPORTUNIDADES: Kanban + tabla leyendo SIEMPRE los mismos datos, montos
 *    INTEGER CLP, probabilidad y MONTO PONDERADO con UNA expresión SQL
 *    compartida (MONTO_PESADO — única fuente del cálculo comercial).
 *  - EMBUDO CONFIGURABLE: etapas en tabla con orden/prob default/terminal
 *    (GANADA/PERDIDA); toda transición queda en historial.
 *  - ACTIVIDADES: tarea/llamada/reunión/nota asociadas a
 *    empresa/contacto/oportunidad, con vencimiento y estado.
 *  - INFORMES: embudo por etapa, conversión, responsable, perdidas con causa,
 *    proyección ponderada, seguimiento pendiente.
 *  - Búsqueda global del módulo y detección de duplicados (RUT/correo/nombre).
 *
 * Recordatorios/engagement/campañas siguen viniendo de core/crm.js (no se
 * duplican). Multitenant: el ROUTER valida guardCrm/accesoEmpresa; aquí se
 * revalida existencia de la empresa. Todo ESCRITO va auditado.
 * Módulo puro: BD por parámetro; lectura nunca muta.
 */

const { registrarAccion } = require('./auditoria')

/* ============================ CONSTANTES ============================= */

/** Expresión SQL ÚNICA del monto ponderado (§Fase 4): kanban, tabla e informes
 * usan ESTA expresión. Monto en CLP entero (convención del sistema). */
const MONTO_PESADO = `ROUND(o.monto * o.probabilidad / 100.0)`

const FUENTES = ['prospeccion', 'referencia', 'sii', 'web', 'whatsapp', 'otro']
const PRIORIDADES = ['alta', 'media', 'baja']
const PROSPECTO_ESTADOS = ['NUEVO', 'EN_CONTACTO', 'DESCARTADO', 'CONVERTIDO']
const ACTIVIDAD_TIPOS = ['tarea', 'llamada', 'reunion', 'nota']
const ACTIVIDAD_ESTADOS = ['PENDIENTE', 'COMPLETADA', 'CANCELADA']

/** Embudo SEMILLA (la tabla `crm_oportunidad_etapas` es configurable). */
const ETAPAS_SEMILLA = [
  { nombre: 'DETALLE', orden: 1, prob_default: 10, terminal: 0, ganada: 0 },
  { nombre: 'EVALUACION', orden: 2, prob_default: 30, terminal: 0, ganada: 0 },
  { nombre: 'PROPUESTA', orden: 3, prob_default: 50, terminal: 0, ganada: 0 },
  { nombre: 'NEGOCIACION', orden: 4, prob_default: 75, terminal: 0, ganada: 0 },
  { nombre: 'GANADA', orden: 5, prob_default: 100, terminal: 1, ganada: 1 },
  { nombre: 'PERDIDA', orden: 6, prob_default: 0, terminal: 1, ganada: 0 },
]

const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Helper multitenant (misma política que core/crm.js): WHERE parametrizado
 * por ids de empresa permitidos; null/undefined = sin límite (super admin).
 * Cada tabla usa su alias real: `e.id` o `p.empresa_id`/`o.empresa_id`. */
function filtroTenantC(empresaIds, col = 'e.id') {
  if (!Array.isArray(empresaIds)) return { sql: '', params: [] }
  if (!empresaIds.length) return { sql: ` AND ${col} = -1`, params: [] }
  return { sql: ` AND ${col} IN (${empresaIds.map(() => '?').join(',')})`, params: empresaIds }
}

function normRut(rut) {
  return String(rut || '').replace(/[.\-\s]/g, '').toUpperCase()
}
function normCorreo(correo) {
  return String(correo || '').trim().toLowerCase()
}
function validarEmail(correo) {
  return !correo || RE_EMAIL.test(correo)
}

/* =========================== MIGRACIONES ============================ */

/** Crea tabla por tabla (llamada por db.js y core/migraciones.js). */
function crearTablasCrmComercial(db) {
  db.exec(`
    -- EMBUDO CONFIGURABLE (EspoCRM-style): etapas con orden, probabilidad
    -- default y terminal (GANADA/PERDIDA finales). Editable por SQL/admin.
    CREATE TABLE IF NOT EXISTS crm_oportunidad_etapas (
      nombre TEXT PRIMARY KEY COLLATE NOCASE,
      orden INTEGER NOT NULL UNIQUE,
      prob_default INTEGER NOT NULL DEFAULT 10,
      terminal INTEGER NOT NULL DEFAULT 0,
      ganada INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS crm_fichas (
      empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id),
      nombre_comercial TEXT,
      giro TEXT,
      correo TEXT,
      direccion TEXT,
      fuente TEXT,
      prioridad TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS crm_contactos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      nombre TEXT NOT NULL,
      cargo TEXT,
      correo TEXT,
      telefono TEXT,
      notas TEXT,
      responsable TEXT,
      principal INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_contactos_correo
      ON crm_contactos(empresa_id, correo) WHERE correo IS NOT NULL AND correo != '';
    CREATE INDEX IF NOT EXISTS idx_crm_contactos_empresa ON crm_contactos(empresa_id);

    CREATE TABLE IF NOT EXISTS crm_prospectos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      rut TEXT,
      correo TEXT,
      telefono TEXT,
      fuente TEXT,
      necesidad TEXT,
      prioridad TEXT NOT NULL DEFAULT 'media',
      estado TEXT NOT NULL DEFAULT 'NUEVO',
      responsable TEXT,
      notas TEXT,
      empresa_id INTEGER REFERENCES empresas(id),
      oportunidad_id INTEGER,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_prospectos_correo
      ON crm_prospectos(correo) WHERE correo IS NOT NULL AND correo != '';
    CREATE INDEX IF NOT EXISTS idx_crm_prospectos_rut ON crm_prospectos(rut)
      WHERE rut IS NOT NULL AND rut != '';
    CREATE INDEX IF NOT EXISTS idx_crm_prospectos_estado ON crm_prospectos(estado);

    CREATE TABLE IF NOT EXISTS crm_oportunidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      contacto_id INTEGER REFERENCES crm_contactos(id),
      monto INTEGER NOT NULL DEFAULT 0,
      moneda TEXT NOT NULL DEFAULT 'CLP',
      etapa TEXT NOT NULL DEFAULT 'DETALLE',
      probabilidad INTEGER NOT NULL DEFAULT 10,
      fecha_cierre_estimada TEXT,
      cierre_real TEXT,
      primera_accion TEXT,
      fecha_seguimiento TEXT,
      motivo_perdida TEXT,
      productos_json TEXT,
      responsable TEXT,
      creado_en TEXT DEFAULT (datetime('now')),
      actualizado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_opo_empresa ON crm_oportunidades(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_crm_opo_etapa ON crm_oportunidades(etapa);
    CREATE INDEX IF NOT EXISTS idx_crm_opo_seguimiento ON crm_oportunidades(fecha_seguimiento);

    CREATE TABLE IF NOT EXISTS crm_oportunidad_historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oportunidad_id INTEGER NOT NULL REFERENCES crm_oportunidades(id),
      desde TEXT,
      hasta TEXT,
      comentario TEXT,
      usuario_id REFERENCES users(id),
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_hist_opo ON crm_oportunidad_historial(oportunidad_id);

    CREATE TABLE IF NOT EXISTS crm_actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      titulo TEXT NOT NULL,
      detalle TEXT,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE',
      prioridad TEXT NOT NULL DEFAULT 'media',
      vencimiento TEXT,
      responsable TEXT,
      empresa_id REFERENCES empresas(id),
      contacto_id REFERENCES crm_contactos(id),
      oportunidad_id INTEGER REFERENCES crm_oportunidades(id),
      completada_en TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_act_estado ON crm_actividades(estado, vencimiento);
    CREATE INDEX IF NOT EXISTS idx_crm_act_empresa ON crm_actividades(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_crm_act_opo ON crm_actividades(oportunidad_id);
  `)
}

/** Siembra del embudo (INSERT OR IGNORE — etapas del despacho se preservan). */
function migracionesCrmComercial(db) {
  for (const e of ETAPAS_SEMILLA) {
    db.prepare(`
      INSERT OR IGNORE INTO crm_oportunidad_etapas (nombre, orden, prob_default, terminal, ganada)
      VALUES (?, ?, ?, ?, ?)
    `).run(e.nombre, e.orden, e.prob_default, e.terminal, e.ganada)
  }
}

/* ========================= VALIDADORES BASE ========================== */

/**
 * CONFIGURACIÓN DEL EMBUDO (§E — "stages" de Twenty/Espo, patrón sin copia):
 * CRUD de etapas con reglas de negocio conservadoras:
 *  - crear: nombre único (NOCASE), orden disincto de la semillada, prob 0..100
 *  - editar: prob/orden cambiables; GANADA/PERDIDA NO cambian de nombre, de
 *    terminal ni de significado (el historial y los informes dependen de ello)
 *  - eliminar: solo si NO hay oportunidades referenciándola ni es terminal
 *  - re-ordenar: de una vez, con la lista completa (fase UI drag-less)
 *
 * Todo auditado (auditoría) — el embudo es configuración comercial del despacho.
 */
const MIN_ETAPAS = 2

/**
 * Renumeración atómica de las etapas: el `orden UNIQUE` de la tabla prohíbe
 * corrimientos parciales (colisión de valores). Técnica en dos pasadas DENTRO
 * de la transacción: (1) mapea TODO orden actual a un valor único alto
 * (inyectivo: nunca colisiona), (2) asigna el orden final secuencial.
 */
const OFFSET_ORDEN = 1000
function renumerarEtapas(db, nombresEnOrden) {
  // Pasada 1: valor antiguo + 200000 por fila — mapeo inyectivo, sin colisiones
  db.prepare(`UPDATE crm_oportunidad_etapas SET orden = 200000 + orden`).run()
  nombresEnOrden.forEach((nombre, i) =>
    db.prepare(`UPDATE crm_oportunidad_etapas SET orden = ? WHERE nombre = ? COLLATE NOCASE`).run(i + 1, nombre))
  const terminales = db.prepare(`SELECT nombre FROM crm_oportunidad_etapas WHERE terminal = 1 ORDER BY orden`).all().map((r) => r.nombre)
  terminales.forEach((nombre, j) =>
    db.prepare(`UPDATE crm_oportunidad_etapas SET orden = ? WHERE nombre = ? COLLATE NOCASE`).run(nombresEnOrden.length + 1 + j, nombre))
}

function validarNombreEtapa(nombre) {
  const n = String(nombre || '').trim().toUpperCase()
  if (!n || n.length < 2 || n.length > 40) throw new Error('Nombre de etapa: 2..40 caracteres')
  return n
}

function listarEtapas(db) { return etapasDe(db) }

/** Crea una etapa NO terminal (las terminales solo nacen en la semilla). */
function crearEtapa(db, { usuarioId, etapa, ip = null }) {
  const nombre = validarNombreEtapa(etapa && etapa.nombre)
  if (!etapaDe(db, nombre)) {
    // continúa: el nombre NO existe — es el caso válido
  } else {
    throw new Error(`Etapa duplicada: ${nombre}`)
  }
  if (!validarProb(etapa.prob_default ?? 0)) throw new Error('prob_default inválida (entero 0..100)')
  const existentes = etapasDe(db)
  const maxOrden = Math.max(...existentes.filter((e) => !e.terminal).map((e) => e.orden), 0)
  const orden = Number.isInteger(Number(etapa.orden)) ? Math.round(Number(etapa.orden)) : maxOrden + 1
  // el orden debe quedar ENTRE etapas no terminales (ANTES de GANADA/PERDIDA)
  if (orden < 1 || orden > maxOrden + 1) throw new Error(`orden debe estar entre 1 y ${maxOrden + 1} (antes de las terminales)`)
  const noticia = existentes.filter((e) => !e.terminal && e.nombre.toUpperCase() !== nombre).map((e) => e.nombre)
  noticia.splice(Math.min(orden - 1, noticia.length), 0, nombre)
  const tx = db.transaction(() => {
    // insert con orden transitorio en un rango disjunto (300000+): la
    // renumeración final REUBICA a la nueva junto con las existentes
    db.prepare(`
      INSERT INTO crm_oportunidad_etapas (nombre, orden, prob_default, terminal, ganada)
      VALUES (?, ?, ?, 0, 0)
    `).run(nombre, 300000 + orden, Math.round(Number(etapa.prob_default ?? 0)))
    renumerarEtapas(db, noticia)
    registrarAccion(db, {
      usuarioId, accion: 'crm.etapa_crear', entidad: 'crm_oportunidad_etapas', entidadId: nombre,
      despues: { nombre, orden, prob_default: Math.round(Number(etapa.prob_default ?? 0)) }, ip,
    })
  })
  tx()
  return { ok: true, nombre, orden }
}

/** Edita prob_default y/o orden de una etapa existente. Terminal: prob libre, resto NO. */
function editarEtapa(db, { usuarioId, nombre, etapa, ip = null }) {
  const fila = etapaDe(db, nombre)
  if (!fila) throw new Error(`Etapa inexistente: ${nombre}`)
  const nuevoNombre = etapa && etapa.nombre != null ? validarNombreEtapa(etapa.nombre) : fila.nombre
  const esTerminal = fila.terminal === 1
  if (esTerminal && (nuevoNombre !== fila.nombre)) throw new Error('No se renombra GANADA/PERDIDA (terminales del embudo)')
  if (!esTerminal && etapaDe(db, nuevoNombre) && nuevoNombre.toUpperCase() !== fila.nombre.toUpperCase()) throw new Error(`Etapa duplicada: ${nuevoNombre}`)
  const prob = etapa != null && etapa.prob_default != null ? Number(etapa.prob_default) : fila.prob_default
  if (!validarProb(prob)) throw new Error('prob_default inválida (entero 0..100)')
  if (esTerminal && etapa.orden != null && Number(etapa.orden) !== fila.orden) throw new Error('No se reordena una etapa terminal (siempre al final del embudo)')
  const nuevoOrden = etapa && etapa.orden != null ? Math.round(Number(etapa.orden)) : fila.orden
  if (!Number.isInteger(nuevoOrden) || nuevoOrden < 1) throw new Error('orden inválido (entero ≥ 1)')
  const tx = db.transaction(() => {
    if (nuevoOrden !== fila.orden) {
      // mover: renumeración completa de las no terminales con la etapa en su posición
      const otras = etapasDe(db).filter((e) => !e.terminal && e.nombre.toUpperCase() !== fila.nombre.toUpperCase()).map((e) => e.nombre)
      otras.splice(Math.min(nuevoOrden - 1, otras.length), 0, fila.nombre)
      renumerarEtapas(db, otras)
    }
    db.prepare(`UPDATE crm_oportunidad_etapas SET nombre = ?, prob_default = ? WHERE nombre = ?`).run(nuevoNombre, prob, fila.nombre)
    registrarAccion(db, {
      usuarioId, accion: 'crm.etapa_editar', entidad: 'crm_oportunidad_etapas', entidadId: fila.nombre,
      antes: { nombre: fila.nombre, orden: fila.orden, prob_default: fila.prob_default },
      despues: { nombre: nuevoNombre, orden: nuevoOrden, prob_default: prob }, ip,
    })
  })
  tx()
  return { ok: true, nombre: nuevoNombre, orden: nuevoOrden, prob_default: prob }
}

/** Elimina una etapa SOLO si no es terminal y no hay oportunidades en ella. */
function eliminarEtapa(db, { usuarioId, nombre, ip = null }) {
  const fila = etapaDe(db, nombre)
  if (!fila) throw new Error(`Etapa inexistente: ${nombre}`)
  if (fila.terminal === 1) throw new Error('No se elimina GANADA/PERDIDA (terminales del embudo)')
  const enUso = db.prepare(`SELECT COUNT(*) AS n FROM crm_oportunidades WHERE etapa = ? COLLATE NOCASE`).get(nombre)
  if (enUso.n > 0) throw new Error(`Imposible eliminar: ${enUso.n} oportunidad(es) usan la etapa ${nombre}`)
  if (etapasDe(db).filter((e) => e.terminal === 0).length <= MIN_ETAPAS) throw new Error(`El embudo conserva al menos ${MIN_ETAPAS} etapas no terminales`)
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM crm_oportunidad_etapas WHERE nombre = ?`).run(nombre)
    // compactar orden de las restantes no terminales (renumeración sin huecos)
    renumerarEtapas(db, etapasDe(db).filter((e) => e.terminal === 0).map((e) => e.nombre))
    registrarAccion(db, {
      usuarioId, accion: 'crm.etapa_eliminar', entidad: 'crm_oportunidad_etapas', entidadId: nombre,
      antes: { nombre, orden: fila.orden, prob_default: fila.prob_default }, ip,
    })
  })
  tx()
  return { ok: true }
}

function empresaExiste(db, empresaId) {
  return db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
}
function etapaDe(db, nombre) {
  return db.prepare(`
    SELECT nombre, orden, prob_default, terminal, ganada
    FROM crm_oportunidad_etapas WHERE nombre = ? COLLATE NOCASE
  `).get(nombre)
}
function etapasDe(db) {
  return db.prepare(`
    SELECT nombre, orden, prob_default, terminal, ganada
    FROM crm_oportunidad_etapas ORDER BY orden
  `).all()
}
function validarProb(p) {
  return Number.isInteger(Number(p)) && Number(p) >= 0 && Number(p) <= 100
}

/* ========================= 1. FICHA COMERCIAL ======================== */

function obtenerFicha(db, empresaId) {
  const emp = empresaExiste(db, empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const ficha = db.prepare(`SELECT * FROM crm_fichas WHERE empresa_id = ?`).get(empresaId)
  const pipeline = db.prepare(`
    SELECT etapa, notas, proximo_contacto, ultima_interaccion
    FROM crm_pipeline WHERE empresa_id = ?`).get(empresaId)
  const contactos = db.prepare(`
    SELECT id, nombre, cargo, correo, telefono, principal, responsable
    FROM crm_contactos WHERE empresa_id = ? ORDER BY principal DESC, nombre
  `).all(empresaId)
  const opo = db.prepare(`
    SELECT COUNT(*) AS n, COALESCE(SUM(${MONTO_PESADO}),0) AS pesado
    FROM crm_oportunidades o WHERE o.empresa_id = ?
  `).get(empresaId)
  // §G (referencias, NO duplicación): conteos de documentos/bandeja y período
  // contable de esta empresa. Solo META-datos — el contenido fiduciario
  // sigue en sus módulos con sus propias autorizaciones; la ficha comercial
  // solo enlaza. `documentos` existe (bandeja SII); `periodos_contables` igual.
  const docsResumen = (() => {
    try {
      const r = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS pendientes,
               SUM(CASE WHEN tipo_flujo = 'compra' THEN 1 ELSE 0 END) AS compras,
               SUM(CASE WHEN tipo_flujo = 'venta' THEN 1 ELSE 0 END) AS ventas,
               MAX(COALESCE(fecha_docto, '')) AS ultimo_docto
        FROM documentos WHERE empresa_id = ?`).get(empresaId)
      return { total: r?.total || 0, pendientes: r?.pendientes || 0, compras: r?.compras || 0, ventas: r?.ventas || 0, ultimo_docto: r?.ultimo_docto || null }
    } catch { return { total: 0, pendientes: 0, compras: 0, ventas: 0, ultimo_docto: null } }
  })()
  const periodoActual = (() => {
    try { return db.prepare(`SELECT periodo, estado FROM periodos_contables WHERE empresa_id = ? ORDER BY periodo DESC LIMIT 1`).get(empresaId) || null } catch { return null }
  })()
  return {
    empresa: { id: emp.id, rut: emp.rut, nombre: emp.nombre },
    ficha: ficha || null,
    etapa: pipeline?.etapa || 'PROSPECTO',
    notas_pipeline: pipeline?.notas || null,
    proximo_contacto: pipeline?.proximo_contacto || null,
    ultima_interaccion: pipeline?.ultima_interaccion || null,
    contactos,
    oportunidades: { total: opo.n, monto_ponderado: opo.pesado },
    documentos: docsResumen,
    periodo_contable: periodoActual,
  }
}

/** UPSERT de la ficha: los campos ausentes conservan el valor previo. */
function guardarFicha(db, { usuarioId, empresaId, ficha, ip = null }) {
  const emp = empresaExiste(db, empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const previa = db.prepare(`SELECT * FROM crm_fichas WHERE empresa_id = ?`).get(empresaId)
  const conservar = (k) => (ficha[k] === undefined ? (previa ? previa[k] : null) : (ficha[k] ? String(ficha[k]).trim() : null))
  const datos = {
    nombre_comercial: conservar('nombre_comercial'),
    giro: conservar('giro'),
    correo: (ficha.correo === undefined ? (previa ? previa.correo : null) : normCorreo(ficha.correo) || null),
    direccion: conservar('direccion'),
    fuente: ficha.fuente === undefined ? (previa ? previa.fuente : null) : (ficha.fuente ? (FUENTES.includes(ficha.fuente) ? ficha.fuente : 'otro') : null),
    prioridad: ficha.prioridad === undefined ? (previa ? previa.prioridad : 'media') : (ficha.prioridad ? (PRIORIDADES.includes(ficha.prioridad) ? ficha.prioridad : 'media') : 'media'),
  }
  if (datos.nombre_comercial) datos.nombre_comercial = datos.nombre_comercial.slice(0, 200)
  if (datos.giro) datos.giro = datos.giro.slice(0, 120)
  if (datos.direccion) datos.direccion = datos.direccion.slice(0, 300)
  if (!validarEmail(datos.correo)) throw new Error('correo de la ficha inválido')
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO crm_fichas (empresa_id, nombre_comercial, giro, correo, direccion, fuente, prioridad, actualizado_en)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(empresa_id) DO UPDATE SET
        nombre_comercial = excluded.nombre_comercial,
        giro = excluded.giro,
        correo = excluded.correo,
        direccion = excluded.direccion,
        fuente = excluded.fuente,
        prioridad = excluded.prioridad,
        actualizado_en = datetime('now')
    `).run(empresaId, datos.nombre_comercial, datos.giro, datos.correo, datos.direccion, datos.fuente, datos.prioridad)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'crm.ficha_guardar', entidad: 'crm_fichas', entidadId: String(empresaId),
      antes: previa ? { giro: previa.giro, correo: previa.correo, fuente: previa.fuente, prioridad: previa.prioridad } : null,
      despues: datos, ip,
    })
  })
  tx()
  return { ok: true, ficha: obtenerFicha(db, empresaId).ficha }
}

/* ============================ 2. CONTACTOS =========================== */

function listarContactos(db, { empresaId = null, texto = null, empresaIds = null, limit = 100, offset = 0 } = {}) {
  const ten = filtroTenantC(empresaIds, 'e.id')
  const where = []
  const params = [...ten.params]
  if (ten.sql) where.push(`1=1${ten.sql}`)
  if (empresaId != null) { where.push('c.empresa_id = ?'); params.push(Number(empresaId)) }
  if (texto) { where.push('(c.nombre LIKE ? OR c.correo LIKE ? OR c.telefono LIKE ? OR e.nombre LIKE ?)'); const p = `%${texto}%`; params.push(p, p, p, p) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return db.prepare(`
    SELECT c.id, c.empresa_id, e.nombre AS empresa_nombre, e.rut,
           c.nombre, c.cargo, c.correo, c.telefono, c.notas, c.responsable,
           c.principal, c.creado_en
    FROM crm_contactos c JOIN empresas e ON e.id = c.empresa_id
    ${whereSql}
    ORDER BY e.nombre, c.principal DESC, c.nombre
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0)
}

function crearContacto(db, { usuarioId, empresaId, contacto, ip = null }) {
  const emp = empresaExiste(db, empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const nombre = String(contacto.nombre || '').trim()
  if (!nombre) throw new Error('El nombre del contacto es obligatorio')
  const correo = normCorreo(contacto.correo)
  if (!validarEmail(correo)) throw new Error('correo del contacto inválido')
  if (correo) {
    const dup = db.prepare(`SELECT id FROM crm_contactos WHERE empresa_id = ? AND correo = ?`).get(empresaId, correo)
    if (dup) throw new Error(`Contacto duplicado: id ${dup.id} ya tiene ese correo en ${emp.nombre}`)
  }
  let principal = contacto.principal ? 1 : 0
  const tx = db.transaction(() => {
    const nActuales = db.prepare(`SELECT COUNT(*) AS n FROM crm_contactos WHERE empresa_id = ?`).get(empresaId).n
    if (nActuales === 0) principal = 1 // el primer contacto es principal por defecto
    if (principal) db.prepare(`UPDATE crm_contactos SET principal = 0 WHERE empresa_id = ?`).run(empresaId)
    const info = db.prepare(`
      INSERT INTO crm_contactos (empresa_id, nombre, cargo, correo, telefono, notas, responsable, principal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      empresaId, nombre.slice(0, 200),
      contacto.cargo ? String(contacto.cargo).trim().slice(0, 120) : null,
      correo || null,
      contacto.telefono ? String(contacto.telefono).trim().slice(0, 40) : null,
      contacto.notas ? String(contacto.notas).trim().slice(0, 500) : null,
      contacto.responsable ? String(contacto.responsable).trim().slice(0, 120) : null,
      principal)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'crm.contacto_crear', entidad: 'crm_contactos', entidadId: String(info.lastInsertRowid),
      despues: { nombre, correo: correo || null, principal }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx() }
}

function editarContacto(db, { usuarioId, contactoId, contacto, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_contactos WHERE id = ?`).get(contactoId)
  if (!fila) throw new Error('Contacto no encontrado')
  const nombre = contacto.nombre !== undefined ? String(contacto.nombre).trim() : fila.nombre
  if (!nombre) throw new Error('El nombre del contacto es obligatorio')
  const correo = contacto.correo !== undefined ? normCorreo(contacto.correo) : fila.correo
  if (!validarEmail(correo)) throw new Error('correo del contacto inválido')
  if (correo && contacto.correo !== undefined) {
    const dup = db.prepare(`SELECT id FROM crm_contactos WHERE empresa_id = ? AND correo = ? AND id != ?`).get(fila.empresa_id, correo, contactoId)
    if (dup) throw new Error(`Contacto duplicado: id ${dup.id} ya tiene ese correo en esta empresa`)
  }
  const tx = db.transaction(() => {
    if (contacto.principal) {
      db.prepare(`UPDATE crm_contactos SET principal = 0 WHERE empresa_id = ?`).run(fila.empresa_id)
      db.prepare(`UPDATE crm_contactos SET principal = 1 WHERE id = ?`).run(contactoId)
    }
    db.prepare(`
      UPDATE crm_contactos SET
        nombre = ?, cargo = COALESCE(?, cargo), correo = ?, telefono = COALESCE(?, telefono),
        notas = COALESCE(?, notas), responsable = COALESCE(?, responsable),
        actualizado_en = datetime('now')
      WHERE id = ?
    `).run(
      nombre.slice(0, 200),
      contacto.cargo !== undefined ? (contacto.cargo ? String(contacto.cargo).trim().slice(0, 120) : null) : null,
      correo || null,
      contacto.telefono !== undefined ? (contacto.telefono ? String(contacto.telefono).trim().slice(0, 40) : null) : null,
      contacto.notas !== undefined ? (contacto.notas ? String(contacto.notas).trim().slice(0, 500) : null) : null,
      contacto.responsable !== undefined ? (contacto.responsable ? String(contacto.responsable).trim().slice(0, 120) : null) : null,
      contactoId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.contacto_editar', entidad: 'crm_contactos', entidadId: String(contactoId),
      antes: { nombre: fila.nombre, correo: fila.correo, principal: fila.principal },
      despues: { nombre, correo, principal: contacto.principal ? 1 : fila.principal }, ip,
    })
  })
  tx()
  return { ok: true }
}

function eliminarContacto(db, { usuarioId, contactoId, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_contactos WHERE id = ?`).get(contactoId)
  if (!fila) throw new Error('Contacto no encontrado')
  const usado = db.prepare(`SELECT COUNT(*) AS n FROM crm_oportunidades WHERE contacto_id = ?`).get(contactoId).n
  if (usado > 0) throw new Error(`El contacto está asociado a ${usado} oportunidad(es): desvincúlalas antes`)
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM crm_contactos WHERE id = ?`).run(contactoId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.contacto_eliminar', entidad: 'crm_contactos', entidadId: String(contactoId),
      antes: { nombre: fila.nombre, correo: fila.correo, principal: fila.principal }, ip,
    })
  })
  tx()
  return { ok: true }
}

/* ============================ 3. PROSPECTOS ========================== */

function listarProspectos(db, { estado = null, texto = null, empresaIds = null, limit = 100, offset = 0 } = {}) {
  // Tenant §5: un prospecto vinculado a empresa X solo lo ve quien tenga X
  // asignada; los SIN empresa (NUEVOS) son leads del despacho. Query con
  // параметриado total (nada concatenado) y params ordenados:
  //   [..tenant IN, estado, texto x3, limit, offset]
  const tenPros = filtroTenantC(empresaIds, 'p.empresa_id')  // AND p.empresa_id IN (...)
  const where = []
  const params = [...tenPros.params]
  if (tenPros.sql) where.push(`(p.empresa_id IS NULL OR 1=1${tenPros.sql})`.replace('AND p.empresa_id', 'AND p.empresa_id'))
  if (estado) { where.push('p.estado = ?'); params.push(estado) }
  if (texto) { where.push('(p.nombre LIKE ? OR p.rut LIKE ? OR p.correo LIKE ?)'); const p = `%${texto}%`; params.push(p, p, p) }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const prospectos = db.prepare(`
    SELECT p.id, p.nombre, p.rut, p.correo, p.telefono, p.fuente, p.necesidad,
           p.prioridad, p.estado, p.responsable, p.notas, p.empresa_id,
           e.nombre AS empresa_nombre, p.oportunidad_id, p.creado_en
    FROM crm_prospectos p LEFT JOIN empresas e ON e.id = p.empresa_id
    ${whereSql}
    ORDER BY CASE p.estado WHEN 'NUEVO' THEN 0 WHEN 'EN_CONTACTO' THEN 1 ELSE 2 END,
             p.creado_en DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 100, 500), Number(offset) || 0)
  const total = db.prepare(`SELECT COUNT(*) AS n FROM crm_prospectos p LEFT JOIN empresas e ON e.id = p.empresa_id ${whereSql}`).get(...params).n
  return { total, prospectos }
}

/** Búsqueda de empresa real por RUT normalizado (comparación en JS, sin UDF). */
function empresaPorRut(db, rut) {
  const objetivo = normRut(rut)
  if (!objetivo) return null
  const filas = db.prepare(`SELECT id, rut FROM empresas WHERE activo = 1`).all()
  const match = filas.find((e) => normRut(e.rut) === objetivo)
  return match ? match.id : null
}

function crearProspecto(db, { usuarioId, prospecto, importacion = false, ip = null }) {
  const nombre = String(prospecto.nombre || '').trim()
  if (!nombre) throw new Error('El nombre del prospecto es obligatorio')
  const rut = String(prospecto.rut || '').trim() || null
  if (rut) {
    const { validarRut } = require('./empresas')
    if (!validarRut(rut)) throw new Error(`RUT inválido: ${rut} (regla Chile M11)`)
  }
  const correo = normCorreo(prospecto.correo)
  if (!validarEmail(correo)) throw new Error('correo del prospecto inválido')
  if (correo) {
    const dup = db.prepare(`SELECT id FROM crm_prospectos WHERE correo = ?`).get(correo)
    if (dup) throw new Error(`Prospecto duplicado: id ${dup.id} ya tiene ese correo`)
  }
  if (prospecto.estado && !PROSPECTO_ESTADOS.includes(prospecto.estado)) {
    throw new Error(`Estado inválido: ${prospecto.estado} (válidos: ${PROSPECTO_ESTADOS.join(', ')})`)
  }
  const prioridad = prospecto.prioridad ? (PRIORIDADES.includes(prospecto.prioridad) ? prospecto.prioridad : 'media') : 'media'
  const fuente = prospecto.fuente ? (FUENTES.includes(prospecto.fuente) ? prospecto.fuente : 'otro') : null
  const estado = importacion ? 'NUEVO' : (prospecto.estado || 'NUEVO')
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO crm_prospectos (nombre, rut, correo, telefono, fuente, necesidad, prioridad, estado, responsable, notas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre.slice(0, 200), rut, correo || null,
      prospecto.telefono ? String(prospecto.telefono).trim().slice(0, 40) : null,
      fuente,
      prospecto.necesidad ? String(prospecto.necesidad).trim().slice(0, 500) : null,
      prioridad, estado,
      prospecto.responsable ? String(prospecto.responsable).trim().slice(0, 120) : null,
      prospecto.notas ? String(prospecto.notas).trim().slice(0, 500) : null)
    registrarAccion(db, {
      empresaId: null, usuarioId,
      accion: importacion ? 'crm.prospecto_importar' : 'crm.prospecto_crear',
      entidad: 'crm_prospectos', entidadId: String(info.lastInsertRowid),
      despues: { nombre, rut, correo: correo || null, fuente, prioridad, estado }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx() }
}

function editarProspecto(db, { usuarioId, prospectoId, prospecto, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_prospectos WHERE id = ?`).get(prospectoId)
  if (!fila) throw new Error('Prospecto no encontrado')
  if (fila.estado === 'CONVERTIDO' && prospecto.estado !== undefined && prospecto.estado !== 'CONVERTIDO') {
    throw new Error('Un CONVERTIDO no vuelve a estados previos (historial conservado)')
  }
  const nombre = prospecto.nombre !== undefined ? String(prospecto.nombre).trim() : fila.nombre
  if (!nombre) throw new Error('El nombre del prospecto es obligatorio')
  const rut = prospecto.rut !== undefined ? (String(prospecto.rut).trim() || null) : fila.rut
  if (rut) {
    const { validarRut } = require('./empresas')
    if (!validarRut(rut)) throw new Error(`RUT inválido: ${rut} (regla Chile M11)`)
  }
  const correo = prospecto.correo !== undefined ? normCorreo(prospecto.correo) : fila.correo
  if (!validarEmail(correo)) throw new Error('correo del prospecto inválido')
  if (correo && prospecto.correo !== undefined) {
    const dup = db.prepare(`SELECT id FROM crm_prospectos WHERE correo = ? AND id != ?`).get(correo, prospectoId)
    if (dup) throw new Error(`Prospecto duplicado: id ${dup.id} ya tiene ese correo`)
  }
  if (prospecto.estado !== undefined && !PROSPECTO_ESTADOS.includes(prospecto.estado)) {
    throw new Error(`Estado inválido: ${prospecto.estado}`)
  }
  const prioridad = prospecto.prioridad !== undefined
    ? (prospecto.prioridad ? (PRIORIDADES.includes(prospecto.prioridad) ? prospecto.prioridad : 'media') : 'media')
    : fila.prioridad
  const fuente = prospecto.fuente !== undefined
    ? (prospecto.fuente ? (FUENTES.includes(prospecto.fuente) ? prospecto.fuente : 'otro') : null)
    : fila.fuente
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE crm_prospectos SET nombre = ?, rut = ?, correo = ?,
        telefono = COALESCE(?, telefono), fuente = ?, necesidad = COALESCE(?, necesidad),
        prioridad = ?, estado = COALESCE(?, estado), responsable = COALESCE(?, responsable),
        notas = COALESCE(?, notas), actualizado_en = datetime('now')
      WHERE id = ?
    `).run(
      nombre.slice(0, 200), rut, correo || null,
      prospecto.telefono !== undefined ? (prospecto.telefono ? String(prospecto.telefono).trim().slice(0, 40) : null) : null,
      fuente,
      prospecto.necesidad !== undefined ? (prospecto.necesidad ? String(prospecto.necesidad).trim().slice(0, 500) : null) : null,
      prioridad,
      prospecto.estado !== undefined ? prospecto.estado : null,
      prospecto.responsable !== undefined ? (prospecto.responsable ? String(prospecto.responsable).trim().slice(0, 120) : null) : null,
      prospecto.notas !== undefined ? (prospecto.notas ? String(prospecto.notas).trim().slice(0, 500) : null) : null,
      prospectoId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.prospecto_editar', entidad: 'crm_prospectos', entidadId: String(prospectoId),
      antes: { estado: fila.estado, prioridad: fila.prioridad, rut: fila.rut },
      despues: { estado: prospecto.estado !== undefined ? prospecto.estado : fila.estado, prioridad, rut }, ip,
    })
  })
  tx()
  return { ok: true }
}

/**
 * CONVERSIÓN controlada (§D): marca el prospecto CONVERTIDO y lo conecta a la
 * empresa real cuando EXISTE (por empresaId explícito o RUT). Sin empresa:
 * queda apuntado al onboarding existente — NUNCA inventa `empresas` con
 * clave SII falsa. Opcional: vincula la oportunidad inicial creada antes.
 */
function convertirProspecto(db, { usuarioId, prospectoId, empresaId = null, oportunidadId = null, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_prospectos WHERE id = ?`).get(prospectoId)
  if (!fila) throw new Error('Prospecto no encontrado')
  if (fila.estado === 'CONVERTIDO') return { ok: true, ya_convertido: true }
  if (fila.estado === 'DESCARTADO') throw new Error('Un DESCARTADO no se convierte: re-actívalo primero')

  let empresaFinal = empresaId != null ? Number(empresaId) : fila.empresa_id
  if (empresaFinal == null && fila.rut) empresaFinal = empresaPorRut(db, fila.rut)
  if (empresaFinal != null && !empresaExiste(db, empresaFinal)) {
    throw new Error(`La empresa ${empresaFinal} no existe`)
  }
  let oportunidadFinal = null
  if (oportunidadId != null) {
    const opo = db.prepare(`SELECT id, empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(oportunidadId))
    if (!opo) throw new Error(`La oportunidad ${oportunidadId} no existe`)
    if (empresaFinal != null && opo.empresa_id !== empresaFinal) {
      throw new Error('La oportunidad no pertenece a la empresa de la conversión')
    }
    oportunidadFinal = opo.id
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE crm_prospectos SET estado = 'CONVERTIDO', empresa_id = ?,
        oportunidad_id = COALESCE(?, oportunidad_id), actualizado_en = datetime('now')
      WHERE id = ?
    `).run(empresaFinal, oportunidadFinal, prospectoId)
    if (empresaFinal != null) {
      const crm = require('./crm')
      crm.actualizarEtapa(db, {
        usuarioId, empresaId: empresaFinal,
        etapa: 'ONBOARDING', notas: `Prospecto #${prospectoId} (${fila.nombre}) convertido`, ip,
      })
    }
    registrarAccion(db, {
      empresaId: empresaFinal, usuarioId,
      accion: 'crm.prospecto_convertir', entidad: 'crm_prospectos', entidadId: String(prospectoId),
      antes: { estado: fila.estado, empresa_id: fila.empresa_id },
      despues: { estado: 'CONVERTIDO', empresa_id: empresaFinal, oportunidad_id: oportunidadFinal }, ip,
    })
  })
  tx()
  return { ok: true, estado: 'CONVERTIDO', empresa_id: empresaFinal, oportunidad_id: oportunidadFinal }
}

/** Importación en LOTE (§D): valida cada fila y reporta; nunca corta el lote. */
function importarProspectos(db, { usuarioId, prospectos, ip = null }) {
  if (!Array.isArray(prospectos) || prospectos.length === 0) throw new Error('Lista de prospectos vacía')
  if (prospectos.length > 500) throw new Error('Máximo 500 prospectos por importación')
  const aceptados = []
  const errores = []
  for (const [idx, fila] of prospectos.entries()) {
    try {
      const r = crearProspecto(db, { usuarioId, prospecto: fila, importacion: true })
      aceptados.push({ fila: idx + 1, id: r.id, nombre: fila ? String(fila.nombre || '') : null })
    } catch (err) {
      errores.push({ fila: idx + 1, nombre: fila ? String(fila.nombre || '') : null, error: err.message })
    }
  }
  if (aceptados.length) {
    registrarAccion(db, {
      empresaId: null, usuarioId,
      accion: 'crm.prospectos_importar_lote', entidad: 'crm_prospectos', entidadId: null,
      despues: { recibidos: prospectos.length, aceptados: aceptados.length, errores: errores.length }, ip,
    })
  }
  return { ok: true, total: prospectos.length, aceptados, errores }
}

/* ========================== 4. OPORTUNIDADES ========================= */

const SELECT_OPO_BASE = `
  SELECT o.id, o.nombre, o.empresa_id, e.nombre AS empresa_nombre, e.rut,
         o.contacto_id, c.nombre AS contacto_nombre,
         o.monto, o.moneda, o.etapa, o.probabilidad,
         ROUND(o.monto * o.probabilidad / 100.0) AS monto_ponderado,
         o.fecha_cierre_estimada, o.cierre_real, o.primera_accion, o.fecha_seguimiento,
         o.motivo_perdida, o.productos_json, o.responsable, o.creado_en, o.actualizado_en,
         et.terminal, et.ganada
  FROM crm_oportunidades o
  JOIN empresas e ON e.id = o.empresa_id
  LEFT JOIN crm_contactos c ON c.id = o.contacto_id
  JOIN crm_oportunidad_etapas et ON et.nombre = o.etapa COLLATE NOCASE
  WHERE 1=1
`

function listarOportunidades(db, { empresaId = null, empresaIds = null, etapa = null, estado = null, responsable = null,
  desde = null, hasta = null, texto = null, limit = 200, offset = 0 } = {}) {
  const tenOpo = filtroTenantC(empresaIds, 'o.empresa_id')
  const con = []
  const params = [...tenOpo.params]
  if (tenOpo.sql) con.push(`1=1${tenOpo.sql}`)
  if (empresaId != null) { con.push('o.empresa_id = ?'); params.push(Number(empresaId)) }
  if (etapa) { con.push('o.etapa = ? COLLATE NOCASE'); params.push(etapa) }
  if (estado === 'abiertas') con.push('et.terminal = 0')
  if (estado === 'ganadas') con.push('et.ganada = 1')
  if (estado === 'perdidas') con.push('et.terminal = 1 AND et.ganada = 0')
  if (responsable) { con.push('o.responsable = ?'); params.push(responsable) }
  if (desde) { con.push('o.fecha_cierre_estimada >= ?'); params.push(desde) }
  if (hasta) { con.push('o.fecha_cierre_estimada <= ?'); params.push(hasta) }
  if (texto) { con.push('(o.nombre LIKE ? OR e.nombre LIKE ?)'); const p = `%${texto}%`; params.push(p, p) }
  const whereSql = con.length ? ` AND ${con.join(' AND ')}` : ''

  const total = db.prepare(`
    SELECT COUNT(*) AS n
    FROM crm_oportunidades o
    JOIN crm_oportunidad_etapas et ON et.nombre = o.etapa COLLATE NOCASE
    WHERE 1=1${whereSql}
  `).get(...params).n
  // NOTA: whereSql ya trae el filtro tenant (INSERTANDO los params a este COUNT
  // y al SELECT principal en ORDEN — la firma tenOpo queda primero).

  const oportunidades = db.prepare(`${SELECT_OPO_BASE}${whereSql}
    ORDER BY o.actualizado_en DESC, o.id DESC
    LIMIT ? OFFSET ?`).all(...params, Math.min(Number(limit) || 200, 1000), Number(offset) || 0)

  // KANBAN y tabla leen los MISMOS datos (§E): agregado por etapa con la
  // misma fórmula ponderada; filtro tenant + empresa SIEMPRE parametrizado.
  // El JOIN-LEFT con insumos del tenant usa correlación directa en el ON:
  // WHERE con o.* NO vale (anularía el LEFT JOIN de las etapas vacías).
  const tenOpoOn = Array.isArray(empresaIds)
    ? (empresaIds.length ? `AND o.empresa_id IN (${empresaIds.map(() => '?').join(',')})` : 'AND o.empresa_id = -1')
    : ''
  const kanbanOn = [
    tenOpoOn,
    ...(empresaId != null ? ['AND o.empresa_id = ?'] : []),
  ]
  const kanbanParams = [
    ...(Array.isArray(empresaIds) ? empresaIds : []),
    ...(empresaId != null ? [Number(empresaId)] : []),
  ]
  const kanban = db.prepare(`
    SELECT et.nombre AS etapa, et.orden, et.terminal, et.ganada,
           COUNT(o.id) AS n, COALESCE(SUM(o.monto),0) AS monto,
           COALESCE(SUM(ROUND(o.monto * o.probabilidad / 100.0)),0) AS monto_ponderado
    FROM crm_oportunidad_etapas et
    LEFT JOIN crm_oportunidades o
           ON o.etapa = et.nombre COLLATE NOCASE ${kanbanOn.join(' ')}
    GROUP BY et.nombre, et.orden, et.terminal, et.ganada
    ORDER BY et.orden
  `).all(...kanbanParams)

  return { total, etapas: etapasDe(db), kanban, oportunidades }
}

function obtenerOportunidad(db, oportunidadId) {
  const fila = db.prepare(`${SELECT_OPO_BASE} AND o.id = ?`).get(oportunidadId)
  if (!fila) throw new Error('Oportunidad no encontrada')
  fila.historial = db.prepare(`
    SELECT h.id, h.desde, h.hasta, h.comentario, h.usuario_id, h.creado_en,
           u.username AS usuario_nombre
    FROM crm_oportunidad_historial h LEFT JOIN users u ON u.id = h.usuario_id
    WHERE h.oportunidad_id = ? ORDER BY h.id DESC LIMIT 100
  `).all(oportunidadId)
  fila.actividades = db.prepare(`
    SELECT id, tipo, titulo, detalle, estado, prioridad, vencimiento, responsable, completada_en, creado_en
    FROM crm_actividades WHERE oportunidad_id = ?
    ORDER BY vencimiento ASC NULLS LAST, id DESC
  `).all(oportunidadId)
  return fila
}

function crearOportunidad(db, { usuarioId, oportunidad, ip = null }) {
  const nombre = String(oportunidad.nombre || '').trim()
  if (!nombre) throw new Error('El nombre de la oportunidad es obligatorio')
  const emp = empresaExiste(db, oportunidad.empresaId)
  if (!emp) throw new Error('Empresa no encontrada')
  const monto = Math.round(Number(oportunidad.monto) || 0)
  if (monto < 0) throw new Error('El monto no puede ser negativo')
  if (oportunidad.moneda && String(oportunidad.moneda).toUpperCase() !== 'CLP') {
    throw new Error(`Moneda no soportada por ahora: ${oportunidad.moneda} (solo 'CLP')`)
  }
  const etapaFila = etapaDe(db, oportunidad.etapa || 'DETALLE')
  if (!etapaFila) {
    throw new Error(`Etapa inexistente en el embudo configurable: ${oportunidad.etapa} (disponibles: ${etapasDe(db).map((e) => e.nombre).join(', ')})`)
  }
  if (etapaFila.terminal) throw new Error(`No se crea una oportunidad en etapa terminal (${etapaFila.nombre})`)
  if (oportunidad.fecha_cierre_estimada && !RE_FECHA.test(String(oportunidad.fecha_cierre_estimada))) {
    throw new Error('fecha_cierre_estimada inválida (YYYY-MM-DD)')
  }
  if (oportunidad.contactoId != null) {
    if (!db.prepare(`SELECT id FROM crm_contactos WHERE id = ? AND empresa_id = ?`).get(Number(oportunidad.contactoId), oportunidad.empresaId)) {
      throw new Error('El contacto no pertenece a la empresa de la oportunidad')
    }
  }
  const probBase = oportunidad.probabilidad != null ? Number(oportunidad.probabilidad) : etapaFila.prob_default
  if (!validarProb(probBase)) throw new Error('probabilidad inválida (entero 0..100)')
  const probabilidad = Math.round(probBase)

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO crm_oportunidades (nombre, empresa_id, contacto_id, monto, moneda, etapa, probabilidad,
        fecha_cierre_estimada, primera_accion, fecha_seguimiento, productos_json, responsable)
      VALUES (?, ?, ?, ?, 'CLP', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nombre.slice(0, 200), oportunidad.empresaId,
      oportunidad.contactoId != null ? Number(oportunidad.contactoId) : null,
      monto, etapaFila.nombre, probabilidad,
      oportunidad.fecha_cierre_estimada || null,
      oportunidad.primera_accion ? String(oportunidad.primera_accion).trim().slice(0, 300) : null,
      oportunidad.fecha_seguimiento && RE_FECHA.test(String(oportunidad.fecha_seguimiento)) ? oportunidad.fecha_seguimiento : null,
      Array.isArray(oportunidad.productos) && oportunidad.productos.length
        ? JSON.stringify(oportunidad.productos.slice(0, 50))
        : null,
      oportunidad.responsable ? String(oportunidad.responsable).trim().slice(0, 120) : null)
    db.prepare(`
      INSERT INTO crm_oportunidad_historial (oportunidad_id, desde, hasta, comentario, usuario_id)
      VALUES (?, NULL, ?, 'creación', ?)
    `).run(info.lastInsertRowid, etapaFila.nombre, usuarioId)
    registrarAccion(db, {
      empresaId: oportunidad.empresaId, usuarioId,
      accion: 'crm.oportunidad_crear', entidad: 'crm_oportunidades', entidadId: String(info.lastInsertRowid),
      despues: { nombre, monto, etapa: etapaFila.nombre, probabilidad }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx() }
}

function editarOportunidad(db, { usuarioId, oportunidadId, oportunidad, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_oportunidades WHERE id = ?`).get(oportunidadId)
  if (!fila) throw new Error('Oportunidad no encontrada')
  const etapaFila = etapaDe(db, fila.etapa)
  if (etapaFila && etapaFila.terminal) {
    throw new Error(`Etapa terminal (${fila.etapa}): los negcios GANADA/PERDIDA son finales — crea una nueva`)
  }
  const ed = {}
  if (oportunidad.nombre !== undefined) {
    const nombre = String(oportunidad.nombre).trim()
    if (!nombre) throw new Error('El nombre es obligatorio')
    ed.nombre = nombre.slice(0, 200)
  }
  if (oportunidad.monto !== undefined) {
    const monto = Math.round(Number(oportunidad.monto) || 0)
    if (monto < 0) throw new Error('El monto no puede ser negativo')
    ed.monto = monto
  }
  if (oportunidad.moneda !== undefined && String(oportunidad.moneda).toUpperCase() !== 'CLP') {
    throw new Error(`Moneda no soportada: ${oportunidad.moneda}`)
  }
  if (oportunidad.fecha_cierre_estimada !== undefined) {
    if (oportunidad.fecha_cierre_estimada && !RE_FECHA.test(String(oportunidad.fecha_cierre_estimada))) {
      throw new Error('fecha_cierre_estimada inválida (YYYY-MM-DD)')
    }
    ed.fecha_cierre_estimada = oportunidad.fecha_cierre_estimada || null
  }
  if (oportunidad.probabilidad !== undefined) {
    if (!validarProb(oportunidad.probabilidad)) throw new Error('probabilidad inválida (entero 0..100)')
    ed.probabilidad = Math.round(Number(oportunidad.probabilidad))
  }
  if (oportunidad.contactoId !== undefined) {
    if (oportunidad.contactoId == null) ed.contacto_id = null
    else {
      if (!db.prepare(`SELECT id FROM crm_contactos WHERE id = ? AND empresa_id = ?`).get(Number(oportunidad.contactoId), fila.empresa_id)) {
        throw new Error('El contacto no pertenece a la empresa de la oportunidad')
      }
      ed.contacto_id = Number(oportunidad.contactoId)
    }
  }
  if (oportunidad.primera_accion !== undefined) ed.primera_accion = oportunidad.primera_accion ? String(oportunidad.primera_accion).trim().slice(0, 300) : null
  if (oportunidad.fecha_seguimiento !== undefined) ed.fecha_seguimiento = oportunidad.fecha_seguimiento && RE_FECHA.test(String(oportunidad.fecha_seguimiento)) ? oportunidad.fecha_seguimiento : null
  if (oportunidad.motivo_perdida !== undefined) {
    if (fila.etapa === 'PERDIDA') throw new Error('El motivo de pérdida se fija en la transición a PERDIDA')
    ed.motivo_perdida = null
  }
  if (oportunidad.productos !== undefined && Array.isArray(oportunidad.productos)) {
    ed.productos_json = oportunidad.productos.length ? JSON.stringify(oportunidad.productos.slice(0, 50)) : null
  }
  if (oportunidad.responsable !== undefined) ed.responsable = oportunidad.responsable ? String(oportunidad.responsable).trim().slice(0, 120) : null

  const campos = Object.keys(ed)
  if (!campos.length) return { ok: true, sin_cambios: true }
  const tx = db.transaction(() => {
    const setSql = campos.map((c) => `${c} = ?`).join(', ')
    db.prepare(`UPDATE crm_oportunidades SET ${setSql}, actualizado_en = datetime('now') WHERE id = ?`)
      .run(...campos.map((c) => ed[c]), oportunidadId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.oportunidad_editar', entidad: 'crm_oportunidades', entidadId: String(oportunidadId),
      antes: Object.fromEntries(campos.map((c) => [c, fila[c]])),
      despues: ed, ip,
    })
  })
  tx()
  return { ok: true, campos: campos }
}

/**
 * CAMBIO DE ETAPA (§E): historial SIEMPRE; terminal fija cierre_real; PERDIDA
 * exige motivo. La probabilidad toma el default de la etapa destino salvo
 * probabilidad explícita. GANADA/PERDIDA son terminales (sin reversión:
 * §Reglas — auditarlas, no re-escribir el embudo).
 */
function cambiarEtapaOportunidad(db, { usuarioId, oportunidadId, etapa, probabilidad = null, motivo = null, comentario = null, ip = null }) {
  const fila = db.prepare(`
    SELECT o.*, et.terminal, et.ganada, e.nombre AS empresa_nombre
    FROM crm_oportunidades o
    JOIN crm_oportunidad_etapas et ON et.nombre = o.etapa COLLATE NOCASE
    JOIN empresas e ON e.id = o.empresa_id
    WHERE o.id = ?
  `).get(oportunidadId)
  if (!fila) throw new Error('Oportunidad no encontrada')
  if (fila.terminal) throw new Error(`Etapa terminal (${fila.etapa}): GANADA/PERDIDA son finales`)
  const destino = etapaDe(db, etapa)
  if (!destino) throw new Error(`Etapa inexistente: ${etapa} (embudo: ${etapasDe(db).map((e) => e.nombre).join(', ')})`)
  if (destino.nombre === 'PERDIDA' && !motivo) throw new Error('PERDIDA exige el motivo de pérdida (§E)')
  if (destino.ganada === 1 && destino.terminal === 1 && motivo) motivo = null // GANADA no lleva motivo de pérdida
  let prob
  if (probabilidad != null) {
    if (!validarProb(probabilidad)) throw new Error('probabilidad inválida (entero 0..100)')
    prob = Math.round(Number(probabilidad))
  } else {
    prob = destino.prob_default
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE crm_oportunidades SET etapa = ?, probabilidad = ?,
        cierre_real = CASE WHEN ? THEN date('now') ELSE cierre_real END,
        motivo_perdida = COALESCE(?, motivo_perdida),
        actualizado_en = datetime('now')
      WHERE id = ?
    `).run(destino.nombre, prob, destino.terminal ? 1 : 0, motivo, oportunidadId)
    db.prepare(`
      INSERT INTO crm_oportunidad_historial (oportunidad_id, desde, hasta, comentario, usuario_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(oportunidadId, fila.etapa, destino.nombre, comentario || (motivo ? `pérdida: ${motivo}` : null), usuarioId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.oportunidad_etapa', entidad: 'crm_oportunidad_historial', entidadId: String(oportunidadId),
      antes: { etapa: fila.etapa, probabilidad: fila.probabilidad },
      despues: { etapa: destino.nombre, probabilidad: prob, motivo }, ip,
    })
  })
  tx()
  return { ok: true, etapa: destino.nombre, probabilidad: prob, terminal: !!destino.terminal }
}

/* ========================== 5. ACTIVIDADES =========================== */

function listarActividades(db, { empresaId = null, empresaIds = null, oportunidadId = null, contactoId = null,
  estado = 'PENDIENTE', vencidasSolo = false, responsable = null, limit = 200, offset = 0 } = {}) {
  // Tenant §5: filtrar por la empresa del ancla (a.empresa_id). Actividades
  // sin ancla no existen (crearActividad exige ancla) aquí el caso NULL es
  // solo defensivo.
  const tenAct = filtroTenantC(empresaIds, 'a.empresa_id')
  const con = []
  const params = [...tenAct.params]
  if (tenAct.sql) con.push(`1=1${tenAct.sql}`)
  if (empresaId != null) { con.push('a.empresa_id = ?'); params.push(Number(empresaId)) }
  if (oportunidadId != null) { con.push('a.oportunidad_id = ?'); params.push(Number(oportunidadId)) }
  if (contactoId != null) { con.push('a.contacto_id = ?'); params.push(Number(contactoId)) }
  if (estado) { con.push('a.estado = ?'); params.push(estado) }
  if (vencidasSolo) con.push(`a.vencimiento IS NOT NULL AND a.vencimiento < date('now')`)
  if (responsable) { con.push('a.responsable = ?'); params.push(responsable) }
  const whereSql = con.length ? `WHERE ${con.map((c) => (c.startsWith('1=1') ? c : c)).join(' AND ')}` : ''
  const filas = db.prepare(`
    SELECT a.id, a.tipo, a.titulo, a.detalle, a.estado, a.prioridad, a.vencimiento,
           a.responsable, a.empresa_id, e.nombre AS empresa_nombre,
           a.contacto_id, c.nombre AS contacto_nombre, a.oportunidad_id,
           o.nombre AS oportunidad_nombre, a.completada_en, a.creado_en,
           CASE WHEN a.vencimiento IS NOT NULL AND a.vencimiento < date('now')
                     AND a.estado = 'PENDIENTE' THEN 1 ELSE 0 END AS vencida
    FROM crm_actividades a
    LEFT JOIN empresas e ON e.id = a.empresa_id
    LEFT JOIN crm_contactos c ON c.id = a.contacto_id
    LEFT JOIN crm_oportunidades o ON o.id = a.oportunidad_id
    ${whereSql}
    ORDER BY COALESCE(a.vencimiento, '9999-12-31') ASC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Math.min(Number(limit) || 200, 500), Number(offset) || 0)
  return filas
}

function crearActividad(db, { usuarioId, actividad, ip = null }) {
  if (!ACTIVIDAD_TIPOS.includes(actividad.tipo)) {
    throw new Error(`Tipo inválido: ${actividad.tipo} (válidos: ${ACTIVIDAD_TIPOS.join(', ')})`)
  }
  const titulo = String(actividad.titulo || '').trim()
  if (!titulo) throw new Error('El título de la actividad es obligatorio')
  if (actividad.prioridad && !PRIORIDADES.includes(actividad.prioridad)) throw new Error('prioridad inválida')
  if (actividad.vencimiento && !RE_FECHA.test(String(actividad.vencimiento))) throw new Error('vencimiento inválido (YYYY-MM-DD)')
  // Ancla obligatoria (§F): sin empresa/contacto/oportunidad la tarea flota.
  const anclada = actividad.empresaId != null || actividad.contactoId != null || actividad.oportunidadId != null
  if (!anclada) throw new Error('La actividad debe asociarse a una empresa, contacto u oportunidad')

  let empresaId = actividad.empresaId != null ? Number(actividad.empresaId) : null
  if (actividad.contactoId != null) {
    const c = db.prepare(`SELECT id, empresa_id FROM crm_contactos WHERE id = ?`).get(Number(actividad.contactoId))
    if (!c) throw new Error('Contacto no encontrado')
    if (empresaId != null && empresaId !== c.empresa_id) throw new Error('El contacto no pertenece a la empresa dada')
    empresaId = empresaId || c.empresa_id
  }
  if (actividad.oportunidadId != null) {
    const o = db.prepare(`SELECT empresa_id FROM crm_oportunidades WHERE id = ?`).get(Number(actividad.oportunidadId))
    if (!o) throw new Error('Oportunidad no encontrada')
    if (empresaId != null && empresaId !== o.empresa_id) throw new Error('La oportunidad no pertenece a la empresa dada')
    empresaId = empresaId || o.empresa_id
  }
  if (!empresaExiste(db, empresaId)) throw new Error('Empresa no encontrada')

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO crm_actividades (tipo, titulo, detalle, prioridad, vencimiento, responsable, empresa_id, contacto_id, oportunidad_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actividad.tipo, titulo.slice(0, 200),
      actividad.detalle ? String(actividad.detalle).trim().slice(0, 1000) : null,
      actividad.prioridad || 'media',
      actividad.vencimiento || null,
      actividad.responsable ? String(actividad.responsable).trim().slice(0, 120) : null,
      empresaId,
      actividad.contactoId != null ? Number(actividad.contactoId) : null,
      actividad.oportunidadId != null ? Number(actividad.oportunidadId) : null)
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'crm.actividad_crear', entidad: 'crm_actividades', entidadId: String(info.lastInsertRowid),
      despues: { tipo: actividad.tipo, titulo, vencimiento: actividad.vencimiento || null }, ip,
    })
    return info.lastInsertRowid
  })
  return { ok: true, id: tx() }
}

function actualizarActividad(db, { usuarioId, actividadId, actividad, ip = null }) {
  const fila = db.prepare(`SELECT * FROM crm_actividades WHERE id = ?`).get(actividadId)
  if (!fila) throw new Error('Actividad no encontrada')
  const cambios = {}
  if (actividad.estado !== undefined) {
    if (!ACTIVIDAD_ESTADOS.includes(actividad.estado)) throw new Error(`Estado inválido: ${actividad.estado}`)
    cambios.estado = actividad.estado
  }
  if (actividad.vencimiento !== undefined) {
    if (actividad.vencimiento && !RE_FECHA.test(String(actividad.vencimiento))) throw new Error('vencimiento inválido')
    cambios.vencimiento = actividad.vencimiento || null
  }
  if (actividad.responsable !== undefined) cambios.responsable = actividad.responsable ? String(actividad.responsable).trim().slice(0, 120) : null
  if (actividad.detalle !== undefined) cambios.detalle = actividad.detalle ? String(actividad.detalle).trim().slice(0, 1000) : null
  if (actividad.prioridad !== undefined) {
    if (!PRIORIDADES.includes(actividad.prioridad)) throw new Error('prioridad inválida')
    cambios.prioridad = actividad.prioridad
  }
  const campos = Object.keys(cambios)
  if (!campos.length) return { ok: true, sin_cambios: true }
  const setSql = campos
    .filter((c) => c !== 'estado' || cambios.estado !== 'CANCELADA')
    .map((c) => (c === 'estado'
      ? `estado = ?, completada_en = ${cambios.estado === 'COMPLETADA' ? "datetime('now')" : 'NULL'}`
      : `${c} = ?`)).join(', ')
  const setSqlCancelado = campos.length && cambios.estado === 'CANCELADA' ? campos.map((c) => (c === 'estado' ? `estado = ?` : `${c} = ?`)).join(', ') : null
  const sqlFinal = setSqlCancelado || setSql
  const valores = campos.map((c) => cambios[c])
  const tx = db.transaction(() => {
    db.prepare(`UPDATE crm_actividades SET ${sqlFinal} WHERE id = ?`).run(...valores, actividadId)
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId,
      accion: 'crm.actividad_editar', entidad: 'crm_actividades', entidadId: String(actividadId),
      antes: Object.fromEntries(campos.map((c) => [c, fila[c]])),
      despues: cambios, ip,
    })
  })
  tx()
  return { ok: true }
}

/* ============================ 6. INFORMES ============================ */

/** WHERE filtrable reutilizable en informes (filtra por tabla `o`). */
function filtroInformes({ desde = null, hasta = null, responsable = null, empresaId = null, empresaIds = null } = {}) {
  const ten = filtroTenantC(empresaIds, 'o.empresa_id')
  const con = ten.sql ? [`1=1${ten.sql}`] : []
  const params = [...ten.params]
  if (empresaId != null) { con.push('o.empresa_id = ?'); params.push(Number(empresaId)) }
  if (responsable) { con.push('o.responsable = ?'); params.push(responsable) }
  if (desde) { con.push(`date(o.creado_en) >= ?`); params.push(desde) }
  if (hasta) { con.push(`date(o.creado_en) <= ?`); params.push(hasta) }
  return { sql: con.length ? con.join(' AND ') : '1=1', params }
}

/**
 * Informes comerciales (§H). TODO sale de la MISMA fórmula ponderada; la
 * conversión usa cierres reales (ganadas/(ganadas+perdidas)); la proyección
 * solo integra oportundades ABIERTAS ponderadas. Filtros combinables:
 * desde/hasta (creado), responsable, empresa.
 */
function informes(db, filtros = {}) {
  const { sql: whereSql, params } = filtroInformes({ ...filtros, empresaIds: filtros.empresaIds })
  // whereSql sin 'AND' inicial: subselects cosen `WHERE ${whereSql}`. El
  // primer elemento ya es 1=1[ AND tenant] cuando hay tenant.

  // Embudo por etapa con las oportunidades YA FILTRADAS (subselect cosido).
  const embudo = db.prepare(`
    SELECT et.nombre AS etapa, et.orden, et.terminal, et.ganada,
           COUNT(sub.id) AS n,
           COALESCE(SUM(sub.monto),0) AS monto,
           COALESCE(SUM(ROUND(sub.monto * sub.probabilidad / 100.0)),0) AS monto_ponderado
    FROM crm_oportunidad_etapas et
    LEFT JOIN (
      SELECT o.id, o.monto, o.probabilidad, o.etapa
      FROM crm_oportunidades o
      WHERE ${whereSql}
    ) sub ON sub.etapa = et.nombre COLLATE NOCASE
    GROUP BY et.nombre, et.orden, et.terminal, et.ganada
    ORDER BY et.orden
  `).all(...params)

  const total = embudo.reduce((s, e) => s + e.n, 0)  // nombre original conservado
  const ganadas = embudo.filter((e) => e.ganada === 1).reduce((s, e) => s + e.n, 0)
  const perdidas = embudo.filter((e) => e.terminal === 1 && e.ganada === 0).reduce((s, e) => s + e.n, 0)
  const abiertas = total - ganadas - perdidas
  const conversion = (ganadas + perdidas) > 0 ? Math.round((ganadas / (ganadas + perdidas)) * 1000) / 10 : null
  const proyeccion = embudo.filter((e) => e.terminal === 0).reduce((s, e) => s + e.monto_ponderado, 0)

  const porResponsable = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(o.responsable), ''), 'sin responsable') AS responsable,
           COUNT(*) AS total,
           SUM(CASE WHEN et.terminal = 0 THEN 1 ELSE 0 END) AS abiertas,
           SUM(CASE WHEN et.terminal = 1 AND et.ganada = 1 THEN 1 ELSE 0 END) AS ganadas,
           SUM(CASE WHEN et.terminal = 1 AND et.ganada = 0 THEN 1 ELSE 0 END) AS perdidas,
           COALESCE(SUM(CASE WHEN et.terminal = 0 THEN ROUND(o.monto * o.probabilidad / 100.0) ELSE 0 END),0) AS proyeccion
    FROM crm_oportunidades o
    JOIN crm_oportunidad_etapas et ON et.nombre = o.etapa COLLATE NOCASE
    WHERE ${whereSql}
    GROUP BY COALESCE(NULLIF(TRIM(o.responsable), ''), 'sin responsable')
    ORDER BY proyeccion DESC
  `).all(...params)

  const perdidasCausa = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(o.motivo_perdida), ''), 'sin motivo informado') AS motivo,
           COUNT(*) AS n, COALESCE(SUM(o.monto), 0) AS monto_perdido
    FROM crm_oportunidades o
    JOIN crm_oportunidad_etapas et ON et.nombre = o.etapa COLLATE NOCASE
    WHERE ${whereSql} AND et.terminal = 1 AND et.ganada = 0
    GROUP BY COALESCE(NULLIF(TRIM(o.motivo_perdida), ''), 'sin motivo informado')
    ORDER BY n DESC
  `).all(...params)

  const actividadesPend = listarActividades(db, { estado: 'PENDIENTE', limit: 200, empresaIds: filtros.empresaIds })
  const seguimiento = actividadesPend.filter((a) => a.vencida || (a.vencimiento != null && a.vencimiento <= fechaCorte()))

  // Clientes nuevos §H: fichas dentro del rango Y empresa del tenant.
  const tenFichas = filtroTenantC(filtros.empresaIds, 'f.empresa_id')
  const conFichas = []
  const paramsFichas = [...tenFichas.params]
  if (tenFichas.sql) conFichas.push(`1=1${tenFichas.sql}`)
  if (filtros.desde) 
  { conFichas.push('date(f.creado_en) >= ?'); paramsFichas.push(filtros.desde) }
  if (filtros.hasta) { conFichas.push('date(f.creado_en) <= ?'); paramsFichas.push(filtros.hasta) }
  const clientesNuevos = db.prepare(`
    SELECT COUNT(*) AS n FROM crm_fichas f
    WHERE ${conFichas.join(' AND ') || '1=1'}
  `).get(...paramsFichas).n

  return {
    ok: true,
    periodo: { desde: filtros.desde || null, hasta: filtros.hasta || null, responsable: filtros.responsable || null, empresa_id: filtros.empresaId ?? null },
    embudo, total, abiertas, ganadas, perdidas,
    conversion_pct: conversion,
    proyeccion_ponderada: proyeccion,
    por_responsable: porResponsable,
    perdidas_causa: perdidasCausa,
    seguimiento_pendiente: { total: seguimiento.length, vencidas: seguimiento.filter((a) => a.vencida).slice(0, 50) },
    clientes_nuevos: clientesNuevos,
  }
}

function fechaCorte() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

/* ======================= 7. BÚSQUEDA GLOBAL CRM ====================== */

function buscar(db, { q = '', limit = 20, empresaIds = null } = {}) {
  const texto = String(q || '').trim()
  if (texto.length < 2) return { ok: true, q: texto, grupos: [] }
  const like = `%${texto}%`
  const grupos = []
  const tenEmp = filtroTenantC(empresaIds, 'e.id')
  const tenProsp = filtroTenantC(empresaIds, 'p.empresa_id')
  const tenCont = filtroTenantC(empresaIds, 'e.id')
  const tenOpo = filtroTenantC(empresaIds, 'o.empresa_id')

  // Empresas: LIKE directo + fallback exacto por RUT normalizado en JS.
  // Tenant §5: solo empresas asignadas al caller.
  let empresas = db.prepare(`
    SELECT e.id, e.rut, e.nombre, f.nombre_comercial, f.fuente, p.etapa
    FROM empresas e
    LEFT JOIN crm_fichas f ON f.empresa_id = e.id
    LEFT JOIN crm_pipeline p ON p.empresa_id = e.id
    WHERE 1=1${tenEmp.sql} AND (e.nombre LIKE ? OR e.rut LIKE ?) LIMIT ?
  `).all(...tenEmp.params, like, like, limit)
  if (empresas.length === 0) {
    const porRut = empresaPorRut(db, texto)
    if (porRut != null && (!Array.isArray(empresaIds) || empresaIds.includes(porRut))) {
      empresas = db.prepare(`
        SELECT e.id, e.rut, e.nombre, f.nombre_comercial, f.fuente, p.etapa
        FROM empresas e
        LEFT JOIN crm_fichas f ON f.empresa_id = e.id
        LEFT JOIN crm_pipeline p ON p.empresa_id = e.id
        WHERE e.id = ?`).all(porRut)
    }
  }
  if (empresas.length) grupos.push({ entidad: 'empresas', filas: empresas })

  const prospectos = db.prepare(`
    SELECT p.id, p.nombre, p.rut, p.correo, p.estado, p.prioridad, p.responsable
    FROM crm_prospectos p
    WHERE (p.empresa_id IS NULL OR 1=1${tenProsp.sql})
      AND (p.nombre LIKE ? OR p.rut LIKE ? OR p.correo LIKE ?)
    ORDER BY CASE p.estado WHEN 'NUEVO' THEN 0 ELSE 1 END LIMIT ?
  `).all(...tenProsp.params, like, like, like, limit)
  if (prospectos.length) grupos.push({ entidad: 'prospectos', filas: prospectos })

  const contactos = db.prepare(`
    SELECT c.id, c.empresa_id, e.nombre AS empresa_nombre, c.nombre, c.cargo, c.correo, c.telefono
    FROM crm_contactos c JOIN empresas e ON e.id = c.empresa_id
    WHERE 1=1${tenCont.sql} AND (c.nombre LIKE ? OR c.correo LIKE ? OR c.telefono LIKE ? OR e.nombre LIKE ?)
    LIMIT ?
  `).all(...tenCont.params, like, like, like, like, limit)
  if (contactos.length) grupos.push({ entidad: 'contactos', filas: contactos })

  const oportunidades = db.prepare(`
    SELECT o.id, o.nombre, o.empresa_id, e.nombre AS empresa_nombre,
           o.etapa, o.monto, ROUND(o.monto * o.probabilidad / 100.0) AS monto_ponderado, o.responsable
    FROM crm_oportunidades o JOIN empresas e ON e.id = o.empresa_id
    WHERE 1=1${tenOpo.sql} AND (o.nombre LIKE ? OR e.nombre LIKE ?)
    LIMIT ?
  `).all(...tenOpo.params, like, like, limit)
  if (oportunidades.length) grupos.push({ entidad: 'oportunidades', filas: oportunidades })

  return { ok: true, q: texto, grupos }
}

/* ========================= 8. DUPLICADOS ============================= */

/** Posibles duplicados §B §C: empresas (maestro), prospectos y contactos. */
function duplicados(db, { q = '', tipo = 'empresas', empresaIds = null } = {}) {
  const texto = String(q || '').trim()
  if (texto.length < 3) return { ok: true, tipo, q: texto, coincidencias: [] }
  const like = `%${texto}%`
  let coincidencias = []
  if (tipo === 'empresas') {
    const tenEmp = filtroTenantC(empresaIds, 'e.id')
    const porRut = empresaPorRut(db, texto)
    const idRutOk = porRut != null && (!Array.isArray(empresaIds) || empresaIds.includes(porRut)) ? Number(porRut) : null
    coincidencias = db.prepare(`
      SELECT e.id, e.rut, e.nombre, f.correo FROM empresas e
      LEFT JOIN crm_fichas f ON f.empresa_id = e.id
      WHERE 1=1${tenEmp.sql} AND (e.nombre LIKE ? OR e.rut LIKE ?${idRutOk != null ? ' OR e.id = ?' : ''})
      LIMIT 20
    `).all(...tenEmp.params, like, like, ...(idRutOk != null ? [idRutOk] : []))
  } else if (tipo === 'prospectos') {
    const tenProsp = filtroTenantC(empresaIds, 'p.empresa_id')
    coincidencias = db.prepare(`
      SELECT p.id, p.nombre, p.rut, p.correo, p.estado FROM crm_prospectos p
      WHERE (p.empresa_id IS NULL OR 1=1${tenProsp.sql}) AND (p.nombre LIKE ? OR p.rut LIKE ? OR p.correo LIKE ?)
      LIMIT 20
    `).all(...tenProsp.params, like, like, like)
  } else if (tipo === 'contactos') {
    const tenCont = filtroTenantC(empresaIds, 'e.id')
    coincidencias = db.prepare(`
      SELECT c.id, c.nombre, c.correo, e.nombre AS empresa_nombre, e.rut
      FROM crm_contactos c JOIN empresas e ON e.id = c.empresa_id
      WHERE 1=1${tenCont.sql} AND (c.nombre LIKE ? OR c.correo LIKE ?)
      LIMIT 20
    `).all(...tenCont.params, like, like)
  } else {
    throw new Error(`tipo de dedupe inválido: ${tipo} (empresas|prospectos|contactos)`)
  }
  return { ok: true, tipo, q: texto, coincidencias }
}

module.exports = {
  MONTO_PESADO, FUENTES, PRIORIDADES, PROSPECTO_ESTADOS, ACTIVIDAD_TIPOS, ACTIVIDAD_ESTADOS, ETAPAS_SEMILLA,
  crearTablasCrmComercial, migracionesCrmComercial,
  listarEtapas, crearEtapa, editarEtapa, eliminarEtapa,
  obtenerFicha, guardarFicha,
  listarContactos, crearContacto, editarContacto, eliminarContacto,
  listarProspectos, crearProspecto, editarProspecto, convertirProspecto, importarProspectos, empresaPorRut,
  listarOportunidades, obtenerOportunidad, crearOportunidad, editarOportunidad, cambiarEtapaOportunidad,
  listarActividades, crearActividad, actualizarActividad,
  informes, buscar, duplicados, etapasDe, etapaDe, normRut,
}
