'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ChoiceChips } from '@/components/ui/choice-chips';

// Le thème choisi n'est connu qu'après le montage (localStorage) : rien de sélectionné avant.
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/** Choix du thème : système, clair ou sombre (#1396 : deux thèmes seulement), mémorisé dans le navigateur. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const t = useTranslations('theme');
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <ChoiceChips
      label={t('label')}
      className={className}
      value={mounted ? theme : undefined}
      onChange={setTheme}
      choices={[
        { id: 'system', label: t('system'), icon: Monitor },
        { id: 'light', label: t('light'), icon: Sun },
        { id: 'dark', label: t('dark'), icon: Moon },
      ]}
    />
  );
}
