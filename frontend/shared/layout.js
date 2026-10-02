/**
 * Layout compartido: sidebar en acordeón + (en páginas con #panel-central)
 * el header con cliente activo/Conectar/estado. Se renderiza desde JS para
 * no repetir el mismo HTML en cada página.
 *
 * Uso: en el <body>, un <div id="layout-root"></div> vacío, y al final:
 *   <script src="/shared/api.js"></script>
 *   <script src="/shared/layout.js"></script>
 *   <script>initLayout('inicio')</script>
 */

// "tipo" apunta a una clave de CATALOGO (frontend/js/reportes.js) — el sidebar
// no conoce el contenido de cada reporte, solo el identificador para navegar.
// "hijos" arma un desplegable; puede anidarse (Ranking ▾ → Análisis ▾ → Mensual/Anual).
// IVA Mensual es tributario puro: la CONTABILIDAD vive aparte, en /sistema/
// (Sistema Contable JMV), que consume esta app solo como integración SII.
const NAV_ITEMS = [
  { key: 'inicio', label: 'Inicio', icon: '🏠', tipo: null },
  { key: 'clientes', label: 'Clientes', icon: '👥', href: '/index.html' },
  { key: 'exportacion-masiva', label: 'Reporte Masivo', icon: '📦', href: '/exportacion-masiva.html' },
  {
    key: 'tributarios', label: 'Tributarios', icon: '🧾', hijos: [
      {
        key: 'iva', label: 'IVA', hijos: [
          { key: 'iva-mensual', label: 'Mensual', tipo: 'iva-mensual' },
          { key: 'iva-anual', label: 'Anual', tipo: 'iva-anual' },
          { key: 'iva-por-cliente', label: 'Por Cliente', tipo: 'iva-por-cliente' },
          { key: 'estado-iva', label: 'Estado', tipo: 'estado-iva' },
        ],
      },
      { key: 'libro-compras-rango', label: 'Libro Compra', tipo: 'libro-compras-rango' },
      { key: 'libro-ventas-rango', label: 'Libro Venta', tipo: 'libro-ventas-rango' },
      { key: 'desglose-gestion-compras', label: 'Desglose Compras', tipo: 'desglose-gestion-compras' },
      { key: 'desglose-gestion-ventas', label: 'Desglose Ventas', tipo: 'desglose-gestion-ventas' },
      { key: 'resumen-tributario', label: 'Resumen', tipo: 'resumen-tributario' },
      { key: 'exportaciones', label: 'Exportaciones', tipo: 'exportaciones' },
    ],
  },
  {
    key: 'comercial', label: 'Comercial', icon: '🤝', hijos: [
      { key: 'top-clientes', label: 'Clientes', tipo: 'top-clientes' },
      { key: 'top-proveedores', label: 'Proveedores', tipo: 'top-proveedores' },
    ],
  },
  {
    key: 'ranking', label: 'Ranking', icon: '🏆', hijos: [
      { key: 'ventas-mes', label: 'Evolución', tipo: 'ventas-mes' },
      {
        key: 'analisis', label: 'Análisis', hijos: [
          { key: 'ranking-mensual', label: 'Mensual', tipo: 'ranking-mensual' },
          { key: 'ranking-anual', label: 'Anual', tipo: 'ranking-anual' },
        ],
      },
    ],
  },
  {
    key: 'comparativos', label: 'Comparativos', icon: '📊', hijos: [
      { key: 'tendencias', label: 'Tendencias', tipo: 'tendencias' },
      { key: 'variaciones', label: 'Variaciones', tipo: 'variaciones' },
      { key: 'kpis', label: 'KPIs', tipo: 'kpis' },
      { key: 'alertas', label: 'Alertas', tipo: 'alertas' },
      { key: 'informe-gestion', label: 'Informe de Gestión', tipo: 'informe-gestion' },
    ],
  },
  {
    key: 'centro-tributario', label: 'Centro Tributario', icon: '🛡️', hijos: [
      { key: 'validador-iva', label: 'Validador IVA', tipo: 'validador-iva' },
      { key: 'calculadora-ppm', label: 'Calculadora PPM', tipo: 'calculadora-ppm' },
      { key: 'calendario-tributario', label: 'Calendario', tipo: 'calendario-tributario' },
      { key: 'pendientes', label: 'Pendientes', tipo: 'pendientes' },
      { key: 'duplicadas', label: 'Duplicadas', tipo: 'duplicadas' },
      { key: 'comparador-f29', label: 'Comparador F29', tipo: 'comparador-f29' },
      { key: 'intereses', label: 'Interés penal', tipo: 'intereses' },
      { key: 'checklist-cierre', label: 'Checklist cierre', tipo: 'checklist-cierre' },
      { key: 'observaciones', label: 'Observaciones', tipo: 'observaciones' },
    ],
  },
  {
    key: 'herramientas', label: 'Herramientas', icon: '🧰', hijos: [
      { key: 'cobranza', label: 'Cobranza WhatsApp', tipo: 'cobranza' },
      { key: 'conversor-dte', label: 'Conversor DTE', tipo: 'conversor-dte' },
    ],
  },
]

let _activeTipo = null

function _contieneTipoActivo(item) {
  if (item.tipo !== undefined) return item.tipo === _activeTipo
  if (item.hijos) return item.hijos.some(_contieneTipoActivo)
  return false
}

function _navItemHtml(item, profundidad = 0) {
  if (item.hijos) {
    const abierto = _contieneTipoActivo(item)
    return `
      <div class="nav-group ${abierto ? 'open' : ''}">
        <button type="button" class="nav-group-toggle" title="${item.label}">
          <span class="nav-icon">${item.icon || ''}</span>
          <span class="nav-label">${item.label}</span>
          <span class="nav-caret">▾</span>
        </button>
        <div class="nav-children ${profundidad > 0 ? 'nav-children-nested' : ''}">
          ${item.hijos.map((h) => _navItemHtml(h, profundidad + 1)).join('')}
        </div>
      </div>`
  }
  if (item.href) {
    return `
      <a href="${item.href}" class="nav-link" title="${item.label}">
        ${item.icon ? `<span class="nav-icon">${item.icon}</span>` : ''}
        <span class="nav-label">${item.label}</span>
      </a>`
  }
  const esInicio = item.tipo === null
  const activo = esInicio ? _activeTipo === null : item.tipo === _activeTipo
  return `
    <button type="button" class="nav-link nav-tipo-btn ${activo ? 'active' : ''}" title="${item.label}" data-tipo="${item.tipo === null ? '' : item.tipo}">
      ${item.icon ? `<span class="nav-icon">${item.icon}</span>` : ''}
      <span class="nav-label">${item.label}</span>
    </button>`
}

function _irAVista(tipo) {
  const panelCentral = document.getElementById('panel-central')
  if (panelCentral && window.ShellRouter) {
    if (tipo === '') window.ShellRouter.mostrarDashboard()
    else window.ShellRouter.mostrarReporte(tipo)
    return
  }
  // Página legada sin shell: navega de verdad a dashboard.html, que al
  // cargar revisa "tipoPendiente" en sessionStorage y abre esa vista una vez.
  sessionStorage.setItem('iva_tipo_pendiente', tipo)
  window.location.href = '/dashboard.html'
}

function _renderSidebarNav(root) {
  const $nav = root.querySelector('.sidebar-nav')
  $nav.innerHTML = NAV_ITEMS.map((item) => _navItemHtml(item)).join('')

  $nav.querySelectorAll('.nav-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.nav-group').classList.toggle('open')
    })
  })
  $nav.querySelectorAll('.nav-tipo-btn').forEach((btn) => {
    btn.addEventListener('click', () => _irAVista(btn.dataset.tipo))
  })
}

const LayoutSidebar = {
  render(activeTipo) {
    _activeTipo = activeTipo
    const root = document.getElementById('layout-root')
    if (!root) return
    _renderSidebarNav(root)
  },
}
window.LayoutSidebar = LayoutSidebar

async function initLayout(activeKey) {
  const root = document.getElementById('layout-root')
  if (!root) return

  let user
  try {
    const data = await apiGet('/api/auth/me')
    user = data.user
  } catch (err) {
    window.location.href = '/login.html'
    return
  }

  _mostrarBannerLicencia(user)

  const esShell = !!document.getElementById('panel-central')
  _activeTipo = null // "Inicio" por defecto; el shell la corrige después vía LayoutSidebar.render

  root.innerHTML = `
    <button type="button" class="sidebar-toggle-mobile" id="sidebar-toggle-mobile" aria-label="Menú">☰</button>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        <img src="/assets/logo-light.svg" alt="JMV Consultores" />
        <span class="sidebar-logo-text">IVA Mensual<small>JMV Consultores</small></span>
        <button type="button" class="sidebar-collapse-btn" id="sidebar-collapse-btn" title="Colapsar menú">⇤</button>
      </div>
      <nav class="sidebar-nav"></nav>
      <div class="sidebar-footer">
        ${user.is_admin ? `
        <a href="/configuracion.html?tab=usuarios" class="nav-link ${activeKey === 'usuarios' ? 'active' : ''}">
          <span class="nav-icon">👤</span><span class="nav-label">Usuarios</span>
        </a>` : ''}
        <a href="/configuracion.html" class="nav-link ${activeKey === 'configuracion' ? 'active' : ''}">
          <span class="nav-icon">⚙️</span><span class="nav-label">Configuración</span>
        </a>
        <div class="nav-user">
          <span class="nav-username" title="${user.username}">${user.username}</span>
          <button type="button" class="nav-logout" id="btn-logout" title="Cerrar sesión">⏻</button>
        </div>
      </div>
    </aside>
    <div class="sidebar-overlay" id="sidebar-overlay"></div>
    ${esShell ? `
    <header class="topbar">
      <div class="control-group topbar-cliente">
        <select id="topbar-select-cliente" class="form-select"><option value="">Cargando clientes...</option></select>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="topbar-btn-conectar">⚡ Conectar</button>
      <span class="badge-estado badge-sin-datos" id="topbar-badge">Sin datos</span>
      <span class="topbar-spacer"></span>
    </header>
    <div class="topbar-progress" id="topbar-progress" hidden><div class="topbar-progress-fill" id="topbar-progress-fill"></div></div>
    <section class="filtro-global-bar">
      ${rangoMesAnioHtml('filtro-global')}
      <div class="filtro-presets" id="filtro-presets" role="group" aria-label="Períodos rápidos">
        <button type="button" class="filtro-preset" data-preset="mes-actual">Este mes</button>
        <button type="button" class="filtro-preset" data-preset="trim">Últimos 3 meses</button>
        <button type="button" class="filtro-preset" data-preset="anio">Año actual</button>
        <button type="button" class="filtro-preset" data-preset="anio-anterior">Año anterior</button>
        <button type="button" class="filtro-preset" data-preset="12m">Últimos 12 meses</button>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" id="filtro-global-btn-export-csv">⬇ CSV</button>
      <button type="button" class="btn btn-secondary btn-sm" id="filtro-global-btn-export-excel">⬇ Excel</button>
      <button type="button" class="btn btn-secondary btn-sm" id="filtro-global-btn-export-pdf">⬇ PDF</button>
    </section>` : ''}`

  document.body.classList.add('has-sidebar')
  if (esShell) document.body.classList.add('has-topbar')

  _renderSidebarNav(root)

  const toggleMobile = document.getElementById('sidebar-toggle-mobile')
  const overlay = document.getElementById('sidebar-overlay')
  const sidebar = document.getElementById('sidebar')
  toggleMobile.addEventListener('click', () => {
    sidebar.classList.toggle('open')
    overlay.classList.toggle('show')
  })
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open')
    overlay.classList.remove('show')
  })

  const collapseBtn = document.getElementById('sidebar-collapse-btn')
  const KEY_COLLAPSED = 'iva_sidebar_collapsed'
  if (localStorage.getItem(KEY_COLLAPSED) === '1') {
    document.body.classList.add('sidebar-collapsed')
  }
  collapseBtn.addEventListener('click', () => {
    const colapsado = document.body.classList.toggle('sidebar-collapsed')
    localStorage.setItem(KEY_COLLAPSED, colapsado ? '1' : '0')
  })

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await apiPost('/api/auth/logout') } catch (err) { /* sesión ya inválida, igual redirige */ }
    window.location.href = '/login.html'
  })

  if (esShell) {
    await _initHeader()
  }
}

async function _cargarClientesEnTopbar() {
  const $select = document.getElementById('topbar-select-cliente')
  try {
    const clientes = await apiGet('/api/clientes')
    if (clientes.length === 0) {
      $select.innerHTML = '<option value="">Sin clientes — agregue uno primero</option>'
      return
    }
    $select.innerHTML = '<option value="">Selecciona un cliente…</option>' +
      clientes.map((c) => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('')
    const activo = window.ShellState.getClienteId()
    if (activo && clientes.some((c) => c.id === activo)) $select.value = String(activo)
  } catch {
    $select.innerHTML = '<option value="">Error al cargar</option>'
  }
}

// Resalta el preset cuyo rango coincide exactamente con el rango activo —
// feedback visual de "dónde estoy" sin leer los cuatro selects.
function _marcarPresetActivo(r) {
  document.querySelectorAll('#filtro-presets .filtro-preset').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.preset === _presetQueCoincide(r))
  })
}

function _presetQueCoincide(r) {
  if (!r) return null
  const ahora = new Date()
  const y = ahora.getFullYear()
  const m = ahora.getMonth() + 1
  const eq = (o) => o.anioInicio === r.anioInicio && o.mesInicio === r.mesInicio && o.anioFin === r.anioFin && o.mesFin === r.mesFin
  if (eq({ anioInicio: y, mesInicio: m, anioFin: y, mesFin: m })) return 'mes-actual'
  if (r.anioInicio === y && r.mesInicio === 1 && r.anioFin === y && r.mesFin === 12) return 'anio'
  if (r.anioInicio === y - 1 && r.mesInicio === 1 && r.anioFin === y - 1 && r.mesFin === 12) return 'anio-anterior'
  // 12 meses: mes siguiente del año pasado (en diciembre cae en enero del año
  // actual y coincide con el preset "Año actual", que ya se evaluó antes).
  const m12 = m === 12 ? 1 : m + 1
  if (r.anioInicio === (m === 12 ? y : y - 1) && r.mesInicio === m12 && r.anioFin === y && r.mesFin === m) return '12m'
  return null
}

// Banner de licencia (SAAS-ACCESO §5.4): countdown de prueba, gracia o
// suspensión — visible en las páginas del módulo contable. La licencia viene
// en /api/auth/me → acceso_contable.empresas[].licencia (de la empresa activa).
function _mostrarBannerLicencia(user) {
  try {
    const acc = user && user.acceso_contable
    if (!acc || !acc.empresas || !acc.empresas.length) return
    const activa = localStorage.getItem('iva_empresa_activa')
    const emp = acc.empresas.find((e) => String(e.id) === String(activa)) || acc.empresas[0]
    const lic = emp && emp.licencia
    if (!lic || !lic.estado) return

    let texto = '', tono = ''
    if (lic.estado === 'PRUEBA' && lic.dias_restantes <= 14) {
      texto = `⏳ Prueba: quedan <b>${lic.dias_restantes}</b> día(s) — Plan PYME $29.900/mes al término. Habla con JMV para activarlo.`
      tono = '#b45309'
    } else if (lic.en_gracia) {
      texto = `⚠ ${lic.mensaje || 'Licencia vencida: activa un plan para evitar la suspensión'}`
      tono = '#b45309'
    } else if (lic.estado === 'SUSPENDIDA' || lic.estado === 'CANCELADA' || lic.estado === 'VENCIDA') {
      texto = `⛔ ${lic.mensaje || `Licencia ${lic.estado}: puedes consultar todo, pero no registrar movimientos`}`
      tono = '#b91c1c'
    }
    if (!texto) return

    const main = document.querySelector('main.container')
    if (!main) return
    const banner = document.createElement('div')
    banner.className = 'banner-licencia'
    banner.style.cssText = `background:${tono}14;border:1px solid ${tono}55;color:${tono};border-radius:10px;padding:.55rem .9rem;margin:.4rem 0 .8rem;font-size:.88rem`
    banner.innerHTML = texto
    main.insertBefore(banner, main.firstChild)
  } catch (err) { /* el banner nunca rompe la app */ }
}

const LayoutHeader = {
  setBadge(estado) {
    const $badge = document.getElementById('topbar-badge')
    if (!$badge) return
    $badge.className = 'badge-estado'
    if (estado === 'conectado') { $badge.classList.add('badge-conectado'); $badge.textContent = 'Conectado' }
    else if (estado === 'sincronizando') { $badge.classList.add('badge-sincronizando'); $badge.textContent = 'Sincronizando…' }
    else { $badge.classList.add('badge-sin-datos'); $badge.textContent = 'Sin datos' }
  },
  setProgreso(pct) {
    const $wrap = document.getElementById('topbar-progress')
    const $fill = document.getElementById('topbar-progress-fill')
    if (!$wrap || !$fill) return
    if (pct === null) { $wrap.hidden = true; return }
    $wrap.hidden = false
    $fill.style.width = `${pct}%`
  },
}
window.LayoutHeader = LayoutHeader

async function _initHeader() {
  await _cargarClientesEnTopbar()

  inicializarRangoMesAnio('filtro-global')
  const rangoGuardado = window.ShellState.getRango()
  document.getElementById('filtro-global-mes-inicio').value = String(rangoGuardado.mesInicio)
  document.getElementById('filtro-global-anio-inicio').value = String(rangoGuardado.anioInicio)
  document.getElementById('filtro-global-mes-fin').value = String(rangoGuardado.mesFin)
  document.getElementById('filtro-global-anio-fin').value = String(rangoGuardado.anioFin)

  document.getElementById('topbar-select-cliente').addEventListener('change', (e) => {
    const id = e.target.value
    if (id) window.ShellState.setClienteId(Number(id))
  })

  ;['filtro-global-mes-inicio', 'filtro-global-anio-inicio', 'filtro-global-mes-fin', 'filtro-global-anio-fin'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      const r = leerRangoMesAnio('filtro-global')
      const error = validarRangoMesAnio(r)
      if (error) { showToast(error, 'error'); return }
      window.ShellState.setRango(r)
      _marcarPresetActivo(r)
    })
  })

  _marcarPresetActivo(rangoGuardado)

  // Presets de período: un clic en vez de cuatro selects. El select de "Año
  // inicio" solo llega hasta el año actual, así que para "Año anterior" se
  // agrega la opción si falta antes de asignar valores.
  const PRESETS = {
    'mes-actual': () => {
      const h = new Date()
      return { anioInicio: h.getFullYear(), mesInicio: h.getMonth() + 1, anioFin: h.getFullYear(), mesFin: h.getMonth() + 1 }
    },
    trim: () => {
      const h = new Date()
      let m = h.getMonth() + 1 - 2, a = h.getFullYear()
      if (m < 1) { m += 12; a -= 1 }
      return { anioInicio: a, mesInicio: m, anioFin: h.getFullYear(), mesFin: h.getMonth() + 1 }
    },
    anio: () => ({ anioInicio: new Date().getFullYear(), mesInicio: 1, anioFin: new Date().getFullYear(), mesFin: 12 }),
    'anio-anterior': () => {
      const y = new Date().getFullYear() - 1
      return { anioInicio: y, mesInicio: 1, anioFin: y, mesFin: 12 }
    },
    '12m': () => {
      const h = new Date()
      let m = h.getMonth() + 2, a = h.getFullYear() - 1 // mes siguiente del año pasado
      if (m > 12) { m = 1; a += 1 } // en diciembre: enero del año actual (== "Año actual")
      return { anioInicio: a, mesInicio: m, anioFin: h.getFullYear(), mesFin: h.getMonth() + 1 }
    },
  }
  document.querySelectorAll('#filtro-presets .filtro-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const r = PRESETS[btn.dataset.preset]?.()
      if (!r) return
      const $anioInicio = document.getElementById('filtro-global-anio-inicio')
      const $anioFin = document.getElementById('filtro-global-anio-fin')
      for (const [$sel, val] of [[$anioInicio, r.anioInicio], [$anioFin, r.anioFin]]) {
        if (![...$sel.options].some((o) => o.value === String(val))) {
          $sel.add(new Option(String(val), String(val)), $sel.options[0] ? 0 : null)
        }
      }
      document.getElementById('filtro-global-mes-inicio').value = String(r.mesInicio)
      $anioInicio.value = String(r.anioInicio)
      document.getElementById('filtro-global-mes-fin').value = String(r.mesFin)
      $anioFin.value = String(r.anioFin)
      window.ShellState.setRango(r)
      _marcarPresetActivo(r)
    })
  })

  document.getElementById('topbar-btn-conectar').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('shell:conectar'))
  })

  const exportar = (formato) => {
    if (typeof window.ReportesEngine?.exportar === 'function') {
      window.ReportesEngine.exportar(formato)
      return
    }
    showToast('Abre un reporte para exportar a CSV, Excel o PDF', 'info')
  }
  document.getElementById('filtro-global-btn-export-csv')?.addEventListener('click', () => exportar('csv'))
  document.getElementById('filtro-global-btn-export-excel')?.addEventListener('click', () => exportar('excel'))
  document.getElementById('filtro-global-btn-export-pdf')?.addEventListener('click', () => exportar('pdf'))
}
