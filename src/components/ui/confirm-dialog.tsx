'use client';

import { Loader2 } from 'lucide-react';
import { ActionSheet } from './action-sheet';
import { Button } from './button';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  /** Envoi en cours : les deux boutons sont désactivés. */
  busy?: boolean;
  busyLabel?: string;
  destructive?: boolean;
  /** Le bouton principal est inactif (ex. enregistrement impossible). */
  confirmDisabled?: boolean;
  /** Troisième choix, sous le bouton principal (ex. « Quitter sans enregistrer »). */
  secondary?: { label: string; onClick: () => void; destructive?: boolean };
};

/** Confirmation d'une action définitive (jamais le `confirm` du navigateur) : tiroir modal, bouton d'action pleine largeur. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, onConfirm, busy, busyLabel, destructive = true, confirmDisabled, secondary }: Props) {
  return (
    <ActionSheet open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={title}>
      <div className="flex flex-col gap-4">
        <p className="text-body text-pretty">{description}</p>
        <div className="flex flex-col gap-2">
          <Button size="lg" variant={destructive ? 'destructive' : 'primary'} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy && <Loader2 aria-hidden className="animate-spin" />} {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
          {secondary && (
            <Button size="lg" variant={secondary.destructive ? 'destructive' : 'outline'} disabled={busy} onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          )}
          <Button size="lg" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </ActionSheet>
  );
}
