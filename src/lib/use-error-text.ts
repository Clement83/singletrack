'use client';

import { useTranslations } from 'next-intl';

/**
 * Text of an error code returned by the API (#1402: routes return codes, never sentences).
 * Unknown code ⇒ generic message.
 */
export function useErrorText() {
  const t = useTranslations('errors');
  return (code: unknown, values?: Record<string, string | number>): string =>
    typeof code === 'string' && t.has(code as never) ? t(code as never, values as never) : t('unknown');
}
