'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export type RsvpAnswer = 'yes' | 'maybe' | 'no';

type Props = {
  /** Nom de l'invité, saisi par l'organisateur. */
  name: string;
  value: RsvpAnswer | null;
  onChange: (answer: RsvpAnswer) => void;
  pending?: boolean;
  className?: string;
};

/**
 * Réponse de l'invité. Action principale unique : GO (pleine largeur, 52 px).
 * « Peut-être » et « Non » sont secondaires. La réponse se change avec les mêmes boutons.
 */
export function RsvpPanel({ name, value, onChange, pending = false, className }: Props) {
  const t = useTranslations('rsvp');
  const choice = (answer: RsvpAnswer, label: string) => (
    <Button
      variant={value === answer ? 'outline' : 'secondary'}
      aria-pressed={value === answer}
      disabled={pending}
      onClick={() => onChange(answer)}
      className={cn('flex-1', value === answer && 'border-primary bg-accent text-accent-foreground')}
    >
      {value === answer && <Check aria-hidden />}
      {label}
    </Button>
  );

  return (
    <section aria-label={t('region')} className={cn('flex flex-col gap-3', className)}>
      <p className="text-heading" aria-live="polite">
        {value ? t(`done.${value}`) : t('hello', { name })}
      </p>
      <Button
        size="lg"
        aria-pressed={value === 'yes'}
        disabled={pending}
        onClick={() => onChange('yes')}
        className="text-heading"
      >
        {value === 'yes' && <Check aria-hidden />}
        {t('go')}
      </Button>
      <div className="flex gap-3">
        {choice('maybe', t('maybe'))}
        {choice('no', t('no'))}
      </div>
    </section>
  );
}
