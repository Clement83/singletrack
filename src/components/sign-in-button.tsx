'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { LoginLink } from '@/components/login-link';
import { cn } from '@/lib/utils';

/** Visiteur sans compte (#1591) : remplace le menu utilisateur, à la même place ; revient sur la même vue après connexion. */
export function SignInButton({ className }: { className?: string }) {
  const t = useTranslations('userMenu');
  const pathname = usePathname();
  if (pathname === '/login') return null;
  return (
    <LoginLink
      aria-label={t('signIn')}
      title={t('signIn')}
      className={cn('flex size-touch items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-95', className)}
    >
      <LogIn aria-hidden className="size-5" />
    </LoginLink>
  );
}
