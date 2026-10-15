/**
 * sii-convenios.js — CONVENIOS del RCV compartidos (fuente ÚNICA de la regla).
 *
 * En la bandeja `documentos` las notas de crédito (códigos 60/61) quedan con
 * montos POSITIVOS (así los entrega el RCV del SII y los encaja
 * documentos.ingestarBatch); el signo se aplica al AGREGAR. Este módulo
 * comparte la regla para que dashboard, analitica, portal y conciliación
 * calculen los MISMOS totales:
 *
 *   SUM(CASE WHEN tipo_doc IN (60,61) THEN -monto ELSE monto END)
 *
 * (routes/sii.js usa la MISMA convención sobre el resumen oficial
 * getResumen: `signo = esNotaCredito(tipoDoc) ? -1 : 1`; propuestas.js y
 * conciliacion.js la aplican por documento con esNC + patas invertidas §6.)
 *
 * Regla §9 del portal: NC resta UNA vez. Sumar crudo infla el total;
 * descontar dos veces lo anularía.
 */

/** Tipos de documento que CORRIGEN (restan) en los RCV de compra y venta. */
const TIPOS_NC = [60, 61]

/** Snippet SQL del signo. Uso: `SUM(${SIGNO_NC}(monto_neto))`. */
const SIGNO_NC = `CASE WHEN tipo_doc IN (60, 61) THEN -1 ELSE 1 END *`

function esNC(tipoDoc) {
  return TIPOS_NC.includes(Number(tipoDoc))
}

/** Signo JS para agregaciones en memoria (un doc a la vez). */
function signoDe(tipoDoc) {
  return esNC(tipoDoc) ? -1 : 1
}

module.exports = { TIPOS_NC, SIGNO_NC, esNC, signoDe }
