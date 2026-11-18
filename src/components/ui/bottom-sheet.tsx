'use client';

import { useState } from 'react';
import { Drawer } from 'vaul';
import { useTranslations } from 'next-intl';
import { ChevronsUp, ChevronsDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { Button } from './button';

// Les 3 crans du sheet mobile : replié (poignée + titre + 1 ligne), mi-hauteur, plein.
export const SNAP_POINTS = ['148px', 0.5, 0.92] as const;
export type Snap = (typeof SNAP_POINTS)[number];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Action principale, collée en bas (bouton pleine largeur). */
  footer?: React.ReactNode;
  /** Cran initial sur mobile. */
  initialSnap?: Snap;
  /** Pied haut (ex. profil + actions, #1582) : réserve plus de place sous le contenu sur mobile. */
  tallFooter?: boolean;
  /** Modal (#1622) : voile derrière le sheet, un tap dessus le ferme ; la page derrière n'est plus utilisable. */
  modal?: boolean;
};

/**
 * Conteneur des détails : bottom sheet à 3 crans sur mobile (vaul), panneau latéral de 400 px
 * en desktop. Non modal : la carte reste utilisable derrière. Clavier : Échap ferme, le bouton
 * « Agrandir / Réduire » fait passer d'un cran à l'autre.
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
        className="fixed inset-y-3 left-[calc(var(--spacing-rail)+12px)] z-40 flex w-panel flex-col overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-md"
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
        {modal && <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/40" />}
        <Drawer.Content
          onInteractOutside={(e) => {
            // Le pied d'action est hors du Content (portail à part) : le toucher ne doit pas
            // être pris pour un clic « à l'extérieur » qui fermerait le sheet avant le clic (#1447).
            if ((e.target as Element | null)?.closest?.('[data-sheet-footer]')) e.preventDefault();
          }}
          className="fixed inset-x-0 bottom-0 z-40 flex h-full max-h-[96dvh] flex-col rounded-t-3xl border border-b-0 border-border bg-card text-card-foreground shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        {/* Le contenu du sheet est translaté selon le cran : l'action principale est donc posée
            à part, collée en bas de l'écran, pour rester visible à tous les crans. */}
        {open && footer && (
          <div data-sheet-footer className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </Drawer.Portal>
    </Drawer.Root>
  );
}
