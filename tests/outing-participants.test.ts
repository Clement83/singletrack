import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createOuting, listParticipants, summarizeParticipants, type Participant } from '@/lib/outings';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'a', name: 'Orga', email: 'a@x.fr' }, { id: 'b', name: 'Bea', email: 'b@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'a', { trackSlug: t.slug, title: 'Sortie', date: '2099-05-10', time: '08:30' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  let n = 0;
  const add = (name: string, status: 'yes' | 'maybe' | 'no' | 'pending', extra: object = {}) => {
    n++;
    const id = `i${n}`;
    db.insert(invitation).values({ id, outingId: o.id, tokenHash: `h${n}`, name, status, createdAt: new Date(2099, 0, n), respondedAt: status === 'pending' ? null : new Date(2099, 1, 10 - n), ...extra }).run();
    return id;
  };
  return { db, o, add };
}

const p = (name: string, status: Participant['status'], extra: Partial<Participant> = {}): Participant => ({ id: name, name, status, isMe: false, isOrganizer: false, ...extra });

describe('listParticipants (#1468)', () => {
  it('« Toi » d’abord, puis l’organisateur, puis ordre de réponse, sans-réponse en dernier', async () => {
    const { db, o, add } = await setup();
    add('Max', 'yes'); const me = add('Léa', 'yes'); add('Tom', 'pending'); add('Zoé', 'no');
    const list = listParticipants(db, o.id, { invitationId: me });
    expect(list.map((x) => x.name)).toEqual(['Léa', 'Orga', 'Max', 'Tom', 'Zoé']);
    expect(list[0]).toMatchObject({ isMe: true });
    expect(list[1]).toMatchObject({ isOrganizer: true, status: 'yes', isMe: false });
  });
  it('l’organisateur connecté est « Toi »', async () => {
    const { db, o } = await setup();
    expect(listParticipants(db, o.id, { userId: 'a' })[0]).toMatchObject({ name: 'Orga', isMe: true, isOrganizer: true });
  });
  it('exclut les révoquées, n’expose ni email ni token, et ne double pas l’organisateur rattaché', async () => {
    const { db, o, add } = await setup();
    add('Révoqué', 'yes', { revokedAt: new Date() }); add('Orga bis', 'yes', { userId: 'a' }); add('Bea', 'maybe', { userId: 'b' });
    const list = listParticipants(db, o.id, {});
    expect(list.map((x) => x.name)).toEqual(['Orga', 'Bea']);
    for (const x of list) expect(Object.keys(x).sort()).toEqual(['id', 'isMe', 'isOrganizer', 'name', 'status']);
  });
  it('20 inscrits ⇒ 20 + l’organisateur', async () => {
    const { db, o, add } = await setup();
    for (let i = 0; i < 20; i++) add(`P${i}`, 'yes');
    expect(listParticipants(db, o.id, {})).toHaveLength(21);
  });
});

describe('summarizeParticipants (#1468)', () => {
  it('3 premiers + n autres, compteurs par réponse', () => {
    const s = summarizeParticipants([p('A', 'yes'), p('B', 'no'), p('C', 'yes'), p('D', 'maybe'), p('E', 'yes'), p('F', 'pending')]);
    expect(s.preview.map((x) => x.name)).toEqual(['A', 'C', 'E']);
    expect(s.others).toBe(1);
    expect(s.counts).toEqual({ yes: 3, maybe: 1, no: 1, pending: 1 });
    expect(s.needsSheet).toBe(true);
  });
  it('≤ 3 participants qui viennent : tout est affiché, pas de tiroir', () => {
    const s = summarizeParticipants([p('A', 'yes'), p('B', 'maybe')]);
    expect(s).toMatchObject({ others: 0, needsSheet: false });
    expect(summarizeParticipants([])).toMatchObject({ preview: [], others: 0, needsSheet: false });
  });
  it('un « non » ou sans-réponse justifie le tiroir même sous 3', () => {
    expect(summarizeParticipants([p('A', 'yes'), p('B', 'no')]).needsSheet).toBe(true);
  });
});
