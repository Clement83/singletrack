'use client';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useCallback, useEffect, useMemo, useDeferredValue, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Layer, Marker, Source, type MapLayerMouseEvent, type MapRef } from 'react-map-gl/maplibre';
import { toast } from 'sonner';
import BaseMap from '@/components/BaseMap';
import { SlopeRouteLayer } from '@/components/map/slope-route-layer';
import { KmMarkers } from '@/components/map/km-markers';
import { gradeAt, nearestProfileIndex } from '@/lib/elevation';
import { edgeGrades } from '@/lib/geo/slopes';
import { haversine } from '@/lib/geo/distance';
import { SlopeLegend } from '@/components/map/slope-legend';
import { ProfileCursorMarker } from '@/components/map/profile-cursor-marker';
import { slopeFeaturesForRuns } from '@/lib/geo/slope-features';
import { useMapColors } from '@/components/tracks/use-map-colors';
import { SinglesLayer, useSingles, useSinglesPref } from '@/components/tracks/singles-layer';
import { cn } from '@/lib/utils';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { docGeometry, pendingSegments, segmentLine, type EditorDoc, type LonLat } from '@/lib/editor/doc';
import { editorReducer, initialState, type EditorAction, type EditorState } from '@/lib/editor/state';
import { liveStats, type LiveStats } from '@/lib/editor/stats';
import type { Position } from '@/lib/geo';
import { DesktopPointPopover, EditorDesktop } from './editor-desktop';
import { AltCard, AltLabels, DeviationCard, DeviationLabel, HoverTip, LineMenu, RouteNoteMarker, type HoverTipState, type LineMenuState } from './editor-desktop-map';
import { useRider } from '@/lib/editor/rider';
import { snapTolerance, hitWidth } from '@/lib/editor/snap';
import { useSnapPref } from '@/lib/editor/snap-pref';
import { FINE_POINTER } from '@/lib/use-desktop-autofocus';
import type { Deviation } from '@/lib/editor/doc';
import { docSig, liveAltSets, nextAlt, upsertAlt, type AltSet } from '@/lib/editor/alts';
import { chooseAltResult, snapPointIn, decideClick, dragPointAction, endLineDrag, moveLineDrag, pointDragExclude, resolveRouted, type HitFeature } from '@/lib/editor/gestures';
import type { Quality } from '@/lib/routing/alternatives';
import type { Rider } from '@/lib/routing/score';
import { EditorMobileBottom, EditorMobileProfile } from './editor-mobile';

export type EditorMode = 'create' | 'update' | 'copy';
export type AutosaveState = 'idle' | 'saving' | 'saved' | 'error';
/** Délai avant l'enregistrement automatique d'une modification (#1450). */
const AUTOSAVE_DELAY_MS = 2000;

type Props = {
  mode: EditorMode;
  initialDoc: EditorDoc;
  initialName?: string;
  initialDescription?: string;
  /** Slug de la trace éditée (update) ou d'origine (copy). */
  slug?: string;
  /** Statut de la trace éditée en place (#1450). */
  initialStatus?: 'draft' | 'published';
  home: LonLat;
  /** Zoom initial (vue transmise par la carte, #1577) ; 13 par défaut. */
  initialZoom?: number;
  bounds?: [number, number, number, number];
};

/** Tout ce dont les mises en page (mobile #1392, desktop #1393) ont besoin : état, actions, enregistrement. */
export type EditorCtl = {
  mode: EditorMode;
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  doc: EditorDoc;
  stats: LiveStats;
  pending: number[];
  canSave: boolean;
  home: LonLat;
  /** Lien « quitter » (carte ou fiche de la trace). */
  quitHref: string;
  /** Slug de la trace éditée (absent à la création). */
  slug?: string;
  /** Vrai si des modifications ne sont pas encore enregistrées (enregistrement automatique en attente ou en cours). */
  dirty: boolean;
  /** Enregistrement automatique (#1450) : état de l'indicateur. */
  autosave: AutosaveState;
  /** Libellé de l'action principale du panneau : `publish` (brouillon / nouvelle trace) ou `update` (trace déjà publiée). */
  saveKey: 'publish' | 'update';
  /** Une trace de l'utilisateur existe déjà en base (brouillon ou publiée) : on peut la supprimer. */
  canDelete: boolean;
  /** Avant de quitter : enregistre d'abord, puis navigue ; popin seulement si l'enregistrement échoue. */
  requestLeave: (e: { preventDefault: () => void }) => void;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  errors: Record<string, string>;
  saving: boolean;
  save: () => Promise<void>;
  /** Curseur du profil (indice dans `stats.profile`, qui suit point par point la géométrie du doc), #1391. */
  setProfileCursor: (i: number | null) => void;
  /** Cycliste du routage (#1385) : musculaire ou VAE (seuils de pente différents). */
  rider: Rider;
  /** Survol de la trace à la souris (desktop) → curseur imposé au profil (#1383), sans déplacer la carte. */
  mapHoverIndex: number | null;
  /** Itinéraires alternatifs (#1386) de chaque tronçon de la portion modifiée (#1527), vides dès le prochain geste sur ces tronçons. */
  alts: AltSet[];
  /** Choisit l'itinéraire `i` du tronçon `seg` (entre dans l'historique ; 0 = recommandé). */
  chooseAlt: (i: number, seg: number) => void;
  /** Passe à l'itinéraire suivant (raccourci A). */
  cycleAlt: () => void;
  /** Parcours d'origine de la dernière déviation (#1451), rétablissable d'un tap ; `null` dès le geste suivant. */
  deviation: Deviation | null;
  restoreDeviation: () => void;
  /** Aimant (#1437) : actif ou non (réglage mémorisé). */
  snapOn: boolean;
};

type AltAnswer = { coordinates: Position[]; deltaKm: number; quality: Quality };
const key = (a: LonLat, b: LonLat) => `${a[0]},${a[1]}|${b[0]},${b[1]}`;

/**
 * Éditeur de traces (#1340) : on tape sur la carte pour poser des points, BRouter relie les points en
 * suivant les chemins VTT (ou ligne droite, segment par segment). Tap sur la ligne = insérer un point,
 * glisser un point = le déplacer, tap sur un point = le sélectionner (supprimer, couper).
 * Mise en page différenciée (#1394) : mobile = profil en haut + grosse barre d'outils en bas (#1392) ;
 * desktop = carte plein écran avec interface flottante, popover du point et raccourcis clavier (#1393).
 */
export function TrackEditor({ mode, initialDoc, initialName = '', initialDescription = '', slug, initialStatus, home, bounds, initialZoom }: Props) {
  const t = useTranslations('editor');
  const router = useRouter();
  const colors = useMapColors();
  const desktop = useMediaQuery(DESKTOP);
  const mapRef = useRef<MapRef>(null);
  // Singles OSM sous le tracé (#1436) : repères pour tracer, base de l'aimant #1437.
  const [singlesOn] = useSinglesPref();
  const [singlesView, setSinglesView] = useState<[number, number, number, number] | null>(null);
  const [singlesZoom, setSinglesZoom] = useState(0);
  const syncSinglesView = useCallback(() => {
    const m = mapRef.current;
    const b = m?.getBounds();
    if (m && b) {
      setSinglesView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      setSinglesZoom(m.getZoom());
    }
  }, []);
  // Tests de bout en bout (#1523) : le test pose `window.__E2E__` avant le chargement, la carte est alors exposée pour projeter/inspecter.
  const onMapLoad = useCallback(() => {
    syncSinglesView();
    const w = window as unknown as { __E2E__?: boolean; __editorMap?: unknown };
    if (w.__E2E__) w.__editorMap = mapRef.current?.getMap();
  }, [syncSinglesView]);
  const singles = useSingles(singlesOn, singlesView, singlesZoom);
  const snapOn = useSnapPref();
  // Alt (ou Maj) maintenu = pose libre, sans aimant (desktop, #1437).
  const freeKey = useRef(false);
  useEffect(() => {
    const set = (e: KeyboardEvent) => {
      freeKey.current = e.altKey || e.shiftKey;
    };
    const clear = () => (freeKey.current = false);
    window.addEventListener('keydown', set);
    window.addEventListener('keyup', set);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', set);
      window.removeEventListener('keyup', set);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const [state, dispatch] = useReducer(editorReducer, initialDoc, (d) => initialState(d, 'route'));
  const doc = state.present;
  const singleLines = useMemo(
    () => (singles?.status === 'ok' ? singles.features.flatMap((f) => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)).map((coordinates) => ({ coordinates })) : []),
    [singles],
  );
  // Zones de clic : étroites à la souris, larges au doigt (#1524).
  const hitPx = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(FINE_POINTER);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => hitWidth(window.matchMedia(FINE_POINTER).matches),
    () => hitWidth(false),
  );
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  /** Position aimantée de `p` (singles d'abord, puis la trace en cours hors tronçons `exclude`), ou `null` si libre. */
  const snapPoint = useCallback(
    (p: LonLat, exclude: number[] = []): LonLat | null => {
      const m = mapRef.current;
      if (!snapOn || freeKey.current || !m) return null;
      const tolPx = snapTolerance(window.matchMedia(FINE_POINTER).matches);
      return snapPointIn(p, docRef.current, singleLines, { project: (c) => m.project([c[0], c[1]]), unproject: (q) => m.unproject(q), tolPx }, exclude);
    },
    [snapOn, singleLines],
  );
  // Halo de la cible pendant le glisser d'un point, vibration brève à l'accroche (mobile).
  const [snapHalo, setSnapHalo] = useState<LonLat | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Brouillons (#1450) : la trace existe en base dès le premier enregistrement automatique (`liveSlug`).
  const [liveSlug, setLiveSlug] = useState<string | undefined>(mode === 'update' ? slug : undefined);
  const [liveStatus, setLiveStatus] = useState<'draft' | 'published' | null>(mode === 'update' ? (initialStatus ?? 'published') : null);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [tick, setTick] = useState(0);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [profileCursor, setProfileCursor] = useState<number | null>(null);
  const [mapHoverIndex, setMapHoverIndex] = useState<number | null>(null);
  // Souris (desktop, #1384) : menu du clic droit sur la ligne, glisser la ligne pour insérer un point, infobulle.
  const [lineMenu, setLineMenu] = useState<LineMenuState>(null);
  const [dragLine, setDragLine] = useState<{ seg: number; x: number; y: number; p: LonLat; moved: boolean } | null>(null);
  const [tip, setTip] = useState<HoverTipState>(null);
  const closeLineMenu = useCallback(() => setLineMenu(null), []);
  const rider = useRider();
  // Justification du dernier tronçon recalé (« +0,9 km, −140 m de D+ », #1385), affichée quelques secondes.
  const [routeNote, setRouteNote] = useState<{ p: LonLat; extraKm: number; gainSavedM: number | null } | null>(null);
  useEffect(() => {
    if (!routeNote) return;
    const timer = setTimeout(() => setRouteNote(null), 6000);
    return () => clearTimeout(timer);
  }, [routeNote]);
  // Souris au-dessus de la ligne : curseur « insérer » (copy) au lieu de « ajouter » (crosshair), #1393.
  const [overLine, setOverLine] = useState(false);
  const cache = useRef(new Map<string, { coords: Position[]; alts: AltAnswer[] }>());
  const [altSets, setAltSets] = useState<AltSet[]>([]);
  const inflight = useRef(new Set<string>());
  const lastDrag = useRef(0);
  // Relâcher hors de la carte : on termine le glisser de ligne au dernier point connu (#1525).
  useEffect(() => {
    if (!dragLine) return;
    const up = () => {
      const act = endLineDrag(dragLine, dragLine.p, snapPoint);
      if (act) {
        lastDrag.current = Date.now();
        dispatch(act);
      }
      setDragLine(null);
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [dragLine, snapPoint, dispatch]);

  // Routage : chaque segment « chemins » sans tracé est demandé à BRouter (avec cache par couple de points).
  const pending = pendingSegments(doc);
  // Aimant BRouter (#1437) : le tronçon est résolu, puis chaque extrémité est ramenée sur le début/la fin du tracé
  // calculé si l'écart est sous la tolérance. Hors historique ; la signature des alternatives suit le point déplacé.
  const settle = (i: number, from: LonLat, to: LonLat, coords: Position[], alts: AltAnswer[]) => {
    const m = mapRef.current;
    const r = resolveRouted({
      doc, rider, i, from, to, coords, alts, gen: state.past.length,
      snap: snapOn && m ? { project: (c) => m.project([c[0], c[1]]), tolPx: snapTolerance(window.matchMedia(FINE_POINTER).matches) } : null,
    });
    r.actions.forEach(dispatch);
    setAltSets((cur) => upsertAlt(cur, i, r.altSet, state.past.length));
  };
  useEffect(() => {
    for (const i of pending) {
      const from = doc.waypoints[i];
      const to = doc.waypoints[i + 1];
      const k = `${rider}|${key(from, to)}`; // le cache inclut le cycliste (profil BRouter différent)
      const hit = cache.current.get(k);
      if (hit) {
        settle(i, from, to, hit.coords, hit.alts);
        continue;
      }
      if (inflight.current.has(k)) continue;
      inflight.current.add(k);
      fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, rider }) })
        .then(async (r) => {
          const j = (await r.json().catch(() => ({}))) as { coordinates?: Position[]; alternatives?: AltAnswer[]; error?: string; note?: { extraKm: number; gainSavedM: number | null } | null };
          if (!r.ok || !j.coordinates) throw new Error(j.error ?? 'route');
          const alts = j.alternatives ?? [];
          cache.current.set(k, { coords: j.coordinates, alts });
          if (j.note) {
            const mid = j.coordinates[Math.floor(j.coordinates.length / 2)];
            setRouteNote({ p: [mid[0], mid[1]], ...j.note });
          }
          settle(i, from, to, j.coordinates, alts);
        })
        .catch(() => {
          toast.error(t('noPath'));
          dispatch({ type: 'routeFailed', seg: i, from, to });
        })
        .finally(() => inflight.current.delete(k));
    }
  }, [doc, pending.join(), rider]); // eslint-disable-line react-hooks/exhaustive-deps

  // Un jeu par tronçon recalculé : après un glisser (2 tronçons) on garde les alternatives des deux (#1527).
  const alts = liveAltSets(altSets, (i) => doc.segments[i]?.coords ?? undefined, rider);
  const chooseAlt = (i: number, seg: number) => {
    const set = alts.find((s) => s.seg === seg);
    const r = chooseAltResult(set, i);
    if (!r) return;
    dispatch(r.action);
    setAltSets((cur) => upsertAlt(cur, seg, r.altSet, r.altSet.gen));
  };
  const restoreDeviation = () => dispatch({ type: 'restoreDeviation' });
  // A : fait passer ensemble tous les tronçons de la portion à leur itinéraire suivant.
  const cycleAlt = () => (alts.length ? alts.forEach((s) => chooseAlt(nextAlt(s), s.seg)) : state.deviation ? restoreDeviation() : undefined);
  const deviationFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: state.deviation ? [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: state.deviation.path } }] : [],
    }),
    [state.deviation],
  );
  const altFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: alts.flatMap((a) =>
        a.routes.flatMap((r, i) =>
          i === a.active ? [] : [{ type: 'Feature' as const, properties: { alt: i, seg: a.seg }, geometry: { type: 'LineString' as const, coordinates: r } }],
        ),
      ),
    }),
    [alts],
  );

  const stats = useMemo(() => liveStats(doc), [doc]);
  const segFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: doc.segments.map((s, i) => ({
        type: 'Feature' as const,
        properties: { seg: i, mode: s.mode },
        geometry: { type: 'LineString' as const, coordinates: segmentLine(doc, i) },
      })),
    }),
    [doc],
  );

  // Pentes : recalculées sur la version différée du doc (le glisser reste fluide), mémoïsées.
  const slowDoc = useDeferredValue(doc);
  const slopeData = useMemo(
    () => slopeFeaturesForRuns(slowDoc.segments.map((s, i) => ({ coords: segmentLine(slowDoc, i), route: s.mode === 'route' }))),
    [slowDoc],
  );

  const onMapClick = useCallback(
    (e: MapLayerMouseEvent) => {
      const features: HitFeature[] = (e.features ?? []).map((f) => ({ layer: f.layer.id, props: f.properties as HitFeature['props'] }));
      const d = decideClick({
        features, p: [e.lngLat.lng, e.lngLat.lat], selected: state.selected, lineMenuOpen: !!lineMenu,
        sinceDragMs: Date.now() - lastDrag.current, snap: (p) => snapPoint(p),
      });
      if (d.kind === 'closeMenu') setLineMenu(null);
      else if (d.kind === 'chooseAlt') chooseAlt(d.alt, d.seg);
      else if (d.kind === 'restoreDeviation') restoreDeviation();
      else if (d.kind === 'dispatch') {
        if (d.vibrate) navigator.vibrate?.(10);
        dispatch(d.action);
      }
    },
    [state.selected, lineMenu, snapPoint], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const sel = state.selected;
  // Mémoïsé : les pastilles km (#1382) ne se recalculent que si la trace change.
  const geometry = useMemo(() => docGeometry(doc), [doc]);
  const located = useMemo(() => geometry?.coordinates.map(([lon, lat]) => ({ lon, lat })) ?? [], [geometry]);
  // Distance cumulée de chaque sommet (infobulle) et pentes du profil.
  const cumKm = useMemo(() => {
    const c = geometry?.coordinates ?? [];
    const out: number[] = [];
    c.forEach((p, i) => out.push(i ? out[i - 1] + haversine(c[i - 1], p) / 1000 : 0));
    return out;
  }, [geometry]);
  const grades = useMemo(
    () => (stats.profile.length > 1 ? edgeGrades(stats.profile.map((p) => p.distKm * 1000), stats.profile.map((p) => p.ele)) : []),
    [stats.profile],
  );
  const hasEle = stats.profile.length > 1 && stats.profile.length === located.length;
  const tipAt = (x: number, y: number, i: number): HoverTipState => ({
    x, y, km: cumKm[i] ?? 0, ele: hasEle ? stats.profile[i].ele : null, grade: hasEle ? gradeAt(grades, i) : null,
  });
  const canSave = !!geometry && doc.waypoints.length >= 2 && pending.length === 0 && stats.distanceM >= 100;
  const cursorPos = profileCursor !== null ? geometry?.coordinates[profileCursor] : undefined;

  // Enregistrement automatique (#1450) : chaque modification est envoyée après un court délai, et à la sortie de la page.
  // Plus d'alerte « modifications non enregistrées » : seul un échec d'enregistrement ouvre une popin.
  const canAutosave = !!geometry && doc.waypoints.length >= 2 && pending.length === 0;
  const autoSig = `${docSig(doc.waypoints, doc.segments.map((s) => s.mode), 'x')}|${name}|${description}|${geometry ? `${geometry.coordinates.length}:${Math.round(stats.distanceM)}` : ''}`;
  const [savedSig, setSavedSig] = useState(autoSig); // état à l'ouverture = déjà enregistré
  const unsaved = autoSig !== savedSig;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leavingRef = useRef(false);
  const running = useRef(false);
  const again = useRef(false);
  const latest = useRef({ doc, name, description, canAutosave, autoSig, liveSlug, liveStatus });
  useEffect(() => {
    latest.current = { doc, name, description, canAutosave, autoSig, liveSlug, liveStatus };
  });

  /** `ok` enregistré, `skip` rien à faire (ou impossible sans nom), `fail` échec. `publish` : nom exigé, statut publié. */
  const persist = useCallback(
    async (publish: boolean, keepalive = false): Promise<{ r: 'ok' | 'skip' | 'fail'; slug?: string }> => {
      if (running.current) {
        if (keepalive) return { r: 'skip' };
        while (running.current) await new Promise((res) => setTimeout(res, 100));
      }
      const c = latest.current;
      if (!c.canAutosave) return { r: 'skip' };
      const asPublished = publish || c.liveStatus === 'published';
      if (publish && !c.name.trim()) {
        setErrors({ name: t('nameRequired') });
        return { r: 'fail' };
      }
      if (asPublished && !c.name.trim()) return { r: 'skip' }; // une trace publiée garde son nom
      running.current = true;
      setAutosave('saving');
      const g = docGeometry(c.doc, { densifyM: 50 })!; // lignes droites densifiées : l'altitude IGN suit le terrain
      const body = JSON.stringify({
        name: c.name, description: c.description, geometry: g, waypoints: c.doc.waypoints, modes: c.doc.segments.map((s) => s.mode),
        status: asPublished ? 'published' : 'draft',
        ...(!c.liveSlug && mode === 'copy' ? { parentSlug: slug } : {}),
      });
      try {
        const res = await fetch(c.liveSlug ? `/api/tracks/${c.liveSlug}` : '/api/tracks', {
          method: c.liveSlug ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: keepalive && body.length < 60_000,
        });
        const j = (await res.json().catch(() => ({}))) as { slug?: string; errors?: Record<string, string> };
        if (!res.ok || !j.slug) {
          if (publish) {
            setErrors(j.errors ?? {});
            toast.error(j.errors ? t('checkFields') : res.status === 403 ? t('notYours') : t('saveFailed'));
          }
          setAutosave('error');
          return { r: 'fail' };
        }
        latest.current = { ...latest.current, liveSlug: j.slug, liveStatus: asPublished ? 'published' : 'draft' };
        setLiveSlug(j.slug);
        setLiveStatus(asPublished ? 'published' : 'draft');
        setSavedSig(c.autoSig);
        setAutosave('saved');
        return { r: 'ok', slug: j.slug };
      } catch {
        if (publish) toast.error(t('saveFailed'));
        setAutosave('error');
        return { r: 'fail' };
      } finally {
        running.current = false;
        if (again.current) {
          again.current = false;
          setTick((x) => x + 1);
        }
      }
    },
    [mode, slug, t],
  );

  // Modification → enregistrement après un court délai (le délai repart à chaque geste).
  useEffect(() => {
    if (!unsaved || !canAutosave || saving || leavingRef.current) return;
    if (running.current) {
      again.current = true;
      return;
    }
    const id = setTimeout(() => void persist(false), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [autoSig, unsaved, canAutosave, saving, tick, persist]);

  const savedSigRef = useRef(savedSig);
  useEffect(() => {
    savedSigRef.current = savedSig;
  }, [savedSig]);

  // Page masquée / fermée : on envoie tout de suite ; retour du réseau : on réessaie.
  useEffect(() => {
    const flush = () => {
      if (latest.current.autoSig !== savedSigRef.current && latest.current.canAutosave) void persist(false, true);
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    const onOnline = () => flush();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('online', onOnline);
    };
  }, [persist]);

  // Seul un échec d'enregistrement garde l'alerte du navigateur : sinon rien ne se perd.
  useEffect(() => {
    if (!(autosave === 'error' && unsaved)) return;
    const warn = (e: BeforeUnloadEvent) => { if (!leavingRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave, unsaved]);

  const quitHrefFor = (s: string | undefined) => (s ? (mode === 'create' ? '/?mine=1' : `/t/${s}`) : mode === 'create' ? '/' : `/t/${slug}`);
  const quitHref = quitHrefFor(liveSlug);
  const dirty = unsaved || autosave === 'saving';
  /** Enregistre ce qui reste, puis quitte ; si ça échoue, la popin propose de réessayer ou de partir. */
  const flushAndLeave = async () => {
    const res = await persist(false);
    if (res.r === 'fail') {
      setLeaveOpen(true);
      return;
    }
    leavingRef.current = true;
    setLeaveOpen(false);
    router.push(quitHrefFor(res.slug ?? latest.current.liveSlug)); // repli explicite : jamais router.back()
  };
  const leaveNow = () => {
    leavingRef.current = true;
    setLeaveOpen(false);
    router.push(quitHref);
  };
  const requestLeave = (e: { preventDefault: () => void }) => {
    if (!dirty) return;
    e.preventDefault();
    if (autosave === 'error') setLeaveOpen(true);
    else void flushAndLeave();
  };

  /** « Publier » / « Enregistrer » du panneau : nom exigé, la trace devient (ou reste) publiée. */
  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErrors({});
    try {
      const res = await persist(true);
      if (res.r !== 'ok' || !res.slug) return;
      leavingRef.current = true;
      setSaved(true);
      toast.success(t('saved'));
      router.push(`/t/${res.slug}`);
    } finally {
      setSaving(false);
    }
  }

  const ctl: EditorCtl = {
    mode, state, dispatch, doc, stats, pending, canSave, home,
    quitHref,
    slug: liveSlug,
    dirty, autosave, saveKey: liveStatus === 'published' ? 'update' : 'publish', canDelete: !!liveSlug, requestLeave, name, setName, description, setDescription, errors, saving, save, setProfileCursor, mapHoverIndex, rider, alts, chooseAlt, cycleAlt, deviation: state.deviation, restoreDeviation, snapOn,
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t('leave.title')}
        description={t('leave.failedDescription')}
        confirmLabel={t('leave.retry')}
        busyLabel={t('leave.saving')}
        busy={autosave === 'saving'}
        confirmDisabled={!canAutosave}
        destructive={false}
        onConfirm={() => { setLeaveOpen(false); void flushAndLeave(); }}
        secondary={{ label: t('leave.discard'), onClick: leaveNow, destructive: true }}
        cancelLabel={t('leave.stay')}
      />
      {!desktop && <EditorMobileProfile ctl={ctl} />}
      <div className="relative min-h-0 flex-1">
        {colors && (
          <BaseMap lat={home[1]} lon={home[0]} zoom={initialZoom ?? 13} mapRef={mapRef} bounds={bounds} onLoad={onMapLoad} onMoveEnd={syncSinglesView} onClick={onMapClick}
            interactiveLayerIds={['alt-hit', 'dev-hit', 'edit-hit']}
            onMouseDown={(e) => {
              // Glisser la ligne = insérer un point et le placer, en un geste (desktop, #1384).
              if (!desktop || e.originalEvent.button !== 0) return;
              // Un appui sur un point (départ, arrivée…) est son propre glisser : il ne doit pas aussi démarrer
              // l'insertion d'un point sur la ligne qui passe dessous (#1466).
              if ((e.originalEvent.target as HTMLElement | null)?.closest?.('[data-waypoint]')) return;
              const hit = e.features?.find((f) => f.layer.id === 'edit-hit');
              if (!hit) return;
              e.preventDefault(); // pas de déplacement de la carte pendant ce geste
              setDragLine({ seg: Number(hit.properties.seg), x: e.point.x, y: e.point.y, p: [e.lngLat.lng, e.lngLat.lat], moved: false });
            }}
            onMouseUp={(e) => {
              if (!dragLine) return;
              const act = endLineDrag(dragLine, [e.lngLat.lng, e.lngLat.lat], snapPoint);
              if (act) {
                lastDrag.current = Date.now();
                dispatch(act);
              }
              setDragLine(null);
            }}
            onContextMenu={(e) => {
              if (!desktop) return;
              const hit = e.features?.find((f) => f.layer.id === 'edit-hit');
              if (!hit) return;
              e.originalEvent.preventDefault();
              setTip(null);
              setLineMenu({ seg: Number(hit.properties.seg), p: [e.lngLat.lng, e.lngLat.lat] });
            }}
            onMouseMove={(e) => {
              if (dragLine) {
                return setDragLine(moveLineDrag(dragLine, e.point, [e.lngLat.lng, e.lngLat.lat]));
              }
              const over = !!e.features?.some((f) => f.layer.id === 'edit-hit');
              setOverLine(over);
              // Survol de la trace → curseur du profil (#1383) ; le profil suit la géométrie point par point.
              const near = over && located.length > 1 ? nearestProfileIndex(located, e.lngLat.lng, e.lngLat.lat) : null;
              setMapHoverIndex(near !== null && hasEle ? near : null);
              setTip(desktop && near !== null && !lineMenu ? tipAt(e.point.x, e.point.y, near) : null);
            }}
            onMouseLeave={() => {
              setOverLine(false);
              setMapHoverIndex(null);
              setTip(null);
            }}
            cursor={dragLine?.moved ? 'grabbing' : overLine ? 'copy' : 'crosshair'}
          >
            <SinglesLayer state={singles} colors={colors} />
            <Source id="edit" type="geojson" data={segFeatures}>
              <Layer id="edit-hit" type="line" layout={{ 'line-cap': 'round' }} paint={{ 'line-color': colors.primary, 'line-width': hitPx, 'line-opacity': 0.01 }} />
              <Layer id="edit-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.card, 'line-width': 9 }} />
              <Layer id="edit-line" type="line" filter={['==', ['get', 'mode'], 'line']} layout={{ 'line-join': 'round' }} paint={{ 'line-color': colors.foreground, 'line-width': 4, 'line-dasharray': [1.5, 1.5] }} />
            </Source>
            <Source id="alts" type="geojson" data={altFeatures}>
              <Layer id="alt-hit" type="line" layout={{ 'line-cap': 'round' }} paint={{ 'line-color': colors.muted, 'line-width': hitPx, 'line-opacity': 0.01 }} />
              <Layer id="alt-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.muted, 'line-width': 3 }} />
            </Source>
            <Source id="deviation" type="geojson" data={deviationFeatures}>
              <Layer id="dev-hit" type="line" layout={{ 'line-cap': 'round' }} paint={{ 'line-color': colors.muted, 'line-width': hitPx, 'line-opacity': 0.01 }} />
              <Layer id="dev-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.muted, 'line-width': 3, 'line-dasharray': [2, 1.5] }} />
            </Source>
            <SlopeRouteLayer id="slope" data={slopeData} colors={colors} />
            <KmMarkers geometry={geometry} />
            {cursorPos && <ProfileCursorMarker mapRef={mapRef} lon={cursorPos[0]} lat={cursorPos[1]} />}
            {doc.waypoints.map((w, i) => {
              const last = i === doc.waypoints.length - 1 && i > 0;
              const isSel = sel === i;
              return (
                <Marker
                  key={i}
                  longitude={w[0]}
                  latitude={w[1]}
                  draggable
                  // Les points passent toujours au-dessus des pastilles, notes et repères ; l'arrivée au-dessus du départ
                  // (boucle fermée), le point sélectionné au-dessus de tout (#1466).
                  style={{ zIndex: isSel ? 30 : last ? 20 : 10 }}
                  onDrag={(e) => {
                    const snapped = snapPoint([e.lngLat.lng, e.lngLat.lat], pointDragExclude(i));
                    setSnapHalo((prev) => {
                      if (snapped && !prev) navigator.vibrate?.(10);
                      return snapped;
                    });
                  }}
                  onDragEnd={(e) => {
                    lastDrag.current = Date.now();
                    const raw: LonLat = [e.lngLat.lng, e.lngLat.lat];
                    setSnapHalo(null);
                    dispatch(dragPointAction(i, raw, snapPoint(raw, pointDragExclude(i))));
                  }}
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    // Un tap/clic ne fait plus rien d'office (#1465) : le geste par défaut est le glisser.
                    // Au clavier (detail 0), Entrée/Espace ouvre les actions du point.
                    if ((e.originalEvent as MouseEvent).detail === 0) dispatch({ type: 'select', i: isSel ? null : i });
                    else if (isSel) dispatch({ type: 'select', i: null });
                  }}
                >
                  {/* Zone tactile 44 px autour d'un point de 22 px */}
                  <button
                    type="button"
                    data-waypoint=""
                    onContextMenu={(e) => {
                      // Clic droit (desktop, #1384) ou appui long (mobile) = actions du point.
                      e.preventDefault();
                      dispatch({ type: 'select', i });
                    }}
                    onDoubleClick={() => dispatch({ type: 'select', i })}
                    onMouseEnter={() => {
                      if (!desktop || located.length < 2) return;
                      const pt = mapRef.current?.project([w[0], w[1]]);
                      if (pt) setTip(tipAt(pt.x, pt.y, nearestProfileIndex(located, w[0], w[1])));
                    }}
                    onMouseLeave={() => setTip(null)}
                    aria-label={t('pointLabel', { n: i + 1, suffix: i === 0 ? 'start' : last ? 'end' : 'none' })}
                    className="flex size-touch cursor-grab items-center justify-center active:cursor-grabbing"
                  >
                    <span
                      className={cn(
                        'flex items-center justify-center rounded-full border-2 border-card text-caption font-bold shadow-md',
                        isSel ? 'size-8 ring-4 ring-ring' : 'size-6',
                        i === 0 ? 'bg-primary text-primary-foreground' : last ? 'bg-foreground text-background' : 'bg-card text-foreground',
                      )}
                    >
                      {i === 0 ? t('startLetter') : last ? t('endLetter') : ''}
                    </span>
                  </button>
                </Marker>
              );
            })}
            {snapHalo && (
              <Marker longitude={snapHalo[0]} latitude={snapHalo[1]} style={{ pointerEvents: 'none' }}>
                <span aria-hidden className="block size-8 rounded-full border-2 border-dashed border-primary bg-primary/15" />
              </Marker>
            )}
            {dragLine?.moved && (
              <Marker longitude={dragLine.p[0]} latitude={dragLine.p[1]} style={{ pointerEvents: 'none' }}>
                <span aria-hidden className="block size-6 rounded-full border-2 border-card bg-card shadow-md ring-4 ring-ring" />
              </Marker>
            )}
            {desktop && alts.map((a) => <AltLabels key={a.seg} alts={a} onChoose={(i) => chooseAlt(i, a.seg)} />)}
            {desktop && state.deviation && <DeviationLabel deviation={state.deviation} onRestore={restoreDeviation} />}
            {routeNote && <RouteNoteMarker note={routeNote} />}
            {desktop && <DesktopPointPopover ctl={ctl} />}
            {desktop && lineMenu && <LineMenu ctl={ctl} menu={lineMenu} onClose={closeLineMenu} />}
          </BaseMap>
        )}
        {!desktop && alts.length > 0 && <AltCard alts={alts.at(-1)!} onChoose={(i) => chooseAlt(i, alts.at(-1)!.seg)} raised={!!state.deviation} />}
        {!desktop && state.deviation && <DeviationCard onRestore={restoreDeviation} />}
        {desktop && tip && !dragLine && <HoverTip tip={tip} />}
        {slopeData.features.some((f) => f.properties.cls !== 'none') && (
          <SlopeLegend className={desktop ? 'bottom-10 left-3' : 'left-3 top-3'} />
        )}
        {doc.waypoints.length === 0 && (
          // Affordance sans texte (#1406) : un départ « fantôme » au centre de la carte, qui invite au premier tap.
          // La consigne reste lue par les lecteurs d'écran.
          <div aria-live="polite" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="sr-only">{t('emptyHint')}</span>
            <span
              aria-hidden
              className="flex size-10 animate-pulse items-center justify-center rounded-full border-2 border-dashed border-primary bg-card/70 text-body font-bold text-primary shadow-sm motion-reduce:animate-none"
            >
              {t('startLetter')}
            </span>
          </div>
        )}
        {desktop && <EditorDesktop ctl={ctl} />}
      </div>
      {!desktop && <EditorMobileBottom ctl={ctl} />}
    </div>
  );
}
