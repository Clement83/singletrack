import type { Db } from '@/db';
import { lines, profileOf, simplifyGeometry } from '@/lib/geo';
import { outingsOfTrack } from '@/lib/outings';
import { canEditInPlace } from './edit';
import { estimateDurationMin } from './duration';
import { ensureTrackElevation } from './elevation';
import { getVisibleTrack } from './query';

export const PROFILE_POINTS = 240;

/**
 * Fiche complète d'une trace (#1581), calculée une seule fois pour la page `/t/<slug>` et `GET /api/tracks/<slug>` :
 * géométrie à 5 m, profil (~240 points localisés), durée estimée, droits et sorties de l'utilisateur.
 * `undefined` si la trace est inconnue ou si c'est le brouillon d'un autre (⇒ 404). Complète l'altitude IGN au besoin.
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
    /** #1590 : seulement pour l'auteur d'une trace modifiable (jamais OSM / Geotrek) ; sert au badge et au menu « … ». */
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
