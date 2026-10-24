# 07 · Filtros, fechas y parámetros

> Fuente: vistas `frontend/sistema/views-*.js`, `app.js`, `url-estado.js`, y firmas de `backend/core/*` + `backend/routes/*`.
> Semántica de fechas al final (§6) y propuesta de criterios comunes (§8).

---

## 1. Contexto global (afecta a todas las pantallas)

| ID | Control | Valores | Default | Formato | Persistencia | Efecto |
|---|---|---|---|---|---|---|
| F-GLB-01 | Selector de empresa (sidebar) | Empresas asignadas al usuario | `localStorage.iva_empresa_activa`, si no la primera | `id` numérico | `localStorage` + `?empresa=` en el hash | Rehace el shell, recalcula permisos y licencia, **descarta el período anterior** |
| F-GLB-02 | Selector de período (header) | Últimos 24 meses + períodos registrados de la empresa | `periodoActual()` (mes calendario) | `YYYYMM` visible como «octubre 2026» | `localStorage.iva_periodo_activo` + `?periodo=` | Cambia el período de las vistas que lo leen; dispara `renderRoute()` |
| F-GLB-03 | Estado del período | `ABIERTO` / `CERRADO` | — | Chip | No | Informativo; se actualiza al cambiar el selector |
| F-GLB-04 | Búsqueda global (header) | Texto ≥ 2 caracteres | — | Texto | No | `GET /buscador?q=`, grupos según RBAC; Ctrl/⌘K |
| F-GLB-05 | Buscador del menú | Texto | — | Texto | No | Filtra ítems por texto o nombre de sección |
| F-GLB-06 | Contexto en URL | `empresa`, `periodo` + filtros de vista | — | Query del hash | URL | Fuente de verdad al entrar; empresa ajena/período inválido se ignoran y se reescribe |

### Propagación del período (implementación real)

`aplicarPeriodoGlobal(p)` escribe:
`localStorage`, `window._inicioPeriodo`, `_repPeriodo`, `_balance8Periodo`, `_clasificadoPeriodo`, `_situacionPeriodo`, `_resultadosPeriodo`, `_niifPeriodo`, `_niifResPeriodo`, `_asPeriodo`, `_tesoPeriodo`, `_ctaPeriodo`, `_propPeriodo`, `_librosPeriodo`, `_autoPeriodo`.

**Riesgo:** es una lista manual de 15 variables. Una vista nueva que no se registre aquí queda silenciosamente en el mes calendario. Además `_cierrePeriodo` **no** está en la lista: Cierre usa su propio selector y no sigue al global.

---

## 2. Filtros por pantalla

### P-005 · Bandeja de Documentos

| ID | Filtro | Valores | Default | Backend | Notas |
|---|---|---|---|---|---|
| F-P005-01 | Estado | `PENDIENTE`, `CLASIFICADO`, `PROPUESTO`, `CONTABILIZADO`, `REVISION`, `ERROR`, `ANULADO` (chips con conteo) | vacío (todos) | `estado` | Los conteos excluyen el filtro de estado (correcto: permiten ver el universo) |
| F-P005-02 | Flujo | compras / ventas | vacío | `tipo_flujo` (`compra`/`venta`) | — |
| F-P005-03 | Tipo de documento | 33, 34, 39, 41, 43, 46, 48, 52, 56, 60, 61… | vacío | `tipo_doc` (numérico) | Catálogo en la vista |
| F-P005-04 | Cuenta contable | Cuentas imputables de la empresa | vacío | `cuenta_id` | — |
| F-P005-05 | Texto | Razón social o folio | vacío | `texto` (LIKE en ambos) | Sin búsqueda por acentos en servidor; UITabla busca en lo cargado |
| F-P005-06 | RUT | Texto libre | vacío | `rut` (se quitan `.` y `-`, LIKE `%…%`) | Coincidencia parcial; no valida DV |
| F-P005-07 | Período | `YYYYMM` | período global | `periodo` | Del contexto, no de un input local |
| F-P005-08 | Orden / dirección | columnas de la tabla | `id DESC` | `orden`, `dir` | Lista blanca `ORDEN_BANDEJA` |
| F-P005-09 | Paginación | — | 200 | `limit` (máx. 1000), `offset` | El total del filtro se informa aparte |
| F-P005-10 | Exportación | CSV / Excel | — | Cliente (lo filtrado) | — |

### P-006 · Libros

| ID | Filtro | Valores | Default | Backend | Notas |
|---|---|---|---|---|---|
| F-P006-01 | Período | `YYYYMM` (input month local) | global | `periodo` | **Cambiarlo llama a `aplicarPeriodoGlobal`**: modifica el período de TODA la app |
| F-P006-02 | Libro | Compras / Ventas / Resumen | Compras | `tipo_flujo` | Pestaña |
| F-P006-03 | Texto (tabla) | — | — | Cliente (UITabla) | No va al servidor |
| F-P006-04 | Límite | — | 1000 | `limit` | Si hay más, la vista lo advierte y no suma el resto |

### P-002 · Salud Tributaria

| ID | Filtro | Valores | Default | Backend | Notas |
|---|---|---|---|---|---|
| F-P002-01 | Período | global | mes actual | `periodo` | No hay selector propio en la vista |
| F-P002-02 | Ventana (`meses`) | 1–60 (backend), **12 fijo en la vista** | 12 | `meses` | El informe imprimible acepta `meses`; la vista no. El comentario del código explica que antes la vista pedía 60 y el menú 12, produciendo índices distintos |
| F-P002-03 | Sin filtro de sucursal/cuenta | — | — | — | Todo el diagnóstico es por empresa |

### P-008 · Dashboard Tributario

| ID | Filtro | Valores | Backend | Notas |
|---|---|---|---|---|
| F-P008-01 | Año | último año con datos / años disponibles | `periodo` | Se envía el período global y la vista deriva el año |
| F-P008-02 | Top clientes / proveedores | 5/10/20 | Cliente | Cambia el ranking, no la consulta |

### P-010/P-011 · DTE

| ID | Filtro | Valores | Backend | Notas |
|---|---|---|---|---|
| F-P011-01 | Tipo | 33/34/56/61 | `tipo` | Query en el hash |
| F-P011-02 | Estado | PENDIENTE/ENVIADO/ACEPTADO/RECHAZADO | `estado` | Estado local, no el código SII |
| F-P011-03 | Límite | 50 por defecto en campana; 200 en bandeja | `limit` | — |

### P-014 · Propuestas y Conciliación

| ID | Filtro | Valores | Backend |
|---|---|---|---|
| F-P014-01 | Período | global | `periodo` |
| F-P014-02 | Estado de propuesta | PENDIENTE/CONFIRMADA/DESCARTADA | `estado` |
| F-P014-03 | Conciliación | período | `periodo` |

### P-015 · Asientos

| ID | Filtro | Valores | Backend |
|---|---|---|---|
| F-P015-01 | Período | global | `periodo` o `desde/hasta` |
| F-P015-02 | Cuenta | cuentas imputables | `cuenta_id` |
| F-P015-03 | Centro de costo | centros activos | `centro_costo_id` |
| F-P015-04 | Texto | glosa | `texto` |
| F-P015-05 | Contraparte (mayor) | RUT | `rut` |
| F-P015-06 | Rango de fechas (mayor) | `YYYY-MM-DD` | `desde/hasta` |

### P-019 · Tesorería

| ID | Filtro | Valores | Backend |
|---|---|---|---|
| F-P019-01 | Cuenta bancaria | bancos de la empresa | `banco_cuenta_id` |
| F-P019-02 | Desde / hasta | fechas ISO | `desde`, `hasta` |
| F-P019-03 | Límite | — | `limit` |
| F-P019-04 | Formato de cartola | formatos guardados | `formato` (mapeo) |

### P-022 · Cierre

| ID | Filtro | Valores | Default | Notas |
|---|---|---|---|---|
| F-P022-01 | Período a cerrar | input month local | `_cierrePeriodo` → `_repPeriodo` → global | **No** actualiza el período global; sí re-renderiza |

### P-029/P-030 · Cuenta corriente

| ID | Filtro | Valores | Backend | Notas |
|---|---|---|---|---|
| F-P029-01 | Rol | cliente / proveedor | `rol` | Dos ítems de menú para la misma vista |
| F-P029-02 | RUT | texto | `rut` | — |
| F-P029-03 | Desde / hasta | fechas ISO | `desde`, `hasta` | — |
| F-P029-04 | Límite | — | `limit` | — |

### P-045 · CRM

| ID | Filtro | Valores |
|---|---|---|
| F-P045-01 | Búsqueda de fichas | texto (`crm-fich-q`) |
| F-P045-02 | Prospectos: estado, búsqueda | `crm-pro-estado`, `crm-pro-q` |
| F-P045-03 | Oportunidades: etapa, estado, desde/hasta, búsqueda | `crm-opo-*` |
| F-P045-04 | Actividades: estado, vencimiento | `crm-act-*` |
| F-P045-05 | Campañas: empresa, plantilla | `crm-cam-*` |
| F-P045-06 | Informes: desde/hasta, responsable | `crm-inf-*` |

### P-047 · Auditoría

| ID | Filtro | Valores | Backend | Notas |
|---|---|---|---|---|
| F-P047-01 | Límite | — | `limit` (máx. 500) | La vista pide 200 |
| F-P047-02 | Búsqueda / agrupación | texto, columna | Cliente (UITabla) | **No hay filtros de servidor por usuario, acción, entidad ni fecha** |

### P-049 · Suscripción

| ID | Filtro | Valores | Backend |
|---|---|---|---|
| F-P049-01 | Historial de pagos | — | `empresaId` |
| F-P049-02 | Fecha de pago | — | Se muestra, no se filtra |

---

## 3. Parámetros de API (convenciones reales)

| Parámetro | Tipo | Dónde | Observaciones |
|---|---|---|---|
| `:empresaId` | path numérico | casi todos | Validado contra asignación |
| `:periodo` | path o query `YYYYMM` | reportes, cierre, automatización, salud | Validación `^\d{6}$` + mes 1–12 |
| `desde` / `hasta` | query ISO `YYYY-MM-DD` o `YYYYMM` según módulo | asientos, tesorería, cuenta corriente, salud | **No hay tipo único** |
| `limit` / `offset` | query numérico | documentos, auditoría, CRM, portal | Defaults variables (50/100/200/1000); máximos variables (500/1000) |
| `estado` | query string | documentos, propuestas, DTE, CRM | Catálogos distintos por módulo |
| `tipo` / `tipo_doc` / `tipo_flujo` | query | DTE, documentos | `tipo_flujo` singular (`compra`/`venta`) |
| `rut` | query | documentos, cuenta corriente, asientos externos | Normalización distinta por módulo |
| `meses` | query/body 1–60 | salud | La vista fija 12 |
| `anios` | body 1–6 | salud/declaraciones | — |
| `incluir_rcv` | body booleano | salud/sincronizar | Dispara ingesta |
| `idempotencia` | body string | DTE emitir | UNIQUE por empresa |

---

## 4. Persistencia de filtros

| Mecanismo | Usado por | Ventaja | Problema |
|---|---|---|---|
| Query del hash | Documentos, DTE, Libros (tab), contexto empresa/período | Compartible, Atrás/Adelante | Solo algunas vistas lo implementan |
| `localStorage` | Empresa, período, tema, secciones plegadas, favoritos de reportes, recientes del Centro | Sobrevive recarga | Puede contradecir la URL si algo falla |
| Variables `window._*` | Pestañas y períodos de contabilidad/tesorería/cierre | Simple | Se pierde al recargar; lista manual |
| Memoria de la vista | Pestañas de Salud, Admin, CRM | — | Se pierde al re-render |

---

## 5. Filtros redundantes o confusos

| # | Hallazgo | Consecuencia |
|---|---|---|
| FF-01 | **Dos selectores de período** (header global y Libros) que se sincronizan en un solo sentido: Libros escribe el global | Cambiar el mes en Libros cambia silenciosamente Informes y Salud |
| FF-02 | **Cierre tiene su propio período** y no sigue al global | Se puede estar «en octubre» y cerrar septiembre sin señal |
| FF-03 | **Reportes no muestra el período activo** en la tarjeta; lo aplica al abrir | El usuario no sabe qué mes verá |
| FF-04 | **Salud no permite ajustar la ventana** (12 fijo) mientras el backend admite 1–60 | No se puede pedir un diagnóstico de 24 meses desde la UI |
| FF-05 | **Auditoría sin filtros de servidor** | La búsqueda local sobre 200 registros parece exhaustiva y no lo es |
| FF-06 | **RUT como LIKE parcial** en documentos vs igualdad en otros módulos | Resultados distintos para el «mismo» filtro |
| FF-07 | **`tipo` en DTE** (numérico) vs **`tipo_doc`** en documentos | Dos nombres para el mismo concepto |
| FF-08 | **Estado local vs estado SII** en DTE | El filtro `estado` no filtra por el código del SII |
| FF-09 | **Sin filtro por estado de sincronización** en Bandeja (solo por estado documental) | No se puede aislar «lo que no vino del SII» |

---

## 6. Semántica de fechas (lo que cada fecha significa realmente)

| Fecha / período | Dónde se usa | Significado | Evidencia |
|---|---|---|---|
| `periodo_ingesta` | Documentos, Libros, Salud, analítica | **Período tributario** del documento (mes del RCV), no la fecha de descarga | `documentos.periodo_ingesta`; filtros de bandeja |
| `fecha_docto` | Documento | Fecha de emisión del documento según el SII | `documentos.fecha_docto` |
| `fecha_emision` | DTE emitido, devengo | Fecha de emisión del DTE (devengo contable en `dte-contable`) | `dte_emitidos.fecha_emision` |
| `fecha` (asiento) | Asientos, mayor | Fecha contable; determina el período `YYYYMM` y el bloqueo por cierre | `asientos.fecha`, `periodos_contables` |
| `periodo` (contable) | Períodos, reportes, cierre | Mes contable `YYYYMM` con estado ABIERTO/CERRADO | `periodos_contables` |
| `desde/hasta` (tesorería) | Libro banco, cartola | Fecha de movimiento bancario | `teso_movimientos.fecha` |
| `fecha_presentacion` | F29/F22 | Fecha en que el SII registra la presentación | `declaraciones_sii` |
| `fecha_vencimiento` | DJ, F29 | Vencimiento legal | `dj_sii`, declaraciones |
| `consultado_en` | Ficha, declaraciones, TGR, salud | Fecha/hora de la consulta al portal | `salud_tributaria_snapshots`, `deuda_tgr` |
| `liquidada_al` | Deuda TGR | Fecha a la que la TGR liquida la deuda | `deuda_tgr` |
| `generado_en` | Informe de salud | Fecha/hora de generación del informe | `construirInforme` |
| `creado_en` | Auditoría | Fecha/hora del evento | `auditoria` |

**Regla de oro vigente:** el F29 estimado se calcula por período tributario (`YYYYMM`), no por fecha de emisión. El devengo del DTE usa `fecha_emision` (documentado en `dte-contable`). La conciliación usa el período.

**Riesgo detectado:** la UI no distingue estas semánticas. Un usuario puede creer que «período» en Bandeja es el mes de emisión del documento, cuando es el mes en que el SII lo imputa (`periodo_ingesta`).

---

## 7. Validaciones observadas

| Entrada | Validación | Dónde |
|---|---|---|
| Período | `^\d{6}$` + mes 1–12 | `salud.periodoValido`, rutas de reportes |
| `meses` | entero 1–60, default 12 | `routes/salud.leerMeses` |
| `anios` | entero 1–6 | `routes/salud` |
| `limit` | tope variable (500/1000) | documentos, auditoría |
| Fecha de asiento | `YYYY-MM-DD` válida | `asientos.crear` |
| Montos | entero en pesos | `asientos` |
| RUT | normalización distinta por módulo | documentos (LIKE), cuenta corriente, DTE |
| Formato de archivo de cartola | detección + mapeo guardado | `tesoreria-cartola-formatos` |

---

## 8. Propuesta de criterios comunes (no implementada)

1. **Un solo período activo** en el shell, visible en el header y en la URL; cualquier selector local debe declarar si lo cambia o solo lo lee. Cierre puede ser la excepción, pero debe mostrar «cerrando septiembre (distinto del período activo)».
2. **Objeto de contexto único** (`empresa`, `periodo`, `desde`, `hasta`) en lugar de 15 variables `window._*`.
3. **Nomenclatura única de parámetros:** `periodo` (YYYYMM), `desde`/`hasta` (ISO), `tipo_documento`, `estado`, `texto`, `rut`, `limite`, `desplazamiento`.
4. **RUT canónico**: normalizar a `cuerpo-DV` y comparar por igualdad; si se quiere búsqueda parcial, exponerla como `texto`.
5. **Toda tabla con filtros de servidor** debe ofrecer los mismos ejes: período/rango, estado, texto, orden y paginación; la búsqueda local no reemplaza al filtro.
6. **Mostrar siempre el alcance:** «mostrando X de Y», «período tributario», «datos al DD/MM HH:MM».
7. **Fechas con etiqueta semántica**, no «Fecha»: «Emisión», «Recepción SII», «Contabilización», «Vencimiento», «Consultado».
