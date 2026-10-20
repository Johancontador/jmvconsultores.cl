#!/bin/bash
# deploy.sh — reconstruye el contenedor y espera a que quede sano.
#
# Lo lanza el hook `post-receive` DESACOPLADO de la sesión que hizo el push
# (setsid + salida a /home/johan/deploy-build.log), para que un cliente SSH que
# desaparezca no pueda colgar el despliegue. Se puede ejecutar a mano:
#
#   cd /home/johan/apps/iva-mensual && bash ops/deploy.sh
#
# Al quedar sano deja un registro legible por máquina en
# /home/johan/deploy-state.json, que lee `ops/estado-deploy.sh`. Hace falta
# porque un push de SOLO documentación mueve HEAD sin reconstruir el
# contenedor: desde ese momento `git rev-parse HEAD` ya no dice qué código corre,
# y hasta 2026-10-20 la única respuesta era leer a mano el log del hook.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
SERVICIO=iva-mensual
ESPERA_SEGUNDOS=${ESPERA_SEGUNDOS:-300} # 5 minutos
ESTADO_DEPLOY=${ESTADO_DEPLOY:-/home/johan/deploy-state.json}
REPO_BARE=${GIT_DIR:-/home/johan/repos/iva-mensual.git}

# Qué commit se despliega y quién lo pidió. Con push lo trae el hook en
# DEPLOY_COMMIT; a mano se asume el HEAD ya aplicado al árbol de trabajo.
if [ -z "${DEPLOY_COMMIT:-}" ]; then
  DEPLOY_COMMIT=$(git --git-dir="$REPO_BARE" rev-parse HEAD 2>/dev/null || echo '')
  DEPLOY_ORIGEN=${DEPLOY_ORIGEN:-manual}
else
  DEPLOY_ORIGEN=${DEPLOY_ORIGEN:-push}
fi
# La comprobación de escritura alimenta el registro: un fallo silencioso (los
# backups del cron) deja de ser invisible al consultar el estado del deploy.
escritura_ok=true

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
      escritura_ok=false
      echo "  AVISO CRÍTICO: el contenedor (uid 1000) NO puede escribir en $dir."
      echo "                 El sistema funcionará, pero los backups del cron fallarán en silencio."
      echo "                 Arréglalo en el host: sudo chown -R 1000:1000 $(pwd)/data"
    fi
  done
}

# Registro del deploy: SOLO se escribe cuando el contenedor quedó sano, así el
# archivo nunca describe un código que no está corriendo. Si un build falla, el
# registro anterior se conserva (y sigue siendo cierto: la imagen vieja sigue
# arriba) y el fallo queda en deploy-build.log.
registrar_estado() {
  local imagen salud intento
  imagen=$(docker inspect -f '{{.Image}}' "$SERVICIO" 2>/dev/null || echo '?')
  salud=$(docker inspect -f '{{.State.Health.Status}}' "$SERVICIO" 2>/dev/null || echo '?')
  intento=$(date -Is)
  cat >"$ESTADO_DEPLOY" <<JSON
{
  "commit": "${DEPLOY_COMMIT:-}",
  "origen": "$DEPLOY_ORIGEN",
  "imagen": "$imagen",
  "salud": "$salud",
  "escritura_ok": $escritura_ok,
  "fecha": "$intento"
}
JSON
  chmod 644 "$ESTADO_DEPLOY" 2>/dev/null
  echo "  estado registrado: $ESTADO_DEPLOY (commit ${DEPLOY_COMMIT:-desconocido}, imagen ${imagen:0:19})"
}

echo "----- build $(date -Is) · commit ${DEPLOY_COMMIT:-desconocido} ($DEPLOY_ORIGEN) -----"
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
    registrar_estado
    exit 0
  fi
  sleep 5
  restante=$((restante - 5))
done

echo "Deploy SIN healthy tras $((ESPERA_SEGUNDOS / 60)) min — revisar: docker logs $SERVICIO"
exit 1
