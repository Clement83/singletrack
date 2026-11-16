// Fichiers téléchargeables d'une sortie (#1351) : calendrier .ics et GPX de la trace figée.
// Partagé par les routes invité (/api/i/<token>/…) et organisateur (/api/outings/<slug>/…).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { OutingRow } from '@/db/schema';
import { toGpx } from '@/lib/geo/gpx';
import { toKml } from '@/lib/geo/kml';
import { estimateDurationMin } from '@/lib/tracks/duration';
import { LOCALE_COOKIE, TIME_ZONE, resolveLocale, type Locale } from '@/i18n/config';
import { translatorFor } from '@/i18n/server';
import { calendarIcs, type IcsEvent } from './ics';
import { safeFileName } from './share';

/** Langue d'une requête de Route Handler (cookie NEXT_LOCALE > Accept-Language > français). */
export function requestLocale(req: Request): Locale {
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === LOCALE_COOKIE)?.[1];
  return resolveLocale({ cookie, acceptLanguage: req.headers.get('accept-language') });
}

/** Origine publique des liens écrits dans les fichiers (URL du site derrière nginx, sinon celle de la requête). */
export function publicOrigin(req: Request): string {
  return (process.env.BETTER_AUTH_URL || new URL(req.url).origin).replace(/\/+$/, '');
}

/** Date d'une sortie pour un message partagé ou un aperçu de lien (« dimanche 16 novembre à 08:30 »), fuseau Paris. */
export function formatShareDate(d: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  }).format(d);
}

/**
 * Métadonnées d'une page de sortie partagée (lien perso, lien de groupe) : titre « <titre> — <date> », description
 * (date, distance, RDV) et OpenGraph pour l'aperçu dans les messageries. Toujours `noindex`.
 */
export function outingShareMetadata(
  o: Pick<OutingRow, 'title' | 'startsAt' | 'meetingLabel' | 'trackSnapshot'>,
  locale: Locale,
): Metadata {
  const t = translatorFor(locale);
  const date = formatShareDate(o.startsAt, locale);
  const km = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(o.trackSnapshot.distanceM / 1000);
  const title = `${o.title} — ${date}`;
  const description = t('share.ogDescription', { date, km, meeting: o.meetingLabel || t('share.meetingFallback') });
  return {
    ...(process.env.BETTER_AUTH_URL ? { metadataBase: new URL(process.env.BETTER_AUTH_URL) } : {}),
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website', siteName: t('common.appName'), locale: locale === 'fr' ? 'fr_FR' : 'en_GB' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

type OutingForExport = Pick<
  OutingRow,
  'id' | 'title' | 'description' | 'startsAt' | 'meetingLat' | 'meetingLon' | 'meetingLabel' | 'status' | 'trackSnapshot' | 'updatedAt'
>;

/** Texte de l'événement (.ics) : RDV, trace, description, lien. Dans la langue de la requête. */
export function icsText(o: OutingForExport, locale: Locale, url: string): { title: string; description: string; location: string } {
  const t = translatorFor(locale);
  const snap = o.trackSnapshot;
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const meeting = o.meetingLabel || t('share.meetingFallback');
  const track =
    snap.elevationGainM != null
      ? t('share.icsTrackGain', { track: snap.name, km: nf.format(snap.distanceM / 1000), gain: nf.format(Math.round(snap.elevationGainM)) })
      : t('share.icsTrack', { track: snap.name, km: nf.format(snap.distanceM / 1000) });
  const description = [
    o.status === 'cancelled' ? t('share.icsCancelled') : null,
    t('share.icsMeeting', { meeting }),
    track,
    o.description,
    url,
  ]
    .filter(Boolean)
    .join('\n');
  return { title: o.title, description, location: meeting };
}

/** Événement iCalendar d'une sortie (UID stable par sortie : réimporter ou s'abonner met à jour au lieu de dupliquer). */
export function icsEvent(o: OutingForExport, locale: Locale, url: string, host: string): IcsEvent {
  const { title, description, location } = icsText(o, locale, url);
  return {
    uid: `outing-${o.id}@${host}`,
    title,
    description,
    location,
    lat: o.meetingLat,
    lon: o.meetingLon,
    start: o.startsAt,
    durationMin: estimateDurationMin(o.trackSnapshot.distanceM, o.trackSnapshot.elevationGainM),
    url,
    cancelled: o.status === 'cancelled',
    sequence: Math.floor(o.updatedAt.getTime() / 1000),
    lastModified: o.updatedAt,
  };
}

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' };

/** Réponse HTTP du fichier .ics (téléchargement ponctuel). */
export function icsResponse(o: OutingForExport, locale: Locale, url: string, host: string): Response {
  return new Response(calendarIcs([icsEvent(o, locale, url, host)]), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(o.title)}.ics"`,
      ...NO_STORE,
    },
  });
}

/** Flux d'abonnement (webcal, #1357) : affiché inline, rafraîchi par l'agenda de l'abonné. */
export function feedResponse(events: IcsEvent[], name: string): Response {
  return new Response(calendarIcs(events, { feed: { name, refreshHours: 6 } }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="singletrack.ics"', ...NO_STORE },
  });
}

/** Réponse HTTP du GPX de la trace **figée** dans la sortie (celle que les invités voient), attribution conservée. */
export function gpxResponse(o: OutingForExport): Response {
  const snap = o.trackSnapshot;
  return new Response(toGpx({ name: snap.name, attribution: snap.attribution, geometry: snap.geometry }), {
    headers: {
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(snap.name, 'trace')}.gpx"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** Même trace figée en KML (GPX reste le format par défaut). */
export function kmlResponse(o: OutingForExport): Response {
  const snap = o.trackSnapshot;
  return new Response(toKml({ name: snap.name, attribution: snap.attribution, geometry: snap.geometry }), {
    headers: {
      'Content-Type': 'application/vnd.google-earth.kml+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(snap.name, 'trace')}.kml"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

/** Origine publique pour une page serveur (lien d'abonnement affiché) : URL du site, sinon l'hôte de la requête. */
export async function pageOrigin(): Promise<string> {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  return `${h.get('x-forwarded-proto') ?? 'http'}://${host}`;
}
