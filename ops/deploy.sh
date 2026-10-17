#!/bin/bash
# deploy.sh — reconstruye el contenedor y espera a que quede sano.
#
# Lo lanza el hook `post-receive` DESACOPLADO de la sesión que hizo el push
# (setsid + salida a /home/johan/deploy-build.log), para que un cliente SSH que
# desaparezca no pueda colgar el despliegue. Se puede ejecutar a mano:
#
#   cd /home/johan/apps/iva-mensual && bash ops/deploy.sh

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SERVICIO=iva-mensual
ESPERA_SEGUNDOS=${ESPERA_SEGUNDOS:-300} # 5 minutos

# El contenedor corre como uid 1000 (Dockerfile: USER node) y escribe el volumen
# ./data: el WAL de SQLite y data/backups (cron de las 03:00). Si un directorio
# queda de root, el contenedor arranca «sano» pero el backup del cron falla en
# SILENCIO con «unable to open database file». Pasó del 2026-10-10 al 16: la
# imagen pasó a USER node con data/backups ya creado por la etapa root, y solo
# se detectó cuando alguien revisó el log a mano.
verificar_escritura() {
  for dir in /app/data /app/data/backups; do
    if docker exec "$SERVICIO" node -e "require('fs').writeFileSync('$dir/.escritura-deploy','x');require('fs').rmSync('$dir/.escritura-deploy')" 2>/dev/null; then
      echo "  escritura del contenedor en $dir: OK"
    else
      echo "  AVISO CRÍTICO: el contenedor (uid 1000) NO puede escribir en $dir."
      echo "                 El sistema funcionará, pero los backups del cron fallarán en silencio."
      echo "                 Arréglalo en el host: sudo chown -R 1000:1000 $(pwd)/data"
    fi
  done
}

echo "----- build $(date -Is) -----"
if ! docker compose up -d --build; then
  echo "Deploy FALLÓ: docker compose up -d --build devolvió error ($(date -Is))"
  exit 1
fi

restante=$ESPERA_SEGUNDOS
while [ "$restante" -gt 0 ]; do
  salud=$(docker inspect -f '{{.State.Health.Status}}' "$SERVICIO" 2>/dev/null || echo ausente)
  echo "  salud: $salud"
  if [ "$salud" = "healthy" ]; then
    echo "Deploy OK $(date -Is)"
    verificar_escritura
    exit 0
  fi
  sleep 5
  restante=$((restante - 5))
done

echo "Deploy SIN healthy tras $((ESPERA_SEGUNDOS / 60)) min — revisar: docker logs $SERVICIO"
exit 1
