import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingPhoto, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { analyzeRide, buildRecap, createOuting, fillTimes, listRideChoices, placePhoto, referenceRide, resolveTakenAt, saveRide, setReferenceRide } from '@/lib/outings';
import { readExifDate } from '@/lib/media/exif';

const fx = (p: string) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/ride', p), 'utf8');
const noIgn = { fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }) as never };
const T0 = Date.parse('2026-11-14T08:00:00Z');

describe('heures de la trace roulée (#1692)', () => {
  it('GPX : garde l’heure de chaque point, à la milliseconde', async () => {
    const s = await analyzeRide(fx('montre-horodatee.gpx'), noIgn);
    // straight line: simplified to 5 m keeps the two ends, each carrying its own time
    expect(s.times).toHaveLength(2);
    expect(s.times![0]).toBe(T0 + 250);
    expect(s.times![1]).toBe(T0 + 600_250);
    expect(s.elapsedSec).toBe(600);
  });
  it('KML gx:Track : garde les <when>', async () => {
    const s = await analyzeRide(fx('appli-gx-track.kml'), noIgn);
    expect(s.times).toHaveLength(2);
    expect(s.times![0]).toBe(T0);
    expect(s.times![1]).toBe(T0 + 600_000);
    expect(s.elapsedSec).toBe(600);
    expect(s.distanceM).toBeGreaterThan(1900);
  });
  it('KML TimeSpan : heures réparties le long de la distance', async () => {
    const s = await analyzeRide(fx('timespan.kml'), noIgn);
    expect(s.times).toHaveLength(2);
    expect(s.times![0]).toBe(T0);
    expect(s.times![1]).toBe(T0 + 600_000);
  });
  it('trace sans heure : valide, times nul', async () => {
    const s = await analyzeRide('<gpx version="1.1" creator="x"><trk><trkseg><trkpt lat="43.2" lon="6.1"/><trkpt lat="43.2" lon="6.11"/></trkseg></trk></gpx>', noIgn);
    expect(s.times).toBeNull();
    expect(s.elapsedSec).toBeNull();
  });
  it('fillTimes comble les trous', () => {
    expect(fillTimes([0, null, 20, null])).toEqual([0, 10, 20, 20]);
    expect(fillTimes([null, 5, null])).toBeNull();
  });
});

describe('heure de prise de vue', () => {
  it('resolveTakenAt : décalage explicite, sinon Europe/Paris, invalide ⇒ null', () => {
    expect(resolveTakenAt('2026-11-14T09:00:00', '+01:00')).toBe(Date.parse('2026-11-14T08:00:00Z'));
    expect(resolveTakenAt('2026-11-14T09:00:00')).toBe(Date.parse('2026-11-14T08:00:00Z'));
    expect(resolveTakenAt('2026-07-14T10:00:30')).toBe(Date.parse('2026-07-14T08:00:30Z'));
    expect(resolveTakenAt('nimporte quoi')).toBeNull();
    expect(resolveTakenAt(null)).toBeNull();
  });
  it('readExifDate lit DateTimeOriginal et OffsetTimeOriginal', () => {
    const asc = (s: string) => [...Buffer.from(s + '\0', 'latin1')];
    const dt = asc('2026:11:14 09:30:15');
    const off = asc('+01:00');
    const parts: number[] = [];
    const w16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
    const w32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
    parts.push(0x49, 0x49); w16(42); w32(8);
    w16(1); w16(0x8769); w16(4); w32(1); w32(26); w32(0); // IFD0 → Exif IFD @26
    w16(2); // Exif IFD: 2 entries (26 + 2 + 24 + 4 = 56 = data start)
    w16(0x9003); w16(2); w32(dt.length); w32(56);
    w16(0x9011); w16(2); w32(off.length); w32(56 + dt.length);
    w32(0);
    parts.push(...dt, ...off);
    const body = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from(parts)]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
    const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xd9])]);
    expect(readExifDate(new Uint8Array(jpg))).toEqual({ local: '2026-11-14T09:30:15', offset: '+01:00' });
    expect(readExifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('calage des photos sur la trace', () => {
  // 11 points 0.00246° apart (~200 m), 1 min apart, starting 08:00:00Z.
  const geometry = { type: 'LineString' as const, coordinates: Array.from({ length: 11 }, (_, i) => [6.1 + i * 0.00246, 43.2] as [number, number]) };
  const times = Array.from({ length: 11 }, (_, i) => T0 + i * 60_000);
  const track = { geometry, times };

  it('par l’heure : position interpolée', () => {
    const p = placePhoto(track, { takenAt: T0 + 90_000, lat: null, lon: null });
    expect(p.method).toBe('time');
    expect(p.at).toBe(T0 + 90_000);
    expect(p.distanceM!).toBeGreaterThan(250);
    expect(p.distanceM!).toBeLessThan(350);
    expect(p.pos![0]).toBeCloseTo(6.1 + 1.5 * 0.00246, 5);
  });
  it('tolérance en bord de plage : ramené au départ / à l’arrivée, au-delà ⇒ pas par l’heure', () => {
    const before = placePhoto(track, { takenAt: T0 - 120_000, lat: null, lon: null });
    expect(before).toMatchObject({ method: 'time', distanceM: 0, at: T0 });
    const after = placePhoto(track, { takenAt: T0 + 600_000 + 4 * 60_000, lat: null, lon: null });
    expect(after.method).toBe('time');
    expect(after.at).toBe(T0 + 600_000);
    expect(placePhoto(track, { takenAt: T0 + 3 * 3600_000, lat: null, lon: null }).method).toBe('none');
  });
  it('sans heure mais GPS proche : par la position', () => {
    const p = placePhoto(track, { takenAt: null, lat: 43.2005, lon: 6.1 + 5 * 0.00246 });
    expect(p.method).toBe('position');
    expect(p.distanceM!).toBeGreaterThan(900);
    expect(p.distanceM!).toBeLessThan(1100);
    expect(Math.abs(p.at! - (T0 + 5 * 60_000))).toBeLessThan(10_000);
  });
  it('heure hors plage + GPS proche : repli sur la position ; GPS loin ou rien : non placée', () => {
    expect(placePhoto(track, { takenAt: T0 + 10 * 3600_000, lat: 43.2, lon: 6.1 + 3 * 0.00246 }).method).toBe('position');
    expect(placePhoto(track, { takenAt: null, lat: 43.25, lon: 6.1 }).method).toBe('none');
    expect(placePhoto(track, { takenAt: null, lat: null, lon: null })).toEqual({ method: 'none', distanceM: null, at: null, pos: null });
  });
  it('trace sans heure : position seulement, instant nul', () => {
    const p = placePhoto({ geometry, times: null }, { takenAt: T0, lat: 43.2, lon: 6.1 + 2 * 0.00246 });
    expect(p.method).toBe('position');
    expect(p.at).toBeNull();
  });
});

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 10] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Sortie', date: '2026-11-14', time: '08:00' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  db.insert(invitation).values({ id: 'i1', outingId: o.id, tokenHash: 'h1', name: 'Léa', status: 'yes' }).run();
  return { db, o, guest: { kind: 'guest' as const, invitationId: 'i1' }, orga: { kind: 'organizer' as const, userId: 'u1' } };
}
const after = new Date('2026-11-14T12:00:00Z');

describe('trace de référence et résumé', () => {
  it('défaut : celle de l’organisateur, sinon la première envoyée ; l’organisateur peut en choisir une autre', async () => {
    const { db, o, guest, orga } = await setup();
    expect(referenceRide(db, o)).toBeNull();
    const g = await saveRide(db, o, guest, fx('appli-gx-track.kml'), after, noIgn);
    expect(g.ok && referenceRide(db, o)?.id).toBe(g.ok && g.id);
    const m = await saveRide(db, o, orga, fx('montre-horodatee.gpx'), after, noIgn);
    expect(m.ok && referenceRide(db, o)?.id).toBe(m.ok && m.id);
    expect(setReferenceRide(db, o, g.ok ? g.id : '')).toBe(true);
    const fresh = db.select().from(outing).where(eq(outing.id, o.id)).get()!;
    expect(referenceRide(db, fresh)?.id).toBe(g.ok && g.id);
    expect(listRideChoices(db, fresh).filter((c) => c.reference)).toHaveLength(1);
    expect(setReferenceRide(db, o, 'inconnu')).toBe(false);
  });
  it('buildRecap : photos placées (heure, position, non placée) et ordonnées le long de la trace', async () => {
    const { db, o, guest, orga } = await setup();
    await saveRide(db, o, orga, fx('montre-horodatee.gpx'), after, noIgn);
    const ins = (id: string, v: Partial<typeof outingPhoto.$inferInsert>) => db.insert(outingPhoto).values({ id, outingId: o.id, width: 10, height: 10, ...v }).run();
    ins('late', { takenAt: T0 + 540_000, invitationId: 'i1' });
    ins('gps', { lat: 43.2, lon: 6.1 + 3 * 0.00246 });
    ins('none', {});
    ins('early', { takenAt: T0 + 60_000 });
    const rc = buildRecap(db, o, guest);
    expect(rc.track?.times).toHaveLength(2);
    expect(rc.media.map((m) => m.id)).toEqual(['early', 'gps', 'late', 'none']);
    expect(rc.media.map((m) => m.placement.method)).toEqual(['time', 'position', 'time', 'none']);
    expect(buildRecap(db, o, orga).media).toHaveLength(4);
  });
  it('sans trace : track nul, photos non placées', async () => {
    const { db, o, orga } = await setup();
    db.insert(outingPhoto).values({ outingId: o.id, width: 1, height: 1, takenAt: T0 }).run();
    const rc = buildRecap(db, o, orga);
    expect(rc.track).toBeNull();
    expect(rc.media[0].placement.method).toBe('none');
  });
});
