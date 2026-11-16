#!/usr/bin/env bash
# Test de montée de version (#1485) : une base créée par la version PRÉCÉDENTE doit migrer sans erreur avec la nouvelle,
# et aucune migration déjà publiée ne doit avoir été modifiée (incident 0017).
#   Lancé par la CI (checkout complet, tags) ; en local, le conteneur n'a pas git : voir PREV_MIGRATIONS.
#   UPGRADE_FROM=<réf git> pour choisir la version précédente (défaut : dernier tag vX.Y.Z ; aucun tag ⇒ test ignoré).
set -euo pipefail
cd "$(dirname "$0")/.."

# PREV_MIGRATIONS=<dossier> : migrations de la version précédente déjà extraites (conteneur sans git).
FROM="${UPGRADE_FROM:-$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)}"
if [ -z "$FROM" ] && [ -z "${PREV_MIGRATIONS:-}" ]; then
  echo "Aucune version publiée (tag vX.Y.Z) : test de montée de version ignoré."
  exit 0
fi
echo "Version précédente : $FROM"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
if [ -n "${PREV_MIGRATIONS:-}" ]; then
  PREV="$(cd "$PREV_MIGRATIONS" && pwd)"; FROM="${FROM:-précédente}"
else
  mkdir -p "$WORK/prev"
  git archive "$FROM" src/db/migrations | tar -x -C "$WORK/prev"
  PREV="$WORK/prev/src/db/migrations"
fi
CUR="src/db/migrations"

# 1. Une migration publiée ne se modifie jamais : chaque fichier de l'ancienne version est identique.
for f in "$PREV"/*.sql; do
  b="$(basename "$f")"
  cmp -s "$f" "$CUR/$b" || { echo "ERREUR : la migration publiée $b a été modifiée ou supprimée depuis $FROM (en créer une nouvelle)."; exit 1; }
done
for f in "$PREV"/meta/*_snapshot.json; do
  [ -e "$f" ] || continue
  b="$(basename "$f")"
  cmp -s "$f" "$CUR/meta/$b" || { echo "ERREUR : le snapshot publié $b a été modifié depuis $FROM."; exit 1; }
done

# 2. Base créée par l'ancienne version, puis migrations de la nouvelle.
DB="$WORK/singletrack.db"
MIGRATIONS_DIR="$PREV" DATABASE_URL="$DB" npx tsx src/db/migrate.ts
OLD="$(node -e "const D=require('better-sqlite3');console.log(new D('$DB').prepare('SELECT count(*) n FROM __drizzle_migrations').get().n)")"
DATABASE_URL="$DB" npx tsx src/db/migrate.ts
NEW="$(node -e "const D=require('better-sqlite3');const d=new D('$DB');if(d.prepare('PRAGMA foreign_key_check').all().length)process.exit(2);console.log(d.prepare('SELECT count(*) n FROM __drizzle_migrations').get().n)")"
EXPECTED="$(ls "$CUR"/*.sql | wc -l)"
[ "$NEW" = "$EXPECTED" ] || { echo "ERREUR : $NEW migrations appliquées, $EXPECTED attendues."; exit 1; }
echo "OK : $FROM ($OLD migrations) → version courante ($NEW migrations)."
