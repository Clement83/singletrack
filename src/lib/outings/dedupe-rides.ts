import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { outingRide } from '@/db/schema';
import { dedupeLineIndexes, lineLength, type Position, type TrackGeometry } from '@/lib/geo';

/**
 * Removes duplicated lines from already stored ridden tracks (#1699), from the stored (simplified) geometry. The original
 * file is not kept, so distance and gain are scaled by the share of the kept lines (their simplified length / gain), which
 * keeps the precision of the values computed at import. Idempotent: a ride without a duplicated line is not written.
 */
export type DedupeReport = { seen: number; changed: number };

export function dedupeStoredRides(
  db: Db,
  opts: { dryRun?: boolean; onItem?: (id: string, before: { distanceM: number; gainM: number | null }, after: { distanceM: number; gainM: number | null }) => void } = {},
): DedupeReport {
  const report: DedupeReport = { seen: 0, changed: 0 };
  for (const r of db.select().from(outingRide).all()) {
    report.seen++;
    const g = r.geometry as TrackGeometry;
    if (g.type !== 'MultiLineString') continue;
    const lines: Position[][] = g.coordinates;
    const keep = dedupeLineIndexes(lines, lines.map(() => !!r.times));
    if (keep.length === lines.length) continue;
    // times is flat and aligned with the lines: slice per line, keep the kept ones.
    let times: number[] | null = null;
    if (r.times && r.times.length === lines.reduce((a, l) => a + l.length, 0)) {
      const offsets: number[] = [];
      let o = 0;
      for (const l of lines) { offsets.push(o); o += l.length; }
      times = keep.flatMap((i) => r.times!.slice(offsets[i], offsets[i] + lines[i].length));
    }
    const lenAll = lines.reduce((a, l) => a + lineLength(l), 0);
    const lenKept = keep.reduce((a, i) => a + lineLength(lines[i]), 0);
    const ratio = lenAll > 0 ? lenKept / lenAll : 1;
    const kept = keep.map((i) => lines[i]);
    const geometry: TrackGeometry = kept.length === 1 ? { type: 'LineString', coordinates: kept[0] } : { type: 'MultiLineString', coordinates: kept };
    const distanceM = Math.round(r.distanceM * ratio);
    const gainM = r.gainM == null ? null : Math.round(r.gainM * ratio);
    opts.onItem?.(r.id, { distanceM: r.distanceM, gainM: r.gainM }, { distanceM, gainM });
    report.changed++;
    if (!opts.dryRun) db.update(outingRide).set({ geometry, distanceM, gainM, times }).where(eq(outingRide.id, r.id)).run();
  }
  return report;
}
