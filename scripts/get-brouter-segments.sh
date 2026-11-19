#!/usr/bin/env bash
# Downloads the BRouter segments (.rd5) into ./data/brouter/segments (outside git). Idempotent: a file already
# present is not downloaded again. Each tile = 5° × 5° (name = south-west corner, e.g. E5_N40 = lon 5–10, lat 40–45).
#
# Usage (from the project root):
#   ./scripts/get-brouter-segments.sh              # tiles around the home point (HOME_LAT/HOME_LON from .env)
#   ./scripts/get-brouter-segments.sh france       # the whole of metropolitan France (≈ 770 MB)
#   ./scripts/get-brouter-segments.sh E5_N40 W5_N40  # tuiles explicites
# Sizes measured on 2026-11-13 (France): W5_N40 88 MB · E0_N40 115 MB · E5_N40 66 MB · W5_N45 62 MB ·
#   E0_N45 122 Mo · E5_N45 242 Mo · E0_N50 76 Mo · W10_N45 < 1 Mo.
# After adding tiles: docker compose restart brouter.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/data/brouter/segments"
mkdir -p "$dir"

tile_of() { # lon lat -> name of the 5° tile
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
  [ -s "$dir/$t.rd5" ] && { echo "$t already present"; continue; }
  curl -fL --retry 3 -o "$dir/$t.rd5.part" "https://brouter.de/brouter/segments4/$t.rd5"
  mv "$dir/$t.rd5.part" "$dir/$t.rd5"
  echo "$t downloaded"
done
du -sh "$dir"
