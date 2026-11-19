import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { LOCALE_COOKIE, TIME_ZONE, resolveLocale } from './config';
import { MESSAGES } from './messages';

// Request language (#1400): NEXT_LOCALE cookie, otherwise Accept-Language, otherwise French.
export default getRequestConfig(async () => {
  const [c, h] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale({ cookie: c.get(LOCALE_COOKIE)?.value, acceptLanguage: h.get('accept-language') });
  return { locale, messages: MESSAGES[locale], timeZone: TIME_ZONE };
});
