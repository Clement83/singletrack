'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Camera, ChevronLeft, ChevronRight, LoaderCircle, Play, Trash2, TriangleAlert, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { compressImage, readFileDate, readFilePosition } from '@/lib/media/compress';
import { useErrorText } from '@/lib/use-error-text';
import type { PhotoView } from '@/lib/outings/photos';
import type { VideoView } from '@/lib/outings/videos';
import type { TrackGeometry } from '@/lib/geo/types';
import { RideMap } from './ride-map';

type Planned = { geometry: TrackGeometry; bbox: [number, number, number, number] };
type Props = { base: string; photos: PhotoView[]; planned: Planned; canUpload: boolean; videoBase: string; videos: VideoView[] };

const MAX_MB = 10;
/** Short videos (#1693): same limits as the server (`VIDEO_MAX_BYTES`), checked before sending 150 MB for nothing. */
const VIDEO_MAX_MB = 150;
const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mov|mp4|m4v)$/i.test(f.name);
/** Video errors sharing a photo key get their own text. */
const VIDEO_ERR: Record<string, string> = { tooLarge: 'videoTooLarge', tooMany: 'videoTooMany' };
/** `m:ss`. */
export const clipDuration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Outing photos (#1413) and short videos (#1693): upload from the native picker (camera or gallery), gallery, viewer, map. */
export function PhotoSection({ base, photos, planned, canUpload, videoBase, videos }: Props) {
  const t = useTranslations('photos');
  const tc = useTranslations('common');
  const [toDelete, setToDelete] = useState<{ id: string; video: boolean } | null>(null);
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const errText = useErrorText();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const located = photos.filter((p) => p.pos);
  const url = (id: string, thumb = false) => `${base}/${id}${thumb ? '?size=thumb' : ''}`;
  const videoUrl = (id: string, thumb = false) => `${videoBase}/${id}${thumb ? '?size=thumb' : ''}`;
  const pending = videos.some((v) => v.status === 'pending');

  // While a clip is being converted, refresh the server data until it is ready (or failed).
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [pending, router]);

  async function sendVideo(file: File): Promise<string | null> {
    if (file.size > VIDEO_MAX_MB * 1024 * 1024) return 'videoTooLarge';
    const res = await fetch(videoBase, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
    if (res.ok) return null;
    const err: string = (await res.json().catch(() => ({}))).error ?? 'generic';
    return VIDEO_ERR[err] ?? err;
  }

  async function sendOne(file: File): Promise<string | null> {
    if (file.size > MAX_MB * 1024 * 1024 * 3) return 'tooLarge';
    const pos = await readFilePosition(file);
    const taken = await readFileDate(file);
    const blob = await compressImage(file);
    if (blob.size > MAX_MB * 1024 * 1024) return 'tooLarge';
    const body = new FormData();
    body.append('file', blob, 'photo.jpg');
    if (pos) {
      body.append('lat', String(pos.lat));
      body.append('lon', String(pos.lon));
    }
    if (taken) {
      body.append('taken', taken.local);
      if (taken.offset) body.append('takenOffset', taken.offset);
    }
    const res = await fetch(base, { method: 'POST', body });
    return res.ok ? null : ((await res.json().catch(() => ({}))).error ?? 'generic');
  }

  async function upload(files: File[]) {
    let failed: string | null = null;
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      setBusy({ done: i, total: files.length });
      try {
        const err = await (isVideoFile(files[i]) ? sendVideo(files[i]) : sendOne(files[i]));
        if (err) failed = err;
        else ok++;
      } catch {
        failed = 'network';
      }
      if (failed === 'tooManyRequests' || failed === 'closed' || failed === 'tooEarly') break;
    }
    setBusy(null);
    if (input.current) input.current.value = '';
    if (ok) {
      toast.success(t('saved', { n: ok }));
      router.refresh();
    }
    if (failed) toast.error(t.has(`errors.${failed}` as never) ? (t as (k: string, v?: object) => string)(`errors.${failed}`, { mb: MAX_MB }) : errText(failed));
  }

  async function remove({ id, video }: { id: string; video: boolean }) {
    setToDelete(null);
    try {
      const res = await fetch(`${video ? videoBase : base}/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setOpen(null);
        setOpenVideo(null);
        router.refresh();
      } else toast.error(t('errors.generic'));
    } catch {
      toast.error(t('errors.network'));
    }
  }

  if (!canUpload && photos.length === 0 && videos.length === 0) return null;
  const current = open != null ? photos[open] : null;
  const ready = videos.filter((v) => v.status === 'ready');
  const currentVideo = openVideo ? ready.find((v) => v.id === openVideo) ?? null : null;

  return (
    <section aria-label={t('title')} className="flex flex-col gap-3">
      <h2 className="text-heading">{t('title')}</h2>
      {photos.length === 0 && videos.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}

      {photos.length + videos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(i)} aria-label={t('open', { n: i + 1, total: photos.length, author: p.author || t('organizer') })} className="block aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-sm active:opacity-80">
                {/* eslint-disable-next-line @next/next/no-img-element -- private file served by our API, already shrunk */}
                <img src={url(p.id, true)} alt="" loading="lazy" decoding="async" width={240} height={240} className="size-full object-cover" />
              </button>
            </li>
          ))}
          {videos.map((v) => (
            <li key={v.id}>
              <VideoTile
                video={v}
                thumb={videoUrl(v.id, true)}
                label={t('videoOpen', { n: ready.indexOf(v) + 1, total: ready.length, author: v.author || t('organizer'), duration: clipDuration(v.durationMs) })}
                onOpen={() => setOpenVideo(v.id)}
                onDelete={v.canDelete ? () => setToDelete({ id: v.id, video: true }) : undefined}
              />
            </li>
          ))}
        </ul>
      )}

      {located.length > 0 && (
        <RideMap
          label={t('mapLabel')}
          planned={planned.geometry}
          ride={null}
          bbox={located.reduce((b, p) => [Math.min(b[0], p.pos!.lon), Math.min(b[1], p.pos!.lat), Math.max(b[2], p.pos!.lon), Math.max(b[3], p.pos!.lat)] as [number, number, number, number], [...planned.bbox] as [number, number, number, number])}
          photos={located.map((p) => ({ id: p.id, lat: p.pos!.lat, lon: p.pos!.lon }))}
          photoLabel={t('onMap')}
          onPhoto={(id) => setOpen(photos.findIndex((p) => p.id === id))}
        />
      )}

      {canUpload && (
        <div className="flex flex-col gap-2">
          <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,.mov,.mp4" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => e.target.files?.length && upload([...e.target.files])} />
          <Button size="lg" disabled={!!busy} onClick={() => input.current?.click()} className="w-full">
            <Camera aria-hidden /> {busy ? t('uploading', { done: busy.done + 1, total: busy.total }) : t('add')}
          </Button>
          <p className="text-caption text-muted-foreground">{t('hint')}</p>
        </div>
      )}

      {current && open != null && <Viewer photo={current} index={open} total={photos.length} src={url(current.id)} onClose={() => setOpen(null)} onMove={(d) => setOpen((o) => (o == null ? o : (o + d + photos.length) % photos.length))} onDelete={current.canDelete ? () => setToDelete({ id: current.id, video: false }) : undefined} />}
      {currentVideo && <VideoViewer video={currentVideo} src={videoUrl(currentVideo.id)} poster={videoUrl(currentVideo.id, true)} onClose={() => setOpenVideo(null)} onDelete={currentVideo.canDelete ? () => setToDelete({ id: currentVideo.id, video: true }) : undefined} />}
      <ConfirmDialog
        open={toDelete != null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={toDelete?.video ? t('videoDelete') : t('delete')}
        description={toDelete?.video ? t('videoDeleteConfirm') : t('deleteConfirm')}
        confirmLabel={toDelete?.video ? t('videoDelete') : t('delete')}
        cancelLabel={tc('cancel')}
        onConfirm={() => toDelete && void remove(toDelete)}
      />
    </section>
  );
}

function Viewer({ photo, index, total, src, onClose, onMove, onDelete }: { photo: PhotoView; index: number; total: number; src: string; onClose: () => void; onMove: (d: number) => void; onDelete?: () => void }) {
  const t = useTranslations('photos');
  const close = useRef<HTMLButtonElement>(null);
  const touch = useRef<number | null>(null);
  const key = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') onMove(-1);
    else if (e.key === 'ArrowRight') onMove(1);
  }, [onClose, onMove]);
  useEffect(() => {
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [key]);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('viewer')} className="fixed inset-0 z-50 flex flex-col bg-foreground/95 text-background" onTouchStart={(e) => { touch.current = e.touches[0].clientX; }} onTouchEnd={(e) => {
      const d = touch.current == null ? 0 : e.changedTouches[0].clientX - touch.current;
      touch.current = null;
      if (Math.abs(d) > 60) onMove(d > 0 ? -1 : 1);
    }}>
      <div className="flex min-h-touch items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)]">
        <span className="min-w-0 truncate text-small tabular-nums">{t('counter', { n: index + 1, total })} · {photo.author || t('organizer')}</span>
        <div className="flex gap-1">
          {onDelete && <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={onDelete} className="text-background"><Trash2 aria-hidden /></Button>}
          <Button ref={close} variant="ghost" size="icon" aria-label={t('close')} onClick={onClose} className="text-background"><X aria-hidden /></Button>
        </div>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overscroll-contain p-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- private file served by our API */}
        <img src={src} alt={t('alt', { author: photo.author || t('organizer') })} width={photo.width} height={photo.height} className="max-h-full max-w-full rounded-2xl object-contain" />
        {total > 1 && (
          <>
            <Button variant="ghost" size="icon" aria-label={t('prev')} onClick={() => onMove(-1)} className="absolute left-1 text-background max-sm:hidden"><ChevronLeft aria-hidden /></Button>
            <Button variant="ghost" size="icon" aria-label={t('next')} onClick={() => onMove(1)} className="absolute right-1 text-background max-sm:hidden"><ChevronRight aria-hidden /></Button>
          </>
        )}
      </div>
      <div className="pb-[env(safe-area-inset-bottom)]" />
    </div>
  );
}

/** Gallery tile of a video: thumbnail + play badge + length when ready; a muted tile while converting or after a failure. */
function VideoTile({ video, thumb, label, onOpen, onDelete }: { video: VideoView; thumb: string; label: string; onOpen: () => void; onDelete?: () => void }) {
  const t = useTranslations('photos');
  if (video.status !== 'ready') {
    const failed = video.status === 'failed';
    return (
      <div className="relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-muted p-2 text-center text-caption text-muted-foreground">
        {failed ? <TriangleAlert aria-hidden className="size-[18px]" /> : <LoaderCircle aria-hidden className="size-[18px] animate-spin motion-reduce:animate-none" />}
        <span role="status">{failed ? t('videoFailed') : t('videoPending')}</span>
        {failed && onDelete && (
          <Button variant="ghost" size="icon" aria-label={t('videoDelete')} onClick={onDelete} className="absolute right-0 top-0"><Trash2 aria-hidden /></Button>
        )}
      </div>
    );
  }
  return (
    <button type="button" onClick={onOpen} aria-label={label} className="press relative block aspect-square w-full overflow-hidden rounded-2xl border border-border bg-muted shadow-sm active:opacity-80">
      {/* eslint-disable-next-line @next/next/no-img-element -- private file served by our API, already shrunk */}
      <img src={thumb} alt="" loading="lazy" decoding="async" width={240} height={240} className="size-full object-cover" />
      <span aria-hidden className="absolute bottom-1 left-1 flex items-center gap-1 rounded-md bg-foreground/70 px-1.5 py-0.5 text-caption tabular-nums text-background">
        <Play className="size-3 fill-current" /> {clipDuration(video.durationMs)}
      </span>
    </button>
  );
}

/** Inline playback: native controls, `playsInline` (no forced full screen on iOS), never autoplay with sound. */
function VideoViewer({ video, src, poster, onClose, onDelete }: { video: VideoView; src: string; poster: string; onClose: () => void; onDelete?: () => void }) {
  const t = useTranslations('photos');
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label={t('videoViewer')} className="fixed inset-0 z-50 flex flex-col bg-foreground/95 text-background">
      <div className="flex min-h-touch items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)]">
        <span className="min-w-0 truncate text-small tabular-nums">{clipDuration(video.durationMs)} · {video.author || t('organizer')}</span>
        <div className="flex gap-1">
          {onDelete && <Button variant="ghost" size="icon" aria-label={t('videoDelete')} onClick={onDelete} className="text-background"><Trash2 aria-hidden /></Button>}
          <Button ref={close} variant="ghost" size="icon" aria-label={t('close')} onClick={onClose} className="text-background"><X aria-hidden /></Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-2">
        <video src={src} poster={poster} controls playsInline preload="metadata" width={video.width} height={video.height} aria-label={t('videoAlt', { author: video.author || t('organizer') })} className="max-h-full max-w-full rounded-2xl bg-foreground object-contain" />
      </div>
      <div className="pb-[env(safe-area-inset-bottom)]" />
    </div>
  );
}
