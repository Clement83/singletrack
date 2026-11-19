'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageCircle } from 'lucide-react';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OutingComments } from '@/components/outings/outing-comments';
import { countUnread, readLastOpened, writeLastOpened } from '@/lib/outings/unread';
import { OPEN_INVITE_EVENT, openActivity } from './bar-events';

export type BarActionKind = 'invite' | 'directions' | 'addRide' | 'addPhotos' | 'seePhotos';

/** Main non-answer action of the bar: a single full-width button. */
export function BarAction({ kind, href }: { kind: BarActionKind; href?: string }) {
  const t = useTranslations('outingBar');
  if (kind === 'directions' && href) {
    return <Button asChild size="lg" className="w-full"><a data-bar-action={kind} href={href} target="_blank" rel="noopener noreferrer">{t('directions')}</a></Button>;
  }
  return (
    <Button size="lg" data-bar-action={kind} className="w-full" onClick={() => (kind === 'invite' ? window.dispatchEvent(new Event(OPEN_INVITE_EVENT)) : openActivity())}>
      {t(kind === 'directions' ? 'directions' : kind)}
    </Button>
  );
}

/**
 * Discussion bubble (#1622): unread badge (messages after the last opening, remembered per device),
 * thread in a modal BottomSheet without real-time refresh. `base` = null: non-participant reader.
 */
function Discussion({ id, base, closed }: { id: string; base: string | null; closed: boolean }) {
  const t = useTranslations('outingBar');
  const tc = useTranslations('comments');
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (!res.ok) return;
      const { comments } = (await res.json()) as { comments: { createdAt: string; mine: boolean }[] };
      setUnread(countUnread(comments, readLastOpened(id)));
    } catch { /* offline: no badge */ }
  }, [base, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of the counter
    void refresh();
  }, [refresh]);

  function change(next: boolean) {
    setOpen(next);
    if (next) { writeLastOpened(id); setUnread(0); }
    else void refresh();
  }

  return (
    <>
      <button
        type="button"
        data-bar-bubble
        aria-label={unread > 0 ? t('discussionUnread', { n: unread }) : t('discussion')}
        onClick={() => change(true)}
        className="relative flex size-[52px] shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-secondary-foreground transition-colors active:opacity-80"
      >
        <MessageCircle aria-hidden className="size-6" />
        {unread > 0 && <Badge aria-hidden className="absolute -top-1 -right-1 min-w-5 justify-center bg-destructive px-1.5 text-destructive-foreground tabular-nums">{unread}</Badge>}
      </button>
      <BottomSheet open={open} onOpenChange={change} title={tc('title')} initialSnap={0.92} modal>
        {base ? <OutingComments base={base} closed={closed} live={false} bare /> : <p className="text-muted-foreground">{t('restricted')}</p>}
      </BottomSheet>
    </>
  );
}

/**
 * Fixed bar at the bottom of the outing view (#1622): main action on the left (`children`), discussion bubble on the right.
 * The page keeps a `padding-bottom` that compensates for its height (see `OutingView`).
 */
export function OutingBar({ children, discussion }: { children?: React.ReactNode; discussion: { id: string; base: string | null; closed: boolean } }) {
  return (
    <div data-outing-bar className="fixed inset-x-0 bottom-0 z-30 glass border-t border-border text-card-foreground shadow-sheet">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
        <Discussion {...discussion} />
      </div>
    </div>
  );
}
