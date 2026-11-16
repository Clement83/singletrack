'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type Props = { token: string; state: 'anonymous' | 'available' | 'mine' };

/** Rattacher l'invitation à son compte (#1434). Optionnel : le lien marche sans compte. `null` si rien à proposer. */
export function GuestClaim({ token, state }: Props) {
  const t = useTranslations('claim');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function claim() {
    setBusy(true);
    try {
      const res = await fetch(`/api/i/${token}/claim`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t('done'));
        router.refresh();
      } else {
        const known = ['alreadyClaimed', 'alreadyOnOuting', 'selfFriend', 'not_found'] as const;
        toast.error(known.includes(data.error) ? t(`errors.${data.error as (typeof known)[number]}`) : t('errors.generic'));
      }
    } catch {
      toast.error(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'mine') {
    return <p className="flex items-center gap-2 text-small text-muted-foreground"><UserCheck aria-hidden className="size-4" /> {t('claimed')}</p>;
  }
  return (
    <section aria-label={t('title')} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-heading">{t('title')}</h2>
      <p className="text-small text-muted-foreground">{t('hint')}</p>
      {state === 'available' ? (
        <Button onClick={claim} disabled={busy} variant="secondary">{busy ? t('pending') : t('button')}</Button>
      ) : (
        <Button asChild variant="secondary"><Link href={`/login?next=${encodeURIComponent(`/i/${token}`)}`}>{t('login')}</Link></Button>
      )}
    </section>
  );
}
