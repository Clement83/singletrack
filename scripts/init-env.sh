#!/usr/bin/env bash
# Prepares an install (#1484): creates .env from .env.example, generates the secrets, creates ./data.
#   ./scripts/init-env.sh [PUBLIC_URL]     e.g. https://mtb.example.org or http://<LAN_IP>:3700
# Idempotent: an existing .env is kept, only secrets still set to "change-me" or empty are generated.
# Without a URL, BETTER_AUTH_URL has to be edited by hand in .env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.example ] || { echo ".env.example not found (download it next to this script)." >&2; exit 1; }
if [ -f .env ]; then echo ".env exists: kept."; else cp .env.example .env; echo ".env created."; fi

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 32
  else head -c 32 /dev/urandom | base64; fi
}
# set_var KEY VALUE: replaces the KEY=… line (or adds it).
set_var() {
  local k="$1" v="$2" tmp; tmp="$(mktemp)"
  if grep -qE "^$k=" .env; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{print k "=" v; next} {print}' .env >"$tmp"
  else
    { cat .env; echo "$k=$v"; } >"$tmp"
  fi
  cat "$tmp" >.env; rm -f "$tmp"
}
needs_secret() { local cur; cur="$(grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true)"; [ -z "$cur" ] || [ "$cur" = "change-me" ]; }

for k in BETTER_AUTH_SECRET INVITE_LINK_KEY; do
  if needs_secret "$k"; then set_var "$k" "$(secret)"; echo "$k generated."; fi
done
# FEDERATION_KEY_ENC: turns federation on (on by default as soon as the key exists, #1477); never change it afterwards.
if needs_secret FEDERATION_KEY_ENC; then set_var FEDERATION_KEY_ENC "$(secret)"; echo "FEDERATION_KEY_ENC generated."; fi

# The files in ./data belong to the user running this script (the container runs under that id).
grep -qE '^APP_UID=' .env || set_var APP_UID "$(id -u)"
grep -qE '^APP_GID=' .env || set_var APP_GID "$(id -g)"
mkdir -p data/brouter/segments

if [ "$#" -ge 1 ]; then
  url="${1%/}"
  case "$url" in http://*|https://*) ;; *) echo "URL invalide (http:// ou https:// attendu) : $url" >&2; exit 1 ;; esac
  set_var BETTER_AUTH_URL "$url"
  set_var AUTH_TRUSTED_ORIGINS "$url"
  case "$url" in http://*) set_var AUTH_SECURE_COOKIES false ;; *) set_var AUTH_SECURE_COOKIES true ;; esac
  echo "Adresse : $url"
fi

echo "Sauvegardez .env avec ./data : INVITE_LINK_KEY et FEDERATION_KEY_ENC ne doivent jamais changer."
echo "Étape suivante : docker compose up -d"
