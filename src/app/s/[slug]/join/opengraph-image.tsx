import { getLocale } from 'next-intl/server';
import { getDb } from '@/db';
import { getOutingByOpenToken } from '@/lib/outings';
import { OG_SIZE, outingOgImage } from '@/lib/outings/og-image';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Singletrack';

// Preview of the group open link (#1351), the one posted in a WhatsApp group. Disabled ⇒ generic image.
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  return outingOgImage(getOutingByOpenToken(getDb().db, (await params).slug), (await getLocale()) as Locale);
}
