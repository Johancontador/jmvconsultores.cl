#!/usr/bin/env bash
# share-link.sh — Enlace público temporal para compartir el sitio
# Uso:   bash deploy/share-link.sh          → crear/mostrar túnel
#        bash deploy/share-link.sh stop     → detener túnel y servidor
#        bash deploy/share-link.sh url      → solo mostrar la URL actual
#
# Usa unidades systemd de usuario: el túnel sobrevive al cierre de la terminal.
set -euo pipefail

export XDG_RUNTIME_DIR="/run/user/$(id -u)"
URL_LOG="journalctl --user -u jmv-share --no-pager"

get_url() {
  $URL_LOG -n 60 2>/dev/null | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
}

case "${1:-}" in
  stop)
    systemctl --user stop jmv-share jmv-www 2>/dev/null || true
    echo "Detenido. Los servicios desaparecen hasta que vuelvas a ejecutar este script."
    exit 0
    ;;
  url)
    URL=$(get_url)
    [[ -n "$URL" ]] && echo "$URL" || { echo "No hay túnel activo. Ejecuta: bash deploy/share-link.sh"; exit 1; }
    exit 0
    ;;
esac

# Ya activo → mostrar URL existente
if systemctl --user is-active --quiet jmv-share 2>/dev/null; then
  echo "✅ Túnel ya activo: $(get_url)"
  exit 0
fi

command -v cloudflared >/dev/null || { echo "Falta cloudflared. Ejecuta antes deploy/setup-tunnel.sh"; exit 1; }

# Servidor de archivos estáticos con la carpeta del proyecto (archivos frescos)
systemctl --user is-active --quiet jmv-www 2>/dev/null || \
  systemd-run --user --unit=jmv-www /usr/bin/python3 -m http.server 8000 --directory "$(pwd)" >/dev/null

# Túnel rápido de Cloudflare (no requiere cuenta ni dominio)
systemd-run --user --unit=jmv-share cloudflared tunnel --url http://localhost:8000 >/dev/null

echo "Creando túnel temporal..."
URL=""
for _ in $(seq 1 15); do
  URL=$(get_url)
  [[ -n "$URL" ]] && break
  sleep 1
done

if [[ -z "$URL" ]]; then
  echo "No se obtuvo URL. Revisa: journalctl --user -u jmv-share -n 30"
  exit 1
fi

echo
echo "✅ Comparte este enlace:"
echo "   $URL"
echo
echo "   Válido mientras la PC esté encendida (los servicios son de tu usuario)."
echo "   El enlace cambia si reinicias el servicio o el equipo."
echo "   Enlace permanente (sin PC): https://johancontador.github.io/jmvconsultores.cl/"
echo "   Detener:  bash deploy/share-link.sh stop"
