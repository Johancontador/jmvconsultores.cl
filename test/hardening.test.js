/**
 * BLOQUE 1bis — P8: hardening.
 *
 *  - Headers (P8.C/D/E): HSTS SOLO con HTTPS real en producción; CSP
 *    incremental con deuda 'unsafe-inline' documentada; CORP presente.
 *  - Rate-limit /api/sii/probar (P8.A): 10/15min por IP → la 11ª da 429.
 *
 * Ejecutar con: node --test test/hardening.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const express = require('express')

const dbFile = path.join(os.tmpdir(), `iva-mensual-hard-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { headersSeguridad, CSP } = require('../backend/middleware/seguridad-headers')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------------- P8.C/D/E: headers ----------------

function capturar(reqOverrides, env) {
  const prev = process.env.NODE_ENV
  if (env !== undefined) process.env.NODE_ENV = env
  const headers = {}
  const res = { setHeader: (k, v) => { headers[k] = v } }
  let llamado = false
  headersSeguridad({ secure: !!reqOverrides.secure }, res, () => { llamado = true })
  process.env.NODE_ENV = prev
  return { headers, llamado }
}

test('P8.C: HSTS SOLO en producción detrás de HTTPS real', () => {
  const prodSecure = capturar({ secure: true }, 'production')
  assert.strictEqual(prodSecure.headers['Strict-Transport-Security'], 'max-age=31536000; includeSubDomains')

  const prodInsecure = capturar({ secure: false }, 'production')
  assert.ok(!prodInsecure.headers['Strict-Transport-Security'], 'HTTP (dev/self-signed): sin HSTS')

  const devSecure = capturar({ secure: true }, 'development')
  assert.ok(!devSecure.headers['Strict-Transport-Security'], 'NODE_ENV de desarrollo: jamás HSTS')
})

test('P8.D/E: CSP incremental, CORP y headers base presentes', () => {
  const { headers } = capturar({ secure: false }, 'production')
  assert.ok(headers['Content-Security-Policy'], 'CSP presente')
  assert.ok(CSP.includes("default-src 'self'"))
  assert.ok(CSP.includes("frame-ancestors 'none'"), 'anti-framing en CSP')
  assert.ok(CSP.includes('https://cdn.jsdelivr.net'), 'CDN con SRI permitido (deuda unsafe-inline documentada)')
  assert.ok(CSP.includes("'unsafe-inline'"), 'deuda documentada: handlers inline aún requieren unsafe-inline')
  assert.strictEqual(headers['Cross-Origin-Resource-Policy'], 'same-origin')
  assert.strictEqual(headers['X-Content-Type-Options'], 'nosniff')
  assert.strictEqual(headers['X-Frame-Options'], 'DENY')
})

// ---------------- P8.A: rate-limit /api/sii/probar ----------------

test('P8.A: /api/sii/probar permite 10 y bloquea la 11ª con 429', async () => {
  // Stub ANTES de requerir el router (destructuring copia el valor)
  const siiRcv = require('../backend/services/sii-rcv')
  siiRcv.probarConexion = async () => ({ ok: true, proveedor: 'sii', pasos: [] })
  const routerSii = require('../backend/routes/sii')
  const { requireAuth } = require('../backend/middleware/requireAuth')

  const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const sid = crypto.randomBytes(32).toString('hex')
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`)
    .run(sid, adminId, new Date(Date.now() + 3600e3).toISOString())

  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use('/api/sii', requireAuth, routerSii)
  const server = app.listen(0)
  const port = server.address().port

  try {
    let ultimoEstado = 0
    for (let i = 1; i <= 11; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/api/sii/probar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
        body: JSON.stringify({ rut: '76111111-1', clave_sii: 'clave-cualquiera' }),
      })
      ultimoEstado = r.status
      if (i <= 10) assert.strictEqual(r.status, 200, `intento ${i} debe pasar`)
      else assert.strictEqual(r.status, 429, `intento ${i} debe ser bloqueado`)
    }
    const cuerpo = await (await fetch(`http://127.0.0.1:${port}/api/sii/probar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `sid=${sid}` },
      body: JSON.stringify({ rut: '76111111-1', clave_sii: 'x' }),
    })).json()
    assert.ok(/15 minutos/.test(cuerpo.error || ''), 'mensaje de bloqueo claro')
    assert.strictEqual(ultimoEstado, 429)
  } finally {
    server.close()
  }
})
