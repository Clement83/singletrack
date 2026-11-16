import Link from 'next/link';
import { CalendarDays, ChevronRight, History, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { getDb } from '@/db';
import { AppNav } from '@/components/app-nav';
import { OutingBadges } from '@/components/outings/outing-badges';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/current-user';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { CalendarSubscribe } from '@/components/outings/calendar-subscribe';
import { pageOrigin } from '@/lib/outings/export';
import { JoinOutingButton } from '@/components/outings/join-outing-button';
import { archiveOverrides, getCalendarFeedToken, isArchivedFor, isDone, isPastOuting, listJoinedOutings, listOutings, listVisibleOutings, type JoinedOuting, type OpenOuting } from '@/lib/outings';
import type { OutingRow } from '@/db/schema';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { ArchiveButton } from '@/components/outings/archive-button';
import { RemoteAnswer } from '@/components/outings/remote-answer';
import { listRemoteOutings, type RemoteOutingView } from '@/lib/federation/outings';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('pages'))('outings'), robots: { index: false, follow: false } };
}

// Ni pastille incendie ni météo ici (#1407) : la sortie porte son bloc Conditions.
function OutingCard({ o, locale, archived = false }: { o: OutingRow; locale: string; archived?: boolean }) {
  return (
    <li className="flex flex-col gap-1">
      <Link href={`/s/${o.slug}`} className="flex min-h-touch items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-small text-muted-foreground">{formatOutingDate(o.startsAt, locale)}</p>
          <p className="text-heading">{o.title}</p>
          <OutingBadges level={o.level} ebike={o.ebike} cancelled={o.status === 'cancelled'} done={isDone(o)} />
        </div>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      </Link>
      <div className="flex justify-end"><ArchiveButton outingId={o.id} mode={archived ? 'unarchive' : 'archive'} /></div>
    </li>
  );
}

// Sortie ouverte (#1443) : résumé sans lien ; « Je viens » (#1444) rejoint avec le compte, désactivé si la sortie est pleine.
async function OpenOutingCard({ o, locale }: { o: OpenOuting; locale: string }) {
  const t = await getTranslations('outings');
  const tl = await getTranslations('outingLabels');
  const te = await getTranslations('errors');
  const dist = `${formatKm(o.distanceM / 1000, locale)}${o.gainM != null ? ` · ${formatElevation(o.gainM, locale)}` : ''}`;
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-small text-muted-foreground">{formatOutingDate(o.startsAt, locale)}</p>
        <Badge variant="outline">{o.visibility === 'friends' ? t('openFriends') : t('openPublic')}</Badge>
      </div>
      <p className="text-heading break-words">{o.title}</p>
      <p className="text-small text-muted-foreground">{t('openBy', { name: o.organizerName })}{o.meetingLabel ? ` · ${o.meetingLabel}` : ''}</p>
      <p className="text-small tabular-nums">{dist}</p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="primary">{tl(`level.${o.level}`)}</Badge>
        <Badge variant="outline">{tl(`ebike.${o.ebike}`)}</Badge>
        <Badge variant="outline">{t('openGoing', { n: o.yesCount })}</Badge>
        {o.spotsLeft != null && <Badge variant={o.spotsLeft === 0 ? 'danger' : 'outline'}>{t('openSpots', { n: o.spotsLeft })}</Badge>}
      </div>
      {o.spotsLeft === 0 ? <p className="text-small text-muted-foreground">{te('full')}</p> : <JoinOutingButton outingId={o.id} mode="join" />}
    </li>
  );
}

// Sortie rejointe avec mon compte (#1444) : badge Participant, « Ouvrir » régénère le lien de l'invitation liée.
function JoinedCard({ o, locale, t, archived = false, past = false }: { o: JoinedOuting; locale: string; archived?: boolean; past?: boolean; t: (k: 'participant' | 'openBy', v?: { name: string }) => string }) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-small text-muted-foreground">{formatOutingDate(o.startsAt, locale)}</p>
        <Badge variant="primary">{t('participant')}</Badge>
      </div>
      <p className="text-heading break-words">{o.title}</p>
      <p className="text-small text-muted-foreground">{t('openBy', { name: o.organizerName })}</p>
      <OutingBadges level={o.level} ebike={o.ebike} cancelled={o.status === 'cancelled'} done={isDone(o)} />
      <JoinOutingButton outingId={o.id} mode="open" />
      <div className="flex justify-end">
        {archived ? <ArchiveButton outingId={o.id} mode="unarchive" /> : past || o.status !== 'planned' ? <ArchiveButton outingId={o.id} mode="archive" /> : <ArchiveButton outingId={o.id} mode="leave" />}
      </div>
    </li>
  );
}

// Sortie d'un autre serveur (#1476) : copie en cache ; « Je viens » en un tap, la fiche pour le détail.
async function RemoteCard({ o, locale }: { o: RemoteOutingView; locale: string }) {
  const t = await getTranslations('remoteOutings');
  const tl = await getTranslations('outingLabels');
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-small text-muted-foreground">{formatOutingDate(o.startsAt, locale)}</p>
        <Badge variant="outline">{t('badge', { domain: o.organizer.domain })}</Badge>
      </div>
      <Link href={`/sorties/distante/${o.id}`} className="text-heading break-words underline-offset-4 hover:underline">{o.title}</Link>
      <p className="text-small text-muted-foreground">{t('by', { name: o.organizer.name, domain: o.organizer.domain })}{o.label ? ` · ${o.label}` : ''}</p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="primary">{tl(`level.${o.level}`)}</Badge>
        {o.invited && o.answer === 'pending' && <Badge variant="primary">{t('invited')}</Badge>}
        {o.answer !== 'pending' && <Badge variant="outline">{t(`answers.${o.answer}`)}</Badge>}
        <Badge variant="outline">{t('going', { n: o.yesCount })}</Badge>
        {o.status === 'cancelled' && <Badge variant="danger">{t('cancelled')}</Badge>}
      </div>
      {o.status === 'planned' && !o.closed && o.spotsLeft !== 0 && <RemoteAnswer id={o.id} current={o.answer} domain={o.organizer.domain} compact />}
    </li>
  );
}

// « Mes sorties » : à venir / passées.
export default async function Page() {
  const user = await requireUser();
  const { upcoming: allUpcoming, past: allPast } = listOutings(getDb().db, user.id);
  const open = listVisibleOutings(getDb().db, user.id);
  const allJoined = listJoinedOutings(getDb().db, user.id);
  const remote = listRemoteOutings(getDb().db, user.id);
  // Archives (#1459) : par personne ; une sortie passée est archivée d'office, sauf choix contraire.
  const overrides = archiveOverrides(getDb().db, user.id);
  const mine = [...allUpcoming, ...allPast];
  const upcoming = allUpcoming.filter((o) => !isArchivedFor(overrides, o));
  const past = allPast.filter((o) => !isArchivedFor(overrides, o));
  const joined = allJoined.filter((o) => !isArchivedFor(overrides, o));
  const archivedMine = mine.filter((o) => isArchivedFor(overrides, o));
  const archivedJoined = allJoined.filter((o) => isArchivedFor(overrides, o));
  const archivedCount = archivedMine.length + archivedJoined.length;
  const t = await getTranslations('outings');
  const ts = await getTranslations('share');
  const tr = await getTranslations('remoteOutings');
  const locale = await getLocale();
  const feedUrl = `${await pageOrigin()}/cal/${getCalendarFeedToken(getDb().db, user.id)}/calendar.ics`;
  return (
    <>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:pt-16 pb-[calc(var(--spacing-nav)+2rem+env(safe-area-inset-bottom))] lg:pl-[calc(var(--spacing-rail)+1rem)]">
        <PageHeader title={t('title')} />
        {upcoming.length === 0 && past.length === 0 && joined.length === 0 && archivedCount === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t('emptyTitle')}
            action={<Button asChild size="lg"><Link href="/">{t('chooseTrack')}</Link></Button>}
          >
            {t('emptyBody')}
          </EmptyState>
        ) : (
          <>
            <section aria-label={t('upcoming')} className="flex flex-col gap-3">
              <h2 className="text-heading">{t('upcoming')}</h2>
              {upcoming.length ? <ul className="flex flex-col gap-3">{upcoming.map((o) => <OutingCard key={o.id} o={o} locale={locale} />)}</ul> : <p className="text-muted-foreground">{t('nothing')}</p>}
            </section>
            {past.length > 0 && (
              <section aria-label={t('past')} className="flex flex-col gap-3">
                <h2 className="text-heading">{t('past')}</h2>
                <ul className="flex flex-col gap-3">{past.map((o) => <OutingCard key={o.id} o={o} locale={locale} />)}</ul>
              </section>
            )}
          </>
        )}
        {joined.length > 0 && (
          <section aria-label={t('joinedTitle')} className="flex flex-col gap-3">
            <h2 className="text-heading">{t('joinedTitle')}</h2>
            <ul className="flex flex-col gap-3">{joined.map((o) => <JoinedCard key={o.id} o={o} locale={locale} t={t} past={isPastOuting(o)} />)}</ul>
          </section>
        )}
        {remote.length > 0 && (
          <section aria-label={tr('title')} className="flex flex-col gap-3">
            <h2 className="text-heading">{tr('title')}</h2>
            <ul className="flex flex-col gap-3">{remote.map((o) => <RemoteCard key={o.id} o={o} locale={locale} />)}</ul>
          </section>
        )}
        <section aria-label={t('openTitle')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('openTitle')}</h2>
          {open.length ? <ul className="flex flex-col gap-3">{open.map((o) => <OpenOutingCard key={o.id} o={o} locale={locale} />)}</ul> : <p className="text-muted-foreground">{t('openEmpty')}</p>}
        </section>
        {archivedCount > 0 && (
          <details className="group rounded-2xl border border-border bg-card p-4 shadow-sm">
            <summary className="flex min-h-touch cursor-pointer items-center justify-between text-heading">{t('archivesTitle', { n: archivedCount })}<ChevronRight aria-hidden className="size-5 text-muted-foreground transition-transform duration-150 group-open:rotate-90" /></summary>
            <ul className="mt-3 flex flex-col gap-3">
              {archivedMine.map((o) => <OutingCard key={o.id} o={o} locale={locale} archived />)}
              {archivedJoined.map((o) => <JoinedCard key={o.id} o={o} locale={locale} t={t} archived />)}
            </ul>
          </details>
        )}
        <Button asChild variant="outline"><Link href="/sorties/historique"><History aria-hidden /> {t('history')}</Link></Button>
        <Button asChild variant="outline"><Link href="/sorties/potes"><Users aria-hidden /> {t('book')}</Link></Button>
        {(upcoming.length > 0 || past.length > 0) && (
          <section aria-label={ts('feedOrganizerTitle')} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <CalendarSubscribe feedUrl={feedUrl} organizer />
          </section>
        )}
      </main>
      <AppNav />
    </>
  );
}
