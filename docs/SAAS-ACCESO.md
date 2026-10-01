# SAAS-ACCESO — Acomplamiento comercial jmvconsultores.cl ↔ Software Contable

> Fecha: 2026-10-01 · Autoría: arquitectura del proyecto. Reglas que respetamos
> (PROMPT MAESTRO + [INTEGRATIONS.md](../INTEGRATIONS.md)): el sitio corporativo
> NO se reconstruye; la integración SII se CONSUME (sin scraping); cada fase
> termina verde en `npm test` + CI antes de la siguiente.

---

## 1. El modelo de negocio en una frase

**El visitante de jmvconsultores.cl entra a `app.jmvconsultores.cl`, se registra
solo con su RUT + clave SII, y el sistema construye su empresa completa solo
(razón social, actividades, régimen, socios), le crea su licencia con 3 meses
gratis y lo deja operando — sin intervención del contador JMV.**

La integración SII existente deja de ser solo un canal de *datos tributarios*
y pasa a ser también la **fuente de verdad de identidad de la empresa** en el
onboarding: el RUT + clave SII no solo autentican la descarga de libros, son la
prueba de que quien se registra tiene el control real de esa empresa ante el SII.

## 2. Mapa del acomplamiento (quién apunta a quién)

```text
jmvconsultores.cl (GitHub Pages + Cloudflare)      iva-mensual (VPS, Docker)
├─ Topbar: "Acceso al Software"  ──────────────────►  https://app.jmvconsultores.cl
├─ Footer: "Acceso clientes al Software" ─────────►    = landing pública de la app
└─ Sección "Software Contable" (planes + precios)      ├─ "Crear cuenta" → /registro.html
   CTA → app.jmvconsultores.cl  ─────────────────►     ├─ registro: usuario+clave+RUT+clave SII
                                                        ├─ onboarding SII → empresa armada sola
                                                        └─ licencia PRUEBA 90 días automática
```

- Cada página del sitio tiene el botón (topbar) + enlace (footer) — ya implementado,
  con URL centralizada en `CONFIG.appUrl` (`js/main.js`).
- La app agrega `/registro.html`: alta self-service. La landing suma el enlace
  "Crear cuenta" junto al login.

## 3. Cómo se entra: 3 puertas, un solo criterio

| Puerta | Quién | Flujo |
|---|---|---|
| **Registro self-service** (nueva) | Dueño de pyme / contador nuevo | RUT + clave SII → sistema arma la empresa → prueba 90 días → opera |
| **Login directo** | Usuarios ya creados | username + contraseña (como hoy) |
| **Alta manual por JMV** | Clientes de servicio contable | El super_admin crea empresa+usuario en contable.html (como hoy) |

Criterio único de autoridad: **una empresa activa por RUT** (ya garantizado por
`UNIQUE` de RUT activo en `empresas`). El RUT es la licencia, no el usuario.

## 4. Onboarding autónomo — "que se alimente sola"

Fase SAAS-1 (esta entrega): al registrarse, el sistema valida el par RUT+clave
SII **en vivo contra el SII** (reusa `probarConexion`, sin scraping), y con eso
arma la empresa: RUT normalizado, clave cifrada en bóveda, plan de cuentas PUC
sembrado, usuario dueño con rol `admin_empresa` y licencia en prueba.

Fases siguientes (mismo principio: **consultar al SII, nunca adivinar**):

| Dato | Fuente SII | Fase |
|---|---|---|
| Razón social real | primer RCV (docs de venta traen el comprador; la identidad propia sale del login exitoso del portal) → confirmación humana en pantalla | SAAS-2 |
| Actividades económicas + inicio de actividades | tarjeta "Datos del contribuyente" del portal (misma sesión `sii-session.js`) | SAAS-2 |
| Régimen tributario (14 D/N, Pro Pyme…) | ídem, campo del contribuyente | SAAS-2 |
| Socios y representante legal | RII/estructura de propiedad (donde el SII lo publique); si no existe endpoint, se pide al usuario (formularios, no scraping) | SAAS-3 |
| Documentos históricos | `consultarRCV` por período (ya existe) | SAAS-2 |

Regla dura: si el SII no entrega un dato por una vía ya existente, se pide al
usuario en un formulario — jamás scraping de HTML (§42 del plan maestro). El
onboarding muestra un checklist "automático ✓ / pendiente humano ⚠" (§43).

## 5. Licencias y planes

### 5.1 Modelo: la licencia se ata a la EMPRESA (RUT), no al usuario

- Cada `empresa` tiene exactamente una `suscripcion` activa (`UNIQUE(empresa_id)`).
- El dueño (rol `admin_empresa` dueño de la cuenta) puede invitar más usuarios a
  la misma empresa — el plan limita **empresas**, no usuarios internos de esa empresa.
- Quien quiera contabilizar 2 empresas (un contador con varios clientes) compra
  2 licencias: registra/activa una empresa adicional desde su misma cuenta.

### 5.2 Estados de la suscripción

`PRUEBA` → `ACTIVA` → `VENCIDA` → `SUSPENDIDA` (7 días de gracia) → `ACTIVA`|`CANCELADA`
El paso de tiempo lo resuelve `licencias.refrescarEstado()` al leer (sin cron).

### 5.3 Planes (CLP, IVA incluido — valores en un solo lugar: `core/licencias.js`)

| Plan | Precio | Empresas | Usuarios/empresa | Límites | Para quién |
|---|---|---|---|---|---|
| **PRUEBA** | $0 — 90 días | 1 | 3 | 600 docs/mes | evaluación |
| **PYME** | $29.900/mes | 1 | 5 | 300 docs/mes | dueño que lleva su contabilidad |
| **PRO** | $59.900/mes | 3 | 10 | 2.000 docs/mes | contador con pocos clientes |
| **DESPACHO** | $119.900/mes | 10 | ilimitados | sin límite de docs | despacho contable |

- El límite operativo se aplica como gate en escrituras (`licencias.exigirVigente`),
  **nunca** borrando ni bloqueando lectura: los datos siempre se ven, no se puede
  escribir en período sin licencia (mismo espíritu que el bloqueo de período cerrado).
- Pagos: FASE SAAS-3 (MercadoPago/Transbank webhook → `activarPlan`). Hoy la
  activación la hace JMV (super_admin) desde la ficha de la empresa; la prueba
  es 100% automática.

### 5.4 Prueba: 3 meses (90 días), automática y honesta

- Al crear la empresa vía registro: licencia `PRUEBA` con `fin` = hoy + 90 días.
- Una sola prueba por RUT de empresa (el RUT ya es único). Si la empresa existe,
  el registro no repite prueba: ofrece login o recuperación.
- El contador no hace nada para activarla: se activa sola al crearla y se muestra
  el countdown en la app (banner "Prueba: quedan N días — Plan PYME al término").

## 6. Arquitectura técnica de la entrega SAAS-1

```text
backend/core/licencias.js     PLANES, crearPrueba(empresaId), suscripcionDe(empresaId),
                              refrescarEstado, exigirVigente(db, empresaId)  ← gate
backend/core/registro.js      registrarConOnboarding(): user + empresa(+clave cifrada)
                              + seed PUC + rol admin_empresa + licencia PRUEBA, 1 tx
backend/routes/auth.js        POST /api/auth/registro (rate-limit propio + captcha-free
                              honeypot), valida RUT módulo 11 y unicidad
backend/core/migraciones.js   migracionesSaas1: tabla suscripciones + columnas ficha
                              tributaria en empresas (razon_social_sii, actividades_json,
                              regimen_tributario, inicio_actividades, onboarding_json)
frontend/registro.html        alta self-service (usuario, clave, RUT, clave SII, WhatsApp)
frontend/landing.html         enlace "Crear cuenta"
```

- **No toca** la integración SII (solo llama `probarConexion` existente).
- **No toca** el núcleo contable: la licencia vive junto a la empresa; el gate se
  inyecta donde ya existe control de escritura (rutas contable/documentos).
- Auditoría: `licencia.crear`, `licencia.activar`, `licencia.estado` (todo trazado).

## 7. Seguridad del registro público

- Rate-limit por IP independiente del login (10 registros/hora/IP) + honeypot
  de formulario (campo oculto que los bots rellenan).
- La clave SII viaja solo por HTTPS, se cifra AES-256-GCM en la misma transacción
  (bóveda existente) y **nunca** se devuelve por API (ni siquiera cifrada).
- `probarConexion` con los reintentos ya existentes; credencial inválida ⇒ el
  registro NO crea nada (evita empresas fantasma que nunca sincronizarán).
- El usuario queda con `activo=1` pero la primera sesión exige login normal
  (no auto-login: menos superficie de fijación de sesión).

## 8. Qué NO es esta fase (explícito)

- Sin pasarela de pago real (SAAS-3). Sin facturación electrónica de la
  suscripción (JMV factura manual). Sin multi-moneda. Sin equipo/organización
  contable con varias empresas en un plan (hasta SAAS-3).
- Sin emails transaccionales: el banner en la app + WhatsApp de JMV bastan para
  arrancar (el sitio ya convierte por WhatsApp).
