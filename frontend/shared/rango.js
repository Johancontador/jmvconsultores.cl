/**
 * Selector de rango Mes+Año (reemplaza los selectores de solo-año en
 * Informe, Reportes y Dashboard). Se usa con un "prefijo" para que varios
 * selectores puedan coexistir en la misma página sin chocar de ids.
 */
function rangoMesAnioHtml(prefijo) {
  return `
    <div class="control-group">
      <label for="${prefijo}-mes-inicio">Mes inicio</label>
      <select id="${prefijo}-mes-inicio"></select>
    </div>
    <div class="control-group">
      <label for="${prefijo}-anio-inicio">Año inicio</label>
      <select id="${prefijo}-anio-inicio"></select>
    </div>
    <div class="control-group">
      <label for="${prefijo}-mes-fin">Mes fin</label>
      <select id="${prefijo}-mes-fin"></select>
    </div>
    <div class="control-group">
      <label for="${prefijo}-anio-fin">Año fin</label>
      <select id="${prefijo}-anio-fin"></select>
    </div>`
}

function inicializarRangoMesAnio(prefijo, anioMinimo = 2023) {
  const ahora = new Date()
  const anioActual = ahora.getFullYear()
  const mesActual = ahora.getMonth() + 1

  const $mesInicio = document.getElementById(`${prefijo}-mes-inicio`)
  const $anioInicio = document.getElementById(`${prefijo}-anio-inicio`)
  const $mesFin = document.getElementById(`${prefijo}-mes-fin`)
  const $anioFin = document.getElementById(`${prefijo}-anio-fin`)

  MESES.forEach((n, i) => {
    $mesInicio.innerHTML += `<option value="${i + 1}">${n}</option>`
    $mesFin.innerHTML += `<option value="${i + 1}">${n}</option>`
  })
  for (let y = anioMinimo; y <= anioActual; y++) {
    $anioInicio.innerHTML += `<option value="${y}">${y}</option>`
    $anioFin.innerHTML += `<option value="${y}">${y}</option>`
  }

  // Por defecto: enero del año actual hasta el mes actual.
  $mesInicio.value = '1'
  $anioInicio.value = String(anioActual)
  $mesFin.value = String(mesActual)
  $anioFin.value = String(anioActual)
}

function leerRangoMesAnio(prefijo) {
  return {
    mesInicio: Number(document.getElementById(`${prefijo}-mes-inicio`).value),
    anioInicio: Number(document.getElementById(`${prefijo}-anio-inicio`).value),
    mesFin: Number(document.getElementById(`${prefijo}-mes-fin`).value),
    anioFin: Number(document.getElementById(`${prefijo}-anio-fin`).value),
  }
}

function validarRangoMesAnio(r) {
  if (r.anioInicio > r.anioFin) return 'El año de inicio debe ser menor o igual al de fin'
  if (r.anioInicio === r.anioFin && r.mesInicio > r.mesFin) return 'El mes de inicio debe ser menor o igual al de fin dentro del mismo año'
  return null
}
