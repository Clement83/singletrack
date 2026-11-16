export type ProfilePoint = { distKm: number; ele: number; /** Altitude estimée (interpolée), pas mesurée (#1467). */ estimated?: boolean };

/** Indice du point du profil le plus proche de `x` (0..width), pour un glissement au doigt. */
export function indexAtX(points: ProfilePoint[], x: number, width: number): number {
  if (points.length === 0 || width <= 0) return -1;
  const max = points[points.length - 1].distKm || 1;
  const target = (Math.min(Math.max(x, 0), width) / width) * max;
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i].distKm - target) < Math.abs(points[best].distKm - target)) best = i;
  }
  return best;
}

/** Point de profil localisé (pour le marqueur synchronisé sur la carte). */
export type LocatedProfilePoint = ProfilePoint & { lon: number; lat: number };

/**
 * Indice du point du profil le plus proche d'une position de la carte (survol de la trace → curseur du profil, #1391).
 * Distance équirectangulaire : suffisante à l'échelle d'une trace. -1 si le profil est vide.
 */
export function nearestProfileIndex(points: { lon: number; lat: number }[], lon: number, lat: number): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = (points[i].lon - lon) * k;
    const dy = points[i].lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Pente (%) affichée sous le curseur du point `i` : celle de l'arête qui part de ce point (ou qui arrive au
 * dernier). `grades` = `edgeGrades` du profil (une valeur par arête).
 */
export function gradeAt(grades: number[], i: number): number | null {
  if (grades.length === 0 || i < 0) return null;
  return grades[Math.min(i, grades.length - 1)] ?? null;
}
