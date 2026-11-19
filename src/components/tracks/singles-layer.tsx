'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Layer, Source } from 'react-map-gl/maplibre';
import { cn } from '@/lib/utils';
import { OSM_ATTRIBUTION } from '@/lib/osm/relation';
import { SINGLES_MIN_ZOOM } from '@/lib/osm/singles';
import type { SegmentFeature } from '@/lib/osm/singles-store';
import type { MapColors } from './use-map-colors';

type View = [number, number, number, number];
export type SinglesState =
  | { status: 'loading' }
  | { status: 'zoom_in' }
  | { status: 'error' }
  | { status: 'ok'; truncated: boolean; features: SegmentFeature[] };

const PREF_KEY = 'singletrack.singles';
const PREF_EVENT = 'singletrack:singles-pref';

/** Singletrack display preference (#1436): on by default, remembered in localStorage (not in the URL). */
export function useSinglesPref(): [boolean, (v: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => {
      window.addEventListener(PREF_EVENT, cb);
      window.addEventListener('storage', cb);
      return () => {
        window.removeEventListener(PREF_EVENT, cb);
        window.removeEventListener('storage', cb);
      };
    },
    () => {
      try {
        return localStorage.getItem(PREF_KEY) !== 'off';
      } catch {
        return true;
      }
    },
    () => true,
  );
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(PREF_KEY, v ? 'on' : 'off');
    } catch {
      /* storage unavailable: the setting only applies to this call */
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);
  return [on, set];
}

type Loaded = { status: 'ok'; truncated: boolean; features: SegmentFeature[] };
const cache = new Map<string, Loaded>();
const CACHE_MAX = 60;

/** Extent aligned on a grid (tiles): a small move lands on the same key, hence on the cache. */
export function snapView(view: View, zoom: number): { key: string; bbox: View } {
  const step = zoom >= 14 ? 0.02 : zoom >= 12.5 ? 0.04 : 0.08;
  const bbox: View = [
    Math.floor(view[0] / step) * step,
    Math.floor(view[1] / step) * step,
    Math.ceil(view[2] / step) * step,
    Math.ceil(view[3] / step) * step,
  ];
  const k = bbox.map((n) => n.toFixed(4)).join(',');
  return { key: `${k}&zoom=${Math.floor(zoom)}`, bbox };
}

/**
 * OSM singletrack layer (#1372, #1436): when on, loads the segments of the view (aligned on a
 * grid, client cache, 300 ms debounce, request cancelled if the map moves again). Below the minimum zoom: nothing is
 * requested or shown. The previous segments stay displayed while loading (no flicker).
 */
export function useSingles(on: boolean, view: View | null, zoom: number): SinglesState | null {
  const [state, setState] = useState<SinglesState | null>(null);
  const tooFar = zoom < SINGLES_MIN_ZOOM;
  const key = view && !tooFar ? snapView(view, zoom).key : null;
  useEffect(() => {
    if (!on || !key) return;
    if (cache.has(key)) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/tracks/segments?bbox=${key}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { status: 'ok' | 'zoom_in'; truncated?: boolean; features: SegmentFeature[] }) => {
          if (d.status !== 'ok') return setState({ status: 'zoom_in' });
          const loaded: Loaded = { status: 'ok', truncated: !!d.truncated, features: d.features };
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
          cache.set(key, loaded);
          setState(loaded);
        })
        .catch((e) => e.name !== 'AbortError' && setState({ status: 'error' }));
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [on, key]);
  if (!on || tooFar) return null;
  return (key && cache.get(key)) || state || { status: 'loading' };
}

/** True when the segment has a difficulty (mtb:scale). */
const RATED = ['has', 'difficulty'];

/**
 * OSM singletracks (#1372, #1675): solid line coloured by difficulty, width growing with zoom, light casing that
 * reads on the topo map. Unrated segments are thinner, grey and fainter. `dimmed` (a track or an outing is open,
 * coloured by slope) fades the singles so the two palettes do not mix. Always under start points and tracks
 * (`beforeId`). Colours come from the `map-*` tokens: the topo map stays light in dark mode.
 */
export function SinglesLayer({ state, colors, beforeId, dimmed = false }: { state: SinglesState | null; colors: MapColors; beforeId?: string; dimmed?: boolean }) {
  if (state?.status !== 'ok') return null;
  const color: unknown = [
    'match', ['get', 'difficulty'],
    'green', colors.mapGreen, 'blue', colors.mapBlue, 'red', colors.mapRed, 'black', colors.mapBlack,
    colors.unrated,
  ];
  const width: unknown = ['interpolate', ['linear'], ['zoom'], SINGLES_MIN_ZOOM, ['case', RATED, 2.5, 1.5], 14, ['case', RATED, 3.5, 2], 17, ['case', RATED, 5, 2.5]];
  const casingWidth: unknown = ['interpolate', ['linear'], ['zoom'], SINGLES_MIN_ZOOM, ['case', RATED, 4.5, 3], 14, ['case', RATED, 6, 3.5], 17, ['case', RATED, 8, 4.5]];
  const opacity: unknown = ['case', RATED, dimmed ? 0.35 : 1, dimmed ? 0.2 : 0.6];
  return (
    <Source id="singles" type="geojson" data={{ type: 'FeatureCollection', features: state.features } as never} attribution={OSM_ATTRIBUTION}>
      <Layer id="singles-casing" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.casing, 'line-width': casingWidth as number, 'line-opacity': dimmed ? 0.3 : 0.85 }} />
      <Layer id="singles-line" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': color as string, 'line-width': width as number, 'line-opacity': opacity as number }} />
    </Source>
  );
}

const LEVELS = ['green', 'blue', 'red', 'black'] as const;
/** Same colours as the map lines (`map-*` tokens), not the themed UI dots. */
const MAP_DOT = { green: 'bg-map-diff-green', blue: 'bg-map-diff-blue', red: 'bg-map-diff-red', black: 'bg-map-diff-black' } as const;

/** Difficulty legend (colour always with its label), in the filters panel. */
export function SinglesLegend({ className }: { className?: string }) {
  const t = useTranslations('singles');
  return (
    <div className={className}>
      <p className="sr-only">{t('legend')}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small">
        {LEVELS.map((l) => (
          <li key={l} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('h-1 w-4 rounded-full ring-1 ring-map-casing', MAP_DOT[l])} />
            {t(`levels.${l}`)}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-map-unrated ring-1 ring-map-casing opacity-60" />
          {t('levels.none')}
        </li>
      </ul>
    </div>
  );
}

/** The only useful indications on the map: error and "truncated". Nothing below the minimum zoom, nor while loading. */
export function SinglesStatus({ state, className }: { state: SinglesState | null; className?: string }) {
  const t = useTranslations('singles');
  if (state?.status !== 'error' && !(state?.status === 'ok' && state.truncated)) return null;
  return (
    <div className={cn('rounded-2xl bg-card/95 px-3 py-2 text-small shadow-md', className)} aria-live="polite">
      {state.status === 'error' ? <p className="text-destructive">{t('error')}</p> : <p className="text-muted-foreground">{t('truncated')}</p>}
    </div>
  );
}
