#!/bin/bash
# estado-deploy.sh — ¿qué código está corriendo en producción?
#
#   bash /home/johan/apps/iva-mensual/ops/estado-deploy.sh
#
# Sale con 0 si todo cuadra y con 1 si hay algo que revisar (sirve para encadenar
# en un cron o en un `&&`). No escribe nada: solo lee el registro que dejó
# ops/deploy.sh, el repo bare y el contenedor.
#
# Por qué existe: el hook NO reconstruye cuando el push es de solo documentación,
# así que HEAD puede quedar por delante del código que corre. Antes eso solo se
# deducía leyendo /home/johan/deploy-hook.log a mano y comparando el log con la
# fecha de arranque del contenedor; ahora hay un hecho registrado por deploy y
# esta vista que lo contrasta.

set -uo pipefail

SERVICIO=${SERVICIO:-iva-mensual}
ESTADO_DEPLOY=${ESTADO_DEPLOY:-/home/johan/deploy-state.json}
REPO_BARE=${GIT_DIR:-/home/johan/repos/iva-mensual.git}
ARBOL=${GIT_WORK_TREE:-/home/johan/apps/iva-mensual}

rojo() { printf '\033[31m%s\033[0m\n' "$*"; }
verde() { printf '\033[32m%s\033[0m\n' "$*"; }
ambar() { printf '\033[33m%s\033[0m\n' "$*"; }

avisos=()
avisar() { avisos+=("$*"); }

campo() { sed -n "s/^ *\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$ESTADO_DEPLOY" 2>/dev/null | head -1 | tr -d '\r'; }

# Una sola lectura del contenedor, sin saltos ni avisos de docker mezclados con el
# valor: si el servicio no existe, la variable queda vacía y se decide con eso.
docker_campo() { docker inspect -f "$1" "$SERVICIO" 2>/dev/null | tr -d '\r' | head -1; }

echo "=============================================="
echo " Estado del despliegue — $SERVICIO"
echo "=============================================="

commit=$(campo commit)
origen=$(campo origen)
imagen_reg=$(campo imagen)
salud_reg=$(campo salud)
escritura=$(sed -n 's/^ *"escritura_ok": *\([a-z]*\).*/\1/p' "$ESTADO_DEPLOY" 2>/dev/null | head -1)
fecha=$(campo fecha)

if [ -z "$commit" ]; then
  ambar " registro      : SIN registro en $ESTADO_DEPLOY"
  avisar "no hay registro de deploy: el código que corre no está identificado (ejecuta bash ops/deploy.sh para crearlo)"
else
  printf " registro      : %s (%s · %s)\n" "${commit:0:12}" "$origen" "${fecha:-sin fecha}"
fi

# Contenedor real
imagen_actual=$(docker_campo '{{.Image}}')
salud_actual=$(docker_campo '{{.State.Health.Status}}')
arranque=$(docker_campo '{{.State.StartedAt}}')
printf " contenedor    : %s, arriba desde %s\n" "${salud_actual:-ausente}" "${arranque:-?}"

if [ -n "$imagen_actual" ]; then
  if [ -n "$imagen_reg" ] && [ "$imagen_reg" != '?' ] && [ "$imagen_actual" != "$imagen_reg" ]; then
    ambar " imagen        : ${imagen_actual:0:19} (registrada: ${imagen_reg:0:19})"
    avisar "el contenedor NO es el que registró el último deploy: alguien recreó el servicio con otra imagen"
  else
    printf " imagen        : %s\n" "${imagen_actual:0:19}"
  fi
else
  avisar "el contenedor $SERVICIO no existe o docker no responde"
fi

if [ -n "$imagen_actual" ] && [ "$salud_actual" != 'healthy' ]; then
  avisar "el contenedor está '${salud_actual:-desconocido}', no 'healthy'"
fi
[ "${escritura:-true}" = 'false' ] && avisar "el contenedor no pudo escribir en /app/data o /app/data/backups (los backups del cron fallarían en silencio)"

# HEAD del repositorio bare vs commit desplegado
head=$(git --git-dir="$REPO_BARE" rev-parse HEAD 2>/dev/null || echo '')
if [ -z "$head" ]; then
  avisar "no se pudo leer HEAD en $REPO_BARE"
else
  printf " HEAD del repo : %s\n" "${head:0:12}"
  if [ -n "$commit" ]; then
    if git --git-dir="$REPO_BARE" merge-base --is-ancestor "$commit" "$head" 2>/dev/null; then
      adelante=$(git --git-dir="$REPO_BARE" rev-list --count "$commit..$head" 2>/dev/null || echo 0)
      if [ "$adelante" = '0' ]; then
        printf " diferencia    : ninguna, HEAD es el código desplegado\n"
      else
        codigo=$(git --git-dir="$REPO_BARE" diff --name-only "$commit" "$head" 2>/dev/null | grep -vE '^(docs/|.*\.md$)' || true)
        printf " diferencia    : %s commit(s) por delante del desplegado\n" "$adelante"
        git --git-dir="$REPO_BARE" log --oneline --no-decorate "$commit..$head" 2>/dev/null | head -5 | sed 's/^/                 · /'
        if [ -n "$codigo" ]; then
          avisar "hay $adelante commit(s) con CÓDIGO sin desplegar (p. ej. $(echo "$codigo" | head -1))"
        else
          printf "                 solo documentación: el hook no reconstruye por docs (esperado)\n"
        fi
      fi
    else
      avisar "el commit desplegado (${commit:0:12}) no es ancestro de HEAD (${head:0:12}): ¿rollback con --force o reset?"
    fi
  fi
fi

echo "----------------------------------------------"
if [ ${#avisos[@]} -eq 0 ]; then
  verde "ESTADO: OK — el contenedor corre el código registrado."
  exit 0
fi
for a in "${avisos[@]}"; do rojo "ESTADO: REVISAR — $a"; done
exit 1
