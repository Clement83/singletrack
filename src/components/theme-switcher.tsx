'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import { ChoiceChips } from '@/components/ui/choice-chips';

// The chosen theme is only known after mount (localStorage): nothing selected before.
const useMounted = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/** Theme choice: system, light or dark (#1396: only two themes), remembered in the browser. */
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
