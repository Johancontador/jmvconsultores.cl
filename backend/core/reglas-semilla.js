/**
 * Reglas semilla (POST-MVP) — plan de arranque del motor de automatización.
 *
 * Cuando una empresa no tiene NINGUNA regla, el pipeline no puede clasificar
 * nada y la promesa "cero digitación" no arranca. Esta semilla da un punto de
 * partida conservador y explícito, alineado con la plantilla PUC:
 *
 *   Ventas (33/34) → VENTAS_SERVICIOS / VENTAS_BIENES (catch-all por flujo)
 *   Compras (33/34) → GASTO_SERVICIOS_BASICOS catch-all (a reclasificar)
 *   Honorarios (39/46... opción) → GASTO_HONORARIOS
 *   NC de compra (61) → GASTO_SERVICIOS_BASICOS sin crédito (reversal típico)
 *
 * Decisiones de diseño:
 *  - Las cuentas se resuelven por ALIAS de control (ACCOUNTING_DOMAIN §3.5),
 *    nunca por código rígido: si la empresa renombró su plan, la semilla
 *    simplemente se salta la regla cuyo alias no exista.
 *  - Prioridades claras: honorarios/NC específicas (30) debajo de las
 *    aprendidas (50) y encima del catch-all (10). El contador edita libre.
 *  - Idempotente: si la empresa ya tiene reglas propias o semilla, no se toca.
 *    Auditada como configuración (una sola acción por corrida).
 */

const { registrarAccion } = require('./auditoria')
const reglas = require('./reglas')

const SEMILLA = [
  {
    nombre: 'Semilla · Venta con IVA → Ventas de servicios',
    prioridad: 20,
    tipoFlujo: 'venta', tipoDoc: null,
    cuentaAlias: 'VENTAS_SERVICIOS', tratamientoIva: 'credito',
  },
  {
    nombre: 'Semilla · Compra con IVA → Gastos (catch-all a revisar)',
    prioridad: 10,
    tipoFlujo: 'compra', tipoDoc: null,
    cuentaAlias: 'GASTO_SERVICIOS_BASICOS', tratamientoIva: 'credito',
  },
  {
    nombre: 'Semilla · NC de compra → Gasto sin crédito fiscal',
    prioridad: 30,
    tipoFlujo: 'compra', tipoDoc: 61,
    cuentaAlias: 'GASTO_SERVICIOS_BASICOS', tratamientoIva: 'sin_credito',
  },
]

/**
 * Instala la semilla en la empresa SOLO si no tiene ninguna regla.
 * Devuelve { instaladas, omitidas, ya_tenía } para la UI.
 */
function instalarSiVacia(db, { empresaId, usuarioId, ip = null }) {
  const existentes = db.prepare(`SELECT COUNT(*) AS n FROM reglas_contables WHERE empresa_id = ?`).get(empresaId).n
  if (existentes > 0) {
    return { instaladas: 0, omitidas: SEMILLA.length, ya_tenia: true }
  }

  const resolverAlias = (alias) => db.prepare(
    `SELECT id FROM cuentas WHERE empresa_id = ? AND alias = ? AND activa = 1 AND es_resumen = 0`
  ).get(empresaId, alias)

  let instaladas = 0
  const omitidas = []
  for (const s of SEMILLA) {
    const cta = resolverAlias(s.cuentaAlias)
    if (!cta) {
      omitidas.push({ regla: s.nombre, motivo: `Alias ${s.cuentaAlias} no existe en el plan de la empresa` })
      continue
    }
    reglas.guardar(db, {
      empresaId, usuarioId,
      nombre: s.nombre, prioridad: s.prioridad, activa: true,
      tipoFlujo: s.tipoFlujo, tipoDoc: s.tipoDoc,
      cuentaId: cta.id, tratamientoIva: s.tratamientoIva,
      ip,
    })
    instaladas++
  }

  if (instaladas > 0) {
    registrarAccion(db, {
      empresaId, usuarioId,
      accion: 'reglas.semilla_instalar', entidad: 'reglas_contables', entidadId: String(instaladas),
      despues: { instaladas, omitidas: omitidas.length },
      ip,
    })
  }
  return { instaladas, omitidas, ya_tenia: false }
}

module.exports = { SEMILLA, instalarSiVacia }
