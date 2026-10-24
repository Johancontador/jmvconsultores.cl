# 02 · Estado actual del sistema

> Base: lectura del repositorio en `master` @ `85f93e9`. Lo que no se ejecutó se marca.
> Detalle de arquitectura en `03`; pantallas en `04`; datos en `09`; integraciones en `10`.

---

## 1. Identidad y objetivo

| Campo | Valor | Evidencia |
|---|---|---|
| Nombre del paquete | `iva-mensual` | `package.json` |
| Denominación de producto | Sistema Contable JMV / JMV Consultores | `frontend/sistema/index.html`, docs |
| Objetivo declarado | Consulta RCV del SII, resúmenes IVA, y software contable completo (empresas, asientos, documentos, tesorería, activos, DTE, CRM, portal) | `package.json`, `CURRENT_STATE.md` |
| Usuarios | Despacho contable (super admin, contador, auditor, tesorería) y dueños de empresa (admin_empresa) | `core/permisos.js` |
| Multiempresa | Sí: `empresa_id` en todas las tablas de dominio + RBAC por empresa | `db.js`, `migraciones.js` |
| Modelo de despliegue | Un proceso Node, SQLite en archivo, nginx opcional, Docker/Cloudflare Tunnel documentado | `Dockerfile`, `docker-compose.yml`, `nginx/`, `ops/` |

---

## 2. Stack real

| Componente | Tecnología / versión | Evidencia |
|---|---|---|
| Runtime | Node.js ≥ 24 | `engines` |
| Framework HTTP | Express ^4.18.3 | `package.json` |
| BD | better-sqlite3 ^12.10.0, WAL, acceso sincrónico | `db.js` |
| Frontend | Vanilla JS, sin build ni framework; SPA por hash | `frontend/sistema/app.js` |
| PDF/Excel | exceljs ^4.4.0, archiver ^8 | `package.json` |
| Automatización de portales | puppeteer-core ^25.14.0 + Chrome/Chromium del sistema | `core/declaraciones-sii.js` |
| PDF parsing | pdf-parse ^1.1.1 (certificado TGR) | `core/deuda-tgr.js` |
| DTE | @devlas/dte-sii ^2.36.0 | `core/dte-emisor.js`, `core/dte.js` |
| Auth | Propia: scrypt (`salt:hash`), sesiones en SQLite, cookie `sid` httpOnly | `services/password.js`, `services/session.js` |
| Tests | `node --test` con archivos explícitos (68) | `package.json` |
| CI | GitHub Actions: tests + `node --check` + gitleaks | `.github/workflows/` |

**Restricción operativa conocida:** un solo proceso. El rate-limit ya vive en BD (`rate_limit`), pero las sesiones SII y los jobs en curso usan `Map` en memoria; escalar a varias instancias exige moverlos.

---

## 3. Estructura de directorios

```text
backend/
  index.js                bootstrap Express, headers, JSON limits, montaje de routers, 404 y error handler
  db.js                   apertura SQLite, PRAGMA, esquema base, migraciones
  core/                   64 módulos de dominio (sin Express; BD por parámetro)
  routes/                 22 archivos de router (23 montajes HTTP, delgados, con requirePermiso)
  services/               10 servicios (SII, RCV, informes, cálculo, sesión, password)
  middleware/             requireAuth, requirePermiso, seguridad-headers, no-encontrado
  data/iva_mensual.db     BD local (no versionada)
frontend/
  sistema/                SPA: app.js (1.374), 18 views-*.js (10.430 líneas), tema, url-estado, CSS
  css/app.css             tokens y componentes (tema oscuro base + override claro)
  sistema/sistema.css     layout del shell (1.805 líneas)
  shared/                 api.js, format.js, toast.js, uitoolkit.js
  landing/login/registro/servicios/nosotros/...  sitio público
test/                     68 archivos de prueba
docs/                     ~40 documentos (PRD, TRD, arquitectura, auditorías, manuales)
ops/, nginx/, scripts/    despliegue, seed de versionado, backups
data/, tmp-*              datos y residuos de trabajo (no versionados o temporales)
```

---

## 4. Puntos de entrada

| Entrada | Archivo | Comportamiento |
|---|---|---|
| Servidor | `backend/index.js` | Carga `.env`, abre BD, monta middleware y routers, escucha `PORT` (3500 por defecto). Al arrancar reanuda históricos y sync diaria. |
| BD | `backend/db.js` | Crea/actualiza esquema; aplica migraciones de `core/migraciones.js`. |
| SPA | `frontend/sistema/index.html` → `app.js` | `appBoot()` → `/api/auth/estado` → `/api/auth/me` → shell → router hash. |
| Login público | `frontend/landing.html`, `frontend/login.html` | Login embebido que redirige a `/sistema/`. |
| API health | `GET /api/health` | `{ok:true}`. |

**Rutas heredadas retiradas:** `core/pantallas-heredadas.js` responde 302 a la vista equivalente de la SPA antes del `static` (verificado por `test/legado-retirado.test.js`).

---

## 5. Inventario de routers montados (23)

| Prefijo | Router | Auth | Notas |
|---|---|---|---|
| `/api/auth` | `routes/auth.js` | Mixto | login/registro públicos con rate-limit; resto `requireAuth` |
| `/api/clientes` | `clientes.js` | `requireAuth` | Capa legacy con scoping por `user_id` |
| `/api/informe` | `informe.js` | `requireAuth` | Informes por rango |
| `/api/proceso` | `proceso.js` | `requireAuth` | Proceso masivo F29 |
| `/api/exportacion-masiva` | `exportacion-masiva.js` | `requireAuth` | ZIP de Excel |
| `/api/sii` | `sii.js` | `requireAuth` | Probar conexión, RCV on-demand |
| `/api/contable` | 11 routers | `requireAuth` + `requirePermiso` | empresas, documentos, propuestas, reportes, automatización, onboarding, salud, tesorería, activos, niif, asientos-externos |
| `/api/pagos` | `pagos.js` | Mixto | Webhook público con firma; resto RBAC |
| `/api/contacto` | `contacto.js` | Público | Rate-limit + honeypot |
| `/api/dte` | `dte.js` | `requireAuth` + RBAC | Emisión, certificado, CAF, estado |
| `/api/crm` | `crm.js` | `requireAuth` + `guardCrm` | Exclusivo del despacho |
| `/api/portal` | `portal.js` | `requireAuth` + guard interno | Read-only por empresa |
| `/api/health` | inline | Público | |

---

## 6. Estado por funcionalidad

Criterio: **Operativo** = lógica implementada y cubierta por tests del backend; **Parcial** = implementado con límites declarados; **No verificado** = existe código pero no se ejecutó contra el sistema externo; **Duplicado** = más de una vía para el mismo resultado.

### 6.1 Núcleo tributario / SII

| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Login SII (RUT + clave) | Operativo (código) / **No verificado en esta pasada** | `services/sii-session.js`; tests `sii-sesion` con servidor simulado |
| RCV compras/ventas por período | Operativo (código) / No verificado en vivo | `services/sii-rcv.js`, `rcv.js`, `rcv_cache`; tests `fase3`, `sync-diaria` |
| Caché de períodos cerrados | Operativo | `rcv_cache` + `meta.rcv_cache_version`; nunca cachea mes en curso |
| Ficha del contribuyente desde el SII | Operativo (código) | `core/empresas-sii.js`; guarda crudo en `data/sii-fichas/<rut>.json`; 10 tests |
| Consulta Integral F29 | Operativo (código) / No verificado en vivo | `declaraciones-sii.js` vía Chrome headless |
| Formulario Compacto F29 (casillas) | Operativo (código) | `f29-formulario.js`; extracción PDF/texto; tests |
| Renta F22 | Operativo (código) | `renta-sii.js` |
| Declaraciones juradas | Operativo (código) | `dj-sii.js` |
| Boletas de honorarios | Operativo (código) | CGI `loa.sii.cl` desde la sesión SII |
| Deuda fiscal TGR | Operativo (código) / No verificado en vivo | `deuda-tgr.js`; PDF como evidencia + `pdf-parse` |
| Cálculo IVA/PPM/F29 estimado | Operativo | `services/calculos.js`; tests `calculos` |
| Conciliación F29 vs RCV | Operativo | `salud-tributaria.js`; tests S12–S14 |

### 6.2 Contabilidad

| Funcionalidad | Estado | Evidencia |
|---|---|---|
| Plan de cuentas PUC + alias | Operativo | `plan-cuentas-plantilla.js`, `cuentas.js` |
| Asientos manuales, partida doble, folio, reversión | Operativo | `asientos.js`, tests `fase2` |
| Cierre/reabrir período con snapshot | Operativo | `periodos.js`, `core/reportes.js`, tests `fase5` |
| Bandeja de documentos + dedupe | Operativo | `documentos.js`, `clave_dedupe`, tests `fase3` |
| Reglas contables + memoria por RUT | Operativo | `reglas.js`, `propuestas.js`, `memoria-reportes` |
| Propuestas y confirmación humana | Operativo | `propuestas.js`; nunca contabiliza sin confirmar |
| Conciliación SII↔contable | Operativo | `conciliacion.js`, tests `fase4` |
| Pipeline de contabilización automática | Operativo (con confirmación) | `automatizacion.js` |
| Reportes: comprobación, 8 columnas, situación, resultados, clasificado, NIIF, cuentas corrientes | Operativo | `reportes.js`, `niif.js`, tests `fase5/8` |
| Tesorería (bancos, pagos, cobros, transferencias, cartola, conciliación) | Operativo | `tesoreria.js`, tests `fase6`, `cartola-formatos`, `teso-aplicaciones` |
| Activos fijos y depreciación | Operativo | `activos.js`, tests `fase7` |
| Asientos externos (Geo Daniela) | Operativo | `asientos-externos.js`, tests `fase9` |

### 6.3 Facturación, SaaS y comercial

| Funcionalidad | Estado | Evidencia / límite |
|---|---|---|
| Emisión DTE 33/34/56/61 para empresas cliente | Operativo en código; **producción pendiente de CAF/certificado** | `dte-emisor.js`, tests `dte-emision` con XML real offline |
| DTE → contabilidad | Operativo | `dte-contable.js`, tests `dte-contable` |
| Suscripción, checkout y webhook MercadoPago | Operativo en código; **sin credenciales no verificable** | `pagos.js`, `pagos-mercadopago.js`, tests `saas3` |
| Factura de la suscripción | Parcial | Adaptador listo; requiere CAF/certificado |
| CRM del despacho | Operativo | `crm.js`, `crm-comercial.js`, tests `crm*` |
| Portal de cliente (10 vistas) | Operativo | `portal*.js`, tests `portal*` |
| Sitio público, contacto, SEO | Operativo | tests `sitio-publico`, `sitio-seo`, `contacto-web` |

### 6.4 Duplicidades funcionales relevantes

| Resultado | Vías existentes | Riesgo |
|---|---|---|
| Estimación F29/PPM | Calculadora de IVA (`views-herramientas`), Proceso masivo (`views-lote`), Salud Tributaria, Informe por rango, `procesos` legacy | Cálculos podrían divergir; hoy todos usan `services/calculos.js` (mitiga) |
| Reportes financieros | Centro de Reportes, pestañas internas, anchors directos | Descubrimiento confuso, no divergencia |
| Sincronizar RCV | Libros (manual), Onboarding, Sync diaria, Salud (reunión, opcional) | Cuatro disparadores del mismo job; hay mutex por empresa/período |
| Bandeja de documentos | Bandeja, Libros (pestaña documentos), Alertas, Propuestas | Misma fuente `documentos`; UI repetida |
| Estado del período | Selector global, Cierre, Administración | Consistente vía API, pero tres lugares |

---

## 7. Autenticación, autorización y aislamiento

- **Sesión:** `sessions` (sid 32 bytes, TTL `SESSION_DIAS`, default 30), cookie `sid` httpOnly, SameSite=Lax, `secure` en producción. Revocación total al cambiar clave y al desactivar usuario.
- **Contraseñas:** scrypt con salt, comparación `timingSafeEqual`; usuario nuevo nace con `debe_cambiar_clave`.
- **RBAC:** 5 roles (`super_admin`, `contador`, `admin_empresa`, `auditor`, `tesoreria`), 41 capacidades nombradas (`core/permisos.js`). `requirePermiso(capacidad)` resuelve empresa desde `:empresaId` y valida asignación; además aplica **gate de licencia** en escrituras (402).
- **Aislamiento:** routers resuelven `empresaId`; los módulos de `core/` revalidan pertenencia en cada operación; consultas filtran por `empresa_id`. Tests específicos de aislamiento (`crm-tenant`, `fase*`).
- **Capa legacy:** `clientes` e `informes` usan `user_id` (dueño) en lugar de `empresa_id`; convive con el modelo nuevo.

---

## 8. Configuración (nombres, sin valores)

37 variables usadas en backend. Documentadas en `.env.example`: `PORT`, `NODE_ENV`, `SESSION_DIAS`, `DB_PATH`, `RCV_PROVIDER`, `SIMPLEAPI_KEY`, `BASIC_AUTH_USER/PASS`, `SECRETOS_MASTER_KEY`, `BACKUP_ENCRYPTION_KEY`, `NOMBRE_CONTADOR`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_BASE_URL`, `PAGOS_NOTIFICATION_URL`, `PAGOS_URL_RETORNO`, `DTE_*` (11).

**Usadas y no documentadas en `.env.example`:** `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH`, `SECRETOS_MASTER_PASS`, `SII_AUTH_URL`, `SII_HOME_URL`, `SII_RCV_UI`, `SII_PAUSA_MS`, `SII_PORTAL_ESPERA_MS`, `SII_DECLARACIONES_MAX`, `SII_DECLARACIONES_DIAS`, `SII_MAX_EMPRESAS`, `SII_DEBUG_PDF`. Es deuda de documentación, no de seguridad.

---

## 9. Pruebas

- **68 archivos**, **634 tests**, **0 fallos**, 121 s (`npm test`, verificado 2026-10-23).
- Cobertura fuerte: núcleo contable, RBAC, aislamiento, SII simulado, DTE offline, salud tributaria e informe, migraciones, hardening, portal, CRM.
- **Carencias:** no hay pruebas de DOM/navegador; `ux-*.test.js` inspeccionan texto del código fuente. No hay prueba end-to-end del flujo “login → ver empresa → clasificar → contabilizar” en navegador.
- Node 25 rompe `node --test test/` en modo directorio (documentado); por eso `npm test` usa archivos explícitos.

---

## 10. Deuda técnica y limitaciones conocidas

1. `clientes.clave_sii` en texto plano (legacy).
2. Estado en memoria para sesiones SII y jobs; se pierde al reiniciar (los jobs persistentes mitigaron parte).
3. Un solo nodo; SQLite un escritor.
4. Frontend sin build, sin tipado y sin pruebas de comportamiento.
5. Migraciones idempotentes ad-hoc, sin versionado secuencial formal.
6. Documentación desactualizada en puntos concretos (H-06).
7. Informe de Salud Tributaria con defectos de presentación (H-01/H-02).
8. Catálogo de reportes con funciones marcadas como inexistentes (H-03).
9. La vista de Salud Tributaria usa una capacidad de otro módulo (`tesoreria:operar`) para deuda TGR.
10. Residuos en la raíz (`tmp-*.js`, `tmp-sii-probe*.json`, `tmp-auditoria*`, `.tmp-sid.txt`) que no afectan runtime pero ensucian el repo y pueden contener datos de prueba.

---

## 11. Qué está fuera de alcance en este handoff

- Reparar los defectos detectados (se documentan, no se corrigen).
- Migrar de tecnología o de BD.
- Ejecutar acciones tributarias reales.
- Validar datos productivos.
