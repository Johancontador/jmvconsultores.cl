/**
 * views-centro.js — CENTRO DE APLICACIONES (solicitud 2026-10-15).
 * Punto de entrada después del iniciar sesión: el usuario elige el módulo en
 * el que quiere trabajar sin caer en una pantalla sobrecargada.
 *
 * Reglas del diseño:
 *  - CERO módulos ficticios: los datos vienen del backend
 *    (/api/auth/centro), que solo autoriza apps/secciones REALES del menú del
 *    SPA según empresa asiganda + rol + capacidades + licencia. Si el backend
 *    no autoriza, la tarjeta no existe en el DOM (反 registro inválido).
 *  - Recientes + "Continuar donde quedó" = localStorage POR usuario
 *    (jmv.centro.recientes.<usuarioId>) — graba renderRoute (app.js).
 *  - Retorno claro: navegar hacia acá siempre reconstruye desde /api/centro
 *    (permisos pueden cambiar; nada se cachea más allá de esta vista).
 */

const ICONOS = {
  libro: '<path d="M4 5a2 2 0 0 1 2-2h12v14H6a2 2 0 0 0-2 2zm2 12h12M8 5v10"/>',
  grafico: '<path d="M4 20V10m5 10V4m5 16v-7m5 7V7"/>',
  usuarios: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6S13.9 16 14.5 19M15.5 5.6a3 3 0 0 1 0 4.8M17 14.6c1.9.5 3 1.9 3.4 4.2"/>',
  banco: '<path d="M3 9.5 12 4l9 5.5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18"/>',
  portal: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c-2.6 2.4-2.6 13.6 0 16M12 4c2.6 2.4 2.6 13.6 0 16"/>',
  escudo: '<path d="M12 3.5 19 6v6c0 4.4-3 7.4-7 8.5-4-1.1-7-4.1-7-8.5V6z"/>',
  pipeline: '<path d="M4 5.5v3.5M4 12v3.5M9 5.5v3.5"/><rect x="3" y="15" width="4" height="4" rx="1"/><rect x="10" y="15" width="4" height="4" rx="1"/><rect x="17" y="15" width="4" height="4" rx="1"/><path d="M5 9.5v0c0 2 1.6 3.3 4 3.5h5"/><path d="m12 10.5 2.3 2.5L12 15.5"/>',
}

function iconoHTML(nombre) {
  const d = ICONOS[nombre] || ICONOS.portal
  return `<svg class="centro-ico-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
}

/** chip de estado comercial (módulo habilitado comercialmente). */
function chipLicencia(app, lic) {
  if (!lic) return '' // sin licencia registrada: la gate real vive en cada ruta
  const { habilitado_comercial: ok } = app
  const clase = ok ? (lic.estado === 'PRUEBA' ? 'pendiente' : 'contabilizado') : 'error'
  const texto = ok ? (lic.estado === 'PRUEBA' ? `Prueba · ${lic.dias_restantes} día(s)` : 'Activo') : lic.estado
  const title = ok ? 'Módulo habilitado comercialmente' : (lic.mensaje || 'Módulo restringido: solo lectura')
  return `<span class="chip ${clase}" title="${esc(title)}">${esc(texto)}</span>`
}

VIEWS['centro'] = {
  titulo: 'Centro de Aplicaciones',
  async render(cont) {
    const eid = S.empresa?.id
    const data = await apiGet(`/api/auth/centro${eid ? `?empresa=${eid}` : ''}`)
    const lic = data.licencia

    // Recientes por usuario (el renderRoute graba; acá solo se lee).
    const claveRec = `jmv.centro.recientes.${S.user.id}`
    let recientes = []
    try { recientes = JSON.parse(localStorage.getItem(claveRec) || '[]') } catch { recientes = [] }

    const continuarPrimero = recientes[0] || null

    const appCard = (app) => `
      <div class="centro-card" data-app="${esc(app.key)}">
        <div class="centro-card-head">
          <span class="centro-ico">${iconoHTML(app.icono)}</span>
          <div>
            <h3>${esc(app.titulo)}${app.restringida ? ' <span class="chip neutral" title="Área restringida a roles autorizados">Restringida</span>' : ''}${app.modoExterno ? ' <span class="chip neutral" title="Experiencia externa de clientes">Externo</span>' : ''}</h3>
          </div>
          <span class="spacer"></span>
          ${chipLicencia(app, lic)}
        </div>
        <p class="centro-desc">${esc(app.descripcion)}</p>
        <div class="centro-secciones">
          ${app.secciones.map((s, i) => `
            <a class="chip ${i === 0 ? 'clasificado' : 'neutral'}" href="#${esc(s.ruta)}" title="Ir a ${esc(s.grupo)}">${esc(s.grupo)}</a>`).join('')}
        </div>
        <a class="centro-abrir btn btn-secondary" href="#${esc(app.secciones[0].ruta)}">Abrir módulo →</a>
      </div>`

    cont.innerHTML = `
      <h1 style="display:none"></h1>
      <div class="centro-hola">
        <div>
          <h2>Hola, ${esc(S.user.username)}</h2>
          <p class="muted">
            ${data.empresas.length > 1
              ? `Trabajando en <b>${esc(data.empresa_activa.nombre)}</b> · ${esc(data.empresa_activa.rol)} — cambia arriba a la izquierda.`
              : `${esc(data.empresa_activa.nombre)} · rol ${esc(data.empresa_activa.rol)}`}
          </p>
        </div>
        <span class="spacer"></span>
        ${lic && !lic.ok && !lic.en_gracia ? `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">${esc(lic.mensaje || `Licencia ${lic.estado}: lectura disponible`)}</div>` : ''}
      </div>

      ${continuarPrimero ? `
      <div class="centro-continuar">
        <a class="centro-card centro-card-seguir" href="#${esc(continuarPrimero.ruta)}">
          <span class="centro-ico">${iconoHTML('grafico')}</span>
          <div>
            <small class="muted">Continuar donde quedó</small>
            <h3>${esc(continuarPrimero.label)}</h3>
          </div>
          <span class="spacer"></span>
          <span class="gs-ir">continuar →</span>
        </a>
      </div>` : ''}

      ${recientes.length > 1 ? `
      <div class="centro-recientes">
        <div class="nav-seccion" style="margin:var(--space-3) 0 var(--space-2)">Módulos recientes</div>
        <div class="centro-secciones">
          ${recientes.slice(0, 6).map((r) => `<a class="chip neutral" href="#${esc(r.ruta)}">${esc(r.label)}</a>`).join('')}
        </div>
      </div>` : ''}

      <div class="centro-grid">
        ${data.apps.map(appCard).join('')}
      </div>
      ${data.apps.length === 0 ? '<div class="empty">Tu rol no tiene módulos habilitados en esta empresa. Contacta a JMV Consultores.</div>' : ''}
    `
  },
}
