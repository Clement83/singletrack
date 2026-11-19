import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { outing, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createOuting, duplicateOuting, getOwnedOuting, updateOuting } from '@/lib/outings';
import { listFriends, requestByEmail, respondToRequest } from '@/lib/friends';
import { canSeeOuting, getDefaultOutingVisibility, isOutingVisibility, setDefaultOutingVisibility } from '@/lib/user-profile';

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([
    { id: 'a', name: 'Alice', email: 'a@x.fr' }, { id: 'b', name: 'Bob', email: 'b@x.fr' },
    { id: 'c', name: 'Cléo', email: 'c@x.fr' }, { id: 'd', name: 'Dan', email: 'd@x.fr' },
  ]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 20] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const mk = async (owner: string, extra: object = {}) => {
    const r = await createOuting(db, owner, { trackSlug: t.slug, title: 'Sortie', date: '2030-05-10', time: '08:30', ...extra });
    if (!('slug' in r)) throw new Error('création');
    return r.slug;
  };
  return { db, mk };
}

describe('visibilité des sorties (#1442)', () => {
  it('défaut du compte : invite, modifiable, valeurs inconnues refusées', async () => {
    const { db } = await setup();
    expect(isOutingVisibility('friends')).toBe(true);
    expect(isOutingVisibility('secret')).toBe(false);
    expect(getDefaultOutingVisibility(db, 'a')).toBe('friends'); // "friends" default since #1455
    expect(setDefaultOutingVisibility(db, 'a', 'secret')).toEqual({ ok: false, error: 'invalid' });
    expect(setDefaultOutingVisibility(db, 'a', 'invite').ok).toBe(true);
    expect(getDefaultOutingVisibility(db, 'a')).toBe('invite');
    expect(getDefaultOutingVisibility(db, 'b')).toBe('friends');
  });

  it('création : défaut du compte, ou surcharge explicite ; valeur invalide refusée', async () => {
    const { db, mk } = await setup();
    expect(getOwnedOuting(db, 'a', await mk('a', { title: 'Un' }))!.visibility).toBe('friends');
    expect(setDefaultOutingVisibility(db, 'a', 'public').ok).toBe(false); // freezes the outing: never a default (#1455)
    expect(getOwnedOuting(db, 'a', await mk('a', { visibility: 'friends', title: 'Autre' }))!.visibility).toBe('friends');
    await expect(mk('a', { visibility: 'nope', title: 'X' })).rejects.toThrow();
  });

  it('modification et duplication', async () => {
    const { db, mk } = await setup();
    const slug = await mk('a');
    expect(updateOuting(db, 'a', slug, { visibility: 'friends' })).toEqual({ ok: true });
    expect(getOwnedOuting(db, 'a', slug)!.visibility).toBe('friends');
    const bad = updateOuting(db, 'a', slug, { visibility: 'nope' });
    expect(bad.ok).toBe(false);
    expect(getOwnedOuting(db, 'a', slug)!.visibility).toBe('friends');
    setDefaultOutingVisibility(db, 'a', 'public'); // the copy takes the original outing's value, not the default
    const d = duplicateOuting(db, 'a', slug, { date: '2030-05-17', time: '08:30' });
    if (!d.ok) throw new Error('dup');
    expect(getOwnedOuting(db, 'a', d.slug)!.visibility).toBe('friends');
  });

  it('canSeeOuting : propriétaire, copain accepté / en attente / inconnu × 3 niveaux', async () => {
    const { db, mk } = await setup();
    requestByEmail(db, 'b', 'a@x.fr'); // b → a, accepted
    respondToRequest(db, 'a', listFriends(db, 'a').incoming[0].id, 'accept');
    requestByEmail(db, 'c', 'a@x.fr'); // c → a, pending
    const rows = {} as Record<string, typeof outing.$inferSelect>;
    for (const v of ['public', 'friends', 'invite'] as const) {
      const slug = await mk('a', { visibility: v, title: v });
      rows[v] = db.select().from(outing).where(eq(outing.slug, slug)).get()!;
    }
    const see = (viewer: string) => (['public', 'friends', 'invite'] as const).map((v) => canSeeOuting(db, viewer, rows[v]));
    expect(see('a')).toEqual([true, true, true]);
    expect(see('b')).toEqual([true, true, false]);
    expect(see('c')).toEqual([true, false, false]);
    expect(see('d')).toEqual([true, false, false]);
  });
});
