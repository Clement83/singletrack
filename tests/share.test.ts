import { describe, it, expect } from 'vitest';
import { icsDate, icsEscape, icsFold, outingIcs } from '@/lib/outings/ics';
import { MAP_APPS, directionsLinks, safeFileName } from '@/lib/outings/share';
import { formatShareDate, gpxResponse, icsResponse, icsText, outingShareMetadata, publicOrigin, requestLocale } from '@/lib/outings/export';
import { ogPaths } from '@/lib/outings/og-image';
import { LOCALE_COOKIE } from '@/i18n/config';
import type { OutingRow } from '@/db/schema';
import type { TrackSnapshot } from '@/lib/outings/snapshot';

// Sharing an outing (#1351): .ics, GPX of the frozen track, link preview, directions links.

const snapshot: TrackSnapshot = {
  slug: 'trace-1',
  name: 'Boucle',
  geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.12, 43.19, 120]] },
  bbox: [6.1, 43.19, 6.12, 43.21],
  start: [6.1, 43.2],
  distanceM: 18_500,
  elevationGainM: 420,
  elevationLossM: 400,
  minEle: 100,
  maxEle: 180,
  difficulty: 'blue',
  loop: true,
  source: 'osm',
  license: 'ODbL',
  attribution: '© OpenStreetMap contributors',
  author: null,
  sourceUrl: null,
  takenAt: '2026-11-12T10:00:00.000Z',
};

function outing(over: Partial<OutingRow> = {}): OutingRow {
  return {
    id: 'outing-1',
    slug: 'sortie-1',
    trackId: null,
    trackSnapshot: snapshot,
    title: 'Boucle des Maures',
    description: 'Départ cool, on ne se presse pas.',
    startsAt: new Date('2026-11-16T07:30:00Z'),
    meetingLat: 43.2269,
    meetingLon: 6.1469,
    meetingLabel: 'Parking de la gare',
    level: 'sportif',
    ebike: 'yes',
    visibility: 'invite',
    maxParticipants: null,
    status: 'planned',
    openLinkEnabled: false,
    openLinkToken: 'open-token',
    createdBy: 'u1',
    ownerId: 'u1',
    participantsCanInvite: false,
    createdAt: new Date('2026-11-12T10:00:00Z'),
    updatedAt: new Date('2026-11-12T10:00:00Z'),
    ...over,
  };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

describe('partage d’une sortie (#1351)', () => {
  it('itinéraire vers le RDV : une URL par appli, coordonnées incluses', () => {
    const links = directionsLinks(43.2269, 6.1469);
    expect(MAP_APPS).toEqual(['google', 'waze', 'apple']);
    expect(links.google).toContain('https://www.google.com/maps/dir/?api=1');
    expect(links.google).toContain('destination=43.226900,6.146900');
    expect(links.waze).toContain('https://waze.com/ul?ll=43.226900,6.146900');
    expect(links.waze).toContain('navigate=yes');
    expect(links.apple).toContain('https://maps.apple.com/?daddr=43.226900,6.146900');
    expect(links.apple).toContain('dirflg=d');
  });

  it('nom de fichier sûr : accents, espaces et ponctuation retirés, longueur bornée', () => {
    expect(safeFileName('Boucle des Maures — 18,5 km')).toBe('Boucle_des_Maures_18_5_km');
    expect(safeFileName('Été à Pierrefeu')).toBe('Ete_a_Pierrefeu');
    expect(safeFileName('   ')).toBe('sortie');
    expect(safeFileName('', 'trace')).toBe('trace');
    expect(safeFileName('x'.repeat(80))).toHaveLength(60);
  });

  it('date de partage : langue de la page, fuseau Europe/Paris', () => {
    const d = new Date('2026-11-16T07:30:00Z');
    expect(formatShareDate(d, 'fr')).toContain('novembre');
    expect(formatShareDate(d, 'fr')).toContain('08:30');
    expect(formatShareDate(d, 'en')).toContain('November');
    expect(formatShareDate(d, 'en')).toContain('08:30');
  });

  it('.ics : date UTC, échappement, pliage à 75 octets sans couper un caractère', () => {
    expect(icsDate(new Date('2026-11-16T07:30:00.000Z'))).toBe('20261116T073000Z');
    expect(icsEscape('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');

    const line = `SUMMARY:${'é'.repeat(80)}`;
    const folded = icsFold(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(bytes(p)).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe(line);
  });

  it('.ics : un seul VEVENT, CRLF, fin = début + durée, annulation, GEO', () => {
    const ics = outingIcs({
      uid: 'outing-outing-1@singletrack.example.org',
      title: 'Boucle des Maures',
      description: 'RDV : Parking de la gare\nBoucle (18,5 km)',
      location: 'Parking de la gare',
      lat: 43.2269,
      lon: 6.1469,
      start: new Date('2026-11-16T07:30:00Z'),
      durationMin: 120,
      url: 'https://singletrack.example.org/i/tok',
      cancelled: true,
      sequence: 12,
      now: new Date('2026-11-12T10:00:00Z'),
    });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('DTSTAMP:20261112T100000Z');
    expect(ics).toContain('DTSTART:20261116T073000Z');
    expect(ics).toContain('DTEND:20261116T093000Z');
    expect(ics).toContain('SEQUENCE:12');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('GEO:43.226900;6.146900');
    expect(ics).toContain('LOCATION:Parking de la gare');
    // the French decimal comma is escaped by icsEscape
    expect(ics).toContain('DESCRIPTION:RDV : Parking de la gare\\nBoucle (18\\,5 km)');
    expect(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
    for (const l of ics.split('\r\n')) expect(bytes(l)).toBeLessThanOrEqual(75);
  });

  it('.ics d’une sortie : texte dans la langue demandée, UID stable, en-têtes de téléchargement', async () => {
    const fr = icsText(outing(), 'fr', 'https://singletrack.example.org/i/tok');
    expect(fr.title).toBe('Boucle des Maures');
    expect(fr.location).toBe('Parking de la gare');
    expect(fr.description).toContain('Parking de la gare');
    expect(fr.description).toContain('18,5');
    expect(fr.description).toContain('https://singletrack.example.org/i/tok');
    expect(fr.description).toContain('Départ cool');

    const en = icsText(outing(), 'en', 'https://singletrack.example.org/i/tok');
    expect(en.description).toContain('18.5');
    expect(icsText(outing({ status: 'cancelled' }), 'fr', 'u').description).toContain('annulée');

    const res = icsResponse(outing(), 'fr', 'https://singletrack.example.org/i/tok', 'singletrack.example.org');
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Boucle_des_Maures.ics"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const body = await res.text();
    expect(body).toContain('UID:outing-outing-1@singletrack.example.org');
    expect(body).toContain('SUMMARY:Boucle des Maures');
    expect(body).toContain('STATUS:CONFIRMED');
  });

  it('GPX : la trace figée, attribution conservée, nom de fichier de la trace', async () => {
    const res = gpxResponse(outing());
    expect(res.headers.get('content-type')).toBe('application/gpx+xml; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="Boucle.gpx"');
    const xml = await res.text();
    expect(xml).toContain('<gpx version="1.1"');
    expect(xml).toContain('<name>Boucle</name>');
    expect(xml).toContain('© OpenStreetMap contributors');
    expect(xml).toContain('<trkpt lat="43.2" lon="6.1"><ele>100</ele></trkpt>');
  });

  it('aperçu de lien : titre daté, description, noindex, locale', () => {
    const md = outingShareMetadata(outing(), 'fr');
    expect(md.robots).toEqual({ index: false, follow: false });
    expect(String(md.title)).toContain('Boucle des Maures');
    expect(String(md.title)).toContain('novembre');
    expect(String(md.description)).toContain('Parking de la gare');
    expect(md.openGraph?.locale).toBe('fr_FR');
    expect(outingShareMetadata(outing(), 'en').openGraph?.locale).toBe('en_GB');
  });

  it('langue d’une requête : cookie d’abord, sinon Accept-Language, sinon français', () => {
    const withCookie = new Request('https://x/api/i/tok/ics', {
      headers: { cookie: `autre=1; ${LOCALE_COOKIE}=en`, 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    expect(requestLocale(withCookie)).toBe('en');
    const headerOnly = new Request('https://x/api/i/tok/ics', { headers: { 'accept-language': 'en-GB,en;q=0.9' } });
    expect(requestLocale(headerOnly)).toBe('en');
    expect(requestLocale(new Request('https://x/api/i/tok/ics'))).toBe('fr');
  });

  it('origine publique : BETTER_AUTH_URL sinon l’origine de la requête', () => {
    const req = new Request('http://192.0.2.10:3700/api/i/tok/ics');
    const saved = process.env.BETTER_AUTH_URL;
    try {
      delete process.env.BETTER_AUTH_URL;
      expect(publicOrigin(req)).toBe('http://192.0.2.10:3700');
      process.env.BETTER_AUTH_URL = 'https://singletrack.example.org/';
      expect(publicOrigin(req)).toBe('https://singletrack.example.org');
    } finally {
      if (saved === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = saved;
    }
  });

  it('tracé de l’aperçu : projeté dans la boîte, proportions conservées, une polyligne par ligne', () => {
    const [line] = ogPaths({ type: 'LineString', coordinates: [[6.1, 43.2], [6.2, 43.3]] }, 100, 100, 10);
    const pts = line.split(' ').map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(2);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(9.9);
      expect(x).toBeLessThanOrEqual(90.1);
      expect(y).toBeGreaterThanOrEqual(9.9);
      expect(y).toBeLessThanOrEqual(90.1);
    }
    expect(ogPaths({ type: 'LineString', coordinates: [[6.1, 43.2]] }, 100, 100)).toEqual([]);
    expect(
      ogPaths({ type: 'MultiLineString', coordinates: [[[6.1, 43.2], [6.2, 43.3]], [[6.15, 43.25], [6.18, 43.28]]] }, 100, 100),
    ).toHaveLength(2);
  });
});
