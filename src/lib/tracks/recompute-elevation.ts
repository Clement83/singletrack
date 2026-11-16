import { eq, isNotNull } from 'drizzle-orm';
import type { Db } from '@/db';
import { outing, outingRide, track } from '@/db/schema';
import { enrichElevation, gainLoss, geometryStats, type EnrichOptions, type Position, type TrackGeometry } from '@/lib/geo';

/**
 * Recalcul du D+ de l'existant (#1519, epic #1514) : recote par l'IGN (mode `replace`, #1515) puis recalcule
 * D+/D-/min/max avec les réglages courants (#1517) pour :
 *  - les traces avec altitude (`track`) ;
 *  - les snapshots de toutes les sorties locales (`outing.track_snapshot`), passées comprises ;
 *  - les traces roulées (`outing_ride.gain_m`).
 * Les sorties distantes (`remote_outing`) ne sont pas concernées. Idempotent : une ligne ne s'écrit que si le résultat
 * diffère, et `done` (reprise) permet de ne pas réinterroger l'IGN pour ce qui est déjà traité.
 */
export type RecomputeKind = 'track' | 'snapshot' | 'ride';
export type RecomputeReport = Record<RecomputeKind, { seen: number; changed: number; skipped: number; failed: number }>;

export type RecomputeOptions = EnrichOptions & {
  /** Clés `kind:id` déjà traitées (reprise) ; alimenté au fil de l'eau. */
  done?: Set<string>;
  dryRun?: boolean;
  onItem?: (kind: RecomputeKind, id: string, outcome: 'changed' | 'unchanged' | 'skipped' | 'failed', detail?: string) => void;
  /** Appelé après chaque ligne traitée (checkpoint). */
  onProgress?: (key: string) => void;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const lineList = (g: TrackGeometry): Position[][] => (g.type === 'LineString' ? [g.coordinates] : g.coordinates);
const hasAllEle = (g: TrackGeometry) => lineList(g).every((l) => l.every((p) => typeof p[2] === 'number'));

export async function recomputeElevation(db: Db, opts: RecomputeOptions = {}): Promise<RecomputeReport> {
  const report: RecomputeReport = {
    track: { seen: 0, changed: 0, skipped: 0, failed: 0 },
    snapshot: { seen: 0, changed: 0, skipped: 0, failed: 0 },
    ride: { seen: 0, changed: 0, skipped: 0, failed: 0 },
  };
  const done = opts.done ?? new Set<string>();
  const cache = opts.cache ?? new Map<string, number>();
  const baseFetch = opts.fetchFn ?? ((u: string) => fetch(u));

  /** Recote une géométrie ; `null` si l'IGN a échoué (on ne touche alors à rien). */
  async function recote(g: TrackGeometry): Promise<TrackGeometry | null> {
    let ignFailed = false;
    const out = await enrichElevation(g, {
      ...opts,
      cache,
      replace: true,
      fetchFn: async (u) => {
        try {
          const r = await baseFetch(u);
          if (!r.ok) ignFailed = true;
          return r;
        } catch (e) {
          ignFailed = true;
          throw e;
        }
      },
    }).catch(() => null);
    return ignFailed ? null : out;
  }

  async function step(kind: RecomputeKind, id: string, work: () => Promise<boolean | null>) {
    const key = `${kind}:${id}`;
    const r = report[kind];
    r.seen++;
    if (done.has(key)) {
      r.skipped++;
      opts.onItem?.(kind, id, 'skipped');
      return;
    }
    try {
      const changed = await work();
      if (changed === null) {
        r.failed++;
        opts.onItem?.(kind, id, 'failed', 'IGN indisponible ou réponse invalide');
        return;
      }
      if (changed) r.changed++;
      if (!opts.dryRun) {
        done.add(key);
        opts.onProgress?.(key);
      }
      opts.onItem?.(kind, id, changed ? 'changed' : 'unchanged');
    } catch (e) {
      r.failed++;
      opts.onItem?.(kind, id, 'failed', e instanceof Error ? e.message : String(e));
    }
  }

  // 1. Traces avec altitude.
  const tracks = db.select().from(track).where(isNotNull(track.minEle)).all();
  for (const t of tracks) {
    await step('track', t.id, async () => {
      const geometry = await recote(t.geometry);
      if (!geometry) return null;
      const s = geometryStats(geometry);
      const patch = { geometry, elevationGainM: s.gainM, elevationLossM: s.lossM, minEle: s.minEle, maxEle: s.maxEle };
      if (same(patch, { geometry: t.geometry, elevationGainM: t.elevationGainM, elevationLossM: t.elevationLossM, minEle: t.minEle, maxEle: t.maxEle })) return false;
      if (!opts.dryRun) db.update(track).set(patch).where(eq(track.id, t.id)).run();
      return true;
    });
  }

  // 2. Snapshots de sorties (leur propre géométrie simplifiée, jamais la trace d'origine : la sortie reste figée).
  for (const o of db.select({ id: outing.id, snap: outing.trackSnapshot }).from(outing).all()) {
    if (!hasAllEle(o.snap.geometry) && o.snap.minEle == null) {
      report.snapshot.seen++;
      report.snapshot.skipped++;
      opts.onItem?.('snapshot', o.id, 'skipped', 'sans altitude');
      continue;
    }
    await step('snapshot', o.id, async () => {
      const geometry = await recote(o.snap.geometry);
      if (!geometry) return null;
      const s = geometryStats(geometry);
      const next = { ...o.snap, geometry, elevationGainM: s.gainM, elevationLossM: s.lossM, minEle: s.minEle, maxEle: s.maxEle };
      if (same(next, o.snap)) return false;
      if (!opts.dryRun) db.update(outing).set({ trackSnapshot: next }).where(eq(outing.id, o.id)).run();
      return true;
    });
  }

  // 3. Traces roulées : géométrie (déjà simplifiée) recotée, D+ arrondi comme à l'enregistrement.
  for (const r of db.select().from(outingRide).all()) {
    await step('ride', r.id, async () => {
      const geometry = await recote(r.geometry);
      if (!geometry) return null;
      const gainM = hasAllEle(geometry) ? Math.round(lineList(geometry).reduce((a, l) => a + gainLoss(l.map((p) => p[2] as number)).gainM, 0)) : null;
      if (same({ geometry, gainM }, { geometry: r.geometry, gainM: r.gainM })) return false;
      if (!opts.dryRun) db.update(outingRide).set({ geometry, gainM }).where(eq(outingRide.id, r.id)).run();
      return true;
    });
  }
  return report;
}
