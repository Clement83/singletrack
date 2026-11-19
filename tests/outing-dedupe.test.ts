import { describe, it, expect } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createInvitation, createOuting, listOutings } from '@/lib/outings';

// #1424: a double form submission creates only one outing; an outing appears only once in "My outings".
describe('sorties en double (#1424)', () => {
  it('deux créations identiques rapprochées = une seule sortie', async () => {
    const { db } = openDb(':memory:');
    db.insert(user).values({ id: 'u1', name: 'Orga', email: 'o@x.fr' }).run();
    const t = await upsertTrack(db, {
      source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
      geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
    }, { enrich: false });
    const input = { trackSlug: t.slug, title: 'Dimanche', date: '2099-05-10', time: '08:30' };
    const a = await createOuting(db, 'u1', input);
    const b = await createOuting(db, 'u1', input);
    expect(a).toEqual(b);
    createInvitation(db, 'u1', (a as { slug: string }).slug, 'Toto');
    createInvitation(db, 'u1', (a as { slug: string }).slug, 'Titi');
    const l = listOutings(db, 'u1', new Date('2099-01-01'));
    expect(l.upcoming.length + l.past.length).toBe(1);
  });
});
