// Langues du site (#1400, epic #1398). Logique pure, testée dans tests/i18n.test.ts.
// Pas de préfixe de langue dans l'URL : les liens partagés /i, /t, /s restent identiques quelle que soit la langue.

export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
/** Cookie qui mémorise la langue choisie (1 an). Posé par POST /api/locale. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';
/** Fuseau unique de l'app (les sorties ont lieu dans le Var), quelle que soit la langue. */
export const TIME_ZONE = 'Europe/Paris';
/** Noms des langues, chacun dans sa propre langue (sélecteur). */
export const LOCALE_NAMES: Record<Locale, string> = { fr: 'Français', en: 'English' };

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

/** Langues d'un en-tête Accept-Language, par préférence décroissante (`fr-FR` → `fr`). */
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
 * Langue d'une requête : choix explicite (cookie, recopié depuis la préférence du compte), sinon la première
 * langue du navigateur que l'on sait servir, sinon le français.
 */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return parseAcceptLanguage(input.acceptLanguage).find(isLocale) ?? DEFAULT_LOCALE;
}
