const TZ = 'Europe/Paris';

/** Offset (ms) of Paris from UTC at the given instant. */
function parisOffsetMs(at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "2026-11-22" + "08:30" (Paris time) → UTC Date. null if invalid. */
export function parisToUtc(date: string, time: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return null;
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]);
  if (Number.isNaN(naive)) return null;
  let utc = naive - parisOffsetMs(new Date(naive));
  utc = naive - parisOffsetMs(new Date(utc));
  return new Date(utc);
}

/** UTC Date → { date: 'YYYY-MM-DD', time: 'HH:MM' } in Paris (form pre-filling). */
export function utcToParisInputs(d: Date): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
