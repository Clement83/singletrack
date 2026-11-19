import { createTranslator } from 'next-intl';
import { DEFAULT_LOCALE, TIME_ZONE, isLocale, type Locale } from './config';
import { MESSAGES } from './messages';

/**
 * Translator outside a request (emails sent in the background, scripts) for a given language, typically
 * the recipient's `user.locale`. Unknown or missing language ⇒ French. In a page or an action,
 * use `getTranslations()` from `next-intl/server` instead (request language).
 */
export function translatorFor(locale: string | null | undefined) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return createTranslator({ locale: l, messages: MESSAGES[l], timeZone: TIME_ZONE });
}
