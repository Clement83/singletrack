export type MassifGeometry = { type: 'MultiPolygon'; coordinates: number[][][][] };

export type MassifFeature = {
  code: string;
  name: string;
  geometry: MassifGeometry;
};
