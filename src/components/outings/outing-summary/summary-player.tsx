'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Camera, Images, Pause, Play, RotateCcw, SkipBack, SkipForward, Trash2, Video, Volume2, VolumeX } from 'lucide-react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import type { Marker as MaplibreMarker } from 'maplibre-gl';
import BaseMap from '@/components/BaseMap';
import { Button } from '@/components/ui/button';
import { SlopeRouteLayer } from '@/components/map/slope-route-layer';
import { BASE_ZOOM, PITCH, TILE_WAIT_MS } from '@/components/map/flyover';
import { useMapColors } from '@/components/tracks/use-map-colors';
import { TERRAIN } from '@/lib/map/terrain';
import { edgeGrades } from '@/lib/geo/slopes';
import { slopeFeatures } from '@/lib/geo/slope-features';
import { buildFlyPath, lookAheadHeading, nextSpeed, positionAt, slopeZoomOffset, smoothHeading, type FlySpeed } from '@/lib/geo/flyover';
import { gradeAt } from '@/lib/elevation';
import { formatDuration, formatElevation, formatKm } from '@/lib/format';
import { timeAtDistance } from '@/lib/outings/photo-placement';
import type { Recap } from '@/lib/outings/recap';
import {
  advanceFly, buildSlides, buildStops, distanceOfProgress, mediaDurationMs, nextStopIndex, prevStopIndex, progressOf, stopKind, type SummaryMedia,
} from '@/lib/outings/summary-script';
import { cn } from '@/lib/utils';

type Props = { recapUrl: string; photoBase: string; videoBase: string; onDeleted?: () => void };
type Shown = { media: SummaryMedia; slide: boolean };
type Mode = 'fly' | 'media' | 'slides' | 'end';
const STOP_ICON = { photo: Camera, video: Video, mixed: Images } as const;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Modest phone: coarse pointer and few cores ⇒ flat 2D camera tilt without terrain (the point must stay smooth). */
function lightDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && (navigator.hardwareConcurrency ?? 8) <= 4;
}

export default function SummaryPlayer({ recapUrl, photoBase, videoBase, onDeleted }: Props) {
  const t = useTranslations('summary');
  const [recap, setRecap] = useState<Recap | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    fetch(recapUrl, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Recap) => { if (d.track) setRecap(d); else setFailed(true); })
      .catch((e) => { if (e?.name !== 'AbortError') setFailed(true); });
    return () => ctl.abort();
  }, [recapUrl]);
  if (failed) return <p role="alert" className="flex size-full items-center justify-center p-6 text-center">{t('error')}</p>;
  if (!recap || !recap.track) return <div className="flex size-full items-center justify-center text-sm opacity-80">{t('loading')}</div>;
  return <Stage recap={recap} track={recap.track} photoBase={photoBase} videoBase={videoBase} onDeleted={onDeleted} />;
}

type TrackData = NonNullable<Recap['track']>;

function Stage({ recap, track, photoBase, videoBase, onDeleted }: { recap: Recap; track: TrackData; photoBase: string; videoBase: string; onDeleted?: () => void }) {
  const t = useTranslations('summary');
  const locale = useLocale() as 'fr' | 'en';
  const colors = useMapColors();
  const mapRef = useRef<MapRef>(null);
  const markerRef = useRef<MaplibreMarker>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const kmRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const path = useMemo(() => buildFlyPath(track.geometry), [track.geometry]);
  const data = useMemo(() => slopeFeatures(track.geometry), [track.geometry]);
  // Media deleted from the player (#1701): taken out of the film without reloading the recap.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const live = useMemo(() => recap.media.filter((m) => !removed.has(m.id)), [recap.media, removed]);
  const deletable = useMemo(() => new Set(recap.media.filter((m) => m.canDelete).map((m) => m.id)), [recap.media]);
  const media = useMemo<SummaryMedia[]>(() => live.map((m) => ({ id: m.id, type: m.type, author: m.author, durationMs: m.durationMs, distanceM: m.placement.distanceM })), [live]);
  const stops = useMemo(() => buildStops(media), [media]);
  const slides = useMemo(() => buildSlides(media), [media]);
  const authors = useMemo(() => new Map(recap.media.map((m) => [m.id, m.organizer ? '' : m.author])), [recap.media]);
  const grades = useMemo(
    () => (track.profile && track.profile.length > 1 ? edgeGrades(track.profile.map((p) => p.km * 1000), track.profile.map((p) => p.ele)) : []),
    [track.profile],
  );
  const light = useMemo(() => (typeof window === 'undefined' ? false : lightDevice()), []);
  const pitch = light ? 45 : PITCH;

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<FlySpeed>(1);
  const [muted, setMuted] = useState(true);
  const [shown, setShown] = useState<Shown | null>(null);
  const [ended, setEnded] = useState(false);
  const [ready, setReady] = useState(false);

  // Mutable state of the film: the loop never re-renders React, only the overlay changes (`shown`, `playing`).
  const st = useRef({
    mode: 'fly' as Mode, dist: 0, heading: 0, zoomOff: 0, last: 0, playing: false, speed: 1 as FlySpeed, raf: 0, run: 0,
    next: 0, showing: null as number | null, mi: 0, slide: 0, timer: 0, timerLeft: 0, timerAt: 0, hud: 0,
  });
  useEffect(() => { st.current.speed = speed; }, [speed]);

  const url = useCallback((m: SummaryMedia, thumb = false) => `${m.type === 'video' ? videoBase : photoBase}/${m.id}${thumb ? '?size=thumb' : ''}`, [photoBase, videoBase]);
  const preloaded = useRef<HTMLVideoElement | null>(null);
  const preload = useCallback((m: SummaryMedia | undefined) => {
    if (!m) return;
    const img = new Image();
    img.src = url(m, m.type === 'video'); // photo file, or the clip's thumbnail first
    if (m.type === 'video') {
      const v = document.createElement('video');
      v.preload = 'auto';
      v.muted = true;
      v.src = url(m);
      preloaded.current = v;
    }
  }, [url]);

  const hud = useCallback(() => {
    const s = st.current;
    const p = progressOf(s.dist, path.totalM, s.mode === 'slides' ? s.slide : s.mode === 'end' ? Math.max(0, slides.length - 1) : null, slides.length);
    if (rangeRef.current) rangeRef.current.value = String(Math.round(p * 1000));
    if (kmRef.current) kmRef.current.textContent = formatKm(s.dist / 1000, locale);
    if (timeRef.current) {
      const at = timeAtDistance({ geometry: track.geometry, times: track.times }, s.dist);
      timeRef.current.textContent = at != null && track.times ? formatDuration(Math.round((at - track.times[0]) / 60_000), locale) : '';
    }
  }, [path.totalM, slides.length, locale, track.geometry, track.times]);

  const place = useCallback((jump: boolean) => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const s = st.current;
    const pos = positionAt(path, s.dist);
    markerRef.current?.setLngLat(pos);
    if (jump) map.jumpTo({ center: pos, bearing: reduced() ? map.getBearing() : s.heading, pitch, zoom: BASE_ZOOM + s.zoomOff });
  }, [path, pitch]);

  const clearTimer = () => { window.clearTimeout(st.current.timer); st.current.timer = 0; };

  const frameRef = useRef<(now: number) => void>(() => undefined);
  const advanceMediaRef = useRef<() => void>(() => undefined);
  const armTimer = useCallback((ms: number) => {
    const s = st.current;
    clearTimer();
    s.timerLeft = ms;
    s.timerAt = performance.now();
    if (s.playing) s.timer = window.setTimeout(() => advanceMediaRef.current(), ms);
  }, []);
  const endRide = useCallback(() => {
    const s = st.current;
    s.dist = path.totalM;
    place(false);
    if (slides.length > 0) {
      s.mode = 'slides';
      s.slide = 0;
      setShown({ media: slides[0], slide: true });
      preload(slides[1]);
      armTimer(mediaDurationMs(slides[0], s.speed));
    } else {
      s.mode = 'end';
      s.playing = false;
      setPlaying(false);
      setEnded(true);
    }
    hud();
  }, [path.totalM, place, slides, preload, hud, armTimer]);

  const flyOn = useCallback(() => {
    const s = st.current;
    s.mode = 'fly';
    setShown(null);
    if (s.playing) {
      s.last = performance.now();
      cancelAnimationFrame(s.raf);
      s.raf = requestAnimationFrame((n) => frameRef.current(n));
    }
  }, []);

  /** Shows the media `mi` of stop `k` (the point is parked on the stop). */
  const showStop = useCallback((k: number, mi: number) => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    clearTimer();
    s.mode = 'media';
    s.showing = k;
    s.mi = mi;
    s.next = k + 1;
    s.dist = stops[k].distanceM;
    place(true);
    hud();
    const m = stops[k].media[mi];
    setShown({ media: m, slide: false });
    preload(stops[k].media[mi + 1] ?? stops[k + 1]?.media[0] ?? slides[0]);
    armTimer(mediaDurationMs(m, s.speed));
  }, [stops, slides, place, hud, preload, armTimer]);

  const advanceMedia = useCallback(() => {
    const s = st.current;
    clearTimer();
    if (s.mode === 'slides') {
      if (s.slide + 1 < slides.length) {
        s.slide++;
        setShown({ media: slides[s.slide], slide: true });
        preload(slides[s.slide + 1]);
        armTimer(mediaDurationMs(slides[s.slide], s.speed));
      } else {
        s.mode = 'end';
        s.playing = false;
        setPlaying(false);
        setShown(null);
        setEnded(true);
      }
      hud();
    } else if (s.mode === 'media' && s.showing != null) {
      const k = s.showing;
      if (s.mi + 1 < stops[k].media.length) showStop(k, s.mi + 1);
      else {
        s.showing = null;
        if (s.next >= stops.length && s.dist >= path.totalM - 1) endRide();
        else flyOn();
      }
    }
  }, [slides, stops, path.totalM, showStop, endRide, flyOn, preload, hud, armTimer]);
  useEffect(() => { advanceMediaRef.current = advanceMedia; }, [advanceMedia]);

  const frame = useCallback((now: number) => {
    const s = st.current;
    if (!s.playing || s.mode !== 'fly') return;
    // Up to 0.5 s per frame: a slow phone (or software WebGL) keeps real time instead of a slow-motion film;
    // a longer gap (tab hidden) is still capped so the point does not jump.
    const dt = Math.min((now - s.last) / 1000, 0.5);
    s.last = now;
    const r = advanceFly(s.dist, dt, path.totalM, s.speed, stops, s.next);
    s.dist = r.distM;
    if (!reduced()) s.heading = smoothHeading(s.heading, lookAheadHeading(path, s.dist), dt, 1.2 * s.speed, 40 * s.speed);
    const gi = track.profile ? Math.max(0, track.profile.findIndex((p) => p.km * 1000 >= s.dist)) : 0;
    s.zoomOff += (slopeZoomOffset(gradeAt(grades, gi) ?? 0) - s.zoomOff) * (1 - Math.exp(-dt / 1.5));
    place(true);
    if (now - s.hud > 250) { s.hud = now; hud(); }
    if (r.reached != null) { showStop(r.reached, 0); return; }
    if (s.dist >= path.totalM) { endRide(); return; }
    s.raf = requestAnimationFrame((n) => frameRef.current(n));
  }, [path, stops, grades, track.profile, place, hud, showStop, endRide]);
  useEffect(() => { frameRef.current = frame; }, [frame]);

  const play = useCallback(() => {
    const s = st.current;
    if (s.mode === 'end') return;
    s.playing = true;
    setPlaying(true);
    if (s.mode === 'fly') {
      s.last = performance.now();
      cancelAnimationFrame(s.raf);
      s.raf = requestAnimationFrame((n) => frameRef.current(n));
    } else {
      void videoRef.current?.play().catch(() => undefined);
      clearTimer();
      s.timerAt = performance.now();
      s.timer = window.setTimeout(() => advanceMediaRef.current(), s.timerLeft);
    }
  }, []);
  const pause = useCallback(() => {
    const s = st.current;
    if (!s.playing) return;
    s.playing = false;
    setPlaying(false);
    cancelAnimationFrame(s.raf);
    if (s.timer) { s.timerLeft = Math.max(0, s.timerLeft - (performance.now() - s.timerAt)); clearTimer(); }
    videoRef.current?.pause();
  }, []);

  const restart = useCallback(() => {
    const s = st.current;
    s.dist = 0;
    s.next = 0;
    s.showing = null;
    s.heading = lookAheadHeading(path, 0);
    s.zoomOff = 0;
    setEnded(false);
    setShown(null);
    place(true);
    hud();
    s.mode = 'fly';
    s.playing = false;
    play();
  }, [path, place, hud, play]);

  const skipNext = useCallback(() => {
    const s = st.current;
    if (s.mode === 'end') return;
    if (s.mode === 'slides') { advanceMedia(); return; }
    // "Next media" jumps to the next media itself (same stop, else the next stop), never just back to flying.
    if (s.mode === 'media' && s.showing != null && s.mi + 1 < stops[s.showing].media.length) { showStop(s.showing, s.mi + 1); return; }
    if (s.next < stops.length) showStop(s.next, 0);
    else endRide();
  }, [advanceMedia, showStop, endRide, stops]);
  const skipPrev = useCallback(() => {
    const s = st.current;
    if (s.mode === 'slides') {
      s.slide = Math.max(0, s.slide - 1);
      setShown({ media: slides[s.slide], slide: true });
      armTimer(mediaDurationMs(slides[s.slide], s.speed));
      return;
    }
    if (s.mode === 'end') { setEnded(false); s.mode = 'fly'; }
    const k = prevStopIndex(stops, s.dist, s.mode === 'media' ? s.showing : null);
    if (k >= 0) { showStop(k, 0); return; }
    cancelAnimationFrame(s.raf);
    clearTimer();
    s.dist = 0;
    s.next = 0;
    s.showing = null;
    s.heading = lookAheadHeading(path, 0);
    place(true);
    hud();
    flyOn();
  }, [slides, stops, path, place, hud, showStop, flyOn, armTimer]);

  const seek = useCallback((p: number) => {
    const s = st.current;
    clearTimer();
    cancelAnimationFrame(s.raf);
    setEnded(false);
    if (slides.length > 0 && p > 0.9) {
      s.mode = 'slides';
      s.slide = Math.min(slides.length - 1, Math.floor(((p - 0.9) / 0.1) * slides.length));
      s.dist = path.totalM;
      place(true);
      setShown({ media: slides[s.slide], slide: true });
      armTimer(mediaDurationMs(slides[s.slide], s.speed));
      hud();
      return;
    }
    s.dist = distanceOfProgress(p, path.totalM, slides.length);
    s.next = nextStopIndex(stops, s.dist);
    s.showing = null;
    s.heading = lookAheadHeading(path, s.dist);
    place(true);
    hud();
    flyOn();
  }, [slides, stops, path, place, hud, flyOn, armTimer]);

  // Start: relief under the start loaded (bounded wait), then play.
  useEffect(() => {
    const s = st.current;
    const run = ++s.run;
    const timers: number[] = [];
    let cancelled = false;
    let started = false;
    const go = () => {
      if (cancelled || s.run !== run || started) return;
      started = true;
      setReady(true);
      place(true);
      hud();
      play();
    };
    const begin = (map: NonNullable<ReturnType<MapRef['getMap']>>) => {
      try { if (!light) map.setTerrain(TERRAIN); } catch { /* flat map: the film still plays */ }
      s.heading = lookAheadHeading(path, 0);
      place(true);
      map.once('idle', go);
    };
    // Whatever the map does (tiles that never settle, style already loaded), the film starts after a bounded wait.
    timers.push(window.setTimeout(go, TILE_WAIT_MS + 2000));
    const poll = window.setInterval(() => {
      const map = mapRef.current?.getMap();
      if (!map || cancelled) return;
      window.clearInterval(poll);
      if (map.isStyleLoaded()) begin(map);
      else map.once('styledata', () => begin(map));
    }, 50);
    return () => {
      cancelled = true;
      s.run++;
      window.clearInterval(poll);
      timers.forEach((x) => window.clearTimeout(x));
      cancelAnimationFrame(s.raf);
      clearTimer();
      s.playing = false;
    };
    // The film starts once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus on the stage, not on the dialog's close button: Space must pause the film, not close it.
  useEffect(() => { stageRef.current?.focus({ preventScroll: true }); }, []);

  // Deleting the shown media (#1701): pause, confirm inside the player (a portal would sit under the native dialog's
  // top layer), DELETE, then the film resumes on the media that followed it.
  const tp = useTranslations('photos');
  const tc = useTranslations('common');
  const [confirm, setConfirm] = useState<SummaryMedia | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const confirmOpen = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasPlaying = useRef(false);
  const resume = useRef<{ following: string | null; mode: Mode } | null>(null);
  useEffect(() => {
    confirmOpen.current = confirm != null;
    if (confirm) cancelRef.current?.focus({ preventScroll: true });
  }, [confirm]);

  const askDelete = useCallback((m: SummaryMedia) => {
    wasPlaying.current = st.current.playing;
    pause();
    setDeleteFailed(false);
    setConfirm(m);
  }, [pause]);
  const cancelDelete = useCallback(() => {
    setConfirm(null);
    stageRef.current?.focus({ preventScroll: true });
    if (wasPlaying.current) play();
  }, [play]);
  const doDelete = useCallback(async (m: SummaryMedia) => {
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const res = await fetch(url(m), { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      const s = st.current;
      const following = s.mode === 'slides'
        ? slides[s.slide + 1]?.id ?? null
        : s.mode === 'media' && s.showing != null ? stops[s.showing].media[s.mi + 1]?.id ?? null : null;
      resume.current = { following, mode: s.mode };
      setRemoved((r) => new Set(r).add(m.id));
      setConfirm(null);
      stageRef.current?.focus({ preventScroll: true });
      onDeleted?.();
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }, [url, slides, stops, onDeleted]);

  // Once stops and slides are rebuilt without the deleted media: show the one that followed it, else fly on / end.
  useEffect(() => {
    const r = resume.current;
    if (!r) return;
    resume.current = null;
    const s = st.current;
    const k = r.following ? stops.findIndex((x) => x.media.some((m) => m.id === r.following)) : -1;
    const si = r.following ? slides.findIndex((m) => m.id === r.following) : -1;
    if (k >= 0) showStop(k, stops[k].media.findIndex((m) => m.id === r.following));
    else if (si >= 0) {
      s.mode = 'slides';
      s.slide = si;
      setShown({ media: slides[si], slide: true });
      preload(slides[si + 1]);
      armTimer(mediaDurationMs(slides[si], s.speed));
      hud();
    } else if (r.mode === 'media') {
      s.showing = null;
      s.next = nextStopIndex(stops, s.dist);
      if (s.next >= stops.length && s.dist >= path.totalM - 1) endRide();
      else flyOn();
    } else {
      s.mode = 'end';
      setShown(null);
      setEnded(true);
    }
    if (wasPlaying.current) play();
  }, [stops, slides, path.totalM, showStop, endRide, flyOn, preload, armTimer, hud, play]);

  // Keyboard (Escape is the native dialog's).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirmOpen.current) return;
      const inControl = e.target instanceof HTMLElement && /^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(e.target.tagName);
      if (e.key === ' ' && !inControl) {
        e.preventDefault();
        if (st.current.mode === 'end') restart();
        else if (st.current.playing) pause();
        else play();
      } else if (e.key === 'ArrowRight') { e.preventDefault(); skipNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skipPrev(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [play, pause, restart, skipNext, skipPrev]);

  // Gestures on the stage: tap = pause / play, horizontal swipe = next / previous media.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onDown = (e: ReactPointerEvent) => { down.current = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - d.y) * 1.5) { if (dx < 0) skipNext(); else skipPrev(); }
    else if (Math.abs(dx) < 10 && Math.abs(e.clientY - d.y) < 10) {
      if (st.current.mode === 'end') restart();
      else if (st.current.playing) pause();
      else play();
    }
  };

  const cur = shown?.media ?? null;
  const author = cur ? authors.get(cur.id) : '';
  const barBtn = 'flex size-11 items-center justify-center rounded-full text-media-foreground hover:bg-media-foreground/15 active:opacity-70 focus-visible:ring-2 focus-visible:ring-ring';
  const startPos = path.coords[0];
  const times = track.times;
  const durationMin = times && times.length > 1 ? Math.round((times[times.length - 1] - times[0]) / 60_000) : null;
  const spark = useMemo(() => sparkline(track.profile), [track.profile]);

  return (
    <div ref={stageRef} tabIndex={-1} className="absolute inset-0 select-none bg-media-surface outline-none" data-testid="summary-stage" data-ready={ready}>
      <div className="absolute inset-0 touch-pan-y" onPointerDown={onDown} onPointerUp={onUp} data-testid="summary-surface">
        {colors && (
          <BaseMap lat={startPos[1]} lon={startPos[0]} bounds={track.bbox} boundsPadding={40} interactive={false} terrain={!light} mapRef={mapRef}>
            <SlopeRouteLayer id="route" data={data} colors={colors} arrows={false} />
            {stops.map((s) => {
              const p = positionAt(path, s.distanceM);
              const Icon = STOP_ICON[stopKind(s)];
              return (
                <Marker key={s.distanceM} longitude={p[0]} latitude={p[1]}>
                  <span className="flex size-7 items-center justify-center rounded-full border-2 border-media-foreground bg-primary text-primary-foreground shadow" data-testid="summary-stop" data-kind={stopKind(s)}>
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                </Marker>
              );
            })}
            <Marker ref={markerRef} longitude={startPos[0]} latitude={startPos[1]} style={{ pointerEvents: 'none', zIndex: 5 }}>
              <span className="block size-5 rounded-full border-[3px] border-media-foreground bg-primary shadow-lg" role="img" aria-label={t('point')} />
            </Marker>
          </BaseMap>
        )}
        {cur && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-media-surface/85 pb-36 pt-16" data-testid="summary-media" data-media-id={cur.id} data-media-type={cur.type}>
            {cur.type === 'photo' ? (
              <ZoomPhoto key={cur.id} src={url(cur)} ms={mediaDurationMs(cur, speed)} playing={playing} />
            ) : (
              <video
                key={cur.id}
                ref={videoRef}
                src={url(cur)}
                poster={url(cur, true)}
                muted={muted}
                playsInline
                autoPlay={playing}
                preload="auto"
                onEnded={() => advanceMedia()}
                className="max-h-full max-w-full object-contain"
              />
            )}
            {author && <p className="absolute bottom-40 left-4 rounded-full bg-media-surface/60 px-3 py-1 text-sm">{t('by', { name: author })}</p>}
          </div>
        )}
        {ended && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-media-surface/60">
            <button type="button" onClick={restart} className="flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-primary-foreground" data-testid="summary-replay">
              <RotateCcw aria-hidden className="size-5" /> {t('replay')}
            </button>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex flex-col rounded-2xl bg-media-surface/55 px-3 py-2 text-sm tabular-nums" data-testid="summary-stats">
        <span><span ref={kmRef}>{formatKm(0, locale)}</span> / {formatKm(track.distanceM / 1000, locale)}{track.gainM != null ? ` · ${formatElevation(track.gainM, locale)}` : ''}</span>
        {durationMin != null && <span className="opacity-80"><span ref={timeRef} /> / {formatDuration(durationMin, locale)}</span>}
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-media-surface/80 to-transparent px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8" data-testid="summary-controls">
        <div className="relative mb-1 h-10">
          {spark && <svg aria-hidden viewBox="0 0 100 20" preserveAspectRatio="none" className="absolute inset-x-0 bottom-3 h-6 w-full text-media-foreground opacity-50"><path d={spark} fill="currentColor" /></svg>}
          {stops.map((s) => {
            const Icon = STOP_ICON[stopKind(s)];
            return (
              <span key={s.distanceM} aria-hidden className="absolute bottom-3.5 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-media-foreground" style={{ left: `${progressOf(s.distanceM, path.totalM, null, slides.length) * 100}%` }} data-testid="summary-mark">
                <Icon className="size-3" />
              </span>
            );
          })}
          <input
            ref={rangeRef}
            type="range"
            min={0}
            max={1000}
            defaultValue={0}
            aria-label={t('progress')}
            data-testid="summary-progress"
            onChange={(e) => seek(Number(e.target.value) / 1000)}
            className="absolute inset-x-0 bottom-0 h-4 w-full cursor-pointer accent-primary"
          />
        </div>
        <div className="flex items-center justify-center gap-1">
          <button type="button" className={barBtn} aria-label={t('prev')} onClick={skipPrev} data-testid="summary-prev"><SkipBack aria-hidden className="size-5" /></button>
          {ended ? (
            <button type="button" className={barBtn} aria-label={t('replay')} onClick={restart}><RotateCcw aria-hidden className="size-5" /></button>
          ) : (
            <button type="button" className={barBtn} aria-label={playing ? t('pause') : t('play')} onClick={() => (playing ? pause() : play())} data-testid="summary-playpause">
              {playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
            </button>
          )}
          <button type="button" className={barBtn} aria-label={t('next')} onClick={skipNext} data-testid="summary-next"><SkipForward aria-hidden className="size-5" /></button>
          <button type="button" className={cn(barBtn, 'w-auto px-3 text-sm font-semibold tabular-nums')} aria-label={t('speed', { speed })} onClick={() => setSpeed(nextSpeed(speed))} data-testid="summary-speed">
            ×{speed}
          </button>
          {cur?.type === 'video' && (
            <button type="button" className={barBtn} aria-label={muted ? t('soundOn') : t('soundOff')} onClick={() => setMuted((v) => !v)} data-testid="summary-sound">
              {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
            </button>
          )}
          {cur && deletable.has(cur.id) && (
            <button type="button" className={barBtn} aria-label={cur.type === 'video' ? tp('videoDelete') : tp('delete')} onClick={() => askDelete(cur)} data-testid="summary-delete">
              <Trash2 aria-hidden className="size-5" />
            </button>
          )}
        </div>
      </div>

      {confirm && (
        <div className="absolute inset-0 z-40 flex items-end justify-center bg-scrim p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center">
          <div role="alertdialog" aria-modal="true" aria-labelledby="summary-delete-title" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-card p-4 text-card-foreground shadow-sheet" data-testid="summary-delete-confirm">
            <h2 id="summary-delete-title" className="text-heading">{confirm.type === 'video' ? tp('videoDelete') : tp('delete')}</h2>
            <p className="text-body text-pretty">{confirm.type === 'video' ? tp('videoDeleteConfirm') : tp('deleteConfirm')}</p>
            {deleteFailed && <p role="alert" className="text-body text-destructive">{tp('errors.generic')}</p>}
            <div className="flex flex-col gap-2">
              <Button size="lg" variant="destructive" disabled={deleting} onClick={() => void doDelete(confirm)} data-testid="summary-delete-ok">
                {confirm.type === 'video' ? tp('videoDelete') : tp('delete')}
              </Button>
              <Button ref={cancelRef} size="lg" variant="outline" disabled={deleting} onClick={cancelDelete}>{tc('cancel')}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Photo with a slow zoom over its display time (`ms`); no zoom under `prefers-reduced-motion`. Freezes while paused. */
function ZoomPhoto({ src, ms, playing }: { src: string; ms: number; playing: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const zoom = on && playing && typeof window !== 'undefined' && !reduced();
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="max-h-full max-w-full object-contain" style={{ transform: zoom ? 'scale(1.06)' : 'scale(1)', transition: zoom ? `transform ${ms}ms linear` : 'none' }} />;
}

/** SVG area path (viewBox 100×20) of the real elevation profile, `null` without elevation. */
function sparkline(profile: TrackData['profile']): string | null {
  if (!profile || profile.length < 2) return null;
  const maxKm = profile[profile.length - 1].km || 1;
  const eles = profile.map((p) => p.ele);
  const lo = Math.min(...eles);
  const span = Math.max(1, Math.max(...eles) - lo);
  const step = Math.max(1, Math.floor(profile.length / 120));
  const pts = profile.filter((_, i) => i % step === 0 || i === profile.length - 1).map((p) => `${((p.km / maxKm) * 100).toFixed(2)},${(20 - ((p.ele - lo) / span) * 18).toFixed(2)}`);
  return `M0,20 L${pts.join(' L')} L100,20 Z`;
}
