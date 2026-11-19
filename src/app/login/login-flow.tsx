'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { authClient, otpError } from '@/lib/auth-client';
import { FINE_POINTER } from '@/lib/use-desktop-autofocus';

/** Passwordless sign-in (#1377): email → code received by email (or link / QR code from the same email). */
export function LoginFlow({ next }: { next?: string }) {
  const router = useRouter();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string>();
  const [info, setInfo] = useState<string>();
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  // Focus on the code when it appears, only with mouse and keyboard (#1390: on mobile the keyboard would hide the screen).
  useEffect(() => {
    if (step === 'code' && window.matchMedia(FINE_POINTER).matches) codeRef.current?.focus();
  }, [step]);

  async function sendCode(to: string) {
    setPending(true);
    setError(undefined);
    const { error } = await authClient.emailOtp.sendVerificationOtp(
      { email: to, type: 'sign-in' },
      next ? { headers: { 'x-login-next': next } } : undefined,
    );
    setPending(false);
    if (error) return setError(t(`errors.${otpError(error)}`));
    setEmail(to);
    setStep('code');
  }

  async function verify(otp: string) {
    setPending(true);
    setError(undefined);
    const { data, error } = await authClient.signIn.emailOtp({ email, otp });
    if (error) {
      setPending(false);
      return setError(t(`errors.${otpError(error)}`));
    }
    router.replace(data?.user.name ? (next ?? '/') : `/bienvenue${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    router.refresh();
  }

  if (step === 'email')
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendCode(String(new FormData(e.currentTarget).get('email')).trim().toLowerCase());
        }}
        className="flex flex-col gap-4"
      >
        <Field label={t('emailLabel')} error={error}>
          {(c) => <Input {...c} name="email" type="email" inputMode="email" autoComplete="email" spellCheck={false} autoCapitalize="none" defaultValue={email} required />}
        </Field>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? t('sending') : t('sendCode')}
        </Button>
      </form>
    );

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        void verify(String(new FormData(e.currentTarget).get('code')));
      }}
      className="flex flex-col gap-4"
    >
      <p>
        {t.rich('codeSentTo', { email, strong: (chunks) => <strong className="break-all">{chunks}</strong> })}
      </p>
      <Field label={t('codeLabel')} hint={info ?? t('codeHint')} error={error}>
        {(c) => (
          <Input
            {...c}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            pattern="[0-9]{6}"
            maxLength={6}
            required
            ref={codeRef}
            className="text-center text-title tracking-[0.5em] tabular-nums"
            onChange={(e) => {
              e.currentTarget.value = e.currentTarget.value.replace(/\D/g, '').slice(0, 6);
              if (e.currentTarget.value.length === 6 && !pending) formRef.current?.requestSubmit();
            }}
          />
        )}
      </Field>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t('signingIn') : t('signIn')}
      </Button>
      <div className="flex justify-between">
        <Button variant="ghost" onClick={() => { setStep('email'); setError(undefined); setInfo(undefined); }}>
          {t('changeEmail')}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={async () => {
            await sendCode(email);
            setInfo(t('resent'));
          }}
        >
          {t('resend')}
        </Button>
      </div>
    </form>
  );
}
