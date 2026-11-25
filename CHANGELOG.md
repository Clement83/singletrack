# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
Each release ticket writes the `## [X.Y.Z] - YYYY-MM-DD` section from the conventional commits since the previous tag;
`.github/workflows/release.yml` publishes that section as the GitHub Release notes.

## [Unreleased]

## [0.10.0] - 2026-11-25

### Added
- **Solo outing from the Sillage app**: `POST /api/app/rides` turns a recording made in the companion app into a private solo outing, idempotent on the client id (the same recording sent twice returns the same outing).

### Fixed
- The offline catalogue and map style given to the app now use the public address of the instance instead of the internal one (`0.0.0.0`).

## [0.9.0] - 2026-11-24

### Added
- **Offline packs built from the admin page**: each region has a Build / Rebuild button with its progress (queued, building the map, downloading segments, failed + retry), and "Refresh now" updates every enabled pack. Builds run in a new `offline-worker` service (in `compose.yml`: `docker compose --profile offline up -d`).
- **Automatic monthly refresh** of the offline packs, from the 2nd of each month at 03:00 (Europe/Paris), run by the worker: no cron job to set up.

### Changed
- `/admin/offline` no longer shows any command line; it says when the build service is stopped.
- Building a pack also downloads the BRouter segments of the region that are missing on the server.

## [0.8.1] - 2026-11-24

### Fixed
- **Offline packs admin page**: `/admin/offline` showed raw translation keys instead of its texts.

## [0.8.0] - 2026-11-24

### Added
- **Administration area**: instance admins (listed in `ADMIN_EMAILS`) get an "Administration" menu entry and an `/admin` page; other accounts get a 404.
- **Companion app pairing**: "Pair the app" in the user menu shows a QR code and a short single-use code; each device gets its own revocable token. New JSON API under `/api/app/*` (outings, outing detail, ridden track upload) secured by that token.
- **QR code of the outing page** in the share block of an outing, to open it in the companion app.
- **Offline map packs (off by default)**: regional PMTiles and BRouter segment packs for the companion app, built from `/admin/offline`, with a download API, quotas and a monthly refresh. Enabled only with `OFFLINE_PACKS_ENABLED` and the admin switch.

## [0.7.0] - 2026-11-22

### Added
- **Choose the speed of the exported summary video**: ×1, ×2, ×4 or ×6, with the resulting film length shown before creating it. Clips keep their real length so their sound stays right.

### Fixed
- **Sharper exported videos**: the bit rate now matches the picture size (about 20 Mb/s in 1080p instead of 6), removing the big moving blocks; long videos are written as they go instead of being held in memory.

## [0.6.0] - 2026-11-22

### Added
- **Export the outing summary as a video**: from the summary player, create an MP4 of the 3D flyover with the photos and clips, in landscape (1920×1080) or portrait (1080×1920), then download or share it. Rendered in the browser, nothing is sent to the server.
- **Background music for the exported video**: each instance can provide its own free-to-use tracks in `data/music` (or `SUMMARY_MUSIC_DIR`); the music fades under the clips so their sound is heard.
- **Photo / video icons on the summary stops**, on the map and on the progress bar.

### Changed
- **Livelier summary**: the ride between media is about 25 % faster, and the point keeps riding along the track while a clip plays (shown as an inset over the map).

## [0.5.0] - 2026-11-22

### Added
- **Delete media from the outing summary**: while watching the summary, the author of a photo or video (or the organiser) can delete it from the player; the film skips it and carries on.
- **Videos on the outing photo map**: located videos now show on the map of the rides and photos section next to the photos, and open in the video viewer.

## [0.4.1] - 2026-11-21

### Fixed
- **Ridden tracks counted twice**: a file that writes the same ride twice (for example a KML with both a timed `gx:Track` and a `LineString`) no longer doubles the distance and elevation gain. Existing rides can be corrected with `npm run rides:dedupe`.

## [0.4.0] - 2026-11-21

### Added
- **Short videos on outings**: participants can add clips (up to 30 s) to an outing like photos. They are converted to 720p H.264 with a thumbnail, using the Intel iGPU (QSV) when available and falling back to software x264.
- **Outing summary**: a "Watch the summary" player flies in 3D over the real ridden track and stops on each photo and video placed along it, then ends with a slideshow of the remaining media.

## [0.3.0] - 2026-11-20

### Added
- **Singles tooltip**: hover (desktop) or tap a singletrack to see its name, difficulty, length, surface, uphill difficulty and an OpenStreetMap link. Surface and uphill data come from OSM; existing installs need `npm run sync:singles` to fill them.
- **3D flyover** (desktop): a play button flies a bike over the open track in 3D with a smoothed camera and a synchronised elevation profile (Space = pause, Escape = stop).
- **Recap data for outings**: ridden tracks keep point times (GPX/KML), photos keep their capture time, and the organiser can pick a reference track; photos are placed along the track by time, then by position.

### Changed
- **New map markers**: clusters are discs with the count and a difficulty ring, start points are bike pins, and outings share the same pin shape with a calendar.
- **Consistent floating surfaces**: panel, map buttons, search, legends and menus share one near-opaque style with a single right-hand button pill; the map recentres taking the side panel or bottom sheet into account.

### Fixed
- **Editor**: copied or imported tracks no longer keep straight lines; frozen segments are recomputed on trails with BRouter when you move a point.

## [0.2.0] - 2026-11-19

### Added
- **Tourist office circuits (DATAtourisme)**: mountain-bike circuits published by French tourist offices appear on the map with their producer, licence and link (`npm run sync:datatourisme`, free API key in `DATA_TOURISM_API_KEY`). Strict request limits, resumable and incremental sync, duplicates of existing tracks skipped.

### Changed
- **Singletracks stand out on the map**: solid line coloured by difficulty, thicker as you zoom in, light casing, unrated segments discreet, faded while a track or an outing is open. Colours stay readable on the light topo map in dark mode (black singles no longer turn light grey).

## [0.1.0] - 2026-11-19

First public release.

### Added
- **Trail map** of metropolitan France: start points grouped in clusters, a track opens in a side panel (stats, sources, planned outings, elevation profile synchronised with the map), slope-coloured line, kilometre markers, map view kept in the URL. Usable without an account (public tracks and outings only).
- **3D relief**: a "3D" button tilts the map over the terrain (AWS Open Data elevation tiles); maps always open flat.
- **Track editor**: draw or edit a track snapped to trails with self-hosted BRouter routing (mountain-bike profiles, with or without e-bike), drag to reroute, choose between two paths after a drag, alternatives, undo/redo, drafts saved automatically, GPX/KML import.
- **Track sources**: OpenStreetMap mountain-bike routes and singletracks, Geotrek official routes, elevation from IGN for accurate elevation gain.
- **Track visibility**: public, friends or private, with per-account defaults.
- **Outings**: dated rides on a frozen copy of a track, meeting point and directions, personal invitation links that guests follow without an account, answers (I'm in / maybe / no), who's coming, comments, rides and photos after the outing, calendar export and subscription, GPX, duplication.
- **Conditions** on each outing: weather (Open-Meteo), fire risk and hunting information for the Var department.
- **Friends** between accounts, public or private profile, ride statistics.
- **Federation (ActivityPub)**: friends and outings across Singletrack servers, moderation tools (blocked servers and accounts, rate limits, reports); on by default when `FEDERATION_KEY_ENC` is set.
- **Passwordless sign-in**: code, link and QR code by email.
- **French and English** interface, mobile first, light and dark themes, a refined visual charter (Inter, indigo accent, glass floating layers).
- **Self-hosting**: multi-arch images on GHCR (`singletrack`, `singletrack-brouter`, `singletrack-tools`), distribution `compose.yml`, `init-env.sh`, install guide.

