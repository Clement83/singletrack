import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { ConditionsBlock } from '@/components/conditions-block';
import { GuestClaim } from '@/components/outings/guest-claim';
import { InviteFriends } from '@/components/outings/invite-friends';
import { GuestResponse } from '@/components/outings/guest-response';
import { OutingComments } from '@/components/outings/outing-comments';
import { PhotoSection } from '@/components/outings/photo-section';
import { RideSection } from '@/components/outings/ride-section';
import { OutingParticipants } from '@/components/outings/outing-participants';
import { HeaderShareButton, OutingShare } from '@/components/outings/outing-share';
import { OutingView } from '@/components/outings/outing-view';
import { getCurrentUser } from '@/lib/current-user';
import { fireInfo, massifsForGeometry, parisDate } from '@/lib/fire';
import { canUploadRide, getInvitationByToken, isClosed, listInvitableFriends, outingPermissions, listPhotos, listRides, listParticipants } from '@/lib/outings';
import { formatShareDate, pageOrigin } from '@/lib/outings/export';
import { estimateDurationMin } from '@/lib/tracks/duration';
import { outingWeather } from '@/lib/weather';
import { huntingInfo } from '@/lib/hunting';
import { fireApplies, huntingApplies } from '@/lib/osm/zones';

export const dynamic = 'force-dynamic';
// Lien personnel : jamais indexé, jamais mis en cache par un intermédiaire.
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('guest'))('metaTitle'), robots: { index: false, follow: false } };
}

// Page invité (#1341) : publique, sans compte. Token inconnu ou révoqué → 404 générique.
// Mobile first : titre, date, RDV et bouton GO tiennent sans scroller à 375 px ; la trace vient dessous.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { db } = getDb();
  const token = (await params).token;
  const found = getInvitationByToken(db, token);
  if (!found) notFound();
  const locale = await getLocale();
  const t = await getTranslations('share');
  const tg = await getTranslations('guest');
  const { invitation: inv, outing: o } = found;
  const snap = o.trackSnapshot;
  const viewer = await getCurrentUser();
  // Rattachement (#1434) : proposé tant que l'invitation n'a pas de compte ; l'organisateur n'a pas à se rattacher à sa propre sortie.
  const claimState = inv.userId ? (viewer && inv.userId === viewer.id ? 'mine' : null) : viewer ? (viewer.id === o.ownerId ? null : 'available') : 'anonymous';
  const closed = isClosed(o);
  const participants = listParticipants(db, o.id, { invitationId: inv.id, userId: viewer?.id });
  const yes = participants.filter((p) => p.status === 'yes' && !p.isOrganizer).length;
  const full = o.maxParticipants != null && yes >= o.maxParticipants && inv.status !== 'yes';
  const groupPath = o.openLinkEnabled && o.openLinkToken ? `/s/${o.openLinkToken}/join` : null;
  const shareText = t('message', { title: o.title, date: formatShareDate(o.startsAt, locale) });

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <OutingView
        role="guest"
        presentation="page"
        outing={{ ...o, cancelled: o.status === 'cancelled' }}
        track={snap}
        headerAction={groupPath ? <HeaderShareButton sharePath={groupPath} shareText={shareText} title={o.title} /> : undefined}
        notices={
          <>
            {o.status === 'cancelled' && (
              <p role="status" className="rounded-2xl bg-destructive-soft p-3 font-semibold text-destructive">{tg('cancelled')}</p>
            )}
            {full && <p role="status" className="rounded-2xl bg-warning-soft p-3 font-semibold text-warning">{tg('full', { max: o.maxParticipants ?? 0 })}</p>}
            {closed && o.status !== 'cancelled' && <p className="text-muted-foreground">{tg('past')}</p>}
          </>
        }
        primaryAction={<GuestResponse token={token} name={inv.name} status={inv.status} comment={inv.comment ?? ''} locked={closed} />}
        conditions={
          <ConditionsBlock
            weather={await outingWeather(o, estimateDurationMin(snap.distanceM, snap.elevationGainM))}
            // Incendie et chasse : sources du Var seulement (#1428), « non disponible » ailleurs.
            outsideVar={!fireApplies(o.meetingLon, o.meetingLat) && !huntingApplies(o.meetingLon, o.meetingLat)}
            fireInfo={fireApplies(o.meetingLon, o.meetingLat) ? fireInfo(db, massifsForGeometry(db, snap.geometry), parisDate(o.startsAt)) : undefined}
            hunting={huntingApplies(o.meetingLon, o.meetingLat) ? huntingInfo(parisDate(o.startsAt)) : undefined}
          />
        }
        participants={<OutingParticipants participants={participants} max={o.maxParticipants} />}
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
            {claimState && <GuestClaim token={token} state={claimState} />}
          </>
        }
        activity={
          inv.status === 'yes' ? (
            <>
              <RideSection
                base={`/api/i/${token}/ride`}
                rides={listRides(db, o.id, { kind: 'guest', invitationId: inv.id })}
                planned={{ geometry: snap.geometry, bbox: snap.bbox, distanceM: snap.distanceM, gainM: snap.elevationGainM ?? null }}
                canUpload={canUploadRide(o)}
              />
              <PhotoSection
                base={`/api/i/${token}/photos`}
                photos={listPhotos(db, o.id, { kind: 'guest', invitationId: inv.id })}
                planned={{ geometry: snap.geometry, bbox: snap.bbox }}
                canUpload={canUploadRide(o)}
              />
            </>
          ) : undefined
        }
        comments={<OutingComments base={`/api/i/${token}/comments`} closed={closed} />}
      />
    </main>
  );
}
