/**
 * PORTAL COMERCIAL (2026-10-16) — visibilidad del CLIENTE sobre SU pipeline.
 *
 * Por qué: el CRM Comercial es y sigue siendo EXCLUSIVO del despacho
 * (guardCrm: contador/super admin — el dueño cliente jamás opera el CRM).
 * Pero el dueño SÍ tiene interés legítimo en ver EL SEGUIMIENTO COMERCIAL DE
 * SU PROPIA empresa: qué oportunidades tiene abiertas, en qué etapa del
 * embudo está cada una y qué próximos pasos hay pendientes. Es el mismo
 * criterio del resto del Portal: solo lectura, aislado server-side por
 * asignación (usuario_empresa), sin superficie de escritura.
 *
 * Reglas de superficie (más restrictiva que el CRM del despacho):
 *  - SOLO LECTURA: nada aquí escribe (ni siquiera auditoría de lectura —
 *    el portal ya no audita lecturas).
 *  - SIN prospectos ni contactos sin empresa (son leads internos del
 *    despacho); no se expone la cartera comercial completa del despacho.
 *  - SIN responsable interno: el campo `responsable` es dato operativo del
 *    despacho — se omite de las filas (§ antifuga de información interna).
 *  - SIN informes de responsables ni causas de pérdida internas de otros:
 *    solo embudo de SU empresa + SUS oportunidades + actividades pendientes
 *    de SUS oportunidades.
 *
 * Módulo puro sobre `db` (testeable in-memory), mismo patrón que
 * portal-metricas.js.
 */
const comercial = require('./crm-comercial')

/** Filtra los datos de una oportunidad para la vista del cliente. */
function vistaOportunidad(o) {
  return {
    id: o.id,
    nombre: o.nombre,
    etapa: o.etapa,
    orden: o.orden,
    terminal: !!o.terminal,
    ganada: !!o.ganada,
    monto: o.monto,
    moneda: o.moneda,
    probabilidad: o.probabilidad,
    fecha_cierre_estimada: o.fecha_cierre_estimada,
    fecha_seguimiento: o.fecha_seguimiento,
    creado_en: o.creado_en,
    actualizado_en: o.actualizado_en,
  }
}

/**
 * Resumen comercial de UNA empresa para su dueño (o para el despacho, que
 * también pasa por el portal si quiere la vista cliente).
 * `acceso` lo resuelve el ROUTER (rolEnEmpresa) — este core asume permiso.
 */
function resumenComercial(db, { empresaId }) {
  const id = Number(empresaId)
  const etapas = comercial.listarEtapas(db)

  // Solo las oportunidades de ESTA empresa (empresaId directo: sin tenant).
  const todas = comercial.listarOportunidades(db, { empresaId: id, limit: 500 })
  const oportunidades = todas.oportunidades.map(vistaOportunidad)

  // Embudo por etapa de la empresa (cuenta + montos, sin responsables).
  const porEtapa = etapas.map((et) => {
    const filas = oportunidades.filter((o) => o.etapa.toUpperCase() === et.nombre.toUpperCase())
    return {
      etapa: et.nombre,
      orden: et.orden,
      terminal: !!et.terminal,
      n: filas.length,
      monto: filas.reduce((s, o) => s + (o.monto || 0), 0),
    }
  })

  const abiertas = oportunidades.filter((o) => !o.terminal)
  const ganadas = oportunidades.filter((o) => o.terminal && o.ganada)
  const perdidas = oportunidades.filter((o) => o.terminal && !o.ganada)
  const proyeccion = abiertas.reduce((s, o) => s + Math.round((o.monto * o.probabilidad) / 100), 0)

  // Próximos pasos: actividades PENDIENTES ancladas a la empresa (el core
  // comercial exige ancla empresa/contacto/oportunidad — con empresaId fijo
  // solo salen las de esta empresa).
  const pendientes = comercial.listarActividades(db, { empresaId: id, estado: 'PENDIENTE', limit: 100 })

  return {
    empresa_id: id,
    etapas: porEtapa,
    total: oportunidades.length,
    abiertas: abiertas.length,
    ganadas: ganadas.length,
    perdidas: perdidas.length,
    proyeccion_ponderada: proyeccion,
    oportunidades,
    pendientes: pendientes.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      titulo: a.titulo,
      fecha: a.vencimiento,
      vencida: !!a.vencida,
      oportunidad_id: a.oportunidad_id,
      oportunidad_nombre: a.oportunidad_nombre || null,
    })),
  }
}

module.exports = { resumenComercial }
