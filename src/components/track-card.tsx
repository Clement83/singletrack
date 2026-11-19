import Link from 'next/link';
import { CalendarDays, ChevronRight, Mountain, PencilLine, Repeat, Route, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Badge, DifficultyBadge } from '@/components/ui/badge';
import { TrackVisibilityBadge, type TrackVisibilityValue } from '@/components/tracks/track-visibility';
import { Skeleton } from '@/components/ui/skeleton';
import type { Difficulty } from '@/lib/design/scales';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';

type Props = {
  /** Link of the card; or `onSelect`: the card becomes a button (e.g. open the track in the panel, #1582). */
  href?: string;
  onSelect?: () => void;
  title: string;
  distanceKm: number;
  /** `null`: gain not computed yet (IGN elevation on first opening, #1428). */
  elevationM: number | null;
  difficulty?: Difficulty;
  loop?: boolean;
  /** Source attribution ("OpenStreetMap", "UtagawaVTT"…). */
  source?: string;
  /** For an outing: start date and number of confirmed participants. */
  date?: Date;
  going?: number;
  /** Draft (#1450): "Draft" badge; an empty title becomes "Untitled". */
  draft?: boolean;
  /** #1590: visibility, to provide only for one's own tracks. */
  visibility?: TrackVisibilityValue;
  className?: string;
};

/** A track or an outing in a list (on mobile: lists of cards, no table). */
export function TrackCard({ href, onSelect, title, distanceKm, elevationM, difficulty, loop, source, date, going, draft, visibility, className }: Props) {
  const t = useTranslations('trackCard');
  const locale = useLocale();
  const cls = cn(
    'flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left text-card-foreground shadow-sm transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60',
    className,
  );
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {date && (
          <p className="flex items-center gap-1.5 text-small font-semibold text-primary">
            <CalendarDays aria-hidden className="size-4" />
            {formatOutingDate(date, locale)}
          </p>
        )}
        <p className="truncate text-heading text-balance">{title || t('untitled')}</p>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body tabular-nums">
          <span className="flex items-center gap-1.5">
            <Route aria-hidden className="size-4 text-muted-foreground" />
            {formatKm(distanceKm, locale)}
          </span>
          <span className="flex items-center gap-1.5">
            <Mountain aria-hidden className="size-4 text-muted-foreground" />
            {elevationM == null ? t('gainUnknown') : formatElevation(elevationM, locale)}
          </span>
          {going !== undefined && (
            <span className="flex items-center gap-1.5">
              <Users aria-hidden className="size-4 text-muted-foreground" />
              {t('going', { n: going })}
            </span>
          )}
        </p>
        {(difficulty || loop || source || draft || visibility) && (
          <div className="flex flex-wrap items-center gap-2">
            {draft && (
              <Badge variant="outline">
                <PencilLine aria-hidden />
                {t('draft')}
              </Badge>
            )}
            {visibility && <TrackVisibilityBadge value={visibility} />}
            {difficulty && <DifficultyBadge level={difficulty} />}
            {loop && (
              <Badge>
                <Repeat aria-hidden />
                {t('loop')}
              </Badge>
            )}
            {source && <span className="text-small text-muted-foreground">{t('source', { source })}</span>}
          </div>
        )}
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />
    </>
  );
  return onSelect ? (
    <button type="button" onClick={onSelect} className={cn(cls, 'w-full')}>
      {body}
    </button>
  ) : (
    <Link href={href ?? '#'} className={cls}>
      {body}
    </Link>
  );
}

/** TrackCard skeleton, for loading lists. */
export function TrackCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3.5" aria-hidden>
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-7 w-24 rounded-full" />
    </div>
  );
}
