import { MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

// 404 aux couleurs de la charte (#1649).
export default async function NotFound() {
  const t = await getTranslations('errors');
  return (
    <main className="flex min-h-dvh items-center justify-center">
      <EmptyState
        icon={MapPinOff}
        title={t('pageNotFound')}
        action={
          <Link href="/" className={buttonVariants()}>
            {t('backToMap')}
          </Link>
        }
      >
        {t('pageNotFoundBody')}
      </EmptyState>
    </main>
  );
}
