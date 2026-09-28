# 🔐 Seguridad — Auditoría y modelo de amenazas

Última revisión: 2026-09-28 · Estado: **endurecido para exposición pública detrás de Cloudflare**

## 1. Modelo de amenazas

| Activo | Riesgo principal | Mitigación actual |
|---|---|---|
| Claves SII de clientes (BD SQLite) | Exfiltración si el servidor o el repo se comprometen | BD fuera de git (`data/`), volumen Docker dedicado; nunca viaja al frontend; cifrado en roadmap (§6) |
| Credenciales de la app | Fuerza bruta, phishing | Rate-limit por IP (5/15 min), contraseñas hasheadas (scrypt), multiusuario |
| Sesión activa | Secuestro de cookie, CSRF | Cookie `httpOnly` + `SameSite=Lax` + `secure` en prod, token 256 bits, TTL configurable |
| Servicio | DoS, abuso de API | Express + nginx; body limit 100 KB; Cloudflare WAF en modo público |
| Código / repo | Filtración de secretos en el historial | `.env` y `data/` jamás commiteados (verificado con `git log --all`); secretos escaneados en CI |

## 2. Verificaciones ejecutadas (2026-09-28)

- ✅ `git log --all -- .env data/` → **vacío**: secretos y BD nunca entraron al historial.
- ✅ `git grep` de credenciales reales en código tracked → **limpio**.
- ✅ Cookies de sesión: `httpOnly: true`, `sameSite: 'lax'`, `secure` en producción, `maxAge` = TTL.
- ✅ Rate-limit de login en memoria por IP (funciona con `trust proxy=1` detrás de nginx).
- ✅ Contraseñas con hash (backend/services/password.js), admin sembrado desde `.env`.
- ✅ `escapeHtml` en todo dato externo renderizado (SII, usuarios, RUTs) — revisión de XSS en reportes y grid.

## 3. Endurecimientos aplicados en esta auditoría

1. **`express.json({ limit: '100kb' })`** — antes sin límite; un body gigante podía consumir memoria.
2. **`app.set('trust proxy', 1)`** — `req.ip` refleja X-Forwarded-For detrás de nginx; el rate-limit no trata a todo Internet como una IP.
3. **Headers extra**: `Permissions-Policy` (cámara/mic/geoloc off), `Cross-Origin-Opener-Policy: same-origin`, `X-DNS-Prefetch-Control: off`.
4. **`SESSION_DIAS` configurable** (`.env`): 7 días recomendado en exposición pública (antes fijo 30).
5. **`.gitignore` reforzado**: `*.db`, `*.db-wal`, `.env.*` (manteniendo `!.env.example`), `cookies*.txt`, `nginx/certs/`, `.freebuff/`.

## 4. Cadena de custodia de las claves SII

1. El usuario ingresa la clave tributaria en Clientes → se guarda **solo** en SQLite local.
2. El backend la usa en memoria para el login contra sii.cl (cookies en jar en memoria).
3. Nunca se loguea, nunca se envía al frontend, nunca sale del servidor.
4. La BD vive en `data/` (volumen Docker `./data:/app/data`), excluida de git y de backups públicos.

## 5. Exposición pública (Cloudflare)

Cuando la app se publique vía Cloudflare Tunnel:

- TLS terminado en Cloudflare (edge) + HTTPS e2e al origen (cloudflared).
- WAF gratuito: bloqueo de países no deseados, rate limiting por reglas, bot fight mode.
- El origen deja de necesitar puertos abiertos: **cero inbound** (túnel saliente).
- Recomendado además: `SESSION_DIAS=7`, acceso por Cloudflare Access (SSO/OTP) para
  restringir quién siquiera llega al login, y alertas de login fallido.

## 6. Deuda conocida y siguientes pasos (priorizado)

1. **Cifrado en reposo de `clave_sii`** (AES-256-GCM con clave en variable de entorno) — alto impacto, esfuerzo medio.
2. Purga automática de sesiones expiradas (job diario) — trivial.
3. 2FA TOTP para usuarios admin — medio.
4. Auditoría de accesos (quién entró, desde dónde) en tabla dedicada — ya existe el patrón en `informe_documentos`.
5. Backup automático cifrado de `data/` a un bucket externo — alto.

> Regla de oro del repo: **si un dato puede identificar un negocio real, no va a git ni a issues**.
