import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '@/db';
import { parseGpxFile, geometryStats } from '@/lib/geo';
import { buildImportedTrack, findDuplicates, prefillFromGpx, upsertTrack } from '@/lib/tracks';

const read = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures/gpx', n), 'utf8');

describe('import GPX', () => {
  it('Utagawa : métadonnées, altitude conservée, pré-remplissage', () => {
    const f = parseGpxFile(read('utagawa-boucle-pierrefeu.gpx'));
    expect(f.tracks).toHaveLength(1);
    expect(f.tracks[0].name).toBe('Boucle des Maurels');
    expect(f.tracks[0].description).toContain('single');
    expect(geometryStats(f.tracks[0].geometry).gainM).toBeGreaterThan(40);
    expect(prefillFromGpx(f)).toMatchObject({ origin: 'utagawa', author: 'Jean D.', sourceUrl: expect.stringContaining('utagawavtt.com') });
  });
  it('Garmin : deux segments → MultiLineString, origine perso', () => {
    const f = parseGpxFile(read('montre-garmin-deux-segments.gpx'));
    expect(f.tracks[0].geometry.type).toBe('MultiLineString');
    expect(prefillFromGpx(f).origin).toBe('perso');
  });
  it('Visorando : <rte> sans altitude', () => {
    const f = parseGpxFile(read('visorando-route-sans-altitude.gpx'));
    expect(f.tracks[0].name).toBe('Les crêtes & vallons');
    expect(geometryStats(f.tracks[0].geometry).gainM).toBeNull();
    expect(prefillFromGpx(f).origin).toBe('visorando');
  });
  it('refuse un non-GPX, un GPX vide et un DOCTYPE', () => {
    expect(() => parseGpxFile('<html/>')).toThrow();
    expect(() => parseGpxFile('<gpx><trk><trkseg></trkseg></trk></gpx>')).toThrow();
    expect(() => parseGpxFile('<!DOCTYPE x [<!ENTITY a "b">]><gpx/>')).toThrow();
  });
  it('plusieurs <trk> → plusieurs traces', () => {
    const t = '<trkseg><trkpt lat="43" lon="6"/><trkpt lat="43.01" lon="6"/></trkseg>';
    expect(parseGpxFile(`<gpx><trk><name>A</name>${t}</trk><trk><name>B</name>${t}</trk></gpx>`).tracks.map((x) => x.name)).toEqual(['A', 'B']);
  });

  it('attribution obligatoire hors trace perso, Utagawa cité', () => {
    const geometry = parseGpxFile(read('utagawa-boucle-pierrefeu.gpx')).tracks[0].geometry;
    const bad = buildImportedTrack({ name: 'X', origin: 'utagawa', geometry });
    expect(bad).toHaveProperty('errors.sourceUrl');
    expect(bad).toHaveProperty('errors.author');
    expect(bad).toHaveProperty('errors.license');
    const ok = buildImportedTrack({ name: 'X', origin: 'utagawa', sourceUrl: 'https://www.utagawavtt.com/x', author: 'Jean', license: 'CC BY-NC', geometry });
    expect('track' in ok && ok.track).toMatchObject({ source: 'gpx', attribution: 'Source : UtagawaVTT.com — Jean', externalId: null });
    expect(buildImportedTrack({ name: 'Perso', origin: 'perso', geometry })).toHaveProperty('track.attribution', null);
    expect(buildImportedTrack({ name: ' ', origin: 'perso', geometry })).toHaveProperty('errors.name');
  });

  it('enregistre avec created_by et avertit des doublons sans bloquer', async () => {
    const { db, sqlite } = openDb(':memory:');
    sqlite.prepare("insert into user (id,name,email,email_verified,created_at,updated_at) values ('u','U','u@x.fr',1,0,0)").run();
    const geometry = parseGpxFile(read('utagawa-boucle-pierrefeu.gpx')).tracks[0].geometry;
    expect(findDuplicates(db, geometry)).toHaveLength(0);
    const b = buildImportedTrack({ name: 'Perso', origin: 'perso', geometry });
    if (!('track' in b)) throw new Error('invalide');
    const r1 = await upsertTrack(db, { ...b.track, createdBy: 'u' }, { enrich: false });
    expect(findDuplicates(db, geometry).map((d) => d.slug)).toEqual([r1.slug]);
    const far = parseGpxFile(read('visorando-route-sans-altitude.gpx')).tracks[0].geometry;
    expect(findDuplicates(db, far)).toHaveLength(0);
    const r2 = await upsertTrack(db, { ...b.track, createdBy: 'u' }, { enrich: false });
    expect(r2.created).toBe(true); // null externalId: never blocked
    const row = sqlite.prepare('select source, created_by from track where slug=?').get(r1.slug);
    expect(row).toEqual({ source: 'gpx', created_by: 'u' });
  });
});
