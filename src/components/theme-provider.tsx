'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { THEMES } from '@/lib/design/themes';

/** Thème clair / sombre / système (+ thèmes de tokens.json), mémorisé dans le navigateur. */
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
