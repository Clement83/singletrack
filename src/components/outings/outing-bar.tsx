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

/** Action principale non-réponse de la barre : un seul bouton pleine largeur. */
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
 * Bulle de discussion (#1622) : badge des non-lus (messages postérieurs à la dernière ouverture, mémorisée par appareil),
 * fil dans un BottomSheet modal sans actualisation temps réel. `base` = null : lecteur non participant.
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
    } catch { /* hors ligne : pas de badge */ }
  }, [base, id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial du compteur
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
 * Barre fixe en bas de la vue de sortie (#1622) : action principale à gauche (`children`), bulle de discussion à droite.
 * La page garde un `padding-bottom` qui compense sa hauteur (voir `OutingView`).
 */
export function OutingBar({ children, discussion }: { children?: React.ReactNode; discussion: { id: string; base: string | null; closed: boolean } }) {
  return (
    <div data-outing-bar className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card text-card-foreground shadow-sheet">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div className="flex min-w-0 flex-1 items-center">{children}</div>
        <Discussion {...discussion} />
      </div>
    </div>
  );
}
