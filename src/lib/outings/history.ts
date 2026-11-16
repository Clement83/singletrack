import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, invitation, outing, type OutingRow } from '@/db/schema';
import { utcToParisInputs } from './time';

/**
 * « Nos sorties » (#1411) : historique des sorties terminées.
 * Une sortie est terminée si l'organisateur l'a marquée `done`, ou automatiquement le lendemain de sa
 * date (jour civil de Paris) tant qu'elle n'est pas annulée. Aucun traitement planifié : c'est calculé à la lecture.
 */
export function isDone(o: Pick<OutingRow, 'status' | 'startsAt'>, now = new Date()): boolean {
  if (o.status === 'done') return true;
  if (o.status !== 'planned') return false;
  return utcToParisInputs(o.startsAt).date < utcToParisInputs(now).date;
}

export type HistoryEntry = {
  slug: string;
  title: string;
  startsAt: Date;
  distanceM: number;
  gainM: number;
  trackName: string;
  geometry: OutingRow['trackSnapshot']['geometry'];
  bbox: [number, number, number, number];
  participants: string[];
};
export type HistoryTotals = { outings: number; distanceM: number; gainM: number };
export type HistoryPal = { contactId: string; name: string; outings: number; distanceM: number; gainM: number; lastAt: Date };

/** Sorties terminées de l'organisateur (récentes d'abord), cumul, et sorties faites avec chaque pote du carnet
 *  (réponse « je viens » sur un lien non révoqué). */
export function listHistory(db: Db, userId: string, now = new Date()) {
  const rows = db.select().from(outing).where(eq(outing.createdBy, userId)).all()
    .filter((o) => isDone(o, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const yes = db.select({
    outingId: invitation.outingId, contactId: invitation.contactId, name: invitation.name,
  }).from(invitation).innerJoin(outing, eq(outing.id, invitation.outingId))
    .where(and(eq(outing.createdBy, userId), eq(invitation.status, 'yes'), isNull(invitation.revokedAt))).all();
  const byOuting = new Map<string, typeof yes>();
  for (const y of yes) byOuting.set(y.outingId, [...(byOuting.get(y.outingId) ?? []), y]);

  const entries: HistoryEntry[] = rows.map((o) => ({
    slug: o.slug, title: o.title, startsAt: o.startsAt,
    distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? 0,
    trackName: o.trackSnapshot.name, geometry: o.trackSnapshot.geometry, bbox: o.trackSnapshot.bbox,
    participants: (byOuting.get(o.id) ?? []).map((y) => y.name),
  }));
  const totals: HistoryTotals = {
    outings: entries.length,
    distanceM: entries.reduce((s, e) => s + e.distanceM, 0),
    gainM: entries.reduce((s, e) => s + e.gainM, 0),
  };
  const names = new Map(db.select({ id: contact.id, name: contact.name }).from(contact).where(eq(contact.ownerUserId, userId)).all().map((c) => [c.id, c.name]));
  const pals = new Map<string, HistoryPal>();
  rows.forEach((o, i) => {
    const seen = new Set<string>();
    for (const y of byOuting.get(o.id) ?? []) {
      if (!y.contactId || seen.has(y.contactId) || !names.has(y.contactId)) continue;
      seen.add(y.contactId);
      const p = pals.get(y.contactId) ?? { contactId: y.contactId, name: names.get(y.contactId)!, outings: 0, distanceM: 0, gainM: 0, lastAt: o.startsAt };
      p.outings++; p.distanceM += entries[i].distanceM; p.gainM += entries[i].gainM;
      if (o.startsAt > p.lastAt) p.lastAt = o.startsAt;
      pals.set(y.contactId, p);
    }
  });
  const byPal = [...pals.values()].sort((a, b) => b.outings - a.outings || b.lastAt.getTime() - a.lastAt.getTime() || a.name.localeCompare(b.name));
  return { entries, totals, byPal };
}

export type ClaimedEntry = { slug: string; title: string; startsAt: Date; distanceM: number; gainM: number };

/** Sorties terminées d'autres organisateurs où ce compte a répondu « je viens » via un lien rattaché (#1434). */
export function listClaimedHistory(db: Db, userId: string, now = new Date()): ClaimedEntry[] {
  return db.select({ o: outing }).from(invitation).innerJoin(outing, eq(outing.id, invitation.outingId))
    .where(and(eq(invitation.userId, userId), eq(invitation.status, 'yes'), isNull(invitation.revokedAt))).all()
    .map((r) => r.o).filter((o) => isDone(o, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .map((o) => ({ slug: o.slug, title: o.title, startsAt: o.startsAt, distanceM: o.trackSnapshot.distanceM, gainM: o.trackSnapshot.elevationGainM ?? 0 }));
}
