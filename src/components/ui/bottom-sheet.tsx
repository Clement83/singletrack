'use client';

import { useState } from 'react';
import { Drawer } from 'vaul';
import { useTranslations } from 'next-intl';
import { ChevronsUp, ChevronsDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { Button } from './button';

// The 3 detents of the mobile sheet: collapsed (handle + title + 1 line), half height, full.
export const SNAP_POINTS = ['148px', 0.5, 0.92] as const;
export type Snap = (typeof SNAP_POINTS)[number];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Main action, stuck at the bottom (full-width button). */
  footer?: React.ReactNode;
  /** Cran initial sur mobile. */
  initialSnap?: Snap;
  /** Tall footer (e.g. profile + actions, #1582): reserves more room under the content on mobile. */
  tallFooter?: boolean;
  /** Modal (#1622): scrim behind the sheet, a tap on it closes it; the page behind is no longer usable. */
  modal?: boolean;
};

/**
 * Details container: 3-detent bottom sheet on mobile (vaul), 400 px side panel
 * on desktop. Non-modal: the map stays usable behind. Keyboard: Escape closes, the
 * "Expand / Shrink" button moves from one detent to the next.
 */
export function BottomSheet({ open, onOpenChange, title, description, children, footer, initialSnap = 0.5, tallFooter = false, modal = false }: Props) {
  const tSheet = useTranslations('sheet');
  const desktop = useMediaQuery(DESKTOP);
  const [snap, setSnap] = useState<Snap | string | number | null>(initialSnap);

  if (desktop) {
    if (!open) return null;
    return (
      <aside
        aria-label={title}
        onKeyDown={(e) => e.key === 'Escape' && onOpenChange(false)}
        className="panel-in fixed inset-y-3 left-[calc(var(--spacing-rail)+12px)] z-40 flex w-panel flex-col overflow-hidden rounded-2xl border border-border glass text-card-foreground shadow-md"
      >
        <header className="flex items-start gap-2 p-4 pb-2">
          <div className="min-w-0 flex-1 pt-2">
            <h2 className="text-title">{title}</h2>
            {description && <p className="mt-1 text-small text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" aria-label={tSheet('close')} onClick={() => onOpenChange(false)}>
            <X />
          </Button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer && <div className="border-t border-border p-4">{footer}</div>}
      </aside>
    );
  }

  const index = SNAP_POINTS.indexOf(snap as Snap);
  const full = index === SNAP_POINTS.length - 1;
  const cycle = () => setSnap(SNAP_POINTS[full ? 0 : index + 1]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[...SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      modal={modal}
    >
      <Drawer.Portal>
        {modal && <Drawer.Overlay className="fade-in fixed inset-0 z-40 bg-foreground/40" />}
        <Drawer.Content
          onInteractOutside={(e) => {
            // The action footer is outside Content (separate portal): touching it must not
            // be taken for a click "outside" that would close the sheet before the click (#1447).
            if ((e.target as Element | null)?.closest?.('[data-sheet-footer]')) e.preventDefault();
          }}
          className="fixed inset-x-0 bottom-0 z-40 flex h-full max-h-[96dvh] flex-col rounded-t-2xl border border-b-0 border-border glass text-card-foreground shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Drawer.Handle className="mt-2 !bg-muted" />
          <header className="flex items-start gap-1 px-4">
            <div className="min-w-0 flex-1 pt-1.5">
              <Drawer.Title className="truncate text-heading">{title}</Drawer.Title>
              <Drawer.Description className={cn('truncate text-small text-muted-foreground', !description && 'sr-only')}>
                {description ?? title}
              </Drawer.Description>
            </div>
            <Button variant="ghost" size="icon" aria-label={full ? tSheet('collapse') : tSheet('expand')} onClick={cycle}>
              {full ? <ChevronsDown /> : <ChevronsUp />}
            </Button>
            <Button variant="ghost" size="icon" aria-label={tSheet('close')} onClick={() => onOpenChange(false)}>
              <X />
            </Button>
          </header>
          <div className={cn('flex-1 px-4 pt-2 pb-4', full ? 'overflow-y-auto' : 'overflow-hidden', footer && (tallFooter ? 'pb-64' : 'pb-28'))}>
            {children}
          </div>
        </Drawer.Content>
        {/* The sheet content is translated according to the detent: the main action is therefore placed
            separately, stuck to the bottom of the screen, to stay visible at every detent. */}
        {open && footer && (
          <div data-sheet-footer className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 border-t border-border glass px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </Drawer.Portal>
    </Drawer.Root>
  );
}
