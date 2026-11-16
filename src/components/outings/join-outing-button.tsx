'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useErrorText } from '@/lib/use-error-text';

/** « Je viens » (rejoindre avec son compte, #1444) ou « Ouvrir » (page participant d'une sortie rejointe). */
export function JoinOutingButton({ outingId, mode }: { outingId: string; mode: 'join' | 'open' }) {
  const t = useTranslations('outings');
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/outings/${outingId}/${mode}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(errText(data.error === 'not_found' ? 'unknown' : data.error));
        if (res.status === 404) router.refresh();
        return;
      }
      if (mode === 'open') router.push(data.path);
      else {
        toast.success(t('joined'));
        router.refresh();
      }
    } catch {
      toast.error(errText('unknown'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="lg" variant={mode === 'join' ? 'primary' : 'outline'} className="w-full" onClick={go} disabled={busy}>
      {busy && <Loader2 aria-hidden className="animate-spin" />}
      {mode === 'join' ? t('join') : t('openJoined')}
    </Button>
  );
}
