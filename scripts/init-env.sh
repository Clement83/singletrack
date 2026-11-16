#!/usr/bin/env bash
# Prépare une installation (#1484) : crée .env depuis .env.example, génère les secrets, crée ./data.
#   ./scripts/init-env.sh [URL_PUBLIQUE]     ex. https://vtt.example.org ou http://<IP_LAN>:3700
# Idempotent : un .env existant est conservé, seuls les secrets encore à « change-me » ou vides sont générés.
# Sans URL, BETTER_AUTH_URL reste à modifier à la main dans .env.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env.example ] || { echo ".env.example introuvable (à télécharger à côté de ce script)." >&2; exit 1; }
if [ -f .env ]; then echo ".env existe : conservé."; else cp .env.example .env; echo ".env créé."; fi

secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 32
  else head -c 32 /dev/urandom | base64; fi
}
# set_var CLE VALEUR : remplace la ligne CLE=… (ou l'ajoute).
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
  if needs_secret "$k"; then set_var "$k" "$(secret)"; echo "$k généré."; fi
done
# FEDERATION_KEY_ENC : active la fédération (par défaut `on` dès que la clé existe, #1477) ; à ne jamais changer ensuite.
if needs_secret FEDERATION_KEY_ENC; then set_var FEDERATION_KEY_ENC "$(secret)"; echo "FEDERATION_KEY_ENC généré."; fi

# Les fichiers de ./data appartiennent à l'utilisateur qui lance ce script (le conteneur tourne sous cet identifiant).
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
