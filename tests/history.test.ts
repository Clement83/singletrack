import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { invitation, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createContact, createOuting, inviteMany, isDone, listHistory, setStatus } from '@/lib/outings';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }, { id: 'u2', name: 'Autre', email: 'a@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [...Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]), ...Array.from({ length: 12 }, (_, i) => [6.122 - i * 0.002, 43.2005, 320 - i * 20] as [number, number, number])] }, raw: {},
  }, { enrich: false });
  const mk = async (date: string, title: string) => {
    const r = await createOuting(db, 'u1', { trackSlug: t.slug, title, date, time: '08:30' });
    if (!('slug' in r)) throw new Error('création');
    return r.slug;
  };
  return { db, mk };
}

describe('historique « Nos sorties » (#1411)', () => {
  it('isDone : manuel, ou lendemain de la date (jour de Paris), jamais pour une annulée', () => {
    const d = (s: string) => new Date(s);
    expect(isDone({ status: 'done', startsAt: d('2099-01-01T08:00:00Z') })).toBe(true);
    expect(isDone({ status: 'planned', startsAt: d('2026-11-12T08:00:00Z') }, d('2026-11-12T22:30:00Z'))).toBe(false);
    expect(isDone({ status: 'planned', startsAt: d('2026-11-12T08:00:00Z') }, d('2026-11-12T23:30:00Z'))).toBe(true); // minuit passé à Paris
    expect(isDone({ status: 'cancelled', startsAt: d('2020-01-01T08:00:00Z') })).toBe(false);
  });

  it('liste les sorties passées et terminées à la main, cumule km/D+, ignore annulées, futures et celles des autres', async () => {
    const { db, mk } = await setup();
    await mk('2020-05-10', 'Passée');
    const manual = await mk('2099-05-10', 'Manuelle');
    const cancelled = await mk('2020-06-10', 'Annulée');
    await mk('2099-06-10', 'Future');
    expect(setStatus(db, 'u1', manual, 'done').ok).toBe(true);
    setStatus(db, 'u1', cancelled, 'cancelled');
    expect(setStatus(db, 'u2', manual, 'planned')).toEqual({ ok: false, error: 'not_found' });
    const h = listHistory(db, 'u1');
    expect(h.entries.map((e) => e.title)).toEqual(['Manuelle', 'Passée']);
    expect(h.totals.outings).toBe(2);
    expect(h.totals.distanceM).toBeCloseTo(h.entries[0].distanceM * 2, 0);
    expect(h.totals.gainM).toBeGreaterThan(0);
    expect(listHistory(db, 'u2').entries).toEqual([]);
  });

  it('compte par pote les sorties où il a répondu « je viens » (liens non révoqués seulement)', async () => {
    const { db, mk } = await setup();
    const a = await mk('2020-05-10', 'A');
    const b = await mk('2020-06-10', 'B');
    const c = await mk('2020-07-10', 'C');
    const paul = createContact(db, 'u1', { name: 'Paul' });
    const lea = createContact(db, 'u1', { name: 'Léa' });
    if (!paul.ok || !lea.ok) throw new Error('contacts');
    for (const [slug, ids] of [[a, [paul.id, lea.id]], [b, [paul.id]], [c, [paul.id]]] as const) {
      expect(inviteMany(db, 'u1', slug, { contactIds: [...ids] }).ok).toBe(true);
    }
    // Les réponses sur sorties passées sont figées : on force le statut en base.
    db.update(invitation).set({ status: 'yes' }).run();
    const h = listHistory(db, 'u1');
    expect(h.byPal.map((p) => [p.name, p.outings])).toEqual([['Paul', 3], ['Léa', 1]]);
    expect(h.byPal[0].distanceM).toBeCloseTo(h.totals.distanceM, 0);
    expect(h.entries.find((e) => e.title === 'A')!.participants.sort()).toEqual(['Léa', 'Paul']);
  });
});
