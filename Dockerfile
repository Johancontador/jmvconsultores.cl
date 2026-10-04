FROM node:24-bookworm-slim

WORKDIR /app

# build-essential deps for better-sqlite3 in case no prebuilt binary matches
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
# scripts/: backup-db.js y rotar-master-key.js se usan dentro del contenedor
# (cron de backups y ops de bóveda) — sin esto, docker exec falla con MODULE_NOT_FOUND.
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3500

# BLOQUE 1bis (P8): ejecutar como usuario NO-root. La imagen oficial node
# trae el usuario 'node' (uid 1000). El volumen ./data del compose debe ser
# escribible por ese uid en el host (en el VPS: chown -R 1000:1000 data).
RUN chown -R node:node /app
USER node

CMD ["node", "backend/index.js"]
