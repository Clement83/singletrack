'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Layer, Source, type MapLayerMouseEvent } from 'react-map-gl/maplibre';
import { X } from 'lucide-react';
import { formatKm } from '@/lib/format';
import { singleInfo, surfaceKey, type SingleInfo } from '@/lib/osm/single-info';
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
export function SinglesLayer({ state, colors, beforeId, dimmed = false, highlightId = null }: { state: SinglesState | null; colors: MapColors; beforeId?: string; dimmed?: boolean; highlightId?: string | null }) {
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
      {/* Highlight of the hovered / tapped single (#1687) */}
      <Layer id="singles-highlight" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} filter={['==', ['get', 'id'], highlightId ?? '']} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.primary, 'line-width': 7, 'line-opacity': 0.55 }} />
      {/* Wide invisible hit zone (≥ 22 px): finger-friendly, queried by the explorer. */}
      <Layer id="singles-hit" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.foreground, 'line-width': 22, 'line-opacity': 0 }} />
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

export type SingleTipState = { x: number; y: number; info: SingleInfo; pinned: boolean; touch: boolean } | null;
/** Layers that win over a single when they overlap (start points, clusters, open track). */
const PRIORITY_LAYERS = ['clusters', 'start-hit', 'open-casing'];

/**
 * Singles tooltip state (#1687). Mouse: hover shows it near the cursor, a click pins it (link usable, close button);
 * touch: a tap opens it, a tap elsewhere or the cross closes it. Nothing when `enabled` is false (a track or an
 * outing is open). Start points, clusters and tracks keep priority over a single.
 */
export function useSingleTip(enabled: boolean) {
  const [tip, setTip] = useState<SingleTipState>(null);
  const resolve = (e: MapLayerMouseEvent) => {
    const fs = e.features ?? [];
    if (fs.some((f) => PRIORITY_LAYERS.includes(f.layer.id))) return null;
    const f = fs.find((f) => f.layer.id === 'singles-hit');
    return f ? singleInfo(f.properties as Parameters<typeof singleInfo>[0]) : null;
  };
  const finePointer = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clear = useCallback(() => setTip(null), []);
  return {
    tip: enabled ? tip : null,
    clear,
    /** `onMouseMove`: hover (mouse only). */
    onMove: (e: MapLayerMouseEvent) => {
      if (!enabled || !finePointer()) return;
      const info = resolve(e);
      setTip((cur) => (cur?.pinned ? cur : info ? { x: e.point.x, y: e.point.y, info, pinned: false, touch: false } : null));
    },
    /** `onClick`: pins on a single, closes elsewhere. */
    onTap: (e: MapLayerMouseEvent) => {
      const info = enabled ? resolve(e) : null;
      setTip(info ? { x: e.point.x, y: e.point.y, info, pinned: true, touch: !finePointer() } : null);
    },
    /** `onMouseLeave`: a pinned tooltip stays. */
    onLeave: () => setTip((cur) => (cur?.pinned ? cur : null)),
  };
}

/** Tooltip of a single: name, difficulty explained, length, surface, uphill, OSM link and attribution. */
export function SingleTip({ tip, onClose }: { tip: SingleTipState; onClose: () => void }) {
  const t = useTranslations('singles');
  const locale = useLocale();
  if (!tip) return null;
  const { info } = tip;
  const surf = info.surface ? (surfaceKey(info.surface) ? t(`surface.${surfaceKey(info.surface)!}`) : info.surface) : null;
  const dot = info.difficulty === 'none' ? 'bg-map-unrated' : MAP_DOT[info.difficulty];
  const level = info.level !== null ? `S${info.level}` : null;
  const up = info.uphillLevel;
  const style = tip.touch ? undefined : { left: `min(${tip.x + 14}px, calc(100% - 304px))`, top: `min(${tip.y + 14}px, calc(100% - 280px))` };
  return (
    <div
      role="status"
      className={cn(
        'absolute z-20 w-72 max-w-[calc(100%-1.5rem)] rounded-2xl floating p-3 text-small text-popover-foreground',
        tip.touch ? 'inset-x-3 bottom-20 mx-auto' : tip.pinned ? '' : 'pointer-events-none',
      )}
      style={style}
    >
      {tip.pinned && (
        <button type="button" onClick={onClose} aria-label={t('tip.close')} className="press absolute top-0 right-0 flex size-11 items-center justify-center rounded-md text-muted-foreground">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <p className={cn('font-semibold', tip.pinned && 'pr-10')}>{info.name ?? t('tip.unnamed')}</p>
      <p className="mt-1 flex items-start gap-2">
        <span aria-hidden className={cn('mt-1.5 h-1 w-4 shrink-0 rounded-full ring-1 ring-map-casing', dot)} />
        <span>
          <span className="font-medium">{t(`levels.${info.difficulty}`)}{level ? ` · ${level}` : ''}</span>
          {info.level !== null && <span className="block text-muted-foreground">{t(`scale.${info.level as 0}`)}</span>}
        </span>
      </p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular-nums">
        <dt className="text-muted-foreground">{t('tip.length')}</dt>
        <dd>{formatKm(info.lengthKm, locale)}</dd>
        {surf && (<><dt className="text-muted-foreground">{t('tip.surface')}</dt><dd>{surf}</dd></>)}
        {up !== null && (<><dt className="text-muted-foreground">{t('tip.uphill')}</dt><dd>{`S${up} · ${t(`uphill.${up as 0}`)}`}</dd></>)}
      </dl>
      {tip.pinned && info.url && (
        <a href={info.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center font-medium text-primary underline-offset-2 hover:underline">
          {t('tip.osm')}
        </a>
      )}
      <p className="mt-1 text-muted-foreground">{t('tip.attribution')}</p>
    </div>
  );
}
