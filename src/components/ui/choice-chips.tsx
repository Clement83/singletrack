'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type Choice = { id: string; label: string; icon?: LucideIcon };

/**
 * Choix unique en pastilles (boutons radio) : thème, langue… Zones ≥ 44 px, sélection en `accent`.
 * `value` indéfini = rien de sélectionné (ex. valeur connue seulement après le montage).
 */
export function ChoiceChips({
  label,
  choices,
  value,
  onChange,
  disabled,
  className,
}: {
  label: string;
  choices: Choice[];
  value: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {choices.map(({ id, label: name, icon: Icon }) => {
        const on = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cn(
              'flex min-h-touch items-center gap-2 rounded-md border px-4 font-medium press disabled:opacity-50',
              on
                ? 'border-primary bg-accent text-accent-foreground'
                : 'border-border bg-card text-foreground hover:bg-accent active:bg-accent',
            )}
          >
            {Icon && <Icon aria-hidden className="size-[18px]" strokeWidth={1.75} />}
            {name}
          </button>
        );
      })}
    </div>
  );
}
