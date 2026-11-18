'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CalendarDays, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// Charte : 3 entrées max (2 depuis #1430 : les traces de l'utilisateur sont un filtre de la carte), à portée de pouce. Barre du bas sur mobile, barre latérale en desktop.
export const NAV_ITEMS = [
  { href: '/', key: 'map', icon: MapIcon },
  { href: '/sorties', key: 'outings', icon: CalendarDays },
] as const;

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

type BarProps = { active?: string; className?: string };

function Items({ active, vertical }: { active: string; vertical?: boolean }) {
  const t = useTranslations('nav');
  return NAV_ITEMS.map(({ href, key, icon: Icon }) => {
    const on = isActive(active, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={on ? 'page' : undefined}
        className={cn(
          'flex min-h-touch flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-caption font-semibold transition-colors duration-150',
          vertical && 'w-16 flex-none py-2',
          on ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <span
          className={cn(
            'flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150',
            on && 'bg-accent text-accent-foreground',
          )}
        >
          <Icon aria-hidden className="size-6" strokeWidth={1.75} />
        </span>
        {t(key)}
      </Link>
    );
  });
}

/** Barre du bas (mobile). `className` permet de la poser ailleurs (styleguide). */
export function BottomNavBar({ active, className }: BarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('main')}
      className={cn('flex h-nav items-stretch gap-1 border-t border-border glass px-2 shadow-md', className)}
    >
      <Items active={active ?? pathname} />
    </nav>
  );
}

/** Barre latérale fine (desktop). */
export function SideNavBar({ active, className }: BarProps) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('main')}
      className={cn('flex w-rail flex-col items-center gap-2 border-r border-border glass py-4 shadow-md', className)}
    >
      {/* Icône de l'app (ticket 1395, générée par scripts/make-icons.mjs) : ramène à la carte. */}
      <Link href="/" aria-label={t('home')} className="mb-4 rounded-xl transition-opacity duration-150 hover:opacity-90 active:opacity-80">
        <Image src="/icons/icon.svg" alt="" width={40} height={40} unoptimized priority className="size-10 rounded-xl shadow-sm" />
      </Link>
      <Items active={active ?? pathname} vertical />
    </nav>
  );
}

/** Navigation de l'appli : barre du bas fixe sur mobile, barre latérale fixe dès 1024 px. */
export function AppNav() {
  return (
    <>
      <BottomNavBar className="fixed inset-x-0 bottom-0 z-30 h-[calc(var(--spacing-nav)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] lg:hidden" />
      <SideNavBar className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />
    </>
  );
}
