'use client';

import { useTranslations } from 'next-intl';
import { CalendarPlus, Copy, Download, Navigation, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CalendarSubscribe } from '@/components/outings/calendar-subscribe';
import { MAP_APPS, directionsLinks } from '@/lib/outings/share';

type Props = {
  /** Path of the link to share (e.g. open link `/s/<token>/join`); absent = no "Share" button. */
  sharePath?: string | null;
  /** Pre-formatted message ("🚵 Sortie VTT <title> — <date>"), already translated on the server. */
  shareText: string;
  title: string;
  icsHref: string;
  gpxHref: string;
  lat: number;
  lon: number;
  /** Choice of maps app; hidden when the page already has its "Directions" button. */
  showDirections?: boolean;
  /** https URL of the guest's subscription feed (#1357); absent = no subscription block. */
  feedUrl?: string;
  /** Help text under the "Share" button (or instead of it when there is no link). */
  hint?: string;
};

type ShareArgs = {
  sharePath: string;
  shareText: string;
  title?: string;
  t: (key: 'copied' | 'copyFailed') => string;
};

/** Native Web Share, "copy link" fallback (#1460). */
export async function shareLink({ sharePath, title, shareText, t }: ShareArgs) {
  const url = `${window.location.origin}${sharePath}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text: shareText, url });
    } catch {
      /* share cancelled: nothing to do */
    }
    return;
  }
  await copyLink({ sharePath, shareText, t });
}

async function copyLink({ sharePath, shareText, t }: ShareArgs) {
  try {
    await navigator.clipboard.writeText(`${shareText}\n${window.location.origin}${sharePath}`);
    toast.success(t('copied'));
  } catch {
    toast.error(t('copyFailed'));
  }
}

/** Header "Share" icon, mobile only (#1460): shares the group link when it is active. */
export function HeaderShareButton({ sharePath, shareText, title }: { sharePath: string; shareText: string; title: string }) {
  const t = useTranslations('share');
  return (
    <Button variant="outline" size="icon" className="shrink-0 lg:hidden" aria-label={t('headerShare')} onClick={() => void shareLink({ sharePath, title, shareText, t })}>
      <Share2 aria-hidden />
    </Button>
  );
}

/**
 * Share and prepare an outing (#1351): native share (Web Share, "copy link" fallback), calendar (.ics),
 * GPX of the frozen track, directions to the meeting point in the chosen maps app. Secondary actions: on the guest
 * page, the GO button stays the main action.
 */
export function OutingShare({ sharePath, shareText, title, icsHref, gpxHref, lat, lon, showDirections = true, feedUrl, hint }: Props) {
  const t = useTranslations('share');
  const links = directionsLinks(lat, lon);

  const share = () => shareLink({ sharePath: sharePath!, title, shareText, t });
  const copy = () => copyLink({ sharePath: sharePath!, shareText, t });

  return (
    <section aria-labelledby="share-title" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 id="share-title" className="text-heading">{t('title')}</h2>
      {sharePath && (
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => void share()}>
            <Share2 aria-hidden /> {t('share')}
          </Button>
          <Button variant="outline" className="shrink-0" onClick={() => void copy()} aria-label={t('copyLink')}>
            <Copy aria-hidden />
          </Button>
        </div>
      )}
      {hint && <p className="text-small text-muted-foreground text-pretty">{hint}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button asChild variant="outline">
          <a href={icsHref} download>
            <CalendarPlus aria-hidden /> {t('calendar')}
          </a>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="flex-1">
            <a href={gpxHref} download>
              <Download aria-hidden /> {t('gpx')}
            </a>
          </Button>
          <Button asChild variant="outline" className="shrink-0">
            <a href={gpxHref.replace(/\/gpx$/, '/kml')} download aria-label={t('kmlLabel')}>
              {t('kml')}
            </a>
          </Button>
        </div>
      </div>
      {feedUrl && <CalendarSubscribe feedUrl={feedUrl} />}
      {showDirections && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-small font-medium">
            <Navigation aria-hidden className="size-4" /> {t('directions')}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {MAP_APPS.map((app) => (
              <Button key={app} asChild variant="outline" className="px-2 text-small leading-tight whitespace-normal">
                <a href={links[app]} target="_blank" rel="noopener noreferrer">
                  {t(`apps.${app}`)}
                </a>
              </Button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
