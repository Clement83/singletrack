'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { OutingVisibilityChips, type OutingVisibilityValue } from '@/components/outing-visibility-switcher';

/** Réglage global (#1442) : visibilité par défaut de mes sorties. PUT /api/profile {outingVisibility}. */
export function DefaultOutingVisibility({ initial }: { initial: OutingVisibilityValue }) {
  const t = useTranslations('outingVisibility');
  const router = useRouter();
  const [value, setValue] = useState<OutingVisibilityValue>(initial);
  const [busy, setBusy] = useState(false);

  async function change(next: OutingVisibilityValue) {
    if (next === value) return;
    setBusy(true);
    const res = await fetch('/api/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outingVisibility: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return void toast.error(t('error'));
    setValue(next);
    toast.success(t('saved'));
    router.refresh();
  }

  return <OutingVisibilityChips values={['friends', 'invite']} label={t('label')} value={value} onChange={(v) => void change(v)} disabled={busy} />;
}
