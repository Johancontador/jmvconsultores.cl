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
    CONTABILIZADO: 'contabilizado', REVISION: 'revision', REVISIÓN: 'revision', ERROR: 'error', ANULADO: 'anulado',
  }
  return `<span class="chip ${map[estado] || 'neutral'}">${esc(estado)}</span>`
}

// Listener de Esc del diálogo abierto. Vive fuera de `openModal` para que
// `cerrarModal()` lo retire también cuando el cierre viene de un botón o de
// una acción completada (si no, quedaría un keydown colgado por cada modal).
let modalEscapeHandler = null

function openModal(html) {
  cerrarModal()
  const back = document.createElement('div')
  back.className = 'modal-back'
  back.id = 'modal-back'
  back.innerHTML = `<div class="modal-card">${html}</div>`
  back.addEventListener('click', (e) => { if (e.target === back) cerrarModal() })
  document.body.appendChild(back)
  // Esc = cancelar en TODOS los diálogos (mismo componente para las vistas) y
  // el foco vuelve al disparador: antes la única salida era el ratón.
  const disparador = document.activeElement
  modalEscapeHandler = (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    cerrarModal()
    disparador?.focus?.()
  }
  document.addEventListener('keydown', modalEscapeHandler)
  const primero = back.querySelector?.('button, input, select, textarea')
  primero?.focus?.()
}

function cerrarModal() {
  const m = document.getElementById('modal-back')
  if (m) m.remove()
  if (modalEscapeHandler) {
    document.removeEventListener('keydown', modalEscapeHandler)
    modalEscapeHandler = null
  }
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

/**
 * Aterrizaje post-login (Centro de Aplicaciones): TODO usuario —interno o
 * cliente— aterriza en la página principal de módulos con recuadros grandes
 * (icono + descripción + ingreso). El dueño de empresa cliente ve su Portal
 * como tarjeta destacada del Centro (sigue accesible directo por #portal-inicio).
 */
function hashInicial() {
  return '#centro'
}

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
    // Un super admin sin empresas activas ve la tarjeta de aviso del shell: no
    // hay vista que montar y seguir a renderRoute dejaba un pageerror
    // («Cannot set properties of null (setting 'textContent')» porque el
    // #sys-title del shell no existe en ese ramo).
    if (!S.empresa) return
    // El aterrizaje por rol SIEMPRE aplica en boot(): el navegador puede
    // restaurar el hash de la sesión anterior (reabrir pestaña/historial) y
    // eso no debe mandar al dueño al sistema operativo en vez de su Portal.
    // Centro de Aplicaciones para TODOS: si el navegador restauró un hash de
    // la sesión anterior (pestaña abierta/historial) se respeta; si no, el
    // destino es la página principal de módulos. Rutas no autorizadas ya las
    // bloquea el router + el backend en cada fetch.
    navigate(location.hash || hashInicial())
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
  window._inicioPeriodo = null
  renderShell()
  // El período es POR EMPRESA y la URL lo lleva: si se dejara el de la
  // empresa anterior en el hash, `aplicarContextoURL` lo volvería a imponer
  // al entrar a la vista. Se reemplaza la empresa y se descarta el período.
  const { key, query } = hashPartes()
  query.set('empresa', String(id))
  query.delete('periodo')
  const qs = query.toString()
  navigate(`#${key}${qs ? `?${qs}` : ''}`)
}

/* ---------- login embebido (mismo template que la landing) ---------- */

/**
 * Marca JMV según el TEMA. `logo-ink.svg` está dibujado para fondos claros y
 * `logo-light.svg` (wordmark blanco) para fondos oscuros. El sidebar y el login
 * embebido usaban SIEMPRE la variante clara sobre fondo claro: en el tema por
 * defecto el wordmark quedaba blanco sobre blanco y solo se veían los puntos.
 * Se emiten las dos y el CSS muestra la que corresponde a `data-theme`.
 */
function logoMarcaHTML() {
  return '<img class="logo-para-claro" src="/assets/logo-ink.svg" alt="JMV">'
    + '<img class="logo-para-oscuro" src="/assets/logo-light.svg" alt="">'
}

function renderLogin(mensaje = '') {
  // MISMA FAMILIA VISUAL que la landing y /login.html (shell unificado):
  // logo JMV + «Ingresar» + retorno claro a la página principal. La lógica
  // del SPA (cambio forzado, onboarding) es propia del sistema privado.
  $app().innerHTML = `
   <div class="sys-login">
     <div class="login-card">
       <div class="logo">${logoMarcaHTML()}<b>Sistema Contable</b></div>
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
       <p class="sub" style="margin-top:var(--space-4);text-align:center;font-size:var(--fs-xs)">
         <a href="/" style="color:var(--accent);font-weight:var(--fw-medium)">&larr; Página principal</a>
         · <a href="https://jmvconsultores.cl/#contacto" target="_blank" rel="noopener" style="color:var(--fg-secondary)">Contacta a tu contador</a>
       </p>
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
       <div class="logo">${logoMarcaHTML()}<b>Sistema Contable</b></div>
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
       <div class="logo">${logoMarcaHTML()}<b>Sistema Contable</b></div>
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
    // Listado filtrado por período: responde 200 aun sin conciliación (el
    // detalle /conciliacion/:periodo devolvía 404 en cada carga y la campana lo
    // tragaba). Además `diferencias` es un CONTEO, no un arreglo: con
    // `difs.length` la alerta no se mostraba nunca aunque hubiera diferencias.
    tareas.push(apiGet(`/api/contable/empresas/${eid}/conciliaciones?periodo=${periodo}`).then((r) => {
      const c = (r.conciliaciones || [])[0]
      const difs = Number(c && c.diferencias) || 0
      if (difs > 0) items.push({ nivel: 'error', hash: '#propuestas', texto: `Conciliación ${periodo}: ${difs} diferencia(s) libro vs cartola`, etiqueta: 'Revisar' })
    }).catch(() => {}))
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

/**
 * Menú visible por ROL, en el orden del trabajo de ese rol: el flujo contable
 * interno sigue el orden del MENU; para el dueño de UNA empresa cliente su
 * PORTAL es la superficie principal y va primero, después Inicio y el resto.
 * Solo afecta el orden de PRESENTACIÓN — los keys/rutas quedan intactos.
 */
/**
 * Orden de trabajo del menú (2026.3): lo que se hace a diario arriba.
 * El catálogo MENU define el contenido; este mapa define el recorrido:
 * documentos → facturación → contabilidad → tesorería → informes. El dueño
 * (admin_empresa) sigue entrando por su Portal y el panel.
 */
const ORDEN_FLUJO = {
  Inicio: 0,
  Documentos: 1,
  Contabilidad: 2,
  'Impuestos y Salud': 3,
  Tesorería: 4,
  Informes: 5,
  'Portal de cliente': 6,
  Administración: 7,
}

function menuVisible() {
  const visible = MENU.filter((sec) => sec.items.some((i) => !i.permiso || tiene(i.permiso)))
  const dueno = !S.superAdmin && S.empresa?.rol === 'admin_empresa'
  const prioridad = (seccion) => {
    if (dueno) {
      // El dueño no opera la contabilidad: su portal y su panel van primero.
      if (seccion === 'Portal de cliente') return -2
      if (seccion === 'Inicio') return -1
    }
    return ORDEN_FLUJO[seccion] ?? 99
  }
  return visible.slice().sort((a, b) => prioridad(a.seccion) - prioridad(b.seccion))
}

/*
 * MENU — organizado según el flujo real del trabajo contable (HANDOFF §2-§20),
 * de mayor a menor frecuencia de uso:
 * BANDEJA/LIBROS (diario) → TRIBUTACIÓN → FACTURACIÓN → CONTABILIDAD →
 * TESORERÍA → CLIENTES/PROVEEDORES → REPORTES + CIERRE → PORTAL (cliente) →
 * CONFIGURACIÓN. La calculadora de IVA vive en Operación SII (es IVA, es SII).
 *
 * Regla de compatibilidad (HANDOFF §36): TODOS los anchors históricos se
 * conservan; los que cambiaron de grupo siguen funcionando tal cual.
 * #reportes era "Reportes y Cierre" y ahora es el Centro de Reportes; el
 * cierre de período y el balance de comprobación tienen vistas propias
 * (#cierre, #comprobacion), enlazadas desde el Centro.
 */
const MENU = [
  {
    // Orden del inicio (2026-10-21): primero el trabajo del día, después el
    // diagnóstico ejecutivo, después lo que requiere atención y por último
    // el lanzador de todos los módulos. Antes arrancaba por el Centro, que
    // es una pantalla de navegación: se quedaba el «día a día» escondido.
    seccion: 'Inicio', items: [
      { key: 'inicio', label: 'Hoy — Panel del período', permiso: null },
      { key: 'alertas', label: 'Alertas — Reclamadas y Pendientes', permiso: 'documentos:ver', pill: 'alertas' },
      // El catálogo completo, ahora como «Todos los módulos» (anchor histórico).
      { key: 'centro', label: 'Todos los módulos', permiso: null },
    ]
  },
  {
    // ÁREA 2 — DOCUMENTOS: lo que entra y lo que se emite. La bandeja y los
    // libros son el trabajo diario del RCV; los DTE son la salida.
    seccion: 'Documentos', items: [
      { key: 'documentos', label: 'Bandeja de Documentos', permiso: 'documentos:ver', pill: 'documentos' },
      { key: 'libros', label: 'Libros de Compras y Ventas', permiso: 'documentos:ver' },
      { key: 'onboarding', label: 'Ficha tributaria e historial RCV', permiso: 'documentos:ver' },
      { key: 'dte-emision', label: 'Emitir Factura o Nota', permiso: 'dte:emitir' },
      { key: 'dte', label: 'Bandeja de DTEs Emitidos', permiso: 'dte:ver' },
      { key: 'dte-config', label: 'Configuración del Emisor', permiso: 'dte:ver' },
    ]
  },
  {
    // ÁREA 3 — CONTABILIDAD: cómo queda registrado lo que entró. El cierre es
    // un proceso contable, no un reporte: se quedó con su sección.
    seccion: 'Contabilidad', items: [
      { key: 'automatizacion', label: 'Estado de contabilización', permiso: 'propuestas:ver' },
      { key: 'propuestas', label: 'Revisar y contabilizar documentos', permiso: 'propuestas:ver' },
      { key: 'asientos', label: 'Asientos — Diario, Mayor y Plan', permiso: 'asientos:ver' },
      { key: 'memoria', label: 'Cuentas habituales por cliente y proveedor', permiso: 'documentos:ver' },
      { key: 'activos', label: 'Activos Fijos y Depreciación', permiso: 'activos:ver' },
      { key: 'cierre', label: 'Cierre de Período', permiso: 'reportes:ver' },
    ]
  },
  {
    // ÁREA 4 — IMPUESTOS Y SALUD: la situación tributaria. Salud Tributaria
    // conserva su identidad y su pill de score; a su lado viven el IVA, la
    // calculadora y el F29 del mes del despacho.
    seccion: 'Impuestos y Salud', items: [
      // Antecedentes + opinión: ficha SII, régimen, ingresos, cobertura RCV,
      // índice de salud, riesgos y plan de acción. Lo no integrado (F22,
      // juradas) se declara. `pill: 'salud'` pinta el score en el menú (y
      // «!» cuando requiere revisión).
      { key: 'salud', label: 'Salud Tributaria — Diagnóstico Ejecutivo', permiso: 'salud:ver', pill: 'salud' },
      // Planificación (T0-B): dónde estamos (salud) a un compuás de a dónde vamos:
      // ficha declarada explícitamente, historial append-only. Sin ficha no hay
      // cálculo — la ausencia de declaración es un estado visible, no un default.
      { key: 'planificacion', label: 'Planificación Tributaria — Ficha', permiso: 'planificacion:ver' },
      { key: 'analitica', label: 'Resumen anual de IVA, compras y ventas', permiso: 'reportes:ver' },
      { key: 'calculadora-iva', label: 'Calculadora de IVA', permiso: null },
      { key: 'proceso-masivo', label: 'Calcular F29 para todos los clientes', permiso: 'crm:ver' },
    ]
  },
  {
    // ÁREA 5 — TESORERÍA: el dinero que entra y sale. Banco, cobranza y la
    // cartola externa (Geo Daniela) comparten la misma pregunta.
    seccion: 'Tesorería', items: [
      { key: 'tesoreria', label: 'Bancos y conciliación bancaria', permiso: 'tesoreria:ver' },
      { key: 'cobranza', label: 'Cobranza y Mora', permiso: 'tesoreria:ver' },
      { key: 'externos', label: 'Asientos recibidos de otros sistemas', permiso: 'asientos:ver' },
    ]
  },
  {
    // UN SOLO MODELO (auditoría §5): el Centro de Reportes es el catálogo y
    // la puerta de entrada a los 14 reportes; el menú NO repite cada uno. Los
    // anchors (#situacion, #balance8, #niif…) siguen vivos y el Centro los
    // abre preseleccionando el período. El cierre no es un reporte: es un
    // proceso, por eso conserva su entrada propia.
    // ÁREA 6 — INFORMES: qué se entrega. El Centro de Reportes es el catálogo
    // único; las cuentas corrientes y las herramientas multi-empresa del
    // despacho viven aquí porque producen un documento.
    seccion: 'Informes', items: [
      { key: 'reportes', label: 'Centro de Reportes', permiso: 'reportes:ver' },
      { key: 'cclientes', label: 'Clientes — Cuenta Corriente', permiso: 'reportes:ver' },
      { key: 'cproveedores', label: 'Proveedores — Cuenta Corriente', permiso: 'reportes:ver' },
      { key: 'informe-rango', label: 'Análisis de compras y ventas por período', permiso: 'crm:ver' },
      { key: 'exportacion-masiva', label: 'Descargar informes de todos los clientes (ZIP)', permiso: 'crm:ver' },
    ]
  },
  {
    // PORTAL DE INTELIGENCIA COMERCIAL — capa read-only por empresa. Los datos
    // SIEMPRE se resuelven server-side contra /api/portal (aislamiento §8) —
    // esta sección solo consume, jamás clasifica ni contabiliza.
    seccion: 'Portal de cliente', items: [
      { key: 'portal-inicio', label: 'Dashboard interactivo', permiso: null },
      { key: 'portal-ventas', label: 'Ventas y movimientos', permiso: null },
      { key: 'portal-cartera', label: 'Cartera de clientes', permiso: null },
      { key: 'portal-productos', label: 'Productos vendidos', permiso: null },
      { key: 'portal-credito', label: 'Crédito autorizado', permiso: null },
      { key: 'portal-costos', label: 'Hoja de costos', permiso: null },
      { key: 'portal-comercial', label: 'Mi seguimiento comercial', permiso: null },
      { key: 'portal-cotizaciones', label: 'Cotizaciones y embudo', permiso: null },
      { key: 'portal-cobranza', label: 'Cobranza (solo lectura)', permiso: null },
      { key: 'portal-reportes', label: 'Reportes guardados', permiso: null },
    ]
  },
  {
    seccion: 'Administración', items: [
      { key: 'admin', label: 'Administración', permiso: 'periodos:ver' },
      { key: 'auditoria', label: 'Auditoría', permiso: 'auditoria:ver' },
      { key: 'integraciones', label: 'Integraciones', permiso: 'empresas:ver' },
      { key: 'suscripcion', label: 'Suscripción y Pagos', permiso: 'empresas:ver' },
      // Herramientas del DESPACHO sobre la cartera: ni el dueño de una empresa
      // ni un rol operativo las necesitan. `crm:ver` solo lo tienen contador y
      // super admin (mismo gate que guardCrm en su API).
      { key: 'crm', label: 'CRM Comercial', permiso: 'crm:ver' },
      { key: 'portafolio', label: 'Clientes del portafolio', permiso: 'crm:ver' },
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

/* Vistas con anchor propio que NO tienen entrada en el menú: son los reportes
 * que se abren desde el Centro de Reportes (#reportes) y que el usuario puede
 * alcanzar por URL directa o por enlace interno.
 *
 * Antes el router resolvía la ruta SOLO contra TODOS_LOS_ITEMS y caía a
 * `TODOS_LOS_ITEMS[0]` (Inicio) cuando la vista no estaba en el menú: el
 * título decía «Panel del período», el breadcrumb apuntaba a otra sección y
 * `route.permiso` era null, así que el gate de UI no se aplicaba (el backend
 * sí devolvía 403/401, pero la pantalla quedaba sin identidad ni bloqueo).
 * Cada entrada declara su capacidad REAL (la misma que exige su endpoint, ver
 * backend/routes/reportes.js y routes/niif.js: `reportes:ver`) para que el
 * router marque la ruta activa, el breadcrumb y el gate de UI con su identidad
 * verdadera. La autoridad de acceso sigue siendo el backend: esto es UX.
 */
const RUTAS_FUERA_DE_MENU = {
  balance8: { key: 'balance8', label: 'Balance de 8 Columnas', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
  clasificado: { key: 'clasificado', label: 'Balance Clasificado', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
  comprobacion: { key: 'comprobacion', label: 'Balance de Comprobación', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
  situacion: { key: 'situacion', label: 'Situación Financiera', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
  resultados: { key: 'resultados', label: 'Estado de Resultados', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
  niif: { key: 'niif', label: 'NIIF — Estados por Rubros', permiso: 'reportes:ver', seccion: 'Informes', origen: 'reportes' },
}

/* ---------- secciones plegables del menú ----------
 * El menú mide 44 ítems en 9 secciones: desplegado ocupa 2576 px de alto en
 * un teléfono (medido a 390 px), así que la mitad de las secciones quedaba a
 * dos pantallas de scroll. Cada sección se pliega y el estado se recuerda por
 * usuario; la sección de la ruta activa se abre siempre.
 */
let navCerradas = new Set()

function claveNavCerradas() {
  return `jmv.nav.cerradas.${S.user?.id || 'anon'}`
}

function leerNavCerradas() {
  try {
    const raw = JSON.parse(localStorage.getItem(claveNavCerradas()) || '[]')
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [])
  } catch { return new Set() }
}

function guardarNavCerradas() {
  try { localStorage.setItem(claveNavCerradas(), JSON.stringify([...navCerradas])) } catch { /* modo privado */ }
}

/* ---------- Dock estilo iOS: accesos grandes + casa para volver ---------- */

/**
 * El dock es la navegación de "teléfono": 5 apps grandes y una CASA que
 * siempre vuelve al inicio (#centro). Solo se pinta lo que el rol puede abrir:
 * un ícono a una ruta sin permiso sería un callejón con 403.
 */
// `ruta` y no `key`: el catálogo del menú (MENU) usa `key` y duplicaría
// entradas al escanear app.js; el dock son accesos directos a rutas.
const DOCK = [
  { ruta: 'centro', label: 'Inicio', icono: 'casa', inicio: true },
  { ruta: 'documentos', label: 'Bandeja', icono: 'bandeja', permiso: 'documentos:ver' },
  { ruta: 'libros', label: 'Libros', icono: 'libro', permiso: 'documentos:ver' },
  { ruta: 'salud', label: 'Salud', icono: 'salud', permiso: 'salud:ver' },
  { ruta: 'tesoreria', label: 'Tesorería', icono: 'banco', permiso: 'tesoreria:ver' },
]

const ICONO_DOCK = {
  casa: '<path d="M4 11.6 12 4.6l8 7"/><path d="M6 10.6V20h12v-9.4"/><path d="M10 20v-5h4v5"/>',
  bandeja: '<path d="M3 13.6 5.6 5h12.8L21 13.6V19H3z"/><path d="M3 13.6h5l1 2h6l1-2h5"/>',
  libro: '<path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H19v16H5.6A1.6 1.6 0 0 1 4 18.4z"/><path d="M8 4v16"/>',
  salud: '<path d="M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z"/><path d="M8.4 12h1.8l1.4-2.2 1.9 4 1.4-1.8h1.7"/>',
  banco: '<path d="M3 9.5 12 4l9 5.5M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
}

function iconoDock(nombre) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONO_DOCK[nombre] || ICONO_DOCK.casa}</svg>`
}

function dockHTML() {
  const items = DOCK.filter((d) => !d.permiso || tiene(d.permiso)).map((d) => `
    <a href="#${d.ruta}" data-dock="${d.ruta}" class="dock-item${d.inicio ? ' dock-item-inicio' : ''}" title="${esc(d.label)}" aria-label="${esc(d.label)}">
      <span class="dock-ico">${iconoDock(d.icono)}</span>
      <span class="dock-label">${esc(d.label)}</span>
    </a>`).join('')
  return `<nav class="sys-dock" id="sys-dock" aria-label="Accesos rápidos">
    ${items}
    <button type="button" class="dock-item dock-menu" id="sys-dock-menu" aria-controls="sys-nav" aria-expanded="false" title="Todas las secciones" aria-label="Abrir todas las secciones">
      <span class="dock-ico">${iconoDock('menu')}</span>
      <span class="dock-label">Menú</span>
    </button>
  </nav>`
}

function conectarDock() {
  const btn = document.getElementById('sys-dock-menu')
  const nav = document.getElementById('sys-nav')
  if (!btn || !nav) return
  // El panel lateral ya lo maneja conectarMenuMovil (#sys-menu-btn): el botón
  // del dock solo lo dispara. Duplicar el estado acá divergía del sidebar
  // (aria-expanded del header y backdrop quedaban desincronizados).
  btn.addEventListener('click', () => {
    document.getElementById('sys-menu-btn')?.click()
    const side = document.getElementById('sys-side')
    btn.setAttribute('aria-expanded', String(!!side?.classList.contains('abierto')))
  })
}

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

  const itemHTML = (i, seccion) => (!i.permiso || tiene(i.permiso)
    ? `<a href="#${i.key}" data-route="${i.key}" data-seccion="${esc(seccion)}">${esc(i.label)}<span class="pill" data-pill="${i.pill || i.key}"></span></a>`
    : '')

  // La sección de la ruta activa nunca arranca plegada: el usuario que entra
  // por URL (o por el buscador global) ve dónde está sin abrir nada.
  // Primer uso (sin preferencia guardada): todo plegado salvo esa sección;
  // si no, el menú sigue midiendo 2576 px y no se gana nada.
  const guardadoNav = localStorage.getItem(claveNavCerradas())
  navCerradas = guardadoNav === null ? new Set(MENU.map((m) => m.seccion)) : leerNavCerradas()
  const rutaActiva = (location.hash || '#inicio').slice(1).split('?')[0]
  const seccionActiva = MENU.find((m) => m.items.some((i) => i.key === rutaActiva))?.seccion
  // Ojo: no se saca la sección activa de navCerradas. Si se saca, el set deja
  // de reflejar la preferencia y al navegar la sección anterior queda abierta
  // para siempre. La apertura por ruta se resuelve solo al pintar.

  $app().innerHTML = `
   <div class="sys">
     <a class="skip-link" href="#sys-contenido">Saltar al contenido</a>
     <aside class="sys-side" id="sys-side">
       <div class="sys-side-top">
         <div class="sys-logo">
           ${logoMarcaHTML()}
           <div>Sistema Contable<small>JMV Consultores</small></div>
         </div>
         <button type="button" class="sys-menu-cerrar" id="sys-menu-cerrar" aria-label="Cerrar el menú de secciones">Cerrar</button>
       </div>
       <select id="sys-empresa" class="form-input" aria-label="Empresa activa">
          ${S.empresas.map((e) => `<option value="${e.id}" ${String(e.id) === String(S.empresa.id) ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
       </select>
       <nav class="sys-nav" id="sys-nav">
         <div class="nav-search" style="margin-bottom:var(--space-2)">
           <input id="nav-buscar" type="search" placeholder="Buscar sección…" aria-label="Buscar sección del menú">
         </div>
          ${menuVisible().map((sec, idx) => {
            const id = `nav-g-${idx}`
            const abierta = !navCerradas.has(sec.seccion) || sec.seccion === seccionActiva
            return `<div class="nav-grupo" data-seccion="${esc(sec.seccion)}" data-cerrado="${abierta ? '0' : '1'}">
             <button type="button" class="nav-seccion" data-nav-seccion="${esc(sec.seccion)}" aria-expanded="${abierta}" aria-controls="${id}">
               <span class="nav-seccion-t">${esc(sec.seccion)}</span><span class="nav-chev" aria-hidden="true"></span>
             </button>
             <div class="nav-items" id="${id}">${sec.items.map((i) => itemHTML(i, sec.seccion)).join('')}</div>
           </div>`
          }).join('')}
          <div class="nav-vacio" id="nav-vacio" hidden>Sin secciones que coincidan</div>
       </nav>
       <div class="sys-side-foot">
         <div class="u-name">${esc(S.user.username)}${S.superAdmin ? ' · super admin' : ''}</div>
         <a href="#" id="sys-logout">Salir</a>
       </div>
     </aside>
     <div class="sys-menu-back" id="sys-menu-back" hidden></div>
     <main class="sys-main" id="sys-contenido" tabindex="-1">
       <div id="sys-anuncio" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
       <div class="sys-header">
         <button type="button" class="sys-menu-btn" id="sys-menu-btn" aria-expanded="false" aria-controls="sys-nav" aria-label="Abrir el menú de secciones">Menú</button>
         <nav class="sys-breadcrumb" id="sys-breadcrumb" aria-label="Ruta"></nav>
         <span class="spacer"></span>
         ${buscarGlobalHTML()}
         ${notificacionesHTML()}
         ${window.Tema ? window.Tema.botonHTML() : ''}
       </div>
       <div class="sys-titlebar">
         <div class="sys-title-tx">
           <span class="sys-kicker" id="sys-kicker"></span>
           <h1 id="sys-title">Inicio</h1>
         </div>
         <span class="spacer"></span>
         <div class="sys-periodo">
           <span class="sub" id="sys-periodo-estado"></span>
           <select id="sys-periodo" class="form-input sys-periodo-sel" aria-label="Período activo"></select>
         </div>
       </div>
       <div id="sys-banner">${banner}</div>
       <div id="sys-view"></div>
     </main>
     ${dockHTML()}
   </div>`

  if (window.Tema) window.Tema.conectar()
  conectarDock()
  observarTablas()
  conectarMenuMovil()
  conectarSeccionesNav()
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

// Períodos registrados de la empresa actual (estado ABIERTO/CERRADO). Vive
// fuera del conectar para que el router pueda refrescar el selector cuando el
// período llega por la URL (navegación dentro de la misma página).
let periodosEmpresa = []

function pintarEstadoPeriodo(p) {
  const est = document.getElementById('sys-periodo-estado')
  if (!est) return
  const row = periodosEmpresa.find((x) => String(x.periodo) === String(p))
  est.innerHTML = row ? `<span class="chip ${row.estado === 'ABIERTO' ? 'clasificado' : 'neutral'}" title="Estado del período activo">${esc(row.estado)}</span>` : ''
}

/** Deja el selector del header en el período indicado (o en el global). */
function sincronizarSelectorPeriodo(p = periodoGlobal()) {
  const sel = document.getElementById('sys-periodo')
  if (sel && sel.value !== String(p)) sel.value = String(p)
  pintarEstadoPeriodo(p)
}

async function conectarSelectorPeriodo() {
  const sel = document.getElementById('sys-periodo')
  if (!sel) return
  // Períodos registrados de la empresa (para el estado ABIERTO/CERRADO).
  periodosEmpresa = []
  try { periodosEmpresa = (await apiGet(`/api/contable/empresas/${S.empresa.id}/periodos`)).periodos || [] }
  catch { /* sin permiso periodos:ver: el selector queda funcional igual */ }
  // El shell pudo re-montarse mientras se esperaba la API: se escribe en el
  // select vigente, no en el nodo que quedó fuera del documento.
  const vivo = document.getElementById('sys-periodo')
  if (!vivo) return
  // Opciones: últimos 24 meses + los períodos registrados (p.ej. cerrados).
  const opciones = [...new Set([
    ...ultimosPeriodos(24).map(String),
    ...periodosEmpresa.map((p) => String(p.periodo)),
  ])].sort()
  vivo.innerHTML = opciones.map((p) => `<option value="${p}">${esc(perDisplay(p))}</option>`).join('')
  vivo.value = periodoGlobal()
  // El estado del período (ABIERTO/CERRADO) al lado del selector.
  pintarEstadoPeriodo(periodoGlobal())
  vivo.addEventListener('change', () => {
    const p = vivo.value || periodoActual()
    aplicarPeriodoGlobal(p)
    pintarEstadoPeriodo(p)
    // El período queda en la URL (replaceState: cambiar de mes no es una
    // navegación, no debe llenar el historial ni perder los filtros abiertos).
    escribirHash(location.hash)
    renderRoute()
  })
}

/* ---------- breadcrumb ---------- */

function breadcrumbHTML(route) {
  const sec = MENU.find((m) => m.items.some((i) => i.key === route.key))
  // Las vistas fuera de menú declaran su sección en la propia ruta.
  const seccion = sec ? sec.seccion : route.seccion
  if (!seccion) return `<span class="bc-actual">${esc(route.label)}</span>`
  return `<a href="#inicio">Inicio</a><span class="bc-sep">/</span><span>${esc(seccion)}</span><span class="bc-sep">/</span><span class="bc-actual">${esc(route.label)}</span>`
}

/* ---------- menú de secciones en móvil ----------
 * A ≤960 px el menú deja de ser una tira horizontal de 44 ítems (medido:
 * 7384 px de ancho, 2 secciones visibles, sin rótulos de sección) y pasa a
 * un panel lateral desplegable con el buscador y las secciones completas.
 * El botón vive en la cabecera para seguir alcanzable con el pulgar.
 */

let menuMovilTeclado = false

function estadoMenuMovil(abierto) {
  const side = document.getElementById('sys-side')
  const btn = document.getElementById('sys-menu-btn')
  const back = document.getElementById('sys-menu-back')
  if (!side || !btn) return
  side.classList.toggle('abierto', abierto)
  document.body.classList.toggle('menu-movil', abierto)
  btn.setAttribute('aria-expanded', String(abierto))
  // El botón «Menú» del dock dispara este mismo panel: si el estado cambia por
  // el ✕, el fondo o Escape, su aria-expanded también debe seguirlo.
  document.getElementById('sys-dock-menu')?.setAttribute('aria-expanded', String(abierto))
  if (back) back.hidden = !abierto
}

function cerrarMenuMovil(devolverFoco = false) {
  const abierto = document.getElementById('sys-side')?.classList.contains('abierto')
  if (!abierto) return
  estadoMenuMovil(false)
  if (devolverFoco) document.getElementById('sys-menu-btn')?.focus()
}

function conectarMenuMovil() {
  const btn = document.getElementById('sys-menu-btn')
  const side = document.getElementById('sys-side')
  if (!btn || !side) return
  estadoMenuMovil(false)
  // Sin foco automático en el buscador: abrir el panel en el teléfono
  // desplegaría el teclado y taparía media lista de secciones.
  btn.addEventListener('click', () => estadoMenuMovil(!side.classList.contains('abierto')))
  document.getElementById('sys-menu-cerrar')?.addEventListener('click', () => cerrarMenuMovil(true))
  document.getElementById('sys-menu-back')?.addEventListener('click', () => cerrarMenuMovil(true))
  // Elegir sección o empresa cierra el panel: el contenido viene después.
  document.getElementById('sys-nav')?.addEventListener('click', (e) => {
    if (e.target.closest('a')) cerrarMenuMovil()
  })
  document.getElementById('sys-empresa')?.addEventListener('change', () => cerrarMenuMovil())
  if (!menuMovilTeclado) {
    menuMovilTeclado = true
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrarMenuMovil(true)
    })
  }
}

/**
 * Aviso de tabla desplazable: a 390 px las tablas contables miden hasta
 * 1000 px de más dentro de `.tbl-wrap` y nada indicaba que había columnas a la
 * derecha (montos, acciones). Se inserta solo cuando la tabla realmente
 * desborda; en escritorio el aviso queda oculto por CSS.
 */
let antiTablaTimer = null
let observadorTablas = null
window.addEventListener('resize', () => {
  clearTimeout(antiTablaTimer)
  antiTablaTimer = setTimeout(() => marcarTablasDesplazables(document.getElementById('sys-view')), 200)
})

/**
 * Las vistas del portal, CRM y tesorería pintan sus tablas DESPUÉS de que
 * `render()` resuelve (esperan API). Sin observar el contenedor, el aviso de
 * desplazamiento no aparecía en esas pantallas. El observer es idempotente:
 * si no hay nada que cambiar, no escribe DOM y no se realimenta.
 */
function observarTablas() {
  const cont = document.getElementById('sys-view')
  if (!cont) return
  observadorTablas?.disconnect()
  observadorTablas = new MutationObserver(() => {
    clearTimeout(antiTablaTimer)
    antiTablaTimer = setTimeout(() => marcarTablasDesplazables(document.getElementById('sys-view')), 120)
  })
  observadorTablas.observe(cont, { childList: true, subtree: true })
}

function marcarTablasDesplazables(cont) {
  if (!cont) return
  cont.querySelectorAll('.tbl-wrap').forEach((w) => {
    let hint = w.previousElementSibling
    if (!hint || !hint.classList?.contains('tbl-hint')) hint = null
    const sobra = w.scrollWidth - w.clientWidth
    if (sobra <= 8) {
      if (hint) hint.remove()
      return
    }
    if (!hint) {
      hint = document.createElement('p')
      hint.className = 'tbl-hint'
      hint.innerHTML = '<span aria-hidden="true">↔</span> Desliza la tabla para ver todas las columnas'
      w.insertAdjacentElement('beforebegin', hint)
    }
    w.setAttribute('tabindex', w.getAttribute('tabindex') || '0')
  })
}

/* ---------- secciones plegables ----------
 * El botón de sección es el único control del pliegue: no hay estado oculto
 * fuera del DOM (aria-expanded + data-cerrado) para que el teclado y el
 * lector de pantalla vean lo mismo que la vista.
 */

function plegarSeccion(grupo, abierta, { persistir = true } = {}) {
  const btn = grupo.querySelector('.nav-seccion')
  grupo.dataset.cerrado = abierta ? '0' : '1'
  if (btn) btn.setAttribute('aria-expanded', String(abierta))
  if (!persistir) return
  const nombre = btn?.dataset.navSeccion || grupo.dataset.seccion
  if (!nombre) return
  if (abierta) navCerradas.delete(nombre)
  else navCerradas.add(nombre)
  guardarNavCerradas()
}

function conectarSeccionesNav() {
  const nav = document.getElementById('sys-nav')
  if (!nav) return
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-seccion')
    const grupo = btn?.closest('.nav-grupo')
    if (!btn || !grupo) return
    const abrir = grupo.dataset.cerrado === '1'
    plegarSeccion(grupo, abrir)
    // NIVEL 1 → NIVEL 2: abrir un área cierra las demás (acordeón). Antes cada
    // área se abría por separado y el lateral volvía a ser la lista completa de
    // funciones —justo el problema que el handoff (§5) identificó—: con 43
    // ítems abiertos el menú mide ~2.600 px en un teléfono. El estado se
    // persiste igual (una sola área abierta), así que al recargar se respeta.
    if (abrir) {
      document.querySelectorAll('#sys-nav .nav-grupo').forEach((otro) => {
        if (otro !== grupo && otro.dataset.cerrado === '0') plegarSeccion(otro, false)
      })
    }
  })
}

/* La ruta activa (URL, buscador global, «Recientes» del Centro) abre su
 * sección aunque el usuario la hubiera plegado antes. Al cambiar de ruta se
 * reaplica el estado base, para que la sección de la vista anterior vuelva a
 * plegarse en vez de acumular secciones abiertas.
 * Abrir por navegación NO se guarda: si no, recorrer las 9 secciones deja todo
 * desplegado (2807 px) y el pliegue deja de servir. */
function abrirSeccionDeRuta(key) {
  document.querySelectorAll('#sys-nav .nav-grupo').forEach((grupo) => {
    const propia = Boolean(grupo.querySelector(`a[data-route="${key}"]`))
    const abierta = propia || !navCerradas.has(grupo.dataset.seccion)
    if ((grupo.dataset.cerrado === '0') !== abierta) plegarSeccion(grupo, abierta, { persistir: false })
  })
}

/* ---------- buscador del menú ---------- */

function conectarBuscadorMenu() {
  const inp = document.getElementById('nav-buscar')
  if (!inp) return
  const aplicar = () => {
    const q = inp.value.trim().toLowerCase()
    let total = 0
    // Se compara también con el RÓTULO DE SECCIÓN: buscar «tesor» debe
    // encontrar «Bancos, Libro Banco y Conciliación» (medido: antes la
    // búsqueda devolvía 0 resultados porque el nombre vive en el rótulo).
    // El rótulo se lee del grupo, no del hermano anterior del enlace: con el
    // menú plegado el enlace ya no es hermano del rótulo.
    document.querySelectorAll('#sys-nav .nav-grupo').forEach((grupo) => {
      const seccion = (grupo.dataset.seccion || '').toLowerCase()
      let visibles = 0
      grupo.querySelectorAll('a').forEach((a) => {
        const coincide = !q || a.textContent.toLowerCase().includes(q) || seccion.includes(q)
        a.classList.toggle('oculto', Boolean(q) && !coincide)
        if (coincide) visibles++
      })
      const oculto = Boolean(q) && visibles === 0
      grupo.classList.toggle('oculta', oculto)
      // Buscando, los grupos con coincidencias se muestran desplegados para
      // que el resultado no quede escondido tras un pliegue previo.
      grupo.classList.toggle('buscando', Boolean(q) && visibles > 0)
      total += visibles
    })
    const vacio = document.getElementById('nav-vacio')
    if (vacio) vacio.hidden = !(q && total === 0)
  }
  inp.addEventListener('input', aplicar)
  inp.addEventListener('search', aplicar)
}

/* ---------- contexto compartible: empresa y período en la URL ----------
 * Empresa y período vivían SOLO en localStorage: el enlace que se copiaba
 * (`#documentos?estado=PENDIENTE`) se abría en la empresa o en el mes de quien
 * lo abría, y Atrás/Adelante no restauraba el contexto. Ahora viajan en la
 * query del hash —el mismo lugar donde cada vista ya guarda sus filtros— sin
 * tocar sus claves: los filtros de la vista se conservan tal cual (`estado`,
 * `tipo`, `p`…). La URL es la fuente de verdad al cargar; localStorage sigue
 * siendo el respaldo para un `#ruta` pelado.
 */
// La aritmética del hash vive en `url-estado.js` (pura y testeable en la
// suite); aquí solo se le inyecta el contexto de la sesión.
function hashPartes(hash = location.hash) { return window.UrlEstado.partes(hash) }
function contextoEnURL(hash = location.hash) { return window.UrlEstado.contexto(hash) }

/**
 * Hash de la vista + el contexto vigente (empresa y período).
 * `forzar` (por defecto) sobrescribe el contexto que traiga el hash: es lo que
 * el router usa al normalizar una URL con empresa ajena o período inválido.
 * `forzar:false` RESPETA el contexto del hash — necesario al navegar a un
 * enlace compartido, cuyo empresa/período deben mandar sobre la sesión.
 */
function conContexto(hash, { forzar = true } = {}) {
  return window.UrlEstado.conContexto(hash, {
    empresa: S.empresa ? S.empresa.id : null,
    periodo: periodoGlobal(),
  }, { forzar })
}

/** Escribe la URL con contexto. `historial` crea entrada (Atrás la restaura). */
function escribirHash(hash, { historial = false } = {}) {
  const destino = conContexto(hash)
  if (location.hash === destino) return
  try {
    if (historial) history.pushState(null, '', destino)
    else history.replaceState(null, '', destino)
  } catch { location.hash = destino }
}

/** Fija el período activo en TODOS los puntos donde lo leen las vistas. */
function aplicarPeriodoGlobal(p) {
  localStorage.setItem('iva_periodo_activo', p)
  window._inicioPeriodo = p
  window._repPeriodo = p; window._balance8Periodo = p; window._clasificadoPeriodo = p
  window._situacionPeriodo = p; window._resultadosPeriodo = p; window._niifPeriodo = p
  window._niifResPeriodo = p; window._asPeriodo = p; window._tesoPeriodo = p
  // F2: el Diario, las Propuestas y los Libros leían `periodoActual()` y
  // quedaban en el mes del calendario aunque el header dijera otro. El
  // período es uno solo: el selector del shell y la URL también los mueven.
  window._ctaPeriodo = p; window._propPeriodo = p; window._librosPeriodo = p
  // Contabilización y Pendientes leía `periodoActual()` (mes del calendario)
  // y mostraba/ejecutaba otro mes que el del header y la URL.
  window._autoPeriodo = p
}

let remontandoContexto = false

/**
 * Aplica el contexto que trae la URL antes de resolver la ruta.
 * Devuelve 'remontar' cuando cambió la empresa: selector, permisos y licencia
 * son de la empresa, así que hay que rehacer el shell antes de pintar.
 * La empresa de la URL solo se acepta si el usuario tiene acceso a ella; si no
 * (enlace de otro despacho, empresa dada de baja) se ignora y la URL se
 * reescribe con el contexto real — nunca se abre una vista en empresa ajena.
 */
function aplicarContextoURL() {
  const ctx = contextoEnURL()
  const periodoValido = ctx.periodo && window.UrlEstado.periodoValido(ctx.periodo) ? ctx.periodo : null
  if (ctx.empresa && String(S.empresa?.id) !== ctx.empresa && !remontandoContexto) {
    const e = S.empresas.find((x) => String(x.id) === ctx.empresa)
    if (e) {
      localStorage.setItem('iva_empresa_activa', String(e.id))
      S.empresa = e
      S.licencia = e.licencia || null
      S.permisos = new Set(e.permisos || [])
      S.cache = {}
      if (periodoValido) aplicarPeriodoGlobal(periodoValido)
      else { localStorage.removeItem('iva_periodo_activo'); window._inicioPeriodo = null }
      remontandoContexto = true
      try { renderShell(); navigate(location.hash) } finally { remontandoContexto = false }
      return 'remontar'
    }
  }
  if (periodoValido && periodoValido !== periodoGlobal()) {
    aplicarPeriodoGlobal(periodoValido)
    // Navegar dentro de la misma página (hashchange) no re-monta el shell: el
    // selector del header quedaría mostrando el mes anterior aunque la vista
    // ya use el de la URL.
    sincronizarSelectorPeriodo(periodoValido)
  }
  // La URL siempre sale con contexto: un enlace copiado desde cualquier vista
  // —o desde un filtro que reescribe el hash— no lo pierde.
  const destino = conContexto(location.hash)
  if (location.hash !== destino) {
    try { history.replaceState(null, '', destino) } catch { /* hash raro */ }
  }
  return 'ok'
}

/* ---------- router ---------- */

function navigate(hash) {
  // Sin forzar: si la ruta destino trae empresa/período (enlace compartido,
  // historial), esos mandan y `aplicarContextoURL` los aplica al renderizar.
  const destino = conContexto(hash, { forzar: false })
  if (location.hash !== destino) { location.hash = destino; return } // dispara hashchange
  renderRoute()
}

window.addEventListener('hashchange', renderRoute)

function renderRoute() {
  if (!S.user) return
  if (aplicarContextoURL() === 'remontar') return
  // La query de la vista (p. ej. #dte?tipo=33) es estado de la ruta, no parte
  // de la clave: sin este split, un filtro te expulsa a la vista Inicio.
  const key0 = (location.hash || '#inicio').slice(1).split('?')[0]
  const key = resolverRouteKey(key0)
  const view = VIEWS[key] || VIEWS.inicio
  // Identidad de la ruta: ítem de menú → vista fuera de menú → Inicio (ruta
  // desconocida). Sin el segundo término, los 6 reportes del Centro de Reportes
  // se renderizaban con la identidad de Inicio (ver RUTAS_FUERA_DE_MENU).
  const route = TODOS_LOS_ITEMS.find((n) => n.key === key)
    || RUTAS_FUERA_DE_MENU[key]
    || TODOS_LOS_ITEMS[0]

  // Recientes del Centro (por usuario): la última vista con entrada de menú.
  // No graba el propio Centro ni vistas extra (excluir efectos como filtros).
  if (S.user && route && route.key && route.key !== 'centro') {
    const clave = `jmv.centro.recientes.${S.user.id}`
    let rec = []
    try { rec = JSON.parse(localStorage.getItem(clave) || '[]') } catch { rec = [] }
    rec = rec.filter((r) => r.ruta !== route.key)
    rec.unshift({ ruta: route.key, label: route.label })
    localStorage.setItem(clave, JSON.stringify(rec.slice(0, 8)))
  }

  // Las vistas fuera de menú (#niif y las otras 5 de F0) NO marcan ningún ítem:
  // el contrato de F0 es que no se señale como activo un ítem en el que el
  // usuario no está (la identidad la da el breadcrumb «Inicio/Informes/…»).
  const activos = new Set([route.key])
  document.querySelectorAll('#sys-nav a').forEach((a) => {
    const activo = activos.has(a.dataset.route)
    a.classList.toggle('active', activo)
    // aria-current: la marca visual (clase) no existe para lectores de pantalla.
    if (activo) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  // El dock marca la app activa; en la casa el «activo» es el inicio.
  document.querySelectorAll('#sys-dock a[data-dock]').forEach((a) => {
    const activo = activos.has(a.dataset.dock)
    a.classList.toggle('active', activo)
    if (activo) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  abrirSeccionDeRuta(route.key)

  document.getElementById('sys-title').textContent = view.titulo || route.label
  // Anuncio para lectores de pantalla: la navegación cambia el contenido sin
  // recargar la página, así que sin aria-live el cambio es invisible al foco
  // virtual. Se anuncia la vista, no cada repintado interno.
  const anuncio = document.getElementById('sys-anuncio')
  if (anuncio) anuncio.textContent = `Vista: ${view.titulo || route.label}`
  // Contexto persistente: empresa y RUT bajo el título, sin repetirlo en cada
  // vista. El período tiene su propio selector a la derecha.
  const kicker = document.getElementById('sys-kicker')
  if (kicker) {
    const emp = S.empresa || {}
    kicker.textContent = [emp.nombre, emp.rut ? formatRut(emp.rut) : null].filter(Boolean).join(' · ')
  }
  const bc = document.getElementById('sys-breadcrumb')
  if (bc) bc.innerHTML = breadcrumbHTML(route)

  // IMPENETRABILIDAD: ruta conocida por URL pero no autorizada para el rol
  // actual NUNCA renderiza la vista (el Backend igual devuelve 401/403/402 en
  // cada fetch data — esto es cortesía de UX, no el control de acceso).
  if (route.permiso && !tiene(route.permiso)) {
    document.getElementById('sys-view').innerHTML =
      `<div class="empty">Tu rol en ${esc(S.empresa.nombre)} no tiene permiso para esta sección.</div>
       <div class="empty"><a class="btn btn-secondary" href="#centro">Volver a Todos los módulos</a></div>`
    return
  }

  cerrarMenuMovil()
  refrescarPillSalud()
  const cont = document.getElementById('sys-view')
  cont.innerHTML = `<div class="empty">Cargando…</div>`
  Promise.resolve(view.render(cont))
    .then(() => marcarTablasDesplazables(cont))
    .catch((err) => {
      cont.innerHTML = `<div class="card" style="border-color:var(--danger)"><b style="color:var(--danger)">Error</b><p class="muted">${esc(err.message)}</p></div>`
    })
}

/* ---------- pill de documentos pendientes en el nav ---------- */

/* ---------- pill de salud tributaria en el nav ---------- */

// El dueño ve el estado de SU empresa sin abrir la vista: el score si está al
// día y «!» cuando requiere revisión. El endpoint está cacheado 60 s en el
// servidor, así que navegar no lo vuelve a calcular.
async function refrescarPillSalud() {
  if (!S.empresa || !tiene('salud:ver')) return
  const a = document.querySelector('[data-pill="salud"]')
  if (!a) return
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/salud-tributaria/resumen?periodo=${periodoGlobal()}&meses=12`)
    const s = r.resumen
    const alerta = s.nivel === 'REQUIERE_REVISION' || s.nivel === 'SIN_INFORMACION'
    a.dataset.nivel = s.nivel
    a.textContent = alerta ? '!' : String(s.score)
    // Sin antecedentes verificados no hay índice: no se muestra un puntaje
    // que la lectura del menúaría como una calificación.
    const puntaje = s.indice_evaluable === false ? 'índice no evaluable' : `${s.score}/100`
    a.title = `${s.titulo} · ${puntaje} · ${s.hallazgos} hallazgo(s)`
    a.setAttribute('aria-label', `Salud tributaria: ${s.titulo}, ${puntaje}, ${s.hallazgos} hallazgos`)
  } catch { /* el pill es informativo: nunca rompe la navegación */ }
}

async function refrescarPillDocs() {
  if (!S.empresa || !tiene('documentos:ver')) return
  try {
    const r = await apiGet(`/api/contable/empresas/${S.empresa.id}/documentos?estado=PENDIENTE&limit=1`)
    const a = document.querySelector('[data-pill="documentos"]')
    if (a && r.total) a.textContent = r.total
  } catch { /* silencioso */ }
}
