'use client';

import { useTranslations } from 'next-intl';
import { CalendarPlus, Copy, Download, Navigation, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CalendarSubscribe } from '@/components/outings/calendar-subscribe';
import { MAP_APPS, directionsLinks } from '@/lib/outings/share';

type Props = {
  /** Chemin du lien à partager (ex. lien ouvert `/s/<token>/join`) ; absent = pas de bouton « Partager ». */
  sharePath?: string | null;
  /** Message préformaté (« 🚵 Sortie VTT <titre> — <date> »), déjà traduit côté serveur. */
  shareText: string;
  title: string;
  icsHref: string;
  gpxHref: string;
  lat: number;
  lon: number;
  /** Choix de l'appli de cartes ; masqué quand la page a déjà son bouton « Itinéraire ». */
  showDirections?: boolean;
  /** URL https du flux d'abonnement de l'invité (#1357) ; absent = pas de bloc d'abonnement. */
  feedUrl?: string;
  /** Texte d'aide sous le bouton « Partager » (ou à sa place s'il n'y a pas de lien). */
  hint?: string;
};

type ShareArgs = {
  sharePath: string;
  shareText: string;
  title?: string;
  t: (key: 'copied' | 'copyFailed') => string;
};

/** Web Share natif, repli « copier le lien » (#1460). */
export async function shareLink({ sharePath, title, shareText, t }: ShareArgs) {
  const url = `${window.location.origin}${sharePath}`;
  if (navigator.share) {
    try {
      await navigator.share({ title, text: shareText, url });
    } catch {
      /* partage annulé : rien à faire */
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

/** Icône « Partager » de l'en-tête, mobile seulement (#1460) : partage le lien du groupe quand il est actif. */
export function HeaderShareButton({ sharePath, shareText, title }: { sharePath: string; shareText: string; title: string }) {
  const t = useTranslations('share');
  return (
    <Button variant="outline" size="icon" className="shrink-0 lg:hidden" aria-label={t('headerShare')} onClick={() => void shareLink({ sharePath, title, shareText, t })}>
      <Share2 aria-hidden />
    </Button>
  );
}

/**
 * Partager et préparer une sortie (#1351) : partage natif (Web Share, repli « copier le lien »), agenda (.ics),
 * GPX de la trace figée, itinéraire vers le RDV dans l'appli de cartes au choix. Actions secondaires : sur la page
 * invité, le bouton GO reste l'action principale.
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
          <p className="flex items-center gap-2 text-small font-semibold">
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
