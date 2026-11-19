'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';

/** Last explorer URL (query), so that "Back" finds the view, open track and filters again (#1577). */
export const LAST_EXPLORER_KEY = 'explorer:last';

/** Link to the map that restores the explorer's last position (otherwise the default view). */
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
