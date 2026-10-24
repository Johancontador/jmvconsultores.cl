/**
 * TAXONOMÍA DE ESTADOS DE SALUD TRIBUTARIA — una sola fuente (handoff §4.5).
 *
 * El diagnóstico usa hoy tres vocabularios distintos para decir «no hay dato»:
 * `no_consultado` (declaración que no se leyó), `no_evaluable` (dimensión sin
 * antecedentes) y `sin_informacion` (declaración consultada que no devolvió
 * datos). Además la vista rotula como «No evaluable» tanto una exposición
 * confirmada en cero como una exposición que nadie consultó, y un fallo de red
 * se muestra con el mismo cartel que un dato ausente.
 *
 * Este módulo fija el significado de cada estado y las funciones que lo
 * deciden. Es puro (sin DOM, sin BD, sin red) y lo comparten la vista
 * (window.EstadosSalud) y el informe imprimible (require desde el backend):
 * el texto y la severidad no pueden divergir entre pantalla y PDF.
 *
 * Reglas que NO son negociables:
 *  - Un cero solo es un dato cuando la fuente fue consultada. Si no se
 *    consultó, el estado es «pendiente», no «verificado».
 *  - Un error técnico NUNCA es un hallazgo tributario ni un puntaje negativo.
 *  - Una fuente no habilitada no es un incumplimiento del contribuyente.
 *  - Un dato antiguo se mantiene visible, marcado con su fecha: no se
 *    presenta como vigente ni se borra.
 */
;(function (raiz, fabrica) {
  const api = fabrica()
  if (typeof module === 'object' && module.exports) module.exports = api
  else raiz.EstadosSalud = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  /**
   * Los 9 estados del handoff. `es_hallazgo` distingue lo que es una materia
   * tributaria (diferencia, revisión) de lo que es una condición del sistema
   * (fuente no disponible, error técnico, fuente no habilitada): solo lo
   * primero puede teñir el índice o la matriz de riesgos.
   */
  const ESTADOS = {
    verificado: {
      clave: 'verificado',
      etiqueta: 'Información verificada',
      severidad: 'ok',
      es_hallazgo: false,
      requiere_accion: false,
      reintentable: false,
      cuando: 'La fuente fue consultada y entregó un valor (incluido 0) para el período.',
    },
    con_observaciones: {
      clave: 'con_observaciones',
      etiqueta: 'Información disponible con observaciones',
      severidad: 'atencion',
      es_hallazgo: true,
      requiere_accion: false,
      reintentable: false,
      cuando: 'El dato existe pero está incompleto, es antiguo o requiere una lectura del contador.',
    },
    diferencia: {
      clave: 'diferencia',
      etiqueta: 'Diferencia detectada',
      severidad: 'atencion',
      es_hallazgo: true,
      requiere_accion: true,
      reintentable: false,
      cuando: 'Dos fuentes disponibles no coinciden (p. ej. F29 declarado vs RCV ingerido).',
    },
    requiere_revision: {
      clave: 'requiere_revision',
      etiqueta: 'Revisión requerida',
      severidad: 'riesgo',
      es_hallazgo: true,
      requiere_accion: true,
      reintentable: false,
      cuando: 'Hay evidencia suficiente para afirmar una contingencia que exige actuación.',
    },
    pendiente: {
      clave: 'pendiente',
      etiqueta: 'Información pendiente',
      severidad: 'info',
      es_hallazgo: false,
      requiere_accion: true,
      reintentable: true,
      cuando: 'La fuente existe y está habilitada, pero todavía no se consultó para el período.',
    },
    fuente_no_disponible: {
      clave: 'fuente_no_disponible',
      etiqueta: 'Fuente temporalmente no disponible',
      severidad: 'info',
      es_hallazgo: false,
      requiere_accion: false,
      reintentable: true,
      cuando: 'La consulta no llegó a completarse por una caída, un tiempo de espera o un bloqueo del proveedor.',
    },
    error_tecnico: {
      clave: 'error_tecnico',
      etiqueta: 'Error técnico',
      severidad: 'info',
      es_hallazgo: false,
      requiere_accion: false,
      reintentable: true,
      cuando: 'Un defecto del sistema impidió procesar la información. No dice nada sobre el contribuyente.',
    },
    fuente_no_habilitada: {
      clave: 'fuente_no_habilitada',
      etiqueta: 'Fuente no habilitada',
      severidad: 'info',
      es_hallazgo: false,
      requiere_accion: false,
      reintentable: false,
      cuando: 'La empresa no contrató o no autorizó esa fuente. No es un incumplimiento.',
    },
    no_concluyente: {
      clave: 'no_concluyente',
      etiqueta: 'Análisis no concluyente',
      severidad: 'info',
      es_hallazgo: false,
      requiere_accion: false,
      reintentable: true,
      cuando: 'Los antecedentes consultados no alcanzan para emitir una conclusión sobre esta materia.',
    },
  }

  const ORDEN = Object.keys(ESTADOS)

  /** Estado por clave. Falla cerrado: una clave desconocida no se inventa. */
  function estado(clave) {
    return Object.prototype.hasOwnProperty.call(ESTADOS, clave) ? ESTADOS[clave] : null
  }

  /**
   * Mensaje profesional del estado. Explica QUÉ ocurrió, QUÉ información queda
   * disponible y QUÉ puede hacer el usuario — nunca «No se pudo obtener
   * información» a secas. `{fuente}`, `{periodo}` y `{detalle}` se sustituyen.
   */
  function mensaje(clave, ctx = {}) {
    const e = estado(clave) || ESTADOS.error_tecnico
    const fuente = ctx.fuente || 'la fuente consultada'
    const periodo = ctx.periodo ? ` (período ${ctx.periodo})` : ''
    const detalle = ctx.detalle ? ` Detalle técnico: ${ctx.detalle}.` : ''
    const reintento = e.reintentable ? ' Puedes reintentar la consulta.' : ''
    const plantillas = {
      verificado: `La información de ${fuente}${periodo} fue verificada y se usa en este análisis.`,
      con_observaciones: `La información de ${fuente}${periodo} está disponible con observaciones: el dato existe pero requiere revisión del contador.`,
      diferencia: `Se detectó una diferencia entre ${fuente}${periodo} y el registro interno. El hallazgo se muestra con la evidencia que lo sustenta.`,
      requiere_revision: `La revisión de ${fuente}${periodo} arrojó una contingencia que requiere actuación. Se indica la evidencia y la acción recomendada.`,
      pendiente: `Aún no se consultó ${fuente}${periodo}. Este apartado no está verificado y no se computa como incumplimiento.`,
      fuente_no_disponible: `No fue posible completar la consulta de ${fuente}${periodo}. Los resultados de este apartado no están verificados para el período seleccionado; los demás análisis que cuentan con información válida permanecen disponibles.${reintento}${detalle}`,
      error_tecnico: `Un problema del sistema impidió procesar ${fuente}${periodo}. No es un hallazgo tributario: la información del contribuyente no está en evaluación aquí.${reintento}${detalle}`,
      fuente_no_habilitada: `${fuente} no está habilitada para esta empresa${periodo}. Su ausencia no constituye un incumplimiento tributario.`,
      no_concluyente: `Con los antecedentes consultados no es posible concluir sobre ${fuente}${periodo}. Se declara el alcance en lugar de emitir una conclusión sin respaldo.`,
    }
    return plantillas[e.clave]
  }

  /**
   * Traducción de los códigos que YA emite el motor (`core/salud-tributaria`:
   * disponible, parcial, no_consultado, sin_informacion, evaluable,
   * no_evaluable) a la taxonomía de presentación. El motor no cambia sus
   * contratos; solo se unifica cómo se leen en pantalla y en el informe.
   */
  const MAPA_MOTOR = {
    disponible: 'verificado',
    evaluable: 'verificado',
    parcial: 'con_observaciones',
    diferencia: 'diferencia',
    revisar: 'requiere_revision',
    requiere_revision: 'requiere_revision',
    no_consultado: 'pendiente',
    pendiente: 'pendiente',
    sin_informacion: 'no_concluyente',
    no_evaluable: 'no_concluyente',
    no_concluyente: 'no_concluyente',
    no_habilitada: 'fuente_no_habilitada',
    fuente_no_disponible: 'fuente_no_disponible',
    error: 'error_tecnico',
    error_tecnico: 'error_tecnico',
  }

  /** Estado de presentación para un código del motor (o para sí mismo). */
  function desdeMotor(codigo) {
    const clave = MAPA_MOTOR[String(codigo || '')]
    return estado(clave) || ESTADOS.no_concluyente
  }

  /**
   * Clasifica el fallo de una consulta externa. La diferencia entre «error
   * técnico» y «fuente no disponible» es operativa: si el proveedor no
   * responde, el usuario debe reintentar más tarde; si el fallo es nuestro,
   * debe reportarlo. Ninguno de los dos es un hallazgo tributario.
   */
  function clasificarFallo({ habilitada = true, detalle = '' } = {}) {
    if (habilitada === false) return estado('fuente_no_habilitada')
    const txt = String(detalle || '')
    const red = /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|network|timeout|tiempo de espera|503|502|504/i
    return red.test(txt) ? estado('fuente_no_disponible') : estado('error_tecnico')
  }

  /**
   * Regla cero ≠ desconocido. Devuelve { estado, valor }:
   *  - sin consulta previa  → pendiente   (valor null)
   *  - consultado sin dato  → no_concluyente (valor null)
   *  - consultado con 0     → verificado  (valor 0: el cero SÍ es un dato)
   */
  function valorDeclarado(valor, { consultado = false, evaluable = true } = {}) {
    if (!consultado) return { estado: 'pendiente', valor: null }
    if (!evaluable || valor === null || valor === undefined || Number.isNaN(Number(valor))) {
      return { estado: 'no_concluyente', valor: null }
    }
    return { estado: 'verificado', valor: Number(valor) }
  }

  /**
   * Vigencia de un dato ya obtenido. No borra lo antiguo (es evidencia): lo
   * marca. `maxDias` por defecto 45 días — un mes tributario más el margen de
   * cierre, el mismo criterio con que se lee un F29 del período anterior.
   */
  function vigencia(consultadoEn, { ahora = Date.now(), maxDias = 45 } = {}) {
    if (!consultadoEn) return { estado: 'pendiente', dias: null, nota: 'Sin fecha de consulta registrada.' }
    const t = new Date(consultadoEn).getTime()
    if (!Number.isFinite(t)) return { estado: 'no_concluyente', dias: null, nota: 'La fecha de consulta no es legible.' }
    const dias = Math.floor((ahora - t) / 86400000)
    if (dias > maxDias) {
      return {
        estado: 'con_observaciones',
        dias,
        nota: `El dato tiene ${dias} días: se mantiene como evidencia, pero no se presenta como vigente.`,
      }
    }
    return { estado: 'verificado', dias, nota: `Consultado hace ${Math.max(0, dias)} día(s).` }
  }

  return { ESTADOS, ORDEN, MAPA_MOTOR, estado, desdeMotor, mensaje, clasificarFallo, valorDeclarado, vigencia }
})
