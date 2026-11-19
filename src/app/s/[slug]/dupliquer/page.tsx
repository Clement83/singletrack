import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getDb } from '@/db';
import { DuplicateForm } from '@/components/outings/duplicate-form';
import { requireUser } from '@/lib/current-user';
import { getManagedOuting, listInvitations, utcToParisInputs } from '@/lib/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('duplicateOuting'), robots: { index: false, follow: false } };
}

/** +7 days on the Paris date, same time (computed on the calendar date: unaffected by the clock change). */
function plusDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Duplicate an outing (#1360): private, organiser only (404 for anyone else).
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const user = await requireUser();
  const { db } = getDb();
  const o = getManagedOuting(db, user.id, (await params).slug);
  if (!o) notFound();
  const { date, time } = utcToParisInputs(o.startsAt);
  const tp = await getTranslations('outingPage');
  const tr = await getTranslations('duplicate');
  const hasInvitees = listInvitations(db, o.id).some((i) => !i.revokedAt);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-5 px-4 pt-4">
      <Link href={`/s/${o.slug}`} className="flex min-h-touch items-center gap-2 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
        <ArrowLeft aria-hidden className="size-5" /> {tp('backToOuting')}
      </Link>
      <h1 className="text-title">{tr('title')}</h1>
      <DuplicateForm slug={o.slug} date={plusDays(date, 7)} time={time} hasInvitees={hasInvitees} />
    </main>
  );
}
