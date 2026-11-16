'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

export function JoinForm({ openToken }: { openToken: string }) {
  const t = useTranslations('join');
  const tr = useTranslations('rsvp');
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/s/${openToken}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) router.push(data.path);
      else toast.error(tr('errors.generic'));
    } catch {
      toast.error(tr('errors.network'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={t('name')} hint={t('nameHint')}>
        {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="given-name" required />}
      </Field>
      <Button type="submit" size="lg" disabled={busy || !name.trim()}>{t('submit')}</Button>
    </form>
  );
}
