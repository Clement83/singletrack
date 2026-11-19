'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChoiceChips } from '@/components/ui/choice-chips';

/** Visibility of my profile (#1433): private (friends) / public (any signed-in account). PUT /api/profile. */
export function VisibilitySwitcher({ initial }: { initial: 'private' | 'public' }) {
  const t = useTranslations('userProfile');
  const router = useRouter();
  const [value, setValue] = useState<string>(initial);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    if (next === value) return;
    setBusy(true);
    const res = await fetch('/api/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return void toast.error(t('error'));
    setValue(next);
    toast.success(t('saved'));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <ChoiceChips
        label={t('visibility')}
        value={value}
        onChange={(id) => void change(id)}
        disabled={busy}
        choices={[{ id: 'private', label: t('private') }, { id: 'public', label: t('public') }]}
      />
      <p className="text-small text-muted-foreground">{value === 'public' ? t('publicHint') : t('privateHint')}</p>
    </div>
  );
}
