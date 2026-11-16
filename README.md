# Singletrack

[![CI](https://github.com/Clement83/singletrack/actions/workflows/ci.yml/badge.svg)](https://github.com/Clement83/singletrack/actions/workflows/ci.yml)

Organiser des sorties VTT : une carte des traces (France métropolitaine, centrée sur le point de votre choix, `HOME_LAT`/`HOME_LON`), un éditeur de traces, des **sorties** datées et des invitations par lien que les invités suivent **sans compte**. Interface en français et en anglais, mobile first.

*Plan your mountain-bike rides: a trail map, a track editor, dated outings and invitation links guests can follow without an account.*

## Démarrer

Installation en quatre commandes (Docker + Docker Compose, images publiées sur GHCR) :

```bash
mkdir singletrack && cd singletrack && mkdir scripts
B=https://raw.githubusercontent.com/Clement83/singletrack/main
curl -fsSLO $B/compose.yml && curl -fsSLO $B/.env.example && curl -fsSL $B/scripts/init-env.sh -o scripts/init-env.sh && chmod +x scripts/init-env.sh   # 1. fichiers
./scripts/init-env.sh http://IP-OU-DOMAINE:3700      # 2. crée .env et génère les secrets
docker compose up -d                                 # 3. démarre (les tuiles BRouter se téléchargent au 1er lancement)
docker compose run --rm tools npm run user:create -- --email vous@example.org --name Prénom   # 4. premier compte
```

L'application écoute sur `http://localhost:3700` (santé : `GET /api/health`) ; la connexion se fait par code reçu par mail (sans `RESEND_API_KEY`, le code est dans `docker compose logs app`). Ensuite, importez vos traces : `docker compose run --rm tools npm run sync:osm -- 83`.

Guide complet (HTTPS, zone BRouter `BROUTER_TILES`, synchros, sauvegarde, mise à jour : `docker compose pull && docker compose up -d`) : **[`docs/install.md`](docs/install.md)**. Développement : [`AGENTS.md`](AGENTS.md) et `docker-compose.yml` (mode dev, code monté).

## Licence

Le code est publié sous **GNU Affero General Public License v3 ou ultérieure** (`AGPL-3.0-or-later`), texte complet dans [`LICENSE`](LICENSE).

Ce que cela implique : vous pouvez utiliser, étudier, modifier et redistribuer le code. Si vous **faites tourner une version modifiée en ligne** pour d'autres personnes, vous devez en publier le code source (AGPL §13). L'application affiche donc un lien « Code source » dans le menu du compte et sur la page de connexion ; il pointe par défaut vers le dépôt public et se règle avec la variable `SOURCE_URL` (à pointer vers votre fork si vous modifiez le code).

## Données tierces

La licence du code **ne couvre pas** les données affichées, qui gardent leur licence d'origine. Respectez-les, surtout si vous hébergez une instance publique.

| Source | Licence / statut | À respecter |
| --- | --- | --- |
| OpenStreetMap | ODbL | Attribution « © contributeurs OpenStreetMap » obligatoire |
| IGN (altitude) | Licence ouverte Etalab | Mentionner la source |
| Open-Meteo (météo) | CC BY 4.0 | Attribution obligatoire |
| Préfecture du Var (risque incendie) | Données publiques de la préfecture | Mentionner la source |
| Geotrek (circuits officiels) | Licence non déclarée par les sources | Vérifier avant toute réutilisation ou redistribution |
| UtagawaVTT | CC BY-NC | **Usage non commercial uniquement : interdit pour une instance commerciale** |
| « Ça chasse ? » | Aucune licence | Consultation seulement, pas de copie ni de redistribution |

Les imports GPX/KML des utilisateurs restent la propriété de leurs auteurs. Pas de scraping.

## Contribuer

Voir [`CONTRIBUTING.md`](CONTRIBUTING.md). Pas de CLA : vous gardez vos droits, et vos contributions sont acceptées sous la même licence, **AGPL v3 ou ultérieure**.
