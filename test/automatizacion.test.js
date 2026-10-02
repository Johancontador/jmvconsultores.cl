/**
 * Tests POST-MVP — Automatización: pipeline clasificar → proponer → contabilizar
 * sobre los módulos core existentes (FASE 3 + FASE 4), reglas semilla y
 * estado del período. Ejecutar con: node --test test/automatizacion.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-auto-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const automatizacion = require('../backend/core/automatizacion')
const semilla = require('../backend/core/reglas-semilla')
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
  usuarioId: adminId, rut: '77123456-9', nombre: 'Automatizacion Pipeline SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})

function cuentaPorAlias(empresaId, alias) {
  return db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias).id
}
function docPorFolio(empresaId, folio, flujo) {
  return db.prepare(`SELECT id, estado FROM documentos WHERE empresa_id = ? AND folio = ? AND tipo_flujo = ?`).get(empresaId, String(folio), flujo)
}

// Documentos con el shape exacto que entrega services/rcv.js (consultarRCV)
const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-8', razonSocial: 'Proveedor Pipeline Ltda',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-09-10', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})
const docVenta = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77888888-2', razonSocial: 'Cliente Pipeline SpA',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: '2026-09-15', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})

documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
  documentos: [docCompra(301), docCompra(302, { montoNeto: 50000, montoIVA: 9500, montoTotal: 59500 })],
})
documentos.ingestarBatch(db, {
  empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202609',
  documentos: [docVenta(401), docVenta(402, { tipoDoc: 61, montoNeto: 30000, montoIVA: 5700, montoTotal: 35700, fechaDocto: '2026-09-20' })],
})

// ---------- RBAC ----------
test('permisos: automatizacion:ejecutar para contador y super_admin; NO para admin_empresa/auditor', () => {
  assert.ok(permisosDeRol('contador').has('automatizacion:ejecutar'))
  assert.ok(permisosDeRol('super_admin').has('automatizacion:ejecutar'))
  assert.ok(!permisosDeRol('admin_empresa').has('automatizacion:ejecutar'))
  assert.ok(!permisosDeRol('auditor').has('automatizacion:ejecutar'))
  assert.ok(!permisosDeRol('tesoreria').has('automatizacion:ejecutar'))
})

// ---------- Reglas semilla ----------
test('semilla: se instala en empresa sin reglas, por alias; segunda vez es no-op', () => {
  const r1 = semilla.instalarSiVacia(db, { empresaId: EMP.id, usuarioId: adminId })
  assert.strictEqual(r1.ya_tenia, false)
  assert.strictEqual(r1.instaladas, 3)
  const r2 = semilla.instalarSiVacia(db, { empresaId: EMP.id, usuarioId: adminId })
  assert.strictEqual(r2.ya_tenia, true)
  assert.strictEqual(r2.instaladas, 0)

  const reglas = db.prepare(`SELECT nombre FROM reglas_contables WHERE empresa_id = ? ORDER BY prioridad DESC`).all(EMP.id)
  assert.strictEqual(reglas.length, 3)
  assert.ok(reglas[0].nombre.startsWith('Semilla · NC'))

  const regs = auditoria.consultar(db, { empresaId: EMP.id, limit: 20 })
  assert.ok(regs.some((x) => x.accion === 'reglas.semilla_instalar'))
})

// ---------- Estado antes del pipeline ----------
test('estado: sin resolver > 0, sin propuestas ni ejecución previa', () => {
  const e = automatizacion.estado(db, { empresaId: EMP.id, periodo: '202609' })
  assert.strictEqual(e.periodo, '202609')
  assert.strictEqual(e.periodo_abierto, true)
  assert.strictEqual(e.documentos.PENDIENTE, 4)
  assert.strictEqual(e.sin_resolver, 4)
  assert.strictEqual(e.propuestas_pendientes, 0)
  assert.strictEqual(e.reglas_activas, 3)
  assert.strictEqual(automatizacion.ultimaEjecucion(db, { empresaId: EMP.id, periodo: '202609' }), null)
})

// ---------- Pipeline completo ----------
test('pipeline: clasifica por reglas → propone → contabiliza, con asientos cuadrados y auditado', () => {
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })

  // Clasificación: los 4 calzan (las reglas de venta/compra son catch-all por
  // flujo: la NC de venta 402 entra por la regla de ventas, y la NC de compra
  // 302 por la específica de NC).
  assert.strictEqual(r.evaluados, 4)
  assert.strictEqual(r.clasificados, 4)
  assert.strictEqual(r.sin_regla, 0)
  assert.strictEqual(r.propuestas_nuevas, 4)
  assert.strictEqual(r.propuestas_fallidas.length, 0)
  assert.strictEqual(r.contabilizadas, 4)
  assert.strictEqual(r.omitidas.length, 0)
  assert.ok(r.total_asientos > 0)

  const d301 = docPorFolio(EMP.id, 301, 'compra')
  assert.strictEqual(d301.estado, 'CONTABILIZADO')
  const d402 = docPorFolio(EMP.id, 402, 'venta')
  assert.strictEqual(d402.estado, 'CONTABILIZADO')

  // Asientos cuadrados por documento
  const asientos = db.prepare(`
    SELECT a.id FROM asientos a WHERE a.empresa_id = ? AND a.periodo = '202609'
  `).all(EMP.id)
  assert.strictEqual(asientos.length, 4)
  for (const a of asientos) {
    const debe = db.prepare(`SELECT COALESCE(SUM(debe),0) AS s FROM asiento_lineas WHERE asiento_id = ?`).get(a.id).s
    const haber = db.prepare(`SELECT COALESCE(SUM(haber),0) AS s FROM asiento_lineas WHERE asiento_id = ?`).get(a.id).s
    assert.strictEqual(debe, haber, 'partida doble')
  }

  const regs = auditoria.consultar(db, { empresaId: EMP.id, limit: 100 })
  assert.ok(regs.some((x) => x.accion === 'automatizacion.ejecutar'))
  assert.ok(regs.some((x) => x.accion === 'propuesta.confirmar_lote'))
})

test('ultimaEjecucion: refleja la corrida con resumen y usuario', () => {
  const u = automatizacion.ultimaEjecucion(db, { empresaId: EMP.id, periodo: '202609' })
  assert.ok(u)
  assert.strictEqual(u.usuario, 'admin')
  assert.strictEqual(u.resumen.contabilizadas, 4)
})

test('pipeline re-ejecutado: no duplica nada (idempotente sobre lo ya contabilizado)', () => {
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  // Todo el período quedó CONTABILIZADO: nada que clasificar, proponer ni confirmar.
  assert.strictEqual(r.clasificados, 0)
  assert.strictEqual(r.propuestas_nuevas, 0)
  assert.strictEqual(r.contabilizadas, 0)
  assert.strictEqual(r.omitidas.length, 0)

  const asientos = db.prepare(`SELECT COUNT(*) AS n FROM asientos WHERE empresa_id = ? AND periodo = '202609'`).get(EMP.id).n
  assert.strictEqual(asientos, 4, 'no se duplican asientos')
})

test('pipeline con regla aprendida después: el doc rezagado entra en la 2ª corrida', () => {
  // Nuevo doc ingestado DESPUÉS de la primera corrida (sin regla que lo cubra
  // aún): queda PENDIENTE. Luego se aprende la regla y la 2ª corrida lo lleva
  // hasta contabilizado.
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(305, { tipoDoc: 39, montoNeto: 100000, montoIVA: 0, montoTotal: 100000, rutDoc: '77777777-k', razonSocial: 'Boleta Honorarios Pipeline' })],
  })
  let r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  // La regla semilla de compras (catch-all 33/34/39 por tipo null) SÍ lo cubre:
  // clasifica, propone y contabiliza.
  assert.strictEqual(r.contabilizadas, 1)

  // Caso real del doc rezagado: un doc que la semilla NO cubre. Boleta de
  // honorarios de COMPRA es tipo 39 con IVA 0: cae en catch-all → mismo
  // escenario anterior. Para probar el rezagado, anulamos ese escenario y
  // probamos con REVISIÓN: un doc en REVISIÓN (monto 0) que gana una regla.
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(306, { montoNeto: 0, montoIVA: 0, montoTotal: 0 })],
  })
  const d306 = docPorFolio(EMP.id, 306, 'compra')
  assert.strictEqual(d306.estado, 'REVISION', 'monto 0 → REVISIÓN (§5)')
  r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  // El pipeline reintenta REVISIÓN: la regla calza y lo clasifica, pero la
  // propuesta está en cero → cae en propuestas_fallidas y se reporta.
  assert.strictEqual(r.clasificados, 1)
  assert.strictEqual(r.contabilizadas, 0)
  assert.strictEqual(r.propuestas_fallidas.length, 1)
  assert.ok(/cero/i.test(r.propuestas_fallidas[0].motivo))

  const e = automatizacion.estado(db, { empresaId: EMP.id, periodo: '202609' })
  assert.strictEqual(e.contabilizados, 5)
  assert.strictEqual(e.sin_resolver, 1, 'solo queda el doc 306 en revisión/clasificado')
})

// ---------- Validaciones ----------
test('propuesta descuadrada (datos RCV inconsistentes): doc queda en REVISIÓN y se reporta', () => {
  // Único descuadre aún posible tras absorber exentos/redondeos en la base
  // (base = total − IVA): el RCV trae un total MENOR que el IVA declarado
  // (datos basura) → la base queda en 0 y ΣDebe (IVA) ≠ ΣHaber (total).
  // Los otros inconsistencies (neto+IVA ≠ total, exentos, sin derecho a
  // crédito) ahora CUADRAN por construcción — ver tests del peaje y FL.
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202608',
    documentos: [docCompra(310, { fechaDocto: '2026-08-20', montoNeto: 1000, montoIVA: 5000, montoTotal: 4000 })],
  })
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202608' })
  // Se clasifica por la regla, la propuesta se rechaza (descuadrada) y el doc
  // queda en REVISIÓN con motivo — no en CLASIFICADO silenciosamente.
  assert.strictEqual(r.propuestas_fallidas.length, 1)
  assert.ok(/DESCUADRADA/.test(r.propuestas_fallidas[0].motivo))
  const d = docPorFolio(EMP.id, 310, 'compra')
  assert.strictEqual(d.estado, 'REVISION')

  const regs = auditoria.consultar(db, { empresaId: EMP.id, limit: 60 })
  assert.ok(regs.some((x) => x.accion === 'documento.marcar_revision'))
})

test('fecha_docto formato SII (DD/MM/YYYY): el asiento se fecha con la fecha del documento (devengo)', () => {
  // Formato REAL que entrega el RCV del SII: sin normalizar, la propuesta no
  // reconocía la fecha y el asiento caía fechado HOY (bug encontrado con datos reales).
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202607',
    documentos: [docVenta(450, { fechaDocto: '25/07/2026' })],
  })
  automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202607' })
  const d = docPorFolio(EMP.id, 450, 'venta')
  assert.strictEqual(d.estado, 'CONTABILIZADO')
  const asiento = db.prepare('SELECT fecha, periodo FROM asientos WHERE id = (SELECT asiento_id FROM documentos WHERE id = ?)').get(d.id)
  assert.strictEqual(asiento.fecha, '2026-07-25', 'fecha del documento, no hoy')
  assert.strictEqual(asiento.periodo, '202607')
})

test('corrección contable: revertir asiento → el pipeline re-propone y re-contabiliza (§5)', () => {
  const d = docPorFolio(EMP.id, 450, 'venta')
  const asientoId = db.prepare('SELECT asiento_id FROM documentos WHERE id = ?').get(d.id).asiento_id

  // Revertir el asiento del documento contabilizado
  const asientos = require('../backend/core/asientos')
  asientos.revertir(db, { empresaId: EMP.id, usuarioId: adminId, asientoId, glosa: 'test revert' })

  // El pipeline siguiente lo re-levanta: propuesta nueva con las mismas reglas
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202607' })
  assert.strictEqual(r.propuestas_nuevas, 1)
  assert.strictEqual(r.contabilizadas, 1)

  const doc = documentos.obtener(db, EMP.id, d.id)
  assert.strictEqual(doc.estado, 'CONTABILIZADO')
  assert.notStrictEqual(doc.asiento_id, asientoId, 'apunta al asiento nuevo, no al revertido')
  const nuevo = db.prepare('SELECT fecha FROM asientos WHERE id = ?').get(doc.asiento_id)
  assert.strictEqual(nuevo.fecha, '2026-07-25')
})

test('propuesta con monto exento (peaje real): base = total − IVA, cuadrada con crédito fiscal', () => {
  // Doc real del RCV: peaje casi todo exento (neto 622 + exento 96.757 + IVA 118)
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202608',
    documentos: [docCompra(330, { fechaDocto: '2026-08-05', montoExento: 96757, montoNeto: 622, montoIVA: 118, montoTotal: 97497 })],
  })
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202608' })
  assert.strictEqual(r.contabilizadas, 1, 'el doc exento ahora se contabiliza')
  const d = docPorFolio(EMP.id, 330, 'compra')
  const asientoId330 = db.prepare('SELECT asiento_id FROM documentos WHERE id = ?').get(d.id).asiento_id
  const lineas = db.prepare('SELECT cuenta_id, debe, haber FROM asiento_lineas WHERE asiento_id = ?').all(asientoId330)
  const debe = lineas.reduce((s, l) => s + l.debe, 0)
  const haber = lineas.reduce((s, l) => s + l.haber, 0)
  assert.strictEqual(debe, 97497)
  assert.strictEqual(haber, 97497)
  const ivaCredito = lineas.find((l) => l.cuenta_id === cuentaPorAlias(EMP.id, 'IVA_CREDITO'))
  assert.strictEqual(ivaCredito.debe, 118, 'solo el IVA del documento va a crédito')
})

test('propuesta con impuesto sin derecho a crédito (RCV real): absorbe en la base, IVA recuperable como crédito', () => {
  // Doc real FL COMERCIAL: neto 36.303 + IVA recup. 6.898 + sin derecho 12.973 = total 56.174
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202608',
    documentos: [docCompra(331, { fechaDocto: '2026-08-10', montoNeto: 36303, montoIVA: 6898, montoTotal: 56174 })],
  })
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202608' })
  assert.strictEqual(r.contabilizadas, 1)
  const d = docPorFolio(EMP.id, 331, 'compra')
  const asientoId331 = db.prepare('SELECT asiento_id FROM documentos WHERE id = ?').get(d.id).asiento_id
  const lineas = db.prepare('SELECT cuenta_id, debe, haber FROM asiento_lineas WHERE asiento_id = ?').all(asientoId331)
  const ivaCredito = lineas.find((l) => l.cuenta_id === cuentaPorAlias(EMP.id, 'IVA_CREDITO'))
  assert.strictEqual(ivaCredito.debe, 6898, 'solo el IVA recuperable')
  const gasto = lineas.find((l) => l.cuenta_id === cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'))
  assert.strictEqual(gasto.debe, 56174 - 6898, 'la base absorbe el exento + sin derecho a crédito')
})

test('conciliación: el devengo cruzado de período (doc 31/08 → asiento 202608) NO es divergencia', () => {
  // Doc ingestado en 202609 con fecha 31/08: su asiento cae en el período 202608
  // (devengo correcto). La conciliación de 202609 debe seguir el VÍNCULO
  // asiento_id, no filtrar por período contable (bug encontrado con datos reales).
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(320, { fechaDocto: '2026-08-31' })],
  })
  automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })

  const conciliacion = require('../backend/core/conciliacion')
  const c = conciliacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202609' })
  const delDoc = c.resultado_json ? JSON.parse(c.resultado_json).diferencias.filter((x) => x.folio === '320') : []
  assert.strictEqual(delDoc.length, 0, 'el doc contabilizado con asiento en otro período concilia OK')
})

test('validaciones: período inválido, empresa inexistente y período cerrado', () => {
  assert.throws(() => automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '2026-09' }), /Período inválido/)
  assert.throws(() => automatizacion.ejecutar(db, { empresaId: 999999, usuarioId: adminId, periodo: '202609' }), /Empresa no encontrada/)

  // Cerrar el período: el lote de confirmación omite (y reporta) lo que caiga ahí
  const periodos = require('../backend/core/periodos')
  periodos.obtenerOCrear(db, EMP.id, '202608')
  periodos.cerrar(db, EMP.id, '202608', adminId)
  documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202608',
    documentos: [docCompra(303, { fechaDocto: '2026-08-08' })],
  })
  const r = automatizacion.ejecutar(db, { empresaId: EMP.id, usuarioId: adminId, periodo: '202608' })
  // Se clasifica y propone, pero la confirmación del asiento (fecha 2026-08-08 →
  // período 202608 cerrado) se omite y queda reportada, nunca silenciosa.
  // (El doc 310 del test anterior está en REVISIÓN: el pipeline lo re-intenta;
  // su propuesta vuelve a fallar por descuadre y regresa a REVISIÓN.)
  assert.strictEqual(r.clasificados, 2)
  assert.strictEqual(r.propuestas_nuevas, 1)
  assert.strictEqual(r.propuestas_fallidas.length, 1)
  assert.strictEqual(r.contabilizadas, 0)
  assert.strictEqual(r.omitidas.length, 1)
  assert.ok(/CERRADO/.test(r.omitidas[0].motivo))
})
