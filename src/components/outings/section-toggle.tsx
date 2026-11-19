'use client';

import { cn } from '@/lib/utils';

/** Opens a collapsed section (`<details id>`) and scrolls to it: the "conditions" line of the identity card (#1619). */
export function OpenSection({ target, className, children, label }: { target: string; className?: string; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn('flex min-h-touch w-full items-center gap-3 rounded-lg text-left active:opacity-70', className)}
      onClick={() => {
        const el = document.getElementById(target);
        if (!(el instanceof HTMLDetailsElement)) return;
        el.open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }}
    >
      {children}
    </button>
  );
}
