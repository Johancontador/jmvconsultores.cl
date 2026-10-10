'use strict'
/**
 * BLOQUE 4 (masterplan) — Aplicaciones de cobro/pago trazables 1↔n.
 *
 * T1 — Setup: banco + 2 facturas de venta contabilizadas.
 * T2 — 1↔n básico: un movimiento de 300 aplica a 2 facturas (200 + 100);
 *      trazabilidad en teso_aplicaciones, cada factura con su saldo.
 * T3 — Anti-ambigüedad: EXCEDE el monto del movimiento → rechazo WITHOUT
 *      dejar aplicaciones a medias (transacción).
 * T4 — Anti-ambigüedad doc: un documento no recibe más que su total.
 * T5 — Coherencia de mano: un COBRO no aplica a una factura de compra.
 * T6 — Idempotencia y acumulación por par (movimiento, documento).
 * T7 — Docs no contabilizados rechazados.
 *
 * Ejecutar con: node --test test/teso-aplicaciones.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-apl-${Date.now()}-${process.pid}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const asientos = require('../backend/core/asientos')
const tesoreria = require('../backend/core/tesoreria')
const cobranza = require('../backend/core/cobranza')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ================= Setup de empresa + cuenta de bastidor =================

let empresaId, bancoId, clientesCtaId, proveedoresCtaId
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id

test.before(() => {
  // clave_sii vacía es válida (opcional en el modelo)
  const e = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, activo) VALUES ('77111111-2', 'Empresa Aplicaciones SpA', '', 1)`).run()
  empresaId = Number(e.lastInsertRowid)
  // Plan de cuentas de la plantilla (CLIENTES, PROVEEDORES, IVA_DEBITO, ...)
  require('../backend/core/migraciones').seedPlanCuentas(db, empresaId)
  const bancoCta = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'BANCO'`).get(empresaId)
    || db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND clase = 1 AND es_resumen = 0 LIMIT 1`).get(empresaId)
  bancoId = tesoreria.crearBanco(db, {
    empresaId, usuarioId: adminId, banco: 'Banco de Prueba', numero: '001',
    cuentaContableId: bancoCta.id,
    saldoInicial: 0,
  })
  clientesCtaId = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'CLIENTES'`).get(empresaId)?.id
  proveedoresCtaId = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'PROVEEDORES'`).get(empresaId)?.id
})

/** Crea una factura contabilizada de venta (o compra) y devuelve su id. */
function crearFactura(n, flujo = 'venta') {
  const fecha = `2025-09-${String(10 + n).padStart(2, '0')}`
  const contraparte = flujo === 'venta' ? clientesCtaId : proveedoresCtaId
  const bancoCta = db.prepare(`SELECT cuenta_contable_id FROM bancos_cuentas WHERE id = ?`).get(bancoId).cuenta_contable_id
  // incluir IVA de crédito/débito de alias estándar si hay; si no, solo contraparte (aceptable para el test)
  const a = asientos.crear(db, {
    empresaId, usuarioId: adminId, fecha,
    glosa: `#${flujo} ${n}`,
    tipo: 'manual',
    lineas: flujo === 'venta'
      ? [
          { cuenta_id: contraparte, debe: 1000 * n, haber: 0, glosa: 'CXC' },
          { cuenta_id: bancoCta, debe: 0, haber: 1000 * n, glosa: 'VENTA' },
        ]
      : [
          { cuenta_id: contraparte, debe: 0, haber: 1000 * n, glosa: 'CXP' },
          { cuenta_id: bancoCta, debe: 1000 * n, haber: 0, glosa: 'COMPRA' },
        ],
    origen: null,
  })
  const d = db.prepare(`
    INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, fecha_docto, rut_contraparte,
      razon_social, monto_neto, monto_iva, monto_total, estado, asiento_id, periodo_ingesta, clave_dedupe)
    VALUES (?, ?, 33, ?, ?, ?, 'Cliente X', ?, 0, ?, 'CONTABILIZADO', ?, '202509', ?)
  `).run(empresaId, flujo, `V${1000 + n}`, fecha, '76123456-3', 1000 * n, 1000 * n, a.id, `dedupe-${flujo}-${n}`)
  return Number(d.lastInsertRowid)
}

let v1, v2, v3, c1
test.before(() => {
  v1 = crearFactura(1, 'venta')   // 1000
  v2 = crearFactura(2, 'venta')   // 2000
  v3 = crearFactura(3, 'venta')   // 3000
  c1 = crearFactura(4, 'compra')  // 4000
})

// ================= T2: 1↔n trazable =================

test('T2: 1 movimiento → 2 facturas con montos parciales trazables', () => {
  // Registrar el COBRO de 300 directo en tesorería (sin documento único)
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-01', monto: 300, glosa: 'Transferencia agrupada',
    documentoId: null, ip: null,
  })
  // Aplicar: 200 a v1 + 100 a v2
  const a = cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v1, monto: 200 }, { documento_id: v2, monto: 100 }],
  })
  assert.strictEqual(a.ok, true)
  assert.strictEqual(a.aplicado_total, 300)
  assert.strictEqual(a.pendiente_movimiento, 0, 'el movimiento queda con 0 pendiente')

  // Trazabilidad por documento
  assert.strictEqual(cobranza.cobradoDeDocumento(db, v1), 200)
  assert.strictEqual(cobranza.cobradoDeDocumento(db, v2), 100)
  // la fila en teso_aplicaciones está ligada al movimiento
  const traz = db.prepare(`
    SELECT a.movimiento_id, a.documento_id, a.monto FROM teso_aplicaciones a
    WHERE a.movimiento_id = ? ORDER BY a.documento_id
  `).all(r.movimientoId)
  assert.strictEqual(traz.length, 2)
  assert.deepStrictEqual(traz.map((t) => [t.documento_id, t.monto]),
    [[v1, 200], [v2, 100]])
})

// ================= T3: anti-ambigüedad del movimiento =================

test('T3: rechaza si la ronda excede el monto del movimiento — sin aplicarlo a medias', () => {
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-02', monto: 500, glosa: 'Abono parcial',
  })
  // Intento: 400 + 200 = 600 > 500 → ROMPE, y NO aplica nada (transacción)
  assert.throws(() => cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v1, monto: 400 }, { documento_id: v3, monto: 200 }],
  }), /no alcanza/)
  // nada aplicado en esta ronda
  assert.strictEqual(cobranza.aplicadoDeMovimiento(db, r.movimientoId), 0)
  assert.strictEqual(cobranza.cobradoDeDocumento(db, v1), 200, 'v1 tampoco cambió (transacción completa)')
})

// ================= T4: anti-ambigüedad del documento =================

test('T4: un documento no recibe más que su total', () => {
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-03', monto: 2000, glosa: 'Cobro v2 completo',
  })
  // v2 ya tiene 100; su total es 2000
  assert.throws(() => cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v2, monto: 1901 }], // 100 + 1901 = 2001 > 2000
  }), /excede su total/)
  // la carta válida: aplicar 1900 (justo de 2000)
  const ok = cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v2, monto: 1900 }],
  })
  assert.strictEqual(ok.ok, true)
  assert.strictEqual(cobranza.cobradoDeDocumento(db, v2), 2000, 'v2 saldado (1↔n parcial + aplicación final)')
})

// ================= T5: coherencia de mano =================

test('T5: un COBRO no aplica a una factura de compra (mano opuesta)', () => {
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-04', monto: 1000, glosa: 'GLOSACOBRO-T5',
  })
  assert.throws(() => cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: c1, monto: 500 }],
  }), /un COBRO solo aplica a ventas/)
})

// ================= T6: acumulación idempotente por par =================

test('T6: re-aplicar al mismo par SUMA (acumulación explícita, no duplica fila)', () => {
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-05', monto: 300, glosa: 'T6 abonos parciales v3',
  })
  cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v3, monto: 100 }],
  })
  cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: v3, monto: 200 }],
  })
  // UNA sola fila con monto acumulado 300
  const filas = db.prepare(`SELECT monto FROM teso_aplicaciones WHERE movimiento_id = ? AND documento_id = ?`).all(r.movimientoId, v3)
  assert.strictEqual(filas.length, 1, 'no duplica el par (UPsert)')
  assert.strictEqual(filas[0].monto, 300)
  assert.strictEqual(cobranza.cobradoDeDocumento(db, v3), 300)
})

// ================= T7: documentos no contabilizados =================

test('T7: rechaza aplicar a un documento pendiente (no contabilizado)', () => {
  // documento sin asiento
  const d = db.prepare(`
    INSERT INTO documentos (empresa_id, tipo_flujo, tipo_doc, folio, fecha_docto, rut_contraparte,
      razon_social, monto_neto, monto_iva, monto_total, estado, asiento_id, periodo_ingesta, clave_dedupe)
    VALUES (?, 'venta', 33, 'F9999', '2025-10-20', '76543210-3', 'Cliente X', 500, 0, 500, 'PENDIENTE', NULL, '202510', 'dedupe-pendiente')
  `).run(empresaId)
  const id = Number(d.lastInsertRowid)
  const r = tesoreria.registrarPagoCobro(db, {
    empresaId, usuarioId: adminId, bancoCuentaId: bancoId,
    tipo: 'COBRO', fecha: '2025-10-21', monto: 500, glosa: 'Abono contra pendiente',
  })
  assert.throws(() => cobranza.aplicarMovimientoADocumentos(db, {
    empresaId, usuarioId: adminId, movimientoId: r.movimientoId,
    aplicaciones: [{ documento_id: id, monto: 500 }],
  }), /solo se aplican a documentos CONTABILIZADOS/)
})
