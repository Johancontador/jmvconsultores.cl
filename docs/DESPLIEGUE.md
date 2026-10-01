# 🚀 Despliegue — De local a producción pública

Estado actual: **VPS con Docker + nginx** (funcionando). Este documento evalúa los
caminos para exponer la app públicamente con dominio, y recomienda uno.

## Opción A — VPS actual + Cloudflare Tunnel ⭐ recomendada

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

**Backups diarios** (la contabilidad es irremplazable — programar en cron del VPS):

```bash
# crontab -e
0 3 * * * cd /home/johan/iva-mensual && /usr/bin/node scripts/backup-db.js >> logs-backup.log 2>&1
```

- `scripts/backup-db.js` usa el backup online de better-sqlite3 (seguro con el
  servidor en marcha y WAL activo), escribe en `data/backups/` y aplica retención
  configurable (`BACKUP_RETENCION`, default 30 copias).
- Restaurar: detener servidor → copiar el `.db` elegido a `data/iva_mensual.db` → arrancar.
- Probar el restore una vez al mes: un backup que nunca se restauró no es un backup.

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
