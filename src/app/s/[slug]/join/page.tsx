import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { JoinForm } from '@/components/outings/join-form';
import { OutingBadges } from '@/components/outings/outing-badges';
import { formatOutingDate } from '@/lib/format';
import { getOutingByOpenToken, isClosed } from '@/lib/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('join'))('metaTitle'), robots: { index: false, follow: false } };
}

// Lien ouvert de groupe (désactivé par défaut) : on tape son prénom, on reçoit son lien perso /i/<token>.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const o = getOutingByOpenToken(getDb().db, slug);
  if (!o) notFound();
  const t = await getTranslations('join');
  const locale = await getLocale();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 pt-8 pb-8">
      <h1 className="text-title">{o.title}</h1>
      <p className="text-heading">{formatOutingDate(o.startsAt, locale)}</p>
      <OutingBadges level={o.level} ebike={o.ebike} cancelled={o.status === 'cancelled'} />
      {isClosed(o) ? <p className="text-muted-foreground">{t('closed')}</p> : <JoinForm openToken={slug} />}
    </main>
  );
}
