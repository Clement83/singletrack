'use client';

import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from './button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Titre (lu par les lecteurs d'écran) ; `header` le remplace visuellement s'il est fourni. */
  title: string;
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Bouton déclencheur (rendu tel quel, `asChild`). */
  trigger?: React.ReactNode;
  className?: string;
};

/**
 * Tiroir **modal** du bas (vaul) pour un menu ou un petit formulaire sur mobile : voile, focus piégé, Échap,
 * glisser pour fermer, zone de sécurité. À distinguer de `BottomSheet` (non modal, 3 crans, pour les détails
 * posés sur la carte). Utilisé par le menu utilisateur (#1397) et l'éditeur mobile (#1392).
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
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border border-b-0 border-border bg-card text-card-foreground shadow-sheet outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
