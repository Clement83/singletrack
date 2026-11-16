import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { config } from '@/lib/config';

/** Mise en page des écrans d'auth (connexion, inscription, mot de passe) : centrée, une action principale. */
export function AuthShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  const t = useTranslations('common');
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div>
        <h1 className="text-title">{t('appName')}</h1>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      {children}
      <a
        href={config.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-touch items-center self-center text-small text-muted-foreground underline-offset-4 hover:underline"
      >
        {t('sourceCode')}
      </a>
    </main>
  );
}

/** Lien secondaire sous un formulaire d'auth (zone tactile ≥ 44 px). */
export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-touch items-center font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
      {children}
    </Link>
  );
}
