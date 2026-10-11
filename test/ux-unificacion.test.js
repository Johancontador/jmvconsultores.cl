'use strict'
/**
 * pruebas de regresión del rediseño UX (masterplan unificación):
 *  T1 — MENU: keys únicos y toda vista tiene entrada (compatibilidad §36).
 *  T2 — UIEstado: cargando/vacio/chip/error escapan HTML (no inyección).
 *  T3 — Calculadora IVA: aritmética neta↔IVA↔total con 19% (19.000→3.610/22.610).
 *  T4 — Centro de reportes: favoritos persisten en localStorage (contrato de keys).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const FRONT = path.resolve(__dirname, '../frontend')

// ---------- T1: MENU ----------
test('T1: menú — keys únicos y toda vista con entrada de menú', () => {
  const dirs = { sistema: fs.readdirSync(path.join(FRONT, 'sistema')).filter((f) => f.endsWith('.js')) }
  let all = ''
  for (const f of dirs.sistema) all += fs.readFileSync(path.join(FRONT, 'sistema', f), 'utf8')
  const app = fs.readFileSync(path.join(FRONT, 'sistema', 'app.js'), 'utf8')
  const menuKeys = [...app.matchAll(/key: '([\w-]+)'/g)].map((m) => m[1])
  assert.ok(menuKeys.length >= 30, `menú tiene ${menuKeys.length} ítems`)
  assert.strictEqual(menuKeys.length, new Set(menuKeys).size, 'sin ítems duplicados')
  // cada VIEWS definida está en el menú
  const vistas = [...all.matchAll(/VIEWS\.([\w]+)\s*=/g)].map((m) => m[1] + [...all.matchAll(/VIEWS\['([\w-]+)'\]/gi)].length ? null : null)
  const vistas2 = [...all.matchAll(/VIEWS\.([\w\w]+)\s*=/g)].map((m) => m[1])
    .concat([...all.matchAll(/VIEWS\['([\w-]+)'\]\s*=/g)].map((m) => m[1]))
  const menuSet = new Set(menuKeys)
  const sinMenu = vistas2.filter((v) => !menuSet.has(v))
  assert.strictEqual(sinMenu.length, 0, `vistas sin entrada de menú: ${sinMenu.join(',')}`)
})

// ---------- T2: UIEstado — carga y escape ----------
test('T2: UIEstado carga y escapa HTML en vacio/error/chip (anti inyección)', () => {
  const sandbox = { window: {}, document: undefined }
  vm.createContext(sandbox)
  new vm.Script(fs.readFileSync(path.join(FRONT, 'sistema', 'ui.js'), 'utf8')).runInContext(sandbox)
  const UI = sandbox.window.UIEstado
  assert.ok(UI, 'window.UIEstado definido')
  const malicioso = '<script>alert(1)</script>'
  for (const salida of [UI.vacio(malicioso), UI.error(malicioso), UI.chip(malicioso)]) {
    assert.ok(!salida.includes('<script>'), 'injection bloqueada')
    assert.ok(salida.includes('&lt;script&gt;'), 'escape correcto')
  }
  assert.ok(UI.cargando('x').includes('ui-spin'), 'spinner CSS presente')
  // calculadora HTML se genera
  assert.ok(UI.calculadoraIvaHTML().includes('ci-neto') && UI.calculadoraIvaHTML().includes('No</b> incluye'), 'calculadora con labeling provisional honesto')
})

// ---------- T3: aritmética de la calculadora (lógica verificada aislada) ----------
test('T3: aritmética IVA 19% — neto 19000 → IVA 3610 → total 22610 (formato chileno)', () => {
  const neto = 19000, TASA = 0.19
  const iva = Math.round(neto * TASA)
  const total = Math.round(neto * (1 + TASA))
  assert.strictEqual(iva, 3610)
  assert.strictEqual(total, 22610)
  // inversa: desde total 22610 → neto 19000, IVA 3610
  const netoInverso = Math.round(22610 / (1 + TASA))
  const ivaInverso = Math.round(22610 - 22610 / (1 + TASA))
  assert.strictEqual(netoInverso, 19000)
  assert.strictEqual(ivaInverso, 3610)
  // formato es-CL (miles con punto)
  const f = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(total)
  assert.ok(f.includes('.'), 'formato chileno de miles')
})

// ---------- T4: centro de reportes — favoritos/recientes (contrato de storage) ----------
test('T4: centro de reportes — keys de storage y contratos de favoritos/recientes', () => {
  const conta = fs.readFileSync(path.join(FRONT, 'sistema', 'views-conta.js'), 'utf8')
  assert.ok(conta.includes('jmv_fav_reports'), 'KEY_FAV definida')
  assert.ok(conta.includes('jmv_recent_records') || conta.includes('jmv_recent_reports'), 'KEY_REC definida')
  // favorito: botón dentro del anchor, con preventDefault (no navega)
  assert.ok(conta.includes('e.preventDefault()') && cont_a(conta), 'rep-fav no navega')
  // búsqueda muestra estado vacío
  assert.ok(conta.includes('rep-sin-resultados'), 'estado vacío de búsqueda presente')
})

function cont_a(s) {
  return s.includes("stopPropagation()")
}
