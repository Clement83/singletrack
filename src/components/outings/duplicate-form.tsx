'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useErrorText } from '@/lib/use-error-text';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

type Props = { slug: string; date: string; time: string; hasInvitees: boolean };

/** Dupliquer une sortie (#1360) : nouvelle date obligatoire (+7 jours par défaut), version de la trace, réinviter. */
export function DuplicateForm({ slug, date: d0, time: t0, hasInvitees }: Props) {
  const t = useTranslations('duplicate');
  const errText = useErrorText();
  const router = useRouter();
  const [date, setDate] = useState(d0);
  const [time, setTime] = useState(t0);
  const [trackSource, setTrackSource] = useState<'track' | 'snapshot'>('track');
  const [reinvite, setReinvite] = useState(hasInvitees);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const res = await fetch(`/api/outings/${slug}/duplicate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, time, trackSource }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/s/${data.slug}${reinvite ? `?reinviter=${slug}` : ''}`);
        router.refresh();
        return;
      }
      if (data.errors) setErrors(data.errors);
      else toast.error(t('failed'));
    } catch {
      toast.error(errText('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-28">
      <p className="text-small text-muted-foreground">{t('intro')}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('date')} error={errors.date && errText(errors.date)}>
          {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}
        </Field>
        <Field label={t('time')}>
          {(p) => <Input {...p} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-semibold">{t('track')}</legend>
        {(['track', 'snapshot'] as const).map((k) => (
          <label key={k} className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-2 transition-colors duration-150 active:bg-accent/60 ${trackSource === k ? 'border-primary bg-accent' : 'border-border bg-card'}`}>
            <input type="radio" name="trackSource" className="size-6 shrink-0 accent-primary" checked={trackSource === k} onChange={() => setTrackSource(k)} />
            <span>{k === 'track' ? t('trackCurrent') : t('trackSnapshot')}</span>
          </label>
        ))}
      </fieldset>
      {hasInvitees && (
        <label className="flex min-h-14 items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3">
          <input type="checkbox" className="mt-0.5 size-6 shrink-0 accent-primary" checked={reinvite} onChange={(e) => setReinvite(e.target.checked)} />
          <span className="flex flex-col">
            <span className="text-body font-semibold">{t('reinvite')}</span>
            <span className="text-small text-muted-foreground">{t('reinviteHint')}</span>
          </span>
        </label>
      )}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" size="lg" disabled={busy}>{busy ? t('saving') : t('submit')}</Button>
      </div>
    </form>
  );
}
