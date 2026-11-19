import { DIFFICULTIES } from '@/db/schema';
import type { Difficulty } from './difficulty';

/** Explorer filters, serialised in the URL (`?q=…&dist=10-40&…`): shareable, back button. */
export type TrackFilters = {
  q?: string;
  minKm?: number;
  maxKm?: number;
  minGain?: number;
  maxGain?: number;
  difficulty?: Difficulty[];
  /** `loop` = loops only, `oneway` = one-way only. */
  shape?: 'loop' | 'oneway';
  /** Radius (km) around home. */
  near?: number;
  /** Only tracks none of whose crossed massifs is closed (red/black) today or tomorrow (#1349). */
  access?: 'today' | 'tomorrow';
  /** Only the signed-in user's tracks (created, copied, imported, #1430). */
  mine?: boolean;
  bbox?: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
};

const num = (v: string | null) => {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const list = <T extends string>(v: string | null, allowed: readonly T[]): T[] | undefined => {
  const out = (v ?? '').split(',').filter((x): x is T => (allowed as readonly string[]).includes(x));
  return out.length ? out : undefined;
};

export function parseFilters(sp: URLSearchParams): TrackFilters {
  const f: TrackFilters = {};
  const q = sp.get('q')?.trim();
  if (q) f.q = q.slice(0, 80);
  f.minKm = num(sp.get('minKm'));
  f.maxKm = num(sp.get('maxKm'));
  f.minGain = num(sp.get('minGain'));
  f.maxGain = num(sp.get('maxGain'));
  f.difficulty = list(sp.get('difficulty'), DIFFICULTIES);
  const shape = sp.get('shape');
  if (shape === 'loop' || shape === 'oneway') f.shape = shape;
  f.near = num(sp.get('near'));
  const access = sp.get('access');
  if (access === 'today' || access === 'tomorrow') f.access = access;
  if (sp.get('mine') === '1') f.mine = true;
  const bb = sp.get('bbox')?.split(',').map(Number);
  if (bb?.length === 4 && bb.every(Number.isFinite)) f.bbox = bb as [number, number, number, number];
  for (const k of Object.keys(f) as (keyof TrackFilters)[]) if (f[k] === undefined) delete f[k];
  return f;
}

export function serializeFilters(f: TrackFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set('q', f.q);
  for (const k of ['minKm', 'maxKm', 'minGain', 'maxGain', 'near'] as const) if (f[k] !== undefined) sp.set(k, String(f[k]));
  if (f.difficulty?.length) sp.set('difficulty', f.difficulty.join(','));
  if (f.shape) sp.set('shape', f.shape);
  if (f.access) sp.set('access', f.access);
  if (f.mine) sp.set('mine', '1');
  if (f.bbox) sp.set('bbox', f.bbox.join(','));
  return sp;
}

/** Number of active filters (excluding the map extent), for the badge of the "Filters" button. */
export function activeFilterCount(f: TrackFilters): number {
  const { bbox: _bbox, ...rest } = f;
  void _bbox;
  const groups = [rest.q, rest.minKm ?? rest.maxKm, rest.minGain ?? rest.maxGain, rest.difficulty, rest.shape, rest.near, rest.access, rest.mine];
  return groups.filter((g) => g !== undefined).length;
}
