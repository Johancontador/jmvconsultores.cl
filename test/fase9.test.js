/**
 * Tests FASE 9.1 — RECEPTOR DE ASIENTOS EXTERNOS (Geo Daniela, INTEGRATIONS §4):
 * centralización ya cuadrada → asiento tipo 'externo' del núcleo con
 * idempotencia (re-envío no duplica), rechazo COMPLETO si Σd≠Σh, período
 * cerrado y códigos inexistentes con lista exacta, aislamiento por usuario.
 * Ejecutar con: node --test test/fase9.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase9-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const periodos = require('../backend/core/periodos')
const externos = require('../backend/core/asientos-externos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77581234-6', nombre: 'Externo Test SpA',
  claveSii: 'clave-ext', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77582345-3', nombre: 'Otra Externo Ltda',
  claveSii: 'clave-ext2', tasaPpm: 0.015, telefono: '912345678',
})

// Usuario operador SIN acceso a EMP2 (para el aislamiento)
const hash = require('../backend/services/password').hashPassword('operador12345')
const operadorId = db.prepare(`INSERT INTO users (username, password_hash, is_admin) VALUES ('operador_ext', ?, 0)`).run(hash).lastInsertRowid
empresas.asignarRol(db, { empresaId: EMP.id, usuarioIdObjetivo: operadorId, rol: 'contador', usuarioIdEjecutor: adminId })

// Centralización de ejemplo (contrato §4): sueldos + pasivos
const CENTRALIZACION = {
  fecha: '2026-10-31',
  glosa: 'Centralización remuneraciones octubre 2026',
  lineas: [
    { cuenta_codigo: '6.1.1.01', debe: 5000000, haber: 0, glosa: 'Sueldos' },
    { cuenta_codigo: '2.1.3.01', debe: 0, haber: 3550000, glosa: 'Remuneraciones por pagar' },
    { cuenta_codigo: '2.1.3.02', debe: 0, haber: 1450000, glosa: 'Cotizaciones por pagar' },
  ],
}

function recibir(overrides = {}, creds = {}) {
  return externos.recibir(db, {
    empresaId: EMP.id, usuarioId: adminId, ...CENTRALIZACION, ...creds,
    ...(overrides.lineas ? { lineas: overrides.lineas } : {}),
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'lineas')),
  })
}

// ---------- Camino feliz + idempotencia ----------

test('centralización cuadrada → asiento tipo externo con folio correlativo y registro', () => {
  const r = recibir()
  assert.strictEqual(r.deduplicado, false)
  assert.ok(r.asiento_id > 0 && r.folio > 0)
  assert.strictEqual(r.total, 5000000)
  const a = db.prepare(`SELECT * FROM asientos WHERE id = ?`).get(r.asiento_id)
  assert.strictEqual(a.tipo, 'externo')
  assert.strictEqual(a.origen, 'geodaniela:202610')
  assert.strictEqual(a.periodo, '202610')
  assert.ok(a.idempotencia && a.idempotencia.startsWith('geodaniela:'))
  const reg = db.prepare(`SELECT * FROM asientos_externos WHERE empresa_id = ? AND asiento_id = ?`).get(EMP.id, r.asiento_id)
  assert.ok(reg && reg.remitente === 'geodaniela' && reg.periodo === '202610')
  const audit = db.prepare(`SELECT accion FROM auditoria WHERE empresa_id = ? AND accion = 'asiento_externo.recibir'`).get(EMP.id)
  assert.ok(audit, 'auditado')
})

test('re-envío del mismo payload → 200 deduplicado sin segundo asiento', () => {
  // el payload ya fue recibido en el test anterior: re-envío deduplica por hash
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n
  const r = recibir()
  assert.strictEqual(r.deduplicado, true, 'mismo payload sin clave → dedupe por hash')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n, antes)
  // la clave explícita vive en su propio espacio: el primer envío con clave nueva
  // crea y el re-envío con la MISMA clave deduplica (el remitente no debe mezclar modos)
  const r3 = recibir({ idempotencia: 'geo-202610-v1' })
  assert.strictEqual(r3.deduplicado, false)
  const r4 = recibir({ idempotencia: 'geo-202610-v1' })
  assert.strictEqual(r4.deduplicado, true)
})

test('misma clave explícita con payload distinto devuelve la PRIMERA centralización', () => {
  const primera = recibir({ glosa: 'Centralización noviembre (key fija)', fecha: '2026-11-30', idempotencia: 'geo-noviembre' })
  assert.strictEqual(primera.deduplicado, false)
  const segunda = recibir({ glosa: 'Centralización noviembre CORREGIDA', fecha: '2026-11-30', idempotencia: 'geo-noviembre' })
  assert.strictEqual(segunda.deduplicado, true)
  assert.strictEqual(segunda.asiento_id, primera.asiento_id)
  assert.strictEqual(segunda.periodo, '202611')
})

// ---------- Rechazos del contrato (422) ----------

test('Σdebe ≠ Σhaber → rechazo COMPLETO 422 sin crear nada', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n
  const lineas = [
    { cuenta_codigo: '6.1.1.01', debe: 5000000, haber: 0 },
    { cuenta_codigo: '2.1.3.01', debe: 0, haber: 3000000 },
  ]
  assert.throws(() => recibir({ lineas, idempotencia: 'mal-cuadre' }), (e) => e.status === 422 && /DESCUADRADO/.test(e.message))
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n, antes)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asientos_externos WHERE empresa_id = ? AND idempotencia LIKE '%mal-cuadre'`).get(EMP.id).n, 0)
})

test('período cerrado → 422 con el período en el mensaje', () => {
  periodos.obtenerOCrear(db, EMP.id, '202609')
  periodos.cerrar(db, EMP.id, '202609', adminId)
  assert.throws(() => recibir({ fecha: '2026-09-30', idempotencia: 'geo-septiembre' }), (e) => e.status === 422 && /202609/.test(e.message) && /CERRADO/.test(e.message))
})

test('código inexistente → 422 con la lista EXACTA de códigos rechazados, sin asiento parcial', () => {
  const lineas = [
    { cuenta_codigo: '6.1.1.01', debe: 1000000, haber: 0 },
    { cuenta_codigo: '9.9.9.99', debe: 0, haber: 600000 },
    { cuenta_codigo: '8.8.8', debe: 0, haber: 400000 },
  ]
  assert.throws(() => recibir({ lineas, idempotencia: 'geo-codigos-malos' }), (e) => e.status === 422 && e.codigo === 'CUENTA_INEXISTENTE' && /9\.9\.9\.99.*8\.8\.8|8\.8\.8.*9\.9\.9\.99/.test(e.message))
})

test('cuenta RESUMEN por código y payload malformado → 422', () => {
  assert.throws(() => recibir({ lineas: [
    { cuenta_codigo: '6.1.1', debe: 1000, haber: 0 },
    { cuenta_codigo: '2.1.3.01', debe: 0, haber: 1000 },
  ], idempotencia: 'geo-resumen' }), (e) => e.status === 422 && e.codigo === 'CUENTA_INEXISTENTE')
  assert.throws(() => recibir({ lineas: [{ cuenta_codigo: '6.1.1.01', debe: 1, haber: 1 }, { cuenta_codigo: '2.1.3.01', debe: 0, haber: 0 }], idempotencia: 'geo-doble-pata' }), (e) => e.status === 422)
  assert.throws(() => recibir({ fecha: '31-10-2026', idempotencia: 'geo-fecha-mala' }), (e) => e.status === 422)
  assert.throws(() => recibir({ periodo: '202611', idempotencia: 'geo-periodo-mismatch' }), (e) => e.status === 422 && /no corresponde/.test(e.message))
})

// ---------- Aislamiento ----------

test('aislamiento: operador sin acceso a la empresa no puede escribir en ella', () => {
  assert.throws(() => externos.recibir(db, {
    empresaId: EMP2.id, usuarioId: operadorId, ...CENTRALIZACION, idempotencia: 'geo-intruso',
  }), (e) => e.status === 403 && e.codigo === 'SIN_ACCESO')
  // el mismo operador SÍ puede escribir en la suya
  const r = externos.recibir(db, { empresaId: EMP.id, usuarioId: operadorId, ...CENTRALIZACION, glosa: 'Centralización del operador', idempotencia: 'geo-operador-ok' })
  assert.strictEqual(r.deduplicado, false)
})

// ---------- Auxiliares ----------

test('validarCodigos: no crea cuentas y reporta existencia/imputabilidad', () => {
  const r = externos.validarCodigos(db, EMP.id, '6.1.1.01,9.9.9.99,1.2.1, 2.1.3.01 ')
  assert.deepStrictEqual(r.map((x) => x.codigo), ['6.1.1.01', '9.9.9.99', '1.2.1', '2.1.3.01'])
  assert.strictEqual(r[0].existe && r[0].imputable, true)
  assert.strictEqual(r[1].existe, false)
  assert.strictEqual(r[2].existe && r[2].imputable, false, 'resumen existe pero no es imputable')
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM cuentas WHERE empresa_id = ? AND codigo = '9.9.9.99'`).get(EMP.id).n, 0)
})

test('listar: histórico de centralizaciones recibidas con folio', () => {
  const l = externos.listar(db, EMP.id)
  assert.ok(l.length >= 4)
  for (const item of l) assert.ok(item.folio > 0 && item.remitente === 'geodaniela')
  assert.strictEqual(externos.listar(db, EMP2.id).length, 0)
})
