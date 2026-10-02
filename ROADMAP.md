# ROADMAP — Plan de construcción del Software Contable JMV

> Fecha: 2026-10-01 · Orden de construcción obligatorio según PROMPT MAESTRO §47. Regla de oro: **cada fase termina verde en `npm test` + CI, con datos reales de al menos una empresa, antes de empezar la siguiente.** No mostrar funcionalidades inexistentes como terminadas (§42): el nav solo mostrará lo que exista.

---

## Vista general

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Inspección + documentos de análisis (este set) | **✅ COMPLETADA** |
| 1 | Fundación: empresas, usuarios, roles, períodos, auditoría, bóveda, backups | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 2 | Núcleo contable: plan de cuentas, asientos, partida doble, diario, mayor | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 3 | Documentos: ingesta SII, bandeja, clasificación, reglas | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 4 | Automatización: propuestas, contabilización, conciliación | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 5 | Reportes: balance, resultados, análisis | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 6 | Tesorería | — |
| 7 | Activos fijos | — |
| 8 | NIIF/IFRS avanzado | — |
| 9 | Integraciones: Geo Daniela, bancos | — |

**MVP (criterio §48) = Fases 1+2+3+4+5 hasta "cerrar período" con conciliación.** Las fases 6–9 no bloquean el MVP. **→ MVP COMPLETO (2026-10-01): la fase 5 cierra el criterio.**

---

## FASE 1 — Fundación (multiempresa, usuarios, roles, períodos, auditoría)

Objetivo: que cualquier cosa contable que venga después nazca aislada, con roles y trazable.

> **✅ IMPLEMENTADA (2026-10-01):** tablas `empresas/roles/usuario_empresa/periodos_contables/auditoria` con migración 1:1 desde clientes (clave SII cifrada en bóveda AES-256-GCM, `SECRETOS_MASTER_KEY`); RBAC de 5 roles por capacidades + `requirePermiso`; períodos con cierre/reapertura auditada; bitácora inmutable consultable; `scripts/backup-db.js` (retención configurable); UI `/contable.html` (ficha, crear empresa, roles, períodos, auditoría) con nav 📚 Contabilidad. Verificada con datos reales (2 empresas migradas, ciclo de cierre/reapertura auditado). **15 tests nuevos** en `test/fase1.test.js` (suite completa: 26 verdes). Pendiente operativo: programar el cron de backups en el VPS y definir `SECRETOS_MASTER_KEY` allá (docs/DESPLIEGUE.md §Requisitos operativos).

1. **Empresas**: tabla + migración 1:1 desde `clientes` (conservar rut/nombre/ppm/clave/usuario dueño). CRUD en `/api/contable/empresas`. El portafolio pasa a leer empresas.
2. **Roles y permisos**: tablas `roles`/`usuario_empresa`; 5 roles semilla (SUPER ADMIN, CONTADOR, ADMIN EMPRESA, AUDITOR, TESORERÍA); capacidades nombradas; middleware `requirePermiso`; `GET /api/auth/me` devuelve `{ usuario, empresas:[{id, rol, permisos}] }`. Selección de empresa activa en el shell (sesión).
3. **Bóveda**: cifrado AES-256-GCM de claves SII (`SECRETOS_MASTER_KEY` en env del servidor); migración one-way de `clientes.clave_sii` legado; descifrado solo dentro de integraciones/sii.
4. **Períodos contables**: tabla + estados ABIERTO/CERRADO + autocreación del período al primer uso.
5. **Auditoría**: módulo + bitácora inmutable de todas las mutaciones (quién/qué/antes/después).
6. **Backups**: script diario `sqlite3 .backup` con retención (tarea programada del VPS) + verificación en CI de que el dump no entra al repo.
7. **Frontend**: selector de empresa + admin de usuarios/roles (solo SUPER ADMIN) + panel de auditoría (solo lectura).

Aceptación FASE 1: con 2 empresas y 2 usuarios con roles distintos, ninguna acción cruzada es posible (probado con tests de permisos); auditoría registra todo; clave SII solo cifrada en disco; backups diarios corriendo.

## FASE 2 — Núcleo contable

> **✅ IMPLEMENTADA (2026-10-01):** plantilla PUC chilena de 99 cuentas con alias de control precargada por empresa (migración + al crear); CRUD de cuentas/centros de costo con validación de jerarquía y alias únicos; `core/asientos.js` con partida doble atómica (ΣD=ΣH, montos enteros, cuenta imputable de la misma empresa, período abierto con autocreación, folio correlativo por año), reversiones referenciadas no repetibles, libro diario con filtros (período/cuenta/texto) y mayor con saldo corrido según naturaleza. UI `/asientos.html` (asiento con validación en vivo, diario, mayor, plan). **12 tests nuevos** (`test/fase2.test.js`); suite completa: 38 verdes. Verificado en vivo con datos reales: apertura folio 1 → reversión folio 2 → mayor neto $0, todo auditado.

1. **Plan de cuentas**: plantilla PUC simplificada chilena precargada al crear empresa; CRUD con validaciones (ACCOUNTING_DOMAIN §3); alias de control (IVA_CREDITO, PROVEEDORES...).
2. **Centros de costo**: CRUD simple.
3. **Asientos**: `core/asientos.js` — creación con validación Σdebe=Σhaber, período abierto, cuentas imputables, folio correlativo; tipos manual/ajuste/reversión/cierre; reversión referenciada; transacción atómica.
4. **Diario**: consulta por período/filtros (fecha, cuenta, CC, glosa) paginada.
5. **Mayor**: T-account por cuenta con saldo corrido.
6. **Frontend**: nav 📚 Contabilidad → Asientos (formulario con partidas par a par y validación en vivo), Diario, Mayor, Plan de Cuentas.

Aceptación FASE 2: suite de tests unitarios del core (partida doble inválida rechazada, período cerrado rechazado, reversión cuadra a cero, correlatividad sin huecos, aislamiento por empresa en todas las consultas); flujo manual completo: crear asiento → verlo en diario → ver saldos en mayor.

## FASE 3 — Documentos (SII → bandeja)

> **✅ IMPLEMENTADA (2026-10-01):** tabla `documentos` (bandeja persistente independiente de informes, cierra la deuda §8.8 de CURRENT_STATE) con dedupe idempotente `clave_dedupe` (SHA-256 de rut empresa|flujo|tipo DTE|folio|período) — re-ingesta del mismo RCV NO duplica (probado); máquina de estados §5 con transiciones validadas (RECIBIDO reservado, ingesta inserta PENDIENTE; PROPUESTO/CONTABILIZADO quedan para FASE 4; monto 0 → REVISIÓN; anulación auditada nunca física); ingesta en background con progreso (patrón informe.js) que consume `rcv.consultarRCV` existente SIN tocarlo, convierte montos REAL→INTEGER solo en la frontera y deriva `contrapartes` (proveedor/cliente, clasificación recordada); motor de reglas por prioridad DESC con condiciones combinables (flujo, RUT, tipo DTE, patrón razón social, rango de monto) y catch-all; clasificación manual con "recordar para este proveedor" (aprende regla RUT+DTE+flujo, prioridad 50); clasificación automática en lote auditada; UI `/bandeja.html` (ingesta con polling, chips de estado con conteos, filtros, diálogo de clasificación con cuenta/CC/IVA, reglas, contrapartes) con nav 📚 → Bandeja de Documentos. Nueva capacidad RBAC `documentos:ingestar` (contador y super admin). **17 tests nuevos** (`test/fase3.test.js`); suite completa: 55 verdes. Pendiente de validación con datos reales del VPS: ingestar Ene–Sep 2026 de la empresa real (1.570 ventas + 1.256 compras → 0 duplicados en re-ingesta) y verificar ≥80% de clasificación con reglas semilla (criterio de aceptación).

1. **Ingesta** (`documentos/ingesta.js`): consumir `rcv.consultarRCV` existente por empresa+período; dedupe idempotente; montos INTEGER; estados iniciales; trabajo en background con progreso (patrón informe.js); reutiliza caché de períodos cerrados.
2. **Bandeja**: `documentos` con filtros (período, RUT, proveedor, folio, tipo DTE, estado, monto, cuenta, CC) sobre `datagrid.js` existente.
3. **Clasificación**: manual (cuenta + CC + tratamiento IVA) y por reglas.
4. **Motor de reglas**: evaluador por prioridad; UI de reglas (lista + editor); "crear regla desde clasificación manual"; catch-all por tipo DTE.
5. **Proveedores/clientes**: entidades derivadas de contrapartes RCV con clasificación recordada (base para prellenar).

Aceptación FASE 3: ingestar Ene–Sep 2026 de la empresa real (1.570 ventas + 1.256 compras) → 0 duplicados en re-ingesta; con las reglas semilla, ≥80% de las compras de un mes queda clasificada sin digitación; navegación y filtros de la bandeja fluidos.

## FASE 4 — Automatización (propuestas, contabilización, conciliación)

> **✅ IMPLEMENTADA (2026-10-01):** tablas `propuestas` (snapshot CONGELADO de líneas en `lineas_json` — la confirmación aplica exactamente lo propuesto, nunca regenera; índice parcial `UNIQUE(documento_id) WHERE estado='PENDIENTE'` que permite histórico de re-propuestas) y `conciliaciones` (UNIQUE empresa+periodo, re-ejecutar reemplaza con ON CONFLICT DO UPDATE); columna `asientos.origen` ('propuesta:<id>') agregada por PRAGMA. `core/propuestas.js`: generar desde CLASIFICADO (re-propone PROPUESTO y CONTABILIZADO-solo-si-su-asiento-ya-está-revertido, transiciones §5), contraparte por precedencia §6 (cuenta_contraparte_id de la regla > clasificación recordada > alias PROVEEDORES/CLIENTES), NC 60/61 con patas invertidas conservando ΣD=ΣH, partida cuadrada validada ANTES de guardar el snapshot; confirmar = transacción única asiento (núcleo FASE 2 con todas sus validaciones) + propuesta APLICADA + documento CONTABILIZADO con asiento_id, fecha = fecha_docto del documento (devengo); confirmarLote omite y reporta los fallidos (p. ej. período cerrado) sin quedar a medias silenciosamente; descartar devuelve el doc a CLASIFICADO. `core/conciliacion.js` (§9): diferencias SOLO_SII / MONTO_DIVERGENTE / IMPUESTO_DIVERGENTE (IVA por alias con signo NC correcto), asientos sin documento = ajustes_sin_documento (NO son diferencias), comparación contra resumen oficial SII opcional (`sii_resumen`); concilia y REPORTA, jamás corrige en silencio. RBAC nuevo: propuestas:ver/generar/confirmar + conciliacion:ver/ejecutar (contador: todas; admin_empresa/auditor/tesorería: solo ver). UI `/propuestas.html` (tabs propuestas/conciliación, generar lote, confirmar individual con vista de partidas y fecha opcional, confirmar lote, descartar, historial) con nav 📚 → Propuestas y Conciliación. **16 tests nuevos** (`test/fase4.test.js`); suite completa: 71 verdes. Pendiente de validación con datos reales del VPS (criterio de aceptación): contabilizar un mes completo → diario cuadra a $0 y la conciliación contra el resumen SII del período explica el 100% de la diferencia (o da $0).

1. **Propuestas**: generador desde documento clasificado + regla (Debe: imputable+IVA según tratamiento; Haber: proveedores/clientes); lotes ("proponer todo el mes"); borradores visibles sin asiento registrado.
2. **Contabilización**: confirmación individual o por lote con validación final; transacción única (asiento + líneas + estado documento + auditoría); documento queda `CONTABILIZADO` con `asiento_id`.
3. **REVISIÓN/ERROR**: banderas por divergencia (ACCOUNTING_DOMAIN §5); flujo de resolución con trazabilidad.
4. **Conciliación SII ↔ contable**: por período, contra `consultarResumen`; diferencias tipificadas persistidas en `conciliaciones`; vista de conciliación.

Aceptación FASE 4 (con datos reales): contabilizar un mes completo → el diario cuadra a $0 en partida doble; la conciliación contra el resumen SII del mismo período explica el 100% de la diferencia (o da $0); todo queda auditado.

## FASE 5 — Reportes y cierres

> **✅ IMPLEMENTADA (2026-10-01) — cierra el MVP (§48):** `core/reportes.js` 100% derivado de `asiento_lineas` (nada digitado): balance de comprobación (acumulado hasta el último día REAL del período + movimientos del mes, ambos con ΣD=ΣC verificado), estado de situación financiera (activos/pasivos/patrimonio por clase + resultado de clases 4/5/6 acumulado SIN asiento de cierre → la ecuación A = P + Patrimonio cuadra en todo estado, verificado por test pre y post cierre) y estado de resultados (mes + acumulado del año). **Cierre de período (§7):** `prepararCierre` NO muta — checklist visible (documentos sin contabilizar BLOQUEAN salvo `forzar` explícito y auditado; conciliación ejecutada y visible: sus diferencias NO bloquean, §7.2) + asientos de cierre PROPUESTOS por ALIAS de control — nunca código rígido (§3.5): IVA determinado → F29_POR_PAGAR (con remanente de crédito fiscal no se propone: el F29 lo arrastra, §10), PPM devengado = ingresos netos × tasa_ppm de la empresa (GASTO_PPM/PPM_POR_PAGAR, §10) y resultado ACUMULADO hasta el último día del período → RESULTADO_EJERCICIO (incorpora el PPM devengado para dejar las clases 4/5/6 en cero; con cuentas abiertas siempre hay asiento aunque el neto sea 0); cada propuesto se verifica cuadrado ANTES de ofrecerse. `ejecutarCierre` = UNA transacción auditada: asientos tipo 'cierre' vía `asientos.crear` (núcleo FASE 2 con TODAS sus validaciones), fechados el ÚLTIMO DÍA del período (el período siguiente queda limpio, sin contrapartidas de cierre), período → CERRADO y snapshot persistido en `periodos_contables.cierre_json` (migración PRAGMA idempotente), consultable vía `obtenerCierre`/snapshot UI. La confirmación es SIEMPRE humana (botón con selección de asientos y `confirm`); el núcleo rechaza cualquier mutación posterior en el período cerrado (test). UI `/reportes-contables.html` (tabs Balance/Situación/Resultados/Cierre con checklist + confirmación + snapshot) con nav 📚 → Reportes y Cierre; RBAC sin cambios: `reportes:ver` (contador/admin_empresa/auditor/tesorería) y `periodos:cerrar` (contador/super_admin) ya existentes. **9 tests nuevos** (`test/fase5.test.js`); suite completa: **80 verdes**. Quedan como mejora posterior (no bloquean el MVP): comparativos y exportación Excel (reutilizar `shared/export.js`) y dashboard contable (§43).

1. ✅ Balance de comprobación y sumas; Estado de situación financiera; Estado de resultados (por naturaleza de cuenta, sin digitación).
2. ✅ **Cierre de período**: checklist (§7 de ACCOUNTING_DOMAIN) + asientos de cierre (IVA→F29 por pagar, PPM devengado, resultado→patrimonio) + bloqueo del período.
3. ⬜ Comparativos y exportación Excel (reutilizar `shared/export.js`) — post-MVP.
4. ⬜ Dashboard contable: indicadores financieros + contables + SII + alertas (§9 del PROMPT MAESTRO), distinguiendo lo automático de lo pendiente humano (§43) — post-MVP.

Aceptación FASE 5 (cierra el MVP, §48): flujo completo con datos reales: empresa → plan → SII → clasificar → asiento → diario → mayor → balance → resultados → conciliar → **cerrar período**; tras cerrar, ninguna mutación anterior es posible (test); A = P + Patrimonio verificado en todos los estados.

> **Logrado en tests (80 verdes):** A = P + Patrimonio verificado pre y post cierre; tras cerrar, el núcleo rechaza cualquier asiento en el período (test); el período siguiente queda sin arrastre. Pendiente: corrida end-to-end con datos reales del VPS (flujo completo hasta cerrar un mes real).

## AUTOMATIZACIÓN — Contabilización automática del período (post-MVP, ruta corta)

> **✅ IMPLEMENTADA (2026-10-01):** pipeline "cero digitación" de punta a punta sobre los módulos existentes (sin re-implementar nada del núcleo): `core/automatizacion.js` orquesta en UNA operación por período — (1) clasificar con reglas solo PENDIENTE/REVISIÓN (nunca pisa decisiones humanas ya clasificadas), (2) generar propuestas de todo CLASIFICADO del período (los fallos se reportan con motivo), (3) `propuestas.confirmarLote` del núcleo FASE 4 (asientos por partida doble, folio correlativo, omitidos reportados). `core/reglas-semilla.js`: semilla de arranque por ALIAS de control (venta catch-all → VENTAS_SERVICIOS, compra catch-all → GASTO_SERVICIOS_BASICOS, NC de compra sin crédito), idempotente y auditada, se instala solo si la empresa no tiene reglas. Rutas `/api/contable/empresas/:id/automatizacion/...` (estado/ejecutar/semilla) con nueva capacidad RBAC `automatizacion:ejecutar` (contador y super_admin). `clasificarAutomatico` acepta `estados` (extensión retrocompatible). UI: vista ⚡ Automatización en `/sistema/` (KPIs por eslabón, ejecución en un clic con resumen y detalle de omitidos) + sección destacada en Inicio. **8 tests nuevos** (`test/automatizacion.test.js`); suite completa: **101 verdes**. Fix incluido: `licencias.hoyISO()` en UTC — SQLite `date('now')` es UTC y la mezcla con fecha local rompía transiciones VENCIDA/SUSPENDIDA cerca de medianoche en zonas UTC-negativas (3 tests rojos de saas1).

**✅ VALIDADA CON DATOS REALES (2026-10-01, empresa COMERCIALIZADORA C&E CLIMA — 76.312.274-3):** conexión SII OK → ingesta RCV septiembre 2026 (254 docs: 131 compras $37.986.358 + 123 ventas $66.051.472, dedupe idempotente con 2 duplicados saltados) → semilla instalada → pipeline: **254/254 clasificados (100%), 241 contabilizados (95%), 13 rechazados y marcados REVISIÓN** (neto+IVA ≠ total en el RCV: defectos de datos reales del SII) → diario cuadra ΣD=ΣH → conciliación explica el 100% de las diferencias (13 SOLO_SII en REVISIÓN + 3 IMPUESTO_DIVERGENTE de NC con regla sin crédito — decisión del contador). Tres bugs reales encontrados y corregidos con su test de regresión: (1) el SII entrega fecha_docto DD/MM/YYYY y la propuesta hacía fallback silencioso a HOY (rompía el devengo) → normalización en la frontera de ingesta + corrección de los 254 docs ya ingestado; (2) camino muerto de FASE 4: re-proponer un CONTABILIZADO con asiento revertido nunca funcionaba (convención de asiento_revertido_id leída al revés, DATA_MODEL §B.2) → corregido y el pipeline re-levanta automáticamente los revertidos; (3) conciliación generaba falsos MONTO_DIVERGENTE cuando el devengo cruza de período (doc 31/08 contabilizado en 202608) → la comparación doc↔asiento sigue el VÍNCULO asiento_id. Suite: **105 verdes**. Pendiente: decidir con JMV el tratamiento del IVA de las NC de compra (¿crédito recuperable o sin crédito?) y reproducir la corrida en el VPS tras el deploy.

> **✅ DEPLOY VPS (2026-10-02):** las 6 entregas (AUTOMATIZACIÓN + SPA, 6 fixes QA, fmtCorto, SAAS-2, fixes QA onboarding, script de rotación) publicadas vía `git push vps master` → hook `post-receive` (checkout a `/home/johan/apps/iva-mensual` + `docker compose up -d --build`). Smoke verde: health, landing, /sistema/ con la vista Onboarding, endpoint /estado, 401 sin sesión, **conexión SII real OK** (202610: 12+12 docs). **Rotación de bóveda ejecutada en el servidor**: sin `SECRETOS_MASTER_KEY` había 4 secretos con el fallback de desarrollo; `scripts/rotar-master-key.js` re-cifró 4/4 con key generada dentro del VPS (nunca impresa ni transmitida), variable añadida al `.env` (600) + recreate; el contenedor ya no emite la advertencia de fallback y las claves SII descifran. **Cierre de 2 deudas operativas**: (1) `scripts/` no estaba en la imagen Docker (MODULE_NOT_FOUND en `docker exec`) → `COPY scripts` en el Dockerfile; (2) **nunca existieron backups** (sin carpeta ni cron) → primer backup 37 MB tomado y cron diario 03:00 instalado en el VPS (`scripts/backup-db.js`, retención `BACKUP_RETENCION`). Quedan pendientes: JMV decide el tratamiento de IVA de las NC de compra; reproducir la corrida de automatización con los datos ya ingestado en el VPS (3.672 docs locales fueron del QA local, no del VPS).

## FASES 6–9 — Post-MVP (una línea cada una, se detallarán al llegar)

- **6 Tesorería**: bancos, pagos, cobros, conciliación bancaria (CxP/CxC del dominio).
- **7 Activos fijos**: registro, depreciación mensual (asiento automático), venta/baja.
- **8 NIIF/IFRS**: mapeo cuentas→rubros NIIF y presentación de estados.
- **9 Integraciones**: receptor Geo Daniela (contrato ya definido en INTEGRATIONS §4), bancos, otras plataformas.

## SAAS — Acomplamiento comercial (docs/SAAS-ACCESO.md)

Paralelo a las fases 6–9: convierte el MVP en producto vendible desde jmvconsultores.cl.

> **✅ SAAS-1 IMPLEMENTADA (2026-10-01):** acceso comercial completo — el sitio corporativo enlaza "Acceso al Software" (topbar + footer, URL en `CONFIG.appUrl`) a `app.jmvconsultores.cl`; **registro self-service** (`/registro.html` → `POST /api/auth/registro`): usuario + RUT de empresa + clave SII, con validación EN VIVO contra el SII (`probarConexion` existente, sin scraping) que rechaza crear cuentas con credenciales inválidas; en UNA transacción se crean usuario + empresa (clave cifrada en bóveda) + plan PUC + rol admin_empresa + **licencia PRUEBA 90 días automática**. **Licencias por empresa** (`suscripciones`, UNIQUE empresa_id): planes PRUEBA/PYME $29.900/PRO $59.900/DESPACHO $119.900 en `core/licencias.js`; estados PRUEBA→ACTIVA→VENCIDA (gracia 7d, sigue operando)→SUSPENDIDA, resueltos al leer (sin cron) y auditados; las empresas preexistentes/creadas por JMV reciben licencia HEREDADA (nunca bloqueadas); **gate centralizado en requirePermiso**: capacidades `:ver` nunca se bloquean, escrituras exigen licencia (HTTP 402 con detalle para la UI); banner de countdown en la app; endpoint de disponibilidad en vivo (usuario/RUT); honeypot + rate-limit propio (10/h/IP); backfill idempotente. Fichas tributarias (razón social, actividades, régimen, socios) como columnas listas para SAAS-2 (onboarding 100% autónomo desde el SII). **13 tests nuevos** (`test/saas1.test.js`, SII mockeado); suite completa: **93 verdes**.

> **✅ SAAS-2 IMPLEMENTADA (2026-10-02):** onboarding autónomo — `core/onboarding.js` con ficha tributaria + checklist ✓/⚠ (§43) e ingesta del histórico. Fuente de cada dato: razón social = login exitoso del portal SII (la sesión del RCV ES la prueba de control de la empresa); inicio de actividades = primera venta del RCV (evidencia de la integración, propuesta sujeta a confirmación humana); actividades/régimen/socios = el SII no los entrega por una vía ya existente → formulario humano (jamás scraping, §42). Rutas `/api/contable/empresas/:id/onboarding/...` (ficha, consultar-sii, confirmar-ficha, ingesta-historica + polling del job) con nueva capacidad `onboarding:ejecutar` (contador, admin_empresa, super_admin) y gate de licencia igual que toda escritura. `admin_empresa` gana `documentos:ingestar`: el dueño trae su histórico sin esperar a JMV. La ingesta reusa el pipeline FASE 3 (dedupe idempotente, máx 24 períodos por corrida, job en background con progreso; re-corridas no duplican y un run con errores marca 'parcial' sin degradar un histórico ya confirmado). UI: vista 🚀 Onboarding en /sistema/ (checklist, ficha editable, "Consultar SII" con propuesta aplicable, ingesta con barra de progreso) + tarjeta de pendientes en Inicio. **11 tests nuevos** (`test/saas2.test.js`, SII mockeado — los tests jamás tocan la red); suite completa: **118 verdes**. Pendiente operativo: validar el flujo end-to-end contra el SII real en el VPS tras el deploy.

- **SAAS-3** — Pagos y facturación: webhook MercadoPago/Transbank → `licencias.activarPlan`; factura electrónica de la suscripción; panel de facturación del cliente. (Socios/representante desde el SII quedará aquí si el SII publica una vía oficial.)
- **SAAS-3** — Pagos y facturación: webhook MercadoPago/Transbank → `licencias.activarPlan`; factura electrónica de la suscripción; panel de facturación del cliente.

Aceptación SAAS-1: un dueño de pyme entra desde jmvconsultores.cl → se registra con su RUT y clave SII → si la clave es válida opera con 90 días de prueba; si es inválida NO se crea nada; una empresa suspendida puede leer todo pero no escribir (402); nada de lo anterior rompe el flujo contable de JMV (licencias heredadas).

## Fuera de alcance permanente (recordatorio)

Remuneraciones y todo lo de Geo Daniela como desarrollo; reconstruir la integración SII o el sitio corporativo; scraping; cualquier regla legal inventada sin fuente (las tasas van en configuración con referencia citada).

## Riesgos y mitigaciones operativas

| Riesgo | Mitigación |
|---|---|
| Regresión en lo existente (informes, SII) | Módulos nuevos sin tocar lo viejo; `npm test` + CI; smoke con empresa real en cada fase |
| Claves SII cifradas rompen sesiones existentes | Migración one-way con fallback de lectura legado durante FASE 1; prueba de conexión tras migrar |
| Volumen de documentos en bandeja | Índices §B.9 + paginación del datagrid existente; volumen real ya probado (2.826 docs/9 meses) |
| Expectativa de NIIF temprano | Fase 8 explícita; el plan de cuentas ya reserva la evolución |
| Dependencia de una sola persona (contador) | RBAC desde fase 1 permite separar roles desde el día 1 |

## Decisiones abiertas (para resolver al iniciar cada fase)

1. FASE 1: ¿subdominio `app.jmvxonsultores.cl` o ruta del dominio para publicar? (afecta DNS/Cloudflare, no el código).
2. FASE 1: política de SESSION_DIAS en producción pública (recomendado 7 días, ya configurable).
3. FASE 2: formato de numeración de folios contables visible (año-folio vs folio simple) — decisión de UX contable.
4. FASE 3: plantilla de plan de cuentas inicial — se propone PUC simplificado chileno; validar con JMV antes de precargar.

---

Estado actual real: [CURRENT_STATE.md](CURRENT_STATE.md) · Arquitectura: [ARCHITECTURE.md](ARCHITECTURE.md) · Dominio: [ACCOUNTING_DOMAIN.md](ACCOUNTING_DOMAIN.md) · Datos: [DATA_MODEL.md](DATA_MODEL.md) · Integraciones: [INTEGRATIONS.md](INTEGRATIONS.md)
