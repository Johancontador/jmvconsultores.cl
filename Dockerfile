FROM node:24-bookworm-slim

WORKDIR /app

# build-essential deps for better-sqlite3 in case no prebuilt binary matches
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# El usuario 'node' (uid 1000) necesita escribir /app para instalar las
# dependencias: el chown es NO recursivo (un solo inodo, instantáneo).
#
# Antes había un `RUN chown -R node:node /app` al final: recorría node_modules
# entero en CADA build (medido: 6 min de los ~9 que tardaba el deploy del
# 2026-10-20) y además copiaba todos esos archivos a una capa nueva, hinchando
# la imagen. Con `COPY --chown` y `npm ci` ejecutado como `node`, cada archivo
# nace con el dueño correcto y no hay capa de corrección.
RUN chown node:node /app

COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --omit=dev

COPY --chown=node:node backend ./backend
COPY --chown=node:node frontend ./frontend
# scripts/: backup-db.js y rotar-master-key.js se usan dentro del contenedor
# (cron de backups y ops de bóveda) — sin esto, docker exec falla con MODULE_NOT_FOUND.
COPY --chown=node:node scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3500

# BLOQUE 1bis (P8): ejecutar como usuario NO-root. La imagen oficial node
# trae el usuario 'node' (uid 1000). El volumen ./data del compose debe ser
# escribible por ese uid en el host (en el VPS: chown -R 1000:1000 data).
USER node

CMD ["node", "backend/index.js"]
