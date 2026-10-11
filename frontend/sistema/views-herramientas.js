/**
 * views-herramientas.js — Herramientas (mandato §5.H).
 * Calculadora de IVA: conversor neto/IVA/total + diferencia débito-crédito
 * PROVISIONAL etiquetada como tal. Cero backend: aritmética local, sin tocar
 * reportes existentes ni duplicar módulos.
 */
VIEWS['calculadora-iva'] = {
  titulo: 'Herramientas — Calculadora de IVA',
  render(cont) {
    cont.innerHTML = `
      <h1 style="display:none"></h1>
      ${window.UIEstado ? UIEstado.calculadoraIvaHTML() : ''}
    `
    if (window.UIEstado) UIEstado.conectarCalculadoraIva()
  },
}
