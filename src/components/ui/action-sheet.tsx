'use client';

import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from './button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title (read by screen readers); `header` replaces it visually if provided. */
  title: string;
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Trigger button (rendered as is, `asChild`). */
  trigger?: React.ReactNode;
  className?: string;
};

/**
 * **Modal** bottom drawer (vaul) for a menu or a small form on mobile: scrim, trapped focus, Escape,
 * drag to close, safe area. Not to be confused with `BottomSheet` (non-modal, 3 detents, for details
 * placed on the map). Used by the user menu (#1397) and the mobile editor (#1392).
 */
export function ActionSheet({ open, onOpenChange, title, header, children, trigger, className }: Props) {
  const t = useTranslations('userMenu');
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-scrim" />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl border border-b-0 border-border glass text-card-foreground shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <Drawer.Handle className="mt-2 !bg-muted" />
          <div className="flex items-start justify-between gap-2 px-4 pt-3">
            {header ? (
              <>
                <Drawer.Title className="sr-only">{title}</Drawer.Title>
                <div className="min-w-0 flex-1">{header}</div>
              </>
            ) : (
              <Drawer.Title className="min-w-0 flex-1 truncate pt-2 text-heading">{title}</Drawer.Title>
            )}
            <Drawer.Description className="sr-only">{title}</Drawer.Description>
            <Button variant="ghost" size="icon" aria-label={t('close')} onClick={() => onOpenChange(false)}>
              <X />
            </Button>
          </div>
          <div className="overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
