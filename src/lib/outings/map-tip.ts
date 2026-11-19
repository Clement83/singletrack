import { formatElevation, formatKm, formatOutingDate } from '@/lib/format';
import type { MapOuting } from './map';

/**
 * Content of an outing marker's tooltip (#1538), pure and tested: the component only displays it.
 * Title, date and time, participants, seats left, km · elevation gain (gain omitted if unknown).
 */
export type TipOuting = Pick<MapOuting, 'title' | 'yesCount' | 'spotsLeft' | 'distanceM' | 'gainM'> & { startsAt: Date | string };

/** "12.4 km · 350 m D+"; the gain is omitted if unknown. */
export function outingStatsLine(o: Pick<TipOuting, 'distanceM' | 'gainM'>, locale: string): string {
  const parts = [formatKm(o.distanceM / 1000, locale)];
  if (o.gainM != null) parts.push(formatElevation(o.gainM, locale));
  return parts.join(' · ');
}

/** Line "3 going · 2 seats left" (seats only if the outing is capped). */
export function outingPeopleLine(o: Pick<TipOuting, 'yesCount' | 'spotsLeft'>, t: (key: 'going' | 'spots', values: { n: number }) => string): string {
  const parts = [t('going', { n: o.yesCount })];
  if (o.spotsLeft != null) parts.push(t('spots', { n: o.spotsLeft }));
  return parts.join(' · ');
}

/** Date and time in Europe/Paris, in the interface language. */
export function outingTipDate(o: Pick<TipOuting, 'startsAt'>, locale: string): string {
  return formatOutingDate(new Date(o.startsAt), locale);
}

/** Cluster: one "title · date" line per outing, at most `max` lines. */
export function clusterTipLines(items: TipOuting[], locale: string, max = 5): { title: string; date: string }[] {
  return items.slice(0, max).map((o) => ({ title: o.title, date: outingTipDate(o, locale) }));
}
