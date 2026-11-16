'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useErrorText } from '@/lib/use-error-text';
import { Button } from '@/components/ui/button';

/** Un tap pour accepter (les antivirus de messagerie ouvrent les liens : jamais d'effet à l'ouverture). */
export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('friends');
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="lg" disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const res = await fetch('/api/friends/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
          const data = await res.json().catch(() => ({}));
          if (res.ok) { toast.success(t('accepted')); router.push('/copains'); }
          else toast.error(errText(data.error === 'not_found' ? 'inviteGone' : data.error));
        } catch { toast.error(errText('network')); }
        finally { setBusy(false); }
      }}
    >
      <Check aria-hidden /> {t('acceptInvite')}
    </Button>
  );
}
