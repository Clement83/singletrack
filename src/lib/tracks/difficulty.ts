import type { DIFFICULTIES } from '@/db/schema';

export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Common scale (green, blue, red, black, like FFC waymarked mountain-bike trails).
 *
 * - OSM `mtb:scale` (0-6, Singletrail Uphill/Downhill scale): 0 → green, 1 → blue, 2 → red, ≥ 3 → black.
 * - Utagawa: the API is not documented (access to request, #1338); provisional mapping on
 *   the usual labels (very easy/green, easy/blue, hard/red, very hard/black), to adjust in #1348.
 * - Geotrek: `difficulty` from the reference list (id or label); same labels as above.
 */
export function difficultyFromMtbScale(scale: string | number | null | undefined): Difficulty | null {
  if (scale === null || scale === undefined || scale === '') return null;
  // `mtb:scale` may be "1+", "2-": the numeric part is kept.
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
