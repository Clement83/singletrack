import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE, TIME_ZONE, isLocale, type Locale } from './config';
import { MESSAGES } from './messages';

/**
 * Traducteur hors requête (mails envoyés en arrière-plan, scripts) pour une langue donnée, typiquement
 * `user.locale` du destinataire. Langue inconnue ou absente ⇒ français. Dans une page ou une action,
 * utiliser plutôt `getTranslations()` de `next-intl/server` (langue de la requête).
 */
export function translatorFor(locale: string | null | undefined) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator({ locale: l, messages: MESSAGES[l], timeZone: TIME_ZONE });
}
