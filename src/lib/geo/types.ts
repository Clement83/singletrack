/** GeoJSON position: `[lon, lat]` or `[lon, lat, ele]`. */
export type Position = [number, number] | [number, number, number];

export type LineString = { type: 'LineString'; coordinates: Position[] };
export type MultiLineString = { type: 'MultiLineString'; coordinates: Position[][] };
export type TrackGeometry = LineString | MultiLineString;

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };
