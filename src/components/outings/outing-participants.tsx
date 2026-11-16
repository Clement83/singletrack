'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { ActionSheet } from '@/components/ui/action-sheet';
import { RsvpBadge } from '@/components/ui/badge';
import { initialOf, summarizeParticipants, type Participant, type ParticipantStatus } from '@/lib/outings/participants-summary';

// Couleurs douces issues des tokens génériques (jamais difficulté, incendie ou pente), choisies d'après le prénom.
const TONES = [
  'bg-primary text-primary-foreground',
  'bg-accent text-accent-foreground',
  'bg-secondary text-secondary-foreground',
  'bg-muted text-foreground',
];
const toneOf = (name: string) => TONES[[...name].reduce((h, c) => (h * 31 + c.codePointAt(0)!) % 997, 7) % TONES.length];

function Avatar({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span aria-hidden style={style} className={cn('flex size-11 shrink-0 items-center justify-center rounded-full text-heading ring-2 ring-card', toneOf(name), className)}>
      {initialOf(name)}
    </span>
  );
}

const GROUPS: ParticipantStatus[] = ['yes', 'maybe', 'pending', 'no'];

type Props = {
  participants: Participant[];
  /** Places max de la sortie (hors organisateur, comme le décompte des réponses). */
  max?: number | null;
  /** Vue organisateur : message d'état vide « on relance ? ». */
  organizer?: boolean;
  className?: string;
};

/**
 * Bloc « Qui vient » compact (#1468), sous les conditions : avatars empilés, 3 premiers prénoms « et n autres »,
 * tap ⇒ tiroir avec tout le monde, groupé par réponse. Prénoms seulement.
 */
export function OutingParticipants({ participants, max, organizer, className }: Props) {
  const t = useTranslations('participants');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const s = summarizeParticipants(participants);
  const nameOf = (p: Participant) => (p.isMe ? t('me') : p.name);
  const names = new Intl.ListFormat(locale, { type: 'conjunction' }).format(s.preview.map(nameOf));
  const taken = participants.filter((p) => p.status === 'yes' && !p.isOrganizer).length;
  const left = max ? Math.max(0, max - taken) : null;

  const head = (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 id="participants-title" className="text-heading">{t('title')}</h3>
        <p className="text-small text-muted-foreground tabular-nums">
          {left === 0 ? t('full') : left !== null && left <= 3 ? t('placesLeft', { count: left }) : max ? t('countMax', { yes: s.counts.yes, max }) : t('count', { count: s.counts.yes })}
        </p>
      </div>
      {s.preview.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{organizer ? t('emptyOrganizer') : t('emptyGuest')}</p>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <span className="flex shrink-0 -space-x-2" aria-hidden>
            {s.preview.map((p, i) => (
              <Avatar key={p.id} name={p.name} className="avatar-in" style={{ '--i': i } as React.CSSProperties} />
            ))}
          </span>
          <p className="min-w-0 flex-1 text-body">
            {s.others > 0 ? t('summaryOthers', { names, others: s.others }) : names}
          </p>
          {s.needsSheet && <ChevronRight aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
        </div>
      )}
    </>
  );

  const box = 'block w-full rounded-2xl border border-border bg-card p-4 text-left text-card-foreground';
  return (
    <section aria-labelledby="participants-title" className={className}>
      {s.needsSheet ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label={t('seeAll', { count: participants.length })}
          className={cn(box, 'min-h-touch transition-colors duration-150 hover:bg-accent/40 active:bg-accent/60')}
        >
          {head}
        </button>
      ) : (
        <div className={box}>{head}</div>
      )}
      <ActionSheet open={open} onOpenChange={setOpen} title={t('sheetTitle')}>
        <div className="flex flex-col gap-4">
          {GROUPS.filter((g) => s.counts[g] > 0).map((g) => (
            <section key={g} aria-label={t(`group.${g}`, { count: s.counts[g] })}>
              <h4 className="mb-1 text-small font-semibold text-muted-foreground">{t(`group.${g}`, { count: s.counts[g] })}</h4>
              <ul className="divide-y divide-border">
                {participants.filter((p) => p.status === g).map((p) => (
                  <li key={p.id} className="flex min-h-14 items-center gap-3">
                    <Avatar name={p.name} />
                    <span className={cn('min-w-0 flex-1 truncate', p.isMe && 'font-semibold')}>{nameOf(p)}</span>
                    {p.isOrganizer && <span className="rounded-full bg-muted px-2 py-0.5 text-caption">{t('organizerTag')}</span>}
                    <RsvpBadge status={p.status} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ActionSheet>
    </section>
  );
}
