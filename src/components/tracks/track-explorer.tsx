'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Layer, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import type { GeoJSONSource } from 'maplibre-gl';
import { BadgeCheck, CalendarDays, Crosshair, List, Plus, UserRound, Search, Route, SearchX, SlidersHorizontal, PencilRuler, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import BaseMap from '@/components/BaseMap';
import { TrackCard, TrackCardSkeleton } from '@/components/track-card';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, NativeSelect } from '@/components/ui/field';
import { DifficultyBadge, Badge } from '@/components/ui/badge';
import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import { activeFilterCount, parseFilters, serializeFilters, type TrackFilters } from '@/lib/tracks/filters';
import type { TrackStart, TrackSummary } from '@/lib/tracks/query';
import { tracksAtStart } from '@/lib/tracks/same-start';
import { MAX_SELECTION, assignColors, parseSelection, serializeSelection, toggleSelection } from '@/lib/tracks/selection';
import { haversine } from '@/lib/geo/distance';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { FiltersForm } from './filters-form';
import { useMapColors } from './use-map-colors';
import { OutingsLayer, useMapOutings } from './outings-layer';
import { useOutingsPref } from './outings-pref';
import { SinglesLayer, SinglesStatus, useSingles, useSinglesPref } from './singles-layer';

type Panel = { kind: 'list' } | { kind: 'group'; slugs: string[] } | { kind: 'filters' } | { kind: 'track'; slug: string } | { kind: 'outing'; id: string } | null;
type Sort = 'near' | 'short' | 'long' | 'gain' | 'name';
type View = [number, number, number, number];

const inView = (p: [number, number], v: View) => p[0] >= v[0] && p[0] <= v[2] && p[1] >= v[1] && p[1] <= v[3];
/** Au-delà, les départs ne se regroupent plus (#1531) : chaque départ est un repère, ceux d'un même parking se superposent. */
const CLUSTER_MAX_ZOOM = 16;

export function TrackExplorer({ home }: { home: { lat: number; lon: number } }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const desktop = useMediaQuery(DESKTOP);
  const colors = useMapColors();
  const mapRef = useRef<MapRef>(null);

  // Le filtre d'accès aux massifs (`access`, #1349) n'est plus proposé ici (#1407) : ignoré s'il traîne dans un vieux lien.
  const filters = useMemo(() => ({ ...parseFilters(new URLSearchParams(sp.toString())), access: undefined }), [sp]);
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
      const keep = new URLSearchParams(window.location.search).get('sel');
      if (keep) params.set('sel', keep);
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
  const syncView = useCallback(() => {
    const b = mapRef.current?.getBounds();
    if (b) setView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    const z = mapRef.current?.getZoom();
    if (z !== undefined) setZoom(z);
  }, []);

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

  const selected = panel?.kind === 'track' ? (tracks?.find((t) => t.slug === panel.slug) ?? (pinned?.slug === panel.slug ? pinned : undefined)) : undefined;
  const hl = selected?.slug ?? (hover && hover !== 'pointer' ? hover : overSlug) ?? '';
  const groupTracks = panel?.kind === 'group' ? (tracks ?? []).filter((t) => panel.slugs.includes(t.slug)) : [];

  // Sélection multiple (#1532) : l'URL (`?sel=slug1,slug2`) est la source de vérité (retour arrière, partage, rechargement).
  const selection = useMemo(() => parseSelection(sp.get('sel')), [sp]);
  // Le numéro de couleur d'une trace reste le même tant qu'elle est choisie (même si une autre est retirée).
  const [colorMap, setColorMap] = useState<Record<string, number>>({});
  const selColors = useMemo(() => assignColors(selection, colorMap), [selection, colorMap]);
  if (JSON.stringify(colorMap) !== JSON.stringify(selColors)) setColorMap(selColors);
  const setSelection = useCallback(
    (next: string[], mode: 'push' | 'replace' = 'push') => {
      const params = new URLSearchParams(window.location.search);
      if (next.length) params.set('sel', serializeSelection(next));
      else params.delete('sel');
      const qs = params.toString();
      router[mode](qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Géométries des traces choisies, à la demande (#1531) : seulement celles qu'on n'a pas encore.
  const [geoms, setGeoms] = useState<Record<string, NonNullable<TrackSummary['geometry']>>>({});
  const geomsRef = useRef(geoms);
  const zoomRef = useRef(zoom);
  useEffect(() => {
    geomsRef.current = geoms;
    zoomRef.current = zoom;
  });
  const selectionKey = selection.join(',');
  useEffect(() => {
    const missing = selectionKey ? selectionKey.split(',').filter((s) => !geomsRef.current[s]) : [];
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
  }, [selectionKey]);
  const lastSlug = selection[selection.length - 1];
  const selectedLines = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: !colors
        ? []
        : selection.flatMap((slug) => {
            const geometry = geoms[slug];
            if (!geometry) return [];
            return [{ type: 'Feature' as const, properties: { slug, color: colors[`sel-${selColors[slug]}` as 'sel-1'], last: slug === lastSlug || slug === hl }, geometry }];
          }),
    }),
    [selection, geoms, colors, selColors, lastSlug, hl],
  );
  const selectedStarts = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: !colors
        ? []
        : selection.flatMap((slug) => {
            const t = tracks?.find((x) => x.slug === slug);
            if (!t) return [];
            return [{ type: 'Feature' as const, properties: { slug, color: colors[`sel-${selColors[slug]}` as 'sel-1'] }, geometry: { type: 'Point' as const, coordinates: t.start } }];
          }),
    }),
    [selection, tracks, colors, selColors],
  );

  // Un tap sur un départ : l'ajoute (et ouvre sa fiche), ou le retire s'il était déjà choisi.
  const toggleTrack = (slug: string) => {
    const r = toggleSelection(selection, slug);
    if (r.action === 'full') {
      toast.error(t('selectionFull', { n: MAX_SELECTION }));
      return;
    }
    if (r.action === 'removed') {
      if (panel?.kind === 'track' && panel.slug === slug) setPanel(null);
    } else if (r.action === 'added') {
      setPinned(tracks?.find((x) => x.slug === slug));
      setPanel({ kind: 'track', slug });
    }
    setSelection(r.selection);
  };

  const chosenTracks = selection.flatMap((slug) => {
    const x = tracks?.find((y) => y.slug === slug);
    return x ? [x] : [];
  });
  // Depuis la liste : ajoute/retire sans quitter la liste (pas d'ouverture de fiche).
  const toggleFromList = (slug: string) => {
    const r = toggleSelection(selection, slug);
    if (r.action === 'full') toast.error(t('selectionFull', { n: MAX_SELECTION }));
    else setSelection(r.selection);
  };

  const onClick = (e: MapLayerMouseEvent) => {
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
    // Repère de départ : toutes les traces qui partent d'ici ; une seule → sa fiche, plusieurs → la liste.
    const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const here = tracksAtStart(tracks ?? [], at);
    if (here.length > 1) setPanel({ kind: 'group', slugs: here.map((t) => t.slug) });
    else if (f.properties?.slug) toggleTrack(f.properties.slug as string);
  };
  const onMouseMove = (e: MapLayerMouseEvent) => {
    setHover(e.features?.some((x) => x.layer.id === 'start-hit' || x.layer.id === 'clusters') ? 'pointer' : null);
    const over = e.features?.find((x) => x.layer.id === 'start-hit')?.properties?.slug as string | undefined;
    setOverSlug((o) => (o === (over ?? null) ? o : (over ?? null)));
  };

  // Recentre la carte sur l'ensemble des traces choisies (géométrie si chargée, sinon leur départ).
  const fitSelection = () => {
    const b: View = [180, 90, -180, -90];
    const add = (c: unknown) => {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number') {
        const [x, y] = c as number[];
        b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
      } else c.forEach(add);
    };
    for (const slug of selection) {
      const g = geoms[slug] as { coordinates?: unknown } | undefined;
      if (g?.coordinates) add(g.coordinates);
      else add(tracks?.find((x) => x.slug === slug)?.start);
    }
    if (b[0] > b[2]) return;
    mapRef.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 90, bottom: 120, left: 40, right: 40 }, maxZoom: 15, duration: 600 });
  };

  const nFilters = activeFilterCount(filters);
  if (!colors) return null;
  const diffColor: unknown = [
    'match', ['get', 'difficulty'],
    'green', colors.green, 'blue', colors.blue, 'red', colors.red, 'black', colors.black,
    colors.primary,
  ];

  const panelTitle = panel?.kind === 'filters' ? t('filters') : panel?.kind === 'group' ? t('panelGroup', { n: groupTracks.length }) : panel?.kind === 'outing' ? tOut('panelTitle') : panel?.kind === 'track' ? (selected ? selected.name || tTrack('untitled') : t('panelTrack')) : t('panelList');
  const sheetOpen = panel !== null;
  const selectedOuting = panel?.kind === 'outing' ? mapOutings.find((o) => o.id === panel.id) : undefined;

  return (
    <>
      <BaseMap
        lat={home.lat}
        lon={home.lon}
        zoom={10}
        mapRef={mapRef}
        onLoad={() => { syncView(); onMapLoad(); }}
        onMoveEnd={syncView}
        onClick={onClick}
        onMouseMove={onMouseMove}
        onMouseLeave={() => { setHover(null); setOverSlug(null); }}
        interactiveLayerIds={['clusters', 'start-hit']}
        cursor={hover === 'pointer' ? 'pointer' : undefined}
      >
        <SinglesLayer state={singles} colors={colors} beforeId="clusters" />
        {outingsOn && (
          <OutingsLayer
            outings={mapOutings}
            zoom={zoom}
            onSelect={(id) => setPanel({ kind: 'outing', id })}
            onCluster={(lat, lon) => mapRef.current?.easeTo({ center: [lon, lat], zoom: Math.min(zoom + 2, 14) })}
          />
        )}
        <Source id="selected" type="geojson" data={selectedLines}>
          <Layer id="selected-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': ['case', ['get', 'last'], 10, 8], 'line-opacity': 0.9 }} />
          <Layer id="selected-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'last'], 6, 4], 'line-opacity': ['case', ['get', 'last'], 1, 0.85] }} />
        </Source>
        <Source id="starts" type="geojson" data={starts} cluster clusterRadius={50} clusterMaxZoom={CLUSTER_MAX_ZOOM}>
          <Layer id="clusters" type="circle" filter={['has', 'point_count']} paint={{ 'circle-color': colors.primary, 'circle-opacity': 0.85, 'circle-stroke-color': colors.card, 'circle-stroke-width': 3, 'circle-radius': ['step', ['get', 'point_count'], 16, 10, 22, 50, 28] }} />
          <Layer id="start-points" type="circle" filter={['!', ['has', 'point_count']]} paint={{ 'circle-color': diffColor as string, 'circle-stroke-color': colors.card, 'circle-stroke-width': 2.5, 'circle-radius': ['case', ['==', ['get', 'slug'], hl], 12, 9] }} />
          {/* Zone tactile ≥ 44 px (rayon 22), invisible. */}
          <Layer id="start-hit" type="circle" filter={['!', ['has', 'point_count']]} paint={{ 'circle-color': colors.foreground, 'circle-opacity': 0, 'circle-radius': 22 }} />
        </Source>
        {/* Repères des départs choisis : anneau à la couleur de leur trace, au-dessus des repères de difficulté. */}
        <Source id="selected-starts" type="geojson" data={selectedStarts}>
          <Layer id="selected-starts-ring" type="circle" paint={{ 'circle-color': 'transparent', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 4, 'circle-radius': 14 }} />
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
        <Button asChild variant="outline" size="icon" className="shadow-md">
          <Link href="/importer" aria-label={t('import')}><Upload /></Link>
        </Button>
        <Button asChild variant="outline" size="icon" className="shadow-md">
          <Link href="/new" aria-label={t('create')}><PencilRuler /></Link>
        </Button>
      </div>

      {/* Singles : plus de bouton (#1436), réglage dans les filtres ; seule l'indication « tronqué » reste ici. */}
      <div className={cn('absolute top-[4.5rem] left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2', desktop && sheetOpen && 'left-[calc(var(--spacing-panel)+36px)]')}>
        <div className="flex flex-wrap gap-2">
          <Button variant={mine ? 'primary' : 'outline'} aria-pressed={mine} onClick={() => apply({ ...filters, mine: mine ? undefined : true })} className="shadow-md">
            <UserRound aria-hidden /> {t('mine')}
          </Button>
          <Button variant={outingsOn ? 'primary' : 'outline'} aria-pressed={outingsOn} onClick={() => setOutingsOn(!outingsOn)} className="shadow-md">
            <CalendarDays aria-hidden /> {tOut('toggle')}
          </Button>
        </div>
        {selection.length > 0 && (
          <div className="flex items-center gap-1 rounded-full border border-border bg-card py-1 pr-1 pl-4 shadow-md">
            <span className="text-small tabular-nums" aria-live="polite">{t('selectionCount', { n: selection.length })}</span>
            <Button variant="ghost" onClick={() => { setSelection([]); if (panel?.kind === 'track') setPanel(null); }}>
              <X aria-hidden /> {t('selectionClear')}
            </Button>
          </div>
        )}
        <SinglesStatus state={singles} />
      </div>

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
        footer={
          panel?.kind === 'outing' && selectedOuting ? (
            <Button asChild size="lg"><Link href={`/sorties/${selectedOuting.id}`}>{tOut('seeOuting')}</Link></Button>
          ) : panel?.kind === 'track' && selected ? (
            <Button asChild size="lg"><Link href={`/t/${selected.slug}`}>{t('seeTrack')}</Link></Button>
          ) : panel?.kind === 'filters' ? (
            <Button size="lg" onClick={() => setPanel({ kind: 'list' })}>{t('seeN', { n: total })}</Button>
          ) : undefined
        }
      >
        {panel?.kind === 'filters' && <FiltersForm value={filters} onChange={(f) => apply(f)} onReset={() => apply({})} />}
        {panel?.kind === 'group' && (
          <div className="flex flex-col gap-3">
            {groupTracks.map((g) => (
              <TrackCard key={g.slug} href={`/t/${g.slug}`} title={g.name} draft={g.status === 'draft'} distanceKm={g.distanceKm} elevationM={g.gainM} difficulty={g.difficulty ?? undefined} loop={g.loop} source={tTrack(`sources.${g.source}`)} />
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
        {panel?.kind === 'track' && selected && (
          <div className="flex flex-col gap-3">
            <p className="text-heading tabular-nums">{formatKm(selected.distanceKm, locale)} · {selected.gainM != null ? formatElevation(selected.gainM, locale) : t('gainUnknown')}</p>
            <div className="flex flex-wrap gap-2">
              {selected.status === 'draft' && <Badge variant="outline">{tTrack('draft')}</Badge>}
              {selected.difficulty && <DifficultyBadge level={selected.difficulty} />}
              {selected.source === 'geotrek' && <Badge variant="outline"><BadgeCheck aria-hidden className="size-4" /> {tTrack('official')}</Badge>}
              {selected.loop && <Badge>{tTrack('loop')}</Badge>}
            </div>
            <p className="text-small text-muted-foreground">{tTrack('source', { source: tTrack(`sources.${selected.source}`) })}</p>
            {selection.includes(selected.slug) && (
              <Button variant="outline" onClick={() => toggleTrack(selected.slug)}>
                <X aria-hidden /> {t('selectionRemove')}
              </Button>
            )}
          </div>
        )}
        {panel?.kind === 'list' && (
          <div className="flex flex-col gap-3">
            {chosenTracks.length > 0 && (
              <section aria-labelledby="chosen-title" className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3" data-testid="chosen-panel">
                <div className="flex items-center justify-between gap-2">
                  <h3 id="chosen-title" className="text-heading">{t('chosenTitle', { n: chosenTracks.length })}</h3>
                  <Button variant="outline" onClick={fitSelection}><Crosshair aria-hidden /> {t('chosenFit')}</Button>
                </div>
                <ul className="flex flex-col gap-1">
                  {chosenTracks.map((c) => (
                    <li key={c.slug} data-slug={c.slug} onMouseEnter={() => setHover(c.slug)} onMouseLeave={() => setHover(null)} className={cn('flex items-center gap-2 rounded-xl', hl === c.slug && 'bg-accent/60')}>
                      <span aria-hidden className="size-4 shrink-0 rounded-full border border-card" style={{ backgroundColor: colors[`sel-${selColors[c.slug]}` as 'sel-1'] }} />
                      <Link href={`/t/${c.slug}`} className="flex min-h-touch min-w-0 flex-1 flex-col justify-center">
                        <span className="truncate text-body font-semibold">{c.name || tTrack('untitled')}</span>
                        <span className="flex flex-wrap items-center gap-x-2 text-small tabular-nums text-muted-foreground">
                          <span>{formatKm(c.distanceKm, locale)} · {c.gainM != null ? formatElevation(c.gainM, locale) : t('gainUnknown')}</span>
                          {c.difficulty && <DifficultyBadge level={c.difficulty} />}
                          {c.loop && <Badge>{tTrack('loop')}</Badge>}
                        </span>
                      </Link>
                      <Button variant="ghost" size="icon" aria-label={t('selectionRemoveNamed', { name: c.name || tTrack('untitled') })} onClick={() => toggleTrack(c.slug)}>
                        <X aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <NativeSelect aria-label={t('sort.label')} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {(['near', 'short', 'long', 'gain', 'name'] as const).map((k) => (
                <option key={k} value={k}>{t(`sort.${k}`)}</option>
              ))}
            </NativeSelect>
            {tracks === null && !error && [0, 1, 2].map((i) => <TrackCardSkeleton key={i} />)}
            {error && <EmptyState icon={SearchX} title={t('errorTitle')}>{t('errorBody')}</EmptyState>}
            {tracks && mine && total === 0 && !error && (
              <EmptyState icon={Route} title={t('mineEmptyTitle')} action={<Button asChild size="lg"><Link href="/new">{t('create')}</Link></Button>}>
                {t('mineEmptyBody')}
              </EmptyState>
            )}
            {tracks && !(mine && total === 0) && visible.length === 0 && (
              <EmptyState icon={SearchX} title={total === 0 ? t('emptyFilters') : t('emptyView')}>
                {total === 0 ? t('emptyFiltersBody') : t('emptyViewBody')}
              </EmptyState>
            )}
            {visible.map((tr) => {
              const chosen = selection.includes(tr.slug);
              return (
                <div key={tr.slug} data-slug={tr.slug} onMouseEnter={() => setHover(tr.slug)} onMouseLeave={() => setHover(null)} className={cn('flex items-stretch gap-2 rounded-2xl', hl === tr.slug && 'ring-2 ring-ring')}>
                  <TrackCard className="min-w-0 flex-1" href={`/t/${tr.slug}`} title={tr.name} draft={tr.status === 'draft'} distanceKm={tr.distanceKm} elevationM={tr.gainM} difficulty={tr.difficulty ?? undefined} loop={tr.loop} source={tTrack(`sources.${tr.source}`)} />
                  <Button variant={chosen ? 'primary' : 'outline'} size="icon" className="h-auto min-h-touch self-stretch" aria-pressed={chosen} aria-label={chosen ? t('selectionRemoveNamed', { name: tr.name || tTrack('untitled') }) : t('selectionAddNamed', { name: tr.name || tTrack('untitled') })} onClick={() => toggleFromList(tr.slug)}>
                    {chosen ? <X aria-hidden /> : <Plus aria-hidden />}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
