'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** « Supprimer cette trace » (#1449) : confirmation, puis retour sur la carte filtrée sur mes traces. */
export function DeleteTrackButton({ slug, name, className }: { slug: string; name: string; className?: string }) {
  const t = useTranslations('trackDelete');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/tracks/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error(res.status === 403 ? t('notYours') : t('failed'));
        setBusy(false);
        return;
      }
      toast.success(t('done'));
      router.push('/?mine=1');
      router.refresh();
    } catch {
      toast.error(t('failed'));
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className={className} onClick={() => setOpen(true)}>
        <Trash2 aria-hidden /> {t('button')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('title')}
        description={t('body', { name })}
        confirmLabel={t('confirm')}
        cancelLabel={t('cancel')}
        busy={busy}
        busyLabel={t('deleting')}
        onConfirm={() => void remove()}
      />
    </>
  );
}
