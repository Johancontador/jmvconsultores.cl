/**
 * Tests FASE 4 — Automatización: propuestas desde documentos clasificados,
 * contabilización (individual y en lote) con transición §5 a CONTABILIZADO,
 * y conciliación SII ↔ contable con diferencias tipificadas (§9).
 * Ejecutar con: node --test test/fase4.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase4-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const propuestas = require('../backend/core/propuestas')
const conciliacion = require('../backend/core/conciliacion')
const asientos = require('../backend/core/asientos')
const periodos = require('../backend/core/periodos')
const reglas = require('../backend/core/reglas')
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
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76555555-8', nombre: 'Automatizacion Test SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '76666666-3', nombre: 'Otra Empresa F4 Ltda',
  claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
})

function cuentaPorAlias(empresaId, alias) {
  return db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias).id
}
function docPorFolio(empresaId, folio, flujo) {
  return db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = ? AND tipo_flujo = ?`).get(empresaId, String(folio), flujo)
}

// Documento con el shape exacto que entrega services/rcv.js (consultarRCV)
const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '76888888-5', razonSocial: 'Proveedor Uno SpA',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-09-10', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})
const docVenta = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-6', razonSocial: 'Cliente Uno Ltda',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: '2026-09-15', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})

// Ingesta: compras 101..108 y venta 201, período 202609
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
  documentos: [
    docCompra(101), docCompra(102), docCompra(103), docCompra(104, { fechaDocto: '2026-08-05' }),
    docCompra(105), docCompra(106, { montoNeto: 30000, montoIVA: 5700, montoTotal: 35700 }),
    docCompra(107, { tipoDoc: 61, montoNeto: 50000, montoIVA: 9500, montoTotal: 59500 }), // NC de compra
    docCompra(108),
  ],
})
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202609',
  documentos: [docVenta(201)],
})

// ---------- RBAC ----------

test('permisos: contador genera/confirma; auditor y tesorería solo leen', () => {
  const contador = permisosDeRol('contador')
  assert.ok(contador.has('propuestas:generar') && contador.has('propuestas:confirmar') && contador.has('conciliacion:ejecutar'))
  const lector = permisosDeRol('auditor')
  assert.ok(lector.has('propuestas:ver') && lector.has('conciliacion:ver'))
  assert.ok(!lector.has('propuestas:confirmar') && !lector.has('conciliacion:ejecutar'))
})

// ---------- Generación de propuestas ----------

test('generar: rechaza estados sin clasificación, sin cuenta, y audita', () => {
  const d = docPorFolio(EMP.id, 101, 'compra')
  assert.throws(() => propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id }), /no admite generar propuesta/)

  documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
  })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  assert.strictEqual(p.estado, 'PENDIENTE')
  assert.strictEqual(p.doc_estado, 'PROPUESTO')

  // re-generar sobre PROPUESTO es re-propuesta válida (no error); PENDIENTE viva se reemplaza
  const p2 = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  assert.ok(p2.id > p.id)
  const vivas = db.prepare(`SELECT COUNT(*) AS n FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(d.id).n
  assert.strictEqual(vivas, 1)

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 30 })
  assert.ok(registros.some((x) => x.accion === 'propuesta.crear'))
})

test('propuesta de compra con IVA: neto+IVA al debe, contraparte al haber, cuadrada (§6)', () => {
  const d = docPorFolio(EMP.id, 101, 'compra')
  const p = propuestas.obtener(db, EMP.id, db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado='PENDIENTE'`).get(d.id).id)
  const { lineas, debe, haber } = propuestas.validarLineasSnapshot(db, EMP.id, p.lineas_json)
  assert.strictEqual(debe, haber)
  assert.strictEqual(debe, 119000)
  assert.strictEqual(lineas.length, 3)
  const porCuenta = new Map(lineas.map((l) => [l.cuenta_id, l]))
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO')).debe, 100000)
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'IVA_CREDITO')).debe, 19000)
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'PROVEEDORES')).haber, 119000)
})

test('precedencia contraparte: regla > contraparte recordada > alias de control', () => {
  // (A) alias: doc 102 sin regla ni recordada → PROVEEDORES
  const d102 = docPorFolio(EMP.id, 102, 'compra')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d102.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'credito' })
  let p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d102.id })
  assert.strictEqual(p.contraparte_codigo, '2.1.1.01', 'alias PROVEEDORES')

  // (B) recordada: contraparte con cuenta BANCOS gana sobre el alias
  db.prepare(`UPDATE contrapartes SET cuenta_id = ? WHERE empresa_id = ? AND rut = '76888888-5'`).run(cuentaPorAlias(EMP.id, 'BANCOS'), EMP.id)
  p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d102.id })
  assert.strictEqual(p.contraparte_codigo, '1.1.1.02', 'clasificación recordada')

  // (C) regla: cuenta_contraparte_id explícita gana sobre la recordada.
  // La clasificación del doc debe quedar ATADA a la regla (regla_id) para que
  // resolverContraparte la preceda sobre la contraparte recordada (§6).
  const d103 = docPorFolio(EMP.id, 103, 'compra')
  const reglaC = reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Regla con contraparte', prioridad: 500,
    tipoFlujo: 'compra', rutContraparte: '76888888-5',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
    cuentaContraparteId: cuentaPorAlias(EMP.id, 'CLIENTES'),
  })
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d103.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito', reglaId: reglaC.id })
  p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d103.id })
  assert.strictEqual(p.contraparte_codigo, '1.1.2.01', 'la regla manda')
  db.prepare(`UPDATE contrapartes SET cuenta_id = NULL WHERE empresa_id = ? AND rut = '76888888-5'`).run(EMP.id)
})

test('re-clasificación + re-propuesta: la propuesta anterior queda DESCARTADA', () => {
  const d = docPorFolio(EMP.id, 101, 'compra')
  const antes = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(d.id).id
  // El doc está PROPUESTO: clasificar exige CLASIFICADO, así que primero se
  // descarta la propuesta viva (el doc vuelve a CLASIFICADO) y recién entonces
  // se re-clasifica y re-propone.
  propuestas.descartar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: antes, motivo: 're-clasificación' })
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'credito' })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  assert.notStrictEqual(p.id, antes)
  const vieja = db.prepare(`SELECT estado FROM propuestas WHERE id = ?`).get(antes)
  assert.strictEqual(vieja.estado, 'DESCARTADA')
  assert.strictEqual(p.cuenta_codigo, '6.1.2.02')
})

// ---------- Contabilización (confirmación) ----------

test('confirmar: PROPUESTO → CONTABILIZADO con asiento cuadrado folio 1, propuesta APLICADA', () => {
  const d = docPorFolio(EMP.id, 101, 'compra')
  const p = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(d.id).id
  const r = propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: p })

  assert.strictEqual(r.propuesta.estado, 'APLICADA')
  assert.strictEqual(r.propuesta.doc_estado, 'CONTABILIZADO')
  assert.strictEqual(r.asiento.folio, 1)
  assert.strictEqual(r.asiento.anio, 2026)
  assert.strictEqual(r.asiento.tipo, 'automatico')
  assert.strictEqual(r.asiento.fecha, '2026-09-10', 'se fecha con fecha_docto del documento')
  const total = r.asiento.lineas.reduce((s, l) => s + l.debe, 0)
  assert.strictEqual(total, 119000)
  assert.strictEqual(r.asiento.lineas.reduce((s, l) => s + l.haber, 0), total, 'partida doble')

  const doc = documentos.obtener(db, EMP.id, d.id)
  assert.strictEqual(doc.estado, 'CONTABILIZADO')
  assert.strictEqual(doc.asiento_id, r.asiento.id)

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 40 })
  assert.ok(registros.some((x) => x.accion === 'propuesta.confirmar'))
  assert.ok(registros.some((x) => x.accion === 'asiento.crear'))

  // doble confirmación rechazada
  assert.throws(() => propuestas.confirmar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: p }), /solo PENDIENTE/)
})

test('confirmar: rechaza propuesta de otra empresa (aislamiento)', () => {
  const d = docPorFolio(EMP.id, 102, 'compra')
  const p = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(d.id).id
  assert.strictEqual(propuestas.obtener(db, EMP2.id, p), null)
  assert.throws(() => propuestas.confirmar(db, { empresaId: EMP2.id, usuarioId: adminId, propuestaId: p }), /no encontrada/)
})

test('NC de compra (tipo 61): patas invertidas conservando ΣD = ΣH (§6)', () => {
  const d = docPorFolio(EMP.id, 107, 'compra')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito' })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  const { lineas, debe, haber } = propuestas.validarLineasSnapshot(db, EMP.id, p.lineas_json)
  assert.strictEqual(debe, haber)
  assert.strictEqual(debe, 59500)
  const porCuenta = new Map(lineas.map((l) => [l.cuenta_id, l]))
  const contra = porCuenta.get(Number(p.cuenta_contraparte_id))
  assert.ok(contra && contra.debe === 59500, 'NC: contraparte al debe')
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO')).haber, 50000, 'NC: gasto al haber')
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'IVA_CREDITO')).haber, 9500, 'NC: IVA al haber')
})

test('venta con IVA: clientes al debe, ventas+IVA débito al haber', () => {
  const d = docPorFolio(EMP.id, 201, 'venta')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id, cuentaId: cuentaPorAlias(EMP.id, 'VENTAS_SERVICIOS'), tratamientoIva: 'credito' })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  const { lineas, debe, haber } = propuestas.validarLineasSnapshot(db, EMP.id, p.lineas_json)
  assert.strictEqual(debe, haber)
  assert.strictEqual(debe, 238000)
  const porCuenta = new Map(lineas.map((l) => [l.cuenta_id, l]))
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'CLIENTES')).debe, 238000)
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'VENTAS_SERVICIOS')).haber, 200000)
  assert.strictEqual(porCuenta.get(cuentaPorAlias(EMP.id, 'IVA_DEBITO')).haber, 38000)
})

test('confirmarLote: aplica todo el período; un período cerrado se omite y se reporta', () => {
  // Doc 104 (fecha 2026-08-05): clasificado y propuesto, pero su asiento caerá
  // en el período 202608 que cerramos a continuación → el lote lo omite.
  const d104 = docPorFolio(EMP.id, 104, 'compra')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d104.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito' })
  propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d104.id })
  const d105 = docPorFolio(EMP.id, 105, 'compra')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d105.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'credito' })
  propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d105.id })
  // 102, 103, 107 y 201 ya tienen propuesta PENDIENTE de tests anteriores

  // Cerrar 202608: el doc 104 (fecha 2026-08-05) no podrá contabilizarse
  periodos.obtenerOCrear(db, EMP.id, '202608')
  periodos.cerrar(db, EMP.id, '202608', adminId)

  const r = propuestas.confirmarLote(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  assert.strictEqual(r.aplicadas, 5, '102, 103, 105, 107 y 201')
  assert.strictEqual(r.omitidos.length, 1, 'solo 104 (período 202608 cerrado)')
  assert.match(r.omitidos[0].motivo, /CERRADO/)

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 60 })
  assert.ok(registros.some((x) => x.accion === 'propuesta.confirmar_lote'))

  // Tras el lote, el diario del período cuadra a $0 en partida doble
  const diario = asientos.diario(db, { empresaId: EMP.id, periodo: '202609', limit: 500 })
  let debeTotal = 0, haberTotal = 0
  for (const a of diario.asientos) {
    for (const l of a.lineas) { debeTotal += l.debe; haberTotal += l.haber }
  }
  assert.strictEqual(debeTotal, haberTotal)
  assert.ok(debeTotal > 0)
})

test('descartar: propuesta PENDIENTE → DESCARTADA y documento vuelve a CLASIFICADO', () => {
  const d = docPorFolio(EMP.id, 108, 'compra')
  documentos.clasificar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito' })
  const p = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  const res = propuestas.descartar(db, { empresaId: EMP.id, usuarioId: adminId, propuestaId: p.id, motivo: 'revisar clasificación' })
  assert.strictEqual(res.estado, 'DESCARTADA')
  const doc = documentos.obtener(db, EMP.id, d.id)
  assert.strictEqual(doc.estado, 'CLASIFICADO')
  // y puede re-proponerse
  const p2 = propuestas.generar(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d.id })
  assert.strictEqual(p2.estado, 'PENDIENTE')
})

// ---------- Conciliación SII ↔ contable ----------

test('conciliación: SOLO_SII para lo no contabilizado; totales coherentes con la bandeja', () => {
  const r = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  // Contabilizados: 101, 102, 103, 105, 107, 201 (y 104 omitido, 108 PENDIENTE propuesta, 109? no)
  const soloSii = r.diferencias.filter((d) => d.tipo === 'SOLO_SII')
  assert.ok(soloSii.length >= 2, '104 (propuesto) y 108 (clasificado) siguen sin asiento')
  assert.ok(soloSii.every((d) => ['PROPUESTO', 'CLASIFICADO', 'PENDIENTE', 'REVISION'].includes(d.estado)))

  const sumas = conciliacion.sumasBandeja(db, EMP.id, '202609')
  assert.strictEqual(r.totales.tributario.neto, sumas.tributario.neto)
  assert.strictEqual(r.totales.tributario.iva, sumas.tributario.iva)
  assert.strictEqual(r.totales.tributario.docs, 9)
  assert.strictEqual(r.totales.cuadre_contable, true, 'todo asiento del núcleo cuadra')
  assert.ok(r.conteo_diferencias.SOLO_SII >= 2)
})

test('conciliación: los asientos manuales (sin documento) son ajustes, no diferencias', () => {
  asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-30', glosa: 'Centralización sueldos septiembre',
    tipo: 'manual',
    lineas: [
      { cuenta_id: cuentaPorAlias(EMP.id, 'GASTO_SUELDOS'), debe: 5000000, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'REMUNERACIONES_POR_PAGAR'), debe: 0, haber: 5000000 },
    ],
  })
  const r = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  assert.ok(r.ajustes_sin_documento.length >= 1, 'el asiento manual figura como ajuste')
  assert.ok(!r.diferencias.some((d) => d.tipo === 'SOLO_CONTABLE'), 'los ajustes no son diferencias (§9)')
  assert.strictEqual(r.totales.cuadre_contable, true)
})

test('conciliación: detecta MONTO_DIVERGENTE e IMPUESTO_DIVERGENTE en contabilizaciones ajenas al motor', () => {
  // Simulación de una contabilización manual divergente (como podría quedar de
  // un proceso externo): asiento balanceado pero con montos ≠ documento.
  const d = docPorFolio(EMP.id, 106, 'compra') // neto 30000, iva 5700, total 35700
  const a = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-11', glosa: 'Registro manual doc 106 (divergente)',
    tipo: 'ajuste',
    lineas: [
      { cuenta_id: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), debe: 25000, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'IVA_CREDITO'), debe: 5700, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'PROVEEDORES'), debe: 0, haber: 30700 },
    ],
  })
  db.prepare(`UPDATE documentos SET estado = 'CONTABILIZADO', asiento_id = ? WHERE id = ?`).run(a.id, d.id)

  const r = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  assert.ok(r.diferencias.some((d) => d.tipo === 'MONTO_DIVERGENTE' && d.detalle.includes('35700')), 'Σdebe 30700 ≠ total doc 35700')
  const imp = r.diferencias.filter((x) => x.tipo === 'IMPUESTO_DIVERGENTE')
  assert.strictEqual(imp.length, 0, 'el IVA crédito del asiento (5700) sí coincide con el doc')
  // Ahora una variante con IVA mal registrado
  const d2 = docPorFolio(EMP.id, 106, 'compra')
  const a2 = asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-09-11', glosa: 'Registro manual doc 106 IVA mal',
    tipo: 'ajuste',
    lineas: [
      { cuenta_id: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), debe: 30000, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'IVA_CREDITO'), debe: 4000, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'PROVEEDORES'), debe: 0, haber: 34000 },
    ],
  })
  db.prepare(`UPDATE documentos SET asiento_id = ? WHERE id = ?`).run(a2.id, d2.id)
  const r2 = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  assert.ok(r2.diferencias.some((x) => x.tipo === 'IMPUESTO_DIVERGENTE' && x.iva_contable === 4000 && x.iva_sii === 5700))
})

test('conciliación: contra resumen SII — cuadra con la bandeja, marca diferencia si no', () => {
  const sumas = conciliacion.sumasBandeja(db, EMP.id, '202609')
  const buenResumen = { neto: sumas.tributario.neto, iva: sumas.tributario.iva, total: sumas.tributario.total }
  const r = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609', siiResumen: buenResumen })
  assert.strictEqual(r.totales.contra_sii.cuadra, true)

  const r2 = conciliacion.ejecutar(db, {
    empresaId: EMP.id, usuarioId: adminId, periodo: '202609',
    siiResumen: { neto: buenResumen.neto + 1000, iva: buenResumen.iva, total: buenResumen.total + 1000 },
  })
  assert.strictEqual(r2.totales.contra_sii.cuadra, false)
  assert.strictEqual(r2.totales.contra_sii.neto_dif, -1000)
})

test('conciliación: persiste resultado por empresa+período y es re-ejecutable; período inválido rechazado', () => {
  const c = conciliacion.obtener(db, EMP.id, '202609')
  assert.ok(c && c.resultado.periodo === '202609')
  assert.ok(Array.isArray(c.resultado.diferencias))
  const lista = conciliacion.listar(db, EMP.id)
  assert.ok(lista.some((x) => x.periodo === '202609'))

  // Filtro por período (lo usa la campana): 0 o 1 fila y sin el 404 del detalle.
  const delPeriodo = conciliacion.listar(db, EMP.id, 50, '202609')
  assert.strictEqual(delPeriodo.length, 1)
  assert.strictEqual(delPeriodo[0].periodo, '202609')
  assert.ok(Number(delPeriodo[0].diferencias) >= 0, 'el conteo es numérico')
  assert.deepStrictEqual(conciliacion.listar(db, EMP.id, 50, '202501'), [])

  assert.throws(() => conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: 'septiembre' }), /Período inválido/)

  // aislamiento: EMP2 no ve la conciliación de EMP
  assert.strictEqual(conciliacion.obtener(db, EMP2.id, '202609'), null)
})
