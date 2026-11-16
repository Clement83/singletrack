import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { contact, invitation, outing, type ContactRow } from '@/db/schema';
import { getManagedOuting, type Result } from './service';
import { outingPermissions } from './permissions';
import { newInviteToken } from './tokens';

/** Carnet de potes (#1359) : habitués de l'utilisateur, prénom + note seulement. */

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const same = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;

export type ContactView = ContactRow & { outings: number; lastOutingAt: Date | null };

/** Contacts de l'utilisateur, avec l'historique (nombre de sorties, dernière date). Tri : dernière invitation d'abord. */
export function listContacts(db: Db, userId: string, opts: { archived?: boolean } = {}): ContactView[] {
  const rows = db.select().from(contact)
    .where(and(eq(contact.ownerUserId, userId), eq(contact.archived, !!opts.archived)))
    .orderBy(sql`${contact.lastInvitedAt} IS NULL`, desc(contact.lastInvitedAt), asc(contact.name))
    .all();
  if (!rows.length) return [];
  const stats = db.select({
    contactId: invitation.contactId,
    n: sql<number>`count(distinct ${invitation.outingId})`,
    last: sql<number | null>`max(${outing.startsAt})`,
  }).from(invitation).innerJoin(outing, eq(outing.id, invitation.outingId))
    .where(inArray(invitation.contactId, rows.map((r) => r.id)))
    .groupBy(invitation.contactId).all();
  const byId = new Map(stats.map((s) => [s.contactId, s]));
  return rows.map((r) => {
    const s = byId.get(r.id);
    return { ...r, outings: s?.n ?? 0, lastOutingAt: s?.last ? new Date(s.last * 1000) : null };
  });
}

export function createContact(db: Db, userId: string, input: { name?: unknown; note?: unknown }): Result<{ id: string }> {
  const name = clean(input.name, 60);
  if (!name) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
  const existing = db.select().from(contact).where(eq(contact.ownerUserId, userId)).all().find((c) => same(c.name, name));
  if (existing) {
    if (existing.archived) db.update(contact).set({ archived: false }).where(eq(contact.id, existing.id)).run();
    return { ok: true, id: existing.id };
  }
  const note = clean(input.note, 80) || null;
  const row = db.insert(contact).values({ ownerUserId: userId, name, note }).returning({ id: contact.id }).get();
  return { ok: true, id: row.id };
}

export function updateContact(db: Db, userId: string, id: string, input: { name?: unknown; note?: unknown; archived?: unknown }): Result {
  const c = db.select().from(contact).where(and(eq(contact.id, id), eq(contact.ownerUserId, userId))).get();
  if (!c) return { ok: false, error: 'not_found' };
  const set: Partial<ContactRow> = {};
  if (input.name !== undefined) {
    const name = clean(input.name, 60);
    if (!name) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
    set.name = name;
  }
  if (input.note !== undefined) set.note = clean(input.note, 80) || null;
  if (typeof input.archived === 'boolean') set.archived = input.archived;
  if (Object.keys(set).length) db.update(contact).set(set).where(eq(contact.id, id)).run();
  return { ok: true };
}

export type BulkInvite = { id: string; name: string; token: string; path: string };

/**
 * Invite plusieurs personnes d'un coup : contacts cochés (`contactIds`) et/ou nouveaux prénoms (`newNames`, avec
 * `addToBook` pour les mémoriser). Une invitation nominative (donc un lien) par personne ; un contact déjà invité
 * (lien actif) à cette sortie est ignoré. Les tokens en clair ne sont renvoyés qu'ici.
 */
export function inviteMany(
  db: Db, userId: string, slug: string,
  input: { contactIds?: unknown; newNames?: unknown },
): Result<{ invites: BulkInvite[]; skipped: string[] }> {
  const o = getManagedOuting(db, userId, slug);
  if (!o || !outingPermissions(db, { userId }, o).canInvite) return { ok: false, error: 'not_found' };
  const ids = Array.isArray(input.contactIds) ? input.contactIds.filter((x): x is string => typeof x === 'string') : [];
  const news = (Array.isArray(input.newNames) ? input.newNames : []).flatMap((n) => {
    const name = clean((n as { name?: unknown })?.name, 61);
    return name ? [{ name, addToBook: (n as { addToBook?: unknown }).addToBook !== false }] : [];
  });
  if (news.some((n) => n.name.length > 60)) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };
  if (!ids.length && !news.length) return { ok: false, error: 'invalid', errors: { name: 'firstName' } };

  return db.transaction((tx) => {
    const targets: { name: string; contactId: string | null }[] = [];
    const chosen = ids.length
      ? tx.select().from(contact).where(and(eq(contact.ownerUserId, userId), eq(contact.archived, false), inArray(contact.id, ids))).all()
      : [];
    for (const c of chosen) targets.push({ name: c.name, contactId: c.id });
    for (const n of news) {
      let contactId: string | null = null;
      if (n.addToBook) {
        const r = createContact(tx as unknown as Db, userId, { name: n.name });
        contactId = r.ok ? r.id : null;
      }
      targets.push({ name: n.name, contactId });
    }
    const active = tx.select().from(invitation).where(eq(invitation.outingId, o.id)).all().filter((i) => !i.revokedAt);
    const invites: BulkInvite[] = [];
    const skipped: string[] = [];
    const now = new Date();
    for (const t of targets) {
      if (t.contactId && active.some((i) => i.contactId === t.contactId)) { skipped.push(t.name); continue; }
      const { token, tokenHash, tokenEnc } = newInviteToken();
      const row = tx.insert(invitation).values({ outingId: o.id, tokenHash, tokenEnc, name: t.name, contactId: t.contactId, createdByUserId: userId }).returning({ id: invitation.id }).get();
      if (t.contactId) tx.update(contact).set({ lastInvitedAt: now }).where(eq(contact.id, t.contactId)).run();
      invites.push({ id: row.id, name: t.name, token, path: `/i/${token}` });
    }
    return { ok: true as const, invites, skipped };
  });
}

/**
 * « Réinviter les mêmes personnes » (#1360) : invités actifs d'une sortie d'origine (du même organisateur),
 * en contacts du carnet (non archivés) ou, à défaut, en simples prénoms. Aucune invitation n'est créée ici.
 */
export function reinviteCandidates(db: Db, userId: string, fromSlug: string): { contactIds: string[]; names: string[] } {
  const src = getManagedOuting(db, userId, fromSlug);
  if (!src) return { contactIds: [], names: [] };
  const invs = db.select().from(invitation).where(eq(invitation.outingId, src.id)).orderBy(asc(invitation.createdAt)).all().filter((i) => !i.revokedAt);
  const ids = invs.flatMap((i) => (i.contactId ? [i.contactId] : []));
  const live = new Set(
    ids.length ? db.select({ id: contact.id }).from(contact).where(and(eq(contact.ownerUserId, userId), eq(contact.archived, false), inArray(contact.id, ids))).all().map((c) => c.id) : [],
  );
  const contactIds = [...new Set(ids.filter((i) => live.has(i)))];
  const names = [...new Set(invs.filter((i) => !i.contactId).map((i) => i.name))];
  return { contactIds, names };
}
