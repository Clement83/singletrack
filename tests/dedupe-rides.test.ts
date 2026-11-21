import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { outing, outingRide, user } from '@/db/schema';
import { dedupeStoredRides } from '@/lib/outings/dedupe-rides';
import { dedupeLineIndexes, lineLength, type Position } from '@/lib/geo';

const line = (n: number, lon0 = 6.1, dLat = 0): Position[] => Array.from({ length: n }, (_, i) => [lon0 + i * 0.00123, 43.2 + dLat, 100 + i]);

describe('dedupeLineIndexes (#1699)', () => {
  it('drops a line covered by another, prefers the timed one', () => {
    expect(dedupeLineIndexes([line(31), line(31, 6.1, 0.00005)], [false, true])).toEqual([1]);
    expect(dedupeLineIndexes([line(31), line(60, 6.1, 0.00005)])).toEqual([1]);
  });
  it('keeps distinct lines, and a loop ridden twice inside one line', () => {
    expect(dedupeLineIndexes([line(31), line(31, 6.1 + 31 * 0.00123)])).toEqual([0, 1]);
    expect(dedupeLineIndexes([[...line(31), ...line(31)]])).toEqual([0]);
  });
});

describe('dedupeStoredRides (#1699)', () => {
  function setup() {
    const { db } = openDb(':memory:');
    db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
    db.insert(outing).values({ id: 'o1', slug: 's1', ownerId: 'u1', title: 'S', date: '2026-11-14', time: '08:00', trackSnapshot: {}, startsAt: new Date(), meetingLat: 43, meetingLon: 6 } as never).run();
    return db;
  }
  it('rewrites a doubled ride once (distance, gain, times), idempotent, dry-run writes nothing', () => {
    const db = setup();
    const a = line(31), b = line(31, 6.1, 0.00004);
    const len = lineLength(a);
    db.insert(outingRide).values({
      id: 'r1', outingId: 'o1', geometry: { type: 'MultiLineString', coordinates: [a, b] }, distanceM: Math.round(len * 2), gainM: 120,
      movingSec: 100, elapsedSec: 200, times: [...a.map((_, i) => i * 1000), ...b.map((_, i) => 5e6 + i)],
    }).run();
    const dry = dedupeStoredRides(db, { dryRun: true });
    expect(dry.changed).toBe(1);
    expect(db.select().from(outingRide).where(eq(outingRide.id, 'r1')).get()!.distanceM).toBe(Math.round(len * 2));
    expect(dedupeStoredRides(db).changed).toBe(1);
    const r = db.select().from(outingRide).where(eq(outingRide.id, 'r1')).get()!;
    expect(r.geometry.type).toBe('LineString');
    expect(r.distanceM).toBe(Math.round(len));
    expect(r.gainM).toBe(60);
    expect(r.times).toHaveLength(31);
    expect(dedupeStoredRides(db).changed).toBe(0);
  });
});
