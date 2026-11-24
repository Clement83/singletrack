'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input } from '@/components/ui/field';
import { useErrorText } from '@/lib/use-error-text';

type Region = { id: string; name: string; bbox: number[]; enabled: boolean; sizeBytes: number | null; version: string | null; builtAt: string | null; segments: string[]; built: boolean };

/** Offline packs admin (#1738): master switch, regions list (enable, delete), registration of a region to build. */
export function AdminOffline({ lastRefresh, envEnabled, switchOn, freeBytes, regions, catalog, usage }: {
  lastRefresh: { at: string; ok: boolean; regions: { status: string }[]; segments: { status: string }[] } | null;
  usage: { userId: string; name: string; email: string; bytes: number; requests: number; last: string | null }[];
  envEnabled: boolean; switchOn: boolean; freeBytes: number | null; regions: Region[]; catalog: { id: string; name: string }[];
}) {
  const t = useTranslations('admin.offline');
  const tc = useTranslations('common');
  const errText = useErrorText();
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [bbox, setBbox] = useState('');
  const [toDelete, setToDelete] = useState<Region | null>(null);
  const mb = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'Europe/Paris' });
  const size = (n: number) => t('mb', { n: mb.format(n / 1e6) });

  async function call(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/offline', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.error)); return false; }
      router.refresh();
      return true;
    } catch { toast.error(errText('unknown')); return false; } finally { setBusy(false); }
  }

  const known = new Set(regions.map((r) => r.id));
  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('switchTitle')} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-heading">{t('switchTitle')}</h2>
        {!envEnabled && <p className="text-small text-muted-foreground">{t('envOff')}</p>}
        <div className="flex items-center justify-between gap-3">
          <span>{switchOn ? t('switchOn') : t('switchOff')}</span>
          <Button variant="outline" disabled={busy} onClick={() => call('PATCH', { switch: !switchOn })}>{switchOn ? t('turnOff') : t('turnOn')}</Button>
        </div>
        {freeBytes != null && <p className="text-small text-muted-foreground">{t('free', { size: size(freeBytes) })}</p>}
      </section>

      <section aria-label={t('refresh')} className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-heading">{t('refresh')}</h2>
        {lastRefresh ? (() => {
          const all = [...lastRefresh.regions, ...lastRefresh.segments];
          const v = { date: date.format(new Date(lastRefresh.at)), updated: all.filter((x) => x.status === 'updated').length, failed: all.filter((x) => x.status === 'failed').length };
          return <p className="text-small text-muted-foreground">{lastRefresh.ok ? t('refreshOk', v) : t('refreshKo', v)}</p>;
        })() : <p className="text-small text-muted-foreground">{t('refreshNone')}</p>}
      </section>

      <section aria-label={t('usage')} className="flex flex-col gap-3">
        <h2 className="text-heading">{t('usage')}</h2>
        <ul className="flex flex-col gap-2">
          {usage.length === 0 && <li className="text-muted-foreground">{t('usageNone')}</li>}
          {usage.map((u) => (
            <li key={u.userId} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="min-w-0 truncate">{u.name || u.email}</span>
              <span className="shrink-0 text-small text-muted-foreground">{t('usageRow', { size: size(u.bytes), n: u.requests })}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('regions')} className="flex flex-col gap-3">
        <h2 className="text-heading">{t('regions')}</h2>
        <ul className="flex flex-col gap-3">
          {regions.length === 0 && <li className="text-muted-foreground">{t('none')}</li>}
          {regions.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
              <p className="text-heading">{r.name}</p>
              <p className="text-small text-muted-foreground">
                {r.built ? `${size(r.sizeBytes ?? 0)} · ${r.builtAt ? date.format(new Date(r.builtAt)) : ''} · ${r.version ?? ''}` : t('notBuilt')}
              </p>
              <p className="text-small text-muted-foreground">{t('segments')} {r.segments.join(', ')}</p>
              {!r.built && <code className="break-all text-small">{`docker compose run --rm tools npm run offline:build -- ${r.id}`}</code>}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={busy || (!r.built && !r.enabled)} onClick={() => call('PATCH', { id: r.id, enabled: !r.enabled })}>{r.enabled ? t('disable') : t('enable')}</Button>
                <Button variant="outline" disabled={busy} onClick={() => setToDelete(r)}>{t('delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={t('add')} className="flex flex-col gap-3">
        <h2 className="text-heading">{t('add')}</h2>
        <div className="flex flex-wrap gap-2">
          {catalog.filter((c) => !known.has(c.id)).map((c) => (
            <Button key={c.id} variant="outline" disabled={busy} onClick={() => call('POST', { catalog: c.id })}>{c.name}</Button>
          ))}
        </div>
        <form className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
          onSubmit={async (e) => { e.preventDefault(); if (await call('POST', { name, bbox })) { setName(''); setBbox(''); } }}>
          <Field label={t('customName')}>{(p) => <Input {...p} type="text" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
          <Field label={t('customBbox')} hint={t('customBboxHint')}>{(p) => <Input {...p} type="text" autoComplete="off" spellCheck={false} placeholder="4.2,43.0,7.7,45.1" value={bbox} onChange={(e) => setBbox(e.target.value)} required />}</Field>
          <Button type="submit" disabled={busy || !name.trim() || !bbox.trim()}>{t('addCustom')}</Button>
        </form>
      </section>

      <ConfirmDialog
        open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title={t('delete')} description={t('confirmDelete', { name: toDelete?.name ?? '' })}
        confirmLabel={t('delete')} cancelLabel={tc('cancel')} busy={busy}
        onConfirm={async () => { if (toDelete && await call('DELETE', { id: toDelete.id })) setToDelete(null); }}
      />
      <p className="text-small text-muted-foreground">{t('attribution')}</p>
    </div>
  );
}
