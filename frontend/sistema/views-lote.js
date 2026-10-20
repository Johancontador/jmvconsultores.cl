/**
 * LOTE DEL DESPACHO — herramientas cross-portafolio que vivían en las pantallas
 * heredadas (informe.html, proceso.html, exportacion-masiva.html). Se portaron a
 * la SPA con sus MISMOS endpoints (/api/informe, /api/proceso,
 * /api/exportacion-masiva) para poder retirar la capa heredada sin perder
 * capacidad: son las tres únicas pantallas viejas que no eran un duplicado.
 *
 * Operan sobre `clientes` (el portafolio heredado), no sobre la empresa activa:
 * el despacho procesa a todos sus clientes de una vez. La autoridad sigue en el
 * backend (sesión + userId del dueño del job); aquí solo se pinta.
 *
 * #informe-rango       — informe de ventas/compras/margen por rango de meses
 * #proceso-masivo      — F29 del mes para todo el portafolio (+ WhatsApp)
 * #exportacion-masiva  — ZIP con el reporte de todos los clientes
 */

/* ------------------------------------------------------------------ */
/* utilidades compartidas por las tres vistas                          */
/* ------------------------------------------------------------------ */

/** `<input type="month">` → { anio, mes } (mes 1-12). */
function loteMesValor(id, porDefecto) {
  const v = document.getElementById(id)?.value || porDefecto
  const [a, m] = String(v).split('-')
  return { anio: Number(a), mes: Number(m) }
}

/** Valor inicial de un input month: el período global o el mes en curso. */
function loteMesInicial() {
  const p = String(periodoGlobal() || periodoActual())
  return `${p.slice(0, 4)}-${p.slice(4)}`
}

function loteValidarRango(desde, hasta) {
  if (!desde.anio || !hasta.anio) return 'Elige el mes de inicio y el de fin'
  const a = desde.anio * 100 + desde.mes
  const b = hasta.anio * 100 + hasta.mes
  if (a > b) return 'El mes de inicio no puede ser posterior al de fin'
  if (desde.anio < 2020 || hasta.anio > 2030) return 'Rango de años inválido (2020–2030)'
  return null
}

/** Progreso en vivo de un job en memoria (los tres endpoints tienen esa forma). */
async function loteEsperar(estadoURL, { onTick, esTerminal }) {
  const detener = iniciarPolling(() => apiGet(estadoURL), {
    intervalo: 1500,
    esTerminal,
    onUpdate: (d) => onTick(d),
  })
  try {
    while (true) {
      await new Promise((r) => setTimeout(r, 1500))
      const d = await apiGet(estadoURL)
      onTick(d)
      if (esTerminal(d)) return d
    }
  } finally {
    detener()
  }
}

function loteProgresoHTML(pct, detalle) {
  return `<div class="prog"><i style="width:${Math.max(5, Math.min(100, pct))}%"></i></div>
    <div class="hint mt">${esc(detalle)}</div>`
}

/* ================================================================== */
/* 0. PORTAFOLIO (clientes del despacho que alimentan las 3 herramientas) */
/* ================================================================== */

VIEWS.portafolio = {
  titulo: 'Clientes del portafolio',
  async render(cont) {
    let clientes = []
    try {
      clientes = await apiGet('/api/clientes')
    } catch (err) {
      cont.innerHTML = `<div class="card">${UIEstado.error(`No se pudo cargar el portafolio: ${err.message}`)}</div>`
      return
    }
    cont.innerHTML = `
      <div class="card">
        <div class="flex">
          <div>
            <h3 style="margin:0">Cartera de clientes</h3>
            <p class="hint" style="margin:var(--space-1) 0 0">Son los clientes de la consultora (RUT, clave SII, PPM y teléfono). Alimentan el informe por rango, el F29 masivo y el ZIP. No son las empresas contables del sistema.</p>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" id="pf-nuevo">+ Nuevo cliente</button>
        </div>
      </div>
      <div id="pf-lista" class="mt"></div>`

    const pintar = () => {
      const box = document.getElementById('pf-lista')
      if (!box) return
      if (!clientes.length) {
        box.innerHTML = `<div class="card">${UIEstado.vacio('No hay clientes en el portafolio', 'Crea el primero con su RUT y clave SII: las tres herramientas del lote lo usan.')}</div>`
        return
      }
      box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Cliente</th><th>RUT</th><th class="num">PPM</th><th>Teléfono</th><th>IVA</th><th>Acciones</th></tr></thead>
        <tbody>${clientes.map((c) => `<tr>
          <td><b>${esc(c.nombre)}</b></td>
          <td class="mono sub">${esc(formatRut(c.rut))}</td>
          <td class="num">${(Number(c.tasa_ppm) * 100).toFixed(1)}%</td>
          <td class="sub">${esc(formatTelefono(c.telefono))}</td>
          <td><span class="chip ${c.exento ? 'neutral' : 'clasificado'}">${c.exento ? 'EXENTO' : 'AFECTO'}</span></td>
          <td><button class="btn btn-secondary btn-sm pf-editar" data-id="${c.id}">Editar</button>
              <button class="btn btn-secondary btn-sm pf-eliminar" data-id="${c.id}">Eliminar</button></td>
        </tr>`).join('')}</tbody>
      </table></div>`
      box.querySelectorAll('.pf-editar').forEach((b) => b.addEventListener('click', () => {
        modalCliente(clientes.find((c) => Number(c.id) === Number(b.dataset.id)))
      }))
      box.querySelectorAll('.pf-eliminar').forEach((b) => b.addEventListener('click', async () => {
        const c = clientes.find((x) => Number(x.id) === Number(b.dataset.id))
        const ok = await UIEstado.confirmar({
          titulo: 'Eliminar cliente del portafolio',
          cuerpo: `<p>Se desactiva <b>${esc(c?.nombre || '')}</b> (${esc(c?.rut || '')}) y deja de aparecer en el informe por rango, el F29 masivo y el ZIP.</p>
            <p class="hint">Los informes ya generados se conservan.</p>`,
          texto: 'Eliminar cliente', peligro: true,
        })
        if (!ok) return
        try {
          await apiDelete(`/api/clientes/${c.id}`)
          clientes = clientes.filter((x) => Number(x.id) !== Number(c.id))
          showToast('Cliente eliminado', 'success')
          pintar()
        } catch (e) { showToast(e.message, 'error') }
      }))
    }

    const recargar = async () => {
      try {
        clientes = await apiGet('/api/clientes')
        pintar()
      } catch (e) { showToast(e.message, 'error') }
    }

    const modalCliente = (c = null) => {
      openModal(`
        <h3>${c ? 'Editar cliente' : 'Nuevo cliente del portafolio'}</h3>
        <div class="frm-row mt">
          <div><span class="frm-label">RUT</span><input id="pf-rut" class="form-input" value="${esc(c?.rut || '')}" placeholder="76123456-0" autocomplete="off"></div>
          <div style="flex:2 1 240px"><span class="frm-label">Razón social</span><input id="pf-nombre" class="form-input" value="${esc(c?.nombre || '')}" autocomplete="off"></div>
        </div>
        <div class="frm-row mt">
          <div><span class="frm-label">Clave SII</span><input id="pf-clave" type="password" class="form-input" autocomplete="new-password" placeholder="${c ? 'Dejar vacío para no cambiar' : '••••••••'}"></div>
          <div><span class="frm-label">Tasa PPM (decimal)</span><input id="pf-ppm" class="form-input" value="${c ? c.tasa_ppm : '0.015'}" inputmode="decimal"></div>
          <div><span class="frm-label">Teléfono</span><input id="pf-tel" class="form-input" value="${esc(c?.telefono || '')}" inputmode="tel"></div>
        </div>
        <label class="checkline mt" style="cursor:pointer"><input type="checkbox" id="pf-exento" ${c?.exento ? 'checked' : ''}> Exento de IVA</label>
        <p class="hint">La clave SII se guarda cifrada en la bóveda y nunca se vuelve a mostrar. PPM en decimal: <b>0,015</b> = 1,5%.</p>
        <div class="modal-foot">
          <button class="btn btn-secondary" id="pf-cancelar">Cancelar</button>
          <button class="btn btn-primary" id="pf-guardar">${c ? 'Guardar cambios' : 'Crear cliente'}</button>
        </div>`)
      document.getElementById('pf-cancelar').addEventListener('click', () => cerrarModal())
      document.getElementById('pf-guardar').addEventListener('click', async () => {
        const rut = document.getElementById('pf-rut').value.trim()
        const nombre = document.getElementById('pf-nombre').value.trim()
        const clave = document.getElementById('pf-clave').value
        const ppm = parseFloat(String(document.getElementById('pf-ppm').value).replace(',', '.'))
        const telefono = document.getElementById('pf-tel').value.trim()
        const exento = document.getElementById('pf-exento').checked
        if (!validarRut(rut)) { showToast('RUT inválido: revisa el dígito verificador', 'error'); return }
        if (!nombre) { showToast('Falta la razón social', 'error'); return }
        if (!c && !clave) { showToast('La clave SII es obligatoria para crear el cliente', 'error'); return }
        if (!Number.isFinite(ppm) || ppm < 0 || ppm > 1) { showToast('Tasa PPM inválida: usa decimal entre 0 y 1 (0,015 = 1,5%)', 'error'); return }
        if (String(telefono).replace(/\D/g, '').length < 8) { showToast('Teléfono inválido: mínimo 8 dígitos', 'error'); return }
        const body = { rut, nombre, tasa_ppm: ppm, telefono, exento }
        if (clave) body.clave_sii = clave
        try {
          if (c) await apiPut(`/api/clientes/${c.id}`, body)
          else await apiPost('/api/clientes', body)
          cerrarModal()
          showToast(c ? 'Cliente actualizado' : 'Cliente creado', 'success')
          await recargar()
        } catch (e) { showToast(e.message, 'error') }
      })
    }

    document.getElementById('pf-nuevo').addEventListener('click', () => modalCliente(null))
    pintar()
  },
}

/* ================================================================== */
/* 1. INFORME POR RANGO                                                */
/* ================================================================== */

VIEWS['informe-rango'] = {
  titulo: 'Informe por rango',
  async render(cont) {
    const mes = loteMesInicial()
    let clientes = []
    try {
      clientes = await apiGet('/api/clientes')
    } catch (err) {
      cont.innerHTML = `<div class="card">${UIEstado.error(`No se pudo cargar el portafolio: ${err.message}`)}</div>`
      return
    }
    if (!Array.isArray(clientes) || clientes.length === 0) {
      cont.innerHTML = `<div class="card">${UIEstado.vacio('El portafolio heredado está vacío', 'Agrega un cliente con RUT y clave SII para poder generar informes.')}</div>`
      return
    }

    cont.innerHTML = `
      <div class="card">
        <h3>Análisis de ventas, compras y margen bruto</h3>
        <p class="hint">Consulta el RCV del SII mes a mes para un cliente del portafolio y arma el informe con resumen ejecutivo y observaciones. Montos netos (sin IVA); las notas de crédito restan.</p>
        <div class="frm-row mt">
          <div style="flex:2 1 260px">
            <span class="frm-label">Cliente</span>
            <select id="ir-cliente" class="form-input">
              ${clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)} (${esc(c.rut)})</option>`).join('')}
            </select>
          </div>
          <div><span class="frm-label">Desde</span><input type="month" id="ir-desde" class="form-input" value="${mes}"></div>
          <div><span class="frm-label">Hasta</span><input type="month" id="ir-hasta" class="form-input" value="${mes}"></div>
          <div>
            <span class="frm-label">Modo</span>
            <select id="ir-modo" class="form-input">
              <option value="resumen">Resumen</option>
              <option value="detalle">Detalle por mes</option>
            </select>
          </div>
        </div>
        <div class="frm-row mt">
          <span id="ir-estimacion" class="hint">—</span>
          <span class="spacer"></span>
          <button class="btn btn-primary" id="ir-generar">Generar informe</button>
        </div>
        <div id="ir-estado" class="mt"></div>
      </div>
      <div id="ir-resultado" class="mt"></div>
      <div class="card mt">
        <h3>Informes guardados</h3>
        <div id="ir-historial" class="mt">${UIEstado.cargando('Cargando informes…')}</div>
      </div>`

    const estimacion = async () => {
      const desde = loteMesValor('ir-desde', mes)
      const hasta = loteMesValor('ir-hasta', mes)
      const el = document.getElementById('ir-estimacion')
      const err = loteValidarRango(desde, hasta)
      if (err) { el.textContent = err; return }
      try {
        const qs = new URLSearchParams({
          anio_inicio: desde.anio, anio_fin: hasta.anio, mes_inicio: desde.mes, mes_fin: hasta.mes,
        })
        const e = await apiGet(`/api/informe/estimacion?${qs}`)
        el.textContent = `${e.total_meses} mes(es) · ${e.consultas_estimadas} consultas al SII`
      } catch { el.textContent = '—' }
    }
    ;['ir-desde', 'ir-hasta'].forEach((id) => document.getElementById(id).addEventListener('change', estimacion))
    estimacion()
    cargarHistorialInformes()

    document.getElementById('ir-generar').addEventListener('click', async () => {
      const desde = loteMesValor('ir-desde', mes)
      const hasta = loteMesValor('ir-hasta', mes)
      const err = loteValidarRango(desde, hasta)
      if (err) { showToast(err, 'error'); return }
      const clienteId = Number(document.getElementById('ir-cliente').value)
      const cliente = clientes.find((c) => Number(c.id) === clienteId)
      const modo = document.getElementById('ir-modo').value
      const total = (hasta.anio - desde.anio) * 12 + (hasta.mes - desde.mes) + 1

      const ok = await UIEstado.confirmar({
        titulo: 'Generar informe',
        cuerpo: `<dl>
          ${UIEstado.dato('Cliente', `${esc(cliente?.nombre || '')} (${esc(cliente?.rut || '')})`)}
          ${UIEstado.dato('Rango', `${perDisplay(String(desde.anio) + String(desde.mes).padStart(2, '0'))} — ${perDisplay(String(hasta.anio) + String(hasta.mes).padStart(2, '0'))}`)}
          ${UIEstado.dato('Meses a consultar', `<b class="mono">${total}</b>`)}
          ${UIEstado.dato('Modo', modo === 'detalle' ? 'Detalle por mes' : 'Resumen')}
        </dl>
        <p class="hint">Se consultará el RCV del SII ${total} vez(es) por flujo. Nada se contabiliza: el informe es de lectura.</p>`,
        texto: 'Consultar SII y generar',
      })
      if (!ok) return

      const box = document.getElementById('ir-estado')
      const btn = document.getElementById('ir-generar')
      btn.disabled = true
      document.getElementById('ir-resultado').innerHTML = ''
      box.innerHTML = loteProgresoHTML(5, 'Iniciando informe…')
      try {
        const j = await apiPost('/api/informe/generar', {
          cliente_id: clienteId,
          anio_inicio: desde.anio, anio_fin: hasta.anio,
          mes_inicio: desde.mes, mes_fin: hasta.mes,
          modo,
        })
        const fin = await loteEsperar(`/api/informe/${j.informe_id}/estado`, {
          esTerminal: (d) => d.estado === 'completado' || d.estado === 'error',
          onTick: (d) => {
            const pct = d.total ? Math.round((d.procesados / d.total) * 100) : 5
            box.innerHTML = loteProgresoHTML(pct, d.procesando
              ? `Consultando ${d.procesando}… (${d.procesados}/${d.total})`
              : `Meses procesados: ${d.procesados}/${d.total}`)
          },
        })
        box.innerHTML = ''
        if (fin.estado === 'error') {
          showToast(fin.error_msg || 'El informe terminó con error', 'error')
        } else {
          document.getElementById('ir-resultado').innerHTML = informeRangoHTML(fin)
          document.getElementById('ir-imprimir')?.addEventListener('click', () => window.print())
          showToast('Informe generado', 'success')
        }
        btn.disabled = false
        cargarHistorialInformes()
      } catch (e) {
        box.innerHTML = ''
        btn.disabled = false
        showToast(e.message, 'error')
      }
    })
  },
}

async function cargarHistorialInformes() {
  const cont = document.getElementById('ir-historial')
  if (!cont) return
  try {
    const r = await apiGet('/api/informe?limit=20')
    const lista = r.informes || []
    if (!lista.length) {
      cont.innerHTML = `<div class="empty">Todavía no hay informes generados.</div>`
      return
    }
    cont.innerHTML = `
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Cliente</th><th>Rango</th><th>Modo</th><th class="num">Meses</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${lista.map((i) => `
          <tr>
            <td>${esc(i.cliente_nombre || '—')}<br><span class="sub mono">${esc(i.cliente_rut || '')}</span></td>
            <td class="sub">${esc(perDisplay(`${i.anio_inicio}${String(i.mes_inicio || 1).padStart(2, '0')}`))} — ${esc(perDisplay(`${i.anio_fin}${String(i.mes_fin || 12).padStart(2, '0')}`))}</td>
            <td class="sub">${esc(i.modo)}</td>
            <td class="num mono">${i.total_meses ?? 0}</td>
            <td><span class="chip ${i.estado === 'completado' ? 'contabilizado' : i.estado === 'error' ? 'anulado' : 'neutral'}">${esc(i.estado)}</span></td>
            <td><button class="btn btn-secondary btn-sm ir-ver" data-id="${i.id}">Ver</button>
                <button class="btn btn-secondary btn-sm ir-borrar" data-id="${i.id}">Eliminar</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`
    cont.querySelectorAll('.ir-ver').forEach((b) => b.addEventListener('click', async () => {
      try {
        const r2 = await apiPost(`/api/informe/${b.dataset.id}/cargar`, {})
        document.getElementById('ir-resultado').innerHTML = informeRangoHTML(r2)
        document.getElementById('ir-imprimir')?.addEventListener('click', () => window.print())
      } catch (e) { showToast(e.message, 'error') }
    }))
    cont.querySelectorAll('.ir-borrar').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UIEstado.confirmar({
        titulo: 'Eliminar informe guardado',
        cuerpo: '<p>Se borra el informe y su detalle. Las consultas al SII ya hechas no se repiten ni se pueden recuperar desde aquí.</p>',
        texto: 'Eliminar informe', peligro: true,
      })
      if (!ok) return
      try {
        await apiDelete(`/api/informe/${b.dataset.id}`)
        showToast('Informe eliminado', 'success')
        cargarHistorialInformes()
      } catch (e) { showToast(e.message, 'error') }
    }))
  } catch (e) {
    cont.innerHTML = `<div class="empty">No se pudo listar los informes: ${esc(e.message)}</div>`
  }
}

/** Documento del informe: resumen ejecutivo, tabla por mes/año y observaciones. */
function informeRangoHTML(d) {
  const r = d.resumen || { ventas_neto: 0, compras_neto: 0, margen: 0, pct_margen: 0 }
  const meses = (d.meses || []).filter((m) => m.estado === 'ok')
  const porAnio = d.por_anio || []
  const errores = (d.meses || []).filter((m) => m.estado === 'error')
  const inicio = `${MESES[(d.mes_inicio || 1) - 1]} ${d.anio_inicio}`
  const fin = `${MESES[(d.mes_fin || 12) - 1]} ${d.anio_fin}`
  const etiqueta = inicio === fin ? inicio : `${inicio} — ${fin}`

  return `
    <div class="card" id="ir-doc">
      <h2 style="margin:0 0 var(--space-2)">Análisis de ventas, compras y margen bruto</h2>
      <p class="sub" style="margin:0">${esc(d.cliente?.nombre || '')} · RUT ${esc(formatRut(d.cliente?.rut || ''))}</p>
      <p class="hint" style="margin:var(--space-1) 0 var(--space-4)">Período: ${esc(etiqueta)} · Cifras en pesos chilenos (CLP), netas de IVA</p>

      <h3>1. Resumen ejecutivo</h3>
      <p class="sub" style="line-height:1.6">
        En el período ${esc(etiqueta)} el negocio registró ventas netas por <b class="mono">${fmt(r.ventas_neto)}</b>
        frente a compras netas de <b class="mono">${fmt(r.compras_neto)}</b>, con un margen bruto de
        <b class="mono">${fmt(r.margen)}</b> (<b>${r.pct_margen}%</b> sobre las ventas).
      </p>

      <div class="tbl-wrap mt"><table class="tbl">
        <thead><tr><th>Mes</th><th class="num">Ventas netas</th><th class="num">Compras netas</th><th class="num">Margen bruto</th><th class="num">% margen</th></tr></thead>
        <tbody>
          ${porAnio.flatMap((g) => [
            porAnio.length > 1 ? `<tr><td colspan="5" class="sub"><b>${g.anio}</b></td></tr>` : '',
            ...g.meses.map((m) => `<tr>
              <td>${esc(m.mes_nombre)}${porAnio.length > 1 ? '' : ' ' + m.anio}</td>
              <td class="num mono">${fmt(m.ventas_neto)}</td>
              <td class="num mono">${fmt(m.compras_neto)}</td>
              <td class="num mono">${fmt(m.margen)}</td>
              <td class="num">${m.pct_margen}%</td>
            </tr>`),
            porAnio.length > 1 ? `<tr><td><b>Total ${g.anio}</b></td><td class="num mono"><b>${fmt(g.ventas_neto)}</b></td><td class="num mono"><b>${fmt(g.compras_neto)}</b></td><td class="num mono"><b>${fmt(g.margen)}</b></td><td class="num"><b>${g.pct_margen}%</b></td></tr>` : '',
          ]).join('')}
          <tr><td><b>TOTAL ACUMULADO</b></td>
            <td class="num mono"><b>${fmt(r.ventas_neto)}</b></td>
            <td class="num mono"><b>${fmt(r.compras_neto)}</b></td>
            <td class="num mono"><b>${fmt(r.margen)}</b></td>
            <td class="num"><b>${r.pct_margen}%</b></td></tr>
        </tbody>
      </table></div>

      ${d.modo === 'detalle' ? `
        <h3 class="mt">2. Detalle por mes</h3>
        ${meses.map((m) => `
          <div class="card mt">
            <h4 style="margin:0 0 var(--space-2)">${esc(m.mes_nombre)} ${m.anio}</h4>
            <table class="tbl">
              <tbody>
                <tr><td colspan="2" class="sub"><b>Ventas</b></td></tr>
                <tr><td>Facturas emitidas</td><td class="num mono">${fmt(m.detalle_ventas?.facturas)}</td></tr>
                ${m.detalle_ventas?.notas_debito ? `<tr><td>Notas de débito</td><td class="num mono">${fmt(m.detalle_ventas.notas_debito)}</td></tr>` : ''}
                ${m.detalle_ventas?.notas_credito ? `<tr><td>Notas de crédito</td><td class="num mono">${fmt(m.detalle_ventas.notas_credito)}</td></tr>` : ''}
                <tr><td><b>Total ventas netas</b></td><td class="num mono"><b>${fmt(m.ventas_neto)}</b></td></tr>
                <tr><td colspan="2" class="sub" style="padding-top:var(--space-2)"><b>Compras</b></td></tr>
                <tr><td>Facturas recibidas</td><td class="num mono">${fmt(m.detalle_compras?.facturas)}</td></tr>
                ${m.detalle_compras?.notas_credito ? `<tr><td>Notas de crédito</td><td class="num mono">${fmt(m.detalle_compras.notas_credito)}</td></tr>` : ''}
                <tr><td><b>Total compras netas</b></td><td class="num mono"><b>${fmt(m.compras_neto)}</b></td></tr>
                <tr><td><b>Margen bruto</b></td><td class="num mono"><b>${fmt(m.margen)} (${m.pct_margen}%)</b></td></tr>
              </tbody>
            </table>
          </div>`).join('')}` : ''}

      ${errores.length ? `
        <h3 class="mt">Meses con error</h3>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Mes</th><th>Motivo</th></tr></thead>
          <tbody>${errores.map((e) => `<tr><td>${esc(e.mes_nombre)} ${e.anio}</td><td class="sub">${esc(e.error_msg || '')}</td></tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">Un mes con error no se inventa: queda fuera del resumen y se lista acá.</p>` : ''}

      <h3 class="mt">${d.modo === 'detalle' ? '3' : '2'}. Tendencias y observaciones</h3>
      <ul class="sub" style="line-height:1.7">${(d.observaciones || []).map((o) => `<li>${o}</li>`).join('')}</ul>
      <p class="hint">Informe preparado sobre los libros de compras y ventas del período. Montos netos de IVA; las notas de crédito se presentan como valores negativos.</p>
      <div class="flex mt"><button type="button" class="btn btn-secondary btn-sm" id="ir-imprimir">Imprimir / PDF</button></div>
    </div>`
}

/* ================================================================== */
/* 2. PROCESO MASIVO (F29 del mes para todo el portafolio)             */
/* ================================================================== */

VIEWS['proceso-masivo'] = {
  titulo: 'Proceso masivo',
  async render(cont) {
    const periodo = periodoGlobal()
    let clientes = []
    try {
      clientes = await apiGet('/api/clientes')
    } catch (err) {
      cont.innerHTML = `<div class="card">${UIEstado.error(`No se pudo cargar el portafolio: ${err.message}`)}</div>`
      return
    }
    const n = Array.isArray(clientes) ? clientes.length : 0

    cont.innerHTML = `
      <div class="card">
        <h3>F29 del mes para todo el portafolio</h3>
        <p class="hint">Consulta el RCV del SII de cada cliente y calcula IVA determinado, PPM y total F29 con el mensaje listo para enviar. Es tu propia cartera: no son las empresas contables del sistema.</p>
        <div class="frm-row mt">
          <div><span class="frm-label">Período</span><input type="month" id="pm-periodo" class="form-input" value="${periodo.slice(0, 4)}-${periodo.slice(4)}"></div>
          <div><span class="frm-label">Cartera</span><span class="sub" id="pm-cartera">${n} cliente(s) activo(s) listo(s)</span></div>
          <span class="spacer"></span>
          <button class="btn btn-primary" id="pm-generar" ${n === 0 ? 'disabled' : ''}>Procesar ${n} cliente(s)</button>
        </div>
        ${n === 0 ? `<p class="hint mt">No hay clientes en la cartera: agrega uno con RUT y clave SII antes de procesar.</p>` : ''}
        <div id="pm-estado" class="mt"></div>
        <div id="pm-log" class="mt"></div>
      </div>
      <div id="pm-resultado" class="mt"></div>`

    document.getElementById('pm-generar').addEventListener('click', async () => {
      const p = leerPeriodo('pm-periodo') || periodo
      const ok = await UIEstado.confirmar({
        titulo: `Procesar ${perDisplay(p)}`,
        cuerpo: `<dl>
          ${UIEstado.dato('Período', `<b class="mono">${esc(perDisplay(p))}</b>`)}
          ${UIEstado.dato('Clientes a consultar', `<b class="mono">${n}</b>`)}
        </dl>
        <p class="hint">Se consultará el SII una vez por cliente (compras y ventas). No se contabiliza nada: solo se calcula el F29 y el mensaje.</p>`,
        texto: `Procesar ${n} cliente(s)`,
      })
      if (!ok) return

      const btn = document.getElementById('pm-generar')
      const estadoBox = document.getElementById('pm-estado')
      const log = document.getElementById('pm-log')
      const out = document.getElementById('pm-resultado')
      btn.disabled = true
      out.innerHTML = ''
      log.innerHTML = ''
      estadoBox.innerHTML = loteProgresoHTML(5, 'Iniciando proceso…')
      try {
        const j = await apiPost('/api/proceso/generar', { periodo: p })
        let ultimo = null
        const fin = await loteEsperar(`/api/proceso/${j.proceso_id}/estado`, {
          esTerminal: (d) => d.estado === 'completado' || d.estado === 'error',
          onTick: (d) => {
            ultimo = d
            const pct = d.total ? Math.round((d.procesados / d.total) * 100) : 5
            estadoBox.innerHTML = loteProgresoHTML(pct, d.procesando
              ? `Consultando: ${d.procesando} (${d.procesados}/${d.total})`
              : `${d.procesados}/${d.total} clientes procesados`)
            log.innerHTML = `<ul class="sub" style="line-height:1.7;margin:0;padding-left:1.2rem">${(d.resultados || [])
              .map((r) => `<li>${r.estado === 'ok' ? '✅' : '❌'} ${esc(r.nombre)}${r.estado === 'error' ? ` — ${esc(r.error_msg || '')}` : ''}</li>`).join('')}</ul>`
          },
        })
        estadoBox.innerHTML = ''
        btn.disabled = false
        if (fin.estado === 'error') {
          showToast(fin.error_msg || 'El proceso terminó con error', 'error')
          return
        }
        renderLoteResultados(fin.resultados || [], fin.periodo || p, out)
        showToast('Proceso completado', 'success')
      } catch (e) {
        estadoBox.innerHTML = ''
        btn.disabled = false
        showToast(e.message, 'error')
      }
    })
  },
}

function renderLoteResultados(resultados, periodo, out) {
  const ok = resultados.filter((r) => r.estado === 'ok')
  const errores = resultados.filter((r) => r.estado === 'error')
  out.innerHTML = `
    <div class="card">
      <div class="flex">
        <h3 style="margin:0">${perDisplay(periodo)} · ${ok.length}/${resultados.length} procesado(s)</h3>
        <span class="spacer"></span>
        ${errores.length ? `<button class="btn btn-secondary btn-sm" id="pm-reintentar">Reintentar ${errores.length} con error</button>` : ''}
      </div>
      ${errores.length ? `<p class="hint">Los errores se muestran con su motivo: el SII no respondió o la clave falló. Reintentar consulta de nuevo SOLO esos clientes.</p>` : ''}
    </div>
    <div class="grid-2 mt">
      ${resultados.map((r, idx) => loteCardHTML(r, idx)).join('')}
    </div>`

  out.querySelectorAll('.pm-msg').forEach((b) => b.addEventListener('click', () => {
    const panel = document.getElementById(`pm-mensaje-${b.dataset.idx}`)
    if (!panel) return
    panel.hidden = !panel.hidden
    b.textContent = panel.hidden ? 'Ver mensaje' : 'Ocultar mensaje'
  }))
  out.querySelectorAll('.pm-copiar').forEach((b) => b.addEventListener('click', async () => {
    const r = resultados[Number(b.dataset.idx)]
    try {
      await navigator.clipboard.writeText(r.mensaje_whatsapp || '')
      showToast('Mensaje copiado', 'success')
    } catch { showToast('El navegador no permitió copiar: abre el mensaje y cópialo a mano', 'error') }
  }))
  out.querySelectorAll('.pm-wa').forEach((b) => b.addEventListener('click', () => {
    const r = resultados[Number(b.dataset.idx)]
    const tel = String(r.telefono || '').replace(/\D/g, '')
    if (!tel) { showToast('El cliente no tiene teléfono registrado', 'error'); return }
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(r.mensaje_whatsapp || '')}`, '_blank', 'noopener')
  }))
  out.querySelectorAll('.pm-retry').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true
    try {
      const r = await apiPost(`/api/proceso/reintentar/${b.dataset.id}`, { periodo })
      const idx = resultados.findIndex((x) => Number(x.cliente_id) === Number(b.dataset.id))
      if (idx >= 0) resultados[idx] = r.resultado
      renderLoteResultados(resultados, periodo, out)
      showToast(r.resultado.estado === 'ok' ? 'Cliente reintentado con éxito' : (r.resultado.error_msg || 'Sigue con error'), r.resultado.estado === 'ok' ? 'success' : 'error')
    } catch (e) {
      b.disabled = false
      showToast(e.message, 'error')
    }
  }))
  document.getElementById('pm-reintentar')?.addEventListener('click', async () => {
    const fallidos = resultados.filter((r) => r.estado === 'error')
    for (const r of fallidos) {
      try {
        const res = await apiPost(`/api/proceso/reintentar/${r.cliente_id}`, { periodo })
        const idx = resultados.findIndex((x) => Number(x.cliente_id) === Number(r.cliente_id))
        if (idx >= 0) resultados[idx] = res.resultado
      } catch { /* se refleja abajo con el estado real del cliente */ }
    }
    renderLoteResultados(resultados, periodo, out)
  })
}

function loteCardHTML(r, idx) {
  if (r.estado === 'error') {
    return `<div class="card" style="border-color:var(--danger)">
      <div class="flex"><div>
        <b>${esc(r.nombre)}</b><br><span class="sub mono">${esc(formatRut(r.rut || ''))}</span>
      </div><span class="chip anulado">ERROR</span></div>
      <p class="sub mt">${esc(r.error_msg || '')}</p>
      <button class="btn btn-secondary btn-sm pm-retry" data-id="${r.cliente_id}">Reintentar</button>
    </div>`
  }
  const iva = Number(r.iva_pagar) || 0
  const ppmPct = r.ventas_neto ? ((r.ppm_monto / r.ventas_neto) * 100).toFixed(1) : '0.0'
  return `<div class="card">
    <div class="flex"><div>
      <b>${esc(r.nombre)}</b><br><span class="sub mono">${esc(formatRut(r.rut || ''))}</span>
    </div>${r.exento ? '<span class="chip neutral">EXENTO</span>' : ''}</div>
    <table class="tbl mt"><tbody>
      <tr><td>Compras</td><td class="num mono">neto ${fmt(r.compras_neto)} · IVA ${fmt(r.compras_iva)}</td></tr>
      <tr><td>Ventas</td><td class="num mono">neto ${fmt(r.ventas_neto)} · IVA ${fmt(r.ventas_iva)}</td></tr>
      ${r.exento ? `<tr><td colspan="2" class="sub">Sin IVA determinado (exento)</td></tr>` : `
        <tr><td>Débito</td><td class="num mono">${fmt(r.debito_fiscal)}</td></tr>
        <tr><td>Crédito</td><td class="num mono">-${fmt(r.credito_fiscal)}</td></tr>
        <tr><td>${iva < 0 ? 'Remanente' : 'IVA a pagar'}</td><td class="num mono">${fmt(Math.abs(iva))}</td></tr>
        <tr><td>PPM ${ppmPct}%</td><td class="num mono">${fmt(r.ppm_monto)}</td></tr>`}
      <tr><td><b>Total F29</b></td><td class="num mono"><b>${fmt(r.exento ? 0 : r.total_f29)}</b></td></tr>
    </tbody></table>
    <div class="flex mt">
      <button class="btn btn-secondary btn-sm pm-msg" data-idx="${idx}">Ver mensaje</button>
      <button class="btn btn-secondary btn-sm pm-copiar" data-idx="${idx}">Copiar</button>
      <button class="btn btn-secondary btn-sm pm-wa" data-idx="${idx}">WhatsApp</button>
    </div>
    <pre class="mensaje-panel" id="pm-mensaje-${idx}" hidden>${esc(r.mensaje_whatsapp || '')}</pre>
  </div>`
}

/* ================================================================== */
/* 3. REPORTE MASIVO (ZIP)                                             */
/* ================================================================== */

VIEWS['exportacion-masiva'] = {
  titulo: 'Reporte masivo',
  async render(cont) {
    const mes = loteMesInicial()
    cont.innerHTML = `
      <div class="card">
        <h3>ZIP con el reporte de todos los clientes</h3>
        <p class="hint">Genera en el servidor un archivo con el reporte de cada cliente del portafolio para el rango elegido. El ZIP se descarga desde el mismo navegador con tu sesión.</p>
        <div class="frm-row mt">
          <div><span class="frm-label">Desde</span><input type="month" id="em-desde" class="form-input" value="${mes}"></div>
          <div><span class="frm-label">Hasta</span><input type="month" id="em-hasta" class="form-input" value="${mes}"></div>
          <span class="spacer"></span>
          <button class="btn btn-primary" id="em-generar">Generar ZIP</button>
        </div>
        <div id="em-estado" class="mt"></div>
      </div>
      <div id="em-resultado" class="mt"></div>`

    document.getElementById('em-generar').addEventListener('click', async () => {
      const desde = loteMesValor('em-desde', mes)
      const hasta = loteMesValor('em-hasta', mes)
      const err = loteValidarRango(desde, hasta)
      if (err) { showToast(err, 'error'); return }
      const total = (hasta.anio - desde.anio) * 12 + (hasta.mes - desde.mes) + 1
      const ok = await UIEstado.confirmar({
        titulo: 'Generar reporte masivo',
        cuerpo: `<dl>
          ${UIEstado.dato('Desde', esc(perDisplay(String(desde.anio) + String(desde.mes).padStart(2, '0'))))}
          ${UIEstado.dato('Hasta', esc(perDisplay(String(hasta.anio) + String(hasta.mes).padStart(2, '0'))))}
          ${UIEstado.dato('Meses por cliente', `<b class="mono">${total}</b>`)}
        </dl>
        <p class="hint">Se consulta el SII por cada cliente y cada mes: puede tardar varios minutos. Nada se contabiliza.</p>`,
        texto: 'Generar ZIP',
      })
      if (!ok) return

      const btn = document.getElementById('em-generar')
      const estadoBox = document.getElementById('em-estado')
      const out = document.getElementById('em-resultado')
      btn.disabled = true
      out.innerHTML = ''
      estadoBox.innerHTML = loteProgresoHTML(5, 'Iniciando exportación…')
      try {
        const j = await apiPost('/api/exportacion-masiva/generar', {
          anio_inicio: desde.anio, anio_fin: hasta.anio,
          mes_inicio: desde.mes, mes_fin: hasta.mes,
        })
        const fin = await loteEsperar(`/api/exportacion-masiva/${j.export_id}/estado`, {
          esTerminal: (d) => d.estado === 'completado' || d.estado === 'error',
          onTick: (d) => {
            const pct = d.total ? Math.round((d.procesados / d.total) * 100) : 5
            estadoBox.innerHTML = loteProgresoHTML(pct, d.procesando
              ? `Cliente ${d.procesados + 1} de ${d.total}: ${d.procesando}`
              : `${d.procesados} de ${d.total} clientes procesados`)
          },
        })
        estadoBox.innerHTML = ''
        btn.disabled = false
        if (fin.estado === 'error') {
          showToast(fin.error_msg || 'La exportación terminó con error', 'error')
          return
        }
        const errores = fin.errores || []
        out.innerHTML = `<div class="card">
          <h3 style="color:var(--success)">Reporte listo</h3>
          <p class="sub">${fin.procesados || 0} de ${fin.total || 0} cliente(s) incluidos en el ZIP.</p>
          ${errores.length ? `<p class="hint" style="color:var(--danger)">${errores.length} cliente(s) no se pudieron exportar: ${errores.map((e) => `<b>${esc(e.cliente)}</b> (${esc(e.error)})`).join(', ')}</p>` : ''}
          <a class="btn btn-primary mt" href="/api/exportacion-masiva/${j.export_id}/descargar">Descargar ZIP</a>
        </div>`
        showToast('Reporte masivo listo', 'success')
      } catch (e) {
        estadoBox.innerHTML = ''
        btn.disabled = false
        showToast(e.message, 'error')
      }
    })
  },
}
