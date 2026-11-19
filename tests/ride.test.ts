import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingRide, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { analyzeRide, canUploadRide, createOuting, deleteRide, listRides, saveRide } from '@/lib/outings';

const gpx = (pts: string) => `<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
// 21 points every 100 m eastwards (~0.00123° of longitude at 43.2°), 20 s apart (18 km/h), climbing 5 m / point, then a GPS pause.
const pt = (i: number, t: string, ele = 100 + i * 5) => `<trkpt lat="43.2" lon="${6.1 + i * 0.00123}"><ele>${ele}</ele><time>${t}</time></trkpt>`;
const ride = gpx(
  Array.from({ length: 21 }, (_, i) => pt(i, new Date(Date.UTC(2026, 10, 14, 8, 0, i * 20)).toISOString())).join('') +
    // 10 min later: GPS pause, 2 almost still points
    pt(21, '2026-11-14T08:17:00Z', 205) + pt(22, '2026-11-14T08:17:30Z', 205),
);

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 10] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Sortie', date: '2026-11-14', time: '08:00' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  const inv = (id: string, name: string) => {
    db.insert(invitation).values({ id, outingId: o.id, tokenHash: `h${id}`, name, status: 'yes' }).run();
    return { kind: 'guest' as const, invitationId: id };
  };
  return { db, o, inv };
}
const after = new Date('2026-11-14T12:00:00Z');
/** Fake IGN: elevation = 500 + 10 × rank of the point in the request (re-elevating proves the GPS elevation is replaced). */
const ign = () => fakeIgn(true);
const fakeIgn = (fail = false) => ({
  fetchFn: vi.fn(async (url: string) => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    const n = new URL(url).searchParams.get('lon')!.split('|').length;
    return { ok: true, status: 200, json: async () => ({ elevations: Array.from({ length: n }, (_, i) => 500 + i * 10) }) };
  }),
  cache: new Map<string, number>(),
  intervalMs: 0,
});

describe('analyzeRide (#1412)', () => {
  it('distance, D+, temps de déplacement hors pauses, durée totale', async () => {
    const s = await analyzeRide(ride, fakeIgn(true)); // IGN down: GPS elevation as a fallback
    expect(s.distanceM).toBeGreaterThan(2000);
    expect(s.distanceM).toBeLessThan(2400);
    expect(s.gainM).toBeGreaterThan(80);
    expect(s.movingSec).toBe(430); // 20 × 20 s + 30 s; the 10-min GPS pause does not count
    expect(s.elapsedSec).toBe(17 * 60 + 30);
  });
  it('D+ calculé sur les altitudes IGN, pas sur celles du GPS (#1515)', async () => {
    const s = await analyzeRide(ride, fakeIgn());
    const up = s.geometry.type === 'LineString' ? s.geometry.coordinates.map((p) => p[2]) : [];
    expect(up.every((e) => typeof e === 'number' && e >= 500)).toBe(true);
    expect(s.gainM).toBeGreaterThan(80);
  });
  it('sans horodatage ni altitude GPS : temps inconnu, altitude IGN ; IGN muet : D+ inconnu', async () => {
    const f = gpx('<trkpt lat="43.2" lon="6.1"/><trkpt lat="43.2" lon="6.11"/>');
    const s = await analyzeRide(f, fakeIgn());
    expect(s.movingSec).toBeNull();
    expect(s.gainM).not.toBeNull(); // IGN elevation present (smoothed gain, 2 points)
    expect((await analyzeRide(f, fakeIgn(true))).gainM).toBeNull();
    expect(s.distanceM).toBeGreaterThan(700);
  });
  it('refuse un fichier qui n’est pas un GPX, un DOCTYPE, un GPX vide', async () => {
    await expect(analyzeRide('<html/>')).rejects.toThrow('notGpx');
    await expect(analyzeRide('<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>')).rejects.toThrow('doctype');
    await expect(analyzeRide('<gpx></gpx>')).rejects.toThrow();
  });
});

describe('saveRide / listRides', () => {
  it('une trace par personne (remplacée), chacun ne voit que la sienne, l’organisateur voit tout', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    const b = inv('b', 'Bob');
    const orga = { kind: 'organizer' as const, userId: 'u1' };
    expect((await saveRide(db, o, a, ride, after, ign())).ok).toBe(true);
    expect((await saveRide(db, o, a, ride, after, ign())).ok).toBe(true); // remplacement
    expect((await saveRide(db, o, b, ride, after, ign())).ok).toBe(true);
    expect((await saveRide(db, o, orga, ride, after, ign())).ok).toBe(true);
    expect(db.select().from(outingRide).all()).toHaveLength(3);
    expect(listRides(db, o.id, a).map((r) => r.mine)).toEqual([true]);
    expect(listRides(db, o.id, b)).toHaveLength(1);
    const all = listRides(db, o.id, orga);
    expect(all).toHaveLength(3);
    expect(all[0].organizer && all[0].mine).toBe(true);
    expect(all.filter((r) => r.author === 'Alice')).toHaveLength(1);
    deleteRide(db, o, a);
    expect(listRides(db, o.id, a)).toHaveLength(0);
    expect(listRides(db, o.id, b)).toHaveLength(1);
  });
  it('refusée avant la sortie, si annulée, ou si le fichier est mauvais', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    expect(await saveRide(db, o, a, ride, new Date('2026-11-01T00:00:00Z'), ign())).toEqual({ ok: false, error: 'tooEarly' });
    expect(await saveRide(db, { ...o, status: 'cancelled' }, a, ride, after, ign())).toEqual({ ok: false, error: 'closed' });
    expect(await saveRide(db, o, a, 'pas un gpx', after, ign())).toEqual({ ok: false, error: 'notGpx' });
    expect(await saveRide(db, o, a, 'x'.repeat(5 * 1024 * 1024 + 1), after, ign())).toEqual({ ok: false, error: 'tooLarge' });
    expect(canUploadRide(o, after)).toBe(true);
  });
  it('supprimer l’invitation supprime sa trace (cascade)', async () => {
    const { db, o, inv } = await setup();
    await saveRide(db, o, inv('a', 'Alice'), ride, after, ign());
    db.delete(invitation).where(eq(invitation.id, 'a')).run();
    expect(db.select().from(outingRide).all()).toHaveLength(0);
  });
});
