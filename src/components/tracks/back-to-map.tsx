'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

/** Dernière URL (query) de l'explorateur, pour que « Retour » retrouve vue, trace ouverte, filtres (#1577). */
export const LAST_EXPLORER_KEY = 'explorer:last';

/** Lien vers la carte qui reprend la dernière position de l'explorateur (sinon vue par défaut). */
export function BackToMap({ onClick, ...props }: Omit<ComponentProps<typeof Link>, 'href'>) {
  const router = useRouter();
  return (
    <Link
      href="/"
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        let qs: string | null = null;
        try { qs = sessionStorage.getItem(LAST_EXPLORER_KEY); } catch { /* stockage indisponible */ }
        if (qs) {
          e.preventDefault();
          router.push(`/?${qs}`);
        }
      }}
    />
  );
}
