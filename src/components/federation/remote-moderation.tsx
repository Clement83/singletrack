'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Flag } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Field, Textarea } from '@/components/ui/field';
import { useErrorText } from '@/lib/use-error-text';

/** « Signaler » (Flag au serveur d'origine + copie pour l'admin) et « Bloquer l'organisateur » sur une sortie d'un autre serveur (#1477). */
export function RemoteModeration({ id, actorId, domain }: { id: string; actorId: string; domain: string }) {
  const t = useTranslations('moderation');
  const tc = useTranslations('common');
  const errText = useErrorText();
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(url: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.error === 'rate_limited' ? 'rateLimited' : data.error)); return false; }
      return true;
    } catch {
      toast.error(errText('unknown'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" disabled={busy} onClick={() => setReportOpen(true)}><Flag aria-hidden /> {t('report')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setBlockOpen(true)}><Ban aria-hidden /> {t('blockOrganizer')}</Button>
      <ActionSheet open={reportOpen} onOpenChange={setReportOpen} title={t('reportTitle')}>
        <form className="flex flex-col gap-3" onSubmit={async (e) => {
          e.preventDefault();
          if (await call(`/api/remote-outings/${id}/report`, { reason })) { setReportOpen(false); setReason(''); toast.success(t('reported', { domain })); }
        }}>
          <p className="text-body text-pretty">{t('reportBody', { domain })}</p>
          <Field label={t('reasonLabel')}>{(p) => <Textarea {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <Button type="submit" size="lg" disabled={busy}>{t('send')}</Button>
        </form>
      </ActionSheet>
      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title={t('blockOrganizer')}
        description={t('blockBody', { domain })}
        confirmLabel={t('block')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={async () => { if (await call(`/api/federation/blocks/${actorId}`)) { toast.success(t('blocked')); router.push('/sorties'); router.refresh(); } }}
      />
    </div>
  );
}
