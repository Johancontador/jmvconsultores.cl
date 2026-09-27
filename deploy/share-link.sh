#!/usr/bin/env bash
# share-link.sh — Genera un enlace público temporal para compartir el sitio
# Uso:  bash deploy/share-link.sh
# El enlace (*.trycloudflare.com) funciona mientras el proceso viva y la PC esté encendida.
set -euo pipefail

LOG=/tmp/jmv-share.log

# ¿Ya hay un túnel rápido corriendo? → mostrar su URL
if pgrep -f "cloudflared tunnel --url" >/dev/null; then
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
  echo "Ya existe un túnel activo:"
  echo "  ${URL:-("(URL en $LOG)")}"
  exit 0
fi

command -v cloudflared >/dev/null || { echo "Falta cloudflared. Ejecuta antes deploy/setup-tunnel.sh"; exit 1; }

nohup cloudflared tunnel --url http://localhost:8080 > "$LOG" 2>&1 &
echo "Creando túnel temporal..."

for i in $(seq 1 10); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" 2>/dev/null | head -1 || true)
  [[ -n "$URL" ]] && break
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "No se obtuvo URL. Revisa $LOG"
  exit 1
fi

echo
echo "✅ Comparte este enlace:"
echo "   $URL"
echo
echo "⚠️  Válido solo mientras tu PC esté encendida y este proceso vivo."
echo "   Enlace permanente (sin PC): https://johancontador.github.io/jmvconsultores.cl/"
echo "   Detener túnel:  pkill -f 'cloudflared tunnel --url'"
