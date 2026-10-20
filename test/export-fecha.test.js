'use strict'
/**
 * Fecha del documento en las EXPORTACIONES (reescrito el 2026-10-20).
 *
 * Antes este test cargaba `frontend/shared/export.js`, el módulo de la capa
 * heredada que se retiró con sus pantallas. La garantía que importa sigue
 * vigente, pero ahora vive en un solo lugar: **UITabla** (shared/uitoolkit.js)
 * exporta las columnas que declara cada vista, y las tablas de documentos
 * declaran `Fecha` con `fecha_docto`.
 *
 *   E1 — exportar CSV/Excel de UITabla incluye la columna Fecha y el valor real
 *        del documento (no un placeholder).
 *   E2 — las tablas de documentos de la SPA (Bandeja y Libros) declaran la
 *        columna Fecha alimentada por `fecha_docto`: si alguien la quita, el
 *        archivo saldría sin fecha y este test falla.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const FRONT = path.join(__dirname, '..', 'frontend')

/* ----------------------------- E1 ----------------------------- */

function sandboxConDescargas() {
  const descargas = []
  const el = () => {
    const e = {
      href: '', download: '', textContent: '', innerHTML: '',
      style: {}, dataset: {}, className: '', value: '',
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute: () => null,
      appendChild() {}, remove() {},
      querySelector: () => null, querySelectorAll: () => [],
      getContext: () => null,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    }
    e.click = () => descargas.push({ nombre: e.download, href: e.href })
    return e
  }
  const sandbox = {
    console,
    document: {
      createElement: () => el(),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { appendChild() {}, removeChild() {} },
      addEventListener() {},
    },
    Blob: class {
      constructor(parts, opts) { this.parts = parts; this.type = opts?.type }
    },
    URL: { createObjectURL: (b) => { sandbox.__blob = b; return 'blob:x' }, revokeObjectURL() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout, clearTimeout, Intl,
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.createContext(sandbox)
  for (const f of ['shared/format.js', 'shared/uitoolkit.js']) {
    vm.runInContext(fs.readFileSync(path.join(FRONT, f), 'utf8'), sandbox)
  }
  return { sandbox, descargas, textoUltimo: () => String((sandbox.__blob?.parts || []).join('')) }
}

const DOC = {
  fecha_docto: '2024-01-15',
  rut_contraparte: '76123456-7',
  razon_social: 'Cliente A',
  monto_neto: 100000,
  monto_iva: 19000,
  monto_total: 119000,
}

// Las MISMAS columnas que declaran las vistas de documentos de la SPA.
const COLUMNAS = [
  { key: 'fecha_docto', label: 'Fecha', valor: (d) => (d.fecha_docto || '').slice(0, 10) },
  { key: 'razon_social', label: 'Contraparte' },
  { key: 'monto_neto', label: 'Neto', num: true, valor: (d) => String(d.monto_neto), crudo: (d) => d.monto_neto },
  { key: 'monto_total', label: 'Total', num: true, valor: (d) => String(d.monto_total), crudo: (d) => d.monto_total },
  { key: 'acciones', label: 'Acciones', exportable: false },
]

test('E1: exportar CSV/Excel de UITabla incluye la fecha real del documento', () => {
  const { sandbox, descargas, textoUltimo } = sandboxConDescargas()

  sandbox.UITabla.exportar({ columnas: COLUMNAS, filas: [DOC], nombre: 'documentos', formato: 'csv' })
  const csv = textoUltimo()
  assert.match(csv, /^\uFEFF?"Fecha";"Contraparte";"Neto";"Total"/, `cabecera sin Acciones: ${csv.split(/\r?\n/)[0]}`)
  assert.match(csv, /"2024-01-15"/, 'el CSV lleva la fecha del documento')
  assert.match(csv, /Cliente A/, 'y el resto de las columnas')
  assert.ok(descargas.length === 1, 'dispara una descarga')
  assert.match(descargas[0].nombre, /documentos\.csv$/, 'nombre del archivo')

  sandbox.UITabla.exportar({ columnas: COLUMNAS, filas: [DOC], nombre: 'documentos', formato: 'xls' })
  const xls = textoUltimo()
  assert.match(xls, /"2024-01-15"/, 'el Excel también lleva la fecha')
  assert.match(descargas[descargas.length - 1].nombre, /documentos\.xls$/)
})

/* ----------------------------- E2 ----------------------------- */

test('E2: Bandeja y Libros declaran la columna Fecha con fecha_docto', () => {
  const src = fs.readFileSync(path.join(FRONT, 'sistema', 'views-fiscal.js'), 'utf8')
  const declaraciones = [...src.matchAll(/\{ key: 'fecha_docto', label: 'Fecha'[^}]*\}/g)]
  assert.ok(declaraciones.length >= 2, `Bandeja y Libros declaran Fecha (encontradas ${declaraciones.length})`)
  for (const d of declaraciones) {
    assert.match(d[0], /valor: \(d\) => \(d\.fecha_docto \|\| ''\)\.slice\(0, 10\)/, 'la columna sale del documento, no del DOM')
    assert.ok(!/exportable: false/.test(d[0]), 'la fecha NO se excluye del archivo')
  }
})
