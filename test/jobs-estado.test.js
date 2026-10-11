'use strict'
/**
 * BLOQUE 4 (unificación UX) — GET /api/contable/empresas/:id/jobs/estado
 * Lectura pura: jamás dispara trabajos. Devuelve resumen + trabajos con
 * estados explícitos. RBAC: documentos:ver (igual que el resto de la bandeja).
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-jobs-estado-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const jobsP = require('../backend/core/jobs-persistentes')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const empresaId = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77JE0001-K', 'Jobs Estado SpA', '', 1)`).run().lastInsertRowid

test('GET jobs/estado: resumen + trabajos, sin exponer secretos, RBAC por permiso', async () => {
  // sembrar 2 jobs de la empresa: 1 completado sync_diaria, 1 fallido historico
  const s = jobsP.crear(db, { tipo: 'sync_diaria', claveUnicidad: `${empresaId}:202610`, empresaId, usuarioId: adminId, periodoDesde: '202610', periodoHasta: '202610' })
  jobsP.tomar(db, s.id)
  jobsP.checkpointPeriodo(db, s.id, '202610')
  jobsP.finalizar(db, s.id, 'completado')
  const h = jobsP.crear(db, { tipo: 'historico_rcv', claveUnicidad: `${empresaId}:202501-202503`, empresaId, usuarioId: adminId, periodoDesde: '202501', periodoHasta: '202503' })
  // agotar max_intentos (3) para que quede FALLIDO definitivo (el 1er fallo
  // vuelve a 'pendiente' por contrato — es un reintento, no un fin)
  for (let i = 0; i < 3; i++) {
    jobsP.tomar(db, h.id)
    jobsP.finalizar(db, h.id, 'fallido', 'SII 500 simulado')
  }

  const { requireAuth } = require('../backend/middleware/requireAuth')
  const router = require('../backend/routes/contable')
  const app = express()
  app.use(express.json())
  app.set('trust proxy', 1)
  app.use('/api/contable', requireAuth, router)
  const server = app.listen(0)
  const port = server.address().port
  const sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(sid, adminId, new Date(Date.now() + 3600e3).toISOString())

  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/contable/empresas/${empresaId}/jobs/estado`, { headers: { cookie: `sid=${sid}` } })
    assert.strictEqual(res.status, 200)
    const body = await res.json()
    assert.strictEqual(body.ok, true)
    assert.strictEqual(body.resumen.fallidos_recientes, 1)
    assert.ok(body.resumen.ultima_sync && body.resumen.ultima_sync.periodo === '202610', 'ultima_sync con período real')
    assert.strictEqual(body.trabajos.length, 2)
    const detalle = body.trabajos.map((t) => `${t.tipo}/${t.estado}`).sort().join(',')
    assert.strictEqual(detalle, 'historico_rcv/fallido,sync_diaria/completado')
    // nunca filtra progreso_json crudo ni claves
    const texto = JSON.stringify(body)
    assert.ok(!texto.includes('progreso_json') && !texto.includes('clave_unicidad'))
  } finally {
    server.close()
  }
})
