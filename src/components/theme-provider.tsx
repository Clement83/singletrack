'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { THEMES } from '@/lib/design/themes';

/** Light / dark / system theme (+ themes from tokens.json), remembered in the browser. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      themes={THEMES.map((t) => t.id)}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
