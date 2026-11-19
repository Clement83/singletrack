import { getLocale } from 'next-intl/server';
import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { OG_SIZE, outingOgImage } from '@/lib/outings/og-image';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Singletrack';

// Personal link preview (#1351): title, date and line of the outing. Unknown/revoked link ⇒ generic image.
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const found = getInvitationByToken(getDb().db, (await params).token);
  return outingOgImage(found?.outing, (await getLocale()) as Locale);
}
