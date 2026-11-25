import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingRide, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { trimEnds, type TrackGeometry } from '@/lib/geo';
import { analyzeRide, canUploadRide, createOuting, deleteRide, listRides, saveRide } from '@/lib/outings';

const gpx = (pts: string) => `<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg>${pts}</trkseg></trk></gpx>`;
// 21 points every 100 m eastwards (~0.00123° of longitude at 43.2°), 20 s apart (18 km/h), climbing 5 m / point, then a GPS pause.
const pt = (i: number, t: string, ele = 100 + i * 5) => `<trkpt lat="43.2" lon="${6.1 + i * 0.00123}"><ele>${ele}</ele><time>${t}</time></trkpt>`;
const ride = gpx(
  Array.from({ length: 21 }, (_, i) => pt(i, new Date(Date.UTC(2026, 10, 14, 8, 0, i * 20)).toISOString())).join('') +
    // 10 min later: GPS pause, 2 almost still points
    pt(21, '2026-11-14T08:17:00Z', 205) + pt(22, '2026-11-14T08:17:30Z', 205),
);

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
  const inv = (id: string, name: string) => {
    db.insert(invitation).values({ id, outingId: o.id, tokenHash: `h${id}`, name, status: 'yes' }).run();
    return { kind: 'guest' as const, invitationId: id };
  };
  return { db, o, inv };
}
const after = new Date('2026-11-14T12:00:00Z');
/** Fake IGN: elevation = 500 + 10 × rank of the point in the request (re-elevating proves the GPS elevation is replaced). */
const ign = () => fakeIgn(true);
const fakeIgn = (fail = false) => ({
  fetchFn: vi.fn(async (url: string) => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    const n = new URL(url).searchParams.get('lon')!.split('|').length;
    return { ok: true, status: 200, json: async () => ({ elevations: Array.from({ length: n }, (_, i) => 500 + i * 10) }) };
  }),
  cache: new Map<string, number>(),
  intervalMs: 0,
});

describe('analyzeRide (#1412)', () => {
  it('distance, D+, temps de déplacement hors pauses, durée totale', async () => {
    const s = await analyzeRide(ride, fakeIgn(true)); // IGN down: GPS elevation as a fallback
    expect(s.distanceM).toBeGreaterThan(2000);
    expect(s.distanceM).toBeLessThan(2400);
    expect(s.gainM).toBeGreaterThan(80);
    expect(s.movingSec).toBe(430); // 20 × 20 s + 30 s; the 10-min GPS pause does not count
    expect(s.elapsedSec).toBe(17 * 60 + 30);
  });
  it('D+ calculé sur les altitudes IGN, pas sur celles du GPS (#1515)', async () => {
    const s = await analyzeRide(ride, fakeIgn());
    const up = s.geometry.type === 'LineString' ? s.geometry.coordinates.map((p) => p[2]) : [];
    expect(up.every((e) => typeof e === 'number' && e >= 500)).toBe(true);
    expect(s.gainM).toBeGreaterThan(80);
  });
  it('sans horodatage ni altitude GPS : temps inconnu, altitude IGN ; IGN muet : D+ inconnu', async () => {
    const f = gpx('<trkpt lat="43.2" lon="6.1"/><trkpt lat="43.2" lon="6.11"/>');
    const s = await analyzeRide(f, fakeIgn());
    expect(s.movingSec).toBeNull();
    expect(s.gainM).not.toBeNull(); // IGN elevation present (smoothed gain, 2 points)
    expect((await analyzeRide(f, fakeIgn(true))).gainM).toBeNull();
    expect(s.distanceM).toBeGreaterThan(700);
  });
  it('refuse un fichier qui n’est pas un GPX, un DOCTYPE, un GPX vide', async () => {
    await expect(analyzeRide('<html/>')).rejects.toThrow('notGpx');
    await expect(analyzeRide('<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>')).rejects.toThrow('doctype');
    await expect(analyzeRide('<gpx></gpx>')).rejects.toThrow();
  });
});

describe('saveRide / listRides', () => {
  it('une trace par personne (remplacée), chacun ne supprime que la sienne', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    const b = inv('b', 'Bob');
    const orga = { kind: 'organizer' as const, userId: 'u1' };
    expect((await saveRide(db, o, a, ride, after, ign())).ok).toBe(true);
    expect((await saveRide(db, o, a, ride, after, ign())).ok).toBe(true); // remplacement
    expect((await saveRide(db, o, b, ride, after, ign())).ok).toBe(true);
    expect((await saveRide(db, o, orga, ride, after, ign())).ok).toBe(true);
    expect(db.select().from(outingRide).all()).toHaveLength(3);
    const all = listRides(db, o.id, orga);
    expect(all.filter((r) => r.mine)).toHaveLength(1);
    expect(all.filter((r) => r.author === 'Alice')).toHaveLength(1);
    deleteRide(db, o, a);
    expect(db.select().from(outingRide).all()).toHaveLength(2);
    expect(listRides(db, o.id, b).map((r) => r.mine).sort()).toEqual([false, true]);
  });
  it('#1772 : tout participant inscrit voit toutes les traces ; en attente / refusé / révoqué ne voit que la sienne', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    const b = inv('b', 'Bob');
    const orga = { kind: 'organizer' as const, userId: 'u1' };
    for (const x of [a, b, orga]) expect((await saveRide(db, o, x, ride, after, ign())).ok).toBe(true);
    expect(listRides(db, o.id, a)).toHaveLength(3);
    expect(listRides(db, o.id, a).filter((r) => r.mine).map((r) => r.author)).toEqual(['Alice']);
    expect(listRides(db, o.id, orga)).toHaveLength(3);
    // un inscrit par le lien de groupe / un compte : invitation « yes » comme les autres
    db.insert(invitation).values({ id: 'g', outingId: o.id, tokenHash: 'hg', name: 'Gina', status: 'yes', origin: 'open_link' }).run();
    expect(listRides(db, o.id, { kind: 'guest', invitationId: 'g' })).toHaveLength(3);
    // non inscrit
    db.insert(invitation).values({ id: 'p', outingId: o.id, tokenHash: 'hp', name: 'Pat', status: 'pending' }).run();
    db.insert(invitation).values({ id: 'n', outingId: o.id, tokenHash: 'hn', name: 'Nina', status: 'no' }).run();
    expect(listRides(db, o.id, { kind: 'guest', invitationId: 'p' })).toHaveLength(0);
    expect(listRides(db, o.id, { kind: 'guest', invitationId: 'n' })).toHaveLength(0);
    // la sienne reste visible même sans être « inscrit »
    expect((await saveRide(db, o, { kind: 'guest', invitationId: 'n' }, ride, after, ign())).ok).toBe(true);
    expect(listRides(db, o.id, { kind: 'guest', invitationId: 'n' }).map((r) => r.mine)).toEqual([true]);
    // révoqué
    db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.id, 'b')).run();
    expect(listRides(db, o.id, b).map((r) => r.mine)).toEqual([true]);
  });
  it('#1772 : les 300 premiers et derniers mètres des autres sont masqués, pas ceux de sa propre trace', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    const b = inv('b', 'Bob');
    // ~2.2 km: long enough to keep a middle part
    expect((await saveRide(db, o, a, ride, after, ign())).ok).toBe(true);
    expect((await saveRide(db, o, b, ride, after, ign())).ok).toBe(true);
    const seen = listRides(db, o.id, a);
    const mine = seen.find((r) => r.mine)!;
    const other = seen.find((r) => !r.mine)!;
    const first = (g: typeof mine.geometry) => (g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]);
    expect(first(other.geometry)[0]).toBeGreaterThan(first(mine.geometry)[0] + 0.003);
    expect(other.distanceM).toBe(mine.distanceM); // stats of the whole ride
    // the stored track stays whole
    expect(db.select().from(outingRide).all().every((r) => r.geometry.type === 'LineString' && Math.abs(r.geometry.coordinates[0][0] - 6.1) < 1e-6)).toBe(true);
  });
  it('refusée avant la sortie, si annulée, ou si le fichier est mauvais', async () => {
    const { db, o, inv } = await setup();
    const a = inv('a', 'Alice');
    expect(await saveRide(db, o, a, ride, new Date('2026-11-01T00:00:00Z'), ign())).toEqual({ ok: false, error: 'tooEarly' });
    expect(await saveRide(db, { ...o, status: 'cancelled' }, a, ride, after, ign())).toEqual({ ok: false, error: 'closed' });
    expect(await saveRide(db, o, a, 'pas un gpx', after, ign())).toEqual({ ok: false, error: 'notGpx' });
    expect(await saveRide(db, o, a, 'x'.repeat(5 * 1024 * 1024 + 1), after, ign())).toEqual({ ok: false, error: 'tooLarge' });
    expect(canUploadRide(o, after)).toBe(true);
  });
  it('supprimer l’invitation supprime sa trace (cascade)', async () => {
    const { db, o, inv } = await setup();
    await saveRide(db, o, inv('a', 'Alice'), ride, after, ign());
    db.delete(invitation).where(eq(invitation.id, 'a')).run();
    expect(db.select().from(outingRide).all()).toHaveLength(0);
  });
});

describe('dédoublonnage des lignes (#1699)', () => {
  // 31 points every ~100 m, climbing 2 m / point; `jitter` shifts the second copy by ~5 m (denser/noisier export).
  const track = (n: number, lonStart = 6.1, jitter = 0) => Array.from({ length: n }, (_, i) => ({ lon: lonStart + i * 0.00123, lat: 43.2 + jitter, ele: 100 + i * 2, t: new Date(Date.UTC(2026, 10, 14, 8, 0, i * 20)).toISOString() }));
  const gxTrack = (ps: ReturnType<typeof track>) => `<gx:Track>${ps.map((p) => `<when>${p.t}</when>`).join('')}${ps.map((p) => `<gx:coord>${p.lon} ${p.lat} ${p.ele}</gx:coord>`).join('')}</gx:Track>`;
  const lineString = (ps: ReturnType<typeof track>) => `<LineString><coordinates>${ps.map((p) => `${p.lon},${p.lat},${p.ele}`).join(' ')}</coordinates></LineString>`;
  const kml = (...placemarks: string[]) => `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document>${placemarks.map((p) => `<Placemark>${p}</Placemark>`).join('')}</Document></kml>`;
  const one = track(31);
  const base = () => analyzeRide(kml(`<name>a</name>${gxTrack(one)}`), fakeIgn(true));

  it('KML : gx:Track + LineString dans le même Placemark = une seule ligne', async () => {
    const single = await base();
    const dup = await analyzeRide(kml(`${lineString(track(31, 6.1, 0.00004))}${gxTrack(one)}`), fakeIgn(true));
    expect(dup.distanceM).toBe(single.distanceM);
    expect(dup.gainM).toBe(single.gainM);
    expect(dup.geometry.type).toBe('LineString');
    // the timed version is kept: times aligned with the geometry
    const n = (dup.geometry as { coordinates: unknown[] }).coordinates.length;
    expect(dup.times).toHaveLength(n);
  });

  it('KML : deux Placemark (LineString puis gx:Track) = une seule ligne, on garde l\'horodatée', async () => {
    const dup = await analyzeRide(kml(lineString(track(60, 6.1, 0.00003).filter((_, i) => i < 31)), gxTrack(one)), fakeIgn(true));
    expect(dup.distanceM).toBe((await base()).distanceM);
    expect(dup.times).not.toBeNull();
    expect(dup.movingSec).not.toBeNull();
  });

  it('GPX : deux <trk> identiques ne sont comptés qu\'une fois', async () => {
    const pts = one.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${p.t}</time></trkpt>`).join('');
    const single = await analyzeRide(`<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg>${pts}</trkseg></trk></gpx>`, fakeIgn(true));
    const dup = await analyzeRide(`<?xml version="1.0"?><gpx version="1.1" creator="t"><trk><trkseg>${pts}</trkseg></trk><trk><trkseg>${pts}</trkseg></trk></gpx>`, fakeIgn(true));
    expect(dup.distanceM).toBe(single.distanceM);
    expect(dup.gainM).toBe(single.gainM);
  });

  it('deux segments distincts qui se suivent restent additionnés', async () => {
    const a = track(31);
    const b = track(31, 6.1 + 31 * 0.00123); // continues right after
    const both = await analyzeRide(kml(`${gxTrack(a)}${gxTrack(b)}`), fakeIgn(true));
    const single = await base();
    expect(both.distanceM).toBeGreaterThan(single.distanceM * 1.9);
    expect(both.geometry.type).toBe('MultiLineString');
  });
});

describe('trimEnds (#1772)', () => {
  const pts = (n: number, dx = 0) => Array.from({ length: n }, (_, i) => [6.1 + dx + i * 0.00123, 43.2] as [number, number]); // 100 m steps
  const line = (n: number): TrackGeometry => ({ type: 'LineString', coordinates: pts(n) });
  it('retire 300 m de chaque côté (interpolé)', () => {
    const g = trimEnds(line(21), 300)! as { coordinates: [number, number][] }; // 2 km
    expect(g.coordinates[0][0]).toBeCloseTo(6.1 + 3 * 0.00123, 4);
    expect(g.coordinates[g.coordinates.length - 1][0]).toBeCloseTo(6.1 + 17 * 0.00123, 4);
  });
  it('trace trop courte (≤ 600 m) : rien à montrer', () => {
    expect(trimEnds(line(7), 300)).toBeNull(); // 600 m
    expect(trimEnds(line(2), 300)).toBeNull();
  });
  it('MultiLineString : coupe le début de la première ligne et la fin de la dernière', () => {
    const a = pts(11);
    const b = pts(11, 0.02);
    const g = trimEnds({ type: 'MultiLineString', coordinates: [a, b] }, 300)!;
    expect(g.type).toBe('MultiLineString');
    const c = (g as { coordinates: [number, number][][] }).coordinates;
    expect(c[0][0][0]).toBeCloseTo(6.1 + 3 * 0.00123, 4);
    expect(c[1][c[1].length - 1][0]).toBeCloseTo(6.12 + 7 * 0.00123, 4);
  });
});
