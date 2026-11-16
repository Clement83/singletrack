/** Sélection multiple de traces sur la carte (#1532) : logique pure, sans React. */

/** Nombre maximum de traces choisies (décision #1534 : au-delà la carte redevient illisible). */
export const MAX_SELECTION = 8;
/** Nombre de couleurs de la palette `sel-1`…`sel-8` (design/tokens.json). */
export const SELECTION_COLORS = 8;

/** Sélection ordonnée : la dernière choisie est la dernière du tableau (mise en avant). */
export type Selection = string[];

export type ToggleResult = { selection: Selection; action: 'added' | 'removed' | 'full' | 'noop' };

/** Ajoute `slug` s'il n'y est pas, le retire sinon ; refuse au-delà du plafond (`action: 'full'`, sélection inchangée). */
export function toggleSelection(sel: Selection, slug: string, max = MAX_SELECTION): ToggleResult {
  if (!slug) return { selection: sel, action: 'noop' };
  if (sel.includes(slug)) return { selection: sel.filter((s) => s !== slug), action: 'removed' };
  if (sel.length >= max) return { selection: sel, action: 'full' };
  return { selection: [...sel, slug], action: 'added' };
}

/** Numéro de palette (1…8) d'une trace choisie. Il suit la trace tant qu'elle reste choisie : on prend le plus petit numéro libre à l'ajout. */
export function assignColors(order: Selection, previous: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  const used = new Set<number>();
  for (const s of order) {
    const c = previous[s];
    if (c && !used.has(c)) {
      out[s] = c;
      used.add(c);
    }
  }
  for (const s of order) {
    if (out[s]) continue;
    let c = 1;
    while (used.has(c)) c++;
    out[s] = ((c - 1) % SELECTION_COLORS) + 1;
    used.add(c);
  }
  return out;
}

/** `?sel=slug1,slug2` → liste de slugs (sans doublon, sans vide, plafonnée). */
export function parseSelection(raw: string | null | undefined, max = MAX_SELECTION): Selection {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (/^[A-Za-z0-9_-]{1,64}$/.test(s) && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function serializeSelection(sel: Selection): string {
  return sel.join(',');
}
