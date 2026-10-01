# CURRENT_STATE — Estado actual del proyecto (base del Software Contable JMV)

> Fecha: 2026-10-01 · Commit base: `89cf4ad` (master, replicado en VPS)
> Este documento es el inventario **factual** de lo que existe hoy. Nada aquí es aspiracional.
> Los documentos ARCHITECTURE.md, DATA_MODEL.md, INTEGRATIONS.md y ROADMAP.md parten de este estado y no lo repiten.

---

## 1. Qué es hoy este proyecto

**IVA Mensual** es una aplicación web Node.js de análisis tributario multiusuario que:

1. Se autentica contra el **SII de Chile** con las credenciales (RUT + clave) de cada cliente, usando el mismo flujo HTTP que el portal RCV del SII (sin APIs oficiales, sin scraping de HTML: consume los endpoints `facadeService` JSON que usa la SPA Angular del portal).
2. Descarga el **Registro de Compras y Ventas (RCV)** por período tributario (compras y ventas, documento a documento).
3. Calcula totales IVA, margen, PPM y F29 estimado, y genera mensajes para WhatsApp y exportaciones Excel.
4. Persiste informes por rango de meses con detalle documento a documento, top contrapartes y documentos reclamados.
5. Expone un Centro Tributario (validador IVA, calculadora PPM/F29, calendario, pendientes, observaciones) y 6 herramientas (duplicados, comparador F29, interés penal art. 53, checklist de cierre, cobranza, conversor DTE XML→Excel).
6. Tiene un portafolio multi-empresa de solo lectura (KPIs agregados por cliente) y una landing pública con login embebido.

**Este proyecto es la base y la fuente de información SII del futuro Software Contable. No se reconstruye: se consume y se extiende.**

## 2. Stack y ejecución

| Componente | Tecnología | Notas |
|---|---|---|
| Runtime | Node.js ≥ 24 | `engines` en package.json |
| Backend | Express 4 + better-sqlite3 | SQLite en modo WAL, acceso sincrónico |
| Frontend | Vanilla JS (sin framework, sin build) | 10 páginas + 11 módulos compartidos en `frontend/shared/` |
| Auth propia | Sesiones en SQLite + cookie `sid` httpOnly | scrypt para passwords (`salt:hash` en hex, 64 bytes) |
| Export | exceljs + archiver | Excel y ZIP en exportación masiva |
| Tests | `node --test` | 11 tests verdes: `npm test` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | tests + `node --check` + gitleaks + chequeo de archivos sensibles |
| Deploy | Docker + nginx (docker-compose) o bare-metal; Cloudflare Tunnel documentado | `docs/DESPLIEGUE.md` |
| Repos | Git local → remote `vps` (bare en VPS, vía Tailscale) | GitHub pendiente de `gh auth login` |

**Ejecutar localmente:** `PORT=3500 node backend/index.js` (el `.env` local tiene `PORT=0`; siempre hacer override). Health: `GET /api/health`.

## 3. Mapa del código

```text
backend/
  index.js                  Express app: headers de seguridad, trust proxy, JSON 100kb,
                            landing en /, static, 5 routers /api/* + /api/health
  db.js                     Esquema SQLite + migraciones idempotentes (patrón PRAGMA table_info)
  middleware/requireAuth.js requireAuth / requireAdmin / parseCookies
  routes/
    auth.js                 login (rate-limit 5/15min por IP), logout, /me, CRUD usuarios (admin)
    clientes.js             CRUD clientes con scoping user_id, validación RUT/PPM/teléfono
    informe.js              iniciar/consultar/listar/eliminar informes (async en background)
    proceso.js              proceso masivo por período (F29 + WhatsApp)
    exportacion-masiva.js   ZIP con excels por cliente/período
    sii.js                  probar conexión, consultar RCV/resumen on-demand
  services/
    sii-session.js          Login SII (CookieJar propio, redirecciones manuales, cookies por hop),
                            token RCV (facadeService), caché de sesiones en Map (TTL 25 min)
    sii-rcv.js              getDetalleCompraExport / getDetalleVentaExport (CSV en JSON),
                            paginación, getResumen, rate-limit global entre consultas
    rcv.js                  Wrapper de proveedor (sii | simpleapi) + caché rcv_cache para
                            períodos cerrados (nunca el mes en curso)
    informe.js              Motor de informes (Map en memoria) + persistencia completa en BD
    proceso.js              Procesos masivos + mensajes WhatsApp
    calculos.js             Sumas con signo NC (tipos 60/61), categorización, margen,
                            IVA, PPM, F29, períodos
    password.js             scrypt hash/verify (timingSafeEqual)
    session.js              Sesiones server-side, TTL configurable (SESSION_DIAS, default 30)
    exportacion-masiva.js   Excel por cliente/período
frontend/
  landing.html              Landing pública (servida en /) con login embebido
  index.html                Clientes (legacy del nav), dashboard.html es el shell real
  dashboard.html            Shell: sidebar + router hash + topbar
  js/  clientes.js informe.js libro.js proceso.js dashboard.js reportes.js
       tributario.js herramientas.js portafolio.js exportacion-masiva.js
  shared/ layout.js shell-router.js shell-state.js api.js format.js table.js
          datagrid.js filters.js rango.js export.js toast.js
data/                       SQLite (no versionado)
nginx/, Dockerfile, docker-compose.yml, migrations/, scripts/, iniciar.bat
docs/                       PRD, TRD, BACKEND, APPFLOW, UI-UX, PLAN, MASTERPLAN,
                            SEGURIDAD, DESPLIEGUE, ROADMAP-FUNCIONALIDADES, REDISENO_PROPUESTA
test/                       calculos, db-schema, export-fecha, informe-listar
```

## 4. Modelo de datos actual (resumen; detalle en DATA_MODEL.md)

- `clientes` — RUT, nombre, **clave_sii en texto plano**, tasa_ppm, teléfono, exento, `user_id` (dueño). Índice único parcial `rut` entre activos.
- `users` — username, password_hash (scrypt), `is_admin` (único rol binario), activo.
- `sessions` — sid aleatorio 32 bytes, user_id, expires_at.
- `procesos` — resultado F29 por cliente/período.
- `rcv_cache` — JSON crudo por (rut, periodo, tipo), solo períodos cerrados; versionado vía tabla `meta` (`rcv_cache_version`, hoy `v4`).
- `informes` + `informe_meses` + `informe_documentos` + `informe_top_contrapartes` + `informe_reclamadas` — persistencia de informes por rango, con detalle documento a documento (escrito por `guardarInformeEnBD` en transacción delete+insert).

**No existen aún:** empresas como entidad, roles/permisos, planes de cuentas, asientos, períodos contables, centros de costo, auditoría.

## 5. Autenticación, autorización y aislamiento hoy

- Login usuario/contraseña → sesión server-side en BD → cookie `sid` (httpOnly, SameSite=Lax, secure en producción). Rate-limit de login 5 intentos/15 min **en memoria** (se pierde al reiniciar el proceso).
- Contraseñas con scrypt + salt y comparación en tiempo constante.
- **Autorización real hoy:** solo dos niveles — dueño (`clientes.user_id`) y `is_admin`. Cada consulta de clientes/informes filtra por `user_id`; `informe.js` valida propiedad al cargar.
- **Modelo conceptual actual:** "usuario = contador; clientes = empresas de ese contador". El aislamiento es por usuario, **no por empresa como entidad contable**. El Software Contable necesita el nivel intermedio "empresa" con aislamiento estricto y roles (SUPER ADMIN / CONTADOR / ADMIN EMPRESA / AUDITOR / TESORERÍA) — hoy no existe ni la tabla ni el middleware de permisos.

## 6. Integración SII hoy (lo que el software contable debe CONSUMIR, no reconstruir)

Flujo probado con captura HAR del portal real:

1. `loginSII`: GET a la página de login (cookies de balanceador) → POST form-urlencoded a `CAutInicio.cgi` con RUT/DV/referencia. Detección de clave incorrecta por contenido de la respuesta.
2. `obtenerTokenRCV`: GET a la SPA RCV → POST `facadeService/getResumen`; el cookie `TOKEN` (o `metaData.conversationId` de la respuesta) habilita las demás llamadas.
3. `consultarRCV`: `getDetalleCompraExport` / `getDetalleVentaExport` devuelven **CSV empaquetado en un array JSON de strings** (`data[0]` = encabezados `;`, `data[1..]` = filas). Se parsea, se normaliza (folio, RUT contraparte, montos, tipo doc, fechas) y se pagina según `metaData.page.totalPages`.
4. Rate-limit global entre consultas (`INTERVALO_MS` en `simpleapi.js`), reintentos por sesión expirada, sesiones cacheadas por RUT (TTL 25 min) en un Map del proceso.
5. Caché persistente `rcv_cache` solo para períodos cerrados, invalidada por versión de formato.
6. Montos "extras" del SII (IVA uso común, no recuperable, etc.) se conservan crudos en `montos` y `detalleSII` — sin mapeos adivinados.

**Interfaz correcta para el software contable:** consumir `rcv.js`/`sii-rcv.js` (`consultarRCV(rut, clave, tipo, periodo)` → documentos normalizados, y `consultarResumen`). Nunca tocar `sii-session.js` ni llamar endpoints SII desde el código contable. Detalle y contrato en INTEGRATIONS.md.

Validación con datos reales: cliente 3 (76.312.274-3), rango Ene–Sep 2026 modo detalle: 9 meses, 1.570 docs de venta + 1.256 de compra, ventas $505.371.188, compras $290.354.588, IVA $40.853.179, validador concilia a $0.

## 7. Seguridad (estado verificado)

- `.env` y `data/` nunca en el historial (verificado con `git log --all`); sin secretos en código versionado.
- Cookies httpOnly/SameSite=Lax/secure en prod; rate-limit de login; `express.json({limit:'100kb'})`; `trust proxy 1`; headers (nosniff, X-Frame-Options DENY, Referrer-Policy, COOP, Permissions-Policy, X-DNS-Prefetch-Control).
- Scrypt para passwords; sesiones revocables en BD; TTL configurable.
- CI con gitleaks y chequeo de archivos sensibles. Modelo de amenazas y deuda priorizada en `docs/SEGURIDAD.md`.

**Deuda de seguridad relevante para el software contable:** `clientes.clave_sii` en texto plano (cifrado en reposo pendiente); rate-limit en memoria; sin roles granulares; sin auditoría de acciones.

## 8. Deuda técnica y limitaciones conocidas (inventario honesto)

1. **Claves SII en texto plano** en `clientes.clave_sii`. El software contable hereda esta necesidad; diseñar bóveda cifrada por empresa (fase 1/3).
2. **Estado en memoria en el proceso**: sesiones SII (`Map`), informes en curso (`Map`) y procesos (`Map`) se pierden al reiniciar. Los informes terminados sí quedan en BD. Un job largo reiniciado a media ejecución se pierde (el front re-inicia).
3. **Rate-limit y sesiones por proceso único**: con más de un proceso/instancia se romperían (hoy hay un solo nodo; documentado para no olvidarlo al escalar).
4. **SQLite single-writer**: correcto para la escala actual (un contador, decenas de clientes); el software contable multiusuario concurrente exigirá vigilar WAL/bloqueos y eventualmente migrar a Postgres (decisión en ARCHITECTURE.md).
5. **Montos en REAL (float)**: aceptable para reportes tributarios informativos; **inaceptable para contabilidad**. El núcleo contable usará INTEGER en pesos. Decisión y migración en DATA_MODEL.md.
6. **Sin framework de migraciones con versionado secuencial** — hay migraciones idempotentes ad-hoc en `db.js` (patrón que funciona y se replicará) + una carpeta `migrations/` con un SQL suelto.
7. **Frontend sin build ni tests**: vanilla JS módulo a módulo con `window.*` como contratos. Funciona y es rápido; para el módulo contable se mantendrá el mismo shell, con lógica pesada (partida doble, saldos) testeada en el backend.
8. **`informe_documentos` crece sin límite por informe** (delete+insert completo en cada regeneración); para la bandeja contable se requiere entidad documento persistente por empresa (no ligada a informes).
9. **Node 25 rompe `node --test test/` en modo directorio** (preexistente); `npm test` con archivos explícitos funciona.
10. **`/index.html` (Clientes) y `dashboard.html` coexisten** con nav legacy; el shell real es dashboard.html.

## 9. Qué funciona y está verificado (no asumir, comprobado en vivo)

- Login y sesión; CRUD de clientes con validaciones; sincronización SII modo detalle; informe por rango con persistencia y rehidratación (incluye corrección del bug de `informe_documentos`); validador IVA conciliando a $0 con datos reales; calculadora PPM/F29; pendientes y observaciones; portafolio multi-empresa; las 6 herramientas; exportación Excel; landing pública con login.
- Tests `npm test` en verde (11). CI en verde en cada push.

## 10. Conclusión del estado actual

La base es sólida para lo que fue diseñada: **obtener y analizar información tributaria del SII por cliente**. Lo que le falta para ser software contable no es calidad sino **dominio**: empresas como entidad con aislamiento estricto, roles, plan de cuentas, asientos con partida doble, motor de reglas, bandeja de documentos con ciclo de vida, períodos y cierres, y reportes financieros. La integración SII existente se conserva tal cual; Geo Daniela no se toca (solo se reserva el contrato de entrada de asientos, ver INTEGRATIONS.md).

El siguiente documento, [ARCHITECTURE.md](ARCHITECTURE.md), define cómo evolucionar de este estado al software contable sin reconstruir nada de lo que funciona.
