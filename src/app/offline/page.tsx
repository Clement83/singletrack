import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('offline');
  return { title: t('title') };
}

// Service worker fallback page (pre-cached at install).
export default async function Offline() {
  const t = await getTranslations('offline');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <WifiOff aria-hidden className="size-10 text-muted-foreground" />
      <h1 className="text-title">{t('heading')}</h1>
      <p className="max-w-xs text-pretty text-muted-foreground">{t('body')}</p>
    </main>
  );
}
