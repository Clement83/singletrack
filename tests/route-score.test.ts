import { describe, expect, it, vi } from 'vitest';
import { chooseRoute, climbPenaltyPer100m, scoreRoute, type Rider } from '@/lib/routing/score';
import { candidateRequests, routeBetween, routeScored } from '@/lib/routing/brouter';
import type { Position } from '@/lib/geo';

/** Simulated IGN outage: routing keeps the BRouter elevation (no network call in tests). */
const noIgn = { fetchFn: async () => ({ ok: false, status: 503, json: async () => ({}) }), cache: new Map<string, number>(), intervalMs: 0 };

// Route scoring (#1385). Synthetic tracks due east, at latitude 43.2°.
const LON_PER_KM = 1 / (111.32 * Math.cos((43.2 * Math.PI) / 180));
/** Line made of segments [km, slope %] with a point every 50 m. */
function line(parts: [number, number][]): Position[] {
  const pts: Position[] = [[6, 43.2, 100]];
  let lon = 6;
  let ele = 100;
  for (const [km, g] of parts) {
    const n = Math.round((km * 1000) / 50);
    for (let i = 0; i < n; i++) {
      lon += 0.05 * LON_PER_KM;
      ele += 50 * (g / 100);
      pts.push([lon, 43.2, ele]);
    }
  }
  return pts;
}
const score = (parts: [number, number][], rider: Rider = 'muscle') => scoreRoute({ type: 'LineString', coordinates: line(parts) }, rider);
const pick = (a: [number, number][], b: [number, number][], rider: Rider = 'muscle') =>
  chooseRoute([{ route: 'court', score: score(a, rider) }, { route: 'détour', score: score(b, rider) }], rider).best.route;

describe('barème de montée', () => {
  it('100 m de D+ ≈ 1 km à 5 %, 2 km à 10 %, 4 km à 15 %', () => {
    expect(climbPenaltyPer100m(5, 'muscle')).toBeCloseTo(1);
    expect(climbPenaltyPer100m(10, 'muscle')).toBeCloseTo(2);
    expect(climbPenaltyPer100m(15, 'muscle')).toBeCloseTo(4);
  });
  it('sous le seuil, seule la distance compte', () => {
    expect(climbPenaltyPer100m(3.9, 'muscle')).toBe(0);
    expect(score([[3, 3]]).effortKm).toBe(0);
  });
  it('une montée à 6 % est pénalisée en musculaire et ignorée en VAE', () => {
    expect(score([[2, 6]], 'muscle').effortKm).toBeGreaterThan(0);
    expect(score([[2, 6]], 'ebike').effortKm).toBe(0);
  });
});

describe('détour proportionné à l’effort évité', () => {
  it('+10 km pour éviter 2 km à 4 % : refusé', () => {
    expect(pick([[2, 4], [3, 0]], [[15, 0]])).toBe('court');
  });
  it('+1 km pour éviter 1,5 km à 12 % : retenu', () => {
    expect(pick([[1.5, 12], [2, 0]], [[4.5, 0]])).toBe('détour');
  });
  it('une montée sous le seuil ne déclenche jamais de détour', () => {
    expect(pick([[3, 3.5]], [[3.2, 0]])).toBe('court');
  });
  it('VAE : la même montée moyenne ne justifie pas le détour', () => {
    expect(pick([[1.5, 6], [2, 0]], [[4.2, 0]], 'muscle')).toBe('détour');
    expect(pick([[1.5, 6], [2, 0]], [[4.2, 0]], 'ebike')).toBe('court');
  });
});

describe('candidats BRouter', () => {
  it('plus court (mtb) + profil du cycliste et ses alternatives', () => {
    expect(candidateRequests('muscle')).toEqual([
      { profile: 'mtb', alt: 0 }, { profile: 'singletrack', alt: 0 }, { profile: 'singletrack', alt: 1 }, { profile: 'singletrack', alt: 2 },
    ]);
    expect(candidateRequests('ebike')[1].profile).toBe('singletrack-vae');
  });
  it('garde le meilleur score et explique le détour ; un candidat en échec est ignoré', async () => {
    const steep = line([[1.5, 12], [2, 0]]);
    const flat = line([[4.5, 0]]);
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = new URL(String(url));
      const alt = u.searchParams.get('alternativeidx');
      const profile = u.searchParams.get('profile');
      if (profile === 'singletrack' && alt === '2') return new Response('no track found', { status: 400 });
      const coords = profile === 'mtb' ? steep : flat;
      return Response.json({ features: [{ geometry: { type: 'LineString', coordinates: coords } }] });
    });
    const r = await routeScored([6, 43.2], [6.05, 43.2], 'muscle', fetchMock as unknown as typeof fetch, noIgn);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(r.best.profile).toBe('singletrack');
    expect(r.note?.extraKm).toBeCloseTo(1, 1);
    expect(r.note?.gainSavedM).toBeGreaterThan(150);
  });
});

describe('altitude IGN sur les segments routés (#1516)', () => {
  const brouter = (coords: number[][]) => vi.fn(async () => Response.json({ features: [{ geometry: { type: 'LineString', coordinates: coords } }] })) as unknown as typeof fetch;
  const raw = [[6.0, 43.2, 100], [6.001, 43.2, 100], [6.002, 43.2, 100]];
  const ignOk = (ele: (lon: number) => number) => async (url: string) => {
    const lons = (new URL(url).searchParams.get('lon') ?? '').split('|').map(Number);
    return { ok: true, status: 200, json: async () => ({ elevations: lons.map(ele) }) };
  };

  it('remplace l’altitude BRouter par celle de l’IGN', async () => {
    const out = await routeBetween([6, 43.2], [6.002, 43.2], brouter(raw), 'mtb', 0, { fetchFn: ignOk((lon) => 200 + Math.round((lon - 6) * 1000) * 10), cache: new Map(), intervalMs: 0 });
    expect(out.map((p) => p[2])).toEqual([200, 210, 220]);
  });

  it('repli sur l’altitude BRouter si l’IGN est en panne', async () => {
    const down = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const out = await routeBetween([6, 43.2], [6.002, 43.2], brouter(raw), 'mtb', 0, { fetchFn: down, cache: new Map(), intervalMs: 0 });
    expect(out.map((p) => p[2])).toEqual([100, 100, 100]);
  });

  it('le D+ noté vient de l’IGN et le cache évite les rappels', async () => {
    const cache = new Map<string, number>();
    const fetchFn = vi.fn(ignOk((lon) => 100 + Math.round((lon - 6) / 0.0005) * 2));
    const flat = Array.from({ length: 41 }, (_, i) => [6 + i * 0.0005, 43.2, 100]);
    const b = brouter(flat);
    const r = await routeScored([6, 43.2], [6.02, 43.2], 'muscle', b, { fetchFn, cache, intervalMs: 0 });
    expect(r.best.score.gainM).toBeGreaterThan(50);
    const calls = fetchFn.mock.calls.length;
    await routeScored([6, 43.2], [6.02, 43.2], 'muscle', b, { fetchFn, cache, intervalMs: 0 });
    expect(fetchFn.mock.calls.length).toBe(calls);
  });
});
