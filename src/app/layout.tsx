import type { Metadata, Viewport } from 'next';
import { ClientMessages } from '@/i18n/client-messages';
// Charte Singletrack (#1645) : Inter 4 avec axes poids + taille optique (coupe Display automatique sur les titres).
import '@fontsource-variable/inter/opsz.css';
// Charte « Technique nuit » (#1626) : @font-face seulement ; le navigateur ne télécharge un fichier que si une règle utilise la famille (Classique : jamais).
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
// Charte « Affiche de trail » (#1627) : Anton, sous-ensemble latin seul, `font-display: swap` ; téléchargée seulement si la charte l'utilise.
import '@fontsource/anton/latin-400.css';
// Charte « Alpin verre » (#1628) : Manrope variable, téléchargée seulement si la charte l'utilise.
import '@fontsource-variable/manrope/wght.css';
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
  // Langue de la requête (#1400) : cookie NEXT_LOCALE, sinon navigateur, sinon français.
  const locale = await getLocale();
  // Charte du compte (#1625), posée côté serveur : pas de flash. Sans session : Classique.
  const me = await getCurrentUser();
  const charte = me ? getCharte(getDb().db, me.id) : CHARTES[0].id;
  return (
    // suppressHydrationWarning : next-themes pose data-theme avant l'hydratation.
    <html lang={locale} data-charte={charte} suppressHydrationWarning>
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
