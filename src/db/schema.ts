import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Table de métadonnées clé/valeur (version du schéma, dates de synchro...). */
export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Tables Better Auth (#1344) : utilisateurs connectés, sessions, comptes (mot de passe hashé), vérifications.
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** Langue choisie (`fr` | `en`, #1400) : langue des mails envoyés à cette personne. NULL = jamais choisie (mails en français). */
  locale: text('locale'),
  /** Profil (#1433) : `private` (défaut, visible des copains) | `public` (visible de tout connecté). */
  profileVisibility: text('profile_visibility').notNull().default('private'),
  /** Visibilité par défaut de mes nouvelles sorties (#1442) : `public` | `friends` | `invite`. */
  // Défaut « copains » depuis #1455 (côté application : la base garde son DEFAULT 'invite' (SQLite ne le change qu'en reconstruisant la table user, évité) : toute insertion Drizzle fournit 'friends').
  defaultOutingVisibility: text('default_outing_visibility').notNull().$defaultFn(() => 'friends'),
  /** #1588 : visibilité préremplie des traces dessinées / importées. */
  defaultDrawnTrackVisibility: text('default_drawn_track_visibility').notNull().default('public'),
  defaultImportedTrackVisibility: text('default_imported_track_visibility').notNull().default('private'),
  /** Charte graphique du compte (#1625) : id d'une charte de design/tokens.json, `classique` par défaut. */
  charte: text('charte').notNull().default('classique'),
  /** Identifiant fédéré (#1474) : `[a-z0-9_]{3,30}`, minuscules, unique. NULL tant que le prénom n'est pas saisi. */
  handle: text('handle'),
  /** Date de l'unique modification du handle ; NULL = jamais modifié. */
  handleChangedAt: integer('handle_changed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
}, (t) => [uniqueIndex('user_handle_unique').on(t.handle)]);

/** Anciens handles (#1474) : jamais réattribués à un autre compte. */
export const handleHistory = sqliteTable('handle_history', {
  handle: text('handle').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  retiredAt: integer('retired_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Paire de clés de signature HTTP d'un compte (#1474) ; la clé privée est chiffrée (AES-256-GCM, FEDERATION_KEY_ENC). */
export const actorKey = sqliteTable('actor_key', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  publicPem: text('public_pem').notNull(),
  privateEnc: text('private_enc').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Cache des comptes distants (#1474). Jamais d'email. */
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

// Traces VTT (#1345). Une trace peut venir d'une source externe ou être faite maison.
/** Visibilité d'une trace (#1588) : `public` (tous, même sans session), `friends` (auteur + copains), `private` (auteur seul). */
export const TRACK_VISIBILITIES = ['public', 'friends', 'private'] as const;
export const TRACK_SOURCES = ['utagawa', 'osm', 'geotrek', 'gpx', 'manual', 'edited', 'datatourisme'] as const;
export const DIFFICULTIES = ['green', 'blue', 'red', 'black'] as const;

export const track = sqliteTable(
  'track',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** UUID v4 distinct de l'id : seul identifiant exposé dans `/t/[slug]`. */
    slug: text('slug').notNull().unique().$defaultFn(() => crypto.randomUUID()),
    source: text('source', { enum: TRACK_SOURCES }).notNull(),
    externalId: text('external_id'),
    sourceUrl: text('source_url'),
    name: text('name').notNull(),
    description: text('description'),
    author: text('author'),
    /** Obligatoires à l'affichage (CC BY-NC, ODbL...). */
    license: text('license'),
    attribution: text('attribution'),
    /** GeoJSON LineString / MultiLineString sérialisé, coordonnées [lon, lat, ele?]. */
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
    /** Copie éditée (#1340) : trace d'origine. */
    parentTrackId: text('parent_track_id').references((): AnySQLiteColumn => track.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    importedAt: integer('imported_at', { mode: 'timestamp' }),
    sourceUpdatedAt: integer('source_updated_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    /** JSON brut de la source, pour réimporter sans re-télécharger. */
    raw: text('raw', { mode: 'json' }),
    /** Codes des massifs forestiers traversés (#1349) ; NULL = pas encore calculé. */
    massifs: text('massifs', { mode: 'json' }).$type<string[]>(),
    /** `draft` (#1450) : visible de son seul auteur, jamais publique ni utilisable pour une sortie. */
    status: text('status', { enum: ['draft', 'published'] }).notNull().default('published'),
    /** #1588 : qui voit la trace. Les sources synchronisées (OSM, Geotrek) sont toujours `public`. */
    visibility: text('visibility', { enum: TRACK_VISIBILITIES }).notNull().default('public'),
  },
  (t) => [
    // Upsert idempotent : un (source, external_id) n'existe qu'une fois (NULL autorisés en multiples : traces maison).
    uniqueIndex('track_source_external_uq').on(t.source, t.externalId),
    index('track_bbox_idx').on(t.bboxMinLon, t.bboxMaxLon, t.bboxMinLat, t.bboxMaxLat),
    index('track_parent_idx').on(t.parentTrackId),
  ],
);

export type TrackRow = typeof track.$inferSelect;

/**
 * Calque des singles OSM (#1372) : ways `highway=path|track` avec `mtb:scale`. Ce ne sont **pas** des traces
 * (segments sans début ni fin, des milliers) : table à part, jamais mélangée à `track`, servie par bbox.
 * Remplacée par zone (département) à chaque synchro (`npm run sync:singles`). Index spatial R-tree
 * `trail_segment_rtree` (migration `0013`, maintenu par triggers) pour la recherche par bbox à l'échelle de la France.
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
    /** GeoJSON LineString [lon, lat], simplifié à 2 m à l'import. */
    geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/geo').TrackGeometry>().notNull(),
    bboxMinLon: real('bbox_min_lon').notNull(),
    bboxMinLat: real('bbox_min_lat').notNull(),
    bboxMaxLon: real('bbox_max_lon').notNull(),
    bboxMaxLat: real('bbox_max_lat').notNull(),
    lengthM: real('length_m').notNull(),
    syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
    /** Zone de synchro (département INSEE, #1428) : une synchro remplace sa zone seulement. */
    zone: text('zone'),
  },
  (t) => [index('trail_segment_zone_idx').on(t.zone), index('trail_segment_bbox_idx').on(t.bboxMinLon, t.bboxMaxLon, t.bboxMinLat, t.bboxMaxLat)],
);

export type TrailSegmentRow = typeof trailSegment.$inferSelect;

// Sorties et invitations nominatives (#1341).
export const OUTING_LEVELS = ['balade', 'sportif', 'enduro'] as const;
export const OUTING_EBIKE = ['yes', 'no', 'only'] as const;
/** Visibilité d'une sortie (#1442) : tous les comptes connectés / mes copains / seulement les invités par lien. */
export const OUTING_VISIBILITIES = ['public', 'friends', 'invite'] as const;
export const OUTING_STATUS = ['planned', 'cancelled', 'done'] as const;
export const INVITATION_STATUS = ['pending', 'yes', 'maybe', 'no'] as const;

export const outing = sqliteTable(
  'outing',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** UUID v4 : page organisateur `/s/[slug]` (connecté). Régénérable. */
    slug: text('slug').notNull().unique().$defaultFn(() => crypto.randomUUID()),
    trackId: text('track_id').references(() => track.id, { onDelete: 'set null' }),
    /** Trace figée à la création : { name, geometry, stats, attribution... } (voir lib/outings/snapshot). */
    trackSnapshot: text('track_snapshot', { mode: 'json' }).$type<import('@/lib/outings/snapshot').TrackSnapshot>().notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** UTC en base, affiché en Europe/Paris. */
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
    /** Qui a créé la sortie (« proposée par »), conservé pour l'historique même si la sortie devient publique (#1455). */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** Propriétaire (seul à modifier / annuler). **NULL = sortie publique sans propriétaire**, figée (#1455). */
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    /** Privée : les participants inscrits peuvent inviter leurs copains (#1455). Toujours vrai en publique. */
    participantsCanInvite: integer('participants_can_invite', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_track_idx').on(t.trackId), index('outing_starts_idx').on(t.startsAt)],
);

/**
 * Archivage par personne (#1459, epic #1463 P5) : `archived` explicite pour (sortie, compte). Sans ligne, une sortie
 * passée est archivée d'office et une sortie à venir ne l'est pas ; une ligne force l'un ou l'autre (« Désarchiver »,
 * « Quitter »). N'affecte ni les stats, ni le profil, ni les autres participants.
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

/** Carnet de potes (#1359) : habitués d'un utilisateur, prénom + note seulement (aucune donnée perso en v1). */
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
    /** Compte copain lié à ce pote (#1432), NULL = simple prénom. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Copain d'un autre serveur lié à ce pote (#1475), NULL = non lié. Exclusif avec `user_id`. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'set null' }),
  },
  (t) => [index('contact_owner_idx').on(t.ownerUserId)],
);

/**
 * Relation d'amitié (#1432) : une seule ligne par paire (`pair_key` = ids triés). Un copain d'un autre serveur (#1475)
 * est une ligne où l'un des deux comptes locaux est NULL et `remote_actor_id` renseigné : `requester_id` NULL = c'est lui qui
 * a demandé, `addressee_id` NULL = c'est moi. L'amitié « deux Follow acceptés » tient en une ligne `accepted`.
 */
export const friendship = sqliteTable(
  'friendship',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    requesterId: text('requester_id').references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id').references(() => user.id, { onDelete: 'cascade' }),
    /** Copain d'un autre serveur (#1475) ; NULL = amitié entre deux comptes locaux. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'cascade' }),
    /** URL de l'activité `Follow` reçue du copain distant (pour y répondre par `Accept`/`Reject`). */
    remoteFollowId: text('remote_follow_id'),
    pairKey: text('pair_key').notNull(),
    status: text('status', { enum: ['pending', 'accepted'] }).notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    respondedAt: integer('responded_at', { mode: 'timestamp' }),
  },
  (t) => [uniqueIndex('friendship_pair_idx').on(t.pairKey), index('friendship_addressee_idx').on(t.addresseeId)],
);

/** Lien d'invitation copain à usage unique (#1432) ; seul le hash du token est stocké. */
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
    /** Contact du carnet (#1359), NULL pour une invitation saisie à la main sans carnet. */
    contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    /** SHA-256 (hex) du token : le token en clair n'est jamais stocké, il n'existe que dans le lien. */
    tokenHash: text('token_hash').notNull().unique(),
    /** Token chiffré (AES-256-GCM, `INVITE_LINK_KEY`, #1456) pour réafficher le lien ; NULL = lien créé avant, non réaffichable. */
    tokenEnc: text('token_enc'),
    /** Compte rattaché par l'invité lui-même (#1434) ; NULL = invité sans compte. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Copain d'un autre serveur invité ou venu répondre (#1476) : sa réponse arrive par ActivityPub, jamais de lien `/i/<token>`. */
    remoteActorId: text('remote_actor_id').references(() => remoteActor.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', { enum: INVITATION_STATUS }).notNull().default('pending'),
    comment: text('comment'),
    origin: text('origin', { enum: ['personal', 'open_link', 'self', 'remote'] }).notNull().default('personal'),
    /** Qui a créé ce lien (#1457) : compte connecté, ou invitation d'un invité sans compte. Sert à limiter la révocation en publique. */
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdByInvitationId: text('created_by_invitation_id'),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    respondedAt: integer('responded_at', { mode: 'timestamp' }),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('invitation_outing_idx').on(t.outingId), index('invitation_user_idx').on(t.userId), index('invitation_remote_idx').on(t.remoteActorId)],
);

/** Sortie d'un autre serveur (#1476) : copie en cache, le serveur de l'organisateur reste la référence. Ni lien `/i/`, ni email. */
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
    /** Trace figée (`singletrack:outing`) : géométrie, stats, attribution et licence. */
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
 * Ma réponse (compte local) à une sortie distante (#1476). `pending` sans réponse = invité, pas encore répondu.
 * `state` : `sent` (envoyée, pas de réponse du serveur), `accepted`, `rejected` (+ `reason` : `full` / `closed` / `forbidden`).
 */
export const remoteResponse = sqliteTable(
  'remote_response',
  {
    remoteOutingId: text('remote_outing_id').notNull().references(() => remoteOuting.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    answer: text('answer', { enum: ['pending', 'yes', 'maybe', 'no'] }).notNull().default('pending'),
    state: text('state', { enum: ['none', 'sent', 'accepted', 'rejected'] }).notNull().default('none'),
    reason: text('reason'),
    /** Identifiant (URL `/ap/joins/<id>`) de ma dernière activité, pour rapprocher l'`Accept` / `Reject`. */
    joinId: text('join_id'),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.remoteOutingId, t.userId] }), index('remote_response_user_idx').on(t.userId)],
);

/** Serveur bloqué par l'admin (#1477) : rien n'est accepté ni envoyé. `source` : saisie à la main ou import d'une liste partagée. */
export const federationBlock = sqliteTable('federation_block', {
  domain: text('domain').primaryKey(),
  reason: text('reason'),
  source: text('source', { enum: ['admin', 'import'] }).notNull().default('admin'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

/** Compte distant bloqué par un compte local (#1477) : ses demandes de copain et ses invitations n'arrivent plus. */
export const remoteActorBlock = sqliteTable(
  'remote_actor_block',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    remoteActorId: text('remote_actor_id').notNull().references(() => remoteActor.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.userId, t.remoteActorId] })],
);

/** Journal des activités refusées (#1477) : domaine, motif, type d'activité. Jamais de contenu personnel. */
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

/** Signalement d'une sortie distante par un compte local (#1477) : copie pour l'admin ; un `Flag` part au serveur d'origine. */
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
 * Trace réellement roulée (#1412) : un GPX par personne et par sortie (nouveau téléversement = remplacement).
 * `invitation_id` NULL = l'organisateur (`author_user_id`). Géométrie simplifiée à 5 m ; stats calculées à l'import.
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
    /** NULL si le GPX n'a pas d'altitude. */
    gainM: real('gain_m'),
    /** Temps de déplacement (hors pauses) ; NULL si le GPX n'a pas d'horodatage. */
    movingSec: integer('moving_sec'),
    elapsedSec: integer('elapsed_sec'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_ride_outing_idx').on(t.outingId)],
);

/** Photos d'une sortie (#1413). Fichiers dans `data/media/<sortie>/` (JPEG sans EXIF) ; lat/lon = position EXIF gardée seulement pour placer la photo sur la carte. */
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
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('outing_photo_outing_idx').on(t.outingId)],
);

/** Fil de discussion d'une sortie (#1358). `invitation_id` NULL = message de l'organisateur. Suppression douce. */
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

/** Jeton d'abonnement agenda de l'organisateur (#1357) : toutes ses sorties dans un flux webcal. En clair (c'est un
 *  lien personnel qu'il doit pouvoir revoir), régénérable ; régénérer invalide l'ancien lien. */
export const calendarFeed = sqliteTable('calendar_feed', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

export type OutingRow = typeof outing.$inferSelect;
export type ContactRow = typeof contact.$inferSelect;
export type InvitationRow = typeof invitation.$inferSelect;

// Massifs forestiers du Var et niveaux de risque incendie (#1349).
/** Contours des massifs (préfecture du Var), rafraîchis au plus une fois par saison. */
export const massif = sqliteTable('massif', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  /** GeoJSON MultiPolygon, coordonnées [lon, lat]. */
  geometry: text('geometry', { mode: 'json' }).$type<import('@/lib/fire/types').MassifGeometry>().notNull(),
  bboxMinLon: real('bbox_min_lon').notNull(),
  bboxMinLat: real('bbox_min_lat').notNull(),
  bboxMaxLon: real('bbox_max_lon').notNull(),
  bboxMaxLat: real('bbox_max_lat').notNull(),
});

/** Niveau (1 vert … 5 noir) d'un massif pour un jour (`YYYY-MM-DD`, Europe/Paris). */
export const massifLevel = sqliteTable(
  'massif_level',
  {
    date: text('date').notNull(),
    massifCode: text('massif_code').notNull(),
    level: integer('level').notNull(),
    /** Second entier du fichier officiel (procédure / ZAPEF). */
    extra: integer('extra').notNull().default(0),
  },
  (t) => [uniqueIndex('massif_level_pk').on(t.date, t.massifCode)],
);

/** Une ligne par jour interrogé : `ok` (fichier lu), `none` (pas de fichier : hors saison), `error`. */
export const massifDay = sqliteTable('massif_day', {
  date: text('date').primaryKey(),
  status: text('status', { enum: ['ok', 'none', 'error'] }).notNull(),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).notNull(),
});
