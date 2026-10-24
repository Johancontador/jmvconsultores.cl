# 05 · Menús, submenús y navegación

> Fuente: `MENU`, `DOCK`, `ORDEN_FLUJO`, `menuVisible()`, `renderShell()`, `renderRoute()`, `breadcrumbHTML()` en `frontend/sistema/app.js`.
> Pantallas: `04`. Navegación objetivo: `16`.

---

## 1. Modelos de navegación que coexisten

| # | Superficie | Qué resuelve | Dónde vive |
|---|---|---|---|
| N1 | **Centro de Aplicaciones** (`#centro`) | Home de íconos grandes por módulo, recientes y «continuar donde quedó» | `views-centro.js` + `GET /api/auth/centro` |
| N2 | **Dock inferior** | 5 accesos grandes + botón «Menú»; casa que siempre vuelve a `#centro` | `DOCK` |
| N3 | **Menú lateral** | 10 secciones plegables, 43 ítems, buscador de secciones, selector de empresa | `MENU` + `sidebar` |
| N4 | **Header + titlebar** | Breadcrumb, búsqueda global (Ctrl/⌘K), campana, tema, selector de período y estado | `renderShell` |
| N5 | **Breadcrumb** | `Inicio / Sección / Ítem` | `breadcrumbHTML` |
| N6 | **Buscador del menú** | Filtra ítems por texto o nombre de sección | `conectarBuscadorMenu` |

Además, cada vista tiene **pestañas internas** (Salud 10; Tesorería 5; Contabilidad 3–4; DTE 3; Admin 6; CRM 7; Portal 10), y el Centro de Reportes es un **catálogo** de tercer nivel.

**Diagnóstico:** seis superficies para el mismo propósito (llegar a una pantalla) sin una jerarquía que las ordene. El usuario no tiene un modelo mental único; el sistema tampoco.

---

## 2. Jerarquía actual completa (10 secciones / 43 ítems)

| NAV | Sección | Orden | Ítem | Clave | Permiso | Vista | Notas |
|---|---|---|---|---|---|---|---|
| NAV-01 | Inicio | 0 | Panel del período | `inicio` | — | P-001 | Home operativo |
| NAV-02 | Inicio | | Salud Tributaria — Diagnóstico Ejecutivo | `salud` | `salud:ver` | P-002 | Pill con score |
| NAV-03 | Inicio | | Alertas — Reclamadas y Pendientes | `alertas` | `documentos:ver` | P-003 | Pill con conteo |
| NAV-04 | Inicio | | Centro de Aplicaciones | `centro` | — | P-004 | Home de módulos |
| NAV-05 | Gestión comercial | 6 | CRM Comercial | `crm` | `crm:ver` | P-045 | Solo despacho |
| NAV-06 | Gestión comercial | | Clientes — Cuenta Corriente | `cclientes` | `reportes:ver` | P-029 | Es un reporte |
| NAV-07 | Gestión comercial | | Proveedores — Cuenta Corriente | `cproveedores` | `reportes:ver` | P-030 | Es un reporte |
| NAV-08 | Documentos y libros | 1 | Bandeja de Documentos | `documentos` | `documentos:ver` | P-005 | Pill pendientes |
| NAV-09 | Documentos y libros | | Libros de Compras y Ventas | `libros` | `documentos:ver` | P-006 | |
| NAV-10 | Documentos y libros | | Onboarding y Extracción | `onboarding` | `documentos:ver` | P-007 | Config inicial |
| NAV-11 | Documentos y libros | | Dashboard Tributario (IVA) | `analitica` | `reportes:ver` | P-008 | |
| NAV-12 | Documentos y libros | | Calculadora de IVA | `calculadora-iva` | — | P-009 | Herramienta sin persistencia |
| NAV-13 | Facturación | 2 | Emitir Factura o Nota | `dte-emision` | `dte:emitir` | P-010 | |
| NAV-14 | Facturación | | Bandeja de DTEs Emitidos | `dte` | `dte:ver` | P-011 | |
| NAV-15 | Facturación | | Configuración del Emisor | `dte-config` | `dte:ver` | P-012 | Acción sensible |
| NAV-16 | Contabilidad | 3 | Contabilización y Pendientes | `automatizacion` | `propuestas:ver` | P-013 | |
| NAV-17 | Contabilidad | | Propuestas y Conciliación | `propuestas` | `propuestas:ver` | P-014 | |
| NAV-18 | Contabilidad | | Asientos — Diario, Mayor y Plan | `asientos` | `asientos:ver` | P-015 | |
| NAV-19 | Contabilidad | | Memoria de Contabilización | `memoria` | `documentos:ver` | P-016 | |
| NAV-20 | Contabilidad | | Receptor Externo (Geo Daniela) | `externos` | `asientos:ver` | P-017 | Integración |
| NAV-21 | Contabilidad | | Activos Fijos y Depreciación | `activos` | `activos:ver` | P-018 | |
| NAV-22 | Tesorería y cobranza | 4 | Bancos, Libro Banco y Conciliación | `tesoreria` | `tesoreria:ver` | P-019 | 5 pestañas |
| NAV-23 | Tesorería y cobranza | | Cobranza y Mora | `cobranza` | `tesoreria:ver` | P-020 | |
| NAV-24 | Informes y control | 5 | Centro de Reportes | `reportes` | `reportes:ver` | P-021 | Catálogo |
| NAV-25 | Informes y control | | Cierre de Período | `cierre` | `reportes:ver` | P-022 | Proceso, no reporte |
| NAV-26 | Lote del despacho | 99 | Clientes del portafolio | `portafolio` | `crm:ver` | P-031 | Legacy |
| NAV-27 | Lote del despacho | | Informe por rango | `informe-rango` | `crm:ver` | P-032 | Legacy |
| NAV-28 | Lote del despacho | | Proceso masivo (F29 del mes) | `proceso-masivo` | `crm:ver` | P-033 | Legacy |
| NAV-29 | Lote del despacho | | Reporte masivo (ZIP) | `exportacion-masiva` | `crm:ver` | P-034 | Legacy |
| NAV-30 | Portal de cliente | 7 | Dashboard interactivo | `portal-inicio` | — | P-035 | |
| NAV-31 | Portal de cliente | | Ventas y movimientos | `portal-ventas` | — | P-036 | |
| NAV-32 | Portal de cliente | | Cartera de clientes | `portal-cartera` | — | P-037 | |
| NAV-33 | Portal de cliente | | Productos vendidos | `portal-productos` | — | P-038 | |
| NAV-34 | Portal de cliente | | Crédito autorizado | `portal-credito` | — | P-039 | |
| NAV-35 | Portal de cliente | | Hoja de costos | `portal-costos` | — | P-040 | |
| NAV-36 | Portal de cliente | | Mi seguimiento comercial | `portal-comercial` | — | P-041 | |
| NAV-37 | Portal de cliente | | Cotizaciones y embudo | `portal-cotizaciones` | — | P-042 | |
| NAV-38 | Portal de cliente | | Cobranza (solo lectura) | `portal-cobranza` | — | P-043 | |
| NAV-39 | Portal de cliente | | Reportes guardados | `portal-reportes` | — | P-044 | |
| NAV-40 | Administración | 8 | Administración | `admin` | `periodos:ver` | P-046 | Ver §5 |
| NAV-41 | Administración | | Auditoría | `auditoria` | `auditoria:ver` | P-047 | |
| NAV-42 | Administración | | Integraciones | `integraciones` | `empresas:ver` | P-048 | |
| NAV-43 | Administración | | Suscripción y Pagos | `suscripcion` | `empresas:ver` | P-049 | |

**Submenús:** no existen submenús desplegables en el menú lateral. El «segundo nivel» se resuelve con **pestañas dentro de la vista** y con el **Centro de Reportes**. Es una decisión deliberada (`sistema.css`: «Sin desplegables: todo visible») que, con 43 ítems, produjo el problema contrario: un catálogo largo en el nivel 1.

---

## 3. Navegación por rol (presentación)

`menuVisible()` filtra secciones sin ítems permitidos y ordena con `ORDEN_FLUJO`:

| Rol | Orden de secciones | Ítems visibles (aprox.) |
|---|---|---|
| `super_admin` | Inicio → Documentos → Facturación → Contabilidad → Tesorería → Informes → Gestión → Portal → Lote → Administración | 43 |
| `contador` | Igual (sin diferencias de permiso relevantes) | 43 |
| `admin_empresa` | Portal (‑2) → Inicio (‑1) → Documentos → Facturación → Contabilidad → Tesorería → Informes → Gestión → Administración | ~37 (sin CRM/Lote) |
| `auditor` | Inicio → Documentos → Contabilidad → Tesorería → Informes → Gestión → Portal → Administración | ~30 (sin escribir) |
| `tesoreria` | Inicio → Documentos → Contabilidad → Tesorería → Informes → Gestión → Portal → Administración | ~28 (sin salud ni DTE config) |

**Hallazgo:** el orden de presentación depende de un mapa por **nombre literal de sección** (`ORDEN_FLUJO`). Renombrar «Tesorería y cobranza» sin actualizar el mapa la manda a `99` (final) sin error visible.

---

## 4. Dock (navegación de teléfono)

| Posición | Ruta | Etiqueta | Permiso | Comportamiento |
|---|---|---|---|---|
| 1 | `#centro` | Inicio (casa) | — | Siempre vuelve al Centro |
| 2 | `#documentos` | Bandeja | `documentos:ver` | |
| 3 | `#libros` | Libros | `documentos:ver` | |
| 4 | `#salud` | Salud | `salud:ver` | |
| 5 | `#tesoreria` | Tesorería | `tesoreria:ver` | |
| 6 | — | Menú | — | Abre el panel lateral; sincroniza `aria-expanded` |

El dock **no incluye Contabilidad ni Facturación**, que son el núcleo operativo del contador. En móvil, el camino a `#asientos` exige abrir el menú.

---

## 5. Problemas de nomenclatura, agrupación y control de acceso

| # | Problema | Evidencia / consecuencia |
|---|---|---|
| N-01 | **43 ítems en el nivel 1** | El menú se pliega en 9 secciones para caber en 1.105 px a 390 px; sigue exigiendo explorar. |
| N-02 | **Seis superficies de navegación** | Centro, dock, lateral, búsqueda global, buscador del menú, breadcrumb + catálogo de reportes. |
| N-03 | **Dos homes** | «Inicio» (operativo) y «Centro» (lanzador). El post-login va a `#centro`; el dock llama «Inicio» a `#centro`; el menú llama «Inicio» a la sección que contiene ambos. |
| N-04 | **Reportes en tres lugares** | `#reportes` (catálogo), ítems de menú (`asientos`, `tesoreria`, `analitica`, `libros`) y anchors directos (`#situacion`, `#balance8`…). |
| N-05 | **Herramientas del despacho dentro de la app del cliente** | «Lote del despacho» comparte shell con el portal y la contabilidad; el dueño no lo ve, pero el contador cambia de contexto sin señal visual. |
| N-06 | **«Gestión comercial» mezcla CRM con reportes** | CRM (operación) + cuentas corrientes (reporte) bajo el mismo rótulo. |
| N-07 | **«Administración» con permiso equivocado** | El ítem exige `periodos:ver`; el rol `tesoreria` lo tiene, así que ve la entrada y dentro la mayoría de acciones responde 403 (usuarios/roles exigen admin). |
| N-08 | **Vistas de reporte sin ítem de menú** | `#comprobacion`, `#balance8`, `#situacion`, `#resultados`, `#clasificado`, `#niif` no están en `MENU`: el router las trata como `inicio` para permisos y breadcrumb (ver `04` nota 1). |
| N-09 | **Portal visible para roles internos** | 10 ítems con `permiso: null`; un contador ve el portal del cliente en su menú aunque su trabajo sea otro. |
| N-10 | **Nombres largos y compuestos** | «Salud Tributaria — Diagnóstico Ejecutivo», «Asientos — Diario, Mayor y Plan», «Bancos, Libro Banco y Conciliación»: el ítem intenta describir la pantalla en lugar de nombrar la tarea. |
| N-11 | **«Onboarding y Extracción»** | Vocabulario técnico para un dueño de empresa; debería ser «Configurar mi empresa» / «Cargar documentos». |
| N-12 | **«Receptor Externo (Geo Daniela)»** | Nombre de proveedor en el menú del producto. |
| N-13 | **Sin indicación de contexto cross-empresa** | El portafolio y el CRM operan sobre todas las empresas, pero el selector de empresa sigue visible y sugiere un alcance que no aplica. |

---

## 6. Navegación contextual dentro de las vistas

| Vista | Pestañas / subvistas | Persistencia |
|---|---|---|
| P-002 Salud | 10 pestañas (Resumen, Cumplimiento, IVA y conciliación, Riesgos, Tendencias, Deuda TGR, Impacto financiero, Plan, Metodología, Identificación) | Estado en memoria; al re-render vuelve a Resumen |
| P-006 Libros | Compras / Ventas / Resumen | `#libros?tab=` |
| P-015 Asientos | Diario / Mayor / Plan / Nuevo | `window._ctaTab` |
| P-019 Tesorería | Bancos (con deuda TGR) / Libro banco / Conciliación (con cartola) | `window._tesoTab` |
| P-046 Admin | Empresas / Períodos / Usuarios y roles / Auditoría / Seguridad | `window` |
| P-045 CRM | 8 pestañas: Panel comercial / Oportunidades / Fichas / Contactos / Prospectos / Actividades / Informes / Fidelización | `window` |
| P-035…044 Portal | Una vista por ítem (no pestañas) | — |

**Inconsistencia:** unas pestañas viajan en la URL o en `window._*`, otras solo en memoria. Al recargar, el usuario pierde el lugar.

---

## 7. Contexto compartible (URL)

`url-estado.js` agrega `empresa` y `periodo` a la query del hash, conservando los filtros de la vista:

```text
#documentos?estado=PENDIENTE&tipo=33&empresa=3&periodo=202602
```

- La URL manda sobre `localStorage` al entrar.
- Empresa ajena o período inválido se ignoran y la URL se reescribe (nunca se abre una empresa sin acceso).
- Cambiar de empresa descarta el período anterior.
- Atrás/Adelante restauran contexto.

Es una de las mejores decisiones del shell y **debe conservarse** en el rediseño.

---

## 8. Diagnóstico de la navegación actual

**Lo que funciona**
- Anclas estables y compatibilidad histórica (`REDIRECCIONES_ANCHOR`, aunque hoy vacío).
- Contexto empresa/período en URL.
- Búsqueda global con RBAC del backend y atajo Ctrl/⌘K.
- Menú plegable con estado por usuario y apertura automática de la sección activa.
- Modo móvil con panel y cierre por Escape/backdrop.

**Lo que no funciona**
- El nivel 1 es un **catálogo de funciones**, no un mapa de trabajo.
- El descubrimiento depende de que el usuario explore 43 ítems o use el buscador (que exige saber qué buscar).
- Los catálogos (menú, Centro, Reportes) se contradicen.
- El control de acceso de la UI no cubre las vistas fuera de `MENU`.
- La nomenclatura mezcla tareas, pantallas, proveedores y estados.

**Dirección propuesta (detalle en `16`):** 6 áreas de nivel 1 (Inicio, Documentos, Contabilidad, Impuestos y Salud, Tesorería, Informes) + Administración y Portal como destinos secundarios; cada área con un **espacio de trabajo** que contiene sus subfunciones, filtros y reportes. Los 43 ítems no desaparecen: se **reubican** en el segundo nivel y se conservan sus anchors.
