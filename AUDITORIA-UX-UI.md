# AUDITORÍA UX/UI — Sistema Contable JMV

**Fecha:** 2026-10-17 · **Commit auditado:** `4dd4beb` (branch `master`) · **Modo:** solo lectura
**Alcance:** repositorio completo (`backend/` 21.390 líneas, `frontend/` SPA 8.285 líneas + 11 páginas HTML heredadas).
**Nada se modificó:** ni código, ni estilos, ni rutas, ni base de datos, ni configuración, ni producción. El único archivo creado es este informe.

---

## 0. Método y niveles de evidencia

No alcanza con encontrar un botón: el sistema tiene 218 endpoints, 44 entradas de menú y 16 módulos de vista, y no todos los caminos están ejercitados. Por eso cada afirmación se etiqueta:

| Marca | Significado |
|---|---|
| **[PRUEBA]** | Verificado ejecutando la suite en este commit (492 tests de `npm test` + 10 de `test/buscador.test.js`, que **no** está en el script). |
| **[CÓDIGO]** | Verificado leyendo la implementación (ruta + vista + llamada HTTP correspondiente). No implica que el flujo funcione contra datos reales. |
| **[NO VERIFICADO]** | Existe en código pero depende de terceros o de datos que esta auditoría no ejerció: SII en vivo, emisión de DTE con certificado, webhook de pagos, cartolas bancarias reales, envío efectivo de campañas. |

**Comandos ejecutados** (sin escritura sobre el proyecto):

```bash
node --test <53 archivos de package.json>   # 492 pass, 0 fail, EXIT=0
node --test test/buscador.test.js           # 10 pass, 0 fail, EXIT=0 (fuera de npm test)
```

**Qué no se hizo:** no se levantó un entorno con datos reales, no se consultó el SII, no se emitió ningún DTE, no se ejecutó ningún pago. Por lo tanto **ningún proceso de negocio se declara “funcionando”**: solo “implementado y con pruebas” o “no verificado”.

---

## 1. Resumen ejecutivo

1. **La aplicación ya es un ERP contable real, no un prototipo.** 218 endpoints, partida doble, períodos, cierre, conciliación, tesorería, activos, NIIF, DTE, CRM y portal de cliente. El rediseño debe ser de **superficie**, no de dominio.
2. **El problema central es de navegación, no de funciones.** 44 entradas en 9 secciones dentro de una barra lateral de 250 px, sin agrupación colapsable: el usuario tiene que recorrer 44 ítems para llegar a “Cierre de período”.
3. **Hay funciones terminadas que no tienen entrada en la interfaz**: revertir asiento, anular documento, administrar formatos de cartola y ver aplicaciones de tesorería. Están en la API y en el modelo de permisos, pero ningún botón las invoca. **[CÓDIGO]**
4. **Hay 6 tarjetas que prometen funciones inexistentes** (“En preparación”: Flujo de efectivo, Cambios en patrimonio, F29, PPM, Antigüedad de saldos, Centros de costo). Es el único “solo UI” del sistema y hoy convive con funciones reales en el mismo cuadro. **[CÓDIGO]**
5. **Cinco reportes son accesibles por dos caminos** (menú lateral y Centro de Reportes) y tres de ellos se solapan en contenido (Situación financiera vs Balance clasificado vs NIIF; Comprobación vs 8 columnas). Duplicación de superficie, no de cálculo.
6. **Los estados de carga/vacío/error son inconsistentes**: el componente `UIEstado` existe y se usa en 4 archivos; las otras 12 vistas pintan “Cargando…” a mano y algunos errores quedan como texto rojo suelto. **[CÓDIGO]**
7. **Las tablas no son un componente único**: **75 tablas** repartidas en 13 archivos (20 solo en CRM) más `UITabla` en 3 archivos. Sin ordenamiento, paginación ni exportación homogéneas. **[CÓDIGO]**
8. **Accesibilidad muy por debajo del sitio público**: 21 `aria-label`, 0 `<caption>`, 0 `scope`, 0 `aria-live`, sin enlace de salto al contenido en una SPA de 44 secciones. **[CÓDIGO]**
9. **El contexto empresa/período es global y frágil**: el período vive en `localStorage` y en 10 variables `window._*Periodo` que el selector del header debe reescribir a mano; una vista que no esté en esa lista mantiene su propio período. **[CÓDIGO]**
10. **El sistema arranca en tema oscuro** (o el del SO) con marca azul marino; la propuesta de una plataforma clara con acentos cálidos es un cambio de dirección visual deliberado, no un ajuste. Hay tokens semánticos suficientes para hacerlo sin reescribir componentes.

---

## 2. Inventario verificable

Leyenda de **Estado**:
`[P]` render cubierto por pruebas · `[C]` código revisado · `[UI]` solo interfaz (sin backend) · `[NV]` implementado, no verificado contra terceros.

### 2.1 Inicio

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Centro de Aplicaciones** `#centro` | Puerta de entrada: apps visibles según rol, licencia y permisos | Elegir app, cambiar de empresa | — | `GET /api/auth/centro` | [P] [C] | Duplica la navegación lateral: dos formas de entrar al mismo módulo | RBAC + licencia |
| **Panel del período** `#inicio` | KPIs (ingresos, gastos, resultado, IVA), alertas, serie mensual, trabajos | Cambiar período, saltar a la vista de cada alerta | período | `dashboard`, `cobranza?limit=1`, `jobs/estado` | [P] [C] | 9 KPIs en dos filas sin jerarquía; el KPI de cobranza aparece/desaparece según permiso | documentos, asientos, tesorería |
| **Alertas** `#alertas` | Reclamadas y pendientes del período | Abrir documento | — | `GET /empresas/:id/alertas` | [P] [C] | Sin filtro ni agrupación; compite con la campana de notificaciones que muestra lo mismo | documentos |

### 2.2 Gestión comercial

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **CRM Comercial** `#crm` | 8 pestañas: Panel, Oportunidades, Fichas, Contactos, Prospectos, Actividades, Informes, Fidelización | Crear/editar oportunidad, mover etapa, convertir prospecto, registrar actividad, exportar CSV | 68 controles de filtro (etapa, owner, texto, fechas, segmento) | 28 endpoints `/api/crm/*` | [P] [C] [NV campañas] | Es el módulo más grande (1.121 líneas) y el más denso; 20 tablas sin componente común; campañas generan texto, **no envían** | empresas, contactos, usuarios |
| **Clientes — Cuenta Corriente** `#cclientes` | Cargos, abonos y saldo corrido por cliente | Buscar, ordenar, paginar (delegado a `UITabla`) | texto, período | `GET /reportes/cuenta-corriente` | [P] [C] | Nombre de menú poco buscable (“cuenta corriente” no aparece); comparte función con Portal › Cartera | documentos, asientos |
| **Proveedores — Cuenta Corriente** `#cproveedores` | Ídem, lado proveedor | Ídem | texto, período | `GET /reportes/cuenta-corriente` | [P] [C] | Ídem; sin vista de antigüedad de saldos (está “en preparación”) | documentos, asientos |
| **Cobranza y Mora** `#cobranza` | Deuda por cliente, marcar pagada | Marcar documento pagado | — | `cobranza`, `bancos`, `cobranza/:docId/pagada` | [P] [C] | “Marcar pagada” crea movimiento bancario implícito sin mostrarlo antes | tesorería |

### 2.3 Compras y ventas (SII)

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Bandeja de Documentos** `#documentos` | RCV documento a documento; clasificar y aprender reglas | Clasificar, clasificación automática, crear/desactivar regla, ver detalle | estado (chips con conteo), flujo, texto | 7 endpoints `documentos`, `reglas` | [P] [C] | Los chips de estado no son excluyentes ni combinables con el texto; el flujo compra/venta no se ve como filtro persistente | SII (RCV), reglas |
| **Libros de Compras y Ventas** `#libros` | Libro compra/venta del período, ingesta desde SII | Ingestar período, ver job | período, pestaña compra/venta | `documentos`, `documentos-ingesta` | [P] [C] | Duplica la bandeja con otra presentación; el progreso de ingesta vive en un job sin barra global | SII |
| **Onboarding y Extracción** `#onboarding` | Ficha tributaria desde SII + ingesta histórica 90 días | Consultar SII, confirmar ficha, lanzar ingesta | — | 5 endpoints `onboarding` | [P] [C] [NV SII] | Flujo largo sin stepper ni estado persistente visible | SII, credenciales cifradas |
| **Dashboard Tributario (IVA)** `#analitica` | IVA débito/crédito/determinado por mes y año, top contrapartes | Cambiar año | año | `GET /analitica?periodo=` | [P] [C] | Compite con el Portal › Dashboard, que muestra otra versión del mismo tema | documentos |
| **Calculadora de IVA** `#calculadora-iva` | Conversor neto/IVA/total y diferencia débito−crédito | Calcular, limpiar | 5 campos | **Ninguno: aritmética local** | [P] [C] **[UI]** | Es la única vista declarada sin backend; el resultado se etiqueta “provisional”, pero el título dice “calculadora” | — |

### 2.4 Facturación

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Emitir Factura o Nota** `#dte-emision` | Formulario de emisión 33/34/56/61 | Emitir, previsualizar totales | tipo DTE, receptor, ítems | `config`, `emitir` | [P] [C] **[NV SII]** | Formulario largo sin guardado de borrador; errores del SII llegan como glosa técnica | certificado + CAF |
| **Bandeja de DTEs Emitidos** `#dte` | Estado real en SII, reintentos, sincronización a contabilidad | Consultar estado, reintentar, sincronizar | estado, tipo, fechas | 5 endpoints `dte` | [P] [C] [NV SII] | “Sincronizar contabilidad” es un botón global sin resumen previo de qué va a crear | SII, asientos |
| **Configuración del Emisor** `#dte-config` | Certificado, CAFs, resolución, ambiente | Subir certificado/CAF, guardar | 10 campos | `config`, `folios` | [P] [C] | Zona de alto riesgo mezclada con configuración común; sin confirmación fuerte ni historial de cambios visible aquí | bóveda de secretos |

### 2.5 Contabilidad

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Contabilización y Pendientes** `#automatizacion` | Pipeline del período (clasificar → proponer → contabilizar) | Ejecutar, ver estado | período | `automatizacion/:p/estado`, `semilla`, `ejecutar` | [P] [C] | Sin confirmación del volumen a procesar; el resultado no enlaza a las propuestas creadas | documentos, propuestas |
| **Propuestas y Conciliación** `#propuestas` | Congelar/confirmar propuestas, descartar, conciliar SII ↔ contable | Confirmar lote, confirmar una, descartar, ejecutar conciliación | pestañas Pendientes/Historial/Conciliación | 9 endpoints | [P] [C] | Tres tareas distintas en una vista; el lote no muestra total ni descuadre antes de confirmar | asientos, documentos |
| **Asientos — Diario, Mayor y Plan** `#asientos` | Diario, nuevo asiento, mayor, plan de cuentas | Crear asiento, filtrar, ver mayor | 4 pestañas, período, cuenta, texto | `asientos`, `mayor` | [P] [C] | **Revertir asiento no tiene botón** aunque la capacidad `asientos:revertir` existe | cuentas, períodos |
| **Memoria de Contabilización** `#memoria` | Reglas aprendidas y configuración de la empresa | Ver/editar configuración, revisar memoria | período, texto | `config`, `memoria` | [P] [C] | Nombre opaco: “memoria” no dice “reglas aprendidas” | reglas |
| **Receptor Externo (Geo Daniela)** `#externos` | Consulta de asientos recibidos de la centralización externa | Ver | RUT empresa | `GET /asientos-externos` | [P] [C] | **Fuera de alcance del rediseño por decisión del brief**; hoy ocupa un ítem del menú | integración externa |
| **Activos Fijos y Depreciación** `#activos` | Alta, depreciación mensual, venta/baja | Crear activo, confirmar depreciación, dar de baja | período, 13 campos | 5 endpoints | [P] [C] | Baja/venta pide datos contables en un formulario plano; sin vista previa del asiento | cuentas, asientos |

### 2.6 Tesorería

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Bancos, Libro Banco y Conciliación** `#tesoreria` | 3 pestañas: Bancos, Libro banco, Conciliación (+ importación de cartola) | Crear banco, registrar pago/cobro/transferencia, importar cartola, conciliar | 22 controles (banco, período, fechas, texto, formato) | 10 endpoints | [P] [C] | La conciliación bancaria exige importar archivo y mapear columnas en la misma pantalla; **no hay UI para formatos de cartola guardados** aunque la API existe | banco, cuentas, asientos |

### 2.7 Informes y control

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Centro de Reportes** `#reportes` | Hub con 17 tarjetas en 6 grupos, favoritos y recientes | Abrir reporte, marcar favorito | — | Sin endpoint (navegación) | [P] [C] | **6 tarjetas “En preparación”** mezcladas con las reales; el hub repite el menú lateral | storage local |
| **Balance de Comprobación** `#comprobacion` | Sumas y saldos, cuadre ΣD=ΣH | Ver, ejecutar cierre desde aquí | período | `reportes/balance`, `cierre/preparar`, `cierre/ejecutar` | [P] [C] | Vista de reporte con acciones de cierre dentro; mezcla consulta y mutación | asientos |
| **Balance de 8 Columnas** `#balance8` | Hoja de trabajo | Ver | período | `reportes/balance8` | [P] [C] | Sin exportación ni impresión | asientos |
| **Balance Clasificado** `#clasificado` | Corriente/no corriente, capital de trabajo | Ver | período | `reportes/clasificado` | [P] [C] | Solapa con Situación financiera y NIIF | cuentas |
| **Situación Financiera** `#situacion` | A = P + Patrimonio | Ver | período | `reportes/situacion` | [P] [C] | Ídem solapamiento | cuentas |
| **Estado de Resultados** `#resultados` | Resultado por período y acumulado | Ver, cuenta corriente | período | `reportes/resultados`, `cuenta-corriente` | [P] [C] | Ídem | cuentas |
| **NIIF — Estados por Rubros** `#niif` | Situación y resultados por rubro, mapeo editable | Editar mapeo | período | 3 endpoints `niif` | [P] [C] | Tercera versión de los mismos estados; sin indicador de “NIIF completo” | cuentas |
| **Cierre de Período** `#cierre` | Checklist y ejecución del cierre | Preparar, cerrar | período | `cierre/*` (vía comprobación) | [P] [C] | Acción irreversible sin resumen de impacto ni confirmación tipada | períodos, asientos |

### 2.8 Portal de cliente (10 vistas, solo lectura por diseño)

| Vista / anchor | Función | Origen de datos | Estado | Problemas UX |
|---|---|---|---|---|
| `#portal-inicio` | Dashboard interactivo, sincronización, series | 9 endpoints `/api/portal` | [P] [C] | Es el módulo visualmente más moderno; usa `UIEstado` 80 veces, el resto no |
| `#portal-ventas` | Ventas y movimientos | `movimientos` | [P] [C] | Filtros distintos a los del resto del sistema |
| `#portal-cartera` | Cartera por cliente, ventana 12 meses | `cartera` | [P] [C] | Duplica Clientes › Cuenta corriente |
| `#portal-productos` | Productos vendidos + margen | `productos`, `margen` | [P] [C] | Sin exportación |
| `#portal-cobranza` | Cobranza con umbrales de días | `cobranza` | [P] [C] | Duplica Cobranza y Mora |
| `#portal-credito` | Crédito autorizado | `credito` | [P] [C] | — |
| `#portal-costos` | Hoja de costos + CSV | `costos`, `costos-csv` | [P] [C] | Es el único con exportación de costos |
| `#portal-cotizaciones` | Cotizaciones y embudo | 3 endpoints | [P] [C] | El embudo se solapa con el CRM interno |
| `#portal-reportes` | Reportes guardados | 4 endpoints | [P] [C] | Guarda definiciones, no resultados |
| `#portal-comercial` | Seguimiento comercial | `comercial` | [P] [C] | Duplica CRM |

### 2.9 Administración

| Vista / anchor | Función | Acciones | Filtros | Origen de datos | Estado | Problemas UX | Dependencias |
|---|---|---|---|---|---|---|---|
| **Administración** `#admin` | 5 pestañas: Empresas, Períodos, Usuarios y roles, Auditoría, Seguridad | Crear empresa desde SII, cerrar/reabrir período, resetear clave, desactivar usuario | 10 campos | 13 endpoints | [P] [C] | La creación de empresa (alta desde SII) es irreversible y vive en una pestaña más | licencias, bóveda |
| **Auditoría** `#auditoria` | Bitácora de acciones | Ver | límite 200 | `auditoria?limit=200` | [P] [C] | Sin filtros por fecha/usuario/acción | auditoría |
| **Integraciones** `#integraciones` | Ficha de la empresa y últimas acciones | Ver | — | `empresas/:id`, `auditoria?limit=50` | [P] [C] | Read-only sin explicar qué se integra ni el estado de cada conector | SII, Cloudflare |
| **Suscripción y Pagos** `#suscripcion` | Plan, pagos, checkout, factura | Pagar, descargar factura | 3 campos | 3 endpoints `/api/pagos` | [P] [C] **[NV pagos]** | Mezcla estado de licencia con historial de pagos y emisión de factura | pasarela, DTE |

**Totales:** 44 vistas, 44 entradas de menú (1:1), 218 rutas HTTP, 21 routers, 16 archivos de vista, 163 clases CSS en `sistema.css`.

---

## 3. Backend: mapa de routers y permisos

| Router | Prefijo | Endpoints | Permisos dominantes |
|---|---|---|---|
| `auth` | `/api/auth` | login, logout, me, centro, usuarios, registro | `requireAdmin` / abierto con rate-limit |
| `contable` | `/api/contable` | empresas, usuarios, períodos, plan de cuentas, centros de costo, reglas, buscador, jobs | `empresas:*`, `periodos:*`, `cuentas:*`, `reglas:*` |
| `documentos` | `/api/contable` | bandeja, ingesta, clasificación, memorias | `documentos:ver/ingestar/clasificar` |
| `propuestas` | `/api/contable` | propuestas, confirmación, conciliación | `propuestas:ver/generar/confirmar`, `conciliacion:*` |
| `automatizacion` | `/api/contable` | pipeline por período | `automatizacion:ejecutar` |
| `reportes` | `/api/contable` | balance, 8 columnas, clasificado, situación, resultados, cierre, analítica | `reportes:ver` |
| `tesoreria` | `/api/contable` | bancos, pagos/cobros/transferencias, cartola, conciliación | `tesoreria:ver/operar`, `bancos:conciliar` |
| `activos` | `/api/contable` | activos, depreciación, venta/baja | `activos:ver/operar` |
| `niif` | `/api/contable` | rubros, mapeo, estados | `reportes:ver` |
| `onboarding` | `/api/contable` | ficha SII, ingesta histórica | `onboarding:ejecutar` |
| `asientos-externos` | `/api/contable` | receptor Geo Daniela | `asientos:ver` |
| `dte` | `/api/dte` | config, folios, emisión, estado, reintento | `dte:ver/emitir/configurar` |
| `crm` | `/api/crm` | oportunidades, fichas, contactos, prospectos, actividades, informes, campañas, alertas | `empresas:ver` + guard CRM |
| `portal` | `/api/portal` | 26 endpoints read-only con aislamiento por empresa | guard interno por empresa |
| `pagos` | `/api/pagos` | checkout, pagos, factura, webhook | `licencias:ver/pagar`, `facturacion:emitir` |
| `sii`, `informe`, `proceso`, `clientes`, `exportacion-masiva`, `contacto` | varios | funcionalidad heredada del producto original (informes por rango, proceso masivo, exportación ZIP) | sesión / legacy |

**Roles** (`core/permisos.js`): `super_admin` (38), `contador` (35: contabilidad, tesorería y DTE), `admin_empresa` (20: portal y lectura), `auditor` (14: solo lectura), `tesoreria` (13: bancos). 38 capacidades nombradas, verificadas en backend con `requirePermiso` y en frontend con `tiene()` (solo cosmético: la autoridad es el backend).

---

## 4. Funciones conectadas, solo-UI y ocultas

### 4.1 Conectadas al backend (implementadas y con pruebas de dominio)

Todo lo listado en §2 salvo la calculadora. La suite cubre: cálculos IVA/PPM/F29, esquema y migraciones, exportación de fechas, informes, fases 1–9, SaaS 1–3, automatización, dashboard, memoria, cartola, bóveda, backups, passwords, hardening, DTE (emisión y contable), empresas-SII, analítica, usuarios temporales, CRM (3 suites), alertas, cobranza, jobs, rate-limit, sync diaria, tesorería, UX unificada, login, portal (3 suites), contacto, resúmenes, centro de apps y sitio público. **492 + 10 tests en verde. [PRUEBA]**

### 4.2 Solo interfaz

| Elemento | Evidencia | Riesgo |
|---|---|---|
| 6 tarjetas “En preparación” del Centro de Reportes (Flujo de efectivo, Cambios en patrimonio, F29, PPM, Antigüedad de saldos, Centros de costo) | `views-conta.js` L604-624 | Prometen funciones que no existen; el usuario las busca en el menú |
| Calculadora de IVA | `ui.js` (aritmética local) | No es un error, pero se confunde con el cálculo real del período |

### 4.3 Ocultas: backend sin entrada en la UI

| Endpoint | Capacidad | Qué falta |
|---|---|---|
| `POST /empresas/:id/asientos/:id/revertir` | `asientos:revertir` | Botón “Revertir” en el Diario (no aparece en ninguna vista) |
| `POST /empresas/:id/documentos/:id/anular` | `documentos:clasificar` | Acción “Anular” en la bandeja |
| `GET/POST /empresas/:id/tesoreria/cartola-formatos` | `bancos:conciliar` | Administrador de formatos de cartola guardados |
| `GET /empresas/:id/tesoreria/documentos/:id/aplicaciones` | `tesoreria:ver` | Ver a qué movimientos se aplicó un documento |
| `POST /api/pagos/webhook/mercadopago` | público firmado | Correcto que no tenga UI (es webhook) |

---

## 5. Duplicaciones, solapamientos e inconsistencias

| Solapamiento | Dónde | Diagnóstico |
|---|---|---|
| Cinco reportes en dos lugares | Menú lateral (5 ítems) + Centro de Reportes (17 tarjetas) | Dos modelos mentales para lo mismo; el hub además repite acciones de cierre |
| Situación / Clasificado / NIIF | 3 vistas distintas | Tres presentaciones de los mismos saldos; el usuario no sabe cuál es “la oficial” |
| Comprobación / 8 columnas | 2 vistas | Comprobación incluye el cierre; 8 columnas es la hoja de trabajo |
| Bandeja de Documentos / Libros | 2 vistas | Mismo origen (RCV), distinta tabla y filtros distintos |
| Cobranza / Portal › Cobranza | 2 vistas | Una opera (marca pagada), la otra es lectura |
| CRM / Portal › Comercial y Cotizaciones | 2+ vistas | Vista interna y vista cliente del mismo embudo |
| Cuenta corriente clientes/proveedores / Portal › Cartera | 2 vistas | Misma información, distinto nombre y filtros |
| Alertas / campana de notificaciones | nav + header | Dos bandejas de pendientes con la misma fuente |
| Tres capas de frontend | `frontend/js` (heredado), `frontend/shared` (parcial), `frontend/sistema` (SPA) | 7 páginas HTML heredadas siguen publicadas y sin enlaces desde la SPA (`/index.html`, `/informe.html`, `/proceso.html`, `/libro.html`, `/dashboard.html`, `/exportacion-masiva.html`, `/configuracion.html`), lo que duplica funciones ya migradas |

**Inconsistencias de lenguaje**: “Contabilización” vs “Automatización” vs “Propuestas” para el mismo flujo; “memoria” para reglas; “Centro de Aplicaciones” vs “Centro de Reportes”; estados `REVISION` en dominio y `REVISIÓN` en pantalla (documentado en el código).

---

## 6. Contexto que afecta a cada módulo

| Contexto | Implementación actual | Problema |
|---|---|---|
| **Empresa** | `<select>` en la barra lateral; `localStorage.iva_empresa_activa` | Visible pero no persistente en la URL: no se puede compartir un enlace a “Documentos de la empresa X” |
| **Período** | Selector global en el título + `localStorage` + 10 variables `window._*Periodo` reasignadas a mano | Una vista nueva que no se agregue a esa lista queda con período desincronizado |
| **Rol/permisos** | `me.acceso_contable.empresas[].permisos`; menú filtrado; gate en ruta; backend autoritativo | El menú se reordena para `admin_empresa` (Portal primero), así que dos usuarios ven estructuras distintas |
| **Licencia** | Banner por estado (`PRUEBA`, `EN_GRACIA`, `SUSPENDIDA`…) + gate 402 en escrituras | El mismo estado se comunica en banner, en Suscripción y en Centro: tres fuentes |
| **Período contable** | `periodos_contables.estado` (`ABIERTO`/`CERRADO`) | El chip del header solo se pinta si el usuario tiene `periodos:ver`; el resto no sabe si puede escribir |
| **Estados de documento** | `PENDIENTE → CLASIFICADO → CONTABILIZADO`, más `REVISIÓN`, `EXCLUIDO` | Los chips del filtro mezclan estados de flujo con decisiones humanas |
| **Estados de DTE** | `PENDIENTE`, `ACEPTADO`, `RECHAZADO`, reintentos | Sin leyenda de qué significa cada estado SII |

---

## 7. Sistema visual actual

**Shell**: sidebar fija de 250 px + contenido; header con breadcrumb, búsqueda global (Ctrl/⌘K), campana y toggle de tema; barra de título con `h1` y selector de período. Breakpoints en 960 px y 640 px (el sidebar pasa a superior).

**Tokens** (`frontend/css/app.css`): paleta primitiva (indigo, slate, emerald, amber, rose), marca JMV (`--c-jmv-navy #1e2a5e`, `--c-jmv-blue #2e86c8`) y **paleta semántica** (`--bg-canvas`, `--bg-surface`, `--fg-primary`, `--accent`, `--border-*`, `--space-*`, `--radius-*`, `--fs-*`). Es una base sólida: permite cambiar la apariencia sin tocar componentes.

**Problemas medidos:**
- Tema por defecto = sistema operativo; en la práctica arranca oscuro (`slate-950`). La propuesta “clara con azul marino” invierte el defecto.
- Tipografía de sistema (`--font-sans`), sin escala tipográfica documentada para datos numéricos: los montos usan `.mono` disperso.
- Tablas: 3 implementaciones (UITabla, tablas propias, tablas crudas). **75 tablas** en 13 vistas. Sin `<caption>` ni `scope`; paginación fija de 100 filas en los listados grandes.
- Estados: `UIEstado` (cargando/vacío/chip/error) usado en 4 archivos de 16.
- Accesibilidad: 21 `aria-label`, 5 `role`, 0 `aria-live`, 0 skip-link; foco visible definido 6 veces en `sistema.css` y 9 en `app.css`.
- Densidad: la barra lateral con 44 ítems y 9 rótulos ocupa más altura que la pantalla; el buscador de menú filtra pero no agrupa.

---

## 8. Arquitectura de navegación propuesta

**Objetivo**: 44 ítems → **6 áreas + 1 modo cliente**, con las mismas funciones y sin romper los anchors (`#documentos`, `#reportes`, etc. se conservan como alias).

| Nueva área | Contenido | Anchors que absorbe |
|---|---|---|
| **Panel** | Inicio (KPIs, alertas, trabajos), Centro de Aplicaciones como bienvenida | `#inicio`, `#centro`, `#alertas` |
| **Documentos** | Bandeja, Libros, Onboarding/ingesta, Alertas | `#documentos`, `#libros`, `#onboarding` |
| **Contabilidad** | Propuestas, Asientos (Diario/Mayor/Plan), Automatización, Activos, Memoria | `#propuestas`, `#asientos`, `#automatizacion`, `#activos`, `#memoria` |
| **Impuestos y facturación** | IVA (dashboard), Emisión, Bandeja DTE, Configuración del emisor, Calculadora | `#analitica`, `#dte-emision`, `#dte`, `#dte-config`, `#calculadora-iva` |
| **Tesorería y cobranza** | Bancos/Libro/Conciliación, Cobranza, Cuenta corriente | `#tesoreria`, `#cobranza`, `#cclientes`, `#cproveedores` |
| **Informes** | Centro de Reportes como único punto de entrada; los 6 reportes dejan de estar en el menú | `#reportes`, `#comprobacion`, `#balance8`, `#clasificado`, `#situacion`, `#resultados`, `#niif`, `#cierre` |
| **Comercial** (interno) | CRM con sus 8 pestañas | `#crm` |
| **Configuración** (pie) | Empresas, Períodos, Usuarios y roles, Auditoría, Integraciones, Suscripción | `#admin`, `#auditoria`, `#integraciones`, `#suscripcion` |
| **Modo cliente** (separado) | Portal de 10 vistas, con encabezado “Vista cliente — solo lectura” | `#portal-*` |

Reglas de navegación:
1. **Contexto siempre visible y en la URL**: `#documentos?empresa=12&periodo=202610`; empresa y período dejan de depender de `localStorage`.
2. **Un solo lugar por tarea**: los reportes salen del menú lateral; el menú lateral no repite el Centro.
3. **Acciones ocultas expuestas**: Revertir, Anular, Formatos de cartola y Aplicaciones pasan a ser acciones de fila o de barra de detalle.
4. **Placeholders fuera de la navegación**: lo “en preparación” se mueve a un bloque “Próximamente” claramente separado o fuera de la vista.
5. **Búsqueda global como ruta principal** (Ctrl/⌘K) con resultados agrupados y navegables (ya existe el endpoint y sus 10 tests).

---

## 9. Sistema de diseño propuesto

**Dirección**: clara por defecto, azul marino como ancla de marca, acentos cálidos puntuales, densidad contable (filas de 36–40 px), jerarquía tipográfica explícita y componentes únicos.

| Token | Valor propuesto | Nota |
|---|---|---|
| `--bg-canvas` | `#f7f8fa` | fondo de área de trabajo |
| `--bg-surface` | `#ffffff` | tarjetas/tablas |
| `--fg-primary` | `#15203a` | texto |
| `--fg-muted` | `#5b6779` | metadatos |
| `--brand-navy` | `#1e2a5e` | encabezado, sidebar activo |
| `--accent` | `#2e86c8` | acción primaria |
| `--accent-warm` | `#c2703d` | acento cálido para hitos/alertas no críticas |
| `--ok / --warn / --danger` | `#1e7d4f` / `#b26a00` / `#b3261e` | estados |
| Espaciado | 4 / 8 / 12 / 16 / 24 / 32 / 48 | reemplaza `--space-*` actuales sin cambiar API |
| Radio | 6 px controles, 10 px tarjetas | |
| Tipografía | Display 600/700 para títulos; cuerpo 15 px; **cifras tabulares** (`font-variant-numeric: tabular-nums`) para montos | Los montos alineados son requisito contable |

**Componentes a unificar** (hoy hay 3 implementaciones de tabla y 2 de tabs):
`DataTable` (orden, filtro por columna, paginación, selección, exportación CSV/XLSX, totales de pie), `FilterBar` (chips de estado + rango de fechas + texto, persistida en URL), `StatCard`, `StatusChip` (con leyenda), `PeriodPicker`, `CompanySwitcher`, `Drawer` de detalle, `ConfirmDialog` para acciones irreversibles (cierre, reversión, emisión), `EmptyState` con causa y acción, `Toast`, `Skeleton`.

**Estados obligatorios por vista**: cargando, vacío (con causa), error (con reintento), éxito (confirmación), sin permiso (explica el rol), período cerrado (banner + acciones deshabilitadas con motivo).

**Accesibilidad mínima**: un `h1` por vista, landmarks (`nav`, `main`), skip-link, `aria-live` para resultados de filtros y jobs, `<caption>`/`scope` en tablas, foco visible, contraste AA, navegación por teclado en menús y diálogos.

---

## 10. Plan de rediseño por fases

| Fase | Alcance | Criterio de aceptación | Riesgo |
|---|---|---|---|
| **F0 — Fundaciones** | Tokens claros, tipografía, densidad, `DataTable`, `FilterBar`, `StatusChip`, `EmptyState`; mantener `app.css`/`sistema.css` encadenados | Un piloto (Documentos) con el componente nuevo y paridad funcional 1:1 con la vista actual | Bajo |
| **F1 — Navegación** | 6 áreas + Configuración + Modo cliente; aliases de anchors; contexto empresa/período en URL | Las 44 rutas siguen renderizando; tests T1/T5b en verde; ninguna entrada del menú cae en fallback | Medio (aliases) |
| **F2 — Documentos y contabilidad** | Bandeja, Libros, Propuestas, Asientos (con Revertir), Automatización | Flujo completo clasificar → proponer → contabilizar → revertir probado en QA con datos ficticios | Medio |
| **F3 — Tesorería e informes** | Tesorería con formatos de cartola, Cobranza, Centro de Reportes único, cierre con confirmación fuerte | Conciliación con archivo real de prueba; cierre bloqueado si hay descuadre | Alto (dinero) |
| **F4 — Impuestos y DTE** | Dashboard IVA, emisión, bandeja, configuración del emisor | Emisión en ambiente de certificación con CAF de prueba | Alto (SII) |
| **F5 — Comercial y modo cliente** | CRM rediseñado, Portal unificado visualmente con el sistema | Paridad de endpoints y aislamiento por empresa verificado | Bajo |

**No-regresión**: cada fase conserva los 502 tests; se agregan pruebas de contrato de rutas y de render por vista (ya existe T5b) y snapshots de tablas clave.

---

## 11. Riesgos y dependencias que el rediseño debe preservar

| Riesgo | Impacto | Mitigación |
|---|---|---|
| SII sin API oficial (endpoints internos de la SPA Angular) | Cualquier cambio de backend puede romper la ingesta | No tocar `services/sii-*`; aislar detrás de la UI |
| Certificados, CAF y claves SII cifrados con `SECRETOS_MASTER_KEY` | Pérdida de la clave inutiliza la emisión | No migrar la bóveda en el rediseño |
| Migraciones idempotentes en `core/migraciones.js` | Cambios de esquema pueden romper datos existentes | Ningún cambio de esquema en fases UX |
| 492 tests como contrato | Un rediseño que rompe selectores/anchors rompe CI | Mantener IDs y anchors; actualizar tests solo con justificación |
| `test/buscador.test.js` fuera de `npm test` | La búsqueda global puede romperse sin que CI avise | Agregarlo al script (decisión aparte, no en esta auditoría) |
| Pruebas hacen login real al SII | CI depende de red y de una cuenta | Marcar como integración, no unitario |
| Tema oscuro por defecto | Cambiar a claro afecta a usuarios actuales | Toggle claro/oscuro/sistema y respetar preferencia guardada |
| 7 páginas heredadas publicadas | Riesgo de confusión y de superficie sin mantener | Redirigir a la SPA o retirarlas con aviso, fuera de esta fase |
| Geo Daniela (`#externos`) | Integración externa futura | Fuera de alcance; conservar la ruta y ocultarla del menú |
| Remuneraciones | **No existe módulo**; solo cuentas del plan y menciones | No prometerlo en el rediseño; evaluar como integración posterior |

---

## 12. Pruebas existentes y qué cubren

- **53 archivos en `npm test` → 492 tests, 0 fallos** en este commit. `test/buscador.test.js` (10 tests) existe y pasa, pero **no está incluido** en el script: total real 502.
- Cobertura por área: cálculos y períodos (`calculos`, `export-fecha`, `resumenes`), esquema/migraciones, fases 1–9 (documentos, propuestas, reportes, tesorería, activos, NIIF, asientos externos), SaaS 1–3 (licencias, pagos, onboarding), automatización, dashboard, memoria, cartola, bóveda, backups, hardening, rate-limit, DTE (emisión y contable), empresas-SII, analítica, usuarios temporales, CRM (3 suites), alertas, cobranza, jobs, sync diaria, **UX unificada** (menú, `UIEstado`, centro de reportes, render de todas las vistas), login y regresiones, portal (3 suites), contacto y sitio público.
- **Lo que la suite NO cubre**: comportamiento contra SII real, emisión real de DTE, conciliación con cartolas reales, pagos y webhooks reales, envío de campañas, y verificación visual (no hay tests de layout ni de contraste).

---

## 13. Archivos inspeccionados

**Backend (21.390 líneas):** `index.js`, `db.js`, `middleware/{requireAuth,requirePermiso,seguridad-headers,no-encontrado}.js`, `core/{migraciones,empresas,permisos,plan-cuentas-plantilla,cuentas,asientos,documentos,propuestas,automatizacion,tesoreria,activos,niif,reportes,dashboard,analitica,licencias,centro-apps,buscador,auditoria,onboarding,asientos-externos,rate-limit-db}.js`, `routes/*.js` (21 routers, 218 endpoints), `services/{sii-rcs,sii-session,password,session}.js`.

**Frontend SPA (8.285 líneas):** `sistema/index.html`, `app.js` (shell, menú de 44 ítems, router, búsqueda global, notificaciones, selector de empresa/período, breadcrumb, tema), `ui.js` (estados + calculadora), `tema.js`, `sistema.css` (163 clases, 2 breakpoints), `views-{fiscal,conta,teso,activos,niif,autom,dte,crm,portal,cobranza,alertas,analitica,onboarding,suscripcion,herramientas,centro}.js`.

**Frontend heredado:** `frontend/index.html`, `landing.html`, `login.html`, `registro.html`, `dashboard.html`, `informe.html`, `proceso.html`, `libro.html`, `exportacion-masiva.html`, `configuracion.html`, `404.html`, `js/*.js` (10 módulos), `shared/*.js` (15 módulos, solo algunos en uso).

**Configuración y pruebas:** `package.json`, `.github/workflows/ci.yml` (si existe), `test/*.test.js` (54), `CURRENT_STATE.md`, `docs/DESPLIEGUE.md`, `docs/CRM-REDISENO-2026-10-15.md`.

---

## 14. Próximos pasos recomendados

1. **Validar el inventario con el propietario** (30 min): confirmar qué funcionalidades no se usan y pueden quedar fuera del menú principal.
2. **Decidir el alcance de “modo cliente”**: si el portal es producto separado o modo del mismo shell.
3. **Elegir 1 vista piloto** (recomendado: Bandeja de Documentos) y rediseñarla con el sistema propuesto antes de tocar la navegación.
4. **Congelar contratos**: anchors, IDs de formularios y endpoints usados por tests; cualquier cambio se acompaña de actualización de pruebas.
5. **Planificar F0 en un branch aparte**, sin tocar `core/` ni migraciones, con verificación visual en navegador real (la suite no cubre layout).

---

*Informe generado en modo auditoría. No se modificó código, estilos, rutas, base de datos, configuración ni producción.*
