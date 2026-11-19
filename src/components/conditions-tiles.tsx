'use client';

import { useState } from 'react';
import { Check, Minus, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionSheet } from '@/components/ui/action-sheet';
import { cn } from '@/lib/utils';
import type { TileLevel } from '@/lib/conditions';

export type Tile = {
  id: 'weather' | 'fire' | 'hunting';
  label: string;
  /** Icon already rendered: a component (function) cannot be passed from server to client. */
  icon: React.ReactNode;
  level: TileLevel;
  /** One line: tooltip (hover) and accessible name. */
  summary: string;
  /** Full card of the item (rendered on the server): detail, alerts, links. */
  detail: React.ReactNode;
};

/** Colours = reserved alert tokens; the level is also told by a shape (check, triangle, octagon, dash). */
const LEVEL: Record<TileLevel, { chip: string; mark: LucideIcon }> = {
  ok: { chip: 'bg-success-soft text-success', mark: Check },
  warn: { chip: 'bg-warning-soft text-warning', mark: TriangleAlert },
  danger: { chip: 'bg-destructive-soft text-destructive', mark: OctagonAlert },
  black: { chip: 'bg-fire-5 text-background', mark: OctagonAlert },
  none: { chip: 'bg-muted text-muted-foreground', mark: Minus },
};

/**
 * Three level icons (Weather, Fire, Hunting), each opens its card on tap or click (bottom drawer,
 * modal: works with a finger, a mouse and a keyboard). The hover tooltip is only a convenience (#1454).
 */
export function ConditionsTiles({ tiles }: { tiles: Tile[] }) {
  const t = useTranslations('conditions');
  const [openId, setOpenId] = useState<Tile['id'] | null>(null);
  const current = tiles.find((x) => x.id === openId);
  return (
    <>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {tiles.map((x) => {
          const L = LEVEL[x.level];
          return (
            <li key={x.id}>
              <button
                type="button"
                title={x.summary}
                aria-label={`${x.label} : ${x.summary}. ${t('openDetail')}`}
                aria-haspopup="dialog"
                onClick={() => setOpenId(x.id)}
                className="flex min-h-touch w-full flex-col items-center gap-1 rounded-2xl border border-border bg-card/60 px-2 py-2.5 text-small font-semibold transition-colors hover:bg-muted active:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={cn('relative flex size-11 items-center justify-center rounded-full', L.chip)}>
                  {x.icon}
                  <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-card bg-card text-foreground">
                    <L.mark aria-hidden className="size-3" strokeWidth={3} />
                  </span>
                </span>
                {x.label}
              </button>
            </li>
          );
        })}
      </ul>
      <ActionSheet open={!!current} onOpenChange={(o) => !o && setOpenId(null)} title={current?.label ?? t('title')}>
        {current?.detail}
      </ActionSheet>
    </>
  );
}
