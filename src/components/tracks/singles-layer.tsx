'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Layer, Source } from 'react-map-gl/maplibre';
import { cn } from '@/lib/utils';
import { DIFFICULTY } from '@/lib/design/scales';
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

/** Préférence d'affichage des singles (#1436) : active par défaut, mémorisée en localStorage (pas dans l'URL). */
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
      /* stockage indisponible : le réglage vaut pour cet appel seulement */
    }
    window.dispatchEvent(new Event(PREF_EVENT));
  }, []);
  return [on, set];
}

type Loaded = { status: 'ok'; truncated: boolean; features: SegmentFeature[] };
const cache = new Map<string, Loaded>();
const CACHE_MAX = 60;

/** Emprise alignée sur une grille (tuiles) : un petit déplacement retombe sur la même clé, donc sur le cache. */
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
 * Calque des singles OSM (#1372, #1436) : quand il est activé, charge les segments de la vue (alignée sur une
 * grille, cache client, debounce 300 ms, requête annulée si la carte rebouge). Sous le zoom minimal : rien n'est
 * demandé ni affiché. Les segments précédents restent affichés pendant le chargement (pas de clignotement).
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

/** Lignes fines en pointillés (≠ traces, pleines), couleur de difficulté, sous les traces. */
export function SinglesLayer({ state, colors, beforeId }: { state: SinglesState | null; colors: MapColors; beforeId?: string }) {
  if (state?.status !== 'ok') return null;
  const color: unknown = [
    'match', ['get', 'difficulty'],
    'green', colors.green, 'blue', colors.blue, 'red', colors.red, 'black', colors.black,
    colors.muted,
  ];
  return (
    <Source id="singles" type="geojson" data={{ type: 'FeatureCollection', features: state.features } as never} attribution={OSM_ATTRIBUTION}>
      <Layer id="singles-casing" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 3.5, 'line-opacity': 0.35 }} />
      <Layer id="singles-line" type="line" minzoom={SINGLES_MIN_ZOOM} beforeId={beforeId} layout={{ 'line-join': 'round' }} paint={{ 'line-color': color as string, 'line-width': 1.6, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] }} />
    </Source>
  );
}

const LEVELS = ['green', 'blue', 'red', 'black'] as const;

/** Légende des difficultés (couleur toujours accompagnée de son libellé), dans le panneau de filtres. */
export function SinglesLegend({ className }: { className?: string }) {
  const t = useTranslations('singles');
  return (
    <div className={className}>
      <p className="sr-only">{t('legend')}</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small">
        {LEVELS.map((l) => (
          <li key={l} className="flex items-center gap-1.5">
            <span aria-hidden className={cn('h-1 w-4 rounded-full', DIFFICULTY[l].dot)} />
            {t(`levels.${l}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Seules indications utiles sur la carte : erreur et « tronqué ». Rien sous le zoom minimal, ni pendant le chargement. */
export function SinglesStatus({ state, className }: { state: SinglesState | null; className?: string }) {
  const t = useTranslations('singles');
  if (state?.status !== 'error' && !(state?.status === 'ok' && state.truncated)) return null;
  return (
    <div className={cn('rounded-2xl bg-card/95 px-3 py-2 text-small shadow-md', className)} aria-live="polite">
      {state.status === 'error' ? <p className="text-destructive">{t('error')}</p> : <p className="text-muted-foreground">{t('truncated')}</p>}
    </div>
  );
}
