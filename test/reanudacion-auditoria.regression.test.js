'use strict'
/**
 * Regresión — la auditoría de la REANUDACIÓN de ingestas históricas
 * (`jobs.reanudados_arranque`, BLOQUE 2 de onboarding) debe firmar con el
 * USUARIO DEL SISTEMA (`licencias.usuarioSistema`, mismo criterio que
 * sync-diaria): el arranque del backend no tiene autor humano y
 * `registrarAccion` exige usuario — con `usuarioId:null` lanzaba AL FINAL
 * (después de relanzar los jobs), así que la reanudación quedaba sin
 * registro en la bitácora y el `.catch` del arranque la etiquetaba como
 * fallida aunque hubiera reanudado.
 *
 * Ejecutar con: node --test test/reanudacion-auditoria.regression.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-onbrean-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile
process.env.SECRETOS_MASTER_KEY = 'a'.repeat(64) // clave de test para v1:

const db = require('../backend/db')
const jobsP = require('../backend/core/jobs-persistentes')
const boveda = require('../backend/core/boveda')
const onboarding = require('../backend/core/onboarding')
const licencias = require('../backend/core/licencias')
const { registrarAccion } = require('../backend/core/auditoria')

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

// La reanudación NO debe tocar red: consulta e ingesta simuladas.
const rcv = require('../backend/services/rcv')
const documentosCore = require('../backend/core/documentos')
const originalRCV = rcv.consultarRCV
const originalBatch = documentosCore.ingestarBatch

test.after(() => {
  rcv.consultarRCV = originalRCV
  documentosCore.ingestarBatch = originalBatch
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

test('la reanudación del arranque firma jobs.reanudados_arranque con el usuario del sistema', async () => {
  // Empresa activa con clave SII descifrable (el run necesita descifrarla).
  const empresaId = Number(db.prepare(
    `INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('76000053-0', 'Reanudación Test', ?, 1)`
  ).run(boveda.cifrar('clave-sii-reanud')).lastInsertRowid)

  // Job histórico que quedó a mitad tras un reinicio: pendiente, sin checkpoints.
  const j = jobsP.crear(db, {
    tipo: 'historico_rcv',
    claveUnicidad: `${empresaId}:202601-202601`,
    empresaId,
    usuarioId: adminId,
    periodoDesde: '202601',
    periodoHasta: '202601',
  })
  assert.ok(j && j.id, 'job persistente creado')

  rcv.consultarRCV = async () => []
  documentosCore.ingestarBatch = async () => ({ insertados: 0, duplicados: 0, errores: [] })

  // ANTES del arreglo: los jobs se relanzaban y luego el registro de la
  // bitácora con usuarioId:null LANZABA — reanudarHistoricosPendientes()
  // quedaba rechazada (el .catch del arranque la reportaba «no fatal»).
  const r = await onboarding.reanudarHistoricosPendientes()
  assert.strictEqual(r.reanudados, 1, 'la reanudación relanza el job pendiente')
  assert.ok(true, 'la reanudación COMPLETA sin lanzar al auditar')

  // La corrida reanudada corre en background: esperarla y confirmar que
  // termina bien con los mocks (y deja el checkpoint persistente).
  const t = onboarding.trabajos.get(`onb_re_${j.id}`)
  if (t && t.promise) await t.promise
  const jb = jobsP.obtener(db, j.id)
  assert.strictEqual(jb.estado, 'completado', 'el job reanudado se completó')
  assert.ok(
    (jb.progreso?.periodos_completados || []).includes('202601'),
    'checkpoint del período reanudado'
  )

  // El evento del ARRANQUE queda en la bitácora firmado por el usuario del
  // sistema (no null): antes esta fila NO EXISTÍA porque registrarAccion
  // lanzaba antes de insertar.
  const fila = db.prepare(
    `SELECT usuario_id, empresa_id, accion FROM auditoria WHERE accion = 'jobs.reanudados_arranque' ORDER BY id DESC LIMIT 1`
  ).get()
  assert.ok(fila, 'la auditoría del arranque existe')
  assert.strictEqual(Number(fila.usuario_id), Number(adminId), 'firma con el admin semilla (usuario del sistema)')

  // Y el run reanudado mantiene la atribución del usuario que lo inició.
  const filaRun = db.prepare(
    `SELECT usuario_id FROM auditoria WHERE accion = 'onboarding.historico_completado' ORDER BY id DESC LIMIT 1`
  ).get()
  assert.ok(filaRun, 'la auditoría del run reanudado existe')
  assert.strictEqual(Number(filaRun.usuario_id), Number(adminId), 'el run conserva el usuario del job')
})

test('control: registrarAccion SIN usuario sigue rechazando (la auditoría no se relajó)', () => {
  assert.throws(
    () => registrarAccion(db, { empresaId: null, usuarioId: null, accion: 'control.noactor', entidad: 'control' }),
    /usuarioId es obligatorio/
  )
})
