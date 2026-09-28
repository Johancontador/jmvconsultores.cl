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
| **👥 Multiusuario** | Cada usuario administra sus propias empresas; roles admin; sesiones httpOnly con expiración. |
| **📦 Reporte Masivo** | Informe de todos los clientes de un período en un solo ZIP (Excel por empresa). |

## Arquitectura (30 segundos)

```
Navegador ── HTTPS ── nginx (TLS, proxy) ── Express (Node 24)
                                          ├─ /api/auth      login, sesiones, usuarios
                                          ├─ /api/clientes  CRUD de empresas
                                          ├─ /api/informe   sincroniza SII + persiste
                                          ├─ /api/proceso   proceso masivo mensual + WhatsApp
                                          └─ /api/sii       libro directo / probar conexión
SQLite (WAL) ← mejor-sqlite3: clientes, informes, meses, documentos, caché RCV
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
npm test                    # no existe script; usar:
node --test test/calculos.test.js test/db-schema.test.js test/export-fecha.test.js test/informe-listar.test.js
```

Cobren cálculos, esquema de BD (migraciones idempotentes), export con fechas y listado
de informes. CI ejecuta lo mismo en cada push (`.github/workflows/ci.yml`).

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
  routes/             auth, clientes, informe, proceso, sii, exportacion-masiva
  services/           sii-session, sii-rcv, rcv (caché), informe, proceso,
                      calculos, exportacion-masiva, session, password
frontend/
  landing.html        Landing pública (marketing + login)
  dashboard.html      Shell principal (portafolio + reportes)
  index.html          Clientes · libro.html · informe.html · proceso.html
  js/                 dashboard, reportes (motor), tributario, herramientas,
                      portafolio, clientes, libro, proceso, informe
  shared/             layout, shell-router, shell-state, api, format, export,
                      datagrid, table, filters, rango, toast
  css/app.css         Design system (tokens, componentes, responsive)
docs/                 PRD, TRD, MASTERPLAN, SEGURIDAD, DESPLIEGUE, ROADMAP
test/                 node:test — cálculos, esquema, export, listado
```

## Hoja de ruta

Ver [`docs/ROADMAP-FUNCIONALIDADES.md`](docs/ROADMAP-FUNCIONALIDADES.md) — incluye lo
implementado (Centro Tributario, portafolio, herramientas) y lo pendiente priorizado
(conciliación contra ERP, sincronización automática mensual, alertas push).

---

*Los cálculos son referenciales y no reemplazan la declaración oficial en sii.cl.*
