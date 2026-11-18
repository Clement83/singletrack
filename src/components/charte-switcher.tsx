'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { CHARTES } from '@/lib/design/themes';

const KEY = 'singletrack-charte';

/** Choix de charte : avec `account` (charte du compte, #1625) enregistrée par `PUT /api/profile` ; sans, démo (#1624, /styleguide) : choisit la charte graphique sans compte (attribut `data-charte`, mémorisé dans le navigateur). */
export function CharteSwitcher({ className, account }: { className?: string; account?: string }) {
  const t = useTranslations('charte');
  const [charte, setCharte] = useState<string | undefined>(account);
  useEffect(() => {
    if (account) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    const id = CHARTES.find((c) => c.id === saved)?.id ?? CHARTES[0].id;
    document.documentElement.dataset.charte = id;
    // Lecture du stockage navigateur après montage (indisponible au rendu serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCharte(id);
  }, [account]);
  const choose = (id: string) => {
    const before = document.documentElement.dataset.charte;
    document.documentElement.dataset.charte = id;
    setCharte(id);
    if (account !== undefined) {
      // Compte connecté (#1625) : appliquée tout de suite, puis enregistrée ; échec ⇒ retour à la précédente.
      fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ charte: id }) })
        .then((r) => { if (!r.ok) throw new Error(); })
        .catch(() => { if (before) document.documentElement.dataset.charte = before; setCharte(before); });
      return;
    }
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  return <ChoiceChips label={t('label')} className={className} value={charte} onChange={choose} choices={CHARTES.map((c) => ({ id: c.id, label: c.name }))} />;
}
