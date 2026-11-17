import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { track, user as userTable } from '@/db/schema';
import { canViewTrack } from '@/lib/tracks/query';
import { getLocale, getTranslations } from 'next-intl/server';
import { ConditionsBlock } from '@/components/conditions-block';
import { PhotoSection } from '@/components/outings/photo-section';
import { RideSection } from '@/components/outings/ride-section';
import { OutingComments } from '@/components/outings/outing-comments';
import { OutingParticipants } from '@/components/outings/outing-participants';
import { OutingManager } from '@/components/outings/outing-manager';
import { InviteFriends } from '@/components/outings/invite-friends';
import { HeaderShareButton, OutingShare } from '@/components/outings/outing-share';
import { requireUser } from '@/lib/current-user';
import { OutingView } from '@/components/outings/outing-view';
import { formatKm } from '@/lib/format';
import { fireInfo, massifsForGeometry, parisDate } from '@/lib/fire';
import { transferCandidates, isFrozen, outingPermissions, canUploadRide, getManagedOuting, isClosed, listInvitableFriends, isDone, listContacts, listPhotos, listRides, listInvitations, listParticipants, reinviteCandidates } from '@/lib/outings';
import { formatShareDate } from '@/lib/outings/export';
import { estimateDurationMin } from '@/lib/tracks/duration';
import { outingWeather } from '@/lib/weather';
import { huntingInfo } from '@/lib/hunting';
import { fireApplies, huntingApplies } from '@/lib/osm/zones';

export const dynamic = 'force-dynamic';
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('outingPage'))('metaTitle'), robots: { index: false, follow: false } };
}

// Page « organisateur » (#1341) : réservée au connecté qui a créé la sortie ; 404 pour tout autre.
// Les invités passent par /i/<token>, jamais par ici.
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ reinviter?: string }> }) {
  const user = await requireUser();
  const { db } = getDb();
  const o = getManagedOuting(db, user.id, (await params).slug);
  if (!o) notFound();
  const from = (await searchParams).reinviter;
  const reinvite = from ? reinviteCandidates(db, user.id, from) : { contactIds: [], names: [] };
  const locale = await getLocale();
  const t = await getTranslations('share');
  const tp = await getTranslations('outingPage');
  const perms = outingPermissions(db, { userId: user.id }, o);
  const invitations = listInvitations(db, o.id).map((i) => ({
    id: i.id, contactId: i.contactId, name: i.name, status: i.status, comment: i.comment, origin: i.origin, linked: !!i.userId,
    revoked: !!i.revokedAt, shareable: perms.canRevoke(i), respondedAt: i.respondedAt?.toISOString() ?? null,
  }));
  const snap = o.trackSnapshot;
  // #1592 : lien vers la trace d'origine seulement si ce lecteur a le droit de la voir (sinon parcours figé sans lien).
  const origin = o.trackId ? db.select().from(track).where(eq(track.id, o.trackId)).get() : undefined;
  const canOpenTrack = !!origin && canViewTrack(db, origin, user.id) && origin.slug === snap.slug;
  const proposer = o.createdBy ? db.select({ name: userTable.name }).from(userTable).where(eq(userTable.id, o.createdBy)).get()?.name : undefined;
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-4 pb-12">
      <Link href="/sorties" className="flex min-h-touch items-center gap-2 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
        <ArrowLeft aria-hidden className="size-5" /> {tp('back')}
      </Link>
      <OutingView
        role="organizer"
        presentation="page"
        outing={{ ...o, cancelled: o.status === 'cancelled', done: isDone(o) }}
        track={snap}
        headerAction={o.openLinkEnabled && o.openLinkToken ? (
          <HeaderShareButton sharePath={`/s/${o.openLinkToken}/join`} shareText={t('message', { title: o.title, date: formatShareDate(o.startsAt, locale) })} title={o.title} />
        ) : undefined}
        notices={isFrozen(o) ? (
          <>
            {proposer && <p className="text-small text-muted-foreground">{tp('proposedBy', { name: proposer })}</p>}
            <p className="rounded-2xl bg-muted px-4 py-3 text-small">{tp('publicNotice')}</p>
          </>
        ) : undefined}
        trackNote={
          <p className="text-small text-muted-foreground">
            {tp.rich(canOpenTrack ? 'track' : 'trackFrozen', {
              name: snap.name,
              km: formatKm(snap.distanceM / 1000, locale),
              date: new Date(snap.takenAt).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris' }),
              link: (chunks) => <Link href={`/t/${snap.slug}`} className="font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">{chunks}</Link>,
            })}
          </p>
        }
        conditions={
      <ConditionsBlock
        weather={await outingWeather(o, estimateDurationMin(snap.distanceM, snap.elevationGainM))}
        // Incendie et chasse : sources du Var seulement (#1428), « non disponible » ailleurs.
        outsideVar={!fireApplies(o.meetingLon, o.meetingLat) && !huntingApplies(o.meetingLon, o.meetingLat)}
        fireInfo={fireApplies(o.meetingLon, o.meetingLat) ? fireInfo(db, massifsForGeometry(db, snap.geometry), parisDate(o.startsAt)) : undefined}
        hunting={huntingApplies(o.meetingLon, o.meetingLat) ? huntingInfo(parisDate(o.startsAt)) : undefined}
      />
        }
        participants={
      <OutingParticipants participants={listParticipants(db, o.id, { userId: user.id })} max={o.maxParticipants} organizer />
        }
        secondaryActions={
          <>
        <OutingShare
          sharePath={o.openLinkEnabled && o.openLinkToken ? `/s/${o.openLinkToken}/join` : null}
          shareText={t('message', { title: o.title, date: formatShareDate(o.startsAt, locale) })}
          title={o.title}
          icsHref={`/api/outings/${o.slug}/ics`}
          gpxHref={`/api/outings/${o.slug}/gpx`}
          lat={o.meetingLat}
          lon={o.meetingLon}
          hint={o.openLinkEnabled ? t('shareHint') : t('noGroupLink')}
        />
        {!isClosed(o) && outingPermissions(db, { userId: user.id }, o).canInviteFriends && (
          <InviteFriends endpoint={`/api/outings/${o.slug}/friends`} friends={listInvitableFriends(db, user.id, o)} />
        )}
        <OutingManager
          outingId={o.id}
          isOwner={o.ownerId === user.id}
          candidates={o.ownerId === user.id ? transferCandidates(db, o.id, user.id) : []}
          frozen={isFrozen(o)}
          slug={o.slug}
          cancelled={o.status === 'cancelled'}
          done={o.status === 'done'}
          openLink={{ enabled: o.openLinkEnabled, token: o.openLinkToken }}
          invitations={invitations}
          contacts={listContacts(db, user.id).map((c) => ({ id: c.id, name: c.name, note: c.note }))}
          title={o.title}
          reinvite={reinvite}
        />
          </>
        }
        activity={
          <>
        <RideSection
          base={`/api/outings/${o.slug}/ride`}
          rides={listRides(db, o.id, { kind: 'organizer', userId: user.id })}
          planned={{ geometry: snap.geometry, bbox: snap.bbox, distanceM: snap.distanceM, gainM: snap.elevationGainM ?? null }}
          canUpload={canUploadRide(o)}
        />
        <PhotoSection
          base={`/api/outings/${o.slug}/photos`}
          photos={listPhotos(db, o.id, { kind: 'organizer', userId: user.id })}
          planned={{ geometry: snap.geometry, bbox: snap.bbox }}
          canUpload={canUploadRide(o)}
        />
          </>
        }
        comments={
      <OutingComments base={`/api/outings/${o.slug}/comments`} closed={isClosed(o)} />
        }
      />
    </main>
  );
}
