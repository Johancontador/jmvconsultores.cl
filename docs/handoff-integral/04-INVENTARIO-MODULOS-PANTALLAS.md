# 04 · Inventario de módulos y pantallas

> Criterio de pantalla: cada clave registrada en `window.VIEWS.*` (49). Las pestañas internas se listan como subpantallas.
> Criterio de módulo: agrupación funcional del `MENU` + vistas alcanzables desde el Centro de Reportes.
> Permisos: el del ítem de menú (el backend revalida en cada endpoint).

---

## 1. Mapa de módulos

| ID | Módulo | Sección de menú | Pantallas | Estado |
|---|---|---|---|---|
| MOD-01 | Inicio y diagnóstico | Inicio | 4 | Operativo con defectos visuales |
| MOD-02 | Documentos y libros | Documentos y libros | 5 | Operativo |
| MOD-03 | Facturación electrónica | Facturación | 3 | Operativo; producción DTE pendiente de credenciales |
| MOD-04 | Contabilidad | Contabilidad | 6 | Operativo |
| MOD-05 | Tesorería y cobranza | Tesorería y cobranza | 2 | Operativo |
| MOD-06 | Informes, estados y cierres | Informes y control + Gestión comercial | 10 | Operativo; catálogo incompleto |
| MOD-07 | Lote del despacho | Lote del despacho | 4 | Operativo (capa heredada portada) |
| MOD-08 | Portal de cliente | Portal de cliente | 10 | Operativo, read-only |
| MOD-09 | Gestión comercial (CRM) | Gestión comercial | 1 | Operativo, exclusivo despacho |
| MOD-10 | Administración y plataforma | Administración | 4 | Operativo |

**Total: 10 módulos de menú · 49 pantallas · 43 ítems de menú.**

---

## 2. Inventario completo de pantallas

Leyenda de estado: **OK** implementada y cubierta por backend/tests; **PARCIAL** con límites declarados; **DEFECTO** problema visual/funcional detectado.

| ID | Clave | Título visible | Módulo | Permiso | Propósito | Endpoints principales | Estado |
|---|---|---|---|---|---|---|---|
| P-001 | `inicio` | Panel del período | MOD-01 | — | Resumen del día: salud, pendientes, jobs, ventas/compras, atajos | `/empresas/:id/dashboard`, `salud-tributaria/resumen`, `jobs/estado`, `sii/config` | OK |
| P-002 | `salud` | Salud Tributaria | MOD-01 | `salud:ver` | Diagnóstico integrado con índice, riesgos, plan e informe | `salud-tributaria`, `/graficos`, `/informe`, `/reunion`, `/resumen` | **DEFECTO** |
| P-003 | `alertas` | Alertas — Reclamadas y Pendientes | MOD-01 | `documentos:ver` | Documentos reclamados, pendientes y sync atrasada | `/empresas/:id/alertas` | OK |
| P-004 | `centro` | Centro de Aplicaciones | MOD-01 | — | Home de módulos por rol + recientes | `/api/auth/centro` | OK |
| P-005 | `documentos` | Bandeja de Documentos | MOD-02 | `documentos:ver` | Clasificar/contabilizar documentos del RCV | `/documentos`, `/documentos/:id`, `/clasificar`, `/anular`, `clasificar-automatico`, `reglas`, `contrapartes` | OK |
| P-006 | `libros` | Libros de Compras y Ventas | MOD-02 | `documentos:ver` | Consultar RCV y sincronizar con SII | `/documentos-ingesta`, `/documentos-ingesta/:jobId` | OK |
| P-007 | `onboarding` | Onboarding y Extracción | MOD-02 | `documentos:ver` | Ficha SII, ingesta histórica, datos faltantes | `/onboarding/ficha`, `/consultar-sii`, `/confirmar-ficha`, `/ingesta-historica` | OK |
| P-008 | `analitica` | Dashboard Tributario (IVA) | MOD-02 | `reportes:ver` | KPIs anuales, serie, top contrapartes, alertas de duplicados/RUT | `/empresas/:id/analitica` | OK |
| P-009 | `calculadora-iva` | Calculadora de IVA | MOD-02 | — | Cálculo rápido IVA/PPM/F29 (cliente) | ninguno | OK (sin persistencia) |
| P-010 | `dte-emision` | Emitir Factura o Nota | MOD-03 | `dte:emitir` | Emisión 33/34/56/61 con totales en vivo | `/dte/empresas/:id/emitir`, `/config`, `/folios` | OK |
| P-011 | `dte` | Bandeja de DTEs Emitidos | MOD-03 | `dte:ver` | Estado SII, reintento, sync a contabilidad | `/dtes`, `/dtes/:id/estado`, `/reintentar`, `/sincronizar-contabilidad` | OK |
| P-012 | `dte-config` | Configuración del Emisor | MOD-03 | `dte:ver` | Certificado, CAF, resolución, ambiente | `/config`, `/folios` | OK |
| P-013 | `automatizacion` | Contabilización y Pendientes | MOD-04 | `propuestas:ver` | Pipeline clasificar→proponer→contabilizar | `/automatizacion/:periodo/estado`, `/ejecutar`, `/semilla` | OK |
| P-014 | `propuestas` | Propuestas y Conciliación | MOD-04 | `propuestas:ver` | Revisar/confirmar propuestas y conciliar SII↔contable | `/propuestas`, `/confirmar`, `/confirmar-lote`, `/descartar`, `/conciliacion/:periodo`, `/conciliaciones` | OK |
| P-015 | `asientos` | Asientos — Diario, Mayor y Plan | MOD-04 | `asientos:ver` | Diario, mayor, plan de cuentas y asiento manual | `/asientos`, `/asientos/:id/revertir`, `/mayor`, `/cuentas`, `/centros-costo` | OK |
| P-016 | `memoria` | Memoria de Contabilización | MOD-04 | `documentos:ver` | RUT→cuenta aprendidos, contrapartes sin ubicar, config simple/completa | `/memoria`, `/contrapartes`, `/config` | OK |
| P-017 | `externos` | Receptor Externo (Geo Daniela) | MOD-04 | `asientos:ver` | Contrato de asientos externos + validación de códigos | `/asientos-externos`, `/validar-codigos` | OK |
| P-018 | `activos` | Activos Fijos y Depreciación | MOD-04 | `activos:ver` | Alta, depreciación mensual, venta/baja | `/activos`, `/activos-depreciacion/:periodo`, `/venta-baja` | OK |
| P-019 | `tesoreria` | Bancos, Libro Banco y Conciliación | MOD-05 | `tesoreria:ver` | Bancos (incluye deuda TGR), libro banco y conciliación con cartola | `/bancos`, `/tesoreria/movimientos`, `/cartola`, `/conciliar`, `/deuda-fiscal` | OK |
| P-020 | `cobranza` | Cobranza y Mora | MOD-05 | `tesoreria:ver` | Facturas vencidas y registro de pago | `/cobranza`, `/cobranza/:documentoId/pagada` | OK |
| P-021 | `reportes` | Centro de Reportes | MOD-06 | `reportes:ver` | Catálogo de reportes, favoritos y recientes | ninguno (navegación) | **DEFECTO** (catálogo) |
| P-022 | `cierre` | Cierre de Período | MOD-06 | `reportes:ver` | Checklist, cierre auditado, reapertura | `/cierre/:periodo/preparar`, `/ejecutar`, `/periodos/:periodo/cerrar` | OK |
| P-023 | `comprobacion` | Balance de Comprobación | MOD-06 | *ver nota (1)* | Sumas y saldos ΣD=ΣH | `/reportes/balance/:periodo` | OK |
| P-024 | `balance8` | Balance de 8 Columnas | MOD-06 | *nota (1)* | Hoja de trabajo con pérdida/utilidad | `/reportes/balance8/:periodo` | OK |
| P-025 | `situacion` | Estado de Situación Financiera | MOD-06 | *nota (1)* | A = P + PN con saldos bancarios | `/reportes/situacion/:periodo` | OK |
| P-026 | `resultados` | Estado de Resultados | MOD-06 | *nota (1)* | Ingresos/gastos por período y acumulado | `/reportes/resultados/:periodo` | OK |
| P-027 | `clasificado` | Balance Clasificado | MOD-06 | *nota (1)* | Corriente/no corriente + capital de trabajo | `/reportes/clasificado/:periodo` | OK |
| P-028 | `niif` | NIIF — Estados por Rubros | MOD-06 | *nota (1)* | Presentación por rubros y mapeo editable | `/niif/mapeo`, `/niif/situacion/:periodo`, `/niif/resultados/:periodo` | OK |
| P-029 | `cclientes` | Clientes — Cuenta Corriente | MOD-06 | `reportes:ver` | Cargos, abonos y saldo por cliente | `/reportes/cuenta-corriente` | OK |
| P-030 | `cproveedores` | Proveedores — Cuenta Corriente | MOD-06 | `reportes:ver` | Ídem proveedores | `/reportes/cuenta-corriente` | OK |
| P-031 | `portafolio` | Clientes del portafolio | MOD-07 | `crm:ver` | Cartera cross-empresa del despacho | `/clientes`, `/informe` | OK (legacy) |
| P-032 | `informe-rango` | Informe por rango | MOD-07 | `crm:ver` | Informe multi-mes con detalle y export | `/informe/*` | OK (legacy) |
| P-033 | `proceso-masivo` | Proceso masivo (F29 del mes) | MOD-07 | `crm:ver` | Proceso por cartera, mensajes WhatsApp | `/proceso/*` | OK (legacy) |
| P-034 | `exportacion-masiva` | Reporte masivo (ZIP) | MOD-07 | `crm:ver` | ZIP de Excel por cliente/período | `/exportacion-masiva/*` | OK (legacy) |
| P-035 | `portal-inicio` | Portal — Dashboard interactivo | MOD-08 | — | Panel del dueño con KPIs del negocio | `/api/portal/empresas/:id/resumen`, `/serie`, `/metricas` | OK |
| P-036 | `portal-ventas` | Portal — Ventas y movimientos | MOD-08 | — | Detalle de ventas, filtros, export | `/movimientos`, `/exportar.csv` | OK |
| P-037 | `portal-cartera` | Portal — Cartera de clientes | MOD-08 | — | Deuda por cliente y cobranza | `/cartera`, `/cobranza` | OK |
| P-038 | `portal-productos` | Portal — Productos vendidos | MOD-08 | — | Ranking y márgenes por producto | `/productos` | OK |
| P-039 | `portal-credito` | Portal — Crédito autorizado | MOD-08 | — | Límites de crédito por cliente | `/credito` | OK |
| P-040 | `portal-costos` | Portal — Hoja de costos | MOD-08 | — | Costos y margen por producto | `/costos`, `/costos-csv`, `/margen` | OK |
| P-041 | `portal-comercial` | Portal — Mi seguimiento comercial | MOD-08 | — | Embudo y actividad comercial del cliente | `/comercial` | OK |
| P-042 | `portal-cotizaciones` | Portal — Cotizaciones y embudo | MOD-08 | — | Cotizaciones con estados | `/cotizaciones` | OK |
| P-043 | `portal-cobranza` | Portal — Cobranza (solo lectura) | MOD-08 | — | Vista de cobranza sin operar | `/cobranza` | OK |
| P-044 | `portal-reportes` | Portal — Reportes guardados | MOD-08 | — | Reportes persistidos por el cliente | `/reportes` | OK |
| P-045 | `crm` | CRM Comercial | MOD-09 | `crm:ver` | Pipeline, fichas, contactos, oportunidades, campañas, retención | `/api/crm/*` (33 endpoints) | OK |
| P-046 | `admin` | Administración | MOD-10 | `periodos:ver` | Empresas, usuarios, roles, cuentas, config | `/empresas`, `/usuarios`, `/roles`, `/cuentas`, `/config` | OK |
| P-047 | `auditoria` | Auditoría | MOD-10 | `auditoria:ver` | Bitácora (últimos 200) con KPIs y búsqueda local | `/empresas/:id/auditoria?limit&offset` | OK (sin filtros de servidor) |
| P-048 | `integraciones` | Integraciones | MOD-10 | `empresas:ver` | Estado de conexión SII y últimas sincronizaciones | `/sii/config`, `/sii/probar` | OK |
| P-049 | `suscripcion` | Suscripción y Pagos | MOD-10 | `empresas:ver` | Plan, pagos, checkout, factura | `/pagos/empresas/:id/pagos`, `/checkout`, `/pagos/:pagoId/factura` | OK |

> **Nota (1) — defecto de control de acceso en frontend:** `P-023` a `P-028` no existen en `MENU`. En `renderRoute`, `route = TODOS_LOS_ITEMS.find(...) || TODOS_LOS_ITEMS[0]`; al no encontrarlas, `route` cae en `inicio` (permiso `null`). Por eso el bloqueo de UI por permiso **no se aplica** a estas vistas cuando se abren por URL directa. El backend sí devuelve 403/402 en cada fetch, así que no hay fuga de datos, pero la promesa de «impenetrabilidad» de la UI no se cumple para ellas y el breadcrumb muestra «Inicio / Inicio / Panel del período».

---

## 3. Fichas detalladas de las pantallas principales

### P-001 · Panel del período (`#inicio`)

| Campo | Detalle |
|---|---|
| Objetivo | Responder «qué requiere mi atención hoy» para la empresa y período activos. |
| Origen / destinos | Post-login (si el hash restaurado no manda) / `#salud`, `#alertas`, `#automatizacion`, `#libros`, `#documentos`, `#asientos`, `#propuestas`, `#reportes`, `#onboarding`. |
| Datos que consulta | `dashboard` (KPIs y acciones), `salud-tributaria/resumen`, `/api/sii/config`, `jobs/estado`. |
| Acciones | «Ver informe de salud», «Abrir» automatización, «Completar» onboarding, «Sincronizar un período», atajos. |
| Estados | `Cargando…` genérico; tarjetas con `—` si no hay dato; tarjeta de error si falla el dashboard. |
| Dependencias | Salud Tributaria (score), jobs de sync, licencia, permisos. |
| Problemas | Duplica el estado de salud que ya muestra el pill del menú y la portada de Salud; el bloque de jobs puede quedar en «cargando…» sin reintento visible. |
| Mejora | Convertirlo en «Hoy»: 3 bloques (obligaciones del mes, pendientes operativos, anomalías), cada uno con enlace al detalle y acción primaria única. |

### P-002 · Salud Tributaria (`#salud`)

| Campo | Detalle |
|---|---|
| Objetivo | Diagnóstico integrado con índice, hallazgos, exposición, plan y evidencia. |
| Origen / destinos | Menú, `#inicio`, pill de salud / `#deuda` (TGR), `#documentos`, `#cierre`. |
| Subpantallas (10 pestañas) | Resumen · Cumplimiento · IVA y conciliación · Riesgos · Tendencias · Deuda fiscal (TGR) · Impacto financiero · Plan de acción · Metodología · Identificación. |
| Datos | Informe completo (`construirInforme`), gráficos SVG, resumen cacheado. |
| Acciones | «Reunir antecedentes» (job 6 pasos), «Emitir informe (PDF)» (abre HTML), «Consultar deuda fiscal» (TGR), «Ver certificado (PDF)». |
| Estados | Cargando, error de carga (cartel), sin índice (`—`), pasos del job con `ok/error`, toasts. |
| Problemas | Ver `12` y `14`: duplicación de bloques, animación decorativa, texto residual, sin distinción error técnico/fuente no disponible, capacidad cruzada `tesoreria:operar`. |
| Mejora | Rehacer la portada con un solo encabezado, un solo plan de acción, estados semánticos y evidencia enlazada. |

### P-005 · Bandeja de Documentos (`#documentos`)

| Campo | Detalle |
|---|---|
| Objetivo | Clasificar y contabilizar documentos del RCV, con trazabilidad. |
| Filtros | Estado (chips con conteo), flujo (compras/ventas), tipo de documento, cuenta, texto (razón social/folio), RUT. |
| Tabla | UITabla: búsqueda sin acentos, orden por valor crudo, paginación, export CSV/XLS, copiar, imprimir, totales en `tfoot`. |
| Acciones por fila | «Clasificar», menú «⋮» (detalle, anular, generar propuesta, ver asiento), selección múltiple. |
| Modales | Detalle, clasificar (cuenta, CC, IVA, recordar regla), anular (motivo obligatorio), clasificación automática (alcance), exportar, reglas. |
| Endpoints | `GET /documentos`, `GET /documentos/:id`, `POST /clasificar`, `/anular`, `/clasificar-automatico`, `/aprender-regla`, `/reglas`, `/contrapartes`. |
| Estados | Skeleton de carga, vacío con «Limpiar filtros/búsqueda», error con «Reintentar», toast de éxito. |
| Problemas | Los filtros viven en el hash (bien) pero el estado vacío ofrece dos botones distintos según causa sin explicar la causa; el menú «⋮» mezcla acciones de distinta severidad (anular es destructiva y no se diferencia visualmente). |
| Mejora | Barra de filtros única + contador; acción destructiva separada y confirmada con consecuencia explícita; conservar UITabla. |

### P-006 · Libros de Compras y Ventas (`#libros`)

| Campo | Detalle |
|---|---|
| Objetivo | Ver el RCV tal como lo entrega el SII y disparar la ingesta. |
| Subpantallas | Pestañas Compras / Ventas / Resumen (conteos, totales, estado documental). |
| Acciones | «⇅ Sincronizar con SII» (job con progreso), cambio de período. |
| Estados | Progreso de ingesta por paso; tabla vacía si no hay documentos; error del job. |
| Problemas | La sincronización también existe en Onboarding, Sync diaria y Salud (4 disparadores); el usuario no sabe cuál usar. |
| Mejora | Un solo punto canónico («Actualizar desde SII») y los demás como enlaces a él. |

### P-015 · Asientos — Diario, Mayor y Plan (`#asientos`)

| Campo | Detalle |
|---|---|
| Objetivo | Consultar diario/mayor, crear asiento manual, revertir. |
| Subpantallas | Diario · Mayor · Plan de cuentas · Nuevo asiento (formulario con líneas dinámicas y totales). |
| Filtros | Período, cuenta, centro de costo, texto, contraparte (RUT en mayor). |
| Acciones | «Nuevo asiento», agregar/quitar línea, guardar, «Revertir» (con diálogo que identifica folio/fecha/monto y advierte que crea un asiento nuevo). |
| Validaciones UI | Debe = Haber antes de enviar; backend revalida todo. |
| Estados | Tabla vacía «Sin asientos en el período»; error del backend mostrado textual. |
| Problemas | El formulario de asiento manual es denso en móvil; la reversión se ofrece en la fila sin indicar el impacto contable hasta abrir el diálogo. |
| Mejora | Formulario en dos pasos (cabecera → líneas) con totales fijos; acción «Revertir» agrupada en un menú de acciones contables. |

### P-014 · Propuestas y Conciliación (`#propuestas`)

| Campo | Detalle |
|---|---|
| Objetivo | Confirmar propuestas (única puerta al asiento) y ver diferencias SII↔contable. |
| Acciones | Confirmar individual, confirmar lote del período, descartar, ejecutar conciliación, ver resultado. |
| Datos | Snapshot de líneas congelado, diferencias tipificadas. |
| Estados | Sin propuestas / con pendientes / diferencia 0. |
| Problemas | «Confirmar lote» no muestra el total de documentos ni el impacto antes de ejecutar; la conciliación es report-only pero la UI no lo dice. |
| Mejora | Resumen previo (n documentos, $X debe/haber) y leyenda «solo reporta, no corrige». |

### P-019 · Tesorería (`#tesoreria`)

| Campo | Detalle |
|---|---|
| Objetivo | Operar bancos y conciliar cartola. |
| Subpantallas | 3 pestañas: **Bancos** (incluye tarjeta de deuda fiscal TGR) · **Libro banco** · **Conciliación** (incluye importación de cartola). |
| Acciones | Crear banco (saldo inicial contabilizado), registrar pago/cobro/transferencia, importar cartola (pegado o archivo), analizar formato, mapeo manual, conciliar, consultar deuda TGR, ver PDF. |
| Estados | Importación con detección de formato y aviso si no se reconoce; conciliación con no conciliados de ambos lados. |
| Problemas | La deuda fiscal (TGR) vive dentro de la pestaña Bancos, donde no se espera; el estado de conciliación 1↔1 no se explica en la UI. |
| Mejora | Un espacio «Tesorería» con barra de cuentas y tres vistas: Movimientos, Cartola, Conciliación; deuda fiscal como tarjeta enlazada, no pestaña. |

### P-011 · Bandeja de DTEs Emitidos (`#dte`)

| Campo | Detalle |
|---|---|
| Objetivo | Ver DTEs, consultar estado SII verbatim, reintentar, sincronizar a contabilidad. |
| Filtros | Tipo (33/34/56/61), estado (PENDIENTE/ENVIADO/ACEPTADO/RECHAZADO). |
| Acciones | «Consultar SII», «Reintentar» (mismo folio), «Sincronizar contabilidad» con resumen de dos pasadas. |
| Estados | KPIs por estado; error del SII mostrado con código; sin DTEs. |
| Problemas | El estado local y el estado SII conviven sin una leyenda que los distinga; el botón de sync no indica cuántos documentos cambiarán. |
| Mejora | Columna «Estado SII (verbatim)» + «Estado interno», leyenda y confirmación con previsualización. |

### P-021 · Centro de Reportes (`#reportes`)

| Campo | Detalle |
|---|---|
| Objetivo | Descubrir y abrir los reportes reales. |
| Contenido | 6 grupos, 14 atajos reales, favoritos y recientes en `localStorage`, 6 tarjetas «No disponible todavía». |
| Problemas | **F29, PPM, centros de costo y antigüedad se declaran no disponibles aunque existen capacidades relacionadas.** `#analitica` aparece en dos grupos (Tributarios y Gestión) con distinto texto. |
| Mejora | Un catálogo generado desde una fuente única de capacidades reales; lo inexistente, fuera del catálogo y en un bloque «En preparación» con enlace a la hoja de ruta. |

### P-046 · Administración (`#admin`)

| Campo | Detalle |
|---|---|
| Subpantallas | 5 pestañas: **Empresas** · **Períodos** · **Usuarios y roles** · **Auditoría** · **Seguridad**. El plan de cuentas y los centros de costo se administran desde Asientos › Plan; la configuración de empresa, desde el detalle de la empresa. |
| Acciones | Crear empresa (RUT + clave SII), editar, dar de baja; crear usuario con clave provisional; reset de clave; desactivar/reactivar; eliminar definitivo; asignar rol; crear cuenta/CC; configurar modo de conciliación. |
| Riesgos | Acciones irreversibles (eliminar usuario, dar de baja empresa) conviven con acciones normales; el diálogo de eliminación definitiva debe explicar qué se borra (hoy lo hace en backend). |
| Mejora | Agrupar por «Personas», «Empresas», «Catálogos», «Parámetros»; acciones destructivas en zona separada con confirmación por texto. |

---

## 4. Modales y subpantallas transversales

| Componente | Origen | Contrato |
|---|---|---|
| `openModal(html)` / `cerrarModal()` | `app.js` | Backdrop, cierre por click/ Escape, foco al primer control y retorno al disparador. |
| Detalle de documento | P-005 | Folio, montos, documento, clasificación, contabilidad, detalle SII. |
| Clasificar documento | P-005 | Cuenta, CC, tratamiento IVA, «recordar para este RUT». |
| Anular documento | P-005 | Motivo obligatorio (máx. 500), deshabilitado hasta escribirlo. |
| Exportar | P-005 | CSV o Excel de lo filtrado. |
| Revertir asiento | P-015 | Folio/fecha/monto + advertencia de asiento nuevo. |
| Emitir DTE | P-010 | Receptor, ítems, referencia condicional, totales, idempotencia. |
| Cargar CAF | P-012 | XML pegado, validación de rango. |
| Importar cartola | P-019 | Pegado/archivo, detección de formato, mapeo. |

Todos usan el mismo componente; no hay modales anidados (el código cierra el anterior al abrir).

---

## 5. Pantallas que el rediseño NO debe perder

Aunque se fusionen visualmente, deben seguir existiendo como destino:
`#comprobacion`, `#balance8`, `#situacion`, `#resultados`, `#clasificado`, `#niif`, `#cclientes`, `#cproveedores`, `#externos`, `#memoria`, `#auditoria`, `#integraciones`, `#dte-config`, y los 10 `#portal-*`. Son enlaces guardados y, en varios casos, la única puerta a una capacidad.
