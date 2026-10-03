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
    // Sondeo barato (siempre 200): sin sesión renderiza el login sin ensuciar
    // la consola con un 401; con sesión se pide el /me completo.
    const estado = await fetch('/api/auth/estado').then((r) => r.json())
    if (!estado.autenticado) return renderLogin()
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

/*
 * MENÚ SUPERIOR HORIZONTAL — secciones con desplegable. Sin iconos: la
 * jerarquía la da la tipografía. Cada sección se despliega al posarse encima.
 */
const MENU = [
  {
    seccion: 'Empresa', items: [
      { key: 'inicio', label: 'Inicio — panel del período', permiso: null },
      { key: 'onboarding', label: 'Onboarding desde el SII', permiso: 'documentos:ver' },
      { key: 'integraciones', label: 'Integraciones', permiso: 'empresas:ver' },
      { key: 'admin', label: 'Administración', permiso: 'periodos:ver' },
      { key: 'suscripcion', label: 'Suscripción y Pagos', permiso: 'empresas:ver' },
    ]
  },
  {
    seccion: 'SII', items: [
      { key: 'libros', label: 'Libros de Compras y Ventas', permiso: 'documentos:ver' },
      { key: 'documentos', label: 'Bandeja de Documentos', permiso: 'documentos:ver', pill: 'documentos' },
    ]
  },
  {
    seccion: 'Contabilizaciones', items: [
      { key: 'automatizacion', label: 'Automatización del período', permiso: 'propuestas:ver' },
      { key: 'propuestas', label: 'Propuestas y Conciliación', permiso: 'propuestas:ver' },
      { key: 'asientos', label: 'Asientos — Diario, Mayor y Plan', permiso: 'asientos:ver' },
      { key: 'activos', label: 'Activos Fijos y Depreciación', permiso: 'activos:ver' },
      { key: 'memoria', label: 'Memoria de Contabilización', permiso: 'documentos:ver' },
      { key: 'externos', label: 'Receptor Externo (Geo Daniela)', permiso: 'asientos:ver' },
    ]
  },
  {
    seccion: 'Tesorería', items: [
      { key: 'tesoreria', label: 'Bancos, Libro Banco y Conciliación', permiso: 'tesoreria:ver' },
    ]
  },
  {
    seccion: 'Reportes', items: [
      { key: 'balance8', label: 'Balance de 8 Columnas', permiso: 'reportes:ver' },
      { key: 'clasificado', label: 'Balance Clasificado', permiso: 'reportes:ver' },
      { key: 'situacion', label: 'Situación Financiera', permiso: 'reportes:ver' },
      { key: 'resultados', label: 'Estado de Resultados', permiso: 'reportes:ver' },
      { key: 'niif', label: 'NIIF — Estados por Rubros', permiso: 'reportes:ver' },
      { key: 'cclientes', label: 'Cuenta Corriente — Clientes', permiso: 'reportes:ver' },
      { key: 'cproveedores', label: 'Cuenta Corriente — Proveedores', permiso: 'reportes:ver' },
      { key: 'reportes', label: 'Cierre de Período', permiso: 'reportes:ver' },
    ]
  },
]

const TODOS_LOS_ITEMS = MENU.flatMap((m) => m.items)

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
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">Licencia de prueba: quedan <b>${lic.dias_restantes}</b> día(s). Habla con JMV para activar tu plan.</div>`
  } else if (lic.en_gracia) {
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">⚠ ${esc(lic.mensaje || 'Licencia vencida — activa un plan para evitar la suspensión')}</div>`
  } else if (['SUSPENDIDA', 'CANCELADA', 'VENCIDA'].includes(lic.estado)) {
    banner = `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">⛔ ${esc(lic.mensaje || `Licencia ${lic.estado}: puedes consultar, pero no registrar movimientos`)}</div>`
  }

  const seccionVisible = (sec) => sec.items.some((i) => !i.permiso || tiene(i.permiso))
  const itemHTML = (i) => (!i.permiso || tiene(i.permiso)
    ? `<a href="#${i.key}" data-route="${i.key}">${esc(i.label)}<span class="pill" data-pill="${i.pill || i.key}"></span></a>`
    : '')

  $app().innerHTML = `
    <div class="sys">
      <nav class="sys-topnav">
        <div class="sys-logo">
          <img src="/assets/logo-light.svg" alt="JMV">
          <div>Sistema Contable<small>JMV Consultores</small></div>
        </div>
        <div class="sys-menu" id="sys-menu">
          ${MENU.filter(seccionVisible).map((sec) => `
            <div class="nav-item">
              <button class="nav-label" type="button">${esc(sec.seccion)}</button>
              <div class="nav-menu">${sec.items.map(itemHTML).join('')}</div>
            </div>`).join('')}
        </div>
        <div class="sys-user">
          <span class="u-name">${esc(S.user.username)}${S.superAdmin ? ' · super admin' : ''}</span>
          <select id="sys-empresa" class="form-input">
            ${S.empresas.map((e) => `<option value="${e.id}" ${String(e.id) === String(S.empresa.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
          </select>
          <a href="#" id="sys-logout">Salir</a>
        </div>
      </nav>
      <main class="sys-main">
        <div class="sys-titlebar">
          <h1 id="sys-title">Inicio</h1>
          <span class="spacer"></span>
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
  const route = TODOS_LOS_ITEMS.find((n) => n.key === key) || TODOS_LOS_ITEMS[0]

  const activos = new Set([route.key])
  document.querySelectorAll('#sys-menu a').forEach((a) => a.classList.toggle('active', activos.has(a.dataset.route)))

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
