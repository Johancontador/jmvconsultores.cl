/**
 * views-plan.js — PLANIFICACIÓN TRIBUTARIA · Ficha (T0-B).
 *
 * Pantalla de la ficha tributaria declarada por empresa. Tres estados:
 *  - Vocación de disponibilidad: la ficha NO existe (nunca se autocompleta) →
 *    CTA «Incorporar ficha» solo si el rol tiene 'planificacion:gestionar'.
 *  - Existente: lectura de los campos declarados + (gestionar) «Editar».
 *  - Historial: siempre visible abajo (append-only del backend).
 *
 * Sin valores fiscales: los select presentan los catálogos reales del backend
 * (mismos dominios que las CHECK de la BD) y la ficha nace PENDIENTE/
 * SIN_CONFIGURAR si el usuario no declara aún — la ausencia es un estado.
 */

const ETIQUETA_REGIMEN = {
  PENDIENTE: 'Pendiente de declaración',
  PRO_PMYE_GENERAL: 'Pro Pyme General (14 letra D N°3)',
  PRO_PMYE_TRANSPARENTE: 'Pro Pyme Transparente (14 letra A N°3)',
  GENERAL_14A: 'Régimen General Semi Integrado (14 letra A)',
  PRESUNTO: 'Renta Presunta (art. 20 letra A)',
  NO_SUJETO_14: 'No sujeto a art. 14 LIR',
}
const ETIQUETA_TIPO_CONTRIBUYENTE = {
  PENDIENTE: 'Pendiente de declaración',
  PERSONA_NATURAL: 'Persona natural',
  PERSONA_JURIDICA: 'Persona jurídica',
}

function _etiqueta(dic, clave) {
  return dic[clave] || clave
}

function _chipEstado(estado) {
  if (estado === 'CONFIGURADA') return `<span class="chip contabilizado">${esc(estado)}</span>`
  return `<span class="chip pendiente">${esc(estado)}</span>`
}

function _filasLectura(f) {
  const activs = JSON.parse(f.actividades_economicas || '[]')
  const props = JSON.parse(f.propietarios_json || '[]')
  return `
    ${_dl('RUT', f.rut)}
    ${_dl('Régimen', _etiqueta(ETIQUETA_REGIMEN, f.regimen))}
    ${f.regimen_desde_ac ? _dl('Rige desde ejercicio comercial (AC)', f.regimen_desde_ac) : ''}
    ${_dl('Inicio de vigencia del régimen', f.fecha_vigencia ? esc(f.fecha_vigencia) : '<em class="muted">pendiente</em>')}
    ${_dl('Tipo de contribuyente', _etiqueta(ETIQUETA_TIPO_CONTRIBUYENTE, f.tipo_contribuyente))}
    ${_dl('Actividades económicas', activs.length ? esc(activs.join(' · ')) : '<em class="muted">pendiente de declaración</em>')}
    ${_dl('Inicio de actividades', f.fecha_inicio_actividades ? esc(f.fecha_inicio_actividades) : '<em class="muted">pendiente</em>')}
    ${_dl('Sujeto a retención de boletas de honorarios', f.sujeto_boletas_honorarios ? 'Sí' : 'No')}
    ${props.length ? `<div class="mb"><b>Propietarios declarados</b>
      <table>${props.map((p) => `
        <tr><td>${esc(p.rut)}</td><td>${esc(String(p.participacion))}%</td>
        <td>${p.gravado_finales ? 'gravado imp. finales' : 'no gravado imp. finales'}</td></tr>`).join('')}</table></div>`
      : _dl('Propietarios', '<em class="muted">pendiente de declaración</em>')}
  `
}
function _dl(clave, valor) {
  return `<div class="frm-row"><span class="muted" style="min-width:280px">${clave}:</span> <b>${valor}</b></div>`
}

function _formulario(f) {
  const esEditar = !!f
  const activs = esEditar ? JSON.parse(f.actividades_economicas || '[]').join(', ') : ''
  return `
    <div class="card mt" id="plan-form-card">
      <h3>${esEditar ? 'Actualizar ficha' : 'Incorporar ficha tributaria'}</h3>
      <p class="muted mb" style="font-size:var(--fs-sm)">
        La declaración es explícita y queda en el historial append-only. Sin
        régimen real no se ejecuta ningún cálculo tributario: los campos que
        deje pendientes nacen PENDIENTE/SIN_CONFIGURAR.
      </p>
      <div class="grid-3">
        <label class="muted">Régimen
          <select class="form-input" id="plan-regimen">
            ${Object.entries(ETIQUETA_REGIMEN).map(([k, n]) =>
              `<option value="${k}" ${esEditar && f.regimen === k ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label class="muted">Rige desde ejercicio comercial (AAAA)
          <input class="form-input" id="plan-regimen-ac" value="${esEditar && f.regimen_desde_ac ? esc(f.regimen_desde_ac) : ''}" placeholder="2025">
        </label>
        <label class="muted">Inicio de vigencia del régimen (día exacto)
          <input class="form-input" id="plan-fecha-vigencia" value="${esEditar && f.fecha_vigencia ? esc(f.fecha_vigencia) : ''}" placeholder="2025-01-01">
        </label>
        <label class="muted">Tipo de contribuyente
          <select class="form-input" id="plan-tipo">
            ${Object.entries(ETIQUETA_TIPO_CONTRIBUYENTE).map(([k, n]) =>
              `<option value="${k}" ${esEditar && f.tipo_contribuyente === k ? 'selected' : ''}>${n}</option>`).join('')}
          </select>
        </label>
        <label class="muted">Inicio de actividades
          <input class="form-input" id="plan-inicio" value="${esEditar && f.fecha_inicio_actividades ? esc(f.fecha_inicio_actividades) : ''}" placeholder="2020-01-01">
        </label>
        <label class="muted">Actividades económicas (separadas por coma)
          <input class="form-input" id="plan-activ" value="${esc(activs)}" placeholder="Tecnologías de la información, Consultoría">
        </label>
        <label class="muted">Propietarios (JSON opcional)
          <input class="form-input" id="plan-props" placeholder='[{"rut":"12345678-5","participacion":100,"gravado_finales":true}]'>
        </label>
      </div>
      <label class="checkline mt" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" id="plan-bhe" ${esEditar && f.sujeto_boletas_honorarios ? 'checked' : ''}>
        Sujeto a retención de boletas de honorarios
      </label>
      <div class="frm-row mt">
        <button class="btn" id="plan-guardar">${esEditar ? 'Guardar cambios' : 'Incorporar ficha'}</button>
        <button class="btn btn-secondary" id="plan-cancelar">Cancelar</button>
      </div>
      <p id="plan-form-error" class="muted" style="color:var(--danger)"></p>
    </div>
  `
}

function _cargarPayload() {
  const activs = document.getElementById('plan-activ').value
    .split(',').map((x) => x.trim()).filter(Boolean)
  const propsRaw = document.getElementById('plan-props').value.trim()
  const payload = {
    regimen: document.getElementById('plan-regimen').value,
    tipo_contribuyente: document.getElementById('plan-tipo').value,
    regimen_desde_ac: document.getElementById('plan-regimen-ac').value.trim() || null,
    fecha_vigencia: document.getElementById('plan-fecha-vigencia').value.trim() || null,
    fecha_inicio_actividades: document.getElementById('plan-inicio').value.trim() || null,
    sujeto_boletas_honorarios: document.getElementById('plan-bhe').checked,
    actividades_economicas: activs,
  }
  if (propsRaw) payload.propietarios = JSON.parse(propsRaw) // error de sintaxis → catch del llamador
  return payload
}

async function _historialHTML(eid) {
  try {
    const data = await apiGet(`/api/contable/empresas/${eid}/planificacion/ficha/historial?limite=10`)
    if (!data.entradas || !data.entradas.length) return ''
    return `
      <div class="card mt">
        <h3>Historial de la ficha (append-only)</h3>
        <table>
          <tr><th>Fecha</th><th>Acción</th><th>Usuario</th><th>Régimen resultante</th></tr>
          ${data.entradas.map((h) => {
            let desp = {}
            try { desp = JSON.parse(h.despues_json || '{}') } catch { desp = {} }
            return `<tr>
              <td>${esc(h.creado_en)}</td>
              <td>${esc(h.accion)}</td>
              <td>${esc(h.usuario_nombre || '')}</td>
              <td>${esc(String(desp.regimen || ''))}</td>
            </tr>`
          }).join('')}
        </table>
      </div>`
  } catch {
    return ''
  }
}

VIEWS['planificacion'] = {
  titulo: 'Planificación Tributaria — Ficha',
  async render(cont) {
    const eid = S.empresa.id
    const puedeGestionar = tiene('planificacion:gestionar')

    let data
    try {
      data = await apiGet(`/api/contable/empresas/${eid}/planificacion/ficha`)
    } catch (err) {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
      return
    }

    const f = data.ficha
    const titlebar = `
      <div class="sys-titlebar">
        <h1>Planificación Tributaria</h1>
        <span class="spacer"></span>
        ${f ? _chipEstado(f.estado_ficha) : '<span class="chip pendiente">SIN_FICHA</span>'}
        ${puedeGestionar ? `<button class="btn" id="plan-accion">${f ? 'Editar ficha' : 'Incorporar ficha'}</button>` : ''}
      </div>
    `

    const bloqueFicha = f ? `
      <div class="card">
        <h3>Declaración vigente</h3>
        ${_filasLectura(f)}
        <p class="muted" style="font-size:var(--fs-sm)">
          Declarada el ${esc(f.creado_en)} · última actualización ${esc(f.actualizado_en)}
        </p>
      </div>
      ${_historialHTML(eid)}
    ` : `
      <div class="card">
        <h3>Ficha tributaria no incorporada</h3>
        <p class="muted">
          Ningún módulo ha declarado el perfil tributario de esta empresa:
          sin ficha NO hay cálculo ni proyección de la Planificación (sin
          régimen por defecto, sin inferencia por RUT ni por el RCV). La
          incorporación es una declaración explícita del contador y queda
          registrada en el historial y la bitácora de auditoría.
        </p>
        ${!puedeGestionar ? `<p class="muted" style="color:var(--warning)">No tiene permiso de declaración (planificacion:gestionar): consulte al contador del despacho.</p>` : ''}
      </div>
      ${_historialHTML(eid)}
    `

    cont.innerHTML = titlebar + bloqueFicha

    const btnAccion = cont.querySelector('#plan-accion')
    if (!btnAccion) return
    btnAccion.addEventListener('click', () => {
      const card = cont.querySelector('#plan-form-card')
      if (card) return
      btnAccion.insertAdjacentHTML('afterend', _formulario(f))
      btnAccion.hidden = true
      cont.querySelector('#plan-cancelar').addEventListener('click', () => {
        cont.querySelector('#plan-form-card').remove()
        btnAccion.hidden = false
      })
      cont.querySelector('#plan-guardar').addEventListener('click', async () => {
        const errorEl = cont.querySelector('#plan-form-error')
        errorEl.textContent = ''
        let payload
        try { payload = _cargarPayload() } catch (errParse) {
          errorEl.textContent = `Propietarios: JSON inválido (${errParse.message})`
          return
        }
        try {
          if (f) {
            await apiPut(`/api/contable/empresas/${eid}/planificacion/ficha`, payload)
            showToast('Ficha actualizada (historial firmado)')
          } else {
            await apiPost(`/api/contable/empresas/${eid}/planificacion/ficha`, payload)
            showToast('Ficha incorporada (historial firmado)')
          }
          renderRoute('planificacion')
        } catch (err) {
          errorEl.textContent = err.message
          showToast(err.message, 'error')
        }
      })
    })
  },
}
