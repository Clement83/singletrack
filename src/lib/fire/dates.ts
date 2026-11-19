// Europe/Paris calendar dates in `YYYY-MM-DD` format (levels are published per local calendar day).
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

/** `2026-08-15` → `20260815` (name of the prefecture's files). */
export const compactDate = (date: string) => date.replaceAll('-', '');

/** Massif access restriction season: June to September (in 2026: 8 June → 30 September). */
export const inSeason = (date: string) => {
  const m = Number(date.slice(5, 7));
  return m >= 6 && m <= 9;
};
