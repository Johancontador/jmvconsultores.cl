/**
 * Tests de expansión Planificación T0-B — `fecha_vigencia` (comportamiento).
 *
 * Semántica decidida (2026-10-26): `fecha_vigencia` = INICIO de vigencia del
 * régimen declarado, con día exacto. Puede ser HISTÓRICA (no se compara con
 * "hoy") y debe pertenecer al ejercicio `regimen_desde_ac`.
 *
 * Cobertura:
 *  A1-A6  metadata (catálogos, RBAC, exports y firmas de las rutas).
 *  B1-B5  escritura real sobre esquema nuevo: NULL por defecto, fecha
 *         histórica aceptada, formato/calendario inválido rechazado, año
 *         incoherente rechazado y PENDIENTE sin fecha.
 *  B6     migración de una BD PREEXISTENTE sin la columna (CREATE TABLE IF
 *         NOT EXISTS no la agrega): el ALTER idempotente la incorpora,
 *         conserva las filas y puede correrse dos veces.
 *
 * BD en memoria: ninguna prueba toca `data/iva_mensual.db`.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const Database = require('better-sqlite3')

const ptab = require('../backend/core/planificacion-tablas.js')

// ---------- helpers ----------

/** BD mínima con las FK que la ficha referencia (empresas, users). */
function dbNueva() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE empresas (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    INSERT INTO empresas (id) VALUES (1);
  `)
  ptab.planificacionTablas(db)
  return db
}

/** Ficha mínima + fecha: devuelve un resultado en vez de lanzar. */
function escribir(db, fecha, ac = '2025') {
  db.prepare(`INSERT OR IGNORE INTO empresas (id) VALUES (2)`).run()
  try {
    db.prepare(`INSERT INTO plan_ficha_tributaria (empresa_id, rut, regimen, regimen_desde_ac, fecha_vigencia)
      VALUES (2, '11111111-1', 'GENERAL_14A', ?, ?)`).run(ac, fecha)
    db.prepare(`DELETE FROM plan_ficha_tributaria WHERE empresa_id = 2`).run()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// ---------- A) metadata ----------

test('A1: PRO_PMYE_TRANSPARENTE y NO_SUJETO_14 están en CAMPOS_TRIBUTARIOS.REGIMEN', () => {
  const regimes = ptab.CAMPOS_TRIBUTARIOS.REGIMEN
  assert.ok(regimes.includes('PRO_PMYE_TRANSPARENTE'))
  assert.ok(regimes.includes('NO_SUJETO_14'))
})

test('A2: un régimen inventado no está en el catálogo', () => {
  assert.ok(!ptab.CAMPOS_TRIBUTARIOS.REGIMEN.includes('REGIMEN_INVENTADO'))
})

test('A3: plan-ficha exporta la superficie esperada', () => {
  const pf = require('../backend/core/plan-ficha.js')
  for (const k of ['obtener', 'incorporar', 'listarHistorial', 'actualizar', 'CAMPOS_TRIBUTARIOS']) {
    assert.ok(Object.keys(pf).includes(k), `${k} debe exportarse`)
  }
})

test('A4: las capacidades de planificación están en el catálogo RBAC', () => {
  const p = require('../backend/core/permisos.js')
  assert.ok(p.CATALOGO_CAPACIDADES['planificacion:ver'])
  assert.ok(p.CATALOGO_CAPACIDADES['planificacion:gestionar'])
})

test('A5: RBAC — gestionar solo contador/super_admin; auditor solo lectura', () => {
  const { PERMISOS_POR_ROL } = require('../backend/core/permisos.js')
  assert.ok(PERMISOS_POR_ROL['contador'].includes('planificacion:gestionar'))
  assert.ok(PERMISOS_POR_ROL['auditor'].includes('planificacion:ver'))
  assert.ok(!PERMISOS_POR_ROL['auditor'].includes('planificacion:gestionar'))
  assert.ok(PERMISOS_POR_ROL['super_admin'].includes('planificacion:ver'))
  assert.ok(PERMISOS_POR_ROL['super_admin'].includes('planificacion:gestionar'))
})

test('A6: el router declara los 4 handlers con los permisos correctos', () => {
  const contenido = fs.readFileSync(path.resolve(__dirname, '..', 'backend', 'routes', 'planificacion.js'), 'utf-8')
  for (const firma of [
    "router.get('/empresas/:empresaId/planificacion/ficha'",
    "router.get('/empresas/:empresaId/planificacion/ficha/historial'",
    "router.post('/empresas/:empresaId/planificacion/ficha'",
    "router.put('/empresas/:empresaId/planificacion/ficha'",
  ]) {
    assert.ok(contenido.includes(firma), `${firma} debe existir`)
  }
  assert.ok(contenido.includes("requirePermiso('planificacion:ver'"))
  assert.ok(contenido.includes("requirePermiso('planificacion:gestionar'"))
})

// ---------- B) comportamiento de fecha_vigencia ----------

test('B1: en esquema nuevo la columna existe, nace NULL y acepta una fecha HISTÓRICA coherente', () => {
  const db = dbNueva()
  const cols = db.prepare(`PRAGMA table_info(plan_ficha_tributaria)`).all().map((c) => c.name)
  assert.ok(cols.includes('fecha_vigencia'), 'la columna debe existir en el esquema nuevo')

  db.prepare(`INSERT INTO plan_ficha_tributaria (empresa_id, rut) VALUES (1, '11111111-1')`).run()
  assert.strictEqual(db.prepare(`SELECT fecha_vigencia FROM plan_ficha_tributaria WHERE empresa_id = 1`).get().fecha_vigencia, null)

  const r = escribir(db, '2025-03-01', '2025')
  assert.ok(r.ok, `una fecha pasada debe aceptarse (${r.error || ''})`)
  db.close()
})

test('B2: rechaza formatos que no son YYYY-MM-DD', () => {
  const db = dbNueva()
  for (const mala of ['2025/03/01', '2025-3-1', '25-03-01', '2025-03-01T00:00:00']) {
    const r = escribir(db, mala, '2025')
    assert.ok(!r.ok, `${mala} debe rechazarse`)
  }
  db.close()
})

test('B3: rechaza fechas de calendario imposibles (mes/día fuera de rango)', () => {
  const db = dbNueva()
  for (const mala of ['2025-13-01', '2025-00-10', '2025-01-32', '2025-01-00']) {
    const r = escribir(db, mala, '2025')
    assert.ok(!r.ok, `${mala} debe rechazarse`)
  }
  db.close()
})

test('B4: rechaza una fecha cuyo año no coincide con regimen_desde_ac', () => {
  const db = dbNueva()
  const r = escribir(db, '2024-12-31', '2025')
  assert.ok(!r.ok, 'el año de fecha_vigencia debe ser el ejercicio declarado')
  assert.match(r.error, /CHECK constraint failed/)
  db.close()
})

test('B5: PENDIENTE (sin regimen_desde_ac) no admite fecha_vigencia', () => {
  const db = dbNueva()
  const r = escribir(db, '2025-03-01', null)
  assert.ok(!r.ok, 'sin ejercicio declarado no puede haber inicio de vigencia')
  db.close()
})

test('B6: una BD preexistente sin la columna se migra (ALTER idempotente) y conserva sus filas', () => {
  // Simula una BD creada por la entrega T0-A: la tabla existe SIN fecha_vigencia.
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE empresas (id INTEGER PRIMARY KEY);
    INSERT INTO empresas (id) VALUES (1);
    CREATE TABLE plan_ficha_tributaria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id),
      rut TEXT NOT NULL,
      regimen TEXT NOT NULL DEFAULT 'PENDIENTE',
      regimen_desde_ac TEXT,
      UNIQUE(empresa_id)
    );
    INSERT INTO plan_ficha_tributaria (empresa_id, rut, regimen, regimen_desde_ac)
      VALUES (1, '11111111-1', 'GENERAL_14A', '2025');
  `)
  assert.ok(!db.prepare(`PRAGMA table_info(plan_ficha_tributaria)`).all().some((c) => c.name === 'fecha_vigencia'))

  ptab.planificacionTablas(db) // migra
  const cols = db.prepare(`PRAGMA table_info(plan_ficha_tributaria)`).all().map((c) => c.name)
  assert.ok(cols.includes('fecha_vigencia'), 'la migración debe agregar la columna')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_tributaria`).get().n, 1, 'conserva las filas')

  // La nueva columna queda protegida por las mismas reglas.
  assert.ok(!escribir(db, '2024-01-01', '2025').ok, 'el CHECK migrado debe rechazar año incoherente')
  assert.ok(escribir(db, '2025-01-01', '2025').ok, 'el CHECK migrado debe aceptar fecha histórica coherente')

  // Idempotencia: correrla de nuevo no duplica ni falla.
  ptab.planificacionTablas(db)
  assert.strictEqual(db.prepare(`PRAGMA table_info(plan_ficha_tributaria)`).all().filter((c) => c.name === 'fecha_vigencia').length, 1)
  db.close()
})
