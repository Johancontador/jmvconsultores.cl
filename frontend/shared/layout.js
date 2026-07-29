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
const NAV_ITEMS = [
  { key: 'inicio', label: 'Inicio', icon: '🏠', tipo: null },
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

  const esShell = !!document.getElementById('panel-central')
  _activeTipo = null // "Inicio" por defecto; el shell la corrige después vía LayoutSidebar.render

  root.innerHTML = `
    <button type="button" class="sidebar-toggle-mobile" id="sidebar-toggle-mobile" aria-label="Menú">☰</button>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">
        💼 <span>IVA Mensual</span>
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
    })
  })

  document.getElementById('topbar-btn-conectar').addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('shell:conectar'))
  })
}
