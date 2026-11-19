# syntax=docker/dockerfile:1
FROM node:22-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/* \
 && chown node:node /app
# Everything below runs as `node` and owns its files from the start (#1673): no `chown -R` of /app, which on
# overlayfs rewrote all of node_modules into a new layer (20+ minutes on a slow disk, worse under QEMU).
USER node
COPY --chown=node:node package.json package-lock.json .npmrc ./
# `npm ci` (lockfile as is) with a persistent npm cache between builds (#1673).
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci --no-audit --no-fund

# Development target (#1464, used by docker-compose.yml app-dev): `next dev` on the mounted code,
# hot reload, no build. `node_modules` comes from the image (named volume), not from the host.
FROM deps AS dev
ENV NODE_ENV=development NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/src/db/migrations
RUN mkdir -p /app/.next
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Production build stage (shared by the `runner` and `release` targets).
FROM deps AS builder
COPY --chown=node:node . .
# .next must exist and belong to `node` before the cache mount below (otherwise BuildKit creates it as root).
RUN mkdir -p .next
# Next.js build cache kept between builds; types are checked by the CI job (`tsc --noEmit`), not again here (#1673).
RUN --mount=type=cache,target=/app/.next/cache,uid=1000,gid=1000 \
    SKIP_TYPECHECK=1 npm run build \
 && cp -r .next/static .next/standalone/.next/static \
 && cp -r public .next/standalone/public \
 && mkdir -p data

# Full image (`singletrack-tools`): keeps devDependencies and sources for one-off scripts (syncs, accounts)
# and tests. Server = standalone build, non-root user.
FROM builder AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MIGRATIONS_DIR=/app/src/db/migrations
EXPOSE 3000
CMD ["node", ".next/standalone/server.js"]

# Image published on GHCR (#1483): no devDependencies, no sources or test tools. Only the standalone build
# (traced node_modules, including better-sqlite3 and sharp), the assets and the migrations; non-root user.
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
