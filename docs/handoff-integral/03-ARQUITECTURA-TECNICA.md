# 03 · Arquitectura técnica

---

## 1. Decisión arquitectónica vigente

**Monolito modular en un proceso Node, un repositorio, una base SQLite.** Está documentado y se cumple en el código:

- `backend/core/*`: dominio puro. No importan Express, no leen `req/res`; reciben `db` y datos, devuelven datos o lanzan `Error` de dominio.
- `backend/routes/*`: routers delgados. Resuelven parámetros HTTP, aplican `requireAuth`/`requirePermiso` y delegan.
- `backend/services/*`: infraestructura de dominio (SII, RCV, cálculo, sesión, password, informes, exportación).
- `backend/middleware/*`: auth, permisos/licencia, headers, 404.
- `frontend/sistema/*`: SPA sin build, contrato `window.VIEWS.<clave> = { titulo, render(cont) }`.

**No hay capa de repositorios ni ORM:** SQL directo con `better-sqlite3` (síncrono). Es consistente en todo el backend.

---

## 2. Orden de middleware (real, en `backend/index.js`)

```text
dotenv → express.json especial 8 MB para /api/contable/**/tesoreria/cartola-archivo
       → express.json 100 KB global
       → trust proxy 1
       → headersSeguridad (CSP, nosniff, XFO, CORP, HSTS solo HTTPS)
       → /api/auth (público con rate-limit interno)
       → GET / (landing)
       → redirects de pantallas heredadas (302)
       → express.static(frontend)
       → routers /api/* con requireAuth (+ RBAC interno)
       → /api/health
       → noEncontrado (JSON para /api, 404.html para páginas)
       → error handler JSON 500
```

Consecuencias relevantes:
- El **404 es propio**: una ruta de API inexistente responde JSON; una página, HTML.
- Los **errores de ruta** no tumban el proceso; se responden `{ok:false,error}` con status 500.
- `uncaughtException`/`unhandledRejection` se registran y **no** terminan el proceso (decisión explícita). Riesgo: un estado corrupto puede seguir sirviendo.

---

## 3. Contrato de autorización

`middleware/requirePermiso.js`:

1. Exige sesión (`requireAuth` ya montado por router).
2. Resuelve `empresaId` de `req.params.empresaId` (o del body/query en rutas especiales como asientos externos).
3. Verifica que el usuario tenga asignación vigente en `usuario_empresa` (o sea `is_admin`).
4. Verifica que el rol tenga la capacidad (`permisosDeRol`).
5. En métodos de escritura, aplica **gate de licencia**: si la suscripción no está operativa → HTTP 402 (excepto rutas de pago, que usan `permisoSinGate`).

Permisos de lectura de Salud Tributaria **no** se bloquean por licencia; sincronizar sí.

**Capacidades:** 41, agrupadas por dominio (empresas, usuarios, períodos, auditoría, cuentas, documentos, asientos, reglas, propuestas, automatización, conciliación, onboarding, reportes, salud, CRM, tesorería, activos, config, licencias, facturación, DTE).

---

## 4. Responsabilidad de los módulos `core/` (mapa)

| Área | Módulos | Responsabilidad |
|---|---|---|
| Identidad y acceso | `empresas`, `empresas-sii`, `permisos`, `licencias`, `usuarios-temporales`, `registro` | Alta de empresas, ficha SII, roles, suscripción, usuarios temporales |
| Contabilidad | `cuentas`, `plan-cuentas-plantilla`, `periodos`, `asientos`, `asientos-externos`, `centros-costo`, `auditoria` | Plan, períodos, partida doble, receptor externo, bitácora |
| Documentos | `documentos`, `ingesta`, `reglas`, `reglas-semilla`, `propuestas`, `conciliacion` | Bandeja, dedupe, clasificación, propuestas, conciliación SII↔contable |
| Automatización | `automatizacion`, `sync-diaria`, `jobs-persistentes`, `jobs-memoria` | Pipeline, sincronización programada, jobs reanudables |
| Reportes | `reportes`, `niif`, `dashboard`, `analitica`, `informe-salud-html`, `salud-tributaria` | Estados financieros, rubros, KPIs, informes |
| Tributario/SII | `declaraciones-sii`, `f29-formulario`, `renta-sii`, `dj-sii`, `deuda-tgr`, `salud-sincronizacion` | Consulta de declaraciones, parseo F29, renta, DJ, TGR, orquestación |
| Tesorería | `tesoreria`, `tesoreria-cartola-formatos`, `cobranza`, `pagos`, `pagos-mercadopago`, `facturas-suscripcion` | Bancos, cartolas, cobranza, suscripción |
| Activos y DTE | `activos`, `dte-emisor`, `dte-contable` | Depreciación, emisión, puente DTE→contabilidad |
| Comercial | `crm`, `crm-comercial`, `propuestas`, `portal-*` | Pipeline, campañas, portal read-only |
| Soporte | `buscador`, `alertas`, `backup-cifrado`, `backup-restaurar`, `boveda`, `rate-limit-db`, `migraciones`, `onboarding`, `centro-apps`, `pantallas-heredadas` | Búsqueda, alertas, respaldo, cifrado, límites, onboarding |

---

## 5. Flujo de una petición típica

```text
Navegador (SPA)
  apiGet('/api/contable/empresas/3/salud-tributaria?periodo=202610')
    → requireAuth (cookie sid → sessions)
    → routes/salud.js (requirePermiso('salud:ver') → usuario_empresa + rol + licencia)
    → core/salud-tributaria.construirInforme(db, {empresaId, periodo, meses, ficha})
        → SELECT documentos, rcv_agregados, declaraciones_sii, f29_formularios,
                 renta_sii, dj_sii, deuda_tgr, teso_*, snapshots
        → cálculo de índice, hallazgos, exposición, plan
    → JSON {ok, informe}
  Render en views-salud.js (10 pestañas)
```

No hay caché HTTP: el navegador siempre consulta. Hay caché en proceso para el resumen de salud (60 s por empresa+período, invalidada al sincronizar).

---

## 6. Frontend: shell y router

`frontend/sistema/app.js` (1.374 líneas) concentra:

| Responsabilidad | Implementación |
|---|---|
| Estado de sesión | `S` (user, empresas, empresa, permisos, licencia, cachés) |
| Login y cambio forzado | `renderLogin`, `renderCambioForzado`, `renderOnboardingEmpresa` |
| Shell | `renderShell`: sidebar, selector de empresa, header (buscador global, campana, tema), titlebar con período, dock |
| Menú | constante `MENU` (10 secciones / 43 ítems) + `menuVisible()` por rol + secciones plegables |
| Router | `hashchange → renderRoute`; clave = hash sin query; `VIEWS[key] || VIEWS.inicio` |
| Contexto compartible | `url-estado.js`: `#vista?filtros&empresa=ID&periodo=YYYYMM` |
| Navegación auxiliar | `DOCK` (5 rutas + Menú), `Centro de Aplicaciones`, breadcrumb, buscador del menú, búsqueda global |
| Accesibilidad | skip-link, `aria-live` de vista, foco en `main`, Escape en modales |
| Período global | `periodoGlobal()` + `aplicarPeriodoGlobal()` escribe variables `window._*Periodo` que leen las vistas |
| Pills | documentos pendientes y score de salud en el menú |

**Riesgo estructural:** el período se propaga por variables globales ad-hoc (`window._ctaPeriodo`, `_propPeriodo`, `_librosPeriodo`, `_autoPeriodo`, …). Es una lista manual: cualquier vista nueva que olvide registrarse queda en el mes calendario. El contexto en URL mitiga, no elimina.

**Contrato de vista:** `{ titulo, async render(cont) }`. Las vistas escriben HTML con template strings y luego enlazan eventos por `id`. No hay componentes con estado ni virtual DOM. `shared/uitoolkit.js` provee tabla (orden, búsqueda, paginación, export, totales) y `UIForms`.

---

## 7. Jobs y trabajos largos

| Job | Disparador | Persistencia | Reanudación |
|---|---|---|---|
| Ingesta RCV | Manual (Libros, Onboarding) | `jobs_persistentes` | `onboarding.reanudarHistoricosPendientes` al arrancar |
| Sync diaria | Login (fire-and-forget) + cron | `jobs_persistentes` | `sync-diaria.reanudarSyncDiaria(db)` al arrancar |
| Reunión de antecedentes (Salud) | Botón «Reunir antecedentes» | Job en memoria con estado por usuario | No sobrevive reinicio |
| Informes legacy | `services/informe.js` | `Map` en memoria + BD al terminar | No |
| Proceso masivo | `services/proceso.js` | `Map` en memoria | No |

Los jobs persistentes usan **mutex por clave** (`empresa:periodo` / `tipo:clave`) para no duplicar corridas.

---

## 8. Base de datos y transacciones

- `better-sqlite3` con WAL; escrituras en `db.transaction()`.
- Asiento = cabecera + líneas en una transacción; documento/propuesta/estado se actualizan en la misma.
- Montos contables en **INTEGER pesos**; capa tributaria legacy usa REAL (documentado).
- FKs declaradas en tablas nuevas; SQLite no fuerza por defecto salvo `PRAGMA foreign_keys` (verificar por conexión — ver `db.js`).
- Migraciones idempotentes por `PRAGMA table_info` y `CREATE TABLE IF NOT EXISTS`; no hay tabla de versiones de esquema, solo `meta` para claves como `rcv_cache_version`.

---

## 9. Manejo de errores

| Capa | Patrón |
|---|---|
| Core | `throw new Error('mensaje de dominio en español')` |
| Router | `try/catch` → `res.status(4xx/5xx).json({ok:false,error})`; algunos distinguen códigos (`SII_TOPE_SESIONES`→409, `SII_SIN_NAVEGADOR`→424, SII→502) |
| SII | Reintento por sesión expirada, rate-limit global, cierre de sesión en `finally` |
| Frontend | `apiGet/apiPost` lanzan `Error` con el mensaje del backend; las vistas muestran un cartel rojo genérico o `showToast` |
| Jobs | Estado por paso (`pendiente/en_curso/ok/error`) visible en la UI |

**Carencia:** no hay taxonomía de errores para el usuario (técnico / fuente no disponible / sin permiso / sin licencia / dato inexistente). Cada vista redacta el suyo.

---

## 10. Restricciones que el rediseño debe respetar

1. No introducir build ni framework sin justificación: el shell actual funciona sin dependencias.
2. No romper `window.VIEWS` ni los anchors (`#documentos`, `#asientos`, …); hay enlaces guardados.
3. No duplicar lógica de cálculo: `services/calculos.js` es la fuente de IVA/PPM/F29 estimado.
4. No llamar al SII desde módulos contables: solo `services/rcv.js` / `sii-rcv.js` / `empresas-sii.js` / `declaraciones-sii.js`.
5. No contabilizar sin confirmación humana (regla de producto vigente).
6. No añadir escrituras sin `requirePermiso` + gate de licencia.
