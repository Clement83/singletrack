# Installing Singletrack on your server

Requirements: a server (NAS, mini PC, VPS) with **Docker + Docker Compose**, ≈ 2 GB of RAM, a few hundred MB of disk (≈ 770 MB more for routing across the whole of France), and, to send the sign-in emails, a [Resend](https://resend.com) account with a verified domain.

Every command runs inside the containers; nothing needs to be installed on the host (apart from Docker and git).

## Quick install (GHCR images)

The `compose.yml` file at the root is the **distribution** compose file: it uses the published images and builds nothing.

```bash
mkdir singletrack && cd singletrack && mkdir scripts
B=https://raw.githubusercontent.com/Clement83/singletrack/main
curl -fsSLO $B/compose.yml && curl -fsSLO $B/.env.example
curl -fsSL $B/scripts/init-env.sh -o scripts/init-env.sh && chmod +x scripts/init-env.sh
./scripts/init-env.sh https://mtb.example.org     # .env + secrets + ./data (without an argument: edit BETTER_AUTH_URL)
docker compose up -d
docker compose run --rm tools npm run user:create -- --email you@example.org --name Firstname
```

- **BRouter tiles**: on first start, the `brouter-init` service downloads the tiles listed in `BROUTER_TILES` (`france` ≈ 770 MB by default, `home` = the tile of the home point, a list such as `E5_N40,W5_N40`, or `none`), then stops; tiles already present are kept. Without a tile (or if the download fails), the editor falls back to straight lines; run `docker compose up -d` again to retry.
- **Track syncs** (manual, idempotent): `docker compose run --rm tools npm run sync:osm -- 83 06`, `sync:singles`, `sync:geotrek`. The `tools` service (`tools` profile, `singletrack-tools` image) contains the scripts; it shares `./data` with the application.
- **Update**: back up `./data` and `.env` (see §6), then `docker compose pull && docker compose up -d`. Pinned version: `SINGLETRACK_TAG=X.Y.Z` in `.env` (`edge` = latest commit on `main`).
- **Verification**: CI runs this path on every change (`scripts/install-test.sh`: `compose up --wait`, `/api/health`, `/login`, account creation, `down`), BRouter routing excepted.

Sections 1 to 7 below describe the install **from source** (git clone, development compose file); the `.env` variables and sections 4 to 6 apply to both.

## 1. Get the code and configure it

```bash
git clone https://github.com/Clement83/singletrack.git
cd singletrack
cp .env.example .env
```

Edit `.env` (every variable is commented: required or optional). The essentials:

| Variable | What to do |
| --- | --- |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `INVITE_LINK_KEY` | `openssl rand -base64 32` — **keep it, never change it** (back it up with `.env`) |
| `FEDERATION_KEY_ENC` | ActivityPub federation key: `openssl rand -base64 32` (keep it, never change it; `init-env.sh` generates it). **Federation is on by default as soon as this key exists**; `FEDERATION=off` turns it off — see `docs/federation.md` |
| `ADMIN_EMAILS` | administrator emails (comma-separated): access to `/admin/federation` to block servers, read reports and the rejection log |
| `BETTER_AUTH_URL` | the public URL, e.g. `https://mtb.example.org` (no trailing slash) |
| `AUTH_TRUSTED_ORIGINS` | that URL, plus any LAN access (`http://<LAN_IP>:3700`) |
| `APP_PORT` | port published on the host (default `3700`) |
| `RESEND_API_KEY`, `MAIL_FROM` | Resend key and sender on a verified domain |
| `HOME_LAT`, `HOME_LON` | your "home" point: map centre and reference for distances (default: centre of France) |
| `SYNC_ZONES` | your departments, e.g. `83,06` (empty = all of France, several hours) |
| `DATA_SOURCES` | optional: enable only some sources (see below) |

For a first try without HTTPS or a domain name: `BETTER_AUTH_URL=http://IP:3700`, `AUTH_TRUSTED_ORIGINS=http://IP:3700`, `AUTH_SECURE_COOKIES=false`.

### Data sources

`DATA_SOURCES` (empty = all): `osm`, `geotrek`, `datatourisme`, `ign`, `openmeteo`, `fire83`, `hunting83`. `datatourisme` also needs a free API key in `DATA_TOURISM_API_KEY` (https://www.datatourisme.fr/utiliser-les-donnees); without it the sync is skipped. Fire risk (`fire83`) and hunting (`hunting83`) only cover the **Var** department: elsewhere these sections show "not available". Respect the data licences (see the [README](../README.md#third-party-data)).

## 2. Download routing data (BRouter)

```bash
./scripts/get-brouter-segments.sh          # tile(s) around HOME_LAT/HOME_LON (≈ 60–250 MB)
./scripts/get-brouter-segments.sh france   # or the whole of France (≈ 770 MB)
./scripts/get-brouter-segments.sh E5_N40   # or chosen 5° tiles (name = south-west corner)
```

Idempotent. After adding tiles: `docker compose restart brouter`. The `brouter` service only becomes healthy when the tile of your home point is present: run this script **before** `up`.

## 3. Start

```bash
docker compose -f docker-compose.yml --profile dev up -d app-dev
docker compose -f docker-compose.yml ps     # app-dev and brouter "healthy" (the first compilation takes 1 to 2 minutes)
curl http://localhost:3701/api/health
```

The SQLite database is created and migrated on start, in `./data/`.

> **Development or production?** From source, `docker-compose.yml` runs the application in development mode (`app-dev`: hot reload, mounted code, port 3701). Its `app` service (production) is **not built locally**: it uses the published images, like `compose.yml`. For a long-lived install, use the distribution compose file (top of this page). On a host without compose network issues, you can remove `network_mode: bridge` and `links`.

## 4. First account and first data

Sign-in is **passwordless** (code, link and QR code sent by email). Either open the URL and sign in with your address (the account is created on first sign-in while `AUTH_DISABLE_SIGNUP=false`), or create the account:

```bash
docker compose -f docker-compose.yml run --rm tools npm run user:create -- --email you@example.org --name Firstname
```

Without `RESEND_API_KEY`, no email is sent: the code is written to the logs (`docker compose logs app`), handy for a first try. To close sign-ups afterwards: `AUTH_DISABLE_SIGNUP=true` (then `docker compose up -d`).

Import the tracks of your areas (`SYNC_ZONES`, or as arguments):

```bash
docker compose -f docker-compose.yml run --rm tools npm run sync:osm         # OSM mountain-bike routes (one department after another)
docker compose -f docker-compose.yml run --rm tools npm run sync:singles     # OSM singletrack layer
docker compose -f docker-compose.yml run --rm tools npm run sync:geotrek     # official park routes (optional)
docker compose -f docker-compose.yml run --rm tools npm run sync:datatourisme   # tourist office circuits (optional, DATA_TOURISM_API_KEY; `-- france` for the whole country)
docker compose -f docker-compose.yml run --rm tools npm run sync:osm -- 83 06   # explicit areas
```

Every script is idempotent: run it again to refresh (for example monthly, from cron).

## 5. HTTPS behind a reverse proxy

Shared links (`/s`, `/t`, `/i`) must be reachable **without SSO**: the application has its own authentication. So do not put a portal in front of it. nginx example (Let's Encrypt certificate, e.g. `certbot --nginx -d mtb.example.org`):

```nginx
server {
    listen 443 ssl http2;
    server_name mtb.example.org;
    ssl_certificate     /etc/letsencrypt/live/mtb.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mtb.example.org/privkey.pem;
    client_max_body_size 160m;                      # photos, GPX and short videos (150 MB max)

    location / {
        proxy_pass http://127.0.0.1:3700;           # APP_PORT
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;     # hot reload in development mode
        proxy_set_header Connection "upgrade";
    }
}
```

Caddy (optional) does the same job, automatic certificate included:

```caddy
mtb.example.org {
    reverse_proxy 127.0.0.1:3700
}
```

Then `BETTER_AUTH_URL=https://mtb.example.org`, `AUTH_SECURE_COOKIES=true`, and this domain in `AUTH_TRUSTED_ORIGINS` (and `ALLOWED_DEV_ORIGINS` in development mode).

## Short videos and the GPU (optional)

Participants can add short clips (≤ 30 s, ≤ 150 MB, MP4/MOV, H.264/HEVC, 15 per outing) to an outing. The server converts them one at a time, in the background, to MP4 H.264 720p (`ffmpeg` is in the image). With an **Intel iGPU**, the conversion uses Quick Sync (QSV): uncomment `devices` / `group_add` in `compose.yml` and set `RENDER_GID` (host `render` group). Without it, the CPU (libx264) does the same job, slower. The log says which encoder ran (`[Video] encoder=h264_qsv` or `libx264`). Force one with `VIDEO_ENCODER=qsv|x264`.

## 6. Backup

All the state lives in `./data/` (except `data/brouter/segments`, which can be downloaded again) and in `.env`:

- `data/singletrack.db` (+ `-wal` / `-shm`): tracks, outings, accounts;
- `data/media/`: outing photos and videos (or `MEDIA_DIR`);
- `data/music/`: optional background music for the outing summary video export (`.mp3`, `.ogg`, `.m4a`, `.wav`, or `SUMMARY_MUSIC_DIR`). Put only tracks whose licence allows use in a video; they are never part of the repository. Empty or missing folder: exports keep only the clips' sound;
- `.env`: in particular `INVITE_LINK_KEY` and `BETTER_AUTH_SECRET`.

Consistent hot backup of the database:

```bash
docker compose exec app node -e "require('better-sqlite3')('/app/data/singletrack.db').backup('/app/data/backup.db').then(()=>console.log('ok'))"
```

then copy `data/backup.db`, `data/media/` and `.env` off the server. Restore: stop (`docker compose down`), put the files back, start again.

## 7. Update

```bash
git pull
docker compose -f docker-compose.yml --profile dev up -d --build app-dev
```

Install on the published images: `docker compose pull && docker compose up -d` (see the top of this page).

Migrations are applied on start. Read `CHANGELOG.md` if a `.env` change is announced (compare with `.env.example`).

## Troubleshooting

- **Sign-in: 403**: your browser's origin is not in `AUTH_TRUSTED_ORIGINS`.
- **Cannot sign in over `http://IP`**: `AUTH_SECURE_COOKIES` must be `false` without HTTPS.
- **`brouter` "unhealthy"**: the tile of the home point is missing (step 2), then `docker compose restart brouter`.
- **No email**: `RESEND_API_KEY` is empty, or the sending domain is not verified; check `docker compose logs app`.
- **The app refuses to start in production**: `INVITE_LINK_KEY` is missing or invalid.

## Published images (GHCR)

The `.github/workflows/images.yml` workflow publishes, for `linux/amd64` and `linux/arm64` (built on native runners, with provenance + SBOM):

- `ghcr.io/clement83/singletrack` (`release` target of the Dockerfile: standalone build without devDependencies, `node` user, data in `/app/data`);
- `ghcr.io/clement83/singletrack-brouter` (custom profiles, without `.rd5` tiles);
- `ghcr.io/clement83/singletrack-tools` (`runner` target, sync and account management scripts).

Tags: `edge` on every push to `main`; `X.Y.Z`, `X.Y` and `latest` on a `vX.Y.Z` tag.
