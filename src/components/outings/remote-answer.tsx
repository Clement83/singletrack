'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useErrorText } from '@/lib/use-error-text';

type Answer = 'yes' | 'maybe' | 'no';

/** « Je viens » / « Peut-être » / « Non » pour une sortie d'un autre serveur (#1476) : un tap, trois zones tactiles de 44 px et plus. */
export function RemoteAnswer({ id, current, domain, compact = false }: { id: string; current: 'pending' | Answer; domain: string; compact?: boolean }) {
  const t = useTranslations('remoteOutings');
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState<Answer | null>(null);

  async function go(answer: Answer) {
    setBusy(answer);
    try {
      const res = await fetch(`/api/remote-outings/${id}/respond`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.error === 'closed' ? 'closed' : 'unknown')); if (res.status === 404) router.refresh(); return; }
      toast.success(t('sent', { domain }));
      router.refresh();
    } catch {
      toast.error(errText('unknown'));
    } finally {
      setBusy(null);
    }
  }

  const choices: Answer[] = compact ? ['yes'] : ['yes', 'maybe', 'no'];
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={t('title')}>
      {choices.map((a) => (
        <Button key={a} size="lg" variant={current === a ? 'primary' : 'outline'} className="min-w-0 flex-1" aria-pressed={current === a} disabled={busy !== null} onClick={() => go(a)}>
          {busy === a && <Loader2 aria-hidden className="animate-spin" />}
          {t(a === 'yes' ? 'join' : a)}
        </Button>
      ))}
    </div>
  );
}
