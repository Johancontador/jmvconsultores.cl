/**
 * Tests SAAS-2 — Onboarding autónomo (docs/SAAS-ACCESO §4).
 *  - Ficha + checklist §43: estado inicial tras el registro self-service.
 *  - consultarSii con el SII mockeado: propuesta sin persistir nada.
 *  - confirmarFicha: solo con confirmación humana, checklist ✓, auditado.
 *  - Ingesta del histórico: job sincrónico mockeado, dedupe idempotente,
 *    checklist documentos_historicos, validaciones de rango.
 *  - RBAC: onboarding:ejecutar para contador/admin_empresa/super_admin;
 *    NO para auditor/tesorería.
 * Ejecutar con: node --test test/saas2.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-saas2-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const licencias = require('../backend/core/licencias')
const registro = require('../backend/core/registro')
const onboarding = require('../backend/core/onboarding')
const auditoria = require('../backend/core/auditoria')
const { permisosDeRol } = require('../backend/core/permisos')
const rcv = require('../backend/services/rcv')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup: empresa self-service (registro con SII mockeado) ----------

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

const siiRcvMock = require('../backend/services/sii-rcv')
const originalProbar = siiRcvMock.probarConexion
const originalConsultar = rcv.consultarRCV

// Shape exacto que entrega services/rcv.js (consultarRCV)
const docVenta = (folio, fecha, extras = {}) => ({
  folio: String(folio), rutDoc: '77888888-2', razonSocial: 'Cliente Onboarding SpA',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: fecha, fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})
const docCompra = (folio, fecha, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-8', razonSocial: 'Proveedor Onboarding Ltda',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: fecha, fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})

/** Mock del SII: RCV de 2 períodos (o rechazo de credencial si mal=true). */
function mockearRCV(mal = false) {
  rcv.consultarRCV = async (rut, clave, tipo, periodo) => {
    if (mal) throw new Error('Clave SII incorrecta')
    if (tipo === 'ventas') {
      return periodo === '202509'
        ? [docVenta(101, '15/09/2025')]
        : [docVenta(201, '05/10/2025'), docVenta(202, '20/10/2025')]
    }
    return periodo === '202509'
      ? [docCompra(501, '10/09/2025')]
      : [docCompra(601, '12/10/2025')]
  }
}
function restaurarRCV() {
  rcv.consultarRCV = originalConsultar
}

// Registro self-service como el flujo real (SAAS-1): usuario+empresa+PRUEBA
let EMP = null
let usuarioPyme = null
test.before(async () => {
  siiRcvMock.probarConexion = async () => ({ ok: true, periodo: '202610', compras: 1, ventas: 1, pasos: [] })
  const r = await registro.registrarConOnboarding(db, {
    username: 'pyme.onboarding', password: 'clave-segura-1', rut: '77.555.111-9',
    claveSii: 'miclave', nombreEmpresa: 'Pyme Onboarding SpA', probarSii: true,
  })
  siiRcvMock.probarConexion = originalProbar
  EMP = r
  usuarioPyme = r.usuarioId
})

// ---------- Checklist inicial ----------

test('ficha: tras el registro, todo el checklist está pendiente y sin datos', () => {
  const f = onboarding.ficha(db, EMP.empresaId)
  assert.strictEqual(f.empresa.rut, '77555111-9')
  assert.strictEqual(f.completo, false)
  assert.deepStrictEqual(f.checklist, {
    razon_social_sii: 'pendiente',
    inicio_actividades: 'pendiente',
    actividades_economicas: 'pendiente',
    regimen_tributario: 'pendiente',
    socios_representante: 'pendiente',
    documentos_historicos: 'pendiente',
  })
  assert.deepStrictEqual(f.pendientes_humano, onboarding.clavesChecklist())
  assert.deepStrictEqual(f.ficha.actividades, [])
})

test('ficha lanza con empresa inexistente', () => {
  assert.throws(() => onboarding.ficha(db, 999999), /no encontrada/i)
})

// ---------- consultarSii (SII mockeado) ----------

test('consultarSii propone razón social + inicio de actividades (primera venta) SIN persistir', async () => {
  mockearRCV()
  try {
    const p = await onboarding.consultarSii(db, EMP.empresaId)
    assert.strictEqual(p.razon_social_sii, 'Pyme Onboarding SpA')
    // Primera venta del mock: 05/10/2025 (folio 201)
    assert.strictEqual(p.inicio_actividades_propuesto, '2025-10-05')
    assert.strictEqual(p.primera_venta, '2025-10-05')
    assert.strictEqual(p.documentos_analizados.ventas, 2)
    assert.strictEqual(p.documentos_analizados.compras, 1)
    assert.ok(p.avisos.some((a) => /Actividades económicas/.test(a)))

    // NADA persistido: la ficha sigue igual (confirmación humana antes)
    const f = onboarding.ficha(db, EMP.empresaId)
    assert.strictEqual(f.ficha.razon_social_sii, null)
    assert.strictEqual(f.checklist.razon_social_sii, 'pendiente')
  } finally {
    restaurarRCV()
  }
})

test('consultarSii falla con clave inválida (propagación del error del SII)', async () => {
  mockearRCV(true)
  try {
    await assert.rejects(() => onboarding.consultarSii(db, EMP.empresaId), /Clave SII incorrecta/)
  } finally {
    restaurarRCV()
  }
})

// ---------- confirmarFicha ----------

test('confirmarFicha persiste solo lo confirmado, marca checklist ✓ y audita', () => {
  const f = onboarding.confirmarFicha(db, {
    empresaId: EMP.empresaId,
    usuarioId: usuarioPyme,
    razonSocialSii: 'Pyme Onboarding SpA',
    inicioActividades: '2025-10-05',
    regimenTributario: 'Pro Pyme General (14 D)',
    actividades: ['620100 — Venta al por mayor de computadores'],
    socios: ['12.345.678-9 — María Pérez — Representante legal'],
  })
  assert.strictEqual(f.ficha.razon_social_sii, 'Pyme Onboarding SpA')
  assert.strictEqual(f.ficha.inicio_actividades, '2025-10-05')
  assert.strictEqual(f.ficha.regimen_tributario, 'Pro Pyme General (14 D)')
  assert.deepStrictEqual(f.ficha.actividades, ['620100 — Venta al por mayor de computadores'])
  assert.strictEqual(f.checklist.razon_social_sii, 'confirmado')
  assert.strictEqual(f.checklist.inicio_actividades, 'confirmado')
  assert.strictEqual(f.checklist.regimen_tributario, 'confirmado')
  assert.strictEqual(f.checklist.actividades_economicas, 'confirmado')
  assert.strictEqual(f.checklist.socios_representante, 'confirmado')
  assert.strictEqual(f.checklist.documentos_historicos, 'pendiente', 'la ingesta aún no corre')
  assert.strictEqual(f.completo, false)
  assert.ok(auditoria.consultar(db, { empresaId: EMP.empresaId, limit: 30 })
    .some((a) => a.accion === 'onboarding.ficha_confirmada'))
})

test('confirmarFicha: fecha inválida rechazada; confirmación parcial permitida', () => {
  assert.throws(() => onboarding.confirmarFicha(db, {
    empresaId: EMP.empresaId, usuarioId: usuarioPyme, inicioActividades: '10/2025',
  }), /fecha ISO/)

  // Confirmar solo un campo no pisa los demás (COALESCE)
  const f = onboarding.confirmarFicha(db, {
    empresaId: EMP.empresaId, usuarioId: usuarioPyme, razonSocialSii: 'Pyme Onboarding SpA Corregida',
  })
  assert.strictEqual(f.ficha.razon_social_sii, 'Pyme Onboarding SpA Corregida')
  assert.strictEqual(f.ficha.inicio_actividades, '2025-10-05', 'lo ya confirmado se conserva')
})

// ---------- RBAC ----------

test('permisos: onboarding:ejecutar para contador, admin_empresa y super_admin; NO para auditor/tesorería', () => {
  assert.ok(permisosDeRol('contador').has('onboarding:ejecutar'))
  assert.ok(permisosDeRol('admin_empresa').has('onboarding:ejecutar'))
  assert.ok(permisosDeRol('admin_empresa').has('documentos:ingestar'), 'SAAS-2: el dueño ingesta su histórico')
  assert.ok(permisosDeRol('super_admin').has('onboarding:ejecutar'))
  assert.strictEqual(permisosDeRol('auditor').has('onboarding:ejecutar'), false)
  assert.strictEqual(permisosDeRol('tesoreria').has('onboarding:ejecutar'), false)
})

// ---------- Ingesta del histórico ----------

test('ingestarHistorico: validaciones de rango y empresa', () => {
  assert.throws(() => onboarding.ingestarHistorico(db, {
    empresaId: EMP.empresaId, usuarioId: usuarioPyme, desde: '202510', hasta: '202509',
  }), /posterior/)
  assert.throws(() => onboarding.ingestarHistorico(db, {
    empresaId: EMP.empresaId, usuarioId: usuarioPyme, desde: 'basura', hasta: '202510',
  }), /AAAAMM/)
  assert.throws(() => onboarding.ingestarHistorico(db, {
    empresaId: 999999, usuarioId: usuarioPyme, desde: '202509', hasta: '202510',
  }), /no encontrada/i)
})

test('ingestarHistorico con SII mockeado: inserta, marca checklist, audita y es idempotente', async () => {
  mockearRCV()
  try {
    // Corrida SINCRÓNICA: ejecutamos el interno directamente (la función
    // pública lanza en background con un require lazy de db).
    const job = onboarding.ingestarHistorico(db, {
      empresaId: EMP.empresaId, usuarioId: usuarioPyme, desde: '202509', hasta: '202510',
    })
    const t = onboarding.trabajos.get(job.jobId)
    await t.promise

    assert.strictEqual(t.estado, 'completado')
    assert.strictEqual(t.resultado.insertados_total, 5, 'venta+compra 202509, 2 ventas+compra 202510')
    assert.strictEqual(t.resultado.duplicados_total, 0)

    // Documentos realmente en bandeja con fecha normalizada DD/MM/YYYY → ISO
    const docs = db.prepare(`SELECT folio, fecha_docto, estado FROM documentos WHERE empresa_id = ? ORDER BY folio`).all(EMP.empresaId)
    assert.strictEqual(docs.length, 5)
    const v201 = docs.find((d) => d.folio === '201')
    assert.strictEqual(v201.fecha_docto, '2025-10-05')
    assert.strictEqual(v201.estado, 'PENDIENTE')

    // Checklist marcado + auditoría
    const f = onboarding.ficha(db, EMP.empresaId)
    assert.strictEqual(f.checklist.documentos_historicos, 'confirmado')
    assert.ok(auditoria.consultar(db, { empresaId: EMP.empresaId, limit: 50 })
      .some((a) => a.accion === 'onboarding.historico_completado'))

    // Idempotencia: re-lanzar el mismo rango NO duplica (dedupe FASE 3)
    const job2 = onboarding.ingestarHistorico(db, {
      empresaId: EMP.empresaId, usuarioId: usuarioPyme, desde: '202509', hasta: '202510',
    })
    const t2 = onboarding.trabajos.get(job2.jobId)
    await t2.promise
    assert.strictEqual(t2.estado, 'completado')
    assert.strictEqual(t2.resultado.insertados_total, 0)
    assert.strictEqual(t2.resultado.duplicados_total, 5)
    assert.strictEqual(
      db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?`).get(EMP.empresaId).n,
      5,
    )
  } finally {
    restaurarRCV()
  }
})

test('ingestarHistorico con errores parciales: marca parcial sin degradar confirmado', async () => {
  // Un flujo falla siempre (simula período sin servicio) → errores > 0.
  // El wrapper envuelve al MOCK (nunca al SII real: los tests no tocan red).
  mockearRCV()
  const mockBueno = rcv.consultarRCV
  rcv.consultarRCV = async (rut, clave, tipo, periodo) => {
    if (tipo === 'compras') throw new Error('SII no disponible')
    return mockBueno(rut, clave, tipo, periodo)
  }
  // Empresa nueva para partir de checklist fresco
  siiRcvMock.probarConexion = async () => ({ ok: true, periodo: '202610', compras: 0, ventas: 0, pasos: [] })
  const r2 = await registro.registrarConOnboarding(db, {
    username: 'pyme.parcial', password: 'clave-segura-1', rut: '77.555.222-0',
    claveSii: 'otraclave', nombreEmpresa: 'Pyme Parcial SpA', probarSii: true,
  })
  siiRcvMock.probarConexion = originalProbar
  try {
    const job = onboarding.ingestarHistorico(db, {
      empresaId: r2.empresaId, usuarioId: usuarioPyme, desde: '202509', hasta: '202510',
    })
    const t = onboarding.trabajos.get(job.jobId)
    await t.promise
    assert.strictEqual(t.estado, 'completado_con_errores')
    const f = onboarding.ficha(db, r2.empresaId)
    assert.strictEqual(f.checklist.documentos_historicos, 'parcial')

    // Re-run con SII sano: 2do run parcial no degrada; un run limpio confirma
    restaurarRCV()
    mockearRCV()
    const job2 = onboarding.ingestarHistorico(db, {
      empresaId: r2.empresaId, usuarioId: usuarioPyme, desde: '202509', hasta: '202510',
    })
    const t2 = onboarding.trabajos.get(job2.jobId)
    await t2.promise
    assert.strictEqual(t2.estado, 'completado')
    assert.strictEqual(onboarding.ficha(db, r2.empresaId).checklist.documentos_historicos, 'confirmado')
  } finally {
    restaurarRCV()
  }
})

// ---------- Estado expuesto por API ----------

test('estadoIngestaHistorica: solo el dueño del job lo ve; null para otro usuario', async () => {
  mockearRCV()
  try {
    const job = onboarding.ingestarHistorico(db, {
      empresaId: EMP.empresaId, usuarioId: usuarioPyme, desde: '202510', hasta: '202510',
    })
    assert.strictEqual(onboarding.estadoIngestaHistorica(job.jobId, usuarioPyme).jobId, job.jobId)
    assert.strictEqual(onboarding.estadoIngestaHistorica(job.jobId, adminId), null)
    await onboarding.trabajos.get(job.jobId).promise
    const st = onboarding.estadoIngestaHistorica(job.jobId, usuarioPyme)
    assert.strictEqual(st.total, 1)
    assert.strictEqual(st.estado, 'completado')
    assert.strictEqual(st.empresa_id, EMP.empresaId)
  } finally {
    restaurarRCV()
  }
})
