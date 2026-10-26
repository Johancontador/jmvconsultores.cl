/**
 * Tests T0-A — Planificación Tributaria: esquema de la ficha tributaria.
 * Ejecutar con: node --test test/planificacion-tablas.test.js
 *
 * Cobertura exigida por la entrega T0-A:
 *  1) creación de las tablas en una base temporal aislada,
 *  2) idempotencia de la inicialización (dos corridas),
 *  3) claves foráneas, unicidad y restricciones CHECK,
 *  4) empresa existente SIN ficha hasta incorporación explícita,
 *  5) historial append-only: las operaciones normales no modifican/borran filas previas,
 *  + sin valores fiscales por defecto (centinela PENDIENTE / SIN_CONFIGURAR).
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-plan-t0a-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const migraciones = require('../backend/core/migraciones')
const empresas = require('../backend/core/empresas')
const planTablas = require('../backend/core/planificacion-tablas')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76555555-8', nombre: 'Plan Test SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})

function objetosPlan(dbx, tipo) {
  return dbx.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name LIKE 'plan_%'`).all(tipo)
}
function ficha(empresa_id) {
  return db.prepare(`SELECT * FROM plan_ficha_tributaria WHERE empresa_id = ?`).get(empresa_id)
}

/** Empresa de las pruebas 5–7 (rut fijo): tiene historial ya sembrado arriba. */
function SIN_VALOR_EMP() {
  return db.prepare(`SELECT id FROM empresas WHERE rut = '76666666-3'`).get().id
}

// ---------- 1) Existencia del esquema ----------

test('T0-A: crea plan_ficha_tributaria, plan_ficha_historial y sus índices en BD aislada', () => {
  const tablas = objetosPlan(db, 'table').map((x) => x.name)
  assert.ok(tablas.includes('plan_ficha_tributaria'))
  assert.ok(tablas.includes('plan_ficha_historial'))
  const indices = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_plan_%'`).all().map((x) => x.name)
  assert.ok(indices.includes('idx_plan_ficha_tributaria_rut'))
  assert.ok(indices.includes('idx_plan_ficha_historial_empresa'))
})

// ---------- 2) Idempotencia ----------

test('T0-A: segunda inicialización no duplica objetos ni altera información existente', () => {
  // Dato plantado ANTES de la re-corrida: debe sobrevivir intacta.
  db.prepare(`
    INSERT INTO plan_ficha_tributaria (empresa_id, rut) VALUES (?, 'RUT-EVIL')
  `).run(EMP.id)

  const antesTablas = objetosPlan(db, 'table').map((x) => x.name).sort()
  const antesIndices = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_plan_%' AND name LIKE 'idx_plan_%'`).all().length

  // Re-corrida por ambas rutas: función y delegación en migraciones.js
  planTablas.planificacionTablas(db)
  migraciones.migracionesPlanificacion(db)

  const despuesTablas = objetosPlan(db, 'table').map((x) => x.name).sort()
  assert.deepStrictEqual(despuesTablas, antesTablas)
  const despuesIndices = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_plan_%'`).all().length
  assert.strictEqual(despuesIndices, antesIndices)

  const filas = db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_tributaria`).get().n
  assert.strictEqual(filas, 1, 'no se duplicaron filas')
  assert.strictEqual(ficha(EMP.id) && ficha(EMP.id).rut, 'RUT-EVIL')
})

// ---------- 3) Empresas existentes SIN ficha automática ----------

test('T0-A: empresa existente permanece SIN ficha hasta incorporación explícita', () => {
  const SIN_FICHA = empresas.crear(db, {
    usuarioId: adminId, rut: '76666666-3', nombre: 'Empresa Sin Ficha Ltda',
    claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
  })
  assert.strictEqual(ficha(SIN_FICHA.id), undefined)
  // La migración corre en cada arranque de db.js y jamás pobla fichas:
  migraciones.migracionesPlanificacion(db)
  assert.strictEqual(ficha(SIN_FICHA.id), undefined)
})

// ---------- 4) Centinela sin valores fiscales por defecto ----------

test('T0-A: incorporación explícita con solo empresa+rut nace PENDIENTE/SIN_CONFIGURAR (sin valores fiscales)', () => {
  const SIN_FICHA = db.prepare(`SELECT id, rut FROM empresas WHERE rut = '76666666-3'`).get()
  db.prepare(`INSERT INTO plan_ficha_tributaria (empresa_id, rut) VALUES (?, ?)`).run(SIN_FICHA.id, SIN_FICHA.rut)
  const f = ficha(SIN_FICHA.id)
  assert.strictEqual(f.regimen, 'PENDIENTE')            // centinela, no valor fiscal
  assert.strictEqual(f.tipo_contribuyente, 'PENDIENTE') // centinela, no valor fiscal
  assert.strictEqual(f.estado_ficha, 'SIN_CONFIGURAR')
  assert.strictEqual(f.regimen_desde_ac, null)          // sin vigencia inventada
  assert.strictEqual(f.fecha_inicio_actividades, null)
  assert.strictEqual(f.actividades_economicas, '[]')    // sin actividad asignada
  assert.strictEqual(f.propietarios_json, '[]')
  assert.strictEqual(f.sujeto_boletas_honorarios, 0)    // opt-in explícito
})

// ---------- 5) Restricciones CHECK, unicidad y consistencia ----------

test('T0-A: CHECK bloquean régimen inventado, vigencia sin régimen y opt-in fuera de dominio', () => {
  const f = ficha(EMP.id)  // plantada en la prueba de idempotencia
  const RE = /CHECK constraint failed/

  // Régimen fuera del catálogo oficial → imposible
  assert.throws(() => db.prepare(`
    UPDATE plan_ficha_tributaria SET regimen = 'REGIMEN_INVENTADO' WHERE id = ?`).run(f.id), RE)
  // Vigencia sobre ficha PENDIENTE → conflicto de consistencia de fila
  assert.throws(() => db.prepare(`
    UPDATE plan_ficha_tributaria SET regimen_desde_ac = '2026' WHERE id = ?`).run(f.id), RE)
  // Opt-in fuera de dominio
  assert.throws(() => db.prepare(`
    UPDATE plan_ficha_tributaria SET sujeto_boletas_honorarios = 2 WHERE id = ?`).run(f.id), RE)

  // Incorporación REAL sí pasa el CHECK completo.
  const fichaje = db.prepare(`
    UPDATE plan_ficha_tributaria
    SET regimen = 'PRO_PMYE_GENERAL', regimen_desde_ac = '2025',
        tipo_contribuyente = 'PERSONA_JURIDICA', estado_ficha = 'CONFIGURADA'
    WHERE id = ? RETURNING empresa_id`).get(f.id)
  assert.ok(fichaje)
})

test('T0-A: FK activas (empresas, users) y unicidad de fila vigente por empresa', () => {
  const usuarioFantasma = 999999
  const SIN_FICHA = db.prepare(`SELECT id, rut FROM empresas WHERE rut = '76666666-3'`).get()

  // FK ficha → empresas
  assert.throws(() => db.prepare(`
    INSERT INTO plan_ficha_tributaria (empresa_id, rut) VALUES (?, 'x')`).run(usuarioFantasma),
    /FOREIGN KEY constraint failed/)

  // FK historial → empresas y → users
  assert.throws(() => db.prepare(`
    INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion)
    VALUES (?, ?, 'ficha.crear')`).run(usuarioFantasma, adminId),
    /FOREIGN KEY constraint failed/)
  assert.throws(() => db.prepare(`
    INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion)
    VALUES (?, ?, 'ficha.crear')`).run(SIN_FICHA.id, usuarioFantasma),
    /FOREIGN KEY constraint failed/)

  // Unicidad: segunda fila vigente para la misma empresa → rechazo por UNIQUE.
  assert.throws(() => db.prepare(`
    INSERT INTO plan_ficha_tributaria (empresa_id, rut) VALUES (?, 'dup')`).run(EMP.id),
    /UNIQUE constraint failed/)
})

// ---------- 6) Historial append-only ----------

test('T0-A: el historial conserva filas previas: UPDATE/DELETE de la ficha/otras filas no las toca', () => {
  const SIN_FICHA = db.prepare(`SELECT id, rut FROM empresas WHERE rut = '76666666-3'`).get()

  // Fila inicial del historial (así la dejaría la operación "ficha.crear").
  db.prepare(`
    INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion, antes_json, despues_json)
    VALUES (?, ?, 'ficha.crear', '{}', '{"regimen":"PENDIENTE"}')
  `).run(SIN_FICHA.id, adminId)

  const primera = db.prepare(`SELECT * FROM plan_ficha_historial WHERE empresa_id = ? ORDER BY id ASC LIMIT 1`).get(SIN_FICHA.id)

  // Operación normal de aplicación: actualizar la ficha vigente + registrar.
  db.prepare(`
    UPDATE plan_ficha_tributaria SET regimen = 'GENERAL_14A', regimen_desde_ac = '2026', estado_ficha = 'CONFIGURADA'
    WHERE empresa_id = ?
  `).run(SIN_FICHA.id)
  db.prepare(`
    INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion, antes_json, despues_json)
    VALUES (?, ?, 'ficha.actualizar', '{"regimen":"PENDIENTE"}', '{"regimen":"GENERAL_14A","regimen_desde_ac":"2026"}')
  `).run(SIN_FICHA.id, adminId)

  const total = db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_historial WHERE empresa_id = ?`).get(SIN_FICHA.id).n
  assert.strictEqual(total, 2)
  const despues = db.prepare(`SELECT * FROM plan_ficha_historial WHERE id = ?`).get(primera.id)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(despues)), JSON.parse(JSON.stringify(primera)),
    'la primera fila del historial quedó byte a byte igual: el UPDATE de la ficha no la alteró')
})

// ---------- 7) Triggers append-only de BD (RAISE ABORT) ----------

test('T0-A: triggers no_update/no_delete existen y son idempotentes', () => {
  const trig = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_plan_%' ORDER BY name`).all().map((x) => x.name)
  assert.deepStrictEqual(trig, [
    'trg_plan_ficha_historial_no_delete',
    'trg_plan_ficha_historial_no_update',
  ])
  // Re-corrida de la migración: no duplica triggers (IF NOT EXISTS).
  planTablas.planificacionTablas(db)
  const trigDeNuevo = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_plan_%'`).all().length
  assert.strictEqual(trigDeNuevo, 2)
})

test('T0-A: UPDATE directo sobre plan_ficha_historial → ABORT del trigger; filas intactas', () => {
  const fila = db.prepare(`SELECT id FROM plan_ficha_historial WHERE empresa_id = ? ORDER BY id DESC LIMIT 1`).get(SIN_VALOR_EMP())
  assert.ok(fila, 'hay una fila de historial para atacar')
  assert.throws(() =>
    db.prepare(`UPDATE plan_ficha_historial SET accion = 'ficha.FALSIFICADA' WHERE id = ?`).run(fila.id),
    /plan_ficha_historial es append-only: escritura prohibida/)
  const despues = db.prepare(`SELECT accion FROM plan_ficha_historial WHERE id = ?`).get(fila.id)
  assert.notStrictEqual(despues.accion, 'ficha.FALSIFICADA', 'la fila no fue tocada')
})

test('T0-A: DELETE directo sobre plan_ficha_historial → ABORT del trigger', () => {
  const fila = db.prepare(`SELECT id FROM plan_ficha_historial WHERE empresa_id = ? ORDER BY id DESC LIMIT 1`).get(SIN_VALOR_EMP())
  assert.throws(() =>
    db.prepare(`DELETE FROM plan_ficha_historial WHERE id = ?`).run(fila.id),
    /plan_ficha_historial es append-only: borrado prohibido/)
  assert.ok(db.prepare(`SELECT id FROM plan_ficha_historial WHERE id = ?`).get(fila.id), 'la fila sigue viva')
})

test('T0-A: el INSERT en el historial sigue habilitado pese a los triggers (append-only real)', () => {
  const EMP = SIN_VALOR_EMP()
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_historial WHERE empresa_id = ?`).get(EMP).n
  db.prepare(`INSERT INTO plan_ficha_historial (empresa_id, usuario_id, accion, antes_json, despues_json)
    VALUES (?, ?, 'ficha.actualizar', '{}', '{}')`).run(EMP, adminId)
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM plan_ficha_historial WHERE empresa_id = ?`).get(EMP).n
  assert.strictEqual(despues, antes + 1, 'el INSERT no está bloqueado por los triggers')
})

test('T0-A: el módulo no expone operaciones de rewrite/borrado (append-only por interfaz y por BD)', () => {
  // La superficie pública del módulo no trae funciones que alteren datos.
  const claves = Object.keys(planTablas)
  assert.deepStrictEqual(claves, ['planificacionTablas', 'CAMPOS_TRIBUTARIOS'])
  // Y el catálogo de dominios respeta el diseño acordado.
  assert.deepStrictEqual(planTablas.CAMPOS_TRIBUTARIOS.REGIMEN,
    ['PENDIENTE', 'PRO_PMYE_GENERAL', 'PRO_PMYE_TRANSPARENTE', 'GENERAL_14A', 'PRESUNTO', 'NO_SUJETO_14'])
})
