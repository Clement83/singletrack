import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingPhoto, outingRideMoment, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { buildRecap, createOuting, listRides, mediaAroundMoments, saveRide, MOMENT_WINDOW_MS } from '@/lib/outings';
import { gpxMoments, kmlMoments } from '@/lib/geo';
import { buildStops } from '@/lib/outings/summary-script';

const noIgn = { fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }) as never };
const T0 = Date.parse('2026-11-14T08:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
// 41 points ~160 m apart (6.4 km), one per minute.
const pts = Array.from({ length: 41 }, (_, i) => ({ lon: 6.1 + i * 0.002, lat: 43.2, t: T0 + i * 60_000 }));
const gpx = (wpts: string) =>
  `<gpx version="1.1" creator="x">${wpts}<trk><trkseg>${pts.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${iso(p.t)}</time></trkpt>`).join('')}</trkseg></trk></gpx>`;
const MID = `<wpt lat="43.2" lon="${6.1 + 20 * 0.002}"><time>${iso(T0 + 20 * 60_000)}</time><name>Belle vue &amp; pause</name><type>viewpoint</type></wpt>`;
const START = `<wpt lat="43.2" lon="${6.1 + 0.0005}"><time>${iso(T0 + 10_000)}</time><name>Départ</name></wpt>`;

describe('extraction des moments clés (#1798)', () => {
  it('GPX : <wpt> avec heure, nom et type ; sans heure gardé', () => {
    const m = gpxMoments(gpx(MID + '<wpt lat="43.21" lon="6.2"><name>Sans heure</name></wpt>'));
    expect(m).toHaveLength(2);
    expect(m[0]).toMatchObject({ lat: 43.2, name: 'Belle vue & pause', type: 'viewpoint', at: T0 + 20 * 60_000 });
    expect(m[1]).toMatchObject({ name: 'Sans heure', at: null, type: null });
  });
  it('KML : Placemark Point daté, les lignes sont ignorées', () => {
    const kml = `<kml><Document>
      <Placemark><name>Trace</name><LineString><coordinates>6.1,43.2 6.2,43.2</coordinates></LineString></Placemark>
      <Placemark><name><![CDATA[Ravito]]></name><TimeStamp><when>${iso(T0 + 5 * 60_000)}</when></TimeStamp><Point><coordinates>6.15,43.21,300</coordinates></Point></Placemark>
      <Placemark><name>Sans heure</name><Point><coordinates>6.16,43.21</coordinates></Point></Placemark></Document></kml>`;
    const m = kmlMoments(kml);
    expect(m).toEqual([
      { lat: 43.21, lon: 6.15, at: T0 + 5 * 60_000, name: 'Ravito', type: null },
      { lat: 43.21, lon: 6.16, at: null, name: 'Sans heure', type: null },
    ]);
  });
});

describe('médias autour d’un moment', () => {
  const moments = [{ id: 'm1', at: T0 }];
  it('photo à 1 min mise en avant, à 10 min non', () => {
    const r = mediaAroundMoments(moments, [
      { id: 'near', type: 'photo', takenAt: T0 + 60_000, durationMs: null },
      { id: 'far', type: 'photo', takenAt: T0 + 10 * 60_000, durationMs: null },
      { id: 'undated', type: 'photo', takenAt: null, durationMs: null },
    ]);
    expect(r.get('m1')).toEqual(['near']);
  });
  it('vidéo qui couvre le moment, ou qui commence ≤ 2 min ; moment sans heure : rien', () => {
    const r = mediaAroundMoments(moments, [
      { id: 'covers', type: 'video', takenAt: T0 - 20_000, durationMs: 30_000 },
      { id: 'starts', type: 'video', takenAt: T0 + MOMENT_WINDOW_MS, durationMs: 10_000 },
      { id: 'late', type: 'video', takenAt: T0 + MOMENT_WINDOW_MS + 1000, durationMs: 10_000 },
    ]);
    expect(r.get('m1')).toEqual(['covers', 'starts']);
    expect(mediaAroundMoments([{ id: 'x', at: null }], [{ id: 'p', type: 'photo', takenAt: T0, durationMs: null }]).size).toBe(0);
  });
  it('un média au plus près de deux moments va au plus proche', () => {
    const r = mediaAroundMoments([{ id: 'a', at: T0 }, { id: 'b', at: T0 + 90_000 }], [{ id: 'p', type: 'photo', takenAt: T0 + 80_000, durationMs: null }]);
    expect(r.get('b')).toEqual(['p']);
    expect(r.has('a')).toBe(false);
  });
  it('au même arrêt, les médias mis en avant passent en premier', () => {
    const s = buildStops([
      { id: 'a', type: 'photo', author: '', durationMs: null, distanceM: 100 },
      { id: 'b', type: 'photo', author: '', durationMs: null, distanceM: 110, featured: true },
    ]);
    expect(s[0].media.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat, 100] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Sortie', date: '2026-11-14', time: '08:00' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  db.insert(invitation).values({ id: 'i1', outingId: o.id, tokenHash: 'h1', name: 'Léa', status: 'yes' }).run();
  return { db, o, guest: { kind: 'guest' as const, invitationId: 'i1' }, orga: { kind: 'organizer' as const, userId: 'u1' } };
}
const after = new Date('2026-11-14T12:00:00Z');

describe('moments d’une trace roulée : stockage, visibilité, résumé', () => {
  it('stockés à l’envoi, remplacés avec la trace', async () => {
    const { db, o, orga } = await setup();
    const r = await saveRide(db, o, orga, gpx(MID), after, noIgn);
    expect(db.select().from(outingRideMoment).all()).toHaveLength(1);
    await saveRide(db, o, orga, gpx(''), after, noIgn);
    expect(db.select().from(outingRideMoment).all()).toHaveLength(0);
    expect(r.ok).toBe(true);
  });
  it('un autre participant ne voit pas un moment dans les 300 premiers mètres, mais voit les autres', async () => {
    const { db, o, guest, orga } = await setup();
    await saveRide(db, o, guest, gpx(START + MID), after, noIgn);
    const own = listRides(db, o.id, guest)[0];
    expect(own.moments!.map((m) => m.name).sort()).toEqual(['Belle vue & pause', 'Départ']);
    const seen = listRides(db, o.id, orga).find((r) => !r.mine)!;
    expect(seen.moments!.map((m) => m.name)).toEqual(['Belle vue & pause']);
  });
  it('le résumé place le moment et met en avant la photo à 1 min, pas celle à 10 min', async () => {
    const { db, o, orga } = await setup();
    await saveRide(db, o, orga, gpx(MID), after, noIgn);
    const mk = (id: string, takenAt: number) => db.insert(outingPhoto).values({ id, outingId: o.id, authorUserId: 'u1', width: 10, height: 10, takenAt }).run();
    mk('p-near', T0 + 21 * 60_000);
    mk('p-far', T0 + 30 * 60_000);
    const recap = buildRecap(db, o, orga);
    expect(recap.track!.moments).toHaveLength(1);
    const mo = recap.track!.moments[0];
    expect(mo.distanceM!).toBeGreaterThan(3000);
    expect(recap.media.find((m) => m.id === 'p-near')!.momentId).toBe(mo.id);
    expect(recap.media.find((m) => m.id === 'p-far')!.momentId).toBeNull();
  });
});
