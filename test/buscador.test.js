/**
 * Tests de búsqueda global R2 (core/buscador.js): documentos, asientos, DTEs,
 * personas de cuenta corriente y cuentas del plan. Aislamiento por empresa,
 * filtrado por permisos del rol, límite 5/grupo y normalización sin acentos.
 * BD temporal por proceso (DB_PATH en tmpdir), siembra a nivel de módulo
 * (misma base que analitica.test.js).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'buscador-')), 'test.db')
const db = require('../backend/db')
const empresas = require('../backend/core/empresas')
const asientos = require('../backend/core/asientos')
const { buscar, LIMIT_POR_GRUPO } = require('../backend/core/buscador')

const TODOS = new Set(['documentos:ver', 'asientos:ver', 'dte:ver', 'reportes:ver', 'cuentas:ver'])
const SOLO_REPORTES = new Set(['reportes:ver'])

// ---------- helpers de sembrado ----------

function dvM11(cuerpo) {
  let sum = 0
  let mult = 2
  const c = String(cuerpo)
  for (let i = c.length - 1; i >= 0; i--) {
    sum += Number(c[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const resto = 11 - (sum % 11)
  return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
}

function rutAleatorio() {
  const cuerpo = String(Math.floor(Math.random() * 8e6) + 1e6)
  return `${cuerpo}-${dvM11(cuerpo)}`
}

function empresaTest(nombre) {
  const emp = empresas.crear(db, { usuarioId: 1, rut: rutAleatorio(), nombre, claveSii: 'clave-test', tasaPpm: 0.01 })
  return typeof emp === 'object' ? emp.id : emp
}

let seq = 0
function documento(empresaId, { periodo, flujo, tipo = 33, folio, rut, razon, total, estado = 'CONTABILIZADO' }) {
  seq++
  const cols = db.prepare('PRAGMA table_info(documentos)').all().map((c) => c.name)
  const fila = {
    empresa_id: empresaId,
    periodo_ingesta: periodo,
    tipo_flujo: flujo,
    tipo_doc: tipo,
    folio: String(folio),
    fecha_docto: `${periodo.slice(0, 4)}-${periodo.slice(4)}-15`,
    rut_contraparte: rut,
    razon_social: razon,
    monto_neto: Math.round((total || 0) / 1.19),
    monto_iva: Math.max(0, (total || 0) - Math.round((total || 0) / 1.19)),
    monto_total: total,
    monto_exento: 0,
    estado,
    clave_dedupe: `t${seq}-${folio}-${rut}`,
    origen: 'rcv',
  }
  const presentes = Object.fromEntries(Object.entries(fila).filter(([k]) => cols.includes(k)))
  const keys = Object.keys(presentes)
  db.prepare(`INSERT INTO documentos (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => presentes[k]))
}

function asientoDe(empresaId, { periodo = '202610', glosa, tipo = 'manual' }) {
  const par = db.prepare('SELECT id FROM cuentas WHERE empresa_id = ? AND es_resumen = 0 ORDER BY id LIMIT 2').all(empresaId)
  return asientos.crear(db, {
    empresaId,
    usuarioId: 1,
    fecha: `${periodo.slice(0, 4)}-${periodo.slice(4)}-15`,
    tipo,
    glosa,
    lineas: [
      { cuenta_id: par[0].id, debe: 1000, haber: 0, glosa: 'cargo' },
      { cuenta_id: par[1].id, debe: 0, haber: 1000, glosa: 'abono' },
    ],
  })
}

// ---------- empresa y sembrado ----------

const EMP = empresaTest('Empresa Búsqueda')
const OTRA = empresaTest('Otra empresa aislada')
const ROL_ID = db.prepare("SELECT id FROM roles WHERE codigo = 'contador'").get().id
db.prepare('INSERT OR IGNORE INTO usuario_empresa (usuario_id, empresa_id, rol_id) VALUES (1, ?, ?)').run(OTRA, ROL_ID)

documento(EMP, { periodo: '202609', flujo: 'compra', tipo: 33, folio: 1023, rut: '77255326-9', razon: 'Distribuidora Camión Eléctrico Ltda', total: 1187000 })
documento(EMP, { periodo: '202610', flujo: 'venta', tipo: 33, folio: 55, rut: '76312274-3', razon: 'Importadora Pacífico Sur SpA', total: 238000, estado: 'PENDIENTE' })
for (let i = 1; i <= 7; i++) {
  documento(EMP, { periodo: '202610', flujo: 'venta', tipo: 110, folio: 9000 + i, rut: '76312274-3', razon: `Boleta chica ${i}`, total: 10000 * i })
}
documento(OTRA, { periodo: '202610', flujo: 'venta', tipo: 33, folio: 1023, rut: '77255326-9', razon: 'Distribuidora Camión Eléctrico Ltda', total: 999999 })
asientoDe(EMP, { periodo: '202610', glosa: 'Depreciación del primer trimestre' })
asientoDe(OTRA, { periodo: '202610', glosa: 'Asiento de otra empresa' })
db.prepare(`
  INSERT INTO dte_emitidos (empresa_id, tipo_dte, folio, fecha_emision, receptor_rut, receptor_razon_social, monto_total, estado)
  VALUES (?, 33, 777, '2026-10-05', '76662246-2', 'Constructora Andina Limitada', 150000, 'ENVIADO')
`).run(EMP)
db.prepare(`
  INSERT INTO cuentas (empresa_id, codigo, nombre, clase, naturaleza)
  VALUES (?, '1.1.10.001', 'Banco Chile Cuenta Corriente', 1, 'deudora')
`).run(EMP)

// ---------- unidades ----------

test('búsqueda vacía o corta: sin grupos', () => {
  assert.deepEqual(buscar(db, { empresaId: EMP, texto: '', permisos: TODOS }).grupos, [])
  assert.deepEqual(buscar(db, { empresaId: EMP, texto: 'a', permisos: TODOS }).grupos, [])
})

test('documentos por razón social sin acentos y por folio exacto', () => {
  const docs = buscar(db, { empresaId: EMP, texto: 'camion electrico', permisos: TODOS }).grupos.find((g) => g.grupo === 'Documentos')
  assert.ok(docs, 'grupo Documentos existe')
  assert.ok(docs.filas[0].titulo.includes('1023'))
  const folio = buscar(db, { empresaId: EMP, texto: '1023', permisos: TODOS }).grupos.find((g) => g.grupo === 'Documentos')
  assert.equal(folio.filas.length, 1)
})

test('límite de 5 por grupo en documentos', () => {
  const docs = buscar(db, { empresaId: EMP, texto: '76312274', permisos: TODOS }).grupos.find((g) => g.grupo === 'Documentos')
  assert.ok(docs, 'grupo Documentos existe')
  assert.equal(docs.filas.length, LIMIT_POR_GRUPO)
})

test('aislamiento: solo documentos de la empresa activa', () => {
  const docs = buscar(db, { empresaId: OTRA, texto: 'camion', permisos: TODOS }).grupos.find((g) => g.grupo === 'Documentos')
  assert.equal(docs.filas.length, 1)
})

test('asientos por glosa (sin acentos) y folio', () => {
  const asi = buscar(db, { empresaId: EMP, texto: 'depreciacion', permisos: TODOS }).grupos.find((g) => g.grupo === 'Asientos')
  assert.ok(asi, 'grupo Asientos existe')
  assert.ok(asi.filas[0].titulo.includes('Depreciación'))
})

test('DTEs emitidos por receptor', () => {
  const dtes = buscar(db, { empresaId: EMP, texto: 'constructora andina', permisos: TODOS }).grupos.find((g) => g.grupo === 'DTEs emitidos')
  assert.ok(dtes, 'grupo DTEs existe')
  assert.ok(dtes.filas[0].titulo.includes('Constructora Andina'))
  assert.equal(dtes.filas[0].hash, '#dte')
})

test('personas: agrupadas por RUT, sin acentos, hash según dominio', () => {
  const per = buscar(db, { empresaId: EMP, texto: 'pacifico', permisos: TODOS }).grupos.find((g) => g.grupo === 'Clientes y proveedores')
  assert.ok(per, 'grupo personas existe')
  assert.equal(per.filas[0].hash, '#cclientes')
})

test('grupos ocultos sin permiso: solo aparece cuenta corriente', () => {
  const r = buscar(db, { empresaId: EMP, texto: 'camion', permisos: SOLO_REPORTES })
  assert.ok(!r.grupos.find((g) => g.grupo === 'Documentos'))
  assert.ok(!r.grupos.find((g) => g.grupo === 'Asientos'))
  assert.ok(!r.grupos.find((g) => g.grupo === 'DTEs emitidos'))
  assert.ok(!r.grupos.find((g) => g.grupo === 'Cuentas del plan'))
})

test('cuentas del plan por código', () => {
  const cu = buscar(db, { empresaId: EMP, texto: '1.1.10', permisos: TODOS }).grupos.find((g) => g.grupo === 'Cuentas del plan')
  assert.ok(cu, 'grupo cuentas existe')
  assert.ok(cu.filas[0].titulo.startsWith('1.1.10.001'))
})

test('cada grupo lleva su permiso y patrón :ver', () => {
  const r = buscar(db, { empresaId: EMP, texto: '10', permisos: TODOS })
  assert.ok(r.grupos.length > 0)
  for (const g of r.grupos) {
    assert.match(g.permiso, /:ver$/)
  }
})
