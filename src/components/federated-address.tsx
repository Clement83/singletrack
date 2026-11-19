'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

/** Federated address `handle@domain` (#1474): copy button, and a single change of the identifier. */
export function FederatedAddress({ handle, address, canChange }: { handle: string; address: string; canChange: boolean }) {
  const t = useTranslations('userMenu');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      toast.success(t('fedCopied'));
    } catch {
      toast.error(t('error'));
    }
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = String(new FormData(e.currentTarget).get('handle')).trim().toLowerCase();
    setPending(true);
    setError(undefined);
    const res = await fetch('/api/profile/handle', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: next }) }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
      return setError(code ? t(`fedErr_${code}` as 'fedErr_invalid') : t('error'));
    }
    setEditing(false);
    toast.success(t('fedSaved'));
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-label uppercase text-muted-foreground">{t('fedTitle')}</h3>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-xl bg-muted px-3 py-2 text-small">{address}</code>
        <Button variant="outline" size="icon" aria-label={t('fedCopy')} onClick={() => void copy()}>
          <Copy aria-hidden />
        </Button>
      </div>
      {canChange &&
        (editing ? (
          <form onSubmit={save} className="flex flex-col gap-3">
            <Field label={t('fedHandleLabel')} hint={`${t('fedHandleRule')}. ${t('fedEditHint')}`} error={error}>
              {(c) => <Input {...c} name="handle" defaultValue={handle} autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={30} pattern="[a-z0-9_]{3,30}" required />}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="flex-1">{pending ? t('saving') : t('save')}</Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setError(undefined); }}>{t('cancel')}</Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" className="w-full justify-start" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('fedEdit')}
          </Button>
        ))}
    </section>
  );
}
