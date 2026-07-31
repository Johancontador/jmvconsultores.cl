/**
 * Grilla estilo planilla de cálculo: buscar, ordenar, agrupar, congelar la
 * primera columna, mostrar/ocultar columnas, totales abajo, doble-click abre
 * detalle, y menú de click derecho. Pensada para tablas de documentos
 * (Libro de Compras/Ventas) que ya vienen descargadas — no hace peticiones
 * nuevas, solo presenta mejor lo que ya se tiene en memoria.
 *
 * config = {
 *   columnas: [{ key, label, align, format, congelar? }],  // primera columna se congela si congelar=true
 *   filas: [...],
 *   agrupar: { key, label } | null,        // ej. { key: 'tipoDoc', label: 'Tipo de documento' }
 *   nombreGrupo: (valorKey) => string,     // cómo mostrar el valor del grupo (ej. nombre del tipo doc)
 *   totales: (filas) => objeto,            // misma forma que una fila, para la fila de totales
 *   onDobleClick: (fila) => void,
 *   menuContextual: (fila) => [{ label, accion: (fila) => void }],
 * }
 */
function renderDataGrid(contenedor, config) {
  let busqueda = ''
  let ordenKey = null
  let ordenAsc = true
  let agruparActivo = !!config.agrupar
  let panelColumnasAbierto = false
  const columnasOcultas = new Set()

  function filasBase() {
    if (!busqueda) return config.filas
    const q = busqueda.toLowerCase()
    return config.filas.filter((fila) =>
      config.columnas.some((c) => String(fila[c.key] ?? '').toLowerCase().includes(q))
    )
  }

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

  function columnasVisibles() {
    return config.columnas.filter((c) => !columnasOcultas.has(c.key))
  }

  function celda(col, fila) {
    const valor = fila[col.key]
    return col.format ? col.format(valor, fila) : (valor ?? '')
  }

  function filaHtml(fila, cols) {
    return `
      <tr data-idx="${fila.__idx}">
        ${cols.map((c, i) => `<td class="${c.align === 'right' ? 'th-right' : ''} ${i === 0 && c.congelar ? 'dg-freeze' : ''}">${celda(c, fila)}</td>`).join('')}
      </tr>`
  }

  function pintarToolbar() {
    return `
      <div class="dg-toolbar">
        <input type="text" class="filtro-input dg-buscar" placeholder="🔍 Buscar en todas las columnas..." value="${busqueda}">
        ${config.agrupar ? `
          <label class="dg-check">
            <input type="checkbox" id="dg-agrupar" ${agruparActivo ? 'checked' : ''}>
            Agrupar por ${config.agrupar.label}
          </label>` : ''}
        <div class="dg-columnas-wrap">
          <button type="button" class="btn btn-secondary btn-sm" id="dg-btn-columnas">☰ Columnas</button>
          <div class="dg-columnas-panel" id="dg-columnas-panel" ${panelColumnasAbierto ? '' : 'hidden'}>
            ${config.columnas.map((c) => `
              <label class="dg-check">
                <input type="checkbox" data-col="${c.key}" ${columnasOcultas.has(c.key) ? '' : 'checked'}>
                ${c.label}
              </label>`).join('')}
          </div>
        </div>
      </div>`
  }

  function pintarTablaPlana(filas, cols) {
    return `
      <table class="informe-table tabla-generica dg-table">
        <thead><tr>${cols.map((c, i) => `
          <th class="${c.align === 'right' ? 'th-right' : ''} th-sortable ${i === 0 && c.congelar ? 'dg-freeze' : ''}" data-key="${c.key}">
            ${c.label}${ordenKey === c.key ? (ordenAsc ? ' ▲' : ' ▼') : ''}
          </th>`).join('')}</tr></thead>
        <tbody>
          ${filas.length ? filas.map((f) => filaHtml(f, cols)).join('') : `<tr><td colspan="${cols.length}" class="libro-empty">Sin documentos</td></tr>`}
        </tbody>
        ${config.totales ? pintarTotales(filas, cols) : ''}
      </table>`
  }

  function pintarTablaAgrupada(filas, cols) {
    const grupos = new Map()
    for (const f of filas) {
      const k = f[config.agrupar.key]
      if (!grupos.has(k)) grupos.set(k, [])
      grupos.get(k).push(f)
    }

    let html = `<table class="informe-table tabla-generica dg-table">
      <thead><tr>${cols.map((c, i) => `
        <th class="${c.align === 'right' ? 'th-right' : ''} th-sortable ${i === 0 && c.congelar ? 'dg-freeze' : ''}" data-key="${c.key}">
          ${c.label}${ordenKey === c.key ? (ordenAsc ? ' ▲' : ' ▼') : ''}
        </th>`).join('')}</tr></thead><tbody>`

    for (const [valorGrupo, filasGrupo] of grupos) {
      const nombre = config.nombreGrupo ? config.nombreGrupo(valorGrupo) : valorGrupo
      const subtotal = config.totales ? config.totales(filasGrupo) : null
      html += `
        <tr class="dg-grupo-header" data-grupo="${valorGrupo}">
          <td colspan="${cols.length}">
            <span class="dg-grupo-toggle">▾</span> ${nombre} <span class="dg-grupo-count">(${filasGrupo.length})</span>
            ${subtotal ? `<span class="dg-grupo-subtotal">${cols.filter((c) => c.align === 'right' && c.key in subtotal).map((c) => c.format ? c.format(subtotal[c.key], subtotal) : subtotal[c.key]).join(' · ')}</span>` : ''}
          </td>
        </tr>`
      html += filasGrupo.map((f) => filaHtml(f, cols)).join('')
    }

    html += `</tbody>${config.totales ? pintarTotales(filas, cols) : ''}</table>`
    return html
  }

  function pintarTotales(filas, cols) {
    const t = config.totales(filas)
    return `
      <tfoot><tr class="row-total">
        ${cols.map((c, i) => `<td class="${c.align === 'right' ? 'th-right' : ''}">${i === 0 ? 'TOTAL' : (!(c.key in t) ? '' : (c.format ? c.format(t[c.key], t) : (t[c.key] ?? '')))}</td>`).join('')}
      </tr></tfoot>`
  }

  function pintar() {
    const conIndice = config.filas.map((f, i) => ({ ...f, __idx: i }))
    config.filas = conIndice // asegura __idx estable mientras no cambien las filas base

    const cols = columnasVisibles()
    const filtradas = ordenar(filasBase())

    contenedor.innerHTML = `
      ${pintarToolbar()}
      <div class="dg-scroll">
        ${agruparActivo && config.agrupar ? pintarTablaAgrupada(filtradas, cols) : pintarTablaPlana(filtradas, cols)}
      </div>`

    wireEventos(filtradas)
  }

  function wireEventos(filasActuales) {
    const $buscar = contenedor.querySelector('.dg-buscar')
    $buscar.addEventListener('input', () => { busqueda = $buscar.value; pintar(); $buscar.focus(); $buscar.setSelectionRange($buscar.value.length, $buscar.value.length) })

    contenedor.querySelectorAll('.th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.key
        if (ordenKey === key) ordenAsc = !ordenAsc
        else { ordenKey = key; ordenAsc = true }
        pintar()
      })
    })

    const $btnCols = contenedor.querySelector('#dg-btn-columnas')
    const $panelCols = contenedor.querySelector('#dg-columnas-panel')
    if ($btnCols) {
      $btnCols.addEventListener('click', (e) => {
        e.stopPropagation()
        panelColumnasAbierto = !panelColumnasAbierto
        $panelCols.hidden = !panelColumnasAbierto
      })
      $panelCols.addEventListener('click', (e) => e.stopPropagation()) // clickear adentro no lo cierra
      $panelCols.querySelectorAll('input[type=checkbox]').forEach((chk) => {
        chk.addEventListener('change', () => {
          if (chk.checked) columnasOcultas.delete(chk.dataset.col)
          else columnasOcultas.add(chk.dataset.col)
          // Se mantiene abierto a través del repintado — antes se cerraba solo
          // apenas se marcaba una columna, porque pintar() reconstruye todo el
          // toolbar y el panel volvía a nacer oculto.
          panelColumnasAbierto = true
          pintar()
        })
      })
    }

    const $agrupar = contenedor.querySelector('#dg-agrupar')
    if ($agrupar) {
      $agrupar.addEventListener('change', () => { agruparActivo = $agrupar.checked; pintar() })
    }

    contenedor.querySelectorAll('.dg-grupo-header').forEach((tr) => {
      tr.addEventListener('click', () => {
        let siguiente = tr.nextElementSibling
        const abrir = tr.querySelector('.dg-grupo-toggle').textContent === '▸'
        tr.querySelector('.dg-grupo-toggle').textContent = abrir ? '▾' : '▸'
        while (siguiente && !siguiente.classList.contains('dg-grupo-header')) {
          siguiente.style.display = abrir ? '' : 'none'
          siguiente = siguiente.nextElementSibling
        }
      })
    })

    // Se busca la fila por su __idx estable (no por posición en el DOM) porque
    // al agrupar, el orden visual deja de coincidir con el orden de filasActuales.
    function filaPorIdx(tr) {
      const idx = Number(tr.dataset.idx)
      return config.filas.find((f) => f.__idx === idx)
    }

    if (config.onDobleClick) {
      contenedor.querySelectorAll('tbody tr[data-idx]').forEach((tr) => {
        tr.addEventListener('dblclick', () => config.onDobleClick(filaPorIdx(tr)))
      })
    }

    if (config.menuContextual) {
      contenedor.querySelectorAll('tbody tr[data-idx]').forEach((tr) => {
        tr.addEventListener('contextmenu', (e) => {
          e.preventDefault()
          mostrarMenuContextual(e.clientX, e.clientY, config.menuContextual(filaPorIdx(tr)))
        })
      })
    }
  }

  // Cierra el panel "Columnas" al hacer click fuera de él. Se registra una
  // sola vez por grilla (no en cada pintar()) y sincroniza panelColumnasAbierto
  // para que el botón "☰ Columnas" siga funcionando bien después de cerrarlo así.
  document.addEventListener('click', (e) => {
    if (!panelColumnasAbierto) return
    if (e.target.closest('.dg-columnas-wrap')) return
    panelColumnasAbierto = false
    const panel = contenedor.querySelector('#dg-columnas-panel')
    if (panel) panel.hidden = true
  })

  pintar()

  // Expone actualizar() para que un llamador (ej. filtros de Libro) pueda
  // reemplazar las filas base sin tener que reconstruir toda la grilla.
  return {
    actualizar: (nuevasFilas) => {
      config.filas = nuevasFilas
      pintar()
    },
  }
}

function mostrarMenuContextual(x, y, items) {
  document.querySelectorAll('.dg-context-menu').forEach((m) => m.remove())
  const menu = document.createElement('div')
  menu.className = 'dg-context-menu'
  menu.style.left = `${x}px`
  menu.style.top = `${y}px`
  menu.innerHTML = items.map((it, i) => `<button type="button" class="dg-context-item" data-i="${i}">${it.label}</button>`).join('')
  document.body.appendChild(menu)

  menu.querySelectorAll('.dg-context-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      items[Number(btn.dataset.i)].accion()
      menu.remove()
    })
  })

  setTimeout(() => {
    document.addEventListener('click', function cerrar() {
      menu.remove()
      document.removeEventListener('click', cerrar)
    })
  }, 0)
}

/** Modal genérico de detalle de documento (para doble-click). Reutiliza las clases .modal-overlay/.modal ya existentes. */
function mostrarModalDetalle(titulo, campos) {
  document.querySelectorAll('.dg-modal-detalle').forEach((m) => m.remove())
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay open dg-modal-detalle'
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${titulo}</h2>
        <button type="button" class="btn-icon dg-cerrar-modal" aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body">
        ${campos.map(([label, valor]) => `
          <div class="dg-modal-campo"><span>${label}</span><strong>${valor}</strong></div>`).join('')}
      </div>
    </div>`
  document.body.appendChild(overlay)

  const cerrar = () => overlay.remove()
  overlay.querySelector('.dg-cerrar-modal').addEventListener('click', cerrar)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar() })
}

function copiarAlPortapapeles(texto, mensaje) {
  navigator.clipboard.writeText(String(texto))
    .then(() => showToast(mensaje || 'Copiado'))
    .catch(() => showToast('No se pudo copiar', 'error'))
}
