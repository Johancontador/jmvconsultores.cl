# Dashboard Power BI — Shell Unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir `dashboard.html` en el shell único de la app (header con cliente activo/Conectar/estado, sidebar en acordeón, panel central que cambia de vista sin recargar), reutilizando el backend y el motor de reportes que ya funcionan hoy — sin tocar login ni las consultas reales al SII.

**Architecture:** Vanilla JS (sin frameworks). Dos módulos nuevos y pequeños (`shell-state.js` para el estado compartido cliente/rango, `shell-router.js` para orquestar qué vista se pinta en `#panel-central`) se apoyan en el motor de render que ya existe en `reportes.js` (tablas, gráficos, export) y en un `dashboard.js` reescrito para la vista de aterrizaje. `layout.js` pasa de renderizar solo un sidebar plano a renderizar sidebar-acordeón + header.

**Tech Stack:** Express + better-sqlite3 (sin cambios), Chart.js (ya cargado vía CDN), vanilla JS/CSS existentes del proyecto.

## Global Constraints

- No modificar `login.html`, `backend/middleware/` de autenticación, ni la lógica de consulta real al SII (`backend/services/proceso.js`, `sii.js`) — spec §2.
- No se agregan reportes nuevos ni se cambia ningún cálculo — todo tipo de reporte ya existe en `CATALOGO` (`frontend/js/reportes.js:39-264`).
- No se agrega ninguna dependencia nueva (sin HTMX/Alpine/frameworks) — spec §3.
- Tema: solo se extiende el sistema de variables CSS oscuro ya existente en `frontend/css/app.css` — no se crea modo claro.
- Sidebar: nombres y estructura exactos por spec §6 (ver mapeo completo en Task 4) — "Ranking ▾ → Evolución, Análisis ▾ (Mensual/Anual)" y "Comparativos ▾ → Tendencias, Variaciones, KPIs, Alertas, Informe de Gestión", tal como el usuario los confirmó.
- Sidebar colapsable en ≥900px (riel de íconos) sin romper el comportamiento móvil (<900px) que ya existe — spec §6.
- `frontend/index.html`, `configuracion.html`, `proceso.html` no cambian de contenido — solo heredan el nuevo sidebar de `layout.js` (componente compartido). El header completo (cliente/Conectar/badge/filtro) solo se renderiza cuando la página tiene `#panel-central` (o sea, solo en el shell).

---

## Mapeo de referencia (usar textual en Tasks 4 y 7)

```
Inicio (dashboard landing, sin tipo — vista por defecto)

Tributarios
├── IVA ▾
│   ├── Mensual        → iva-mensual
│   ├── Anual          → iva-anual
│   ├── Por Cliente    → iva-por-cliente   (fuente: proceso — ver nota Task 7)
│   └── Estado         → estado-iva
├── Libro Compra       → libro-compras-rango
├── Libro Venta        → libro-ventas-rango
├── Desglose Compras   → desglose-gestion-compras
├── Desglose Ventas    → desglose-gestion-ventas
├── Resumen            → resumen-tributario
└── Exportaciones      → exportaciones

Comercial
├── Clientes           → top-clientes
└── Proveedores        → top-proveedores

Ranking ▾
├── Evolución          → ventas-mes
└── Análisis ▾
    ├── Mensual        → ranking-mensual
    └── Anual          → ranking-anual

Comparativos ▾
├── Tendencias         → tendencias
├── Variaciones        → variaciones
├── KPIs               → kpis
├── Alertas            → alertas
└── Informe de Gestión → informe-gestion
```

---

### Task 1: Backend — filtrar informes por cliente

**Files:**
- Modify: `backend/services/informe.js:192-198` (`listarInformesDeBD`)
- Modify: `backend/routes/informe.js:101-126` (`router.get('/')`)
- Test: `test/informe-listar.test.js`

**Interfaces:**
- Produces: `listarInformesDeBD(userId, limit = 50, offset = 0, clienteId = null)` — si `clienteId` no es `null`, filtra `WHERE cliente_id = ?` además de `user_id`. Usado por Task 7 vía `GET /api/informe?cliente_id=`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/informe-listar.test.js`:

```js
/**
 * Tests de listarInformesDeBD con filtro por cliente.
 * Ejecutar con: node --test test/informe-listar.test.js
 */
const test = require('node:test')
const assert = require('node:assert')
const path = require('path')
const fs = require('fs')
const os = require('os')

const dbFile = path.join(os.tmpdir(), `iva-mensual-test-${Date.now()}.db`)
process.env.DB_PATH = dbFile

const db = require('../backend/db')
const { listarInformesDeBD } = require('../backend/services/informe')

test.after(() => {
  db.close()
  fs.rmSync(dbFile, { force: true })
  fs.rmSync(dbFile + '-wal', { force: true })
  fs.rmSync(dbFile + '-shm', { force: true })
})

function seedCliente(userId, nombre, rut) {
  const info = db
    .prepare(`INSERT INTO clientes (rut, nombre, clave_sii, tasa_ppm, telefono, user_id) VALUES (?, ?, 'x', 0, '900000000', ?)`)
    .run(rut, nombre, userId)
  return info.lastInsertRowid
}

function seedInforme(id, userId, clienteId, clienteNombre) {
  db.prepare(`
    INSERT INTO informes (id, user_id, cliente_id, cliente_nombre, cliente_rut, anio_inicio, anio_fin, mes_inicio, mes_fin, estado, consultas_estimadas, total_meses)
    VALUES (?, ?, ?, ?, '11111111-1', 2026, 2026, 1, 6, 'completado', 12, 6)
  `).run(id, userId, clienteId, clienteNombre)
}

test('listarInformesDeBD sin clienteId devuelve informes de todos los clientes del usuario', () => {
  const userId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const clienteA = seedCliente(userId, 'Cliente A', '76111111-1')
  const clienteB = seedCliente(userId, 'Cliente B', '76222222-2')
  seedInforme('inf-a', userId, clienteA, 'Cliente A')
  seedInforme('inf-b', userId, clienteB, 'Cliente B')

  const todos = listarInformesDeBD(userId, 50, 0)
  const ids = todos.map((i) => i.id)
  assert.ok(ids.includes('inf-a'))
  assert.ok(ids.includes('inf-b'))
})

test('listarInformesDeBD con clienteId solo devuelve informes de ese cliente', () => {
  const userId = db.prepare(`SELECT id FROM users WHERE is_admin = 1 LIMIT 1`).get().id
  const clienteA = seedCliente(userId, 'Cliente C', '76333333-3')
  const clienteB = seedCliente(userId, 'Cliente D', '76444444-4')
  seedInforme('inf-c', userId, clienteA, 'Cliente C')
  seedInforme('inf-d', userId, clienteB, 'Cliente D')

  const soloA = listarInformesDeBD(userId, 50, 0, clienteA)
  assert.strictEqual(soloA.length, 1)
  assert.strictEqual(soloA[0].id, 'inf-c')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `node --test test/informe-listar.test.js`
Expected: FALLA en el segundo test (`soloA.length` será 2, no 1) — porque `listarInformesDeBD` todavía no acepta/filtra por `clienteId`.

- [ ] **Step 3: Implementar el filtro en el servicio**

En `backend/services/informe.js`, reemplazar líneas 192-198:

```js
function listarInformesDeBD(userId, limit = 50, offset = 0, clienteId = null) {
  if (clienteId) {
    return db.prepare(`
      SELECT id, cliente_nombre, cliente_rut, anio_inicio, anio_fin, mes_inicio, mes_fin, modo, estado,
             total_meses, consultas_estimadas, resumen_json, creado_en
      FROM informes WHERE user_id = ? AND cliente_id = ? ORDER BY creado_en DESC LIMIT ? OFFSET ?
    `).all(userId, clienteId, limit, offset)
  }
  return db.prepare(`
    SELECT id, cliente_nombre, cliente_rut, anio_inicio, anio_fin, mes_inicio, mes_fin, modo, estado,
           total_meses, consultas_estimadas, resumen_json, creado_en
    FROM informes WHERE user_id = ? ORDER BY creado_en DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset)
}
```

- [ ] **Step 4: Pasar `cliente_id` desde la ruta**

En `backend/routes/informe.js`, reemplazar líneas 101-105 (dentro de `router.get('/', ...)`):

```js
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const offset = Number(req.query.offset) || 0
    const clienteId = req.query.cliente_id ? Number(req.query.cliente_id) : null
    const informes = listarInformesDeBD(req.user.id, limit, offset, clienteId)
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `node --test test/informe-listar.test.js`
Expected: PASS (2 tests, 0 fallos)

- [ ] **Step 6: Commit**

```bash
git add backend/services/informe.js backend/routes/informe.js test/informe-listar.test.js
git commit -m "feat(backend): filtrar informes por cliente_id en GET /api/informe"
```

---

### Task 2: `shared/shell-state.js` — estado global compartido

**Files:**
- Create: `frontend/shared/shell-state.js`

**Interfaces:**
- Produces (global `window.ShellState`):
  - `getClienteId(): number|null`
  - `setClienteId(id: number): void` — persiste y notifica listeners
  - `getRango(): {anioInicio:number, mesInicio:number, anioFin:number, mesFin:number}` — con default (enero del año actual → mes actual) si no hay nada guardado
  - `setRango(rango): void` — persiste y notifica listeners
  - `onCambio(fn: () => void): void` — se llama cada vez que cliente o rango cambian

- [ ] **Step 1: Crear el archivo**

```js
/**
 * Estado compartido entre header, barra de filtros global y el panel central:
 * cliente activo y rango Año/Mes. Persistido en sessionStorage para sobrevivir
 * un F5 dentro de la misma pestaña, sin depender de la URL.
 */
const ShellState = (() => {
  const KEY_CLIENTE = 'iva_shell_cliente_id'
  const KEY_RANGO = 'iva_shell_rango'
  const listeners = []

  function getClienteId() {
    const v = sessionStorage.getItem(KEY_CLIENTE)
    return v ? Number(v) : null
  }

  function setClienteId(id) {
    sessionStorage.setItem(KEY_CLIENTE, String(id))
    notificar()
  }

  function getRango() {
    const raw = sessionStorage.getItem(KEY_RANGO)
    if (raw) {
      try { return JSON.parse(raw) } catch { /* cae al default */ }
    }
    const ahora = new Date()
    return {
      anioInicio: ahora.getFullYear(),
      mesInicio: 1,
      anioFin: ahora.getFullYear(),
      mesFin: ahora.getMonth() + 1,
    }
  }

  function setRango(rango) {
    sessionStorage.setItem(KEY_RANGO, JSON.stringify(rango))
    notificar()
  }

  function onCambio(fn) {
    listeners.push(fn)
  }

  function notificar() {
    listeners.forEach((fn) => fn())
  }

  return { getClienteId, setClienteId, getRango, setRango, onCambio }
})()

window.ShellState = ShellState
```

- [ ] **Step 2: Verificar manualmente en consola del navegador**

No hay test runner de frontend en este proyecto (confirmado: `package.json` solo define `node --test` para backend). Verificación manual: abrir cualquier página con `<script src="/shared/shell-state.js"></script>` cargado, y en devtools console ejecutar:

```js
ShellState.setClienteId(5)
ShellState.getClienteId() // debe devolver 5
ShellState.setRango({anioInicio:2025, mesInicio:1, anioFin:2026, mesFin:7})
ShellState.getRango() // debe devolver ese objeto
```

Expected: los tres `console.log` devuelven los valores esperados y no hay errores en consola. (Este archivo aún no está enlazado en ninguna página — se enlaza en Task 9. Para probarlo ahora, se puede pegar el contenido temporalmente en la consola de cualquier página del sitio.)

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/shell-state.js
git commit -m "feat(frontend): agregar shell-state.js para cliente activo y rango compartidos"
```

---

### Task 3: CSS — fundamentos visuales del shell

**Files:**
- Modify: `frontend/css/app.css` (agregar al final, después de la línea 1127)

**Interfaces:**
- Produces (clases CSS nuevas, consumidas por Tasks 4, 5, 8): `.topbar`, `.topbar-cliente`, `.topbar-spacer`, `.badge-estado` (+ modificadores `.badge-conectado`/`.badge-sincronizando`/`.badge-sin-datos`), `.topbar-progress` (+ `.topbar-progress-fill`), `.filtro-global-bar`, `.sidebar-collapse-btn`, `.nav-children-nested`, `.kpi-card-bi` (+ `.kpi-icono`, `.kpi-tendencia`, `.kpi-tendencia-up`, `.kpi-tendencia-down`), `.dash-card-dona`.
- Consumes: variables ya existentes en `:root` — `--sidebar-w`, `--sidebar-w-sm` (ya definida, sin usar hoy — línea 127), `--header-h`, `--accent`, `--success`, `--error`, `--bg-surface`, `--bg-base`, `--bg-elevated`, `--border-subtle`, `--border-default`, `--fg-secondary`, `--fg-primary`, `--fs-xs`, `--fs-xl`, `--fw-semibold`, `--z-sticky`, `--dur-base`, `--dur-fast`, `--ease-out`, `--radius-sm`, `--radius-md`, `--shadow-md`.

- [ ] **Step 1: Agregar las nuevas secciones CSS al final de `app.css`**

Agregar después de la línea 1127 (después del bloque `.stagger`):

```css

/* ─────────────────────────────────────────────────────────────────────────────
   26. TOPBAR — cliente activo, conectar, estado, filtro global
   ───────────────────────────────────────────────────────────────────────────── */
.topbar {
  position: fixed; top: 0; left: var(--sidebar-w); right: 0; height: var(--header-h);
  background: var(--bg-surface); border-bottom: 1px solid var(--border-subtle);
  display: flex; align-items: center; gap: var(--space-4);
  padding: 0 var(--space-5); z-index: calc(var(--z-sticky) - 1);
  transition: left var(--dur-base) var(--ease-out);
}
body.sidebar-collapsed .topbar { left: var(--sidebar-w-sm); }
.topbar-cliente { min-width: 220px; }
.topbar-spacer { flex: 1; }

.badge-estado {
  display: inline-flex; align-items: center; gap: var(--space-2);
  padding: var(--space-1) var(--space-3); border-radius: 999px;
  font-size: var(--fs-xs); font-weight: var(--fw-semibold); white-space: nowrap;
}
.badge-estado::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.badge-conectado { background: var(--success-soft); color: var(--success); }
.badge-sincronizando { background: rgba(234,179,8,0.14); color: #eab308; }
.badge-sin-datos { background: var(--bg-elevated); color: var(--fg-secondary); }

.topbar-progress {
  position: fixed; top: var(--header-h); left: var(--sidebar-w); right: 0; height: 3px;
  background: transparent; z-index: calc(var(--z-sticky) - 1);
  transition: left var(--dur-base) var(--ease-out);
}
body.sidebar-collapsed .topbar-progress { left: var(--sidebar-w-sm); }
.topbar-progress-fill { height: 100%; background: var(--accent); width: 0%; transition: width var(--dur-fast) linear; }

.filtro-global-bar {
  position: fixed; top: var(--header-h); left: var(--sidebar-w); right: 0;
  z-index: calc(var(--z-sticky) - 2); background: var(--bg-base);
  border-bottom: 1px solid var(--border-subtle); padding: var(--space-3) var(--space-5);
  display: flex; align-items: flex-end; gap: var(--space-3); flex-wrap: wrap;
  transition: left var(--dur-base) var(--ease-out);
}
body.sidebar-collapsed .filtro-global-bar { left: var(--sidebar-w-sm); }
.filtro-global-bar .control-group { margin-bottom: 0; }

body.has-sidebar.has-topbar .container { padding-top: calc(var(--header-h) + 84px + var(--space-5)); }

@media (max-width: 900px) {
  .topbar, .filtro-global-bar, .topbar-progress { left: 0; }
  body.sidebar-collapsed .topbar, body.sidebar-collapsed .filtro-global-bar, body.sidebar-collapsed .topbar-progress { left: 0; }
  .filtro-global-bar { flex-direction: column; align-items: stretch; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   27. SIDEBAR COLAPSABLE (riel de íconos en desktop/laptop)
   ───────────────────────────────────────────────────────────────────────────── */
.sidebar-collapse-btn {
  width: 32px; height: 32px; margin-left: auto; background: none;
  border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  color: var(--fg-secondary); cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.sidebar-collapse-btn:hover { background: var(--bg-elevated); color: var(--fg-primary); }

body.sidebar-collapsed .sidebar { width: var(--sidebar-w-sm); }
body.sidebar-collapsed .sidebar .nav-label,
body.sidebar-collapsed .sidebar .sidebar-logo span,
body.sidebar-collapsed .sidebar .nav-caret,
body.sidebar-collapsed .sidebar .nav-children,
body.sidebar-collapsed .sidebar .nav-username { display: none; }
body.sidebar-collapsed .sidebar .nav-link,
body.sidebar-collapsed .sidebar .nav-group-toggle { justify-content: center; padding-left: 0; padding-right: 0; }
body.sidebar-collapsed.has-sidebar .container { margin-left: var(--sidebar-w-sm); width: calc(100% - var(--sidebar-w-sm)); }

body.sidebar-collapsed .sidebar .nav-link:hover::after,
body.sidebar-collapsed .sidebar .nav-group-toggle:hover::after {
  content: attr(title); position: absolute; left: calc(100% + 8px); top: 50%; transform: translateY(-50%);
  background: var(--bg-elevated); border: 1px solid var(--border-default); border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2); font-size: var(--fs-xs); white-space: nowrap; z-index: var(--z-sticky);
  box-shadow: var(--shadow-md);
}
.nav-link, .nav-group-toggle { position: relative; }
.nav-children-nested { padding-left: var(--space-4); }

@media (max-width: 900px) {
  .sidebar-collapse-btn { display: none; }
  body.sidebar-collapsed .sidebar { width: var(--sidebar-w); }
  body.sidebar-collapsed.has-sidebar .container { margin-left: 0; width: 100%; }
}

/* ─────────────────────────────────────────────────────────────────────────────
   28. DASHBOARD BI — KPI con tendencia, gráfico de dona
   ───────────────────────────────────────────────────────────────────────────── */
.kpi-card-bi { display: flex; flex-direction: column; gap: var(--space-2); }
.kpi-card-bi .kpi-icono { font-size: var(--fs-xl); opacity: 0.85; }
.kpi-tendencia { font-size: var(--fs-xs); font-weight: var(--fw-semibold); display: inline-flex; align-items: center; gap: 2px; }
.kpi-tendencia-up { color: var(--success); }
.kpi-tendencia-down { color: var(--error); }
.dash-card-dona .chart-wrap { max-height: 280px; }
```

- [ ] **Step 2: Verificación visual**

No hay nada que renderice estas clases todavía (se consumen desde Task 4 en adelante). Verificar solo que el archivo no tiene errores de sintaxis: abrir cualquier página existente (ej. `index.html` con el server corriendo) y confirmar en devtools → Network que `app.css` carga con status 200 y sin que el navegador reporte reglas inválidas en la pestaña Elements → Styles.

- [ ] **Step 3: Commit**

```bash
git add frontend/css/app.css
git commit -m "feat(css): fundamentos visuales para topbar, sidebar colapsable y dashboard BI"
```

---

### Task 4: `shared/layout.js` — sidebar en acordeón + colapso responsivo

**Files:**
- Modify: `frontend/shared/layout.js` (reescritura completa del archivo)

**Interfaces:**
- Consumes: `apiGet` (de `shared/api.js`, ya cargado antes que `layout.js` en cada página).
- Produces (funciones/globals para Task 6):
  - `window.LayoutSidebar.render(activeTipo: string|null)` — vuelve a pintar el sidebar marcando como activo el ítem cuyo `tipo` coincide (o `'inicio'` para la vista dashboard).
  - Mantiene `initLayout(activeKey)` como entrypoint (llamado igual que hoy desde cada HTML), pero `activeKey` ahora es opcional/informativo para páginas legadas — el shell (Task 9) usa `LayoutSidebar.render(tipo)` dinámicamente.
- Nota de integración con Task 5 (header): esta tarea dejafunción `initLayout` lista para que Task 5 añada el bloque del header dentro del mismo archivo — se hacen en el mismo archivo pero como checkpoints separados para poder revisar el sidebar de forma aislada primero.

- [ ] **Step 1: Reemplazar todo el contenido de `frontend/shared/layout.js`**

```js
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
    <div class="sidebar-overlay" id="sidebar-overlay"></div>`

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
}
```

- [ ] **Step 2: Verificación visual manual**

Correr el servidor (`npm run dev`), abrir `http://localhost:<puerto>/index.html` (Clientes — página legada, sin `#panel-central`) en el navegador:
- El sidebar debe mostrar: Inicio, Tributarios ▾ (con IVA ▾ anidado dentro), Comercial ▾, Ranking ▾ (con Análisis ▾ anidado), Comparativos ▾.
- Click en "Tributarios" despliega sus hijos; click en "IVA" dentro despliega Mensual/Anual/Por Cliente/Estado.
- El botón ⇤ junto al logo colapsa el sidebar a solo íconos y lo recuerda tras recargar la página (F5).
- En una ventana angosta (<900px, o devtools responsive) el sidebar se sigue comportando como antes: oculto con overlay al abrir con el botón ☰.
- Click en cualquier ítem con `tipo` (ej. "Por Cliente") — como no existe `#panel-central` en esta página ni `ShellRouter` todavía, debe navegar a `/dashboard.html` (se verá el dashboard viejo por ahora — se reemplaza en Task 9).

Expected: todo lo anterior se cumple, sin errores en consola.

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/layout.js
git commit -m "feat(frontend): sidebar en acordeón anidado + colapso responsivo en layout.js"
```

---

### Task 5: `shared/layout.js` — header (cliente activo, Conectar, badge, filtro global)

**Files:**
- Modify: `frontend/shared/layout.js` (agregar al `initLayout` existente de Task 4)

**Interfaces:**
- Consumes: `window.ShellState` (Task 2), `apiGet`/`apiPost` (`shared/api.js`), `rangoMesAnioHtml`/`inicializarRangoMesAnio`/`leerRangoMesAnio`/`validarRangoMesAnio` (`shared/rango.js` — debe cargarse antes que `layout.js` en el shell), `showToast` (`shared/toast.js`).
- Produces (globals para Task 6):
  - `window.LayoutHeader.setBadge(estado: 'conectado'|'sincronizando'|'sin-datos')`
  - `window.LayoutHeader.setProgreso(pct: number|null)` — `null` oculta la barra de progreso
  - Dispara evento custom `window.dispatchEvent(new CustomEvent('shell:conectar'))` cuando se presiona "Conectar" — Task 6 escucha este evento.

- [ ] **Step 1: Agregar el bloque de header dentro de `initLayout`, solo cuando `esShell` es true**

Modificar el `root.innerHTML = ...` de `initLayout` (Task 4, Step 1) agregando el header como hermano del `<aside class="sidebar">`. Reemplazar el bloque completo `root.innerHTML = ...` por:

```js
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
        <select id="topbar-select-cliente"><option value="">Cargando clientes...</option></select>
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
```

- [ ] **Step 2: Después del bloque de colapso de sidebar (antes del cierre de `initLayout`), agregar la inicialización del header**

Agregar al final de `initLayout`, antes del cierre de la función:

```js
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
      clientes.map((c) => `<option value="${c.id}">${c.nombre}</option>`).join('')
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
```

- [ ] **Step 3: Verificación visual manual**

Esta tarea todavía no tiene `#panel-central` en ninguna página (llega en Task 9), así que para probarla de forma aislada: crear temporalmente un `<div id="panel-central"></div>` dentro de `index.html` (solo para la prueba, revertir después de verificar) y cargar `shared/shell-state.js` + `shared/rango.js` antes que `shared/layout.js`. Recargar la página y confirmar:
- Aparece el header arriba con el selector de cliente (poblado con los clientes reales), el botón "⚡ Conectar" y el badge "Sin datos".
- Debajo aparece la barra de filtro global con Mes/Año inicio y fin, más los 3 botones de exportar.
- Cambiar el cliente en el dropdown no tira errores en consola (aunque todavía no repinta nada — eso es Task 6).
- Cambiar el rango de fechas no tira errores.
- Click en "Conectar" no tira errores (el evento `shell:conectar` se dispara pero nadie lo escucha todavía).

Expected: sin errores en consola, todos los controles visibles y con datos reales cargados (clientes). Revertir el `<div id="panel-central">` de prueba antes de continuar (no commitear ese cambio).

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/layout.js
git commit -m "feat(frontend): header con cliente activo, Conectar, badge y filtro global en layout.js"
```

---

### Task 6: `shared/shell-router.js` — orquestador de vistas

**Files:**
- Create: `frontend/shared/shell-router.js`

**Interfaces:**
- Consumes: `window.ShellState` (Task 2), `window.LayoutSidebar.render(tipo)` (Task 4), `window.LayoutHeader.setBadge/setProgreso` (Task 5), evento `shell:conectar` (Task 5), y de `reportes.js` (Task 7): `window.ReportesEngine.CATALOGO`, `window.ReportesEngine.mostrarReporte(tipo)`, `window.ReportesEngine.ejecutarInformeReal(clienteId, rango)`; de `dashboard.js` (Task 8): `window.DashboardBI.mostrar()`, `window.DashboardBI.conectar()`.
- Produces (global `window.ShellRouter`, usado por `layout.js` Task 4 y por `dashboard.html` Task 9):
  - `mostrarDashboard(): void`
  - `mostrarReporte(tipo: string): void`
  - `init(): void` — se llama una vez al cargar `dashboard.html`; revisa `sessionStorage.iva_tipo_pendiente` (dejado por una página legada, Task 4) y abre esa vista si existe, si no muestra el dashboard.

- [ ] **Step 1: Crear el archivo**

```js
/**
 * Orquesta qué vista se pinta en #panel-central (dashboard o un reporte de
 * reportes.js) sin recargar la página, y qué hace el botón "Conectar" del
 * header según la vista activa.
 */
const ShellRouter = (() => {
  let vistaActiva = 'dashboard' // 'dashboard' | tipo de CATALOGO

  function _mostrarContenedor(nombre) {
    document.getElementById('vista-dashboard').hidden = nombre !== 'dashboard'
    document.getElementById('vista-reporte').hidden = nombre !== 'reporte'
  }

  function mostrarDashboard() {
    vistaActiva = 'dashboard'
    _mostrarContenedor('dashboard')
    window.LayoutSidebar.render(null)
    window.DashboardBI.mostrar()
  }

  function mostrarReporte(tipo) {
    if (!window.ReportesEngine.CATALOGO[tipo]) return
    vistaActiva = tipo
    _mostrarContenedor('reporte')
    window.LayoutSidebar.render(tipo)
    window.ReportesEngine.mostrarReporte(tipo)
  }

  function _onConectar() {
    if (vistaActiva === 'dashboard') {
      window.DashboardBI.conectar()
      return
    }
    const reporte = window.ReportesEngine.CATALOGO[vistaActiva]
    if (reporte && reporte.fuente === 'proceso') {
      showToast('Este reporte no depende de un cliente activo — usa el botón "Generar" del propio reporte', 'info')
      return
    }
    const clienteId = window.ShellState.getClienteId()
    if (!clienteId) { showToast('Selecciona un cliente primero', 'error'); return }
    window.ReportesEngine.ejecutarInformeReal(clienteId, window.ShellState.getRango())
  }

  function init() {
    window.addEventListener('shell:conectar', _onConectar)
    window.ShellState.onCambio(() => {
      if (vistaActiva === 'dashboard') window.DashboardBI.mostrar()
      else {
        const reporte = window.ReportesEngine.CATALOGO[vistaActiva]
        if (reporte && reporte.fuente !== 'proceso') window.ReportesEngine.mostrarReporte(vistaActiva)
      }
    })

    const tipoPendiente = sessionStorage.getItem('iva_tipo_pendiente')
    if (tipoPendiente) {
      sessionStorage.removeItem('iva_tipo_pendiente')
      if (tipoPendiente === '') mostrarDashboard()
      else mostrarReporte(tipoPendiente)
      return
    }
    mostrarDashboard()
  }

  return { mostrarDashboard, mostrarReporte, init }
})()

window.ShellRouter = ShellRouter
```

- [ ] **Step 2: Verificación**

Este módulo depende de `ReportesEngine` (Task 7) y `DashboardBI` (Task 8), que todavía no existen — no es verificable de forma aislada. Se verifica end-to-end en Task 10. Por ahora, solo confirmar que el archivo no tiene errores de sintaxis: `node --check frontend/shared/shell-router.js`.

Run: `node --check frontend/shared/shell-router.js`
Expected: sin salida (sin errores de sintaxis).

- [ ] **Step 3: Commit**

```bash
git add frontend/shared/shell-router.js
git commit -m "feat(frontend): shell-router.js orquesta el swap de vistas sin recarga"
```

---

### Task 7: Adaptar `frontend/js/reportes.js` al shell

**Files:**
- Modify: `frontend/js/reportes.js:266-330` (elimina nav interno, ajusta referencias DOM)
- Modify: `frontend/js/reportes.js:334-357` (reemplaza `renderControlesInforme`)
- Modify: `frontend/js/reportes.js:942-988` (reemplaza `seleccionarReporte`/`init`/listeners de nav y popstate)
- Modify: `frontend/js/reportes.js` (final del archivo — exportar `window.ReportesEngine`)

**Interfaces:**
- Consumes: `window.ShellState.getClienteId()/getRango()` (Task 2).
- Produces (global `window.ReportesEngine`, usado por Task 6):
  - `CATALOGO` (el objeto ya existente, sin cambios de contenido)
  - `mostrarReporte(tipo: string): void` — antes se llamaba `seleccionarReporte`, se renombra en el export público mantiene el nombre interno.
  - `ejecutarInformeReal(clienteId: number, rango): Promise<void>` — dispara sync real al SII (antes vivía dentro de `renderControlesInforme`, ahora es invocable desde el header).

**Nota de diseño importante:** cada tipo con `fuente: 'informe'` es solo una proyección distinta del MISMO objeto de datos (`d.meses`, `d.por_anio`, `d.top_proveedores`, etc. del informe generado para un cliente+rango) — no hay que volver a pedir datos por cada tipo. `'iva-por-cliente'` es la única excepción (`fuente: 'proceso'`): compara TODOS los clientes en un único período, no depende del cliente activo — su control local (mes/año + botón "Generar", ya existente en `renderControlesProceso`) se mantiene intacto sin cambios, tal como ya funciona hoy.

- [ ] **Step 1: Eliminar el nav interno — reemplazar líneas 266-330**

El bloque `CATEGORIAS` (líneas 270-320) y las constantes de nav ya no se usan (el sidebar de `layout.js` los reemplaza). Reemplazar todo el rango de líneas 266-330 (desde el comentario `// Centro de Reportes: categorías...` hasta `let chartInstancia = null`) por:

```js
const $titulo = document.getElementById('reporte-titulo')
const $controles = document.getElementById('reporte-controles')
const $progress = document.getElementById('progress-section')
const $progressLabel = document.getElementById('progress-label')
const $resultado = document.getElementById('reporte-resultado')

let tipo = null
let reporte = null
let ultimoDato = null
let chartInstancia = null
```

- [ ] **Step 2: Reemplazar `renderControlesInforme` (líneas 334-357) por la versión cache-first**

```js
function renderControlesInforme() {
  $controles.innerHTML = ''
  const clienteId = window.ShellState.getClienteId()
  if (!clienteId) {
    $resultado.innerHTML = `<div class="empty-state"><p>Selecciona un cliente en la barra superior para ver este reporte.</p></div>`
    return
  }
  cargarInformeCacheado(clienteId, window.ShellState.getRango())
}

function _cubreRango(informe, r) {
  const inicioOk = informe.anio_inicio < r.anioInicio ||
    (informe.anio_inicio === r.anioInicio && informe.mes_inicio <= r.mesInicio)
  const finOk = informe.anio_fin > r.anioFin ||
    (informe.anio_fin === r.anioFin && informe.mes_fin >= r.mesFin)
  return inicioOk && finOk
}

async function cargarInformeCacheado(clienteId, r) {
  $resultado.innerHTML = `<div class="empty-state"><p>Cargando…</p></div>`
  try {
    const lista = await apiGet(`/api/informe?cliente_id=${clienteId}&limit=1`)
    const ultimo = lista.informes && lista.informes[0]
    if (ultimo && ultimo.estado === 'completado' && _cubreRango(ultimo, r)) {
      const data = await apiPost(`/api/informe/${ultimo.id}/cargar`, {})
      ultimoDato = data
      renderReporte(data)
    } else {
      $resultado.innerHTML = `<div class="empty-state"><p>Sin datos sincronizados para este cliente y período — presiona "Conectar" en la barra superior.</p></div>`
    }
  } catch (err) {
    $resultado.innerHTML = `<div class="empty-state"><p>Sin datos todavía — presiona "Conectar" en la barra superior.</p></div>`
  }
}

async function ejecutarInformeReal(clienteId, r) {
  window.LayoutHeader.setBadge('sincronizando')
  window.LayoutHeader.setProgreso(0)
  $progress.hidden = false
  try {
    const data = await apiPost('/api/informe/generar', {
      cliente_id: Number(clienteId), anio_inicio: r.anioInicio, anio_fin: r.anioFin,
      mes_inicio: r.mesInicio, mes_fin: r.mesFin, modo: 'resumen',
    })
    iniciarPolling(
      () => apiGet(`/api/informe/${data.informe_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          $progressLabel.textContent = `Consultando SII... ${estado.procesados} de ${estado.total} (${pct}%)`
          window.LayoutHeader.setProgreso(pct)
          if (estado.estado === 'completado') {
            $progress.hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('conectado')
            ultimoDato = estado
            if (tipo && reporte && reporte.fuente === 'informe') renderReporte(estado)
            showToast('Datos actualizados')
          } else if (estado.estado === 'error') {
            $progress.hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('sin-datos')
            showToast(estado.error_msg || 'Error al sincronizar', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    $progress.hidden = true
    window.LayoutHeader.setProgreso(null)
    window.LayoutHeader.setBadge('sin-datos')
    showToast(err.message, 'error')
  }
}
```

- [ ] **Step 3: Reemplazar `seleccionarReporte`/`init`/listeners de nav y popstate (líneas 942-988) por**

```js
function seleccionarReporte(nuevoTipo) {
  if (!CATALOGO[nuevoTipo]) return
  tipo = nuevoTipo
  reporte = CATALOGO[tipo]

  document.title = `${reporte.titulo} — IVA Mensual`
  $titulo.textContent = reporte.titulo
  $progress.hidden = true
  $resultado.innerHTML = ''

  if (reporte.esInfo) {
    $controles.innerHTML = ''
    renderInfoExportaciones()
    return
  }

  if (reporte.fuente === 'proceso') renderControlesProceso()
  else renderControlesInforme()
}
```

(Se elimina `init()`, el `window.addEventListener('popstate', ...)` y el listener de `document.addEventListener('click', ...)` que cerraba los desplegables del nav interno — ya no existe ese nav; el cierre de los desplegables del sidebar nuevo lo maneja `layout.js`.)

- [ ] **Step 4: Exportar la API pública al final del archivo**

Agregar al final de `frontend/js/reportes.js`:

```js
window.ReportesEngine = {
  CATALOGO,
  mostrarReporte: seleccionarReporte,
  ejecutarInformeReal,
}
```

- [ ] **Step 5: Verificación de sintaxis**

Run: `node --check frontend/js/reportes.js`
Expected: sin salida (sin errores de sintaxis). La verificación funcional completa (que un reporte realmente se vea) ocurre en Task 10 una vez montado el shell completo en Task 9.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/reportes.js
git commit -m "refactor(frontend): adaptar reportes.js al shell — quita nav interno, agrega carga cache-first"
```

---

### Task 8: Reescribir `frontend/js/dashboard.js` — landing tipo Power BI

**Files:**
- Modify: `frontend/js/dashboard.js` (reescritura completa)

**Interfaces:**
- Consumes: `window.ShellState.getClienteId()/getRango()` (Task 2), `window.LayoutHeader.setBadge/setProgreso` (Task 5), `fmt`/`fmtCorto` (`shared/format.js`), `showToast` (`shared/toast.js`), `apiGet`/`apiPost`/`iniciarPolling` (`shared/api.js`).
- Produces (global `window.DashboardBI`, usado por Task 6):
  - `mostrar(): void` — carga cache-first (igual patrón que reportes.js) y pinta KPIs + gráficos.
  - `conectar(): void` — fuerza sync real al SII y repinta al completar.

- [ ] **Step 1: Reemplazar todo el contenido de `frontend/js/dashboard.js`**

```js
/**
 * Vista de aterrizaje (landing) del shell: 5 KPIs, barra Ventas vs Compras,
 * línea de evolución de IVA, y dona de compras por proveedor. Reutiliza la
 * MISMA respuesta de /api/informe (igual dato que consumen los reportes de
 * reportes.js) — no hay cálculos nuevos en el backend.
 */
const COLOR_ACCENT = '#2563eb'
const COLOR_ACCENT_HOVER = '#3b82f6'
const COLOR_SUCCESS = '#10b981'
const COLOR_ERROR = '#ef4444'
const COLOR_TEXT_SECONDARY = '#94a3b8'
const COLOR_GRID = 'rgba(255,255,255,0.06)'
const COLORES_DONA = ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#10b981', '#f59e0b', '#94a3b8']

let _charts = {}
let _ultimoDato = null

function _chartDefaults() {
  return {
    plugins: { legend: { labels: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } } } },
    scales: {
      x: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' } }, grid: { color: COLOR_GRID } },
      y: { ticks: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' }, callback: (v) => fmtCorto(v) }, grid: { color: COLOR_GRID } },
    },
  }
}

function _destruirCharts() {
  Object.values(_charts).forEach((c) => c && c.destroy())
  _charts = {}
}

function _variacionPct(actual, previo) {
  if (!previo) return null
  return Math.round(((actual - previo) / Math.abs(previo)) * 1000) / 10
}

function _kpiHtml(icono, label, valor, variacion) {
  const tendenciaHtml = variacion === null ? '' : `
    <span class="kpi-tendencia ${variacion >= 0 ? 'kpi-tendencia-up' : 'kpi-tendencia-down'}">
      ${variacion >= 0 ? '▲' : '▼'} ${Math.abs(variacion)}%
    </span>`
  return `
    <div class="kpi-card kpi-card-bi">
      <div class="kpi-icono">${icono}</div>
      <div class="kpi-label">${label}</div>
      <div class="kpi-valor">${valor}</div>
      ${tendenciaHtml}
    </div>`
}

function _renderKPIs(data) {
  const r = data.resumen
  const meses = data.meses.filter((m) => m.estado === 'ok')
  const penultimo = meses.length > 1 ? meses[meses.length - 2] : null
  const ultimo = meses.length > 0 ? meses[meses.length - 1] : null

  const $grid = document.getElementById('kpi-grid')
  $grid.innerHTML = [
    _kpiHtml('💰', 'Ventas del Mes', fmt(r.ventas_neto), ultimo && penultimo ? _variacionPct(ultimo.ventas_neto, penultimo.ventas_neto) : null),
    _kpiHtml('🛒', 'Compras', fmt(r.compras_neto), ultimo && penultimo ? _variacionPct(ultimo.compras_neto, penultimo.compras_neto) : null),
    _kpiHtml('📤', 'IVA Débito', fmt(r.debito_fiscal), null),
    _kpiHtml('📥', 'IVA Crédito', fmt(r.credito_fiscal), null),
    _kpiHtml('⚖️', 'Resultado', r.iva_pagar < 0 ? `Remanente ${fmt(Math.abs(r.iva_pagar))}` : `A pagar ${fmt(r.iva_pagar)}`, null),
  ].join('')
}

function _renderGraficos(data) {
  const meses = data.meses.filter((m) => m.estado === 'ok')
  const labels = meses.map((m) => `${m.mes_nombre.slice(0, 3)} ${m.anio}`)

  _destruirCharts()
  const defaults = _chartDefaults()

  _charts.comparativo = new Chart(document.getElementById('chart-comparativo'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ventas', data: meses.map((m) => m.ventas_neto), backgroundColor: COLOR_ACCENT, borderRadius: 6 },
        { label: 'Compras', data: meses.map((m) => m.compras_neto), backgroundColor: COLOR_TEXT_SECONDARY, borderRadius: 6 },
      ],
    },
    options: {
      ...defaults,
      onClick: (evt, elementos) => {
        if (!elementos.length) return
        const m = meses[elementos[0].index]
        window.ShellState.setRango({ anioInicio: m.anio, mesInicio: m.mes, anioFin: m.anio, mesFin: m.mes })
      },
    },
  })

  _charts.ivaEvolucion = new Chart(document.getElementById('chart-iva-evolucion'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Débito Fiscal', data: meses.map((m) => m.debito_fiscal), borderColor: COLOR_ACCENT, tension: 0.3 },
        { label: 'Crédito Fiscal', data: meses.map((m) => m.credito_fiscal), borderColor: COLOR_SUCCESS, tension: 0.3 },
        { label: 'IVA a Pagar', data: meses.map((m) => m.iva_pagar), borderColor: COLOR_ERROR, tension: 0.3 },
      ],
    },
    options: defaults,
  })

  const proveedores = (data.top_proveedores || []).slice(0, 7)
  const $donaCard = document.getElementById('dash-card-dona')
  if (proveedores.length > 0) {
    $donaCard.hidden = false
    _charts.dona = new Chart(document.getElementById('chart-dona-proveedores'), {
      type: 'doughnut',
      data: {
        labels: proveedores.map((p) => p.razonSocial),
        datasets: [{ data: proveedores.map((p) => p.neto), backgroundColor: COLORES_DONA, borderWidth: 0 }],
      },
      options: {
        plugins: {
          legend: { position: 'right', labels: { color: COLOR_TEXT_SECONDARY, font: { family: 'Inter' }, boxWidth: 12 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}` } },
        },
      },
    })
  } else {
    $donaCard.hidden = true
  }
}

async function _pintar(data) {
  _ultimoDato = data
  document.getElementById('dash-empty').hidden = true
  document.getElementById('dash-content').hidden = false
  _renderKPIs(data)
  _renderGraficos(data)
}

function _mostrarVacio(mensaje) {
  document.getElementById('dash-empty').hidden = false
  document.getElementById('dash-content').hidden = true
  document.getElementById('dash-empty').querySelector('p').textContent = mensaje
}

function _cubreRango(informe, r) {
  const inicioOk = informe.anio_inicio < r.anioInicio ||
    (informe.anio_inicio === r.anioInicio && informe.mes_inicio <= r.mesInicio)
  const finOk = informe.anio_fin > r.anioFin ||
    (informe.anio_fin === r.anioFin && informe.mes_fin >= r.mesFin)
  return inicioOk && finOk
}

async function mostrar() {
  const clienteId = window.ShellState.getClienteId()
  if (!clienteId) {
    _mostrarVacio('Selecciona una empresa en la barra superior.')
    window.LayoutHeader.setBadge('sin-datos')
    return
  }
  const r = window.ShellState.getRango()
  try {
    const lista = await apiGet(`/api/informe?cliente_id=${clienteId}&limit=1`)
    const ultimo = lista.informes && lista.informes[0]
    if (ultimo && ultimo.estado === 'completado' && _cubreRango(ultimo, r)) {
      const data = await apiPost(`/api/informe/${ultimo.id}/cargar`, {})
      await _pintar(data)
      window.LayoutHeader.setBadge('conectado')
    } else {
      _mostrarVacio('Sin datos sincronizados para este cliente y período — presiona "Conectar".')
      window.LayoutHeader.setBadge('sin-datos')
    }
  } catch (err) {
    _mostrarVacio('Sin datos todavía — presiona "Conectar" para sincronizar con el SII.')
    window.LayoutHeader.setBadge('sin-datos')
  }
}

async function conectar() {
  const clienteId = window.ShellState.getClienteId()
  if (!clienteId) { showToast('Selecciona una empresa primero', 'error'); return }
  const r = window.ShellState.getRango()

  window.LayoutHeader.setBadge('sincronizando')
  window.LayoutHeader.setProgreso(0)
  document.getElementById('progress-section-dashboard').hidden = false

  try {
    const data = await apiPost('/api/informe/generar', {
      cliente_id: clienteId, anio_inicio: r.anioInicio, anio_fin: r.anioFin,
      mes_inicio: r.mesInicio, mes_fin: r.mesFin, modo: 'resumen',
    })
    iniciarPolling(
      () => apiGet(`/api/informe/${data.informe_id}/estado`),
      {
        onUpdate: (estado) => {
          const pct = estado.total > 0 ? Math.round((estado.procesados / estado.total) * 100) : 0
          window.LayoutHeader.setProgreso(pct)
          document.getElementById('progress-label-dashboard').textContent = `Consultando SII... ${estado.procesados} de ${estado.total} meses`
          if (estado.estado === 'completado') {
            document.getElementById('progress-section-dashboard').hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('conectado')
            _pintar(estado)
            showToast('Dashboard actualizado')
          } else if (estado.estado === 'error') {
            document.getElementById('progress-section-dashboard').hidden = true
            window.LayoutHeader.setProgreso(null)
            window.LayoutHeader.setBadge('sin-datos')
            showToast(estado.error_msg || 'Error al generar dashboard', 'error')
          }
        },
        esTerminal: (estado) => estado.estado === 'completado' || estado.estado === 'error',
      }
    )
  } catch (err) {
    document.getElementById('progress-section-dashboard').hidden = true
    window.LayoutHeader.setProgreso(null)
    window.LayoutHeader.setBadge('sin-datos')
    showToast(err.message, 'error')
  }
}

window.DashboardBI = { mostrar, conectar }
```

- [ ] **Step 2: Verificación de sintaxis**

Run: `node --check frontend/js/dashboard.js`
Expected: sin salida (sin errores de sintaxis). Verificación funcional en Task 10.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/dashboard.js
git commit -m "feat(frontend): reescribir dashboard.js — 5 KPIs, dona de proveedores, clic-para-filtrar"
```

---

### Task 9: `frontend/dashboard.html` como shell final + retirar `reportes.html`

**Files:**
- Modify: `frontend/dashboard.html` (reescritura completa)
- Delete: `frontend/reportes.html`

**Interfaces:**
- Consumes: todos los módulos de Tasks 2, 4, 5, 6, 7, 8.

- [ ] **Step 1: Reemplazar todo el contenido de `frontend/dashboard.html`**

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard — IVA Mensual</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/app.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js" integrity="sha384-NrKB+u6Ts6AtkIhwPixiKTzgSKNblyhlk0Sohlgar9UHUBzai/sgnNNWWd291xqt" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js" integrity="sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js" integrity="sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js" integrity="sha384-Xl/CUCfJbzsngMp0CFxkmF0VW/8C160IsGujqeQlIhaGxKz2+JsIGORFqtCPeldF" crossorigin="anonymous"></script>
</head>
<!-- Nota: estos 4 hashes SRI se calcularon con `curl | openssl dgst -sha384` sobre los archivos reales servidos por jsdelivr para estas versiones exactas — si alguna vez se sube la versión del paquete, hay que recalcular el hash o el navegador bloqueará el script. -->
<body>
  <div id="layout-root"></div>

  <main class="container container-wide" id="panel-central">
    <div id="vista-dashboard">
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Ventas, compras y margen — vista comparativa por período</p>
        </div>
      </div>

      <section class="progress-section" id="progress-section-dashboard" hidden>
        <div class="progress-header"><span id="progress-label-dashboard">Consultando SII...</span></div>
        <div class="progress-track"><div class="progress-fill progress-fill-indeterminate"></div></div>
      </section>

      <div id="dash-empty" class="empty-state">
        <p>Selecciona una empresa en la barra superior y presiona "Conectar".</p>
      </div>

      <div id="dash-content" hidden>
        <section class="kpi-grid" id="kpi-grid"></section>

        <section class="dash-grid">
          <div class="dash-card dash-card-wide">
            <h3>Comparativo Ventas vs Compras</h3>
            <div class="chart-wrap"><canvas id="chart-comparativo"></canvas></div>
          </div>
          <div class="dash-card dash-card-wide">
            <h3>Evolución mensual de IVA</h3>
            <div class="chart-wrap"><canvas id="chart-iva-evolucion"></canvas></div>
          </div>
          <div class="dash-card dash-card-dona" id="dash-card-dona" hidden>
            <h3>Compras por Proveedor</h3>
            <div class="chart-wrap"><canvas id="chart-dona-proveedores"></canvas></div>
          </div>
        </section>
      </div>
    </div>

    <div id="vista-reporte" hidden>
      <h2 id="reporte-titulo">Selecciona un reporte</h2>
      <section class="informe-controls" id="reporte-controles"></section>
      <section class="progress-section" id="progress-section" hidden>
        <div class="progress-header"><span id="progress-label">Consultando...</span></div>
        <div class="progress-track"><div class="progress-fill progress-fill-indeterminate"></div></div>
      </section>
      <div id="reporte-resultado"></div>
    </div>
  </main>

  <div class="toast" id="toast" hidden></div>
  <script src="/shared/format.js"></script>
  <script src="/shared/toast.js"></script>
  <script src="/shared/api.js"></script>
  <script src="/shared/rango.js"></script>
  <script src="/shared/table.js"></script>
  <script src="/shared/filters.js"></script>
  <script src="/shared/export.js"></script>
  <script src="/shared/datagrid.js"></script>
  <script src="/shared/shell-state.js"></script>
  <script src="/shared/layout.js"></script>
  <script src="/js/dashboard.js"></script>
  <script src="/js/reportes.js"></script>
  <script src="/shared/shell-router.js"></script>
  <script>
    initLayout('inicio').then(() => window.ShellRouter.init())
  </script>
</body>
</html>
```

Nota: `initLayout` ya es `async function` (Task 4) por lo que devuelve una Promise — encadenar `.then()` asegura que el sidebar/header (y por lo tanto `LayoutSidebar`/`LayoutHeader`) existan en el DOM antes de que `ShellRouter.init()` intente usarlos.

- [ ] **Step 2: Eliminar `frontend/reportes.html`**

```bash
rm frontend/reportes.html
```

- [ ] **Step 3: Revisar enlaces rotos hacia `reportes.html`**

Buscar referencias que ya no deben apuntar a la página eliminada:

Run: `grep -rn "reportes.html" frontend/`

Actualizar cualquier resultado (por ejemplo, en `layout.js` de Task 4 el enlace `href="/reportes.html"` del NAV_ITEMS viejo ya fue reemplazado por el nuevo NAV_ITEMS con botones `data-tipo`, así que no debería quedar ninguno — si `grep` encuentra algo, reemplazar ese `href="/reportes.html"` por un botón `data-tipo` equivalente o por `href="/dashboard.html"`).

Expected: `grep` no encuentra resultados (o solo referencias en comentarios/docs, que no requieren cambio funcional).

- [ ] **Step 4: Commit**

```bash
git add frontend/dashboard.html
git rm frontend/reportes.html
git commit -m "feat(frontend): dashboard.html es el shell final; retira reportes.html (absorbida por el shell)"
```

---

### Task 10: Verificación manual end-to-end en navegador

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Levantar el servidor local**

Run: `npm run dev`
Expected: arranca sin errores, escuchando en el puerto configurado (revisar `.env`/consola para el puerto exacto).

- [ ] **Step 2: Flujo completo en el navegador**

Abrir `http://localhost:<puerto>/login.html`, iniciar sesión con un usuario real, y verificar en `/dashboard.html`:

1. El shell carga: header arriba (selector de cliente + Conectar + badge), barra de filtro global debajo, sidebar en acordeón a la izquierda, vista "Dashboard" al centro por defecto.
2. Seleccionar un cliente que **ya tenga** un informe sincronizado previamente (si no hay ninguno, usar "Conectar" primero) → el dashboard pinta 5 KPIs, gráfico comparativo, línea de IVA y la dona de proveedores, sin recargar la página.
3. Click en un ítem del sidebar (ej. Tributarios → Libro Venta) → el panel central cambia a esa vista sin parpadeo/recarga, con datos reales (cache-first, instantáneo si ya había informe).
4. Click en "Comercial → Proveedores", luego en "Ranking → Análisis → Anual", confirmando que cada reporte pinta tabla/gráfico/exportar correctamente y que el sidebar marca el ítem activo.
5. Click en "Tributarios → IVA → Por Cliente" → debe mostrar su propio selector de Mes/Año + botón "Generar" embebido (no depende del cliente activo del header) — confirmar que sigue funcionando igual que antes de este cambio.
6. Cambiar el rango de Año/Mes en la barra de filtro global mientras se ve un reporte → repinta con los datos cacheados si cubren el nuevo rango, o muestra el estado vacío invitando a Conectar si no.
7. Presionar "Conectar" → dispara sync real al SII (progreso visible bajo el header), badge pasa a "Sincronizando…" y luego a "Conectado", la vista activa se repinta con datos frescos al terminar.
8. Click en "Exportar CSV/Excel/PDF" desde un reporte con tabla → descarga el archivo correctamente (reutiliza `export.js` sin cambios).
9. Achicar la ventana del navegador a ~1280px de ancho (simulando laptop 13"/14") y usar el botón de colapso del sidebar (⇤) → el sidebar se reduce a riel de íconos con tooltips al hover, y el panel central gana espacio horizontal. Recargar la página (F5): el sidebar debe seguir colapsado (persistido).
10. Achicar a <900px de ancho → el sidebar vuelve al comportamiento móvil (oculto + botón ☰ + overlay), sin mezclarse con el modo colapsado de escritorio.
11. Abrir `index.html` (Clientes) directamente → debe mostrar el mismo sidebar acordeón (sin header, ya que no tiene `#panel-central`); hacer click en un reporte del sidebar (ej. "Resumen") → debe navegar de verdad a `/dashboard.html` y abrir esa vista automáticamente al cargar.
12. Revisar la consola del navegador durante todo el flujo: no debe haber errores de JS.

Expected: todos los puntos anteriores se cumplen tal como se describen, sin errores en consola ni comportamientos rotos respecto a lo que ya funcionaba antes de este cambio (login, sync real al SII, exportaciones).

- [ ] **Step 3: Correr la suite de tests de backend completa**

Run: `node --test test/`
Expected: todos los tests pasan (incluye `calculos.test.js` sin cambios + `informe-listar.test.js` de Task 1).

- [ ] **Step 4: Reportar al usuario**

No hay commit en este paso — es el checkpoint final de verificación antes de coordinar el deploy al VPS (fuera del alcance de este plan, spec §11).

---

## Self-Review

**Cobertura de la spec:**
- Arquitectura shell sin recarga (spec §3) → Tasks 6, 9.
- Header: cliente/Conectar/badge, cache-first vs sync real (spec §4) → Tasks 5, 7 (`cargarInformeCacheado`/`ejecutarInformeReal`), 8 (`mostrar`/`conectar`).
- Filtro global Año/Mes persistente (spec §5) → Tasks 2, 5.
- Sidebar acordeón con nombres exactos (spec §6) → Task 4.
- Sidebar colapsable responsivo (spec §6, feedback del usuario) → Tasks 3, 4.
- Vista Dashboard con 5 KPIs + dona nueva + clic-para-filtrar (spec §7) → Task 8.
- Vista de reporte genérica reutilizada (spec §8) → Task 7 (sin reescribir el motor existente).
- Manejo de errores / sin clientes / sesión expira (spec §9) → cubierto por comportamiento ya existente de `layout.js`/`api.js`, no requiere tarea nueva.
- Cambio de backend mínimo (spec §10) → Task 1.
- Verificación local antes de VPS (spec §11) → Task 10.

**Consistencia de tipos/nombres verificada:** `window.ShellState` (Task 2) se consume igual en Tasks 5, 6, 7, 8. `window.LayoutSidebar.render(tipo)` (Task 4) y `window.LayoutHeader.setBadge/setProgreso` (Task 5) se consumen igual en Task 6/7/8. `window.ReportesEngine.{CATALOGO, mostrarReporte, ejecutarInformeReal}` (Task 7) coincide exactamente con lo que consume Task 6. `window.DashboardBI.{mostrar, conectar}` (Task 8) coincide con Task 6.

**Sin placeholders:** todos los pasos de código tienen implementación completa, no hay "TODO"/"implementar después".
