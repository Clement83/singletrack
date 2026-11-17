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
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
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
import { OutingsLayer, useMapOutings } from './outings-layer';
import { useOutingsPref } from './outings-pref';
import { SinglesLayer, SinglesStatus, useSingles, useSinglesPref } from './singles-layer';
import { SlopeLegend } from '@/components/map/slope-legend';
import { OpenTrackLayers, TrackPanelBody, TrackPanelFooter, useOutingTrack, useTrackSheet } from './track-panel';
import { nearestProfileIndex } from '@/lib/elevation';
import { ElevationProfile } from '@/components/elevation-profile';

type ListPanel = { kind: 'list' } | { kind: 'group'; slugs: string[] };
/** `from` : la liste ou le groupe d'où la trace a été ouverte (bouton « Retour », #1582). */
type Panel = ListPanel | { kind: 'filters' } | { kind: 'track'; slug: string; from?: ListPanel } | { kind: 'outing'; id: string } | null;
type Sort = 'near' | 'short' | 'long' | 'gain' | 'name';
type View = [number, number, number, number];

const inView = (p: [number, number], v: View) => p[0] >= v[0] && p[0] <= v[2] && p[1] >= v[1] && p[1] <= v[3];
/** Au-delà, les départs ne se regroupent plus (#1531) : chaque départ est un repère, ceux d'un même parking se superposent. */
const CLUSTER_MAX_ZOOM = 16;
const openSlugOf = (p: Panel) => (p?.kind === 'track' ? p.slug : null);

/** `signedIn=false` : mode visiteur (#1591), sans « Mes traces », import ni création ; les actions réservées mènent à la connexion. */
export function TrackExplorer({ home, signedIn = true }: { home: { lat: number; lon: number }; signedIn?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const colors = useMapColors();
  const mapRef = useRef<MapRef>(null);

  // Le filtre d'accès aux massifs (`access`, #1349) n'est plus proposé ici (#1407) : ignoré s'il traîne dans un vieux lien.
  // « Mes traces » n'a pas de sens sans compte (#1591) : un `mine=1` dans le lien d'un visiteur est ignoré.
  const filters = useMemo(() => ({ ...parseFilters(new URLSearchParams(sp.toString())), access: undefined, ...(signedIn ? {} : { mine: undefined }) }), [sp, signedIn]);
  const filterKey = useMemo(() => serializeFilters({ ...filters, bbox: undefined }).toString(), [filters]);

  const [tracks, setTracks] = useState<TrackStart[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pinned, setPinned] = useState<TrackStart | undefined>();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const error = errorKey === filterKey;
  const [view, setView] = useState<View | null>(null);
  const [zoom, setZoom] = useState(10);
  // Calque des singles OSM (#1372) : actif par défaut (#1436), réglage dans les filtres.
  const t = useTranslations('explorer');
  const tTrack = useTranslations('track');
  const locale = useLocale();
  const [singlesOn] = useSinglesPref();
  const singles = useSingles(singlesOn, view, zoom);
  const [outingsOn, setOutingsOn] = useOutingsPref();
  const mapOutings = useMapOutings(outingsOn, view);
  const tOut = useTranslations('outingsMap');
  const tl = useTranslations('outingLabels');
  const [panel, setPanel] = useState<Panel>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Trace survolée sur la carte (#1533) : met en avant sa ligne dans la liste.
  const [overSlug, setOverSlug] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('near');
  const [draft, setDraft] = useState<string | null>(null);
  const q = draft ?? filters.q ?? '';
  // URL = source de vérité des filtres (partageable, retour arrière).
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

  // « Mes traces » (#1430) : à l'activation, la carte se recadre sur l'ensemble de ses traces (sinon on croit
  // qu'elles ont disparu). Une seule requête légère (départs seulement), sans emprise.
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

  // Recherche texte : on attend la fin de la frappe, puis l'URL reprend la main.
  useEffect(() => {
    if (draft === null) return;
    const t = setTimeout(() => {
      apply({ ...filters, q: draft.trim() || undefined }, 'replace');
      setDraft(null);
    }, 350);
    return () => clearTimeout(t);
  }, [draft, filters, apply]);

  // Départs légers de toute la France (#1530, #1531), une fois par jeu de filtres : la carte ne dessine que des
  // repères et des grappes (MapLibre), la géométrie d'une trace se charge à la demande quand on la choisit.
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

  // Tests de bout en bout (#1532) : `window.__E2E__` posé avant le chargement expose la carte pour projeter/inspecter.
  const onMapLoad = useCallback(() => {
    const w = window as unknown as { __E2E__?: boolean; __explorerMap?: unknown };
    if (w.__E2E__) w.__explorerMap = mapRef.current?.getMap();
  }, []);
  // Vue de la carte dans l'URL (#1577) : lue une fois à l'arrivée, écrite par replaceState (seuil anti-boucle).
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
  // Ancienne sélection multiple (#1532, retirée par #1584) : un vieux lien `?sel=` s'ouvre normalement, le paramètre est effacé.
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
  // Trace ouverte (`t`) : rouverte à l'arrivée si elle est encore visible, ignorée sinon ; ensuite l'URL suit le panneau.
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
  // Aperçu terne au survol d'une ligne de liste (#1583), desktop seulement (le tap ouvre directement la trace).
  const [preview, setPreview] = useState<string | null>(null);
  const listHover = (slug: string) => ({
    onMouseEnter: () => { setHover(slug); if (desktop) setPreview(slug); },
    onMouseLeave: () => { setHover(null); setPreview(null); },
    onFocus: () => { if (desktop) setPreview(slug); },
    onBlur: () => setPreview(null),
  });

  // Trace ouverte (#1582) : fiche complète chargée à la demande, tracé coloré par pente sur la carte, profil synchronisé.
  const openSlug = panel?.kind === 'track' ? panel.slug : null;
  const { sheet, loading: sheetLoading, error: sheetError, setVisibility: setSheetVisibility } = useTrackSheet(openSlug);
  // Sortie ouverte (#1596) : son parcours figé se dessine comme une trace ouverte (un seul tracé à la fois).
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
  // À l'ouverture, la carte se cale sur la trace si elle n'est pas entièrement dans la vue (une fois par trace).
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

  // Géométries à la demande (#1531), pour l'aperçu au survol : seulement celles qu'on n'a pas encore.
  const [geoms, setGeoms] = useState<Record<string, NonNullable<TrackSummary['geometry']>>>({});
  const geomsRef = useRef(geoms);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    geomsRef.current = geoms;
    zoomRef.current = zoom;
  });
  // Géométries voulues : traces du groupe ouvert (préchargées pour un aperçu instantané, ≤ 50) et trace survolée.
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

  // Infobulle « km depuis le départ » sur la trace ouverte (#1535), avec l'altitude du profil.
  const lineTip = useTrackTip((e) => {
    const f = e.features?.[0];
    if (f?.layer.id !== 'open-casing' || !openLine) return null;
    return { geometry: openLine.geometry, ele: (lon, lat) => openLine.profile[nearestProfileIndex(openLine.profile, lon, lat)]?.ele ?? null };
  });
  const onClick = (e: MapLayerMouseEvent) => {
    lineTip.onTap(e);
    const f = e.features?.[0];
    if (!f) return;
    const src = mapRef.current?.getSource('starts') as GeoJSONSource | undefined;
    if (f.layer.id === 'clusters') {
      const id = f.properties?.cluster_id;
      src?.getClusterExpansionZoom(id).then(async (z) => {
        // La grappe ne s'éclate plus en zoomant (même parking) : on en liste les traces.
        if (z > CLUSTER_MAX_ZOOM) {
          const leaves = await src.getClusterLeaves(id, 50, 0);
          setPanel({ kind: 'group', slugs: leaves.map((l) => l.properties?.slug as string) });
          return;
        }
        mapRef.current?.easeTo({ center: e.lngLat, zoom: z });
      });
      return;
    }
    if (f.layer.id !== 'start-hit') return;
    // Repère de départ : toutes les traces qui partent d'ici ; une seule → sa fiche dans le panneau, plusieurs → la liste.
    const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const here = tracksAtStart(tracks ?? [], at);
    if (here.length > 1) setPanel({ kind: 'group', slugs: here.map((t) => t.slug) });
    else if (f.properties?.slug) openTrack(f.properties.slug as string);
  };
  const onMouseMove = (e: MapLayerMouseEvent) => {
    lineTip.onMove(e);
    const onLine = openLine && lineKey && e.features?.some((x) => x.layer.id === 'open-casing');
    setLineOver(onLine ? { slug: lineKey, i: nearestProfileIndex(openLine.profile, e.lngLat.lng, e.lngLat.lat) } : null);
    setHover(e.features?.some((x) => x.layer.id === 'start-hit' || x.layer.id === 'clusters') ? 'pointer' : null);
    const over = e.features?.find((x) => x.layer.id === 'start-hit')?.properties?.slug as string | undefined;
    setOverSlug((o) => (o === (over ?? null) ? o : (over ?? null)));
  };

  const nFilters = activeFilterCount(filters);
  if (!colors) return null;
  const diffColor: unknown = [
    'match', ['get', 'difficulty'],
    'green', colors.green, 'blue', colors.blue, 'red', colors.red, 'black', colors.black,
    colors.primary,
  ];

  const panelTitle = panel?.kind === 'filters' ? t('filters') : panel?.kind === 'group' ? t('panelGroup', { n: groupTracks.length }) : panel?.kind === 'outing' ? tOut('panelTitle') : panel?.kind === 'track' ? (sheet ? sheet.name || tTrack('untitled') : selected ? selected.name || tTrack('untitled') : t('panelTrack')) : t('panelList');
  const sheetOpen = panel !== null;
  const selectedOuting = panel?.kind === 'outing' ? mapOutings.find((o) => o.id === panel.id) : undefined;

  return (
    <>
      <BaseMap
        lat={initialView?.lat ?? home.lat}
        lon={initialView?.lng ?? home.lon}
        zoom={initialView?.z ?? 10}
        mapRef={mapRef}
        onLoad={() => { syncView(); onMapLoad(); }}
        onMoveEnd={syncView}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={() => { setHover(null); setOverSlug(null); setLineOver(null); lineTip.clear(); }}
        interactiveLayerIds={['clusters', 'start-hit', 'open-casing']}
        cursor={hover === 'pointer' ? 'pointer' : undefined}
      >
        <TrackTip tip={lineTip.tip} />
        <SinglesLayer state={singles} colors={colors} beforeId="clusters" />
        {outingsOn && (
          <OutingsLayer
            outings={mapOutings}
            zoom={zoom}
            onSelect={(id) => setPanel({ kind: 'outing', id })}
            onCluster={(lat, lon) => mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.min(zoom + 2, 14) })}
          />
        )}
        {/* Aperçu terne (#1583), sous la trace ouverte et les départs. */}
        <Source id="preview" type="geojson" data={previewLine}>
          <Layer id="preview-line" beforeId="clusters" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.preview, 'line-width': 3.5, 'line-opacity': 0.5 }} />
        </Source>
        {openLine && <OpenTrackLayers sheet={openLine} colors={colors} mapRef={mapRef} marked={profileCursor ?? lineCursor} beforeId="clusters" />}
        <Source id="starts" type="geojson" data={starts} cluster clusterRadius={50} clusterMaxZoom={CLUSTER_MAX_ZOOM}>
          <Layer id="clusters" type="circle" filter={['has', 'point_count']} paint={{ 'circle-color': colors.primary, 'circle-opacity': 0.85, 'circle-stroke-color': colors.card, 'circle-stroke-width': 3, 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28] }} />
          <Layer id="start-points" type="circle" filter={['!', ['has', 'point_count']]} paint={{ 'circle-color': diffColor as string, 'circle-stroke-color': colors.card, 'circle-stroke-width': 2.5, 'circle-radius': ['case', ['==', ['get', 'slug'], hl], 12, 9] }} />
          {/* Zone tactile ≥ 44 px (rayon 22), invisible. */}
          <Layer id="start-hit" type="circle" filter={['!', ['has', 'point_count']]} paint={{ 'circle-color': colors.foreground, 'circle-opacity': 0, 'circle-radius': 22 }} />
        </Source>
      </BaseMap>

      {/* Barre flottante : recherche + filtres. Décalée à droite du panneau en desktop. */}
      <div className={cn('absolute top-3 right-16 left-16 z-10 flex gap-2 lg:left-3', desktop && sheetOpen && 'left-[calc(var(--spacing-panel)+36px)]')}>
        <div className="relative flex-1">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setDraft(e.target.value)} className="rounded-full pl-11 shadow-md" />
        </div>
        <Button variant="outline" size="icon" aria-label={nFilters ? t('filtersActive', { n: nFilters }) : t('filters')} onClick={() => setPanel({ kind: 'filters' })} className="relative shadow-md">
          <SlidersHorizontal />
          {nFilters > 0 && <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-caption text-primary-foreground">{nFilters}</span>}
        </Button>
        {signedIn && (
          <>
            <Button asChild variant="outline" size="icon" className="shadow-md">
              <Link href="/importer" aria-label={t('import')}><Upload /></Link>
            </Button>
            <Button asChild variant="outline" size="icon" className="shadow-md">
              <Link href={newHref} aria-label={t('create')}><PencilRuler /></Link>
            </Button>
          </>
        )}
      </div>

      {/* Singles : plus de bouton (#1436), réglage dans les filtres ; seule l'indication « tronqué » reste ici. */}
      <div className={cn('absolute top-[4.5rem] left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2', desktop && sheetOpen && 'left-[calc(var(--spacing-panel)+36px)]')}>
        <div className="flex flex-wrap gap-2">
          {signedIn && (
            <Button variant={mine ? 'primary' : 'outline'} aria-pressed={mine} onClick={() => apply({ ...filters, mine: mine ? undefined : true })} className="shadow-md">
              <UserRound aria-hidden /> {t('mine')}
            </Button>
          )}
          <Button variant={outingsOn ? 'primary' : 'outline'} aria-pressed={outingsOn} onClick={() => setOutingsOn(!outingsOn)} className="shadow-md">
            <CalendarDays aria-hidden /> {tOut('toggle')}
          </Button>
        </div>
        <SinglesStatus state={singles} />
        {/* Légende des pentes (#1585) : sur la carte dès qu'une trace colorée est ouverte. Mobile : sous les boutons du haut,
            hors du sheet ; desktop : en bas à gauche, à droite du panneau. */}
        {openLine && !desktop && <SlopeLegend className="static" />}
      </div>
      {openLine && desktop && <SlopeLegend className="bottom-8 left-[calc(var(--spacing-panel)+36px)]" />}

      {!sheetOpen && (
        <Button onClick={() => setPanel({ kind: 'list' })} className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full px-6 shadow-md">
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
          <div className="flex flex-col gap-3">
            <h3 className="text-heading break-words">{selectedOuting.title}</h3>
            <p className="text-body tabular-nums">{formatOutingDate(new Date(selectedOuting.startsAt), locale)}</p>
            {selectedOuting.meetingLabel && <p className="text-small text-muted-foreground">{tOut('meeting', { place: selectedOuting.meetingLabel })}</p>}
            <p className="text-heading tabular-nums">{formatKm(selectedOuting.distanceM / 1000, locale)}{selectedOuting.gainM != null ? ` · ${formatElevation(selectedOuting.gainM, locale)}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="primary">{tl(`level.${selectedOuting.level}`)}</Badge>
              <Badge variant="outline">{tl(`ebike.${selectedOuting.ebike}`)}</Badge>
              <Badge variant="outline">{tOut('going', { n: selectedOuting.yesCount })}</Badge>
              {selectedOuting.spotsLeft != null && <Badge variant={selectedOuting.spotsLeft === 0 ? 'danger' : 'outline'}>{tOut('spots', { n: selectedOuting.spotsLeft })}</Badge>}
            </div>
          </div>
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
              <div key={tr.slug} data-slug={tr.slug} {...listHover(tr.slug)} className={cn('rounded-2xl', hl === tr.slug && 'ring-2 ring-ring')}>
                <TrackCard onSelect={() => openTrack(tr.slug, { kind: 'list' })} title={tr.name} draft={tr.status === 'draft'} visibility={tr.visibility} distanceKm={tr.distanceKm} elevationM={tr.gainM} difficulty={tr.difficulty ?? undefined} loop={tr.loop} source={tTrack(`sources.${tr.source}`)} />
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
