import { describe, expect, it } from 'vitest';
import { osmWayUrl, scaleLevel, singleInfo, surfaceKey } from '@/lib/osm/single-info';
import { wayToSegment } from '@/lib/osm/singles';

describe('single tooltip helpers (#1687)', () => {
  it('reads mtb:scale levels, clamped to S5', () => {
    expect(scaleLevel('2')).toBe(2);
    expect(scaleLevel('1+')).toBe(1);
    expect(scaleLevel('6')).toBe(5);
    expect(scaleLevel('x')).toBeNull();
    expect(scaleLevel(null)).toBeNull();
  });
  it('maps surfaces, raw fallback when unknown', () => {
    expect(surfaceKey('gravel')).toBe('gravel');
    expect(surfaceKey('Dirt;gravel')).toBe('dirt');
    expect(surfaceKey('weird')).toBeNull();
    expect(surfaceKey(undefined)).toBeNull();
  });
  it('builds the OSM link', () => {
    expect(osmWayUrl('way/123')).toBe('https://www.openstreetmap.org/way/123');
    expect(osmWayUrl('node/1')).toBeNull();
  });
  it('builds the display data', () => {
    const i = singleInfo({ id: 'way/9', difficulty: 'red', scale: '2', name: ' ', surface: 'ground', uphill: '1', lengthM: 1530 });
    expect(i).toMatchObject({ name: null, level: 2, uphillLevel: 1, surface: 'ground', lengthKm: 1.53, url: 'https://www.openstreetmap.org/way/9' });
  });
  it('keeps surface and mtb:scale:uphill at sync', () => {
    const seg = wayToSegment({ type: 'way', id: 1, tags: { highway: 'path', 'mtb:scale': '1', surface: 'dirt', 'mtb:scale:uphill': '2' }, geometry: [{ lat: 43, lon: 6 }, { lat: 43.001, lon: 6 }] });
    expect(seg).toMatchObject({ surface: 'dirt', mtbScaleUphill: '2' });
  });
});
