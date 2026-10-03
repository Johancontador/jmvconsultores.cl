/**
 * Tests FASE 8 — NIIF: mapeo cuentas → rubros (defaults sembrados + edición
 * auditada), Estado de Situación Financiera NIIF por rubros (PYE neto,
 * SIN_CLASIFICAR reportado y ecuación A = P + PN verificada) y Estado de
 * Resultados NIIF por naturaleza.
 * Ejecutar con: node --test test/fase8.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase8-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const cuentas = require('../backend/core/cuentas')
const asientos = require('../backend/core/asientos')
const activos = require('../backend/core/activos')
const niif = require('../backend/core/niif')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77571234-1', nombre: 'NIIF Test SpA',
  claveSii: 'clave-niif', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77572345-9', nombre: 'Otra NIIF Ltda',
  claveSii: 'clave-niif2', tasaPpm: 0.015, telefono: '912345678',
})

const ctaPorCodigo = (empresaId, codigo) => db.prepare(`SELECT id, rubro_niif FROM cuentas WHERE empresa_id = ? AND codigo = ?`).get(empresaId, codigo)

// ---------- Catálogo y defaults ----------

test('catálogo: claves únicas y secciones válidas', () => {
  const claves = niif.RUBROS_NIIF.map((r) => r.key)
  assert.strictEqual(new Set(claves).size, claves.length)
  for (const r of niif.RUBROS_NIIF) {
    assert.ok(['activo_corriente', 'activo_no_corriente', 'pasivo_corriente', 'pasivo_no_corriente', 'patrimonio', 'resultado'].includes(r.seccion))
  }
  assert.ok(niif.esRubroValido('PYE') && niif.esRubroValido(null) && !niif.esRubroValido('INVENTADO'))
})

test('empresa nueva nace con el mapeo NIIF sembrado por defecto', () => {
  assert.strictEqual(ctaPorCodigo(EMP.id, '1.1.1.02').rubro_niif, 'EFECTIVO_EQUIVALENTES')
  assert.strictEqual(ctaPorCodigo(EMP.id, '1.2.1.04').rubro_niif, 'PYE')
  assert.strictEqual(ctaPorCodigo(EMP.id, '1.2.2.01').rubro_niif, 'PYE') // depreciación acumulada se pliega en PYE
  assert.strictEqual(ctaPorCodigo(EMP.id, '3.1.1.01').rubro_niif, 'CAPITAL_EMITIDO')
  assert.strictEqual(ctaPorCodigo(EMP.id, '4.1.1.02').rubro_niif, 'INGRESOS_ORDINARIOS')
  assert.strictEqual(ctaPorCodigo(EMP.id, '6.3.1.01').rubro_niif, 'DEPRECIACION_AMORTIZACION')
  assert.strictEqual(cuentas.obtener(db, EMP.id, ctaPorCodigo(EMP.id, '1.1.1.02').id).rubro_niif, 'EFECTIVO_EQUIVALENTES')
  const m = niif.mapeo(db, EMP.id)
  assert.strictEqual(m.sin_clasificar, 0)
  assert.ok(m.rubros.length >= 20 && m.cuentas.length > 50)
})

test('cuenta nueva sin rubro queda sin clasificar; asignarMasivo la corrige (auditado)', () => {
  const nueva = cuentas.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: '1.1.2.09', nombre: 'IVA por recuperar' })
  assert.strictEqual(nueva.rubro_niif, null)
  assert.strictEqual(niif.mapeo(db, EMP.id).sin_clasificar, 1)

  assert.throws(() => niif.asignarMasivo(db, {
    empresaId: EMP.id, usuarioId: adminId,
    mapeos: [{ cuenta_id: nueva.id, rubro: 'RUBRO_INVENTADO' }],
  }), /inválido/)
  assert.throws(() => niif.asignarMasivo(db, {
    empresaId: EMP.id, usuarioId: adminId,
    mapeos: [{ cuenta_id: 99999999, rubro: 'OTROS_ACTIVOS_CTES' }],
  }), /no existe/)

  const r = niif.asignarMasivo(db, {
    empresaId: EMP.id, usuarioId: adminId,
    mapeos: [{ cuenta_id: nueva.id, rubro: 'DEUDORES_COMERCIALES' }],
    ip: 'test',
  })
  assert.strictEqual(r.cambios, 1)
  assert.strictEqual(niif.mapeo(db, EMP.id).sin_clasificar, 0)
  const audit = db.prepare(`SELECT accion FROM auditoria WHERE empresa_id = ? AND accion = 'niif.mapeo'`).get(EMP.id)
  assert.ok(audit, 'quedó auditado')

  // sin cambios: mismo rubro no re-audit ni cuenta cambios
  const r2 = niif.asignarMasivo(db, { empresaId: EMP.id, usuarioId: adminId, mapeos: [{ cuenta_id: nueva.id, rubro: 'DEUDORES_COMERCIALES' }] })
  assert.strictEqual(r2.cambios, 0)
})

// ---------- Situación financiera NIIF ----------

test('situación NIIF: PYE neto (dep. acumulada plegada) y A = P + PN cuadrado', () => {
  const r = activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-N1', descripcion: 'Camión reparto',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.04').id,
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 12000000, vidaUtilMeses: 48,
    contabilizarAlta: true, cuentaContraId: ctaPorCodigo(EMP.id, '3.1.1.01').id,
  })
  assert.ok(r.alta)
  activos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, codigo: 'AF-N2', descripcion: 'Equipos oficina',
    cuentaActivoId: ctaPorCodigo(EMP.id, '1.2.1.06').id,
    fechaAdquisicion: '2026-09-01', valorAdquisicion: 2400000, vidaUtilMeses: 24,
    contabilizarAlta: true, cuentaContraId: ctaPorCodigo(EMP.id, '3.1.1.01').id,
  })
  activos.confirmarDepreciacion(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202610' }) // 250.000 + 100.000

  const s = niif.situacionNiif(db, EMP.id, '202610')
  const pye = s.activo_no_corriente.rubros.find((g) => g.rubro === 'PYE')
  assert.ok(pye)
  assert.strictEqual(pye.saldo, 14400000 - 350000) // costo de ambos activos − depreciación
  const capital = s.patrimonio.rubros.find((g) => g.rubro === 'CAPITAL_EMITIDO')
  assert.strictEqual(capital.saldo, 14400000)
  assert.strictEqual(s.patrimonio.resultado_periodo, -350000)
  assert.strictEqual(s.totales.activo, s.totales.pasivo_patrimonio)
  assert.strictEqual(s.ecuacion.cuadra, true)
  assert.strictEqual(s.sin_clasificar, 0)
})

test('cuenta con movimientos y sin rubro: reportada en SIN_CLASIFICAR y la ecuación sigue cuadrando', () => {
  const cuentaLibre = cuentas.crear(db, { empresaId: EMP.id, usuarioId: adminId, codigo: '1.1.3.99', nombre: 'Depósitos judiciales' })
  asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-10-15', glosa: 'Depósito judicial', tipo: 'manual',
    lineas: [
      { cuenta_id: cuentaLibre.id, debe: 500000, haber: 0 },
      { cuenta_id: ctaPorCodigo(EMP.id, '1.1.1.01').id, debe: 0, haber: 500000 },
    ],
  })
  const s = niif.situacionNiif(db, EMP.id, '202610')
  const sinClas = s.activo_corriente.rubros.find((g) => g.rubro === 'SIN_CLASIFICAR')
  assert.ok(sinClas && sinClas.saldo === 500000)
  const efectivo = s.activo_corriente.rubros.find((g) => g.rubro === 'EFECTIVO_EQUIVALENTES')
  assert.strictEqual(efectivo.saldo, -500000)
  assert.strictEqual(s.sin_clasificar, 1)
  assert.strictEqual(s.ecuacion.cuadra, true)
})

// ---------- Resultados NIIF ----------

test('resultados NIIF por naturaleza: depreciación en su rubro y resultado correcto', () => {
  const r = niif.resultadosNiif(db, EMP.id, '202610')
  const dep = r.periodo_mes.gastos.rubros.find((g) => g.rubro === 'DEPRECIACION_AMORTIZACION')
  assert.ok(dep && dep.saldo === 350000)
  assert.strictEqual(r.periodo_mes.ingresos.total, 0)
  assert.strictEqual(r.periodo_mes.resultado, -350000)
  assert.strictEqual(r.acumulado.resultado, -350000)
  assert.strictEqual(r.periodo_mes.sin_clasificar, 0)
})

// ---------- Aislamiento ----------

test('aislamiento: EMP2 no ve cuentas ni saldos de EMP', () => {
  const m = niif.mapeo(db, EMP2.id)
  assert.ok(!m.cuentas.some((c) => c.codigo === '1.1.2.09'))
  const s = niif.situacionNiif(db, EMP2.id, '202610')
  assert.strictEqual(s.totales.activo, 0)
  assert.strictEqual(s.ecuacion.cuadra, true)
  assert.strictEqual(niif.situacionNiif(db, EMP2.id, '202612').totales.activo, 0)
})
