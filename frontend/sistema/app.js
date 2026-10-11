/**
 * SISTEMA CONTABLE JMV — núcleo de la SPA (boot, login, shell, router).
 *
 * IVA Mensual queda OCULTO: actúa solo como la integración que ingesta los
 * documentos del SII (conexión RCV). Este sistema consume las mismas APIs
 * /api/contable/* pero con identidad y navegación propias.
 * Las vistas se registran en window.VIEWS desde views-*.js (fiscal, conta,
 * teso, suscripcion, activos, niif, onboarding, autom y dte).
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
    // BUGFIX QA (CYESISTEMA1): un usuario temporal que ya cambió su clave pero
    // AÚN no tiene empresa debe aterrizar en el onboarding (RUT + clave SII),
    // no en «Sin empresas asignadas» sin salida. Solo aplica a no-admin: los
    // super admin pueden entrar sin empresa propia (trabajan con cualquiera).
    if (!S.empresa && !S.superAdmin) {
      renderOnboardingEmpresa()
      return
    }
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
  localStorage.removeItem('iva_periodo_activo') // cada empresa retoma su período
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
         <button type="submit" class="btn btn-primary" id="lg-btn" style="width:100%">Entrar</button>
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
      const raw = await apiPost('/api/auth/login', {
        username: document.getElementById('lg-user').value.trim(),
        password: document.getElementById('lg-pass').value,
      })
      // ACCESO ADMIN: si el login indica cambio forzado, la UI lo exige ANTES
      // de seguir (el backend igual bloquea empresas y onboarding sin concluirlo).
      if (raw && raw.user && raw.user.debe_cambiar_clave) {
        renderCambioForzado(raw.user.username)
        return
      }
      boot()
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
      btn.disabled = false
      btn.textContent = 'Entrar'
    }
  })
}

/* ---------- ACCESO ADMIN: cambio de clave forzado + onboarding ---------- */

/**
 * Pantalla del usuario nuevo (creado por JMV desde Administración): le exige
 * cambiar la clave provisional antes de seguir, y en seguida pide RUT + clave
 * SII para que la empresa se forme sola (empresas-sii.crearDesdeSii).
 */
function renderCambioForzado(username) {
  $app().innerHTML = `
   <div class="sys-login">
     <div class="login-card">
       <div class="logo"><img src="/assets/logo-light.svg" alt="JMV"><b>Sistema Contable</b></div>
       <h2>Bienvenido, ${esc(username)}</h2>
       <p class="sub">Por seguridad, cambia la clave provisional que te entregó tu contador antes de continuar.</p>
       <div class="login-err" id="cf-err" hidden></div>
       <form id="cf-form">
         <div class="form-group">
           <label class="form-label" for="cf-actual">Clave provisional</label>
           <input type="password" id="cf-actual" class="form-input" autocomplete="current-password" required>
         </div>
         <div class="form-group">
           <label class="form-label" for="cf-nueva">Nueva clave (mínimo 8)</label>
           <input type="password" id="cf-nueva" class="form-input" autocomplete="new-password" required minlength="8">
         </div>
         <div class="form-group">
           <label class="form-label" for="cf-rep">Repetir nueva clave</label>
           <input type="password" id="cf-rep" class="form-input" autocomplete="new-password" required>
         </div>
         <button type="submit" class="btn btn-primary" style="width:100%" id="cf-btn">Cambiar y continuar</button>
       </form>
     </div>
   </div>`
  document.getElementById('cf-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = document.getElementById('cf-err')
    err.hidden = true
    const nueva = document.getElementById('cf-nueva').value
    if (nueva !== document.getElementById('cf-rep').value) {
      err.textContent = 'Las claves no coinciden'
      err.hidden = false
      return
    }
    try {
      await apiPost('/api/auth/password', {
        password_actual: document.getElementById('cf-actual').value,
        password_nueva: nueva,
      })
      // BUGFIX QA: /api/auth/password revoca TODAS las sesiones del usuario
      // (correcto por seguridad), así que la sesión de este login ya no existe:
      // enviar al onboarding acá producía 401 en bucle. Volver al login para
      // re-autenticar con la nueva clave.
      showToast('Clave actualizada. Vuelve a entrar con tu nueva clave.', 'success')
      renderLogin()
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
    }
  })
}

function renderOnboardingEmpresa() {
  $app().innerHTML = `
   <div class="sys-login">
     <div class="login-card">
       <div class="logo"><img src="/assets/logo-light.svg" alt="JMV"><b>Sistema Contable</b></div>
       <h2>Tu empresa</h2>
       <p class="sub">Ingresa el RUT de tu empresa y tu clave tributaria del SII. El sistema valida la credencial contra el SII y arma tu empresa sola: razón social, régimen, plan de cuentas y prueba de 90 días. Este vínculo es único y no puede cambiarse después.</p>
       <div class="login-err" id="ob-err" hidden></div>
       <form id="ob-form">
         <div class="form-group">
           <label class="form-label" for="ob-rut">RUT de la empresa</label>
           <input type="text" id="ob-rut" class="form-input" placeholder="76.312.274-3" required>
         </div>
         <div class="form-group">
           <label class="form-label" for="ob-clave">Clave SII / clave tributaria</label>
           <input type="password" id="ob-clave" class="form-input" autocomplete="off" required>
         </div>
         <button type="submit" class="btn btn-primary" style="width:100%" id="ob-btn">Conectar con el SII y crear mi empresa</button>
       </form>
     </div>
   </div>`
  document.getElementById('ob-form').addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = document.getElementById('ob-err')
    const btn = document.getElementById('ob-btn')
    err.hidden = true
    btn.disabled = true
    btn.textContent = 'Consultando el SII… (puede tomar unos segundos)'
    try {
      const r = await apiPost('/api/auth/onboarding/empresa', {
        rut: document.getElementById('ob-rut').value.trim(),
        clave_sii: document.getElementById('ob-clave').value,
      })
      showToast(`Empresa ${r.empresa.nombre} creada`, 'success')
      boot()
    } catch (ex) {
      err.textContent = ex.message
      err.hidden = false
      btn.disabled = false
      btn.textContent = 'Conectar con el SII y crear mi empresa'
    }
  })
}

/* ---------- búsqueda global (R2, HANDOFF §22) ----------
 * Un input en el header que busca DENTRO de la empresa activa (documentos,
 * asientos, DTEs, personas, cuentas) y deja saltar directo al resultado. Los
 * grupos respetan el RBAC del rol — el backend devuelve solo lo permitido.
 * Mínimo 2 caracteres; debounce 300ms; Enter en un resultado navega. */

let buscarTimer = null

function buscarGlobalHTML() {
  return `
   <div class="gsearch" id="gsearch">
     <input id="gs-input" type="search" placeholder="Buscar en la empresa…  (⌘K / Ctrl+K)" aria-label="Búsqueda global" autocomplete="off">
     <div class="gsearch-drop" id="gs-drop" hidden></div>
   </div>`
}

/* ---------- Notificaciones (R2 §21): las MISMAS fuentes que el dashboard ----------
 * 3 canales reales, sin inventar: documentos sin contabilizar (documentos:ver),
 * conciliación pendiente (conciliacion:ver) y DTE rechazados (dte:ver).
 * Sin permiso → el canal no existe. Sin novedad → panel "Al día".
 */

async function cargarNotificaciones() {
  const eid = S.empresa.id
  const items = []
  const tareas = []

  if (tiene('documentos:ver')) {
    tareas.push(apiGet(`/api/contable/empresas/${eid}/documentos?estado=PENDIENTE&limit=1`).then((r) => {
      if (r.total > 0) items.push({ nivel: 'warn', hash: '#documentos', texto: `${r.total} documento(s) sin contabilizar — pena la conciliación y el cierre`, etiqueta: 'Bandeja' })
    }).catch(() => {}))
  }
  if (tiene('conciliacion:ver')) {
    const periodo = periodoGlobal()
    tareas.push(apiGet(`/api/contable/empresas/${eid}/conciliacion/${periodo}`).then((r) => {
      const difs = (r.conciliacion && r.conciliacion.diferencias) || []
      if (difs.length) items.push({ nivel: 'error', hash: '#propuestas', texto: `Conciliación ${periodo}: ${difs.length} diferencia(s) libro vs cartola`, etiqueta: 'Revisar' })
    }).catch(() => {})) // 404 = conciliación aún sin ejecutar en el período (no es error)
  }
  if (tiene('dte:ver')) {
    // BUGFIX QA: el header consultaba /api/dte/empresas/:id que NO EXISTE
    // (el listado real es /dtes) — 404 en consola en cada carga del shell.
    tareas.push(apiGet(`/api/dte/empresas/${eid}/dtes?limit=50`).then((r) => {
      const rechazados = (r.dtes || []).filter((d) => d.estado === 'RECHAZADO')
      if (rechazados.length) items.push({ nivel: 'error', hash: '#dte', texto: `${rechazados.length} DTE(s) RECHAZADO(s) por el SII — requiere corrección y reenvío`, etiqueta: 'DTEs' })
    }).catch(() => {}))
  }

  await Promise.all(tareas)
  return items
}

function notificacionesHTML() {
  return `
   <div class="campana" id="campana">
     <button class="campana-btn" id="campana-btn" aria-label="Notificaciones" title="Notificaciones">
       <span class="campana-icon"></span>
       <span class="campana-dot" id="campana-dot" hidden></span>
     </button>
     <div class="campana-drop" id="campana-drop" hidden></div>
   </div>`
}

function conectarNotificaciones() {
  const btn = document.getElementById('campana-btn')
  const drop = document.getElementById('campana-drop')
  const dot = document.getElementById('campana-dot')
  if (!btn || !drop || !dot) return

  let items = []
  const pintar = () => {
    drop.innerHTML = items.length
      ? `<div class="gs-head">Pendientes de la empresa</div>` + items.map((i) => `
          <a class="gs-item" href="${i.hash}">
            <span class="campana-nv ${i.nivel}"></span>
            <span class="gs-item-tx"><b>${esc(i.texto)}</b></span>
            <span class="gs-ir">${esc(i.etiqueta)} →</span>
          </a>`).join('')
      : '<div class="gs-vacio">Al día — sin pendientes de contabilización, conciliación ni DTEs.</div>'
    dot.hidden = items.length === 0
  }

  cargarNotificaciones().then((r) => { items = r; pintar() }).catch(() => {})

  btn.addEventListener('click', () => { drop.hidden = !drop.hidden })
  drop.addEventListener('click', (e) => {
    if (e.target.closest('a.gs-item')) drop.hidden = true
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#campana')) drop.hidden = true
  })
}

function conectarBusquedaGlobal() {
  const input = document.getElementById('gs-input')
  const drop = document.getElementById('gs-drop')
  if (!input || !drop) return

  const cerrar = () => { drop.hidden = true }
  input.addEventListener('blur', () => setTimeout(cerrar, 180))

  input.addEventListener('input', () => {
    clearTimeout(buscarTimer)
    const q = input.value.trim()
    if (q.length < 2) { cerrar(); return }
    buscarTimer = setTimeout(async () => {
      try {
        const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/buscador?q=${encodeURIComponent(q)}`)
        pintarResultados(drop, q, r.grupos || [])
      } catch { cerrar() }
    }, 300)
  })

  drop.addEventListener('mousedown', (e) => {
    const a = e.target.closest('a.gs-item')
    if (!a) return
    e.preventDefault() // evita que el blur cierre el dropdown antes de navegar
  })
  drop.addEventListener('click', (e) => {
    const a = e.target.closest('a.gs-item')
    if (!a) return
    cerrar()
    input.value = ''
  })

  // Atajo de teclado: Ctrl+K / ⌘K enfoca la búsqueda.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      input.focus()
    }
    if (e.key === 'Escape') cerrar()
  })
}

function pintarResultados(drop, q, grupos) {
  if (!grupos.length) {
    drop.innerHTML = '<div class="gs-vacio">Sin resultados para “' + esc(q) + '”.</div>'
    drop.hidden = false
    return
  }
  const total = grupos.reduce((s, g) => s + g.filas.length, 0)
  const gruposHTML = grupos.map((g) => `
    <div class="gs-grupo">
      <div class="gs-grupo-t">${esc(g.grupo)}</div>
      ${g.filas.map((f) => `
        <a class="gs-item" href="${esc(f.hash)}">
          <span class="gs-item-tx"><b>${esc(f.titulo)}</b><small>${esc(f.sub || '')}</small></span>
          <span class="gs-ir">ir →</span>
        </a>`).join('')}
    </div>`).join('')
  drop.innerHTML = `<div class="gs-head">${total} resultado(s) por “${esc(q)}”</div>${gruposHTML}`
  drop.hidden = false
}

/* ---------- shell ---------- */

/*
 * MENÚ SUPERIOR HORIZONTAL — secciones con desplegable. Sin iconos: la
 * jerarquía la da la tipografía. Cada sección se despliega al posarse encima.
 */
/*
 * MENU — organizado según el flujo real del trabajo contable (HANDOFF §2-§20):
 * EMPRESA → PERÍODO → OPERACIÓN → SII/TRIBUTACIÓN → FACTURACIÓN →
 * CONTABILIDAD → TESORERÍA → CENTRALIZACIONES → ACTIVOS → REPORTES →
 * CIERRE → AUDITORÍA.
 *
 * Regla de compatibilidad (HANDOFF §36): TODOS los anchors históricos se
 * conservan; los que cambiaron de grupo siguen funcionando tal cual.
 * #reportes era "Reportes y Cierre" y ahora es el Centro de Reportes; el
 * cierre de período y el balance de comprobación tienen vistas propias
 * (#cierre, #comprobacion), enlazadas desde el Centro.
 */
const MENU = [
  {
    seccion: 'Inicio', items: [
      { key: 'inicio', label: 'Panel del período', permiso: null },
      { key: 'alertas', label: 'Alertas — Reclamadas y Pendientes', permiso: 'documentos:ver', pill: 'alertas' },
    ]
  },
  {
    seccion: 'Empresas y clientes', items: [
      { key: 'cclientes', label: 'Clientes — Cuenta Corriente', permiso: 'reportes:ver' },
      { key: 'cproveedores', label: 'Proveedores — Cuenta Corriente', permiso: 'reportes:ver' },
      { key: 'cobranza', label: 'Cobranza y Mora', permiso: 'tesoreria:ver' },
      { key: 'crm', label: 'Pipeline y Salud', permiso: 'empresas:ver' },
      { key: 'documentos', label: 'Bandeja de Documentos', permiso: 'documentos:ver', pill: 'documentos' },
    ]
  },
  {
    seccion: 'Operación SII', items: [
      { key: 'libros', label: 'Libros de Compras y Ventas', permiso: 'documentos:ver' },
      { key: 'onboarding', label: 'Onboarding y Extracción', permiso: 'documentos:ver' },
      { key: 'analitica', label: 'Dashboard Tributario (IVA)', permiso: 'reportes:ver' },
    ]
  },
  {
    seccion: 'Facturación', items: [
      { key: 'dte-emision', label: 'Emitir Factura o Nota', permiso: 'dte:emitir' },
      { key: 'dte', label: 'Bandeja de DTEs Emitidos', permiso: 'dte:ver' },
      { key: 'dte-config', label: 'Configuración del Emisor', permiso: 'dte:ver' },
    ]
  },
  {
    seccion: 'Contabilidad', items: [
      { key: 'automatizacion', label: 'Contabilización y Pendientes', permiso: 'propuestas:ver' },
      { key: 'propuestas', label: 'Propuestas y Conciliación', permiso: 'propuestas:ver' },
      { key: 'asientos', label: 'Asientos — Diario, Mayor y Plan', permiso: 'asientos:ver' },
      { key: 'memoria', label: 'Memoria de Contabilización', permiso: 'documentos:ver' },
      { key: 'externos', label: 'Receptor Externo (Geo Daniela)', permiso: 'asientos:ver' },
      { key: 'activos', label: 'Activos Fijos y Depreciación', permiso: 'activos:ver' },
    ]
  },
  {
    seccion: 'Tesorería', items: [
      { key: 'tesoreria', label: 'Bancos, Libro Banco y Conciliación', permiso: 'tesoreria:ver' },
    ]
  },
  {
    seccion: 'Reportes', items: [
      { key: 'reportes', label: 'Centro de Reportes', permiso: 'reportes:ver' },
      { key: 'comprobacion', label: 'Balance de Comprobación', permiso: 'reportes:ver' },
      { key: 'balance8', label: 'Balance de 8 Columnas', permiso: 'reportes:ver' },
      { key: 'clasificado', label: 'Balance Clasificado', permiso: 'reportes:ver' },
      { key: 'situacion', label: 'Situación Financiera', permiso: 'reportes:ver' },
      { key: 'resultados', label: 'Estado de Resultados', permiso: 'reportes:ver' },
      { key: 'niif', label: 'NIIF — Estados por Rubros', permiso: 'reportes:ver' },
    ]
  },
  {
    seccion: 'Herramientas', items: [
      { key: 'calculadora-iva', label: 'Calculadora de IVA', permiso: null },
    ]
  },
  {
    seccion: 'Configuración', items: [
      { key: 'admin', label: 'Administración', permiso: 'periodos:ver' },
      { key: 'cierre', label: 'Cierre de Período', permiso: 'reportes:ver' },
      { key: 'auditoria', label: 'Auditoría', permiso: 'auditoria:ver' },
      { key: 'integraciones', label: 'Integraciones', permiso: 'empresas:ver' },
      { key: 'suscripcion', label: 'Suscripción y Pagos', permiso: 'empresas:ver' },
    ]
  },
]

/* Compatibilidad de anchors (HANDOFF §36): hash histórico → ruta actual.
 * #reportes sigue existiendo (ahora es el Centro de Reportes) y el balance de
 * comprobación que vivía en sus pestañas tiene vista propia (#comprobacion).
 * Los alias ANTIGUO→NUEVO se registran en REDIRECCIONES_ANCHOR; hoy está
 * vacío porque ningún anchor histórico cambió de vista. */
const REDIRECCIONES_ANCHOR = {}

function resolverRouteKey(key) {
  return REDIRECCIONES_ANCHOR[key] || key
}

const TODOS_LOS_ITEMS = MENU.flatMap((m) => m.items)

function renderShell() {
  if (!S.empresa) {
    // BUGFIX QA (CYESISTEMA1): el no-admin SIN empresa aterriza en onboarding
    // vía boot(); este ramo queda como salvavidas si algo llega acá sin pasar
    // por boot (nada lo hace hoy, pero no debe ser un callejón sin texto).
    $app().innerHTML = `<div class="sys-login"><div class="login-card" style="max-width:460px">
     <h2>Completa el ingreso de tu empresa</h2>
     <p class="sub">Tu usuario (${esc(S.user.username)}) aún no tiene una empresa vinculada. Vuelve a entrar para completar el onboarding, o contacta a JMV Consultores.</p>
     <button class="btn btn-secondary" onclick="fetch('/api/auth/logout',{method:'POST'}).then(()=>boot())">Volver a entrar</button>
   </div></div>`
    return
  }

  const lic = S.licencia || {}
  let banner = ''
  if (lic.estado === 'PRUEBA' && lic.dias_restantes <= 14) {
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">Licencia de prueba: quedan <b>${lic.dias_restantes}</b> día(s). Habla con JMV para activar tu plan.</div>`
  } else if (lic.en_gracia) {
    banner = `<div class="banner-lic" style="background:var(--warning-soft);color:var(--warning)">${esc(lic.mensaje || 'Licencia vencida — activa un plan para evitar la suspensión')}</div>`
  } else if (['SUSPENDIDA', 'CANCELADA', 'VENCIDA'].includes(lic.estado)) {
    banner = `<div class="banner-lic" style="background:var(--danger-soft);color:var(--danger)">${esc(lic.mensaje || `Licencia ${lic.estado}: puedes consultar, pero no registrar movimientos`)}</div>`
  }

  const seccionVisible = (sec) => sec.items.some((i) => !i.permiso || tiene(i.permiso))
  const itemHTML = (i) => (!i.permiso || tiene(i.permiso)
    ? `<a href="#${i.key}" data-route="${i.key}">${esc(i.label)}<span class="pill" data-pill="${i.pill || i.key}"></span></a>`
    : '')

  $app().innerHTML = `
   <div class="sys">
     <aside class="sys-side">
       <div class="sys-logo">
         <img src="/assets/logo-light.svg" alt="JMV">
         <div>Sistema Contable<small>JMV Consultores</small></div>
       </div>
       <select id="sys-empresa" class="form-input" aria-label="Empresa activa">
          ${S.empresas.map((e) => `<option value="${e.id}" ${String(e.id) === String(S.empresa.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
       </select>
       <nav class="sys-nav" id="sys-nav">
         <div class="nav-search" style="margin-bottom:var(--space-2)">
           <input id="nav-buscar" type="search" placeholder="Buscar sección…" aria-label="Buscar sección del menú">
         </div>
          ${MENU.filter(seccionVisible).map((sec) => `
           <div class="nav-seccion">${esc(sec.seccion)}</div>
            ${sec.items.map(itemHTML).join('')}`).join('')}
       </nav>
       <div class="sys-side-foot">
         <div class="u-name">${esc(S.user.username)}${S.superAdmin ? ' · super admin' : ''}</div>
         <a href="#" id="sys-logout">Salir</a>
       </div>
     </aside>
     <main class="sys-main">
       <div class="sys-header">
         <nav class="sys-breadcrumb" id="sys-breadcrumb" aria-label="Ruta"></nav>
         <span class="spacer"></span>
         ${buscarGlobalHTML()}
         ${notificacionesHTML()}
         ${window.Tema ? window.Tema.botonHTML() : ''}
       </div>
       <div class="sys-titlebar">
         <h1 id="sys-title">Inicio</h1>
         <span class="spacer"></span>
         <div class="frm-row" style="gap:var(--space-2);align-items:center">
           <span class="sub" id="sys-periodo-estado"></span>
           <select id="sys-periodo" class="form-input" style="width:auto;height:30px;font-size:var(--fs-xs)" aria-label="Período activo"></select>
         </div>
       </div>
       <div id="sys-banner">${banner}</div>
       <div id="sys-view"></div>
     </main>
   </div>`

  if (window.Tema) window.Tema.conectar()
  conectarBuscadorMenu()
  conectarBusquedaGlobal()
  conectarNotificaciones()
  conectarSelectorPeriodo()
  document.getElementById('sys-empresa').addEventListener('change', (e) => setEmpresa(e.target.value))
  document.getElementById('sys-logout').addEventListener('click', async (e) => {
    e.preventDefault()
    try { await apiPost('/api/auth/logout', {}) } catch { /* sesión ya inexistente */ }
    localStorage.removeItem('iva_empresa_activa')
    renderLogin()
  })
}

/* ---------- selector global de período (header) ---------- */

/** Período activo global: lo fija Inicio o el selector; las vistas lo leen. */
function periodoGlobal() {
  if (window._inicioPeriodo) return window._inicioPeriodo
  let p = localStorage.getItem('iva_periodo_activo')
  if (!p) {
    p = periodoActual()
    localStorage.setItem('iva_periodo_activo', p)
  }
  return p
}

async function conectarSelectorPeriodo() {
  const sel = document.getElementById('sys-periodo')
  if (!sel) return
  const est = document.getElementById('sys-periodo-estado')
  // Períodos registrados de la empresa (para el estado ABIERTO/CERRADO).
  let periodos = []
  try { periodos = (await apiGet(`/api/contable/empresas/${S.empresa.id}/periodos`)).periodos || [] }
  catch { /* sin permiso periodos:ver: el selector queda funcional igual */ }
  // Opciones: últimos 24 meses + los períodos registrados (p.ej. cerrados).
  const opciones = [...new Set([
    ...ultimosPeriodos(24).map(String),
    ...periodos.map((p) => String(p.periodo)),
  ])].sort()
  sel.innerHTML = opciones.map((p) => `<option value="${p}">${esc(perDisplay(p))}</option>`).join('')
  sel.value = periodoGlobal()
  // El estado del período (ABIERTO/CERRADO) al lado del selector.
  const pintarEstado = (p) => {
    if (!est) return
    const row = periodos.find((x) => String(x.periodo) === String(p))
    est.innerHTML = row ? `<span class="chip ${row.estado === 'ABIERTO' ? 'clasificado' : 'neutral'}" title="Estado del período activo">${esc(row.estado)}</span>` : ''
  }
  pintarEstado(periodoGlobal())
  sel.addEventListener('change', () => {
    const p = sel.value || periodoActual()
    localStorage.setItem('iva_periodo_activo', p)
    pintarEstado(p)
    window._inicioPeriodo = p // Inicio y las vistas con período propio lo siguen
    window._repPeriodo = p; window._balance8Periodo = p; window._clasificadoPeriodo = p
    window._situacionPeriodo = p; window._resultadosPeriodo = p; window._niifPeriodo = p
    window._niifResPeriodo = p; window._asPeriodo = p; window._tesoPeriodo = p
    renderRoute()
  })
}

/* ---------- breadcrumb ---------- */

function breadcrumbHTML(route) {
  const sec = MENU.find((m) => m.items.some((i) => i.key === route.key))
  if (!sec) return `<span class="bc-actual">${esc(route.label)}</span>`
  return `<a href="#inicio">Inicio</a><span class="bc-sep">/</span><span>${esc(sec.seccion)}</span><span class="bc-sep">/</span><span class="bc-actual">${esc(route.label)}</span>`
}

/* ---------- buscador del menú ---------- */

function conectarBuscadorMenu() {
  const inp = document.getElementById('nav-buscar')
  if (!inp) return
  inp.addEventListener('input', () => {
    const q = inp.value.trim().toLowerCase()
    document.querySelectorAll('#sys-nav a').forEach((a) => {
      a.classList.toggle('oculto', q && !a.textContent.toLowerCase().includes(q))
    })
    document.querySelectorAll('#sys-nav .nav-seccion').forEach((sec) => {
      const el = sec.nextElementSibling
      let hayVisible = false
      let nodo = el
      while (nodo && !nodo.classList.contains('nav-seccion')) {
        if (nodo.tagName === 'A' && !nodo.classList.contains('oculto')) { hayVisible = true; break }
        nodo = nodo.nextElementSibling
      }
      sec.classList.toggle('oculta', q && !hayVisible)
    })
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
  // La query de la vista (p. ej. #dte?tipo=33) es estado de la ruta, no parte
  // de la clave: sin este split, un filtro te expulsa a la vista Inicio.
  const key0 = (location.hash || '#inicio').slice(1).split('?')[0]
  const key = resolverRouteKey(key0)
  const view = VIEWS[key] || VIEWS.inicio
  const route = TODOS_LOS_ITEMS.find((n) => n.key === key) || TODOS_LOS_ITEMS[0]

  const activos = new Set([route.key])
  document.querySelectorAll('#sys-nav a').forEach((a) => a.classList.toggle('active', activos.has(a.dataset.route)))

  document.getElementById('sys-title').textContent = view.titulo || route.label
  const bc = document.getElementById('sys-breadcrumb')
  if (bc) bc.innerHTML = breadcrumbHTML(route)

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
