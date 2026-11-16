'use client';

import { useTranslations } from 'next-intl';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { OUTING_VISIBILITIES } from '@/db/schema';

export type OutingVisibilityValue = (typeof OUTING_VISIBILITIES)[number];

/** Choix Tous / Amis / Invitation (#1442), partagé par le menu utilisateur (défaut du compte) et le formulaire de sortie (surcharge). */
export function OutingVisibilityChips({ label, value, onChange, disabled, values = OUTING_VISIBILITIES }: {
  label: string;
  value: string;
  onChange: (v: OutingVisibilityValue) => void;
  disabled?: boolean;
  /** Choix proposés (le défaut du compte exclut « public », qui fige la sortie, #1455). */
  values?: readonly OutingVisibilityValue[];
}) {
  const t = useTranslations('outingVisibility');
  return (
    <div className="flex flex-col gap-2">
      <ChoiceChips
        label={label}
        value={value}
        onChange={(id) => onChange(id as OutingVisibilityValue)}
        disabled={disabled}
        choices={values.map((id) => ({ id, label: t(id) }))}
      />
      <p className="text-small text-muted-foreground">{t(`${value as OutingVisibilityValue}Hint`)}</p>
    </div>
  );
}
