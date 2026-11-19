import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEM_SOURCE,
  DEM_SOURCE_ID,
  TERRAIN,
  TERRAIN_PITCH,
  isDemTileUrl,
  terrainPitch,
} from '@/lib/map/terrain';

describe('relief 3D (#1667)', () => {
  it('source Terrarium AWS, terrain branché dessus', () => {
    expect(DEM_SOURCE.type).toBe('raster-dem');
    expect(DEM_SOURCE.encoding).toBe('terrarium');
    expect(DEM_SOURCE.maxzoom).toBe(15);
    expect(DEM_SOURCE.attribution).toContain('Mapzen');
    expect(TERRAIN.source).toBe(DEM_SOURCE_ID);
    expect(TERRAIN.exaggeration).toBeGreaterThan(1);
  });

  it('inclinée en 3D, à plat sinon', () => {
    expect(terrainPitch(true)).toBe(TERRAIN_PITCH);
    expect(terrainPitch(false)).toBe(0);
  });

  it('reconnaît les tuiles d’altitude, et le service worker les met en cache', () => {
    const tile = DEM_SOURCE.tiles![0].replace('{z}/{x}/{y}', '12/2120/1497');
    expect(isDemTileUrl(new URL(tile))).toBe(true);
    expect(isDemTileUrl(new URL('https://a.tile.opentopomap.org/12/2120/1497.png'))).toBe(false);
    expect(isDemTileUrl(new URL('https://s3.amazonaws.com/autre-bucket/x.png'))).toBe(false);
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toContain("'/elevation-tiles-prod/terrarium/'");
  });
});
