import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { TrackGeometry } from '@/lib/geo';
import { parseKmlFile, kmlFromKmz, parseTrackFile, toKml, toGpx, geometryStats } from '@/lib/geo';

const bytes = (n: string) => fs.readFileSync(path.join(__dirname, 'fixtures/kml', n));
const read = (n: string) => bytes(n).toString('utf8');

describe('import KML / KMZ', () => {
  it('Google My Maps : une trace par Placemark ligne, points ignorés, altitude 0 écartée, HTML nettoyé', () => {
    const f = parseKmlFile(read('google-my-maps.kml'));
    expect(f.tracks.map((t) => t.name)).toEqual(['Boucle du Fenouillet', 'Deux tronçons']);
    expect(f.tracks[0].description).toBe('Single sympa\ndépart parking');
    expect(f.tracks[0].geometry.type).toBe('LineString');
    expect(geometryStats(f.tracks[0].geometry).gainM).toBeNull();
    expect(f.tracks[1].geometry.type).toBe('MultiLineString');
    const g1 = f.tracks[1].geometry;
    expect(g1.type === 'MultiLineString' && g1.coordinates[0][0][2]).toBe(120);
  });
  it('Google Earth : gx:Track avec altitude', () => {
    const f = parseKmlFile(read('google-earth-gxtrack.kml'));
    expect(f.tracks).toHaveLength(1);
    const g = f.tracks[0].geometry;
    expect(g.type === 'LineString' && g.coordinates).toEqual([[6.15, 43.2, 100], [6.155, 43.204, 140], [6.16, 43.21, 180]]);
  });
  it('KMZ : même résultat que le KML', () => {
    const kmz = bytes('google-my-maps.kmz');
    expect(kmlFromKmz(kmz)).toBe(read('google-my-maps.kml'));
    expect(parseTrackFile('x.KMZ', kmz).tracks).toHaveLength(2);
  });
  it('refuse DOCTYPE/ENTITY, non-KML, KMZ illisible, extension inconnue', () => {
    expect(() => parseKmlFile(read('malicieux.kml'))).toThrow('doctype');
    expect(() => parseKmlFile('<gpx></gpx>')).toThrow('notGpx');
    expect(() => parseKmlFile('<kml><Document><Placemark><Point><coordinates>6,43</coordinates></Point></Placemark></Document></kml>')).toThrow('noTrack');
    expect(() => kmlFromKmz(Buffer.from('pas un zip'))).toThrow('unreadable');
    expect(() => parseTrackFile('a.txt', Buffer.from(''))).toThrow('notGpxExt');
  });
  it('GPX toujours accepté par parseTrackFile', () => {
    const g: TrackGeometry = { type: 'LineString', coordinates: [[6, 43], [6.1, 43.1]] };
    const gpx = toGpx({ name: 'T', geometry: g });
    expect(parseTrackFile('a.gpx', Buffer.from(gpx)).tracks).toHaveLength(1);
  });
});

describe('export KML', () => {
  const geometry: TrackGeometry = { type: 'LineString', coordinates: [[6.15, 43.2, 100], [6.16, 43.21, 140]] };
  it('relit ce qu’il écrit, avec attribution, licence et échappement', () => {
    const kml = toKml({ name: 'A & <B>', description: 'desc', attribution: '© OpenStreetMap contributors', license: 'ODbL', geometry });
    expect(kml).toContain('<altitudeMode>absolute</altitudeMode>');
    expect(kml).toContain('© OpenStreetMap contributors');
    expect(kml).toContain('Licence : ODbL');
    expect(kml).not.toContain('gx:Track');
    const back = parseKmlFile(kml);
    expect(back.tracks[0].name).toBe('A & <B>');
    expect(back.tracks[0].geometry).toEqual(geometry);
  });
  it('sans altitude : clampToGround, multi-lignes en MultiGeometry', () => {
    const g: TrackGeometry = { type: 'MultiLineString', coordinates: [[[6, 43], [6.1, 43.1]], [[6.2, 43.2], [6.3, 43.3]]] };
    const kml = toKml({ name: 'M', geometry: g });
    expect(kml).toContain('clampToGround');
    expect(kml).toContain('<MultiGeometry>');
    expect(parseKmlFile(kml).tracks[0].geometry.type).toBe('MultiLineString');
  });
  it('couleur de ligne lue sur le token primary (aabbggrr)', () => {
    expect(toKml({ name: 'x', geometry })).toContain('<color>ff5c3a2a</color>');
  });
});

