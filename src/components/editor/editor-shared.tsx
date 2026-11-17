'use client';

import { TrackVisibilityChips } from '@/components/tracks/track-visibility';
import { DeleteTrackButton } from '@/components/tracks/delete-track';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import type { EditorCtl } from './track-editor';
import { useErrorText } from '@/lib/use-error-text';

/** Stats en direct (distance, D+, D−), partagées par les mises en page mobile (#1392) et desktop (#1393). */
export function useEditorStats(ctl: EditorCtl) {
  const t = useTranslations('editor');
  const format = useFormatter();
  const { stats } = ctl;
  const m = (v: number | null) => (v == null ? '—' : `${format.number(Math.round(v))} m`);
  const approx = (v: number | null) => (stats.partial && v !== null ? ` ${t('approx')}` : '');
  return [
    { key: 'distance', label: t('distance'), value: stats.distanceM ? `${format.number(stats.distanceM / 1000, { maximumFractionDigits: 1 })} km` : '—' },
    { key: 'gain', label: `${t('gain')}${approx(stats.gainM)}`, value: m(stats.gainM) },
    { key: 'loss', label: `${t('loss')}${approx(stats.lossM)}`, value: m(stats.lossM) },
  ];
}

/** Formulaire d'enregistrement (nom, description), partagé par le panneau desktop et le tiroir mobile. */
export function SaveForm({ ctl, autoFocusName = false }: { ctl: EditorCtl; autoFocusName?: boolean }) {
  const t = useTranslations('editor');
  const { errors } = ctl;
  const errText = useErrorText();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void ctl.save();
      }}
    >
      <Field label={t('nameLabel')} error={errors.name && errText(errors.name)}>
        {(c) => (
          // autoFocus seulement en desktop (charte : jamais sur mobile, le clavier masquerait l'écran).
          <Input {...c} value={ctl.name} onChange={(e) => ctl.setName(e.target.value)} maxLength={200} autoComplete="off" autoFocus={autoFocusName} />
        )}
      </Field>
      <Field label={t('descriptionLabel')}>
        {(c) => <Textarea {...c} value={ctl.description} onChange={(e) => ctl.setDescription(e.target.value)} rows={3} />}
      </Field>
      <TrackVisibilityChips value={ctl.visibility} onChange={ctl.setVisibility} />
      {(errors.geometry || errors.waypoints || errors.parent) && <p className="text-small text-destructive">{errText(errors.geometry ?? errors.waypoints ?? errors.parent)}</p>}
      <Button type="submit" size="lg" disabled={ctl.saving || !ctl.canSave}>
        {ctl.saving ? <Loader2 className="animate-spin" /> : null} {t(`saveLabel.${ctl.saveKey}`)}
      </Button>
      {ctl.canDelete && ctl.slug && <DeleteTrackButton slug={ctl.slug} name={ctl.name} />}
    </form>
  );
}

/** Indicateur discret de l'enregistrement automatique (#1450) : icône + texte (texte seulement si `showText`). */
export function AutosaveStatus({ ctl, showText = true }: { ctl: EditorCtl; showText?: boolean }) {
  const t = useTranslations('editor.autosave');
  if (ctl.autosave === 'idle') return <span aria-live="polite" className="sr-only" />;
  const Icon = ctl.autosave === 'saving' ? Loader2 : ctl.autosave === 'saved' ? Check : AlertTriangle;
  return (
    <span aria-live="polite" className={`flex shrink-0 items-center gap-1 text-caption ${ctl.autosave === 'error' ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
      <Icon aria-hidden className={`size-4 ${ctl.autosave === 'saving' ? 'animate-spin' : ''}`} />
      <span className={showText ? '' : 'sr-only'}>{t(ctl.autosave)}</span>
    </span>
  );
}
