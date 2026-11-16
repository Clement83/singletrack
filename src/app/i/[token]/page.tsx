import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Navigation } from 'lucide-react';
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
import { OutingBadges } from '@/components/outings/outing-badges';
import { HeaderShareButton, OutingShare } from '@/components/outings/outing-share';
import { TrackDetail } from '@/components/tracks/track-detail';
import { Button } from '@/components/ui/button';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { getCurrentUser } from '@/lib/current-user';
import { fireInfo, massifsForGeometry, parisDate } from '@/lib/fire';
import { canUploadRide, directionsUrl, getInvitationByToken, isClosed, listInvitableFriends, outingPermissions, listPhotos, listRides, profileFor, listParticipants } from '@/lib/outings';
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
  const end = (snap.geometry.type === 'LineString' ? snap.geometry.coordinates : snap.geometry.coordinates.flat()).at(-1)!;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pt-5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
      {o.status === 'cancelled' && (
        <p role="status" className="rounded-2xl bg-destructive-soft p-3 font-semibold text-destructive">{tg('cancelled')}</p>
      )}
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-title">{o.title}</h1>
          {groupPath && <HeaderShareButton sharePath={groupPath} shareText={shareText} title={o.title} />}
        </div>
        <p className="text-heading">{formatOutingDate(o.startsAt, locale)}</p>
        <OutingBadges level={o.level} ebike={o.ebike} />
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-small text-muted-foreground">{tg('meeting', { place: o.meetingLabel ?? t('meetingFallback') })}</p>
          <Button asChild variant="outline">
            <a href={directionsUrl(o.meetingLat, o.meetingLon)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> {tg('directions')}</a>
          </Button>
        </div>
      </header>

      {full ? (
        <p role="status" className="rounded-2xl bg-warning-soft p-3 font-semibold text-warning">{tg('full', { max: o.maxParticipants ?? 0 })}</p>
      ) : null}
      {closed && o.status !== 'cancelled' && <p className="text-muted-foreground">{tg('past')}</p>}
      <GuestResponse token={token} name={inv.name} status={inv.status} comment={inv.comment ?? ''} locked={closed} />

      <section aria-label={tg('trackRegion')} className="flex flex-col gap-3">
        <h2 className="text-heading">{snap.name}</h2>
        <p className="text-small text-muted-foreground">
          {formatKm(snap.distanceM / 1000, locale)}
          {snap.elevationGainM != null ? ` · ${formatElevation(snap.elevationGainM, locale)}` : ''}
        </p>
        <TrackDetail geometry={snap.geometry} bbox={snap.bbox} start={snap.start} end={[end[0], end[1]]} profile={profileFor(snap.geometry)} />
        {(snap.attribution || snap.license) && (
          <p className="text-caption text-muted-foreground">{[snap.attribution, snap.license && tg('license', { license: snap.license })].filter(Boolean).join(' · ')}</p>
        )}
      </section>

      {o.description && <p className="whitespace-pre-line">{o.description}</p>}

      <ConditionsBlock
        weather={await outingWeather(o, estimateDurationMin(snap.distanceM, snap.elevationGainM))}
        // Incendie et chasse : sources du Var seulement (#1428), « non disponible » ailleurs.
        outsideVar={!fireApplies(o.meetingLon, o.meetingLat) && !huntingApplies(o.meetingLon, o.meetingLat)}
        fireInfo={fireApplies(o.meetingLon, o.meetingLat) ? fireInfo(db, massifsForGeometry(db, snap.geometry), parisDate(o.startsAt)) : undefined}
        hunting={huntingApplies(o.meetingLon, o.meetingLat) ? huntingInfo(parisDate(o.startsAt)) : undefined}
      />

      <OutingParticipants participants={participants} max={o.maxParticipants} />

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

      {inv.status === 'yes' && (
        <RideSection
          base={`/api/i/${token}/ride`}
          rides={listRides(db, o.id, { kind: 'guest', invitationId: inv.id })}
          planned={{ geometry: snap.geometry, bbox: snap.bbox, distanceM: snap.distanceM, gainM: snap.elevationGainM ?? null }}
          canUpload={canUploadRide(o)}
        />
      )}

      {inv.status === 'yes' && (
        <PhotoSection
          base={`/api/i/${token}/photos`}
          photos={listPhotos(db, o.id, { kind: 'guest', invitationId: inv.id })}
          planned={{ geometry: snap.geometry, bbox: snap.bbox }}
          canUpload={canUploadRide(o)}
        />
      )}

      {viewer && !closed && outingPermissions(db, { userId: viewer.id }, o).canInviteFriends && (
        <InviteFriends endpoint={`/api/i/${token}/friends`} friends={listInvitableFriends(db, viewer.id, o)} />
      )}

      {claimState && <GuestClaim token={token} state={claimState} />}

      <OutingComments base={`/api/i/${token}/comments`} closed={closed} />
    </main>
  );
}
