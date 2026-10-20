# 🚀 Despliegue — De local a producción pública

> **✅ 2026-10-10: SISTEMA EN LÍNEA bajo el dominio corporativo** — el sistema
> contable corre en **https://app.jmvconsultores.cl** (y la landing corporativa en
> jmvconsultores.cl / www), todos vía el túnel Cloudflare `jmv-app` con
> servicios systemd permanentes (`jmv-tunnel` y `jmv-www` en el VPS; el 3500
> recibe la ruta `app` directamente — nginx-iva/8443 queda como fallback).
> La guía operativa detallada (mapa del stack, unit files, playbook de
> incidentes, URLs usadas de la API y el historial de la sesión) vive en el
> VPS: `/home/johan/OPSGUIDE.md`.

Estado actual: **VPS con Docker + nginx** (funcionando). Este documento evalúa los
caminos para exponer la app públicamente con dominio, y recomienda uno.

## Opción A — VPS actual + Cloudflare Tunnel ⭐ recomendada

### Compartir RÁPIDO (Quick Tunnel — sin cuenta, URL temporal)

Para compartir una demo al instante sin dominio ni login de Cloudflare:

```bash
# en el VPS (la URL sale en el log y cambia en cada reinicio):
nohup cloudflared tunnel --url http://127.0.0.1:3500 --no-autoupdate \
  > /home/johan/cloudflared-iva.log 2>&1 &
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /home/johan/cloudflared-iva.log | head -1
```

- **APUNTAR AL 3500 (Express directo), NO al 8080**: nginx-iva redirige
  `http → https://$host:8443` y ese puerto no es alcanzable a través de
  trycloudflare (loop de redirección). Express en 3500 sirve frontend + API.
- La URL es ALEATORIA y muere si el proceso muere o el VPS reinicia —
  es para compartir/compartir-demo, no para producción.
- Túnel PERMANENTE con tu dominio: `cloudflared tunnel login` (interactivo,
  abre navegador), crear túnel con nombre y ruta DNS — ver pasos abajo.

**Por qué:** mantienes tu VPS y su BD local, publicas con dominio real, **cero puertos
abiertos**, TLS automático de Cloudflare, WAF y DDoS gratis.

```
Usuarios → https://ivamensual.tudominio.com → Cloudflare Edge
                                              └─ cloudflared (túnel saliente, en el VPS)
                                                  └─ nginx-iva (8443 interno) → iva-mensual (3500)
```

Pasos en el VPS:

```bash
# 1. Instalar cloudflared y autenticar
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
cloudflared tunnel login

# 2. Crear túnel y ruta (un solo comando por línea)
cloudflared tunnel create iva-mensual
cloudflared tunnel route dns iva-mensual app.tudominio.com

# 3. Config (~/.cloudflared/config.yml):
#   tunnel: iva-mensual
#   credentials-file: /root/.cloudflared/<TUNNEL-ID>.json
#   ingress:
#     - hostname: app.tudominio.com
#       service: https://localhost:8443   # nginx-iva existente
#       originRequest:
#         noTLSVerify: true               # cert autofirmado del nginx
#     - service: http_status:404

# 4. Servicio systemd
cloudflared service install
```

En Cloudflare (dashboard): SSL/TLS **Full (strict)** hacia el edge ya lo maneja el
túnel; activar **Bot Fight Mode** y una regla de rate-limit para `/api/auth/login`.

**Dominio gratis:** si no tienes dominio, opciones sin costo:
- **Cloudflare Registrar no es gratis**, pero un dominio `.cl` cuesta ~US$8/año — la
  alternativa gratuita real es un subdominio de un servicio: `ivamensual.duckdns.org`
  (DuckDNS, gratis) o dominios de prueba de Cloudflare Workers Routes. Para un negocio
  serio se recomienda pagar el `.cl` (~CLP 7.000/año) — barato y profesional.
- DuckDNS + Cloudflare: se puede usar un dominio propio apuntando CNAME al túnel
  aunque el DNS esté en DuckDNS.

## Requisitos operativos del Software Contable (FASE 1+)

En el `.env` del VPS **son obligatorias** estas variables nuevas:

```bash
# Bóveda AES-256-GCM: cifra las claves SII de las empresas en reposo.
# Generar UNA VEZ: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Si cambia después, los secretos cifrados dejan de ser legibles.
SECRETOS_MASTER_KEY=<64-hex>
```

**Tareas programadas en el VPS** (`crontab -e`) — las DOS corren dentro del
contenedor: es la única copia con las dependencias instaladas, y el árbol del
host no tiene `node_modules` propios.

```bash
# Backups (03:00) — la contabilidad es irremplazable
0 3 * * * /usr/bin/docker exec iva-mensual node scripts/backup-db.js >> /home/johan/apps/iva-mensual/logs-backup.log 2>&1
# Sync diaria RCV (07:30)
30 7 * * * /usr/bin/docker exec iva-mensual node scripts/sync-diaria.js >> /home/johan/apps/iva-mensual/logs-sync.log 2>&1
```

- `scripts/backup-db.js` usa el backup online de better-sqlite3 (seguro con el
  servidor en marcha y WAL activo), escribe en `data/backups/` y aplica retención
  configurable (`BACKUP_RETENCION`, default 30 copias).
- `scripts/sync-diaria.js` baja el RCV del mes en curso de todas las empresas
  activas con clave SII (idempotente, reanudable, techo `SII_MAX_EMPRESAS`). La
  auditoría se firma con el admin semilla e `ip = 'script:sync-diaria'` — sin
  usuario explícito (`--usuario`) la corrida abortaba al cerrar por auditoría:
  el cron fallaba todos los días después de haber sincronizado.
- Restaurar: detener servidor → copiar el `.db` elegido a `data/iva_mensual.db` → arrancar.
- Probar el restore una vez al mes: un backup que nunca se restauró no es un backup.

> ⚠️ **El volumen `./data` debe pertenecer al uid 1000** (el contenedor corre
> como `USER node`): `sudo chown -R 1000:1000 ./data`. Si `data/backups` queda de
> root, el contenedor arranca sano y **el backup del cron falla en silencio**
> («unable to open database file»). Ocurrió del 2026-10-10 al 16 (7 noches sin
> backup, detectado al revisar el log). `ops/deploy.sh` ahora comprueba la
> escritura de `/app/data` y `/app/data/backups` al terminar cada despliegue.

## Consultar qué código corre en producción

```bash
ssh johan@100.116.109.54 'bash /home/johan/apps/iva-mensual/ops/estado-deploy.sh'
# exit 0 = todo cuadra · exit 1 = hay algo que revisar (sirve en un cron o un &&)
```

Responde la pregunta que antes solo se podía deducir a mano: **un push de solo
`docs/` o `*.md` no reconstruye el contenedor**, así que `git rev-parse HEAD` puede
quedar por delante del código que realmente está corriendo.

| archivo | quién lo escribe | qué contiene |
|---|---|---|
| `/home/johan/deploy-state.json` | `ops/deploy.sh`, **solo si el contenedor quedó `healthy`** | commit desplegado, origen (`push`/`manual`), id de imagen, salud, verificación de escritura y fecha |
| `/home/johan/deploy-hook.log` | `ops/post-receive` | qué decidió el hook en cada push (rebuild o solo documentación, y a qué commit volvería un rollback) |
| `/home/johan/deploy-build.log` | `ops/deploy.sh` | build, arranque, salud y registro del estado |
| `/home/johan/rollback-target.txt` | `ops/post-receive` | el **código que estaba corriendo** antes del rebuild (no el HEAD previo: tras un push de documentación coincidiría con un commit que nunca llegó a la imagen) |

El verificador contrasta registro ↔ HEAD ↔ contenedor y distingue tres casos que
antes se veían iguales: commits de **solo documentación** por delante (esperado,
`ESTADO: OK`), commits con **código sin desplegar** (`ESTADO: REVISAR`, nombrando un
archivo), y un contenedor que **no es la imagen registrada** (alguien recreó el
servicio por fuera del hook). Los scripts se instalan en el VPS con
`install -m 755 ops/post-receive /home/johan/repos/iva-mensual.git/hooks/post-receive`;
`ops/deploy.sh` y `ops/estado-deploy.sh` se ejecutan desde el árbol de trabajo (ambos
van versionados con bit de ejecución: si el índice los tiene en 644, el `checkout -f`
del hook revierte en silencio cualquier `chmod` manual).

**Si el build falla, el sistema sigue sirviendo:** el registro anterior se conserva y
`ops/estado-deploy.sh` responde `REVISAR` con el commit pendiente, mientras el contenedor
viejo sigue `healthy`. Reintento (manual, no requiere push):

```bash
ssh johan@100.116.109.54 'cd /home/johan/apps/iva-mensual && setsid nohup bash ops/deploy.sh >> /home/johan/deploy-build.log 2>&1 < /dev/null &'
```

Ocurrió el 2026-10-20: `npm ci --omit=dev` abortó al descargar el binario precompilado de
`better-sqlite3` y luego los headers de Node para compilarlo (`node-gyp … TypeError:
terminated`), un corte de red del VPS. El contenedor no se tocó, el registro conservó el
commit en vivo y el reintento entró sin más. Por eso **no** hay que podar la caché de
build del host justo antes de un despliegue: sin capas cacheadas, cada intento vuelve a
depender de la red para `apt-get`, `npm ci` y la compilación del módulo nativo (~7 min en
vez de ~40 s).

## Opción B — PaaS (Render / Railway / Fly.io)

**Por qué:** cero administración, deploy desde GitHub automático.
**Contras:** SQLite en disco efímero en planes gratis (la BD se borra en redeploys);
habría que migrar a Postgres/Turso. Costo: ~US$5-7/mes por el disco persistente.

Adecuada solo si migras la BD. El `Dockerfile` ya sirve tal cual para Fly.io con
volumen montado en `/app/data`.

## Opción C — Solo VPS con IP + DNS propio

La actual con `nginx_prod` expone 8443. Funciona, pero depende de IP/Tailscale, sin
WAF, y el cert es autofirmado (warning del navegador). Es el punto de partida que la
Opción A reemplaza.

## CI/CD con GitHub Actions (`.github/workflows/ci.yml`)

Ya incluido en el repo:

1. **CI**: en cada push/PR → `node --test` de los 4 suites + verificación de sintaxis.
2. **Seguridad**: escaneo de secretos (gitleaks) para que `.env` jamás se suba.
3. Deploy: el VPS hace `git pull` del remote `vps` (bare repo) — para auto-deploy se
   puede añadir un webhook o `watchtower` para Docker; documentado como siguiente paso.

## Checklist de puesta en producción

- [ ] `.env` con `NODE_ENV=production`, `SESSION_DIAS=7`, credenciales fuertes
- [ ] `docker compose up -d --build` y healthcheck en verde
- [ ] Túnel Cloudflare activo + dominio resolvendo
- [ ] Login probado desde Internet + rate-limit verificado
- [ ] Backup de `data/` programado (cron + rclone cifrado)
- [ ] Landing pública revisada (`/`), panel protegido (`/dashboard.html`)
