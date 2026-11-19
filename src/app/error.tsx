'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

// Erreur inattendue d'un écran (#1649) : ton simple et une suite possible, jamais une page blanche.
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('errors');
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        tone="error"
        icon={TriangleAlert}
        title={t('pageError')}
        action={<Button onClick={reset}>{t('retry')}</Button>}
      >
        {t('unknown')}
      </EmptyState>
    </main>
  );
}
