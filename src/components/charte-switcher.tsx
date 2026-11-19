'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { CHARTES } from '@/lib/design/themes';

const KEY = 'singletrack-charte';

/** Charter choice: with `account` (account charter, #1625) saved through `PUT /api/profile`; without it, demo (#1624, /styleguide): picks the visual charter without an account (`data-charte` attribute, remembered in the browser). */
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
    // Browser storage read after mount (unavailable during server rendering).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCharte(id);
  }, [account]);
  const choose = (id: string) => {
    const before = document.documentElement.dataset.charte;
    document.documentElement.dataset.charte = id;
    setCharte(id);
    if (account !== undefined) {
      // Signed-in account (#1625): applied immediately, then saved; failure ⇒ back to the previous one.
      fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ charte: id }) })
        .then((r) => { if (!r.ok) throw new Error(); })
        .catch(() => { if (before) document.documentElement.dataset.charte = before; setCharte(before); });
      return;
    }
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };
  // A single charter declared: nothing to choose (the mechanism stays for future charters).
  if (CHARTES.length < 2) return null;
  return <ChoiceChips label={t('label')} className={className} value={charte} onChange={choose} choices={CHARTES.map((c) => ({ id: c.id, label: c.name }))} />;
}
