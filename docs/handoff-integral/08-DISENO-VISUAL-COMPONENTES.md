# 08 · Diseño visual y sistema de componentes

> Fuente: `frontend/css/app.css` (tokens y componentes), `frontend/sistema/sistema.css` (shell), `views-*.js` (HTML y estilos inline), `tema.js`.
> Los valores son los declarados en el código. **No se midió contraste ni se renderizó** en navegador en esta pasada; lo que requiere medición se marca.

---

## 1. Tema y tokens

- **Tema por defecto: claro** (`Tema.DEFECTO = 'light'`), aplicado antes del primer paint con `data-theme` en `<html>`.
- El tema oscuro es el `:root` base; el claro redefine tokens semánticos en `html[data-theme='light']`.
- No se escucha `prefers-color-scheme` (decisión explícita desde F0: el SO no cambia el tema a media sesión).

### 1.1 Marca y primitivas

| Token | Valor | Uso |
|---|---|---|
| `--c-jmv-navy` | `#1e2a5e` | Jerarquía / marca |
| `--c-jmv-blue` | `#2e86c8` | Acento y acción primaria |
| `--c-jmv-blue-light` | `#8fc7ee` | Gradiente de marca |
| `--gradient-brand` | `linear-gradient(120deg, #8fc7ee, #2e86c8 55%, #1e2a5e)` | Marca |
| `--c-slate-50 … 950` | `#f8fafc … #020617` | Escala neutra |
| `--c-emerald-500` | `#10b981` | Éxito |
| `--c-amber-500` | `#f59e0b` | Advertencia |
| `--c-rose-500` | `#ef4444` | Peligro |
| `--c-indigo-*` | `#eef2ff … #1e1b4b` | Disponible; poco usado en el shell |

### 1.2 Tokens semánticos — tema oscuro (base)

| Token | Valor |
|---|---|
| `--bg-canvas` | `#020617` (slate-950) |
| `--bg-surface` | `#0f172a` (slate-900) |
| `--bg-elevated` | `#1e293b` (slate-800) |
| `--bg-hover` | `rgba(255,255,255,0.04)` |
| `--bg-active` | `rgba(255,255,255,0.08)` |
| `--fg-primary` | `#f8fafc` |
| `--fg-secondary` | `#94a3b8` |
| `--fg-muted` | `#64748b` |
| `--fg-inverse` | `#020617` |
| `--border-subtle` | `rgba(148,163,184,0.08)` |
| `--border-default` | `rgba(148,163,184,0.14)` |
| `--border-strong` | `rgba(148,163,184,0.22)` |
| `--accent` | `#2e86c8` |
| `--accent-hover` | `#4aa3e0` |
| `--accent-soft` | `rgba(46,134,200,0.14)` |
| `--accent-strong` | `rgba(46,134,200,0.22)` |
| `--success` | `#10b981` · soft `rgba(16,185,129,0.14)` |
| `--warning` | `#f59e0b` · soft `rgba(245,158,11,0.14)` |
| `--danger` | `#ef4444` · soft `rgba(239,68,68,0.14)` |

### 1.3 Override del tema claro (el que ve la mayoría)

| Token | Valor |
|---|---|
| `--bg-canvas` | `#f1f5f9` (slate-100) |
| `--bg-surface` | `#ffffff` |
| `--bg-elevated` | `#f8fafc` |
| `--bg-hover` | `rgba(15,23,42,0.045)` |
| `--bg-active` | `rgba(15,23,42,0.09)` |
| `--fg-primary` | `#0f172a` |
| `--fg-secondary` | `#475569` |
| `--fg-muted` | `#64748b` |
| `--border-*` | `rgba(15,23,42,0.08 / 0.14 / 0.24)` |
| `--accent-soft` | `rgba(46,134,200,0.12)` |
| `--warning` | `#d97706` (amber-600) |
| `--danger` | `#dc2626` (rose-600) |
| Sombras | `0 1px 2px` a `0 24px 64px` con alpha 0.06–0.16 |

**Observación:** el tema claro **no redefine** `--accent` ni `--c-jmv-*` (correcto: se mantiene la marca). Sí redefine warning/danger a variantes más oscuras para contraste sobre blanco (buena práctica).

---

## 2. Tipografía

| Rol | Token | Valor |
|---|---|---|
| Sans | `--font-sans` | `'Inter', system-ui, -apple-system, sans-serif` |
| Display | `--font-display` | `'Sora', 'Space Grotesk', 'Inter', system-ui` |
| Mono | `--font-mono` | `'JetBrains Mono', 'Fira Code', ui-monospace` |

| Escala | Valor | Uso |
|---|---|---|
| `--fs-xs` | 12 px | Encabezados de tabla, etiquetas, metadatos (piso de legibilidad) |
| `--fs-sm` | 13 px | Texto secundario |
| `--fs-base` / `--fs-md` | 16 px | Base |
| `--fs-lg` | 17 px | — |
| `--fs-xl` | 19 px | KPI, títulos de sección |
| `--fs-2xl` | 22 px | Título de pantalla |
| `--fs-3xl` / `--fs-4xl` | 28 / 36 px | Portadas |

Pesos: 400 / 500 / 600 / 700. Interlineado 1.25 / 1.5 / 1.65.

**Dependencia externa no verificada:** las fuentes se referencian por nombre pero no se encontró un `@font-face` ni un `<link>` a Google Fonts en `index.html` (verificar). Si no están instaladas, el sistema cae a `system-ui` y el resultado cambia.

---

## 3. Espaciado, radios, sombras y movimiento

| Escala | Valor | | Radios | Valor |
|---|---|---|---|---|
| `--space-1` | 4 px | | `--radius-sm` | 6 px |
| `--space-2` | 8 px | | `--radius-md` | 10 px |
| `--space-3` | 12 px | | `--radius-lg` | 14 px |
| `--space-4` | 16 px | | `--radius-xl` | 18 px |
| `--space-5` | 20 px | | `--radius-2xl` | 24 px |
| `--space-6` | 24 px | | `--radius-full` | 9999 px |
| `--space-8/10/12/16` | 32/40/48/64 px | | | |

Sombras de `--shadow-xs` (0 1px 2px) a `--shadow-xl` (0 24px 64px). Movimiento: `--dur-fast` 120 ms, `--dur-base` 200 ms, `--dur-slow` 300 ms; `--ease-out` `cubic-bezier(0.16,1,0.3,1)`; `--ease-spring` con rebote.

**`prefers-reduced-motion: reduce`:** duraciones a 0 ms y animaciones a 0.01 ms (`app.css`). **Excepción:** `views-salud.js` inyecta `animation: kpiPulse 2s infinite` y un `keyframes` propio; la regla global `animation-duration: 0.01ms !important` lo neutraliza, pero la animación sigue declarada y el badge sigue existiendo.

---

## 4. Layout del shell

| Elemento | Medida / comportamiento |
|---|---|
| Grid principal | `250px` sidebar + `minmax(0, 1fr)` |
| Sidebar | `position: sticky`, `100vh`, scroll propio, borde derecho sutil |
| Contenido | `max-width: 1180px`, `width: 100%`, padding 24 px |
| Header | Breadcrumb + spacer + búsqueda global + campana + tema |
| Titlebar | Kicker (empresa · RUT), `h1`, selector de período + chip de estado |
| Dock | Fijo inferior; 5 apps + Menú; solo en móvil (por CSS) |
| Breakpoints | `960px` (sidebar → panel), `900px` (grids a 1 columna), `768px` (piso tipográfico), `700px`, `640px` (header apilado, KPIs 2 columnas) |

**Correcciones documentadas en el código (verificadas por comentarios y tests UX):** `width: 100%` + `grid-template-columns: minmax(0,1fr)` para evitar scroll horizontal; `grid-column: 1` para apilar sidebar y main; aviso «Desliza la tabla» cuando `.tbl-wrap` desborda.

---

## 5. Componentes

| Componente | Clases | Estado |
|---|---|---|
| Card | `.card` | Consistente |
| KPI | `.kpi-grid`, `.kpi`, `.kpi.up/.bad/.warn/.acc` | Consistente; variantes de color por significado |
| Chip | `.chip` + familias (`pendiente`, `clasificado`, `propuesto`, `contabilizado`, `revision`, `error`, `anulado`, `neutral`) | Consistente; **el mismo vocabulario se usa para estados documentales, de declaración y de severidad** (ver §7) |
| Tabla | `.tbl`, `.tbl-wrap`, `.tbl-hint`, UITabla | Fuerte: orden, búsqueda, paginación, export, totales, grupos, columna congelada |
| Formularios | `.form-group`, `.form-label`, `.form-input`, `.frm-row`, `UIForms` | Consistente; validación inline requerido/rut/email/min |
| Botones | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-sm` | Consistente en forma; uso desparejo (§`06`) |
| Modal | `.modal-back`, `.modal-card`, `openModal` | Único componente, cierre por Escape/backdrop, foco gestionado |
| Tabs | `.tabs`, `.sl-tabs` | Dos implementaciones (shell y Salud) |
| Estados | `.empty`, `.ui-loading`, `.ui-error`, `.ui-empty` | `ui.js` los centraliza; varias vistas siguen usando `.empty` a mano |
| Banners | `.banner-lic` | Licencia en shell y en Centro (posible duplicación) |
| Búsqueda global | `.gsearch`, `.gsearch-drop`, `.gs-item` | Con dropdown, teclado y grupos |
| Campana | `.campana`, `.campana-drop` | 3 canales reales |
| Gráficos | SVG generados en backend (`informe-salud-html.graficosSvg`) | Misma fuente para panel y PDF (decisión correcta) |

**Métricas:** 153 selectores de clase en `sistema.css` + 268 en `app.css` (con solapamiento); **528 atributos `style="`** en las vistas. Ese volumen de estilo inline es la causa principal de inconsistencias: cada vista reinventa márgenes, colores y tipografía.

---

## 6. Iconografía

| Origen | Dónde | Problema |
|---|---|---|
| SVG inline (stroke 1.6–1.7) | Dock, Centro, header | Consistente entre sí |
| Emoji / símbolos | Botones de vistas (`⇅`, `⋮`, `✕`, `📋`, `💳`, `🔌`, `⇅`) | Depende de la fuente del sistema; cambia de forma y color por SO; no es accesible por sí mismo |
| Sin biblioteca de iconos | — | No hay `lucide`, `heroicons` ni sprite; cada SVG se escribe a mano |

**Recomendación:** un sprite SVG propio (16/20/24 px) con `aria-hidden` y texto visible; reservar emoji para contenido, nunca para acciones.

---

## 7. Semántica de color y estados

| Significado | Color actual | Dónde se usa |
|---|---|---|
| Éxito / conforme | `--success` (verde) | Chips `contabilizado`, `AL_DIA`, KPI `up` |
| Atención | `--warning` (ámbar) | Chips `propuesto`, `CON_OBSERVACIONES` |
| Riesgo / error | `--danger` (rojo) | Chips `error`, `REQUIERE_REVISION`, alertas críticas |
| Neutro / sin dato | `--fg-muted` / gris | Chips `neutral`, `SIN_INFORMACION` |
| Información | `--accent` (azul) | Acción primaria, enlaces |

**Problema:** el chip `propuesto` (ámbar) se usa tanto para «propuesta de asiento pendiente» (estado de trabajo normal) como para severidad media y para «prueba» de licencia. El color no distingue **estado de proceso** de **severidad de riesgo**. En Salud, `chipSev` mapea `media → propuesto`, `baja → pendiente`: reutiliza chips documentales para severidad.

**Recomendación:** dos familias separadas: `estado-*` (proceso) y `severidad-*` (riesgo), con icono además de color (nunca color solo).

---

## 8. Clasificación del ruido visual

| Elemento | Dónde | Clasificación | Acción propuesta |
|---|---|---|---|
| Bloque de índice duplicado (dos veces el score, cobertura, confianza) | P-002 portada | **Redundante** | Uno solo |
| «Plan de acción» impreso dos veces | P-002 pestaña Plan | **Redundante** | Uno, con evidencia de cierre |
| «Opinión Tributaria Profesional» repetida (panel + bloque) | P-002 Resumen | **Redundante** | Un bloque con hechos/diferencias/riesgos/recomendación |
| Badges «Módulo 0…7» + animación | P-002 portada | **Obsoleto / decorativo** | Eliminar |
| Texto `": 85/100"` residual por KPI | P-002 KPI | **Incorrecto** | Eliminar la llamada `kpiContextoSII` mal formada |
| «Última actualización SII: hoy» | P-002 (no invocada) | **Engañoso si se usa** | Fecha real por fuente |
| Tarjetas «No disponible todavía» para F29/PPM/CC | P-021 | **Incorrecto** | Enlazar a la función real |
| Tooltip `title` con la fórmula del KPI | P-002 | **Útil, mal presentado** | Ficha «cómo se calcula» visible |
| Banner de licencia en shell + banner en Centro | P-001/P-004 | **Redundante** | Uno, contextual |
| Tabla de detalle por período repetida (cap. 3 y 5 del informe) | Informe | **Redundante** | Una, con enlace |
| Leyendas explicativas largas bajo cada tabla | P-002, P-006 | **Útil, mejorable** | Mover a «ayuda contextual» desplegable |
| Emoji en botones | Varias vistas | **Confuso / inconsistente** | Icono SVG + texto |
| 528 estilos inline | Vistas | **Técnicamente necesario, mal presentado** | Migrar a clases/tokens |
| `.sl-*` (52 reglas en CSS + 13 clases usadas solo inline en la vista) | Salud | **Duplicado** | Un solo origen |
| Animación `login-in` 0.5 s | Login | **Útil** | Mantener; respeta reduced-motion |
| Gradiente de marca | Sitio público | **Esencial** | Mantener |

**No se debe eliminar** información necesaria para auditoría, seguridad o trazabilidad (detalle SII, evidencia, fechas de consulta, limitaciones). La solución es **jerarquizarla**, no esconderla.

---

## 9. Accesibilidad

| Aspecto | Estado | Evidencia |
|---|---|---|
| Skip link | Sí | `.skip-link` en el shell |
| Foco visible | Sí | `:focus-visible` con outline 2 px; foco al `main` |
| Anuncio de cambio de vista | Sí | `#sys-anuncio` `aria-live="polite"` |
| Modales | Escape, foco inicial, retorno al disparador | `openModal`/`cerrarModal` |
| Tablas | `aria-busy`, encabezados, aviso de scroll | UITabla |
| Contraste | **NO MEDIDO** | Requiere auditoría con herramienta |
| Texto mínimo | 12 px declarado como piso | `--fs-xs`; tests UX |
| Objetivos táctiles | 40 px selects, 32 px enlaces de tabla, 44 px filas en touch | `sistema.css` |
| Movimiento reducido | Sí, salvo animación declarada en Salud | `prefers-reduced-motion` |
| Formularios | `label` + `for`, `aria-label` en iconos | Revisado en bandeja y shell |
| Menú contextual de tabla | Sin `role="menu"` ni navegación con flechas | P-005 |

---

## 10. Tokens y componentes propuestos (resumen; detalle en `17`)

- **Conservar** la paleta JMV (`#2e86c8`, `#1e2a5e`) y la escala slate; el tema claro por defecto.
- **Añadir** familias semánticas separadas `--state-*` y `--severity-*` con sus `-soft` y `-fg`.
- **Definir** un único componente `DataTable` (UITabla evolucionado) y un `PageHeader` (kicker, título, contexto, acciones) para eliminar 528 estilos inline.
- **Iconos**: sprite SVG propio de 24 px, sin emoji en acciones.
- **Estados**: `loading`, `empty`, `error`, `sin-permiso`, `sin-licencia`, `fuente-no-disponible`, cada uno con copy y acción.
- **Densidad**: dos modos (cómoda para el dueño, compacta para el contador), sobre la misma escala de 4 px.
