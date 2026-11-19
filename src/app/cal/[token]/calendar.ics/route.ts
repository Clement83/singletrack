import { getDb } from '@/db';
import { outingsForCalendarFeed } from '@/lib/outings';
import { feedResponse, icsEvent, publicOrigin, requestLocale } from '@/lib/outings/export';
import { translatorFor } from '@/i18n/server';

export const dynamic = 'force-dynamic';

/** Organiser's calendar subscription (#1357): all their outings. Dedicated token, can be regenerated (`/api/calendar-feed`). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const outings = outingsForCalendarFeed(getDb().db, (await params).token);
  if (!outings) return new Response('Not found', { status: 404 });
  const origin = publicOrigin(req);
  const host = new URL(origin).host;
  const locale = requestLocale(req);
  const events = outings.map((o) => icsEvent(o, locale, `${origin}/s/${o.slug}`, host));
  return feedResponse(events, translatorFor(locale)('share.feedName'));
}
