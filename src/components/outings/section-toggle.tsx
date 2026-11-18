'use client';

import { cn } from '@/lib/utils';

/** Ouvre une section repliée (`<details id>`) et y amène la vue : la ligne « conditions » de la carte d'identité (#1619). */
export function OpenSection({ target, className, children, label }: { target: string; className?: string; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn('flex min-h-touch w-full items-center gap-3 rounded-xl text-left active:opacity-70', className)}
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
