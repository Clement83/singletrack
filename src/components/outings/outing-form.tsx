'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Marker } from 'react-map-gl/maplibre';
import { MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useErrorText } from '@/lib/use-error-text';
import { LazyMap } from '@/components/lazy-map';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { outingWiderThanTrack } from '@/lib/outings/track-exposure';
import type { OutingVisibilityValue } from '@/components/outing-visibility-switcher';
import { ConditionsVerdict } from './conditions-verdict';

export type OutingFormValues = {
  title: string;
  description: string;
  date: string;
  time: string;
  meetingLat: number;
  meetingLon: number;
  meetingLabel: string;
  level: string;
  ebike: string;
  maxParticipants: string;
  visibility: OutingVisibilityValue;
  participantsCanInvite: boolean;
};

type Props = {
  /** Creation: slug of the track. Edit: slug of the outing. */
  mode: { kind: 'create'; trackSlug: string } | { kind: 'edit'; outingSlug: string };
  initial: OutingFormValues;
  /** Federation on (#1476): reminds that a cancellation sent to other servers is not guaranteed. */
  federated?: boolean;
  /** Visibility of the original track (#1592): warns when the outing is wider. */
  trackVisibility?: string | null;
};

/** Short form (charter): date, time, title, meeting point (tap on the map), level, e-bike. */
export function OutingForm({ mode, initial, federated = false, trackVisibility = null }: Props) {
  const t = useTranslations('outingForm');
  const tl = useTranslations('outingLabels');
  const tv = useTranslations('outingVisibility');
  const errText = useErrorText();
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  // Synchronous lock (#1424): `busy` only propagates on the next render, a double tap created two outings.
  const locked = useRef(false);
  const dirty = !sent && JSON.stringify(v) !== JSON.stringify(initial);
  // Warn before closing or reloading the page with unsaved changes (#1390, ui-ux skill).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const set = (k: keyof OutingFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setErrors({});
    const payload = {
      title: v.title,
      description: v.description,
      date: v.date,
      time: v.time,
      meetingLat: v.meetingLat,
      meetingLon: v.meetingLon,
      meetingLabel: v.meetingLabel,
      level: v.level,
      ebike: v.ebike,
      visibility: v.visibility,
      participantsCanInvite: v.participantsCanInvite,
      maxParticipants: v.maxParticipants ? Number(v.maxParticipants) : null,
    };
    let done = false;
    try {
      const res =
        mode.kind === 'create'
          ? await fetch('/api/outings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, trackSlug: mode.trackSlug }) })
          : await fetch(`/api/outings/${mode.outingSlug}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', ...payload }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSent(true);
        router.push(`/s/${mode.kind === 'create' ? data.slug : mode.outingSlug}`);
        router.refresh();
        done = true; // the lock stays on: we leave the page, no second submission possible
        return;
      }
      if (data.errors) setErrors(data.errors);
      else toast.error(t('saveFailed'));
    } catch {
      toast.error(errText('network'));
    } finally {
      if (!done) {
        locked.current = false;
        setBusy(false);
      }
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-28">
      <Field label={t('title')} error={errors.title && errText(errors.title)}>
        {(p) => <Input {...p} value={v.title} onChange={set('title')} maxLength={120} required autoComplete="off" />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('date')} error={errors.date && errText(errors.date)}>
          {(p) => <Input {...p} type="date" value={v.date} onChange={set('date')} required />}
        </Field>
        <Field label={t('time')}>
          {(p) => <Input {...p} type="time" value={v.time} onChange={set('time')} required />}
        </Field>
      </div>
      <ConditionsVerdict
        target={mode.kind === 'create' ? { trace: mode.trackSlug } : { outing: mode.outingSlug }}
        date={v.date}
        time={v.time}
        lat={v.meetingLat}
        lon={v.meetingLon}
      />
      <div className="flex flex-col gap-2">
        <span className="text-body font-medium">{t('meeting')}</span>
        <p className="text-small text-muted-foreground">{t('meetingHint')}</p>
        <div className="h-56 overflow-hidden rounded-2xl border border-border shadow-sm">
          <LazyMap
            lat={v.meetingLat}
            lon={v.meetingLon}
            zoom={13}
            embedded
            onClick={(e) => setV((s) => ({ ...s, meetingLat: +e.lngLat.lat.toFixed(6), meetingLon: +e.lngLat.lng.toFixed(6) }))}
          >
            <Marker longitude={v.meetingLon} latitude={v.meetingLat} anchor="bottom">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md" role="img" aria-label={t('meetingMarker')}>
                <MapPin className="size-5" />
              </span>
            </Marker>
          </LazyMap>
        </div>
        <Field label={t('place')} error={errors.meeting && errText(errors.meeting)}>
          {(p) => <Input {...p} value={v.meetingLabel} onChange={set('meetingLabel')} placeholder={t('placePlaceholder')} autoComplete="off" />}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('level')} error={errors.level && errText(errors.level)}>
          {(p) => (
            <NativeSelect {...p} value={v.level} onChange={set('level')}>
              {(['balade', 'sportif', 'enduro'] as const).map((k) => <option key={k} value={k}>{tl(`level.${k}`)}</option>)}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('ebike')} error={errors.ebike && errText(errors.ebike)}>
          {(p) => (
            <NativeSelect {...p} value={v.ebike} onChange={set('ebike')}>
              {(['yes', 'no', 'only'] as const).map((k) => <option key={k} value={k}>{tl(`ebike.${k}`)}</option>)}
            </NativeSelect>
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <ChoiceChips
          label={tv('formLabel')}
          value={v.visibility}
          onChange={(id) => setV((s) => ({ ...s, visibility: id as OutingVisibilityValue }))}
          choices={(mode.kind === 'create' ? (['friends', 'invite', 'public'] as const) : (['friends', 'invite'] as const)).map((id) => ({ id, label: tv(`form.${id}`) }))}
          className="flex-col items-stretch"
        />
        <p className={v.visibility === 'public' ? 'rounded-2xl border border-border bg-accent/40 p-3 text-small' : 'text-small text-muted-foreground'}>{tv(`form.${v.visibility}Hint`)}</p>
        {outingWiderThanTrack(v.visibility, trackVisibility) && <p role="note" className="rounded-2xl border border-border bg-accent/40 p-3 text-small">{tv('form.trackStaysPrivate')}</p>}
        {federated && <p className="text-small text-muted-foreground">{tv('form.federationNote')}</p>}
        {v.visibility !== 'public' && (
          <label className="flex min-h-touch items-center gap-3 text-body">
            <input type="checkbox" className="size-6 shrink-0 accent-primary" checked={v.participantsCanInvite} onChange={(e) => setV((s) => ({ ...s, participantsCanInvite: e.target.checked }))} />
            {tv('form.participantsCanInvite')}
          </label>
        )}
      </div>
      <Field label={t('description')}>
        {(p) => <Textarea {...p} value={v.description} onChange={set('description')} />}
      </Field>
      <Field label={t('max')} error={errors.maxParticipants && errText(errors.maxParticipants)}>
        {(p) => <Input {...p} type="number" inputMode="numeric" min={1} max={500} value={v.maxParticipants} onChange={set('maxParticipants')} />}
      </Field>
      <div className="fixed inset-x-0 bottom-0 z-30 glass border-t border-border px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t('saving') : mode.kind === 'create' ? t('create') : t('save')}
        </Button>
      </div>
    </form>
  );
}
