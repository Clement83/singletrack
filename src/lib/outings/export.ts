// Downloadable files of an outing (#1351): .ics calendar and GPX of the frozen track.
// Shared by the guest routes (/api/i/<token>/…) and the organiser routes (/api/outings/<slug>/…).
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

/** Language of a Route Handler request (NEXT_LOCALE cookie > Accept-Language > French). */
export function requestLocale(req: Request): Locale {
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === LOCALE_COOKIE)?.[1];
  return resolveLocale({ cookie, acceptLanguage: req.headers.get('accept-language') });
}

/** Public origin of the links written in the files (site URL behind nginx, otherwise the request's). */
export function publicOrigin(req: Request): string {
  return (process.env.BETTER_AUTH_URL || new URL(req.url).origin).replace(/\/+$/, '');
}

/** Date of an outing for a shared message or a link preview (« dimanche 16 novembre à 08:30 »), Paris time zone. */
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
 * Metadata of a shared outing page (personal link, group link): title "<title> — <date>", description
 * (date, distance, meeting point) and OpenGraph for the preview in messaging apps. Always `noindex`.
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

/** Event text (.ics): meeting point, track, description, link. In the request's language. */
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

/** iCalendar event of an outing (stable UID per outing: re-importing or subscribing updates instead of duplicating). */
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

/** HTTP response of the .ics file (one-off download). */
export function icsResponse(o: OutingForExport, locale: Locale, url: string, host: string): Response {
  return new Response(calendarIcs([icsEvent(o, locale, url, host)]), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFileName(o.title)}.ics"`,
      ...NO_STORE,
    },
  });
}

/** Subscription feed (webcal, #1357): served inline, refreshed by the subscriber's calendar. */
export function feedResponse(events: IcsEvent[], name: string): Response {
  return new Response(calendarIcs(events, { feed: { name, refreshHours: 6 } }), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="singletrack.ics"', ...NO_STORE },
  });
}

/** HTTP response of the GPX of the track **frozen** in the outing (the one guests see), attribution kept. */
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

/** Same frozen track as KML (GPX stays the default format). */
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

/** Public origin for a server page (subscription link shown): site URL, otherwise the request host. */
export async function pageOrigin(): Promise<string> {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  return `${h.get('x-forwarded-proto') ?? 'http'}://${host}`;
}
