import { ExternalLink, Flame, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { OFFICIAL_MAP_URL, type FireMessage } from '@/lib/fire';
import { cn } from '@/lib/utils';

/** Banner for forbidden / not advised access: semantic colours, never colour alone (icon + text). */
export function FireBanner({ message, className }: { message: FireMessage; className?: string }) {
  if (!message.banner) return null;
  const danger = message.tone === 'danger';
  const Icon = danger ? Flame : TriangleAlert;
  return (
    <div role="alert" className={cn('flex flex-col gap-2 rounded-2xl p-4', danger ? 'bg-destructive-soft text-destructive' : 'bg-warning-soft text-warning', className)}>
      <p className="flex items-start gap-2 text-body font-semibold">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
        {message.banner}
      </p>
      {message.note && <p className="text-small">{message.note}</p>}
      <OfficialLink />
    </div>
  );
}

export function OfficialLink({ className }: { className?: string }) {
  const t = useTranslations('fire');
  return (
    <a href={OFFICIAL_MAP_URL} target="_blank" rel="noopener noreferrer" className={cn('inline-flex min-h-touch items-center gap-1.5 text-small font-semibold underline underline-offset-2 hover:opacity-80 active:opacity-70', className)}>
      {t('officialMap')} <ExternalLink aria-hidden className="size-4" />
    </a>
  );
}
