'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { TRACK_VISIBILITIES } from '@/db/schema';

export type TrackVisibilityValue = (typeof TRACK_VISIBILITIES)[number];

const ICONS: Record<TrackVisibilityValue, LucideIcon> = { public: Globe, friends: Users, private: Lock };

/** Choix Publique / Copains / Privée d'une trace (#1590), partagé par l'éditeur, l'import, le panneau et le menu utilisateur. */
export function TrackVisibilityChips({ value, onChange, disabled, label, hint }: {
  value: TrackVisibilityValue;
  onChange: (v: TrackVisibilityValue) => void;
  disabled?: boolean;
  label?: string;
  /** Phrase d'explication complémentaire (ex. l'import, qui part en privé). */
  hint?: string;
}) {
  const t = useTranslations('trackVisibility');
  return (
    <div className="flex flex-col gap-2">
      <ChoiceChips
        label={label ?? t('label')}
        value={value}
        onChange={(id) => onChange(id as TrackVisibilityValue)}
        disabled={disabled}
        choices={TRACK_VISIBILITIES.map((id) => ({ id, label: t(id), icon: ICONS[id] }))}
      />
      <p className="text-small text-muted-foreground">{t(`${value}Hint`)}</p>
      {hint && <p className="text-small text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Pastille de visibilité : à n'afficher que sur ses propres traces. */
export function TrackVisibilityBadge({ value, className }: { value: TrackVisibilityValue; className?: string }) {
  const t = useTranslations('trackVisibility');
  const Icon = ICONS[value];
  return (
    <Badge variant="outline" className={className} data-testid="track-visibility-badge">
      <Icon aria-hidden />
      {t(value)}
    </Badge>
  );
}

/** Réglage du compte (#1588/#1590) : visibilité par défaut des traces dessinées ou importées. PUT /api/profile. */
export function DefaultTrackVisibility({ origin, initial }: { origin: 'drawn' | 'imported'; initial: TrackVisibilityValue }) {
  const t = useTranslations('trackVisibility');
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function change(next: TrackVisibilityValue) {
    if (next === value) return;
    setBusy(true);
    const res = await fetch('/api/profile', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(origin === 'drawn' ? { drawnTrackVisibility: next } : { importedTrackVisibility: next }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return void toast.error(t('error'));
    setValue(next);
    toast.success(t('saved'));
    router.refresh();
  }

  return <TrackVisibilityChips value={value} onChange={(v) => void change(v)} disabled={busy} label={t(origin === 'drawn' ? 'drawnLabel' : 'importedLabel')} />;
}
