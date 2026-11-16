#!/usr/bin/env bash
# Télécharge les segments BRouter (.rd5) dans ./data/brouter/segments (hors git). Idempotent : un fichier déjà
# présent n'est pas retéléchargé. Chaque tuile = 5° × 5° (nom = coin sud-ouest, ex. E5_N40 = lon 5–10, lat 40–45).
#
# Usage (depuis la racine du projet) :
#   ./scripts/get-brouter-segments.sh              # tuiles de la zone du point maison (HOME_LAT/HOME_LON du .env)
#   ./scripts/get-brouter-segments.sh france       # France métropolitaine entière (≈ 770 Mo)
#   ./scripts/get-brouter-segments.sh E5_N40 W5_N40  # tuiles explicites
# Tailles mesurées le 2026-11-13 (France) : W5_N40 88 Mo · E0_N40 115 Mo · E5_N40 66 Mo · W5_N45 62 Mo ·
#   E0_N45 122 Mo · E5_N45 242 Mo · E0_N50 76 Mo · W10_N45 < 1 Mo.
# Après un ajout de tuiles : docker compose restart brouter.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/data/brouter/segments"
mkdir -p "$dir"

tile_of() { # lon lat -> nom de tuile 5°
  awk -v lon="$1" -v lat="$2" 'BEGIN {
    x = int(lon / 5); if (lon < 0 && x * 5 != lon) x -= 1; x *= 5
    y = int(lat / 5); if (lat < 0 && y * 5 != lat) y -= 1; y *= 5
    printf "%s%d_%s%d\n", (x < 0 ? "W" : "E"), (x < 0 ? -x : x), (y < 0 ? "S" : "N"), (y < 0 ? -y : y)
  }'
}

if [ "$#" -eq 0 ]; then
  lat="${HOME_LAT:-}"; lon="${HOME_LON:-}"
  if [ -z "$lat" ] && [ -f "$root/.env" ]; then
    lat="$(grep -E '^HOME_LAT=' "$root/.env" | tail -1 | cut -d= -f2 | tr -d '"' || true)"
    lon="$(grep -E '^HOME_LON=' "$root/.env" | tail -1 | cut -d= -f2 | tr -d '"' || true)"
  fi
  lat="${lat:-46.6}"; lon="${lon:-2.4}"
  tiles=("$(tile_of "$lon" "$lat")")
  echo "Zone du point maison ($lat, $lon) : ${tiles[0]} (autres zones : passer les tuiles en argument, ou « france »)"
elif [ "$1" = "france" ]; then
  tiles=(E5_N40 E0_N40 W5_N40 W5_N45 E0_N45 E5_N45 E0_N50 W10_N45)
else
  tiles=("$@")
fi

for t in "${tiles[@]}"; do
  [[ "$t" =~ ^[EW][0-9]+_[NS][0-9]+$ ]] || { echo "Nom de tuile invalide : $t" >&2; exit 1; }
  [ -s "$dir/$t.rd5" ] && { echo "$t déjà présent"; continue; }
  curl -fL --retry 3 -o "$dir/$t.rd5.part" "https://brouter.de/brouter/segments4/$t.rd5"
  mv "$dir/$t.rd5.part" "$dir/$t.rd5"
  echo "$t téléchargé"
done
du -sh "$dir"
