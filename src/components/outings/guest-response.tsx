'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { RsvpAnswer } from '@/components/rsvp-panel';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { OPEN_RESPOND_EVENT } from './bar-events';

type Status = 'pending' | RsvpAnswer;

/** Envoi d'une réponse d'invité (sans compte : le jeton du lien fait foi). */
function useGuestSend(token: string) {
  const t = useTranslations('rsvp');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function send(body: Record<string, unknown>, ok?: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/i/${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (ok) toast.success(ok);
        router.refresh();
        return true;
      }
      if (data.error === 'full') toast.error(t('errors.full'));
      else if (data.error === 'closed') toast.error(t('errors.closed'));
      else toast.error(t('errors.generic'));
    } catch {
      toast.error(t('errors.network'));
    } finally {
      setBusy(false);
    }
    return false;
  }
  return { busy, send };
}

/**
 * Réponse de l'invité dans la barre fixe (#1622) : « Je viens ? » ⇒ Je viens / Peut-être / Non en place ⇒
 * « ✓ Je viens · Modifier ». Mêmes appels que l'ancien panneau (`POST /api/i/<token>`) ; l'encart « Prochaine étape »
 * ouvre le même choix par `OPEN_RESPOND_EVENT`.
 */
export function GuestAnswerBar({ token, status }: { token: string; status: Status }) {
  const t = useTranslations('outingBar');
  const { busy, send } = useGuestSend(token);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    const on = () => setChoosing(true);
    window.addEventListener(OPEN_RESPOND_EVENT, on);
    return () => window.removeEventListener(OPEN_RESPOND_EVENT, on);
  }, []);

  async function pick(s: RsvpAnswer) {
    if (await send({ status: s })) setChoosing(false);
  }

  if (!choosing && status !== 'pending') {
    return (
      <button type="button" data-bar-action="answered" onClick={() => setChoosing(true)} className="flex min-h-[52px] w-full min-w-0 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-foreground transition-colors active:opacity-80">
        <Check aria-hidden className="size-5 shrink-0" />
        <span className="truncate">{t(`answered.${status}`)} · {t('change')}</span>
      </button>
    );
  }
  if (!choosing) {
    return <Button size="lg" data-bar-action="respond" className="w-full" onClick={() => setChoosing(true)}>{t('respond')}</Button>;
  }
  const choice = (s: RsvpAnswer, primary: boolean) => (
    <Button
      key={s}
      size="lg"
      variant={primary ? 'primary' : 'secondary'}
      aria-pressed={status === s}
      disabled={busy}
      onClick={() => pick(s)}
      className={cn('min-w-0 flex-1 px-2', status === s && !primary && 'border border-primary bg-accent text-accent-foreground')}
    >
      {busy ? <Loader2 aria-hidden className="animate-spin" /> : status === s && <Check aria-hidden />}
      <span className="truncate">{t(s)}</span>
    </Button>
  );
  return (
    <div role="group" aria-label={t('choices')} data-bar-action="choices" className="flex w-full min-w-0 gap-2">
      {choice('yes', true)}
      {choice('maybe', false)}
      {choice('no', false)}
    </div>
  );
}

/** Nom et mot de l'invité (formulaire replié, hors barre). */
export function GuestProfile({ token, name, comment, locked }: { token: string; name: string; comment: string; locked: boolean }) {
  const t = useTranslations('rsvp');
  const { busy, send } = useGuestSend(token);
  const [n, setN] = useState(name);
  const [c, setC] = useState(comment);
  if (locked) return null;
  return (
    <details className="rounded-2xl border border-border bg-card p-4">
      <summary className="flex min-h-touch cursor-pointer items-center font-semibold">{t('nameAndWord')}</summary>
      <form className="mt-3 flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void send({ name: n, comment: c }, t('saved')); }}>
        <Field label={t('myName')}>{(p) => <Input {...p} value={n} onChange={(e) => setN(e.target.value)} maxLength={60} required />}</Field>
        <Field label={t('word')}>{(p) => <Input {...p} value={c} onChange={(e) => setC(e.target.value)} maxLength={300} placeholder={t('wordPlaceholder')} />}</Field>
        <Button type="submit" variant="secondary" disabled={busy}>{t('save')}</Button>
      </form>
    </details>
  );
}
