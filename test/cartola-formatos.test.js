/**
 * Tests FASE 9.2 — CONECTORES DE CARTOLAS BANCARIAS POR FORMATO:
 * archivo CSV/Excel del portal del banco → filas {fecha ISO, monto firmado,
 * glosa} → importarCartola de FASE 6 sin cambios (dedupe idempotente).
 *  - montos chilenos ($ con miles, decimales con coma, cargo contable en paréntesis)
 *  - detección por encabezado y estadística; mapeo manual guardado por banco
 *  - formato no reconocido NO inventa nada (filas vacías + mapeo manual en UI)
 * Ejecutar con: node --test test/cartola-formatos.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-cartola-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const teso = require('../backend/core/tesoreria')
const formatos = require('../backend/core/tesoreria-cartola-formatos')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

const adminId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
const EMP = empresas.crear(db, {
  usuarioId: adminId, rut: '77591234-0', nombre: 'Cartolas Test SpA',
  claveSii: 'clave-cart', tasaPpm: 0.015, telefono: '912345678',
})
const ctaBanco = db.prepare(`SELECT id FROM cuentas WHERE empresa_id = ? AND alias = 'BANCOS'`).get(EMP.id).id
const bancoId = teso.crearBanco(db, {
  empresaId: EMP.id, usuarioId: adminId, banco: 'Banco de Prueba', numero: '001-999',
  cuentaContableId: ctaBanco, saldoInicial: 1000000,
})

const base64 = (s) => Buffer.from(s, 'utf8').toString('base64')

// ---------- Normalizadores ----------

test('montos chilenos: $ con miles, coma decimal, paréntesis contable, números', () => {
  assert.strictEqual(formatos.parsearMonto('$1.234.567'), 1234567)
  assert.strictEqual(formatos.parsearMonto('-$56.789'), -56789)
  assert.strictEqual(formatos.parsearMonto('1.234.567-'), -1234567)
  assert.strictEqual(formatos.parsearMonto('1.234,56'), 1235)
  assert.strictEqual(formatos.parsearMonto('(2.500)'), -2500)
  assert.strictEqual(formatos.parsearMonto('1234.56'), 1235)
  assert.strictEqual(formatos.parsearMonto(45678), 45678)
  assert.strictEqual(formatos.parsearMonto(''), null)
  assert.strictEqual(formatos.parsearMonto('abc'), null)
  assert.strictEqual(formatos.parsearMonto('1.234'), 1234, 'punto con 3 dígitos = miles')
})

test('fechas: ISO, DD/MM/YYYY, DD-MM-YY, Date y serial de Excel', () => {
  assert.strictEqual(formatos.parsearFecha('2026-10-05'), '2026-10-05')
  assert.strictEqual(formatos.parsearFecha('05/10/2026'), '2026-10-05')
  assert.strictEqual(formatos.parsearFecha('5-10-26'), '2026-10-05')
  assert.strictEqual(formatos.parsearFecha(new Date(Date.UTC(2026, 9, 5))), '2026-10-05')
  assert.strictEqual(formatos.parsearFecha('46100'), '2026-03-19', 'serial de Excel')
  assert.strictEqual(formatos.parsearFecha('31/02/2026'), null)
  assert.strictEqual(formatos.parsearFecha(''), null)
})

test('CSV con comillas y separador ; parsea celdas con coma dentro', () => {
  assert.deepStrictEqual(
    formatos.parsearLineaCSV('"05/10/2026";"TRASPASO, FONDO";"1.500.000";', ';'),
    ['05/10/2026', 'TRASPASO, FONDO', '1.500.000', '']
  )
})

// ---------- Detección por encabezado ----------

test('CSV BancoEstado-like con encabezado Fecha;Glosa;Monto → detecta y parsea', async () => {
  const csv = [
    'Fecha;Glosa;Monto',
    '05/10/2026;TRANSFERENCIA RECIBIDA CLIENTE X;1.500.000',
    '06/10/2026;PAGO PROVEEDOR Y;-$380.000',
    '07/10/2026;COMISION BANCARIA;-$2.990',
  ].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'cartola.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(r.tipo_archivo, 'csv')
  assert.strictEqual(r.formato_detectado.fuente, 'encabezado')
  assert.strictEqual(r.filas_detectadas, 3)
  assert.deepStrictEqual(r.filas[0], { fecha: '2026-10-05', monto: 1500000, glosa: 'TRANSFERENCIA RECIBIDA CLIENTE X' })
  assert.strictEqual(r.filas[1].monto, -380000)
  assert.strictEqual(r.filas[2].monto, -2990)
})

test('CSV con CARGO y ABONO separados → monto firmado = abono − cargo', async () => {
  const csv = [
    'Fecha;Detalle;Cargo;Abono;Saldo',
    '2026-10-05;DEP CHEQUE;0;700.000;1.700.000',
    '2026-10-06;COBRO SERVICIO;4.500;0;1.695.500',
  ].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'cartola.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(r.formato_detectado.fuente, 'encabezado')
  assert.strictEqual(r.filas.length, 2)
  assert.strictEqual(r.filas[0].monto, 700000)
  assert.strictEqual(r.filas[1].monto, -4500, 'el saldo queda fuera (mapeo por nombres, no por estadística)')
})

// ---------- Detección estadística (sin encabezado reconocible) ----------

test('CSV sin encabezado: detección estadística por estructura de columnas', async () => {
  const csv = [
    '05/10/2026;ABONO NOMINA;1500000',
    '06/10/2026;DEBITO AUTO;-25.000',
    '07/10/2026;TRANSFERENCIA;890000',
    '08/10/2026;CAFETERIA;-.3.500',
  ].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'sin-enc.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(r.formato_detectado.fuente, 'estadistico')
  assert.strictEqual(r.filas_detectadas, 4)
  assert.strictEqual(r.filas[0].fecha, '2026-10-05')
  assert.strictEqual(r.filas[1].monto, -25000)
  assert.strictEqual(r.filas[3].monto, -3500)
})

test('formato no reconocido (sin fechas) → filas vacías, nada inventado', async () => {
  const csv = ['NOMBRE;RUT;DIRECCION', 'PEREZ S.A.;76.111.111-8;AV LIBERTAD 123'].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'otro.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(r.formato_detectado, null)
  assert.strictEqual(r.filas.length, 0)
})

test('filas con monto cero o ilegible van a saltadas con motivo', async () => {
  const csv = [
    'Fecha;Glosa;Monto',
    '05/10/2026;SALDO INICIAL;0',
    '06/10/2026;ABONO;500.000',
    'SIN FECHA;RARA;100',
  ].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'con-raras.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(r.filas.length, 1)
  assert.ok(r.saltadas.length >= 2)
  assert.ok(r.saltadas.some((s) => s.motivo === 'monto en cero'))
  assert.ok(r.saltadas.some((s) => s.motivo === 'sin fecha legible'))
})

// ---------- Excel (xlsx real generado con exceljs) ----------

test('XLSX del banco: celdas Date + números → filas ISO firmadas', async () => {
  const ExcelJS = require('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Cartola')
  ws.addRow(['Fecha', 'Descripción', 'Cargo', 'Abono'])
  ws.addRow([new Date(Date.UTC(2026, 9, 5)), 'ABONO TRANSFERENCIA', null, 1200000])
  ws.addRow([new Date(Date.UTC(2026, 9, 6)), 'PAGO LINEA', 99000, null])
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  const r = await formatos.parsearArchivo({ nombre: 'cartola.xlsx', contenidoBase64: buffer.toString('base64') })
  assert.strictEqual(r.tipo_archivo, 'xlsx')
  assert.strictEqual(r.formato_detectado.fuente, 'encabezado')
  assert.strictEqual(r.filas.length, 2)
  assert.strictEqual(r.filas[0].fecha, '2026-10-05')
  assert.strictEqual(r.filas[0].monto, 1200000)
  assert.strictEqual(r.filas[1].monto, -99000)
})

// ---------- Mapeo manual + formatos guardados ----------

test('mapeo manual: reemplaza la detección y los errores van a saltadas sin crash', async () => {
  const csv = ['Fecha;Glosa;Monto', '05/10/2026;ABONO;1.000.000', '06/10/2026;CARGO;-.100.000'].join('\n')
  const primero = await formatos.parsearArchivo({ nombre: 'cartola.csv', contenidoBase64: base64(csv) })
  assert.strictEqual(primero.filas.length, 2)
  // mapeo erróneo del usuario: columnas intercambiadas → nada importable, sin crash
  const mal = formatos.parsearConMapeo(primero.matriz, { fila_inicio: 1, col_fecha: 1, col_monto: 0 })
  assert.strictEqual(mal.filas.length, 0)
  assert.ok(mal.saltadas.length >= 2)
  // mapeo manual correcto reproduce la detección automática
  const bien = formatos.parsearConMapeo(primero.matriz, { fila_inicio: 1, col_fecha: 0, col_monto: 2, col_glosa: 1 })
  assert.strictEqual(bien.filas.length, 2)
  assert.strictEqual(bien.filas[0].monto, 1000000)
  assert.strictEqual(bien.filas[1].monto, -100000)
})

test('guardar formato: valida mapeo, guarda, lista y actualiza (upsert) — auditado', () => {
  assert.throws(() => formatos.guardarFormato(db, { empresaId: EMP.id, usuarioId: adminId, nombre: 'X', mapeo: { fila_inicio: 0, col_fecha: 0 } }), /col_monto/)
  const mapeo = { fila_inicio: 1, col_fecha: 0, col_monto: 2, col_glosa: 1 }
  const r = formatos.guardarFormato(db, { empresaId: EMP.id, usuarioId: adminId, nombre: 'Banco Prueba CSV', mapeo, ip: 'test' })
  assert.strictEqual(r.nombre, 'Banco Prueba CSV')
  const lista = formatos.listarFormatos(db, EMP.id)
  assert.strictEqual(lista.length, 1)
  assert.deepStrictEqual(lista[0].mapeo, { fila_inicio: 1, col_fecha: 0, col_monto: 2, col_cargo: null, col_abono: null, col_glosa: 1 })
  // upsert: mismo nombre actualiza sin duplicar
  formatos.guardarFormato(db, { empresaId: EMP.id, usuarioId: adminId, nombre: 'Banco Prueba CSV', mapeo: { ...mapeo, fila_inicio: 2 } })
  assert.strictEqual(formatos.listarFormatos(db, EMP.id).length, 1)
  assert.strictEqual(formatos.listarFormatos(db, EMP.id)[0].mapeo.fila_inicio, 2)
  const audit = db.prepare(`SELECT accion FROM auditoria WHERE empresa_id = ? AND accion = 'tesoreria.formato_guardar'`).get(EMP.id)
  assert.ok(audit)
  // aislamiento
  assert.strictEqual(formatos.listarFormatos(db, EMP.id + 999).length, 0)
})

// ---------- Integración con importarCartola (FASE 6 intacta) ----------

test('de archivo a libro: parsear → importarCartola → dedupe en re-importación', async () => {
  const csv = [
    'Fecha;Glosa;Monto',
    '10/10/2026;ABONO FACTURA 100;900.000',
    '11/10/2026;PAGO ARRIENDO;-.850.000',
    '12/10/2026;COMISION;-.1.200',
  ].join('\n')
  const r = await formatos.parsearArchivo({ nombre: 'cartola-final.csv', contenidoBase64: base64(csv) })
  const imp1 = teso.importarCartola(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: bancoId, filas: r.filas, ip: 'test' })
  assert.strictEqual(imp1.insertadas, 3)
  assert.strictEqual(imp1.duplicadas, 0)
  // re-importar el MISMO archivo → 0 nuevas (dedupe UNIQUE de FASE 6 intacto)
  const imp2 = teso.importarCartola(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: bancoId, filas: r.filas, ip: 'test' })
  assert.strictEqual(imp2.insertadas, 0)
  assert.strictEqual(imp2.duplicadas, 3)
  // conciliación de FASE 6 sigue operando sobre lo importado
  const conc = teso.conciliarBanco(db, { empresaId: EMP.id, usuarioId: adminId, bancoCuentaId: bancoId, hasta: '2026-10-31' })
  assert.ok(conc && typeof conc.cuadrado === 'boolean')
})
