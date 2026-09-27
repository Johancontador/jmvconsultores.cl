#!/usr/bin/env bash
#
# setup-tunnel.sh — Publica jmvconsultores.cl vía Cloudflare Tunnel
# ------------------------------------------------------------------
# Qué hace:
#   1. Instala nginx y cloudflared (repo oficial de Cloudflare, apt)
#   2. Publica el sitio en /var/www/jmvconsultores.cl (puerto 8080)
#   3. Registra el túnel con el TOKEN de Cloudflare Zero Trust
#
# Uso (pedirá tu contraseña de sudo):
#   bash deploy/setup-tunnel.sh <TOKEN>
#
# Requisitos previos (en Cloudflare):
#   - Sitio con estado "Active" (nameservers cambiados en NIC Chile)
#   - Túnel creado en Zero Trust → Networks → Tunnels → Create tunnel
#   - Public hostname: jmvconsultores.cl → HTTP → localhost:8080
#     (repite la entrada para www.jmvconsultores.cl)
#
set -euo pipefail

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

say()  { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC}  $*"; }

TOKEN="${1:-}"
if [[ -z "$TOKEN" ]]; then
  echo "Uso: bash deploy/setup-tunnel.sh <TOKEN>"
  echo ""
  echo "El TOKEN se obtiene en: Cloudflare Zero Trust → Networks → Tunnels →"
  echo "Create tunnel → y se ve con el comando 'install cloudflared' que sugiere."
  exit 1
fi

# Aviso de seguridad: el token registra un servicio que corre como root.
# (si ya eres root, también funciona; los `sudo` se ignoran)
warn "El TOKEN se guardará en /etc/cloudflared/ y registrará un servicio systemd (root)."
warn "No compartas el token. Si se filtra: Zero Trust → Tunnels → tu túnel → delete/recreate."
echo

# --- 0. Comprobaciones previas ----------------------------------------------
command -v curl >/dev/null || { echo "Falta curl. Instálalo: sudo apt-get install -y curl"; exit 1; }

# --- 1. Sistema listo --------------------------------------------------------
say "Instalando nginx y cloudflared (puede tardar unos minutos)..."
sudo apt-get update -qq
sudo apt-get install -y -qq nginx

if ! command -v cloudflared >/dev/null; then
  sudo mkdir -p --mode=0755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq cloudflared
fi
say "nginx y cloudflared instalados."

# --- 2. Publicar el sitio ----------------------------------------------------
SITE_DIR="/var/www/jmvconsultores.cl"
say "Publicando sitio en $SITE_DIR ..."
sudo mkdir -p "$SITE_DIR"
sudo cp -r index.html css js assets "$SITE_DIR/"
sudo chown -R www-data:www-data "$SITE_DIR"
say "Sitio copiado a $SITE_DIR"

# --- 3. VirtualHost en el puerto 8080 ---------------------------------------
say "Configurando nginx en puerto 8080..."
sudo tee /etc/nginx/sites-available/jmvconsultores.cl >/dev/null <<'NGINX'
server {
    listen 8080;
    listen [::]:8080;
    server_name jmvconsultores.cl www.jmvconsultores.cl _;

    root /var/www/jmvconsultores.cl;
    index index.html;

    # caché de estáticos
    location ~* \.(css|js|svg|png|jpg|jpeg|webp|ico)$ {
        expires 30d;
        add_header Cache-Control "public";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/jmvconsultores.cl /etc/nginx/sites-enabled/jmvconsultores.cl
sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx
say "nginx sirviendo el sitio en http://localhost:8080"

# --- 4. Registrar el túnel ----------------------------------------------------
say "Registrando el túnel de Cloudflare..."
sudo cloudflared service install "$TOKEN"
sudo systemctl enable --now cloudflared

# --- 5. Verificación ----------------------------------------------------------
sleep 3
say "Comprobando que el sitio responde localmente..."
curl -fsS -o /dev/null -w "  localhost:8080 → HTTP %{http_code}\n" http://localhost:8080/
warn "El sitio remoto puede tardar ~1 min en estar activo. Prueba: https://jmvconsultores.cl"

echo
say "¡Listo! Sitio publicado vía Cloudflare Tunnel."
echo "  → https://jmvconsultores.cl"
echo "  → Logs del túnel:  journalctl -u cloudflared -f"
echo "  → Reinstalar:      sudo cloudflared service install <TOKEN> (repitiendo este script)"
