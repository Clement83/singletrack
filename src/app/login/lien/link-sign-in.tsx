'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthLink } from '@/components/auth-shell';
import { safeNext } from '@/lib/safe-next';
import { authClient, otpError } from '@/lib/auth-client';

/**
 * No automatic sign-in on opening: mail antivirus software opens the links in emails,
 * it would consume the code. The person confirms with a tap.
 */
export function LinkSignIn() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [creds, setCreds] = useState<{ email: string; otp: string; next?: string } | null>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const email = p.get('e');
    const otp = p.get('c');
    const next = safeNext(p.get('n'));
    // The code does not stay in the address bar or the history.
    history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- single read of the fragment on mount
    setCreds(email && otp && /^\d{6}$/.test(otp) ? { email, otp, next } : null);
  }, []);

  if (creds === undefined) return <Skeleton className="h-button-lg w-full rounded-md" />;

  if (creds === null || error)
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <p>{error ?? t('link.incomplete')}</p>
        <AuthLink href="/login">{t('link.newCode')}</AuthLink>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <p>
        {t.rich('link.signingInAs', { email: creds.email, strong: (chunks) => <strong className="break-all">{chunks}</strong> })}
      </p>
      <Button
        size="lg"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const { data, error } = await authClient.signIn.emailOtp({ email: creds.email, otp: creds.otp });
          if (error) {
            setPending(false);
            return setError(t(`errors.${otpError(error)}`));
          }
          router.replace(data?.user.name ? (creds.next ?? '/') : `/bienvenue${creds.next ? `?next=${encodeURIComponent(creds.next)}` : ''}`);
          router.refresh();
        }}
      >
        {pending ? t('signingIn') : t('signIn')}
      </Button>
    </div>
  );
}
