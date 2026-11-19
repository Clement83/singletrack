#!/usr/bin/env bash
# Upgrade test (#1485): a database created by the PREVIOUS version must migrate without error with the new one,
# and no migration already published may have been modified (incident 0017).
#   Run by CI (full checkout, tags); locally, the container has no git: see PREV_MIGRATIONS.
#   UPGRADE_FROM=<git ref> to choose the previous version (default: last vX.Y.Z tag; no tag ⇒ test skipped).
set -euo pipefail
cd "$(dirname "$0")/.."

# PREV_MIGRATIONS=<folder>: migrations of the previous version already extracted (container without git).
FROM="${UPGRADE_FROM:-$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)}"
if [ -z "$FROM" ] && [ -z "${PREV_MIGRATIONS:-}" ]; then
  echo "No published version (vX.Y.Z tag): upgrade test skipped."
  exit 0
fi
echo "Previous version: $FROM"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "${PREV_MIGRATIONS:-}" ]; then
  PREV="$(cd "$PREV_MIGRATIONS" && pwd)"; FROM="${FROM:-previous}"
else
  mkdir -p "$WORK/prev"
  git archive "$FROM" src/db/migrations | tar -x -C "$WORK/prev"
  PREV="$WORK/prev/src/db/migrations"
fi
CUR="src/db/migrations"

# 1. A published migration is never modified: every file of the old version is identical.
for f in "$PREV"/*.sql; do
  b="$(basename "$f")"
  cmp -s "$f" "$CUR/$b" || { echo "ERROR: published migration $b was modified or deleted since $FROM (create a new one instead)."; exit 1; }
done
for f in "$PREV"/meta/*_snapshot.json; do
  [ -e "$f" ] || continue
  b="$(basename "$f")"
  cmp -s "$f" "$CUR/meta/$b" || { echo "ERROR: published snapshot $b was modified since $FROM."; exit 1; }
done

# 2. Database created by the old version, then the new version's migrations.
DB="$WORK/singletrack.db"
MIGRATIONS_DIR="$PREV" DATABASE_URL="$DB" npx tsx src/db/migrate.ts
OLD="$(node -e "const D=require('better-sqlite3');console.log(new D('$DB').prepare('SELECT count(*) n FROM __drizzle_migrations').get().n)")"
DATABASE_URL="$DB" npx tsx src/db/migrate.ts
NEW="$(node -e "const D=require('better-sqlite3');const d=new D('$DB');if(d.prepare('PRAGMA foreign_key_check').all().length)process.exit(2);console.log(d.prepare('SELECT count(*) n FROM __drizzle_migrations').get().n)")"
EXPECTED="$(ls "$CUR"/*.sql | wc -l)"
[ "$NEW" = "$EXPECTED" ] || { echo "ERROR: $NEW migrations applied, $EXPECTED expected."; exit 1; }
echo "OK : $FROM ($OLD migrations) → version courante ($NEW migrations)."
