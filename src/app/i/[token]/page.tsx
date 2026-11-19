import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { eq } from 'drizzle-orm';
import { user as userTable } from '@/db/schema';
import { BackToMap } from '@/components/tracks/back-to-map';
import { ConditionsBlock, ConditionsLine, ConditionsSummary } from '@/components/conditions-block';
import { GuestClaim } from '@/components/outings/guest-claim';
import { InviteFriends } from '@/components/outings/invite-friends';
import { GuestAnswerBar, GuestProfile } from '@/components/outings/guest-response';
import { BarAction, OutingBar } from '@/components/outings/outing-bar';
import { PhotoSection } from '@/components/outings/photo-section';
import { RideSection } from '@/components/outings/ride-section';
import { OutingParticipants } from '@/components/outings/outing-participants';
import { HeaderShareButton, OutingShare } from '@/components/outings/outing-share';
import { OutingView } from '@/components/outings/outing-view';
import { NextStepCard } from '@/components/outings/next-step-card';
import { nextStep } from '@/lib/outings/next-step';
import { directionsUrl } from '@/lib/outings/labels';
import { getCurrentUser } from '@/lib/current-user';
import { fireInfo, massifsForGeometry, parisDate } from '@/lib/fire';
import { canUploadRide, getInvitationByToken, isClosed, listInvitableFriends, outingPermissions, listPhotos, listRides, listParticipants } from '@/lib/outings';
import { formatShareDate, pageOrigin } from '@/lib/outings/export';
import { estimateDurationMin } from '@/lib/tracks/duration';
import { outingWeather } from '@/lib/weather';
import { huntingInfo } from '@/lib/hunting';
import { fireApplies, huntingApplies } from '@/lib/osm/zones';

export const dynamic = 'force-dynamic';
// Personal link: never indexed, never cached by an intermediary.
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('guest'))('metaTitle'), robots: { index: false, follow: false } };
}

// Guest page (#1341): public, no account. Unknown or revoked token → generic 404.
// Mobile first: title, date, meeting point and GO button fit without scrolling at 375 px; the track comes below.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { db } = getDb();
  const token = (await params).token;
  const found = getInvitationByToken(db, token);
  if (!found) notFound();
  const locale = await getLocale();
  const t = await getTranslations('share');
  const tg = await getTranslations('guest');
  const tv = await getTranslations('outingView');
  const { invitation: inv, outing: o } = found;
  const snap = o.trackSnapshot;
  const viewer = await getCurrentUser();
  // Attachment (#1434): offered while the invitation has no account; the organiser does not attach to their own outing.
  const claimState = inv.userId ? (viewer && inv.userId === viewer.id ? 'mine' : null) : viewer ? (viewer.id === o.ownerId ? null : 'available') : 'anonymous';
  const closed = isClosed(o);
  const organizerName = o.ownerId ? db.select({ name: userTable.name }).from(userTable).where(eq(userTable.id, o.ownerId)).get()?.name : undefined;
  const weather = await outingWeather(o, estimateDurationMin(snap.distanceM, snap.elevationGainM));
  const fireInfoValue = fireApplies(o.meetingLon, o.meetingLat) ? fireInfo(db, massifsForGeometry(db, snap.geometry), parisDate(o.startsAt)) : undefined;
  const participants = listParticipants(db, o.id, { invitationId: inv.id, userId: viewer?.id });
  const yes = participants.filter((p) => p.status === 'yes' && !p.isOrganizer).length;
  const full = o.maxParticipants != null && yes >= o.maxParticipants && inv.status !== 'yes';
  const groupPath = o.openLinkEnabled && o.openLinkToken ? `/s/${o.openLinkToken}/join` : null;
  const photos = listPhotos(db, o.id, { kind: 'guest', invitationId: inv.id });
  const step = nextStep({ role: 'guest', answer: inv.status, past: closed, organizerName, meetingLabel: o.meetingLabel, startsAt: o.startsAt, now: new Date(), photoCount: photos.length, locale });
  const shareText = t('message', { title: o.title, date: formatShareDate(o.startsAt, locale) });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <OutingView
        role="guest"
        presentation="page"
        outing={{ ...o, cancelled: o.status === 'cancelled' }}
        track={snap}
        organizerName={organizerName}
        topLink={<BackToMap className="flex min-h-touch items-center gap-1 text-body font-medium text-primary underline-offset-4 hover:underline active:opacity-70"><ChevronLeft aria-hidden className="size-5" /> {tv('back')}</BackToMap>}
        conditionsLine={<ConditionsLine weather={weather} fireInfo={fireInfoValue} />}
        headerAction={groupPath ? <HeaderShareButton sharePath={groupPath} shareText={shareText} title={o.title} /> : undefined}
        notices={
          <>
            {o.status === 'cancelled' && (
              <p role="status" className="rounded-lg bg-destructive-soft px-3 py-2.5 text-small font-medium text-destructive">{tg('cancelled')}</p>
            )}
            {full && <p role="status" className="rounded-lg bg-warning-soft px-3 py-2.5 text-small font-medium text-warning">{tg('full', { max: o.maxParticipants ?? 0 })}</p>}
            {closed && o.status !== 'cancelled' && <p className="text-muted-foreground">{tg('past')}</p>}
          </>
        }
        nextStep={o.status === 'cancelled' ? undefined : <NextStepCard step={step} directionsHref={directionsUrl(o.meetingLat, o.meetingLon)} />}
        conditionsSummary={<ConditionsSummary weather={weather} fireInfo={fireInfoValue} />}
        conditions={
          <ConditionsBlock
            weather={weather}
            // Fire and hunting: Var-only sources (#1428), "not available" elsewhere.
            outsideVar={!fireApplies(o.meetingLon, o.meetingLat) && !huntingApplies(o.meetingLon, o.meetingLat)}
            fireInfo={fireInfoValue}
            hunting={huntingApplies(o.meetingLon, o.meetingLat) ? huntingInfo(parisDate(o.startsAt)) : undefined}
          />
        }
        participants={<OutingParticipants inline participants={participants} max={o.maxParticipants} />}
        secondaryActions={
          <>
            <OutingShare
              sharePath={groupPath}
              hint={groupPath ? t('shareHint') : undefined}
              shareText={shareText}
              title={o.title}
              icsHref={`/api/i/${token}/ics`}
              feedUrl={`${await pageOrigin()}/i/${token}/calendar.ics`}
              gpxHref={`/api/i/${token}/gpx`}
              lat={o.meetingLat}
              lon={o.meetingLon}
              showDirections={false}
            />
            {viewer && !closed && outingPermissions(db, { userId: viewer.id }, o).canInviteFriends && (
              <InviteFriends endpoint={`/api/i/${token}/friends`} friends={listInvitableFriends(db, viewer.id, o)} />
            )}
            <GuestProfile token={token} name={inv.name} comment={inv.comment ?? ''} locked={closed} />
            {claimState && <GuestClaim token={token} state={claimState} />}
          </>
        }
        activity={
          inv.status === 'yes' || (closed && photos.length > 0) ? (
            <>
              <RideSection
                base={`/api/i/${token}/ride`}
                rides={listRides(db, o.id, { kind: 'guest', invitationId: inv.id })}
                planned={{ geometry: snap.geometry, bbox: snap.bbox, distanceM: snap.distanceM, gainM: snap.elevationGainM ?? null }}
                canUpload={canUploadRide(o)}
              />
              <PhotoSection
                base={`/api/i/${token}/photos`}
                photos={photos}
                planned={{ geometry: snap.geometry, bbox: snap.bbox }}
                canUpload={canUploadRide(o)}
              />
            </>
          ) : undefined
        }
        bar={
          <OutingBar discussion={{ id: o.id, base: `/api/i/${token}/comments`, closed }}>
            {o.status === 'cancelled' ? null : closed ? (
              <BarAction kind={inv.status === 'yes' ? 'addRide' : 'seePhotos'} />
            ) : (
              <GuestAnswerBar token={token} status={inv.status} />
            )}
          </OutingBar>
        }
      />
    </main>
  );
}
