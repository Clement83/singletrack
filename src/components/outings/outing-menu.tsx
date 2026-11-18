'use client';

import { useState } from 'react';
import { Download, MoreHorizontal, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Button } from '@/components/ui/button';

/**
 * Menu « … » de l'organisateur (#1619) : modifier, dupliquer, annuler (`manage`), inviter (`invite`), partage et
 * exports (`share`). Le contenu est rendu côté serveur par la page et passé en slots.
 */
export function OutingMenu({ manage, invite, share }: { manage: React.ReactNode; invite: React.ReactNode; share?: React.ReactNode }) {
  const t = useTranslations('outingView');
  const [open, setOpen] = useState<'menu' | 'invite' | 'share' | null>(null);
  const close = (o: boolean) => !o && setOpen(null);
  return (
    <>
      <Button variant="outline" size="icon" aria-label={t('menu')} aria-haspopup="dialog" onClick={() => setOpen('menu')}><MoreHorizontal aria-hidden /></Button>
      <ActionSheet open={open === 'menu'} onOpenChange={close} title={t('menu')}>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => setOpen('invite')}><UserPlus aria-hidden /> {t('invite')}</Button>
          {share && <Button variant="outline" onClick={() => setOpen('share')}><Download aria-hidden /> {t('share')}</Button>}
          {manage}
        </div>
      </ActionSheet>
      <ActionSheet open={open === 'invite'} onOpenChange={close} title={t('invite')}>{invite}</ActionSheet>
      {share && <ActionSheet open={open === 'share'} onOpenChange={close} title={t('share')}>{share}</ActionSheet>}
    </>
  );
}
