'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { Bike, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { Marker, useControl, useMap, type ControlPosition } from 'react-map-gl/maplibre';
import type { IControl, Marker as MaplibreMarker } from 'maplibre-gl';
import { TERRAIN, TERRAIN_PITCH } from '@/lib/map/terrain';
import { edgeGrades } from '@/lib/geo/slopes';
import { gradeAt, type LocatedProfilePoint } from '@/lib/elevation';
import { useMediaQuery, DESKTOP } from '@/lib/use-media-query';
import { FINE_POINTER } from '@/lib/use-desktop-autofocus';
import {
  buildFlyPath, distanceOfProfileIndex, flyDurationMs, lookAheadHeading, nextSpeed, positionAt, profileIndexAt,
  slopeZoomOffset, smoothHeading, type FlySpeed,
} from '@/lib/geo/flyover';
import type { TrackGeometry } from '@/lib/geo/types';
import { cn } from '@/lib/utils';

export const PITCH = Math.max(TERRAIN_PITCH, 65);
export const BASE_ZOOM = 14.6;
export const TILE_WAIT_MS = 6000;

/**
 * Link between the flyover (inside the map) and the elevation profile (outside): the flyover publishes its
 * profile index (`cursor`), and a click/drag on the profile makes the bike jump there (`seekProps`, on the wrapper).
 */
export function useFlyoverLink() {
  const seekRef = useRef<((index: number) => void) | null>(null);
  const hover = useRef<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [active, setActive] = useState(false);
  const jump = useCallback(() => {
    if (hover.current !== null) seekRef.current?.(hover.current);
  }, []);
  return {
    seekRef, cursor, setCursor, active, setActive,
    /** To pass to `ElevationProfile onScrub` (keeps the hovered index). */
    trackHover: (i: number | null) => { hover.current = i; },
    /** Spread on a wrapper of the profile: click or drag = jump of the bike. */
    seekProps: {
      onPointerDown: jump,
      onPointerMove: (e: ReactPointerEvent) => { if (e.buttons === 1) jump(); },
    },
  };
}
export type FlyoverLink = ReturnType<typeof useFlyoverLink>;

class PortalControl implements IControl {
  readonly container: HTMLDivElement;
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
  }
  onAdd() { return this.container; }
  onRemove() { this.container.remove(); }
}

type Props = {
  geometry: TrackGeometry;
  profile: LocatedProfilePoint[];
  link: FlyoverLink;
  position?: ControlPosition;
  /** Placement of the playback bar in the map container. */
  barClassName?: string;
};

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 3D flyover (#1690), desktop only: a bike follows the open track, the camera follows it smoothly (heading aimed
 * 150-300 m ahead, damped rotation; pure logic in `src/lib/geo/flyover.ts`), the profile cursor moves with it.
 * The loop runs on `requestAnimationFrame` and moves the camera/marker imperatively: React only re-renders on
 * button state changes and when the profile index changes.
 */
export function Flyover(props: Props) {
  const desktop = useMediaQuery(DESKTOP);
  const fine = useMediaQuery(FINE_POINTER);
  if (!desktop || !fine) return null;
  return <FlyoverInner {...props} />;
}

function FlyoverInner({ geometry, profile, link, position = 'top-right', barClassName = 'bottom-6 right-16' }: Props) {
  const t = useTranslations('map');
  const ctrl = useControl(() => new PortalControl(), { position });
  const { current: mapRef } = useMap();
  const { active, setActive, setCursor, seekRef } = link;
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<FlySpeed>(1);
  const markerRef = useRef<MaplibreMarker>(null);
  const arrowRef = useRef<HTMLDivElement>(null);

  const path = useMemo(() => buildFlyPath(geometry), [geometry]);
  const grades = useMemo(
    () => (profile.length > 1 ? edgeGrades(profile.map((p) => p.distKm * 1000), profile.map((p) => p.ele)) : []),
    [profile],
  );
  const st = useRef({ dist: 0, heading: 0, zoomOff: 0, last: 0, playing: false, speed: 1 as FlySpeed, lastIdx: -1, raf: 0, run: 0 });
  useEffect(() => { st.current.speed = speed; }, [speed]);

  const place = useCallback((jumpCamera: boolean) => {
    const map = mapRef?.getMap();
    if (!map) return;
    const s = st.current;
    const pos = positionAt(path, s.dist);
    markerRef.current?.setLngLat(pos);
    if (jumpCamera) {
      map.jumpTo({ center: pos, bearing: reduced() ? map.getBearing() : s.heading, pitch: PITCH, zoom: BASE_ZOOM + s.zoomOff });
    }
    // Bike heading relative to the screen (it keeps pointing along the track while the camera turns).
    const local = lookAheadHeading(path, s.dist, 30);
    if (arrowRef.current) arrowRef.current.style.transform = `rotate(${local - map.getBearing()}deg)`;
    const idx = profileIndexAt(profile, s.dist);
    if (idx !== s.lastIdx) {
      s.lastIdx = idx;
      setCursor(idx >= 0 ? idx : null);
    }
  }, [mapRef, path, profile, setCursor]);

  const pause = useCallback(() => {
    st.current.playing = false;
    setPlaying(false);
  }, []);

  const frameRef = useRef<(now: number) => void>(() => undefined);
  const frame = useCallback((now: number) => {
    const s = st.current;
    if (!s.playing) return;
    const dt = Math.min((now - s.last) / 1000, 0.5);
    s.last = now;
    s.dist += (path.totalM / (flyDurationMs(path.totalM, s.speed) / 1000)) * dt;
    if (s.dist >= path.totalM) {
      s.dist = path.totalM;
      s.playing = false;
      setPlaying(false);
      setEnded(true);
    }
    if (!reduced()) {
      // Damping time constant grows with the speed so ×4 stays as smooth as ×1.
      s.heading = smoothHeading(s.heading, lookAheadHeading(path, s.dist), dt, 1.2 * s.speed, 40 * s.speed);
    }
    const g = gradeAt(grades, Math.max(0, profileIndexAt(profile, s.dist))) ?? 0;
    s.zoomOff += (slopeZoomOffset(g) - s.zoomOff) * (1 - Math.exp(-dt / 1.5));
    place(true);
    if (s.playing) s.raf = requestAnimationFrame((n) => frameRef.current(n));
  }, [path, grades, profile, place]);
  useEffect(() => { frameRef.current = frame; }, [frame]);

  const play = useCallback(() => {
    const s = st.current;
    if (s.playing) return;
    s.playing = true;
    setPlaying(true);
    s.last = performance.now();
    cancelAnimationFrame(s.raf);
    s.raf = requestAnimationFrame((n) => frameRef.current(n));
  }, []);

  const stop = useCallback(() => {
    const s = st.current;
    s.run++; // cancels a start that is still waiting for the tiles
    s.playing = false;
    cancelAnimationFrame(s.raf);
    setPlaying(false);
    setEnded(false);
    setActive(false);
    setCursor(null);
    s.lastIdx = -1;
  }, [setActive, setCursor]);

  const start = useCallback((from = 0) => {
    const map = mapRef?.getMap();
    if (!map) return;
    const s = st.current;
    const run = ++s.run;
    s.dist = from;
    s.zoomOff = 0;
    s.lastIdx = -1;
    s.heading = lookAheadHeading(path, from);
    setEnded(false);
    setActive(true);
    const go = () => {
      if (s.run !== run) return;
      place(true);
      play();
    };
    const begin = () => {
      map.setTerrain(TERRAIN);
      place(true);
      // The playback waits for the relief under the start to be loaded (bounded wait).
      const timer = window.setTimeout(go, TILE_WAIT_MS);
      map.once('idle', () => { window.clearTimeout(timer); go(); });
    };
    if (map.isStyleLoaded()) begin();
    else map.once('load', begin);
  }, [mapRef, path, place, play, setActive]);

  // Jump from the profile (click / drag).
  useEffect(() => {
    seekRef.current = (index) => {
      if (!st.current.run) return;
      const s = st.current;
      s.dist = distanceOfProfileIndex(profile, index, path.totalM);
      s.heading = lookAheadHeading(path, s.dist);
      setEnded(false);
      place(true);
    };
    return () => { seekRef.current = null; };
  }, [seekRef, profile, path, place]);

  // User action on the map pauses; Space / Escape.
  useEffect(() => {
    const map = mapRef?.getMap();
    if (!active || !map) return;
    const onUser = () => pause();
    map.on('mousedown', onUser);
    map.on('wheel', onUser);
    map.on('touchstart', onUser);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        stop();
      } else if (e.key === ' ' && !(e.target instanceof HTMLElement && /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(e.target.tagName))) {
        e.preventDefault();
        if (st.current.playing) pause();
        else if (st.current.dist >= path.totalM) start(0);
        else play();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      map.off('mousedown', onUser);
      map.off('wheel', onUser);
      map.off('touchstart', onUser);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [active, mapRef, pause, stop, play, start, path.totalM]);

  // Closing the track (unmount) or changing it stops everything.
  useEffect(() => {
    const s = st.current;
    return () => {
      s.run++;
      s.playing = false;
      cancelAnimationFrame(s.raf);
      setActive(false);
      setCursor(null);
    };
  }, [geometry, setActive, setCursor]);

  const map = mapRef?.getMap();
  if (!map || path.coords.length < 2) return null;
  const startPos = path.coords[0];
  const label = t('flyoverStart');
  const barBtn = 'flex size-11 items-center justify-center rounded-md text-foreground hover:bg-muted active:opacity-70 focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <>
      {createPortal(
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={active}
          data-testid="flyover-start"
          onClick={() => (active ? stop() : start(0))}
          className={cn('text-foreground active:opacity-70', active && 'text-primary')}
        >
          <Play aria-hidden className="mx-auto size-4" />
        </button>,
        ctrl.container,
      )}
      {active && (
        <Marker ref={markerRef} longitude={startPos[0]} latitude={startPos[1]} style={{ pointerEvents: 'none', zIndex: 5 }}>
          <div ref={arrowRef} className="relative size-11" role="img" aria-label={t('flyoverBike')} data-testid="flyover-bike">
            <span className="absolute left-1/2 top-0 -translate-x-1/2 border-x-[7px] border-b-[10px] border-x-transparent border-b-primary" />
            <span className="absolute inset-1.5 flex items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md">
              <Bike aria-hidden className="size-5" strokeWidth={1.75} />
            </span>
          </div>
        </Marker>
      )}
      {active && createPortal(
        <div className={cn('floating absolute z-20 flex items-center gap-1 rounded-2xl p-1', barClassName)} data-testid="flyover-bar">
          {ended ? (
            <button type="button" className={cn(barBtn, 'w-auto gap-1.5 px-3 text-sm font-medium')} onClick={() => start(0)} data-testid="flyover-replay">
              <RotateCcw aria-hidden className="size-[18px]" /> {t('flyoverReplay')}
            </button>
          ) : (
            <button type="button" className={barBtn} aria-label={playing ? t('flyoverPause') : t('flyoverPlay')} onClick={() => (playing ? pause() : play())} data-testid="flyover-playpause">
              {playing ? <Pause aria-hidden className="size-[18px]" /> : <Play aria-hidden className="size-[18px]" />}
            </button>
          )}
          <button type="button" className={cn(barBtn, 'w-auto px-3 text-sm font-semibold tabular-nums')} aria-label={t('flyoverSpeed', { speed })} onClick={() => setSpeed(nextSpeed(speed))} data-testid="flyover-speed">
            ×{speed}
          </button>
          <button type="button" className={barBtn} aria-label={t('flyoverStop')} title={t('flyoverStop')} onClick={stop} data-testid="flyover-stop">
            <Square aria-hidden className="size-4" />
          </button>
        </div>,
        map.getContainer(),
      )}
    </>
  );
}
