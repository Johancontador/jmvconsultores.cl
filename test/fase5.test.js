/**
 * Tests FASE 5 — Reportes financieros (§8) y cierre de período (§7).
 *  - Balance de comprobación (acumulado + mes) con ΣD = ΣC verificado.
 *  - Situación financiera con ecuación A = P + Patrimonio verificada
 *    (pre y post cierre de resultado).
 *  - Estado de resultados del mes y acumulado.
 *  - Cierre: propuesta de asientos (IVA → F29, PPM devengado, resultado → RE),
 *    ejecución atómica, snapshot, bloqueo del núcleo y período siguiente limpio.
 * Ejecutar con: node --test test/fase5.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase5-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const propuestas = require('../backend/core/propuestas')
const conciliacion = require('../backend/core/conciliacion')
const asientos = require('../backend/core/asientos')
const reportes = require('../backend/core/reportes')
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
  usuarioId: adminId, rut: '77555555-6', nombre: 'Reportes Test SpA',
  claveSii: 'clave-test', tasaPpm: 0.01, telefono: '912345678', // PPM 1%
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '77666666-1', nombre: 'Otra Empresa F5 Ltda',
  claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
})

function cuentaPorAlias(empresaId, alias) {
  return db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias).id
}
function docPorFolio(empresaId, folio, flujo) {
  return db.prepare(`SELECT id, estado FROM documentos WHERE empresa_id = ? AND folio = ? AND tipo_flujo = ?`).get(empresaId, String(folio), flujo)
}
const docVenta = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-6', razonSocial: 'Cliente Uno Ltda',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: '2026-11-15', fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})
const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '76888888-5', razonSocial: 'Proveedor Uno SpA',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-10-10', fechaReclamo: '', montos: {}, detalleSII: {},
  ...extras,
})

/** Clasifica + propone + confirma un documento (camino feliz FASE 3+4). */
function contabilizar(empresaId, folio, flujo, aliasCuenta, fechaDocto = null) {
  const d = docPorFolio(empresaId, folio, flujo)
  documentos.clasificar(db, {
    empresaId, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(empresaId, aliasCuenta), tratamientoIva: 'credito',
  })
  propuestas.generar(db, { empresaId, usuarioId: adminId, documentoId: d.id })
  const pid = db.prepare(`SELECT id FROM propuestas WHERE documento_id = ? AND estado = 'PENDIENTE'`).get(d.id).id
  return propuestas.confirmar(db, { empresaId, usuarioId: adminId, propuestaId: pid, fecha: fechaDocto })
}

// Ingesta 202610: venta 301 y compras 401 (oct) + 402 (sep)
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202610',
  documentos: [docVenta(301, { montoNeto: 500000, montoIVA: 95000, montoTotal: 595000, fechaDocto: '2026-10-15' })],
})
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202610',
  documentos: [docCompra(401)],
})
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
  documentos: [docCompra(402, { montoNeto: 50000, montoIVA: 9500, montoTotal: 59500, fechaDocto: '2026-09-20' })],
})

contabilizar(EMP.id, 301, 'venta', 'VENTAS_SERVICIOS')        // 2026-10-15
contabilizar(EMP.id, 401, 'compra', 'GASTO_ARRIENDO')         // 2026-10-10
contabilizar(EMP.id, 402, 'compra', 'GASTO_ARRIENDO', '2026-09-20') // período 202609

// ---------- RBAC ----------

test('permisos: contador cierra períodos y ve reportes; auditor/tesorería solo ven', () => {
  const contador = permisosDeRol('contador')
  assert.ok(contador.has('reportes:ver') && contador.has('periodos:cerrar'))
  for (const rol of ['auditor', 'tesoreria', 'admin_empresa']) {
    const p = permisosDeRol(rol)
    assert.ok(p.has('reportes:ver'), `${rol} ve reportes`)
    assert.ok(!p.has('periodos:cerrar'), `${rol} NO cierra períodos`)
  }
})

// ---------- Balance de comprobación (§8) ----------

test('balance de comprobación: acumulado y del mes, ΣD = ΣC verificado, aislamiento', () => {
  const b = reportes.balanceComprobacion(db, EMP.id, '202610')

  // Acumulado hasta octubre: incluye también la compra de septiembre (402)
  assert.strictEqual(b.acumulado.cuadra, true)
  const acc = new Map(b.acumulado.filas.map((f) => [f.codigo, f]))
  assert.strictEqual(acc.get('1.1.2.01').saldo, 595000, 'CLIENTES deudor')
  assert.strictEqual(acc.get('4.1.1.02').saldo, 500000, 'VENTAS acreedor')
  assert.strictEqual(acc.get('6.1.2.01').saldo, 150000, 'GASTO_ARRIENDO 100k oct + 50k sep')
  assert.strictEqual(acc.get('2.1.1.01').saldo, 178500, 'PROVEEDORES acreedor')
  assert.strictEqual(b.acumulado.debe, b.acumulado.haber)
  assert.ok(b.acumulado.debe > 0)

  // Solo movimientos de octubre: excluye 402 (septiembre)
  assert.strictEqual(b.periodo_mes.cuadra, true)
  const mes = new Map(b.periodo_mes.filas.map((f) => [f.codigo, f]))
  assert.strictEqual(mes.get('6.1.2.01').saldo, 100000)
  assert.strictEqual(mes.get('1.1.3.02').saldo, 19000, 'IVA crédito solo de 401')

  // Otra empresa: cero filas (y cuadra 0 = 0)
  const b2 = reportes.balanceComprobacion(db, EMP2.id, '202610')
  assert.strictEqual(b2.acumulado.filas.length, 0)
  assert.strictEqual(b2.acumulado.cuadra, true)
})

// ---------- Situación financiera (§8) ----------

test('situación financiera: A = P + Patrimonio (con resultado acumulado sin cierre)', () => {
  const s = reportes.situacionFinanciera(db, EMP.id, '202610')
  assert.strictEqual(s.ecuacion.cuadra, true, 'A = P + Pat')
  assert.strictEqual(s.ecuacion.diferencia, 0)
  assert.strictEqual(s.totales.activos, 623500, 'CLIENTES 595000 + IVA_CREDITO 28500')
  assert.strictEqual(s.totales.pasivos, 273500, 'PROVEEDORES 178500 + IVA_DEBITO 95000')
  assert.strictEqual(s.resultados.resultado, 350000, '500000 ingresos − 150000 gastos')
  assert.strictEqual(s.totales.patrimonio, 350000, 'sin cuentas 3 con saldo + resultado del período')
})

// ---------- Estado de resultados (§8) ----------

test('estado de resultados: del mes y acumulado del año', () => {
  const r = reportes.estadoResultados(db, EMP.id, '202610')
  assert.strictEqual(r.periodo_mes.resultado, 400000, 'mes: 500000 ingresos − 100000 gasto 401')
  assert.ok(r.periodo_mes.detalle.ingresos.some((x) => x.codigo === '4.1.1.02'))
  assert.ok(r.periodo_mes.detalle.gastos.some((x) => x.codigo === '6.1.2.01'))
  assert.strictEqual(r.acumulado.resultado, 350000, 'acumulado: 500000 − 150000 (incluye gasto sep 402)')

  // Septiembre: solo la compra 402 → pérdida del mes, acumulado idem
  const r9 = reportes.estadoResultados(db, EMP.id, '202609')
  assert.strictEqual(r9.periodo_mes.resultado, -50000)
  assert.strictEqual(r9.acumulado.resultado, -50000)
})

// ---------- Cierre de período (§7): propuesta ----------

test('prepararCierre: checklist, conciliación visible y asientos PROPUESTOS cuadrados', () => {
  conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202610' })

  const prep = reportes.prepararCierre(db, EMP.id, '202610')
  assert.strictEqual(prep.puede_cerrar, true, 'todos los documentos contabilizados')
  assert.strictEqual(prep.checklist.documentos_pendientes, 0)
  assert.strictEqual(prep.checklist.conciliacion_ejecutada, true)

  const claves = prep.cierres_propuestos.map((c) => c.clave)
  assert.ok(claves.includes('IVA_F29'))
  assert.ok(claves.includes('PPM'))
  assert.ok(claves.includes('RESULTADO'))

  // IVA_F29: débito 95000 al debe, crédito 19000 al haber, F29 por 76000
  const iva = prep.cierres_propuestos.find((c) => c.clave === 'IVA_F29')
  const porCta = new Map(iva.lineas.map((l) => [l.cuenta_id, l]))
  assert.strictEqual(porCta.get(cuentaPorAlias(EMP.id, 'IVA_DEBITO')).debe, 95000)
  assert.strictEqual(porCta.get(cuentaPorAlias(EMP.id, 'IVA_CREDITO')).haber, 19000)
  assert.strictEqual(porCta.get(cuentaPorAlias(EMP.id, 'F29_POR_PAGAR')).haber, 76000)

  // PPM: 1% de ingresos netos del período (500000) = 5000
  const ppm = prep.cierres_propuestos.find((c) => c.clave === 'PPM')
  assert.strictEqual(ppm.referencia.ppm_devengado, 5000)
  const ppmCta = new Map(ppm.lineas.map((l) => [l.cuenta_id, l]))
  assert.strictEqual(ppmCta.get(cuentaPorAlias(EMP.id, 'GASTO_PPM')).debe, 5000)
  assert.strictEqual(ppmCta.get(cuentaPorAlias(EMP.id, 'PPM_POR_PAGAR')).haber, 5000)

  // RESULTADO: cierra el ACUMULADO hasta el último día del período:
  // RE al haber por 345000 (500000 − 150000 gastos − 5000 PPM devengado);
  // contra: ventas al debe 500000, gasto arriendo al haber 150000 (incluye el
  // gasto de sep, doc 402) y GASTO_PPM al haber 5000 (devengo virtual)
  const res = prep.cierres_propuestos.find((c) => c.clave === 'RESULTADO')
  assert.strictEqual(res.referencia.resultado, 345000)
  assert.strictEqual(prep.resultado_mes.resultado, 400000, 'resultado del mes como referencia')
  const resCta = new Map(res.lineas.map((l) => [l.cuenta_id, l]))
  assert.strictEqual(resCta.get(cuentaPorAlias(EMP.id, 'RESULTADO_EJERCICIO')).haber, 345000)
  assert.strictEqual(resCta.get(cuentaPorAlias(EMP.id, 'VENTAS_SERVICIOS')).debe, 500000)
  assert.strictEqual(resCta.get(cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO')).haber, 150000)
  assert.strictEqual(resCta.get(cuentaPorAlias(EMP.id, 'GASTO_PPM')).haber, 5000)

  // Cada asiento propuesto cuadra (defensa estructural)
  for (const c of prep.cierres_propuestos) {
    const d = c.lineas.reduce((s, l) => s + (l.debe || 0), 0)
    const h = c.lineas.reduce((s, l) => s + (l.haber || 0), 0)
    assert.strictEqual(d, h, `${c.clave} cuadra`)
  }
})

// ---------- Cierre de período (§7): ejecución ----------

test('ejecutarCierre: asientos tipo cierre fechados en el período, snapshot, y núcleo bloquea', () => {
  const r = reportes.ejecutarCierre(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202610' })
  assert.strictEqual(r.asientos_cierre.length, 3)
  const porClave = new Map(r.asientos_cierre.map((a) => [a.clave, a]))
  assert.strictEqual(porClave.get('IVA_F29').total, 95000)
  assert.strictEqual(porClave.get('PPM').total, 5000)
  assert.strictEqual(porClave.get('RESULTADO').total, 500000, 'ventas 500000 al debe (RE y gastos al haber)')

  // Todos fechados en el último día del período cerrado
  const cierres = asientos.diario(db, { empresaId: EMP.id, periodo: '202610', limit: 500 })
    .asientos.filter((a) => a.tipo === 'cierre')
  assert.strictEqual(cierres.length, 3)
  assert.ok(cierres.every((a) => a.fecha === '2026-10-31'), 'asiento de cierre dentro del período')

  // El período quedó CERRADO con snapshot consultable
  const p = db.prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = '202610'`).get(EMP.id)
  assert.strictEqual(p.estado, 'CERRADO')
  const snap = reportes.obtenerCierre(db, EMP.id, '202610')
  assert.strictEqual(snap.asientos.length, 3)
  assert.strictEqual(snap.forzado, false)

  // El núcleo rechaza cualquier mutación en el período cerrado
  assert.throws(() => asientos.crear(db, {
    empresaId: EMP.id, usuarioId: adminId, fecha: '2026-10-20', glosa: 'tardío', tipo: 'manual',
    lineas: [
      { cuenta_id: cuentaPorAlias(EMP.id, 'CAJA'), debe: 1000, haber: 0 },
      { cuenta_id: cuentaPorAlias(EMP.id, 'BANCOS'), debe: 0, haber: 1000 },
    ],
  }), /CERRADO/)

  // Re-cerrar rechazado
  assert.throws(() => reportes.prepararCierre(db, EMP.id, '202610'), /ya está CERRADO/)
})

test('post-cierre: el resultado queda en patrimonio (RE) y A = P + Pat sigue cuadrando; 202611 sin arrastre', () => {
  const s = reportes.situacionFinanciera(db, EMP.id, '202610')
  assert.strictEqual(s.ecuacion.cuadra, true, 'ecuación post cierre')
  assert.strictEqual(s.resultados.resultado, 0, 'clases 4/5/6 cerradas a cero')
  assert.strictEqual(s.totales.patrimonio, 345000, 'RE absorbe 345000 (500000 − 150000 − 5000 PPM)')
  assert.strictEqual(s.totales.activos, 604500, 'CLIENTES 595000 + IVA_CREDITO remanente 9500 (sep)')
  assert.strictEqual(s.totales.pasivos, 259500, 'PROVEEDORES 178500 + F29 76000 + PPM 5000')

  // Noviembre: el MES está limpio (sin arrastre de las contra-partidas del cierre)
  const b11 = reportes.balanceComprobacion(db, EMP.id, '202611')
  assert.strictEqual(b11.periodo_mes.filas.length, 0)
  assert.strictEqual(b11.periodo_mes.cuadra, true)

  const s11 = reportes.situacionFinanciera(db, EMP.id, '202611')
  assert.strictEqual(s11.resultados.resultado, 0, 'sin ingresos/gastos en noviembre')
  assert.strictEqual(s11.totales.patrimonio, 345000, 'RE acumulado en patrimonio')
  assert.strictEqual(s11.ecuacion.cuadra, true)

  // La auditoría registra el cierre
  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 60 })
  assert.ok(registros.some((x) => x.accion === 'periodo.cerrar'))
})

test('cierre con documentos pendientes: bloqueado por defecto; claves parciales y forzado auditable', () => {
  // 202611: una venta contabilizada y una compra que queda PENDIENTE
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202611',
    documentos: [docVenta(502)],
  })
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202611',
    documentos: [docCompra(501, { fechaDocto: '2026-11-05' })],
  })
  contabilizar(EMP.id, 502, 'venta', 'VENTAS_SERVICIOS')

  const prep = reportes.prepararCierre(db, EMP.id, '202611')
  assert.strictEqual(prep.puede_cerrar, false)
  assert.strictEqual(prep.checklist.documentos_pendientes, 1)
  assert.strictEqual(prep.checklist.documentos_por_estado.PENDIENTE, 1)

  assert.throws(
    () => reportes.ejecutarCierre(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202611' }),
    /forzar/
  )
  // Clave inexistente rechazada (con forzar, para llegar a la validación de claves)
  assert.throws(
    () => reportes.ejecutarCierre(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202611', claves: ['NO_EXISTE'], forzar: true }),
    /No hay asiento de cierre propuesto/
  )

  // Cierre PARCIAL forzado: solo PPM (200000 × 1% = 2000), decisión humana auditada
  const r = reportes.ejecutarCierre(db, {
    empresaId: EMP.id, usuarioId: adminId, periodo: '202611', claves: ['PPM'], forzar: true,
  })
  assert.strictEqual(r.asientos_cierre.length, 1)
  assert.strictEqual(r.asientos_cierre[0].clave, 'PPM')
  assert.strictEqual(r.asientos_cierre[0].total, 2000)

  const p = db.prepare(`SELECT * FROM periodos_contables WHERE empresa_id = ? AND periodo = '202611'`).get(EMP.id)
  assert.strictEqual(p.estado, 'CERRADO')
  assert.strictEqual(reportes.obtenerCierre(db, EMP.id, '202611').forzado, true)
  // El doc pendiente NO fue tocado por el cierre
  assert.strictEqual(docPorFolio(EMP.id, 501, 'compra').estado, 'PENDIENTE')

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 80 })
  const cierre = registros.find((x) => x.accion === 'periodo.cerrar' && x.entidad_id === '202611')
  assert.ok(cierre, 'cierre de 202611 auditado')
})

test('prepararCierre: período sin movimientos rechazado; validación de formato', () => {
  assert.throws(() => reportes.prepararCierre(db, EMP.id, '202612'), /no existe/)
  assert.throws(() => reportes.balanceComprobacion(db, EMP.id, 'septiembre'), /inválido|esperado/)
})
