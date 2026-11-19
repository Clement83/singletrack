'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArchiveRestore, DoorOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useErrorText } from '@/lib/use-error-text';

/**
 * Archive / un-archive (#1459) for oneself only, or leave an upcoming outing (answer "no" + hidden).
 * Leaving asks for confirmation; archiving is immediate and reversible (Archives › Un-archive).
 */
export function ArchiveButton({ outingId, mode, onDone }: { outingId: string; mode: 'archive' | 'unarchive' | 'leave'; onDone?: () => void }) {
  const t = useTranslations('outings');
  const tc = useTranslations('common');
  const errText = useErrorText();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = mode === 'leave'
        ? await fetch(`/api/outings/${outingId}/leave`, { method: 'POST' })
        : await fetch(`/api/outings/${outingId}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: mode === 'archive' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(errText(data.error === 'not_found' ? 'unknown' : data.error));
        return;
      }
      toast.success(mode === 'leave' ? t('left') : mode === 'archive' ? t('archived') : t('unarchived'));
      setConfirm(false);
      onDone?.();
      router.refresh();
    } catch {
      toast.error(errText('unknown'));
    } finally {
      setBusy(false);
    }
  }

  const Icon = mode === 'leave' ? DoorOpen : mode === 'archive' ? Archive : ArchiveRestore;
  const label = mode === 'leave' ? t('leave') : mode === 'archive' ? t('archive') : t('unarchive');
  return (
    <>
      <Button variant="ghost" className="min-h-touch" disabled={busy} onClick={() => (mode === 'leave' ? setConfirm(true) : go())}>
        <Icon aria-hidden /> {label}
      </Button>
      {mode === 'leave' && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={t('leaveTitle')}
          description={t('leaveConfirm')}
          confirmLabel={t('leave')}
          cancelLabel={tc('cancel')}
          busy={busy}
          onConfirm={go}
        />
      )}
    </>
  );
}
