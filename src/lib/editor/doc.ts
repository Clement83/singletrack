import { haversine, type LineString, type Position, type TrackGeometry } from '@/lib/geo';
import { simplifyLine } from '@/lib/geo/simplify';

/**
 * Modèle de l'éditeur de traces (#1340) : des waypoints reliés deux à deux par des segments.
 * Chaque segment suit les chemins (BRouter) ou va en ligne droite ; ses `coords` sont le tracé calculé
 * (`null` = à calculer). Fonctions pures, sans React : tout est testable.
 */
export type LonLat = [number, number];
export type SegmentMode = 'route' | 'line';
export type Segment = { mode: SegmentMode; coords: Position[] | null };
export type EditorDoc = { waypoints: LonLat[]; segments: Segment[] };

export const emptyDoc = (): EditorDoc => ({ waypoints: [], segments: [] });

const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];
const seg = (mode: SegmentMode, coords: Position[] | null = null): Segment => ({ mode, coords });

export function addWaypoint(doc: EditorDoc, p: LonLat, mode: SegmentMode): EditorDoc {
  return {
    waypoints: [...doc.waypoints, p],
    segments: doc.waypoints.length ? [...doc.segments, seg(mode)] : doc.segments,
  };
}

/** Insère un point sur le segment `i` (clic sur la ligne). Le tracé déjà calculé est coupé, pas recalculé. */
export function insertWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  const s = doc.segments[i];
  if (!s) return doc;
  let at: LonLat = p;
  let left = seg(s.mode);
  let right = seg(s.mode);
  const c = s.coords;
  if (c && c.length > 2) {
    // Accroche le point au sommet le plus proche (intérieur au tracé) : la géométrie existante est conservée.
    let k = 1;
    let best = Infinity;
    for (let j = 1; j < c.length - 1; j++) {
      const d = haversine(c[j], p);
      if (d < best) {
        best = d;
        k = j;
      }
    }
    at = [c[k][0], c[k][1]];
    left = seg(s.mode, c.slice(0, k + 1));
    right = seg(s.mode, c.slice(k));
  }
  const waypoints = [...doc.waypoints];
  waypoints.splice(i + 1, 0, at);
  const segments = [...doc.segments];
  segments.splice(i, 1, left, right);
  return { waypoints, segments };
}

/** Déplace un point : les deux segments voisins sont à recalculer. */
export function moveWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  const waypoints = doc.waypoints.map((w, k) => (k === i ? p : w));
  const segments = doc.segments.map((s, k) => (k === i - 1 || k === i ? seg(s.mode) : s));
  return { waypoints, segments };
}

/** Ramène un waypoint sur le tracé calculé (aimant BRouter, #1437) sans invalider les tronçons voisins. */
export function snapWaypoint(doc: EditorDoc, i: number, p: LonLat): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  return { ...doc, waypoints: doc.waypoints.map((w, k) => (k === i ? p : w)) };
}

export function removeWaypoint(doc: EditorDoc, i: number): EditorDoc {
  if (!doc.waypoints[i]) return doc;
  const waypoints = doc.waypoints.filter((_, k) => k !== i);
  if (waypoints.length === 0) return emptyDoc();
  const segments = [...doc.segments];
  if (i === 0) segments.splice(0, 1);
  else if (i === doc.waypoints.length - 1) segments.splice(i - 1, 1);
  else segments.splice(i - 1, 2, seg(doc.segments[i - 1].mode)); // les deux voisins fusionnent
  return { waypoints, segments };
}

export function setSegmentMode(doc: EditorDoc, i: number, mode: SegmentMode): EditorDoc {
  const s = doc.segments[i];
  if (!s || s.mode === mode) return doc;
  return { ...doc, segments: doc.segments.map((x, k) => (k === i ? seg(mode) : x)) };
}

/** « Recaler » : tous les segments passent dans le même mode (ex. tout suivre les chemins). */
export function setAllModes(doc: EditorDoc, mode: SegmentMode): EditorDoc {
  return { ...doc, segments: doc.segments.map((s) => (s.mode === mode ? s : seg(mode))) };
}

export function reverseDoc(doc: EditorDoc): EditorDoc {
  return {
    waypoints: [...doc.waypoints].reverse(),
    segments: [...doc.segments].reverse().map((s) => ({ mode: s.mode, coords: s.coords ? [...s.coords].reverse() : null })),
  };
}

/** Retour au point de départ. Sans effet si la trace est vide, ou déjà fermée. */
export function closeLoop(doc: EditorDoc, mode: SegmentMode): EditorDoc {
  const n = doc.waypoints.length;
  if (n < 2 || same(doc.waypoints[0], doc.waypoints[n - 1])) return doc;
  return addWaypoint(doc, doc.waypoints[0], mode);
}

/** Liaison domicile → départ : le domicile devient le premier point. */
export function prependHome(doc: EditorDoc, home: LonLat, mode: SegmentMode): EditorDoc {
  if (doc.waypoints.length && same(doc.waypoints[0], home)) return doc;
  return {
    waypoints: [home, ...doc.waypoints],
    segments: doc.waypoints.length ? [seg(mode), ...doc.segments] : doc.segments,
  };
}

/** Coupe le début : le point `i` devient le départ. */
export function trimBefore(doc: EditorDoc, i: number): EditorDoc {
  if (i <= 0 || i >= doc.waypoints.length) return doc;
  return { waypoints: doc.waypoints.slice(i), segments: doc.segments.slice(i) };
}

/** Coupe la fin : le point `i` devient l'arrivée. */
export function trimAfter(doc: EditorDoc, i: number): EditorDoc {
  if (i < 0 || i >= doc.waypoints.length - 1) return doc;
  return { waypoints: doc.waypoints.slice(0, i + 1), segments: doc.segments.slice(0, i) };
}

/** Enregistre le tracé calculé d'un segment, si ses extrémités n'ont pas bougé entre-temps. */
export function resolveSegment(doc: EditorDoc, i: number, from: LonLat, to: LonLat, coords: Position[]): EditorDoc {
  const a = doc.waypoints[i];
  const b = doc.waypoints[i + 1];
  const s = doc.segments[i];
  if (!a || !b || !s || s.mode !== 'route' || !same(a, from) || !same(b, to)) return doc;
  return { ...doc, segments: doc.segments.map((x, k) => (k === i ? { mode: 'route', coords } : x)) };
}

/** Segments « suivre les chemins » dont le tracé reste à demander à BRouter. */
export function pendingSegments(doc: EditorDoc): number[] {
  return doc.segments.flatMap((s, i) => (s.mode === 'route' && !s.coords ? [i] : []));
}

/** Points intermédiaires tous les `stepM` m sur une ligne droite (pour que l'altitude IGN suive le terrain). */
export function densify(a: Position, b: Position, stepM: number): Position[] {
  const n = Math.max(1, Math.ceil(haversine(a, b) / stepM));
  return Array.from({ length: n + 1 }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n] as Position);
}

export type DocGeometryOptions = {
  /** Densifie les lignes droites (enregistrement) ; sinon deux points suffisent (affichage). */
  densifyM?: number;
};

/** Tracé de chaque segment (un segment à calculer s'affiche provisoirement en ligne droite). */
export function segmentLine(doc: EditorDoc, i: number, opts: DocGeometryOptions = {}): Position[] {
  const s = doc.segments[i];
  if (s.coords) return s.coords;
  const a = doc.waypoints[i];
  const b = doc.waypoints[i + 1];
  return opts.densifyM ? densify(a, b, opts.densifyM) : [a, b];
}

/** Géométrie complète, ou `null` s'il y a moins de deux points. Les jonctions ne sont pas dupliquées. */
export function docGeometry(doc: EditorDoc, opts: DocGeometryOptions = {}): LineString | null {
  if (doc.waypoints.length < 2) return null;
  const out: Position[] = [];
  doc.segments.forEach((_, i) => {
    const line = segmentLine(doc, i, opts);
    out.push(...(i === 0 ? line : line.slice(1)));
  });
  return { type: 'LineString', coordinates: out };
}

export type StoredDoc = { waypoints: LonLat[]; modes: SegmentMode[] };

export const docToStored = (doc: EditorDoc): StoredDoc => ({ waypoints: doc.waypoints, modes: doc.segments.map((s) => s.mode) });

/** Relit un document enregistré : les segments « chemins » sont à recalculer. */
export function docFromStored(s: StoredDoc): EditorDoc {
  return { waypoints: s.waypoints, segments: s.modes.map((m) => seg(m)) };
}

/**
 * Relit un document enregistré **en reprenant le tracé enregistré** (#1526) : la géométrie de la trace est découpée aux
 * waypoints (premier sommet à moins de `tolM` en avançant), chaque segment « chemins » retrouve ainsi son tracé et seule
 * la portion modifiée sera recalculée. Un waypoint introuvable laisse ses segments voisins à recalculer.
 */
export function docFromStoredWithGeometry(s: StoredDoc, g: TrackGeometry, tolM = 2): EditorDoc {
  const doc = docFromStored(s);
  const all: Position[] = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  if (all.length < 2 || s.waypoints.length < 2) return doc;
  const at: (number | null)[] = [];
  let from = 0;
  for (const w of s.waypoints) {
    let found: number | null = null;
    for (let j = from; j < all.length; j++) {
      if (haversine(all[j], w) <= tolM) {
        found = j;
        break;
      }
    }
    at.push(found);
    if (found !== null) from = found;
  }
  doc.segments.forEach((sg, k) => {
    const a = at[k];
    const b = at[k + 1];
    if (sg.mode === 'route' && a != null && b != null && b > a) sg.coords = all.slice(a, b + 1);
  });
  return doc;
}

/** Valide la forme d'un document lu en base (colonne `raw`) ou reçu d'un client. */
export function parseStored(v: unknown, maxPoints = 500): StoredDoc | null {
  if (!v || typeof v !== 'object') return null;
  const { waypoints, modes } = v as Record<string, unknown>;
  if (!Array.isArray(waypoints) || !Array.isArray(modes) || waypoints.length > maxPoints) return null;
  if (!waypoints.every((w) => Array.isArray(w) && w.length >= 2 && Number.isFinite(w[0]) && Number.isFinite(w[1]))) return null;
  if (modes.length !== Math.max(0, waypoints.length - 1) || !modes.every((m) => m === 'route' || m === 'line')) return null;
  return { waypoints: waypoints.map((w) => [w[0], w[1]] as LonLat), modes: modes as SegmentMode[] };
}

/**
 * Ouvre une géométrie existante (import GPX, trace OSM...) : on garde ≤ `maxPoints` sommets comme
 * waypoints, et chaque segment conserve le tracé d'origine (mode ligne) — rien ne bouge tant qu'on ne
 * déplace pas un point ou qu'on ne bascule pas un segment en « suivre les chemins ».
 */
export function docFromGeometry(g: TrackGeometry, maxPoints = 60): EditorDoc {
  const all: Position[] = g.type === 'LineString' ? g.coordinates : g.coordinates.flat();
  if (all.length < 2) return emptyDoc();
  let idx: number[] = [];
  for (let tol = 5; tol < 5000; tol *= 1.6) {
    // Douglas-Peucker sur des indices : on retrouve les sommets gardés par leurs coordonnées.
    const kept = simplifyLine(all.map((p, i) => [p[0], p[1], i] as Position), tol);
    idx = kept.map((p) => p[2] as number);
    if (idx.length <= maxPoints) break;
  }
  if (idx[0] !== 0) idx.unshift(0);
  if (idx[idx.length - 1] !== all.length - 1) idx.push(all.length - 1);
  idx = idx.filter((v, k) => k === 0 || v > idx[k - 1]);
  return {
    waypoints: idx.map((i) => [all[i][0], all[i][1]] as LonLat),
    segments: idx.slice(1).map((end, k) => seg('line', all.slice(idx[k], end + 1))),
  };
}

/** Fenêtre de déviation (#1451) : longueur de tracé d'origine « libéré » de chaque côté du point tiré. */
export const DEVIATION_WINDOW_M = 400;

/** Parcours d'origine remplacé par une déviation, proposé en alternative : `a` = indice de la première ancre. */
export type Deviation = {
  a: number;
  /** Nombre de waypoints du document dévié et de ceux qui remplacent l'origine (garde-fou de la restauration). */
  len: number;
  count: number;
  waypoints: LonLat[];
  segments: Segment[];
  /** Tracé d'origine d'ancre à ancre (ligne grise cliquable). */
  path: Position[];
};

const lineLen = (c: Position[]) => c.reduce((s, p, k) => (k ? s + haversine(c[k - 1], p) : 0), 0);
/** Un segment « d'origine » : ligne figée portant son tracé (import / copie), que la fenêtre peut absorber. */
const absorbable = (s: Segment | undefined) => !!s && s.mode === 'line' && !!s.coords;

/**
 * Tire le waypoint `i` en `p` en **déviation** : les waypoints d'origine (segments figés) sur ~`windowM` de tracé
 * de chaque côté sont retirés ; ancre → point → ancre sont à recalculer par BRouter. Si les ancres sont les voisins
 * directs (trace faite à la main, peu de points), c'est le déplacement habituel et `deviation` vaut `null`.
 * La fenêtre s'arrête au premier segment qui n'est pas un tracé d'origine, et finit sur le waypoint qui la dépasse.
 */
export function deviateWaypoint(
  doc: EditorDoc, i: number, p: LonLat, windowM = DEVIATION_WINDOW_M,
): { doc: EditorDoc; deviation: Deviation | null } {
  const n = doc.waypoints.length;
  if (!doc.waypoints[i]) return { doc, deviation: null };
  let a = i;
  for (let cum = 0; a > 0 && absorbable(doc.segments[a - 1]) && cum < windowM; a--) cum += lineLen(doc.segments[a - 1].coords!);
  let b = i;
  for (let cum = 0; b < n - 1 && absorbable(doc.segments[b]) && cum < windowM; b++) cum += lineLen(doc.segments[b].coords!);
  const hasL = i > 0;
  const hasR = i < n - 1;
  const la = hasL ? Math.min(a, i - 1) : i;
  const rb = hasR ? Math.max(b, i + 1) : i;
  if ((!hasL || la === i - 1) && (!hasR || rb === i + 1)) return { doc: moveWaypoint(doc, i, p), deviation: null };
  const start = hasL ? la : i;
  const waypoints = [...doc.waypoints.slice(0, hasL ? la + 1 : 0), p, ...doc.waypoints.slice(hasR ? rb : n)];
  const segments = [
    ...doc.segments.slice(0, la),
    ...(hasL ? [seg(la === i - 1 ? doc.segments[i - 1].mode : 'route')] : []),
    ...(hasR ? [seg(rb === i + 1 ? doc.segments[i].mode : 'route')] : []),
    ...doc.segments.slice(rb),
  ];
  const origSegs = doc.segments.slice(start, hasR ? rb : i);
  const path: Position[] = [];
  origSegs.forEach((_, k) => {
    const line = segmentLine(doc, start + k);
    path.push(...(k === 0 ? line : line.slice(1)));
  });
  return {
    doc: { waypoints, segments },
    deviation: {
      a: start, len: waypoints.length, count: (hasL ? 1 : 0) + 1 + (hasR ? 1 : 0),
      waypoints: doc.waypoints.slice(start, (hasR ? rb : i) + 1), segments: origSegs, path,
    },
  };
}

/** Rétablit le parcours d'origine d'une déviation, ou renvoie le document tel quel s'il a changé de forme. */
export function restoreDeviation(doc: EditorDoc, d: Deviation): EditorDoc {
  if (doc.waypoints.length !== d.len) return doc;
  return {
    waypoints: [...doc.waypoints.slice(0, d.a), ...d.waypoints, ...doc.waypoints.slice(d.a + d.count)],
    segments: [...doc.segments.slice(0, d.a), ...d.segments, ...doc.segments.slice(d.a + d.count - 1)],
  };
}
