import type { Metadata, Viewport } from 'next';
import { ClientMessages } from '@/i18n/client-messages';
import '@fontsource-variable/inter';
import './globals.css';
import { getLocale, getTranslations } from 'next-intl/server';
import tokens from '../../design/tokens.json';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { SwRegister } from '@/components/sw-register';

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
  // Langue de la requête (#1400) : cookie NEXT_LOCALE, sinon navigateur, sinon français.
  const locale = await getLocale();
  return (
    // suppressHydrationWarning : next-themes pose data-theme avant l'hydratation.
    <html lang={locale} suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* Messages client par zone (#1405) : ici le strict minimum, chaque segment pose les siens. */}
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
