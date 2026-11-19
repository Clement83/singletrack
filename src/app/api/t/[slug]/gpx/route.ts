import { getDb } from '@/db';
import { toGpx } from '@/lib/geo';
import { getCurrentUser } from '@/lib/current-user';
import { getVisibleTrack } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

/** Public by slug: GPX download (attribution kept in the file). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);
  const t = getVisibleTrack(getDb().db, slug, user?.id);
  if (!t) return new Response('Not found', { status: 404 });
  const file = t.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'trace';
  return new Response(toGpx(t), {
    headers: {
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file}.gpx"`,
      'X-Robots-Tag': 'noindex',
    },
  });
}
