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

## Monthly refresh (#1740)

```bash
docker compose -f docker-compose.yml run --rm tools npm run offline:refresh [-- --dry-run] [--source <url|file>] [--no-segments]
```

Rebuilds every **enabled, built** region from the latest Protomaps build and refreshes the BRouter segments they list
(downloaded only if the remote file is newer, `If-Modified-Since`). Each file is written to `<file>.part` then replaced with a
single `rename`: a download already streaming finishes on the old inode, BRouter keeps routing, and a client resuming with
`If-Range` and the old `ETag` simply receives the new file in full (200) and can detect the version change. The version is the
build date; a region already at that version is skipped. The result (date, per region and segment status) is shown in
`/admin/offline`, and `/api/app/offline` exposes the new `version`. Exit code 1 if anything failed.

Scheduling is up to you, e.g. a host cron on the 2nd of each month at 03:00 (not required):

```cron
0 3 2 * * cd /path/to/singletrack && docker compose -f docker-compose.yml run --rm tools npm run offline:refresh >> data/offline-refresh.log 2>&1
```

## Disk space

Vector tiles for a region are typically a few hundred MB (a large region such as Nouvelle-Aquitaine: ~1 GB; all of France: a few GB).
Segments are 60–240 MB per 5° tile. `/admin/offline` shows the free space before you build.

## Licence

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); tiles built by Protomaps.
The app must display this attribution on the offline map. Do not use OpenTopoMap tiles for offline use (prefetching is forbidden).
