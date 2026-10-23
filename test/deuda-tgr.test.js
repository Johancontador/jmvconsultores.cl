'use strict'
/**
 * DEUDA FISCAL (TGR) + DECLARACIONES JURADAS — tests sin red.
 *
 * Lo que se prueba:
 *  D1  El texto REAL de un certificado «NO REGISTRA DEUDA» se interpreta como
 *      sin deuda, total 0, con fecha de emisión y código de verificación.
 *  D2  Un certificado con deuda toma el TOTAL rotulado y NO suma montos
 *      sueltos; si no hay rótulo, el total queda NULL (no se inventa).
 *  D3  La consulta guarda el registro y el PDF, y el informe lo expone con su
 *      propio estado (no como deuda comercial).
 *  D4  Con deuda, el informe abre un hallazgo DEUDA_TGR de severidad alta y
 *      suma el monto UNA sola vez a la exposición.
 *  D5  Sin consulta, el informe dice «no consultado» y NO inventa un cero.
 *  D6  El Formulario Compacto del F29 se persiste (regresión del typo
 *      comacto/comulto que dejaba la tabla vacía).
 *  D7  Las declaraciones juradas se guardan por año y el informe las lee.
 *
 * BD temporal; ninguna llamada a la TGR ni al SII.
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-tgr-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const deuda = require('../backend/core/deuda-tgr')
const salud = require('../backend/core/salud-tributaria')
const decl = require('../backend/core/declaraciones-sii')
const dj = require('../backend/core/dj-sii')

test.after(() => {
  try { db.close() } catch { /* ya cerrada */ }
  for (const suf of ['', '-wal', '-shm']) fs.rmSync(dbFile + suf, { force: true })
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('cert-tgr-test-')) fs.rmSync(path.join(os.tmpdir(), f), { force: true })
  }
})

let n = 0
function empresa(rut = '76312274-3') {
  const info = db.prepare(`INSERT INTO empresas (rut, nombre, clave_sii, tasa_ppm, activo) VALUES (?, ?, 'k', 0.01, 1)`)
    .run(rut, `Empresa TGR ${++n}`)
  return Number(info.lastInsertRowid)
}

/** Texto REAL del certificado sin deuda (empresa 76312274-3, 22-10-2026). */
const TEXTO_SIN_DEUDA = `
Certificado de Deuda
COMERCIALIZADORA C&E CLIMA LIMITADA
NOMBRE
STA ELVIRA 101, SANTIAGOSANTIAGO
76.312.274-3
DIRECCION
RUT
COMUNA
ESTE RUT 76.312.274-3 NO REGISTRA DEUDA
22:23
La Institución o persona ante quien se presenta este certificado, podrá verificar su autenticidad en www.tgr.cl, ingresando el número del código de
barra que se indica en certificado.
(Liquidada al: 22-10-2026)
El Servicio de Tesorería certifica que de acuerdo al estado de la Cuenta Única Tributaria no se registra deuda asociada a este RUT 76.312.274-3.
IMPORTANTE
Emitido a las:
Página 1 de
Fecha de Emisión del Certificado: 22-10-2026
1
DOCUMENTO NO VALIDO PARA PAGAR EN INSTITUCIONES RECAUDADORAS
001SD202629571457648
`

const TEXTO_CON_DEUDA = `
Certificado de Deuda
EMPRESA DEMO SPA
NOMBRE
AV SIEMPRE VIVA 100, PROVIDENCIAPROVIDENCIA
76.000.000-1
DIRECCION
RUT
COMUNA
Documento                 Periodo        Monto
Formulario 29             2025-04        1.250.000
Reajustes e intereses                    210.500
TOTAL A PAGAR                            1.460.500
(Liquidada al: 22-10-2026)
Fecha de Emisión del Certificado: 22-10-2026
001SD202629571457999
`

test('D1: certificado real «NO REGISTRA DEUDA» → sin deuda, total 0', () => {
  const r = deuda.parsearCertificado(TEXTO_SIN_DEUDA)
  assert.equal(r.estado, 'sin_deuda')
  assert.equal(r.total, 0)
  assert.equal(r.fecha_emision, '2026-10-22')
  assert.equal(r.liquidada_al, '2026-10-22')
  assert.equal(r.codigo_verificacion, '001SD202629571457648')
  assert.equal(r.rut, '76.312.274-3')
  assert.equal(r.confianza, 'alta')
  assert.equal(deuda.nombreCertificado(TEXTO_SIN_DEUDA), 'COMERCIALIZADORA C&E CLIMA LIMITADA')
})

test('D2: con deuda se toma el TOTAL rotulado (no la suma de montos sueltos)', () => {
  const r = deuda.parsearCertificado(TEXTO_CON_DEUDA)
  assert.equal(r.estado, 'con_deuda')
  assert.equal(r.total, 1460500)
  assert.equal(r.etiqueta_total, 'TOTAL A PAGAR')
  assert.equal(r.confianza, 'media')

  // Detalle por documento: solo la fila con período e importe legibles.
  assert.equal(r.documentos.length, 1)
  assert.deepEqual(
    { documento: r.documentos[0].documento, periodo: r.documentos[0].periodo, monto: r.documentos[0].monto },
    { documento: 'F29', periodo: '202504', monto: 1250000 },
  )
  // La suma de filas se expone APARTE y no reemplaza al total oficial.
  assert.equal(r.total_calculado, 1250000)

  // Sin rótulo de total: NO se inventa una suma.
  const sinTotal = deuda.parsearCertificado('Certificado de Deuda\nDocumento X 100.000\nOtro 200.000\n')
  assert.equal(sinTotal.estado, 'con_deuda')
  assert.equal(sinTotal.total, null)
  assert.deepEqual(sinTotal.montos_detectados.sort((a, b) => a - b), [100000, 200000])
  assert.equal(sinTotal.confianza, 'baja')
})

test('D3/D4: la consulta guarda evidencia y el informe expone la deuda UNA vez', async () => {
  const eid = empresa('76312274-3')
  const r = await deuda.consultar(db, {
    empresaId: eid,
    deps: {
      clave: 'clave-de-prueba',
      descargarCertificado: async () => ({
        pdf: Buffer.from('%PDF-1.4 demo'),
        texto: TEXTO_CON_DEUDA,
        url: 'https://www.tesoreria.cl/CertDeudasRutCutAixWeb/internet/begin.do',
      }),
      guardarPdf: (rut) => {
        const archivo = path.join(os.tmpdir(), `cert-tgr-test-${rut}-${Date.now()}.pdf`)
        fs.writeFileSync(archivo, '%PDF-1.4 demo')
        return archivo
      },
    },
  })
  assert.equal(r.estado, 'con_deuda')
  assert.equal(r.total, 1460500)
  assert.ok(r.pdf_ruta, 'el certificado queda guardado como evidencia')

  const resumen = deuda.resumen(db, eid)
  assert.equal(resumen.estado, 'con_deuda')
  assert.equal(resumen.total, 1460500)
  assert.equal(resumen.fecha_emision, '2026-10-22')

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 3 })
  assert.equal(inf.deudas.fiscal_tgr.estado, 'con_deuda')
  assert.equal(inf.deudas.fiscal_tgr.total, 1460500)
  assert.equal(inf.tesoreria.deuda_fiscal.total, 1460500, 'la deuda fiscal viaja junto a tesorería')

  const h = inf.opinion.hallazgos.find((x) => x.codigo === 'DEUDA_TGR')
  assert.ok(h, 'la deuda fiscal genera hallazgo')
  assert.equal(h.severidad, 'alta')

  const filas = inf.opinion.matriz_riesgos.filter((x) => x.codigo === 'DEUDA_TGR')
  assert.equal(filas.length, 1)
  assert.equal(filas[0].importe, 1460500)
  assert.equal(filas[0].cuenta_exposicion, true)
  assert.equal(inf.opinion.exposicion.por_naturaleza.deuda_fiscal_tgr, 1460500)
  // El total de exposición incluye la deuda fiscal sin duplicarla (aquí no
  // hay otras diferencias cuantificadas).
  assert.equal(inf.opinion.exposicion.total, 1460500)
})

test('D5: sin consulta el informe dice «no consultado» (nunca cero)', () => {
  const eid = empresa('78198601-1')
  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 3 })
  assert.equal(inf.deudas.fiscal_tgr.estado, 'no_consultado')
  assert.equal(inf.deudas.fiscal_tgr.total, null)
  assert.ok(!inf.opinion.hallazgos.some((h) => h.codigo === 'DEUDA_TGR'))
  assert.ok(inf.opinion.limitaciones.some((l) => /deuda fiscal en la TGR/i.test(l)))
  // El resumen del menú tampoco puede sugerir que está al día.
  const res = salud.resumenInforme(db, { empresaId: eid, periodo: '202610', meses: 3 })
  assert.equal(res.deuda_tgr.estado, 'no_consultado')
})

test('D6: el Formulario Compacto del F29 se persiste (regresión comacto/comulto)', () => {
  const eid = empresa('77255326-9')
  const ok = decl.guardarFormularioF29(db, {
    empresaId: eid,
    rut: '77255326-9',
    periodo: '202509',
    fila: { folio: '8124703416', estado: 'Vigente', monto: '$4.277.873' },
    estado: { situacion: 'Vigente', monto_observado: 0, declaraciones_vigentes: 1, intentos_declaracion: 1, eventos: [] },
    compacto: {
      ok: true,
      folio: '8124703416',
      casillas: [{ codigo: '89', monto: 22790604 }],
      verificaciones: [{ ok: true, detalle: 'débitos − NC = total' }],
      indicadores: { total_debitos: 22790604, iva_determinado: 427783, total_a_pagar: 4277873 },
      url: 'https://www4.sii.cl/rfiInternet/formCompacto?folio=8124703416',
      bytes: 12345,
    },
  })
  assert.equal(ok, true)
  const fila = db.prepare(`SELECT * FROM f29_formularios WHERE empresa_id = ? AND periodo = '202509'`).get(eid)
  assert.ok(fila, 'la fila del Formulario Compacto debe existir')
  assert.equal(fila.folio, '8124703416')
  assert.equal(fila.monto_observado, 0)
  assert.deepEqual(JSON.parse(fila.casillas_json), [{ codigo: '89', monto: 22790604 }])
  assert.equal(JSON.parse(fila.indicadores_json).total_a_pagar, 4277873)
  assert.equal(JSON.parse(fila.verificaciones_json)[0].ok, true)

  // Segundo período sin Formulario Compacto: se guarda el estado igual, sin
  // casillas, y se informa false para las métricas.
  const sinCompacto = decl.guardarFormularioF29(db, {
    empresaId: eid, rut: '77255326-9', periodo: '202510',
    fila: { folio: '999', estado: 'Vigente' },
    estado: {},
    compacto: { ok: false, error: 'sin visor' },
  })
  assert.equal(sinCompacto, false)
  const otra = db.prepare(`SELECT * FROM f29_formularios WHERE empresa_id = ? AND periodo = '202510'`).get(eid)
  assert.ok(otra)
  assert.deepEqual(JSON.parse(otra.casillas_json), [])
})

test('D7: las declaraciones juradas se leen por año y el informe las muestra', () => {
  const eid = empresa('78478611-0')
  const anio = {
    anio: '2026',
    estado: 'con_declaraciones',
    presentadas: [{
      dj: '1947',
      titulo: 'Base Imponible de Primera Categoría',
      estado: 'Aceptada',
      presentada: true,
      folio: '2089291',
      fecha_presentacion: '2026-03-22',
      fecha_vencimiento: '2026-03-27',
      tipo_declaracion: 'Original',
      clasificacion: 'Regimen Pro Pyme Transparente (14D N° 8)',
      codigo_riac: '14TT',
    }],
  }
  const guardados = dj.guardar(db, { empresaId: eid, rut: '78478611-0', anios: [anio] })
  assert.equal(guardados, 1)

  const inf = salud.construirInforme(db, { empresaId: eid, periodo: '202610', meses: 3 })
  assert.equal(inf.declaraciones_juradas.estado, 'disponible')
  assert.equal(inf.declaraciones_juradas.total_presentadas, 1)
  assert.equal(inf.declaraciones_juradas.presentadas[0].dj, '1947')
  assert.equal(inf.declaraciones_juradas.presentadas[0].anio, '2026')
  assert.equal(inf.declaraciones_juradas.observadas, 0)
  const anual = inf.declaraciones_anuales.anios.find((a) => a.anio === '2026')
  assert.ok(anual.juradas, 'el año trae sus juradas')
  assert.equal(anual.juradas.total, 1)

  // Una DJ observada sí es un hallazgo, con el estado VERBATIM del SII.
  const eid2 = empresa('96987654-K')
  dj.guardar(db, {
    empresaId: eid2, rut: '96987654-K',
    anios: [{
      anio: '2026',
      estado: 'con_declaraciones',
      presentadas: [{ dj: '1887', estado: 'Observada', folio: '1', fecha_presentacion: '2026-03-20' }],
      // DJ aplicable sin presentación registrada y con plazo vencido.
      pendientes: [{ dj: '1947', titulo: 'Base Imponible', estado: '', folio: null, fecha_vencimiento: '2025-03-27' }],
    }],
  })
  const inf2 = salud.construirInforme(db, { empresaId: eid2, periodo: '202610', meses: 3 })
  const h = inf2.opinion.hallazgos.find((x) => x.codigo === 'DJ_OBSERVADA')
  assert.ok(h)
  assert.match(h.detalle, /Observada/)
  const hp = inf2.opinion.hallazgos.find((x) => x.codigo === 'DJ_PENDIENTE')
  assert.ok(hp, 'una DJ vencida sin presentación es un hallazgo')
  assert.equal(hp.severidad, 'alta')
  assert.equal(inf2.declaraciones_juradas.total_pendientes, 1)
  assert.equal(inf2.declaraciones_juradas.vencidas, 1)
  assert.equal(inf2.declaraciones_juradas.pendientes[0].dj, '1947')
})

test('D2b: detalle tolerante (mes/año, año solo, sin inventar filas)', () => {
  const detalle = deuda.parsearDetalle([
    'Formulario 29            04/2025        $1.250.000',
    'F29                      2025-05        980.500',
    'Giro 123456                 2024        400.000',
    'Reajustes e intereses                    210.500',
    'TOTAL A PAGAR                          2.841.000',
    'Cuota convenio 1/12      03/2026        150.000',
  ])
  assert.equal(detalle.length, 4)
  assert.deepEqual(detalle.map((d) => d.periodo), ['202504', '202505', '2024', '202603'])
  assert.deepEqual(detalle.map((d) => d.monto), [1250000, 980500, 400000, 150000])
  assert.equal(detalle[0].documento, 'F29')
  assert.ok(detalle[2].documento.includes('Giro'))
  // Una línea sin período no es una fila de deuda.
  assert.ok(!detalle.some((d) => /Reajustes/.test(d.glosa)))
})

test('D8: el parser de fechas y montos tolera el formato chileno', () => {
  assert.equal(deuda.montoDeTexto('$1.460.500'), 1460500)
  assert.equal(deuda.montoDeTexto('—'), null)
  assert.equal(deuda.fechaISO('22-10-2026'), '2026-10-22')
  assert.equal(deuda.fechaISO(''), null)
})
