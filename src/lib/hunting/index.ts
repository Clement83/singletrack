/**
 * Hunting in the Var (#1354) — "guaranteed minimum": season and wild boar driven-hunt periods from the
 * prefectoral orders, as versioned configuration. No source of declared hunts is usable
 * (no API or reuse licence, see the study in the ticket comment): so we never show
 * "no driven hunt", only "driven hunts possible" and links to the reference maps.
 *
 * Update every spring when the next season's orders are published (fdc83.com/reglementations).
 */

export type HuntingKind =
  /** General opening: every species, wild boar driven hunts. */
  | 'general'
  /** Wild boar driven hunts every day (early opening, or extension after the general closing). */
  | 'boarDrive'
  /** Summer wild boar driven hunts by holders of a prefectoral authorisation only. */
  | 'boarAuthorized'
  /** Any hunting suspended that day. */
  | 'suspended'
  /** No hunting that day. */
  | 'closed'
  /** Date outside the known orders. */
  | 'unknown';

export type HuntingPeriod = { from: string; to: string; kind: Exclude<HuntingKind, 'closed' | 'unknown'> };

export type HuntingSeason = {
  /** First and last date covered by the season's orders (outside them: "unknown"). */
  from: string;
  to: string;
  periods: HuntingPeriod[];
  /** Reference orders. */
  sources: string[];
};

/**
 * 2026-2027 season — Var prefectoral orders read on 2026-11-12:
 * - DDTM/SAF/BCFSP/2026-046 of 12 May 2026 (opening and closing): general opening on 13 September 2026
 *   at 7 am, closing on 28 February 2027 in the evening; wild boar driven hunts from 13 September 2026 to 31 March 2027;
 *   any hunting suspended on 12 September 2026;
 * - DDTM/SAF/BCFSP/2026-045 of 12 May 2026 (early opening): wild boar and fox driven hunts every
 *   day from 15 August to 11 September 2026;
 * - "driven hunt from 1 June 2026" order: wild boar driven hunts from 1 June to 14 August 2026 for holders
 *   of a prefectoral authorisation.
 */
export const VAR_HUNTING_SEASONS: HuntingSeason[] = [
  {
    from: '2026-06-01',
    to: '2027-05-31',
    periods: [
      { from: '2026-06-01', to: '2026-08-14', kind: 'boarAuthorized' },
      { from: '2026-08-15', to: '2026-09-11', kind: 'boarDrive' },
      { from: '2026-09-12', to: '2026-09-12', kind: 'suspended' },
      { from: '2026-09-13', to: '2027-02-28', kind: 'general' },
      { from: '2027-03-01', to: '2027-03-31', kind: 'boarDrive' },
    ],
    sources: [
      'https://www.fdc83.com/wp-content/uploads/2026/09/AP_Ouverture-et-cloture-26-27.pdf',
      'https://www.fdc83.com/wp-content/uploads/2026/05/4-AP_Ouverture-anticipee-2026.pdf',
      'https://www.fdc83.com/wp-content/uploads/2026/05/3-AP_Battue-au-1er-juin-2026.pdf',
    ],
  },
];

/** Maps of declared driven hunts kept by the study (viewing only, none is complete). */
export const HUNTING_MAPS = [
  { name: 'Ça chasse ?', url: 'https://ca-chasse.com/' },
  { name: 'CynePortail', url: 'https://www.cyneportail.fr/declarations/timeline' },
] as const;

/** Season regulations (Var hunters' federation). */
export const HUNTING_RULES_URL = 'https://www.fdc83.com/reglementations/';

/** `caution`: driven hunts are possible that day; `ok`: no hunting; `unknown`: dates not published. */
export type HuntingTone = 'caution' | 'ok' | 'unknown';

export type HuntingInfo = {
  kind: HuntingKind;
  tone: HuntingTone;
  /** Last day of the current period (hunting periods only). */
  until?: string;
};

const TONE: Record<HuntingKind, HuntingTone> = {
  general: 'caution', boarDrive: 'caution', boarAuthorized: 'caution', suspended: 'ok', closed: 'ok', unknown: 'unknown',
};

/** Hunting situation in the Var on a calendar date (`YYYY-MM-DD`, Europe/Paris). */
export function huntingInfo(date: string, seasons: HuntingSeason[] = VAR_HUNTING_SEASONS): HuntingInfo {
  const season = seasons.find((s) => s.from <= date && date <= s.to);
  if (!season) return { kind: 'unknown', tone: 'unknown' };
  const p = season.periods.find((x) => x.from <= date && date <= x.to);
  if (!p) return { kind: 'closed', tone: 'ok' };
  return p.kind === 'suspended' ? { kind: p.kind, tone: TONE[p.kind] } : { kind: p.kind, tone: TONE[p.kind], until: p.to };
}
