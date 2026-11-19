'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { useErrorText } from '@/lib/use-error-text';
import { formatElevation, formatKm } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { TrackVisibilityChips, type TrackVisibilityValue } from './track-visibility';
import { IMPORT_ORIGINS } from '@/lib/tracks/import-origins';
import type { TrackGeometry } from '@/lib/geo/types';

type Item = {
  key: string;
  file: string;
  name: string;
  description: string;
  origin: string;
  sourceUrl: string | null;
  author: string | null;
  geometry: TrackGeometry;
  hasElevation: boolean;
  stats: { distanceKm: number; gainM: number | null; loop: boolean };
  duplicates: { slug: string; name: string; distanceKm: number }[];
};
type Errs = Partial<Record<string, string>>;
/** Exemple d'adresse, identique dans toutes les langues. */
const URL_PLACEHOLDER = 'https://…';

function ItemForm({ item, onSaved, defaultVisibility }: { item: Item; onSaved: (slug: string) => void; defaultVisibility: TrackVisibilityValue }) {
  const t = useTranslations('importer');
  const locale = useLocale();
  const errText = useErrorText();
  const [v, setV] = useState({
    name: item.name, description: item.description, origin: item.origin,
    sourceUrl: item.sourceUrl ?? '', author: item.author ?? '', license: '',
  });
  const [visibility, setVisibility] = useState<TrackVisibilityValue>(defaultVisibility);
  const [errors, setErrors] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));
  const external = v.origin !== 'perso';

  async function save() {
    setBusy(true);
    try {
      const r = await fetch('/api/tracks/import', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...v, visibility, geometry: item.geometry }),
      });
      const j = await r.json();
      if (r.status === 422) return setErrors(j.errors);
      if (!r.ok) throw new Error(j.error ?? 'unknown');
      setSlug(j.slug);
      onSaved(j.slug);
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (slug)
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-success-soft p-4 shadow-sm">
        <p className="flex items-center gap-2 font-semibold"><CheckCircle2 aria-hidden className="size-5 text-success" />{t('savedTitle', { name: v.name })}</p>
        <Button asChild size="lg"><Link href={`/t/${slug}`}>{t('seeTrack')}</Link></Button>
      </div>
    );

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <p className="text-small text-muted-foreground">
        {[item.file, formatKm(item.stats.distanceKm, locale), item.stats.gainM !== null && formatElevation(item.stats.gainM, locale), item.stats.loop && t('loop')]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {!item.hasElevation && <p className="text-small text-muted-foreground">{t('noEle')}</p>}
      {item.duplicates.length > 0 && (
        <div role="status" className="flex gap-2 rounded-lg bg-warning-soft p-3 text-small">
          <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <p>
            {t.rich('duplicates', {
              links: () =>
                item.duplicates.map((d, i) => (
                  <span key={d.slug}>{i > 0 && ', '}<Link href={`/t/${d.slug}`} className="font-semibold underline hover:opacity-80 active:opacity-70">{d.name}</Link></span>
                )),
            })}
          </p>
        </div>
      )}
      <Field label={t('name')} error={errors.name && errText(errors.name)}>{(c) => <Input {...c} value={v.name} onChange={set('name')} />}</Field>
      <Field label={t('description')}>{(c) => <Textarea {...c} value={v.description} onChange={set('description')} />}</Field>
      <Field label={t('origin')} error={errors.origin && errText(errors.origin)}>
        {(c) => (
          <NativeSelect {...c} value={v.origin} onChange={set('origin')}>
            {IMPORT_ORIGINS.map((o) => <option key={o.id} value={o.id}>{o.id === 'perso' || o.id === 'autre' ? t(`origins.${o.id}`) : o.label}</option>)}
          </NativeSelect>
        )}
      </Field>
      {external && (
        <>
          <Field label={t('sourceUrl')} error={errors.sourceUrl && errText(errors.sourceUrl)} hint={t('sourceUrlHint')}>
            {(c) => <Input {...c} type="url" inputMode="url" placeholder={URL_PLACEHOLDER} value={v.sourceUrl} onChange={set('sourceUrl')} />}
          </Field>
          <Field label={t('author')} error={errors.author && errText(errors.author)}>{(c) => <Input {...c} value={v.author} onChange={set('author')} />}</Field>
          <Field label={t('license')} error={errors.license && errText(errors.license)} hint={t('licenseHint')}>
            {(c) => <Input {...c} value={v.license} onChange={set('license')} />}
          </Field>
        </>
      )}
      <TrackVisibilityChips value={visibility} onChange={setVisibility} hint={t('visibilityHint')} />
      {errors.visibility && <p role="alert" className="text-small text-destructive">{errText(errors.visibility)}</p>}
      {errors.geometry && <p role="alert" className="text-small text-destructive">{errText(errors.geometry)}</p>}
      <Button type="submit" size="lg" disabled={busy}>{busy ? t('saving') : t('submit')}</Button>
    </form>
  );
}

export function GpxImporter({ defaultVisibility }: { defaultVisibility: TrackVisibilityValue }) {
  const t = useTranslations('importer');
  const errText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [fileErrors, setFileErrors] = useState<{ file: string; error: string }[]>([]);

  async function analyse(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setBusy(true);
    setFileErrors([]);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const r = await fetch('/api/tracks/import', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) return toast.error(errText(j.error, { max: j.max ?? 10 }));
      setItems(j.items);
      setFileErrors(j.errors);
    } catch {
      toast.error(t('analyseFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void analyse(e.dataTransfer.files); }}
        className={cn('flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-input bg-card p-6 text-center transition-colors duration-150', over && 'border-primary bg-accent')}
      >
        <FileUp aria-hidden className="size-8 text-muted-foreground" />
        <p className="text-muted-foreground">{t('drop')}</p>
        <input ref={input} type="file" accept=".gpx,.kml,.kmz,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" multiple hidden onChange={(e) => e.target.files && void analyse(e.target.files)} />
        <Button size="lg" onClick={() => input.current?.click()} disabled={busy}>{busy ? t('analysing') : t('choose')}</Button>
      </div>
      {busy && <Skeleton className="h-40 rounded-2xl" />}
      {fileErrors.map((e) => (
        <p key={e.file} role="alert" className="rounded-lg bg-destructive-soft p-3 text-small text-destructive"><strong>{e.file}</strong> — {errText(e.error)}</p>
      ))}
      {items.map((it) => <ItemForm key={it.key} item={it} onSaved={() => undefined} defaultVisibility={defaultVisibility} />)}
    </div>
  );
}
