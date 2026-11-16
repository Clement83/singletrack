'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useErrorText } from '@/lib/use-error-text';

export type FriendOption = { userId: string; name: string };

/**
 * « Inviter des copains » (#1458) : copains acceptés pas encore dans la sortie, cases à cocher de 56 px,
 * bouton « Inviter (n) » collé en bas (même ergonomie que le carnet de potes). L'invitation est liée à leur compte
 * et un mail part ; la sortie apparaît dans leurs « Mes sorties ».
 */
export function InviteFriends({ endpoint, friends }: { endpoint: string; friends: FriendOption[] }) {
  const t = useTranslations('inviteFriends');
  const locale = useLocale();
  const errText = useErrorText();
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit() {
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userIds: picked }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.errors ? Object.values(data.errors)[0] : data.error)); return; }
      toast.success(t('sent', { n: data.invited.length }));
      if (data.skipped?.length) toast.info(t('skipped', { names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(data.skipped) }));
      setPicked([]);
      router.refresh();
    } catch {
      toast.error(errText('network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={t('region')} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-heading">{t('title')}</h2>
      {friends.length === 0 ? (
        <p className="text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <p className="text-small text-muted-foreground">{t('hint')}</p>
          <ul className="flex flex-col gap-2">
            {friends.map((f) => {
              const on = picked.includes(f.userId);
              return (
                <li key={f.userId}>
                  <label className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-2 transition-colors duration-150 active:bg-accent/60 ${on ? 'border-primary bg-accent' : 'border-border bg-background'}`}>
                    <input type="checkbox" className="size-6 shrink-0 accent-primary" checked={on} onChange={() => toggle(f.userId)} />
                    <span className="text-body min-w-0 flex-1 truncate font-semibold">{f.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link href="/copains" className="flex min-h-touch items-center text-small font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">{t('friendsLink')}</Link>
      {picked.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 rounded-b-2xl border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <Button size="lg" className="w-full" disabled={busy} onClick={submit}><Check aria-hidden /> {t('invite', { n: picked.length })}</Button>
        </div>
      )}
    </section>
  );
}
