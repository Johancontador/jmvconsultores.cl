# 00 · Índice general — Handoff integral Sistema Contable JMV

> **Fecha de la inspección:** 2026-10-23 · **Rama:** `master` · **Commit inspeccionado:** `85f93e9`
> **Modo:** solo lectura. No se modificó código, datos, configuración, credenciales ni integraciones.
> **Estado de las etapas:** A ✅ · B ✅ · C ✅ · D ✅ · E ✅ · F ✅ · G ✅ (documentación). Las etapas de **implementación F0–F5 están ejecutadas en local** (ver `22`–`34`); el despliegue a producción sigue pendiente de autorización (`29`).

---

## 1. Qué es este paquete

Documentación de traspaso del sistema real (`iva-mensual` / “Sistema Contable JMV”) para que otro arquitecto o agente pueda rediseñarlo sin perder funcionalidades, reglas de negocio ni conexiones. Cada afirmación tiene evidencia en el repositorio; lo que no se pudo comprobar está marcado como **NO VERIFICADO** y las limitaciones se listan en §5.

### Distinciones usadas en todos los documentos

| Etiqueta | Significado |
|---|---|
| **Inspeccionado** | Leído en el código o la base del repositorio. |
| **Verificado** | Ejecutado (tests, consultas) en este handoff, con resultado. |
| **Documentado** | Declarado en la documentación existente del repo; no re-verificado aquí. |
| **NO VERIFICADO** | No se pudo comprobar en esta pasada (p. ej. llamada real al SII). |
| **Propuesta** | Recomendación de este handoff, no implementada. |

---

## 2. Documentos

| # | Documento | Contenido | Audiencia |
|---|---|---|---|
| 00 | `00-INDICE-GENERAL.md` | Este índice, método, métricas, cobertura | Todas |
| 01 | `01-RESUMEN-EJECUTIVO.md` | Hallazgos y conclusiones principales | Dirección / producto |
| 02 | `02-ESTADO-ACTUAL.md` | Inventario factual del sistema, stack, estado de funcionalidades | Arquitectura |
| 03 | `03-ARQUITECTURA-TECNICA.md` | Proceso único, capas, routers, contratos, aislamiento | Desarrollo |
| 04 | `04-INVENTARIO-MODULOS-PANTALLAS.md` | 12 dominios, 49 vistas, subpantallas y modales | Producto / UX |
| 05 | `05-MENUS-SUBMENUS-NAVEGACION.md` | Menú actual (10 secciones, 43 ítems), dock, breadcrumb, problemas | UX |
| 06 | `06-INVENTARIO-BOTONES-ACCIONES.md` | Catálogo de acciones por pantalla, tipos, estados, defectos | UX / desarrollo |
| 07 | `07-FILTROS-FECHAS-PARAMETROS.md` | Filtros, período, empresa, semántica de fechas, inconsistencias | Producto |
| 08 | `08-DISENO-VISUAL-COMPONENTES.md` | Tokens reales, componentes, accesibilidad, ruido visual | Diseño |
| 09 | `09-MAPEO-DATOS-DEPENDENCIAS.md` | 61 tablas, fuentes de verdad, flujos, dependencias | Arquitectura / datos |
| 10 | `10-INTEGRACIONES-CONECTORES.md` | SII, TGR, MercadoPago, DTE, Geo Daniela, cartolas | Arquitectura |
| 11 | `11-REGLAS-CONTABLES-TRIBUTARIAS.md` | Reglas implementadas, trazabilidad y reglas a validar | Contabilidad / tributario |
| 12 | `12-SALUD-TRIBUTARIA-AUDITORIA.md` | Auditoría funcional completa del módulo prioritario | Producto / tributario |
| 13 | `13-SII-FLUJOS-VALIDACIONES.md` | Recorrido de datos SII, errores, vigencia, límites | Desarrollo / tributario |
| 14 | `14-CERTIFICADOS-REPORTES-MENSAJES.md` | Informe imprimible, certificados, taxonomía de estados | Producto / diseño |
| 15 | `15-DIAGRAMAS-MERMAID.md` | 13 diagramas de arquitectura, navegación, datos, flujos | Todas |
| 16 | `16-ARQUITECTURA-FUNCIONAL-OBJETIVO.md` | Navegación de 2 niveles, módulos, centralización | Producto / arquitectura |
| 17 | `17-PROPUESTA-REDISENO-UX-UI.md` | Lenguaje visual, componentes, acciones, movimiento | Diseño |
| 18 | `18-MATRIZ-CONSERVACION-REGRESION.md` | Capacidades a preservar y pruebas de regresión | QA |
| 19 | `19-PLAN-IMPLEMENTACION.md` | Fases, dependencias, riesgos, aceptación, reversión | Gestión |
| 20 | `20-RIESGOS-PENDIENTES-DECISIONES.md` | Riesgos, deuda, decisiones que requieren al dueño | Dirección |
| 21 | `21-F0-LINEA-BASE-Y-CONTINUIDAD.md` | Línea base, contratos de navegación, respaldo e integridad | QA / arquitectura |
| 22 | `22-EJECUCION-F0-F1-F2.md` | **Ejecución real**: cambios, pruebas y riesgos residuales | Todas |
| 23 | `23-VALIDACION-VISUAL-FUNCIONAL.md` | **F3 ejecutada**: entorno aislado, 39+14 pantallas en Chrome real, 10 defectos corregidos, informe imprimible | QA / producto |
| 24 | `24-CONTINUIDAD-OPERATIVA-Y-RECUPERACION.md` | **F4**: matriz de backup, restore aislado probado, credenciales SII, controles DTE, integraciones | Arquitectura / operaciones |
| 25 | `25-AUDITORIA-SEGURIDAD-F5.md` | **F5**: auditoría, matriz de riesgos (confirmados/descartados/no verificables), protección de secretos | Seguridad / arquitectura |
| 26 | `26-PLAN-HARDENING-Y-RECUPERACION.md` | **F5**: plan de backup externo, alertas, rotación de claves, custodia, RPO/RTO propuestos | Dirección / operaciones |
| 27 | `27-VERIFICACION-PRODUCCION-F6.md` | **F6**: verificación de producción en solo lectura, matriz de controles A/B/C/D y orden de remediación | Dirección / operaciones / seguridad |
| 28 | `28-PAQUETE-DIAGNOSTICO-VPS.md` | **F7**: comandos de solo lectura para verificar clave maestra, backups, versión, certificados y permisos sin revelar secretos | Operaciones |
| 29 | `29-PLAN-INTERVENCION-CONTROLADA.md` | **F7**: plan condicionado por evidencia (escenarios A–E), ventana, rollback y criterios de autorización | Dirección / operaciones |
| 30 | `30-INFORME-MAESTRO-F8.md` | **F8**: estado integral, correcciones locales (health, 500, cabecera), recuperación medida, invariantes e inventario de controles verificados/bloqueados | Dirección / operaciones / QA |
| 31 | `31-MATRIZ-RIESGOS-Y-DEPENDENCIAS.md` | **F8**: registro único de riesgos priorizado, con dependencias, prueba de aceptación y autorización requerida | Dirección / seguridad |
| 32 | `32-RUNBOOK-RECUPERACION-Y-RELEASE.md` | **F8**: procedimiento ejecutable de backup/restore, release, rollback, criterios de aborto y definición de RPO/RTO | Operaciones / SRE |
| 33 | `33-MATRIZ-OPERACIONAL-VPS.md` | **F8**: verificaciones pendientes en el VPS, comandos, evidencia esperada y autorizaciones exactas | Operaciones |
| 34 | `34-INFORME-EJECUTIVO-F3-F4.md` | **F3+F4**: informe de cierre en 10 puntos de esa fase (se conserva como evidencia) | Dirección / operaciones |
| 34 | `34-A5-A6-R2-PUSHOVER.md` | **A5/A6**: respaldo R2 y notificaciones Pushover (diseño, verificación y límites) | Operaciones / seguridad |
| 35 | `35-AUDITORIA-SALUD-TRIBUTARIA-FASE1.md` | **Auditoría Salud Tributaria**: flujo, fórmulas, 13 hallazgos con evidencia (ST-01…ST-13), reproducciones, plan P0–P3 y continuidad. **ST-01 a ST-09 implementados el 2026-10-26** (§6.1–§6.4); quedan ST-10 a ST-13 (P2/P3) y la validación del contador sobre remanente y casilla 091 | Dirección / contador responsable / QA |

> **Estado de ejecución (2026-10-23):** F0, F1 y F2 están **implementadas y con
> tests en verde** (ver `22`). Lo que los docs `05` y `16` describen como menú
> «actual» y «objetivo» ya fue ejecutado: la fuente vigente del menú es `22` §F2
> + `frontend/sistema/app.js`. El resto de este índice sigue siendo el
> diagnóstico de la línea base `85f93e9`.
>
> **Estado de ejecución (2026-10-24):** **F3 y F4 ejecutadas** (ver `23` y `24`).
> F3 validó en Chrome real sobre una BD ficticia (39 pantallas de escritorio, 14
> responsive, 6 páginas de informe imprimible, 7 recorridos) y corrigió 10
> defectos; suite completa **662/662**. F4 documentó la cobertura de backup,
> **probó una restauración en un entorno aislado** (6 casos, incluidos 4 modos de
> fallo) y dejó explícitos los riesgos de custodia de claves y de emisión DTE.
> Ninguna integración externa se declara verificada en vivo.
>
> **Estado de ejecución (2026-10-24 · F5):** auditoría de seguridad de solo
> lectura + tres correcciones locales probadas (ver `25` y `26`): fallo seguro
> del arranque sin `SECRETOS_MASTER_KEY`, validación local de vigencia/identidad
> del certificado antes de emitir DTE, y verificación de frescura/integridad de
> backups con CLI y exit codes. Suite **686/686**. **Nada desplegado:** el `.env`,
> el cron y la configuración del VPS siguen sin verificarse y las medidas de
> copia externa, alertas y rotación de claves quedan como plan.
>
> **Estado de ejecución (2026-10-24 · F7):** F0–F5 sigue **en el árbol de trabajo
> sin commitear** (`HEAD = 85f93e9`); la suite está en **686/686** y `seed:v` no
> tiene referencias pendientes. El informe de cierre de F3/F4 —con el estado Git
> real y la evidencia visual— está en `34`. Sigue **sin deploy**: producción
> corre el build de `85f93e9` y las puertas G1–G8 de `29` dependen de la salida
> de `28` en el VPS.
>
> **Estado de ejecución (2026-10-24 · F8):** tres defectos corregidos en local con
> prueba (`/api/health` sin verificar la base, `500` que devolvía `err.message`,
> `X-Powered-By` presente en producción); recuperación ejecutada de punta a punta
> sobre BD ficticia (backup 0,55 s · verificación 0,34 s · restore 0,51 s · la app
> abre la copia y deja entrar a sus usuarios) con los 4 modos de fallo rechazados;
> 8 invariantes contables nuevas (cuadre, folios, reversión, aislamiento,
> idempotencia, período cerrado, RCV). Suite **701/701**. **Nada desplegado:**
> producción sigue en un build anterior (`app.js?v=bdf0e607`) y las verificaciones
> de clave, backups y certificados en el VPS son las de `33`.
>
> **Estado de producción (2026-10-24 · F6, solo lectura):** `https://app.jmvconsultores.cl`
> responde con TLS válido (hasta 2027-01-07), HSTS, CSP, anti-framing y sin exponer
> `.env`, BD ni repo; **detectado**: HTTP sin redirección a HTTPS y `x-powered-by`.
> Producción sirve un build **anterior a F3** (9 de 28 assets distintos del working
> tree), así que **F5 no está desplegado**. Sin acceso al VPS, no se pudo verificar
> la clave maestra, el cron de backups, los certificados ni los permisos: ver `27`.
> **Nada se modificó en el servidor.**
>
> **Estado de preparación (2026-10-24 · F7):** paquete de diagnóstico de solo
> lectura (`28`) y plan de intervención condicionado (`29`). No se ejecutó nada:
> siguen pendientes de autorización y acceso las verificaciones de clave maestra,
> versión del backend por hash, backups, certificados y permisos. El despliegue de
> F0–F5 queda bloqueado hasta cerrar las puertas G1–G8.

---

## 3. Método (Etapa A)

1. Inventario de árbol, `package.json`, documentación existente (`ARCHITECTURE.md`, `CURRENT_STATE.md`, `docs/*`).
2. Lectura de puntos de entrada: `backend/index.js`, `backend/db.js`, `frontend/sistema/index.html`, `app.js`, `tema.js`, `url-estado.js`.
3. Recorrido de routers y módulos `core/` y `services/`; extracción mecánica de endpoints.
4. Recorrido de las 18 vistas de la SPA y sus 49 registros `VIEWS.*`.
5. Auditoría en profundidad de `core/salud-tributaria.js` (1.820 líneas), `routes/salud.js`, `frontend/sistema/views-salud.js`, `core/informe-salud-html.js`, `core/declaraciones-sii.js`, `core/deuda-tgr.js`, `core/salud-sincronizacion.js`.
6. Extracción de tokens CSS de `frontend/css/app.css` y `sistema.css`.
7. Extracción de esquema de BD (`CREATE TABLE`) y variables de entorno.
8. **Verificación ejecutada:** `npm test` completo.

No se abrió sesión en el SII, no se usaron credenciales, no se generaron DTEs, no se consultó la TGR, no se ejecutaron jobs ni se tocó la BD de `data/`.

---

## 4. Métricas del inventario (con criterio de conteo)

| Métrica | Valor | Criterio |
|---|---|---|
| Secciones de menú | **10** | Arreglo `MENU` en `app.js`. |
| Ítems de menú | **43** | Entradas `key` del `MENU` (incluye ítems que abren la misma vista con otra pestaña). |
| Vistas registradas | **49** | Claves `window.VIEWS[...]` en `frontend/sistema/*.js`. |
| Archivos de vista | **18** | `views-*.js` (10.430 líneas en total). |
| Rutas HTTP | **230** | Ocurrencias `router.<método>(` en `backend/routes/*.js`: GET 114, POST 92, PUT 9, PATCH 5, DELETE 10. |
| Routers montados | **23** | `app.use('/api/...')` en `backend/index.js`. |
| Tablas | **61** | `CREATE TABLE` únicos en `backend/**/*.js` (excluye binarios). |
| Módulos `core/` | **64** | Archivos `.js` en `backend/core/`. |
| Servicios | **10** | Archivos en `backend/services/`. |
| Migraciones | 1.132 líneas | `core/migraciones.js` + `backend/db.js` (401 líneas), idempotentes. |
| Botones en vistas | **235** | Ocurrencias literales de `<button` en `frontend/sistema/*.js` (no es el conteo en runtime). |
| Selects / inputs en vistas | **67 / 173** | Ocurrencias literales de `<select` / `<input`. |
| Archivos de test | **68** | Lista explícita en `package.json`. |
| Tests | **634 pass / 0 fail** | `npm test`, 121,2 s (verificado 2026-10-23). |
| Variables de entorno | **37** | `process.env.*` en backend; `.env.example` documenta 25. |
| Documentos de este handoff | **21** | Esta carpeta. |

---

## 5. Cobertura y limitaciones (honestidad del inventario)

### Inspeccionado y verificado
- Suite completa de tests: **634/634 en verde**.
- Estructura completa de rutas, menú, vistas, tablas, tokens y variables.
- Lógica de Salud Tributaria, SII (declaraciones, RCV, TGR), informe imprimible y vista.
- Reglas del núcleo contable (partida doble, cierres, reversión, propuestas, conciliación).

### Inspeccionado, NO verificado en ejecución
- **Integración SII en vivo**: no se autenticó ni consultó el SII. Los flujos descritos provienen del código y de comentarios de verificación previos; su comportamiento real depende de credenciales, del portal y del navegador headless.
- **TGR, MercadoPago, DTE real**: no se ejecutaron. Sin credenciales/CAF/certificado no hay verificación posible.
- **Datos productivos**: no se abrió `data/iva_mensual.db` ni `data/sii-fichas/*`. Cifras de cartera citadas en docs previos no se re-verificaron.
- **Render visual**: no se tomó screenshot ni se abrió navegador. Los hallazgos visuales se derivan de CSS/HTML; los que requieren medición están marcados como tales.
- **Jobs largos** (reunión de antecedentes, ingesta histórica, sync diaria): no se dispararon.

### No inventariado botón por botón al 100 %
- El catálogo de `06` cubre **todas las pantallas** y las acciones principales/contextuales de cada una, pero no enumera las 235 ocurrencias literales de `<button` una por una: varias son plantillas repetidas por fila (acciones de tabla) y varias viven en modales generados dinámicamente. Se indica por pantalla el conjunto de acciones y sus manejadores; lo no itemizado se declara.
- **CRM** (1.209 líneas de vista + 1.387 de core) y **Portal de cliente** (1.481 líneas de vista) se documentan a nivel de pantalla, pestañas y acciones principales, no acción por acción.

---

## 6. Convenciones de identificadores

| Prefijo | Uso | Ejemplo |
|---|---|---|
| `MOD-xx` | Dominio funcional | `MOD-05` Contabilidad |
| `P-xxx` | Pantalla (clave de vista) | `P-019` `#salud` |
| `NAV-xx` | Ítem de menú | `NAV-05` |
| `AC-Pxxx-nn` | Acción de una pantalla | `AC-P019-02` |
| `F-Pxxx-nn` | Filtro/parámetro | `F-P021-01` |
| `EP-xxx` | Endpoint | `EP-072` |
| `INT-xx` | Integración | `INT-01` SII |
| `RN-xxx` | Regla de negocio | `RN-020` |
| `ST-xx` | Indicador de Salud Tributaria | `ST-01` |
| `RK-xx` | Riesgo | `RK-01` |
| `DEC-xx` | Decisión pendiente | `DEC-01` |

---

## 7. Orden de lectura recomendado

1. `01` y `02` para contexto y estado.
2. `12`, `13`, `14` si el objetivo inmediato es Salud Tributaria / SII / certificados.
3. `05`, `16`, `17` para navegación y rediseño.
4. `18`, `19`, `20` antes de implementar.

---

## 8. Reglas que este handoff respetó

- No se reconstruyó nada, no se reemplazó tecnología, no se eliminó funcionalidad.
- No se modificaron credenciales, sesiones, permisos, datos ni procesos tributarios.
- No se declaró operativa una función por existir un botón o una ruta.
- Diagnóstico, propuesta, implementación y validación están separados: **este paquete es diagnóstico + propuesta; la implementación no comenzó.**

---

## 9. Auditoría de completitud del handoff (Etapa G)

Re-verificación mecánica ejecutada al cerrar el paquete, sobre el mismo árbol inspeccionado:

| Verificación | Comando / método | Resultado |
|---|---|---|
| Documentos exigidos | `ls docs/handoff-integral` | 21/21 presentes (`00`–`20`), 4.542 líneas |
| Referencias cruzadas | Extraer todo `NN-*.md` citado y comprobar existencia | 21 nombres citados, **0 rotos** |
| Placeholders | Buscar `TODO/TBD/XXX/[completar]/Lorem` | Sin marcadores pendientes (las 2 coincidencias son `TODOS_LOS_ITEMS` y un nodo «Todos» del diagrama) |
| Diagramas | Cabecera de cada bloque `mermaid` | 13 bloques en `15` + 2 en otros docs, **todos con tipo válido** |
| Vistas | Regex `VIEWS.x =` / `VIEWS['x'] =` sobre `frontend/sistema/*.js` | **49** claves únicas |
| Menú | Extracción del arreglo `MENU` | **10 secciones / 43 ítems**, 43 únicos, 0 ítems sin vista |
| Vistas fuera del menú | Diferencia vistas − ítems | 6 (`balance8`, `clasificado`, `comprobacion`, `niif`, `resultados`, `situacion`) → documentado como RK-21 |
| Endpoints | Conteo por método en `backend/routes/*.js` | **230** (GET 114 · POST 92 · PUT 9 · PATCH 5 · DELETE 10) + 2 rutas directas en `index.js` |
| Routers montados | `app.use('/api...')` | **23** |
| Tablas | `CREATE TABLE` únicos | **61** únicas; 48 sentencias en esquema base + 16 en módulos (con re-creaciones idempotentes) |
| Suite de tests | `npm test` | **634 pass / 0 fail** |
| Estado del árbol | `git status` | Solo `docs/handoff-integral/` sin seguimiento; **ningún archivo de código, datos o configuración modificado** |

Correcciones aplicadas en esta pasada: (a) se precisó el desglose de tablas en `09` (antes decía «52 base + 9 módulos»; el desglose verificado es 48 + 16 declaraciones para 61 tablas únicas); (b) se agregó **RK-21** en `20` con el defecto de guard de permisos en vistas sin ítem de menú.

### Lo que sigue sin verificar (declarado, no oculto)
- Llamadas reales al SII, TGR, MercadoPago y emisión de DTE (requieren credenciales y efectos externos).
- Render visual medido en navegador: no se tomaron capturas ni se navegó la SPA.
- Datos productivos (`data/iva_mensual.db`, `data/sii-fichas/`): no se abrieron.
- Comportamiento en runtime de los 235 `<button>`: se documentan por pantalla, no uno por uno.
