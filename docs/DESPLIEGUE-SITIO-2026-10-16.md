# Despliegue controlado — sitio público + portal comercial (2026-10-16)

> **Estado: preparado, SIN ejecutar.** No se hizo `push` ni se tocó producción.
> Este documento es la auditoría previa y el runbook reproducible.

Referencias: `docs/SITIO-PUBLICO-2026-10-16.md` (rediseño) ·
`docs/INCIDENCIA-SISTEMA-MOVIL-2026-10-16.md` (defecto aparte, **no** se mezcla aquí).

## 1. Qué se publica

Rango `vps/master..master` — **18 archivos, 0 borrados y 0 renombrados**, en **3
commits de contenido** más los commits de documentación (que no tocan código):

| commit | contenido |
|---|---|
| `97934fd` | feat(portal): seguimiento comercial read-only del dueño en su Portal |
| `1caacf8` | feat(sitio): rediseño unificado de landing, acceso y registro |
| `88f8d55` | fix(login): el botón Mostrar/Ocultar contraseña nunca se enganchaba |
| *commits de docs* | auditoría previa al push, este runbook, la incidencia móvil y este bloqueo |

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
ssh johan@100.116.109.54 'echo VPS_OK; hostname; uptime'
# commit que corre producción = el del repo bare (el árbol de trabajo NO es un repo)
ssh johan@100.116.109.54 'git --git-dir=/home/johan/repos/iva-mensual.git rev-parse HEAD'
git fetch vps master && git rev-list --left-right --count vps/master...master   # esperado: izquierda 0
```

- izquierda `0` → producción es ancestro nuestro: adelante.
- izquierda `> 0` → **DETENER**: producción avanzó, revisar antes de publicar.
- Si `ssh` no responde: comprobar Tailscale (`tailscale status | grep remusaas`) y
  reintentar. **No publicar a ciegas.**

> **Corrección importante (descubierta al ejecutar el 2026-10-16):** el despliegue real
> **es Docker** y lo hace el propio `git push`, no systemd. El repo bare
> `/home/johan/repos/iva-mensual.git` tiene un `hooks/post-receive` que ejecuta
> `git checkout -f master` sobre `GIT_WORK_TREE=/home/johan/apps/iva-mensual` y en
> seguida `docker compose up -d --build`. No existe `/home/johan/iva-mensual`, el árbol
> de trabajo **no es un repo git**, y `jmv-www.service` es el sitio corporativo
> estático (no la app).

### Paso 1 — Respaldo verificable ANTES de tocar nada (en el VPS)

La app vive en la imagen Docker; el runtime y el `.env` están **dentro del contenedor**,
así que los scripts se ejecutan ahí (la BD real es `data/iva_mensual.db` en el host =
`/app/data/iva_mensual.db` en el contenedor):

```bash
ssh johan@100.116.109.54
# commit que corre producción, para el rollback
git --git-dir=/home/johan/repos/iva-mensual.git rev-parse HEAD | tee /home/johan/rollback-target.txt

# respaldo online (seguro con WAL activo) desde dentro del contenedor
docker exec iva-mensual node scripts/backup-db.js
ls -lt /home/johan/apps/iva-mensual/data/backups/*.db.enc | head -3

# verificarlo en carpeta AISLADA (nunca toca la BD real):
docker exec iva-mensual node scripts/restore-db.js \
  --backup /app/data/backups/<ARCHIVO>.db.enc --dest /tmp/restore-verify
```

Criterio de aceptación: el restore termina con `integrity_check` OK, conteos de tablas
críticas y claves SII descifrables. **Un respaldo que no se restauró no es un respaldo.**

### Paso 2 — Publicar (local) — el push DESPLIEGA

```bash
git push vps master       # SIN --force. Si producción avanzó, Git rechaza el push.
```

Un push lanza el `post-receive`: `git checkout -f master` + `docker compose up -d --build`.
Dos consecuencias prácticas:

1. **El push tarda lo que tarda el rebuild** (minutos) porque el hook está enganchado a
   la salida del cliente. Un `[rejected]` significa que alguien movió producción: parar y
   volver al paso 0.
2. **PELIGRO real, observado el 2026-10-16:** si el cliente SSH desaparece a mitad del
   build, el hook queda **colgado escribiendo a un pipe muerto** (proceso vivo, `wchan`
   `futex_wait`, contenedor sin recrear, imagen vieja). No se recupera solo. Cómo
detectarlo y salir del paso:

```bash
# en el VPS: ¿quedó un hook colgado?
ps aux | grep -E 'post-receive|docker compose' | grep -v grep
# desbloquear y relanzar DESACOPLADO de cualquier sesión:
kill <PID-post-receive> <PID-docker-compose>
cd /home/johan/apps/iva-mensual && \
  setsid nohup docker compose up -d --build > /tmp/deploy-build.log 2>&1 < /dev/null &
# y seguir el build por el archivo, no por la sesión:
tail -f /tmp/deploy-build.log
```

### Paso 3 — Verificar en el VPS (el hook ya aplicó el código)

```bash
# el ref del bare ya avanzó y el árbol de trabajo tiene el código nuevo
ls -l /home/johan/apps/iva-mensual/frontend/css/sitio.css | awk '{print $6,$7,$8,$9}'
docker compose -f /home/johan/apps/iva-mensual/docker-compose.yml ps

# ¿corre el contenedor el código publicado? (sha1 por contenido, no por fecha)
docker exec iva-mensual sh -c 'for f in frontend/css/sitio.css frontend/shared/login-auth.js \
  sistema/app.js backend/core/portal-comercial.js; do printf "%-40s %s\n" "$f" $(sha1sum /app/$f | cut -c1-8); done'
# comparar contra `sha1sum` local de los mismos archivos: deben coincidir
```

El contenedor debe quedar `Up (healthy)`. La BD va montada (`data/`), así que no se
recrea: comprobar igualmente los conteos críticos tras el arranque.

### Paso 4 — Comprobación post-deploy (desde fuera)

```bash
for u in / /login.html /registro.html /sistema/; do
  curl -s -o /dev/null -w "%{http_code} %{size_download}B  $u\n" "https://app.jmvconsultores.cl$u"
done
curl -sI https://app.jmvconsultores.cl/css/sitio.css | grep -iE 'cache-control|etag'
```

Esperado: `200` en las cuatro y `cache-control: public, max-age=14400` (verificado el
2026-10-16 en el edge, con `cf-cache-status: MISS` para la URL nueva: el `max-age` no
estorba porque la URL cambió). Comprobar también que las páginas servidas traen los
`?v=` nuevos y que la función nueva responde protegida:

```bash
curl -s https://app.jmvconsultores.cl/login.html | grep -o 'login-auth.js?v=[a-f0-9]*'
curl -s -o /dev/null -w '%{http_code}\n' https://app.jmvconsultores.cl/api/portal/empresas/1/comercial  # 401 sin sesión
```

Y en el navegador: botón *Mostrar* revela la contraseña; menú móvil de la landing abre
y cierra con `Escape`; `/sistema/` sin sesión pide credenciales. **No** probar un envío
de contacto ni logins fallidos contra producción: escriben datos / consumen el
rate-limit real (5 logins y 10 registros por hora e IP).

### Rollback

El rollback es un push hacia atrás: el mismo hook hace checkout y rebuild. Desde el repo
local (donde está el commit anterior anotado en el paso 1, p. ej. `ad09d47`):

```bash
git push --force vps ad09d47:master   # único caso donde un force es legítimo y deliberado
```

La BD **no** necesita restaurarse (el rango no trae migraciones). Solo si algo hubiera
escrito datos de forma indeseada, en el VPS:

```bash
cd /home/johan/apps/iva-mensual
docker compose stop iva-mensual
cp data/backups/<ARCHIVO>.db   data/iva_mensual.db
rm -f data/iva_mensual.db-wal data/iva_mensual.db-shm
docker compose up -d iva-mensual
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
   el hotfix en una segunda ventana. Recomendado publicar los 3 commits de contenido
   juntos (el `88f8d55` arregla un botón roto en la página que se está publicando).

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

### Resolución (23:47 UTC)

**Se recuperó solo.** El túnel volvió a registrar sus cuatro conexiones a las 23:47:38 y
ambos dominios respondieron `200` sin intervención. El host **no se reinició**
(`uptime`: 2 días), así que fue un corte de red del VPS que tumbó a la vez Tailscale y
`cloudflared`: de ahí que un mismo origen diera 1033 (túnel) y `rx 0` (Tailscale) sin que
la app tuviera nada roto.

## 5. Ejecución real — 2026-10-16, 23:50→00:00 UTC

**Desplegado.** `ad09d47` → **`894fb24`** (fast-forward, sin `--force`), contenedor
recreado a las 23:59:45 UTC y `healthy`.

### Precondiciones comprobadas

- Divergencia antes del push: **0 / 6** (producción era ancestro nuestro).
- Árbol de producción: **sin cambios en archivos versionados** (`git diff` vacío), así que
  el `checkout -f` no destruyó nada. Los 4 archivos sueltos (`backend/informe.js`,
  `frontend/css/datagrid.js`, `frontend/reportes.html`, `docker-compose.yml.bak-*`) son
  *untracked* y **ninguno pertenece al rango publicado**.
- Sitio `200` antes de empezar (tras la recuperación del túnel).

### Respaldo y rollback

- Respaldo cifrado `iva_mensual_2026-10-16T23-49-43.db.enc` (AES-256-GCM + manifest + sha256).
- **Restore verificado** en carpeta aislada: integridad `ok`, conteos coincidentes
  (6 usuarios, 6 empresas, 5 clientes, 13.944 documentos, 263 asientos) y **11 claves SII
  descifrables sin error**. La BD real quedó intacta (mismo tamaño y fecha).
- Objetivo de rollback anotado en el VPS: `/home/johan/rollback-target.txt` → `ad09d47`.

### Verificación post-deploy

| comprobación | resultado |
|---|---|
| 7 archivos dentro del contenedor vs local | **sha1 idénticos byte a byte** (`sitio.css 3fc0f66c`, `login-auth.js 8d3d6fa7`, `api.js 80d2c456`, `app.js 01aec88d`, `views-portal.js 240abc40`, `logo-ink.svg b7e09f0a`, `portal-comercial.js d56f084e`) |
| 4 URLs públicas por HTTPS | `/`, `/login.html`, `/registro.html`, `/sistema/` → **200** |
| referencias servidas desde el edge | las nuevas (`login-auth.js?v=8d3d6fa7` incluido) |
| cabecera de caché real | `cache-control: public, max-age=14400` + `cf-cache-status: MISS` en la URL nueva |
| función nueva | `/api/portal/empresas/1/comercial` → **401** sin sesión; entrada `portal-comercial` en el `app.js` servido y en `VIEWS` |
| BD tras el deploy | integridad `ok`, 6 empresas, 13.944 documentos |
| navegador real | landing (8 secciones, sin desborde, identidad aplicada), móvil 390 con menú y `Escape`, **botón Mostrar funciona en producción**, registro con validación en vivo, `/sistema/` pide credenciales |

### Hallazgos de la ejecución (ninguno es un defecto del despliegue)

1. **El hook se cuelga si desaparece el cliente SSH.** Ocurrió: el build quedó vivo pero
   idle (`futex_wait`) escribiendo a un pipe muerto y el contenedor nunca se recreó. Se
   detectó por `ps` y se resolvió matando el hook y relanzando el build con
   `setsid nohup … > /tmp/deploy-build.log`. **Ver §2, paso 2.**
2. **CSP de la app bloquea el beacon de Cloudflare Analytics** en *todas* las páginas
   (`backend/middleware/seguridad-headers.js`), incluida `/sistema/`, que no tocamos:
   preexistente. Deja un error de consola en cada visita y hace que la analítica no mida.
3. **Aviso de jobs al arrancar** (`[JOBS] reanudación sync-diaria falló … 'prepare'`):
   reproducido en local con el mismo código → preexistente y no fatal.
4. Dos aserciones de mi propia auditoría estaban mal, no la app: el umbral de secciones
   (la landing tiene 8, igual que en local) y la validación de campos vacíos, que la hace
   el navegador (`required` sin `novalidate`) sin emitir ninguna petición.

### Pendientes reales que quedan como incidencia (no bloquean)

- CSP vs beacon de Cloudflare Analytics (punto 1 arriba).
- Defecto móvil preexistente de `/sistema/` — `docs/INCIDENCIA-SISTEMA-MOVIL-2026-10-16.md`.
- Aviso de reanudación de `sync-diaria` al arrancar (punto 2 arriba).
