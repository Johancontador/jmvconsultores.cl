'use strict'
/**
 * FIXTURES DETERMINISTAS — estados de Salud Tributaria (F0.3).
 *
 * Datos 100% inventados (RUT y montos de ejemplo) y fechas fijas: ninguna
 * cifra productiva, ningún reloj real. Cada caso declara la ENTRADA y el
 * ESTADO ESPERADO, de modo que el test falla si el significado de un estado
 * cambia. Los consume test/salud-estados.test.js.
 */

// Reloj congelado: la vigencia no puede depender de la fecha en que se corre
// la suite (un test que pasa hoy y falla en 46 días no es un contrato).
const AHORA = Date.parse('2026-10-23T12:00:00Z')

/** Los 9 estados del handoff §4.5, con su condición de activación. */
const CASOS_ESTADO = [
  { clave: 'verificado', es_hallazgo: false, requiere_accion: false, severidad: 'ok' },
  { clave: 'con_observaciones', es_hallazgo: true, requiere_accion: false, severidad: 'atencion' },
  { clave: 'diferencia', es_hallazgo: true, requiere_accion: true, severidad: 'atencion' },
  { clave: 'requiere_revision', es_hallazgo: true, requiere_accion: true, severidad: 'riesgo' },
  { clave: 'pendiente', es_hallazgo: false, requiere_accion: true, severidad: 'info' },
  { clave: 'fuente_no_disponible', es_hallazgo: false, requiere_accion: false, severidad: 'info' },
  { clave: 'error_tecnico', es_hallazgo: false, requiere_accion: false, severidad: 'info' },
  { clave: 'fuente_no_habilitada', es_hallazgo: false, requiere_accion: false, severidad: 'info' },
  { clave: 'no_concluyente', es_hallazgo: false, requiere_accion: false, severidad: 'info' },
]

/**
 * Cero confirmado ≠ dato desconocido. `valorDeclarado(valor, opciones)`:
 * `consultado:false` es «pendiente» aunque el valor sea 0; un 0 consultado es
 * «verificado» (la fuente respondió que no hay exposición).
 */
const CASOS_VALOR = [
  { nombre: 'cero confirmado', entrada: [0, { consultado: true, evaluable: true }], esperado: { estado: 'verificado', valor: 0 } },
  { nombre: 'monto confirmado', entrada: [1250000, { consultado: true, evaluable: true }], esperado: { estado: 'verificado', valor: 1250000 } },
  { nombre: 'desconocido sin consulta', entrada: [0, { consultado: false }], esperado: { estado: 'pendiente', valor: null } },
  { nombre: 'consultado sin dato', entrada: [null, { consultado: true }], esperado: { estado: 'no_concluyente', valor: null } },
  { nombre: 'no evaluable', entrada: [0, { consultado: true, evaluable: false }], esperado: { estado: 'no_concluyente', valor: null } },
]

/** Información antigua: se marca, no se borra ni se presenta como vigente. */
const CASOS_VIGENCIA = [
  { nombre: 'consultado hoy', entrada: ['2026-10-23T09:00:00Z'], esperado: { estado: 'verificado', dias: 0 } },
  { nombre: 'consultado hace 30 días', entrada: ['2026-09-23T12:00:00Z'], esperado: { estado: 'verificado', dias: 30 } },
  { nombre: 'antiguo (60 días)', entrada: ['2026-08-24T12:00:00Z'], esperado: { estado: 'con_observaciones', dias: 60 } },
  { nombre: 'sin fecha', entrada: [null], esperado: { estado: 'pendiente', dias: null } },
  { nombre: 'fecha ilegible', entrada: ['no-es-fecha'], esperado: { estado: 'no_concluyente', dias: null } },
]

/** Fallo de consulta externa: proveedor caído ≠ defecto propio ≠ no habilitada. */
const CASOS_FALLO = [
  { nombre: 'sin habilitar', entrada: { habilitada: false, detalle: 'ECONNREFUSED' }, esperado: 'fuente_no_habilitada' },
  { nombre: 'proveedor caído', entrada: { habilitada: true, detalle: 'fetch failed' }, esperado: 'fuente_no_disponible' },
  { nombre: 'tiempo de espera', entrada: { habilitada: true, detalle: 'ETIMEDOUT al leer el RCV' }, esperado: 'fuente_no_disponible' },
  { nombre: 'defecto propio', entrada: { habilitada: true, detalle: 'Cannot read properties of undefined' }, esperado: 'error_tecnico' },
]

module.exports = { AHORA, CASOS_ESTADO, CASOS_VALOR, CASOS_VIGENCIA, CASOS_FALLO }
