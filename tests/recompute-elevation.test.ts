import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { outing, outingRide, track } from '@/db/schema';
import { snapshotOf } from '@/lib/outings/snapshot';
import { geometryStats } from '@/lib/geo';
import { recomputeElevation } from '@/lib/tracks/recompute-elevation';

// Simulated IGN: elevation = 100 + 10 × (lon - 6) × 1000, i.e. +10 m per point spaced 0.001° apart.
const fakeFetch = async (url: string) => {
  const lons = new URL(url).searchParams.get('lon')!.split('|').map(Number);
  return { ok: true, status: 200, json: async () => ({ elevations: lons.map((l) => 100 + Math.round((l - 6) * 10000)) }) };
};
const geom = { type: 'LineString' as const, coordinates: [[6, 43, 500], [6.001, 43, 100], [6.002, 43, 900], [6.003, 43, 50]] as [number, number, number][] };

function seed() {
  const { db } = openDb(':memory:');
  const s = geometryStats(geom);
  const t = db.insert(track).values({
    source: 'manual', name: 'T', geometry: geom, bboxMinLon: 6, bboxMinLat: 43, bboxMaxLon: 6.003, bboxMaxLat: 43, startLon: 6, startLat: 43,
    distanceM: s.distanceM, elevationGainM: s.gainM, elevationLossM: s.lossM, minEle: s.minEle, maxEle: s.maxEle,
  }).returning().get();
  const noEle = db.insert(track).values({
    source: 'manual', name: 'N', geometry: { type: 'LineString', coordinates: [[6, 43], [6.001, 43]] }, bboxMinLon: 6, bboxMinLat: 43, bboxMaxLon: 6.001, bboxMaxLat: 43,
    startLon: 6, startLat: 43, distanceM: 100,
  }).returning().get();
  return { db, t, noEle };
}

describe('recomputeElevation (#1519)', () => {
  it('recote les traces avec altitude, laisse les autres, et ne fait rien de plus la seconde fois', async () => {
    const { db, t, noEle } = seed();
    const first = await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0 });
    expect(first.track).toMatchObject({ seen: 1, changed: 1, failed: 0 });
    const after = db.select().from(track).all();
    const upd = after.find((x) => x.id === t.id)!;
    expect(upd.geometry.coordinates.map((p) => p[2])).toEqual([100, 110, 120, 130]);
    expect(upd.elevationGainM).toBe(30);
    expect(after.find((x) => x.id === noEle.id)!.minEle).toBeNull();

    const second = await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0 });
    expect(second.track.changed).toBe(0);
    expect(db.select().from(track).all()).toEqual(after);
  });

  it('recote les snapshots de sorties et les traces roulées', async () => {
    const { db, t } = seed();
    const snap = { ...snapshotOf(t), geometry: geom };
    const o = db.insert(outing).values({ trackId: t.id, trackSnapshot: snap, title: 'S', startsAt: new Date(), meetingLat: 43, meetingLon: 6 }).returning().get();
    const ride = db.insert(outingRide).values({ outingId: o.id, geometry: geom, distanceM: 300, gainM: 800 }).returning().get();
    const r = await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0 });
    expect(r.snapshot.changed).toBe(1);
    expect(r.ride.changed).toBe(1);
    const o2 = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    expect(o2.trackSnapshot.elevationGainM).toBe(30);
    expect(o2.trackSnapshot.slug).toBe(snap.slug); // the rest of the snapshot is untouched
    expect(db.select().from(outingRide).where(eq(outingRide.id, ride.id)).get()!.gainM).toBe(30);
    const again = await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0 });
    expect(again.snapshot.changed + again.ride.changed + again.track.changed).toBe(0);
  });

  it('reprise : les lignes déjà traitées ne rappellent pas l\'IGN', async () => {
    const { db } = seed();
    const done = new Set<string>();
    await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0, done });
    let calls = 0;
    const r = await recomputeElevation(db, { fetchFn: (u) => (calls++, fakeFetch(u)), intervalMs: 0, done });
    expect(calls).toBe(0);
    expect(r.track.skipped).toBe(1);
  });

  it('IGN en panne : échec compté, ligne intacte, non marquée traitée', async () => {
    const { db, t } = seed();
    const done = new Set<string>();
    const r = await recomputeElevation(db, { fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }), intervalMs: 0, done });
    expect(r.track).toMatchObject({ failed: 1, changed: 0 });
    expect(done.size).toBe(0);
    expect(db.select().from(track).all().find((x) => x.id === t.id)!.geometry).toEqual(geom);
  });

  it('dry-run : rien n\'est écrit', async () => {
    const { db, t } = seed();
    const r = await recomputeElevation(db, { fetchFn: fakeFetch, intervalMs: 0, dryRun: true });
    expect(r.track.changed).toBe(1);
    expect(db.select().from(track).all().find((x) => x.id === t.id)!.geometry).toEqual(geom);
  });
});
