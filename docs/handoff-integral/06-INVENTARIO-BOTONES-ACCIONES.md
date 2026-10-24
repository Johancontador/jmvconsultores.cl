# 06 · Inventario de botones y acciones

> Criterio: se documentan **todas las pantallas** y las acciones con consecuencia funcional (consulta, escritura, navegación, exportación, ayuda). No se listan una por una las 235 ocurrencias literales de `<button`, porque muchas son plantillas de fila repetidas; se indica su familia y el manejador real.
> El borrador de acciones se obtuvo de `frontend/sistema/views-*.js` y de los endpoints que invoca cada handler.

---

## 1. Taxonomía actual (de facto)

| Tipo | Clase / patrón | Uso observado |
|---|---|---|
| Primaria | `.btn.btn-primary` | Acción principal de la pantalla («Sincronizar con SII», «Reunir antecedentes», «Emitir DTE al SII») |
| Secundaria | `.btn.btn-secondary` | Alternativa («Cancelar», «Exportar», «Consultar estado») |
| Pequeña | `.btn-sm` | Acciones de fila y barras de herramientas |
| Destructiva | `.btn-danger` | «Revertir asiento», «Anular documento», «Eliminar», «Eliminar etapa» |
| Navegación | `<a class="btn ..." href="#ruta">` | «Ver informe de salud», «Abrir», «Ir a Libros» |
| Icono | `<button>` con texto simbólico (`⋮`, `✕`) | Menú de acciones, eliminar etapa |
| Estado/pill | `<span class="chip">`, `<b class="pill">` | No interactivos (salvo el pill del menú, dentro de un `<a>`) |
| Enlace de texto | `<a id="sys-logout">Salir</a>` | Logout, enlaces de ayuda |

**No existe** una guía de cuándo usar cada tipo; conviven «Sincronizar» como primario y como secundario según la pantalla.

---

## 2. Catálogo de acciones por pantalla

### P-001 · Panel del período

| ID | Acción | Tipo | Efecto real | Permiso | Estados |
|---|---|---|---|---|---|
| AC-P001-01 | Ver informe de salud | Navegación | `#salud` | `salud:ver` (ítem visible solo con permiso) | — |
| AC-P001-02 | Abrir (automatización) | Navegación | `#automatizacion` | `propuestas:ver` | — |
| AC-P001-03 | Completar (onboarding) | Navegación | `#onboarding` | `documentos:ver` | — |
| AC-P001-04 | Sincronizar un período | Navegación | `#libros` | `documentos:ver` | — |
| AC-P001-05 | Atajos (Libros, Documentos, Contabilidad, Propuestas, Reportes) | Navegación | 5 anchors | según ítem | — |
| AC-P001-06 | Reintentar (jobs) | Botón | Re-consulta `/jobs/estado` | `documentos:ver` | Solo aparece si hay error |

### P-002 · Salud Tributaria

| ID | Acción | Tipo | Handler / endpoint | Permiso | Validaciones / estados |
|---|---|---|---|---|---|
| AC-P002-01 | **Reunir antecedentes** | Primaria | `POST /salud-tributaria/reunion` → polling cada 3 s de `/reunion/:jobId` (máx. 30 min) | `salud:sincronizar` | Deshabilita y cambia a «Reuniendo…»; muestra 6 pasos; si hay pasos con error, toast de error con nombres; al terminar `renderRoute()` |
| AC-P002-02 | **Emitir informe (PDF)** | Secundaria | `window.open('/salud-tributaria/informe?periodo=…')` | `salud:ver` | **Abre HTML**, no un PDF; si el navegador bloquea el popup, toast de error |
| AC-P002-03 | Consultar deuda fiscal | Primaria | `POST /tesoreria/deuda-fiscal/consultar` | **`tesoreria:operar`** (capacidad de otro módulo) | Deshabilita, «Consultando la TGR…», toast, re-render |
| AC-P002-04 | Ver certificado (PDF) | Secundaria | `window.open('/tesoreria/deuda-fiscal/certificado')` | `salud:ver` (la ruta exige `tesoreria:ver`) | Solo si existe PDF; **posible 403 si el rol ve salud pero no tesorería** |
| AC-P002-05 | Pestañas (10) | Navegación local | Cambia panel visible; `scrollTo` suave | — | No persiste en URL; al re-render vuelve a Resumen |
| AC-P002-06 | Badges «Módulo 0…7» | **Decorativo** | Ninguno | — | Animación infinita `kpiPulse`; no aporta información |

### P-003 · Alertas

| ID | Acción | Tipo | Efecto | Permiso |
|---|---|---|---|---|
| AC-P003-01 | Abrir documento / vista relacionada | Navegación | `#documentos`, `#libros` | `documentos:ver` |
| AC-P003-02 | Filtrar por tipo de alerta | Botón de filtro | Re-render de la lista | `documentos:ver` |

### P-004 · Centro de Aplicaciones

| ID | Acción | Tipo | Efecto | Notas |
|---|---|---|---|---|
| AC-P004-01 | Tarjeta de app | Navegación | Abre la primera ruta de la app | Solo apps autorizadas por `/api/auth/centro` |
| AC-P004-02 | Continuar donde quedó | Navegación | Última ruta registrada | `localStorage` por usuario |
| AC-P004-03 | Módulos recientes (chips) | Navegación | Hasta 6 rutas | — |

### P-005 · Bandeja de Documentos

| ID | Acción | Tipo | Endpoint | Permiso | Notas |
|---|---|---|---|---|---|
| AC-P005-01 | Buscar / filtrar | Inputs y selects | `GET /documentos?...` | `documentos:ver` | Debounce; filtros en hash |
| AC-P005-02 | Chips de estado con conteo | Filtro | Igual | `documentos:ver` | `aria-pressed` |
| AC-P005-03 | Clasificar (fila) | Secundaria | Abre modal → `POST /documentos/:id/clasificar` | `documentos:clasificar` | Oculta sin permiso |
| AC-P005-04 | ⋮ (más acciones) | Icono | Menú contextual | — | `aria-haspopup`, `aria-expanded`, `aria-label` con folio |
| AC-P005-05 | Ver detalle | Secundaria | `GET /documentos/:id` | `documentos:ver` | Modal con 6 secciones |
| AC-P005-06 | Anular… | **Destructiva** | Modal → `POST /documentos/:id/anular` | `documentos:clasificar` | Botón deshabilitado hasta escribir motivo (máx. 500) |
| AC-P005-07 | Clasificar automático | Primaria | Modal → `POST /documentos/clasificar-automatico` | `documentos:clasificar` | Botón del modal deshabilitado si alcance = 0 |
| AC-P005-08 | Reglas | Secundaria | `GET /reglas`; desactivar `POST /reglas/:id/desactivar` | `reglas:ver` / `reglas:editar` | Modal con tabla |
| AC-P005-09 | Exportar (CSV / Excel) | Secundaria | Cliente (datos filtrados) | `documentos:ver` | Botones deshabilitados sin filas |
| AC-P005-10 | Limpiar filtros / búsqueda | Secundaria | Re-render | — | Dos botones distintos según el estado vacío |
| AC-P005-11 | Reintentar (error) | Secundaria | Repite la carga | — | — |
| AC-P005-12 | Paginación / orden / copiar / imprimir | UITabla | Cliente | — | Totales de lo filtrado en `tfoot` |

### P-006 · Libros

| ID | Acción | Tipo | Endpoint | Permiso | Notas |
|---|---|---|---|---|---|
| AC-P006-01 | ⇅ Sincronizar con SII | Primaria | `POST /documentos-ingesta` + polling `/documentos-ingesta/:jobId` | `documentos:ingestar` | Progreso por paso; **cuarto** disparador de la misma ingesta |
| AC-P006-02 | Pestañas Compras/Ventas/Resumen | Filtro | Re-render | `documentos:ver` | — |
| AC-P006-03 | Exportar / imprimir | UITabla | Cliente | — | — |

### P-007 · Onboarding

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P007-01 | Consultar SII | Primaria | `POST /onboarding/consultar-sii` | `onboarding:ejecutar` |
| AC-P007-02 | Aplicar propuesta / Guardar ficha | Primaria | `POST /onboarding/confirmar-ficha` | `onboarding:ejecutar` |
| AC-P007-03 | Ingesta del histórico | Primaria | `POST /onboarding/ingesta-historica` | `onboarding:ejecutar` |
| AC-P007-04 | Cancelar | Secundaria | Cierra modal | — |

### P-008 · Dashboard Tributario

| ID | Acción | Tipo | Efecto |
|---|---|---|---|
| AC-P008-01 | Selector de año | Select | Re-consulta `/analitica` |
| AC-P008-02 | Top clientes/proveedores | Select | Cambia el ranking |
| AC-P008-03 | Alertas (duplicados, RUT inválido) | Informativo | Enlaces a documentos cuando aplica |

### P-009 · Calculadora de IVA

| ID | Acción | Tipo | Efecto |
|---|---|---|---|
| AC-P009-01 | Inputs neto/IVA/total | Cálculo local | Recalcula los otros dos (19 %) |
| AC-P009-02 | Limpiar | Secundaria | Vacía campos y diferencia |
| AC-P009-03 | IVA determinado provisional | Informativo | Débito − crédito, rotulado «provisional» |

### P-010/P-011/P-012 · Facturación

| ID | Acción | Tipo | Endpoint | Permiso | Notas |
|---|---|---|---|---|---|
| AC-P010-01 | Emitir DTE al SII | Primaria | `POST /dte/empresas/:id/emitir` | `dte:emitir` | Totales en vivo; clave de idempotencia al abrir el formulario |
| AC-P010-02 | Agregar/quitar ítem | Secundaria | Cliente | — | Totales idénticos a `calcularMontos` |
| AC-P010-03 | Descartar borrador | Secundaria | Cliente | — | — |
| AC-P011-01 | Filtros tipo/estado | Selects | `GET /dtes?tipo&estado` | `dte:ver` | Query en hash |
| AC-P011-02 | Consultar SII | Secundaria | `POST /dtes/:id/estado` | `dte:emitir` | Estado verbatim |
| AC-P011-03 | Reintentar | Secundaria | `POST /dtes/:id/reintentar` | `dte:emitir` | Mismo folio |
| AC-P011-04 | Sincronizar contabilidad | Primaria | `POST /sincronizar-contabilidad` | `dte:emitir` | Muestra resumen de dos pasadas |
| AC-P012-01 | Guardar ficha | Primaria | `PUT /config` | `dte:configurar` | Certificado y clave nunca se releen |
| AC-P012-02 | Cargar CAF | Primaria | `POST /folios` | `dte:configurar` | XML pegado; valida rango |
| AC-P012-03 | Quitar (CAF/certificado) | **Destructiva** | `PUT /config` / endpoint de baja | `dte:configurar` | Confirmación por RUT en el caso del certificado |

### P-013/P-014 · Automatización y Propuestas

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P013-01 | Contabilizar automáticamente | Primaria | `POST /automatizacion/:periodo/ejecutar` | `automatizacion:ejecutar` |
| AC-P013-02 | Instalar reglas iniciales | Secundaria | `POST /automatizacion/semilla` | `reglas:editar` |
| AC-P014-01 | Confirmar propuesta | Primaria | `POST /propuestas/:id/confirmar` | `propuestas:confirmar` |
| AC-P014-02 | Confirmar lote del período | Primaria | `POST /propuestas/confirmar-lote` | `propuestas:confirmar` |
| AC-P014-03 | Descartar | Secundaria | `POST /propuestas/:id/descartar` | `propuestas:generar` |
| AC-P014-04 | Conciliación (ejecutar / ver) | Secundaria | `POST /conciliacion/:periodo/ejecutar`, `GET /conciliacion/:periodo` | `conciliacion:ejecutar` / `:ver` |
| AC-P014-05 | Forzar con pendientes (cierre) | **Destructiva controlada** | Cierre con `requiere` texto | `periodos:cerrar` |

### P-015 · Asientos

| ID | Acción | Tipo | Endpoint | Permiso | Notas |
|---|---|---|---|---|---|
| AC-P015-01 | Nuevo asiento | Primaria | Abre formulario | `asientos:crear` | — |
| AC-P015-02 | Agregar línea | Secundaria | Cliente | — | Mínimo 2 |
| AC-P015-03 | Guardar asiento | Primaria | `POST /asientos` | `asientos:crear` | Debe = Haber en UI; backend revalida |
| AC-P015-04 | Revertir asiento | **Destructiva** | `POST /asientos/:id/revertir` | `asientos:revertir` | Diálogo con folio/fecha/monto; oculto si ya revertido o sin escritura |
| AC-P015-05 | Ver mayor / plan / diario | Pestañas | `GET /mayor`, `/cuentas` | `asientos:ver` | — |

### P-016 · Memoria

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P016-01 | Asignar cuenta a RUT | Primaria | `POST /memoria` | `documentos:clasificar` |
| AC-P016-02 | Guardar configuración (simple/completa) | Primaria | `PUT /config` | `config:editar` |

### P-017 · Receptor externo

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P017-01 | Validar códigos | Secundaria | `GET /asientos-externos/validar-codigos` | `asientos:ver` |
| AC-P017-02 | Copiar contrato | Secundaria | Cliente | — |

### P-018 · Activos

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P018-01 | Registrar activo | Primaria | `POST /activos` | `activos:operar` |
| AC-P018-02 | Confirmar depreciación del período | Primaria | `POST /activos-depreciacion/:periodo/confirmar` | `activos:operar` |
| AC-P018-03 | Venta / Baja | **Destructiva** | `POST /activos/:id/venta-baja` | `activos:operar` |

### P-019 · Tesorería

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P019-01 | Crear banco | Primaria | `POST /bancos` | `tesoreria:operar` |
| AC-P019-02 | Registrar pago / cobro / transferencia | Primaria | `POST /tesoreria/pagos|cobros|transferencias` | `tesoreria:operar` |
| AC-P019-03 | Importar cartola (pegar / archivo) | Primaria | `POST /tesoreria/cartola`, `/cartola-archivo` | `bancos:conciliar` |
| AC-P019-04 | Analizar archivo / Re-analizar con mapeo | Secundaria | `GET/POST /cartola-formatos` | `bancos:conciliar` |
| AC-P019-05 | Conciliar | Primaria | `POST /tesoreria/conciliar` | `bancos:conciliar` |
| AC-P019-06 | Consultar deuda fiscal | Primaria | `POST /tesoreria/deuda-fiscal/consultar` | `tesoreria:operar` |
| AC-P019-07 | Ver certificado (PDF) | Secundaria | `GET /deuda-fiscal/certificado` | `tesoreria:ver` |

### P-020 · Cobranza

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P020-01 | Pagada | Primaria | `POST /cobranza/:documentoId/pagada` | `tesoreria:operar` |
| AC-P020-02 | Aplicaciones | Secundaria | `GET /tesoreria/documentos/:id/aplicaciones` | `tesoreria:ver` |

### P-021 · Centro de Reportes

| ID | Acción | Tipo | Efecto | Notas |
|---|---|---|---|---|
| AC-P021-01 | Abrir reporte | Navegación | `#hash` (+ `tabVar/tabVal`) | 14 atajos reales |
| AC-P021-02 | Fijar / actualizar favorito | Secundaria | `localStorage` | — |
| AC-P021-03 | Buscar | Input | Filtra tarjetas | — |
| AC-P021-04 | «No disponible todavía» | **Informativo** | Ninguno | 6 tarjetas; 4 de ellas son capacidades existentes en otro módulo |

### P-022 · Cierre

| ID | Acción | Tipo | Endpoint | Permiso | Notas |
|---|---|---|---|---|---|
| AC-P022-01 | Preparar cierre | Secundaria | `GET /cierre/:periodo/preparar` | `periodos:ver` | Checklist |
| AC-P022-02 | Cerrar período | **Destructiva controlada** | `POST /cierre/:periodo/ejecutar` | `periodos:cerrar` | Confirmación con texto |
| AC-P022-03 | Reabrir | **Destructiva controlada** | `POST /periodos/:periodo/reabrir` | `periodos:reabrir` | Auditada |

### P-023–P-030 · Reportes y estados

| ID | Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|---|
| AC-P023-01 | Ver comprobación | Consulta | `GET /reportes/balance/:periodo` | `reportes:ver` |
| AC-P024-01 | Ver balance 8 columnas | Consulta | `GET /reportes/balance8/:periodo` | `reportes:ver` |
| AC-P025-01 | Ver situación financiera | Consulta | `GET /reportes/situacion/:periodo` | `reportes:ver` |
| AC-P026-01 | Ver resultados | Consulta | `GET /reportes/resultados/:periodo` | `reportes:ver` |
| AC-P027-01 | Ver clasificado | Consulta | `GET /reportes/clasificado/:periodo` | `reportes:ver` |
| AC-P028-01 | Guardar mapeo NIIF | Primaria | `PUT /niif/mapeo` | `cuentas:editar` |
| AC-P029/030-01 | Filtrar por RUT / desde / hasta | Inputs | `GET /reportes/cuenta-corriente` | `reportes:ver` |
| AC-P029/030-02 | Limpiar | Secundaria | Re-render | — |

### P-031–P-034 · Lote del despacho (legacy)

| ID | Acción | Tipo | Endpoint | Notas |
|---|---|---|---|---|
| AC-P031-01 | Editar / Eliminar cliente | Primaria / destructiva | `PUT/DELETE /clientes/:id` | Capa legacy con scoping |
| AC-P032-01 | Generar informe | Primaria | `POST /informe/generar` | Job en memoria |
| AC-P032-02 | Imprimir / PDF, WhatsApp, Ver mensaje, Copiar | Secundaria | Cliente | — |
| AC-P033-01 | Proceso masivo (F29) | Primaria | `POST /proceso/generar` | Job en memoria |
| AC-P033-02 | Reintentar | Secundaria | `POST /proceso/reintentar/:cliente_id` | — |
| AC-P034-01 | Generar ZIP | Primaria | `POST /exportacion-masiva/generar` | Descarga posterior |

### P-035–P-044 · Portal

| Acción | Tipo | Endpoint | Notas |
|---|---|---|---|
| Filtrar ventas (fechas, texto), exportar CSV | Consulta | `/movimientos`, `/exportar.csv` | Read-only |
| Guardar / eliminar reporte | Primaria / destructiva | `POST/DELETE /reportes` | Por empresa |
| Fijar crédito | Primaria | `PUT /credito` | — |
| Importar costos CSV | Primaria | `POST /costos-csv` | Validación de formato |
| Crear / editar / eliminar cotización | Primaria / destructiva | `POST/PUT/DELETE /cotizaciones` | — |
| Sincronizar / reintentar | Primaria | `POST /sincronizar` + `/estado` | — |

### P-045 · CRM (resumen de familias)

| Familia | Acciones | Endpoints |
|---|---|---|
| Pipeline | Cambiar etapa, registrar interacción, notas | `POST /pipeline/:empresaId`, `/interaccion` |
| Recordatorios | Crear, completar | `POST /recordatorios`, `/:id/completar` |
| Campañas | Crear, «Marcar enviada», generar por lote | `POST /campanas`, `/:id/enviar`, `/lote` |
| Fichas / contactos | Crear, editar, eliminar contacto | `PUT /fichas/:id`, `PATCH/DELETE /contactos/:id` |
| Prospectos | Crear, importar, convertir | `POST /prospectos*` |
| Oportunidades | Crear, cambiar etapa, historial | `POST/PATCH /oportunidades*` |
| Etapas | Crear, renombrar, eliminar (no terminal) | `POST/PATCH/DELETE /etapas` |
| Informes | Filtrar, exportar CSV | `GET /informes`, `/buscar`, `/duplicados` |

### P-046 · Administración

| ID | Acción | Tipo | Endpoint | Permiso | Riesgo |
|---|---|---|---|---|---|
| AC-P046-01 | Consultar SII y crear (empresa) | Primaria | `POST /empresas/desde-sii` | admin | Llama al SII; idempotente |
| AC-P046-02 | Editar empresa | Primaria | `PUT /empresas/:id` | `empresas:editar` | — |
| AC-P046-03 | Dar de baja empresa | **Destructiva** | `DELETE /empresas/:id` | admin | Baja lógica |
| AC-P046-04 | Crear usuario (clave provisional) | Primaria | `POST /auth/usuarios` | admin | Clave mostrada una vez |
| AC-P046-05 | Reset de clave | **Destructiva** | `POST /auth/usuarios/:id/reset-clave` | admin | Revoca sesiones |
| AC-P046-06 | Desactivar / Reactivar | **Destructiva** | `DELETE /usuarios/:id`, `POST .../reactivar` | admin | Desactivar cierra sesiones |
| AC-P046-07 | Eliminar definitivo | **Irreversible** | `DELETE /usuarios/:id/definitivo` | admin | Borra auditoría/sesiones/asignaciones; protegido contra el admin semilla |
| AC-P046-08 | Asignar rol | Primaria | `POST /empresas/:id/usuarios` | admin | — |
| AC-P046-09 | Crear cuenta / centro de costo | Primaria | `POST /cuentas`, `/centros-costo` | `cuentas:editar` | — |
| AC-P046-10 | Cambiar contraseña | Primaria | `POST /auth/password` | sesión | Revoca todas las sesiones |

### P-047 · Auditoría

| Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|
| Buscar / ordenar / agrupar (en memoria sobre los últimos 200) | UITabla | Cliente | `auditoria:ver` |
| Exportar | UITabla | Cliente | — |

> El endpoint solo acepta `limit` (máx. 500) y `offset`; **no existen filtros de servidor** por usuario, acción, entidad ni fecha. La búsqueda es local sobre los 200 registros cargados, lo que puede inducir a creer que no hay eventos anteriores.

### P-048 · Integraciones

| Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|
| Probar conexión SII | Primaria | `POST /sii/probar` (rate-limit propio) | sesión |
| Ver últimas sincronizaciones | Consulta | `GET /jobs/estado` | `documentos:ver` |

### P-049 · Suscripción y Pagos

| Acción | Tipo | Endpoint | Permiso |
|---|---|---|---|
| Contratar / renovar | Primaria | `POST /pagos/empresas/:id/checkout` | `licencias:pagar` |
| Emitir factura / Emitir DTE | Primaria | `POST /pagos/:pagoId/factura` | `facturacion:emitir` |
| Ver historial | Consulta | `GET /pagos/:empresaId/pagos` | `licencias:ver` |

---

## 3. Acciones duplicadas o redundantes

| Acción | Lugares | Consecuencia |
|---|---|---|
| Sincronizar RCV | Libros, Onboarding, Salud (opcional), Sync diaria (login) | Cuatro caminos; el usuario no sabe cuál es el canónico. Mitigado por mutex |
| Consultar deuda fiscal | Salud (pestaña TGR) y Tesorería | Dos botones, distinta capacidad (`tesoreria:operar`), misma acción |
| Ver informe / certificado | Salud («Emitir informe»), informe TGR, reportes | Lenguaje de «certificado» aplicado a tres cosas distintas |
| Ir a reportes | Menú, Centro de Reportes, tarjetas del Panel, atajos | Misma pantalla con contextos distintos |
| Confirmar propuestas | Individual y lote | El lote no muestra impacto previo |
| Abrir documentos | Alertas, Bandeja, Libros, Propuestas | Correcto (misma fuente) pero la barra de filtros se repite |

---

## 4. Botones decorativos, engañosos o sin función

| Elemento | Dónde | Problema | Corrección propuesta |
|---|---|---|---|
| Badges «Módulo 0…7» + `kpiPulse` | P-002 portada | Decorativos, animación infinita, no informan | Eliminar |
| «Última actualización SII: hoy» | P-002 (función `kpiUltimaActualizacion`, hoy no invocada) | Si se usara, afirmaría una actualización que no se consultó | Reemplazar por fecha real de cada fuente |
| «Emitir informe (PDF)» | P-002 | Abre HTML para imprimir; no genera PDF | «Ver informe imprimible» + instrucción de impresión |
| «No disponible todavía» (F29, PPM, centros de costo) | P-021 | Contradice capacidades existentes | Enlazar a la función real o retirar |
| «Certificado» de deuda vs «Informe» de salud | P-002 | Dos significados de certificado | Reservar «certificado» para documentos oficiales (TGR/SII) |
| Tarjetas de KPI con tooltip `title` | P-002 | La fórmula solo aparece al pasar el mouse; inaccesible en táctil | Ficha «cómo se calcula» visible |
| «Re-analizar con este mapeo» | P-019 | Correcto, pero sin explicar qué cambia | Texto de consecuencia |

---

## 5. Estados de los controles (auditoría)

| Estado | Implementación | Cobertura |
|---|---|---|
| Hover | CSS `:hover` | Amplia |
| Focus | `:focus-visible` en botones/inputs/nav | Amplia; `outline` de 2 px |
| Active | `.active` en nav; `:active` en botones | Parcial |
| Disabled | `disabled` real | Correcto en anular, clasificar automático, acciones en curso |
| Loading | Texto cambia («Verificando…», «Reuniendo…», «Consultando la TGR…») + `aria-busy` en tablas | Correcto; falta spinner en varias |
| Error | Cartel `.ui-error` o toast | Mensaje del backend, sin taxonomía |
| Confirmación | `UIEstado.confirmar` con texto obligatorio para cierres/reversiones | Buena práctica, aplicada de forma despareja |

**Carencia de accesibilidad:** los botones icono (`⋮`, `✕`) tienen `aria-label` en los casos revisados, pero el menú contextual de la bandeja no implementa navegación por teclado con flechas ni `role="menu"`.

---

## 6. Reglas de acción propuestas (para `17`)

1. **Una acción primaria por pantalla.** Si hay dos, una es secundaria.
2. **Destructivas:** color `danger`, separadas del resto, confirmación con consecuencia y, si es irreversible, texto a escribir.
3. **Navegación:** enlace, no botón; no debe verse igual que una acción que escribe.
4. **Diferir:** toda acción que dispara un job debe mostrar progreso y permitir cerrar la vista sin perder el estado.
5. **Deshabilitar con motivo:** un botón deshabilitado debe explicar por qué (título o texto adyacente).
6. **Etiqueta = resultado**, no mecanismo: «Actualizar desde SII», no «⇅ Sincronizar con SII».
