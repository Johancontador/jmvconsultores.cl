/**
 * EMISIÓN DE DTE PARA EMPRESAS CLIENTES — BLOQUE 2 (fase 1 del handoff).
 *
 * Cada empresa cliente del SaaS emite SUS documentos: Factura (33),
 * Factura Exenta (34), Nota de Débito (56) y Nota de Crédito (61), con
 * certificado de firma, CAFs de folios y resolución SII PROPIOS.
 *
 * Principios (mismos del proyecto):
 *  - Honestidad (§42): lo que falta se NOMINA, jamás se adivina. Sin CAF del
 *    tipo, sin certificado, sin resolución → la emisión se rechaza nombrando
 *    exactamente qué falta.
 *  - NO inventar estados SII: los códigos que devuelve el SII (EPR, RPR, DOK,
 *    FAU…) se guardan VERBATIM en dte_emitidos.sii_codigo/sii_respuesta_json.
 *    La clasificación exitoso/rechazado la calcula la librería (@devlas/dte-sii,
 *    tabla oficial QueryEstUp). `estado` en BD es SOLO el ciclo de vida local:
 *    PENDIENTE → ENVIADO → ACEPTADO | RECHAZADO (ERROR si el envío nunca partió).
 *  - Secretos cifrados (BLOQUE 1): certificado .pfx, contraseña y XML de cada
 *    CAF (contiene la CLAVE PRIVADA de los folios) viven cifrados v1: en la
 *    bóveda (core/boveda.js) — jamás en texto plano ni en logs/auditoría.
 *  - Folios: secuencia local por empresa+tipo (MAX(folio)+1, arrancando en el
 *    folio_desde del primer CAF), validada contra el rango del CAF. Si el
 *    siguiente folio cae en un hueco entre CAFs → error NOMBRANDO el hueco.
 *  - Adaptador INYECTABLE (mismo patrón que facturas-suscripcion): los tests
 *    jamás tocan la red; el adaptador real carga @devlas/dte-sii LAZY.
 *  - Auditoría: toda operación se registra SIN secretos y SIN el XML completo.
 *
 * Contrato del adaptador inyectable:
 *   emitirDTE({ emisor, receptor, tipo, folio, items, referencia, montos,
 *               certPfx, certPass, cafXml, ambiente, fechaEmision })
 *     → { folio, xml, track_id, sii_respuesta }   (lanza si el SII rechaza)
 *   consultarEstadoDTE({ trackId, rutEmisor, certPfx, certPass, ambiente })
 *     → respuesta VERBATIM del SII + { esExitoso, esRechazado } de la librería
 */

const { cifrar, descifrar } = require('./boveda')
const { registrarAccion } = require('./auditoria')
const { validarRut, normalizarRut } = require('./empresas')
const { TASA_IVA } = require('./facturas-suscripcion')

/** Tipos emitibles. FUENTE: formato DTE del SII (EnvioDTE_v10.xsd). */
const TIPOS_DTE = {
  33: 'Factura Electrónica',
  34: 'Factura Exenta Electrónica',
  56: 'Nota de Débito Electrónica',
  61: 'Nota de Crédito Electrónica',
}

/** Códigos de referencia de NC/ND. FUENTE: formato DTE del SII (<CodRef> del
 *  elemento Referencia): 1 = Anula documento, 2 = Corrige texto, 3 = Corrige montos. */
const COD_REF = { 1: 'Anula documento de referencia', 2: 'Corrige texto', 3: 'Corrige montos' }

const AMBIENTES = ['certificacion', 'produccion']
const ESTADOS_LOCALES = ['PENDIENTE', 'ENVIADO', 'ACEPTADO', 'RECHAZADO', 'ERROR']

function esTipoValido(tipo) {
  return Object.prototype.hasOwnProperty.call(TIPOS_DTE, Number(tipo))
}

function esNota(tipo) {
  return Number(tipo) === 56 || Number(tipo) === 61
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

// ============================================================
// Configuración del emisor (dte_config)
// ============================================================

/** Ficha pública SIN secretos (para GET/UI): solo flags de presencia. */
function configPublica(db, empresaId) {
  const fila = db.prepare(`SELECT * FROM dte_config WHERE empresa_id = ?`).get(empresaId)
  if (!fila) return null
  const { cert_pfx, cert_pass, ...publica } = fila
  return { ...publica, tiene_certificado: Boolean(cert_pfx) }
}

/** Config descifrada — SOLO para emitir. Jamás devolver por HTTP. */
function obtenerConfigDescifrada(db, empresaId) {
  const fila = db.prepare(`SELECT * FROM dte_config WHERE empresa_id = ?`).get(empresaId)
  if (!fila) return null
  return {
    ...fila,
    cert_pfx: fila.cert_pfx ? descifrar(fila.cert_pfx) : null,
    cert_pass: fila.cert_pass ? descifrar(fila.cert_pass) : null,
  }
}

/**
 * Guarda la ficha del emisor. Campos undefined = sin cambio; null = limpiar.
 * cert_pfx (base64 del .pfx) y cert_pass se CIFRAN (bóveda v1). Auditoría sin
 * secretos: registra qué campos cambió y si el certificado se actualizó.
 */
function guardarConfig(db, { empresaId, usuarioId, campos = {}, ip = null }) {
  if (!db.prepare(`SELECT 1 FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)) {
    throw new Error('Empresa no encontrada')
  }
  const updatable = {}
  for (const k of ['razon_social', 'giro', 'direccion', 'comuna', 'acteco', 'fch_resol', 'nro_resol']) {
    if (campos[k] !== undefined) {
      const v = campos[k] === null ? null : String(campos[k]).trim() || null
      updatable[k] = v
    }
  }
  if (campos.ambiente !== undefined) {
    if (!AMBIENTES.includes(campos.ambiente)) {
      throw new Error(`Ambiente inválido: '${campos.ambiente}' — debe ser 'certificacion' o 'produccion'`)
    }
    updatable.ambiente = campos.ambiente
  }
  if (updatable.fch_resol && !/^\d{4}-\d{2}-\d{2}$/.test(updatable.fch_resol)) {
    throw new Error('FchResol inválida: use el formato YYYY-MM-DD (ej: 2024-01-15)')
  }
  if (updatable.nro_resol && !/^\d+$/.test(updatable.nro_resol)) {
    throw new Error('NroResol inválido: debe ser un número entero (0 en ambiente de certificación)')
  }
  if (updatable.acteco && !/^\d+$/.test(updatable.acteco)) {
    throw new Error('ACTECO inválido: debe ser el código numérico de actividad económica del SII')
  }
  if (campos.cert_pfx !== undefined) updatable.cert_pfx = campos.cert_pfx ? cifrar(String(campos.cert_pfx)) : null
  if (campos.cert_pass !== undefined) updatable.cert_pass = campos.cert_pass ? cifrar(String(campos.cert_pass)) : null

  if (!Object.keys(updatable).length) throw new Error('No hay campos para actualizar')

  const existe = db.prepare(`SELECT id FROM dte_config WHERE empresa_id = ?`).get(empresaId)
  const tx = db.transaction(() => {
    if (existe) {
      const sets = Object.keys(updatable).map((k) => `${k} = @${k}`).join(', ')
      db.prepare(`UPDATE dte_config SET ${sets}, actualizado_en = datetime('now') WHERE empresa_id = @empresa_id`)
        .run({ ...updatable, empresa_id: empresaId })
    } else {
      const cols = ['empresa_id', ...Object.keys(updatable)]
      db.prepare(`INSERT INTO dte_config (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`)
        .run({ empresa_id: empresaId, ...updatable })
    }
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'dte.config.guardar', entidad: 'dte_config', entidadId: String(empresaId),
      despues: {
        campos: Object.keys(updatable).filter((k) => k !== 'cert_pass'),
        cert_actualizado: updatable.cert_pfx !== undefined ? Boolean(updatable.cert_pfx) : undefined,
        ambiente: updatable.ambiente,
      },
      ip,
    })
  })
  tx()
  return configPublica(db, empresaId)
}

// ============================================================
// CAFs de folios (dte_folios)
// ============================================================

/**
 * Carga un CAF (XML del SII) para la empresa. Lo parsea con la librería
 * (lazy) para validar estructura y extraer tipo/rango; valida que el RUT del
 * CAF sea el de la empresa; lo guarda CIFRADO (contiene la clave privada de
 * los folios). Cargar el MISMO rango de nuevo es idempotente (update).
 */
function guardarCaf(db, { empresaId, usuarioId, cafXml, ip = null }) {
  const empresa = db.prepare(`SELECT rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  if (!cafXml || !String(cafXml).trim()) throw new Error('caf_xml es obligatorio (XML del CAF descargado del SII)')

  let caf
  try {
    const { CAF } = require('@devlas/dte-sii')
    caf = new CAF(String(cafXml))
  } catch (err) {
    throw new Error(`CAF inválido: ${err.message}`)
  }
  if (normalizarRut(caf.getRutEmisor()) !== normalizarRut(empresa.rut)) {
    throw new Error(`El CAF pertenece al RUT ${caf.getRutEmisor()} y la empresa es ${empresa.rut} — cada empresa emite con SUS folios`)
  }
  const tipo = caf.getTipoDTE()
  if (!esTipoValido(tipo)) {
    throw new Error(`El CAF es de tipo ${tipo} — el sistema emite: ${Object.keys(TIPOS_DTE).join(', ')}`)
  }
  const folioDesde = caf.getFolioDesde()
  const folioHasta = caf.getFolioHasta()
  if (folioHasta < folioDesde) throw new Error(`CAF con rango inválido: ${folioDesde}–${folioHasta}`)

  const xmlCifrado = cifrar(String(cafXml))
  const tx = db.transaction(() => {
    const dup = db.prepare(`
      SELECT id FROM dte_folios WHERE empresa_id = ? AND tipo_dte = ? AND folio_desde = ? AND folio_hasta = ?
    `).get(empresaId, tipo, folioDesde, folioHasta)
    let id
    if (dup) {
      db.prepare(`UPDATE dte_folios SET caf_xml = ?, activo = 1 WHERE id = ?`).run(xmlCifrado, dup.id)
      id = dup.id
    } else {
      id = db.prepare(`
        INSERT INTO dte_folios (empresa_id, tipo_dte, rut_emisor, folio_desde, folio_hasta, caf_xml)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(empresaId, tipo, empresa.rut, folioDesde, folioHasta, xmlCifrado).lastInsertRowid
    }
    registrarAccion(db, {
      empresaId, usuarioId, accion: 'dte.caf.guardar', entidad: 'dte_folios', entidadId: String(id),
      despues: { tipo_dte: tipo, folio_desde: folioDesde, folio_hasta: folioHasta, idempotente: Boolean(dup) },
      ip,
    })
    return id
  })
  const id = tx()
  return { id, tipo_dte: tipo, folio_desde: folioDesde, folio_hasta: folioHasta }
}

/** Metadatos de los CAFs cargados — JAMÁS el caf_xml (clave privada). */
function listarFolios(db, empresaId) {
  return db.prepare(`
    SELECT f.id, f.tipo_dte, f.rut_emisor, f.folio_desde, f.folio_hasta, f.activo, f.creado_en,
           (SELECT COUNT(*) FROM dte_emitidos d
             WHERE d.empresa_id = f.empresa_id AND d.tipo_dte = f.tipo_dte
               AND d.folio BETWEEN f.folio_desde AND f.folio_hasta) AS folios_usados
    FROM dte_folios f
    WHERE f.empresa_id = ?
    ORDER BY f.tipo_dte ASC, f.folio_desde ASC
  `).all(empresaId)
}

/**
 * Siguiente folio para (empresa, tipo): MAX(folio emitido)+1, arrancando en el
 * folio_desde del primer CAF activo. Devuelve { ok:true, caf, folio } o
 * { ok:false, razon } NOMBRANDO el hueco — jamás salta folios en silencio.
 */
function siguienteFolio(db, empresaId, tipo) {
  const cafs = db.prepare(`
    SELECT * FROM dte_folios WHERE empresa_id = ? AND tipo_dte = ? AND activo = 1 ORDER BY folio_desde ASC
  `).all(empresaId, Number(tipo))
  if (!cafs.length) {
    return { ok: false, razon: `Sin CAF de folios tipo ${tipo} (${TIPOS_DTE[Number(tipo)] || tipo}) — descárguelo del SII y cárguelo en el sistema` }
  }
  const ultimo = db.prepare(`
    SELECT MAX(folio) AS f FROM dte_emitidos WHERE empresa_id = ? AND tipo_dte = ?
  `).get(empresaId, Number(tipo)).f || 0
  const candidato = Math.max(ultimo + 1, cafs[0].folio_desde)
  const caf = cafs.find((c) => candidato >= c.folio_desde && candidato <= c.folio_hasta)
  if (!caf) {
    const rangos = cafs.map((c) => `${c.folio_desde}–${c.folio_hasta}`).join(', ')
    return { ok: false, razon: `El siguiente folio (${candidato}) no está cubierto por ningún CAF activo del tipo ${tipo} (rangos cargados: ${rangos}) — reobtenga folios en el SII cubriendo ese hueco` }
  }
  return { ok: true, caf, folio: candidato }
}

// ============================================================
// Faltantes (honestidad §42): qué falta para emitir, por tipo
// ============================================================

function faltantesPorTipo(db, empresaId, tipos = Object.keys(TIPOS_DTE).map(Number)) {
  const empresa = db.prepare(`SELECT razon_social_sii, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  const fila = db.prepare(`SELECT * FROM dte_config WHERE empresa_id = ?`).get(empresaId)

  const base = []
  if (!fila) {
    base.push(
      'certificado de firma electrónica (.pfx)',
      'contraseña del certificado',
      'fecha de resolución SII (FchResol)',
      'número de resolución SII (NroResol)',
      'giro del emisor',
      'dirección del emisor',
      'comuna del emisor',
      'código de actividad económica (ACTECO)',
    )
  } else {
    const razonSocial = fila.razon_social || empresa.razon_social_sii || empresa.nombre
    if (!razonSocial) base.push('razón social del emisor')
    if (!fila.giro) base.push('giro del emisor')
    if (!fila.direccion) base.push('dirección del emisor')
    if (!fila.comuna) base.push('comuna del emisor')
    if (!fila.acteco) base.push('código de actividad económica (ACTECO)')
    if (!fila.fch_resol) base.push('fecha de resolución SII (FchResol)')
    if (fila.nro_resol === null || fila.nro_resol === undefined || fila.nro_resol === '') {
      base.push('número de resolución SII (NroResol)')
    }
    if (!fila.cert_pfx) base.push('certificado de firma electrónica (.pfx)')
    if (!fila.cert_pass) base.push('contraseña del certificado')
  }

  const out = {}
  for (const t of tipos) {
    const tieneCaf = fila && db.prepare(`
      SELECT 1 FROM dte_folios WHERE empresa_id = ? AND tipo_dte = ? AND activo = 1 LIMIT 1
    `).get(empresaId, Number(t))
    out[t] = [...base, ...(tieneCaf ? [] : [`CAF de folios tipo ${t} (${TIPOS_DTE[Number(t)] || t})`])]
  }
  return out
}

// ============================================================
// F5-D — CERTIFICADO DE FIRMA: vigencia e identidad (LOCAL, sin red)
//
// Antes de F5 la emisión no comprobaba NADA del certificado: uno vencido, de
// otro RUT o imposible de descifrar llegaba hasta el adaptador y fallaba allá
// (o, peor, firmaba con el certificado equivocado si el adaptador no valida).
// Este chequeo es local: parsea el .pfx con la librería del SII, lee `notAfter`
// y extrae el RUT del firmante. NO consulta al SII: la identidad se compara
// contra `empresas.rut`, y la comparación con la ficha oficial queda como
// condición NO VERIFICADA (ver docs/handoff-integral/25).
// ============================================================

/**
 * Estado del certificado del emisor. Devuelve SOLO metadatos: jamás el pfx, la
 * contraseña ni la clave privada.
 * @returns {{estado:string, bloqueante:boolean, motivo:string|null, rut:string|null,
 *            dias:number|null, vence:string|null, ambiente:string|null}}
 */
function estadoCertificado(db, empresaId, { margenDias = 30 } = {}) {
  const empresa = db.prepare(`SELECT rut FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  const fila = db.prepare(`SELECT cert_pfx, cert_pass, ambiente FROM dte_config WHERE empresa_id = ?`).get(empresaId)
  const base = { rut: null, dias: null, vence: null, ambiente: fila ? fila.ambiente : null }

  if (!fila || !fila.cert_pfx) {
    return { ...base, estado: 'ausente', bloqueante: false, motivo: 'Sin certificado de firma cargado' }
  }

  let pfx
  let pass
  try {
    pfx = Buffer.from(descifrar(fila.cert_pfx), 'base64')
    pass = descifrar(fila.cert_pass)
  } catch {
    return {
      ...base, estado: 'indescifrable', bloqueante: true,
      motivo: 'El certificado o su contraseña no se pudieron descifrar con la clave maestra vigente (¿cambió SECRETOS_MASTER_KEY?)',
    }
  }

  let datos
  try {
    const { loadPfxFromBuffer, isCertificateExpired, getDaysUntilExpiry } = require('@devlas/dte-sii')
    datos = loadPfxFromBuffer(pfx, pass)
    const dias = getDaysUntilExpiry(datos.notAfter)
    const vencido = isCertificateExpired(datos.notAfter)
    const rutCert = datos.rut || null
    const coincide = rutCert ? normalizarRut(rutCert) === normalizarRut(empresa.rut) : null
    const meta = {
      ...base,
      rut: rutCert,
      dias,
      vence: new Date(datos.notAfter).toISOString().slice(0, 10),
    }

    if (vencido) {
      return { ...meta, estado: 'vencido', bloqueante: true, motivo: `El certificado de firma venció el ${meta.vence}` }
    }
    if (coincide === false) {
      return {
        ...meta, estado: 'rut_no_coincide', bloqueante: true,
        motivo: `El certificado pertenece al RUT ${rutCert} y la empresa emisora es ${empresa.rut}`,
      }
    }
    if (coincide === null) {
      // El .pfx no declara RUT: no se puede afirmar identidad. Se emite en
      // certificación (mock), pero en producción se bloquea por precaución.
      return {
        ...meta, estado: 'identidad_no_verificada', bloqueante: false,
        motivo: 'El certificado no declara RUT en su subject: identidad del emisor NO VERIFICADA',
      }
    }
    if (dias <= margenDias) {
      return { ...meta, estado: 'por_vencer', bloqueante: false, motivo: `El certificado vence en ${dias} día(s)` }
    }
    return { ...meta, estado: 'vigente', bloqueante: false, motivo: null }
  } catch (err) {
    return {
      ...base,
      estado: 'invalido',
      bloqueante: false,
      motivo: `El certificado no se pudo leer (${String(err.message || err).slice(0, 120)})`,
    }
  }
}

/**
 * Puerta previa a la emisión: lanza si una condición demostrable la bloquea.
 * Deja pasar `invalido` en certificación (los tests y los mocks usan .pfx
 * ficticios) pero lo bloquea en producción, donde un certificado ilegible
 * jamás debe intentar emitir.
 */
function exigirCertificadoEmisor(db, empresaId) {
  const cert = estadoCertificado(db, empresaId)
  if (cert.bloqueante) throw new Error(`Emisión bloqueada: ${cert.motivo}`)
  const prod = (cert.ambiente || '') === 'produccion'
  if (prod && (cert.estado === 'invalido' || cert.estado === 'identidad_no_verificada')) {
    throw new Error(`Emisión bloqueada en producción: ${cert.motivo}. Cargue un certificado vigente del RUT emisor (Configuración del Emisor).`)
  }
  return cert
}

// ============================================================
// Validaciones del documento (lo inválido se NOMINA)
// ============================================================

function calcularMontos(items, tipo) {
  let neto = 0
  let exento = 0
  for (const it of items) {
    const monto = Math.round(Number(it.cantidad) * Number(it.precio))
    if (Number(tipo) === 34 || it.exento) exento += monto
    else neto += monto
  }
  // Tasa general de IVA — FUENTE: D.L. 825 (Ley 21.210), 19% (definida con cita en facturas-suscripcion).
  const iva = neto > 0 ? Math.round(neto * TASA_IVA) : 0
  return { monto_neto: neto, monto_exento: exento, monto_iva: iva, monto_total: neto + iva + exento }
}

function validarItems(items) {
  if (!Array.isArray(items) || items.length === 0) return ['al menos un ítem (items)']
  const errores = []
  items.forEach((it, i) => {
    const n = i + 1
    if (!it || !it.nombre || !String(it.nombre).trim()) errores.push(`ítem ${n}: nombre obligatorio`)
    else if (String(it.nombre).length > 80) errores.push(`ítem ${n}: el nombre supera 80 caracteres (límite NmbItem del XSD del SII)`)
    if (!Number.isFinite(Number(it && it.cantidad)) || Number(it.cantidad) <= 0) errores.push(`ítem ${n}: cantidad debe ser > 0`)
    if (!Number.isFinite(Number(it && it.precio)) || Number(it.precio) < 0) errores.push(`ítem ${n}: precio debe ser ≥ 0`)
  })
  return errores
}

function validarReceptor(receptor) {
  const r = receptor || {}
  const faltantes = []
  if (!r.rut || !validarRut(String(r.rut))) faltantes.push('RUT del receptor (válido)')
  if (!r.razon_social) faltantes.push('razón social del receptor')
  if (!r.giro) faltantes.push('giro del receptor')
  if (!r.direccion) faltantes.push('dirección del receptor')
  if (!r.comuna) faltantes.push('comuna del receptor')
  return faltantes
}

function validarReferencia(ref) {
  if (!ref || typeof ref !== 'object') {
    return ['referencia obligatoria para nota de crédito/débito: { TpoDocRef, FolioRef, CodRef, RazonRef } (qué documento corrige)']
  }
  const errores = []
  if (!Number.isInteger(Number(ref.TpoDocRef)) || Number(ref.TpoDocRef) <= 0) errores.push('referencia.TpoDocRef (tipo del documento referenciado, ej: 33)')
  if (!Number.isInteger(Number(ref.FolioRef)) || Number(ref.FolioRef) <= 0) errores.push('referencia.FolioRef (folio del documento referenciado)')
  if (!COD_REF[Number(ref.CodRef)]) errores.push(`referencia.CodRef (1 = anula, 2 = corrige texto, 3 = corrige montos — códigos del XSD del SII)`)
  if (ref.FchRef && !/^\d{4}-\d{2}-\d{2}$/.test(String(ref.FchRef))) errores.push('referencia.FchRef (formato YYYY-MM-DD)')
  return errores
}

// ============================================================
// Emisión
// ============================================================

function obtener(db, empresaId, dteId) {
  return db.prepare(`SELECT * FROM dte_emitidos WHERE id = ? AND empresa_id = ?`).get(Number(dteId), empresaId) || null
}

/** BLOQUE 3: fila por clave de idempotencia (o null) — dedupe HTTP de emisión. */
function obtenerPorIdempotencia(db, empresaId, clave) {
  if (clave === null || clave === undefined || clave === '') return null
  return db.prepare(`SELECT * FROM dte_emitidos WHERE empresa_id = ? AND idempotencia = ?`).get(empresaId, String(clave)) || null
}

function listar(db, { empresaId, tipo = null, estado = null, limit = 100, offset = 0 } = {}) {
  const clauses = ['empresa_id = @empresa_id']
  const params = { empresa_id: empresaId, limit: Math.min(Number(limit) || 100, 500), offset: Number(offset) || 0 }
  if (tipo !== null && tipo !== undefined && tipo !== '') {
    if (!esTipoValido(tipo)) throw new Error(`Tipo inválido: ${tipo} — emitibles: 33, 34, 56, 61`)
    clauses.push('tipo_dte = @tipo')
    params.tipo = Number(tipo)
  }
  if (estado !== null && estado !== undefined && estado !== '') {
    if (!ESTADOS_LOCALES.includes(estado)) throw new Error(`Estado inválido: ${estado} — válidos: ${ESTADOS_LOCALES.join(', ')}`)
    clauses.push('estado = @estado')
    params.estado = estado
  }
  return db.prepare(`
    SELECT id, empresa_id, tipo_dte, folio, fecha_emision,
           receptor_rut, receptor_razon_social,
           monto_exento, monto_neto, monto_iva, monto_total,
           estado, track_id, sii_codigo, sii_glosa, intentos, motivo_error,
           documento_id, asiento_id, emitido_por, consultado_en, creado_en, actualizado_en
    FROM dte_emitidos
    WHERE ${clauses.join(' AND ')}
    ORDER BY id DESC
    LIMIT @limit OFFSET @offset
  `).all(params)
}

/**
 * Emite un DTE: valida (nombrando lo inválido), reserva el folio y envía al
 * SII vía el adaptador. documento_id (opcional) liga el DTE con la bandeja.
 * `idempotencia` (opcional, BLOQUE 3): clave provista por el cliente HTTP —
 * re-envío con la misma clave NO duplica DTE (UNIQUE parcial empresa+clave;
 * el route pre-verifica y devuelve la fila existente con deduplicado: true).
 */
async function emitir(db, { empresaId, usuarioId, tipo, items, receptor, referencia = null, documentoId = null, idempotencia = null, dteAdapter, ip = null }) {
  if (!dteAdapter || typeof dteAdapter.emitirDTE !== 'function') {
    throw new Error('Emisor DTE no configurado: falta el adaptador de emisión')
  }
  const tipoN = Number(tipo)
  if (!esTipoValido(tipoN)) throw new Error(`Tipo de DTE inválido: ${tipo} — emitibles: 33, 34, 56, 61`)

  const errores = [...validarItems(items), ...validarReceptor(receptor)]
  if (esNota(tipoN)) errores.push(...validarReferencia(referencia))
  if (errores.length) throw new Error(`Datos del DTE inválidos: ${errores.join('; ')}`)

  const faltantes = faltantesPorTipo(db, empresaId, [tipoN])[tipoN]
  if (faltantes.length) throw new Error(`Emisor DTE no configurado: faltan (${faltantes.join(', ')})`)

  // F5-D: certificado vigente y del RUT emisor (chequeo local, sin red).
  exigirCertificadoEmisor(db, empresaId)

  const folioRes = siguienteFolio(db, empresaId, tipoN)
  if (!folioRes.ok) throw new Error(folioRes.razon)

  let docId = null
  if (documentoId !== null && documentoId !== undefined && documentoId !== '') {
    if (!db.prepare(`SELECT id FROM documentos WHERE id = ? AND empresa_id = ?`).get(Number(documentoId), empresaId)) {
      throw new Error(`Documento de la bandeja ${documentoId} no encontrado en esta empresa`)
    }
    docId = Number(documentoId)
  }

  const montos = calcularMontos(items, tipoN)
  const r = (k) => (receptor && receptor[k] ? String(receptor[k]).trim() : null)
  const fecha = hoyISO()

  // Reserva del folio en transacción (better-sqlite3 es síncrono: sin carreras).
  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO dte_emitidos (empresa_id, tipo_dte, folio, fecha_emision,
        receptor_rut, receptor_razon_social, receptor_giro, receptor_direccion, receptor_comuna,
        monto_exento, monto_neto, monto_iva, monto_total, items_json, referencia_json,
        documento_id, idempotencia, emitido_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      empresaId, tipoN, folioRes.folio, fecha,
      r('rut'), r('razon_social'), r('giro'), r('direccion'), r('comuna'),
      montos.monto_exento, montos.monto_neto, montos.monto_iva, montos.monto_total,
      JSON.stringify(items), referencia ? JSON.stringify(referencia) : null,
      docId, idempotencia === null || idempotencia === undefined || idempotencia === '' ? null : String(idempotencia),
      usuarioId,
    )
    return info.lastInsertRowid
  })
  const id = tx()
  const fila = obtener(db, empresaId, id)
  return _enviar(db, fila, { usuarioId, dteAdapter, ip, accion: 'dte.emitir' })
}

/**
 * Envío real de una fila PENDIENTE (o reintento). Reconstruye el documento
 * desde la fila (snapshot), timbra con el CAF que cubre el folio y firma con
 * el certificado de la empresa. ERROR local si el envío no parte; los
 * rechazos definitivos los clasifica consultarEstado con códigos VERBATIM.
 */
async function _enviar(db, fila, { usuarioId, dteAdapter, ip = null, accion = 'dte.emitir' }) {
  if (!dteAdapter || typeof dteAdapter.emitirDTE !== 'function') {
    throw new Error('Emisor DTE no configurado: falta el adaptador de emisión')
  }
  const config = obtenerConfigDescifrada(db, fila.empresa_id)
  const empresa = db.prepare(`SELECT rut, razon_social_sii, nombre FROM empresas WHERE id = ?`).get(fila.empresa_id)
  const cafRow = db.prepare(`
    SELECT caf_xml FROM dte_folios
    WHERE empresa_id = ? AND tipo_dte = ? AND activo = 1 AND folio_desde <= ? AND folio_hasta >= ?
    ORDER BY folio_desde ASC LIMIT 1
  `).get(fila.empresa_id, fila.tipo_dte, fila.folio, fila.folio)
  if (!cafRow) throw new Error(`Sin CAF activo que cubra el folio ${fila.folio} (tipo ${fila.tipo_dte})`)

  const emisor = {
    rut: empresa.rut,
    razon_social: config.razon_social || empresa.razon_social_sii || empresa.nombre,
    giro: config.giro,
    direccion: config.direccion,
    comuna: config.comuna,
    actividad_economica: Number(config.acteco),
    resolucion: { fecha: config.fch_resol, numero: Number(config.nro_resol) },
  }
  const receptor = {
    rut: fila.receptor_rut,
    razon_social: fila.receptor_razon_social,
    giro: fila.receptor_giro,
    direccion: fila.receptor_direccion,
    comuna: fila.receptor_comuna,
  }
  const items = JSON.parse(fila.items_json || '[]')
  const referencia = fila.referencia_json ? JSON.parse(fila.referencia_json) : null

  let r
  try {
    r = await dteAdapter.emitirDTE({
      emisor, receptor,
      tipo: fila.tipo_dte, folio: fila.folio, items, referencia,
      montos: {
        monto_exento: fila.monto_exento, monto_neto: fila.monto_neto,
        monto_iva: fila.monto_iva, monto_total: fila.monto_total,
      },
      certPfx: Buffer.from(config.cert_pfx, 'base64'),
      certPass: config.cert_pass,
      cafXml: descifrar(cafRow.caf_xml),
      ambiente: config.ambiente,
      fechaEmision: fila.fecha_emision,
    })
  } catch (err) {
    db.prepare(`
      UPDATE dte_emitidos SET estado = 'ERROR', motivo_error = ?, intentos = intentos + 1, actualizado_en = datetime('now')
      WHERE id = ?
    `).run(String(err.message).slice(0, 500), fila.id)
    const intentos = db.prepare(`SELECT intentos FROM dte_emitidos WHERE id = ?`).get(fila.id).intentos
    registrarAccion(db, {
      empresaId: fila.empresa_id, usuarioId, accion: 'dte.error',
      entidad: 'dte_emitidos', entidadId: String(fila.id),
      despues: { tipo_dte: fila.tipo_dte, folio: fila.folio, motivo: String(err.message).slice(0, 200), intentos },
      ip,
    })
    throw err
  }

  if (!r || !r.track_id) {
    const detalle = `El SII no devolvió track-id: ${JSON.stringify(r).slice(0, 300)}`
    db.prepare(`
      UPDATE dte_emitidos SET estado = 'ERROR', motivo_error = ?, intentos = intentos + 1, actualizado_en = datetime('now')
      WHERE id = ?
    `).run(detalle.slice(0, 500), fila.id)
    throw new Error(detalle)
  }

  const siiResp = r.sii_respuesta || null
  db.prepare(`
    UPDATE dte_emitidos SET estado = 'ENVIADO', track_id = ?, sii_codigo = ?, sii_glosa = ?,
      sii_respuesta_json = ?, xml = ?, intentos = intentos + 1, motivo_error = NULL, actualizado_en = datetime('now')
    WHERE id = ?
  `).run(
    r.track_id || null,
    (siiResp && (siiResp.estado ?? siiResp.trackId)) ?? null,
    (siiResp && (siiResp.glosa ?? siiResp.descripcion ?? siiResp.mensaje)) || null,
    siiResp ? JSON.stringify(siiResp).slice(0, 4000) : null,
    r.xml || null,
    fila.id,
  )
  const final = obtener(db, fila.empresa_id, fila.id)
  registrarAccion(db, {
    empresaId: fila.empresa_id, usuarioId, accion,
    entidad: 'dte_emitidos', entidadId: String(fila.id),
    despues: {
      tipo_dte: fila.tipo_dte, folio: fila.folio, track_id: r.track_id,
      estado: 'ENVIADO', monto_total: fila.monto_total, receptor: fila.receptor_rut, intentos: final.intentos,
    },
    ip,
  })
  return final
}

/**
 * Consulta el estado REAL del envío en el SII. La respuesta del SII se guarda
 * VERBATIM (sii_respuesta_json) y la clasificación exitoso/rechazado la hace
 * la librería (tabla oficial QueryEstUp) — aquí jamás se inventa un estado.
 */
async function consultarEstado(db, { empresaId, dteId, usuarioId, dteAdapter, ip = null }) {
  const fila = obtener(db, empresaId, dteId)
  if (!fila) throw new Error('DTE no encontrado')
  if (!fila.track_id) throw new Error('El DTE no tiene track-id: el envío nunca llegó al SII — use reintentar')
  if (!dteAdapter || typeof dteAdapter.consultarEstadoDTE !== 'function') {
    throw new Error('Emisor DTE no configurado: falta el adaptador de consulta de estado')
  }
  const config = obtenerConfigDescifrada(db, empresaId)
  const empresa = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)

  const r = await dteAdapter.consultarEstadoDTE({
    trackId: fila.track_id,
    rutEmisor: empresa.rut,
    certPfx: Buffer.from(config.cert_pfx, 'base64'),
    certPass: config.cert_pass,
    ambiente: config.ambiente,
  })
  if (!r) throw new Error('El SII no respondió a la consulta de estado')

  // Clasificación de la LIBRERÍA (esExitoso/esRechazado sobre códigos oficiales).
  const estado = r.esExitoso ? 'ACEPTADO' : (r.esRechazado ? 'RECHAZADO' : fila.estado)
  db.prepare(`
    UPDATE dte_emitidos SET estado = ?, sii_codigo = ?, sii_glosa = ?, sii_respuesta_json = ?,
      consultado_en = datetime('now'), actualizado_en = datetime('now')
    WHERE id = ?
  `).run(
    estado,
    r.estado ?? null,
    (r.descripcion ?? r.glosa ?? r.mensaje) || null,
    JSON.stringify(r).slice(0, 4000),
    fila.id,
  )
  registrarAccion(db, {
    empresaId, usuarioId, accion: 'dte.estado.consultar',
    entidad: 'dte_emitidos', entidadId: String(fila.id),
    despues: { estado_sii: r.estado ?? null, estado_local: estado, folio: fila.folio, tipo_dte: fila.tipo_dte },
    ip,
  })
  return obtener(db, empresaId, fila.id)
}

/**
 * Reintento del envío con el MISMO folio. Permitido cuando el DTE no llegó
 * (PENDIENTE/ERROR) o el SOBRE fue rechazado (RECHAZADO por schema/firma —
 * el folio no se consumió; si estuviera usado, el SII lo dirá: es la fuente
 * de verdad). Jamás se reenvía un DTE ENVIADO/ACEPTADO.
 */
async function reintentar(db, { empresaId, dteId, usuarioId, dteAdapter, ip = null }) {
  const fila = obtener(db, empresaId, dteId)
  if (!fila) throw new Error('DTE no encontrado')
  if (!['PENDIENTE', 'ERROR', 'RECHAZADO'].includes(fila.estado)) {
    throw new Error(`No se puede reintentar un DTE en estado ${fila.estado} (solo PENDIENTE, ERROR o RECHAZADO)`)
  }
  return _enviar(db, fila, { usuarioId, dteAdapter, ip, accion: 'dte.reintentar' })
}

// ============================================================
// Adaptador real (@devlas/dte-sii — LAZY: el sistema funciona sin él;
// solo la emisión exige la librería instalada y configurada).
//
// Formas de la librería v2.36: emisor/receptor con claves nativas del SII
// (RUTEmisor/RznSoc/GiroEmis/DirOrigen/CmnaOrigen/Acteco y
// RUTRecep/RznSocRecep/GiroRecep/DirRecep/CmnaRecep) e ítems
// { NmbItem, QtyItem, PrcItem, IndExe }.
// ============================================================

function _libreria() {
  try {
    return require('@devlas/dte-sii')
  } catch (err) {
    throw new Error(`Emisor DTE no instalado: npm install @devlas/dte-sii (${err.code || err.message})`)
  }
}

/**
 * Genera + timbra + firma el XML del DTE (SIN red — testeable offline).
 * Devuelve { xml, dte, cert, caf }.
 */
function generarXMLDTE({ tipo, folio, fechaEmision, emisor, receptor, items, referencia, certPfx, certPass, cafXml }) {
  const lib = _libreria()
  const { Certificado, CAF, DTE } = lib
  const cert = new Certificado(certPfx, certPass)
  const caf = new CAF(cafXml)
  if (!caf.isFolioValido(folio)) {
    throw new Error(`Folio ${folio} fuera del rango autorizado del CAF (${caf.getFolioDesde()}–${caf.getFolioHasta()})`)
  }
  const dte = new DTE({
    tipo: Number(tipo),
    folio,
    fechaEmision,
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
    items: items.map((i) => ({
      NmbItem: i.nombre,
      QtyItem: i.cantidad,
      PrcItem: i.precio,
      ...(i.exento ? { IndExe: 1 } : {}),
    })),
    ...(referencia ? { referencia } : {}),
  })
  dte.generarXML().timbrar(caf).firmar(cert)
  return { xml: dte.getXML(), dte, cert, caf }
}

/** Adaptador real: XML → sobre → SOAP al SII (track-id). */
function adaptadorReal() {
  return {
    async emitirDTE({ emisor, receptor, tipo, folio, items, referencia, certPfx, certPass, cafXml, ambiente, fechaEmision }) {
      const { xml, dte, cert } = generarXMLDTE({ tipo, folio, fechaEmision, emisor, receptor, items, referencia, certPfx, certPass, cafXml })
      const { EnvioDTE, EnviadorSII } = _libreria()
      const envio = new EnvioDTE({ certificado: cert })
      envio.agregar(dte)
      envio.setCaratula({
        RutEmisor: emisor.rut,
        RutReceptor: '60803000-K', // RUT del SII para envíos propios
        FchResol: emisor.resolucion.fecha,
        NroResol: emisor.resolucion.numero,
      })
      envio.generar()
      const enviador = new EnviadorSII(cert, ambiente === 'produccion' ? 'produccion' : 'certificacion')
      const resultado = await enviador.enviarDteSoap(envio)
      if (!resultado || !resultado.trackId) {
        throw new Error(`El SII no devolvió track-id: ${JSON.stringify(resultado).slice(0, 300)}`)
      }
      return { folio, xml, track_id: resultado.trackId, sii_respuesta: resultado }
    },

    async consultarEstadoDTE({ trackId, rutEmisor, certPfx, certPass, ambiente }) {
      const { Certificado, EnviadorSII } = _libreria()
      const cert = new Certificado(certPfx, certPass)
      const enviador = new EnviadorSII(cert, ambiente === 'produccion' ? 'produccion' : 'certificacion')
      // Respuesta VERBATIM del SII (códigos oficiales QueryEstUp + clasificación de la librería).
      return enviador.consultarEstado(trackId, rutEmisor)
    },
  }
}

module.exports = {
  TIPOS_DTE, COD_REF, AMBIENTES, ESTADOS_LOCALES,
  esTipoValido, esNota,
  configPublica, obtenerConfigDescifrada, guardarConfig,
  guardarCaf, listarFolios, siguienteFolio, faltantesPorTipo,
  estadoCertificado, exigirCertificadoEmisor,
  calcularMontos, validarItems, validarReceptor, validarReferencia,
  emitir, reintentar, consultarEstado, listar, obtener, obtenerPorIdempotencia,
  generarXMLDTE, adaptadorReal,
}
