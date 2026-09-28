/**
 * Exportación CSV / Excel / PDF, reutilizable desde cualquier reporte.
 *
 * CSV no necesita librerías externas.
 * Excel necesita que la página cargue (vía CDN, antes de este script):
 *   <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
 * PDF necesita:
 *   <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js"></script>
 *
 * Ninguna página carga estas 3 librerías por defecto — cada reporte que
 * ofrezca exportar a Excel/PDF las agrega solo si las va a usar, para no
 * inflar páginas que no las necesitan (ej. Clientes no exporta nada).
 */

function _filasParaExport(columnas, filas) {
  const headers = columnas.map((c) => c.label)
  const rows = filas.map((fila) => columnas.map((c) => {
    const valor = fila[c.key]
    return c.exportFormat ? c.exportFormat(valor, fila) : (valor ?? '')
  }))
  return { headers, rows }
}

function _nombreHojaExcel(nombre, indice) {
  const limpio = String(nombre || `Hoja${indice + 1}`).replace(/[:\\/?*[\]]/g, ' ').trim()
  return (limpio || `Hoja${indice + 1}`).slice(0, 31)
}

function _estilosColumnaFecha(headers) {
  const styles = {}
  headers.forEach((h, i) => {
    if (/fecha/i.test(String(h))) styles[i] = { cellWidth: 24, minCellWidth: 20, overflow: 'linebreak' }
  })
  return styles
}

function _autoTableFecha(doc, { headers, rows, startY, tituloSeccion }) {
  let y = startY
  if (tituloSeccion) {
    doc.setFontSize(11)
    doc.text(tituloSeccion, 14, y)
    y += 6
  }
  doc.autoTable({
    head: [headers],
    body: rows,
    startY: y,
    styles: { fontSize: 7, overflow: 'linebreak', cellPadding: 1.2 },
    headStyles: { fillColor: [37, 99, 235] },
    columnStyles: _estilosColumnaFecha(headers),
    horizontalPageBreak: true,
    showHead: 'everyPage',
  })
  return doc.lastAutoTable.finalY
}

function seccionesParaExport(opts) {
  const { columnas, filas, titulo, data, esDetalleDocumentos } = opts
  const secciones = []
  if (columnas && columnas.length && filas && filas.length) {
    secciones.push({ titulo: titulo || 'Reporte', columnas, filas })
  }
  if (!esDetalleDocumentos && data && typeof documentosDeInforme === 'function') {
    const docs = documentosDeInforme(data)
    if (docs.length) {
      secciones.push({
        titulo: 'Documentos',
        columnas: columnasDocumento({ conLibro: true, conPeriodo: true, conReclamo: true }),
        filas: docs,
      })
    }
  }
  return secciones
}

function exportarCSV(columnas, filas, nombreArchivo) {
  exportarCSVSecciones([{ titulo: '', columnas, filas }], nombreArchivo)
}

function exportarCSVSecciones(secciones, nombreArchivo) {
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const bloques = []
  for (const seccion of secciones) {
    const { headers, rows } = _filasParaExport(seccion.columnas, seccion.filas)
    if (seccion.titulo) bloques.push([escapar(seccion.titulo)].join(';'))
    bloques.push([headers, ...rows].map((fila) => fila.map(escapar).join(';')).join('\r\n'))
    bloques.push('')
  }
  const contenido = bloques.join('\r\n')
  const blob = new Blob(['\uFEFF' + contenido], { type: 'text/csv;charset=utf-8;' })
  _descargarBlob(blob, nombreArchivo.endsWith('.csv') ? nombreArchivo : `${nombreArchivo}.csv`)
}

function exportarExcel(columnas, filas, nombreArchivo, nombreHoja = 'Datos') {
  exportarExcelHojas([{ titulo: nombreHoja, columnas, filas }], nombreArchivo)
}

function exportarExcelHojas(secciones, nombreArchivo) {
  if (typeof XLSX === 'undefined') {
    throw new Error('Falta cargar la librería de Excel (xlsx) en esta página')
  }
  const libro = XLSX.utils.book_new()
  const usados = new Set()
  secciones.forEach((seccion, i) => {
    let nombre = _nombreHojaExcel(seccion.titulo, i)
    if (usados.has(nombre)) nombre = _nombreHojaExcel(`${nombre} ${i + 1}`, i)
    usados.add(nombre)
    const { headers, rows } = _filasParaExport(seccion.columnas, seccion.filas)
    const hoja = XLSX.utils.aoa_to_sheet([headers, ...rows])
    XLSX.utils.book_append_sheet(libro, hoja, nombre)
  })
  XLSX.writeFile(libro, nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`)
}

function exportarPDF(columnas, filas, nombreArchivo, titulo = '') {
  exportarPDFTablas([{ titulo: '', columnas, filas }], nombreArchivo, titulo)
}

function exportarPDFTablas(secciones, nombreArchivo, tituloPrincipal = '') {
  if (typeof window.jspdf === 'undefined') {
    throw new Error('Falta cargar la librería de PDF (jsPDF) en esta página')
  }
  const { jsPDF } = window.jspdf
  const maxCols = Math.max(0, ...secciones.map((s) => s.columnas.length))
  const doc = new jsPDF({ orientation: maxCols > 6 ? 'landscape' : 'portrait' })
  if (typeof doc.autoTable !== 'function') {
    throw new Error('Falta cargar el plugin jspdf-autotable en esta página')
  }

  let startY = 10
  if (tituloPrincipal) {
    doc.setFontSize(14)
    doc.text(tituloPrincipal, 14, 15)
    startY = 22
  }

  secciones.forEach((seccion, i) => {
    if (i > 0) {
      doc.addPage()
      startY = 16
    }
    const { headers, rows } = _filasParaExport(seccion.columnas, seccion.filas)
    startY = _autoTableFecha(doc, {
      headers,
      rows,
      startY,
      tituloSeccion: seccion.titulo && seccion.titulo !== tituloPrincipal ? seccion.titulo : '',
    })
  })

  doc.save(nombreArchivo.endsWith('.pdf') ? nombreArchivo : `${nombreArchivo}.pdf`)
}

function exportarConDocumentos(formato, opts) {
  const secciones = seccionesParaExport(opts)
  if (secciones.length === 0) {
    throw new Error('No hay datos para exportar')
  }
  const nombre = opts.nombre || 'reporte'
  const titulo = opts.titulo || ''
  if (formato === 'csv') exportarCSVSecciones(secciones, nombre)
  else if (formato === 'excel') exportarExcelHojas(secciones, nombre)
  else if (formato === 'pdf') exportarPDFTablas(secciones, nombre, titulo)
  else throw new Error('Formato de export no soportado')
}

function _descargarBlob(blob, nombreArchivo) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombreArchivo
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
