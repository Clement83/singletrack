import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import type { MassifFeature } from './types';

/** Reads `massifs_83.fgb` (FlatGeoBuf) → one massif per feature (`ID`, `NOM_MASSIF`, MultiPolygon). */
export async function readMassifsFgb(buf: ArrayBuffer | Uint8Array): Promise<MassifFeature[]> {
  const out: MassifFeature[] = [];
  for await (const f of deserialize(buf instanceof Uint8Array ? buf : new Uint8Array(buf)) as AsyncIterable<{
    properties: { ID?: number | string; NOM_MASSIF?: string } | null;
    geometry: { type: string; coordinates: number[][][][] | number[][][] };
  }>) {
    const code = String(f.properties?.ID ?? '');
    if (!code || !f.properties?.NOM_MASSIF) continue;
    const g = f.geometry;
    const coordinates = g.type === 'Polygon' ? [g.coordinates as number[][][]] : (g.coordinates as number[][][][]);
    out.push({ code, name: f.properties.NOM_MASSIF, geometry: { type: 'MultiPolygon', coordinates } });
  }
  return out;
}
