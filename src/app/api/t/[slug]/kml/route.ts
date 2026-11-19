import { getDb } from '@/db';
import { toKml } from '@/lib/geo';
import { getCurrentUser } from '@/lib/current-user';
import { getVisibleTrack } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/** Public by slug: KML download (attribution kept in the file). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);
  const t = getVisibleTrack(getDb().db, slug, user?.id);
  if (!t) return new Response('Not found', { status: 404 });
  const file = t.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'trace';
  return new Response(toKml({ name: t.name, description: t.description, attribution: t.attribution, license: t.license, geometry: t.geometry }), {
    headers: {
      'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}.kml"`,
      'X-Robots-Tag': 'noindex',
    },
  });
}
