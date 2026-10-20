/**
 * ui.js — Componentes de estado compartidos (cargado antes de las vistas).
 * Contract: window.UIEstado = { cargando, vacio, chip, error }
 * Pureza: solo template HTML + helpers DOM; sin dependencias Express.
 */
(function () {
  /** Indicador visible de consulta en curso (patrón §7 mandato). */
  function cargando(mensaje = 'Cargando…') {
    return `<div class="ui-loading"><span class="ui-spin"></span> ${esc(mensaje)}</div>`
  }

  /** Estado vacío que explica por qué no hay resultados (§7 mandato: causa). */
  function vacio(titulo, detalle = '', accionHTML = '') {
    return `
      <div class="ui-empty">
        <b>${esc(titulo)}</b>
        ${detalle ? `<p>${esc(detalle)}</p>` : ''}
        ${accionHTML}
      </div>`
  }

  /** Chip semántico genérico (color por familia, nunca custom por vista). */
  function chip(texto, familia = 'neutral') {
    return `<span class="chip ${familia}">${esc(texto)}</span>`
  }

  /** Banner de error reutilizable (mensaje backend directo, sin jerga). */
  function error(mensaje, reintentarHTML = '') {
    return `
      <div class="ui-error">
        <b style="color:var(--danger)">Error</b>
        <p class="muted">${esc(mensaje)}</p>
        ${reintentarHTML}
      </div>`
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  /**
   * Confirmación con alcance para acciones que ESCRIBEN (F3, auditoría §4.3).
   *
   * Reemplaza el `confirm()` del navegador en las acciones con consecuencia
   * contable: muestra qué se va a crear, cuánto y con qué período antes de
   * enviar nada. Devuelve Promise<boolean> — true solo si la persona confirma.
   *
   * `requiere` obliga a teclear un texto exacto (p. ej. el período al cerrar):
   * el botón nace deshabilitado y solo se habilita al calzar. Escape, clic en
   * el fondo y «Cancelar» resuelven false, así ninguna promesa queda colgada
   * (a diferencia de un `confirm()` que nadie puede resolver por otra vía).
   */
  function confirmar({ titulo, cuerpo = '', texto = 'Confirmar', peligro = false, requiere = null, idBoton = 'ui-conf-ok', idInput = 'ui-conf-input' } = {}) {
    return new Promise((resolve) => {
      let cerrado = false
      const fin = (valor) => {
        if (cerrado) return
        cerrado = true
        document.removeEventListener('keydown', enEsc, true)
        document.removeEventListener('click', enFondo, true)
        cerrarModal()
        resolve(valor)
      }
      const enEsc = (e) => { if (e && e.key === 'Escape') fin(false) }
      const enFondo = (e) => { if (e && e.target && e.target.id === 'modal-back') fin(false) }

      openModal(`
        <h3>${esc(titulo)}</h3>
        <div class="ui-confirm">${cuerpo}</div>
        ${requiere ? `
        <div class="mt">
          <span class="frm-label">Escribe <b class="mono">${esc(requiere)}</b> para confirmar</span>
          <input id="${idInput}" class="form-input mt" autocomplete="off" spellcheck="false" style="width:100%">
        </div>` : ''}
        <div class="modal-foot">
          <button class="btn btn-secondary" id="ui-conf-no">Cancelar</button>
          <button class="btn ${peligro ? 'btn-danger' : 'btn-primary'}" id="${idBoton}" ${requiere ? 'disabled' : ''}>${esc(texto)}</button>
        </div>`)

      document.addEventListener('keydown', enEsc, true)
      document.addEventListener('click', enFondo, true)
      document.getElementById('ui-conf-no').addEventListener('click', () => fin(false))
      const boton = document.getElementById(idBoton)
      boton.addEventListener('click', () => fin(true))
      if (requiere) {
        const input = document.getElementById(idInput)
        input.addEventListener('input', () => { boton.disabled = input.value.trim() !== requiere })
      }
    })
  }

  /** Fila de dato para el cuerpo de una confirmación (etiqueta → valor). */
  function dato(etiqueta, valorHTML) {
    return `<dt>${esc(etiqueta)}</dt><dd>${valorHTML}</dd>`
  }

  /**
   * VIEW calculadora de IVA — Herramientas.
   * Aritmética local (equivalente al reporte existente de resumen IVA, vista
   * por documento desde la bandeja); NO calcula impuesto definitivo:
   * la diferencia débito-crédito se etiqueta como PROVISIONAL.
   */
  function calculadoraIvaHTML({ neto = '', iva = '', total = '', ventaja = '' } = {}) {
    return `
      <div class="card">
        <h3>Conversor neto / IVA / total</h3>
        <p class="hint">Ingresá cualquier valor que conozca: los otros dos se calculan al instante (Tasa 19%).</p>
        <div class="frm-row mt">
          <div><span class="frm-label">Neto</span><input id="ci-neto" type="number" class="form-input" value="${neto}" style="width:auto"></div>
          <div><span class="frm-label">IVA (19%)</span><input id="ci-iva" type="number" class="form-input" value="${iva}" style="width:auto"></div>
          <div><span class="frm-label">Total</span><input id="ci-total" type="number" class="form-input" value="${total}" style="width:auto"></div>
          <button class="btn btn-secondary" id="ci-limpiar">Limpiar</button>
        </div>
      </div>
      <div class="card mt">
        <h3>IVA determinado (provisional)</h3>
        <p class="hint">Débito (IVA de ventas) − crédito (IVA de compras). <b>No</b> incluye PPM, retenciones ni ajustes del F29: es solo la aritmética de tus libros.</p>
        <div class="frm-row mt">
          <div><span class="frm-label">IVA ventas (débito)</span><input id="ci-debito" type="number" class="form-input" value="" style="width:auto"></div>
          <div><span class="frm-label">IVA compras (crédito)</span><input id="ci-credito" type="number" class="form-input" value="" style="width:auto"></div>
          <div><span class="frm-label">Diferencia</span><span id="ci-dif" class="mono" style="font-size:var(--fs-lg);font-weight:600">—</span></div>
        </div>
      </div>`
  }

  function conectarCalculadoraIva() {
    const TASA = 0.19
    const $ = (id) => document.getElementById(id)
    const fmt = (n) => (Number.isFinite(n) ? new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(n)) : '—')
    //nac: evita recalcular el campo que está siendo editado (no bloquear el input del usuario)
    function recalcular(desde) {
      const neto = parseFloat($('ci-neto')?.value)
      const iva = parseFloat($('ci-iva')?.value)
      const total = parseFloat($('ci-total')?.value)
      if (desde === 'ci-neto' && Number.isFinite(neto)) {
        $('ci-iva').value = Math.round(neto * TASA)
        $('ci-total').value = Math.round(neto * (1 + TASA))
      } else if (desde === 'ci-iva' && Number.isFinite(iva)) {
        $('ci-neto').value = Math.round(iva / TASA)
        $('ci-total').value = Math.round((iva / TASA) * (1 + TASA))
      } else if (desde === 'ci-total' && Number.isFinite(total)) {
        $('ci-neto').value = Math.round(total / (1 + TASA))
        $('ci-iva').value = Math.round(total - total / (1 + TASA))
      }
      // diferencia débito−crédito
      const debito = parseFloat($('ci-debito')?.value)
      const credito = parseFloat($('ci-credito')?.value)
      if (Number.isFinite(debito) || Number.isFinite(credito)) {
        const d = (Number.isFinite(debito) ? debito : 0) - (Number.isFinite(credito) ? credito : 0)
        const el = $('ci-dif')
        el.textContent = fmt(d)
        el.style.color = d >= 0 ? 'var(--success)' : 'var(--danger)'
      }
    }
    ;['ci-neto', 'ci-iva', 'ci-total', 'ci-debito', 'ci-credito'].forEach((id) => {
      $(id)?.addEventListener('input', () => recalcular(id))
    })
    $('ci-limpiar')?.addEventListener('click', () => {
      ;['ci-neto', 'ci-iva', 'ci-total', 'ci-debito', 'ci-credito'].forEach((id) => { if ($(id)) $(id).value = '' })
      $('ci-dif').textContent = '—'
      $('ci-dif').style.color = ''
    })
  }

  window.UIEstado = { cargando, vacio, chip, error, confirmar, dato, calculadoraIvaHTML, conectarCalculadoraIva }
})()
