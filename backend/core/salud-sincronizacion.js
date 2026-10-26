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
 * Períodos a sincronizar desde el RCV: el período pedido + los más recientes
 * SIN documentos ingeridos, hasta el tope. No se re-sincroniza lo que ya
 * está: el SII es lento y la ingesta es idempotente pero no gratis.
 */
function periodosParaRcV(db, empresaId, periodo, meses, maxPeriodos) {
  const candidatos = periodosRecientes(periodo, meses)
  const conDatos = new Set(db.prepare(`
    SELECT DISTINCT periodo_ingesta AS periodo FROM documentos
    WHERE empresa_id = ? AND periodo_ingesta BETWEEN ? AND ?
  `).all(empresaId, candidatos[candidatos.length - 1], periodo).map((r) => r.periodo))
  const lista = []
  for (const p of candidatos) {
    if (lista.length >= maxPeriodos) break
    if (p === periodo || !conDatos.has(p)) lista.push(p)
  }
  return lista
}

/**
 * Lanza la reunión de antecedentes en segundo plano.
 * Devuelve el jobId de inmediato; el progreso se consulta con
 * `obtenerEstado(jobId, usuarioId)`.
 */
function iniciar(db, {
  empresaId, usuarioId, periodo, meses = 12, ip = null,
  anios = 5, maxPeriodosRcv = 3, periodosFormulario = 12, pasos: pasosPedidos = null,
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
    const clave = deps.descifrarClave(db, empresaId)
    if (!clave) throw new Error('La empresa no tiene clave SII configurada')
    const rut = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)?.rut
    const lista = periodosParaRcV(db, empresaId, periodo, opciones.meses, opciones.maxPeriodosRcv)
    let insertados = 0
    let duplicados = 0
    let errores = 0
    let agregados = 0
    for (const p of lista) {
      for (const [tipo, flujo] of [['compras', 'compra'], ['ventas', 'venta']]) {
        try {
          const docs = await deps.consultarRCV(rut, clave, tipo, p)
          const r = deps.ingestarBatch(db, {
            empresaId, usuarioId, tipoFlujo: flujo, periodo: p, documentos: docs, ip,
          })
          insertados += r.insertados || 0
          duplicados += r.duplicados || 0
          errores += (r.errores || []).length
        } catch (err) {
          errores += 1
        }
      }
      // Boletas/comprobantes de pago: el SII solo los entrega como total
      // mensual; se guardan en rcv_agregados para completar la conciliación.
      try {
        const ags = await deps.consultarAgregadosVenta(rut, clave, p)
        const g = deps.guardarAgregados(db, { empresaId, rut, periodo: p, agregados: ags })
        agregados += g.guardados || 0
      } catch (err) {
        errores += 1
      }
    }
    resumen.rcv = { periodos: lista, insertados, duplicados, errores, agregados }
    return { detalle: `${lista.length} período(s) · ${insertados} documento(s) nuevo(s) · ${agregados} agregado(s) · ${errores} error(es)` }
  })
  salud.olvidarResumen(empresaId)

  // ---- 3. Declaraciones (matriz F29, boletas, juradas) ----
  await ejecutarPaso('declaraciones', async () => {
    const r = await deps.sincronizarDeclaraciones(db, { empresaId, usuarioId, periodo, anios: opciones.anios })
    const f29 = r?.resultado?.f29?.periodos ?? null
    resumen.declaraciones = {
      f29: f29,
      aviso: r?.aviso || null,
    }
    return { detalle: f29 != null ? `${f29} período(s) de F29 revisados` : 'Declaraciones consultadas' }
  })
  salud.olvidarResumen(empresaId)

  // ---- 4. Formulario Compacto del F29 (casillas declaradas) ----
  await ejecutarPaso('formularios', async () => {
    const r = await deps.sincronizarFormularios(db, {
      empresaId, usuarioId, periodo, periodos: opciones.periodosFormulario,
    })
    resumen.formularios = { periodos: r?.periodos ?? 0, con_formulario: r?.con_formulario ?? 0 }
    return { detalle: `${r?.con_formulario ?? 0} formulario(s) compacto(s) leídos` }
  })
  salud.olvidarResumen(empresaId)

  // ---- 5. Renta (F22) ----
  await ejecutarPaso('renta', async () => {
    const emp = db.prepare(`SELECT rut FROM empresas WHERE id = ?`).get(empresaId)
    const [cuerpo, ...resto] = String(emp.rut).split('-')
    const dv = resto.join('-') || '0'
    const aniosLista = []
    const anioHasta = Number(periodo.slice(0, 4))
    for (let a = anioHasta; a >= anioHasta - Math.max(0, opciones.anios - 1); a--) aniosLista.push(a)
    const clave = deps.descifrarClave(db, empresaId)
    if (!clave) throw new Error('La empresa no tiene clave SII configurada')
    const r = await deps.consultarRenta({ rut: emp.rut, dv, anios: aniosLista, clave })
    const guardados = deps.guardarRenta(db, { empresaId, rut: emp.rut, anios: r?.anios || [] })
    resumen.renta = { anios: (r?.anios || []).length, guardados, aviso: r?.aviso || null }
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
