import type { DIFFICULTIES } from '@/db/schema';

export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Échelle commune (vert, bleu, rouge, noir, comme les pistes VTT balisées FFC).
 *
 * - OSM `mtb:scale` (0-6, échelle d'Uphill/Downhill de Singletrail) : 0 → vert, 1 → bleu, 2 → rouge, ≥ 3 → noir.
 * - Utagawa : l'API n'est pas documentée (accès à demander, #1338) ; correspondance provisoire sur
 *   les libellés courants (très facile/vert, facile/bleu, difficile/rouge, très difficile/noir), à ajuster en #1348.
 * - Geotrek : `difficulty` du référentiel (id ou libellé) ; mêmes libellés que ci-dessus.
 */
export function difficultyFromMtbScale(scale: string | number | null | undefined): Difficulty | null {
  if (scale === null || scale === undefined || scale === '') return null;
  // `mtb:scale` peut valoir "1+", "2-" : on garde la partie numérique.
  const n = Number.parseInt(String(scale), 10);
  if (Number.isNaN(n) || n < 0) return null;
  if (n === 0) return 'green';
  if (n === 1) return 'blue';
  if (n === 2) return 'red';
  return 'black';
}

export function difficultyFromLabel(label: string | null | undefined): Difficulty | null {
  if (!label) return null;
  const s = label.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(tres difficile|noir|black|expert)/.test(s)) return 'black';
  if (/(difficile|rouge|red|sportif)/.test(s)) return 'red';
  if (/(moyen|bleu|blue|intermediaire)/.test(s)) return 'blue';
  if (/(tres facile|facile|vert|green|easy|famil)/.test(s)) return 'green';
  return null;
}
