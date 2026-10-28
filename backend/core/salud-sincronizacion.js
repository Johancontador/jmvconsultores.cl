/**
 * salud-sincronizacion.js — REUNIÓN DE ANTECEDENTES DE SALUD TRIBUTARIA.
 *
 * Un solo botón ("Reunir antecedentes") que deja el diagnóstico completo:
 *   1. ficha      → ficha del contribuyente en el SII
 *   2. rcv        → compras y ventas del período (y de los meses sin datos)
 *   3. declarac. → matriz de estados F29, boletas de honorarios y juradas
 *   4. form       → Formulario Compacto del F29 (casillas declaradas)
 *   5. renta      → estado de la declaración anual (F22)
 *   6. tesorería  → deuda fiscal real en la TGR (certificado de deuda)
 *   7. informe    → reconstrucción del informe + evidencia (snapshot)
 *
 * Por qué un job y no un request: cada paso abre sesión en el portal del SII
 * y puede tardar minutos. El request HTTP no puede quedarse abierto: el
 * cliente hace polling del estado (mismo patrón que la ingesta, ver
 * core/ingesta.js). El estado vive en memoria (CURRENT_STATE §8.2: un
 * reinicio del proceso pierde el job en curso, pero NO se pierde lo ya
 * guardado: la ingesta es idempotente y las declaraciones se actualizan por
 * clave única).
 *
 * Los pasos son INDEPENDIENTES: si el SII no entrega el Formulario Compacto,
 * el informe se emite igual con lo que hay, diciendo qué falta. Un paso que
 * falla no borra lo que otro paso ya traer.
 *
 * Las dependencias de red se INYECTAN (`deps`) para que los tests puedan
 * ejercitar el orquestador sin tocar el SII.
 */

const salud = require('./salud-tributaria')
const jobsMemoria = require('./jobs-memoria')
const { registrarAccion } = require('./auditoria')

const PASOS = [
  { clave: 'ficha', nombre: 'Ficha del contribuyente (SII)' },
  { clave: 'rcv', nombre: 'Compras y ventas (RCV)' },
  { clave: 'declaraciones', nombre: 'Declaraciones F29, boletas y juradas' },
  { clave: 'formularios', nombre: 'Formulario Compacto del F29' },
  { clave: 'renta', nombre: 'Renta (F22)' },
  { clave: 'tesoreria', nombre: 'Deuda fiscal (TGR)' },
  { clave: 'informe', nombre: 'Informe y evidencia' },
]

const trabajos = new Map() // jobId → estado

function generarJobId() {
  return `sal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function dependenciasPorDefecto() {
  return {
    asegurarFicha: (db, opts) => require('./empresas-sii').asegurarFicha(db, opts),
    consultarRCV: (rut, clave, tipo, periodo) => require('../services/rcv').consultarRCV(rut, clave, tipo, periodo),
    consultarAgregadosVenta: (rut, clave, periodo) => require('../services/rcv').consultarAgregadosVenta(rut, clave, periodo),
    rcvProveedor: () => require('../services/rcv').getProvider(),
    guardarAgregados: (db, opts) => require('./salud-tributaria').guardarAgregados(db, opts),
    ingestarBatch: (db, opts) => require('./documentos').ingestarBatch(db, opts),
    sincronizarDeclaraciones: (db, opts) => require('./declaraciones-sii').sincronizar(db, opts),
    sincronizarFormularios: (db, opts) => require('./declaraciones-sii').sincronizarFormularios(db, opts),
    consultarRenta: (opts) => require('./renta-sii').consultarRenta(opts),
    guardarRenta: (db, opts) => require('./renta-sii').guardar(db, opts),
    consultarDeudaTgr: (db, opts) => require('./deuda-tgr').consultar(db, opts),
    descifrarClave: (db, empresaId) => require('./empresas').claveSiiDescifrada(db, empresaId),
  }
}

/** Estado del job listo para la API (sin secretos). */
function obtenerEstado(jobId, usuarioId = null) {
  jobsMemoria.purgar(trabajos)
  const t = trabajos.get(jobId)
  if (!t) return null
  if (usuarioId != null && t.usuarioId !== usuarioId) return null
  return {
    jobId,
    empresa_id: t.empresaId,
    periodo: t.periodo,
    estado: t.estado,
    pasos: t.pasos.map((p) => ({ ...p })),
    resumen: t.resumen,
    error: t.error,
    iniciado_en: t.iniciado_en,
    terminado_en: t.terminado_en,
  }
}

/** Jobs vivos de una empresa (para re-enganchar la UI al recargar). */
function listarDeEmpresa(empresaId, usuarioId = null) {
  jobsMemoria.purgar(trabajos)
  return [...trabajos.values()]
    .filter((t) => t.empresaId === empresaId && (usuarioId == null || t.usuarioId === usuarioId))
    .map((t) => obtenerEstado(t.jobId, usuarioId))
    .filter(Boolean)
    .sort((a, b) => (a.iniciado_en < b.iniciado_en ? 1 : -1))
}

/** Meses de la ventana, del más reciente al más antiguo. */
function periodosRecientes(periodo, meses) {
  const out = []
  let y = Number(periodo.slice(0, 4))
  let m = Number(periodo.slice(4, 6))
  for (let i = 0; i < Math.max(1, meses); i++) {
    out.push(`${y}${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

/**
 * Períodos a sincronizar desde el RCV: toda la ventana solicitada, limitada
 * solo por maxPeriodos. La presencia de documentos no prueba que estén los dos
 * flujos ni los agregados del SII; la ingesta es idempotente y el servicio RCV
 * reutiliza su caché de consultas completas por flujo.
 */
function periodosParaRcV(db, empresaId, periodo, meses, maxPeriodos) {
  const candidatos = periodosRecientes(periodo, meses)
  const limite = Number.isInteger(Number(maxPeriodos)) && Number(maxPeriodos) > 0
    ? Number(maxPeriodos)
    : candidatos.length
  return candidatos.slice(0, limite)
}

/**
 * Lanza la reunión de antecedentes en segundo plano.
 * Devuelve el jobId de inmediato; el progreso se consulta con
 * `obtenerEstado(jobId, usuarioId)`.
 */
function iniciar(db, {
  empresaId, usuarioId, periodo, meses = 12, ip = null,
  anios = 5, maxPeriodosRcv = null, periodosFormulario = 12, pasos: pasosPedidos = null,
  deps: depsInyectadas = null, guardarEvidencia = true,
} = {}) {
  const empresa = db.prepare(`SELECT id, rut, nombre FROM empresas WHERE id = ? AND activo = 1`).get(empresaId)
  if (!empresa) throw new Error('Empresa no encontrada')
  if (!periodo || !/^\d{6}$/.test(String(periodo))) throw new Error('Período inválido (YYYYMM)')

  const jobId = generarJobId()
  const activos = PASOS.filter((p) => !pasosPedidos || pasosPedidos.includes(p.clave))
  jobsMemoria.registrar(trabajos, jobId, {
    jobId, empresaId, usuarioId, periodo, ip,
    estado: 'en_curso',
    iniciado_en: new Date().toISOString(),
    terminado_en: null,
    error: null,
    resumen: {},
    pasos: PASOS.map((p) => ({
      clave: p.clave,
      nombre: p.nombre,
      estado: activos.some((a) => a.clave === p.clave) ? 'pendiente' : 'omitido',
      detalle: null,
      error: null,
      duracion_ms: null,
    })),
  })

  ejecutar(jobId, { db, meses, anios, maxPeriodosRcv, periodosFormulario, deps: depsInyectadas, guardarEvidencia })
    .catch((err) => {
      const t = trabajos.get(jobId)
      if (t) {
        t.estado = 'error'
        t.error = err.message
        t.terminado_en = new Date().toISOString()
      }
    })

  return { jobId, empresa: { id: empresa.id, nombre: empresa.nombre }, periodo }
}

function marcarPaso(jobId, clave, estado, extra = {}) {
  const t = trabajos.get(jobId)
  if (!t) return
  const p = t.pasos.find((x) => x.clave === clave)
  if (!p) return
  p.estado = estado
  if (extra.detalle !== undefined) p.detalle = extra.detalle
  if (extra.error !== undefined) p.error = extra.error
  if (extra.duracion_ms !== undefined) p.duracion_ms = extra.duracion_ms
}

async function ejecutar(jobId, opciones) {
  const t = trabajos.get(jobId)
  if (!t) return
  const db = opciones.db
  const { empresaId, usuarioId, periodo, ip } = t
  const deps = { ...dependenciasPorDefecto(), ...(opciones.deps || {}) }
  const resumen = t.resumen

  const ejecutarPaso = async (clave, fn) => {
    const paso = t.pasos.find((p) => p.clave === clave)
    if (!paso || paso.estado === 'omitido') return null
    const inicio = Date.now()
    marcarPaso(jobId, clave, 'en_curso')
    try {
      const r = await fn()
      marcarPaso(jobId, clave, 'ok', { detalle: r?.detalle ?? null, duracion_ms: Date.now() - inicio })
      return r
    } catch (err) {
      marcarPaso(jobId, clave, 'error', { error: err.message, duracion_ms: Date.now() - inicio })
      return { error: err.message }
    }
  }

  // ---- 1. Ficha del contribuyente ----
  const ficha = await ejecutarPaso('ficha', async () => {
    const r = await deps.asegurarFicha(db, { empresaId, usuarioId, ip })
    return {
      detalle: r.actualizada ? 'Ficha actualizada desde el SII' : `Ficha sin cambios (${r.motivo || 'sin novedades'})`,
      valor: r,
    }
  })
  if (ficha?.valor) {
    resumen.ficha = ficha.valor.actualizada ? 'actualizada' : (ficha.valor.motivo || 'sin cambios')
    salud.olvidarResumen(empresaId)
  }

  // ---- 2. RCV (compras y ventas) ----
  await ejecutarPaso('rcv', async () => {
    const proveedor = deps.rcvProveedor ? deps.rcvProveedor() : 'sii'
    if (proveedor !== 'sii') {
      throw new Error(`Proveedor RCV «${proveedor}» no permite certificar la extracción completa de Salud Tributaria (se requieren RCV y agregados oficiales del SII)`)
    }
    const clave = deps.descifrarClave(db, empresaId)
    if (!clave) throw new Error('La empresa no tiene clave SII configurada')
    const rut = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)?.rut
    const lista = periodosParaRcV(db, empresaId, periodo, opciones.meses, opciones.maxPeriodosRcv)
    let insertados = 0
    let duplicados = 0
    let erroresDocumento = 0
    const fallos = []
    let agregados = 0
    for (const p of lista) {
      for (const [tipo, flujo] of [['compras', 'compra'], ['ventas', 'venta']]) {
        try {
          const docs = await deps.consultarRCV(rut, clave, tipo, p)
          if (!Array.isArray(docs)) throw new Error('La respuesta RCV no es una lista de documentos')
          const r = deps.ingestarBatch(db, {
            empresaId, usuarioId, tipoFlujo: flujo, periodo: p, documentos: docs, ip,
          })
          insertados += r.insertados || 0
          duplicados += r.duplicados || 0
          erroresDocumento += (r.errores || []).length
        } catch (err) {
          fallos.push(`${p} ${tipo}: ${err.message}`)
        }
      }
      // Boletas/comprobantes de pago: el SII solo los entrega como total
      // mensual; se guardan en rcv_agregados para completar la conciliación.
      try {
        const ags = await deps.consultarAgregadosVenta(rut, clave, p)
        if (!Array.isArray(ags)) throw new Error('La respuesta de agregados RCV no es una lista')
        const g = deps.guardarAgregados(db, { empresaId, rut, periodo: p, agregados: ags })
        agregados += g.guardados || 0
      } catch (err) {
        fallos.push(`${p} agregados de ventas: ${err.message}`)
      }
    }
    resumen.rcv = { periodos: lista, consultados: lista.length, insertados, duplicados, errores: fallos.length + erroresDocumento, errores_documento: erroresDocumento, fallos, agregados }

    if (fallos.length || erroresDocumento) {
      throw new Error(`RCV incompleto (${fallos.length} consulta(s) fallida(s), ${erroresDocumento} documento(s) rechazado(s)): ${fallos.join(' · ') || 'revisar errores de documentos en el resultado de ingesta'}`)
    }
    return { detalle: `${lista.length} período(s) · ${insertados} documento(s) nuevo(s) · ${agregados} agregado(s) · sin errores` }
  })
  salud.olvidarResumen(empresaId)

  // ---- 3. Declaraciones (matriz F29, boletas, juradas) ----
  await ejecutarPaso('declaraciones', async () => {
    const r = await deps.sincronizarDeclaraciones(db, { empresaId, usuarioId, periodo, anios: opciones.anios })
    const f29 = r?.resultado?.f29?.periodos ?? null
    resumen.declaraciones = {
      f29,
      boletas: r?.resultado?.boletas ?? null,
      juradas: r?.resultado?.juradas ?? null,
      f22: r?.resultado?.f22 ?? null,
      aviso: r?.aviso || null,
    }
    const requeridos = ['f29', 'boletas', 'juradas', 'f22']
    const ausentes = requeridos.filter((fuente) => r?.resultado?.[fuente] == null)
    if (ausentes.length) throw new Error(`La conexión no confirmó resultados para: ${ausentes.join(', ')}`)
    const aniosSolicitados = Math.min(Math.max(Number(opciones.anios) || 5, 1), 5)
    if (!Number.isFinite(Number(r.resultado.f29.periodos))) {
      throw new Error('La consulta F29 no informó cuántos períodos logró revisar')
    }
    if (!Number.isFinite(Number(r.resultado.juradas.anios)) || !Number.isFinite(Number(r.resultado.f22.anios)) || Number(r.resultado.juradas.anios) < aniosSolicitados || Number(r.resultado.f22.anios) < aniosSolicitados) {
      throw new Error(`Cobertura anual incompleta: se solicitaron ${aniosSolicitados} años, el SII confirmó DJ=${r.resultado.juradas.anios} y F22=${r.resultado.f22.anios}`)
    }
    if (Number(r.resultado.juradas.guardados) !== aniosSolicitados || Number(r.resultado.f22.guardados) !== aniosSolicitados) {
      throw new Error(`Persistencia anual incompleta: DJ=${r.resultado.juradas.guardados} y F22=${r.resultado.f22.guardados} de ${aniosSolicitados} años guardados`)
    }
    if (!Number.isFinite(Number(r.resultado.boletas.anios)) || Number(r.resultado.boletas.anios) < aniosSolicitados) {
      throw new Error(`Cobertura incompleta de boletas de honorarios: se solicitaron ${aniosSolicitados} años, se consultaron ${r.resultado.boletas.anios}`)
    }
    if (Array.isArray(r.resultado.f29.anios_solicitados) && r.resultado.f29.anios_solicitados.some((a) => !r.resultado.f29.anios_consultados?.includes(a))) {
      throw new Error(`Consulta F29 incompleta: no se confirmó la búsqueda anual para ${r.resultado.f29.anios_solicitados.filter((a) => !r.resultado.f29.anios_consultados?.includes(a)).join(', ')}`)
    }
    if (r.resultado.juradas.anios_guardados && r.resultado.juradas.anios_guardados.length !== aniosSolicitados) {
      throw new Error(`Persistencia DJ incompleta: se guardaron ${r.resultado.juradas.anios_guardados.length} de ${aniosSolicitados} años`)
    }
    if (r.resultado.f22.anios_guardados && r.resultado.f22.anios_guardados.length !== aniosSolicitados) {
      throw new Error(`Persistencia F22 incompleta: se guardaron ${r.resultado.f22.anios_guardados.length} de ${aniosSolicitados} años`)
    }
    if (Array.isArray(r.resultado.juradas.resultados) && r.resultado.juradas.resultados.some((x) => x.error)) {
      throw new Error(`Consulta DJ incompleta: ${r.resultado.juradas.resultados.filter((x) => x.error).map((x) => `${x.anio}: ${x.error}`).join(' · ')}`)
    }
    if (Array.isArray(r.resultado.f22.resultados) && r.resultado.f22.resultados.some((x) => x.error)) {
      throw new Error(`Consulta F22 incompleta: ${r.resultado.f22.resultados.filter((x) => x.error).map((x) => `${x.anio}: ${x.error}`).join(' · ')}`)
    }
    if ((Array.isArray(r.resultado.boletas.anios_con_error) && r.resultado.boletas.anios_con_error.length > 0)
      || (Number.isFinite(Number(r.resultado.boletas.anios_con_error)) && Number(r.resultado.boletas.anios_con_error) > 0)
      || r.resultado.boletas.error) {
      throw new Error(`Consulta de boletas incompleta: ${JSON.stringify(r.resultado.boletas.anios_con_error || r.resultado.boletas.error)}`)
    }
    const f29Incompleto = (Array.isArray(r.resultado.f29.anios_con_error) && r.resultado.f29.anios_con_error.length > 0)
      || (Array.isArray(r.resultado.f29.cobertura_periodos) && r.resultado.f29.cobertura_periodos.length !== 60)
    if (f29Incompleto) throw new Error('Consulta F29 incompleta: no se confirmó la cobertura de 60 períodos solicitada')
    const fallos = []
    for (const fuente of ['boletas', 'juradas', 'f22']) {
      const resultado = r?.resultado?.[fuente]
      if (resultado?.error) fallos.push(`${fuente}: ${resultado.error}`)
      if (resultado?.aviso) fallos.push(`${fuente}: ${resultado.aviso}`)
    }
    if (fallos.length) throw new Error(`Consulta de declaraciones incompleta: ${fallos.join(' · ')}`)
    return { detalle: f29 != null ? `${f29} período(s) de F29 revisados; boletas, juradas y F22 consultados` : 'Declaraciones consultadas' }
  })
  salud.olvidarResumen(empresaId)

  // ---- 4. Formulario Compacto del F29 (casillas declaradas) ----
  await ejecutarPaso('formularios', async () => {
    const r = await deps.sincronizarFormularios(db, {
      empresaId, usuarioId, periodo, periodos: Math.min(Math.max(Number(opciones.anios) || 5, 1), 5) * 12,
    })
    resumen.formularios = { periodos: r?.periodos ?? 0, con_formulario: r?.con_formulario ?? 0, errores: r?.errores || [] }
    const periodosCobertura = Math.min(Math.max(Number(opciones.anios) || 5, 1), 5) * 12
    const esperados = require('./declaraciones-sii').ultimosPeriodos(periodosCobertura, periodo)
    const noRevisados = esperados.filter((p) => !r?.revisados?.includes(p))
    const sinCompacto = esperados.filter((p) => r?.revisados?.includes(p) && !r?.consultados?.includes(p))
    if (r?.errores?.length || noRevisados.length || sinCompacto.length) {
      const problemas = [...(r?.errores || [])]
      if (noRevisados.length) problemas.push(`sin revisión del SII para ${noRevisados.join(', ')}`)
      if (sinCompacto.length) problemas.push(`SII sin Formulario Compacto confirmado para ${sinCompacto.join(', ')}`)
      throw new Error(`Formulario Compacto incompleto (${problemas.length} problema(s)): ${problemas.join(' · ')}`)
    }
    return { detalle: `${r?.con_formulario ?? 0} Formulario(s) Compacto(s) obtenido(s); ${r?.revisados?.length ?? 0} período(s) revisados en el SII` }
  })
  salud.olvidarResumen(empresaId)

  // ---- 5. Renta (F22) ----
  await ejecutarPaso('renta', async () => {
    const emp = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)
    const [cuerpo, ...resto] = String(emp.rut).split('-')
    const dv = resto.join('-') || '0'
    const aniosLista = []
    const anioHasta = Number(periodo.slice(0, 4))
    const aniosCobertura = Math.min(Math.max(Number(opciones.anios) || 5, 1), 5)
    for (let a = anioHasta; a >= anioHasta - (aniosCobertura - 1); a--) aniosLista.push(a)
    const clave = deps.descifrarClave(db, empresaId)
    if (!clave) throw new Error('La empresa no tiene clave SII configurada')
    const r = await deps.consultarRenta({ rut: emp.rut, dv, anios: aniosLista, clave })
    const guardados = deps.guardarRenta(db, { empresaId, rut: emp.rut, anios: r?.anios || [] })
    resumen.renta = { anios: (r?.anios || []).length, guardados, aviso: r?.aviso || null }
    const errores = (r?.anios || []).filter((a) => a.error)
    const aniosRecibidos = new Set((r?.anios || []).map((a) => String(a.anio)))
    const faltantes = aniosLista.filter((a) => !aniosRecibidos.has(String(a)))
    if (errores.length || faltantes.length || (r?.anios || []).length !== aniosLista.length || guardados !== aniosLista.length) {
      throw new Error(`Consulta F22 incompleta: ${errores.map((a) => `${a.anio}: ${a.error}`).join(' · ') || `${faltantes.length ? `faltan años ${faltantes.join(', ')}` : `SII devolvió ${guardados} de ${aniosLista.length} años guardados`}`}`)
    }
    return { detalle: `${(r?.anios || []).length} año(s) consultado(s), ${guardados} guardado(s)` }
  })
  salud.olvidarResumen(empresaId)

  // ---- 6. Deuda fiscal en la Tesorería (TGR) ----
  // Es un portal distinto del SII (aunque autentica con la misma Clave
  // Tributaria) y puede estar caído o cambiar: su fallo NO invalida el resto
  // del informe, y la sección queda «no consultado» con el motivo.
  await ejecutarPaso('tesoreria', async () => {
    const r = await deps.consultarDeudaTgr(db, { empresaId, usuarioId, ip })
    resumen.tesoreria = {
      estado: r.estado,
      total: r.total == null ? null : Number(r.total),
      fecha_emision: r.fecha_emision || null,
      pdf: r.pdf_ruta || null,
    }
    return {
      detalle: r.estado === 'sin_deuda'
        ? `Certificado TGR del ${r.fecha_emision || 'día'}: sin deuda fiscal`
        : `Certificado TGR del ${r.fecha_emision || 'día'}: ${r.total == null ? 'deuda registrada (monto no legible)' : `${Number(r.total).toLocaleString('es-CL')} CLP de deuda`}`,
    }
  })
  salud.olvidarResumen(empresaId)

  // ---- 7. Informe + evidencia ----
  await ejecutarPaso('informe', async () => {
    const inf = salud.construirInforme(db, { empresaId, periodo, meses: opciones.meses })
    let snapshotId = null
    if (opciones.guardarEvidencia) {
      snapshotId = salud.guardarSnapshot(db, { empresaId, periodo, usuarioId, informe: inf })
    }
    resumen.informe = {
      score: inf.opinion.score,
      nivel: inf.opinion.nivel,
      hallazgos: (inf.opinion.hallazgos || []).length,
      // ST-03: tres indicadores distintos. `cobertura` es el peso del índice
      // con evidencia; la cobertura de FUENTES (todas las consultas, incluidas
      // TGR, F22, DJ y BHE) y la confianza se informan aparte.
      cobertura: inf.opinion.cobertura_diagnostico,
      cobertura_fuentes: inf.opinion.cobertura_fuentes?.pct ?? null,
      confianza: inf.opinion.nivel_confianza || null,
      snapshot_id: snapshotId,
    }
    return { detalle: `Índice ${inf.opinion.score}/100 · ${(inf.opinion.hallazgos || []).length} hallazgo(s)` }
  })

  const fallidos = t.pasos.filter((p) => p.estado === 'error')
  t.estado = fallidos.length ? 'completado_con_errores' : 'completado'
  t.terminado_en = new Date().toISOString()

  try {
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'salud_tributaria.reunion_antecedentes', entidad: 'salud_tributaria_snapshots',
      entidadId: String(periodo),
      despues: { estado: t.estado, resumen },
      ip,
    })
  } catch { /* la auditoría no debe tumbar la corrida */ }
}

module.exports = {
  iniciar, obtenerEstado, listarDeEmpresa, trabajos, PASOS,
  periodosParaRcV, periodosRecientes,
}
