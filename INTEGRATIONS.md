# INTEGRATIONS — Contratos de integración del ecosistema JMV

> Fecha: 2026-10-01 · Regla del PROMPT MAESTRO: la integración SII **ya existe y funciona** — se consume, no se reconstruye, no se reemplaza, no se le inventan APIs, no se hace scraping de HTML. Geo Daniela **no se toca**: solo se reserva su contrato de entrada futura.

---

## 1. Mapa del ecosistema

```text
┌─────────────────────────┐
│ jmvxonsultores.cl       │  Sitio corporativo existente (NO se reconstruye)
│ (sitio web público)     │  Integración: solo un enlace "Acceso al Software" → app
└─────────────────────────┘
┌─────────────────────────┐      ┌──────────────────────────────────┐
│ SII Chile               │◄─────│ IVA MENSUAL (este repo)          │
│ portal RCV / CAutInicio │ HTTP │  sii-session.js + sii-rcv.js     │ ← INTACTO
└─────────────────────────┘      │        │                         │
                                 │        ▼ única frontera          │
                                 │  documentos/ingesta (nuevo)      │
                                 │        │                         │
                                 │        ▼                         │
                                 │  SOFTWARE CONTABLE (núcleo nuevo)│
                                 └────────┬─────────────────────────┘
                                          ▲ (futuro, fase 9)
                                 ┌────────┴────────────┐
                                 │ Geo Daniela         │  Remuneraciones (EXISTE,
                                 │ (centralización     │  independiente; solo enviará
                                 │  contable)          │  asientos externos)
                                 └─────────────────────┘
```

## 2. Integración SII existente — contrato de CONSUMO

**Archivos (intactos):** `backend/services/sii-session.js` (login, cookie jar, token RCV), `backend/services/sii-rcv.js` (detalle y resumen RCV), `backend/services/rcv.js` (wrapper proveedor + caché).

**Funciones públicas que el software contable usa (y única forma de usarlas):**

```js
// Documentos normalizados de un período (compras|ventas)
const docs = await require('./services/rcv').consultarRCV(rut, claveSii, tipo, periodo)
// docs[i] = { folio, rutDoc, razonSocial, montoExento, montoNeto, montoIVA, montoTotal,
//             tipoDoc, fechaDocto, fechaReclamo?, estadoDocumento:'REGISTRO',
//             montos:{...columnas SII monetarias}, detalleSII:{...fila cruda} }

// Resumen oficial por tipo de documento (fuente de verdad para cuadrar)
const resumen = await require('./services/sii-rcv').consultarResumen(rut, claveSii, periodo, tipo)

// Diagnóstico de credenciales (paso a paso)
const prueba = await require('./services/sii-rcv').probarConexion(rut, claveSii)
```

**Comportamientos que el consumidor debe respetar (ya implementados abajo en la pila):**
- Rate-limit global entre consultas al SII (`esperarRateLimit`), sesiones cacheadas por RUT con TTL 25 min, reintentos automáticos por sesión expirada, paginación transparente (`metaData.page.totalPages`).
- Caché persistente `rcv_cache` **solo para períodos cerrados** (el mes en curso siempre va al SII); invalidación por versión de formato (`meta.rcv_cache_version = 'v4'`).
- Las credenciales SII de cada empresa viven cifradas (ver DATA_MODEL §B.7); se descifran solo para pasarlas a estas funciones.

**Errores que el consumidor debe tratar:** `Clave SII incorrecta`, `Sesión SII expirada`, `Timeout — reintentar`, `Error SII: HTTP <n>`, `No se pudo obtener token de sesión RCV`. La ingesta los mapea a estado `ERROR` del documento/lote con mensaje legible.

### 2.1 Frontera única: `documentos/ingesta` (fase 3 — el único código nuevo que llama al SII)

```text
iniciarIngesta(empresaId, periodo):
  1. empresa + credencial descifrada → rcv.consultarRCV('compras' y 'ventas', periodo)
  2. convertir REAL→INTEGER (Math.round) y normalizar a la tabla `documentos`
  3. dedupe por (empresa, tipo_flujo, tipo_doc, folio, periodo_ingesta): existente = update de
     montos solo si cambió; nuevo = insert con estado RECIBIDO
  4. lote finaliza → resumen (ingresados/actualizados/errores) + auditoría
  NOTA: reutiliza el patrón de trabajo en background de informe.js (Map + estado consultable);
  NO consulta el SII desde ningún otro módulo del software contable.
```

La conciliación usa `consultarResumen` (totales oficiales del SII) contra los totales contables — nunca recalcula el detalle del SII por su cuenta.

## 3. Sitio corporativo jmvxonsultores.cl — integración mínima

- **No se rediseña ni se reemplaza.** Única integración requerida: un botón/enlace "Acceso clientes / Software contable" que apunte a la app (subdominio tipo `app.jmvxonsultores.cl` o ruta del dominio), que abre la landing con login (`/` de esta app).
- La app ya tiene landing pública con login embebido y hardening (cookies httpOnly/SameSite, rate-limit, headers) — ver [docs/SEGURIDAD.md](docs/SEGURIDAD.md) y [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) (Cloudflare Tunnel como vía de publicación: cero puertos abiertos, TLS y WAF gestionados; dominio recomendado `.cl` para negocio).
- Si el sitio corporativo vive en otro hosting, el enlace no exige cookies compartidas ni SSO en el MVP.

## 4. Geo Daniela (remuneraciones) — contrato FUTURO de asiento externo (fase 9)

**Estado: ✅ IMPLEMENTADO (2026-10-02, FASE 9.1 — 10 tests).** Detalle de implementación en ROADMAP.md → PLAN FASE 9 §9.1. El canal es `asientos.tipo='externo'` con `origen='<remitente>:<periodo>'`.

Contrato previsto (cuando Geo Daniela quiera enviar su centralización):

```text
ENTRADA: POST /api/contable/asientos-externos   (autenticado, permiso asientos:crear)
{
  "empresa_rut":  "76312274-3",
  "idempotencia": "centralizacion-202609-v1",   // OPCIONAL: si se envía, DEBE enviarse siempre
                                                 // (re-envío con la misma clave = 200 deduplicado, no duplica;
                                                 //  sin clave, el dedupe es por SHA-256 del payload)
  "periodo":      "202609",            // debe estar ABIERTO
  "glosa":        "Centralización remuneraciones septiembre 2026",
  "fecha":        "2026-09-30",
  "lineas": [
    { "cuenta_codigo": "6.1.1",  "debe": 5000000, "haber": 0, "glosa": "Sueldos" },
    { "cuenta_codigo": "2.1.4",  "debe": 0, "haber": 1450000, "glosa": "AFP por pagar" },
    { "cuenta_codigo": "2.1.3",  "debe": 0, "haber": 3550000, "glosa": "Remuneraciones por pagar" }
  ]
}
REGLAS (idénticas a cualquier asiento, validadas por el MISMO núcleo):
  - autenticación + permiso; aislamiento de empresa por RUT
  - Σdebe = Σhaber (rechazo 422 si no cuadra — se rechaza COMPLETO, nunca parcial)
  - período abierto; cuentas imputables existentes y activas (por código, empresa)
  - atómico en transacción; folio correlativo; auditado
  - NO hay cálculo de remuneraciones de este lado: Geo Daniela envía el asiento ya cuadrado
  - las cuentas 6.1.1/2.1.x son de la plantilla del plan de cuentas; el mapeo lo maneja
    Geo Daniela o configuración, no lógica especial en el núcleo
```

Esto cumple la regla del PROMPT MAESTRO: **cero desarrollo de remuneraciones**; solo el núcleo abierto a recibir un asiento externo.

Auxiliares del receptor (FASE 9.1):
- `GET /api/contable/asientos-externos?empresa_rut=…` — centralizaciones recibidas (histórico con folio).
- `GET /api/contable/asientos-externos/validar-codigos?empresa_rut=…&codigos=6.1.1,2.1.4` — valida existencia/imputabilidad SIN crear cuentas.
- Errores: 422 con `codigo` PAYLOAD_INVALIDO (incluye Σd≠Σh — rechazo completo) · PERIODO_CERRADO · CUENTA_INEXISTENTE (lista exacta de códigos) · 403 SIN_ACCESO (el usuario no pertenece a la empresa) · 402 licencia.

## 5. GitHub / CI / VPS (integración de desarrollo, vigente)

- Remotes: `vps` (bare en VPS vía Tailscale, **activo**), `github` (pendiente: el usuario debe ejecutar `gh auth login -h github.com`; luego crear repo privado, `git remote add github <url>`, `git push -u github master`).
- CI (`.github/workflows/ci.yml`): `npm test` (11 tests) + `node --check` en backend + gitleaks + chequeo de que `.env`/`data/` no entren al repo. Las fases contables agregarán sus tests al mismo script (el core contable es puro y testeable por diseño, ARCHITECTURE §2).
- Backups (operación crítica nueva del software contable): `sqlite3 data/iva_mensual.db ".backup ..."` diario con retención — se automatiza en fase 1 (ROADMAP).

## 6. Pagos de la suscripción + factura electrónica — SAAS-3 (IMPLEMENTADO)

### 6.1 Pasarela de pagos — adaptador con MercadoPago primero

- **Contrato interno** (`core/pagos.js`, módulo puro): el adaptador de pasarela se INYECTA — `crearPreferencia({monto_clp, descripcion, external_reference, url_retorno, url_notificacion}) → {id, init_point}` y `obtenerPago(gatewayPagoId) → {estado, external_reference, monto, moneda, detalle}`. Transbank/Webpay queda como segundo adaptador con la misma interfaz.
- **Checkout**: `POST /api/pagos/empresas/:id/checkout` (sesión + capacidad `licencias:pagar`; SIN gate de licencia — pagar debe ser posible incluso SUSPENDIDA). Crea la fila `pagos_suscripcion` PENDIENTE con `external_reference = pago_suscripcion:<id>` y devuelve el `init_point` de MercadoPago (Checkout Pro).
- **Webhook** (PÚBLICO, la pasarela no tiene sesión): `POST /api/pagos/webhook/mercadopago`. Defensas en capas: (1) firma `x-signature` HMAC-SHA256 con la plantilla oficial `id:{dataId};request-id:{rid};ts:{ts};` si hay `MP_WEBHOOK_SECRET`; (2) el estado del pago SIEMPRE se re-consulta a la API de MP (`obtenerPago` — el body del webhook solo trae ids y jamás se confía en él); (3) idempotencia en dos espacios: `webhook_eventos` UNIQUE(gateway, evento_id) y `pagos_suscripcion` UNIQUE(gateway, gateway_pago_id). Respuesta 200 salvo error transitorio (500 → la pasarela re-intenta).
- **Aprobado** → UNA transacción: pago APROBADO + licencia activada/renovada vía `licencias.activarPlan` (renovación suma al fin vigente) + factura de la suscripción PENDIENTE + auditoría. Rechazado → RECHAZADO sin tocar la licencia.
- **Env**: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` (opcional), `MP_BASE_URL` (sandbox/prod), `PAGOS_NOTIFICATION_URL`, `PAGOS_URL_RETORNO`.

### 6.2 Factura electrónica de la suscripción (DTE 33)

- **Adaptador real**: `core/dte.js` sobre **@devlas/dte-sii** (librería chilena open-source: genera el XML, timbra con el CAF, firma con el certificado .pfx y envía al SII por SOAP). Lazy: el sistema arranca y todo lo demás funciona sin esta configuración.
- **Config (env)**: `DTE_CERT_PFX` + `DTE_CERT_PASS` (firma electrónica), `DTE_CAF_XML` (folios tipo 33), `DTE_RUT_EMISOR/RAZON_SOCIAL/GIRO/DIRECCION/COMUNA/ACTECO`, `DTE_FCH_RESOL/NRO_RESOL` (resolución SII), `DTE_AMBIENTE` (certificación|producción). `configFaltante()` nombra EXACTAMENTE las que faltan.
- **Receptor**: RUT y razón social de la ficha de la empresa; giro/dirección/comuna se piden en la emisión (se NOMINA lo que falta — jamás se adivina, §42). IVA 19% citado (D.L. 825, Ley 21.210). Folio = secuencia local del emisor, validada contra el rango del CAF.
- **Endpoint**: `POST /api/pagos/empresas/:id/pagos/:pagoId/factura` (`facturacion:emitir`) — solo pagos APROBADO; una factura EMITIDA no se re-emite.
- **Aceptación operativa**: cuenta MercadoPago real y firma+CAF de JMV — el flujo completo está probado con adaptadores falsos (17 tests).

## 7. Integraciones explícitamente FUERA de alcance

- SII: cualquier otra cosa distinta al RCV (boletas de honorarios electrónicas SII-web, F22, cartolas bancos) — fase futura, requiere decisión expresa.
- Bancos: la cartola del portal entra como ARCHIVO con conector por formato — ✅ IMPLEMENTADO (FASE 9.2: `core/tesoreria-cartola-formatos.js`, detección por encabezado/estructura + mapeo manual guardado; cero scraping, el humano descarga el archivo). La integración directa vía agregador (XuMi) queda bajo decisión expresa del dueño (ROADMAP §9.3).
- Facturación emisora COMO FUNCIÓN PARA CLIENTES (emitir los DTE de su contabilidad): fuera del alcance — el software es receptor/consumidor del RCV. EXCEPCIÓN ya implementada: la factura electrónica de la PROPIA SUSCRIPCIÓN del SaaS (§6.2).

---

Estado actual del código de esta integración: [CURRENT_STATE.md](CURRENT_STATE.md) §6. Modelos de datos involucrados: [DATA_MODEL.md](DATA_MODEL.md) §B.3.
