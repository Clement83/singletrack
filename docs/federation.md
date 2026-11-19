# ActivityPub federation — study and decisions (#1471, epic #1470)

Status: study completed on 2026-11-14; **P6 (#1476, outings across servers) delivered**, see §10; **P5 (#1475, friends across servers) delivered**, see §9; **P4 (#1474) delivered**: identity, WebFinger, NodeInfo, actor, signatures, delivery queue, `remote_actor` (see §8). The spike in `spikes/federation/` validates **Fedify 2.4.5**. Tickets P4 to P7 build on this document.

## 1. Maintainer decisions (2026-11-14)

- **ActivityPub** protocol, **Fedify** library (validated by the spike, §3).
- **Open to every server**, no allow-list. Moderation (P7) is therefore required before enabling it in production.
- **AGPL v3, no CLA.** No trademark policy for the name.
- v1 scope: **friends + outings**, every visibility. Federation **enabled by default** in the distributed version, after P7.
- **Never federated**: `/i/<token>` links, guests without an account, the buddy book, emails, drafts.
- The organiser's server remains the reference for an outing. A deletion sent elsewhere is not guaranteed.
- Vision: a federated Komoot/Strava, mountain biking only for now. Nothing here may hard-code this server.

## 2. Federated identifier (`handle`)

An account currently only has an email and a first name. Rule adopted (ticket recommendation, confirmed by the study):

| Point | Rule |
|---|---|
| Column | `user.handle`, unique, **case-insensitive** (stored in lower case, unique index) |
| Alphabet | `[a-z0-9_]`, 3 to 30 characters |
| Generation | when the account is created, from the first name: lower case, accents removed (NFD), everything outside `[a-z0-9_]` dropped, padded to 3 characters (`user` + suffix) if too short, then a numeric suffix on the first conflict (`alice`, `alice2`, `alice3`…) |
| Account without a first name (`/bienvenue` not done yet) | handle generated **when the first name is entered**, never from the email |
| Change | **only once**, in the user menu. Column `handle_changed_at` (NULL = never changed) |
| Reserved | `admin`, `root`, `support`, `ap`, `api`, `inbox`, `actor`, `instance`, `singletrack`, `nodeinfo`, `well-known` and their equivalents (list in the code, tested) |
| Address | `handle@<instance domain>` (WebFinger `acct:handle@domain`) |
| Email | **never exposed**: not in the actor, not in WebFinger, not in an activity |

Why a single change: an account's address is what remote friends have remembered. Changing address requires an ActivityPub `Move` (out of v1). In v1 the change is therefore **refused if the account already has remote friends**, and the interface says so. As long as there are none (or before P5), changing breaks nothing.

An old handle is never given to another account (`handle_history` table, or simply keeping the value in `handle_changed_at`/a `previous_handle` field, to be settled in P4).

Domain: the actor is identified by its URL (`https://<domain>/ap/users/<handle>`), **never by the internal database identifier**. The domain comes from configuration (`BETTER_AUTH_URL`/`PUBLIC_URL`), not from a request header (see §3, origin pitfall).

## 3. Fedify spike: results

Code: `spikes/federation/` (throwaway, outside the build, excluded from tsc, ESLint and the image). Run: `docker compose -f spikes/federation/docker-compose.yml up -d`, then `docker compose -f spikes/federation/docker-compose.yml exec spike node /w/check.mjs`.

**Verdict: Fedify fits.** No home-made fallback needed.

| Ticket question | Result |
|---|---|
| Compatible with Next.js 16 (App Router, `next dev`)? | **Yes.** Official `@fedify/next` package: `fedifyWith(federation)()` exported as `proxy` (Next 16 renames `middleware` to `proxy`, deprecated otherwise). The federation singleton must live on `globalThis`: otherwise Next recreates it on every hot reload and throws "Listener already set for this type". `output: standalone` was not tested in the spike (development mode was the only one in use, #1464): to check in P4 with `npm run build`. |
| KV store and message queue on SQLite, without Redis or Postgres? | **Yes, without writing anything**: `@fedify/sqlite` provides `SqliteKvStore` and `SqliteMessageQueue` (tables `fedify_kv`, `fedify_message`, `fedify_message_locks`, created automatically). They use Node 22's experimental **`node:sqlite`** module ("SQLite is an experimental feature" warning in the logs), not better-sqlite3. Fedify's tables go into **a separate SQLite file** (`data/federation.db`), so as not to touch the Drizzle migrations or lock the app database. If `node:sqlite` causes trouble: `KvStore`/`MessageQueue` are small interfaces, a better-sqlite3 version fits in ~150 lines. |
| Can two instances find each other through WebFinger? | **Yes.** `GET /.well-known/webfinger?resource=acct:paul@host` returns the `self` link to the actor. |
| Exchange of a signed activity? | **Yes, round trip validated**: a signed `Follow` from instance 1 to instance 2 (signature verified, remote actor resolved), then a signed `Accept` back, verified by instance 1. `Follow` and `Accept` go through the **SQLite queue** (not sent immediately) without loss. RSA keys are stored in the database (JWK) by a `setKeyPairsDispatcher`: to be encrypted in P4 (instance key in `.env`). |
| Local HTTP | `allowPrivateAddress: true` (development flag `FEDERATION_DEV_HTTP=1`). It also allows private addresses. **Never in production: HTTPS required**, the flag is absent from `.env.example`. |

**Pitfalls met (to carry into the P4 code):**

1. **Fedify 2.x moved the vocabulary** to `@fedify/vocab`: `Person`, `Follow`, `Accept`, `Endpoints`, `Create`, `Event`… are no longer imported from `@fedify/fedify`. Forgetting it yields `undefined` classes and the misleading "Listener already set for this type" error.
2. **A single copy of the Fedify packages**: Turbopack bundles two (route and proxy) and `instanceof CryptographicKey` fails ("The publicKey must be of type CryptographicKey"). Fix: `serverExternalPackages: ['@fedify/fedify', '@fedify/vocab', '@fedify/vocab-runtime', '@fedify/webfinger', '@fedify/sqlite']` in `next.config.mjs`.
3. **Origin**: `ctx.origin` takes the request host (`0.0.0.0` behind `next dev -H 0.0.0.0`, or the internal host behind nginx). Automatically generated activity IDs take that origin and the remote server answers **401 "the activity and its actors do not have the same origin"**. Required: the `origin` option of `createFederation` (public domain), `ctx.canonicalOrigin` to build URLs, and **explicit activity IDs**.
4. **WebFinger**: `fedifyWith` only handles requests whose `Accept` header is ActivityPub/JRD; a `fetch` without `Accept` gets Next's 404 page. Real clients send the right header. Integration tests must set it.
5. **`mapHandle`** is needed for WebFinger to find an account by its handle.
6. The federation modules keep state (queue started by `startQueue`): in development, a hot reload does not replace the singleton; restart the container to test a listener change.
7. A **listener change** only takes effect after a restart (consequence of 6).

**Not tested (for P4/P6)**: `output: standalone`, exponential retries over 48 h (Fedify: configurable `retryPolicy`, to tune), RFC 9421 (Fedify negotiates and remembers the spec accepted by the remote host, `firstKnock`), interoperability with a real Mastodon or Mobilizon (out of v1).

**Two containers `app` / `app2`**: in the app's compose file, the bridge network without DNS forbids cross `links` (cyclic dependency), and the compose network pool is exhausted. The spike uses **one container, two processes** (ports 3000 and 3001, two databases). P4 will do the same for its integration tests, or ask for a dedicated network if the infrastructure allows it.

## 4. Data model

Drizzle additions (**new** migrations, never a change to an applied migration):

| Table / column | Role | Ticket |
|---|---|---|
| `user.handle`, `user.handle_changed_at` | federated identity (§2) | P4 |
| `actor_key(user_id, public_pem, private_enc, created_at)` | key pair per account, private key encrypted (AES-256-GCM, key `FEDERATION_KEY_ENC`, modelled on `INVITE_LINK_KEY`) | P4 |
| `remote_actor(id, actor_url unique, handle, domain, display_name, inbox_url, shared_inbox_url, public_key_pem, fetched_at)` | cache of remote accounts | P4 |
| `friendship`: nullable `remote_actor_id` next to `user_id` | a friend, local **or** remote, a single notion | P5 |
| `delivery`: handled by Fedify (`fedify_message`) | persistent delivery queue | P4 |
| `remote_outing(id, object_url unique, remote_actor_id, title, starts_at, meeting_*, track_geojson, stats, status, visibility, max_participants, yes_count, fetched_at, updated_at)` | cache of remote outings | P6 |
| `remote_response(remote_outing_id, user_id, answer)` | my local answer to a remote outing | P6 |
| `federation_block(domain|actor_url, kind, reason, created_at)` | admin and user blocks | P7 |
| `federation_log(at, direction, domain, type, outcome)` | rejection log, without personal content | P7 |

None of these tables holds an email. `invitation`, `contact` (buddy book) and `/i/<token>` stay **purely local**.

## 5. ActivityPub flows (P4 to P7)

### Identity (P4)
- WebFinger, **NodeInfo 2.1** (`software.name = singletrack`, `openRegistrations` according to `AUTH_DISABLE_SIGNUP`).
- `Person` actor: `preferredUsername` = handle, `name` = first name, `inbox`, `outbox`, `followers`, `following`, public key. No email or statistics. `profile_visibility = private` ⇒ the actor exists (required for signatures) but only exposes handle and first name.
- **Shared inbox** (`/ap/inbox`) to limit deliveries per server.
- Signatures: Fedify handles the cavage draft and RFC 9421; required both inbound and outbound.

### Friends (P5)
| Action | Activity |
|---|---|
| Request | `Follow` (object = remote actor) |
| Accept | `Accept(Follow)` **and** a `Follow` back (friendship is mutual), accepted by `Accept` |
| Decline | `Reject(Follow)` |
| Remove | `Undo(Follow)` sent by the remover; the receiver deletes the relation and sends `Undo(Follow)` of its own |

A "friend" = **two `Follow`s accepted in both directions**. Only one half = pending request. Crossed requests = acceptance (rule of #1432 kept). Resolving an unknown address returns the same neutral answer as for an unknown email. No directory, no search.

### Outings (P6)
**Object**: `Event` (`@fedify/vocab`), properties: `name`, `content`, `startTime`, `location` (`Place` with `latitude`/`longitude`), `maximumAttendeeCapacity`, `joinMode`, `eventStatus`. Extension `singletrack:track` (GeoJSON simplified to 5 m + stats + attribution/licence) in the instance's JSON-LD context (prefix published under `/ns/singletrack`).

**Addressing by visibility**:

| Visibility | `to` | `cc` | Who receives it |
|---|---|---|---|
| public | `as:Public` | `followers` collection | the whole Fediverse |
| friends | the organiser's `friends` collection (private collection, see below) | — | friends' servers only |
| invitation only | **each invited actor** (one per invited remote friend) | — | **only each guest's server** |

The `friends` collection is not `followers` (public by convention): it is a private collection served only to the servers that belong to it, never enumerable.

No `Public` for a non-public outing, **including in `cc`**. Delivery: `ctx.sendActivity(sender, recipients)` with an explicit list of actors (never `"followers"` for a private outing).

**Lifecycle**:
- Creation: `Create(Event)`. Change: `Update(Event)`. Cancellation: `Update(Event)` with `eventStatus: EventCancelled` (the outing is never erased, consistent with `cancelOuting`), deletion: `Delete(Event)` (`Tombstone`). The remote server applies it on a best-effort basis.
- Answer from a remote user: `Join(Event)` (I'm in), `TentativeAccept` (maybe, ActivityStreams vocabulary) and `Leave(Event)` (no). The organiser's server applies the rules of `outingPermissions`/`joinVisibleOuting` (seats, closed outing, visibility), then answers `Accept(Join)` or `Reject(Join)` (reason `full` / `closed` in `summary`). State is also sent back in `Update(Event)` (number of "I'm in", remaining seats).
- Removing a guest: `Undo(Join)` or `Reject` depending on the side.

**Never sent**: `/i/<token>`, guests without an account, buddy book, emails, drafts, comments (out of v1), photos and the actually ridden track (out of v1).

### Security and moderation (P7)
Server blocking (as early as possible in the inbox), account blocking, rate limits per server, activity size, clock (±12 h), mandatory signature, rejection log. Blocks also apply to outgoing deliveries. Delivered in P7: see §11.

## 6. Switch and exposure

- `FEDERATION=on|off`. `off` (default until P7): no ActivityPub route answers (404 before reaching Fedify) and nothing is sent. `on` by default after P7.
- Public routes to add to `src/lib/public-routes.ts`: `/.well-known/webfinger`, `/.well-known/nodeinfo`, `/nodeinfo`, `/ap`, with tests in `tests/auth.test.ts`. **The current `proxy.ts` must call Fedify before the redirect to `/login`** (order to test).
- nginx: the instance's vhost must not sit behind an SSO. It must forward `Host` and `X-Forwarded-Proto` and **not** cache `/ap/*`. Inbox `POST`s can be large (track): `client_max_body_size` ≥ 1 MB on `/ap/`.

## 7. Impact on tickets P4 to P7

- **P4**: add to the scope `@fedify/vocab`, `@fedify/next`, `@fedify/sqlite`, the `data/federation.db` database, `serverExternalPackages`, the `globalThis` singleton, the canonical `origin`, integration tests with **one container, two processes**, and the handle rule of §2 (including `handle_changed_at`). Order in `proxy.ts`.
- **P5**: adopt the "two accepted `Follow`s" sub-model of §5.
- **P6**: "friends" addressing through a private collection, not `followers`; JSON-LD extension `singletrack:track`; `Join` / `TentativeAccept` / `Leave` vocabulary confirmed.
- **P7**: unchanged.
- No new blocker: no `[Humain]` ticket needed. To watch: interoperability with Mastodon/Mobilizon is not tested.

## 8. P4 status (#1474)

Delivered: `user.handle` / `handle_changed_at` / `handle_history` table (an old handle is never given again: settled), `actor_key`, `remote_actor` (migration 0022); WebFinger, NodeInfo 2.1, `Person` actor (handle and first name only), inboxes (actor and shared) with signatures verified by Fedify, empty outbox/followers/following (P5, P6), SQLite queue `data/federation.db` with exponential retries over ~48 h (1 min, 2, 4… capped at 8 h, 14 retries); `FEDERATION=off` by default; user menu: copyable federated address (if `FEDERATION=on`) and single handle change.

Decisions: the remote actor is cached on every signed activity received; `hasRemoteFriends` (`src/lib/federation/handle.ts`) returns `false` until P5, which must wire it to `friendship`; `FEDERATION_KEY_ENC` is required at start-up if `FEDERATION=on`; the address is not shown if federation is off. Checked: `next build` (standalone) and the `runner` image contain the Fedify packages; signed `Follow` exchange between two instances (`scripts/federation-two-instances.ts`). Not done: interoperability with a real Mastodon, RFC 9421 not tested explicitly (Fedify negotiates), encrypting existing keys if `FEDERATION_KEY_ENC` changes (impossible, never change it).


## 9. P5 status (#1475): friends across servers

Code: `src/lib/federation/friends.ts` (logic and delivery), `Follow` / `Accept` / `Reject` / `Undo` listeners in `src/lib/federation/index.ts`, single notion of friend in `src/lib/friends.ts`. Migration 0023.

- **Model**: one `friendship` row per friendship, local **or** remote. A remote friend = a local account (`requester_id` or `addressee_id`, the other NULL) + `remote_actor_id`; `remote_follow_id` keeps the URL of the received `Follow` to answer it. `pair_key` = `<user>:r:<remote_actor>`. `contact.remote_actor_id` links a buddy-book entry to a remote friend (exclusive with `contact.user_id`). `status`: `pending` while a half is missing, `accepted` once both `Follow`s are in.
- **Flows**: request = `Follow` (id `/ap/follows/<id>`); accept = `Accept(Follow)` **and** a `Follow` back (`<id>-back`), confirmed by an `Accept`; decline = `Reject`; cancel or remove = `Undo(Follow)`, the receiver deletes the relation and sends the `Undo` of its own `Follow`; crossed request = acceptance.
- **Request**: "address" field on `/copains` (visible if `FEDERATION=on`), `POST /api/friends {address}`. WebFinger resolution by Fedify (8 s timeout). Address not found ⇒ same answer as for an unknown email (`202`, nothing created). An address on this server is handled locally. Activities are sent **only** if `FEDERATION=on` and go through the queue (retries over ~48 h).
- **A single notion of friend**: `listFriends` returns local and remote friends (`userId` NULL + `remote` for remote ones), `removeFriendship` / `respondToRequest` / `linkContact` handle both, `hasRemoteFriends` locks the handle change. `outingPermissions` (`areFriendsOf`) stays **local**: a remote friend has no session here, they will see "friends" outings from their own server (P6, through `remoteFriendActorIds` / `isRemoteFriend`). `listInvitableFriends` only offers local accounts (remote invitations: P6).
- **UI**: "other server · domain" badge on the card, link to their profile on their server (no copy of stats), no invitation link for a remote friend.
- **Limits**: a remote actor that never sends an `Accept` leaves the request pending forever (no expiry); no server blocking before P7 (#1477).


## 10. P6 status (#1476): outings across servers

Code: `src/lib/federation/outings.ts` (logic, serialisation, delivery), `Create` / `Update` / `Delete` / `Join` / `TentativeAccept` / `Leave` listeners (and `Accept` / `Reject` of `Join`) in `src/lib/federation/index.ts`, hooks in `src/lib/outings/federation-hook.ts` (called by `service.ts`), invitation of remote friends in `src/lib/outings/friend-invites.ts`. Migration 0024: `remote_outing`, `remote_response`, `invitation.remote_actor_id` (+ origin `remote`). Tests: `tests/federation-outings.test.ts` (two in-memory servers + a fake Fedify server).

- **Object**: `Event` with `name`, `content`, `startTime`, `location` (`Place` lat/lon), `attributedTo`. **Departure from the study**: `@fedify/vocab` has neither `maximumAttendeeCapacity`, nor `joinMode`, nor a free extension property. Everything missing (frozen track as simplified GeoJSON + stats + attribution/licence, seats, level, e-bike, status, number of "I'm in") travels in **a `Document` attachment named `singletrack:outing`** whose URL is a `data:application/json;base64,…` (≤ 600 KB: the track is re-simplified to 10, 20, 40, 80 m when needed). Read defensively (`parseExt`: enumerations, bounds, at most 100,000 points). The **track slug** (secret link `/t/<uuid>`) is never sent.
- **Addressing** (`deliverOutingWithFedify`): public = `Public` + `followers`; friends = collection `/ap/users/<handle>/friends`, **never served** (no dispatcher: 404, not enumerable); invitation only = one activity per guest, `to` = that actor only. Recipients (`recipientsOf`): remote guests (every visibility) + accepted remote friends (public, friends). For invitation only, a friend who is not invited receives nothing.
- **Who sees what, on the remote side** (`listRemoteOutings`): public = every account; friends = the organiser's friend accounts; invitation only = accounts named in `to` **and** friends of the organiser (an invitation from a stranger is ignored), materialised by a pending `remote_response` row + the invitation email (link to `/sorties/distante/<id>`, never `/i/`).
- **Answers**: `Join` (I'm in), `TentativeAccept` (maybe), `Leave` (no), id `/ap/joins/<uuid>`. The organiser applies the same rules as locally (visibility, closed outing, seats) to an `invitation` row (`remote_actor_id`, origin `remote`, no token: `token_hash` discarded), then `Accept` / `Reject(Join)` (`summary` = `full` / `closed` / `forbidden`) and an `Update(Event)` to the answering actor only (up-to-date number of "I'm in"). An actor without rights: silence.
- **Propagation**: creation → `Create`; change, change of track, switch to public, **cancellation** (status `cancelled`, like `cancelOuting`, nothing is erased) → `Update(Event)`; remote guest removed → `Delete(Tombstone)` to their server only. Deliveries go out in the background through the queue (retries over ~48 h), only if `FEDERATION=on`. A remote deletion or cancellation **is not guaranteed**: text in the outing form (`outingVisibility.form.federationNote`) and on the remote outing page.
- **Security**: the object must be attributed to the signing actor and hosted on its domain; a copy is never modified by another actor; `Delete` and `Accept`/`Reject` only count from the organiser; the URL of an `Event` from another origin is never an outing from here. `GET /ap/outings/<id>` only returns **public** outings.
- **UI**: "My outings" lists outings from other servers ("other server · domain" badge, "I'm in" in one tap), page `/sorties/distante/<id>` (3 answers, confirmed / refused state with reason, track attribution). Inviting friends also offers remote friends (`remote:<actor>`).
- **v1 limits** (to follow up): remote outings do not appear on the map yet (#1461) nor on the discovery page, no weather / fire / hunting computed on the copy; a public outing is only pushed to remote friends (Fediverse `followers` are not tracked before P7); the number of "I'm in" from other guests is only refreshed on a remote server at the next `Update`; transferring an outing to another owner does not re-attribute the `Event`; no federated comments or photos (out of v1).

## 11. P7 status (#1477): security, moderation, enabled by default

Code: `src/lib/federation/moderation.ts` (rules and limits, `LIMITS` constant), `inbox-guard.ts` (filter before Fedify, called by `src/proxy.ts`), `src/lib/admin.ts` (`assertAdmin`). Migration 0025: `federation_block`, `remote_actor_block`, `federation_log`, `federation_report`.

- **Administrator**: emails in `ADMIN_EMAILS` (case-insensitive). Page `/admin/federation` (404 for everyone else), routes `/api/admin/federation/*` (401 without a session, 403 otherwise).
- **Blocked server** (domain; a domain also blocks its subdomains): rejected **at the door** (403, before the signature), nothing is cached, **nothing is sent** (`safeDeliver`, `send`, address lookup), and when added, friends, cached outings and invitations from that server are removed. Editable list, optional import of a Mastodon CSV (`suspend` rows, masked domains ignored).
- **Account blocked** by a user (`remote_actor_block`, button on a remote outing page and on a received friend request; list + unblock in "My friends"): friendship and answers removed, their `Follow`s, invitations and outings no longer arrive.
- **Limits**: 60 activities/min per server (429); 256 KB per activity, bounded body read (413); 200 cached outings per server (new ones are refused, updates go through); copies expire 30 days after the outing starts; clock ±12 h (Fedify `signatureTimeWindow`); mandatory signature (Fedify, 401 logged); `Delete` from an unknown actor ignored (202).
- **Anti-spam**: friend requests from a "never seen" server (no accepted friend there): 5 per day and per recipient account, the rest ignored. No directory and no account search.
- **Reporting**: "Report" on a remote outing → a `federation_report` row (one per account and per outing) + a `Flag` (organiser's actor and object) to the origin server; the local admin sees the copy.
- **Rejection log** (`federation_log`): domain, reason, activity type, never content; 1,000 rows kept.
- **Known limit**: early filtering (blocking, rate) relies on the actor **declared** by the activity, not verified; signature verification follows, and blocking is checked again on the verified actor. An attacker can therefore use up the quota of a domain they impersonate, never act on its behalf.
- **Enabled by default**: `FEDERATION` unset = `on` as soon as `FEDERATION_KEY_ENC` exists (without a key: off, warning at start-up); `FEDERATION=off` turns it off. Enabling it on a given server remains the operator's decision.
