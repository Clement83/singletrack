'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CalendarSync, Copy, RefreshCw, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { subscribeLinks } from '@/lib/outings/links';

type Props = {
  /** URL https absolue du flux (`/i/<token>/calendar.ics` ou `/cal/<token>/calendar.ics`). */
  feedUrl: string;
  /** Organisateur : copier le lien et le régénérer (le flux couvre toutes ses sorties). */
  organizer?: boolean;
};

/**
 * Abonnement agenda (#1357) : Google Agenda, agenda iPhone (webcal), et pour l'organisateur copier / régénérer le
 * lien. L'agenda se met à jour tout seul, mais à son rythme : on le dit honnêtement.
 */
export function CalendarSubscribe({ feedUrl, organizer = false }: Props) {
  const t = useTranslations('share');
  const tc = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const links = subscribeLinks(feedUrl);

  async function copy() {
    try {
      await navigator.clipboard.writeText(links.https);
      toast.success(t('feedCopied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const res = await fetch('/api/calendar-feed', { method: 'POST' });
      if (!res.ok) throw new Error('failed');
      toast.success(t('feedRegenerated'));
      router.refresh();
    } catch {
      toast.error(t('feedRegenerateFailed'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-small font-medium">
        <CalendarSync aria-hidden className="size-4" /> {t(organizer ? 'feedOrganizerTitle' : 'subscribeTitle')}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button asChild variant="outline">
          <a href={links.google} target="_blank" rel="noopener noreferrer">
            <CalendarSync aria-hidden /> {t('subscribeGoogle')}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={links.webcal}>
            <Smartphone aria-hidden /> {t('subscribeApple')}
          </a>
        </Button>
      </div>
      {organizer && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button variant="secondary" onClick={() => void copy()}>
            <Copy aria-hidden /> {t('feedCopy')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
            <RefreshCw aria-hidden /> {t('feedRegenerate')}
          </Button>
        </div>
      )}
      <p className="text-small text-muted-foreground text-pretty">{t('subscribeNote')}</p>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('feedRegenerate')}
        description={t('feedRegenerateConfirm')}
        confirmLabel={t('feedRegenerate')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => void regenerate()}
      />
    </div>
  );
}
