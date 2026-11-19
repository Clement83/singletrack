'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Avatar } from '@/components/outings/outing-participants';

/** The organiser's note (#1619): quote on a `muted` background, 3 lines then "Read more" / "Show less". */
export function OrganizerWord({ name, text }: { name: string; text: string }) {
  const t = useTranslations('outingView');
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflow(el.scrollHeight > el.clientHeight + 1);
  }, [text, expanded]);
  return (
    <figure className="flex gap-3 rounded-2xl bg-muted p-3">
      <Avatar name={name} className="size-9 ring-0" />
      <div className="min-w-0 flex-1">
        <blockquote>
          <p id={id} ref={ref} className={cn('whitespace-pre-line break-words', !expanded && 'line-clamp-3')}>{text}</p>
        </blockquote>
        {(overflow || expanded) && (
          <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((v) => !v)} className="-mb-2 mt-1 flex min-h-touch items-center text-small font-medium text-primary underline-offset-4 hover:underline active:opacity-70">
            {expanded ? t('less') : t('more')}
          </button>
        )}
      </div>
    </figure>
  );
}
