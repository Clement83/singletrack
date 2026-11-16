# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* .npmrc ./
RUN npm install

# Mode développement (#1464, cible utilisée par docker-compose.yml) : `next dev` sur le code monté,
# rechargement à chaud, aucun build. `node_modules` vient de l'image (volume nommé), pas de l'hôte.
FROM deps AS dev
ENV NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/src/db/migrations
RUN mkdir -p /app/.next && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Image de production (non utilisée tant que le projet est en mode dev, #1464).
FROM deps AS builder
COPY . .
RUN npm run build \
 && cp -r .next/static .next/standalone/.next/static \
 && cp -r public .next/standalone/public \
 && mkdir -p data && chown -R node:node /app

# Image finale : on garde devDependencies pour `docker compose exec app npm test|lint`
# (projet perso sur LAN, taille d'image non critique). Serveur = build standalone, utilisateur non root.
FROM builder AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/src/db/migrations
USER node
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]

# Image publiée sur GHCR (#1483) : sans devDependencies, sans sources ni outils de test. Uniquement le build
# standalone (node_modules tracés, dont better-sqlite3 et sharp), les assets, les migrations ; utilisateur non root.
FROM node:22-slim AS release
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/src/db/migrations
WORKDIR /app
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/src/db/migrations ./src/db/migrations
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
