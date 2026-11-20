'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Layer, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { GeoJSONSource } from 'maplibre-gl';
import { CalendarDays, List, UserRound, Search, Route, SearchX, SlidersHorizontal, PencilRuler, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import BaseMap from '@/components/BaseMap';
import { TrackCard, TrackCardSkeleton } from '@/components/track-card';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { OutingView } from '@/components/outings/outing-view';
import { OutingParticipants } from '@/components/outings/outing-participants';
import { activeFilterCount, parseFilters, serializeFilters, type TrackFilters } from '@/lib/tracks/filters';
import type { TrackStart, TrackSummary } from '@/lib/tracks/query';
import { tracksAtStart } from '@/lib/tracks/same-start';
import { VIEW_PARAMS, parseMapView, parseOpenTrack, viewChanged, viewQuery, writeMapView, type MapView } from '@/lib/tracks/map-view';
import { LAST_EXPLORER_KEY } from '@/components/tracks/back-to-map';
import { LoginLink } from '@/components/login-link';
import { haversine } from '@/lib/geo/distance';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { FiltersForm } from './filters-form';
import { useMapColors } from './use-map-colors';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import { StartMarkers, useStartItems, type StartItem } from '@/components/map/start-markers';
import { CLUSTER_PROPERTIES } from '@/lib/tracks/cluster-ring';
import { OutingsLayer, useMapOutings } from './outings-layer';
import { useOutingsPref } from './outings-pref';
import { SingleTip, SinglesLayer, SinglesStatus, useSingleTip, useSingles, useSinglesPref } from './singles-layer';
import { SlopeLegend } from '@/components/map/slope-legend';
import { OpenTrackLayers, TrackPanelBody, TrackPanelFooter, useOutingTrack, useTrackSheet } from './track-panel';
import { nearestProfileIndex } from '@/lib/elevation';
import { ElevationProfile } from '@/components/elevation-profile';

type ListPanel = { kind: 'list' } | { kind: 'group'; slugs: string[] };
/** `from`: the list or group the track was opened from ("Back" button, #1582). */
type Panel = ListPanel | { kind: 'filters' } | { kind: 'track'; slug: string; from?: ListPanel } | { kind: 'outing'; id: string } | null;
type Sort = 'near' | 'short' | 'long' | 'gain' | 'name';
type View = [number, number, number, number];

const inView = (p: [number, number], v: View) => p[0] >= v[0] && p[0] <= v[2] && p[1] >= v[1] && p[1] <= v[3];
/** Beyond it, start points no longer cluster (#1531): each start is a marker, those of the same car park stack. */
const CLUSTER_MAX_ZOOM = 16;
const openSlugOf = (p: Panel) => (p?.kind === 'track' ? p.slug : null);

/** `signedIn=false`: visitor mode (#1591), without "My tracks", import or creation; restricted actions lead to sign-in. */
export function TrackExplorer({ home, signedIn = true }: { home: { lat: number; lon: number }; signedIn?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const colors = useMapColors();
  const mapRef = useRef<MapRef>(null);

  // The massif access filter (`access`, #1349) is no longer offered here (#1407): ignored if left in an old link.
  // "My tracks" makes no sense without an account (#1591): a `mine=1` in a visitor's link is ignored.
  const filters = useMemo(() => ({ ...parseFilters(new URLSearchParams(sp.toString())), access: undefined, ...(signedIn ? {} : { mine: undefined }) }), [sp, signedIn]);
  const filterKey = useMemo(() => serializeFilters({ ...filters, bbox: undefined }).toString(), [filters]);

  const [tracks, setTracks] = useState<TrackStart[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pinned, setPinned] = useState<TrackStart | undefined>();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const error = errorKey === filterKey;
  const [view, setView] = useState<View | null>(null);
  const [zoom, setZoom] = useState(10);
  // OSM singletrack layer (#1372): on by default (#1436), setting in the filters.
  const t = useTranslations('explorer');
  const tTrack = useTranslations('track');
  const locale = useLocale();
  const [singlesOn] = useSinglesPref();
  const singles = useSingles(singlesOn, view, zoom);
  const [outingsOn, setOutingsOn] = useOutingsPref();
  const mapOutings = useMapOutings(outingsOn, view);
  const tOut = useTranslations('outingsMap');
  const tm = useTranslations('outings');
  const [panel, setPanel] = useState<Panel>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Track hovered on the map (#1533): highlights its row in the list.
  const [overSlug, setOverSlug] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('near');
  const [draft, setDraft] = useState<string | null>(null);
  const q = draft ?? filters.q ?? '';
  // URL = source of truth of the filters (shareable, back button).
  const apply = useCallback(
    (next: TrackFilters, mode: 'push' | 'replace' = 'push') => {
      const params = serializeFilters({ ...next, bbox: undefined });
      const cur = new URLSearchParams(window.location.search);
      for (const k of VIEW_PARAMS) {
        const keep = cur.get(k);
        if (keep) params.set(k, keep);
      }
      const qs = params.toString();
      router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // "My tracks" (#1430): when turned on, the map fits all of one's tracks (otherwise one would think
  // they disappeared). A single light request (start points only), without extent.
  const mine = !!filters.mine;
  useEffect(() => {
    if (!mine) return;
    const ctl = new AbortController();
    fetch('/api/tracks?mine=1&overview=1', { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { tracks: TrackSummary[] }) => {
        if (!d.tracks.length) return;
        const b = d.tracks.reduce<View>(
          (a, t) => [Math.min(a[0], t.bbox[0]), Math.min(a[1], t.bbox[1]), Math.max(a[2], t.bbox[2]), Math.max(a[3], t.bbox[3])],
          [180, 90, -180, -90],
        );
        mapRef.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 90, bottom: 120, left: 40, right: 40 }, maxZoom: 14, duration: 600 });
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [mine]);

  // Text search: wait for typing to end, then the URL takes over.
  useEffect(() => {
    if (draft === null) return;
    const t = setTimeout(() => {
      apply({ ...filters, q: draft.trim() || undefined }, 'replace');
      setDraft(null);
    }, 350);
    return () => clearTimeout(t);
  }, [draft, filters, apply]);

  // Light start points for the whole of France (#1530, #1531), once per filter set: the map only draws
  // markers and clusters (MapLibre), a track's geometry loads on demand when it is chosen.
  useEffect(() => {
    const ctl = new AbortController();
    fetch(`/api/tracks?${new URLSearchParams(filterKey)}&starts=1`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { tracks: TrackStart[]; total: number }) => {
        setTracks(d.tracks);
        setTotal(d.total);
      })
      .catch((e) => e.name !== 'AbortError' && setErrorKey(filterKey));
    return () => ctl.abort();
  }, [filterKey]);

  // End-to-end tests (#1532): `window.__E2E__` set before loading exposes the map to project/inspect.
  const onMapLoad = useCallback(() => {
    const w = window as unknown as { __E2E__?: boolean; __explorerMap?: unknown };
    if (w.__E2E__) w.__explorerMap = mapRef.current?.getMap();
  }, []);
  // Map view in the URL (#1577): read once on arrival, written through replaceState (anti-loop threshold).
  const [initialView] = useState<MapView | null>(() => parseMapView(new URLSearchParams(sp.toString())));
  const pendingOpen = useRef<string | null>(parseOpenTrack(new URLSearchParams(sp.toString())));
  const [mapView, setMapView] = useState<MapView | null>(initialView);
  const writeUrl = useCallback((mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(window.location.search);
    mutate(params);
    const qs = params.toString();
    if (qs === window.location.search.replace(/^\?/, '')) return;
    window.history.replaceState(window.history.state, '', qs ? `${pathname}?${qs}` : pathname);
    try { sessionStorage.setItem(LAST_EXPLORER_KEY, qs); } catch { /* stockage indisponible */ }
  }, [pathname]);
  // Old multi-selection (#1532, removed by #1584): an old `?sel=` link opens normally, the parameter is cleared.
  useEffect(() => writeUrl((p) => p.delete('sel')), [writeUrl]);
  const syncView = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      const c = map.getCenter();
      const v = { z: map.getZoom(), lat: c.lat, lng: c.lng };
      setMapView((o) => (viewChanged(o, v) ? v : o));
      writeUrl((p) => {
        if (viewChanged(parseMapView(p), v)) writeMapView(p, v);
      });
    }
    const b = mapRef.current?.getBounds();
    if (b) setView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    const z = mapRef.current?.getZoom();
    if (z !== undefined) setZoom(z);
  }, [writeUrl]);

  const starts = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: (tracks ?? []).map((t) => ({
        type: 'Feature' as const,
        properties: { slug: t.slug, difficulty: t.difficulty ?? 'none' },
        geometry: { type: 'Point' as const, coordinates: t.start },
      })),
    }),
    [tracks],
  );

  const [mapLoaded, setMapLoaded] = useState(false);
  const startItems = useStartItems(mapRef, `${mapLoaded}`, starts);

  const visible = useMemo(() => {
    const list = (tracks ?? []).filter((t) => !view || inView(t.start, view));
    const d = (t: TrackStart) => haversine([home.lon, home.lat], t.start);
    const cmp: Record<Sort, (a: TrackStart, b: TrackStart) => number> = {
      near: (a, b) => d(a) - d(b),
      short: (a, b) => a.distanceKm - b.distanceKm,
      long: (a, b) => b.distanceKm - a.distanceKm,
      gain: (a, b) => (b.gainM ?? 0) - (a.gainM ?? 0),
      name: (a, b) => a.name.localeCompare(b.name, locale),
    };
    return list.sort(cmp[sort]);
  }, [tracks, view, sort, home, locale]);

  const newHref = mapView ? `/new?${viewQuery(mapView)}` : '/new';
  // Open track (`t`): reopened on arrival if still visible, ignored otherwise; then the URL follows the panel.
  useEffect(() => {
    const slug = pendingOpen.current;
    if (!slug || !tracks) return;
    pendingOpen.current = null;
    if (tracks.some((x) => x.slug === slug)) setPanel({ kind: 'track', slug });
    else writeUrl((p) => p.delete('t'));
  }, [tracks, writeUrl]);
  useEffect(() => {
    if (pendingOpen.current) return;
    const slug = panel?.kind === 'track' ? panel.slug : null;
    writeUrl((p) => (slug ? p.set('t', slug) : p.delete('t')));
  }, [panel, writeUrl]);

  const selected = panel?.kind === 'track' ? (tracks?.find((t) => t.slug === panel.slug) ?? (pinned?.slug === panel.slug ? pinned : undefined)) : undefined;
  const hl = selected?.slug ?? (hover && hover !== 'pointer' ? hover : overSlug) ?? '';
  const groupTracks = panel?.kind === 'group' ? (tracks ?? []).filter((t) => panel.slugs.includes(t.slug)) : [];
  // Dimmed preview when hovering a list row (#1583), desktop only (a tap opens the track directly).
  const [preview, setPreview] = useState<string | null>(null);
  const listHover = (slug: string) => ({
    onMouseEnter: () => { setHover(slug); if (desktop) setPreview(slug); },
    onMouseLeave: () => { setHover(null); setPreview(null); },
    onFocus: () => { if (desktop) setPreview(slug); },
    onBlur: () => setPreview(null),
  });

  // Open track (#1582): full sheet loaded on demand, line coloured by slope on the map, synchronised profile.
  const openSlug = panel?.kind === 'track' ? panel.slug : null;
  const { sheet, loading: sheetLoading, error: sheetError, setVisibility: setSheetVisibility } = useTrackSheet(openSlug);
  // Open outing (#1596): its frozen route is drawn like an open track (one line at a time).
  const openOutingId = panel?.kind === 'outing' ? panel.id : null;
  const outingTrack = useOutingTrack(openOutingId);
  const openLine = panel?.kind === 'outing' ? outingTrack : sheet;
  const lineKey = openOutingId ? `outing:${openOutingId}` : openSlug;
  const [scrub, setScrub] = useState<{ slug: string; i: number } | null>(null);
  const [lineOver, setLineOver] = useState<{ slug: string; i: number } | null>(null);
  const profileCursor = scrub && scrub.slug === lineKey ? scrub.i : null;
  const lineCursor = lineOver && lineOver.slug === lineKey ? lineOver.i : null;
  const openTrack = (slug: string, from?: ListPanel) => {
    setPinned(tracks?.find((x) => x.slug === slug));
    setPanel({ kind: 'track', slug, from });
  };
  // On opening, the map fits the track if it is not entirely in view (once per track).
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!openLine || !map || !lineKey || fitted.current === lineKey) return;
    fitted.current = lineKey;
    const b = map.getBounds();
    const [w, s, e, n] = openLine.bbox;
    if (b.contains([w, s]) && b.contains([e, n])) return;
    const panelW = desktop ? 420 : 0;
    map.fitBounds([[w, s], [e, n]], { padding: { top: 90, bottom: desktop ? 60 : window.innerHeight * 0.5, left: 40 + panelW, right: 40 }, maxZoom: 15, duration: 600 });
  }, [openLine, lineKey, desktop]);

  // Geometries on demand (#1531), for the hover preview: only those not loaded yet.
  const [geoms, setGeoms] = useState<Record<string, NonNullable<TrackSummary['geometry']>>>({});
  const geomsRef = useRef(geoms);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    geomsRef.current = geoms;
    zoomRef.current = zoom;
  });
  // Wanted geometries: tracks of the open group (preloaded for an instant preview, ≤ 50) and the hovered track.
  const wantedKey = [...new Set([...(panel?.kind === 'group' ? panel.slugs.slice(0, 50) : []), ...(preview ? [preview] : [])])].join(',');
  useEffect(() => {
    const missing = wantedKey ? wantedKey.split(',').filter((s) => !geomsRef.current[s]) : [];
    if (!missing.length) return;
    const ctl = new AbortController();
    fetch(`/api/tracks/geometry?slugs=${encodeURIComponent(missing.join(','))}&z=${Math.round(zoomRef.current)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { tracks: { slug: string; geometry: TrackSummary['geometry'] }[] }) => {
        const add: Record<string, NonNullable<TrackSummary['geometry']>> = {};
        for (const t of d.tracks) if (t.geometry) add[t.slug] = t.geometry;
        setGeoms((g) => ({ ...g, ...add }));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [wantedKey]);
  const previewGeom = preview && preview !== openSlugOf(panel) ? geoms[preview] : undefined;
  const previewLine = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: previewGeom ? [{ type: 'Feature' as const, properties: {}, geometry: previewGeom }] : [] }),
    [previewGeom],
  );

  // "km from the start" tooltip on the open track (#1535), with the profile's elevation.
  const lineTip = useTrackTip((e) => {
    const f = e.features?.[0];
    if (f?.layer.id !== 'open-casing' || !openLine) return null;
    return { geometry: openLine.geometry, ele: (lon, lat) => openLine.profile[nearestProfileIndex(openLine.profile, lon, lat)]?.ele ?? null };
  });
  // Singles tooltip (#1687): off while a track or an outing is open (singles dimmed).
  const singlesTipOn = singles?.status === 'ok' && !openLine && panel?.kind !== 'track' && panel?.kind !== 'outing';
  const singleTip = useSingleTip(singlesTipOn);
  const onClick = (e: MapLayerMouseEvent) => {
    lineTip.onTap(e);
    singleTip.onTap(e);
  };
  const startsSource = () => mapRef.current?.getSource('starts') as GeoJSONSource | undefined;
  // Cluster marker (#1688): expansion zoom, or the list when the group no longer splits (same car park).
  const onClusterTap = async (c: Extract<StartItem, { kind: 'cluster' }>) => {
    const src = startsSource();
    if (!src) return;
    const z = await src.getClusterExpansionZoom(c.id);
    if (z > CLUSTER_MAX_ZOOM) {
      const leaves = await src.getClusterLeaves(c.id, 50, 0);
      setPanel({ kind: 'group', slugs: leaves.map((l) => l.properties?.slug as string) });
      return;
    }
    mapRef.current?.easeTo({ center: [c.lng, c.lat], zoom: z });
  };
  // Start marker: every track starting here; a single one → its sheet in the panel, several → the list.
  const onStartTap = (st: Extract<StartItem, { kind: 'start' }>) => {
    const here = tracksAtStart(tracks ?? [], [st.lng, st.lat]);
    if (here.length > 1) setPanel({ kind: 'group', slugs: here.map((t) => t.slug) });
    else openTrack(st.slug);
  };
  const onMouseMove = (e: MapLayerMouseEvent) => {
    lineTip.onMove(e);
    singleTip.onMove(e);
    const onLine = openLine && lineKey && e.features?.some((x) => x.layer.id === 'open-casing');
    setLineOver(onLine ? { slug: lineKey, i: nearestProfileIndex(openLine.profile, e.lngLat.lng, e.lngLat.lat) } : null);
    setHover(singlesTipOn && e.features?.some((x) => x.layer.id === 'singles-hit') ? 'pointer' : null);
  };

  const nFilters = activeFilterCount(filters);
  if (!colors) return null;

  const panelTitle = panel?.kind === 'filters' ? t('filters') : panel?.kind === 'group' ? t('panelGroup', { n: groupTracks.length }) : panel?.kind === 'outing' ? tOut('panelTitle') : panel?.kind === 'track' ? (sheet ? sheet.name || tTrack('untitled') : selected ? selected.name || tTrack('untitled') : t('panelTrack')) : t('panelList');
  const sheetOpen = panel !== null;
  const selectedOuting = panel?.kind === 'outing' ? mapOutings.find((o) => o.id === panel.id) : undefined;

  return (
    <>
      <BaseMap
        lat={initialView?.lat ?? home.lat}
        lon={initialView?.lng ?? home.lon}
        zoom={initialView?.z ?? 10}
        terrain
        mapRef={mapRef}
        onLoad={() => { syncView(); onMapLoad(); setMapLoaded(true); }}
        onMoveEnd={syncView}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={() => { setHover(null); setLineOver(null); lineTip.clear(); singleTip.onLeave(); }}
        interactiveLayerIds={singlesTipOn ? ['open-casing', 'singles-hit'] : ['open-casing']}
        cursor={hover === 'pointer' ? 'pointer' : undefined}
      >
        {/* Declared first: the layers below have beforeId="clusters", which must exist when they are added (#1607). */}
        <Source id="starts" type="geojson" data={starts} cluster clusterRadius={50} clusterMaxZoom={CLUSTER_MAX_ZOOM} clusterProperties={CLUSTER_PROPERTIES as never}>
          {/* Anchor layer for the beforeId="clusters" of the others (#1607); markers are HTML (#1688). */}
          <Layer id="clusters" type="circle" filter={['has', 'point_count']} paint={{ 'circle-radius': 0, 'circle-opacity': 0 }} />
        </Source>
        <StartMarkers items={startItems} highlighted={hl} onCluster={onClusterTap} onStart={onStartTap} onHover={setOverSlug} />
        <TrackTip tip={lineTip.tip} />
        <SinglesLayer state={singles} colors={colors} beforeId="clusters" dimmed={!!openLine} highlightId={singleTip.tip?.info.id ?? null} />
        <SingleTip tip={singleTip.tip} onClose={singleTip.clear} />
        {outingsOn && (
          <OutingsLayer
            outings={mapOutings}
            zoom={zoom}
            onSelect={(id) => setPanel({ kind: 'outing', id })}
            onCluster={(lat, lon) => mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.min(zoom + 2, 14) })}
          />
        )}
        {/* Dimmed preview (#1583), under the open track and the start points. */}
        <Source id="preview" type="geojson" data={previewLine}>
          <Layer id="preview-line" beforeId="clusters" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.preview, 'line-width': 3.5, 'line-opacity': 0.5 }} />
        </Source>
        {openLine && <OpenTrackLayers sheet={openLine} colors={colors} mapRef={mapRef} marked={profileCursor ?? lineCursor} beforeId="clusters" />}
      </BaseMap>

      {/* Floating bar: search + filters. Shifted right of the panel on desktop. */}
      <div className={cn('absolute top-3 right-16 left-16 z-10 flex gap-2 lg:left-3', desktop && sheetOpen && 'left-[calc(var(--spacing-panel)+36px)]')}>
        <div className="relative flex-1 rounded-full border border-border glass shadow-md">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setDraft(e.target.value)} className="rounded-full border-transparent bg-transparent pl-11" />
        </div>
        <Button variant="glass" size="icon" aria-label={nFilters ? t('filtersActive', { n: nFilters }) : t('filters')} onClick={() => setPanel({ kind: 'filters' })} className="relative">
          <SlidersHorizontal />
          {nFilters > 0 && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-caption font-semibold text-primary-foreground tabular-nums ring-2 ring-background">{nFilters}</span>}
        </Button>
        {signedIn && (
          <>
            <Button asChild variant="glass" size="icon">
              <Link href="/importer" aria-label={t('import')}><Upload /></Link>
            </Button>
            <Button asChild variant="glass" size="icon">
              <Link href={newHref} aria-label={t('create')}><PencilRuler /></Link>
            </Button>
          </>
        )}
      </div>

      {/* Singletracks: no more button (#1436), setting in the filters; only the "truncated" notice stays here. */}
      <div className={cn('absolute top-[4.5rem] left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2', desktop && sheetOpen && 'left-[calc(var(--spacing-panel)+36px)]')}>
        <div className="flex flex-wrap gap-2">
          {signedIn && (
            <Button variant={mine ? 'primary' : 'glass'} aria-pressed={mine} onClick={() => apply({ ...filters, mine: mine ? undefined : true })} className={mine ? 'shadow-md' : undefined}>
              <UserRound aria-hidden /> {t('mine')}
            </Button>
          )}
          <Button variant={outingsOn ? 'primary' : 'glass'} aria-pressed={outingsOn} onClick={() => setOutingsOn(!outingsOn)} className={outingsOn ? 'shadow-md' : undefined}>
            <CalendarDays aria-hidden /> {tOut('toggle')}
          </Button>
        </div>
        <SinglesStatus state={singles} />
        {/* Slope legend (#1585): on the map as soon as a coloured track is open. Mobile: under the top buttons,
            outside the sheet; desktop: bottom left, right of the panel. */}
        {openLine && !desktop && <SlopeLegend className="static" />}
      </div>
      {openLine && desktop && <SlopeLegend className="bottom-8 left-[calc(var(--spacing-panel)+36px)]" />}

      {!sheetOpen && (
        <Button variant="glass" onClick={() => setPanel({ kind: 'list' })} className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full px-6 tabular-nums">
          <List />
          {tracks === null ? t('loading') : t('count', { n: visible.length })}
        </Button>
      )}

      <BottomSheet
        open={sheetOpen}
        onOpenChange={(o) => !o && setPanel(null)}
        title={panelTitle}
        description={panel?.kind === 'list' ? t('listDesc', { visible: visible.length, total }) : undefined}
        initialSnap={panel?.kind === 'track' || panel?.kind === 'outing' ? 0.5 : 0.92}
        tallFooter={(panel?.kind === 'track' && !!sheet) || (panel?.kind === 'outing' && !!outingTrack && outingTrack.profile.length > 1)}
        footer={
          panel?.kind === 'outing' && selectedOuting ? (
            <div className="flex flex-col gap-3" data-testid="outing-panel-footer">
              {outingTrack && outingTrack.profile.length > 1 && (
                <ElevationProfile points={outingTrack.profile} slopes legend={false} compact={!desktop} cursor={lineCursor} onScrub={(p) => setScrub(p ? { slug: `outing:${selectedOuting.id}`, i: p.index } : null)} />
              )}
              <Button asChild size="lg">{signedIn ? <Link href={`/sorties/${selectedOuting.id}`}>{tOut('seeOuting')}</Link> : <LoginLink>{tOut('seeOuting')}</LoginLink>}</Button>
            </div>
          ) : panel?.kind === 'track' && sheet ? (
            <TrackPanelFooter sheet={sheet} signedIn={signedIn} onVisibility={setSheetVisibility} compact={!desktop} cursor={lineCursor} onScrub={(i) => setScrub(i === null ? null : { slug: sheet.slug, i })} />
          ) : panel?.kind === 'filters' ? (
            <Button size="lg" onClick={() => setPanel({ kind: 'list' })}>{t('seeN', { n: total })}</Button>
          ) : undefined
        }
      >
        {panel?.kind === 'filters' && <FiltersForm value={filters} onChange={(f) => apply(f)} onReset={() => apply({})} />}
        {panel?.kind === 'group' && (
          <div className="flex flex-col gap-3">
            {groupTracks.map((g) => (
              <div key={g.slug} data-slug={g.slug} {...listHover(g.slug)}>
                <TrackCard onSelect={() => openTrack(g.slug, panel)} title={g.name} draft={g.status === 'draft'} visibility={g.visibility} distanceKm={g.distanceKm} elevationM={g.gainM} difficulty={g.difficulty ?? undefined} loop={g.loop} source={tTrack(`sources.${g.source}`)} />
              </div>
            ))}
          </div>
        )}
        {panel?.kind === 'outing' && !selectedOuting && <p className="text-muted-foreground">{tOut('gone')}</p>}
        {panel?.kind === 'outing' && selectedOuting && (
          <OutingView
            role={signedIn ? (selectedOuting.mine ? 'guest' : 'visitor') : 'anonymous'}
            presentation="panel"
            outing={{ title: selectedOuting.title, startsAt: new Date(selectedOuting.startsAt), level: selectedOuting.level, ebike: selectedOuting.ebike, meetingLabel: selectedOuting.meetingLabel, meetingLat: selectedOuting.lat, meetingLon: selectedOuting.lon, description: outingTrack?.description ?? null, visibility: selectedOuting.visibility }}
            track={outingTrack ? { ...outingTrack.track, geometry: outingTrack.geometry, bbox: outingTrack.bbox, start: [outingTrack.geometry.type === 'LineString' ? outingTrack.geometry.coordinates[0][0] : outingTrack.geometry.coordinates[0][0][0], outingTrack.geometry.type === 'LineString' ? outingTrack.geometry.coordinates[0][1] : outingTrack.geometry.coordinates[0][0][1]] } : null}
            notices={<p className="text-small text-muted-foreground">{tm('openBy', { name: selectedOuting.organizerName })}</p>}
            participants={outingTrack?.participants
              ? <OutingParticipants participants={outingTrack.participants} />
              : (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{tOut('going', { n: selectedOuting.yesCount })}</Badge>
                  {selectedOuting.spotsLeft != null && <Badge variant={selectedOuting.spotsLeft === 0 ? 'danger' : 'outline'}>{tOut('spots', { n: selectedOuting.spotsLeft })}</Badge>}
                </div>
              )}
          />
        )}
        {panel?.kind === 'track' && (
          <TrackPanelBody
            sheet={sheet}
            loading={sheetLoading}
            error={sheetError}
            backLabel={panel.from ? (panel.from.kind === 'group' ? t('panel.backToGroup') : t('panel.backToList')) : undefined}
            onBack={panel.from ? () => setPanel(panel.from ?? null) : undefined}
          />
        )}
        {panel?.kind === 'list' && (
          <div className="flex flex-col gap-3">
            <NativeSelect aria-label={t('sort.label')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(['near', 'short', 'long', 'gain', 'name'] as const).map((k) => (
                <option key={k} value={k}>{t(`sort.${k}`)}</option>
              ))}
            </NativeSelect>
            {tracks === null && !error && [0, 1, 2].map((i) => <TrackCardSkeleton key={i} />)}
            {error && <EmptyState icon={SearchX} title={t('errorTitle')}>{t('errorBody')}</EmptyState>}
            {tracks && mine && total === 0 && !error && (
              <EmptyState icon={Route} title={t('mineEmptyTitle')} action={<Button asChild size="lg"><Link href={newHref}>{t('create')}</Link></Button>}>
                {t('mineEmptyBody')}
              </EmptyState>
            )}
            {tracks && !(mine && total === 0) && visible.length === 0 && (
              <EmptyState icon={SearchX} title={total === 0 ? t('emptyFilters') : t('emptyView')}>
                {total === 0 ? t('emptyFiltersBody') : t('emptyViewBody')}
              </EmptyState>
            )}
            {visible.map((tr) => (
              <div key={tr.slug} data-slug={tr.slug} {...listHover(tr.slug)} className={cn('rounded-xl transition-shadow', hl === tr.slug && 'ring-2 ring-ring')}>
                <TrackCard onSelect={() => openTrack(tr.slug, { kind: 'list' })} title={tr.name} draft={tr.status === 'draft'} visibility={tr.visibility} distanceKm={tr.distanceKm} elevationM={tr.gainM} difficulty={tr.difficulty ?? undefined} loop={tr.loop} source={tTrack(`sources.${tr.source}`)} />
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
