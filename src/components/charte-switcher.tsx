'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { CHARTES } from '@/lib/design/themes';

const KEY = 'singletrack-charte';

/** Démo (#1624, /styleguide) : choisit la charte graphique sans compte (attribut `data-charte`, mémorisé dans le navigateur). */
export function CharteSwitcher({ className }: { className?: string }) {
  const t = useTranslations('charte');
  const [charte, setCharte] = useState<string>();
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    const id = CHARTES.find((c) => c.id === saved)?.id ?? CHARTES[0].id;
    document.documentElement.dataset.charte = id;
    // Lecture du stockage navigateur après montage (indisponible au rendu serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCharte(id);
  }, []);
  const choose = (id: string) => {
    document.documentElement.dataset.charte = id;
    setCharte(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  return <ChoiceChips label={t('label')} className={className} value={charte} onChange={choose} choices={CHARTES.map((c) => ({ id: c.id, label: c.name }))} />;
}
