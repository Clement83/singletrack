import { and, between, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { invitation, outing, user, type OutingRow } from '@/db/schema';
import { outingPermissions } from './permissions';
import { archiveOverrides } from './leave';
import { decryptToken } from './tokens';
import type { TrackGeometry } from '@/lib/geo/types';
import { utcToParisInputs } from './time';
import { countYes, isClosed } from './service';

/**
 * « Sorties à venir » sur la carte (#1461, epic #1463 P7). Une sortie apparaît à son **point de RDV** si le compte la voit
 * (`outingPermissions.canView` : publique, propriétaire, invité lié à un compte même sans réponse, ou copain du propriétaire
 * d'une sortie « copains »), si elle est planifiée, à venir et non masquée (archivée) par ce compte.
 * Résumé maigre : jamais de slug organisateur, de token, d'email ni de prénoms de participants.
 */
export type MapOuting = {
  id: string;
  title: string;
  startsAt: Date;
  lat: number;
  lon: number;
  meetingLabel: string | null;
  distanceM: number;
  gainM: number | null;
  level: OutingRow['level'];
  ebike: OutingRow['ebike'];
  visibility: OutingRow['visibility'];
  organizerName: string;
  yesCount: number;
  spotsLeft: number | null;
  /** Le compte est propriétaire, créateur ou invité lié : la fiche renvoie vers sa page. */
  mine: boolean;
};

export type MapBbox = [number, number, number, number];
export const MAP_OUTINGS_MAX = 200;

export function listMapOutings(db: Db, viewerId: string, bbox: MapBbox, now = new Date()): MapOuting[] {
  const today = utcToParisInputs(now).date;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const rows = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy))
    .where(and(eq(outing.status, 'planned'), between(outing.meetingLat, minLat, maxLat), between(outing.meetingLon, minLon, maxLon)))
    .all()
    .filter(({ o }) => utcToParisInputs(o.startsAt).date >= today)
    .sort((a, b) => a.o.startsAt.getTime() - b.o.startsAt.getTime());
  if (!rows.length) return [];

  const hidden = archiveOverrides(db, viewerId);
  const mineInv = new Set(db.select({ outingId: invitation.outingId }).from(invitation)
    .where(and(eq(invitation.userId, viewerId), isNull(invitation.revokedAt))).all().map((i) => i.outingId));

  const out: MapOuting[] = [];
  for (const { o, organizer } of rows) {
    if (out.length >= MAP_OUTINGS_MAX) break;
    if (hidden.get(o.id) === true) continue;
    if (!outingPermissions(db, { userId: viewerId }, o, now).canView) continue;
    const yesCount = countYes(db, o.id);
    out.push({
      id: o.id, title: o.title, startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, meetingLabel: o.meetingLabel,
      distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? null,
      level: o.level, ebike: o.ebike, visibility: o.visibility, organizerName: organizer, yesCount,
      spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - yesCount),
      mine: o.ownerId === viewerId || o.createdBy === viewerId || mineInv.has(o.id),
    });
  }
  return out;
}

export type OutingDiscovery =
  | { kind: 'redirect'; path: string }
  | { kind: 'show'; outing: MapOuting & { description: string | null; geometry: TrackGeometry }; canJoin: boolean; full: boolean }
  | { kind: 'notFound' };

/**
 * Fiche de découverte (#1461) d'une sortie désignée par son **id** (le slug organisateur n'est jamais exposé).
 * Inconnue ou non visible ⇒ `notFound` (même réponse). Déjà rattaché (propriétaire, créateur, invité lié) ⇒ redirection vers
 * sa page : `/s/<slug>`, ou `/i/<token>` déchiffré (#1456) ; si le lien est indisponible (créé avant le chiffrement),
 * on affiche la fiche sans bouton « Je viens ».
 */
export function getOutingDiscovery(db: Db, viewerId: string, outingId: string, now = new Date()): OutingDiscovery {
  const row = db.select({ o: outing, organizer: user.name }).from(outing)
    .innerJoin(user, eq(user.id, outing.createdBy)).where(eq(outing.id, outingId)).get();
  if (!row) return { kind: 'notFound' };
  const { o, organizer } = row;
  const perms = outingPermissions(db, { userId: viewerId }, o, now);
  if (!perms.canView) return { kind: 'notFound' };
  if (perms.isOwner || o.createdBy === viewerId) return { kind: 'redirect', path: `/s/${o.slug}` };
  const inv = db.select().from(invitation)
    .where(and(eq(invitation.outingId, o.id), eq(invitation.userId, viewerId), isNull(invitation.revokedAt))).get();
  let linkUnavailable = false;
  if (inv) {
    const token = decryptToken(inv.tokenEnc);
    if (token) return { kind: 'redirect', path: `/i/${token}` };
    linkUnavailable = true;
  }
  const yesCount = countYes(db, o.id);
  const full = o.maxParticipants != null && yesCount >= o.maxParticipants;
  return {
    kind: 'show',
    outing: {
      id: o.id, title: o.title, description: o.description, geometry: o.trackSnapshot.geometry,
      startsAt: o.startsAt, lat: o.meetingLat, lon: o.meetingLon, meetingLabel: o.meetingLabel,
      distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? null,
      level: o.level, ebike: o.ebike, visibility: o.visibility, organizerName: organizer, yesCount,
      spotsLeft: o.maxParticipants == null ? null : Math.max(0, o.maxParticipants - yesCount), mine: !!inv,
    },
    canJoin: perms.canJoin && !full && !isClosed(o, now) && !linkUnavailable && !inv,
    full,
  };
}
