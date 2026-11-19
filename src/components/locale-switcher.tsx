'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';

/** Language choice (#1397): POST /api/locale (cookie + account preference), then a new server render. */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('userMenu');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sending, setSending] = useState(false);

  async function change(next: string) {
    if (next === locale) return;
    setSending(true);
    const res = await fetch('/api/locale', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale: next }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) return void toast.error(t('error'));
    startTransition(() => router.refresh());
  }

  return (
    <ChoiceChips
      label={t('language')}
      className={className}
      value={locale}
      onChange={(id) => void change(id)}
      disabled={sending || pending}
      choices={LOCALES.map((l) => ({ id: l, label: LOCALE_NAMES[l] }))}
    />
  );
}
