'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Crosshair } from 'lucide-react';
import { OVERALL } from '@/components/overall-tone';
import type { ConditionsPreview } from '@/lib/conditions-preview';
import { cn } from '@/lib/utils';

type Props = {
  /** `trace=<slug>` (création) ou `outing=<slug>` (modification). */
  target: { trace: string } | { outing: string };
  date: string;
  time: string;
  lat: number;
  lon: number;
};

/**
 * Verdict des conditions en une ligne pendant qu'on organise une sortie (#1407) : météo, massifs, chasse.
 * Rien de bloquant : sans date ou si le serveur ne répond pas, la ligne reste discrète ou disparaît.
 */
export function ConditionsVerdict({ target, date, time, lat, lon }: Props) {
  const t = useTranslations('conditions');
  const [result, setResult] = useState<{ key: string; value: ConditionsPreview | null } | null>(null);
  const qs = new URLSearchParams({ ...target, date, time, lat: String(lat), lon: String(lon) }).toString();
  const ready = !!date && !!time;

  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    // On attend la fin de la saisie (date tapée au clavier, RDV déplacé plusieurs fois).
    const timer = setTimeout(() => {
      fetch(`/api/outings/conditions?${qs}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((value: ConditionsPreview | null) => setResult({ key: qs, value }))
        .catch((e) => e.name !== 'AbortError' && setResult({ key: qs, value: null }));
    }, 400);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [qs, ready]);

  if (!ready) return <p className="text-small text-muted-foreground">{t('preview.pickDate')}</p>;
  const current = result?.key === qs ? result.value : undefined;
  if (current === null) return null;
  if (current === undefined)
    return (
      <p aria-busy className="text-small text-muted-foreground">
        {t('preview.loading')}
      </p>
    );
  const v = OVERALL[current.tone];
  return (
    <p aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-muted px-3 py-2 text-small">
      <span className={cn('flex items-center gap-2 font-medium', v.className)}>
        <v.icon aria-hidden className="size-5 shrink-0" />
        {t(`overall.${current.tone}`)}
      </span>
      {current.hunting === 'caution' && (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Crosshair aria-hidden className="size-4 shrink-0" />
          {t('preview.hunting')}
        </span>
      )}
    </p>
  );
}
