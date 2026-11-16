#!/usr/bin/env bash
# Test de fumée de l'image de production (#1482) : construit la cible `runner`, la démarre sur une base
# d'exemple et lance scripts/smoke.mjs. Utilisé par la CI ; relançable en local (a besoin de Docker).
#   ./scripts/smoke-docker.sh            # construit l'image
#   SMOKE_IMAGE=singletrack:ci ./scripts/smoke-docker.sh   # image déjà construite
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${SMOKE_IMAGE:-singletrack-smoke:local}"
NAME="singletrack-smoke-$$"
PORT="${SMOKE_PORT:-3799}"
[ -n "${SMOKE_IMAGE:-}" ] || docker build --target runner -t "$IMAGE" .

cleanup() { docker logs "$NAME" 2>&1 | tail -40 || true; docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ENVS=(-e BETTER_AUTH_SECRET=smoke-secret-smoke-secret-smoke-secret -e INVITE_LINK_KEY="$(head -c 32 /dev/zero | base64)"
  -e BETTER_AUTH_URL="http://localhost:$PORT" -e AUTH_TRUSTED_ORIGINS="http://localhost:$PORT" -e DATABASE_URL=/tmp/smoke/singletrack.db)

# Base d'exemple : migrations appliquées + une trace publique, dans l'image elle-même.
SLUG="$(docker run --rm --name "$NAME-seed" "${ENVS[@]}" -v "$NAME-data:/tmp/smoke" --user root "$IMAGE" \
  sh -c 'chown node /tmp/smoke && su node -s /bin/sh -c "npx tsx scripts/smoke-seed.ts"' | tail -1)"
echo "Trace d'exemple : $SLUG"

docker run -d --name "$NAME" -p "$PORT:3000" "${ENVS[@]}" -v "$NAME-data:/tmp/smoke" "$IMAGE" >/dev/null
trap 'cleanup; docker volume rm "$NAME-data" >/dev/null 2>&1 || true' EXIT

SMOKE_URL="http://localhost:$PORT" SMOKE_SLUG="$SLUG" node scripts/smoke.mjs
