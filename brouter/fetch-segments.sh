#!/bin/sh
# Télécharge les tuiles BRouter (.rd5) dans /segments au premier lancement (#1484). Idempotent : une tuile déjà
# présente n'est pas retéléchargée. Ne fait jamais échouer le démarrage (sans tuile, l'éditeur passe en ligne droite).
#   BROUTER_TILES=france                 France métropolitaine (≈ 770 Mo, défaut)
#   BROUTER_TILES=home                   seulement la tuile 5° de HOME_LAT/HOME_LON
#   BROUTER_TILES=E5_N40,W5_N40          tuiles explicites (nom = coin sud-ouest d'une tuile de 5°)
#   BROUTER_TILES=none                   ne rien télécharger
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
    *) echo "Tuile invalide ignorée : $t" >&2; continue ;;
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
