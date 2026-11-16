'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthLink } from '@/components/auth-shell';
import { authClient, otpError } from '@/lib/auth-client';

/**
 * Pas de connexion automatique à l'ouverture : les antivirus de messagerie ouvrent les liens des mails,
 * ils consommeraient le code. La personne confirme d'un tap.
 */
export function LinkSignIn() {
  const router = useRouter();
  const t = useTranslations('auth');
  const [creds, setCreds] = useState<{ email: string; otp: string } | null>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));
    const email = p.get('e');
    const otp = p.get('c');
    // Le code ne reste pas dans la barre d'adresse ni l'historique.
    history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique du fragment au montage
    setCreds(email && otp && /^\d{6}$/.test(otp) ? { email, otp } : null);
  }, []);

  if (creds === undefined) return <Skeleton className="h-button-lg w-full rounded-xl" />;

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
          router.replace(data?.user.name ? '/' : '/bienvenue');
          router.refresh();
        }}
      >
        {pending ? t('signingIn') : t('signIn')}
      </Button>
    </div>
  );
}
