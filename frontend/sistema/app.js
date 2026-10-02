/**
 * SISTEMA CONTABLE JMV — núcleo de la SPA (boot, login, shell, router).
 *
 * IVA Mensual queda OCULTO: actúa solo como la integración que ingesta los
 * documentos del SII (conexión RCV). Este sistema consume las mismas APIs
 * /api/contable/* pero con identidad y navegación propias.
 * Las vistas se registran en window.VIEWS desde views-fiscal.js y views-conta.js.
 */

const S = {
  user: null,
  empresas: [],
  empresa: null,        // empresa activa (objeto {id, rut, nombre, ...})
  permisos: new Set(),  // capacidades del usuario en la empresa activa
  superAdmin: false,
  licencia: null,
  cache: {},            // cachés por empresa (cuentas, centros, periodos…)
}

window.VIEWS = {}

/* ---------- helpers base ---------- */

const esc = (v) => (window.escapeHtml ? escapeHtml(v) : String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))

const $app = () => document.getElementById('app')
const fmtM = (v) => fmt(v || 0)

function periodoActual() {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function perDisplay(p) {
  if (!p || p.length < 6) return p || ''
  if (window.periodoDisplay) return periodoDisplay(p)
  return `${MESES[Number(p.slice(4)) - 1] || ''} ${p.slice(0, 4)}`
}

/** Últimos n períodos terminando en `hasta` (YYYYMM), ascendente. */
function ultimosPeriodos(n, hasta = periodoActual()) {
  const y = Number(hasta.slice(0, 4)), m = Number(hasta.slice(4))
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i, yy = y
    while (mm <= 0) { mm += 12; yy-- }
    out.push(`${yy}${String(mm).padStart(2, '0')}`)
  }
  return out
}

function chipEstado(estado) {
  const map = {
    PENDIENTE: 'pendiente', CLASIFICADO: 'clasificado', PROPUESTO: 'propuesto',
    CONTABILIZADO: 'contabilizado', REVISIÓN: 'revision', ERROR: 'error', ANULADO: 'anulado',
  }
  return `<span class="chip ${map[estado] || 'neutral'}">${esc(estado)}</span>`
}

function openModal(html) {
  cerrarModal()
  const back = document.createElement('div')
  back.className = 'modal-back'
  back.id = 'modal-back'
  back.innerHTML = `<div class="modal-card">${html}</div>`
  back.addEventListener('click', (e) => { if (e.target === back) cerrarModal() })
  document.body.appendChild(back)
}

function cerrarModal() {
  const m = document.getElementById('modal-back')
  if (m) m.remove()
}

function selectOptions(items, valueKey, labelFn, selected) {
  return items.map((it) => `<option value="${esc(it[valueKey])}" ${String(it[valueKey]) === String(selected ?? '') ? 'selected' : ''}>${esc(labelFn(it))}</option>`).join('')
}

/** Cache por empresa para no repetir fetch de catálogos. */
async function cacheOnce(key, fetcher) {
  const k = `${S.empresa.id}:${key}`
  if (!S.cache[k]) S.cache[k] = fetcher()
  return S.cache[k]
}

const getCuentas = () => cacheOnce('cuentas', () => apiGet(`/api/contable/empresas/${S.empresa.id}/cuentas`).then((r) => r.cuentas))
const getCuentasImputables = () => cacheOnce('imputables', () => apiGet(`/api/contable/empresas/${S.empresa.id}/cuentas-imputables`).then((r) => r.cuentas))
const getCentros = () => cacheOnce('centros', () => apiGet(`/api/contable/empresas/${S.empresa.id}/centros-costo`).then((r) => r.centros))

function tiene(cap) { return S.permisos.has(cap) }

/** Selector de período (input month ↔ YYYYMM). */
function inputPeriodoHTML(id, valor) {
  const v = String(valor || periodoActual())
  return `<input type="month" id="${id}" class="form-input" value="${v.slice(0, 4)}-${v.slice(4)}" style="width:auto">`
}
function leerPeriodo(id) {
  const raw = document.getElementById(id)?.value || ''
  return raw.replaceAll('-', '')
}

/* ---------- boot / sesión ---------- */

window.appBoot = boot

async function boot() {
  try {
    const me = await apiGet('/api/auth/me')
    setUser(me.user)
    renderShell()
    navigate(location.hash || '#inicio')
  } catch {
    renderLogin()
  }
}

function setUser(user) {
  S.user = { id: user.id, username: user.username, is_admin: !!user.is_admin }
  const acc = user.acceso_contable || { super_admin: false, empresas: [] }
  S.superAdmin = !!acc.super_admin
  S.empresas = acc.empresas || []
  const guardada = localStorage.getItem('iva_empresa_activa')
  S.empresa = S.empresas.find((e) => String(e.id) === String(guardada)) || S.empresas[0] || null
  S.licencia = S.empresa?.licencia || null
  S.permisos = new Set(S.empresa?.permisos || [])
  S.cache = {}
}

function setEmpresa(id) {
  localStorage.setItem('iva_empresa_activa', String(id))
  const e = S.empresas.find((x) => String(x.id) === String(id))
  S.empresa = e || null
  S.licencia = e?.licencia || null
  S.permisos = new Set(e?.permisos || [])
  S.cache = {}
  renderShell()
  navigate(location.hash || '#inicio')
}

/* ---------- login embebido (mismo template que la landing) ---------- */

function renderLogin(mensaje = '') {
  $app().innerHTML = `
    <div class="sys-login">
      <div class="login-card">
        <div class="logo"><img src="/assets/logo-light.svg" alt="JMV"><b>Sistema Contable</b></div>
        <h2>Ingresar</h2>
        <p class="sub">Con tus credenciales de JMV Consultores</p>
        <div class="login-err" id="login-err" hidden></div>
        ${mensaje ? `<div class="banner-lic" style="background:var(--success-soft);color:var(--success)">${esc(mensaje)}</div>` : ''}
        <form id="login-form">
          <div class="form-group">
            <label class="form-label" for="lg-user">Usuario</label>
            <input type="text" id="lg-user" class="form-input" autocomplete="username" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="lg-pass">Contraseña</label>
            <input type="password" id="lg-pass" class="form-input" autocomplete="current-password" required>
          </div>
          <button type="submit" class="btn btn-primary" id="lg-btn" style="width:100%">Entrar →</button>
        </form>
      </div>
    </div>`
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = document.getElementById('login-err')
    const btn = document.getElementById('lg-btn')
    err.hidden = true
    btn.disabled = true
    btn.textContent = 'Verificando…'
    try {
      await apiPost('/api/auth/login', {
        username: document.getElementById('lg-user').value.trim(),
        password: document.getElementById('lg-pass').value,
      })
      boot()
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
      btn.disabled = false
      btn.textContent = 'Entrar →'
    }
  })
}

/* ---------- shell ---------- */

const NAV = [
  { key: 'inicio', label: 'Inicio', ico: '🏠', permiso: null },
  { key: 'automatizacion', label: '⚡ Automatización', ico: '⚡', permiso: 'propuestas:ver' },
  { key: 'libros', label: 'Libros Compras y Ventas', ico: '📚', permiso: 'documentos:ver' },
  { key: 'documentos', label: 'Documentos', ico: '🧾', permiso: 'documentos:ver' },
  { key: 'asientos', label: 'Contabilidad', ico: '⚖️', permiso: 'asientos:ver' },
  { key: 'propuestas', label: 'Propuestas', ico: '⚡', permiso: 'propuestas:ver' },
  { key: 'reportes', label: 'Reportes y Cierre', ico: '📈', permiso: 'reportes:ver' },
  { key: 'integraciones', label: 'Integraciones', ico: '🔌', permiso: 'empresas:ver' },
  { key: 'admin', label: 'Administración', ico: '⚙️', permiso: 'periodos:ver' },
]

function renderShell() {
  if (!S.empresa) {
    $app().innerHTML = `<div class="sys-login"><div class="login-card" style="max-width:460px">
      <h2>Sin empresas asignadas</h2>
      <p class="sub">Tu usuario (${esc(S.user.username)}) no tiene acceso a ninguna empresa. Contacta a JMV Consultores.</p>
      <button class="btn btn-secondary" onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>boot())">Salir</button>
    </div></div>`
    return
  }

  const lic = S.licencia || {}
  let banner = ''
  if (lic.estado === 'PRUEBA' && lic.dias_restantes <= 14) {
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">⏳ Licencia de prueba: quedan <b>${lic.dias_restantes}</b> día(s). Habla con JMV para activar tu plan.</div>`
  } else if (lic.en_gracia) {
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">⚠ ${esc(lic.mensaje || 'Licencia vencida — activa un plan para evitar la suspensión')}</div>`
  } else if (['SUSPENDIDA', 'CANCELADA', 'VENCIDA'].includes(lic.estado)) {
    banner = `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">⛔ ${esc(lic.mensaje || `Licencia ${lic.estado}: puedes consultar, pero no registrar movimientos`)}</div>`
  }

  $app().innerHTML = `
    <div class="sys">
      <button class="btn btn-secondary btn-sm sys-toggle" id="sys-toggle">☰</button>
      <aside class="sys-sidebar" id="sys-sidebar">
        <div class="sys-logo">
          <img src="/assets/logo-light.svg" alt="JMV">
          <div class="t">Sistema Contable<small>JMV Consultores</small></div>
        </div>
        <nav class="sys-nav" id="sys-nav">
          ${NAV.map((n) => (!n.permiso || tiene(n.permiso)
            ? `<a href="#${n.key}" data-route="${n.key}"><span class="ico">${n.ico}</span>${n.label}<span class="pill" data-pill="${n.key}"></span></a>`
            : '')).join('')}
        </nav>
        <div class="sys-sidebar-foot">
          <div>${esc(S.user.username)}${S.superAdmin ? ' · super admin' : ''}</div>
          <div style="margin-top:2px"><a href="#" id="sys-logout" style="color:var(--accent)">Cerrar sesión</a></div>
        </div>
      </aside>
      <main class="sys-main">
        <div class="sys-topbar">
          <h1 id="sys-title">Inicio</h1>
          <span class="spacer"></span>
          <select id="sys-empresa" class="form-input" style="width:auto">
            ${S.empresas.map((e) => `<option value="${e.id}" ${String(e.id) === String(S.empresa.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select>
        </div>
        <div id="sys-banner">${banner}</div>
        <div id="sys-view"></div>
      </main>
    </div>`

  document.getElementById('sys-empresa').addEventListener('change', (e) => setEmpresa(e.target.value))
  document.getElementById('sys-logout').addEventListener('click', async (e) => {
    e.preventDefault()
    try { await apiPost('/api/auth/logout', {}) } catch { /* sesión ya inexistente */ }
    localStorage.removeItem('iva_empresa_activa')
    renderLogin()
  })
  document.getElementById('sys-toggle').addEventListener('click', () => {
    document.getElementById('sys-sidebar').classList.toggle('open')
  })
}

/* ---------- router ---------- */

function navigate(hash) {
  if (location.hash !== hash) { location.hash = hash; return } // dispara hashchange
  renderRoute()
}

window.addEventListener('hashchange', renderRoute)

function renderRoute() {
  if (!S.user) return
  const key = (location.hash || '#inicio').slice(1)
  const view = VIEWS[key] || VIEWS.inicio
  const route = NAV.find((n) => n.key === key) || NAV[0]

  document.querySelectorAll('#sys-nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === route.key))
  document.getElementById('sys-sidebar')?.classList.remove('open')
  document.getElementById('sys-title').textContent = view.titulo || route.label

  if (route.permiso && !tiene(route.permiso)) {
    document.getElementById('sys-view').innerHTML =
      `<div class="empty">Tu rol en ${esc(S.empresa.nombre)} no tiene permiso para esta sección.</div>`
    return
  }

  const cont = document.getElementById('sys-view')
  cont.innerHTML = `<div class="empty">Cargando…</div>`
  Promise.resolve(view.render(cont)).catch((err) => {
    cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
  })
}

/* ---------- pill de documentos pendientes en el nav ---------- */

async function refrescarPillDocs() {
  if (!S.empresa || !tiene('documentos:ver')) return
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos?estado=PENDIENTE&limit=1`)
    const a = document.querySelector('[data-pill="documentos"]')
    if (a && r.total) a.textContent = r.total
  } catch { /* silencioso */ }
}
