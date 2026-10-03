# 💼 IVA Mensual

**El copiloto tributario del contador chileno.** Conexión directa al SII, portafolio
multi-empresa, Centro Tributario con herramientas de control, y 28+ reportes
exportables — todo self-hosted, sin costos de infraestructura.

![Stack](https://img.shields.io/badge/stack-Node_24_·_Express_·_SQLite-informational)
![Tests](https://img.shields.io/badge/tests-node:--test-success)
![Seguridad](https://img.shields.io/badge/auth-sesiones_httpOnly_·_rate--limit-success)

---

## Qué hace

| Área | Capacidades |
|---|---|
| **🏠 Portafolio** | Landing tipo *Dashboard del Contador*: KPIs agregados de todas las empresas, vencimientos F29 con cuenta regresiva, estado de sincronización y accesos rápidos — cero consultas al SII al abrir. |
| **📊 Dashboard BI** | Ventas vs compras, evolución de IVA, compras por proveedor (donut), KPIs con variación mes a mes. |
| **🧾 Reportes (18+)** | IVA mensual/anual/por cliente, comparativos, tendencias, variaciones, rankings, resumen tributario, Libro Compra/Venta por rango, desgloses de gestión — todos con filtros y exportación CSV/Excel/PDF. |
| **🛡️ Centro Tributario** | Validador de IVA (concilia documentos vs informe a $0), calculadora PPM/F29, calendario tributario, detector de pendientes y duplicadas, comparador F29 histórico, interés penal art. 53, checklist de cierre persistente, panel de observaciones. |
| **🧰 Herramientas** | Generador de cobranza por WhatsApp (3 tonos), conversor XML DTE → Excel 100% client-side. |
| **📚 Contabilidad** | Multiempresa con RBAC (5 roles), plan de cuentas PUC chileno, asientos con partida doble atómica, bandeja de documentos SII con motor de reglas, propuestas de asiento automáticas (compras/ventas/NC) con confirmación individual o en lote, conciliación SII ↔ contable con diferencias tipificadas, reportes financieros 100% derivados de asientos (balance con ΣD=ΣC, situación financiera con A = P + Patrimonio verificada, estado de resultados) y **cierre de período**: checklist, asientos de cierre por alias (IVA→F29, PPM devengado, resultado→patrimonio), confirmación humana, snapshot persistido y período bloqueado para mutaciones. **🧠 Memoria**: el sistema recuerda a qué cuenta se contabilizó cada proveedor/cliente y la aplica sola el mes siguiente (modo simple: compras y ventas se netean contra la cuenta regular sin conciliación). **📈 Reportes**: balance de 8 columnas (hoja de trabajo con cuadres), balance clasificado (corriente/no corriente), situación financiera, resultados y cuenta corriente de clientes/proveedores con pagos aplicados. **💰 Tesorería**: cuentas bancarias con saldo inicial contabilizado (asiento de apertura), pagos/cobros/transferencias que nacen con su asiento en partida doble (nada fuera de los libros), libro banco con saldo corrido y folio de asiento visible, importación de cartola idempotente y conciliación bancaria report-only (empareja ±3 días, reporta lo no conciliado de ambos lados — jamás corrige en silencio). **🏢 Activos fijos**: registro con alta contable opcional, depreciación mensual por línea recta (propuesta visible → confirmación en un clic, un asiento por período, jamás dos veces el mismo mes) y venta/baja con utilidad/pérdida en un asiento. **🌐 NIIF**: Estados de Situación Financiera y de Resultados por rubros de presentación (mapeo cuentas→rubros editable y auditado, PYE neto, lo sin mapear se reporta visible — jamás adivinado). **🔌 Integraciones**: receptor de asientos externos para sistemas de remuneraciones (Geo Daniela) — centralización cuadrada → asiento auditado con partida doble del núcleo, idempotencia de re-envío y rechazo completo si no cuadra; cero lógica de remuneraciones de este lado. Cartolas bancarias por archivo (Excel/CSV del portal del banco): detección de formato por encabezado o estructura, mapeo manual guardable por banco, dedupe idempotente. |
| **👥 Multiusuario** | Cada usuario administra sus propias empresas; roles admin; sesiones httpOnly con expiración. |
| **💳 SaaS** | Registro self-service desde jmvconsultores.cl: RUT + clave SII validados en vivo contra el SII, empresa armada sola (plan de cuentas, rol, prueba de 90 días). Licencias por empresa (PYME/PRO/DESPACHO) con gracia y suspensión auditadas; la lectura nunca se bloquea. |
| **📦 Reporte Masivo** | Informe de todos los clientes de un período en un solo ZIP (Excel por empresa). |

## Arquitectura (30 segundos)

```
Navegador ── HTTPS ── nginx (TLS, proxy) ── Express (Node 24)
                                          ├─ /api/auth      login, sesiones, usuarios
                                          ├─ /api/clientes  CRUD de empresas
                                          ├─ /api/informe   sincroniza SII + persiste
                                          ├─ /api/proceso   proceso masivo mensual + WhatsApp
                                          ├─ /api/sii       libro directo / probar conexión
                                          └─ /api/contable  empresas, RBAC, períodos, plan,
                                                            asientos, bandeja, reglas,
                                                            propuestas, conciliación,
                                                            reportes, cierre de período,
                                                            tesorería (bancos, libro banco,
                                                            cartola, conciliación)
SQLite (WAL) ← mejor-sqlite3: clientes, informes, meses, documentos, caché RCV,
                empresas/cuentas/asientos/documentos_contables/reglas/propuestas/
                conciliaciones/auditoría/bancos_cuentas/teso_movimientos/teso_cartola
```

- **Scraper SII propio** (`sii-session.js` + `sii-rcv.js`): login con clave tributaria,
  cookies capturadas salto a salto, export CSV parseado a documentos normalizados.
  Alternativa por `RCV_PROVIDER=simpleapi` si se prefiere un tercero.
- **Caché inteligente**: los períodos cerrados se guardan en SQLite con versión de
  esquema (`rcv_cache`); re-sincronizar es casi instantáneo. El mes en curso siempre
  se consulta en vivo.
- **Sin build**: frontend en vanilla JS con módulos compartidos (`shared/*.js`) y un
  design system propio en `app.css`. Chart.js / SheetJS / jsPDF por CDN con SRI.

## Arranque rápido

```bash
cp .env.example .env        # completa BASIC_AUTH_USER/PASS
npm install
npm start                   # http://localhost:3500
```

Docker (incluye nginx con TLS autofirmado):

```bash
docker compose up -d        # app en 127.0.0.1:3500, nginx en 8443/8080
```

Variables clave: ver `.env.example` comentado (`SESSION_DIAS`, `RCV_PROVIDER`, etc.).

## Pruebas

```bash
npm test                    # 197 tests: cálculos, esquema, export, informes, fases contables 1-9, SaaS, dashboard, memoria, cartolas
```

La suite incluye los módulos contables: fundación (fase1), núcleo de partida
doble (fase2), bandeja de documentos con motor de reglas (fase3), automatización —
propuestas, contabilización y conciliación SII ↔ contable (fase4) —, reportes
financieros con cierre de período (fase5), tesorería — bancos, libro banco, cartola
y conciliación bancaria report-only (fase6) —, activos fijos con depreciación
mensual propuesta→confirmada y venta/baja (fase7), presentación NIIF por rubros
con mapeo editable y SIN_CLASIFICAR nunca oculto (fase8), receptor de centralizaciones
externas de remuneraciones — Geo Daniela — con idempotencia (fase9.1), cartolas
bancarias por archivo con conector por formato y mapeo manual guardable (fase9.2) —
y el acomplamiento comercial SaaS:
registro self-service con validación SII en vivo, licencias por empresa y prueba
de 90 días (saas1) — y la memoria de contabilización con modo simple y reportes
nuevos (memoria-reportes): el sistema recuerda a qué cuenta se contabilizó cada
proveedor/cliente y la aplica sola el mes siguiente. CI ejecuta lo mismo en cada
push (`.github/workflows/ci.yml`).

## Seguridad (resumen)

- Credenciales y BD **fuera de git** por diseño (`.gitignore`); el historial está limpio.
- Login con rate-limit por IP (5 intentos / 15 min), contraseñas hasheadas.
- Sesiones: token de 32 bytes aleatorios, cookie `httpOnly` + `SameSite=Lax` +
  `secure` en producción, TTL configurable (`SESSION_DIAS`).
- Headers: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`.
- Límite de body JSON (100 KB) y `trust proxy` correcto detrás de nginx.
- Datos sensibles (claves SII de clientes) viven solo en la BD local.

Detalle completo y checklist de endurecimiento: [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md).

## Despliegue

Tres caminos documentados con trade-offs: VPS propio (actual, nginx + Docker),
Cloudflare Tunnel (recomendado para dominio público sin IP fija) y PaaS.
Guía paso a paso: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Estructura

```
backend/
  index.js            Express, headers, rutas
  db.js               SQLite + migraciones idempotentes
  routes/             auth, clientes, informe, proceso, sii, exportacion-masiva,
                      contable, documentos, propuestas, reportes, automatizacion,
                      onboarding, tesoreria
  services/           sii-session, sii-rcv, rcv (caché), informe, proceso,
                      calculos, exportacion-masiva, session, password
  core/               dominio contable puro: migraciones, asientos, documentos,
                      propuestas, reportes, tesorería, licencias, onboarding
frontend/
  landing.html        Landing pública (marketing + login)
  sistema/            SPA contable (shell real): finanzas, docs, asientos,
                      tesorería, reportes, admin
  dashboard.html      Shell del sistema tributario (portafolio + reportes)
  index.html          Clientes · libro.html · informe.html · proceso.html
  js/                 dashboard, reportes (motor), tributario, herramientas,
                      portafolio, clientes, libro, proceso, informe
  shared/             layout, shell-router, shell-state, api, format, export,
                      datagrid, table, filters, rango, toast
  css/app.css         Design system (tokens, componentes, responsive)
docs/                 PRD, TRD, MASTERPLAN, SEGURIDAD, DESPLIEGUE, ROADMAP
test/                 node:test — cálculos, esquema, export, listado, fase1-6,
                      saas1, saas2, automatizacion, dashboard
```

## Hoja de ruta

Ver [`docs/ROADMAP-FUNCIONALIDADES.md`](docs/ROADMAP-FUNCIONALIDADES.md) — incluye lo
implementado (Centro Tributario, portafolio, herramientas) y lo pendiente priorizado
(conciliación contra ERP, sincronización automática mensual, alertas push).

---

*Los cálculos son referenciales y no reemplazan la declaración oficial en sii.cl.*
