/**
 * Layout compartido: sidebar de navegación + topbar. Se renderiza desde JS
 * para no repetir el mismo HTML de navegación en cada página.
 *
 * Uso: en el <body>, en vez del <nav class="navbar">...</nav> de antes, un
 * <div id="layout-root"></div> vacío, y al final del body:
 *   <script src="/shared/layout.js"></script>
 *   <script>initLayout('dashboard')</script>
 */

// Sidebar plano — sin submenús anidados. La categorización (Tributarios /
// Comercial / Análisis) vive dentro del Centro de Reportes, no aquí.
// Nav reducido a 4 ítems: el proceso mensual (antes "Importar") pasa a ser una
// acción dentro de Inicio, y "Libros" se fusionó dentro de Reportes → Tributarios
// (Libro Compra/Venta + Desglose de Gestión), no desapareció, solo cambió de lugar.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Inicio', href: '/dashboard.html', icon: '🏠' },
  { key: 'clientes', label: 'Clientes', href: '/index.html', icon: '👥' },
  { key: 'reportes', label: 'Reportes', href: '/reportes.html', icon: '📈' },
  { key: 'exportaciones', label: 'Exportaciones', href: '/reportes.html?tipo=exportaciones', icon: '📁' },
]

function _navItemHtml(item, activeKey) {
  if (item.children) {
    const abierto = item.children.some((c) => c.key === activeKey)
    return `
      <div class="nav-group ${abierto ? 'open' : ''}">
        <button type="button" class="nav-group-toggle">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
          <span class="nav-caret">▾</span>
        </button>
        <div class="nav-children">
          ${item.children.map((c) => `
            <a href="${c.href}" class="nav-child-link ${c.key === activeKey ? 'active' : ''}">${c.label}</a>
          `).join('')}
        </div>
      </div>`
  }
  return `
    <a href="${item.href}" class="nav-link ${item.key === activeKey ? 'active' : ''}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${item.label}</span>
    </a>`
}

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

  root.innerHTML = `
    <button type="button" class="sidebar-toggle-mobile" id="sidebar-toggle-mobile" aria-label="Menú">☰</button>
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-logo">💼 <span>IVA Mensual</span></div>
      <nav class="sidebar-nav">
        ${NAV_ITEMS.map((item) => _navItemHtml(item, activeKey)).join('')}
      </nav>
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
    <div class="sidebar-overlay" id="sidebar-overlay"></div>`

  document.body.classList.add('has-sidebar')

  root.querySelectorAll('.nav-group-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.closest('.nav-group').classList.toggle('open')
    })
  })

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

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await apiPost('/api/auth/logout') } catch (err) { /* sesión ya inválida, igual redirige */ }
    window.location.href = '/login.html'
  })
}
