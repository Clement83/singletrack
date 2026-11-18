'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { RsvpPanel, type RsvpAnswer } from '@/components/rsvp-panel';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

type Props = { token: string; name: string; status: 'pending' | RsvpAnswer; comment: string; locked: boolean };

/** Réponse de l'invité : GO / peut-être / non, plus nom et commentaire modifiables. Pas de compte. */
export function GuestResponse({ token, name, status, comment, locked }: Props) {
  const t = useTranslations('rsvp');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(name);
  const [c, setC] = useState(comment);

  async function send(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/i/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (ok) toast.success(ok);
        router.refresh();
      } else if (data.error === 'full') toast.error(t('errors.full'));
      else if (data.error === 'closed') toast.error(t('errors.closed'));
      else toast.error(t('errors.generic'));
    } catch {
      toast.error(t('errors.network'));
    } finally {
      setBusy(false);
    }
  }

  if (locked) return null;
  return (
    <div id="respond" className="flex scroll-mt-4 flex-col gap-4">
      <RsvpPanel name={name} value={status === 'pending' ? null : status} pending={busy} onChange={(s) => send({ status: s })} />
      <details className="rounded-2xl border border-border bg-card p-4">
        <summary className="flex min-h-touch cursor-pointer items-center font-semibold">{t('nameAndWord')}</summary>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => { e.preventDefault(); send({ name: n, comment: c }, t('saved')); }}
        >
          <Field label={t('myName')}>{(p) => <Input {...p} value={n} onChange={(e) => setN(e.target.value)} maxLength={60} required />}</Field>
          <Field label={t('word')}>{(p) => <Input {...p} value={c} onChange={(e) => setC(e.target.value)} maxLength={300} placeholder={t('wordPlaceholder')} />}</Field>
          <Button type="submit" variant="secondary" disabled={busy}>{t('save')}</Button>
        </form>
      </details>
    </div>
  );
}
