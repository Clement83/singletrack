'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Clapperboard, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const SummaryPlayer = dynamic(() => import('./summary-player'), { ssr: false, loading: () => <Skeleton className="size-full" /> });

type Props = {
  /** `/api/outings/<slug>/recap` or `/api/i/<token>/recap` (same rights as the photos). */
  recapUrl: string;
  photoBase: string;
  videoBase: string;
};

/**
 * "Watch the summary" (#1694): button + full-screen native dialog (Escape, trapped focus) holding the player.
 * The caller only renders it for a finished outing that has a reference ridden track; data is fetched on open.
 */
export function OutingSummary({ recapUrl, photoBase, videoBase }: Props) {
  const t = useTranslations('summary');
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  // A media deleted from the player (#1701): the gallery behind is refreshed once the dialog is closed, not while
  // it plays (a refresh during playback could re-render the page under the film).
  const deleted = useRef(false);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} data-testid="summary-open" className="w-full">
        <Clapperboard aria-hidden /> {t('open')}
      </Button>
      <dialog
        ref={dialog}
        aria-label={t('title')}
        onClose={() => {
          setOpen(false);
          if (deleted.current) {
            deleted.current = false;
            router.refresh();
          }
        }}
        className="m-0 size-full max-h-none max-w-none overflow-hidden bg-media-surface p-0 text-media-foreground backdrop:bg-scrim"
      >
        {open && (
          <div className="relative size-full" data-testid="summary-player">
            <SummaryPlayer recapUrl={recapUrl} photoBase={photoBase} videoBase={videoBase} onDeleted={() => { deleted.current = true; }} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('close')}
              data-testid="summary-close"
              className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex size-11 items-center justify-center rounded-full bg-media-surface/60 text-media-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
        )}
      </dialog>
    </>
  );
}
