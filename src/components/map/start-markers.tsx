'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import { Bike } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { RING_KEYS, clusterSize, countLabel, countsOf, ringArcs, totalOf, type Counts, type RingKey } from '@/lib/tracks/cluster-ring';
import { cn } from '@/lib/utils';

/** What the map currently shows of the `starts` source: a cluster (with its difficulty counters) or one start. */
export type StartItem =
  | { kind: 'cluster'; key: string; id: number; lng: number; lat: number; counts: Counts; count: number }
  | { kind: 'start'; key: string; slug: string; difficulty: string; lng: number; lat: number };

/** Safety net for very dense views: clustering (50 px radius) already bounds the count to the screen. */
const MAX_MARKERS = 250;

/**
 * Clusters and start points drawn as HTML markers (#1688): the map style has no glyphs (no text on a MapLibre
 * layer), and the count is the point. Only what is on screen is rendered: `querySourceFeatures` on the clustered
 * source, filtered by the view and deduplicated (a feature appears once per tile), refreshed when the map stops
 * moving or when the source data changes. React keys recycle the DOM nodes.
 */
export function useStartItems(mapRef: React.RefObject<MapRef | null>, ...deps: unknown[]): StartItem[] {
  const [items, setItems] = useState<StartItem[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map || !map.getSource('starts')) return;
    const b = map.getBounds();
    const seen = new Map<string, StartItem>();
    for (const f of map.querySourceFeatures('starts')) {
      if (f.geometry.type !== 'Point') continue;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      if (lng < b.getWest() || lng > b.getEast() || lat < b.getSouth() || lat > b.getNorth()) continue;
      const p = f.properties ?? {};
      if (p.cluster) {
        const counts = countsOf(p);
        const key = `c${p.cluster_id}`;
        seen.set(key, { kind: 'cluster', key, id: Number(p.cluster_id), lng, lat, counts, count: Number(p.point_count) || totalOf(counts) });
      } else if (p.slug) {
        const key = `s${p.slug}`;
        seen.set(key, { kind: 'start', key, slug: String(p.slug), difficulty: String(p.difficulty ?? 'none'), lng, lat });
      }
      if (seen.size >= MAX_MARKERS) break;
    }
    setItems([...seen.values()]);
  }, [mapRef]);

  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const later = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 60);
    };
    const onData = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === 'starts' && e.isSourceLoaded) later();
    };
    map.on('moveend', later);
    map.on('sourcedata', onData);
    later();
    return () => {
      map.off('moveend', later);
      map.off('sourcedata', onData);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, refresh, ...deps]);
  return items;
}

const arcFill = (k: RingKey) => (k === 'none' ? 'var(--map-unrated)' : `var(--diff-${k})`);

export function StartMarkers({
  items,
  highlighted,
  onCluster,
  onStart,
  onHover,
}: {
  items: StartItem[];
  highlighted: string;
  onCluster: (item: Extract<StartItem, { kind: 'cluster' }>) => void;
  onStart: (item: Extract<StartItem, { kind: 'start' }>) => void;
  onHover: (slug: string | null) => void;
}) {
  return items.map((it) =>
    it.kind === 'cluster' ? (
      <ClusterMarker key={it.key} item={it} onClick={() => onCluster(it)} />
    ) : (
      <StartPin key={it.key} item={it} hl={highlighted === it.slug} onClick={() => onStart(it)} onHover={onHover} />
    ),
  );
}

function ClusterMarker({ item, onClick }: { item: Extract<StartItem, { kind: 'cluster' }>; onClick: () => void }) {
  const t = useTranslations('explorer');
  const tDiff = useTranslations('scales.difficulty');
  const size = clusterSize(item.count);
  const thickness = 6;
  const arcs = ringArcs(item.counts, size, thickness);
  const details = RING_KEYS.filter((k) => item.counts[k] > 0)
    .map((k) => `${item.counts[k]} ${k === 'none' ? t('unrated') : tDiff(k)}`)
    .join(', ');
  const label = `${t('clusterLabel', { n: item.count })} : ${details}`;
  return (
    <Marker longitude={item.lng} latitude={item.lat} anchor="center" style={{ zIndex: 3 }}>
      <button
        type="button"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="group flex min-h-touch min-w-touch items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="relative flex items-center justify-center rounded-full floating transition-transform duration-150 ease-out group-hover:scale-110 group-active:scale-95 motion-reduce:transition-none"
          style={{ width: size, height: size }}
        >
          <svg aria-hidden width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
            {arcs.map((a) => (
              <path key={a.key} d={a.d} style={{ fill: arcFill(a.key) }} />
            ))}
          </svg>
          <span aria-hidden className="relative text-small leading-none font-semibold text-foreground tabular-nums">
            {countLabel(item.count)}
          </span>
        </span>
      </button>
    </Marker>
  );
}

/** Pin whose tip sits exactly on the start point: the 44 px touch area is centred on that point. */
function StartPin({ item, hl, onClick, onHover }: { item: Extract<StartItem, { kind: 'start' }>; hl: boolean; onClick: () => void; onHover: (slug: string | null) => void }) {
  const t = useTranslations('explorer');
  const tDiff = useTranslations('scales.difficulty');
  const key = (RING_KEYS as readonly string[]).includes(item.difficulty) ? (item.difficulty as RingKey) : 'none';
  const w = hl ? 34 : 28;
  return (
    <Marker longitude={item.lng} latitude={item.lat} anchor="center" style={{ zIndex: hl ? 4 : 2 }}>
      <button
        type="button"
        aria-label={t('startLabel', { difficulty: key === 'none' ? t('unrated') : tDiff(key) })}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') onHover(item.slug);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') onHover(null);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="group relative flex min-h-touch min-w-touch items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden
          className={cn(
            'absolute top-1/2 left-1/2 flex items-center justify-center rounded-full border-2 border-card text-background shadow-md transition-transform duration-150 ease-out group-active:scale-95 motion-reduce:transition-none',
            hl && 'ring-2 ring-ring',
          )}
          style={{ width: w, height: w, background: arcFill(key), transform: `translate(-50%, calc(-50% - ${Math.round(w * 0.707)}px)) rotate(45deg)`, borderBottomRightRadius: 0 }}
        >
          <span className="flex size-full -rotate-45 items-center justify-center">
            <Bike className={hl ? 'size-5' : 'size-4'} strokeWidth={1.75} />
          </span>
        </span>
      </button>
    </Marker>
  );
}
