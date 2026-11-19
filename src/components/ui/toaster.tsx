'use client';

import { Toaster as Sonner } from 'sonner';

/** Short toasts ("Link copied"): `import { toast } from 'sonner'`. Styles = tokens only. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      // Above the bottom bar on mobile.
      mobileOffset={{ bottom: 'calc(var(--spacing-nav) + env(safe-area-inset-bottom) + 12px)' }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-center gap-3 rounded-xl border border-border glass px-4 py-3 text-body text-popover-foreground shadow-md',
          title: 'font-semibold',
          description: 'text-small text-muted-foreground',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-destructive',
          actionButton: 'ml-auto min-h-touch press rounded-md px-3 font-medium text-primary',
        },
      }}
    />
  );
}
