// Chiffres selon la langue (charte, #1401) : en français virgule décimale et espace insécable avant l'unité ;
// en anglais point décimal. Fuseau toujours Europe/Paris.
const NBSP = '\u00a0';
type Lang = string;
const en = (l: Lang) => l.startsWith('en');
const tag = (l: Lang) => (en(l) ? 'en-GB' : 'fr-FR');

export function formatKm(km: number, locale: Lang = 'fr'): string {
  const digits = km < 100 ? 1 : 0;
  return `${km.toLocaleString(tag(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits })}${NBSP}km`;
}

export function formatElevation(m: number, locale: Lang = 'fr'): string {
  const n = Math.round(m).toLocaleString(tag(locale));
  return en(locale) ? `+${n}${NBSP}m` : `${n}${NBSP}m${NBSP}D+`;
}

/** Altitude ou dénivelé simple (« 350 m »), « — » si inconnu. */
export function formatMeters(m: number | null | undefined, locale: Lang = 'fr'): string {
  return m == null ? '—' : `${Math.round(m).toLocaleString(tag(locale))}${NBSP}m`;
}

export function formatDuration(minutes: number, locale: Lang = 'fr'): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}${NBSP}min`;
  if (en(locale)) return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${m}${NBSP}min`;
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${String(m).padStart(2, '0')}`;
}

/** « dim. 16 nov. · 8 h 00 » ; en anglais « Sun 16 Nov · 08:00 ». */
export function formatOutingDate(date: Date, locale: Lang = 'fr', timeZone = 'Europe/Paris'): string {
  const day = date.toLocaleDateString(tag(locale), { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const [h, m] = date
    .toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone })
    .split(':')
    .map(Number);
  const mm = String(m).padStart(2, '0');
  return en(locale) ? `${day} · ${String(h).padStart(2, '0')}:${mm}` : `${day} · ${h}${NBSP}h${NBSP}${mm}`;
}
