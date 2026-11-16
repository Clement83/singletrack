import { getDb } from '@/db';
import { assertUser, unauthorized } from '@/lib/current-user';
import { parseTrackFile, geometryStats, enrichElevation, type TrackGeometry } from '@/lib/geo';
import {
  MAX_FILES, MAX_GPX_BYTES, buildImportedTrack, findDuplicates, prefillFromGpx, upsertTrack, type ImportInput,
} from '@/lib/tracks';


const FILE_ERRORS = new Set(['notGpxExt', 'tooBig', 'notGpx', 'doctype', 'noPoints', 'noTrack']);
export const dynamic = 'force-dynamic';

/**
 * Privé. `POST /api/tracks/import` (multipart, champ `files`) : analyse sans rien enregistrer.
 * Renvoie une proposition par trace trouvée (stats, pré-remplissage, doublons éventuels).
 */
export async function POST(req: Request) {
  try {
    await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const form = await req.formData().catch(() => null);
  const files = (form?.getAll('files') ?? []).filter((f): f is File => typeof f !== 'string');
  if (files.length === 0) return Response.json({ error: 'noFile' }, { status: 400 });
  if (files.length > MAX_FILES) return Response.json({ error: 'tooManyFiles', max: MAX_FILES }, { status: 400 });

  const { db } = getDb();
  const items: unknown[] = [];
  const errors: { file: string; error: string }[] = [];
  for (const f of files) {
    try {
      if (!/\.(gpx|kml|kmz)$/i.test(f.name)) throw new Error('notGpxExt');
      if (f.size > MAX_GPX_BYTES) throw new Error('tooBig');
      const gpx = parseTrackFile(f.name, Buffer.from(await f.arrayBuffer()));
      const pre = prefillFromGpx(gpx);
      for (const [i, t] of gpx.tracks.entries()) {
        const s = geometryStats(t.geometry);
        items.push({
          file: f.name,
          name: t.name ?? f.name.replace(/\.(gpx|kml|kmz)$/i, ''),
          description: t.description ?? '',
          ...pre,
          geometry: t.geometry,
          hasElevation: s.gainM !== null,
          stats: { distanceKm: s.distanceM / 1000, gainM: s.gainM, lossM: s.lossM, loop: s.loop },
          duplicates: findDuplicates(db, t.geometry),
          key: `${f.name}#${i}`,
        });
      }
    } catch (e) {
      // Codes d'erreur traduits côté client (#1402) ; toute autre erreur (XML illisible…) → `unreadable`.
      const code = e instanceof Error && FILE_ERRORS.has(e.message) ? e.message : 'unreadable';
      errors.push({ file: f.name, error: code });
    }
  }
  return Response.json({ items, errors });
}

/** Privé. `PUT /api/tracks/import` (JSON `ImportInput`) : valide, complète l'altitude si absente, enregistre. */
export async function PUT(req: Request) {
  let user;
  try {
    user = await assertUser();
  } catch (e) {
    return unauthorized(e);
  }
  const input = (await req.json().catch(() => null)) as (ImportInput & { geometry: TrackGeometry }) | null;
  if (!input || typeof input !== 'object') return Response.json({ error: 'invalidRequest' }, { status: 400 });
  const built = buildImportedTrack(input);
  if ('errors' in built) return Response.json({ errors: built.errors }, { status: 422 });

  const { db } = getDb();
  // Toutes les altitudes viennent de l'IGN (#1515) ; l'altitude GPS du fichier ne sert que de repli.
  const geometry = await enrichElevation(built.track.geometry, { replace: true });
  const res = await upsertTrack(db, { ...built.track, geometry, createdBy: user.id }, { enrich: false });
  return Response.json({ slug: res.slug }, { status: 201 });
}
