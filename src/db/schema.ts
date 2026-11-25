import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Key/value metadata table (schema version, sync dates...). */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Better Auth tables (#1344): signed-in users, sessions, accounts (hashed password), verifications.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** Chosen language (`fr` | `en`, #1400): language of the emails sent to this person. NULL = never chosen (emails in French). */
  locale: text('locale'),
  /** Profile (#1433): `private` (default, visible to friends) | `public` (visible to any signed-in account). */
  profileVisibility: text('profile_visibility').notNull().default('private'),
  /** Default visibility of my new outings (#1442): `public` | `friends` | `invite`. */
  // "Friends" default since #1455 (application side: the database keeps its DEFAULT 'invite' (SQLite only changes it by rebuilding the user table, avoided): every Drizzle insert provides 'friends').
  defaultOutingVisibility: text('default_outing_visibility').notNull().$defaultFn(() => 'friends'),
  /** #1588: pre-filled visibility of drawn / imported tracks. */
  defaultDrawnTrackVisibility: text('default_drawn_track_visibility').notNull().default('public'),
  defaultImportedTrackVisibility: text('default_imported_track_visibility').notNull().default('private'),
  /** Visual charter of the account (#1625): id of a charter in design/tokens.json, `classique` by default. */
  charte: text('charte').notNull().default('classique'),
  /** Federated identifier (#1474): `[a-z0-9_]{3,30}`, lower case, unique. NULL until the first name is entered. */
  handle: text('handle'),
  /** Date of the single change of the handle; NULL = never changed. */
  handleChangedAt: integer('handle_changed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('user_handle_unique').on(t.handle)]);

/** Old handles (#1474): never given to another account. */
export const handleHistory = sqliteTable('handle_history', {
  handle: text('handle').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  retiredAt: integer('retired_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** HTTP signature key pair of an account (#1474); the private key is encrypted (AES-256-GCM, FEDERATION_KEY_ENC). */
export const actorKey = sqliteTable('actor_key', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  publicPem: text('public_pem').notNull(),
  privateEnc: text('private_enc').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Cache of remote accounts (#1474). Never an email. */
export const remoteActor = sqliteTable('remote_actor', {
  id: text('id').primaryKey(),
  actorUrl: text('actor_url').notNull().unique(),
  handle: text('handle').notNull(),
  domain: text('domain').notNull(),
  displayName: text('display_name'),
  inboxUrl: text('inbox_url').notNull(),
  sharedInboxUrl: text('shared_inbox_url'),
  publicKeyPem: text('public_key_pem'),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// Mountain-bike tracks (#1345). A track may come from an external source or be home-made.
/** Visibility of a track (#1588): `public` (everyone, even without a session), `friends` (author + friends), `private` (author only). */
export const TRACK_VISIBILITIES = ['public', 'friends', 'private'] as const;
export const TRACK_SOURCES = ['utagawa', 'osm', 'geotrek', 'gpx', 'manual', 'edited', 'datatourisme'] as const;
export const DIFFICULTIES = ['green', 'blue', 'red', 'black'] as const;

export const track = sqliteTable(
  'track',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** UUID v4 distinct from the id: the only identifier exposed in `/t/[slug]`. */
    slug: text('slug').notNull().unique().$defaultFn(() => crypto.randomUUID()),
    source: text('source', { enum: TRACK_SOURCES }).notNull(),
    externalId: text('external_id'),
    sourceUrl: text('source_url'),
    name: text('name').notNull(),
    description: text('description'),
    author: text('author'),
    /** Required for display (CC BY-NC, ODbL...). */
    license: text('license'),
    attribution: text('attribution'),
    /** Serialised GeoJSON LineString / MultiLineString, coordinates [lon, lat, ele?]. */
    geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/geo').TrackGeometry>().notNull(),
    bboxMinLon: real('bbox_min_lon').notNull(),
    bboxMinLat: real('bbox_min_lat').notNull(),
    bboxMaxLon: real('bbox_max_lon').notNull(),
    bboxMaxLat: real('bbox_max_lat').notNull(),
    startLon: real('start_lon').notNull(),
    startLat: real('start_lat').notNull(),
    distanceM: real('distance_m').notNull(),
    elevationGainM: real('elevation_gain_m'),
    elevationLossM: real('elevation_loss_m'),
    minEle: real('min_ele'),
    maxEle: real('max_ele'),
    difficulty: text('difficulty', { enum: DIFFICULTIES }),
    difficultyRaw: text('difficulty_raw'),
    loop: integer('loop', { mode: 'boolean' }).notNull().default(false),
    /** Edited copy (#1340): original track. */
    parentTrackId: text('parent_track_id').references((): AnySQLiteColumn => track.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    importedAt: integer('imported_at', { mode: 'timestamp' }),
    sourceUpdatedAt: integer('source_updated_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    /** Raw JSON of the source, to re-import without downloading again. */
    raw: text('raw', { mode: 'json' }),
    /** Codes of the crossed forest massifs (#1349); NULL = not computed yet. */
    massifs: text('massifs', { mode: 'json' }).$type<string[]>(),
    /** `draft` (#1450): visible to its author only, never public nor usable for an outing. */
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('published'),
    /** #1588: who sees the track. Synced sources (OSM, Geotrek, DATAtourisme) are always `public`. */
    visibility: text('visibility', { enum: TRACK_VISIBILITIES }).notNull().default('public'),
  },
  (t) => [
    // Idempotent upsert: a (source, external_id) exists only once (multiple NULLs allowed: home-made tracks).
    uniqueIndex('track_source_external_uq').on(t.source, t.externalId),
    index('track_bbox_idx').on(t.bboxMinLon, t.bboxMaxLon, t.bboxMinLat, t.bboxMaxLat),
    index('track_parent_idx').on(t.parentTrackId),
  ],
);

export type TrackRow = typeof track.$inferSelect;

/**
 * OSM singletrack layer (#1372): `highway=path|track` ways with `mtb:scale`. These are **not** tracks
 * (segments without start or end, by the thousands): separate table, never mixed with `track`, served by bbox.
 * Replaced per area (department) on each sync (`npm run sync:singles`). R-tree spatial index
 * `trail_segment_rtree` (migration `0013`, maintained by triggers) for bbox search at the scale of France.
 */
export const trailSegment = sqliteTable(
  'trail_segment',
  {
    /** `way/<id>` OSM. */
    osmId: text('osm_id').primaryKey(),
    name: text('name'),
    highway: text('highway').notNull(),
    /** Valeur brute `mtb:scale` (ex. « 2+ »). */
    mtbScale: text('mtb_scale').notNull(),
    difficulty: text('difficulty', { enum: DIFFICULTIES }),
    /** Raw OSM `surface` tag (#1687), null if not tagged. */
    surface: text('surface'),
    /** Raw OSM `mtb:scale:uphill` tag (#1687), null if not tagged. */
    mtbScaleUphill: text('mtb_scale_uphill'),
    /** GeoJSON LineString [lon, lat], simplified to 2 m at import. */
    geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/geo').TrackGeometry>().notNull(),
    bboxMinLon: real('bbox_min_lon').notNull(),
    bboxMinLat: real('bbox_min_lat').notNull(),
    bboxMaxLon: real('bbox_max_lon').notNull(),
    bboxMaxLat: real('bbox_max_lat').notNull(),
    lengthM: real('length_m').notNull(),
    syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
    /** Sync area (INSEE department, #1428): a sync only replaces its own area. */
    zone: text('zone'),
  },
  (t) => [index('trail_segment_zone_idx').on(t.zone), index('trail_segment_bbox_idx').on(t.bboxMinLon, t.bboxMaxLon, t.bboxMinLat, t.bboxMaxLat)],
);

export type TrailSegmentRow = typeof trailSegment.$inferSelect;

// Sorties et invitations nominatives (#1341).
export const OUTING_LEVELS = ['balade', 'sportif', 'enduro'] as const;
export const OUTING_EBIKE = ['yes', 'no', 'only'] as const;
/** Visibility of an outing (#1442): every signed-in account / my friends / link guests only. */
export const OUTING_VISIBILITIES = ['public', 'friends', 'invite'] as const;
export const OUTING_STATUS = ['planned', 'cancelled', 'done'] as const;
export const INVITATION_STATUS = ['pending', 'yes', 'maybe', 'no'] as const;

export const outing = sqliteTable(
  'outing',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** UUID v4: organiser page `/s/[slug]` (signed in). Can be regenerated. */
    slug: text('slug').notNull().unique().$defaultFn(() => crypto.randomUUID()),
    trackId: text('track_id').references(() => track.id, { onDelete: 'set null' }),
    /** Track frozen at creation: { name, geometry, stats, attribution... } (see lib/outings/snapshot). */
    trackSnapshot: text('track_snapshot', { mode: 'json' }).$type<import('@/lib/outings/snapshot').TrackSnapshot>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** UTC in the database, shown in Europe/Paris. */
    startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
    meetingLat: real('meeting_lat').notNull(),
    meetingLon: real('meeting_lon').notNull(),
    meetingLabel: text('meeting_label'),
    level: text('level', { enum: OUTING_LEVELS }).notNull().default('sportif'),
    ebike: text('ebike', { enum: OUTING_EBIKE }).notNull().default('yes'),
    maxParticipants: integer('max_participants'),
    status: text('status', { enum: OUTING_STATUS }).notNull().default('planned'),
    visibility: text('visibility', { enum: OUTING_VISIBILITIES }).notNull().default('invite'),
    openLinkEnabled: integer('open_link_enabled', { mode: 'boolean' }).notNull().default(false),
    openLinkToken: text('open_link_token').notNull().$defaultFn(() => crypto.randomUUID()),
    /** Who created the outing ("proposed by"), kept for history even if the outing becomes public (#1455). */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Owner (the only one who edits / cancels). **NULL = public outing without an owner**, frozen (#1455). */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    /** Private: registered participants may invite their friends (#1455). Always true for a public outing. */
    participantsCanInvite: integer('participants_can_invite', { mode: 'boolean' }).notNull().default(false),
    /** Ridden track chosen by the organiser for the outing recap (#1692). No FK: a stale id falls back to the default. */
    referenceRideId: text('reference_ride_id'),
    /** Idempotency key of an outing created from an app recording (#1765): unique per creator. */
    clientId: text('client_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_track_idx').on(t.trackId), index('outing_starts_idx').on(t.startsAt), uniqueIndex('outing_client_id_uq').on(t.createdBy, t.clientId)],
);

/**
 * Per-person archiving (#1459, epic #1463 P5): explicit `archived` for (outing, account). Without a row, a past outing
 * is archived by default and an upcoming one is not; a row forces one or the other ("Un-archive",
 * "Leave"). Affects neither stats, nor the profile, nor the other participants.
 */
export const outingArchive = sqliteTable(
  'outing_archive',
  {
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    archived: integer('archived', { mode: 'boolean' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.outingId, t.userId] })],
);

/** Buddy book (#1359): a user's regulars, first name + note only (no personal data in v1). */
export const contact = sqliteTable(
  'contact',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    ownerUserId: text('owner_user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    lastInvitedAt: integer('last_invited_at', { mode: 'timestamp' }),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    /** Friend account linked to this buddy (#1432), NULL = plain first name. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Friend on another server linked to this buddy (#1475), NULL = not linked. Exclusive with `user_id`. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'set null' }),
  },
  (t) => [index('contact_owner_idx').on(t.ownerUserId)],
);

/**
 * Friendship relation (#1432): a single row per pair (`pair_key` = sorted ids). A friend on another server (#1475)
 * is a row where one of the two local accounts is NULL and `remote_actor_id` is set: `requester_id` NULL = they
 * asked, `addressee_id` NULL = I asked. The "two accepted Follows" friendship fits in one `accepted` row.
 */
export const friendship = sqliteTable(
  'friendship',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    requesterId: text('requester_id').references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id').references(() => user.id, { onDelete: 'cascade' }),
    /** Friend on another server (#1475); NULL = friendship between two local accounts. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'cascade' }),
    /** URL of the `Follow` activity received from the remote friend (to answer it with `Accept`/`Reject`). */
    remoteFollowId: text('remote_follow_id'),
    pairKey: text('pair_key').notNull(),
    status: text('status', { enum: ['pending', 'accepted'] }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    respondedAt: integer('responded_at', { mode: 'timestamp' }),
  },
  (t) => [uniqueIndex('friendship_pair_idx').on(t.pairKey), index('friendship_addressee_idx').on(t.addresseeId)],
);

/** Single-use friend invitation link (#1432); only the token's hash is stored. */
export const friendInvite = sqliteTable('friend_invite', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  inviterId: text('inviter_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
});

export const invitation = sqliteTable(
  'invitation',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    /** Buddy-book contact (#1359), NULL for an invitation typed by hand without the book. */
    contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    /** SHA-256 (hex) of the token: the plain token is never stored, it only exists in the link. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Encrypted token (AES-256-GCM, `INVITE_LINK_KEY`, #1456) to show the link again; NULL = link created before, cannot be shown again. */
    tokenEnc: text('token_enc'),
    /** Account attached by the guest themselves (#1434); NULL = guest without an account. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Friend on another server invited or who came to answer (#1476): their answer arrives through ActivityPub, never an `/i/<token>` link. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: INVITATION_STATUS }).notNull().default('pending'),
    comment: text('comment'),
    origin: text('origin', { enum: ['personal', 'open_link', 'self', 'remote'] }).notNull().default('personal'),
    /** Who created this link (#1457): signed-in account, or invitation of a guest without an account. Used to limit revocation on public outings. */
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdByInvitationId: text('created_by_invitation_id'),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    respondedAt: integer('responded_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('invitation_outing_idx').on(t.outingId), index('invitation_user_idx').on(t.userId), index('invitation_remote_idx').on(t.remoteActorId)],
);

/** Outing from another server (#1476): cached copy, the organiser's server remains the reference. No `/i/` link, no email. */
export const remoteOuting = sqliteTable(
  'remote_outing',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** URL de l'objet `Event` chez l'organisateur : identifiant stable. */
    objectUrl: text('object_url').notNull().unique(),
    remoteActorId: text('remote_actor_id').notNull().references(() => remoteActor.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    startsAt: integer('starts_at', { mode: 'timestamp' }).notNull(),
    meetingLat: real('meeting_lat').notNull(),
    meetingLon: real('meeting_lon').notNull(),
    meetingLabel: text('meeting_label'),
    level: text('level', { enum: OUTING_LEVELS }).notNull().default('sportif'),
    ebike: text('ebike', { enum: OUTING_EBIKE }).notNull().default('yes'),
    /** Frozen track (`singletrack:outing`): geometry, stats, attribution and licence. */
    track: text('track', { mode: 'json' }).$type<import('@/lib/outings/snapshot').TrackSnapshot | null>(),
    status: text('status', { enum: OUTING_STATUS }).notNull().default('planned'),
    visibility: text('visibility', { enum: OUTING_VISIBILITIES }).notNull().default('invite'),
    maxParticipants: integer('max_participants'),
    yesCount: integer('yes_count').notNull().default(0),
    fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  },
  (t) => [index('remote_outing_actor_idx').on(t.remoteActorId), index('remote_outing_starts_idx').on(t.startsAt)],
);

/**
 * My answer (local account) to a remote outing (#1476). `pending` without an answer = guest, not answered yet.
 * `state`: `sent` (sent, no answer from the server), `accepted`, `rejected` (+ `reason`: `full` / `closed` / `forbidden`).
 */
export const remoteResponse = sqliteTable(
  'remote_response',
  {
    remoteOutingId: text('remote_outing_id').notNull().references(() => remoteOuting.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    answer: text('answer', { enum: ['pending', 'yes', 'maybe', 'no'] }).notNull().default('pending'),
    state: text('state', { enum: ['none', 'sent', 'accepted', 'rejected'] }).notNull().default('none'),
    reason: text('reason'),
    /** Id (URL `/ap/joins/<id>`) of my last activity, to match the `Accept` / `Reject`. */
    joinId: text('join_id'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.remoteOutingId, t.userId] }), index('remote_response_user_idx').on(t.userId)],
);

/**
 * My ridden track on an outing from another server (#1775). Kept here whole (my own copy); its id is the federated object
 * `/ap/rides/<id>`, served trimmed (first/last 300 m hidden) and only to the organiser's server. `sentAt` = delivered at least
 * once (so a change is an `Update` and a removal a `Delete`); NULL = kept here only (federation off, organiser's server too old).
 */
export const remoteRide = sqliteTable(
  'remote_ride',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    remoteOutingId: text('remote_outing_id').notNull().references(() => remoteOuting.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/geo/types').TrackGeometry>().notNull(),
    distanceM: real('distance_m').notNull(),
    gainM: real('gain_m'),
    movingSec: integer('moving_sec'),
    elapsedSec: integer('elapsed_sec'),
    times: text('times', { mode: 'json' }).$type<number[]>(),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('remote_ride_outing_user_idx').on(t.remoteOutingId, t.userId)],
);

/** Server blocked by the admin (#1477): nothing is accepted or sent. `source`: typed by hand or imported from a shared list. */
export const federationBlock = sqliteTable('federation_block', {
  domain: text('domain').primaryKey(),
  reason: text('reason'),
  source: text('source', { enum: ['admin', 'import'] }).notNull().default('admin'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Remote account blocked by a local account (#1477): its friend requests and invitations no longer arrive. */
export const remoteActorBlock = sqliteTable(
  'remote_actor_block',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    remoteActorId: text('remote_actor_id').notNull().references(() => remoteActor.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.remoteActorId] })],
);

/** Log of rejected activities (#1477): domain, reason, activity type. Never personal content. */
export const federationLog = sqliteTable(
  'federation_log',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    at: integer('at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    domain: text('domain'),
    reason: text('reason').notNull(),
    activity: text('activity'),
  },
  (t) => [index('federation_log_at_idx').on(t.at)],
);

/** Report of a remote outing by a local account (#1477): copy for the admin; a `Flag` goes to the origin server. */
export const federationReport = sqliteTable(
  'federation_report',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    reporterId: text('reporter_id').references(() => user.id, { onDelete: 'set null' }),
    objectUrl: text('object_url').notNull(),
    domain: text('domain').notNull(),
    title: text('title').notNull(),
    reason: text('reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex('federation_report_once_idx').on(t.reporterId, t.objectUrl)],
);

/**
 * Actually ridden track (#1412): one GPX per person and per outing (new upload = replacement).
 * `invitation_id` NULL = the organiser (`author_user_id`). Geometry simplified to 5 m; stats computed at import.
 */
export const outingRide = sqliteTable(
  'outing_ride',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    invitationId: text('invitation_id').references(() => invitation.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/geo/types').TrackGeometry>().notNull(),
    distanceM: real('distance_m').notNull(),
    /** NULL if the GPX has no elevation. */
    gainM: real('gain_m'),
    /** Moving time (breaks excluded); NULL if the GPX has no timestamps. */
    movingSec: integer('moving_sec'),
    elapsedSec: integer('elapsed_sec'),
    /** Time of each point of `geometry` (epoch ms, flattened in order); NULL if the file has no timestamps (#1692). */
    times: text('times', { mode: 'json' }).$type<number[]>(),
    /**
     * URL of the federated ride object (`/ap/rides/<id>` on the participant's server) when this track came from a guest on
     * another server (#1775). Its first and last 300 m were already hidden by that server: never trimmed again on read.
     */
    remoteUrl: text('remote_url').unique(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_ride_outing_idx').on(t.outingId)],
);

/**
 * Key moments noted during a ridden track (#1798): GPX `<wpt>` / KML `Placemark` Point, kept when the track is analysed.
 * Replacing the track replaces its moments (cascade + re-insert). `at` = epoch ms, NULL if the waypoint is undated.
 */
export const outingRideMoment = sqliteTable(
  'outing_ride_moment',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    rideId: text('ride_id').notNull().references(() => outingRide.id, { onDelete: 'cascade' }),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    at: integer('at'),
    name: text('name'),
    type: text('type'),
  },
  (t) => [index('outing_ride_moment_ride_idx').on(t.rideId)],
);

/** Outing photos (#1413). Files in `data/media/<outing>/` (JPEG without EXIF); lat/lon = EXIF position kept only to place the photo on the map. */
export const outingPhoto = sqliteTable(
  'outing_photo',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    invitationId: text('invitation_id').references(() => invitation.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    lat: real('lat'),
    lon: real('lon'),
    /** Capture time (epoch ms, EXIF DateTimeOriginal); NULL if unknown (#1692). */
    takenAt: integer('taken_at'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_photo_outing_idx').on(t.outingId)],
);

/**
 * Short participant video (#1693). Uploaded original converted in the background (H.264 720p, AAC, faststart) by the
 * video queue (`src/lib/media/video-queue.ts`); `status` = `pending` → `ready` | `failed`. Capture time and position
 * are read by ffprobe before conversion, kept here, and stripped from the published file.
 */
export const outingVideo = sqliteTable(
  'outing_video',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    invitationId: text('invitation_id').references(() => invitation.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
    /** Published size (after conversion); source size while pending. */
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    durationMs: integer('duration_ms').notNull(),
    lat: real('lat'),
    lon: real('lon'),
    /** Capture time (epoch ms, QuickTime `creation_time`); NULL if unknown. */
    takenAt: integer('taken_at'),
    /** Encoder actually used (`h264_qsv` | `libx264`), for diagnostics. */
    encoder: text('encoder'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_video_outing_idx').on(t.outingId)],
);

/** Discussion thread of an outing (#1358). `invitation_id` NULL = organiser's message. Soft delete. */
export const outingComment = sqliteTable(
  'outing_comment',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    outingId: text('outing_id').notNull().references(() => outing.id, { onDelete: 'cascade' }),
    invitationId: text('invitation_id').references(() => invitation.id, { onDelete: 'cascade' }),
    authorUserId: text('author_user_id').references(() => user.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    editedAt: integer('edited_at', { mode: 'timestamp_ms' }),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('outing_comment_outing_idx').on(t.outingId, t.createdAt)],
);

/** Organiser's calendar subscription token (#1357): all their outings in one webcal feed. In clear (it is a
 *  personal link they must be able to see again), can be regenerated; regenerating invalidates the old link. */
export const calendarFeed = sqliteTable('calendar_feed', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type OutingRow = typeof outing.$inferSelect;
export type ContactRow = typeof contact.$inferSelect;
export type InvitationRow = typeof invitation.$inferSelect;

// Var forest massifs and fire risk levels (#1349).
/** Massif outlines (Var prefecture), refreshed at most once per season. */
export const massif = sqliteTable('massif', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** GeoJSON MultiPolygon, coordinates [lon, lat]. */
  geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/fire/types').MassifGeometry>().notNull(),
  bboxMinLon: real('bbox_min_lon').notNull(),
  bboxMinLat: real('bbox_min_lat').notNull(),
  bboxMaxLon: real('bbox_max_lon').notNull(),
  bboxMaxLat: real('bbox_max_lat').notNull(),
});

/** Level (1 green … 5 black) of a massif for a day (`YYYY-MM-DD`, Europe/Paris). */
export const massifLevel = sqliteTable(
  'massif_level',
  {
    date: text('date').notNull(),
    massifCode: text('massif_code').notNull(),
    level: integer('level').notNull(),
    /** Second integer of the official file (procedure / ZAPEF). */
    extra: integer('extra').notNull().default(0),
  },
  (t) => [uniqueIndex('massif_level_pk').on(t.date, t.massifCode)],
);

/** One row per queried day: `ok` (file read), `none` (no file: out of season), `error`. */
export const massifDay = sqliteTable('massif_day', {
  date: text('date').primaryKey(),
  status: text('status', { enum: ['ok', 'none', 'error'] }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});

/**
 * Companion Android app (#1720). `app_pairing`: short single-use code (hash only, 5 min) shown as a QR in the user menu;
 * `app_token`: long-lived revocable token obtained by exchanging it (hash only, `Authorization: Bearer`, `/api/app/*` only).
 */
export const appPairing = sqliteTable('app_pairing', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  usedAt: integer('used_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const appToken = sqliteTable(
  'app_token',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
  },
  (t) => [index('app_token_user_idx').on(t.userId)],
);

/**
 * Offline packs (#1738): one row per region served to the companion app. The `.pmtiles` extract lives in
 * `<DATA>/offline/<id>.pmtiles`; `segments` = BRouter `.rd5` tiles covering the bbox (JSON array of names).
 * `instance_setting`: small key/value store for admin switches (e.g. `offline.enabled`).
 */
export const offlineRegion = sqliteTable('offline_region', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  bbox: text('bbox').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  pmtilesPath: text('pmtiles_path'),
  sizeBytes: integer('size_bytes'),
  version: text('version'),
  builtAt: integer('built_at', { mode: 'timestamp' }),
  segments: text('segments').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export const instanceSetting = sqliteTable('instance_setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Offline packs usage (#1739): bytes served to the companion app per token (rate limit + /admin/offline). */
export const offlineUsage = sqliteTable(
  'offline_usage',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tokenId: text('token_id').notNull().references(() => appToken.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('offline_usage_token_idx').on(t.tokenId, t.createdAt)],
);

/**
 * Offline pack jobs (#1749): `/admin/offline` enqueues, the separate `offline-worker` service runs them one at a time.
 * `kind` = `build` (one region, `region_id`) | `refresh` (every enabled region, `region_id` null);
 * `status` = `queued` | `running` | `done` | `failed`; `step` = progress (`map`, `segments`); `error` = short code/message.
 */
export const offlineJob = sqliteTable(
  'offline_job',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    kind: text('kind').notNull(),
    regionId: text('region_id'),
    status: text('status').notNull().default('queued'),
    step: text('step'),
    error: text('error'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('offline_job_status_idx').on(t.status, t.createdAt)],
);
