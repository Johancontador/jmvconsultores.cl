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

---

## P6 — Backups cifrados y restauración verificada (BLOQUE 1bis)

**Estado del arte:** claves SII SIEMPRE cifradas en reposo (`v1:` AES-256-GCM, bóveda BLOQUE 1). Los backups se generan cifrados.

### Cómo crear backup

```bash
node scripts/backup-db.js          # usa DB_PATH/BACKUP_DIR/BACKUP_ENCRYPTION_KEY desde .env
```

Genera 3 artefactos en `data/backups/`:

| Archivo | Contenido |
|---|---|
| `iva_mensual_<stamp>.db.enc` | BD cifrada AES-256-GCM (formato binario `JMVBACKUP1`: magic + iv + tag + ciphertext) |
| `iva_mensual_<stamp>.manifest.json` | archivo, sha256, tamaño, timestamp, formato `jmv-backup-v1`, `cifrado`, `sha256_original`, `secretos: "ninguno"` |
| `iva_mensual_<stamp>.sha256` | hash en formato `sha256sum` para verificación externa |

Retención por defecto: 30 backups (todos sus artefactos), configurable con `BACKUP_RETENCION`. El `.db` en claro se elimina tras verificar el round-trip de cifrado.

### Secretos requeridos

| Variable | Uso | Si no está disponible |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | cifrar/descifrar BACKUPS (salt propia `jmv-backup-v1`) | backup SIN cifrar + warning; restore de `.enc` falla con error claro |
| `SECRETOS_MASTER_KEY` | descifrar claves SII `v1:` en el restore (bóveda, salt `jmv-iva-mensual-boveda-v1`) | restore funciona pero reporta `claves: error` — las claves SII no se pueden verificar |

Separación de responsabilidades: dos claves, dos salt — rotar una no afecta la otra.

**Si `SECRETOS_MASTER_KEY` se pierde:** los secretos de la bóveda NO son recuperables; restaurar desde un backup previo no ayuda (están cifrados con la misma clave). Rotar = volver a pedir las claves SII. **Si `BACKUP_ENCRYPTION_KEY` se pierde:** los backups cifrados existentes NO son recuperables; conservar la clave en el gestor de secretos del VPS.

### Cómo verificar integridad

```bash
sha256sum -c data/backups/iva_mensual_<stamp>.sha256    # verificación externa
cat data/backups/iva_mensual_<stamp>.manifest.json       # metadatos (sin secretos)
```

### Cómo restaurar (procedimiento REAL, probado en BLOQUE 1bis)

```bash
node scripts/restore-db.js --backup data/backups/iva_mensual_<stamp>.db.enc --dest /tmp/restore-$(date +%s)
```

El script ejecuta y reporta: SHA-256 del archivo vs manifest → descifrado → SHA-256 del original → escritura en un TEMPORAL `0600` del destino → `PRAGMA integrity_check` **y** `PRAGMA foreign_key_check` → conteos de tablas críticas (`users, empresas, clientes, auditoria, asientos, asiento_lineas, documentos, periodos_contables, bancos_cuentas, suscripciones`) → descifrado de TODAS las claves SII `v1:` con `SECRETOS_MASTER_KEY` → publicación por `rename` solo si todo pasó. Sale 0 si todo ok.

Guardas (audit 2026-10-25): se niega a escribir si el destino ya existe (hay que pasar `--sobrescribir` de forma explícita) y aborta si la ruta coincide con `DB_PATH` (la BD en uso). Si algo falla, el destino queda intacto y el temporal se borra: nunca se publica una base con `integrity_check` o `foreign_key_check` no satisfactorios.

**Límites (audit 2026-10-25, pendientes):** la publicación no exige tamaño mínimo ni que las tablas críticas existan —un archivo de 0 bytes o una base sin ninguna tabla crítica pasa con `publicado: sí`—, así que un drill debe revisar los conteos del reporte, no solo el código de salida. La guarda de destino ocupado se comprueba al inicio (*check-then-act*): un archivo creado justo después sería reemplazado; usar un directorio recién creado.

Arrancar la app desde la copia restaurada (nunca sobre la BD real):

```bash
DB_PATH=/tmp/restore-XXXX/iva_mensual_restaurada.db PORT=3997 node backend/index.js
# curl /api/health → 200; luego cerrar y migrar el archivo a data/ tras detener el server
```

Restore verificado en vivo (BLOQUE 1bis): usuarios 2, empresas 2, clientes 3, auditoría 5.540, asientos 738, líneas 2.173, documentos 3.672; 5/5 claves v1 descifrables; app arrancando desde la copia con 0 errores; BD de producción intacta.

## BLOQUE 2 — Secretos del emisor de DTE por empresa (certificado, CAF)

Con la emisión de DTE para empresas cliente (`/api/dte`, BLOQUE 2) entran los secretos MÁS sensibles por empresa: la **firma electrónica** (certificado .pfx + contraseña) y los **CAF de folios** (su XML contiene la CLAVE PRIVADA RSA que timbra los documentos). Modelo de custodia:

- **En reposo, SIEMPRE cifrados** con la bóveda existente (`core/boveda.js`, `v1:` = AES-256-GCM con `SECRETOS_MASTER_KEY`): `dte_config.cert_pfx`, `dte_config.cert_pass` y `dte_folios.caf_xml`. Guardas de test: la BD jamás contiene plaintext del .pfx ni `RSASK` del CAF.
- **En tránsito**: nunca salen por HTTP — `GET /config` devuelve solo `tiene_certificado` (flag); `GET /folios` devuelve rangos y conteos, jamás `caf_xml`. Las respuestas y la auditoría se testean para no contener ni ciphertext ni plaintext.
- **En memoria**: solo al emitir — `obtenerConfigDescifrada()` y `descifrar(caf_xml)` alimentan el adaptador (`core/dte-emisor.adaptadorReal`, @devlas/dte-sii) y no se loggean.
- **Rotación de SECRETOS_MASTER_KEY**: invalida también certificados/CAFs ya cifrados (mismo compromiso que las claves SII — re-cargar tras rotar; el sistema lo nombra en los errores de descifrado).
