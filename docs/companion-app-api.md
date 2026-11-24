# Companion app API (`/api/app/*`)

JSON API for the Android companion app (read-only outings, plus uploading your ridden track). Decisions: pairing by a revocable token, no session cookie, same rights as the web pages, nothing new exposed without an account (#1719, #1720).

All `/api/app/*` responses are `Cache-Control: private, no-store`. Errors are `{ "error": "<code>" }`.

## Pairing

1. In the user menu, **Pair the app** (`POST /api/profile/app-devices`, session) returns a single-use code (6 characters, `A–Z` without `I L O`, digits `2–9`, valid **5 minutes**), the link `singletrack://pair?server=<origin>&code=<CODE>` and that link as a QR code (`qr`, PNG data URL). The same menu lists paired devices (`GET`) and revokes one (`DELETE {id}`).
2. The app scans the QR (or the user types the code) and calls:

```
POST /api/app/pair
{ "code": "K7M2QX", "deviceName": "Pixel 8" }
→ 200 { "token": "<43 chars>" }
→ 401 unknown, expired or already used code
→ 429 more than 10 attempts / minute / IP
```

The code works once (replay ⇒ 401). Only SHA-256 hashes of the code and of the token are stored. At most 20 devices per account (the oldest is revoked beyond that).

## Authentication

`Authorization: Bearer <token>` on every other `/api/app/*` route except `GET /api/app/i/<token>`. Missing, unknown or revoked token ⇒ `401` with `WWW-Authenticate: Bearer`. The session cookie is **never** accepted on these routes. `lastUsedAt` is refreshed at most once a minute.

## Routes

| Route | Auth | Description |
|---|---|---|
| `GET /api/app/outings` | Bearer | My outings (organiser or guest linked to my account): upcoming and the last 30 days, oldest first. |
| `GET /api/app/outings/<ref>` | Bearer | One outing. `ref` = slug (organiser, same rights as `/s/<slug>`) or outing `id` (also works for a linked guest). Not mine ⇒ `404`. |
| `GET /api/app/i/<token>` | none | Same data and rights as `/i/<token>` (personal link, no account). Unknown or revoked ⇒ `404`. 60 requests / minute / IP. |
| `GET` / `POST` / `DELETE /api/app/outings/<ref>/ride` | Bearer | Ridden track, same handler and limits as the web (`multipart` field `file`, GPX / KML / KMZ ≤ 5 MB; `<wpt>` waypoints are accepted and ignored). Errors `tooEarly` / `closed` (409), `tooLarge` (413), `notGpx` / `noTrack` / `doctype` (422). |

Anything the account may not see is `404`, never `403`.

### Outing summary (`outings[]`)

`id`, `slug` (organiser only), `role` (`organizer` | `guest`), `title`, `startsAt` (ISO, UTC), `status`, `cancelled`, `done`, `closed`, `meeting` `{ lat, lon, label }`, `distanceM`, `elevationGainM`, `level`, `ebike`, `organizerName`.

### Outing detail

The summary fields plus `description`, `maxParticipants`, `visibility`, `webPath` (`/s/<slug>` for the organiser, else `null`: "See on the website"), `myAnswer` (`yes|maybe|no|pending|null`), `yesCount`, `participants` (first names, `status`, `isMe`, `isOrganizer`) and `track`: the frozen route `{ name, geometry, bbox, start, distanceM, elevationGainM, elevationLossM, minEle, maxEle, difficulty, loop, attribution, license, profile }` (`profile` = ~240 sampled points). The track slug, the organiser's other guests' links and tokens are never sent.

## Code

`src/lib/app/` (`tokens.ts` pairing / token / devices, `outings.ts` rights and JSON, `http.ts` Bearer wrapper), routes in `src/app/api/app/` and `src/app/api/profile/app-devices/`, menu `src/components/app-devices.tsx`, tables `app_pairing` / `app_token` (migration `0031`), tests `tests/app-api.test.ts`.
