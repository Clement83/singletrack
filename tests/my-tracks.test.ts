import { describe, expect, it } from 'vitest';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { parseFilters, queryTracks, serializeFilters, upsertTrack, type NormalizedTrack } from '@/lib/tracks';
import { activeFilterCount } from '@/lib/tracks/filters';
import { isPublicPath } from '@/lib/public-routes';

// Filtre « Mes traces » de la carte (#1430, remplace la page /traces de #1410).
const mk = (name: string, createdBy: string | null): NormalizedTrack => ({
  source: createdBy ? 'manual' : 'osm', externalId: createdBy ? null : name, name, license: null, attribution: null, createdBy,
  geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180]] }, raw: null,
});

describe('filtre mes traces', () => {
  it('?mine=1 se lit, se sérialise et compte comme un filtre', () => {
    const f = parseFilters(new URLSearchParams('mine=1'));
    expect(f.mine).toBe(true);
    expect(serializeFilters(f).toString()).toBe('mine=1');
    expect(activeFilterCount(f)).toBe(1);
    expect(parseFilters(new URLSearchParams('mine=0')).mine).toBeUndefined();
  });
  it('ne renvoie que les traces de l’utilisateur', async () => {
    const { db } = openDb(':memory:');
    const now = new Date();
    for (const id of ['u1', 'u2']) db.insert(user).values({ id, name: id, email: `${id}@x.fr`, emailVerified: true, createdAt: now, updatedAt: now }).run();
    await upsertTrack(db, mk('A', 'u1'), { enrich: false });
    await upsertTrack(db, mk('B', 'u2'), { enrich: false });
    await upsertTrack(db, mk('OSM', null), { enrich: false });
    const names = (userId?: string) => queryTracks(db, { mine: true }, undefined, { userId }).tracks.map((t) => t.name);
    expect(names('u1')).toEqual(['A']);
    expect(names('u3')).toEqual([]);
    expect(names(undefined)).toEqual([]);
    expect(queryTracks(db, {}, undefined, { userId: 'u1' }).total).toBe(3);
  });
  it('/traces n’est plus une page publique', () => expect(isPublicPath('/traces')).toBe(false));
});
