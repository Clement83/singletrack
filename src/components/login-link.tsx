'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loginHref } from '@/lib/login-href';

/**
 * Lien vers la connexion qui revient ensuite sur la vue courante (#1591). La vue de la carte change par `replaceState`
 * (#1577) : l'adresse de retour est donc lue au clic, pas au rendu.
 */
export function LoginLink({ onClick, ...props }: Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href="/login"
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(loginHref(window.location));
      }}
    />
  );
}
