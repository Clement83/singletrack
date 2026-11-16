'use client';

import { Toaster as Sonner } from 'sonner';

/** Toasts courts (« Lien copié ») : `import { toast } from 'sonner'`. Styles = tokens uniquement. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      // Au-dessus de la barre du bas sur mobile.
      mobileOffset={{ bottom: 'calc(var(--spacing-nav) + env(safe-area-inset-bottom) + 12px)' }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-center gap-3 rounded-2xl border border-border bg-popover px-4 py-3 text-body text-popover-foreground shadow-md',
          title: 'font-semibold',
          description: 'text-small text-muted-foreground',
          success: '[&_[data-icon]]:text-success',
          error: '[&_[data-icon]]:text-destructive',
          actionButton: 'ml-auto min-h-touch rounded-xl px-3 font-semibold text-primary',
        },
      }}
    />
  );
}
