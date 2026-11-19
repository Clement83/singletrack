// Site languages (#1400, epic #1398). Pure logic, tested in tests/i18n.test.ts.
// No language prefix in the URL: shared links /i, /t, /s stay identical whatever the language.

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
/** Cookie that remembers the chosen language (1 year). Set by POST /api/locale. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Single time zone of the app (outings take place in France), whatever the language. */
export const TIME_ZONE = 'Europe/Paris';
/** Language names, each in its own language (switcher). */
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', en: 'English' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Languages of an Accept-Language header, by decreasing preference (`fr-FR` → `fr`). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { lang: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((x) => x.lang && x.lang !== '*' && x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map((x) => x.lang);
}

/**
 * Language of a request: explicit choice (cookie, copied from the account preference), otherwise the first
 * browser language we can serve, otherwise French.
 */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return parseAcceptLanguage(input.acceptLanguage).find(isLocale) ?? DEFAULT_LOCALE;
}
