/**
 * Tests SAAS-1 — Acomplamiento comercial (docs/SAAS-ACCESO.md).
 *  - Licencias: prueba 90 días, heredada, refresco de estado, gracia,
 *    suspensión, activación/cancelación auditadas.
 *  - Gate en requirePermiso: lectura libre; escritura exige licencia;
 *    HTTP 402 con detalle cuando está suspendida.
 *  - Registro self-service: RUT duplicado, SII mockeado (ok y error),
 *    empresa+usuario+rol+licencia en una transacción, honeypot, validación.
 *  - Backfill: empresas preexistentes reciben licencia heredada.
 * Ejecutar con: node --test test/saas1.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-saas1-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const licencias = require('../backend/core/licencias')
const registro = require('../backend/core/registro')
const migraciones = require('../backend/core/migraciones')
const auditoria = require('../backend/core/auditoria')
const { permisosDeRol } = require('../backend/core/permisos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

test('planes y constantes: catálogo coherente con docs/SAAS-ACCESO §5.3', () => {
  assert.deepStrictEqual(Object.keys(licencias.PLANES), ['PRUEBA', 'PYME', 'PRO', 'DESPACHO'])
  assert.strictEqual(licencias.PLANES.PRUEBA.dias, 90, 'la prueba dura 3 meses (90 días)')
  assert.strictEqual(licencias.PLANES.PYME.monto_clp, 29900)
  assert.strictEqual(licencias.PLANES.PRO.monto_clp, 59900)
  assert.strictEqual(licencias.PLANES.DESPACHO.monto_clp, 119900)
  assert.ok(licencias.GRACIA_DIAS > 0)
})

test('backfill SAAS-1: empresas preexistentes reciben licencia heredada ACTIVA', () => {
  // La empresa sembrada por el setup de migraciones (si existe) o una creada
  // AHORA por el super_admin (camino empresas.crear) debe quedar con licencia.
  const emp = empresas.crear(db, {
    usuarioId: adminId, rut: '77555555-6', nombre: 'Servicio JMV Ltda',
    claveSii: 'clave-test', tasaPpm: 0.01, telefono: '912345678',
  })
  const s = licencias.suscripcionDe(db, emp.id)
  assert.ok(s, 'la empresa creada por JMV tiene licencia')
  assert.strictEqual(s.estado, 'ACTIVA')
  assert.strictEqual(s.plan, 'DESPACHO')
  assert.match(String(s.notas || ''), /Heredada|servicio/)
})

test('crearPrueba: 90 días exactos, una sola por empresa, auditada', () => {
  const emp2 = empresas.crear(db, {
    usuarioId: adminId, rut: '77666666-1', nombre: 'Prueba SpA',
    claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
  })
  // empresas.crear ya le puso heredada → crearPrueba debe rechazar duplicado
  assert.throws(() => licencias.crearPrueba(db, emp2.id), /ya tiene una licencia/)

  // Empresa "self-service" simulada: le quitamos la heredada y creamos la prueba
  db.prepare(`DELETE FROM suscripciones WHERE empresa_id = ?`).run(emp2.id)
  const s = licencias.crearPrueba(db, emp2.id, adminId)
  assert.strictEqual(s.plan, 'PRUEBA')
  assert.strictEqual(s.estado, 'PRUEBA')
  assert.strictEqual(s.monto_clp, 0)
  const dias = Math.round((new Date(s.fin) - new Date(s.inicio)) / 86400000)
  assert.strictEqual(dias, 90)

  assert.ok(auditoria.consultar(db, { empresaId: emp2.id, limit: 20 })
    .some((a) => a.accion === 'licencia.crear'))
})

test('refrescarEstado: PRUEBA vencida → VENCIDA con gracia; gracia vencida → SUSPENDIDA', () => {
  const emp3 = empresas.crear(db, {
    usuarioId: adminId, rut: '77777777-7', nombre: 'Vencida SpA',
    claveSii: 'clave-test3', tasaPpm: 0.01, telefono: '912345678',
  })
  db.prepare(`DELETE FROM suscripciones WHERE empresa_id = ?`).run(emp3.id)

  // Caso 1: fin ayer → refrescar la vuelve VENCIDA con gracia a +7 días
  const ayer = licencias.sumaDias(licencias.hoyISO(), -1)
  db.prepare(`
    INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp)
    VALUES (?, 'PYME', 'ACTIVA', date('now', '-31 days'), ?, 29900)
  `).run(emp3.id, ayer)
  let s = licencias.suscripcionDe(db, emp3.id)
  assert.strictEqual(s.estado, 'VENCIDA')
  assert.strictEqual(s.gracia_hasta, licencias.sumaDias(ayer, licencias.GRACIA_DIAS))

  // En gracia: la empresa SIGUE pudiendo escribir (cortesía estándar SaaS)
  assert.strictEqual(licencias.puedeEscribir(db, emp3.id).ok, true)
  assert.strictEqual(licencias.puedeEscribir(db, emp3.id).en_gracia, true)

  // Caso 2: gracia vencida → SUSPENDIDA y el gate bloquea
  db.prepare(`UPDATE suscripciones SET gracia_hasta = date('now', '-1 day') WHERE empresa_id = ?`).run(emp3.id)
  s = licencias.suscripcionDe(db, emp3.id)
  assert.strictEqual(s.estado, 'SUSPENDIDA')
  const r = licencias.puedeEscribir(db, emp3.id)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.motivo, 'suspendida')
  assert.throws(() => licencias.exigirVigente(db, emp3.id), /Licencia SUSPENDIDA/)
})

test('activarPlan: renueva desde fin vigente, cambia plan y queda auditado', () => {
  const emp4 = empresas.crear(db, {
    usuarioId: adminId, rut: '77888888-2', nombre: 'Pagadora SpA',
    claveSii: 'clave-test4', tasaPpm: 0.01, telefono: '912345678',
  })
  db.prepare(`DELETE FROM suscripciones WHERE empresa_id = ?`).run(emp4.id)
  db.prepare(`
    INSERT INTO suscripciones (empresa_id, plan, estado, inicio, fin, monto_clp)
    VALUES (?, 'PYME', 'ACTIVA', date('now'), date('now', '+20 days'), 29900)
  `).run(emp4.id)

  const s = licencias.activarPlan(db, { empresaId: emp4.id, plan: 'PRO', usuarioId: adminId, meses: 1 })
  assert.strictEqual(s.plan, 'PRO')
  assert.strictEqual(s.estado, 'ACTIVA')
  assert.strictEqual(s.monto_clp, 59900)
  // Renovación desde el fin vigente (+20 días) + 1 mes
  const esperado = licencias.sumaDias(licencias.hoyISO(), 20)
  const [y, m, d] = esperado.split('-').map(Number)
  assert.strictEqual(s.fin, new Date(Date.UTC(y, m - 1 + 1, d)).toISOString().slice(0, 10))

  assert.throws(() => licencias.activarPlan(db, { empresaId: emp4.id, plan: 'PRUEBA', usuarioId: adminId }), /solo con crearPrueba/)
  assert.throws(() => licencias.activarPlan(db, { empresaId: emp4.id, plan: 'ORO', usuarioId: adminId }), /Plan inválido/)
  assert.ok(auditoria.consultar(db, { empresaId: emp4.id, limit: 30 })
    .some((a) => a.accion === 'licencia.activar'))
})

test('cancelar: no renueva (queda usable hasta fin) y queda auditado', () => {
  const emp5 = empresas.crear(db, {
    usuarioId: adminId, rut: '77999999-8', nombre: 'Canceladora SpA',
    claveSii: 'clave-test5', tasaPpm: 0.01, telefono: '912345678',
  })
  licencias.cancelar(db, { empresaId: emp5.id, usuarioId: adminId, notas: 'no renovar' })
  const s = licencias.suscripcionDe(db, emp5.id)
  assert.strictEqual(s.estado, 'ACTIVA', 'cancelada sigue usable hasta su fin')
  assert.ok(auditoria.consultar(db, { empresaId: emp5.id, limit: 30 })
    .some((a) => a.accion === 'licencia.cancelar'))
})

// ---------- Gate en requirePermiso (integración HTTP) ----------

test('gate RBAC: auditor (solo lectura) mantiene sus permisos :ver; escritura exige licencia', () => {
  // El auditor tiene reportes:ver → la capacidad termina en :ver → sin gate.
  assert.ok(permisosDeRol('auditor').has('reportes:ver'))
  // El gate solo aplica a capacidades que no son de lectura: comprobamos la
  // lógica del middleware con un mock mínimo de req/res.
  const { requirePermiso } = require('../backend/middleware/requirePermiso')

  const empSus = db.prepare(`SELECT empresa_id FROM suscripciones WHERE estado = 'SUSPENDIDA' LIMIT 1`).get()
  assert.ok(empSus, 'hay una empresa suspendida del test anterior')

  const mw = requirePermiso('documentos:ingestar') // escritura
  let codigo = null, cuerpo = null
  const res = {
    status(c) { codigo = c; return this },
    json(j) { cuerpo = j },
  }
  const req = { user: { id: adminId }, params: { empresaId: String(empSus.empresa_id) } }
  mw(req, res, () => { throw new Error('NO debió llegar al handler') })
  assert.strictEqual(codigo, 402, 'escritura con licencia SUSPENDIDA → 402')
  assert.strictEqual(cuerpo.ok, false)
  assert.match(cuerpo.error, /SUSPENDIDA/)
  assert.ok(cuerpo.licencia, 'la respuesta incluye el estado de licencia para la UI')
})

// ---------- Registro self-service ----------

test('validarFormulario: rechaza honeypot, usuario corto, clave corta y RUT inválido', () => {
  const base = { username: 'miempresa', password: 'clave-segura-1', rut: '77555555-6', claveSii: 'abcd1234', nombreEmpresa: 'Mi Empresa' }
  assert.throws(() => registro.validarFormulario({ ...base, web: 'http://spam' }), /rechazado/)
  assert.throws(() => registro.validarFormulario({ ...base, username: 'abc' }), /4 caracteres/)
  assert.throws(() => registro.validarFormulario({ ...base, password: 'corta12' }), /8 caracteres/)
  assert.throws(() => registro.validarFormulario({ ...base, rut: '12345678-0' }), /RUT inválido/)
  assert.throws(() => registro.validarFormulario({ ...base, claveSii: '' }), /clave SII/)
})

test('registro: RUT ya registrado rechaza (una licencia por RUT)', async () => {
  await assert.rejects(
    () => registro.registrarConOnboarding(db, {
      username: 'otro', password: 'clave-segura-1', rut: '77555555-6',
      claveSii: 'x123456', nombreEmpresa: 'Otra', probarSii: false,
    }),
    /ya tiene una cuenta/
  )
})

test('registro con SII mockeado OK: crea TODO en una transacción (user+empresa+PUC+rol+PRUEBA)', async () => {
  const original = require('../backend/services/sii-rcv').probarConexion
  require('../backend/services/sii-rcv').probarConexion = async () => ({
    ok: true, proveedor: 'sii', periodo: '202610', compras: 12, ventas: 8, pasos: [],
  })
  try {
    const r = await registro.registrarConOnboarding(db, {
      username: ' ClientePyme ', password: 'clave-segura-1',
      rut: '77.123.456-9', claveSii: 'miclave', nombreEmpresa: 'Cliente Pyme Demo',
      telefono: '912345678', ip: '127.0.0.1',
    })
    assert.strictEqual(r.ok, true)
    assert.strictEqual(r.licencia.plan, 'PRUEBA')
    // 90 días exactos de vigencia; el countdown mostrado depende de la hora
    // del día (redondeo hacia arriba) — se acepta 90 o 91.
    assert.ok(r.licencia.dias_restantes >= 90 && r.licencia.dias_restantes <= 91,
      `dias_restantes=${r.licencia.dias_restantes}`)
    assert.strictEqual(r.onboarding.estado, 'verificado_sii')

    // Usuario normalizado y con rol admin_empresa en su empresa
    const u = db.prepare(`SELECT id, username FROM users WHERE id = ?`).get(r.usuarioId)
    assert.strictEqual(u.username, 'clientepyme')
    const rol = db.prepare(`
      SELECT r.codigo FROM usuario_empresa ue JOIN roles r ON r.id = ue.rol_id
      WHERE ue.usuario_id = ? AND ue.empresa_id = ? AND ue.activo = 1
    `).get(r.usuarioId, r.empresaId)
    assert.strictEqual(rol.codigo, 'admin_empresa')

    // Plan de cuentas sembrado + clave SII cifrada (nunca plana)
    const cuentas = db.prepare(`SELECT COUNT(*) AS n FROM cuentas WHERE empresa_id = ?`).get(r.empresaId)
    assert.ok(cuentas.n > 50, 'plan PUC precargado')
    const clave = db.prepare(`SELECT clave_sii FROM empresas WHERE id = ?`).get(r.empresaId).clave_sii
    assert.ok(!clave.includes('miclave'), 'la clave SII nunca queda en claro')
    assert.match(clave, /^v1:/, 'formato de bóveda AES-256-GCM')

    // Licencia PRUEBA 90 días + auditoría del registro
    const s = licencias.suscripcionDe(db, r.empresaId)
    assert.strictEqual(s.plan, 'PRUEBA')
    assert.ok(auditoria.consultar(db, { empresaId: r.empresaId, limit: 20 })
      .some((a) => a.accion === 'registro.self_service'))
  } finally {
    require('../backend/services/sii-rcv').probarConexion = original
  }
})

test('registro con credencial SII rechazada: NO crea nada (ni user, ni empresa, ni licencia)', async () => {
  const original = require('../backend/services/sii-rcv').probarConexion
  require('../backend/services/sii-rcv').probarConexion = async () => ({
    ok: false, error: 'Clave SII incorrecta', pasos: [], proveedor: 'sii',
  })
  const usersAntes = db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n
  const empresasAntes = db.prepare(`SELECT COUNT(*) AS n FROM empresas`).get().n
  try {
    await assert.rejects(
      () => registro.registrarConOnboarding(db, {
        username: 'fantasma', password: 'clave-segura-1', rut: '77222222-K',
        claveSii: 'malisima', nombreEmpresa: 'Fantasma SpA',
      }),
      /no aceptó/
    )
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n, usersAntes)
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM empresas`).get().n, empresasAntes)
    assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM suscripciones`).get().n,
      db.prepare(`SELECT COUNT(*) AS n FROM empresas`).get().n, 'cada empresa sigue con exactamente 1 licencia')
  } finally {
    require('../backend/services/sii-rcv').probarConexion = original
  }
})

test('username duplicado rechaza; registro sin verificar SII queda marcado pendiente', async () => {
  await assert.rejects(
    () => registro.registrarConOnboarding(db, {
      username: 'clientepyme', password: 'clave-segura-1', rut: '77333333-5',
      claveSii: 'x123456', nombreEmpresa: 'Duplicado', probarSii: false,
    }),
    /ya existe/
  )
  const r = await registro.registrarConOnboarding(db, {
    username: 'sinverificar', password: 'clave-segura-1', rut: '77333333-5',
    claveSii: 'x123456', nombreEmpresa: 'Sin Verificar SpA', probarSii: false,
  })
  assert.strictEqual(r.onboarding.estado, 'pendiente_verificacion')
  const s = licencias.suscripcionDe(db, r.empresaId)
  assert.strictEqual(s.plan, 'PRUEBA', 'la prueba se otorga igual (JMV valida la clave después)')
})

test('migracionesSaas1 es idempotente (re-ejecutar no duplica ni rompe)', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM suscripciones`).get().n
  migraciones.migracionesSaas1(db)
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM suscripciones`).get().n
  assert.strictEqual(antes, despues)
  const sinLicencia = db.prepare(`
    SELECT COUNT(*) AS n FROM empresas WHERE activo = 1
    AND id NOT IN (SELECT empresa_id FROM suscripciones)
  `).get().n
  assert.strictEqual(sinLicencia, 0, 'toda empresa activa tiene su licencia')
})
