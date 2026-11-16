import { getLocale } from 'next-intl/server';
import { getDb } from '@/db';
import { getInvitationByToken } from '@/lib/outings';
import { OG_SIZE, outingOgImage } from '@/lib/outings/og-image';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';
export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = 'Singletrack';

// Aperçu du lien perso (#1351) : titre, date et tracé de la sortie. Lien inconnu/révoqué ⇒ image générique.
export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const found = getInvitationByToken(getDb().db, (await params).token);
  return outingOgImage(found?.outing, (await getLocale()) as Locale);
}
