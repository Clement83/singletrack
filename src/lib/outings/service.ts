import { and, asc, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { calendarFeed, invitation, outing, track, OUTING_EBIKE, OUTING_LEVELS, type InvitationRow, type OutingRow } from '@/db/schema';
import { getDefaultOutingVisibility, isOutingVisibility } from '@/lib/user-profile';
import { ensureTrackElevation } from '@/lib/tracks/elevation';
import { snapshotOf } from './snapshot';
import { decryptToken, hashToken, newInviteToken, newToken } from './tokens';
import { parisToUtc } from './time';
import { outingPermissions, isFrozen } from './permissions';
import { emitOutingChange, emitRemoteRetract } from './federation-hook';

/** Une sortie reste ouverte aux réponses jusqu'à 6 h après son départ. */
const GRACE_MS = 6 * 3600_000;

export type OutingInput = {
  trackSlug?: string;
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  meetingLat?: number;
  meetingLon?: number;
  meetingLabel?: string;
  level?: string;
  ebike?: string;
  maxParticipants?: number | null;
  /** `public | friends | invite` (#1442) ; absent à la création = défaut du compte. */
  visibility?: string;
  /** Privée : les participants inscrits peuvent inviter leurs copains (#1455). Ignoré en publique (toujours vrai). */
  participantsCanInvite?: boolean;
};

/** Champ → code d'erreur, traduit côté client (`errors.<code>`, #1402). */
export type Errors = Record<string, string>;

function validate(input: OutingInput, partial: boolean): { errors: Errors; startsAt?: Date } {
  const errors: Errors = {};
  const title = input.title?.trim();
  if (!partial || input.title !== undefined) if (!title || title.length > 120) errors.title = 'title';
  let startsAt: Date | undefined;
  if (!partial || input.date !== undefined || input.time !== undefined) {
    startsAt = parisToUtc(input.date ?? '', input.time ?? '') ?? undefined;
    if (!startsAt) errors.date = 'date';
  }
  if (input.level !== undefined && !(OUTING_LEVELS as readonly string[]).includes(input.level)) errors.level = 'level';
  if (input.ebike !== undefined && !(OUTING_EBIKE as readonly string[]).includes(input.ebike)) errors.ebike = 'ebike';
  if (input.visibility !== undefined && !isOutingVisibility(input.visibility)) errors.visibility = 'visibility';
  if (input.participantsCanInvite !== undefined && typeof input.participantsCanInvite !== 'boolean') errors.participantsCanInvite = 'invalid';
  if (input.maxParticipants != null && (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 1 || input.maxParticipants > 500))
    errors.maxParticipants = 'maxParticipants';
  if (input.meetingLat !== undefined || input.meetingLon !== undefined) {
    const { meetingLat: la, meetingLon: lo } = input;
    if (typeof la !== 'number' || typeof lo !== 'number' || Math.abs(la) > 90 || Math.abs(lo) > 180) errors.meeting = 'meeting';
  }
  return { errors, startsAt };
}

export async function createOuting(db: Db, userId: string, input: OutingInput): Promise<{ slug: string } | { errors: Errors } | { error: 'not_found' }> {
  const found = input.trackSlug ? db.select().from(track).where(eq(track.slug, input.trackSlug)).get() : undefined;
  // Un brouillon (#1450) ne sert jamais à créer une sortie : même réponse qu'une trace inconnue.
  if (!found || found.status === 'draft') return { error: 'not_found' };
  const { errors, startsAt } = validate(input, false);
  if (Object.keys(errors).length) return { errors };
  const t = await ensureTrackElevation(db, found); // la sortie fige la trace : altitude IGN complétée avant (#1428)
  // Anti double envoi (#1424) : même organisateur, trace, titre et date créés il y a moins de 30 s ⇒ la même sortie.
  const title = input.title!.trim();
  const recent = db.select().from(outing)
    .where(and(eq(outing.createdBy, userId), eq(outing.trackId, t.id), eq(outing.title, title), eq(outing.startsAt, startsAt!), gt(outing.createdAt, new Date(Date.now() - 30_000))))
    .get();
  if (recent) return { slug: recent.slug };
  const visibility = (input.visibility as OutingRow['visibility']) ?? getDefaultOutingVisibility(db, userId);
  // Publique = sans propriétaire, figée, lien de groupe toujours actif (#1455) ; `created_by` garde « proposée par ».
  const isPublic = visibility === 'public';
  const row = db
    .insert(outing)
    .values({
      trackId: t.id,
      trackSnapshot: snapshotOf(t),
      title: input.title!.trim(),
      description: input.description?.trim() || null,
      startsAt: startsAt!,
      meetingLat: input.meetingLat ?? t.startLat,
      meetingLon: input.meetingLon ?? t.startLon,
      meetingLabel: input.meetingLabel?.trim() || null,
      level: (input.level as OutingRow['level']) ?? 'sportif',
      ebike: (input.ebike as OutingRow['ebike']) ?? 'yes',
      maxParticipants: input.maxParticipants ?? null,
      visibility,
      ownerId: isPublic ? null : userId,
      participantsCanInvite: isPublic ? true : input.participantsCanInvite === true,
      openLinkEnabled: isPublic,
      createdBy: userId,
    })
    .returning({ id: outing.id, slug: outing.slug })
    .get();
  emitOutingChange(db, row.id, 'Create'); // #1476 : publique / copains → serveurs des copains distants (sur invitation : rien tant que personne n'est invité)
  return { slug: row.slug };
}

export type DuplicateInput = { date?: string; time?: string; trackSource?: string };

/**
 * Duplique une sortie à une autre date (#1360) : même trace, titre, description, RDV, niveau, VAE et places ;
 * nouveau slug, nouveau lien ouvert, statut « prévue », aucune invitation (les liens perso sont propres à une sortie).
 * `trackSource` : `track` (défaut : version actuelle de la trace, repli sur le snapshot si elle a disparu) ou `snapshot`.
 */
export function duplicateOuting(db: Db, userId: string, slug: string, input: DuplicateInput): Result<{ slug: string }> {
  const o = getManagedOuting(db, userId, slug);
  if (!o || !outingPermissions(db, { userId }, o).canInvite) return { ok: false, error: 'not_found' };
  const errors: Errors = {};
  const startsAt = parisToUtc(input.date ?? '', input.time ?? '');
  if (!startsAt) errors.date = 'date';
  if (input.trackSource !== undefined && input.trackSource !== 'track' && input.trackSource !== 'snapshot') errors.trackSource = 'unknown';
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', errors };
  const current = input.trackSource === 'snapshot' || !o.trackId ? undefined : db.select().from(track).where(eq(track.id, o.trackId)).get();
  const row = db
    .insert(outing)
    .values({
      trackId: o.trackId,
      trackSnapshot: current ? snapshotOf(current) : o.trackSnapshot,
      title: o.title,
      description: o.description,
      startsAt: startsAt!,
      meetingLat: o.meetingLat,
      meetingLon: o.meetingLon,
      meetingLabel: o.meetingLabel,
      level: o.level,
      ebike: o.ebike,
      maxParticipants: o.maxParticipants,
      visibility: o.visibility,
      // Dupliquer une publique donne une publique (sans propriétaire, figée, lien de groupe actif).
      ownerId: isFrozen(o) ? null : userId,
      participantsCanInvite: o.participantsCanInvite,
      openLinkEnabled: isFrozen(o),
      createdBy: userId,
    })
    .returning({ id: outing.id, slug: outing.slug })
    .get();
  emitOutingChange(db, row.id, 'Create');
  return { ok: true, slug: row.slug };
}

/** Sortie de l'organisateur, ou undefined (inconnue ou d'un autre : même réponse). */
export function getOwnedOuting(db: Db, userId: string, slug: string): OutingRow | undefined {
  const o = db.select().from(outing).where(eq(outing.slug, slug)).get();
  return o && o.ownerId === userId ? o : undefined;
}

/**
 * Sortie que `userId` gère depuis la page `/s/<slug>` : la sienne (propriétaire), ou une publique qu'il a proposée
 * (sans propriétaire : il n'y a rien à modifier, mais il garde sa page pour inviter et partager). Autre ⇒ undefined.
 */
export function getManagedOuting(db: Db, userId: string, slug: string): OutingRow | undefined {
  const o = db.select().from(outing).where(eq(outing.slug, slug)).get();
  if (!o) return undefined;
  return o.ownerId === userId || (o.ownerId == null && o.createdBy === userId) ? o : undefined;
}

/** Sorties gérées par l'utilisateur : possédées, ou publiques qu'il a proposées. */
const managedBy = (userId: string) => or(eq(outing.ownerId, userId), and(isNull(outing.ownerId), eq(outing.createdBy, userId)));

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: 'not_found' | 'invalid' | 'closed' | 'full' | 'disabled' | 'outingFrozen'; errors?: Errors };

/** Sortie à modifier : propriétaire seulement. Une publique (sans propriétaire) répond `outingFrozen` à son créateur, `not_found` aux autres. */
function editableOuting(db: Db, userId: string, slug: string): { o: OutingRow } | { error: 'not_found' | 'outingFrozen' } {
  const o = getManagedOuting(db, userId, slug);
  if (!o) return { error: 'not_found' };
  return outingPermissions(db, { userId }, o).canEdit ? { o } : { error: 'outingFrozen' };
}

export function updateOuting(db: Db, userId: string, slug: string, input: OutingInput): Result {
  const e = editableOuting(db, userId, slug);
  if ('error' in e) return { ok: false, error: e.error };
  const o = e.o;
  // Rendre publique passe par `makePublic` (une seule voie, irréversible) ; jamais l'inverse.
  if (input.visibility === 'public' && o.visibility !== 'public') return { ok: false, error: 'invalid', errors: { visibility: 'visibility' } };
  const merged: OutingInput = { ...input };
  // Date et heure vont ensemble : on complète avec les valeurs actuelles.
  const { errors, startsAt } = validate(merged, true);
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', errors };
  db.update(outing)
    .set({
      ...(input.title !== undefined && { title: input.title.trim() }),
      ...(input.description !== undefined && { description: input.description.trim() || null }),
      ...(startsAt && { startsAt }),
      ...(input.meetingLat !== undefined && { meetingLat: input.meetingLat, meetingLon: input.meetingLon }),
      ...(input.meetingLabel !== undefined && { meetingLabel: input.meetingLabel.trim() || null }),
      ...(input.level !== undefined && { level: input.level as OutingRow['level'] }),
      ...(input.ebike !== undefined && { ebike: input.ebike as OutingRow['ebike'] }),
      ...(input.maxParticipants !== undefined && { maxParticipants: input.maxParticipants }),
      ...(input.visibility !== undefined && { visibility: input.visibility as OutingRow['visibility'] }),
      ...(input.participantsCanInvite !== undefined && { participantsCanInvite: input.participantsCanInvite }),
      updatedAt: new Date(),
    })
    .where(eq(outing.id, o.id))
    .run();
  emitOutingChange(db, o.id, 'Update');
  return { ok: true };
}

export function setStatus(db: Db, userId: string, slug: string, status: 'planned' | 'cancelled' | 'done'): Result {
  const e = editableOuting(db, userId, slug);
  if ('error' in e) return { ok: false, error: e.error };
  const o = e.o;
  db.update(outing).set({ status, updatedAt: new Date() }).where(eq(outing.id, o.id)).run();
  emitOutingChange(db, o.id, 'Update'); // annulation = `Update(Event)` avec le statut (la sortie n'est jamais effacée)
  return { ok: true };
}

/** « Mettre à jour depuis la trace » : recopie la version courante de la trace dans la sortie. */
export function refreshSnapshot(db: Db, userId: string, slug: string): Result {
  const e = editableOuting(db, userId, slug);
  if ('error' in e) return { ok: false, error: e.error };
  const o = e.o;
  const t = o.trackId ? db.select().from(track).where(eq(track.id, o.trackId)).get() : undefined;
  if (!t) return { ok: false, error: 'not_found' };
  db.update(outing).set({ trackSnapshot: snapshotOf(t), updatedAt: new Date() }).where(eq(outing.id, o.id)).run();
  emitOutingChange(db, o.id, 'Update');
  return { ok: true };
}

/** Nouveau slug (le précédent lien organisateur cesse de fonctionner). */
export function regenerateSlug(db: Db, userId: string, slug: string): Result<{ slug: string }> {
  const o = getOwnedOuting(db, userId, slug);
  if (!o) return { ok: false, error: 'not_found' };
  const next = crypto.randomUUID();
  db.update(outing).set({ slug: next, updatedAt: new Date() }).where(eq(outing.id, o.id)).run();
  return { ok: true, slug: next };
}

export function setOpenLink(db: Db, userId: string, slug: string, enabled: boolean): Result {
  const o = getManagedOuting(db, userId, slug);
  if (!o) return { ok: false, error: 'not_found' };
  // Publique : le lien de groupe est toujours actif, on ne le désactive ni ne le régénère.
  if (isFrozen(o)) return { ok: false, error: 'outingFrozen' };
  db.update(outing)
    .set({ openLinkEnabled: enabled, updatedAt: new Date() })
    .where(eq(outing.id, o.id))
    .run();
  return { ok: true };
}

const cleanName = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ') : '');

/** Crée une invitation nominative. Le token en clair n'est renvoyé qu'ici. */
export function createInvitation(db: Db, userId: string, slug: string, name: unknown): Result<{ token: string; id: string }> {
  const o = getManagedOuting(db, userId, slug);
  if (!o || !outingPermissions(db, { userId }, o).canInvite) return { ok: false, error: 'not_found' };
  const n = cleanName(name);
  if (!n || n.length > 60) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
  const { token, tokenHash, tokenEnc } = newInviteToken();
  const row = db.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc, name: n, createdByUserId: userId }).returning({ id: invitation.id }).get();
  return { ok: true, token, id: row.id };
}

function ownedInvitation(db: Db, userId: string, slug: string, id: string) {
  const o = getManagedOuting(db, userId, slug);
  if (!o) return undefined;
  const inv = db.select().from(invitation).where(and(eq(invitation.id, id), eq(invitation.outingId, o.id))).get();
  return inv && outingPermissions(db, { userId }, o).canRevoke(inv) ? inv : undefined;
}

export function revokeInvitation(db: Db, userId: string, slug: string, id: string): Result {
  const inv = ownedInvitation(db, userId, slug, id);
  if (!inv) return { ok: false, error: 'not_found' };
  db.update(invitation).set({ revokedAt: new Date(), updatedAt: new Date() }).where(eq(invitation.id, inv.id)).run();
  if (inv.remoteActorId) emitRemoteRetract(db, inv.outingId, inv.remoteActorId); // #1476 : retrait de son côté
  return { ok: true };
}

/**
 * Lien perso d'une personne, **déchiffré** (#1456) : jamais de régénération, on réaffiche le même lien.
 * Qui a le droit : `canRevoke` (propriétaire en privée ; en publique, la personne qui a créé ce lien).
 * `linkUnavailable` pour un lien créé avant le chiffrement (ou clé absente / changée).
 */
export function getInvitationLink(db: Db, userId: string, slug: string, id: string): { ok: true; token: string } | { ok: false; error: 'not_found' | 'linkUnavailable' } {
  const inv = ownedInvitation(db, userId, slug, id);
  if (!inv || inv.revokedAt) return { ok: false, error: 'not_found' };
  const token = decryptToken(inv.tokenEnc);
  return token ? { ok: true, token } : { ok: false, error: 'linkUnavailable' };
}

export function listInvitations(db: Db, outingId: string): InvitationRow[] {
  return db.select().from(invitation).where(eq(invitation.outingId, outingId)).orderBy(asc(invitation.createdAt)).all();
}

/** Mes sorties, la plus proche d'abord à venir ; passées ensuite. */
export function listOutings(db: Db, userId: string, now = new Date()) {
  const rows = db.select().from(outing).where(managedBy(userId)).orderBy(asc(outing.startsAt)).all();
  const cut = now.getTime() - GRACE_MS;
  return {
    upcoming: rows.filter((o) => o.startsAt.getTime() >= cut),
    past: rows.filter((o) => o.startsAt.getTime() < cut).reverse(),
  };
}

export function outingsOfTrack(db: Db, userId: string, trackId: string) {
  return db.select().from(outing).where(and(eq(outing.trackId, trackId), managedBy(userId))).orderBy(desc(outing.startsAt)).all();
}

export function isClosed(o: Pick<OutingRow, 'status' | 'startsAt'>, now = new Date()): boolean {
  return o.status !== 'planned' || o.startsAt.getTime() + GRACE_MS < now.getTime();
}

/** Invitation active (non révoquée) par son token en clair, avec sa sortie. */
export function getInvitationByToken(db: Db, token: string) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return undefined;
  const inv = db.select().from(invitation).where(and(eq(invitation.tokenHash, hashToken(token)), isNull(invitation.revokedAt))).get();
  if (!inv) return undefined;
  const o = db.select().from(outing).where(eq(outing.id, inv.outingId)).get();
  return o ? { invitation: inv, outing: o } : undefined;
}

export function countYes(db: Db, outingId: string, exceptId?: string): number {
  const r = db
    .select({ n: sql<number>`count(*)` })
    .from(invitation)
    .where(and(eq(invitation.outingId, outingId), eq(invitation.status, 'yes'), isNull(invitation.revokedAt), exceptId ? ne(invitation.id, exceptId) : undefined))
    .get();
  return r?.n ?? 0;
}

export type RespondInput = { status?: unknown; name?: unknown; comment?: unknown };

/** Réponse d'un invité : ne touche que SA ligne (identifiée par le hash du token). */
export function respond(db: Db, token: string, input: RespondInput, now = new Date()): Result {
  const found = getInvitationByToken(db, token);
  if (!found) return { ok: false, error: 'not_found' };
  const { invitation: inv, outing: o } = found;
  if (isClosed(o, now)) return { ok: false, error: 'closed' };
  const set: Partial<InvitationRow> = {};
  if (input.status !== undefined) {
    if (input.status !== 'yes' && input.status !== 'maybe' && input.status !== 'no') return { ok: false, error: 'invalid' };
    if (input.status === 'yes' && o.maxParticipants != null && inv.status !== 'yes' && countYes(db, o.id, inv.id) >= o.maxParticipants)
      return { ok: false, error: 'full' };
    set.status = input.status;
    set.respondedAt = now;
  }
  if (input.name !== undefined) {
    const n = cleanName(input.name);
    if (!n || n.length > 60) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
    set.name = n;
  }
  if (input.comment !== undefined) {
    const c = typeof input.comment === 'string' ? input.comment.trim() : '';
    if (c.length > 300) return { ok: false, error: 'invalid', errors: { comment: 'commentTooLong' } };
    set.comment = c || null;
  }
  db.update(invitation).set({ ...set, updatedAt: now }).where(eq(invitation.id, inv.id)).run();
  return { ok: true };
}

export function getOutingByOpenToken(db: Db, openToken: string) {
  const o = db.select().from(outing).where(eq(outing.openLinkToken, openToken)).get();
  return o && o.openLinkEnabled ? o : undefined;
}

/** Lien ouvert : crée l'invitation personnelle de celui qui saisit son nom. */
export function joinOpen(db: Db, openToken: string, name: unknown, now = new Date()): Result<{ token: string }> {
  const o = getOutingByOpenToken(db, openToken);
  if (!o) return { ok: false, error: 'disabled' };
  if (isClosed(o, now)) return { ok: false, error: 'closed' };
  const n = cleanName(name);
  if (!n || n.length > 60) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
  const count = db.select({ n: sql<number>`count(*)` }).from(invitation).where(eq(invitation.outingId, o.id)).get()?.n ?? 0;
  if (count >= 200) return { ok: false, error: 'full' };
  const { token, tokenHash, tokenEnc } = newInviteToken();
  db.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc, name: n, origin: 'open_link' }).run();
  return { ok: true, token };
}

/** Jeton du flux agenda de l'organisateur (#1357) : créé au premier appel, stable ensuite. */
export function getCalendarFeedToken(db: Db, userId: string): string {
  const row = db.select().from(calendarFeed).where(eq(calendarFeed.userId, userId)).get();
  if (row) return row.token;
  return regenerateCalendarFeedToken(db, userId);
}

/** Nouveau jeton : l'ancien lien s'arrête de répondre (404). */
export function regenerateCalendarFeedToken(db: Db, userId: string): string {
  const token = newToken();
  db.insert(calendarFeed).values({ userId, token }).onConflictDoUpdate({ target: calendarFeed.userId, set: { token, createdAt: new Date() } }).run();
  return token;
}

/** Sorties d'un flux agenda par jeton (toutes celles de l'organisateur, annulées comprises : l'agenda les barre). */
export function outingsForCalendarFeed(db: Db, token: string): OutingRow[] | undefined {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return undefined;
  const feed = db.select().from(calendarFeed).where(eq(calendarFeed.token, token)).get();
  if (!feed) return undefined;
  return db.select().from(outing).where(managedBy(feed.userId)).orderBy(asc(outing.startsAt)).all();
}

/**
 * Passer une sortie privée en **publique** (#1455) : propriétaire seulement. Elle perd son propriétaire (`owner_id` NULL ;
 * `created_by` garde « proposée par »), son lien de groupe devient actif, plus rien n'est modifiable ni annulable.
 * **Irréversible** : publique → privée n'existe pas.
 */
export function makePublic(db: Db, userId: string, slug: string): Result {
  const o = getOwnedOuting(db, userId, slug);
  if (!o) return { ok: false, error: 'not_found' };
  db.update(outing)
    .set({ visibility: 'public', ownerId: null, participantsCanInvite: true, openLinkEnabled: true, updatedAt: new Date() })
    .where(eq(outing.id, o.id))
    .run();
  emitOutingChange(db, o.id, 'Update');
  return { ok: true };
}
