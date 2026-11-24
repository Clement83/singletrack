# Offline packs (#1738)

An instance can serve **offline packs** to the companion app, one per region. A pack = a vector map extract
(PMTiles, OpenStreetMap data built by [Protomaps](https://protomaps.com/)) plus the list of BRouter segments (`.rd5`)
the region needs for routing. Download API for the app: [`companion-app-api.md`](companion-app-api.md) (#1739); this page covers preparing them.

## Admin

`/admin/offline` (administrators in `ADMIN_EMAILS`): register a region (predefined metropolitan France regions or a custom
bounding box `west,south,east,north`), **build / rebuild** it with a button, see its state (queued, building the map,
downloading segments, failed + retry), size / build date / segments, enable or disable it, delete it (the file is removed),
**refresh now**. **Master switch**: nothing is served unless `OFFLINE_PACKS_ENABLED=on` in `.env` **and** the switch in
`/admin/offline` is on.

## Build service (`offline-worker`, #1749)

Buttons do not build anything in the web app: they queue a job (`offline_job` table) that the separate **`offline-worker`**
service runs, one at a time. It uses the `singletrack-tools` image (it has the `pmtiles` CLI), shares `./data` with the app,
writes a heartbeat every 10 s (older than 2 min: `/admin/offline` says the service is stopped and disables the buttons) and,
at start-up, marks a job interrupted by a restart as failed. The web app never talks to Docker.

```bash
docker compose --profile offline up -d offline-worker     # distribution compose.yml: opt-in profile
docker compose -f docker-compose.yml up -d offline-worker # maintainer compose file: always on
docker compose logs -f offline-worker
```

A build extracts the region from the latest Protomaps planet build with `pmtiles extract` (HTTP range requests: only the
region is downloaded, not the planet) into `data/offline/<region>.pmtiles` (or `OFFLINE_DIR`), written to `<file>.part` then
renamed, records size, version (build date) and the covered `.rd5` tiles (5° × 5°, named after the south-west corner, e.g.
`E5_N40`), then downloads the BRouter segments of the region that are missing on the server. `PMTILES_SOURCE` overrides the
Protomaps build.

## Monthly refresh (#1740, #1751)

The worker queues a refresh by itself once a month, from the **2nd at 03:00 Europe/Paris** (no host cron needed), if at least
one pack is enabled; "Refresh now" in `/admin/offline` does the same on demand. A refresh rebuilds every **enabled, built**
region from the latest Protomaps build and refreshes the BRouter segments they list (downloaded only if the remote file is
newer, `If-Modified-Since`). Each file is written to `<file>.part` then replaced with a single `rename`: a download already
streaming finishes on the old inode, BRouter keeps routing, and a client resuming with `If-Range` and the old `ETag` simply
receives the new file in full (200) and can detect the version change. The version is the build date; a region already at that
version is skipped. The result (date, per region and segment status) is shown in `/admin/offline`, and `/api/app/offline`
exposes the new `version`.

## Command line (scripting)

The same code is available without the worker, through the `tools` service:

```bash
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- --list
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- paca [--source <url|file>] [--dry-run]
docker compose -f docker-compose.yml run --rm tools npm run offline:build -- my-area --name "My area" --bbox 4.2,43.0,7.7,45.1
docker compose -f docker-compose.yml run --rm tools npm run offline:refresh [-- --dry-run] [--source <url|file>] [--no-segments]
```

`offline:refresh` exits with code 1 if anything failed.

## Disk space

Vector tiles for a region are typically a few hundred MB (a large region such as Nouvelle-Aquitaine: ~1 GB; all of France: a few GB).
Segments are 60–240 MB per 5° tile. `/admin/offline` shows the free space before you build.

## Licence

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright); tiles built by Protomaps.
The app must display this attribution on the offline map. Do not use OpenTopoMap tiles for offline use (prefetching is forbidden).
