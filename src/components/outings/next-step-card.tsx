'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NextStep } from '@/lib/outings/next-step';
import { OPEN_INVITE_EVENT, OPEN_RESPOND_EVENT, openActivity } from './bar-events';

export { OPEN_INVITE_EVENT };

const cls = 'flex min-h-[72px] w-full items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-left text-accent-foreground shadow-sm active:opacity-80';

/**
 * Encart « Prochaine étape » (#1620) : un seul bouton pleine largeur, piloté par `nextStep()`. Seul son contenu change.
 * `directionsHref` : cible de « RDV <lieu> ».
 */
export function NextStepCard({ step, directionsHref }: { step: NextStep; directionsHref: string }) {
  const t = useTranslations('nextStep');
  const body = (
    <>
      <span className="flex min-w-0 flex-col">
        <span className="text-label uppercase">{t('label')}</span>
        <span className="text-heading text-balance">{t(`title.${step.titleKey}` as 'label', step.params)}</span>
        {step.contextKey && <span className="text-small">{t(`context.${step.contextKey}` as 'label', step.params)}</span>}
      </span>
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-foreground text-accent"><ArrowRight className="size-5" /></span>
    </>
  );
  if (step.kind === 'meeting') {
    return <a data-next-step={step.kind} href={directionsHref} target="_blank" rel="noopener noreferrer" className={cls}>{body}</a>;
  }
  function go() {
    if (step.kind === 'remind') { window.dispatchEvent(new Event(OPEN_INVITE_EVENT)); return; }
    if (step.kind === 'answer' || step.kind === 'confirm' || step.kind === 'changeAnswer') { window.dispatchEvent(new Event(OPEN_RESPOND_EVENT)); return; }
    openActivity();
  }
  return <button type="button" data-next-step={step.kind} onClick={go} className={cls}>{body}</button>;
}
