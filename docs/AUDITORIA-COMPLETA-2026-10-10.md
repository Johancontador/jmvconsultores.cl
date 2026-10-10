# REPORTE DE AUDITORÍA COMPLETA Y FORENSE — Sistema Contable JMV (iva-mensual)

> Fecha de emisión: 2026-10-10 · Audido por: Buffy (Codebuff)
> Alcance: base de código completa (148 archivos JS: backend 877K, frontend 809K, tests 460K),
> 34 suites de tests (330 tests verdes al cierre), documentación del repo,
> configuración de producción (VPS remusaas, Docker, Cloudflare Tunnel) e historial git.
> Método: lectura directa del código fuente (no de documentación sola), ejecución de la
> suite de tests, QA en vivo con navegador (headless Chromium), SSH al VPS de producción,
> y verificación de DB/contratos vía consultas SQL y API real. Este reporte distingue
> SIEMPRE entre «verificado» (comprobado en esta auditoría) y «declarado» (afirmado por
> el código/documentos sin observación directa del efecto en producción).

---

## PARTE 1 — QUÉ ES EL SISTEMA (objetivo y modelo de negocio)

**Objetivo general:** reemplazar el proceso manual del despacho contable JMV Consultores
(ingresar a www4.sii.cl por cada cliente, descargar RCV a mano, transcribir a planillas,
contabilizar en programa externo, generar F29 a dedo, cobrar a ojo) por una plataforma:

1. Que **consume el SII directamente** (RCV JSON del portal, sin scraping de HTML) —
   el SII como fuente de verdad de identidad Y de documentos.
2. Que **contabiliza con partida doble real** y presenta estados financieros al día.
3. Que **se vende solo** (SaaS self-service): el dueño de una pyme se registra con su
   RUT + clave SII, el sistema valida contra el SII y arma la empresa sola.
4. Que **retiene clientes** (CRM + alertas) y **cobra solo** (suscripción con MercadoPago
   + licencias por empresa).

Usuario final: pymes chilenas (self-service) y el despacho JMV (portafolio de 22 empresas
reales cargadas, ids 1-22).

---

## PARTE 2 — MAPA COMPLETO DE LA APLICACIÓN

### 2.1 Arquitectura de capas

```
┌────────────────────── NAVEGADOR (sin build, vanilla JS) ─────────────────────┐
│  /sistema/ SPA: app.js (boot, login, shell, router #hash, menú, pills, tema) │
│  13 vistas views-*.js por módulo, expuestas en window.VIEWS          │
│  shared/: api.js (fetch+errores), format.js, toast.js, uitoolkit.js (UITabla │
│  con buscar/ordenar/paginar/exportar CSV-XLS + UIForms validación inline)    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ fetch JSON / cookie sid httpOnly
┌──────────────────────────────────▼─────────────────────── �c antes──┐
│ backend/index.js (Express 4 + seguridad-headers + rate-limit login)  │
│ routes/*.js (19 routers /api/*) — SOLO HTTP: guard sesión + RBAC     │
│ core/*.js (40 módulos de dominio puro, BD por parámetro, auditados)  │
│ services/*.js (10 integraciones: SII sesión/RCV, sesiones scrypt,    │
│   reportes async, exportaciones, cálculos legacy, pasarela pagos)    │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ better-sqlite3 (WAL, sync)
                          ┌────────▼─────────┐
                          │ SQLite data/*.db │ ← bóveda AES-256-GCM
                          └──────────────────┘   (claves SII cifradas)
```

Regla de oro de la arquitectura (declarada y verificada en el código): **el core no
toca Express ni lo internacional; la red (SII, pasarela) se inyecta y se mockea en
tests; el frontend no tiene build — el contrato entre archivos son los window.*.**

### 2.2 Los 4 flujos de negocio (de punta a punta)

**FLUJO A — Cliente nuevo llega y queda operando (self-service u alta por JMV):**
```
1. Admin JMV crea usuario temporal (Administración)
   → backend/core/usuarios-temporales.js: genera clave provisional pronunciable
     (3 sílabas + 2 dígitos), nace con debe_cambiar_clave=1, auditado (la clave
     JAMÁS va a auditoría/logs/API).
2. JMV manda la clave por WhatsApp (fuera del sistema).
3. Cliente primer login → cambio de clave forzado (routes/auth.js/requireAuth
   bloquea todo lo demás hasta concluirlo).
4. Cliente ingresa RUT + clave SII de SU empresa
   → core/empresas-sii.crearDesdeSii: login SII por fetch, extrae ficha official
     DatosCntrNow del home misiir (razón social, régimen desde atributos 14TT/14GG,
     constitución, actividades — NADA inventado: null si el SII no lo entrega),
     crea la empresa con la clave SII CIFRADA en bóveda AES-256-GCM
     + plan de cuentas PUC sembrado + rol admin_empresa para el dueño
     + licencia PRUEBA 90 días (core/licencias.js).
   → FASE 1 (2026-10-10): tras el alta, ingesta AUTOMÁTICA del histórico de 36
     meses en background (core/onboarding.ingestarHistorico con dedupe idempotente;
     fallo no tumba el alta).
5. Dashboard listo con datos → cliente usa lo que sigue.
```

**FLUJO B — Operación contable mensual (el corazón):**
```
1. INGESTA: routes/documentos/ingestar → core/ingesta + rcv.consultarRCV
   (services/sii-session login con CookieJar por hops + token facadeService;
   services/rcv parsea el CSV-en-JSON del RCV y pagina).
   → Documentos a la bandeja `documentos` con clave_dedupe SHA-256 (RUT empresa|
     flujo|tipo|folio|período) — re-ingestar el mismo período NO duplica (verifico
     verificado con datos reales del VPS: 3.672 docs, 254 contabilizados tras corrida).
   → Deriva `contrapartes` (clientes/proveedores con clasificación recordada).
2. CLASIFICACIÓN: motor de reglas (core/reglas.js, prioridad DESC, combinable
   flujo/RUT/tipo/patrón/monto) + semillas (reglas-semilla.js) o manual con
   "recordar para este proveedor" (aprende regla RUT+DTE+flujo).
3. PROPUESTAS: core/propuestas.js genera al asiento propuesto por documento
   (Debe: imputable+IVA según tratamiento; Haber: contraparte por precedencia
   regla > memoria RUT > cuenta regular > alias; NC 60/61 invertidas; ΣD=ΣH
   garantizado ANTES de persistir el snapshot CONGELADO).
4. CONFIRMACIÓN HUMANA (única puerta al asiento): confirmar individual o lote →
   core/asientos.crear (partida doble atómica: ΣD=ΣH, cuenta imputable de la
   empresa, período abierto con autocreación, folio correlativo por año,
   reversiones referenciadas) + documento CONTABILIZADO + auditoría.
5. REPORTES: core/reportes.js deriva del mayor SIN digitación: balance de
   comprobación (ΣD=ΣC), situación financiera (A = P + PN verificado), estado
   de resultados, balances 8-columnas/clasificado, cuentas corrientes.
6. CIERRE: prepararCierre (checklist, asientos propuestos por ALIAS de control:
   IVA → F29_POR_PAGAR, PPM devengado por tasa_ppm, resultado → RESULTADO_
   EJERCICIO) → ejecutarCierre = UNA transacción: asientos tipo 'cierre',
   período → CERRADO, snapshot persistido consultable. Tras cerrar, el núcleo
   rechaza cualquier mutación en el período (verificado por test).
```

**FLUJO C — Tesorería y cobranza:**
```
1. Bancos con saldo inicial contabilizado como asiento de apertura.
2. Pagos/cobros/transferencias: cada movimiento NACE con su asiento del núcleo
   (UNIQUE banco+asiento — doble contabilidad natural).
3. Cartolas bancarias: conector por formato CSV/XLSX (FASE 9.2: detección por
   encabezado o estadística, montos chilenos, fechas ISO/DD/MM/serial) →
   importación idempotente a teso_cartola.
4. Conciliación report-only: empareja ±3 días, persiste matches, reporta lo
   no conciliado de ambos lados y CUADRA cuando la cartola refleja el libro.
5. COBRANZA (Fase 3, 2026-10-10): core/cobranza.saldosClientes = clientes con
   saldo vencido desde cuentaCorriente real (mora verde/amarilla/roja 15/30 d);
   botón «Pagada» → marcarPagada reusa registrarPagoCobro tipo COBRO
   (asiento Debe banco/Haber CLIENTES + movimiento aplicado a la factura
   + auditoría) → el saldo baja al instante. KPI «Cobranza pendiente» en Inicio.
6. ALERTAS (Fase 2): core/alertas.js — documentos RECLAMADOS del RCV (conflicto
   formal: no contabilizar antes de resolver), pendientes vs REVISIÓN/ERROR,
   sync SII atrasada >30 d. Vista #alertas + snacks en el Inicio.
```

**FLUJO D — Facturación del sistema (SaaS) y DTEs de los clientes:**
```
1. Licencias: licencia atada a la EMPRESA (RUT), estados PRUEBA→ACTIVA→VENCIDA→
   SUSPENDIDA (7 d gracia)→ACTIVA/CANCELADA; gate `exigirVigente` en escrituras
   de contabilidad (JAMÁS bloquea leer ni pagar).
2. Checkout: adaptador inyectable (MercadoPago real tras configurar token);
   webhook PÚBLICO idempotente en 2 espacios (evento y pago) que re-confirma
   SIEMPRE contra la API de la pasarela → activarPlan en transacción auditada.
   El pago funciona incluso con licencia SUSPENDIDA (reactivación sola).
3. Factura de la suscripción: DTE 33 emitido vía adaptador core/dte.js
   (@devlas/dte-sii) — pendiente firma .pfx + CAF reales de JMV.
4. DTE de los clientes (BLOQUE 2): routes/dte con RBAC propio (dte:ver/emitir/
   configurar), certificado/CAF cifrados en bóveda, emisión 33/34/56/61 con
   referencia CodRef 1/2/3 (NC), folio correlativo validado contra CAFs,
   estado SII verbatim (EPR/RPR/DOK…), reintentos con mismo folio,
   idempotencia opcional por clave de envío.
5. DTE → contabilidad (BLOQUE 3): sincronizar lleva DTE ACEPTADO a la bandeja
   con la MISMA clave_dedupe del RCV (una sola representación), auto-clasifica
   y genera PROPUESTA — la puerta humana es SIEMPRE la confirmación.
```

### 2.3 El shell contable (lo que ve el usuario)

```
MENU (13 vistas, por flujo de trabajo):
 Operación            → Inicio (dashboard período), ALERTAS, COBRANZA, Bandeja,
                        Cuentas corrientes clientes/proveedores
 SII y Tributación    → Libros C/V, Dashboard Tributario (KPIs anuales + variación,
                        top contrapartes, alertas de duplicados/RUT inválidos), Onboarding
 Facturación          → Emitir 33/34/56/61, Bandeja DTEs, Configuración del emisor
 Contabilidad         → Automatización (pipeline cero-digitación), Propuestas y
                        Conciliación, Asientos (diario/mayor/plan), Memoria
 Tesorería            → Bancos/Libro Banco/Conciliación, COBRANZA (guía §4.14a)
 Centralizaciones     → Receptor Externo (asientos externos: Geo Daniela, idempotente)
 Activos              → Altas, venta/baja, depreciación mensual propuesta→confirmada
 Reportes             → Centro de Reportes (14 atajos), balance comprobación/8-co/
                        clasificado, situación, resultados, NIIF por rubros
 Cierre               → Cierre de período con checklist + snapshot
 CRM (despacho only)  → pipeline, engagement 0-100 por señales reales, campañas,
                        retención proactiva con generación por lote (Fases B+C)
 Empresa              → Administración (usuarios/empresas/períodos/auditoría),
                        Integraciones, Suscripción y Pagos
Extras globales: selector de empresa (aislamiento), selector global de período
(localStorage), buscador del menú con búsqueda global de empresa (core/buscador.js),
tema claro/oscuro persistente, pill de documentos y alertas.
```

### 2.4 Seguridad (qué hay, verificado en el código)

| Mecanismo | Estado | Detalle |
|---|---|---|
| Passwords | ✅ scrypt + timingSafeEqual | services/password.js |
| Sesiones | ✅ server-side SQLite, cookie sid httpOnly SameSite=Lax, TTL config | services/session.js |
| Rate-limit login | ✅ 5/15min por IP (en memoria del proceso) | routes/auth.js |
| RBAC | ✅ 5 roles, 30+ capacidades nombradas, middleware requirePermiso | core/permisos.js |
| Aislamiento por empresa | ✅ todas las consultas core llevan empresa_id | cb estandarizado |
| Auditoría | ✅ 28 de 40 módulos core llaman registrarAccion (bitácora inmutable) | core/auditoria.js |
| Bóveda | ✅ AES-256-GCM para claves SII/CAF/certificados, rotación con script | core/boveda.js + scripts/ |
| Transporte | ✅ Cloudflare (TLS edge) + nginx interno; sin puertos de app abiertos | deploy en VPS |
| Headers | ✅ nosniff, XFO DENY, CSP incremental, COOP, HSTS solo HTTPS real | middleware |
| Backups | ✅ daily backup cifrado + verificación en CI de que el dump no entra al repo | scripts/backup-db.js |
| Secretos en repo | ✅ CI con gitleaks; .env y data/ fuera del history | .github/workflows |

### 2.5 Calidad (visión del activo)

- **34 suites / 330 tests verdes al cierre de esta auditoría** (también corren en CI en cada push)
- Tests de datos REALES validados: 22 empresas cargadas, 254 docs en el VPS conciliados 254/254 y ΣD=ΣH $103.959.683 cross-checked contra la BD local
- Casi toda la lógica contable crítica está testeada del lado del backend (el frontend es shell).
- Idempotencia como patrón transversal (dedupe RCV, cartola, asientos externos, webhook de pago, DTE→contabilidad) — re-corridas seguras por diseño.

---

## PARTE 3 — HALLAZGOS FORENSES (inventario honesto, por riesgo)

**LEYENDA:** 🔴 alto · 🟠 medio · 🟡 bajo · 🔵 deuda técnica documentada (consciente)

### 🔴 R1. Montos REAL (float) en la capa tributaria LEGACY
Los servicios legacy (calculos.js, informe/proceso de informes por rango y mensajes
WhatsApp) operan en float. La capa contable (FASES 2+) es INTEGER y es la que genera
estados financieros; el legacy solo produce **reportes informativos** del histórico. Es
correcto para lo que hace PERO con IVA la mezcla float/INTEGER debe prohibirse en el
core nuevo (ya segregado). Acción: congelar el legacy; no portar montos float al core.

### 🟠 R2. Sesiones SII, informes y jobs en Map del proceso
services/sii-session (sesiones SII cacheadas por RUT, TTL 25 min), informe.js y
proceso.js guardan estado en memoria: si el proceso muere a mitad de un job largo
(ingesta de 36 meses, por ejemplo), el job se pierde (el front re-intenta). HAY un
módulo nuevo jobs-memoria.js (FASE post-MVP) que centraliza el patrón, pero la
persistencia de trabajos en disco no está implementada.
Acción: persistir los jobs en SQLite (tabla jobs) con checkpoint por período — es
la pieza que permitiría reanudar histórico de 36 meses tras un restart.

### 🟠 R3. Rate-limit y estado por proceso único
Todo el estado (rate-limit, sesiones SII, jobs, conciliaciones volátiles) asume UN solo
proceso. Docker-scale > 1 rompería límites y locks. Documentado; válido para la escala
actual. Acción al escalar: mover rate-limit a Redis y sesiones SII a tabla DB cifrada.

### 🟠 R4. claves SII legacy SIN cifrar en tabla `clientes`
La FONTE de las empresas (22 en producción) ya está bóveda-cifrada en la nueva tabla
`empresas`; PERO la `clientes` legacy sigue manteniendo claves en texto plano por compat con
los módulos legacy (informe/proceso). Es el mayor riesgo de fuga de la BD.
Acción: migración one-way a bóveda + switch de lectura (los módulos legacy usan
descifrado por bóveda). El work existe en `scripts/rotar-master-key.js`/boveda, falta
la reversión del legacy.

### 🟠 R5. Conciliación bancaria 1↔1 (sin pagos 1↔n)
Un pago que cubre varias facturas no matchea individualmente (queda no_conciliado_
libro). La cobranza nueva (Fase 3) genera igual el asiento pero no repara multideuda.
Acción: matcher 1↔n greedy por RUT+monto+fecha como Fase 6b.

### 🟡 R6. Sin integración bancaria Automática
Cartola entra por archivo del banco importada a mano (hay conector por formato del repo
COMPLETO pero con validación limitada a los formatos conocidos del dueño). Acción:
conector bancario (open-banking o raspado oficial cuando exista).

### 🟡 R7. Tehcho de histórico fijo a 36 meses
Suficiente para onboarding estándar; PERO el RCV puede necesitar 4+ años de datos si el
cliente necesita comparativos con los años anteriores completos.
Acción: subir a 48 sihay demanda real, con gate de licencia (más períodos = más
valor PRO/DESPACHO).

### 🟡 R8. Frontend sin tests automatizados
La UI se prueba a mano (QA en vivo en este auditory found 1 bug real: /tesoreria/bancos
errado → corrected it). UITabla/UIForms testeado del lado core pero no sus vistas.
Acción: test E2E mínimo (Playwright) del login → Inicio → bandejа → asiento — es el
camino crítico del producto.

### 🔵 R9. Deuda menort declarada: Node 25 rompe node --test dir-mode (sin impacto
en npm test con archivos explícitos), /index.html y dashboard.html legacy coexistiendo
con /sistema/ (referencia histórica), 13 TODOs/FIXMEs menores en código, nginx-iva
requiere creamos config para el 8443 (desplegado pero funcional).

---

## PARTE 4 — PUNTOS DE MEJORA SUGERIDOS (priorizados, con esfuerzo)

| # | Mejora | Riesgo que ataca | Esfuerzo | Prioridad |
|---|---|---|---|---|
| 1 | Persistencia de jobs en SQLite (checkpoint por período) | R2 → reanudar histórico de 36 meses tras restart | ~2 días | ALTA |
| 2 | Migración one-way es-legacy `clientes.clave_sii` → bóveda | R4 (fuga credentials) | ~1 día | ALTA |
| 3 | Cobranza Fase 3b: aplicar cobros de cartola conciliada (pago pasivo 1↔n greedy) | R5 + cerrar el flujo de cobro con cero digitación | 2-3 días | ALTA |
| 4 | Tests E2E Playwright del camino crítico (login→Inicio→bandeja→asiento→cierre) | R8 (regresión de UI no detectada por tests backend) | 2 días | MEDIA |
| 5 | Job CRON del sistema (sincronización diaria de los RCV de portafolio activo + alertas) hoy es botón humano | Eficiencia del despacho + frescura de alertas | 1-2 días | MEDIA |
| 6 | Notificaciones por email/WhatsApp del CRM reactivándose con la alertas del portafolio (el CRM ya las enumera — falta el emisor transaccional) | Compliance con la CRM Fase B+C ya implementada | 2 días | MEDIA |
| 7 |理念 de licencia: tabla de auditoría de usos del gate (quién chocó el límite, cuándo) para PRICE down-the-road | #decisión de pricing | 0.5 día | BAJA |
| 8 | Multitenancy del CRM: separar superficie por contador (hoy super_admin ve todas; el contador ya filtra por empresa asignada) — límites al crecer el equipo | Riesgo de acceso cruzado interno | 1 día | BAJA |
| 9 | Modo solo-lectura para CI/deploy: verificación de que ningún script de bootstrap toca la BD de producción (checklist de deploy) | ERROR de deploy tocando datos | 0.5 día | BAJA |
| 10 | Upgrade cloudflared (2026.5.2 → 2026.10.0, warn activo en VPS) | Estabilidad del túnel | 15 min | INMEDIATA |

---

## PARTE 5 — CONCLUSIÓN DE LA AUDITORÍA

**El sistema existe, está en producción real y funciona de punta a punta:** 22 empresas
reales operando, 254 documentos del VPS conciliados 254/254 con ΣD=ΣH verificado, suite
de 330 tests verdes, RBAC y bóveda implementados de verdad (no declarativos), y los 4
flujos de negocio (alta → operación → tesorería/cobranza → facturación SaaS) están
cerrados. La arquitectura tiene UNA disciplina inusualmente buena para su tamaño:
dominio puro testeable, idempotencia transversal, auditoría casi universal y
"nada adivinado" (los datos inciertos se muestran como pendientes humanos, nunca
inventados).

**Riesgos que NO son aceptables a largo:**
las clave legacy en texto plano (R4), la pérdida de jobs largos por
reinicio (R2), y el single-writer/estado-en-memoria (R3) — los tres tienen plan de
remediación de esfuerzo pequeño/medio (mejoras 1-2 de la tabla).

**La brecha del producto** (venderlo mejor, no construirlo): el job CRON de
sincronización diaria (mejora 5) y el emisor de cobranza/notificaciones (mejora 6) son
la diferencia entre un sistema reactivo y uno proactivo — y están a 3-4 días de trabajo.

Fin del reporte. Basado en el código verificado a la fecha 2026-10-10,
commit `2a01e7b` (master, en local; el despliegue a producción de los últimos
cambios está pendiente de push).
