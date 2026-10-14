/**
 * UI TOOLKIT — tabla cliente reutilizable para /sistema/.
 *
 * Una sola implementación de: buscador en vivo, ordenamiento por columna,
 * paginación, exportación CSV/Excel con BOM y impresión. Las vistas le pasan
 * columnas + filas crudas (datos, no DOM): nunca más scraping de la tabla.
 *
 * Uso:
 *   UITabla.montar({
 *     mount, columnas, filas, busqueda, porPagina, nombreArchivo,
 *     filaHTML, totalesHTML, vacio
 *   }) → { refrescar(filas) }
 */
(function () {
  const esc = (v) => (window.escapeHtml ? escapeHtml(v) : String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))

  const estado = new Map() // id mount → estado de esa tabla
  let seq = 0

  function normalizar(v) {
    return String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  }

  function comparar(a, b) {
    const na = Number(a), nb = Number(b)
    if (!Number.isNaN(na) && !Number.isNaN(nb) && a !== '' && b !== '') return na - nb
    return normalizar(a).localeCompare(normalizar(b), 'es')
  }

  function resaltar(texto, q) {
    const t = esc(texto)
    if (!q) return t
    const nq = normalizar(q)
    // Resalta la primera coincidencia sin romper escapes: búsqueda simple.
    const idx = normalizar(texto).indexOf(nq)
    if (idx < 0) return t
    return esc(String(texto ?? '').slice(0, idx)) +
      '<mark class="hl">' + esc(String(texto ?? '').slice(idx, idx + q.length)) + '</mark>' +
      esc(String(texto ?? '').slice(idx + q.length))
  }

  function filtrar(st) {
    let out = st.filas
    if (st.q) {
      const campos = st.columnas.filter((c) => c.buscar !== false).map((c) => (f) => (c.valor ? c.valor(f) : f[c.key]))
      out = out.filter((f) => campos.some((get) => normalizar(get(f)).includes(normalizar(st.q))))
    }
    if (st.sortKey) {
      const col = st.columnas.find((c) => c.key === st.sortKey)
      const dir = st.sortDir === 'asc' ? 1 : -1
      out = [...out].sort((a, b) => {
        // crudo primero: columnas numéricas formateadas ("$1.234") deben ordenar por número.
        const va = col?.crudo ? col.crudo(a) : (col?.valor ? col.valor(a) : a[st.sortKey])
        const vb = col?.crudo ? col.crudo(b) : (col?.valor ? col.valor(b) : b[st.sortKey])
        return comparar(va, vb) * dir
      })
    }
    return out
  }

  function paginar(st, filas) {
    if (!st.porPagina) return { pagina: filas, total: filas.length, paginas: 1 }
    const paginas = Math.max(1, Math.ceil(filas.length / st.porPagina))
    const p = Math.min(st.pagina, paginas)
    return { pagina: filas.slice((p - 1) * st.porPagina, p * st.porPagina), total: filas.length, paginas, actual: p }
  }

  function csvDescargar(st, filas) {
    const sep = ';'
    const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [st.columnas.map((c) => celda(c.label)).join(sep)]
    for (const f of filas) lines.push(st.columnas.map((c) => celda(c.crudo ? c.crudo(f) : (c.valor ? c.valor(f) : f[c.key]))).join(sep))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = `${st.nombreArchivo}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /** Descarga Excel real: CSV con BOM renombrado .xls lo abre Excel/Sheets limpio. */
  function excelDescargar(st, filas) {
    const sep = ';'
    const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [st.columnas.map((c) => celda(c.label)).join(sep)]
    for (const f of filas) lines.push(st.columnas.map((c) => celda(c.crudo ? c.crudo(f) : (c.valor ? c.valor(f) : f[c.key]))).join(sep))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'application/vnd.ms-excel;charset=utf-8' }))
    a.download = `${st.nombreArchivo}.xls`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function copiar(st, filas) {
    const lines = [st.columnas.map((c) => c.label).join('\t')]
    for (const f of filas) lines.push(st.columnas.map((c) => String(c.crudo ? c.crudo(f) : (c.valor ? c.valor(f) : f[c.key]))).join('\t'))
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => window.showToast && showToast(`Copiadas ${filas.length} fila(s) al portapapeles`, 'success'))
      .catch(() => window.showToast && showToast('No se pudo copiar', 'error'))
  }

  function montar(opciones) {
    const id = `uit-${++seq}`
    const st = {
      id,
      columnas: opciones.columnas,
      filas: opciones.filas || [],
      q: '',
      sortKey: opciones.ordenInicial?.key || null,
      sortDir: opciones.ordenInicial?.dir || 'asc',
      pagina: 1,
      porPagina: opciones.porPagina || 0,
      nombreArchivo: opciones.nombreArchivo || 'exportacion',
      filaHTML: opciones.filaHTML,
      totalesHTML: opciones.totalesHTML || '',
      vacio: opciones.vacio || 'Sin datos',
      accionesExtra: opciones.accionesExtra || '',
      // B3 (masterplan unificación): capacidades del datagrid integradas como
      // opciones de UITabla — agrupar por UNA clave con encabezado de grupo
      // colapsable + subtotal, y congelar la primera columna. La visibilidad
      // de columnas sigue siendo exclusiva de datagrid.js (filaHTML fija).
      agrupar: opciones.agrupar || null, // { key, label, nombreGrupo?, subtotal? }
      agrupado: !!opciones.agrupar && opciones.agrupadoPorDefecto !== false,
      congelar: !!opciones.congelar,
      gruposCerrados: new Set(),
      mount: opciones.mount,
    }
    estado.set(id, st)

    const herramientas = `
      <div class="tbl-toolbar">
        <input type="search" id="${id}-q" placeholder="Buscar…" value="${esc(st.q)}" aria-label="Buscar en la tabla">
        ${st.agrupar ? `<label class="dg-check" title="Agrupa las filas por ${esc(st.agrupar.label)} con subtotal por grupo">
          <input type="checkbox" id="${id}-agr" ${st.agrupado ? 'checked' : ''}>
          Agrupar por ${esc(st.agrupar.label)}
        </label>` : ''}
        <span class="spacer"></span>
        <span class="hint" id="${id}-info"></span>
        <button class="btn btn-secondary btn-sm" id="${id}-csv" title="Descargar CSV">CSV</button>
        <button class="btn btn-secondary btn-sm" id="${id}-xls" title="Descargar para Excel">Excel</button>
        <button class="btn btn-secondary btn-sm" id="${id}-copiar" title="Copiar al portapapeles">Copiar</button>
        <button class="btn btn-secondary btn-sm" id="${id}-imprimir" title="Imprimir">Imprimir</button>
        ${st.accionesExtra}
      </div>`

    const head = st.columnas.map((c) =>
      `<th class="${c.num ? 'num' : ''} ${c.orden !== false ? 'th-sort' : ''}" data-k="${esc(c.key)}">${esc(c.label)}</th>`).join('')

    st.mount.innerHTML = `
      ${herramientas}
      <div class="tbl-wrap">
        <table class="tbl ${st.congelar ? 'uit-congelar' : ''}">
          <thead><tr>${head}</tr></thead>
          <tbody id="${id}-body"></tbody>
          ${st.totalesHTML ? `<tfoot id="${id}-foot"></tfoot>` : ''}
        </table>
      </div>
      ${st.porPagina ? `<div class="flex" id="${id}-pag" style="justify-content:flex-end;margin-top:var(--space-3)"></div>` : ''}`

    document.getElementById(`${id}-q`).addEventListener('input', (e) => {
      st.q = e.target.value.trim()
      st.pagina = 1
      pintar()
    })
    document.getElementById(`${id}-csv`).addEventListener('click', () => csvDescargar(st, filtrar(st)))
    document.getElementById(`${id}-xls`).addEventListener('click', () => excelDescargar(st, filtrar(st)))
    document.getElementById(`${id}-copiar`).addEventListener('click', () => copiar(st, filtrar(st)))
    document.getElementById(`${id}-imprimir`).addEventListener('click', () => window.print())

    st.mount.querySelectorAll('th.th-sort').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.k
      if (st.sortKey === k) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc'
      else { st.sortKey = k; st.sortDir = 'asc' }
      pintar()
    }))

    function pintar() {
      const filas = filtrar(st)
      st.mount.querySelectorAll('th.th-sort').forEach((th) => {
        th.classList.toggle('asc', th.dataset.k === st.sortKey && st.sortDir === 'asc')
        th.classList.toggle('desc', th.dataset.k === st.sortKey && st.sortDir === 'desc')
      })
      // B3: con la casilla de agrupar activa, la paginación se omite (las
      // listas objetivo caben) y CADA grupo conserva el orden del filtrado.
      if (st.agrupar && st.agrupado) return pintarAgrupado(filas)
      pintarPlana(filas)
    }

    function pintarPlana(filas) {
      const { pagina, total, paginas, actual } = paginar(st, filas)

      const body = document.getElementById(`${id}-body`)
      body.innerHTML = pagina.map((f) => st.filaHTML(f, (t, col) => resaltar(t, st.q))).join('')
        || `<tr><td colspan="${st.columnas.length}"><div class="empty">${esc(st.vacio)}</div></td></tr>`

      const foot = document.getElementById(`${id}-foot`)
      if (foot) foot.innerHTML = typeof st.totalesHTML === 'function' ? st.totalesHTML(filas) : st.totalesHTML

      const info = document.getElementById(`${id}-info`)
      if (info) info.textContent = st.q ? `${total} de ${st.filas.length} fila(s)` : `${st.filas.length} fila(s)`

      const pag = document.getElementById(`${id}-pag`)
      if (pag && st.porPagina) {
        pag.innerHTML = paginas > 1 ? `
          <button class="btn btn-secondary btn-sm" id="${id}-prev" ${actual <= 1 ? 'disabled' : ''}>←</button>
          <span class="hint">Página ${actual} de ${paginas}</span>
          <button class="btn btn-secondary btn-sm" id="${id}-next" ${actual >= paginas ? 'disabled' : ''}>→</button>` : ''
        const prev = document.getElementById(`${id}-prev`)
        const next = document.getElementById(`${id}-next`)
        if (prev) prev.addEventListener('click', () => { st.pagina = Math.max(1, st.pagina - 1); pintar() })
        if (next) next.addEventListener('click', () => { st.pagina = Math.min(paginas, st.pagina + 1); pintar() })
      }
    }

    function pintarAgrupado(filas) {
      const body = document.getElementById(`${id}-body`)
      if (!filas.length) {
        body.innerHTML = `<tr><td colspan="${st.columnas.length}"><div class="empty">${esc(st.vacio)}</div></td></tr>`
      } else {
        const grupos = new Map()
        for (const f of filas) {
          const k = String(f[st.agrupar.key] ?? '—')
          if (!grupos.has(k)) grupos.set(k, [])
          grupos.get(k).push(f)
        }
        const frag = []
        for (const [valor, filasGrupo] of grupos) {
          const cerrado = st.gruposCerrados.has(valor)
          const nombre = st.agrupar.nombreGrupo ? st.agrupar.nombreGrupo(valor) : valor
          const subtotal = !cerrado && typeof st.agrupar.subtotal === 'function' ? st.agrupar.subtotal(filasGrupo) : ''
          frag.push(`
            <tr class="dg-group-header" data-grupo="${esc(valor)}" title="Clic para colapsar/expandir este grupo">
              <td colspan="${st.columnas.length}">
                <span class="dg-group-toggle${cerrado ? '' : ' open'}">▶</span><b>${esc(nombre)}</b>
                <span class="dg-group-count">${filasGrupo.length} fila(s)</span>
                ${subtotal ? `<span class="dg-group-subtotal">${subtotal}</span>` : ''}
              </td>
            </tr>`)
          if (!cerrado) frag.push(filasGrupo.map((f) => st.filaHTML(f, (t, col) => resaltar(t, st.q))).join(''))
        }
        body.innerHTML = frag.join('')
      }
      // El total general del filtro sigue visible en el tfoot.
      const foot = document.getElementById(`${id}-foot`)
      if (foot) foot.innerHTML = typeof st.totalesHTML === 'function' ? st.totalesHTML(filas) : st.totalesHTML
      const info = document.getElementById(`${id}-info`)
      if (info) info.textContent = `${filas.length} fila(s) agrupadas por ${esc(st.agrupar.label)}`
      const pag = document.getElementById(`${id}-pag`)
      if (pag) pag.innerHTML = ''
    }

    // Delegación del cuerpo: colapsar/expandir un grupo con clic en su encabezado.
    document.getElementById(`${id}-body`).addEventListener('click', (e) => {
      const hd = e.target.closest('.dg-group-header')
      if (!hd) return
      const grupo = hd.dataset.grupo
      if (st.gruposCerrados.has(grupo)) st.gruposCerrados.delete(grupo)
      else st.gruposCerrados.add(grupo)
      pintar()
    })

    document.getElementById(`${id}-agr`)?.addEventListener('change', (e) => {
      st.agrupado = e.target.checked
      st.pagina = 1
      pintar()
    })

    pintar()

    return {
      refrescar(filasNuevas) {
        st.filas = filasNuevas || []
        st.pagina = 1
        pintar()
      },
      filasFiltradas: () => filtrar(st),
    }
  }

  window.UITabla = { montar }

  /**
   * UIForms — validación en línea para formularios modales/vistas.
   * Reglas por campo: requerido, rut, min, max, pattern, email, custom(fn).
   * Muestra mensajes claros bajo cada input y marca .form-input.error.
   */
  const validaciones = {
    requerido: (v) => (String(v).trim() ? null : 'Este campo es obligatorio'),
    rut: (v) => {
      const limpio = String(v).trim()
      if (!limpio) return null
      return (window.validarRut && validarRut(limpio)) ? null : 'RUT inválido (revisa el dígito verificador)'
    },
    email: (v) => (!String(v).trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)) ? null : 'Email inválido'),
  }

  function validarFormulario(raiz, esquema) {
    const errores = {}
    for (const [campo, reglas] of Object.entries(esquema)) {
      const input = raiz.querySelector(`#${campo}`)
      if (!input) continue
      const valor = input.value
      let error = null
      for (const regla of reglas) {
        if (typeof regla === 'function') { error = regla(valor) || null; if (error) break; continue }
        const [nombre, arg] = typeof regla === 'string' ? [regla, null] : regla
        if (nombre === 'requerido') error = validaciones.requerido(valor)
        else if (nombre === 'rut') error = validaciones.rut(valor)
        else if (nombre === 'email') error = validaciones.email(valor)
        else if (nombre === 'min') error = String(valor).trim().length >= arg ? null : `Mínimo ${arg} caracteres`
        else if (nombre === 'max') error = String(valor).trim().length <= arg ? null : `Máximo ${arg} caracteres`
        else if (nombre === 'pattern') error = new RegExp(arg).test(String(valor).trim()) ? null : (regla.mensaje || 'Formato inválido')
        if (error) break
      }
      errores[campo] = error
      marcar(input, error)
    }
    return { ok: Object.values(errores).every((e) => !e), errores }
  }

  function marcar(input, error) {
    if (!input) return
    input.classList.toggle('error', !!error)
    let msg = input.parentElement.querySelector('.form-error')
    if (error) {
      if (!msg) {
        msg = document.createElement('small')
        msg.className = 'form-error'
        input.parentElement.insertBefore(msg, input.nextSibling)
      }
      msg.textContent = error
    } else if (msg) msg.remove()
  }

  /** Limpia marcas de error de todos los inputs de la raíz. */
  function limpiarErrores(raiz) {
    raiz.querySelectorAll('.form-input.error').forEach((i) => i.classList.remove('error'))
    raiz.querySelectorAll('.form-error').forEach((m) => m.remove())
  }

  window.UIForms = { validar: validarFormulario, limpiar: limpiarErrores }
})()
