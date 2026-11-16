'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authClient } from '@/lib/auth-client';
import { useDesktopAutoFocus } from '@/lib/use-desktop-autofocus';

export function WelcomeForm({ next }: { next?: string }) {
  const t = useTranslations('welcome');
  const nameRef = useDesktopAutoFocus();
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    setPending(true);
    const { error } = await authClient.updateUser({ name });
    if (error) {
      setPending(false);
      return setError(t('error'));
    }
    router.replace(next ?? '/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label={t('name')} hint={t('nameHint')} error={error}>
        {(c) => <Input {...c} name="name" autoComplete="given-name" autoCapitalize="words" maxLength={60} required ref={nameRef} />}
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('pending') : t('submit')}
      </Button>
    </form>
  );
}
