#!/bin/sh
# Downloads the BRouter tiles (.rd5) into /segments on first start (#1484). Idempotent: a tile already
# present is not downloaded again. Never fails the start-up (without tiles, the editor falls back to straight lines).
#   BROUTER_TILES=france                 metropolitan France (≈ 770 MB, default)
#   BROUTER_TILES=home                   only the 5° tile of HOME_LAT/HOME_LON
#   BROUTER_TILES=E5_N40,W5_N40          explicit tiles (name = south-west corner of a 5° tile)
#   BROUTER_TILES=none                   download nothing
dir=/segments
spec="${BROUTER_TILES:-france}"
mkdir -p "$dir" 2>/dev/null || true

case "$spec" in
  none) echo "BROUTER_TILES=none : aucun téléchargement."; exit 0 ;;
  france) tiles="E5_N40 E0_N40 W5_N40 W5_N45 E0_N45 E5_N45 E0_N50 W10_N45" ;;
  home)
    tiles="$(awk -v lon="${HOME_LON:-2.4}" -v lat="${HOME_LAT:-46.6}" 'BEGIN {
      x = int(lon / 5); if (lon < 0 && x * 5 != lon) x -= 1; x *= 5
      y = int(lat / 5); if (lat < 0 && y * 5 != lat) y -= 1; y *= 5
      printf "%s%d_%s%d\n", (x < 0 ? "W" : "E"), (x < 0 ? -x : x), (y < 0 ? "S" : "N"), (y < 0 ? -y : y) }')" ;;
  *) tiles="$(echo "$spec" | tr ',' ' ')" ;;
esac

for t in $tiles; do
  case "$t" in
    [EW][0-9]*_[NS][0-9]*) ;;
    *) echo "Invalid tile ignored: $t" >&2; continue ;;
  esac
  if [ -s "$dir/$t.rd5" ]; then echo "$t déjà présent"; continue; fi
  echo "Téléchargement de $t…"
  if curl -fL --retry 3 -o "$dir/$t.rd5.part" "https://brouter.de/brouter/segments4/$t.rd5"; then
    mv "$dir/$t.rd5.part" "$dir/$t.rd5" && echo "$t téléchargé"
  else
    rm -f "$dir/$t.rd5.part"
    echo "Échec du téléchargement de $t : relancer « docker compose up -d » pour réessayer." >&2
  fi
done
exit 0
