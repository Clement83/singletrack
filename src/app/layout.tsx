import type { Metadata, Viewport } from 'next';
import { ClientMessages } from '@/i18n/client-messages';
// Singletrack charter (#1645): Inter 4 with weight + optical size axes (automatic Display cut on headings).
import '@fontsource-variable/inter/opsz.css';
import './globals.css';
import { getLocale, getTranslations } from 'next-intl/server';
import tokens from '../../design/tokens.json';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { SwRegister } from '@/components/sw-register';
import { getCurrentUser } from '@/lib/current-user';
import { getDb } from '@/db';
import { getCharte } from '@/lib/user-profile';
import { CHARTES } from '@/lib/design/themes';

const bg = (t: 'light' | 'dark') => tokens.color.find((c) => c.name === 'background')!.value[t];
const light = () => bg('light');
const dark = () => bg('dark');

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('common');
  return {
    title: t('appName'),
    description: t('appDescription'),
    robots: { index: false, follow: false },
    icons: { icon: { url: '/icon.svg', type: 'image/svg+xml' }, apple: '/icons/apple-touch-icon.png' },
    appleWebApp: { capable: true, title: t('appName'), statusBarStyle: 'default' },
  };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: light() },
    { media: '(prefers-color-scheme: dark)', color: dark() },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Request language (#1400): NEXT_LOCALE cookie, otherwise browser, otherwise French.
  const locale = await getLocale();
  // Account charter (#1625), set on the server: no flash. Without a session: Classique.
  const me = await getCurrentUser();
  const charte = me ? getCharte(getDb().db, me.id) : CHARTES[0].id;
  return (
    // suppressHydrationWarning : next-themes pose data-theme avant l'hydratation.
    <html lang={locale} data-charte={charte} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Client messages per area (#1405): the bare minimum here, each segment sets its own. */}
        <ClientMessages zone="root">
          <ThemeProvider>
            {children}
            <Toaster />
            <SwRegister />
          </ThemeProvider>
        </ClientMessages>
      </body>
    </html>
  );
}
