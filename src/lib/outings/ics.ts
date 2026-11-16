// Export calendrier d'une sortie (#1351) : fichier iCalendar (RFC 5545). Logique pure, testée dans tests/share.test.ts.
// Heures en UTC (suffixe Z) : pas de VTIMEZONE à maintenir, Google Agenda et iOS Calendrier les affichent dans le
// fuseau de l'appareil (Europe/Paris pour nous).

export type IcsEvent = {
  /** Identifiant stable de l'événement (même sortie ⇒ même UID, l'agenda met à jour au lieu de dupliquer). */
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
  /** Révision (entier croissant) : l'agenda remplace une version plus ancienne. */
  sequence?: number;
  /** Horodatage de génération (DTSTAMP). */
  now?: Date;
  /** Dernière modification (LAST-MODIFIED). */
  lastModified?: Date;
};

export type IcsOptions = {
  /** Abonnement (#1357) : heures en Europe/Paris avec VTIMEZONE, durées de rafraîchissement, nom du calendrier. */
  feed?: { name: string; refreshHours?: number };
};

const CRLF = '\r\n';

/** Date au format iCalendar UTC : 20261116T070000Z. */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Échappement d'un texte iCalendar : antislash, point-virgule, virgule, retours à la ligne. */
export function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Pliage d'une ligne à 75 octets UTF-8 (continuation = CRLF + espace), sans couper un caractère. */
export function icsFold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // une ligne de continuation commence par un espace (1 octet)
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

/** Heure locale Paris au format iCalendar flottant : 20261116T083000. */
export function icsLocalDate(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZID, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

/** VTIMEZONE Europe/Paris (règles UE en vigueur depuis 1996 : dernier dimanche de mars / d'octobre). */
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

/** Calendrier .ics (un ou plusieurs VEVENT), lignes pliées, fins de ligne CRLF. Un seul générateur : fichier ponctuel et abonnement. */
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

/** Fichier .ics d'une seule sortie (téléchargement ponctuel, heures UTC). */
export function outingIcs(e: IcsEvent): string {
  return calendarIcs([e]);
}
