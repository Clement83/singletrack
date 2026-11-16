/**
 * Chasse dans le Var (#1354) — « minimum garanti » : saison et périodes de battue au sanglier d'après les
 * arrêtés préfectoraux, en configuration versionnée. Aucune source de battues déclarées n'est exploitable
 * (pas d'API ni de licence de réutilisation, voir l'étude en commentaire du ticket) : on n'affiche donc
 * jamais « pas de battue », seulement « battues possibles » et des liens vers les cartes de référence.
 *
 * Mettre à jour chaque printemps à la parution des arrêtés de la saison suivante (fdc83.com/reglementations).
 */

export type HuntingKind =
  /** Ouverture générale : toutes espèces, battues au sanglier. */
  | 'general'
  /** Battues au sanglier tous les jours (préouverture, ou prolongation après la fermeture générale). */
  | 'boarDrive'
  /** Battues d'été au sanglier par les seuls détenteurs d'une autorisation préfectorale. */
  | 'boarAuthorized'
  /** Tout acte de chasse suspendu ce jour-là. */
  | 'suspended'
  /** Pas de chasse ce jour-là. */
  | 'closed'
  /** Date hors des arrêtés connus. */
  | 'unknown';

export type HuntingPeriod = { from: string; to: string; kind: Exclude<HuntingKind, 'closed' | 'unknown'> };

export type HuntingSeason = {
  /** Première et dernière date couvertes par les arrêtés de la saison (hors de ces dates : « inconnu »). */
  from: string;
  to: string;
  periods: HuntingPeriod[];
  /** Arrêtés de référence. */
  sources: string[];
};

/**
 * Campagne 2026-2027 — arrêtés préfectoraux du Var lus le 2026-11-12 :
 * - DDTM/SAF/BCFSP/2026-046 du 12 mai 2026 (ouverture et clôture) : ouverture générale le 13 septembre 2026
 *   à 7 h, fermeture le 28 février 2027 au soir ; sanglier en battue du 13 septembre 2026 au 31 mars 2027 ;
 *   tout acte de chasse suspendu le 12 septembre 2026 ;
 * - DDTM/SAF/BCFSP/2026-045 du 12 mai 2026 (ouverture anticipée) : sanglier et renard en battue tous les
 *   jours du 15 août au 11 septembre 2026 ;
 * - arrêté « battue au 1er juin 2026 » : battues au sanglier du 1er juin au 14 août 2026 pour les détenteurs
 *   d'une autorisation préfectorale.
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

/** Cartes de battues déclarées retenues par l'étude (consultation seulement, aucune n'est exhaustive). */
export const HUNTING_MAPS = [
  { name: 'Ça chasse ?', url: 'https://ca-chasse.com/' },
  { name: 'CynePortail', url: 'https://www.cyneportail.fr/declarations/timeline' },
] as const;

/** Réglementation de la saison (Fédération des chasseurs du Var). */
export const HUNTING_RULES_URL = 'https://www.fdc83.com/reglementations/';

/** `caution` : des battues sont possibles ce jour-là ; `ok` : pas de chasse ; `unknown` : dates pas publiées. */
export type HuntingTone = 'caution' | 'ok' | 'unknown';

export type HuntingInfo = {
  kind: HuntingKind;
  tone: HuntingTone;
  /** Dernier jour de la période en cours (périodes de chasse seulement). */
  until?: string;
};

const TONE: Record<HuntingKind, HuntingTone> = {
  general: 'caution', boarDrive: 'caution', boarAuthorized: 'caution', suspended: 'ok', closed: 'ok', unknown: 'unknown',
};

/** Situation de la chasse dans le Var à une date civile (`YYYY-MM-DD`, Europe/Paris). */
export function huntingInfo(date: string, seasons: HuntingSeason[] = VAR_HUNTING_SEASONS): HuntingInfo {
  const season = seasons.find((s) => s.from <= date && date <= s.to);
  if (!season) return { kind: 'unknown', tone: 'unknown' };
  const p = season.periods.find((x) => x.from <= date && date <= x.to);
  if (!p) return { kind: 'closed', tone: 'ok' };
  return p.kind === 'suspended' ? { kind: p.kind, tone: TONE[p.kind] } : { kind: p.kind, tone: TONE[p.kind], until: p.to };
}
