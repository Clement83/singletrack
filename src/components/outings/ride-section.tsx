'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { formatDuration, formatElevation, formatKm } from '@/lib/format';
import { useErrorText } from '@/lib/use-error-text';
import type { RideView } from '@/lib/outings/ride';
import type { TrackGeometry } from '@/lib/geo/types';
import { cn } from '@/lib/utils';
import { RideMap } from './ride-map';
import { OTHER_VARS } from './ride-map-inner';

type Planned = { geometry: TrackGeometry; bbox: [number, number, number, number]; distanceM: number; gainM: number | null };
type Props = {
  base: string;
  rides: RideView[];
  /** `null` for a remote outing without a route (#1779): no planned line, no comparison. */
  planned: Planned | null;
  canUpload: boolean;
  /** Organiser only (#1692): which ridden track feeds the recap. */
  reference?: { id: string | null; timed: Record<string, boolean> };
};

const MAX_MB = 5;

/** After the outing (#1412): "My ridden track" (GPX), planned / actual overlay and real stats. */
export function RideSection({ base, rides, planned, canUpload, reference }: Props) {
  const t = useTranslations('ride');
  const tc = useTranslations('common');
  const [confirming, setConfirming] = useState(false);
  const errText = useErrorText();
  const locale = useLocale() as 'fr' | 'en';
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = rides.find((r) => r.id === picked) ?? rides.find((r) => r.mine) ?? rides[0] ?? null;
  const mine = rides.find((r) => r.mine);

  async function upload(file: File) {
    if (file.size > MAX_MB * 1024 * 1024) return toast.error(t('errors.tooLarge', { mb: MAX_MB }));
    setBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const res = await fetch(base, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(t('saved'));
        if (data.federated === 'unsupported') toast.message(t('unsupported'));
        setPicked(null);
        router.refresh();
      } else toast.error(t.has(`errors.${data.error}` as never) ? t(`errors.${data.error}` as never) : errText(data.error));
    } catch {
      toast.error(t('errors.network'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function pickReference(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`${base}/reference`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rideId: id }) });
      if (res.ok) {
        toast.success(t('referenceSet'));
        router.refresh();
      } else toast.error(t('referenceError'));
    } catch {
      toast.error(t('errors.network'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(base, { method: 'DELETE' });
      if (res.ok) router.refresh();
      else toast.error(t('errors.generic'));
    } catch {
      toast.error(t('errors.network'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!canUpload && rides.length === 0) return null;
  const km = (m: number) => formatKm(m / 1000, locale);
  const sign = (d: number) => (d > 0 ? '+' : '−');
  const deltaKm = (real: number, plan: number) => (Math.abs(real - plan) < 100 ? null : `${sign(real - plan)}${km(Math.abs(real - plan))}`);
  const deltaGain = (real: number, plan: number) => (Math.abs(real - plan) < 10 ? null : `${sign(real - plan)}${Math.round(Math.abs(real - plan))}\u00a0m`);

  return (
    <section aria-label={t('title')} className="flex flex-col gap-3">
      <h2 className="text-heading">{rides.length > 1 || (rides.length === 1 && !mine) ? t('titleGroup') : t('title')}</h2>
      {rides.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}

      {selected && (
        <>
          <RideMap label={t('mapLabel')} planned={planned?.geometry ?? null} ride={selected.geometry} others={rides.filter((r) => r.id !== selected.id).map((r) => ({ id: r.id, geometry: r.geometry, slot: rides.indexOf(r) }))} bbox={planned ? (selected.bbox.map((v, i) => (i < 2 ? Math.min(v, planned.bbox[i]) : Math.max(v, planned.bbox[i]))) as [number, number, number, number]) : selected.bbox} />
          {planned && <ul className="flex items-center gap-4 text-small text-muted-foreground" aria-label={t('legend')}>
            <li className="flex items-center gap-2"><span aria-hidden className="h-0 w-6 border-t-[3px] border-dashed border-foreground" />{t('planned')}</li>
            <li className="flex items-center gap-2"><span aria-hidden className="h-1 w-6 rounded-full bg-primary" />{t('real')}</li>
          </ul>}
        </>
      )}

      <ul className="flex flex-col gap-3">
        {rides.map((r) => {
          const avg = r.movingSec ? (r.distanceM / 1000) / (r.movingSec / 3600) : null;
          const on = r.id === selected?.id;
          const dKm = planned ? deltaKm(r.distanceM, planned.distanceM) : null;
          const dGain = planned && r.gainM != null && planned.gainM != null ? deltaGain(r.gainM, planned.gainM) : null;
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(r.id)}
                className={cn('flex min-h-touch w-full flex-col gap-2 rounded-2xl border p-4 text-left shadow-sm transition-colors active:bg-muted', on ? 'border-primary bg-card' : 'border-border bg-card')}
              >
                <span className="flex items-center gap-2 font-medium">
                  <span aria-hidden className="h-1 w-4 rounded-full" style={{ background: on ? 'var(--primary)' : `var(${OTHER_VARS[rides.indexOf(r) % OTHER_VARS.length]})` }} />
                  {r.mine ? t('mine') : r.organizer ? t('organizer') : r.author}
                </span>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 tabular-nums sm:grid-cols-4">
                  <Stat label={t('distance')} value={km(r.distanceM)} hint={dKm ? t('vsPlanned', { delta: dKm }) : undefined} />
                  <Stat label={t('gain')} value={r.gainM != null ? formatElevation(r.gainM, locale) : t('unknown')} hint={dGain ? t('vsPlanned', { delta: dGain }) : undefined} />
                  <Stat label={t('moving')} value={r.movingSec != null ? formatDuration(r.movingSec / 60, locale) : t('unknown')} />
                  <Stat label={t('avgSpeed')} value={avg != null ? t('kmh', { v: avg.toFixed(1) }) : t('unknown')} />
                </dl>
                {r.elapsedSec != null && r.movingSec != null && r.elapsedSec - r.movingSec > 300 && (
                  <span className="text-small text-muted-foreground">{t('stops', { total: formatDuration(r.elapsedSec / 60, locale) })}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {reference && rides.length > 1 && (
        <div role="group" aria-label={t('referenceLabel')} className="flex flex-col gap-2">
          <span className="text-small text-muted-foreground">{t('referenceLabel')}</span>
          <div className="flex flex-wrap gap-2">
            {rides.map((r) => (
              <button
                key={r.id}
                type="button"
                aria-pressed={r.id === reference.id}
                disabled={busy}
                onClick={() => void pickReference(r.id)}
                className={cn('min-h-touch rounded-md border px-3 text-small font-medium press', r.id === reference.id ? 'border-primary bg-card' : 'border-border')}
              >
                {r.mine ? t('mine') : r.organizer ? t('organizer') : r.author}
                {!reference.timed[r.id] && <span className="text-muted-foreground"> · {t('untimed')}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {canUpload && (
        <div className="flex flex-col gap-2">
          <input ref={input} type="file" accept=".gpx,.kml,.kmz,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="lg" disabled={busy} onClick={() => input.current?.click()} className="w-full">
            <Upload aria-hidden /> {busy ? t('uploading') : mine ? t('replace') : t('upload')}
          </Button>
          <p className="text-caption text-muted-foreground">{t('hint', { mb: MAX_MB })}</p>
          {mine && (
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(true)} className="w-full">
              <Trash2 aria-hidden /> {t('delete')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('delete')}
        description={t('deleteConfirm')}
        confirmLabel={t('delete')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => void remove()}
      />
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
      {hint && <dd className="text-caption text-muted-foreground">{hint}</dd>}
    </div>
  );
}
