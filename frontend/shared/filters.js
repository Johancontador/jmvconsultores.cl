/**
 * Barra de filtros reutilizable. Recibe una definición declarativa y devuelve
 * los valores actuales cada vez que algo cambia.
 *
 * definicion: [{ key, label, type: 'select'|'text'|'number'|'date', options?: [{value,label}], placeholder? }]
 */
function renderFiltros(contenedor, definicion, valoresIniciales, onChange) {
  const valores = { ...valoresIniciales }

  function campoHtml(f) {
    const valor = valores[f.key] ?? ''
    if (f.type === 'select') {
      return `
        <select data-key="${f.key}" class="filtro-input">
          ${(f.options || []).map((o) => `<option value="${o.value}" ${String(o.value) === String(valor) ? 'selected' : ''}>${o.label}</option>`).join('')}
        </select>`
    }
    if (f.type === 'number') {
      return `<input type="number" data-key="${f.key}" class="filtro-input form-input" placeholder="${f.placeholder || ''}" value="${valor}">`
    }
    if (f.type === 'date') {
      return `<input type="date" data-key="${f.key}" class="filtro-input form-input" value="${valor}">`
    }
    return `<input type="text" data-key="${f.key}" class="filtro-input form-input" placeholder="${f.placeholder || ''}" value="${valor}">`
  }

  contenedor.innerHTML = `
    <div class="filtros-bar">
      ${definicion.map((f) => `
        <div class="filtro-group">
          <label>${f.label}</label>
          ${campoHtml(f)}
        </div>`).join('')}
      <button type="button" class="btn btn-secondary btn-sm" id="btn-limpiar-filtros">Limpiar</button>
    </div>`

  contenedor.querySelectorAll('.filtro-input').forEach((input) => {
    input.addEventListener('change', () => {
      valores[input.dataset.key] = input.value
      onChange({ ...valores })
    })
  })

  contenedor.querySelector('#btn-limpiar-filtros').addEventListener('click', () => {
    definicion.forEach((f) => { delete valores[f.key] })
    renderFiltros(contenedor, definicion, {}, onChange)
    onChange({})
  })

  return { valores: () => ({ ...valores }) }
}

/** Aplica un objeto de filtros a un array de filas (compras/ventas/documentos). */
function aplicarFiltros(filas, filtros) {
  return filas.filter((fila) => {
    if (filtros.rut && !String(fila.rutDoc || '').includes(filtros.rut.replace(/[.\-]/g, ''))) return false
    if (filtros.folio && String(fila.folio || '') !== String(filtros.folio)) return false
    if (filtros.tipoDoc && String(fila.tipoDoc) !== String(filtros.tipoDoc)) return false
    if (filtros.montoMin && (fila.montoNeto || 0) < Number(filtros.montoMin)) return false
    if (filtros.montoMax && (fila.montoNeto || 0) > Number(filtros.montoMax)) return false
    if (filtros.exento === 'si' && !(fila.montoExento > 0)) return false
    if (filtros.exento === 'no' && fila.montoExento > 0) return false
    return true
  })
}
