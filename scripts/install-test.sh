#!/usr/bin/env bash
# Install test (#1484): distribution compose.yml + init-env.sh on images already built, waits for the
# healthchecks, calls /api/health and /login, then tears down. BRouter snapping is not tested (BROUTER_TILES=none).
#   SINGLETRACK_REGISTRY=local SINGLETRACK_TAG=ci ./scripts/install-test.sh
# Images attendues : $REGISTRY/singletrack, singletrack-brouter, singletrack-tools (tag $TAG).
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
# Inside the project (not /tmp): a Docker installed through snap cannot read /tmp.
work="$(mktemp -d "$src/install-test-tmp.XXXXXX")"
port="${INSTALL_PORT:-3798}"
export COMPOSE_PROJECT_NAME="singletrack-install-$$"
export SINGLETRACK_REGISTRY="${SINGLETRACK_REGISTRY:-ghcr.io/clement83}" SINGLETRACK_TAG="${SINGLETRACK_TAG:-latest}"

cleanup() {
  ( cd "$work" && docker compose ps -a 2>&1 | tail -20; docker compose logs --tail 30 2>&1 | tail -80; docker compose --profile tools down -v ) || true
  rm -rf "$work" 2>/dev/null || true
}
trap cleanup EXIT

# Exactly the files the user downloads.
mkdir -p "$work/scripts"
cp "$src/compose.yml" "$src/.env.example" "$work/"
cp "$src/scripts/init-env.sh" "$work/scripts/"
cd "$work"
./scripts/init-env.sh "http://localhost:$port"
{ echo "APP_PORT=$port"; echo "BROUTER_TILES=none"; } >>.env

# Host whose compose address pool is exhausted (homelab): INSTALL_BRIDGE=1 uses the default bridge network.
if [ -n "${INSTALL_BRIDGE:-}" ]; then
  cat >compose.override.yml <<'YML'
services:
  app: { network_mode: bridge, links: [brouter] }
  brouter: { network_mode: bridge }
  brouter-init: { network_mode: bridge }
  tools: { network_mode: bridge, links: [brouter] }
YML
fi

docker compose up -d --wait --wait-timeout 180
curl -fsS "http://localhost:$port/api/health"; echo
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/login")"
[ "$code" = "200" ] || { echo "/login answered $code" >&2; exit 1; }
# The tools share the database: account creation must work (migrations already applied by the app).
docker compose run --rm tools npm run user:create -- --email ci@example.org --name CI
[ -s data/singletrack.db ] || { echo "base absente de ./data" >&2; exit 1; }
echo "Installation OK."
