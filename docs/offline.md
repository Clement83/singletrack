# Offline packs (#1738)

An instance can serve **offline packs** to the companion app, one per region. A pack = a vector map extract
(PMTiles, OpenStreetMap data built by [Protomaps](https://protomaps.com/)) plus the list of BRouter segments (`.rd5`)
the region needs for routing. Download API for the app: [`companion-app-api.md`](companion-app-api.md) (#1739); this page covers preparing them.

## Admin

`/admin/offline` (administrators in `ADMIN_EMAILS`): register a region (predefined metropolitan France regions or a custom
bounding box `west,south,east,north`), see size / build date / segments, enable or disable it, delete it (the file is removed).
**Master switch**: nothing is served unless `OFFLINE_PACKS_ENABLED=on` in `.env` **and** the switch in `/admin/offline` is on.

## Building a pack

```bash
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- --list
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- paca
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- my-area --name "My area" --bbox 4.2,43.0,7.7,45.1
```

The command uses `pmtiles extract` (included in the `tools` image) with HTTP range requests: only the region is
downloaded, not the planet. Output: `data/offline/<region>.pmtiles` (or `OFFLINE_DIR`). It then records size, version
(build date) and the covered `.rd5` tiles. Rebuilding replaces the file. `--source <url|file>` / `PMTILES_SOURCE`
overrides the Protomaps build; `--dry-run` prints the plan.

BRouter segments are the ones already on the server (`./scripts/get-brouter-segments.sh`); the pack only lists which
5° × 5° tiles (named after the south-west corner, e.g. `E5_N40`) cover the region.

## Disk space

Vector tiles for a region are typically a few hundred MB (a large region such as Nouvelle-Aquitaine: ~1 GB; all of France: a few GB).
Segments are 60–240 MB per 5° tile. `/admin/offline` shows the free space before you build.

## Licence

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); tiles built by Protomaps.
The app must display this attribution on the offline map. Do not use OpenTopoMap tiles for offline use (prefetching is forbidden).
