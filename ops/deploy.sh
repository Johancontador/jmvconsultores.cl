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
    exit 0
  fi
  sleep 5
  restante=$((restante - 5))
done

echo "Deploy SIN healthy tras $((ESPERA_SEGUNDOS / 60)) min — revisar: docker logs $SERVICIO"
exit 1
