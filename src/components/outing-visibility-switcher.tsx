'use client';

import { useTranslations } from 'next-intl';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { OUTING_VISIBILITIES } from '@/db/schema';

export type OutingVisibilityValue = (typeof OUTING_VISIBILITIES)[number];

/** Everyone / Friends / Invitation choice (#1442), shared by the user menu (account default) and the outing form (override). */
export function OutingVisibilityChips({ label, value, onChange, disabled, values = OUTING_VISIBILITIES }: {
  label: string;
  value: string;
  onChange: (v: OutingVisibilityValue) => void;
  disabled?: boolean;
  /** Choices offered (the account default excludes "public", which freezes the outing, #1455). */
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
