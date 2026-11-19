import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { getCurrentUser } from '@/lib/current-user';
import { getVisibleTrack } from '@/lib/tracks';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const user = await getCurrentUser().catch(() => null);
  const t = getVisibleTrack(getDb().db, (await params).slug, user?.id);
  const tr = await getTranslations('track');
  return { title: t ? tr('metaTitle', { name: t.name || tr('untitled') }) : tr('notFound'), robots: { index: false, follow: false } };
}

/** Short and stable link (#1593): the sheet lives in the map panel. Not visible ⇒ 404, never a redirect. */
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser().catch(() => null);
  if (!getVisibleTrack(getDb().db, slug, user?.id)) notFound();
  redirect(`/?t=${encodeURIComponent(slug)}`);
}
