'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { useErrorText } from '@/lib/use-error-text';

/** Server block list (#1477): entry, CSV import (Mastodon format), unblocking. */
export function AdminBlocks({ blocks }: { blocks: { domain: string; reason: string | null; source: 'admin' | 'import' }[] }) {
  const t = useTranslations('moderation.admin');
  const errText = useErrorText();
  const router = useRouter();
  const [domain, setDomain] = useState('');
  const [reason, setReason] = useState('');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);

  async function call(method: 'POST' | 'DELETE', body: unknown) {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/federation/blocks', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.error)); return null; }
      router.refresh();
      return data;
    } catch {
      toast.error(errText('unknown'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={async (e) => { e.preventDefault(); if (await call('POST', { domain, reason })) { setDomain(''); setReason(''); toast.success(t('blocked')); } }}>
        <Field label={t('domain')} hint={t('domainHint')}>
          {(p) => <Input {...p} type="text" inputMode="url" autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={t('domainPlaceholder')} value={domain} onChange={(e) => setDomain(e.target.value)} required />}
        </Field>
        <Field label={t('reason')}>
          {(p) => <Input {...p} type="text" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <Button type="submit" disabled={busy || !domain.trim()}>{t('block')}</Button>
      </form>

      <ul className="flex flex-col gap-3" aria-label={t('listLabel')}>
        {blocks.length === 0 && <li className="text-muted-foreground">{t('none')}</li>}
        {blocks.map((b) => (
          <li key={b.domain} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="text-heading break-all">{b.domain}</p>
              <p className="text-small text-muted-foreground">{b.source === 'import' ? t('fromImport') : t('fromAdmin')}{b.reason ? ` · ${b.reason}` : ''}</p>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => call('DELETE', { domain: b.domain })}>{t('unblock')}</Button>
          </li>
        ))}
      </ul>

      <form className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await call('POST', { csv });
          if (r) { setCsv(''); toast.success(t('imported', { added: r.added, skipped: r.skipped })); }
        }}>
        <Field label={t('importLabel')} hint={t('importHint')}>
          {(p) => <Textarea {...p} spellCheck={false} placeholder={t('csvPlaceholder')} value={csv} onChange={(e) => setCsv(e.target.value)} required />}
        </Field>
        <Button type="submit" variant="outline" disabled={busy || !csv.trim()}>{t('import')}</Button>
      </form>
    </div>
  );
}
