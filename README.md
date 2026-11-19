# Singletrack

[![CI](https://github.com/Clement83/singletrack/actions/workflows/ci.yml/badge.svg)](https://github.com/Clement83/singletrack/actions/workflows/ci.yml)

Plan your mountain-bike rides: a trail map (metropolitan France, centred on the point of your choice, `HOME_LAT`/`HOME_LON`), a track editor, dated **outings** and invitation links that guests follow **without an account**. Interface in French and English, mobile first.

## Getting started

Install in four commands (Docker + Docker Compose, images published on GHCR):

```bash
mkdir singletrack && cd singletrack && mkdir scripts
B=https://raw.githubusercontent.com/Clement83/singletrack/main
curl -fsSLO $B/compose.yml && curl -fsSLO $B/.env.example && curl -fsSL $B/scripts/init-env.sh -o scripts/init-env.sh && chmod +x scripts/init-env.sh   # 1. files
./scripts/init-env.sh http://IP-OR-DOMAIN:3700       # 2. creates .env and generates the secrets
docker compose up -d                                 # 3. starts (BRouter tiles are downloaded on first start)
docker compose run --rm tools npm run user:create -- --email you@example.org --name Firstname   # 4. first account
```

The application listens on `http://localhost:3700` (health: `GET /api/health`); sign-in uses a code sent by email (without `RESEND_API_KEY`, the code is printed in `docker compose logs app`). Then import tracks: `docker compose run --rm tools npm run sync:osm -- 83`.

Full guide (HTTPS, BRouter area `BROUTER_TILES`, syncs, backup, update: `docker compose pull && docker compose up -d`): **[`docs/install.md`](docs/install.md)**. Development: [`AGENTS.md`](AGENTS.md) and `docker-compose.yml` (`app-dev`, mounted source code).

## Licence

The code is released under the **GNU Affero General Public License v3 or later** (`AGPL-3.0-or-later`), full text in [`LICENSE`](LICENSE).

What this means: you may use, study, modify and redistribute the code. If you **run a modified version online** for other people, you must publish its source code (AGPL §13). The application therefore shows a "Source code" link in the account menu and on the sign-in page; it points to the public repository by default and is set with the `SOURCE_URL` variable (point it to your fork if you modify the code).

## Third-party data

The code licence **does not cover** the data displayed, which keeps its original licence. Respect it, especially if you host a public instance.

| Source | Licence / status | What to respect |
| --- | --- | --- |
| OpenStreetMap | ODbL | Attribution "© OpenStreetMap contributors" required |
| IGN (elevation) | Etalab Open Licence | Credit the source |
| Open-Meteo (weather) | CC BY 4.0 | Attribution required |
| Var prefecture (fire risk) | Public data from the prefecture | Credit the source |
| Geotrek (official routes) | Licence not declared by the sources | Check before any reuse or redistribution |
| DATAtourisme (tourist office circuits) | Etalab Open Licence 2.0 | Credit the producer (shown on each track) and DATAtourisme |
| UtagawaVTT | CC BY-NC | **Non-commercial use only: forbidden for a commercial instance** |
| "Ça chasse ?" | No licence | Viewing only, no copying or redistribution |
| Mapzen Terrain Tiles (3D relief, AWS Open Data) | Per source (SRTM, etc.), attribution required | Keep the map attribution |

GPX/KML files imported by users remain the property of their authors. No scraping.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). No CLA: you keep your rights, and contributions are accepted under the same licence, **AGPL v3 or later**.
