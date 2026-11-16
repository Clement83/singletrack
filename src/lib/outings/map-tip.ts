import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import type { MapOuting } from './map';

/**
 * Contenu de l'infobulle d'un repère de sortie (#1538), pur et testé : le composant ne fait que l'afficher.
 * Titre, date et heure, participants, places restantes, km · D+ (D+ absent si inconnu).
 */
export type TipOuting = Pick<MapOuting, 'title' | 'yesCount' | 'spotsLeft' | 'distanceM' | 'gainM'> & { startsAt: Date | string };

/** « 12,4 km · 350 m D+ » ; le D+ est omis s'il est inconnu. */
export function outingStatsLine(o: Pick<TipOuting, 'distanceM' | 'gainM'>, locale: string): string {
  const parts = [formatKm(o.distanceM / 1000, locale)];
  if (o.gainM != null) parts.push(formatElevation(o.gainM, locale));
  return parts.join(' · ');
}

/** Ligne « 3 vont · 2 places restantes » (places seulement si la sortie est limitée). */
export function outingPeopleLine(o: Pick<TipOuting, 'yesCount' | 'spotsLeft'>, t: (key: 'going' | 'spots', values: { n: number }) => string): string {
  const parts = [t('going', { n: o.yesCount })];
  if (o.spotsLeft != null) parts.push(t('spots', { n: o.spotsLeft }));
  return parts.join(' · ');
}

/** Date et heure en Europe/Paris, dans la langue de l'interface. */
export function outingTipDate(o: Pick<TipOuting, 'startsAt'>, locale: string): string {
  return formatOutingDate(new Date(o.startsAt), locale);
}

/** Grappe : une ligne « titre · date » par sortie, au plus `max` lignes. */
export function clusterTipLines(items: TipOuting[], locale: string, max = 5): { title: string; date: string }[] {
  return items.slice(0, max).map((o) => ({ title: o.title, date: outingTipDate(o, locale) }));
}
