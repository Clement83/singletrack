import { Navigation } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { OutingBadges } from '@/components/outings/outing-badges';
import { TrackDetail } from '@/components/tracks/track-detail';
import { Button } from '@/components/ui/button';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { directionsUrl } from '@/lib/outings/labels';
import { profileFor } from '@/lib/outings/profile';
import type { TrackSnapshot } from '@/lib/outings/snapshot';
import type { OutingRow } from '@/db/schema';

export type OutingViewRole = 'organizer' | 'guest' | 'visitor' | 'anonymous';

export type OutingViewOuting = Pick<OutingRow, 'title' | 'startsAt' | 'level' | 'ebike' | 'meetingLabel' | 'meetingLat' | 'meetingLon' | 'description'> & {
  visibility?: OutingRow['visibility'];
  cancelled?: boolean;
  done?: boolean;
};

type Props = {
  /** Qui regarde : ne change que les actions (passées en slots), jamais le visuel. */
  role: OutingViewRole;
  /** `page` = page complète ; `panel` = panneau de la carte (sans conditions, roulées, photos, commentaires ni carte embarquée). */
  presentation: 'page' | 'panel';
  outing: OutingViewOuting;
  track: TrackSnapshot;
  /** Lien de retour, au-dessus de l'en-tête. */
  topLink?: React.ReactNode;
  /** Bouton à droite du titre (partage du lien de groupe). */
  headerAction?: React.ReactNode;
  /** Bandeaux d'état sous les badges (sortie publique figée, annulée, complète, passée). */
  notices?: React.ReactNode;
  /** Action principale : Répondre / Gérer / Rejoindre / Se connecter. */
  primaryAction?: React.ReactNode;
  /** Phrase sous le titre du parcours (trace d'origine, attribution). */
  trackNote?: React.ReactNode;
  conditions?: React.ReactNode;
  participants?: React.ReactNode;
  /** Partage, inviter des copains, gestion. */
  secondaryActions?: React.ReactNode;
  /** Sorties roulées et photos. */
  activity?: React.ReactNode;
  comments?: React.ReactNode;
};

/**
 * Vue unique d'une sortie (#1597) : mêmes blocs, même ordre partout. Le composant ne fait aucun appel réseau ;
 * l'appelant décide des actions selon `outingPermissions` et les passe dans les emplacements.
 * Ordre : en-tête → action principale → RDV + itinéraire → description → parcours → conditions → qui vient
 * → actions secondaires → roulées / photos → commentaires.
 */
export function OutingView({ role, presentation, outing: o, track: snap, topLink, headerAction, notices, primaryAction, trackNote, conditions, participants, secondaryActions, activity, comments }: Props) {
  const locale = useLocale();
  const t = useTranslations('share');
  const tg = useTranslations('guest');
  const panel = presentation === 'panel';
  const end = (snap.geometry.type === 'LineString' ? snap.geometry.coordinates : snap.geometry.coordinates.flat()).at(-1)!;
  return (
    <div data-outing-view={presentation} data-role={role} className="flex flex-col gap-5">
      {topLink}
      <header className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-title">{o.title}</h1>
          {headerAction}
        </div>
        <p className="text-heading">{formatOutingDate(o.startsAt, locale)}</p>
        <OutingBadges visibility={o.visibility} level={o.level} ebike={o.ebike} cancelled={o.cancelled} done={o.done} />
        {notices}
      </header>

      {primaryAction}

      <section aria-label={tg('meetingRegion')} className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-small text-muted-foreground">{tg('meeting', { place: o.meetingLabel ?? t('meetingFallback') })}</p>
        <Button asChild variant="outline">
          <a href={directionsUrl(o.meetingLat, o.meetingLon)} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden /> {tg('directions')}</a>
        </Button>
      </section>

      {o.description && <p className="whitespace-pre-line break-words">{o.description}</p>}

      <section aria-label={tg('trackRegion')} className="flex flex-col gap-3">
        <h2 className="text-heading">{snap.name}</h2>
        <p className="text-small text-muted-foreground">
          {formatKm(snap.distanceM / 1000, locale)}
          {snap.elevationGainM != null ? ` · ${formatElevation(snap.elevationGainM, locale)}` : ''}
        </p>
        {trackNote}
        {!panel && <TrackDetail geometry={snap.geometry} bbox={snap.bbox} start={snap.start} end={[end[0], end[1]]} profile={profileFor(snap.geometry)} />}
        {(snap.attribution || snap.license) && (
          <p className="text-caption text-muted-foreground">{[snap.attribution, snap.license && tg('license', { license: snap.license })].filter(Boolean).join(' · ')}</p>
        )}
      </section>

      {!panel && conditions}
      {participants}
      {!panel && secondaryActions}
      {!panel && activity}
      {!panel && comments}
    </div>
  );
}
