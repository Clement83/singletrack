'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MusicTrack } from '@/lib/outings/music';
import { cn } from '@/lib/utils';
import { exportFilm, ExportUnsupported, type ExportFormat, type ExportInput } from './export-film';

type Props = {
  /** Everything but the music URL, built lazily (the film is only unrolled when the export starts). */
  input: () => Omit<ExportInput, 'musicUrl'>;
  music: MusicTrack[];
  musicBase: string;
  fileName: string;
  onClose: () => void;
};
type State = { step: 'options' } | { step: 'running'; p: number } | { step: 'done'; url: string; blob: Blob } | { step: 'error'; unsupported: boolean };

const RANDOM = 'random';
const NONE = 'none';

/** "Export video" panel of the summary player (#1707): format, music, progress, download / share. */
export function SummaryExport({ input, music, musicBase, fileName, onClose }: Props) {
  const t = useTranslations('summary.export');
  const [format, setFormat] = useState<ExportFormat>('landscape');
  const [track, setTrack] = useState<string>(RANDOM);
  const [state, setState] = useState<State>({ step: 'options' });
  const ctl = useRef<AbortController | null>(null);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => { first.current?.focus({ preventScroll: true }); }, [state.step]);
  // Leaving the player stops the render and frees the file.
  useEffect(() => () => ctl.current?.abort(), []);
  const doneUrl = state.step === 'done' ? state.url : null;
  useEffect(() => () => { if (doneUrl) URL.revokeObjectURL(doneUrl); }, [doneUrl]);

  async function run() {
    const ac = new AbortController();
    ctl.current = ac;
    setState({ step: 'running', p: 0 });
    const id = track === NONE || music.length === 0 ? null : track === RANDOM ? music[Math.floor(Math.random() * music.length)].id : Number(track);
    try {
      const blob = await exportFilm(
        { ...input(), musicUrl: id == null ? null : `${musicBase}/${id}` },
        { format, signal: ac.signal, onProgress: (p) => setState((s) => (s.step === 'running' ? { step: 'running', p } : s)) },
      );
      setState({ step: 'done', blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      if (ac.signal.aborted) setState({ step: 'options' });
      else {
        console.error('[Export] failed', e);
        setState({ step: 'error', unsupported: e instanceof ExportUnsupported });
      }
    } finally {
      if (ctl.current === ac) ctl.current = null;
    }
  }

  const file = state.step === 'done' ? new File([state.blob], fileName, { type: 'video/mp4' }) : null;
  const canShare = !!file && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] });
  const chip = (on: boolean) => cn('flex-1', on && 'ring-2 ring-ring');

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-scrim p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="summary-export-title" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl bg-card p-4 text-card-foreground shadow-sheet" data-testid="summary-export">
        <h2 id="summary-export-title" className="text-heading">{t('title')}</h2>

        {state.step === 'options' && (
          <>
            <div role="group" aria-label={t('format')} className="flex gap-2">
              <Button ref={first} variant={format === 'landscape' ? 'primary' : 'outline'} aria-pressed={format === 'landscape'} className={chip(format === 'landscape')} onClick={() => setFormat('landscape')}>{t('landscape')}</Button>
              <Button variant={format === 'portrait' ? 'primary' : 'outline'} aria-pressed={format === 'portrait'} className={chip(format === 'portrait')} onClick={() => setFormat('portrait')} data-testid="summary-export-portrait">{t('portrait')}</Button>
            </div>
            {music.length > 0 && (
              <label className="flex flex-col gap-1.5 text-body">
                <span className="font-medium">{t('music')}</span>
                <select value={track} onChange={(e) => setTrack(e.target.value)} className="min-h-touch rounded-md border border-input bg-background px-3 text-foreground">
                  <option value={RANDOM}>{t('musicRandom')}</option>
                  {music.map((m) => <option key={m.id} value={String(m.id)}>{m.title}</option>)}
                  <option value={NONE}>{t('musicNone')}</option>
                </select>
              </label>
            )}
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => void run()} data-testid="summary-export-run">{t('create')}</Button>
              <Button size="lg" variant="outline" onClick={onClose}>{t('close')}</Button>
            </div>
          </>
        )}

        {state.step === 'running' && (
          <>
            <div role="progressbar" aria-label={t('title')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.p * 100)} className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(state.p * 100)}%` }} />
            </div>
            <p className="text-body tabular-nums" aria-live="polite" data-testid="summary-export-progress">{t('progress', { pct: Math.round(state.p * 100) })}</p>
            <Button ref={first} size="lg" variant="outline" onClick={() => ctl.current?.abort()}>{t('stop')}</Button>
          </>
        )}

        {state.step === 'done' && (
          <div className="flex flex-col gap-2">
            <Button asChild size="lg">
              <a ref={first as never} href={state.url} download={fileName} data-testid="summary-export-download"><Download aria-hidden /> {t('download')}</a>
            </Button>
            {canShare && (
              <Button size="lg" variant="outline" onClick={() => void navigator.share({ files: [file!] }).catch(() => undefined)}>
                <Share2 aria-hidden /> {t('share')}
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={onClose}>{t('close')}</Button>
          </div>
        )}

        {state.step === 'error' && (
          <>
            <p role="alert" className="text-body text-destructive">{state.unsupported ? t('unsupported') : t('error')}</p>
            <div className="flex flex-col gap-2">
              {!state.unsupported && <Button ref={first} size="lg" onClick={() => void run()}>{t('retry')}</Button>}
              <Button size="lg" variant="outline" onClick={onClose}>{t('close')}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
