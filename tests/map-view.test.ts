import { describe, expect, it } from 'vitest';
import { parseMapView, parseOpenTrack, viewChanged, viewQuery, writeMapView } from '@/lib/tracks/map-view';

const sp = (s: string) => new URLSearchParams(s);

describe('vue de la carte dans l’URL (#1577)', () => {
  it('lit z/lat/lng', () => {
    expect(parseMapView(sp('z=12.5&lat=43.12346&lng=6.1'))).toEqual({ z: 12.5, lat: 43.1235, lng: 6.1 });
  });
  it('sans paramètre ou invalide : null (vue par défaut)', () => {
    expect(parseMapView(sp(''))).toBeNull();
    expect(parseMapView(sp('z=12&lat=43'))).toBeNull();
    expect(parseMapView(sp('z=abc&lat=43&lng=6'))).toBeNull();
    expect(parseMapView(sp('z=12&lat=143&lng=6'))).toBeNull();
    expect(parseMapView(sp('z=99&lat=43&lng=6'))).toBeNull();
  });
  it('sérialise avec précision limitée et conserve les autres paramètres', () => {
    const p = writeMapView(sp('sel=a'), { z: 11.23456, lat: 43.123456, lng: 6.987654 });
    expect(p.toString()).toBe('sel=a&z=11.23&lat=43.1235&lng=6.9877');
    expect(parseMapView(p)).toEqual({ z: 11.23, lat: 43.1235, lng: 6.9877 });
  });
  it('viewQuery', () => {
    expect(viewQuery(null)).toBe('');
    expect(viewQuery({ z: 10, lat: 43, lng: 6 }, '123e4567-e89b-42d3-a456-426614174000')).toBe('z=10&lat=43&lng=6&t=123e4567-e89b-42d3-a456-426614174000');
  });
  it('seuil de changement', () => {
    const v = { z: 10, lat: 43, lng: 6 };
    expect(viewChanged(v, { ...v, lat: 43.00001 })).toBe(false);
    expect(viewChanged(v, { ...v, lat: 43.001 })).toBe(true);
    expect(viewChanged(v, { ...v, z: 10.5 })).toBe(true);
    expect(viewChanged(null, v)).toBe(true);
  });
  it('trace ouverte', () => {
    expect(parseOpenTrack(sp('t=123e4567-e89b-42d3-a456-426614174000'))).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(parseOpenTrack(sp('t=<x>'))).toBeNull();
    expect(parseOpenTrack(sp(''))).toBeNull();
  });
});
