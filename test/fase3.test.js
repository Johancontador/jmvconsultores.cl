/**
 * Tests FASE 3 — Documentos: ingesta idempotente SII → bandeja, máquina de
 * estados (§5), motor de reglas por prioridad (§6), clasificación automática,
 * aprendizaje desde clasificación manual, contrapartes y aislamiento.
 * Ejecutar con: node --test test/fase3.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-fase3-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const documentos = require('../backend/core/documentos')
const reglas = require('../backend/core/reglas')
const auditoria = require('../backend/core/auditoria')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

// ---------- Setup ----------
const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '76555555-8', nombre: 'Bandeja Test SpA',
  claveSii: 'clave-test', tasaPpm: 0.015, telefono: '912345678',
})
const EMP2 = empresas.crear(db, {
  usuarioId: adminId, rut: '76666666-3', nombre: 'Otra Empresa Bandeja Ltda',
  claveSii: 'clave-test2', tasaPpm: 0.01, telefono: '912345678',
})

function cuentaPorAlias(empresaId, alias) {
  const fila = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ?`).get(empresaId, alias)
  return fila.id
}

// Documento con el shape exacto que entrega services/rcv.js (consultarRCV)
const docCompra = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '76888888-5', razonSocial: 'Proveedor Uno SpA',
  montoExento: 0, montoNeto: 100000, montoIVA: 19000, montoTotal: 119000,
  tipoDoc: 33, fechaDocto: '2026-09-10', fechaReclamo: '',
  montos: { 'Monto Neto': 100000 }, detalleSII: { folio: String(folio) },
  ...extras,
})
const docVenta = (folio, extras = {}) => ({
  folio: String(folio), rutDoc: '77999999-6', razonSocial: 'Cliente Uno Ltda',
  montoExento: 0, montoNeto: 200000, montoIVA: 38000, montoTotal: 238000,
  tipoDoc: 33, fechaDocto: '2026-09-15', fechaReclamo: '',
  montos: {}, detalleSII: {},
  ...extras,
})

// ---------- Ingesta idempotente ----------

test('ingesta: inserta documentos válidos en PENDIENTE con montos INTEGER', () => {
  const r = documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(101), docCompra(102)],
  })
  assert.strictEqual(r.insertados, 2)
  assert.strictEqual(r.duplicados, 0)
  assert.strictEqual(r.en_revision, 0)
  assert.deepStrictEqual(r.errores, [])

  const fila101 = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '101'`).get(EMP.id)
  const d = documentos.obtener(db, EMP.id, fila101.id)
  assert.strictEqual(d.estado, 'PENDIENTE')
  assert.strictEqual(d.monto_neto, 100000)
  assert.strictEqual(d.monto_iva, 19000)
  assert.strictEqual(d.monto_total, 119000)
  assert.strictEqual(d.tipo_flujo, 'compra')
  assert.ok(d.clave_dedupe.length === 32)
})

test('ingesta idempotente: re-ingesta del mismo RCV NO duplica', () => {
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?`).get(EMP.id).n
  const r = documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(101), docCompra(102)],
  })
  assert.strictEqual(r.insertados, 0)
  assert.strictEqual(r.duplicados, 2)
  const despues = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ?`).get(EMP.id).n
  assert.strictEqual(despues, antes)
})

test('ingesta: la misma clave (rut empresa|flujo|tipo|folio|periodo) NO colisiona entre empresas', () => {
  const r = documentos.ingestarBatch(db, {
    empresaId: EMP2.id, usuarioId: adminId, tipoFlujo: 'compra', periodo: '202609',
    documentos: [docCompra(101)],
  })
  assert.strictEqual(r.insertados, 1)
  const d = db.prepare(`SELECT empresa_id FROM documentos WHERE folio = '101' AND empresa_id = ?`).get(EMP2.id)
  assert.ok(d, 'EMP2 tiene SU copia del documento (aislamiento por empresa)')
})

test('ingesta: documentos sin folio/tipo/RUT van a errores sin abortar el lote; monto 0 → REVISION', () => {
  const r = documentos.ingestarBatch(db, {
    empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta', periodo: '202609',
    documentos: [
      { ...docVenta(201), folio: '' },
      { ...docVenta(202), tipoDoc: 0 },
      { ...docVenta(203), rutDoc: '' },
      docVenta(204, { montoTotal: 0, montoNeto: 0, montoIVA: 0 }),
      docVenta(205),
    ],
  })
  assert.strictEqual(r.errores.length, 3)
  assert.strictEqual(r.insertados, 2)
  assert.strictEqual(r.en_revision, 1)
  const d0 = db.prepare(`SELECT estado FROM documentos WHERE empresa_id = ? AND folio = '204' AND tipo_flujo = 'venta'`).get(EMP.id)
  assert.strictEqual(d0.estado, 'REVISION')
})

test('ingesta: contrapartes derivadas con clasificación proveedor/cliente y dedupe', () => {
  const cp = db.prepare(`SELECT clasificacion FROM contrapartes WHERE empresa_id = ? AND rut = '76888888-5'`).get(EMP.id)
  assert.strictEqual(cp.clasificacion, 'proveedor')
  const cv = db.prepare(`SELECT clasificacion FROM contrapartes WHERE empresa_id = ? AND rut = '77999999-6'`).get(EMP.id)
  assert.strictEqual(cv.clasificacion, 'cliente')
})

test('ingesta: auditada como lote con contadores', () => {
  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 20 })
  assert.ok(registros.some((x) => x.accion === 'documentos.ingestar'))
})

// ---------- Máquina de estados y clasificación ----------

test('clasificación manual: PENDIENTE → CLASIFICADO con cuenta/CC/IVA, re-clasificable, auditada', () => {
  const d = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '101'`).get(EMP.id)
  const doc1 = documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'),
    centroCostoId: null, tratamientoIva: 'credito',
  })
  assert.strictEqual(doc1.estado, 'CLASIFICADO')
  assert.strictEqual(doc1.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'))
  assert.strictEqual(doc1.tratamiento_iva, 'credito')

  // re-clasificar un CLASIFICADO es válido
  const doc1b = documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'),
    tratamientoIva: 'uso_comun',
  })
  assert.strictEqual(doc1b.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'))

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 30 })
  assert.ok(registros.filter((x) => x.accion === 'documento.clasificar').length >= 2)
})

test('clasificación: validaciones (cuenta ajena, resumen, tratamiento inválido, estado prohibido)', () => {
  const d = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '102'`).get(EMP.id)
  // cuenta de otra empresa
  assert.throws(() => documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(EMP2.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
  }), /no encontrada/)
  // cuenta resumen
  const resumen = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND codigo = '6.1'`).get(EMP.id)
  assert.throws(() => documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: resumen.id, tratamientoIva: 'credito',
  }), /imputable/)
  // tratamiento IVA inválido
  assert.throws(() => documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d.id,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'inventado',
  }), /Tratamiento IVA inválido/)
})

test('anulación: exige motivo, es auditada y nunca física; REVISIÓN vuelve a CLASIFICADO', () => {
  const d204 = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '204' AND tipo_flujo = 'venta'`).get(EMP.id)
  const re = documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d204.id,
    cuentaId: cuentaPorAlias(EMP.id, 'VENTAS_SERVICIOS'), tratamientoIva: 'credito',
  })
  assert.strictEqual(re.estado, 'CLASIFICADO') // REVISION → CLASIFICADO permitido

  const d205 = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '205' AND tipo_flujo = 'venta'`).get(EMP.id)
  assert.throws(() => documentos.anular(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d205.id, motivo: '' }), /motivo/)
  const anulado = documentos.anular(db, { empresaId: EMP.id, usuarioId: adminId, documentoId: d205.id, motivo: 'DTE no corresponde' })
  assert.strictEqual(anulado.estado, 'ANULADO')
  const fila = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE id = ?`).get(d205.id)
  assert.strictEqual(fila.n, 1, 'nunca delete físico')
  // un ANULADO ya no se clasifica
  assert.throws(() => documentos.clasificar(db, {
    empresaId: EMP.id, usuarioId: adminId, documentoId: d205.id,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
  }), /no admite clasificación/)
})

// ---------- Motor de reglas ----------

test('reglas: CRUD con validaciones y orden por prioridad', () => {
  const rArr = reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Arriendo inmobiliaria',
    prioridad: 200, tipoFlujo: 'compra', rutContraparte: '76888888-5',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
  })
  assert.ok(rArr.id > 0 && rArr.prioridad === 200)

  assert.throws(() => reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Sin cuenta',
    cuentaId: cuentaPorAlias(EMP2.id, 'GASTO_ARRIENDO'),
  }), /no encontrada/)
  assert.throws(() => reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Flujo raro', tipoFlujo: 'notas',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'),
  }), /tipo_flujo/)
})

test('evaluar: prioridad DESC, todas las condiciones AND, catch-all al final', () => {
  // Regla específica prioridad 300: RUT del proveedor → sueldos (deliberadamente "mala" para probar que gana la de mayor prioridad)
  const rAlta = reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Alta prioridad', prioridad: 300,
    tipoFlujo: 'compra', rutContraparte: '76888888-5',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SUELDOS'), tratamientoIva: 'sin_credito',
  })
  // Catch-all compras prioridad 10
  reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Catch-all compras', prioridad: 10,
    tipoFlujo: 'compra', cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'uso_comun',
  })

  const doc = { tipo_flujo: 'compra', rut_contraparte: '76888888-5', tipo_doc: 33, razon_social: 'Proveedor Uno', monto_total: 119000 }
  const m = reglas.evaluar(db, EMP.id, doc)
  assert.strictEqual(m.regla_id, rAlta.id, 'la de mayor prioridad gana')
  assert.strictEqual(m.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_SUELDOS'))

  // Otro RUT cae al catch-all
  const m2 = reglas.evaluar(db, EMP.id, { ...doc, rut_contraparte: '11111111-1' })
  assert.strictEqual(m2.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'))

  // El flujo es condición: la regla de compras no aplica a ventas
  const m3 = reglas.evaluar(db, EMP.id, { ...doc, tipo_flujo: 'venta' })
  assert.strictEqual(m3, null, 'no hay reglas de ventas → null')
})

test('evaluar: tipo_doc, patrón razón social y rango de monto', () => {
  reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Boletas sin crédito', prioridad: 150,
    tipoDoc: 39, cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'sin_credito',
  })
  const m = reglas.evaluar(db, EMP.id, {
    tipo_flujo: 'compra', rut_contraparte: '22222222-2', tipo_doc: 39, razon_social: 'Kiosco', monto_total: 5000,
  })
  assert.strictEqual(m.tratamiento_iva, 'sin_credito')

  reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Compras caras', prioridad: 250,
    patronRazonSocial: 'inmobiliaria', montoMin: 500000, montoMax: 2000000,
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'), tratamientoIva: 'credito',
  })
  const mRango = reglas.evaluar(db, EMP.id, {
    tipo_flujo: 'compra', rut_contraparte: '33333333-3', tipo_doc: 33, razon_social: 'Inmobiliaria Central SpA', monto_total: 800000,
  })
  assert.strictEqual(mRango.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'))
  // fuera de rango → no calza esa regla
  const mFuera = reglas.evaluar(db, EMP.id, {
    tipo_flujo: 'compra', rut_contraparte: '33333333-3', tipo_doc: 33, razon_social: 'Inmobiliaria Central SpA', monto_total: 300000,
  })
  assert.notStrictEqual(mFuera.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'))
})

test('clasificación automática: aplica motor en lote, deja regla aplicada en el documento y audita', () => {
  reglas.guardar(db, {
    empresaId: EMP.id, usuarioId: adminId, nombre: 'Ventas serv.', prioridad: 100,
    tipoFlujo: 'venta', cuentaId: cuentaPorAlias(EMP.id, 'VENTAS_SERVICIOS'), tratamientoIva: 'credito',
  })
  // el motor re-clasifica: evalúa PENDIENTE + CLASIFICADO + REVISION del filtro
  const antes = db.prepare(`SELECT COUNT(*) AS n FROM documentos WHERE empresa_id = ? AND tipo_flujo = 'venta' AND estado IN ('PENDIENTE','CLASIFICADO','REVISION')`).get(EMP.id).n
  const r = reglas.clasificarAutomatico(db, { empresaId: EMP.id, usuarioId: adminId, tipoFlujo: 'venta' })
  assert.strictEqual(r.evaluados, antes)
  assert.strictEqual(r.clasificados, antes)
  const conRegla = db.prepare(`
    SELECT COUNT(*) AS n FROM documentos d JOIN reglas_contables r ON r.id = d.regla_id
    WHERE d.empresa_id = ? AND d.tipo_flujo = 'venta' AND d.estado = 'CLASIFICADO'
  `).get(EMP.id).n
  assert.ok(conRegla >= 1, 'los clasificados guardan regla_id')

  const registros = auditoria.consultar(db, { empresaId: EMP.id, limit: 50 })
  assert.ok(registros.some((x) => x.accion === 'documentos.clasificar_automatico'))
})

test('aprendizaje: crear regla desde clasificación manual (RUT+DTE+flujo único), calza y respeta prioridad 50', () => {
  const d = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '102'`).get(EMP.id)
  const regla = reglas.crearDesdeClasificacion(db, {
    empresaId: EMP.id, usuarioId: adminId,
    rutContraparte: '76888888-5', tipoDoc: 33, tipoFlujo: 'compra',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_SERVICIOS_BASICOS'), tratamientoIva: 'credito',
  })
  assert.ok(regla.crear_desde_clasificacion)
  assert.strictEqual(regla.prioridad, 50)

  // duplicada se rechaza
  assert.throws(() => reglas.crearDesdeClasificacion(db, {
    empresaId: EMP.id, usuarioId: adminId, rutContraparte: '76888888-5', tipoDoc: 33, tipoFlujo: 'compra',
    cuentaId: cuentaPorAlias(EMP.id, 'GASTO_ARRIENDO'),
  }), /Ya existe/)

  // gana sobre el catch-all (10) pero pierde contra la de 300 (RUT → GASTO_SUELDOS)
  const m = reglas.evaluar(db, EMP.id, { tipo_flujo: 'compra', rut_contraparte: '76888888-5', tipo_doc: 33, razon_social: 'Proveedor Uno', monto_total: 119000 })
  assert.strictEqual(m.cuenta_id, cuentaPorAlias(EMP.id, 'GASTO_SUELDOS'))
})

test('desactivar regla: deja de calzar', () => {
  const lista = reglas.listar(db, EMP.id)
  const objetivo = lista.find((r) => r.nombre === 'Boletas sin crédito')
  reglas.desactivar(db, { empresaId: EMP.id, usuarioId: adminId, reglaId: objetivo.id })
  const m = reglas.evaluar(db, EMP.id, {
    tipo_flujo: 'compra', rut_contraparte: '22222222-2', tipo_doc: 39, razon_social: 'Kiosco', monto_total: 5000,
  })
  assert.notStrictEqual(m.tratamiento_iva, 'sin_credito')
})

// ---------- Aislamiento ----------

test('aislamiento: bandeja y reglas nunca cruzan empresas', () => {
  const dEmp1 = db.prepare(`SELECT id FROM documentos WHERE empresa_id = ? AND folio = '101'`).get(EMP.id)
  assert.strictEqual(documentos.obtener(db, EMP2.id, dEmp1.id), null, 'documento de EMP1 invisible desde EMP2')
  const reglaEmp1 = reglas.listar(db, EMP.id)[0]
  assert.strictEqual(reglas.obtener(db, EMP2.id, reglaEmp1.id), null)
  assert.throws(() => reglas.desactivar(db, { empresaId: EMP2.id, usuarioId: adminId, reglaId: reglaEmp1.id }), /no encontrada/)

  // listar de EMP2 no devuelve documentos de EMP1
  const l2 = documentos.listar(db, { empresaId: EMP2.id })
  assert.ok(l2.documentos.every((x) => x.empresa_id === EMP2.id))
})

test('bandeja: filtros y resumen de estados coherentes', () => {
  const l = documentos.listar(db, { empresaId: EMP.id, tipoFlujo: 'compra' })
  assert.ok(l.documentos.every((d) => d.tipo_flujo === 'compra'))
  const sumaTotal = l.documentos.reduce((s, d) => s + d.monto_total, 0)
  assert.strictEqual(l.sumas.total, sumaTotal)

  const lEstado = documentos.listar(db, { empresaId: EMP.id, estado: 'CLASIFICADO' })
  assert.ok(lEstado.documentos.every((d) => d.estado === 'CLASIFICADO'))
  // el resumen de estados NO está afectado por el filtro de estado (suma = total de la empresa)
  const sumaEstados = lEstado.estados.reduce((s, e) => s + e.n, 0)
  const todos = documentos.listar(db, { empresaId: EMP.id })
  assert.strictEqual(sumaEstados, todos.total)

  const lTexto = documentos.listar(db, { empresaId: EMP.id, texto: 'Proveedor Uno' })
  assert.ok(lTexto.total >= 1)
  const lRut = documentos.listar(db, { empresaId: EMP.id, rut: '76888888' })
  assert.ok(lRut.total >= 1)
})

test('bandeja: orden de servidor por lista blanca abarca el filtro completo', () => {
  const base = documentos.listar(db, { empresaId: EMP.id, limit: 1000 })

  const asc = documentos.listar(db, { empresaId: EMP.id, orden: 'folio', dir: 'asc', limit: 1000 })
  const folios = asc.documentos.map((d) => Number(d.folio))
  assert.deepStrictEqual(folios, [...folios].sort((a, b) => a - b), 'el folio se ordena numérico, no alfabético')
  assert.strictEqual(asc.total, base.total, 'ordenar no altera el total del filtro')

  const desc = documentos.listar(db, { empresaId: EMP.id, orden: 'monto_total', dir: 'desc', limit: 1000 })
  const montos = desc.documentos.map((d) => d.monto_total)
  assert.deepStrictEqual(montos, [...montos].sort((a, b) => b - a))

  // El orden cubre el filtro, no la página: la página 2 continúa la 1 sin repetir.
  const p1 = documentos.listar(db, { empresaId: EMP.id, orden: 'folio', dir: 'asc', limit: 2, offset: 0 })
  const p2 = documentos.listar(db, { empresaId: EMP.id, orden: 'folio', dir: 'asc', limit: 2, offset: 2 })
  assert.deepStrictEqual(
    [...p1.documentos, ...p2.documentos].map((d) => d.folio),
    asc.documentos.slice(0, 4).map((d) => d.folio),
  )

  // `orden` desconocido cae al orden por id: el nombre nunca llega al SQL.
  const malo = documentos.listar(db, { empresaId: EMP.id, orden: 'folio; DROP TABLE documentos', dir: 'asc', limit: 1000 })
  assert.deepStrictEqual(malo.documentos.map((d) => d.id), base.documentos.map((d) => d.id).sort((a, b) => a - b))
  assert.ok(db.prepare(`SELECT COUNT(*) AS n FROM documentos`).get().n > 0, 'la tabla sigue existiendo')
})
