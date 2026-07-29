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

function exportarCSV(columnas, filas, nombreArchivo) {
  const { headers, rows } = _filasParaExport(columnas, filas)
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const contenido = [headers, ...rows].map((fila) => fila.map(escapar).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + contenido], { type: 'text/csv;charset=utf-8;' })
  _descargarBlob(blob, nombreArchivo.endsWith('.csv') ? nombreArchivo : `${nombreArchivo}.csv`)
}

function exportarExcel(columnas, filas, nombreArchivo, nombreHoja = 'Datos') {
  if (typeof XLSX === 'undefined') {
    throw new Error('Falta cargar la librería de Excel (xlsx) en esta página')
  }
  const { headers, rows } = _filasParaExport(columnas, filas)
  const hoja = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja)
  XLSX.writeFile(libro, nombreArchivo.endsWith('.xlsx') ? nombreArchivo : `${nombreArchivo}.xlsx`)
}

function exportarPDF(columnas, filas, nombreArchivo, titulo = '') {
  if (typeof window.jspdf === 'undefined') {
    throw new Error('Falta cargar la librería de PDF (jsPDF) en esta página')
  }
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ orientation: columnas.length > 6 ? 'landscape' : 'portrait' })

  if (titulo) {
    doc.setFontSize(14)
    doc.text(titulo, 14, 15)
  }

  const { headers, rows } = _filasParaExport(columnas, filas)
  if (typeof doc.autoTable !== 'function') {
    throw new Error('Falta cargar el plugin jspdf-autotable en esta página')
  }
  doc.autoTable({
    head: [headers],
    body: rows,
    startY: titulo ? 22 : 10,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  })

  doc.save(nombreArchivo.endsWith('.pdf') ? nombreArchivo : `${nombreArchivo}.pdf`)
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
