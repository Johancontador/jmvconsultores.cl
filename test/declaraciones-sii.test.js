'use strict'
/**
 * DECLARACIONES SII — tests de los parsers (sin red).
 *
 * Lo que se prueba:
 *  T1  Tooltip de la Consulta Integral → estado (declarada / no presentada).
 *  T2  Estado de la búsqueda de formularios («Vigente», «Rectificada»…).
 *  T3  Montos y fechas del SII en formato chileno.
 *  T4  Tabla del informe anual de boletas: 12 meses + totales.
 *  T5  Grilla de búsqueda anual del F29: columnas por encabezado (ST-02).
 *
 * Los valores de los tooltips y de las columnas están copiados de respuestas
 * reales del SII (21-10-2026), no inventados.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-decl-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const decl = require('../backend/core/declaraciones-sii')
const db = require('../backend/db')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
})

test('T1: tooltip de la matriz F29 → estado', () => {
  assert.equal(decl.estadoDesdeTooltip('Declaración sin observaciones.'), 'declarada')
  assert.equal(decl.estadoDesdeTooltip('Periodo sin declaración, haz clic para ingresar al formulario.'), 'no_presentada')
  assert.equal(decl.estadoDesdeTooltip('Declaración con observaciones.'), 'declarada')
  assert.equal(decl.estadoDesdeTooltip('Declaración rectificada vigente'), 'rectificada')
  assert.equal(decl.estadoDesdeTooltip('texto desconocido'), 'sin_informacion')
  assert.equal(decl.estadoDesdeTooltip(''), null)
})

test('T2: estado de la búsqueda de formularios', () => {
  assert.equal(decl.estadoDesdeBusqueda('Vigente'), 'declarada')
  assert.equal(decl.estadoDesdeBusqueda('Rectificada'), 'rectificada')
  assert.equal(decl.estadoDesdeBusqueda('Anulada'), 'no_presentada')
  assert.equal(decl.estadoDesdeBusqueda('Pendiente'), 'no_presentada')
  assert.equal(decl.estadoDesdeBusqueda('—'), 'sin_informacion')
})

test('T3: montos y fechas en formato SII', () => {
  assert.equal(decl.normalizarMonto('$1,027,539'), 1027539)
  assert.equal(decl.normalizarMonto('$ 29.583'), 29583)
  assert.equal(decl.normalizarMonto('0'), 0)
  assert.equal(decl.normalizarMonto(''), null)
  assert.equal(decl.normalizarFecha('19/02/2025'), '2025-02-19')
  assert.equal(decl.normalizarFecha('8/3/2021'), '2021-03-08')
  assert.equal(decl.normalizarFecha('sin fecha'), null)
})

test('T4: informe anual de boletas — 12 meses y totales', () => {
  const filas = [
    ['ENERO', '1', '3', '3', '0', '1.000.000', '100.000', '50.000', '850.000'],
    ['FEBRERO', '4', '4', '1', '0', '200.000', '20.000', '10.000', '170.000'],
    ['TOTALES:', '3', '0', '1.200.000', '120.000', '60.000', '1.020.000'],
  ]
  const r = decl.parsearTablaBhe(filas)
  const enero = r.find((f) => f.mes === '01')
  assert.equal(enero.folio_inicial, '1')
  assert.equal(enero.folio_final, '3')
  assert.equal(enero.vigentes, 3)
  assert.equal(enero.honorario_bruto, 1000000)
  assert.equal(enero.retencion_terceros, 100000)
  assert.equal(enero.retencion_contribuyente, 50000)
  assert.equal(enero.total_liquido, 850000)
  const tot = r.find((f) => f.totales)
  assert.equal(tot.honorario_bruto, 1200000)
  assert.equal(tot.total_liquido, 1020000)
})

// T5: el despliegue en Docker instala chromium y puppeteer-core como
// dependencia de producción. Si falta cualquiera de los dos, la sincronización
// de declaraciones tiene que decirlo con SII_SIN_NAVEGADOR (no con un 500 y
// menos aún abriendo una sesión en el SII que después nadie cierra).
test('T5: disponibilidad del navegador headless', () => {
  const sinNada = decl.navegadorDisponible(['/ruta/que/no/existe'])
  assert.equal(sinNada.disponible, false)
  assert.equal(sinNada.ruta, null)
  assert.match(sinNada.motivo, /CHROME_PATH/)

  const conBinario = decl.navegadorDisponible([process.execPath])
  assert.equal(conBinario.disponible, true)
  assert.equal(conBinario.ruta, process.execPath)
  assert.equal(conBinario.motivo, null)
})

// T7: el parseo por posiciones (coordenadas BT) es la vía principal, pero
// cuando el PDF no expone textos BT utilizables el resultado era «leído» con
// casillas vacías. El respaldo por texto plano debe recuperarlas y alimentar
// los mismos indicadores que usa la conciliación declarado vs RCV.
test('T7: lectura de respaldo del Formulario Compacto por texto plano', () => {
  const f29 = require('../backend/core/f29-formulario')
  // Texto real de pdf-parse para el F29 202609 de 77.255.326-9: el compacto
  // imprime código, glosa y valor PEGADOS, sin espacios.
  const texto = [
    'FORMULARIO 29',
    'FOLIO[07]9367498676',
    'CódigoGlosaValor',
    '503CANTIDAD FACTURAS EMITIDAS12',
    '511CRÉD. IVA POR DCTOS. ELECTRÓNICOS1.447.459',
    '563BASE IMPONIBLE16.840.242',
    '115TASA PPM 1ra. CATEGORÍA0.1',
    '502DÉBITOS FACTURAS EMITIDAS3.199.646',
    '538TOTAL DÉBITOS3.199.646',
    '520CRÉDITO REC. Y REINT./FACT. DEL GIRO1.503.957',
    '528CRÉDITO RECUP. Y REINT NOTAS DE CRÉD56.498',
    '537TOTAL CRÉDITOS1.447.459',
    '089IMP. DETERM. IVA1.752.187',
    '062PPM NETO DETERMINADO16.840',
    '595SUB TOTAL IMP. DETERMINADO ANVERSO1.769.027',
    '547TOTAL DETERMINADO1.769.027',
    '931Monto Interés932Monto Multa60Condonación',
    'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL911.769.027+',
    'TOTAL A PAGAR CON RECARGO94=',
  ].join('\n')
  const cs = f29.casillasDeTexto(texto)
  assert.deepEqual(cs.find((c) => c.codigo === '563'), {
    codigo: '563', glosa: 'BASE IMPONIBLE', valor_texto: '16.840.242', valor: 16840242,
  })
  // La tasa es un porcentaje: «0.1» no puede leerse como 1.
  assert.equal(cs.find((c) => c.codigo === '115').valor, 0.1)
  // Casilla 91: código pegado al monto; se descarta el «91» y se cuadra con 547.
  assert.equal(cs.find((c) => c.codigo === '091').valor, 1769027)
  const { indicadores, verificaciones } = f29.indicadores(cs)
  assert.equal(indicadores.base_imponible, 16840242)
  assert.equal(indicadores.iva_determinado, 1752187)
  assert.equal(indicadores.ppm_neto, 16840)
  assert.equal(indicadores.total_a_pagar, 1769027)
  assert.deepEqual(verificaciones.map((v) => v.codigo), [
    'DEBITOS_NETOS', 'IVA_DETERMINADO', 'TOTAL_CREDITOS', 'PPM_DETERMINADO', 'TOTAL_A_PAGAR',
  ])
  assert.ok(verificaciones.every((v) => v.ok), 'las cuadraturas del F29 real deben cerrar')
  assert.equal(f29.casillasDeTexto('').length, 0)
  assert.equal(f29.casillasDeTexto('Texto sin casillas\n20/02/2026').length, 0)

  // 202604 (mismo contribuyente, PDF real): las NOTAS DE DÉBITO emitidas (513)
  // suman al total. Sin ellas la cuadratura «502 − 510 = 538» fallaba por
  // exactamente el monto de la nota de débito (31.933).
  const conNd = f29.casillasDeTexto([
    '512CANT. DE DCTOS. NOTAS DE DÉBITO EMIT.1',
    '502DÉBITOS FACTURAS EMITIDAS3.760.018',
    '513NOTAS DE DÉBITOS EMITIDAS31.933',
    '510DÉBITOS NOTAS DE CRÉDITOS EMITIDAS1.341.223',
    '538TOTAL DÉBITOS2.450.728',
    '537TOTAL CRÉDITOS1.723.342',
    '089IMP. DETERM. IVA727.386',
  ].join('\n'))
  assert.equal(conNd.find((c) => c.codigo === '513').valor, 31933)
  const vNd = f29.indicadores(conNd).verificaciones
  assert.ok(vNd.find((v) => v.codigo === 'DEBITOS_NETOS').ok, '502 + 513 − 510 debe cuadrar con 538')
  assert.ok(vNd.find((v) => v.codigo === 'IVA_DETERMINADO').ok)

  // 202605 de 78.174.505-7 (PDF real): remanente de crédito, boletas (111),
  // recibos de medios electrónicos (759) y tasa PPM de tres decimales (0,125).
  // Antes de corregirlo este mes fallaba 3 de 5 cuadraturas siendo correcto.
  const conRemanente = f29.casillasDeTexto([
    '110CANT. DE DCTOS. BOLETAS12',
    '758CANT. RECIBO DE PAGO MEDIOS ELECTRÓNICOS25',
    '511CRÉD. IVA POR DCTOS. ELECTRÓNICOS245.723',
    '563BASE IMPONIBLE3.565.653',
    '115TASA PPM 1ra. CATEGORÍA0,125',
    '520CRÉDITO REC. Y REINT./FACT. DEL GIRO245.723',
    '504REMANENTE CRÉDITO MES ANTERIOR3.438.724',
    '537TOTAL CRÉDITOS3.684.447',
    '502DÉBITOS FACTURAS EMITIDAS613.512',
    '111DÉBITOS / BOLETAS21.108',
    '759DÉB. RECIBO DE PAGO MEDIOS ELECTRÓNICOS50.454',
    '510DÉBITOS NOTAS DE CRÉDITOS EMITIDAS7.600',
    '538TOTAL DÉBITOS677.474',
    '089IMP. DETERM. IVA0',
    '062PPM NETO DETERMINADO4.457',
    '547TOTAL DETERMINADO4.457',
    'TOTAL A PAGAR DENTRO DEL PLAZO LEGAL914.457+',
  ].join('\n'))
  const rRem = f29.indicadores(conRemanente)
  assert.equal(rRem.indicadores.tasa_ppm, 0.125)
  assert.equal(rRem.indicadores.total_a_pagar, 4457)
  assert.equal(rRem.indicadores.remanente_credito_anterior, 3438724)
  assert.ok(rRem.verificaciones.every((v) => v.ok), rRem.verificaciones.filter((v) => !v.ok).map((v) => v.detalle).join(' | '))
})

test('T5: grilla anual del F29 — columnas por encabezado, no por posición', () => {
  // Valores copiados de la grilla real de la Consulta Integral (21-10-2026).
  const filas = [
    ['Periodo', 'Folio', 'Contribuyente', 'Fecha', 'Estado', 'Monto', 'Ver'],
    ['2025-01', '123456789', 'EMPRESA UNO', '19/02/2025', 'Vigente', '$1.027.539', 'Ver'],
    ['2025-02', '123456790', 'EMPRESA UNO', '20/03/2025', 'Rectificada', '$ 29.583', 'Ver'],
  ]
  const r = decl.parsearTablaBusquedaF29(filas)
  assert.deepEqual(r.columnas, { periodo: 0, folio: 1, fecha: 3, estado: 4, monto: 5 })
  assert.equal(r.filas.length, 2)
  assert.equal(r.filas[0].periodo, '202501')
  assert.equal(r.filas[0].folio, '123456789')
  assert.equal(r.filas[0].fecha, '19/02/2025')
  assert.equal(r.filas[0].estado, 'Vigente')
  assert.equal(r.filas[0].monto, '$1.027.539')
  // El monto se informa, pero SIN casilla: no es conciliable.
  assert.equal(r.filas[0].monto_concepto, 'no_identificado')

  // Si el SII agrega una columna antes del monto, se sigue leyendo «Monto»
  // (antes se tomaba `c[5]`, que aquí sería «Estado»).
  const movido = [
    ['Período', 'Folio', 'Contribuyente', 'Cuota', 'Fecha', 'Estado', 'Monto'],
    ['2025-03', '123456791', 'EMPRESA UNO', '12', '20/04/2025', 'Vigente', '$10.000'],
  ]
  const r2 = decl.parsearTablaBusquedaF29(movido)
  assert.equal(r2.filas[0].monto, '$10.000')
  assert.equal(r2.filas[0].estado, 'Vigente')

  // Sin encabezado reconocible no se adivina por posición: mejor ninguna fila
  // que una diferencia inventada.
  assert.deepEqual(
    decl.parsearTablaBusquedaF29([['2025-01', '1', 'X', '19/02/2025', 'Vigente', '$1', 'Ver']]),
    { columnas: null, filas: [] },
  )
  assert.deepEqual(decl.parsearTablaBusquedaF29([]), { columnas: null, filas: [] })
})

test('T6: puppeteer-core es dependencia de producción y el Dockerfile instala chromium', () => {
  const pkg = require('../package.json')
  assert.ok(pkg.dependencies['puppeteer-core'], 'puppeteer-core debe estar en dependencies (npm ci --omit=dev)')
  assert.ok(!(pkg.devDependencies || {})['puppeteer-core'], 'puppeteer-core no debe quedar solo en devDependencies')
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8')
  assert.match(dockerfile, /apt-get install[^\n]*chromium/)
  assert.match(dockerfile, /CHROME_PATH=\/usr\/bin\/chromium/)
})
