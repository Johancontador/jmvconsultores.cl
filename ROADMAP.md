# ROADMAP — Plan de construcción del Software Contable JMV

> Fecha: 2026-10-01 · Orden de construcción obligatorio según PROMPT MAESTRO §47. Regla de oro: **cada fase termina verde en `npm test` + CI, con datos reales de al menos una empresa, antes de empezar la siguiente.** No mostrar funcionalidades inexistentes como terminadas (§42): el nav solo mostrará lo que exista.

---

## Vista general

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Inspección + documentos de análisis (este set) | **✅ COMPLETADA** |
| 1 | Fundación: empresas, usuarios, roles, períodos, auditoría, bóveda, backups | **✅ IMPLEMENTADA** (2026-10-01, ver nota bajo la fase) |
| 2 | Núcleo contable: plan de cuentas, asientos, partida doble, diario, mayor | Siguiente |
| 3 | Documentos: ingesta SII, bandeja, clasificación, reglas | — |
| 4 | Automatización: propuestas, contabilización, conciliación | — |
| 5 | Reportes: balance, resultados, análisis | — |
| 6 | Tesorería | — |
| 7 | Activos fijos | — |
| 8 | NIIF/IFRS avanzado | — |
| 9 | Integraciones: Geo Daniela, bancos | — |

**MVP (criterio §48) = Fases 1+2+3+4+5 hasta "cerrar período" con conciliación.** Las fases 6–9 no bloquean el MVP.

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

1. **Plan de cuentas**: plantilla PUC simplificada chilena precargada al crear empresa; CRUD con validaciones (ACCOUNTING_DOMAIN §3); alias de control (IVA_CREDITO, PROVEEDORES...).
2. **Centros de costo**: CRUD simple.
3. **Asientos**: `core/asientos.js` — creación con validación Σdebe=Σhaber, período abierto, cuentas imputables, folio correlativo; tipos manual/ajuste/reversión/cierre; reversión referenciada; transacción atómica.
4. **Diario**: consulta por período/filtros (fecha, cuenta, CC, glosa) paginada.
5. **Mayor**: T-account por cuenta con saldo corrido.
6. **Frontend**: nav 📚 Contabilidad → Asientos (formulario con partidas par a par y validación en vivo), Diario, Mayor, Plan de Cuentas.

Aceptación FASE 2: suite de tests unitarios del core (partida doble inválida rechazada, período cerrado rechazado, reversión cuadra a cero, correlatividad sin huecos, aislamiento por empresa en todas las consultas); flujo manual completo: crear asiento → verlo en diario → ver saldos en mayor.

## FASE 3 — Documentos (SII → bandeja)

1. **Ingesta** (`documentos/ingesta.js`): consumir `rcv.consultarRCV` existente por empresa+período; dedupe idempotente; montos INTEGER; estados iniciales; trabajo en background con progreso (patrón informe.js); reutiliza caché de períodos cerrados.
2. **Bandeja**: `documentos` con filtros (período, RUT, proveedor, folio, tipo DTE, estado, monto, cuenta, CC) sobre `datagrid.js` existente.
3. **Clasificación**: manual (cuenta + CC + tratamiento IVA) y por reglas.
4. **Motor de reglas**: evaluador por prioridad; UI de reglas (lista + editor); "crear regla desde clasificación manual"; catch-all por tipo DTE.
5. **Proveedores/clientes**: entidades derivadas de contrapartes RCV con clasificación recordada (base para prellenar).

Aceptación FASE 3: ingestar Ene–Sep 2026 de la empresa real (1.570 ventas + 1.256 compras) → 0 duplicados en re-ingesta; con las reglas semilla, ≥80% de las compras de un mes queda clasificada sin digitación; navegación y filtros de la bandeja fluidos.

## FASE 4 — Automatización (propuestas, contabilización, conciliación)

1. **Propuestas**: generador desde documento clasificado + regla (Debe: imputable+IVA según tratamiento; Haber: proveedores/clientes); lotes ("proponer todo el mes"); borradores visibles sin asiento registrado.
2. **Contabilización**: confirmación individual o por lote con validación final; transacción única (asiento + líneas + estado documento + auditoría); documento queda `CONTABILIZADO` con `asiento_id`.
3. **REVISIÓN/ERROR**: banderas por divergencia (ACCOUNTING_DOMAIN §5); flujo de resolución con trazabilidad.
4. **Conciliación SII ↔ contable**: por período, contra `consultarResumen`; diferencias tipificadas persistidas en `conciliaciones`; vista de conciliación.

Aceptación FASE 4 (con datos reales): contabilizar un mes completo → el diario cuadra a $0 en partida doble; la conciliación contra el resumen SII del mismo período explica el 100% de la diferencia (o da $0); todo queda auditado.

## FASE 5 — Reportes y cierres

1. Balance de comprobación y sumas; Estado de situación financiera; Estado de resultados (por naturaleza de cuenta, sin digitación).
2. **Cierre de período**: checklist (§7 de ACCOUNTING_DOMAIN) + asientos de cierre (IVA→F29 por pagar, PPM devengado, resultado→patrimonio) + bloqueo del período.
3. Comparativos y exportación Excel (reutilizar `shared/export.js`).
4. Dashboard contable: indicadores financieros + contables + SII + alertas (§9 del PROMPT MAESTRO), distinguiendo lo automático de lo pendiente humano (§43).

Aceptación FASE 5 (cierra el MVP, §48): flujo completo con datos reales: empresa → plan → SII → clasificar → asiento → diario → mayor → balance → resultados → conciliar → **cerrar período**; tras cerrar, ninguna mutación anterior es posible (test); A = P + Patrimonio verificado en todos los estados.

## FASES 6–9 — Post-MVP (una línea cada una, se detallarán al llegar)

- **6 Tesorería**: bancos, pagos, cobros, conciliación bancaria (CxP/CxC del dominio).
- **7 Activos fijos**: registro, depreciación mensual (asiento automático), venta/baja.
- **8 NIIF/IFRS**: mapeo cuentas→rubros NIIF y presentación de estados.
- **9 Integraciones**: receptor Geo Daniela (contrato ya definido en INTEGRATIONS §4), bancos, otras plataformas.

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
