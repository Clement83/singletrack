// Dates civiles Europe/Paris au format `YYYY-MM-DD` (les niveaux sont publiés par jour calendaire local).
const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' });

export const isDateStr = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const parisDate = (d: Date): string => dateFmt.format(d);
export const parisHour = (d: Date): number => Number(hourFmt.format(d));

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `2026-08-15` → `20260815` (nom des fichiers de la préfecture). */
export const compactDate = (date: string) => date.replaceAll('-', '');

/** Saison de restriction d'accès aux massifs : juin à septembre (en 2026 : 8 juin → 30 septembre). */
export const inSeason = (date: string) => {
  const m = Number(date.slice(5, 7));
  return m >= 6 && m <= 9;
};
