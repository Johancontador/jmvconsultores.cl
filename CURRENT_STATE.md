# CURRENT_STATE — Estado actual del proyecto (base del Software Contable JMV)

> Fecha: 2026-10-05 · Commit base: `7d7a565` (master) · Suite: 301 verdes
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
| Tests | `node --test` | 29 archivos, 301 tests verdes: `npm test` |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | tests + `node --check` + gitleaks + chequeo de archivos sensibles |
| Deploy | Docker + nginx (docker-compose) o bare-metal; Cloudflare Tunnel documentado | `docs/DESPLIEGUE.md` |
| Repos | Git local → remote `vps` (bare en VPS, vía Tailscale) | GitHub pendiente de `gh auth login` |

**Ejecutar localmente:** `PORT=3500 node backend/index.js` (el `.env` local tiene `PORT=0`; siempre hacer override). Health: `GET /api/health`.

## 3. Mapa del código

```text
backend/
  index.js                  Express app: headers de seguridad, trust proxy, JSON 100kb,
                            landing en /, static, routers /api/* + /api/health
  db.js                     Esquema SQLite + migraciones idempotentes (patrón PRAGMA table_info);
                            FASES 1-6 + SAAS-1 + dashboard se aplican desde core/migraciones.js
  middleware/requireAuth.js requireAuth / requireAdmin / parseCookies
  middleware/requirePermiso.js RBAC por capacidades + gate de licencia en escrituras (402)
  core/                     Dominio contable puro (BD por parámetro, testeable): migraciones,
                            empresas, permisos, periodos, auditoría, bóveda, licencias,
                            plan-cuentas-plantilla, cuentas, asientos, documentos, ingesta,
                            reglas + semillas, contrapartes, propuestas, conciliación,
                            automatización, onboarding, reportes, dashboard, tesorería,
                            tesoreria-cartola-formatos, activos, niif, asientos-externos,
                            dte-emisor (BLOQUE 2: emisión de DTEs por empresa cliente),
                            dte-contable (BLOQUE 3: DTE ACEPTADO → bandeja → propuesta → asiento),
                            empresas-sii (alta de empresa desde el SII con solo RUT + clave:
                            login por fetch, extrae la ficha oficial DatosCntrNow del home
                            misiir y alimenta onboarding.confirmarFicha; régimen desde
                            atributos 14TT/14GG, nada inventado; ficha cruda en
                            data/sii-fichas/<rut>.json; fallback a login básico si la cuenta
                            no habilita token RCV; detecta redirección a login = clave
                            rechazada con la variante «no es correcta» que loginSII no pesca),
                            analitica (motor de analítica tributaria: DV M11, alertas de
                            duplicados y RUT inválidos del RCV, KPIs anuales, top contrapartes)
  routes/
    auth.js                 login (rate-limit 5/15min por IP), logout, /me, CRUD usuarios (admin),
                            registro self-service con validación SII en vivo (SAAS-1)
    contable.js             empresas CRUD (incluye POST /empresas/desde-sii: alta con solo
                            RUT + clave SII, ver core/empresas-sii.js), usuarios/roles,
                            períodos, auditoría, plan de cuentas, centros de costo, reglas
    documentos.js           bandeja + ingesta RCV + reglas (FASE 3)
    propuestas.js           propuestas + conciliación SII↔contable (FASE 4)
    reportes.js             balance, situación, resultados, cierre de período (FASE 5),
                            analítica tributaria anual (GET /empresas/:id/analitica)
    automatizacion.js       pipeline de contabilización automática del período
    onboarding.js           ficha tributaria SII + ingesta del histórico (SAAS-2)
    tesoreria.js            bancos, pagos/cobros/transferencias, cartola, conciliación (FASE 6)
    activos.js              activos fijos, depreciación mensual, venta/baja (FASE 7)
    niif.js                 mapeo cuentas→rubros NIIF + estados por rubros (FASE 8)
    asientos-externos.js    receptor de centralizaciones externas — Geo Daniela (FASE 9.1)
    dte.js                  emisión de DTE para empresas cliente: config del emisor (certificado/CAF
                            cifrados), folios, emitir 33/34/56/61, estado SII real, reintentos (BLOQUE 2)
    tesoreria-cartola-formatos.js   conectores de cartolas por formato CSV/XLSX (FASE 9.2)
    clientes.js             CRUD clientes con scoping user_id, validación RUT/PPM/teléfono (legacy)
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
  sistema/                  SPA contable (shell real): router hash + vistas por módulo
    index.html              app.js, views-fiscal/autom/teso/activos/onboarding/dte/conta,
                            views-analitica, tema.js, shared/uitoolkit.js
    app.js                  boot, login, shell (secciones verticales ordenadas por flujo de
                            trabajo: SII / Facturación / Contabilizaciones / Tesorería /
                            Reportes / Empresa — Bandeja de Documentos primero,
                            Administración al final, pill de documentos), router (query de
                            vista soportada en el hash: #dte?tipo=33), selector de empresa,
                            sys-header con breadcrumb y toggle de tema claro/oscuro, buscador
                            del menú lateral
    views-dte.js            Facturación Electrónica (BLOQUE 4): bandeja de DTEs emitidos con
                            filtros/estado SII/vínculo contable y sincronización DTE→contabilidad,
                            matriz de requisitos del emisor, configuración (certificado/CAFs) y
                            emisión 33/34/56/61 con totales en vivo e idempotencia por envío
    views-teso.js           Tesorería: bancos, libro banco, conciliación (FASE 6)
    views-activos.js        Activos fijos, venta/baja, depreciación del período (FASE 7)
    views-niif.js           NIIF: situación/resultados por rubros + mapeo (FASE 8)
    views-fiscal.js         Libros C/V, documentos, bandeja (UITabla: buscar sin acentos,
                            ordenar por valor crudo, paginar, exportar CSV/XLS, copiar,
                            imprimir, totales de lo filtrado en tfoot)
    views-analitica.js      Dashboard Tributario: KPIs anuales con variación vs año
                            anterior, barras 12 meses, top 20 clientes/proveedores,
                            alertas de duplicados y RUT inválidos
    views-autom.js          Automatización + propuestas/conciliación
    views-onboarding.js     Onboarding autónomo (SAAS-2)
    views-conta.js          Asientos, diario, mayor, memoria, balance 8 columnas,
                            clasificado, situación, resultados, cuentas corrientes, admin
  index.html                Clientes (legacy del nav), dashboard.html es el shell del legado
  dashboard.html            Shell del sistema tributario legado
  js/  clientes.js informe.js libro.js proceso.js dashboard.js reportes.js
       tributario.js herramientas.js portafolio.js exportacion-masiva.js
  shared/ layout.js shell-router.js shell-state.js api.js format.js table.js
          datagrid.js filters.js rango.js export.js toast.js uitoolkit.js
data/                       SQLite (no versionado)
nginx/, Dockerfile, docker-compose.yml, scripts/, iniciar.bat
docs/                       PRD, TRD, BACKEND, APPFLOW, UI-UX, PLAN, MASTERPLAN,
                            SEGURIDAD, DESPLIEGUE, ROADMAP-FUNCIONALIDADES, REDISENO_PROPUESTA
test/                       29 suites: calculos, db-schema, export-fecha, informe-listar,
                            fase1-fase9, saas1-saas3, automatizacion, dashboard, backup-seguro,
                            boveda-clientes, dte-emision, dte-contable, empresas-sii, hardening,
                            memoria-limpieza, memoria-reportes, password, cartola-formatos,
                            analitica
```

## 4. Modelo de datos actual (resumen; detalle en DATA_MODEL.md)

- `clientes` — RUT, nombre, **clave_sii en texto plano**, tasa_ppm, teléfono, exento, `user_id` (dueño). Índice único parcial `rut` entre activos.
- `users` — username, password_hash (scrypt), `is_admin` (único rol binario), activo.
- `sessions` — sid aleatorio 32 bytes, user_id, expires_at.
- `procesos` — resultado F29 por cliente/período.
- `rcv_cache` — JSON crudo por (rut, periodo, tipo), solo períodos cerrados; versionado vía tabla `meta` (`rcv_cache_version`, hoy `v4`).
- `informes` + `informe_meses` + `informe_documentos` + `informe_top_contrapartes` + `informe_reclamadas` — persistencia de informes por rango, con detalle documento a documento (escrito por `guardarInformeEnBD` en transacción delete+insert).

**Capa contable (FASES 1-6, detalle en DATA_MODEL.md):**
- `empresas`, `roles`, `usuario_empresa`, `periodos_contables` (+ `cierre_json`), `auditoria`, `suscripciones` (licencias).
- `cuentas` (plantilla PUC con alias de control), `centros_costo`, `asientos` (+ `origen`), `asiento_lineas` — núcleo de partida doble, INTEGER en pesos.
- `documentos` (bandeja con dedupe `clave_dedupe`), `reglas_contables`, `contrapartes` — ingesta SII y clasificación.
- `propuestas` (snapshot congelado de líneas), `conciliaciones` — automatización y conciliación SII↔contable.
- `bancos_cuentas`, `teso_movimientos` (monto FIRMADO, UNIQUE banco+asiento), `teso_cartola` (dedupe idempotente; `movimiento_id` = match de conciliación) — tesorería de FASE 6: cada movimiento bancario queda respaldado por un asiento del núcleo (`asiento_id`) y el saldo inicial del banco se contabiliza como asiento de apertura.
- `empresas.config_json` — memoria de contabilización: `modo_conciliacion` ('simple' | 'completa') + cuentas regulares de gastos/ingresos donde se netean compras/ventas en modo simple; la memoria RUT → cuenta vive en `contrapartes` (precedencia: regla > memoria RUT > cuenta regular > alias).

**Integraciones (FASE 9.1):** `asientos.idempotencia` (UNIQUE parcial) + `asientos_externos` (UNIQUE empresa+idempotencia) — receptor de centralizaciones externas (Geo Daniela, INTEGRATIONS §4): la empresa se resuelve por RUT dentro de las empresas del usuario autenticado, rechazo completo 422 si Σd≠Σh/período cerrado/códigos inválidos, re-envío deduplicado (clave explícita o SHA-256 del payload).
- `activos_fijos` (código UNIQUE, cuenta clase 1, vida útil, residual, estado ACTIVO|VENDIDO|BAJA, asiento de alta/baja) + `activos_depreciaciones` (UNIQUE activo+período con `asiento_id`) — FASE 7: depreciación por línea recta respaldada asiento por asiento; la venta/baja limpia costo + depreciación acumulada contra utilidad/pérdida por alias.

**Presentación NIIF (FASE 8):** `cuentas.rubro_niif` (defaults de la PLANTILLA PUC; backfill por código para empresas preexistentes) — mapeo editable y auditado; los estados por rubros derivan del mayor con `SIN_CLASIFICAR` visible y never-guess (ecuación A = P + PN verificada; PYE se presenta neto).

**No existe aún:** NIIF avanzado tipo consolidación/moneda extranjera (la presentación por rubros de la FASE 8 cubre el estándar) ni integraciones bancarias automáticas (la cartola se importa a mano — report-only; conector por formato planificado en ROADMAP → FASE 9.2). El receptor Geo Daniela (9.1) ya existe.

## 5. Autenticación, autorización y aislamiento hoy

- Login usuario/contraseña → sesión server-side en BD → cookie `sid` (httpOnly, SameSite=Lax, secure en producción). Rate-limit de login 5 intentos/15 min **en memoria** (se pierde al reiniciar el proceso).
- Contraseñas con scrypt + salt y comparación en tiempo constante.
- **Autorización real hoy:** solo dos niveles — dueño (`clientes.user_id`) y `is_admin`. Cada consulta de clientes/informes filtra por `user_id`; `informe.js` valida propiedad al cargar.
- **Modelo conceptual actual:** "usuario = contador; clientes = empresas de ese contador" en la capa legacy. El Software Contable ya tiene el nivel intermedio "empresa" con aislamiento estricto y 5 roles (SUPER ADMIN / CONTADOR / ADMIN EMPRESA / AUDITOR / TESORERÍA) gestionados en `usuario_empresa` + `middleware/requirePermiso.js` (capacidades nombradas, gate de licencia en escrituras): **FASE 6 añadió las capacidades `tesoreria:ver` (contador, auditor, tesorería, super_admin), `tesoreria:operar` y `bancos:conciliar` (contador, tesorería, super_admin); admin_empresa no accede al módulo** — verificado por test.

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

**Deuda de seguridad relevante para el software contable:** `clientes.clave_sii` en texto plano en la capa LEGACY (las empresas del sistema contable SÍ están cifradas en bóveda AES-256-GCM desde FASE 1); rate-limit en memoria; sin roles granulares en la capa legacy; sin auditoría de acciones.

## 8. Deuda técnica y limitaciones conocidas (inventario honesto)

1. **Claves SII en texto plano** en `clientes.clave_sii`. El software contable hereda esta necesidad; diseñar bóveda cifrada por empresa (fase 1/3).
2. **Estado en memoria en el proceso**: sesiones SII (`Map`), informes en curso (`Map`) y procesos (`Map`) se pierden al reiniciar. Los informes terminados sí quedan en BD. Un job largo reiniciado a media ejecución se pierde (el front re-inicia).
3. **Rate-limit y sesiones por proceso único**: con más de un proceso/instancia se romperían (hoy hay un solo nodo; documentado para no olvidarlo al escalar).
4. **SQLite single-writer**: correcto para la escala actual (un contador, decenas de clientes); el software contable multiusuario concurrente exigirá vigilar WAL/bloqueos y eventualmente migrar a Postgres (decisión en ARCHITECTURE.md).
5. **Montos en REAL (float)** en la capa tributaria LEGACY: aceptable para reportes informativos; la capa contable (FASES 2-6) ya opera en INTEGER con partida doble.
6. **Sin framework de migraciones con versionado secuencial** — hay migraciones idempotentes ad-hoc en `db.js` + `core/migraciones.js` (patrón PRAGMA table_info que funciona y se replicará; la carpeta `migrations/` con SQL suelto fue eliminada — el esquema vive íntegro en el core).
7. **Frontend sin build ni tests**: vanilla JS módulo a módulo con `window.*` como contratos. Funciona y es rápido; el módulo contable mantiene el mismo shell (`/sistema/`), con lógica pesada (partida doble, saldos, conciliación) testeada en el backend.
8. **`informe_documentos` crece sin límite por informe** (delete+insert completo en cada regeneración). RESUELTO para el contable: la bandeja `documentos` es una entidad persistente por empresa, independiente de informes (FASE 3).
9. **Node 25 rompe `node --test test/` en modo directorio** (preexistente); `npm test` con archivos explícitos funciona.
10. **`/index.html` (Clientes), `dashboard.html` (legado) y `/sistema/` (contable) coexisten**; el shell contable real es `/sistema/`.
11. **Tesorería sin integración bancaria automática**: la cartola entra por pegado CSV o por archivo del portal del banco con conector por formato (FASE 9.2 — detección genérica + formatos guardados; formatos concretos por banco por afinar con muestras reales) y la conciliación es report-only — sin agregador bancario (9.3 queda bajo decisión del dueño).
12. **Conciliación bancaria empareja 1↔1**: un pago que cubre varias facturas queda sin match individual; se reporta en `no_conciliado_libro` para ajuste manual. Mejora 1↔n post-MVP.

## 9. Qué funciona y está verificado (no asumir, comprobado en vivo)

- Login y sesión; CRUD de clientes con validaciones; sincronización SII modo detalle; informe por rango con persistencia y rehidratación (incluye corrección del bug de `informe_documentos`); validador IVA conciliando a $0 con datos reales; calculadora PPM/F29; pendientes y observaciones; portafolio multi-empresa; las 6 herramientas; exportación Excel; landing pública con login.

- **Software contable (FASES 1-6 + SAAS, suite 146 verdes):** empresas con RBAC de 5 roles y períodos auditados; núcleo de partida doble (Σd=ΣH, folios, reversiones); bandeja SII con dedupe idempotente y motor de reglas; propuestas con confirmación humana y conciliación SII↔contable report-only; reportes financieros derivados del mayor (balance ΣD=ΣC, situación con A = P + Patrimonio verificada) y cierre de período con snapshot; pipeline de contabilización automática; licencias con gate en escrituras; onboarding autónomo desde el SII; dashboard operativo del Inicio.

- **Tesorería (FASE 6, 15 tests):** alta de banco con saldo inicial contabilizado como apertura; pagos/cobros/transferencias que nacen con su asiento del núcleo (UNIQUE banco+asiento); libro banco con saldo corrido y folio visible; importación de cartola idempotente (re-importar no duplica); conciliación report-only que empareja ±3 días, persiste matches y reporta lo no conciliado de ambos lados, cuadrando cuando la cartola refleja todo el libro; aislamiento estricto por empresa; RBAC (contador/tesorería operan, auditor lee, admin_empresa no accede); la situación financiera incluye el saldo bancario y sigue cuadrando (A = P + P) con tesorería operando.

- **Activos fijos (FASE 7, 14 tests):** registro con alta contable opcional (apertura activo↔contraparte); depreciación mensual por línea recta propuesta→confirmada (UN asiento por período, cuota final con depreciable exacto, UNIQUE activo+período, re-confirmar lanza); venta/baja con utilidad/pérdida por alias y aviso de cuota pendiente; períodos cerrados rechazados; la situación financiera sigue cuadrando (A = P + P) con depreciación y ventas operando. Además, los tests destaparon y corrigieron un bug del balance de 8 columnas (columnas deudor/acreedor por signo del neto, no por naturaleza).

- **Cartolas por archivo (FASE 9.2, 12 tests):** conector por formato CSV/XLSX (exceljs de lectura, montos chilenos con miles/decimales/paréntesis, fechas ISO/DD-MM/serial con rechazo de inexistentes), detección por encabezado o estructura estadística (con y sin fila de encabezado), formato no reconocido → mapeo manual guardado por nombre (auditado, upsert), importación a la misma `teso_cartola` con dedupe idempotente y conciliación de FASE 6 intacta. La validación con cartolas reales de los bancos del dueño queda como criterio operativo (ROADMAP → 9.2).

- **Receptor de asientos externos (FASE 9.1, 10 tests):** contrato INTEGRATIONS §4 implementado — centralización cuadrada → asiento tipo 'externo' con folio correlativo, origen y auditoría; idempotencia por clave explícita o hash del payload (re-envío no duplica); rechazo COMPLETO con lista exacta de códigos inválidos; período cerrado y acceso restringido a las empresas del usuario; auxiliar validar-codigos sin crear cuentas; vista 🔌 Receptor Externo con el contrato visible para el integrador.

- **NIIF (FASE 8, 7 tests):** mapeo cuentas→rubros con defaults de plantilla (backfill idempotente por código), edición masiva auditada (solo cambios reales), situación financiera por rubros con PYE neto y ecuación A = P + PN verificada, resultados por naturaleza mes/acumulado, SIN_CLASIFICAR reportado sin romper el cuadre y aislamiento estricto por empresa.

- **Memoria de contabilización + modo simple + reportes nuevos (8 tests):** config de empresa (`modo_conciliacion` simple/completa + cuentas regulares validadas, auditada); precedencia de contraparte regla > memoria RUT > cuenta regular > alias, con aprendizaje automático al confirmar propuestas (el RUT queda vinculado para el mes siguiente) y vista "contrapartes nuevas por ubicar"; balance de 8 columnas (hoja de trabajo con cuadres ΣD=ΣC, saldos y Pérdida/Utilidad); balance clasificado (corriente/no corriente por código del plan, capital de trabajo, A = P + P); cuenta corriente de clientes/proveedores con pagos/cobros aplicados y saldo corrido; mayor con filtro por RUT de contraparte (documento contabilizado o pago de tesorería). Shell `/sistema/` rediseñado a menú superior horizontal con secciones (Empresa / SII / Contabilizaciones / Tesorería / Reportes).

- **Pagos y facturación de la suscripción (SAAS-3, 17 tests):** checkout con adaptador de pasarela inyectable (MercadoPago primero, Transbank/Webpay después), webhook PÚBLICO idempotente en dos espacios (evento y pago) que re-confirma SIEMPRE contra la API de la pasarela y activa/renueva la licencia vía `activarPlan` en una transacción auditada; el gate de licencia NO aplica a pagar (una empresa SUSPENDIDA puede reactivarse sola); factura electrónica (DTE 33) con desglose IVA citado, receptor validado nominando lo que falta y adaptador real `core/dte.js` sobre @devlas/dte-sii (pendiente credenciales CAF/certificado para producción); vista 💳 Suscripción y Pagos en /sistema/.

- **Emisión de DTE para empresas cliente (BLOQUE 2, 29 tests):** `/api/dte` con RBAC `dte:ver/dte:emitir/dte:configurar` + gate de licencia; config del emisor por empresa (giro/dirección/comuna/ACTECO/resolución/ambiente) con certificado .pfx y contraseña CIFRADOS (bóveda v1); CAFs por tipo con XML cifrado (contiene la clave privada de folios), parseo/validación de RUT y rango al cargar, idempotentes por rango; emisión de Factura (33), Factura Exenta (34), Nota de Débito (56) y Nota de Crédito (61, referencia obligatoria con CodRef 1/2/3 del XSD); folio correlativo por empresa+tipo validado contra los CAFs (hueco entre rangos → 422 nombrándolo); estados SII VERBATIM (`sii_codigo`/`sii_respuesta_json` — EPR, RPR, DOK… según tabla oficial QueryEstUp de la librería; el `estado` local es solo el pipeline PENDIENTE→ENVIADO→ACEPTADO/RECHAZADO); errores y reintentos con el mismo folio; cada DTE ligado a empresa+documento de la bandeja (opcional)+folio+estado SII; adaptador inyectable (tests sin red) y real lazy; test offline del XML real con PKCS12+CAF generados que corrigió un bug latente del camelCase en `core/dte.js` (la suscripción habría emitido con emisor vacío/receptor 'Consumidor Final'); UI operable desde el BLOQUE 4 (ver abajo); pendiente credenciales reales para producción.

- **DTE → Contabilidad (BLOQUE 3, 12 tests — tras auditoría 2A):** `sincronizar-contabilidad` lleva cada DTE ACEPTADO a la bandeja como documento `origen='dte'` con la MISMA `clave_dedupe` de la ingesta RCV (UNA sola representación: re-ingestar el RCV del período lo dedupea; si el RCV llegó primero, se apunta a él), auto-clasifica con las reglas del contador y genera PROPUESTA PENDIENTE — la confirmación humana sigue siendo la única puerta al asiento (§6); sin regla → documento PENDIENTE visible (nada inventado); segunda pasada vincula `dte_emitidos.asiento_id` (vínculo bidireccional DTE↔asiento). Devengo por `fecha_emision`. Flujo probado 33 (Debe CLIENTES / Haber VENTAS_SERVICIOS + IVA_DEBITO), 34 sin IVA y 61 invertido. Idempotencia de emisión: `idempotencia` opcional en `POST /emitir` (UNIQUE parcial empresa+clave → `deduplicado: true`). La conciliación FASE 4 ve los DTE automáticamente vía bandeja (sin tocarla).

- **Alta de empresa desde el SII (solo RUT + clave SII):** el modal de nueva empresa de Administración pide únicamente RUT y clave SII; `POST /api/contable/empresas/desde-sii` hace login por fetch (`loginSII`), extrae la ficha oficial del contribuyente (JSON `DatosCntrNow` embebido en el HTML del home misiir) y alimenta la ficha completa vía `onboarding.confirmarFicha` — razón social, tipo/subtipo contribuyente, constitución, inicio de actividades, régimen tributario desde atributos 14TT/14GG (null si no están: nada inventado), email, teléfono, domicilio y actividades (glosas). Valida que el RUT de la ficha coincida con el pedido, guarda la ficha cruda en `data/sii-fichas/<rut>.json` y la clave SII queda cifrada en bóveda. 10 tests del parser/mapeo; suite 289/289.

- **Portafolio cargado en producción (2026-10-05):** 22 empresas activas (ids 1-22) — 19 creadas en lote vía el flujo «desde SII» con sus fichas crudas en `data/sii-fichas/`. 2 RUTs de la lista original (77604189-0 y 78107917-0) quedaron fuera: el SII rechaza sus claves («La Clave Tributaria ingresada no es correcta») — pendiente que el dueño entregue las claves correctas y se reintente (el flujo es idempotente).

- **Arquitectura UI profesional (FASES 1-4, commit `7d7a565`):** tema claro/oscuro/sistema persistente con toggle en el header (`tema.js` + tokens en app.css); sys-header con breadcrumb por sección; buscador del menú lateral con filtrado en vivo; **UITabla** en `shared/uitoolkit.js` (buscador sin acentos con resaltado `<mark>`, orden por columna usando el valor crudo — los montos formateados ordenan numérico, bug corregido y verificado en vivo —, paginación, exportación CSV/XLS con BOM, copiar, imprimir, tfoot con totales de lo filtrado) y **UIForms** (validación requerido/rut/email/min con mensajes inline). Libros C/V y Bandeja de Documentos reescritas sobre UITabla (fin del scraping de DOM); **Dashboard Tributario** (#analitica) con KPIs anuales + variación, barras 12 meses, top 20 clientes/proveedores y alertas de duplicados/RUT inválidos (`core/analitica.js`, 12 tests); modal de nueva empresa valida con UIForms antes de llamar al SII. Verificado en vivo con navegador headless (shell, dashboard, tema, buscador, libros, documentos con paginación, modal sin crear nada): consola sin errores, 22 empresas intactas.

- Tests `npm test` en verde (301). CI en verde en cada push.

- **UI de Facturación Electrónica (BLOQUE 4, frontend) + design audit:** las tres vistas en `/sistema/` (`views-dte.js`): bandeja de DTEs emitidos (KPIs por estado, filtros tipo/estado con query en el hash, acciones por fila: consultar estado SII verbatim y reintentar con el mismo folio, botón de sincronización DTE→contabilidad con resumen de ambas pasadas), configuración del emisor (ficha con certificado .pfx subido desde archivo y contraseña — cifrados en el servidor, jamás releídos —, tabla de CAFs con folios usados y carga por pegado del XML, idempotente) y emisión 33/34/56/61 (receptor completo, referencia condicional para notas con CodRef 1/2/3, ítems dinámicos con totales en vivo idénticos a `calcularMontos`, clave de idempotencia generada al abrir el formulario). Design audit documentado en [docs/DESIGN-AUDIT-DTE.md](docs/DESIGN-AUDIT-DTE.md): 5 hallazgos corregidos (bug del router con query en el hash compartido por todas las vistas, matriz de faltantes en vez del muro repetido ×4, jerarquía de acciones, montos en mono tabular, base tipográfica de la app a 16px) — Design Score B → A, suite 279/279.

## 10. Conclusión del estado actual

La base heredada es sólida para lo que fue diseñada: **obtener y analizar información tributaria del SII por cliente**. Sobre ella, el **software contable ya existe y está en producción del MVP**: empresas con dominio estricto, roles, plan de cuentas, partida doble, motor de reglas, bandeja con ciclo de vida, propuestas, conciliación, reportes, cierres, automatización, licencias, onboarding, **tesorería (FASE 6)** con libro banco respaldado asiento por asiento, **activos fijos (FASE 7)** con depreciación mensual propuesta→confirmada y venta/baja en un asiento, y **presentación NIIF (FASE 8)** por rubros con mapeo editable y SIN_CLASIFICAR nunca oculto. La integración SII existente se conserva tal cual; Geo Daniela no se toca (solo se reserva el contrato de entrada de asientos, ver INTEGRATIONS.md).

El siguiente documento, [ARCHITECTURE.md](ARCHITECTURE.md), define cómo evolucionar de este estado al software contable sin reconstruir nada de lo que funciona. El **manual de funcionalidades y procedimientos** (paso a paso, por rol y módulo, con troubleshooting) vive en [docs/MANUAL.md](docs/MANUAL.md) — mantenerlo al día con cada fase nueva.
