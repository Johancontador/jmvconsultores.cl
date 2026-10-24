# 27 · Verificación de producción en solo lectura (F6)

> **Fecha:** 2026-10-24 · **Rama:** `master` · **Commit local:** `85f93e9` (+ cambios F0–F5 sin commitear)
> **Alcance:** diagnóstico. **No** se modificó nada, no se reinició nada, no se
> desplegó, no se ejecutaron backups ni migraciones, no se consultó SII/TGR/
> MercadoPago y no se emitió ningún DTE.
>
> **Acceso disponible:** ninguno al VPS (ni SSH, ni Docker en esta estación, ni
> lectura del `.env` de producción). Sí se hicieron **comprobaciones públicas de
> solo lectura** contra `https://app.jmvconsultores.cl` (las que pide F6.5:
> TLS/cabeceras/exposición accidental), sin autenticarse y sin escanear.
>
> Estados: `VERIFICADO` · `FALLIDO` · `NO VERIFICADO` · `NO APLICA`.
> La ausencia de acceso **no** se interpreta como que algo esté bien o mal.

---

## 1. Identificación del entorno (F6.1)

| Dato | Estado | Evidencia |
|---|---|---|
| URL pública | **VERIFICADO** | `https://app.jmvconsultores.cl` responde `200`; DNS/edge `188.114.97.5` (Cloudflare, `server: cloudflare`) |
| Aplicación | **VERIFICADO** | `GET /api/health` → `{"ok":true,"message":"IVA Mensual API running"}`; `x-powered-by: Express` |
| Mecanismo de ejecución | **VERIFICADO (por código)** | `ops/post-receive` (hook del repo bare) → `ops/deploy.sh` → `docker compose up -d --build` → espera health → `deploy-state.json`. Contenedor `iva-mensual`, `USER node` (uid 1000) |
| Servicio bajo systemd/PM2 | **NO APLICA** | El despliegue es Docker + hook de git; no hay unidad systemd de la app en el repo |
| Commit desplegado | **NO VERIFICADO** (requiere VPS) | `cat /home/johan/deploy-state.json` o `bash ops/estado-deploy.sh` |
| Versión del **frontend** desplegado vs. local | **VERIFICADO** | Comparación de `?v=` (sha1 del contenido) de `/sistema/index.html`: **19 de 28 referencias coinciden** con el working tree; **9 difieren** → el build público es **anterior** a los cambios F3 |
| Archivos que difieren | **VERIFICADO** | `sistema/sistema.css`, `app.js`, `views-fiscal.js`, `views-salud.js`, `views-teso.js`, `views-activos.js`, `views-portal.js`, `views-conta.js`, `views-centro.js` (exactamente los tocados en F3) |
| Fecha del despliegue web | **NO VERIFICADO** (indicio) | `last-modified: Tue, 20 Oct 2026 02:30:18 GMT` en `/` |
| Directorios de datos | **VERIFICADO (por código)** | `DB_PATH` default `./data/iva_mensual.db`; backups `./data/backups`; fichas `data/sii-fichas`; certificados TGR `data/certificados-tgr`; exports `data/exports`. Todos dentro del volumen `./data` |

**Conclusión de F6.1:** producción **no** ejecuta el código local más reciente.
El build público corresponde a un estado **anterior a F3** (coherente con
`85f93e9`, 20-oct). Por lo tanto **las protecciones de F5-B, F5-C y F5-D no
están activas en producción**: existen en el repositorio, no en el servidor.

---

## 2. Clave maestra (F6.2)

| Control | Estado | Evidencia / motivo |
|---|---|---|
| ¿`SECRETOS_MASTER_KEY` está definida en el entorno efectivo del servicio? | **NO VERIFICADO** | Sin acceso al VPS. No basta verla en `.env.example` ni en la plantilla |
| ¿Su formato/longitud cumplen el contrato (64 hex o passphrase ≥ 32)? | **NO VERIFICADO** | Requiere leer longitud/hash, no el valor |
| ¿El código desplegado incluye la validación F5-B? | **FALLIDO (demostrado)** | El build público es anterior a F3 (9/28 assets distintos) y F5 no se ha desplegado: la guarda **no** está corriendo |
| ¿La clave corresponde a la usada para cifrar los datos? | **NO VERIFICADO** | Se demuestra sólo descifrando un valor; sin acceso |
| ¿La app arrancaría hoy sin la variable (fallback silencioso)? | **SÍ en el código desplegado** (por versión) | El build antiguo usa el fallback de desarrollo sin distinguir entorno |
| ¿Riesgo de indisponibilidad al desplegar F5? | **VERIFICADO (por código)** | Si la variable falta o es inválida, el arranque **aborta** (exit 1). Desplegar F5 sin verificarla primero = caída del servicio |

**Comandos de verificación (solo lectura, a ejecutar por el operador en el VPS):**

```bash
# 1) Nombres de variables del contenedor (NUNCA los valores)
docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' iva-mensual | cut -d= -f1 | sort

# 2) ¿Existe y cuánto mide? (sólo longitud; el valor no se imprime)
docker exec iva-mensual sh -c 'printf %s "$SECRETOS_MASTER_KEY" | wc -c'

# 3) Huella para comparar con el gestor de secretos (12 hex, no reversible)
docker exec iva-mensual sh -c 'printf %s "$SECRETOS_MASTER_KEY" | sha256sum | cut -c1-12'

# 4) ¿Coincide con los datos? → restaurar un backup a un destino TEMPORAL con
#    scripts/restore-db.js (no toca la BD real) y leer el campo `claves`:
#    `error: null` y `descifrables = clientes_v1 + empresas_v1` ⇒ la clave vigente
#    es la que cifró esos datos.
```

**Riesgo P0 asociado:** desplegar F5 sin confirmar (2) y (3) deja el servicio
sin arrancar. Ver §8, orden seguro.

---

## 3. Backups (F6.3)

| Control | Estado | Evidencia / motivo |
|---|---|---|
| Últimas copias y antigüedad **en producción** | **NO VERIFICADO** | Sin acceso a `data/backups` del VPS |
| Resultado de las últimas ejecuciones (log del cron) | **NO VERIFICADO** | `logs-backup.log` está en el VPS |
| Integridad/formato de los archivos existentes | **NO VERIFICADO** | Requiere `sha256sum -c` o leer el manifest |
| Cifrado de los respaldos | **NO VERIFICADO** | Depende de `BACKUP_ENCRYPTION_KEY` en el `.env` del VPS |
| Ubicación física / volumen | **VERIFICADO (por código+docs)** | `data/backups` en el **mismo volumen** (`./data`) que la BD |
| Retención configurada | **NO VERIFICADO** | `BACKUP_RETENCION` (default 30) |
| Copia fuera del volumen principal | **NO VERIFICADO / sin evidencia** | No hay código ni documentación que la produzca; no se declara existente |
| Programación efectiva del cron | **NO VERIFICADO** | `crontab -l` en el VPS (documentado: `0 3 * * * docker exec …`) |
| Alertas ante fallo o copia vieja | **FALLIDO (demostrado por versión)** | El verificador F5-C **no está desplegado**; el cron actual sólo escribe en el log |
| Comprobación local del verificador (F5-C) | **VERIFICADO en el working tree, NO en producción** | `node scripts/verificar-backup.js --dir ./data/backups` → `ANTIGUO … 330.3 h, total 6` (exit 1). **Esto es la copia local de desarrollo, no el VPS** |

**Comandos de verificación (solo lectura):**

```bash
# Copias y fechas (sin abrir archivos)
docker exec iva-mensual ls -lt /app/data/backups | head -12
# Programación real
crontab -l | grep -E 'backup|sync'
# Resultado de las últimas noches
tail -30 /home/johan/apps/iva-mensual/logs-backup.log
# Integridad declarada vs. real (solo lectura)
docker exec iva-mensual sh -c 'cd /app/data/backups && sha256sum -c *.sha256 2>&1 | tail -5'
# Dueño y permisos del volumen (el incidente de octubre fue de permisos)
ls -ld /home/johan/apps/iva-mensual/data /home/johan/apps/iva-mensual/data/backups
```

**Distinción explícita:** no hay evidencia de que exista (a) una tarea
programada activa, (b) una ejecución reciente con éxito, ni (c) un respaldo
recuperable. Sólo hay documentación de cómo se programó y un script que lo
produce. **Nada de eso se pudo comprobar en el servidor.**

---

## 4. Certificados y DTE (F6.4)

| Control | Estado | Evidencia / motivo |
|---|---|---|
| Rutas DTE desplegadas y protegidas | **VERIFICADO (público)** | `GET /api/dte/empresas/1/config` → **401** (sin sesión), sin filtrar existencia |
| Certificado configurado por empresa | **NO VERIFICADO** | Requiere consulta autenticada o lectura de la BD |
| Fecha de expiración de cada certificado | **NO VERIFICADO** | El build desplegado **no** expone `certificado` (es nuevo de F5) |
| Correspondencia certificado ↔ RUT emisor | **NO VERIFICADO** | Misma razón |
| El código desplegado aplica las barreras F5-D | **FALLIDO (demostrado)** | 9/28 assets distintos + cambios de backend no desplegados |
| Emisión en producción exige controles explícitos | **FALLIDO (por código desplegado)** | En el build público `emitir()` no valida el certificado |
| Errores y condiciones no verificadas se presentan honestamente | **PARCIAL** | El backend devuelve 401/403 correctos; el 500 devuelve `err.message` (ver N-1 en `25`) |

**Comando de verificación de metadatos (solo lectura, sin exponer secretos):**

```bash
# Cuántas empresas tienen certificado y pass guardados (conteos, no valores)
docker exec iva-mensual node -e "
const db=require('better-sqlite3')('/app/data/iva_mensual.db',{readonly:true});
console.log(db.prepare('SELECT COUNT(*) empresas, SUM(CASE WHEN cert_pfx IS NOT NULL THEN 1 ELSE 0 END) con_cert FROM dte_config').get());
"
```

La expiración **sólo** se puede leer de forma segura con el código de F5
(`estadoCertificado`, que descifra en memoria y devuelve metadatos) o desde el
`/config` ya desplegado tras F5. Hoy: **NO VERIFICADO**.

---

## 5. Seguridad del servidor público (F6.5) — comprobaciones realizadas

Sólo peticiones `GET/HEAD` públicas, sin autenticación, sin escaneo.

| Control | Estado | Evidencia (mínima) | Impacto | Prioridad |
|---|---|---|---|---|
| HTTPS operativo | **VERIFICADO** | `HTTP=200`, verificación TLS correcta (`TLS_VERIFY=0`) | — | — |
| Certificado TLS vigente | **VERIFICADO** | Let's Encrypt · `CN=jmvconsultores.cl` · `notBefore=2026-10-09` · `notAfter=**2027-01-07**` | Renovación automática por Cloudflare; sin acción | P3 (seguimiento) |
| HSTS | **VERIFICADO (parcial)** | `strict-transport-security: max-age=31536000; includeSubDomains` en HTTPS | Sólo aplica tras la primera visita | P3 |
| **HTTP sin redirección a HTTPS** | **FALLIDO** | `curl -I http://app.jmvconsultores.cl/` → **200** (no 301/308) | Contenido servido en claro; HSTS mitiga sólo después de la primera visita HTTPS | **P2** |
| CSP | **VERIFICADO con deuda conocida** | `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, pero `script-src 'unsafe-inline'` | XSS con inline si hubiera inyección | P3 (N-2 de `25`) |
| Anti-framing | **VERIFICADO** | `x-frame-options: DENY` + `frame-ancestors 'none'` | — | — |
| `nosniff` / CORP / COOP / referrer / permissions | **VERIFICADO** | Cabeceras presentes (ver §5.1) | — | — |
| **`x-powered-by: Express`** | **FALLIDO** | Cabecera presente | Divulgación de stack (facilita fingerprinting) | P3 |
| Exposición de `.env` | **VERIFICADO (no expuesto)** | `GET /.env` → **404** | — | — |
| Exposición de la BD | **VERIFICADO (no expuesto)** | `GET /data/iva_mensual.db` → **404**; `GET /data/` → **404** | — | — |
| Exposición del repo | **VERIFICADO (no expuesto)** | `GET /.git/config` → **404** | — | — |
| API protegida sin sesión | **VERIFICADO** | `/api/dte/empresas/1/config` → **401** (no 403 ni 200; no revela existencia) | — | — |
| Sesiones/cookies | **NO VERIFICADO (servidor)** | El código usa `httpOnly`, `sameSite=lax`, `secure` en producción; no se observó `Set-Cookie` sin autenticarse | — | — |
| Permisos de archivos (`.env`, BD, backups) | **NO VERIFICADO** | Requiere `stat` en el VPS | — | **P1** |
| Versión de Node y dependencias desplegadas | **NO VERIFICADO** | `docker exec iva-mensual node -v` / `npm ls --depth=0` | — | P2 |
| Monitorización y alertas operativas | **NO VERIFICADO / sin evidencia** | No hay endpoint de métricas ni alerta documentada; el verificador F5-C no está desplegado | — | **P1** |
| Logs con información interna | **NO VERIFICADO** | Requiere leer los logs del contenedor | — | P2 |

### 5.1 Cabeceras observadas (sin cookies ni datos)

```
HTTP/1.1 200 OK · server: cloudflare
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' …; object-src 'none'; frame-ancestors 'none'
strict-transport-security: max-age=31536000; includeSubDomains
x-frame-options: DENY · x-content-type-options: nosniff
cross-origin-opener-policy: same-origin · cross-origin-resource-policy: same-origin
referrer-policy: strict-origin-when-cross-origin · permissions-policy: camera=(), microphone=(), geolocation=()
x-powered-by: Express
```

---

## 6. Matriz de controles (A / B / C / D)

### A · Hallazgos **demostrados en el servidor** (desde fuera, sin acceso)

| # | Hallazgo | Estado | Evidencia |
|---|---|---|---|
| A1 | Producción sirve un build **anterior** al working tree (9/28 assets distintos) | **VERIFICADO** | Hashes `?v=` de `/sistema/index.html` vs. `sha1` local |
| A2 | HTTPS válido y HSTS activo | **VERIFICADO** | Cabeceras + TLS |
| A3 | `.env`, BD, `/data/` y `.git` **no** están expuestos | **VERIFICADO** | 404 en las cuatro rutas |
| A4 | API protegida responde 401 sin sesión, sin filtrar existencia | **VERIFICADO** | `/api/dte/empresas/1/config` |
| A5 | **HTTP (puerto 80) responde 200 sin redirección** | **FALLIDO** | `curl -I http://…` |
| A6 | **`x-powered-by: Express`** | **FALLIDO** | Cabecera |
| A7 | `/api/health` público con mensaje fijo | **VERIFICADO** (aceptable) | Cuerpo |

### B · Hallazgos **demostrados solo en código** (working tree, no desplegado)

| # | Hallazgo | Estado |
|---|---|---|
| B1 | Arranque aborta sin clave maestra (F5-B) | **VERIFICADO localmente** (`test/seguridad-f5.test.js`, exit 1 en proceso real) |
| B2 | Certificado DTE validado antes de consumir folio (F5-D) | **VERIFICADO localmente** (`test/dte-certificado.test.js`) |
| B3 | Verificador de backups con exit codes (F5-C) | **VERIFICADO localmente** (`test/backup-vigilancia.test.js` + corrida real) |
| B4 | `backups` en el mismo volumen; sin copia externa; sin alerta | **VERIFICADO en código** (`scripts/backup-db.js`, `docs/DESPLIEGUE.md`) |
| B5 | Migración one-way de `clientes.clave_sii` a `v1:` | **VERIFICADO en código** |
| B6 | 500 devuelve `err.message` al cliente | **VERIFICADO en código** (`index.js:127`) |

### C · Controles **pendientes de acceso o evidencia** (NO VERIFICADO)

| # | Control | Comando de verificación (solo lectura) |
|---|---|---|
| C1 | Existencia/formato de `SECRETOS_MASTER_KEY` | `§2` comandos 1–3 |
| C2 | Que la clave descifra los datos reales | Restore aislado del último backup (escribe sólo en destino temporal) |
| C3 | Commit/imagen desplegados y salud del contenedor | `bash ops/estado-deploy.sh` |
| C4 | Cron real y resultado de las últimas noches | `crontab -l`, `tail logs-backup.log` |
| C5 | Frescura/integridad/cifrado de las copias | `ls -lt data/backups`, `sha256sum -c *.sha256` |
| C6 | Permisos de `.env`, BD y backups | `stat -c '%U %G %a %n' …` |
| C7 | Certificados por empresa y vencimiento | `estadoCertificado` (tras F5) o conteo SQL de §4 |
| C8 | Versión de Node y dependencias | `docker exec iva-mensual node -v` |
| C9 | Logs con datos internos | `docker logs --tail 200 iva-mensual` |
| C10 | Copia externa y su custodio | Inventario del operador |

### D · Recomendaciones **no implementadas**

| # | Recomendación | Prioridad |
|---|---|---|
| D1 | Verificar clave maestra **antes** de desplegar F5 (evita caída) | **P0** |
| D2 | Confirmar frescura e integridad de backups; si están viejos, corregir antes de cualquier deploy | **P0** |
| D3 | Desplegar F0–F5 en ventana con rollback (`rollback-target.txt`) | P1 |
| D4 | Programar `verificar-backup.js` + alerta (`MAILTO`/webhook) | P1 |
| D5 | Copia externa cifrada (opción a elegir, ver `26` §3.1) | P1 |
| D6 | Redirigir HTTP→HTTPS (Cloudflare "Always Use HTTPS" o nginx) | P2 |
| D7 | `app.disable('x-powered-by')` | P3 |
| D8 | CSP sin `unsafe-inline`; mensaje genérico en 500 (N-1) | P2 |
| D9 | Verificar certificado de cada empresa emisora | P1 |
| D10 | Rotación de clave maestra (`v2`) cuando se apruebe | P2 |

---

## 7. Resumen ejecutivo

### P0 — antes de cualquier despliegue

1. **La clave maestra es una incógnita y un riesgo de caída.** El código nuevo
   **no arranca** sin `SECRETOS_MASTER_KEY` válida. Hay que comprobar longitud y
   huella en el VPS (§2) **antes** de desplegar. Si no existe, primero se define
   la clave y se re-cifra el legado (procedimiento `26` §4 / script existente),
   y **después** se despliega.
2. **Los respaldos no están verificados.** No hay evidencia de que el cron haya
   corrido, de que la última copia sea reciente ni de que esté íntegra. Dado el
   antecedente de **7 noches sin backup**, esto se comprueba **antes** de tocar
   nada (§3).

### P1 — lo que falta para considerar producción "protegida"

3. Desplegar F0–F5 (hoy producción corre un build anterior; las protecciones de
   clave, certificado y backup **no están activas**), en ventana y con rollback.
4. Vigilancia de backups programada + alerta real conectada.
5. Copia externa cifrada y custodia de claves documentada.
6. Verificación del certificado de cada empresa emisora.

### P2 — endurecimiento pendiente

7. Redirección HTTP→HTTPS (hoy el puerto 80 responde 200).
8. Mensaje genérico en 500 y CSP sin `unsafe-inline`.
9. Versión de Node/dependencias y permisos de archivos verificados.

### P3 — menores

10. `x-powered-by`, renovación TLS (automática, vigente hasta 2027-01-07).

---

## 8. Orden seguro de remediación (propuesto, sin ejecutar)

| Paso | Acción | Riesgo | Autorización / ventana | Prueba de aceptación |
|---|---|---|---|---|
| 1 | Ejecutar los comandos de §2/§3/§6-C (solo lectura) y registrar salida | Nulo | Acceso al VPS | Informe con longitudes, fechas y conteos |
| 2 | Si no hay copia reciente: ejecutar `backup-db.js` **a mano** y verificar | Bajo (escribe una copia) | Autorización explícita | Manifest + `.sha256` + `integrity_check ok` |
| 3 | Si la clave maestra falta/es inválida: definirla y re-cifrar el legado | **Alto** (afecta secretos) | Ventana + backup previo | `descifrables = total`, 0 `v1:` con fallback |
| 4 | `git push` de F0–F5 (hook reconstruye) | **Medio** (recrea contenedor, ~1–5 min) | Ventana de mantenimiento | `ops/estado-deploy.sh` → `ESTADO: OK`; `/api/health` 200 |
| 5 | Post-deploy: `verificar-backup.js`, `GET /config` (campo `certificado`), login de prueba | Bajo | — | Verificador `ok`; certificados con estado |
| 6 | Programar el verificador + alerta; copia externa | Bajo | Autorización + credenciales | Alerta de prueba recibida; copia externa descargable |
| 7 | Endurecimiento P2/P3 | Bajo | Planificado | Cabeceras sin `x-powered-by`; HTTP→HTTPS 301 |

**Ninguno de estos pasos se ejecutó.** Este documento es diagnóstico.

---

## 9. Limitaciones declaradas

1. **Sin acceso al VPS**: no se verificó la clave maestra, el cron, las copias,
   los permisos, la salud del contenedor ni el commit desplegado. Todo eso está
   en §6-C con su comando de comprobación.
2. **Las comprobaciones públicas son de solo lectura** (GET/HEAD a rutas
   conocidas), sin autenticación, sin escaneo de puertos ni de rutas. No
   constituyen una auditoría de intrusión.
3. **La versión desplegada se dedujo** comparando hashes de assets estáticos
   (`?v=` = sha1 del contenido), no leyendo el contenedor: es evidencia sólida
   del frontend, no del backend. El backend desplegado se infiere del commit
   documentado (`85f93e9`, 20-oct); **NO VERIFICADO** en el servidor.
4. **No se abrió ningún `.pfx`** ni se consultó dato tributario de clientes.
5. La expiración de los certificados **de las empresas** no se pudo leer: el
   build desplegado no expone ese metadato y leer el `.pfx` requeriría
   descifrarlo (prohibido en esta fase).
