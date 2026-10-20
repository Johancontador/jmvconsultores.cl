# Propuesta UI — Bandeja de Documentos (módulo piloto)

**Fecha:** 2026-10-17 · **Commit base:** `4dd4beb` · **Estado:** propuesta, sin implementar
**Referencia:** `AUDITORIA-UX-UI.md` (mismo commit) · **Alcance:** una sola vista, `#documentos`
**Regla de esta entrega:** no se modificó código, CSS, rutas, API, base de datos ni configuración; no hubo deploy.

---

## 1. Objetivo

Convertir la Bandeja de Documentos en el **piloto del sistema visual** del ERP: tema claro, fondo gris suave, superficies blancas, azul marino JMV, tablas contables compactas y estados de interfaz completos, **conservando** la integración SII, los contratos HTTP, los permisos y todos los IDs y anchors actuales.

La bandeja es el mejor piloto porque concentra lo difícil: tabla densa, filtros con conteos, agrupación por flujo, montos, estados de documento, permisos de escritura, acciones por fila y una acción masiva.

---

## 2. Lo que existe hoy (medido, no supuesto)

### 2.1 Implementación actual

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Vista | `frontend/sistema/views-fiscal.js` L351–446 (`VIEWS.documentos`) | Filtros por chips de estado, toolbar con “Clasificar automático” y “Reglas”, tabla montada con `UITabla` |
| Tabla | `frontend/shared/uitoolkit.js` (`UITabla.montar`) | Búsqueda local, orden por columna, paginación, CSV/Excel/Copiar/Imprimir, agrupación por `tipo_flujo` con subtotal, columna congelada |
| Clasificación | `modalClasificar()` en la misma vista + `POST …/documentos/:id/clasificar` | Modal con cuenta, centro de costo, tratamiento IVA y “recordar regla” |
| Reglas | `modalReglas()` + `GET /reglas`, `POST /reglas/:id/desactivar` | Lista y desactiva reglas |
| Estados UI | `UIEstado` (`frontend/sistema/ui.js`, contrato `{ cargando, vacio, chip, error }`) | Existe, pero **esta vista no lo usa**: el vacío lo pinta `UITabla` y el error lo pinta `renderRoute` |
| Período global | `periodoGlobal()` y `conectarSelectorPeriodo()` (`app.js` L707 y L716) | El selector del shell fija `localStorage.iva_periodo_activo` y `window._inicioPeriodo` + 9 variables más; Inicio y Contabilidad leen `periodoGlobal()`, **esta vista no** |
| Contrato de datos | `GET …/documentos` | Devuelve `{ total, sumas: {n, neto, iva, total}, estados: [{estado, n}], documentos: [...] }`; acepta `periodo, tipo_flujo, estado, tipo_doc, rut, texto, cuenta_id, limit, offset` (máx. 1000) |
| Permisos | `documentos:ver` (ruta), `documentos:clasificar` (escrituras), `reglas:editar` (desactivar regla) | Se respetan en backend; la UI oculta botones |
| Anulación | `POST …/documentos/:id/anular` (`documentos:clasificar`) | **Existe en backend, sin entrada en la UI.** Exige `motivo`, rechaza `CONTABILIZADO` y `ANULADO` |

### 2.2 Brechas detectadas en la vista (evidencia de código)

| # | Brecha | Evidencia | Impacto |
|---|---|---|---|
| G1 | **El período global no se aplica**: la petición no envía `periodo`, así que la bandeja lista documentos de todos los períodos mientras la cabecera dice “Octubre 2026” | `views-fiscal.js` L356–359 (solo `limit`, `estado`, `texto`, `tipo_flujo`) frente a `periodoGlobal()` en `app.js` L707 | El usuario cree estar viendo un período y ve otro |
| G2 | **Sumas y “Total” no son los del filtro**: la vista pide `limit=300`, ignora `r.total` y `r.sumas`, y el pie suma solo las filas cargadas | L356 y `totalesHTML` L412–415 | Con más de 300 documentos, el total mostrado es falso |
| G3 | **Exportación truncada**: la descarga de `UITabla` recorre las filas cargadas, no el filtro completo | `UITabla.montar` (L377) + descarga sobre `st.filas` | El archivo exportado no coincide con el período |
| G4 | **Filtro `texto` sin control**: el estado `filtros.texto` existe y se envía, pero no hay campo que lo alimente | L354 y L357 | Función inalcanzable; la búsqueda real es la local de `UITabla` |
| G5 | **Filtros de API sin UI**: `tipo_doc`, `rut`, `cuenta_id` no se ofrecen | Comparar contrato §2.1 con la toolbar L366–372 | Búsquedas que hoy exigen exportar a Excel |
| G6 | **No hay detalle del documento**: solo el modal de clasificación | `modalClasificar()` L441 | Para ver montos SII, folio, asiento o reclamo no hay camino |
| G7 | **Una sola acción por fila** y sin menú secundario | `filaHTML` L408–410 | Anular y ver detalle quedan inaccesibles |
| G8 | **Sin confirmación ni alcance** en “Clasificar automático”: dispara directo con `{ periodo: null }` | L430–437 | Acción masiva sobre un período incierto, sin resumen previo |
| G9 | **Sin estado de carga propio, sin reintento y sin distinguir vacío de “sin resultados”** | L351–439 | Errores de red dejan un texto rojo sin acción |
| G10 | **Agrupar + paginar compiten**: la agrupación es local sobre las filas cargadas | `uitoolkit.js` L119–123 y L183–185 | Con paginación de servidor los subtotales por grupo serían de página, no del filtro |
| G11 | **“Revisión” no filtra ni pinta**: el backend usa `REVISION` (sin tilde) y la UI envía y busca `REVISIÓN` | `ESTADOS.REVISION` en `core/documentos.js` L31 frente a `views-fiscal.js` L369 y `chipEstado` (`app.js` L57, que mapea `REVISIÓN`) | El chip muestra 0 siempre y los documentos en revisión quedan sin chip propio e inaccesibles por pestaña |

> G1–G3 no se corrigen “con estilos”: son parte del alcance del piloto y se resuelven con los parámetros y la respuesta que la API **ya** expone.

---

## 3. Decisiones de diseño

| # | Decisión | Por qué | Alternativa descartada |
|---|---|---|---|
| **D1** | **Tema claro por defecto**, con `claro / oscuro / sistema` disponible y persistido en `jmv_tema` | El brief pide claro; hoy `resolver()` sigue al SO, así que en equipos con tema oscuro la app arranca oscura. Los tokens claros ya existen en `html[data-theme='light']` (app.css L1448) | Reemplazar la paleta oscura: rompe a usuarios actuales y duplica trabajo |
| **D2** | **Completar la cabecera de contexto del shell** (empresa + RUT junto al período y su estado) y hacer que las vistas consuman `periodoGlobal()`. No se crea otra cabecera dentro de la vista | El shell **ya** tiene selector de período y chip `ABIERTO/CERRADO` (`sys-periodo`, `sys-periodo-estado`), pero la empresa solo vive en el sidebar y la bandeja ignora `periodoGlobal()` | Duplicar la cabecera dentro de la vista: dos fuentes de período |
| **D3** | **Filtros en la URL** (`#documentos?estado=PENDIENTE&flujo=compra&periodo=202610&p=2`) y `window._docFiltros` solo como espejo de compatibilidad | Permite compartir/volver atrás y elimina estado oculto; `_docFiltros` sigue existiendo para no romper nada | Seguir usando solo `window._docFiltros` |
| **D4** | **Paginación de servidor** (`limit`/`offset`, 50 filas) y **totales desde `r.sumas`**, no desde las filas visibles | Corrige G2/G3 sin tocar la API | Sumar en cliente sobre 300 filas (hoy) |
| **D5** | **Sustituir la agrupación visual por un filtro de flujo** (“Todas / Compras / Ventas”) con totales del servidor | Agrupar + paginar produce subtotales de página (G10); el filtro de flujo ya existe en la API | Mantener agrupación local y paginar en cliente |
| **D6** | **Fila clicable → panel lateral de detalle**, sin perder la lista visible | El brief pide detalle sin perder contexto; ya existe `GET /documentos/:id` | Página de detalle: pierde el contexto y suma una ruta |
| **D7** | **Acción principal: “Clasificar automático”** con resumen y confirmación. “Ingestar documentos” queda como acción secundaria que **lleva a `#libros`**, donde la ingesta ya existe | Evita duplicar el flujo de jobs de ingesta y su polling; no inventa endpoints | Botón de ingesta embebido en la bandeja (duplicaría `documentos-ingesta` y su estado) |
| **D8** | **“Anular” visible** con motivo obligatorio y confirmación, solo para estados permitidos | Función terminada sin entrada (auditoría §4.3); el backend ya valida | Ocultarla hasta rediseñar Contabilidad |
| **D9** | **Permisos: ocultar lo que no corresponde, explicar el bloqueo** | `documentos:clasificar` gobierna clasificar/anular; `reglas:ver` la lectura y `reglas:editar` la desactivación | Deshabilitar sin motivo: el usuario no entiende |
| **D10** | **Sin dependencias nuevas**: se reutilizan `UITabla`, `UIEstado`, `openModal`, `showToast` y las clases existentes; lo nuevo es aditivo | Mantiene el stack vanilla y los tests actuales | Introducir framework o librería de componentes |
| **D11** | **Contratos intactos**: IDs, anchors, endpoints, permisos, `refrescarPillDocs`, integración SII | El brief lo exige y los tests dependen de ellos | Renombrar por “limpieza” |
| **D12** | **Densidad contable**: fila 40 px, cifras tabulares alineadas a la derecha, cabecera fija | Es una bandeja de trabajo, no una landing | Filas de 56 px tipo marketing |
| **D13** | **No inventar**: sin filtro de rango de fechas (la API no lo soporta), sin selección múltiple ni acciones masivas (no existen), sin enlace profundo al SII (no hay URL estable documentada) | Honestidad de alcance | Prometer lo que no está |

---

## 4. Sistema visual del piloto

Se usan los tokens existentes; **solo se propone un ajuste** de valor, no una paleta nueva.

### 4.1 Tokens (reutilizados)

| Token | Valor actual en claro | Uso en la bandeja |
|---|---|---|
| `--bg-canvas` | `--c-slate-100` `#f1f5f9` | Fondo del área de trabajo — **propuesta: `#f6f7f9`** (gris más suave, menos azulado) |
| `--bg-surface` | `#ffffff` | Tabla, tarjetas, panel de detalle |
| `--bg-elevated` | `--c-slate-50` | Hover de fila, inputs, menú |
| `--fg-primary` | `--c-slate-900` | Texto principal |
| `--fg-secondary` / `--fg-muted` | `--c-slate-600` / `--c-slate-500` | Metadatos, RUT, cuenta |
| `--accent` | `#2e86c8` (azul JMV) | Acción primaria, foco, enlaces |
| `--c-jmv-navy` | `#1e2a5e` | Encabezado de tabla y sidebar activo |
| `--success` / `--warning` / `--danger` | emerald / amber / rose | Estados de documento |
| `--radius-sm/md/lg` | 6 / 10 / 14 px | Controles, tarjetas, contenedores |
| `--space-1…8` | 4…32 px | Toda la separación |

**Único cambio propuesto:** `--bg-canvas` en `html[data-theme='light']` de `#f1f5f9` a `#f6f7f9`. Se documenta como “ajuste de superficie”, reversible en una línea.

### 4.2 Tipografía

- **Títulos**: `--font-display` (Sora), 700 — ya cargada en `sistema/index.html`.
- **Texto y tablas**: `--font-sans` (Inter), 400/500/600.
- **Montos y folios**: `--font-mono` + `font-variant-numeric: tabular-nums`, 13 px, alineados a la derecha.
- **Escala**: `--fs-xs` 12 px para metadatos, `--fs-sm` 13 px para tabla, `--fs-base` 16 px para cuerpo. No se agrega escala nueva.

### 4.3 Tabla contable

| Atributo | Valor |
|---|---|
| Alto de fila | 40 px (celda `padding: 8px 12px`) |
| Cabecera | `position: sticky`, fondo `--c-slate-50`, borde inferior `--border-default`, 12 px mayúsculas |
| Columna congelada | “Doc” (se mantiene `congelar: true`) |
| Columnas | Doc · Folio · Fecha · Contraparte (con RUT debajo) · Neto · IVA · Total · Estado · Cuenta · Acciones |
| Alineación | Texto a la izquierda; montos y folio a la derecha; estado como chip |
| Totales | Pie con `Σ neto / IVA / total` y **cantidad real** (`r.total`), calculados con los signos de NC que ya aplica el backend |
| Selección | No en el piloto (no hay acciones masivas) |
| Densidad | Sin zebra; hover `--bg-hover`; borde de 1 px entre filas |

---

## 5. Estructura de la pantalla

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [shell]  JMV · Sistema Contable                         🔍  🔔  ☾/☀       │
├───────────────────────────────────────────────────────────────────────────┤
│ Comercial Andes SpA · 76.543.210-3   ·   Octubre 2026  [ABIERTO]          │  ← D2 contexto
│ Documentos    Compras, ventas y bandeja SII                               │
│                                                                           │
│ [Clasificar automático]  [Más acciones ▾]                    (primaria)   │  ← toolbar
│                                                                           │
│ Todas (128) │ Pendientes (34) │ Clasificados (61) │ Contabilizados (30) │ Revisión (3) │
│ Flujo: [Todas ▾]  Tipo: [Todos ▾]  Cuenta: [Todas ▾]  Buscar: [______]  │  ← filtros
│                                                        Limpiar filtros    │
│ 128 documentos · neto $42.310.000 · IVA $8.038.900 · total $50.348.900   │  ← resumen real
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ Doc     │ Folio │ Fecha  │ Contraparte        │ Neto │ IVA │ Total │ … │ │
│ │ Compra 33│ 2211 │ 12-10  │ Proveedora Central │  …   │  …  │   …   │ … │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ Página 1 de 3 · 50 por página                          [‹] [1] [2] [3] [›]│
└───────────────────────────────────────────────────────────────────────────┘
                    ┌── panel de detalle (drawer, 480 px) ──┐
                    │ Folio 2211 · Compra 33 · 12-10-2026   │
                    │ [Clasificar]  [Anular]  [⋮]           │
                    └───────────────────────────────────────┘
```

### 5.1 Regiones

| Región | Contenido | Estado actual |
|---|---|---|
| Cabecera de contexto (shell) | Empresa, RUT, período, estado del período, última sincronización | Existe parcialmente (empresa en sidebar, período en titlebar) |
| Título de vista | `Documentos` + subtítulo “Compras, ventas y bandeja SII” | `h1` ya lo pone el shell |
| Toolbar | Acción primaria + “Más acciones” | Hoy dos botones sueltos a la derecha de los chips |
| Filtros | Chips de estado con conteo, flujo, tipo de documento, cuenta, búsqueda | Hoy solo chips |
| Resumen | Cantidad + suma neta/IVA/total del filtro | Hoy inexistente |
| Tabla | Ver §4.3 | Existe con 7 columnas |
| Pie | Paginación | Hoy local, 100 por página |

---

## 6. Cabecera con empresa y período (D2)

Se propone **una sola** cabecera en el shell (`frontend/sistema/app.js`, `renderShell` L619), reutilizable por todas las vistas:

```
Comercial Andes SpA · 76.543.210-3     Octubre 2026 [ABIERTO]     Última sincronización: —
```

- **Empresa**: nombre + RUT (ya viaja en `me.acceso_contable`).
- **Período**: el selector actual se mueve aquí; el estado `ABIERTO/CERRADO` viene de `GET /periodos` (hoy solo se pinta si el usuario tiene `periodos:ver`; en el piloto se muestra “—” cuando no lo tiene, sin inventar).
- **Última sincronización**: solo si el dato ya está disponible (`jobs/estado` / dashboard); si no, no se muestra.
- **Sincronización entre módulos**: el período pasa a leerse de la URL con respaldo en `localStorage` (D3). Las variables `window._*Periodo` repartidas en `app.js`, `views-conta.js`, `views-fiscal.js`, `views-activos.js` y `views-autom.js` se mantienen como espejo para no romper las vistas actuales, pero la fuente de verdad pasa a ser una sola.

> Esta pieza toca el shell, no la bandeja. Es el único cambio del piloto fuera de la vista, junto con el token de superficie.

---

## 7. Filtros

Todos los filtros se mapean a parámetros **existentes** del endpoint.

| Control | Parámetro | Tipo | Comportamiento |
|---|---|---|---|
| Chips de estado con conteo | `estado` | `PENDIENTE`, `CLASIFICADO`, `CONTABILIZADO`, `REVISIÓN`, `ANULADO`, `''` (todas) | Conteos desde `r.estados`, que ya se calculan con los demás filtros aplicados |
| Flujo | `tipo_flujo` | `compra` / `venta` / `''` | Reemplaza la agrupación visual (D5) |
| Tipo de documento | `tipo_doc` | 33, 34, 39, 56, 61, 52, boletas | Catálogo ya usado por la tabla (`NOMBRES_TIPO_DOC`) |
| Cuenta contable | `cuenta_id` | imputables de la empresa | Reutiliza `getCuentasImputables()` que ya usa el modal |
| Contraparte | `rut` | texto | El backend normaliza puntos y guiones |
| Buscar | `texto` | texto | Servidor: `razon_social` o `folio` (G4); debounce 300 ms |
| Período | `periodo` | YYYYMM | Desde la cabecera (G1); por defecto el período activo |

**No se agregan** rango de fechas, monto mínimo/máximo ni etiquetas: no existen en el contrato.

**Persistencia**: en la URL (D3). “Limpiar filtros” vuelve a `#documentos?periodo=<activo>`.

---

## 8. Tabla y paginación

- **Filas por página**: 50 (servidor, `limit=50&offset=n`).
- **Orden**: el backend ordena por `id DESC`; el orden por columna es local sobre la página. El piloto **no** promete orden global salvo que se agregue `orden` al contrato (fuera de alcance). Se indica en el encabezado ordenado: “orden aplicado a esta página”.
- **Totales del pie**: `r.sumas` (neto, IVA, total) con el signo de notas de crédito que ya aplica el core; `r.total` para la cantidad.
- **Búsqueda local de `UITabla`**: se mantiene, pero se rotula “Buscar en esta página” para no confundirla con la búsqueda de servidor.
- **Exportación**: se mantiene CSV/Excel de `UITabla` sobre la página visible, y se agrega un ítem “Exportar todo el filtro (máx. 1000)” en “Más acciones” que pide `limit=1000` con los filtros activos. Si el total supera 1000, se avisa que el archivo trae los primeros 1000 (límite real del endpoint).

---

## 9. Acciones por fila y “Más acciones”

### 9.1 Acciones de fila

| Acción | Estados | Permiso | Endpoint | Confirmación |
|---|---|---|---|---|
| **Ver detalle** (clic en fila) | Todos | `documentos:ver` | `GET …/documentos/:id` | — |
| **Clasificar** | `ADMITEN_CLASIFICACION` = `PENDIENTE`, `CLASIFICADO`, `REVISION` (`core/documentos.js` L59) | `documentos:clasificar` | `POST …/documentos/:id/clasificar` | Modal de clasificación (ya existe) |
| **Anular** | No `CONTABILIZADO`, no `ANULADO` | `documentos:clasificar` | `POST …/anular` | Diálogo con **motivo obligatorio** y aviso de irreversibilidad |
| **Más acciones ⋮** | Según estado | — | — | — |

> La lista exacta de estados que admiten clasificación se toma de `ADMITEN_CLASIFICACION` en `core/documentos.js`; la UI **no** duplica la regla: si el backend rechaza, se muestra el mensaje real.

### 9.2 Menú “Más acciones”

**Por fila:**

| Ítem | Qué hace | Permiso |
|---|---|---|
| Ver detalle | Abre el panel lateral | `documentos:ver` |
| Copiar folio | Portapapeles | `documentos:ver` |
| Copiar RUT | Portapapeles | `documentos:ver` |
| Clasificar | Abre modal | `documentos:clasificar` |
| Anular… | Diálogo con motivo | `documentos:clasificar` |
| Ver asiento | Salta a `#asientos` con el asiento vinculado, si `asiento_id` existe | `asientos:ver` |

**De la vista (toolbar):**

| Ítem | Qué hace | Permiso |
|---|---|---|
| Clasificar automático… | Confirmación con alcance y pendientes | `documentos:clasificar` |
| Reglas contables | Abre el modal existente (lectura `reglas:ver`; desactivar exige `reglas:editar`) | `reglas:ver` |
| Ingestar documentos | Navega a `#libros` (allí vive la ingesta y su polling) | `documentos:ingestar` |
| Exportar todo el filtro | Descarga hasta 1000 filas | `documentos:ver` |
| Actualizar | Reejecuta la consulta | `documentos:ver` |

---

## 10. Detalle del documento (panel lateral)

**Comportamiento**: clic en fila → panel de 480 px a la derecha, la tabla queda visible y desplazable; `Esc` cierra y el foco vuelve a la fila. En móvil (< 960 px) ocupa el ancho completo como hoja inferior.

**Secciones y campos** (todos provienen de `documentos.obtener`, que devuelve `d.*` más joins):

| Sección | Campos |
|---|---|
| Identificación | Tipo de flujo, tipo de documento, folio, fecha del documento, fecha de reclamo, origen, período de ingesta |
| Contraparte | Razón social, RUT, estado del documento |
| Montos | Exento, neto, IVA, total (con signo de NC), `montos_sii_json` si existe |
| Clasificación | Cuenta (código + nombre), centro de costo, tratamiento IVA, regla aplicada |
| Contabilidad | Asiento vinculado (folio y año) o “Sin asiento”; estado de contabilización |
| SII | `detalle_sii_json` en formato clave/valor legible; sin enlaces externos inventados |

**Acciones del panel**: `Clasificar` (si procede), `Anular…` (si procede), `Cerrar`.

> No se muestran adjuntos, XML ni PDF: no hay endpoint que los sirva en este módulo.

---

## 11. Estados de la pantalla

| Estado | Cuándo | Qué se ve |
|---|---|---|
| **Cargando** | Primera carga o cambio de filtro | 8 filas esqueleto con la misma rejilla; sin salto de layout |
| **Sin datos** | `total = 0` y sin filtros | “Aún no hay documentos en este período” + acción “Ir a Ingestar” (permiso) |
| **Sin resultados** | `total = 0` con filtros | “Ningún documento coincide” + “Limpiar filtros” |
| **Error** | Fallo de red o 4xx/5xx | Mensaje del backend + “Reintentar” (misma consulta) |
| **Sin permiso** | Ruta sin `documentos:ver` | Mensaje del gate actual del router (se conserva) + “Volver al Centro” |
| **Período cerrado** | `periodos.estado = CERRADO` | Chip “CERRADO” en la cabecera; **no** se deshabilitan acciones desde la UI porque hoy el backend de clasificación no valida el cierre — se documenta como comportamiento actual, sin inventar bloqueo |
| **Éxito** | Acción completada | `showToast` existente + refresco de la fila/lista y del pill de documentos |

---

## 12. Confirmaciones y acciones sensibles

| Acción | Diálogo | Contenido |
|---|---|---|
| **Clasificar automático** | Sí | “Se clasificarán los documentos pendientes de {empresa} del período {período}. Pendientes ahora: {n}. ¿Continuar?” + Cancelar / Clasificar |
| **Anular** | Sí | Documento identificado (tipo, folio, contraparte, monto), campo **Motivo** obligatorio, aviso “No se puede deshacer; queda auditado” + Cancelar / Anular |
| **Desactivar regla** | Sí (hoy no tiene) | Nombre de la regla y efecto (“dejará de aplicarse a nuevos documentos”) |
| **Cierre de período** | No aplica a este piloto | Vive en `#cierre` |

Todas usan el mismo componente de diálogo, con foco atrapado, `Esc` = cancelar y botón destructivo con `--danger`.

---

## 13. Accesibilidad

- `<caption>` visible/oculta con el nombre del listado y `scope="col"` en todas las columnas.
- `aria-sort` en las columnas ordenables; `aria-live="polite"` para el resumen (“128 documentos, total $…”).
- Fila accesible con `tabindex="0"` y `Enter` abre el detalle; `Espacio` no dispara acciones.
- Menú “Más acciones” con `aria-haspopup="menu"`, `aria-expanded`, navegación con flechas y `Esc`.
- Panel lateral con `role="dialog"`, `aria-modal="true"`, foco inicial en el título y retorno al disparador.
- Contraste mínimo AA sobre `#ffffff` y `#f6f7f9`; foco visible con `--accent` (ya definido).
- Enlace de salto al contenido: hoy **no existe** en el sistema; se propone agregarlo en el shell, no en esta vista.

---

## 14. Componentes

| Componente | Estado | Archivo | API propuesta (sin código en esta entrega) |
|---|---|---|---|
| `UITabla` | **Reutilizar y extender** | `frontend/shared/uitoolkit.js` | Nuevas opciones **opcionales**: `caption`, `ariaSort`, `servidor: { total, offset, onPage }`, `rowAttrs(fila)`; sin cambiar la firma actual |
| `UIEstado.vacio` / `.error` / `.cargando` | **Reutilizar** | `frontend/sistema/ui.js` | Ya existen; se usan en la vista |
| `chipEstado` | **Reutilizar y corregir** | `frontend/sistema/app.js` L54 | Ya mapea estados a clases; debe aceptar `REVISION` (G11) |
| `openModal` / `cerrarModal` / `showToast` | **Reutilizar** | `app.js` / `shared/toast.js` | Sin cambios |
| `PageContextBar` | **Nuevo** | `frontend/sistema/app.js` + `sistema.css` | `contextoHTML({ empresa, periodo, estado, sync })` |
| `FilterBar` | **Nuevo** | `frontend/sistema/ui.js` | `UIEstado.filtros({ chips, selects, onCambio })` |
| `ActionMenu` | **Nuevo** | `frontend/sistema/ui.js` | `UIEstado.menu(items, { etiqueta })`, con teclado |
| `Drawer` | **Nuevo** | `frontend/sistema/ui.js` + `sistema.css` | `UIEstado.drawer({ titulo, cuerpo, acciones, onCerrar })` |
| `ConfirmDialog` | **Nuevo** | `frontend/sistema/ui.js` | `UIEstado.confirmar({ titulo, detalle, confirmar, peligro, onConfirmar })` |
| `SkeletonTable` | **Nuevo** | `frontend/sistema/ui.js` + `sistema.css` | `UIEstado.tablaCargando(filas, columnas)` |

Regla: los componentes nuevos viven en `ui.js` (ya es el punto de contratos de UI) y su CSS en `sistema.css`; no se crea ninguna librería ni dependencia.

---

## 15. Archivos exactos a modificar (cuando se autorice)

| Archivo | Zona | Cambio |
|---|---|---|
| `frontend/sistema/views-fiscal.js` | `VIEWS.documentos` (L351–446) | Enviar `periodo`, `limit=50`, `offset`; leer `r.total` y `r.sumas`; filtros nuevos; chip de estados; toolbar; menú; detalle; estados UI |
| `frontend/sistema/views-fiscal.js` | tras `VIEWS.documentos` | Nuevas funciones `abrirDetalleDocumento`, `modalAnular`, `modalAutoClasificar`, `exportarFiltro` |
| `frontend/sistema/ui.js` | final del módulo | `filtros`, `menu`, `drawer`, `confirmar`, `tablaCargando` |
| `frontend/sistema/app.js` | `renderShell` L619, `chipEstado` L54, `renderRoute` L791 | Empresa/RUT en la cabecera; `REVISION` en el mapa de chips; la vista lee la query del hash |
| `frontend/sistema/sistema.css` | nueva sección al final | `.ctx-bar`, `.doc-toolbar`, `.filter-bar`, `.menu-acciones`, `.drawer`, `.confirm-dialog`, `.skeleton-row`, ajustes de `.tbl` (40 px, tabular) |
| `frontend/css/app.css` | `html[data-theme='light']` (L1449) | `--bg-canvas: #f6f7f9` (único cambio de token) |
| `frontend/shared/uitoolkit.js` | `montar` | Opciones opcionales de paginación de servidor, `caption`, `aria-sort`, `rowAttrs` |
| `test/ux-bandeja-documentos.test.js` | nuevo | Contrato de la vista: parámetros enviados, totales desde `sumas`, acciones por estado, permisos |
| `test/ux-unificacion.test.js` | T5b | Se mantiene; debe seguir renderizando la vista sin `ReferenceError` |

**No se toca:** `backend/**` (ni rutas ni core), `services/sii-*`, `core/ingesta`, migraciones, `docs/DESPLIEGUE.md` ni configuración.

---

## 16. Contratos que se preservan

| Contrato | Detalle |
|---|---|
| Anchor | `#documentos` sigue siendo la ruta; los query params son aditivos (`renderRoute` L793 ya separa `?` de la clave) |
| Estados | El valor canónico pasa a ser `REVISION`; se conserva la etiqueta visible “Revisión” y se normaliza cualquier valor legado `REVISIÓN` al leer `_docFiltros` |
| Estado global | `window._docFiltros` se mantiene como espejo de los filtros |
| IDs | `doc-tabla`, `doc-auto`, `doc-reglas`, `[data-est]`, `[data-clas]` |
| Modal de clasificación | `cl-cuenta`, `cl-cc`, `cl-iva`, `cl-recordar`, `cl-save`, `cerrarModal()` |
| Reglas | `modalReglas` y `[data-off]` |
| Permisos | `documentos:ver`, `documentos:clasificar`, `reglas:editar` sin cambios |
| Endpoints | `GET /documentos`, `GET /documentos/:id`, `POST /clasificar`, `POST /aprender-regla`, `POST /anular`, `POST /clasificar-automatico`, `GET/POST /reglas` |
| Efectos secundarios | `refrescarPillDocs()` y `renderRoute()` siguen disparándose tras escribir |
| Integración SII | Sin cambios: la bandeja solo lee lo que la ingesta dejó en `documentos` |

---

## 17. Criterios de aceptación

**Datos y filtros**

1. La petición incluye `periodo` y el listado no muestra documentos de otros períodos (G1).
2. El pie muestra `r.total` y las sumas de `r.sumas`; con más de 300 documentos coinciden con la suma de todas las páginas (G2).
3. Paginar envía `offset` correcto; “Página 2 de 3” coincide con `ceil(total/50)`.
4. Cada filtro (estado, flujo, tipo, cuenta, RUT, texto) modifica la petición y se refleja en la URL; atrás/adelante restauran el estado.
5. “Limpiar filtros” deja solo el período activo.
6. El chip “Revisión” envía `REVISION`, muestra el conteo real de `r.estados` y `chipEstado` pinta esos documentos con la clase `revision` (G11).

**Tabla y detalle**

7. Fila de 40 px, montos alineados a la derecha con cifras tabulares, sin desborde horizontal en 1280 y 390 px (scroll dentro del contenedor).
8. Clic en fila abre el panel con los datos del documento; `Esc` cierra y devuelve el foco.
9. El panel no ofrece acciones que el backend rechazaría para ese estado.

**Acciones y permisos**

10. “Clasificar” solo aparece para estados que admiten clasificación y con `documentos:clasificar`.
11. “Anular” exige motivo no vacío, confirma y deja el documento en `ANULADO`; un `CONTABILIZADO` no muestra la opción.
12. “Clasificar automático” muestra alcance y cantidad antes de ejecutar; cancelar no envía ninguna petición.
13. Sin `documentos:clasificar` no hay acciones de escritura visibles, y llamar al endpoint igual devuelve 403.

**Estados**

14. Carga con esqueleto sin salto de layout; error con “Reintentar” que repite la consulta; vacío distingue “sin datos” de “sin resultados”.

**Regresión**

15. `npm test` sigue en verde (492) y `test/buscador.test.js` (10) se mantiene; T5b renderiza `#documentos` sin errores.
16. No cambia ningún endpoint, esquema ni comportamiento de la ingesta SII.
17. Contraste AA en texto y chips; `caption`, `scope="col"` y `aria-sort` presentes.

---

## 18. Plan de implementación del piloto

1. **Tokens y componentes** (`ui.js`, `sistema.css`, `app.css`): tema claro por defecto, contexto, filtros, menú, drawer, confirmación, esqueleto.
2. **Contrato primero** (`views-fiscal.js`): período, paginación y totales reales; sin cambios visuales todavía.
3. **Rejilla nueva**: columnas, fechas, montos, estado, acciones; eliminar agrupación por flujo y agregar el filtro.
4. **Acciones**: clasificar (reutilizado), anular, detalle, menú, automático con confirmación.
5. **Estados y accesibilidad**: esqueleto, vacío, error, foco, teclado.
6. **Pruebas**: nueva suite de contrato; correr las 502 existentes; verificación visual en navegador a 1280 y 390 px.

Cada paso debe dejar la vista funcionando: no se acepta una fase intermedia que rompa `#documentos`.

---

## 19. Riesgos y fuera de alcance

| Riesgo | Mitigación |
|---|---|
| Paginación de servidor + subtotales por grupo | Se elimina la agrupación visual (D5) y se usa filtro de flujo con totales de `sumas` |
| El backend ordena por `id DESC`; ordenar por otra columna solo afecta la página | Se rotula; orden global queda como cambio de contrato futuro |
| Exportar más de 1000 filas | Se avisa del límite real; ampliarlo requiere cambio de API (fuera de alcance) |
| Cierre de período no bloquea clasificar hoy | Se comunica el estado, no se inventa un bloqueo |
| Normalizar `REVISIÓN` → `REVISION` puede dejar filtros guardados con el valor viejo | Se normaliza al leer (`_docFiltros` y query) y se conserva la etiqueta visible “Revisión” |
| Cambiar el tema por defecto afecta a usuarios actuales | Toggle persistido; `sistema` sigue disponible |
| Tocar el shell para la cabecera | Cambio acotado a `renderShell`; T5b y las 44 vistas se re-verifican |

**Fuera de alcance:** backend, SII, ingesta, selección múltiple, filtros de fecha/monto, adjuntos, enlace al portal SII, navegación global (fase posterior) y el resto de los módulos.

---

## 20. Evidencia revisada

**Leído:** `AUDITORIA-UX-UI.md`; `frontend/sistema/views-fiscal.js` (VIEWS.documentos L351–439 y modales de clasificación/reglas); `frontend/shared/uitoolkit.js`; `frontend/sistema/ui.js`; `frontend/sistema/app.js` (`renderShell` L619, `chipEstado` L54, `periodoGlobal` L707, selector L716, `renderRoute` L791); `frontend/css/app.css` (`[data-theme='light']` L1448); `frontend/sistema/tema.js`; `frontend/sistema/index.html` (Inter + Sora); `frontend/sistema/sistema.css`; `backend/routes/documentos.js` (rutas y permisos); `backend/core/documentos.js` (`ESTADOS`, `ADMITEN_CLASIFICACION`, `listar`, `obtener`, `clasificar`, `anular`).

**Ejecutado en este commit:** `npm test` → 492 pass / 0 fail; `node --test test/buscador.test.js` → 10 pass / 0 fail.

**No ejecutado / no afirmado:** no se probó la vista en navegador, no se consultó el SII, no se emitió DTE, no se ejecutó anulación ni clasificación sobre datos reales, y no se midió rendimiento en producción. Las afirmaciones sobre comportamiento del backend provienen del código, no de una ejecución funcional.

---

*Documento de propuesta. No se implementó ningún cambio.*
