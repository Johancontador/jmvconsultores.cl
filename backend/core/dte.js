/**
 * ADAPTADOR DTE REAL — factura electrónica (tipo 33) de la suscripción vía
 * @devlas/dte-sii (librería chilena open-source: genera, timbra, firma y
 * envía el DTE al SII por SOAP; consultar el track-id por el mismo envío).
 *
 * La dependencia se requiere LAZY dentro de la función: el sistema arranca y
 * todo lo demás funciona aunque esta librería no esté instalada — solo la
 * EMISIÓN de facturas exige configuración completa.
 *
 * Configuración (env):
 *   DTE_CERT_PFX        — ruta del certificado .pfx (firma electrónica) o su base64
 *   DTE_CERT_PASS       — contraseña del certificado
 *   DTE_CAF_XML         — ruta del CAF tipo 33 (folios autorizados) o su contenido
 *   DTE_RUT_EMISOR      — RUT de JMV Consultores (emisor de la factura)
 *   DTE_RAZON_SOCIAL, DTE_GIRO, DTE_DIRECCION, DTE_COMUNA, DTE_ACTECO
 *   DTE_FCH_RESOL, DTE_NRO_RESOL — resolución de autorización del SII
 *   DTE_AMBIENTE        — 'certificacion' | 'produccion' (default certificación)
 *
 * Interfaz que implementa (ver core/facturas-suscripcion.js):
 *   emitirFactura({ emisor, receptor, folio, items, monto_neto, monto_iva, monto_total })
 *     → { folio, xml, track_id }
 */

function configFaltante() {
  const requeridas = [
    'DTE_CERT_PFX', 'DTE_CERT_PASS', 'DTE_CAF_XML',
    'DTE_RUT_EMISOR', 'DTE_RAZON_SOCIAL', 'DTE_GIRO',
    'DTE_DIRECCION', 'DTE_COMUNA', 'DTE_ACTECO',
    'DTE_FCH_RESOL', 'DTE_NRO_RESOL',
  ]
  return requeridas.filter((k) => !process.env[k])
}

/** Datos del emisor (JMV) desde env — lanza con la lista EXACTA de lo que falta. */
function emisorDesdeEnv() {
  const faltantes = configFaltante()
  if (faltantes.length) {
    throw new Error(`Emisor DTE no configurado: faltan variables de entorno (${faltantes.join(', ')}) — JMV debe tener firma electrónica, CAF de folios 33 y resolución SII`)
  }
  return {
    rut: process.env.DTE_RUT_EMISOR,
    razon_social: process.env.DTE_RAZON_SOCIAL,
    giro: process.env.DTE_GIRO,
    direccion: process.env.DTE_DIRECCION,
    comuna: process.env.DTE_COMUNA,
    actividad_economica: Number(process.env.DTE_ACTECO),
    resolucion: { fecha: process.env.DTE_FCH_RESOL, numero: Number(process.env.DTE_NRO_RESOL) },
  }
}

function cargarArchivo(entrada) {
  if (!entrada) return null
  // Ruta existente → leer; si no existe el path, asumimos base64 crudo.
  const fs = require('fs')
  if (fs.existsSync(entrada)) return fs.readFileSync(entrada)
  return Buffer.from(entrada, 'base64')
}

/** Emisión real: DTE → timbrar (CAF) → firmar (certificado) → enviar al SII. */
async function emitirFactura({ emisor, receptor, folio, items, monto_neto, monto_iva, monto_total }) {
  // Lazy: solo la emisión exige la librería instalada.
  let lib
  try {
    lib = require('@devlas/dte-sii')
  } catch (err) {
    throw new Error(`Emisor DTE no instalado: npm install @devlas/dte-sii (${err.code || err.message})`)
  }
  const { Certificado, CAF, DTE, EnvioDTE, EnviadorSII } = lib

  const pfx = cargarArchivo(process.env.DTE_CERT_PFX)
  const cafXml = cargarArchivo(process.env.DTE_CAF_XML)
  const cert = new Certificado(pfx, process.env.DTE_CERT_PASS)
  const caf = new CAF(cafXml)
  if (!caf.isFolioValido(folio)) {
    throw new Error(`Folio ${folio} fuera del rango autorizado del CAF (${caf.getFolioDesde()}–${caf.getFolioHasta()})`)
  }

  // Formas exigidas por @devlas/dte-sii v2.36 (formato simplificado): claves
  // nativas del XSD del SII — RUTEmisor/RznSoc/GiroEmis/DirOrigen/CmnaOrigen/
  // Acteco, RUTRecep/RznSocRecep/GiroRecep/DirRecep/CmnaRecep e ítems
  // { NmbItem, QtyItem, PrcItem }. (Antes se pasaban claves camelCase que la
  // librería no reconoce: el XML salía con emisor vacío y receptor
  // 'Consumidor Final' — bug latente: la emisión real nunca había corrido
  // pendiente las credenciales. BLOQUE 2.)
  const dte = new DTE({
    tipo: 33,
    folio,
    emisor: {
      RUTEmisor: emisor.rut,
      RznSoc: emisor.razon_social,
      GiroEmis: emisor.giro,
      DirOrigen: emisor.direccion,
      CmnaOrigen: emisor.comuna,
      ...(emisor.actividad_economica ? { Acteco: emisor.actividad_economica } : {}),
    },
    receptor: {
      RUTRecep: receptor.rut,
      RznSocRecep: receptor.razon_social,
      ...(receptor.giro ? { GiroRecep: receptor.giro } : {}),
      DirRecep: receptor.direccion,
      CmnaRecep: receptor.comuna,
    },
    items: items.map((i) => ({ NmbItem: i.nombre, QtyItem: i.cantidad, PrcItem: i.precio })),
    resolucion: {
      fecha: emisor.resolucion.fecha,
      numero: emisor.resolucion.numero,
    },
  })

  dte.generarXML().timbrar(caf).firmar(cert)

  const envio = new EnvioDTE({ certificado: cert })
  envio.agregar(dte)
  envio.setCaratula({
    RutEmisor: emisor.rut,
    RutReceptor: '60803000-K', // RUT del SII para envíos propios
    FchResol: emisor.resolucion.fecha,
    NroResol: emisor.resolucion.numero,
  })
  envio.generar()

  const ambiente = process.env.DTE_AMBIENTE === 'produccion' ? 'produccion' : 'certificacion'
  const enviador = new EnviadorSII(cert, ambiente)
  const resultado = await enviador.enviarDteSoap(envio)
  if (!resultado || !resultado.trackId) {
    throw new Error(`El SII no devolvió track-id: ${JSON.stringify(resultado).slice(0, 300)}`)
  }
  return { folio, xml: dte.getXML(), track_id: resultado.trackId }
}

module.exports = { configFaltante, emisorDesdeEnv, emitirFactura }
