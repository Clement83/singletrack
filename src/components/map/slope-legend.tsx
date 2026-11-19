'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Mountain } from 'lucide-react';
import { cn } from '@/lib/utils';

const UP = ['bg-slope-up-1', 'bg-slope-up-2', 'bg-slope-up-3', 'bg-slope-up-4', 'bg-slope-up-5'];
const DOWN = ['bg-slope-down-1', 'bg-slope-down-2', 'bg-slope-down-3', 'bg-slope-down-4', 'bg-slope-down-5'];

function Ramp({ label, colors }: { label: string; colors: string[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-label text-muted-foreground uppercase">{label}</span>
      <span className="flex overflow-hidden rounded-full ring-1 ring-border/60" aria-hidden>
        {colors.map((c) => <span key={c} className={cn('h-2.5 w-6', c)} />)}
      </span>
    </div>
  );
}

/** Collapsible "Climb / Descent" legend; collapsed by default (a 44 px button), to place in a `relative` container. */
export function SlopeLegend({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  return (
    <div className={cn('absolute z-10 rounded-xl border border-border glass shadow-md', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-touch items-center gap-2 rounded-xl px-3 text-small font-medium text-foreground press"
      >
        <Mountain aria-hidden className="size-4" /> {t('map.slopes')}
        <ChevronDown aria-hidden className={cn('size-4 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Ramp label={t('profile.up')} colors={UP} />
          <Ramp label={t('profile.down')} colors={DOWN} />
          <p className="text-caption text-muted-foreground">{t('map.slopesHint')}</p>
        </div>
      )}
    </div>
  );
}
