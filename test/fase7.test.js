/**
 * Tests FASE 7 — ACTIVOS FIJOS: registro (alta opcional contabilizada),
 * depreciación mensual por línea recta propuesta→confirmada con asiento del
 * núcleo (UNIQUE activo+período), venta/baja con utilidad/pérdida y aislamiento.
 * Ejecutar con: node --test test/fase7.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase7-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const asientos = require('../backend/core/asientos')
const periodos = require('../backend/core/periodos')
const reportes = require('../backend/core/reportes')
const activos = require('../backend/core/activos')
const { permisosDeRol } = require('../backend/core/permisos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77561234-7', nombre: 'Activos Test SpA',
  claveSii: 'clave-af', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77562345-4', nombre: 'Otra Activos Ltda',
  claveSii: 'clave-af2', tasaPpm: 0.015, telefono: '912345678',
})

const ctaPorAlias = (empresaId, alias) => db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias).id
const ctaPorCodigo = (empresaId, codigo) => db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = ?`).get(empresaId, codigo).id
const lineasDe = (asientoId) => db.prepare(`
  SELECT c.alias, c.codigo, al.debe, al.haber FROM asiento_lineas al JOIN cuentas c ON c.id = al.cuenta_id WHERE al.asiento_id = ?
`).all(asientoId)

// ---------- RBAC ----------

test('RBAC: contador opera activos; auditor y admin_empresa solo ven; tesorería no', () => {
  assert.ok(permisosDeRol('contador').has('activos:ver') && permisosDeRol('contador').has('activos:operar'))
  assert.ok(permisosDeRol('auditor').has('activos:ver') && !permisosDeRol('auditor').has('activos:operar'))
  assert.ok(permisosDeRol('admin_empresa').has('activos:ver') && !permisosDeRol('admin_empresa').has('activos:operar'))
  assert.ok(!permisosDeRol('tesoreria').has('activos:ver'))
})

// ---------- Registro ----------

test('crear activo: defaults de depreciación por alias y validaciones de dominio', () => {
  const r = activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-001', descripcion: 'Camioneta reparto',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.04'),
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 12000000, vidaUtilMeses: 48,
  })
  assert.ok(r.id > 0 && !r.alta)
  const a = db.prepare(`SELECT * FROM activos_fijos WHERE id = ?`).get(r.id)
  assert.strictEqual(a.cuenta_dep_id, ctaPorAlias(EMP.id, 'DEPRECIACION_ACUMULADA'))
  assert.strictEqual(a.cuenta_gasto_id, ctaPorAlias(EMP.id, 'GASTO_DEPRECIACION'))
  assert.strictEqual(a.estado, 'ACTIVO')

  // validaciones
  assert.throws(() => activos.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: 'X', descripcion: 'd', cuentaActivoId: 99999999, fechaAdquisicion: '2026-09-01', valorAdquisicion: 1, vidaUtilMeses: 12 }), /no existe/)
  assert.throws(() => activos.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: 'X2', descripcion: 'd', cuentaActivoId: ctaPorCodigo(EMP.id, '1.2'), fechaAdquisicion: '2026-09-01', valorAdquisicion: 1, vidaUtilMeses: 12 }), /RESUMEN/)
  assert.throws(() => activos.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: 'X3', descripcion: 'd', cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.04'), fechaAdquisicion: '2026-09-01', valorAdquisicion: 100, vidaUtilMeses: 12, valorResidual: 100 }), /residual/)
  assert.throws(() => activos.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: 'X4', descripcion: 'd', cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.04'), fechaAdquisicion: '2026-09-01', valorAdquisicion: 100, vidaUtilMeses: 0 }), /vida útil/)
  assert.throws(() => activos.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-001', descripcion: 'd', cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.04'), fechaAdquisicion: '2026-09-01', valorAdquisicion: 100, vidaUtilMeses: 12 }), /código AF-001/)
})

test('alta contabilizada opcional: asiento de apertura activo ↔ capital', () => {
  const r = activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-ALTA', descripcion: 'Máquina preexistente',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.03'),
    fechaAdquisicion: '2026-09-15', valorAdquisicion: 3000000, vidaUtilMeses: 60,
    contabilizarAlta: true, cuentaContraId: ctaPorAlias(EMP.id, 'CAPITAL'),
  })
  assert.ok(r.alta && r.alta.total === 3000000)
  const lineas = lineasDe(r.alta.asiento_id)
  assert.strictEqual(lineas.find((l) => l.alias === null && l.codigo === '1.2.1.03').debe, 3000000)
  assert.strictEqual(lineas.find((l) => l.alias === 'CAPITAL').haber, 3000000)
  const a = db.prepare(`SELECT asiento_alta_id FROM activos_fijos WHERE id = ?`).get(r.id)
  assert.strictEqual(a.asiento_alta_id, r.alta.asiento_id)
})

test('aislamiento: la cuenta de otra empresa y su listado no cruzan', () => {
  assert.throws(() => activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-X', descripcion: 'd',
    cuentaActivoId: ctaPorCodigo(EMP2.id, '1.2.1.04'),
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 100, vidaUtilMeses: 12,
  }), /no existe/)
  const r = activos.crear(db, {
    empresaId: EMP2.id, usuarioId: adminId, codigo: 'AF-E2', descripcion: 'Equipo EMP2',
    cuentaActivoId: ctaPorCodigo(EMP2.id, '1.2.1.06'),
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 500000, vidaUtilMeses: 24,
  })
  assert.ok(r.id > 0)
  assert.strictEqual(activos.obtener(db, EMP.id, r.id), null)
  assert.strictEqual(activos.listar(db, EMP.id).activos.some((x) => x.id === r.id), false)
})

// ---------- Depreciación del período ----------

test('preparar depreciación: no muta, propone un asiento cuadrado con líneas por activo', () => {
  activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-002', descripcion: 'Notebooks contabilidad',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.06'),
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 2400000, vidaUtilMeses: 24,
  })
  const antes = {
    filas: db.prepare(`SELECT COUNT(*) AS n FROM activos_depreciaciones`).get().n,
    asientos: db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n,
  }
  const prep = activos.prepararDepreciacion(db, EMP.id, '202610')
  assert.strictEqual(prep.items.length, 3) // AF-001 250.000 + AF-002 100.000 + AF-ALTA 50.000
  assert.strictEqual(prep.total, 400000)
  assert.strictEqual(prep.lineas.length, 6)
  assert.strictEqual(prep.lineas.reduce((s, l) => s + l.debe, 0), prep.lineas.reduce((s, l) => s + l.haber, 0))
  assert.strictEqual(prep.fecha_asiento, '2026-10-31')
  assert.strictEqual(prep.puede_confirmar, true)
  // nada mutó
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM activos_depreciaciones`).get().n, antes.filas)
  assert.strictEqual(db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ?`).get(EMP.id).n, antes.asientos)
})

test('confirmar depreciación: asiento del núcleo, filas UNIQUE y re-confirmar lanza', () => {
  const r = activos.confirmarDepreciacion(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202610', ip: 'test' })
  assert.strictEqual(r.total, 400000)
  const as = db.prepare(`SELECT * FROM asientos WHERE id = ?`).get(r.asiento_id)
  assert.strictEqual(as.tipo, 'automatico')
  assert.strictEqual(as.origen, 'depreciacion:202610')
  assert.strictEqual(as.periodo, '202610')
  const lineas = lineasDe(r.asiento_id)
  const gasto = lineas.filter((l) => l.alias === 'GASTO_DEPRECIACION').reduce((s, l) => s + l.debe, 0)
  const dep = lineas.filter((l) => l.alias === 'DEPRECIACION_ACUMULADA').reduce((s, l) => s + l.haber, 0)
  assert.strictEqual(gasto, 400000)
  assert.strictEqual(dep, 400000)
  const filas = db.prepare(`SELECT * FROM activos_depreciaciones WHERE empresa_id = ? AND periodo = '202610'`).all(EMP.id)
  assert.strictEqual(filas.length, 3)
  for (const f of filas) assert.strictEqual(f.asiento_id, r.asiento_id)

  assert.throws(() => activos.confirmarDepreciacion(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202610' }), /ya tiene depreciación registrada/)
  const prep = activos.prepararDepreciacion(db, EMP.id, '202610')
  assert.strictEqual(prep.items.length, 0) // todos los activos del período ya están depreciados
  assert.ok(prep.omitidos.some((o) => o.motivo === 'ya depreciado en este período'))
})

test('cuota del último mes cierra el depreciable exacto y luego el activo queda totalmente depreciado', () => {
  const r = activos.crear(db, {
    empresaId: EMP2.id, usuarioId: adminId, codigo: 'AF-VIDA', descripcion: 'Activo de vida corta',
    cuentaActivoId: ctaPorCodigo(EMP2.id, '1.2.1.05'),
    fechaAdquisicion: '2026-08-01', valorAdquisicion: 1000000, vidaUtilMeses: 3,
  })
  activos.confirmarDepreciacion(db, { empresaId: EMP2.id, usuarioId: adminId, periodo: '202608' })
  activos.confirmarDepreciacion(db, { empresaId: EMP2.id, usuarioId: adminId, periodo: '202609' })
  activos.confirmarDepreciacion(db, { empresaId: EMP2.id, usuarioId: adminId, periodo: '202610' })
  // las cuotas de AF-VIDA cierran el depreciable exacto (los totales del período
  // incluyen también a AF-E2, creada en el test de aislamiento)
  const montos = db.prepare(`SELECT monto FROM activos_depreciaciones WHERE activo_id = ? ORDER BY periodo`).all(r.id).map((x) => x.monto)
  assert.deepStrictEqual(montos, [333333, 333333, 333334])
  assert.strictEqual(activos.depAcumulada(db, r.id), 1000000)
  const prep = activos.prepararDepreciacion(db, EMP2.id, '202611')
  assert.ok(prep.omitidos.some((o) => o.motivo === 'totalmente depreciado'))
  assert.strictEqual(prep.items.length, 1) // AF-VIDA fuera; AF-E2 recién entra (20833)
  assert.strictEqual(prep.items[0].cuota, 20833)
  // plan de depreciación consistente
  const plan = activos.planDepreciacion(db, EMP2.id, r.id)
  assert.strictEqual(plan.meses.filter((m) => m.registrado).length, 3)
})

test('período cerrado: preparar lo reporta y confirmar lanza', () => {
  periodos.obtenerOCrear(db, EMP2.id, '202611')
  periodos.cerrar(db, EMP2.id, '202611', adminId)
  const prep = activos.prepararDepreciacion(db, EMP2.id, '202611')
  assert.strictEqual(prep.periodo_cerrado, true)
  assert.throws(() => activos.confirmarDepreciacion(db, { empresaId: EMP2.id, usuarioId: adminId, periodo: '202611' }), /CERRADO/)
})

// ---------- Venta / baja ----------

test('venta con utilidad: limpia costo y depreciación y lleva la diferencia a UTILIDAD_VENTA_ACTIVO', () => {
  const af2 = db.prepare(`SELECT id FROM activos_fijos WHERE empresa_id = ? AND codigo = 'AF-002'`).get(EMP.id)
  const r = activos.registrarVentaBaja(db, {
    empresaId: EMP.id, usuarioId: adminId, activoId: af2.id, tipo: 'VENTA',
    fecha: '2026-11-05', precioVenta: 2500000, cuentaDestinoId: ctaPorAlias(EMP.id, 'BANCOS'),
  })
  assert.strictEqual(r.utilidad_perdida, 200000) // 2.500.000 + 100.000 dep − 2.400.000
  const lineas = lineasDe(r.asiento_id)
  assert.strictEqual(lineas.find((l) => l.alias === 'BANCOS').debe, 2500000)
  assert.strictEqual(lineas.find((l) => l.alias === 'DEPRECIACION_ACUMULADA' && l.debe > 0).debe, 100000)
  assert.strictEqual(lineas.find((l) => l.alias === 'UTILIDAD_VENTA_ACTIVO').haber, 200000)
  assert.strictEqual(lineas.find((l) => l.codigo === '1.2.1.06').haber, 2400000)
  const a = db.prepare(`SELECT estado, asiento_baja_id FROM activos_fijos WHERE id = ?`).get(af2.id)
  assert.strictEqual(a.estado, 'VENDIDO')
  assert.strictEqual(a.asiento_baja_id, r.asiento_id)
  assert.throws(() => activos.registrarVentaBaja(db, {
    empresaId: EMP.id, usuarioId: adminId, activoId: af2.id, tipo: 'VENTA', fecha: '2026-11-06', precioVenta: 1, cuentaDestinoId: 1,
  }), /ya está vendido/)
  // ya no se deprecia
  const prep = activos.prepararDepreciacion(db, EMP.id, '202611')
  assert.ok(!prep.items.some((it) => it.activo_id === af2.id))
})

test('venta con pérdida y aviso de depreciación pendiente del mes', () => {
  const r = activos.confirmarDepreciacion(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202611' }) // AF-001 + AF-ALTA
  assert.strictEqual(r.total, 300000)
  const af1 = db.prepare(`SELECT id FROM activos_fijos WHERE empresa_id = ? AND codigo = 'AF-001'`).get(EMP.id)
  const v = activos.registrarVentaBaja(db, {
    empresaId: EMP.id, usuarioId: adminId, activoId: af1.id, tipo: 'VENTA',
    fecha: '2026-12-01', precioVenta: 11200000, cuentaDestinoId: ctaPorAlias(EMP.id, 'CLIENTES'),
  })
  // 11.200.000 + 500.000 dep (2 meses) − 12.000.000 = −300.000 (pérdida)
  assert.strictEqual(v.utilidad_perdida, -300000)
  const lineas = lineasDe(v.asiento_id)
  assert.strictEqual(lineas.find((l) => l.alias === 'PERDIDA_BAJA_ACTIVO').debe, 300000)
  assert.strictEqual(lineas.find((l) => l.alias === 'CLIENTES').debe, 11200000)
  assert.strictEqual(lineas.find((l) => l.alias === 'DEPRECIACION_ACUMULADA' && l.debe > 0).debe, 500000)
  assert.ok(v.aviso && /pendiente/.test(v.aviso), 'avisa que diciembre no está depreciado')
  const af = db.prepare(`SELECT estado FROM activos_fijos WHERE id = ?`).get(af1.id)
  assert.strictEqual(af.estado, 'VENDIDO')
})

test('baja directa: pérdida por valor libro; BAJA con precio lanza', () => {
  const r = activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-BAJA', descripcion: 'Equipo obsoleto',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.06'),
    fechaAdquisicion: '2026-10-01', valorAdquisicion: 800000, vidaUtilMeses: 12,
  })
  activos.confirmarDepreciacion(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202612' }) // AF-BAJA 66.667 + AF-ALTA 50.000
  const depBaja = db.prepare(`SELECT monto FROM activos_depreciaciones WHERE activo_id = ? AND periodo = '202612'`).get(r.id).monto
  assert.strictEqual(depBaja, 66667)
  assert.throws(() => activos.registrarVentaBaja(db, {
    empresaId: EMP.id, usuarioId: adminId, activoId: r.id, tipo: 'BAJA', fecha: '2026-12-15', precioVenta: 100,
  }), /no lleva precio/)
  const b = activos.registrarVentaBaja(db, {
    empresaId: EMP.id, usuarioId: adminId, activoId: r.id, tipo: 'BAJA', fecha: '2026-12-15',
  })
  assert.strictEqual(b.utilidad_perdida, 800000 - 66667)
  const lineas = lineasDe(b.asiento_id)
  assert.strictEqual(lineas.find((l) => l.alias === 'PERDIDA_BAJA_ACTIVO').debe, 800000 - 66667)
  assert.strictEqual(lineas.reduce((s, l) => s + l.debe, 0), lineas.reduce((s, l) => s + l.haber, 0))
  assert.strictEqual(db.prepare(`SELECT estado FROM activos_fijos WHERE id = ?`).get(r.id).estado, 'BAJA')
})

// ---------- Integración con reportes ----------

test('situación financiera cuadra (A = P + P) con depreciación y ventas operando', () => {
  const s = reportes.situacionFinanciera(db, EMP.id, '202612')
  assert.strictEqual(s.ecuacion.cuadra, true)
  // la depreciación acumulada vive en clase 1 con saldo negativo (contra-activo)
  const depCta = s.activos.find((f) => f.codigo === '1.2.2.01')
  assert.ok(depCta && depCta.saldo < 0)
})

test('balance de 8 columnas: el gasto por depreciación cae en la columna Pérdida y cuadra', () => {
  const b = reportes.balance8Columnas(db, EMP.id, '202610')
  const filaDep = b.filas.find((f) => f.codigo === '6.3.1.01')
  assert.ok(filaDep && filaDep.perdida === 400000)
  assert.strictEqual(b.cuadres.sumas_debe_haber, true)
  assert.strictEqual(b.cuadres.saldos_cuadran, true)
})

test('resumen y listado: KPIs del módulo consistentes con las filas registradas', () => {
  const r = activos.resumen(db, EMP.id)
  const dep = db.prepare(`SELECT COALESCE(SUM(monto), 0) AS t FROM activos_depreciaciones WHERE empresa_id = ?`).get(EMP.id).t
  assert.strictEqual(r.depreciacion_acumulada, dep)
  assert.strictEqual(r.activos, 1) // solo AF-ALTA sigue ACTIVO
  const hist = activos.depreciaciones(db, EMP.id)
  assert.ok(hist.length >= 5 && hist.every((h) => h.folio > 0))
  assert.strictEqual(activos.obtener(db, EMP.id, 999999), null)
})
