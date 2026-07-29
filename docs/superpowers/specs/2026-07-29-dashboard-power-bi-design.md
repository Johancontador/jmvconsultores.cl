# Rediseño de Dashboard/Landing tipo Power BI — Spec

**Fecha:** 2026-07-29
**Estado:** Aprobado por el usuario, pendiente de implementación
**Despliegue actual:** VPS en `http://100.116.109.54:3500/login.html` (acceso vía `ssh -i ~/.ssh/id_geodaniela johan@100.116.109.54`, app en `/home/johan/apps/iva-mensual`). Este ciclo trabaja primero en local; el deploy al VPS es un paso posterior, no cubierto por esta spec.

## 1. Contexto

La app `iva-mensual` es un sistema real y funcional: login por sesión (cookie), backend Node/Express con SQLite, y consultas reales al SII (Servicio de Impuestos Internos, Chile) para generar informes de IVA por cliente/período. El backend y los datos **funcionan correctamente** — el problema es puramente de interfaz: hoy son páginas HTML sueltas, sin header, sin densidad visual, con navegación que recarga la página completa y un submenú de reportes escondido dentro de una página secundaria.

Objetivo: reconstruir la experiencia visual como un dashboard denso, moderno, estilo Power BI/Tableau — con header de cliente activo, sidebar en acordeón, y un panel central que cambia de vista sin recargar la página — **sin tocar el login, la autenticación, ni la lógica de consulta al SII**, que ya funcionan.

## 2. Fuera de alcance

- `login.html` — sin cambios, es la frontera de autenticación.
- `index.html` (gestión de Clientes/CRUD), `configuracion.html`, `proceso.html` (proceso mensual manual) — quedan como páginas separadas de hoy, enlazadas desde el sidebar igual que ahora. No estaban en el pedido original.
- No se agregan reportes nuevos ni se modifica el cálculo de ningún dato — todo el redisño reutiliza los endpoints y tipos de reporte que ya existen en `backend/routes/informe.js` y `frontend/js/reportes.js`.
- No se agrega modo claro — se pule/extiende el tema oscuro slate/índigo ya existente en `app.css`.
- No se migra a un framework (React/Vue) ni a HTMX/Alpine — el "sin recarga" se logra con fetch + JS vanilla, generalizando el patrón que `reportes.js` ya usa hoy internamente para cambiar de reporte sin recargar.

## 3. Arquitectura: shell único con panel central dinámico

`dashboard.html` pasa a ser el **shell de la aplicación**: Header + Sidebar fijos, inyectados una sola vez, y un contenedor central (`#panel-central`) que se repinta con JS cada vez que el usuario:
- hace clic en un ítem del sidebar (cambia de reporte),
- cambia cliente activo en el header,
- cambia el filtro global de Año/Mes,
- presiona "Conectar".

Un router liviano en JS (nuevo archivo `frontend/shared/shell-router.js`) mapea cada ítem del sidebar a una función de vista. Cada vista (dashboard landing o un reporte específico) es responsable de pedir sus datos vía `fetch`/`apiGet` a los endpoints que **ya existen** y renderizar dentro de `#panel-central`, reutilizando el motor de render que hoy vive en `reportes.js` (tablas, gráficos, filtros, export) — no se reescribe esa lógica, se le da un nuevo home.

Las páginas de reportes individuales (`reportes.html`) y el dashboard viejo (contenido actual de `dashboard.html`) se consolidan en este shell; `reportes.html` como página independiente queda obsoleta y se elimina (su lógica de render por `tipo` se traslada a `shared/shell-router.js` + `js/dashboard.js`).

Navegar entre secciones NO cambia la URL de forma tradicional (no hay recarga); se usa el estado del sidebar (clase `active`) para reflejar la vista actual. Al recargar la página (F5) siempre se vuelve a la vista Dashboard (landing) — no se persiste la sub-vista, sólo el cliente activo y el filtro Año/Mes (ver §4 y §5).

## 4. Header — cliente activo, sincronización, estado

Elementos, de izquierda a derecha: selector de cliente (dropdown buscable), botón "Conectar", badge de estado.

**Cambiar cliente en el dropdown:**
1. Guarda el `cliente_id` activo en `sessionStorage` (persiste mientras dure la sesión del navegador, sin volver a pedir selección en cada F5).
2. Llama a `GET /api/informe?cliente_id=...` *(el endpoint actual no filtra por cliente — se agrega ese filtro opcional en el backend, único cambio de backend en toda esta spec)* para buscar el informe completado más reciente de ese cliente.
3. Si existe, lo carga con `POST /api/informe/:id/cargar` (lee de BD, no toca el SII — respuesta inmediata) y repinta la vista central activa con esos datos.
4. Si no existe ningún informe previo para ese cliente, el panel central muestra un estado vacío: *"Sin datos para este cliente — presiona Conectar para sincronizar con el SII"*.

**Botón "Conectar / Sincronizar":**
- Dispara `POST /api/informe/generar` (consulta real al SII) para el cliente y rango Año/Mes activos — es la misma llamada real que hoy hace `btn-generar` en el dashboard viejo, solo que ahora vive en el header y es accesible desde cualquier vista.
- Mientras corre, muestra una barra de progreso compacta bajo el header (reutiliza el polling de `iniciarPolling` en `shared/api.js`), sin bloquear la navegación a otras secciones.
- Al completar, repinta automáticamente la vista central que esté abierta en ese momento con los datos frescos.

**Badge de estado**, tres estados visuales (color + texto):
- 🟢 **Conectado** — hay datos cargados para el cliente activo.
- 🟡 **Sincronizando…** — hay una consulta al SII en curso.
- ⚪ **Sin datos** — no hay ningún informe cargado todavía para el cliente activo.

## 5. Barra de filtros global (Año/Mes + Exportar)

Fija justo debajo del header, dentro del shell (no se destruye/recrea al cambiar de vista — mismo trato que el header). Cambiar Año/Mes:
1. Se guarda en `sessionStorage` (mismo criterio que el cliente activo).
2. Repite el mismo flujo del §4 (busca informe cacheado que cubra ese rango; si no existe, estado vacío invitando a "Conectar").

El botón **Exportar** (PDF/Excel/CSV, reutilizando `shared/export.js` tal cual funciona hoy) es contextual: exporta lo que esté visible en `#panel-central` en ese momento — la vista Dashboard exporta un resumen ejecutivo; una vista de reporte exporta su tabla.

## 6. Sidebar — acordeón, mapeo exacto a reportes existentes

Estructura visual y nombres exactamente como los pidió el usuario. Mapeo interno a los `tipo` que ya existen en `reportes.js` (`CATEGORIAS`), sin perder ningún reporte actual:

```
Tributarios
├── IVA ▾
│   ├── Mensual        → iva-mensual
│   ├── Anual          → iva-anual
│   ├── Por Cliente    → iva-por-cliente
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

Nota: los tipos `comparativo-mensual` / `comparativo-anual` (hoy dentro de "Análisis → Comparativos") no tienen un ítem propio en la nueva estructura porque su contenido — Ventas vs Compras vs Margen por mes/año — queda cubierto por el gráfico comparativo que ya vive en la vista Dashboard (§7). No se pierde funcionalidad, se evita duplicar la misma comparación en dos lugares.

**Responsivo / colapso:**
- **≥ 900px (desktop/laptop):** el sidebar tiene un botón de colapso manual (icono, junto al logo) que lo reduce a un riel de solo-íconos (con tooltip al hover mostrando el label), dejando más espacio horizontal al panel central en pantallas de 13"/14". Estado persistido en `localStorage` (se recuerda entre sesiones).
- **< 900px (mobile):** se mantiene el comportamiento actual — sidebar oculto por defecto, overlay a pantalla completa al abrir (sin cambios sobre lo que ya funciona en `layout.js`).

## 7. Vista Dashboard (landing por defecto)

Vista que se muestra al entrar y al hacer clic en el logo/"Inicio". Contenido:

- **5 tarjetas KPI**, cada una con ícono, valor y variación % vs el período anterior dentro del mismo rango: Ventas del Mes (`ventas_neto`), Compras (`compras_neto`), IVA Débito (`debito_fiscal`), IVA Crédito (`credito_fiscal`), Resultado (`iva_pagar`, mostrando "a pagar" o "remanente" según signo).
- **Grid de gráficos** (Chart.js, ya usado en el proyecto):
  - Barras: Ventas vs Compras por mes (reemplaza conceptualmente a `comparativo-mensual`, ver nota §6).
  - Línea: evolución mensual de IVA (débito/crédito/a pagar).
  - **Dona (nueva):** distribución de compras por proveedor, usando el mismo dato que ya sirve el reporte `top-proveedores` — sin cálculo nuevo en backend.
- **Interactividad:** tooltip al hover en todos los gráficos (default de Chart.js, ya se usa); clic en una barra/punto de un mes ajusta el filtro global de Mes (§5) y repinta la vista con ese mes.

## 8. Vista de Reporte (genérica, reutilizada por todos los ítems del sidebar)

Mismo patrón visual para cualquier reporte seleccionado en el sidebar: tabla (reusa `shared/datagrid.js`/`shared/table.js` tal cual existen), gráfico cuando el tipo de reporte lo define (ya definido por `chart` en cada entrada de `reportes.js`), y el botón Exportar de la barra global (§5). El filtro Año/Mes es el global del shell — no hay un filtro adicional por reporte como hoy.

## 9. Manejo de errores

- Sin clientes registrados: el dropdown de cliente muestra "Sin clientes — agrega uno primero" y enlaza a la gestión de clientes (fuera de alcance, página existente).
- Falla la consulta al SII al presionar Conectar: toast de error (reutiliza `shared/toast.js`), badge vuelve a "Sin datos" o al último estado válido si había uno.
- Sesión expira en cualquier momento: mismo comportamiento actual de `layout.js` (`apiGet('/api/auth/me')` falla → redirige a `login.html`), sin cambios.

## 10. Archivos afectados (estimado, se detalla en el plan de implementación)

- `frontend/dashboard.html` — se convierte en el shell (header + sidebar + `#panel-central`).
- `frontend/shared/layout.js` — se extiende para incluir el header (cliente/conectar/badge) y el colapso de sidebar; sidebar pasa de lista plana a estructura de acordeón.
- `frontend/shared/shell-router.js` — **nuevo**, orquesta el swap de vistas sin recarga.
- `frontend/js/dashboard.js` — se reescribe: KPIs (5), gráficos incluida la dona, interactividad de clic-para-filtrar.
- `frontend/js/reportes.js` — se reutiliza su `CATEGORIAS`/lógica de render por `tipo`, adaptada para ser invocada desde el shell en vez de una página propia.
- `frontend/reportes.html` — se elimina (absorbida por el shell).
- `frontend/css/app.css` — nuevas clases para header, badge, dona, sidebar colapsable/riel; se extiende el sistema de variables existente, no se reemplaza.
- `backend/routes/informe.js` — un cambio menor: filtro opcional `cliente_id` en `GET /api/informe`.

## 11. Verificación

Antes de tocar el VPS: correr la app local (`iniciar.bat` o el flujo de dev existente), probar con datos reales de al menos un cliente ya sincronizado: cambio de cliente, cambio de filtro Año/Mes, botón Conectar (sync real), navegación por todos los ítems del sidebar, exportar PDF/Excel/CSV desde una vista de reporte y desde el dashboard, y colapso de sidebar en un viewport de ~1280px de ancho (simulando laptop 13"/14"). Recién después de validar todo esto localmente se coordina el deploy al VPS.
