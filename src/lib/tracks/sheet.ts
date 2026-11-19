import type { Db } from '@/db';
import { lines, profileOf, simplifyGeometry } from '@/lib/geo';
import { outingsOfTrack } from '@/lib/outings';
import { canEditInPlace } from './edit';
import { estimateDurationMin } from './duration';
import { ensureTrackElevation } from './elevation';
import { getVisibleTrack } from './query';

export const PROFILE_POINTS = 240;

/**
 * Full sheet of a track (#1581), computed once for the `/t/<slug>` page and `GET /api/tracks/<slug>`:
 * geometry at 5 m, profile (~240 located points), estimated duration, rights and the user's outings.
 * `undefined` if the track is unknown or someone else's draft (⇒ 404). Completes the IGN elevation if needed.
 */
export async function trackSheet(db: Db, slug: string, userId?: string | null) {
  const found = getVisibleTrack(db, slug, userId);
  if (!found) return undefined;
  const t = await ensureTrackElevation(db, found);
  const geometry = simplifyGeometry(t.geometry, 5);
  const coords = lines(t.geometry).flat();
  const full = profileOf(coords);
  const withEle = coords.filter((p) => typeof p[2] === 'number');
  const step = Math.max(1, Math.floor(full.length / PROFILE_POINTS));
  const profile = full
    .map((p, i) => ({ ...p, lon: withEle[i][0], lat: withEle[i][1] }))
    .filter((_, i, a) => i % step === 0 || i === a.length - 1);
  const ls = lines(t.geometry);
  const end = ls[ls.length - 1].at(-1)!;
  const draft = t.status === 'draft';
  const mine = !!userId && canEditInPlace(t, userId);
  const outings = userId ? outingsOfTrack(db, userId, t.id) : [];
  return {
    slug: t.slug,
    name: t.name,
    status: t.status,
    /** #1590: only for the author of an editable track (never OSM / Geotrek); used for the badge and the "…" menu. */
    visibility: mine ? t.visibility : null,
    difficulty: t.difficulty,
    loop: t.loop,
    source: t.source,
    distanceM: t.distanceM,
    gainM: t.elevationGainM,
    lossM: t.elevationLossM,
    minEle: t.minEle,
    maxEle: t.maxEle,
    durationMin: estimateDurationMin(t.distanceM, t.elevationGainM),
    description: t.description,
    author: t.author,
    license: t.license,
    attribution: t.attribution,
    sourceUrl: t.sourceUrl,
    geometry,
    bbox: [t.bboxMinLon, t.bboxMinLat, t.bboxMaxLon, t.bboxMaxLat] as [number, number, number, number],
    start: [t.startLon, t.startLat] as [number, number],
    end: [end[0], end[1]] as [number, number],
    profile,
    rights: { edit: mine, copy: !!userId && !draft, delete: mine },
    outings: outings.map((o) => ({ slug: o.slug, title: o.title, startsAt: o.startsAt })),
    updatedAt: t.updatedAt,
  };
}
export type TrackSheet = NonNullable<Awaited<ReturnType<typeof trackSheet>>>;
