'use client';

import { useTranslations } from 'next-intl';

/**
 * Texte d'un code d'erreur renvoyé par l'API (#1402 : les routes renvoient des codes, jamais de phrases).
 * Code inconnu ⇒ message générique.
 */
export function useErrorText() {
  const t = useTranslations('errors');
  return (code: unknown, values?: Record<string, string | number>): string =>
    typeof code === 'string' && t.has(code as never) ? t(code as never, values as never) : t('unknown');
}
