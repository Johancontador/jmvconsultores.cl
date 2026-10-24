# 16 · Arquitectura funcional objetivo

> **Propuesta**, no implementación. Parte de lo que existe (`04`, `05`) y no crea módulos ficticios.
> Objetivo: que el menú deje de ser un catálogo de 43 funciones y pase a ser un mapa de 6 áreas de trabajo, con el detalle dentro de cada área.

---

## 1. Principios de la nueva arquitectura

1. **Nivel 1 = áreas de negocio**, no pantallas ni archivos. Máximo 6 + 2 secundarias.
2. **Nivel 2 = espacio de trabajo del área**: subnavegación contextual, acciones y filtros propios.
3. **Una tarea, un lugar.** Si dos pantallas hacen lo mismo, una es la canónica y la otra enlaza.
4. **Descubrimiento por tarea**: al entrar a un área se ven sus 4–7 tareas más frecuentes, no todas sus tablas.
5. **Los anchors históricos se conservan** (alias si cambian de forma).
6. **El contexto (empresa/período) sigue en la URL** y se mantiene entre áreas.
7. **Nada se muestra sin permiso** y **nada se declara disponible si no existe**.

---

## 2. Navegación de nivel 1 (propuesta)

| # | Área | Pregunta que responde | Contenido |
|---|---|---|---|
| 1 | **Inicio / Hoy** | «¿Qué requiere mi atención?» | Pendientes, obligaciones del mes, anomalías, trabajos en curso, recientes, lanzador de módulos |
| 2 | **Documentos** | «¿Qué documentos entraron y qué hice con ellos?» | Bandeja, libros C/V, sync/importación, clasificación y reglas, DTE |
| 3 | **Contabilidad** | «¿Cómo está registrado?» | Asientos/diario/mayor, propuestas, plan y centros, activos, cierre, conciliación SII↔contable, memoria |
| 4 | **Impuestos y Salud** | «¿Cómo está mi situación tributaria?» | Salud Tributaria, F29/PPM/IVA, declaraciones, deuda TGR |
| 5 | **Tesorería** | «¿Qué dinero entró y salió?» | Bancos, movimientos, cartola, conciliación, cobranza |
| 6 | **Informes** | «¿Qué reporte necesito entregar?» | Estados financieros, reportes tributarios, cuentas corrientes, exportaciones |
| — | **Administración** (secundaria) | «¿Cómo está configurado?» | Empresas, usuarios, roles, integraciones, auditoría, suscripción |
| — | **Portal del cliente** (secundaria, rol dueño) | «¿Cómo va mi negocio?» | 10 vistas read-only |

**Qué pasa con «Lote del despacho»:** deja de ser área de nivel 1. Sus 4 herramientas se reubican:
- Portafolio → Administración › Empresas (vista de cartera).
- Informe por rango → Informes › «Informe multi-mes».
- Proceso masivo → Impuestos y Salud › «Procesos del mes» (o Administración › Operación).
- Exportación ZIP → Informes › Exportaciones.

**Qué pasa con «Gestión comercial»:** el CRM es una herramienta del despacho, no del cliente. Se mueve a **Administración › Comercial** (o a un área «Despacho» si el dueño lo prefiere), y las cuentas corrientes pasan a **Informes**.

**Qué pasa con «Centro de Aplicaciones»:** deja de ser el destino post-login. El post-login va a **Inicio/Hoy**; el catálogo de módulos queda como sección «Todos los módulos» dentro de Inicio y conserva el anchor `#centro`.

---

## 3. Reubicación de los 43 ítems (sin perder ninguno)

| Ítem actual | Nueva área | Nuevo lugar |
|---|---|---|
| `inicio` | Inicio | Portada |
| `salud` | Impuestos y Salud | Portada del área (destacada) |
| `alertas` | Inicio | Bloque «Requiere atención» + enlace «Ver todas» |
| `centro` | Inicio | «Todos los módulos» (secundario) |
| `documentos` | Documentos | Pestaña «Bandeja» |
| `libros` | Documentos | Pestaña «Libros C/V» |
| `onboarding` | Documentos | Acción «Configurar / importar» |
| `analitica` | Impuestos y Salud | «IVA y tendencias» |
| `calculadora-iva` | Impuestos y Salud | Herramienta «Calculadora» |
| `dte-emision` | Documentos | Pestaña «Emitir» |
| `dte` | Documentos | Pestaña «Emitidos» |
| `dte-config` | Documentos | «Configuración del emisor» (avanzado) |
| `automatizacion` | Contabilidad | «Contabilizar» |
| `propuestas` | Contabilidad | «Propuestas» |
| `asientos` | Contabilidad | «Asientos» (diario/mayor/plan) |
| `memoria` | Contabilidad | «Reglas y memoria» (con Bandeja › Reglas) |
| `externos` | Contabilidad | «Integraciones contables» (avanzado) |
| `activos` | Contabilidad | «Activos fijos» |
| `tesoreria` | Tesorería | Portada del área |
| `cobranza` | Tesorería | Pestaña «Cobranza» |
| `reportes` | Informes | Portada del área (catálogo único) |
| `cierre` | Contabilidad | «Cierre del período» |
| `cclientes` | Informes | «Cuentas corrientes › Clientes» |
| `cproveedores` | Informes | «Cuentas corrientes › Proveedores» |
| `crm` | Administración | «Comercial» (solo despacho) |
| `portafolio` | Administración | «Empresas › Cartera» |
| `informe-rango` | Informes | «Informe multi-mes» |
| `proceso-masivo` | Impuestos y Salud | «Procesos del mes» |
| `exportacion-masiva` | Informes | «Exportaciones» |
| `portal-*` (10) | Portal del cliente | Se conservan las 10 |

**Vistas sin ítem de menú** (`comprobacion`, `balance8`, `situacion`, `resultados`, `clasificado`, `niif`) se convierten en **pestañas de Informes › Estados financieros**, conservando sus anchors y añadiendo el ítem al mapa de permisos.

---

## 4. Espacio de trabajo de cada área (nivel 2)

### 4.1 Inicio / Hoy

```text
[Hoy]  [Todos los módulos]
─────────────────────────────────────────────
Obligaciones del período     · F29 del mes, vencimientos, DJ
Requiere tu atención         · hallazgos altos, documentos reclamados, DTEs rechazados
Trabajo en curso             · sync, ingesta, informes
Últimos movimientos          · documentos, asientos, pagos
Accesos recientes            · por usuario
```

Cada bloque con **una** acción primaria y enlace al detalle. Sin tarjetas decorativas.

### 4.2 Documentos

```text
[Bandeja] [Libros C/V] [Emitidos] [Emitir] [Reglas]
Filtros persistentes · contador de estados · acciones por fila
```
- «Actualizar desde SII» (canónico) reemplaza los 4 disparadores; los demás enlazan aquí.
- Configuración del emisor queda como engranaje del área, no como ítem principal.

### 4.3 Contabilidad

```text
[Asientos] [Propuestas] [Plan y centros] [Activos] [Cierre] [Conciliación] [Reglas y memoria]
```
- Diario/Mayor/Plan como subpestañas de Asientos.
- «Contabilizar» es la acción primaria de Propuestas, no una pantalla aparte.

### 4.4 Impuestos y Salud

```text
[Salud Tributaria] [IVA y tendencias] [Declaraciones] [Deuda TGR] [Procesos del mes]
```
- Salud es la portada; F29/PPM se muestran como **estimación** con enlace a la declaración oficial.
- «Reunir antecedentes» vive aquí y es el único disparador de la consulta integral.
- Calculadora como herramienta contextual, no ítem de menú.

### 4.5 Tesorería

```text
[Bancos] [Movimientos] [Cartola] [Conciliación] [Cobranza]
```
- Deuda TGR **no** vive aquí: es fiscal, va a Impuestos y Salud (se elimina la duplicación).

### 4.6 Informes

```text
[Estados financieros] [Tributarios] [Cuentas corrientes] [Exportaciones]
```
- Un solo catálogo generado desde capacidades reales; sin «No disponible» falso.
- Cada reporte con período visible, exportación y descripción de una línea.

### 4.7 Administración

```text
[Empresas] [Usuarios y roles] [Integraciones] [Auditoría] [Comercial] [Suscripción]
```
- Separar «Personas» de «Catálogos» de «Parámetros».
- Acciones irreversibles en zona propia.

### 4.8 Portal del cliente

Se conserva tal cual (10 vistas), con una portada que explique qué es y qué no es (read-only, datos del cliente).

---

## 5. Descubrimiento

| Mecanismo | Regla |
|---|---|
| Portada de área | 4–7 tareas frecuentes + estado del área (1 línea) |
| Subnavegación | Pestañas estables, persistidas en URL (`?tab=`) |
| Acciones primarias | Una por pantalla; el resto en menú contextual |
| Búsqueda global | Conservar (Ctrl/⌘K), con grupos por área y RBAC |
| Recientes / favoritos | Conservar (localStorage por usuario), máximo 6 |
| Ayuda contextual | Texto breve + «cómo se calcula» en los indicadores |
| Estados vacíos | Explicar la causa y ofrecer la acción que la resuelve |

**No** se propone un dashboard lleno de tarjetas: Inicio tiene 4 bloques con propósito.

---

## 6. Matriz de centralización funcional

| Funcionalidad | Propietario propuesto | Consumidores | Fuente única | Duplicidad actual | Riesgo de centralizar | Arquitectura propuesta | Beneficio | Esfuerzo |
|---|---|---|---|---|---|---|---|---|
| Documentos del RCV | Documentos | Contabilidad, Impuestos, Informes | `documentos` (clave_dedupe) | Bandeja/Libros/Alertas/Propuestas | Medio (permisos) | Un servicio `documentos` + una UI canónica | Menos rutas, misma verdad | Bajo |
| Sincronización SII | Documentos (acción «Actualizar») | Onboarding, Salud | `core/ingesta` + mutex | 4 disparadores | Medio (jobs) | Un botón canónico; el resto enlaza | Claridad operativa | Bajo |
| Clasificación y reglas | Contabilidad | Documentos | `reglas` + `contrapartes` | Reglas en modal de Bandeja y en Memoria | Bajo | Un solo editor de reglas, referenciado | Coherencia | Medio |
| Propuestas y contabilización | Contabilidad | Documentos, Automatización | `propuestas` | Pantalla + modal + lote | Medio (confirmación) | Una cola de propuestas con acciones masivas | Menos pasos | Medio |
| F29/PPM/IVA | Impuestos y Salud | Documentos, Informes, Procesos | `services/calculos` | Calculadora, Proceso, Salud, Informe | **Alto** (cálculos divergentes) | Un servicio de estimación + una presentación | Una sola cifra | Medio |
| Reportes financieros | Informes | Salud, Cierre | `reportes`/`niif` | 6 vistas + centro | Bajo | Un catálogo, mismas vistas detrás | Descubrimiento | Bajo |
| Cuentas corrientes | Informes | Cobranza, Portal | `reportes.cuentaCorriente` | Menú + Centro | Bajo | Un reporte con rol cliente/proveedor | Menos ítems | Bajo |
| Cobranza | Tesorería | Portal, Salud | `cobranza` + `teso` | Cobranza + Portal cobranza | Bajo | Tesorería opera; Portal lee | Separación clara | Bajo |
| Deuda TGR | Impuestos y Salud | Tesorería | `deuda_tgr` | Salud + Tesorería | Bajo | Una consulta, un lugar | Sin duplicado | Bajo |
| DTE | Documentos | Contabilidad, Suscripción | `dte_emitidos` | Emisión/Bandeja/Config | Medio | Un área con 3 pestañas | Claridad | Bajo |
| Entidades (empresa/contraparte) | Administración | Todo | `empresas` + `contrapartes` | `clientes` legacy | **Alto** (dual) | Un maestro por RUT, legacy en solo lectura | Integridad | Alto |
| Auditoría | Administración | Todo | `auditoria` | Vista propia | Bajo | Vista con filtros de servidor | Auditabilidad | Bajo |
| Jobs | Inicio / Administración | Documentos, Salud | `jobs_persistentes` | Health polling + jobs legacy | Medio | Un panel de trabajos | Transparencia | Medio |

---

## 7. Datos maestros con una sola fuente

| Dato | Fuente única | Debe dejar de existir como fuente |
|---|---|---|
| Empresa/contribuyente | `empresas` (+ ficha SII como atributo) | `clientes.clave_sii` como credencial paralela |
| RUT de contraparte | `contrapartes` (memoria) + documentos | Listas duplicadas en UI |
| Plan de cuentas | `cuentas` | Alias hardcodeados en reglas semilla sin validar |
| Período contable | `periodos_contables` | Cálculos de período en la UI |
| Tasa PPM | `empresas.tasa_ppm` | Capturas manuales en reportes |
| Documento tributario | `documentos` | Cualquier otra tabla que replique folios |
| Asiento | `asientos` + `asiento_lineas` | Saldos persistidos |
| Declaración | `declaraciones_sii` + `f29_formularios` | Estimaciones presentadas como declaración |
| Licencia | `suscripciones` | Banderas manuales |

---

## 8. Procesos que deben permanecer independientes

| Proceso | Por qué |
|---|---|
| Contabilidad vs tributario | La contabilidad declara; el SII informa. La conciliación los compara, no los mezcla |
| Cierre de período | Es un acto contable con bloqueo; no debe ser un efecto secundario de un reporte |
| Confirmación de propuestas | Requiere decisión humana; la automatización solo prepara |
| Emisión de DTE | Acto tributario con folio y firma; no se automatiza desde la bandeja sin acción explícita |
| Consulta SII | Una sesión por corrida y cierre obligatorio; no debe dispararse desde cada vista |
| Deuda TGR | Documento oficial con fecha; no se recalcula |

---

## 9. Invariantes que el rediseño debe cumplir

1. Los 43 anchors actuales siguen resolviendo a una pantalla válida.
2. El contexto `empresa`/`periodo` viaja en la URL y se respeta.
3. Todo ítem de nivel 1 y 2 tiene permiso declarado y el backend lo revalida.
4. Ninguna vista nueva se muestra sin ítem en el mapa de permisos (corrige el defecto de `#situacion` y compañía).
5. Los reportes conservan sus endpoints y fórmulas.
6. Salud Tributaria conserva su contrato de datos y sus snapshots.
7. La navegación funciona sin JavaScript de terceros ni build.

---

## 10. Qué NO se propone

- Reemplazar la SPA por un framework.
- Microservicios.
- Un dashboard con 20 tarjetas.
- Eliminar el portal, el CRM o el lote: se reubican.
- Cambiar cálculos contables o tributarios en esta fase.
- Un «asistente IA» que decida por el contador.
