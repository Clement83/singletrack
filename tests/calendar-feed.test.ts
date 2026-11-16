import { describe, it, expect } from 'vitest';
import ICAL from 'ical.js';
import { openDb } from '@/db';
import { user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import {
  calendarIcs, createInvitation, createOuting, getCalendarFeedToken, icsLocalDate, outingsForCalendarFeed, regenerateCalendarFeedToken,
  revokeInvitation, setStatus, getInvitationByToken,
} from '@/lib/outings';
import { icsEvent, feedResponse } from '@/lib/outings/export';
import { subscribeLinks } from '@/lib/outings/links';
import { isPublicPath } from '@/lib/public-routes';

// Abonnement agenda webcal (#1357) : flux par invité et par organisateur, validé par ical.js.

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }, { id: 'u2', name: 'Autre', email: 'a@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: [[6.1, 43.2, 100], [6.11, 43.21, 180], [6.1, 43.2, 101]] }, raw: {},
  }, { enrich: false });
  const mk = async (title: string, date: string) => {
    const o = await createOuting(db, 'u1', { trackSlug: t.slug, title, date, time: '08:30' });
    if (!('slug' in o)) throw new Error('création');
    return o.slug;
  };
  return { db, mk };
}

describe('flux agenda (#1357)', () => {
  it('icsLocalDate : heure de Paris, été et hiver', () => {
    expect(icsLocalDate(new Date('2026-11-16T07:30:00Z'))).toBe('20261116T083000');
    expect(icsLocalDate(new Date('2026-07-16T06:30:00Z'))).toBe('20260716T083000');
  });

  it('un flux est un iCalendar valide : VTIMEZONE, TZID, rafraîchissement, annulation', async () => {
    const { db, mk } = await setup();
    const slug = await mk('Dimanche', '2099-05-10');
    const slug2 = await mk('Samedi', '2099-06-13');
    setStatus(db, 'u1', slug2, 'cancelled');
    const feed = outingsForCalendarFeed(db, getCalendarFeedToken(db, 'u1'))!;
    expect(feed).toHaveLength(2);
    const events = feed.map((o) => icsEvent(o, 'fr', `https://x.me/s/${o.slug}`, 'x.me'));
    const body = calendarIcs(events, { feed: { name: 'Mes sorties', refreshHours: 6 } });
    expect(body).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT6H');
    expect(body).toContain('X-PUBLISHED-TTL:PT6H');
    expect(body).toContain('DTSTART;TZID=Europe/Paris:20990510T083000');
    expect(body).toContain('LAST-MODIFIED:');
    expect(body).toContain('STATUS:CANCELLED');
    expect(slug).toBeTruthy();

    const comp = new ICAL.Component(ICAL.parse(body));
    expect(comp.getFirstPropertyValue('version')).toBe('2.0');
    expect(comp.getAllSubcomponents('vtimezone')).toHaveLength(1);
    const vevents = comp.getAllSubcomponents('vevent');
    expect(vevents).toHaveLength(2);
    const ev = new ICAL.Event(vevents[0]);
    expect(ev.uid).toMatch(/^outing-.+@x\.me$/);
    // l'heure locale Paris (08:30 en mai = UTC+2) est bien résolue par le VTIMEZONE
    expect(ev.startDate.toJSDate().toISOString()).toBe('2099-05-10T06:30:00.000Z');
    expect(vevents.map((v) => v.getFirstPropertyValue('status'))).toContain('CANCELLED');
  });

  it('le fichier ponctuel reste en UTC et valide', async () => {
    const { db, mk } = await setup();
    await mk('Dimanche', '2099-05-10');
    const o = outingsForCalendarFeed(db, getCalendarFeedToken(db, 'u1'))![0];
    const body = calendarIcs([icsEvent(o, 'en', 'https://x.me/i/t', 'x.me')]);
    expect(body).toContain('DTSTART:20990510T063000Z');
    expect(body).not.toContain('VTIMEZONE');
    expect(new ICAL.Component(ICAL.parse(body)).getAllSubcomponents('vevent')).toHaveLength(1);
  });

  it('la réponse HTTP est un flux inline, jamais mis en cache', async () => {
    const res = feedResponse([], 'x');
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('content-disposition')).toContain('inline');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('jeton organisateur : stable, régénérable (l’ancien ne répond plus), limité à ses sorties', async () => {
    const { db, mk } = await setup();
    await mk('Dimanche', '2099-05-10');
    const t1 = getCalendarFeedToken(db, 'u1');
    expect(getCalendarFeedToken(db, 'u1')).toBe(t1);
    expect(getCalendarFeedToken(db, 'u2')).not.toBe(t1);
    expect(outingsForCalendarFeed(db, getCalendarFeedToken(db, 'u2'))).toEqual([]);
    const t2 = regenerateCalendarFeedToken(db, 'u1');
    expect(t2).not.toBe(t1);
    expect(outingsForCalendarFeed(db, t1)).toBeUndefined();
    expect(outingsForCalendarFeed(db, t2)).toHaveLength(1);
    expect(outingsForCalendarFeed(db, 'court')).toBeUndefined();
  });

  it('lien d’invité révoqué : plus de flux (404)', async () => {
    const { db, mk } = await setup();
    const slug = await mk('Dimanche', '2099-05-10');
    const inv = createInvitation(db, 'u1', slug, 'Zed');
    if (!inv.ok) throw new Error('invitation');
    const token = inv.token;
    expect(getInvitationByToken(db, token)).toBeTruthy();
    revokeInvitation(db, 'u1', slug, inv.id);
    expect(getInvitationByToken(db, token)).toBeUndefined();
  });

  it('liens d’abonnement : webcal et Google Agenda', () => {
    const l = subscribeLinks('https://singletrack.example.org/i/abc/calendar.ics');
    expect(l.webcal).toBe('webcal://singletrack.example.org/i/abc/calendar.ics');
    expect(l.google).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(l.webcal)}`);
  });

  it('routes publiques sans session : /cal et /i/<token>/calendar.ics', () => {
    expect(isPublicPath('/cal/tok/calendar.ics')).toBe(true);
    expect(isPublicPath('/i/tok/calendar.ics')).toBe(true);
    expect(isPublicPath('/api/calendar-feed')).toBe(false);
  });
});
