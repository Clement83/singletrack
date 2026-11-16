import { describe, it, expect } from 'vitest';
import { config, parseDataSources, parseSyncZones, DATA_SOURCE_NAMES } from '@/lib/config';
import { parseZones, fireApplies, huntingApplies } from '@/lib/osm/zones';

describe('config', () => {
  it('a un point maison neutre par défaut (centre de la France), surchargé par .env', () => {
    expect(Number.isFinite(config.homeLat) && Number.isFinite(config.homeLon)).toBe(true);
  });

  it('expose un lien « Code source » (AGPL §13)', () => {
    expect(config.sourceUrl).toMatch(/^https:\/\//);
  });

  it('DATA_SOURCES : vide = toutes, sinon seulement celles listées, inconnues ignorées', () => {
    expect([...parseDataSources(undefined)]).toEqual([...DATA_SOURCE_NAMES]);
    expect([...parseDataSources(' ')]).toEqual([...DATA_SOURCE_NAMES]);
    expect([...parseDataSources('osm, OpenMeteo ,bidule,openmeteo')]).toEqual(['osm', 'openmeteo']);
  });

  it('SYNC_ZONES : virgules et espaces', () => {
    expect(parseSyncZones('83, 06 2A')).toEqual(['83', '06', '2A']);
    expect(parseSyncZones(undefined)).toEqual([]);
  });

  it('les zones de synchro viennent des arguments, sinon de SYNC_ZONES, sinon de toute la France', () => {
    expect(parseZones(['06'], ['83']).zones).toEqual(['06']);
    expect(parseZones([], ['83', '6']).zones).toEqual(['83', '06']);
    expect(parseZones([], []).zones).toHaveLength(96);
    expect(parseZones(['all'], ['83']).zones).toHaveLength(96);
  });

  it('incendie et chasse : Var seulement', () => {
    expect(fireApplies(6.15, 43.23)).toBe(true);
    expect(huntingApplies(6.15, 43.23)).toBe(true);
    expect(fireApplies(2.35, 48.85)).toBe(false);
    expect(huntingApplies(2.35, 48.85)).toBe(false);
  });
});
