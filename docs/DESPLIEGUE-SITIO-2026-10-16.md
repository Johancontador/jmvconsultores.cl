# Despliegue controlado — sitio público + portal comercial (2026-10-16)

> **Estado: preparado, SIN ejecutar.** No se hizo `push` ni se tocó producción.
> Este documento es la auditoría previa y el runbook reproducible.

Referencias: `docs/SITIO-PUBLICO-2026-10-16.md` (rediseño) ·
`docs/INCIDENCIA-SISTEMA-MOVIL-2026-10-16.md` (defecto aparte, **no** se mezcla aquí).

## 1. Qué se publica

Rango `vps/master..master` — **4 commits, 18 archivos, 0 borrados y 0 renombrados**
(el cuarto commit es este documento y el registro de la incidencia):

| commit | contenido |
|---|---|
| `97934fd` | feat(portal): seguimiento comercial read-only del dueño en su Portal |
| `1caacf8` | feat(sitio): rediseño unificado de landing, acceso y registro |
| `88f8d55` | fix(login): el botón Mostrar/Ocultar contraseña nunca se enganchaba |
| *(commit de docs)* | auditoría previa al push, este runbook y la incidencia móvil |

```
A backend/core/portal-comercial.js      M frontend/registro.html
M backend/routes/portal.js              M frontend/shared/login-auth.js
A docs/SITIO-PUBLICO-2026-10-16.md      M frontend/sistema/app.js
A frontend/assets/logo-ink.svg          M frontend/sistema/index.html
A frontend/css/sitio.css                M frontend/sistema/views-portal.js
M frontend/landing.html                 M package.json
M frontend/login.html                   M scripts/seed-versionado.js
A test/portal-comercial.test.js         A test/sitio-publico.test.js
A docs/DESPLIEGUE-SITIO-2026-10-16.md   A docs/INCIDENCIA-SISTEMA-MOVIL-2026-10-16.md
```

### Punto 1 — ¿puede esto sobrescribir producción o filtrar datos?

- **Estructura:** el deploy es un `git push vps master` a un repo *bare*. Un push
  **no** es `--force`, así que Git lo **rechaza** si producción avanzó: sobrescribir
  cambios posteriores es imposible por diseño. Lo único que hay que hacer es **leer
  el resultado del push**, no asumirlo.
- **Archivos sensibles:** ninguno en el rango. `.gitignore` cubre `data/`, `*.db`,
  `.env`, `nginx/certs/`; el único archivo con pinta sensible versionado es
  `.env.example`. Barrido de patrones de secreto sobre el diff añadido
  (`api_key`, `secret`, `password=`, `Bearer`, `PRIVATE KEY`, `sk-…`): **0 hallazgos**
  (los únicos matches son nombres de fixtures de test).
- **Migración de esquema: ninguna.** `backend/core/portal-comercial.js` es solo
  lectura (no hace `CREATE`/`ALTER`) y no hay archivos de migración en el rango.
  Consecuencia práctica: **el rollback es solo código + reinicio**, la base de datos
  no cambia de forma.
- **Producción pudo moverse y hoy no se puede comprobar (y además está caída, §4).**
  La referencia local
  `vps/master` quedó en `ad09d47` (2026-10-16 14:56, «update by push»), pero el VPS
  **no responde**: `ssh johan@100.116.109.54` agota tiempo (IP Tailscale, puerto 22).
  Por eso el runbook empieza reconectando y re-verificando. Si la izquierda de
  `rev-list --left-right --count vps/master...master` no es `0`, **detener**.
- **Ojo:** `github/master` = `ac05b4d` ≠ `vps/master` = `ad09d47`. GitHub **no** es
  espejo de producción; no sirve para juzgar el estado del VPS.

### Punto 2 — caché de nginx y versionado

- La config nginx **del repo** no fija cabeceras de caché (no hay `expires` ni
  `add_header`): `nginx/default.conf` solo hace de reverse proxy. El `max-age=14400`
  que documenta CLAUDE.md vive en el nginx **del VPS** y **no se pudo verificar hoy**
  (VPS inalcanzable). El mecanismo anti-caché no depende de eso: lo que expira es la
  **URL**, no el archivo.
- Medición local (Express en 3500): `/css/sitio.css` → `Cache-Control: public,
  max-age=0` + `ETag`/`Last-Modified`; lo mismo `.js`. Aun con `max-age=14400`, una
  URL nueva obliga a refetch.
- **Prueba de invalidación por contenido** (ejecutada): se añadió un comentario a
  `sitio.css` → `?v=3fc0f66c` pasó a `?v=6e8c1776` en las tres páginas; se restauró el
  archivo y volvió a `3fc0f66c`; el árbol quedó limpio.
- **Idempotencia:** `npm run seed:v` dos veces seguidas → «Sin cambios: 33
  referencia(s) ya versionadas por contenido», exit 0, árbol limpio.
- **Integridad:** las **33/33** referencias `?v=` de las 4 páginas coinciden con el
  sha1 del archivo real (0 desajustes). Hashes del estado a publicar:
  `sitio.css 3fc0f66c` · `api.js 80d2c456` · `login-auth.js 8d3d6fa7` ·
  `sistema/app.js 01aec88d` · `sistema/views-portal.js 240abc40`.
- **Recursos del sistema:** `frontend/sistema/index.html` cambia **solo 2 líneas**
  (`app.js` y `views-portal.js`, los dos archivos que el rango modifica); las otras
  23 referencias de la app no se tocan.
- **Defecto cosmético conocido (no corregido, fuera de alcance):**
  `seed-versionado.js` informa «N referencia(s) rehashadas» contando referencias
  *visitadas*, no las que realmente cambiaron; con un solo archivo modificado imprime
  «33». Confuso en un log de deploy, inocuo en el resultado.

### Punto 3 — flujos reales, medidos en Chrome

**31 comprobaciones, 0 fallas** sobre el estado exacto a publicar (con las URLs ya
rehasheadas). Usuario temporal creado y eliminado; residuo de `rate_limit` purgado;
base de datos devuelta a su estado inicial (`users` = 3, `contactos_web` = 0,
`usuario_empresa` = 23).

- **Login `/login.html`:** carga sin errores de JS; botón *Mostrar/Ocultar* alterna
  (`type` password↔text); credenciales malas → **401 real** + mensaje en pantalla sin
  navegar; credenciales buenas → `/sistema/`; app monta pantalla real.
- **Landing `/` (1366):** sin desborde; el panel embebido `#acceso` autentica y
  redirige a `/sistema/`; consola sin errores.
- **Landing móvil (390):** sin desborde horizontal; el menú abre, cierra, alterna y
  responde a `Escape`.
- **Contacto:** POST real a `/api/contacto` → confirmación en pantalla **y** fila
  creada en `contactos_web` (verificada y luego eliminada).
- **Registro:** usuario tomado → «✗ ya existe»; usuario libre → «✓ disponible»; RUT con
  DV incorrecto (`76123456-9`) → «✗ RUT inválido»; RUT válido y libre (`76123456-0`) →
  «✓ RUT disponible»; honeypot presente y fuera de foco; todos los campos etiquetados;
  consola sin errores. **No se envía el formulario** (requiere clave SII real).
- **`/sistema/` sin sesión:** pide credenciales en vez de mostrar la app.
- **Rate-limit confirmado en vivo (no un fallo):** 5 intentos de login/15 min por IP →
  **429** con minutos de espera; registro 10/h (`LIMITE_REGISTRO`, `auth.js`).
- **Defecto encontrado y corregido en esta pasada:** `montarLoginPublico`
  (`shared/login-auth.js`) leía `clave` desde el scope del listener de submit →
  `ReferenceError: clave is not defined` al montar y el botón *Mostrar* **nunca
  funcionó** (botón visible que no hace nada). Preexistente en producción (`fe10d99`);
  corregido en `88f8d55`. Fue visible porque el rediseño conserva ese botón.
- **Suite completa:** `npm test` → **480/480, exit 0**.

### Punto 4 — defecto móvil de `/sistema/`: registrado aparte

Medido y documentado en `docs/INCIDENCIA-SISTEMA-MOVIL-2026-10-16.md`, **sin tocar
código**: es previo (`.sys .centro-grid` con columnas fijas de 320 px ya está en
`vps/master`) y mezclarlo aquí ensuciaría este despliegue.

## 2. Runbook — despliegue controlado

Los comandos del VPS van **en el VPS**; los locales, **en este repo**.

### Paso 0 — Reconectar y re-verificar (obligatorio, hoy bloqueado por red)

Primero, ¿está vivo el sitio? (si producción está caída, no es momento de publicar):

```bash
curl -sI https://app.jmvconsultores.cl/ | head -1   # esperado: HTTP/2 200
```

Un `530` con cuerpo `error code: 1033` significa que el túnel Argo de Cloudflare no
encuentra origen: el VPS o `cloudflared` están caídos (ver §4).

```bash
ssh johan@100.116.109.54 'echo VPS_OK; cd /home/johan/iva-mensual && git rev-parse --short HEAD'
git fetch vps master && git rev-list --left-right --count vps/master...master   # esperado: 0  4
```

- izquierda `0` → producción es ancestro nuestro: adelante.
- izquierda `> 0` → **DETENER**: producción avanzó, revisar antes de publicar.
- Si `ssh` no responde: comprobar Tailscale (`tailscale status | grep remusaas`) y
  reintentar. **No publicar a ciegas.**

### Paso 1 — Respaldo verificable ANTES de tocar nada (en el VPS)

```bash
cd /home/johan/iva-mensual
git rev-parse --short HEAD > /tmp/commit-pre-deploy.txt && cat /tmp/commit-pre-deploy.txt
node scripts/backup-db.js                 # backup online (seguro con WAL activo)
ls -lh data/backups/ | tail -3            # .db.enc + manifest si BACKUP_ENCRYPTION_KEY está definida

# Verificar el respaldo elegido en carpeta AISLADA (nunca toca la BD real):
node scripts/restore-db.js --backup data/backups/<ARCHIVO>.db.enc --dest "$HOME/restore-pre-deploy"
```

Criterio de aceptación: el restore termina con `integrity_check` OK, conteos de tablas
críticas y claves SII descifrables. **Un respaldo que no se restauró no es un respaldo.**

### Paso 2 — Publicar (local)

```bash
git push vps master       # SIN --force. Si producción avanzó, Git rechaza el push.
```

Leer la salida: `ad09d47..<sha-del-último-commit>  master -> master`. Un `[rejected]` significa que
alguien movió producción: parar y volver al paso 0.

### Paso 3 — Aplicar en el VPS y reiniciar

```bash
cd /home/johan/iva-mensual
git fetch && git log --oneline -4          # confirmar los 4 commits
git pull                                    # fast-forward; si pide merge, parar
node scripts/seed-versionado.js             # debe decir «Sin cambios: 33 …»
systemctl list-units --type=service | grep -i jmv    # confirmar el nombre real (jmv-www)
systemctl restart jmv-www && systemctl status jmv-www --no-pager | head -12
```

### Paso 4 — Comprobación post-deploy (desde fuera)

```bash
for u in / /login.html /registro.html /sistema/; do
  curl -s -o /dev/null -w "%{http_code} %{size_download}B  $u\n" "https://app.jmvconsultores.cl$u"
done
curl -sI https://app.jmvconsultores.cl/css/sitio.css | grep -iE 'cache-control|etag'
```

Esperado: `200` en las cuatro; el CSS con la referencia `?v=3fc0f66c`; y — si el nginx
del VPS añade `max-age`, que eso **no** impida el refetch porque la URL es nueva.
Luego, en el navegador: login correcto → `/sistema/`; botón *Mostrar* revela la
contraseña; menú móvil de la landing abre con `Escape`; un envío de contacto de prueba
aparece en `contactos_web` (y se borra).

### Rollback

```bash
# En el VPS
cd /home/johan/iva-mensual
git reset --hard "$(cat /tmp/commit-pre-deploy.txt)"   # volver al commit anotado en el paso 1
node scripts/seed-versionado.js                        # rehash por contenido
systemctl restart jmv-www
```

La BD **no** necesita restaurarse (el rango no trae migraciones). Solo si algo hubiera
escrito datos de forma indeseada:

```bash
systemctl stop jmv-www
cp data/backups/<ARCHIVO>.db data/iva_mensual.db
rm -f data/iva_mensual.db-wal data/iva_mensual.db-shm
systemctl start jmv-www
```

Nota: los cambios de `/sistema/` son cosméticos desde el cliente (URLs `?v=` nuevas);
el rollback de código no requiere purgar cachés.

## 3. Verificaciones pendientes (documentadas, NO bloqueantes)

1. **Lighthouse / dispositivo real:** no ejecutado.
2. **Registro end-to-end contra el SII:** requiere clave tributaria real; la validación
   en vivo sí quedó probada.
3. **Cabeceras reales del nginx del VPS:** no verificadas hoy (VPS inalcanzable); el
   anti-caché no depende de ellas.
4. **Decisión del usuario:** si prefiere publicar solo `97934fd` + `1caacf8` y dejar el
   hotfix `88f8d55` para después, es posible: `git push vps 1caacf8:master` y desplegar
   el hotfix en una segunda ventana. Recomendado publicar los 4 juntos (el `88f8d55`
   arregla un botón roto en la página que se está publicando).

## 4. Bloqueo de ejecución — 2026-10-16 23:42 · VPS fuera de línea

**Autorización recibida; despliegue NO ejecutado por indisponibilidad de la
infraestructura.** Nada empujado, nada desplegado, ningún cambio en producción.

### Diagnóstico (tres señales independientes)

| comprobación | resultado |
|---|---|
| `https://app.jmvconsultores.cl/` | **HTTP 530**, cuerpo `error code: 1033` (17 bytes) — túnel Argo sin origen |
| `https://jmvconsultores.cl/` | **HTTP 530** — afecta a los dos dominios, no solo a la app |
| Tailscale peer `remusaas` (100.116.109.54) | `offline, last seen 1h ago, tx 6240 rx 0` |
| `tailscale ping` / TCP 22·443·8443·8080 | sin respuesta en los cuatro puertos |
| DNS | resuelve a Cloudflare (188.114.96.5): el DNS no es la causa |

El error 1033 (no 521/522) apunta al túnel, pero el `rx 0` de Tailscale y los puertos
muertos apuntan a la máquina: **el VPS está fuera de línea**, y con él el sitio público.
Es un incidente de operación, independiente de este despliegue.

### Rutas de acceso: no hay Plan B

Buscado en todo el repo: **no hay IP pública ni host alterno** para el VPS; el único
acceso documentado es SSH por Tailscale (`ssh://johan@100.116.109.54/...`).
`.github/workflows/` solo tiene `ci.yml` (CI, no deploy). En la máquina local existen las
claves `~/.ssh/id_ed25519` e `~/.ssh/id_geodaniela` (la segunda es la que cita
`docs/PLAN.md`), pero el bloqueo es de **red**, no de autenticación: no respondería
ninguna clave. Conclusión: hace falta que el host vuelva, no otra credencial.

### Al volver el VPS, en este orden

1. Confirmar que el sitio responde: `curl -sI https://app.jmvconsultores.cl/ | head -1` → `200`.
2. `systemctl status jmv-tunnel cloudflared --no-pager` — es el servicio que da el 1033
   si murió; `journalctl -u jmv-tunnel -n 50 --no-pager` para ver por qué.
3. `systemctl status jmv-www` (o `docker ps`) y `uptime` — distinguir «host reinició» de
   «proceso caído».
4. Recién entonces ejecutar el runbook desde el paso 0.

### Razón por la que un 1033 no cambia el plan de despliegue

El sitio estaba caído **antes** de tocar nada: el estado previo de producción no se
puede confirmar por HTTP, así que el paso 0 (comparar `vps/master` contra `master` y
revisar que el push sea fast-forward) sigue siendo el único control válido y hay que
ejecutarlo igual, con el sitio ya arriba.
