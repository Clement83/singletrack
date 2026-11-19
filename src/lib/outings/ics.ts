// Calendar export of an outing (#1351): iCalendar file (RFC 5545). Pure logic, tested in tests/share.test.ts.
// Times in UTC (Z suffix): no VTIMEZONE to maintain, Google Calendar and iOS Calendar show them in the
// device's time zone (Europe/Paris for us).

export type IcsEvent = {
  /** Stable event id (same outing ⇒ same UID, the calendar updates instead of duplicating). */
  uid: string;
  title: string;
  description?: string | null;
  location?: string | null;
  lat: number;
  lon: number;
  start: Date;
  durationMin: number;
  url?: string | null;
  cancelled?: boolean;
  /** Revision (increasing integer): the calendar replaces an older version. */
  sequence?: number;
  /** Generation timestamp (DTSTAMP). */
  now?: Date;
  /** Last change (LAST-MODIFIED). */
  lastModified?: Date;
};

export type IcsOptions = {
  /** Subscription (#1357): Europe/Paris times with VTIMEZONE, refresh intervals, calendar name. */
  feed?: { name: string; refreshHours?: number };
};

const CRLF = '\r\n';

/** Date in iCalendar UTC format: 20261116T070000Z. */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapes an iCalendar text: backslash, semicolon, comma, line breaks. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a line at 75 UTF-8 bytes (continuation = CRLF + space), without splitting a character. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // a continuation line starts with a space (1 byte)
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join(`${CRLF} `);
}

const TZID = 'Europe/Paris';

/** Paris local time in floating iCalendar format: 20261116T083000. */
export function icsLocalDate(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZID, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

/** VTIMEZONE Europe/Paris (EU rules in force since 1996: last Sunday of March / October). */
const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TZID}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function veventLines(e: IcsEvent, tz: boolean): string[] {
  const end = new Date(e.start.getTime() + Math.max(30, Math.round(e.durationMin)) * 60_000);
  const dt = (name: string, d: Date) => (tz ? `${name};TZID=${TZID}:${icsLocalDate(d)}` : `${name}:${icsDate(d)}`);
  return [
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsDate(e.now ?? new Date())}`,
    ...(e.lastModified ? [`LAST-MODIFIED:${icsDate(e.lastModified)}`] : []),
    `SEQUENCE:${Math.max(0, Math.floor(e.sequence ?? 0))}`,
    dt('DTSTART', e.start),
    dt('DTEND', end),
    `SUMMARY:${icsEscape(e.title)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    `GEO:${e.lat.toFixed(6)};${e.lon.toFixed(6)}`,
    ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

/** .ics calendar (one or more VEVENTs), folded lines, CRLF line endings. A single generator: one-off file and subscription. */
export function calendarIcs(events: IcsEvent[], opts: IcsOptions = {}): string {
  const feed = opts.feed;
  const hours = Math.max(1, Math.round(feed?.refreshHours ?? 6));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//singletrack//sorties VTT//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...(feed
      ? [
          `X-WR-CALNAME:${icsEscape(feed.name)}`,
          `X-WR-TIMEZONE:${TZID}`,
          `REFRESH-INTERVAL;VALUE=DURATION:PT${hours}H`,
          `X-PUBLISHED-TTL:PT${hours}H`,
          ...VTIMEZONE,
        ]
      : []),
    ...events.flatMap((e) => veventLines(e, !!feed)),
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join(CRLF) + CRLF;
}

/** .ics file of a single outing (one-off download, UTC times). */
export function outingIcs(e: IcsEvent): string {
  return calendarIcs([e]);
}
