# MASTERPLAN DE UNIFICACIÓN, ORDEN FUNCIONAL Y REDISEÑO UX/UI

> Fuente: `MASTERPLAN EJECUTABLE` (mandato oct-2026). Base verificada: commits
> `2e4bd5a` (auditoría), `6b59277` (correcciones B2-B5), `c6c7806` (validación).
> Suite vigente: 332/332. Regla rectora: **adaptar, no reconstruir**. El frontend
> chain (`window.VIEWS`, `window.Tema`, helpers por script-orden) es el contrato.

---

## 1. MAPA FUNCIONAL ACTUAL (verificado en código, no en docs viejas)

### 1.1 Shell y contrato
- Shell: `frontend/sistema/index.html` carga `css/app.css` (tokens+tema) → `sistema/sistema.css` (layout) → 13 `views-*.js` → `app.js` (boot+MENU+navegación).
- Contrato rígido: `window.VIEWS.ir = render(cont)`; cada RENDER invocado por `app.navigate(hash)`. Breadcrumbs ya generados (`sys-header`). Los anchors # se resuelven con `resolverRouteKey` y el menú coincide con los keys reales (no hay redirects huérfanos hoy: `REDIRECCIONES_ANCHOR = {}`).
- Estado in-memory en `S` (`shell-state.js`): empresa activa, permisos, período de trabajo, caché de catálogos (`cacheOnce`).

### 1.2 Matriz de pantallas (28 VIEWS reales)

| ID funcional | Vista (#anchor) | Grupo actual | Archivo | Endpoint principal | Permiso | Duplicaciones detectadas |
|---|---|---|---|---|---|---|
| F-INICIO | `#inicio` | Operación | views-fiscal.js | `GET /dashboard` | — (permiso específico) | 0 |
| F-ALERTAS | `#alertas` | Operación | views-alertas.js | `GET /alertas` | documentos:ver | 0 (pill reutiliza dashboard) |
| F-BANDEJA | `#documentos` | Operación | views-fiscal.js | `GET/POST/PUT/DELETE /documentos` | documentos:ver | toolbar manual repetida (comp. table.js disponible pero sin usar aquí) |
| F-CLIENTES-CC | `#cclientes` | Operación | views-crm.js | `GET /reportes/cuenta-corriente(rol=cliente)` | reportes:ver | (ver §1.3) |
| F-PROVEEDORES-CC | `#cproveedores` | Operación | views-crm.js | `GET /reportes/cuenta-corriente(rol=proveedor)` | reportes:ver | (ver §1.3) |
| F-COBRANZA | `#cobranza` | Operación | views-cobranza.js | `GET /cobranza` + POST pagada + POST aplicar | tesoreria:ver | 0 (superpone con cclientes conceptualmente, diferenciado) |
| F-LIBROS | `#libros` | SII y Tributación | views-fiscal.js | `GET /documentos/:flujo` + POST ingesta | documentos:ver | Tabla manual 2x (compras/ventas en tabs) duplicando bandeja de documentos (ver §1.3) |
| F-ANALITICA | `#analitica` | SII y Tributación | views-analitica.js | `GET /reportes/resumen-iva` | reportes:ver | 0 |
| F-ONBOARDING | `#onboarding` | SII y Tributación | views-onboarding.js | POST consultar-sii/confirmar/ingesta + estado | documentos:ver | 0 |
| DTE-EMISION | `#dte-emision` | Facturación | views-dte.js | POST /dte/emitir | dte:ver | 0 |
| DTE-BANDEJA | `#dte` | Facturación | views-dte.js | GET /dte/lista | dte:ver | 0 |
| DTE-CONFIG | `#dte-config` | Facturación | views-dte.js | GET/PUT /dte/config | dte:ver | 0 |
| CONTAB-AUTO | `#automatizacion` | Contabilidad | views-autom.js | GET/POST /automatizacion | propuestas:ver | 0. Reusa in-put de reglas de memoria |
| CONTAB-PROP | `#propuestas` | Contabilidad | views-conta.js | POST /propuestas/confirmar | propuestas:ver | 0 |
| CONTAB-ASIEN | `#asientos` | Contabilidad | views-conta.js | GET /asientos | asientos:ver | 0 |
| CONTAB-MEMORIA | `#memoria` | Contabilidad | views-autom.js? | (ver §1.4) | documentos:ver | — |
| TESO-BANCOS | `#tesoreria` | Tesorería | views-teso.js | GET/POST /tesoreria | tesoreria:ver | 0 |
| RECI-EXT | `#externos` | Centralizaciones | views-teso.js | asientos-externos | asientos:ver | 0 |
| ACTIVOS-DEP | `#activos` | Activos | views-activos.js | GET/POST /activos | activos:ver | 0 |
| REP-CENTRO | `#reportes` | Reportes | views-conta.js | — | reportes:ver | (ver §1.3) |
| REP-COMPB | `#comprobacion` | Reportes | views-conta.js | GET /reportes/balance_comprobacion | reportes:ver | — |
| REP-BAL8 | `#balance8` | Reportes | views-conta.js | GET /reportes/balance_8columnas | reportes:ver | — |
| REP-CLASF | `#clasificado` | Reportes | views-conta.js | GET /reportes/balance_clasificado | reportes:ver | — |
| REP-SIT | `#situacion` | Reportes | views-conta.js | GET /reportes/estado_situacion | reportes:ver | — |
| REP-RES | `#resultados` | Reportes | views-conta.js | GET /reportes/estado_resultados | reportes:ver | — |
| REP-NIIF | `#niif` | Reportes | views-niif.js | GET /reportes/niif | reportes:ver | — |
| CIERRE | `#cierre` | Cierre | views-conta.js | POST /cierre | reportes:ver | — |
| CRM | `#crm` | CRM (pipeline) | views-crm.js | /api/crm | empresas:ver | 0 |
| ADMIN | `#admin` | Empresa/Admin | views-suscripcion.js (admin?) | /api/contable/empresas (cuentas/config) | periodos:ver | — |
| AUDIT | `#auditoria` | Empresa/Auditoría | views-suscripcion.js | GET /api/auditoria | auditoria:ver | — |
| INTEG | `#integraciones` | Empresa/Integraciones | views-suscripcion.js | GET /api/integraciones? | empresas:ver | — |
| SUSCR | `#suscripcion` | Empresa/Suscripción | views-suscripcion.js | pagos/mercadopago | empresas:ver | — |

### 1.3 Duplicaciones y solapamientos (cinco niveles)

1. **Navegación**:
   - `#inicio` accede a reportes, libros, alertas y auditoría — enlaces aún dispersos con las mismas rutas (aceptable: accesos vs módulos).
   - `#cclientes` / `#cproveedores` (cuenta corriente) ↔ `#cobranza` (saldos de clientes): solapamiento en línea PERO distintos enfoques (CC listados vs cobranza por mora). **Resolución**: mantener ambas, coherencia visual.
2. **Interfaz**:
   - Manual-toolbars/tablas: 45 `<table>` con repetición de `frm-row`+toolbar. 58 `class="tbl"` (varias son etiqueta con distintos estilos). El proyecto ya posee `table.js` (ordenamiento+totales) y `datagrid.js` (agrupar/congelar/ocultar) prácticamente sin uso real en vistas (0 reference en views-*.js). **Es la duplicación más grande**: cada tabla redefine el mismo HTML.
   - Los IDs de toolbar variados (`lb-sync`, `dep-periodo`...) repiten patrón de período+botón con la misma estructura.
3. **Lógica frontend**:
   - `frontend/shared/filters.js`: función `aplicarFiltros` filtra docs por rut/folio/tipoDoc/exento. `datagrid.js` tiene su propia columna string buscando texto; ambos conviven sin referencias en views. Redundacia real.
   - `acciones copiar RUT/folio` existen como idea en uitoolkit (montar tabla con acciones), sin uso.
4. **Backend**: clean tras las Auditoría — no se detectan duplicados con endpoints reales en uso (49 wrap-once). Sin segunda conexión al SII (solo `services/sii-rcv.js` + `sii-session.js` autoritativos, reutilizados por ingesta, onboarding y DTE).
5. **Datos**: los catálogos (plan de cuentas, centros) van por `cacheOnce` — sin recálculos redundantes visibles.

### 1.4 Pendientes de verificación en B5
- `VIEWS.memoria` (dónde vive y su relación real con `memoria de contabilización` backend).
- Uso real de `uitoolkit.js` (nunca citado por las vistas).
- Cobertura de `layout.js` y `shell-router.js` (¿activos? o vestigio del shell anterior).

---

## 2. MAPA OBJETIVO DE NAVEGACIÓN (8 secciones del mandato §5)

```
Inicio          #inicio (dashboard + alertas + atajos + estado sincronización + jobs)
Empresas        #clientes | #cclientes | #cproveedores | #cobranza | #crm
Operación SII   #sii     (merge de #libros+ onboarding/tracking jobs)
Libros          #libros  (compras/ventas/unificada + detalle panel lateral)
IVA y Análisis  #analitica
Reportes        #reportes (centro con categorías Tributarios/Contables/Análisis)
                #comprobacion #balance8 #clasificado #situacion #resultados #niif
Tesorería       #tesoreria (+ cobranza integrada + pagos/aplicaciones trazables)
Facturación     #dte-emision | #dte | #dte-config
Contabilidad    #automatizacion | #propuestas | #asientos | #memoria | #externos | #activos
Herramientas    #calculadora-iva* (nueva él breve; usa export ya existente)
Config          #admin | #auditoria | #integraciones | #suscripcion | #cierre
```

*\* las herramientas «calculadora» se implementan SOLO si no duplica el centro de reportes; muestra la diferencia neta y desglose con lectura client-side del neto/iva/total.*

### Cambios de menú (único cambio real de navegación)
- Sección actual `Operación` (6 ítems) se divide en **Inicio + Empresas** (mandato §5 A/B).
- Sección `SII y Tributación` queda `Operación SII` (mantener onboarding, añadir estado de trabajos allí).
- No se eliminan views; solo se **reagrupa**, preservando cada anchor (regla de compatibilidad §36 HANDOFF ya desde app.js).

### Sistema visual (B2)
1. **Tokens**: ya existen en `css/app.css` (←de la landing). Solo ajustarlos: fondo `--bg-canvas` = "gris muy claro" claro default (light default), sidebar neutr oscuro según §3 del mandato.
2. **Tema**: ya implementado en `tema.js` con 3 estados + toggle CSS puro. Cambio pedido: default `light` cuando `prefers-color-scheme` no existe (al arrow function en tema.js: invertir el orden del marcador).
3. **Botones**: jerarquía ya existe (`btn-primary/secondary/ghost` en app.css).
4. **Iconos**: el shell es deliberadamente **sin iconos** (regla actual: izquierda e jerarquía tipográfica) — el uso de familia única es la decisión del proyecto; NO agregamos librería de iconos.

---

## 3. COMPONENTES COMPARTIDOS (B3) — bajados de shared/, activados de verdad

| Componente | Estado actual | Acción |
|---|---|---|
| `table.js renderTabla` | existe, sin uso | **Adoptar** en vistas tabulares simples (balances, cuentas vigentes) |
| `datagrid.js renderDataGrid` | existe, sin uso | Adoptar en la **Bandeja de Documentos** y **Libros** — congelar 1ª col, agrupar por tipo, ocultar columnas, totales filtrados, dobles click → detalle lateral |
| `filters.js renderFiltros/aplicarFiltros` | existe parcial (6 filtros fijos) | Extender: advanced-collapse, chips activos, contador de resultados, spinner, reset explícito |
| `uitoolkit UIForms` | existe sin uso | Adoptar en formularios de configuración |
| Nuevos: `chips`, `empty-state`, `spinner` (CSS puro) | — | clases CSS + helper `window.UIEstado = { chips, vacio, cargando }` |

**Regla de adopción**: solo en las vistas que REPLENICEN la operación diaria (Libros, Documentos, Reportes). Las views pequeñas (activos, suscripción...) conservan su markup manual funcional — no reescribir por estética.

---

## 4. DASHBOARD PRINCIPAL (B4)

`#inicio` YA calcula KPIs del período vía `/dashboard` (únicos datos confirmados: ingresos, gastos, resultado, IVA determinado, docs contabilizados, CxC/CxP). Acciones sobre el ya existente:

- **Añadir bloque "Trabajos y sincronización"** (nuevo): estado real de `jobs_persistentes` (pendientes/fallidos del período) + última sync (`sync_diaria` completada). Endpoint nuevo `GET /api/contable/empresas/:id/jobs/estado` → jobsp.listar(db,{empresaId}) con resumen. **Un solo fetch, sin repetir SII**.
- **No añadir KPIs ambiguos**: la "Diferencia débito-crédito" existe como IVA determinado — continuar denominación contable, agregamos aclaración de alcance (§8 del mandato: mostrar "IVA determinado provisional — NO incluye PPM ni retenciones").
- **Gráficos ya existen**: barras compras/ventas 6 meses + navegación (title). Añadir drill-through: clases `<a>` click → `#libros` del período (no nuevo gráfico).

---

## 5. CENTRO DE REPORTES (B4-B5)

Estado actual: la vista `#reportes` ya funciona como hub con tarjetas enlazadas + búsqueda si la hay. Acción:
1. Reorganizar en **3 categorías** reales: `Tributarios` (IVA, Libros CC, analítica) / `Contables` (comprobación, balance8, NIIF...) / `Análisis` (cuenta corriente, cobranza, CRM). Puede que el centro ya tenga categorización — se harmoniza.
2. Búsqueda/favoritos/recientes: **localStorage** (`jmv_fav_reports`, `jmv_recent_reports`) — sin backend.
3. Parámetros comunes: periodo de trabajo global (`rep-periodo-global` ya existe en views-conta).
4. Exportaciones: ya funcional, se mantienen verbatim.

---

## 6. ORDEN DE IMPLEMENTACIÓN

| Bloque | Contenido | Verificación de terminado |
|---|---|---|
| 1 | ✅ Este documento | generado |
| 2 | Menú agrupado (solo recatálogo del MENU), tema default light, contraste sidebar | anchors intactos; suite 332 sin regresión |
| 3 | Adoptar datagrid en Bandeja y Libros; filtros con chips+avanzado+cuentas de resultados | manual tests de las 2 vistas + sin errores |
| 4 | jobs/estado endpoint + bloque en #inicio + refinamiento centro reportes | sin consultas SII redundantes; suite estable |
| 5 | Dedupe: eliminar `REDIRECCIONES_ANCHOR` vacío si sigue vacío (mantener el mecanismo), fallback de filtros.js → unificado | Set de tests de regresión |
| 6 | Suite + informe final | todos los ítems §14 |

---

## 7. LÍMITES COMPROMETIDOS (no negociables)
- No tocar el contrato `window.VIEWS.ir = render(cont)`.
- No alterar cálculos contables (backend intacto salvo el endpoint nuevo `jobs/estado` de lectura pura).
- No renombrar anchors (HANDOFF §36).
- No mover las 13 vistas de ubicación de archivos (mantener carga por script).

---

## 8. EJECUCIÓN REALIZADA (commit de este documento)

| Bloque | Entregado | Verificación |
|---|---|---|
| 1 | Este documento (mapa actual + objetivo + duplicaciones) | — |
| 2 | MENU reorganizado en 9 secciones del mandato (33 items únicos, 0 pérdidas: 30 VIEWS todas con entrada); anchors intactos (`REDIRECCIONES_ANCHOR` sigue el mecanismo y sigue vacío) | verificación por script: keys únicos + cobertura 33/30; suite 332 sin regresión |
| 3 | `sistema/ui.js` NUEVO: `window.UIEstado {cargando, vacio, chip, error, calculadoraIvaHTML, conectarCalculadoraIva}` con escape HTML verificado; CSS de estados (.ui-loading/.ui-spin/.ui-empty/.ui-error) + chips de filtros activos + panel avanzado (details) | test ux-unificacion T2 (anti-inyección) |
| 4a | `GET /api/contable/empresas/:id/jobs/estado` NUEVO (lectura pura; RBAC documentos:ver; nunca dispara) | test HTTP jobs-estado 1/1 |
| 4b | `#inicio` — bloque nuevo «Trabajos y sincronización»: resumen jobs + última sync; 1 fetch; errores no rompen el dashboard | revisión de código; sin consultas SII nuevas |
| 4c | Calculadora IVA (`#calculadora-iva` en Herramientas): artimética client-side neta↔IVA↔total 19%; diferencia débito−crédito etiquetada PROVISIONAL (no impuesto definitivo) | test T3 aritmética 19.000→3.610→22.610 |
| 5 | Centro de Reportes: búsqueda client-side con estado vacío + Favoritos ★ (localStorage `jmv_fav_reports`) + Recientes (`jmv_recent_reports`); permite crear un panel sin backend nuevo | test T4 contratos de storage |
| 6 | `package.json` — suite ampliada (359 tests); 27 tests NUEVOS de los bloques 2-5 conservados | **359/359 pass** |

### NO realizado en esta fase (declarado honestamente)
- **Migración masiva de las 45 tablas manuales a renderTabla/renderDataGrid**: se dejó como paso por-vista para no reescribir código que funciona (regla del mandato). La infraestructura compartida está lista y verificada; cada vista puede adoptarla individualmente sin cambiar contratos.
- **Aparición de shared/datagrid+filters en index.html**: quedó solo documentado en §1.3 porque su adopción real pertenece a la unificación por-vista anterior.
- Modo claro default ya existente; sidebar neutro ya existente — no se tocó el tema (comprobado en tema.js).
