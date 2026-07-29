/**
 * Tabla genérica: ordenamiento por columna, formato por columna, fila de
 * totales opcional. No pagina (los volúmenes de este sistema — documentos de
 * un mes, o meses de un año — no lo necesitan); si un reporte crece mucho se
 * agrega paginación después sin cambiar la firma de esta función.
 *
 * columnas: [{ key, label, align: 'left'|'right', format: fn(valor, fila) }]
 * filas: array de objetos
 * opciones: { totales: fn(filas) => objeto con mismas keys, vacio: 'texto' }
 */
function renderTabla(contenedor, columnas, filas, opciones = {}) {
  let ordenKey = null
  let ordenAsc = true

  function ordenar(filas) {
    if (!ordenKey) return filas
    const copia = [...filas]
    copia.sort((a, b) => {
      const va = a[ordenKey]
      const vb = b[ordenKey]
      if (typeof va === 'number' && typeof vb === 'number') return ordenAsc ? va - vb : vb - va
      return ordenAsc
        ? String(va ?? '').localeCompare(String(vb ?? ''), 'es')
        : String(vb ?? '').localeCompare(String(va ?? ''), 'es')
    })
    return copia
  }

  function celda(col, fila) {
    const valor = fila[col.key]
    return col.format ? col.format(valor, fila) : (valor ?? '')
  }

  function pintar() {
    const filasOrdenadas = ordenar(filas)
    const totales = opciones.totales ? opciones.totales(filas) : null

    contenedor.innerHTML = `
      <table class="tabla-generica informe-table">
        <thead>
          <tr>
            ${columnas.map((col) => `
              <th class="${col.align === 'right' ? 'th-right' : ''} ${col.sortable !== false ? 'th-sortable' : ''}" data-key="${col.key}">
                ${col.label}${ordenKey === col.key ? (ordenAsc ? ' ▲' : ' ▼') : ''}
              </th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${filasOrdenadas.length === 0
            ? `<tr><td colspan="${columnas.length}" class="libro-empty">${opciones.vacio || 'Sin datos'}</td></tr>`
            : filasOrdenadas.map((fila) => `
              <tr>
                ${columnas.map((col) => `<td class="${col.align === 'right' ? 'th-right' : ''}">${celda(col, fila)}</td>`).join('')}
              </tr>`).join('')}
        </tbody>
        ${totales ? `
        <tfoot>
          <tr class="row-total">
            ${columnas.map((col, idx) => `
              <td class="${col.align === 'right' ? 'th-right' : ''}">${idx === 0 ? 'TOTAL' : (col.format ? col.format(totales[col.key], totales) : (totales[col.key] ?? ''))}</td>`).join('')}
          </tr>
        </tfoot>` : ''}
      </table>`

    contenedor.querySelectorAll('.th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key
        if (ordenKey === key) ordenAsc = !ordenAsc
        else { ordenKey = key; ordenAsc = true }
        pintar()
      })
    })
  }

  pintar()
  return { actualizar: (nuevasFilas) => { filas = nuevasFilas; pintar() } }
}
