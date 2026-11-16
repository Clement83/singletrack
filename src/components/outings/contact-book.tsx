'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, ArchiveRestore, Check, Pencil, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { useErrorText } from '@/lib/use-error-text';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect } from '@/components/ui/field';

export type BookEntry = { id: string; name: string; note: string | null; outings: number; lastOutingAt: string | null; userId: string | null; remoteActorId?: string | null };
type Props = { contacts: BookEntry[]; archived: BookEntry[]; friends: { userId: string | null; remoteActorId: string | null; name: string; domain: string | null }[] };
/** Valeur d'option : `u:<compte>` (copain local) ou `r:<acteur>` (copain d'un autre serveur, #1475). */
const optionKey = (f: { userId: string | null; remoteActorId: string | null }) => (f.userId ? `u:${f.userId}` : `r:${f.remoteActorId}`);

/** Écran de gestion du carnet de potes (#1359) : ajouter, renommer, annoter, archiver, historique. */
export function ContactBook({ contacts, archived, friends }: Props) {
  const t = useTranslations('contacts');
  const locale = useLocale();
  const errText = useErrorText();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: '', note: '' });

  async function call(url: string, method: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(errText(data.errors ? Object.values(data.errors)[0] : data.error));
      else router.refresh();
      return res.ok;
    } catch {
      toast.error(errText('network'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const history = (c: BookEntry) =>
    c.outings === 0
      ? t('neverInvited')
      : t('history', { n: c.outings, date: new Date(c.lastOutingAt!).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' }) });

  function row(c: BookEntry, isArchived: boolean) {
    const open = editing === c.id;
    return (
      <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {open ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(`/api/contacts/${c.id}`, 'PATCH', { name: draft.name, note: draft.note })) setEditing(null);
            }}
          >
            <Field label={t('name')}>{(p) => <Input {...p} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} autoComplete="off" required />}</Field>
            <Field label={t('note')} hint={t('noteHint')}>{(p) => <Input {...p} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={80} autoComplete="off" />}</Field>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setEditing(null)}>{t('cancel')}</Button>
              <Button type="submit" className="flex-1" disabled={busy || !draft.name.trim()}><Check aria-hidden /> {t('save')}</Button>
            </div>
          </form>
        ) : (
          <>
            <div className="min-w-0">
              <p className="text-heading truncate">{c.name}</p>
              {c.note && <p className="text-small text-muted-foreground">{c.note}</p>}
              <p className="text-small text-muted-foreground tabular-nums">{history(c)}</p>
              {!isArchived && friends.length > 0 && (
                <Field label={t('linkLabel')} className="mt-2">
                  {(p) => (
                    <NativeSelect
                      {...p} value={c.userId ? `u:${c.userId}` : c.remoteActorId ? `r:${c.remoteActorId}` : ''} disabled={busy}
                      onChange={(e) => call(`/api/contacts/${c.id}/link`, 'PUT', e.target.value.startsWith('r:') ? { remoteActorId: e.target.value.slice(2) } : { userId: e.target.value.slice(2) || null })}
                    >
                      <option value="">{t('linkNone')}</option>
                      {friends.map((f) => <option key={optionKey(f)} value={optionKey(f)}>{f.domain ? `${f.name} · ${f.domain}` : f.name}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              )}
            </div>
            <div className="flex gap-2">
              {!isArchived && (
                <Button variant="secondary" className="flex-1" onClick={() => { setEditing(c.id); setDraft({ name: c.name, note: c.note ?? '' }); }}><Pencil aria-hidden /> {t('edit')}</Button>
              )}
              <Button variant={isArchived ? 'secondary' : 'ghost'} className="flex-1" disabled={busy} onClick={() => call(`/api/contacts/${c.id}`, 'PATCH', { archived: !isArchived })}>
                {isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} {isArchived ? t('restore') : t('archive')}
              </Button>
            </div>
          </>
        )}
      </li>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Button asChild variant="secondary" size="lg"><Link href="/copains"><Users aria-hidden /> {t('friends')}</Link></Button>
      <form
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={async (e) => { e.preventDefault(); if (await call('/api/contacts', 'POST', { name })) setName(''); }}
      >
        <Field label={t('addLabel')}>{(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />}</Field>
        <Button type="submit" size="lg" disabled={busy || !name.trim()}><UserPlus aria-hidden /> {t('add')}</Button>
      </form>
      {contacts.length === 0 ? <p className="text-muted-foreground">{t('empty')}</p> : <ul className="flex flex-col gap-3">{contacts.map((c) => row(c, false))}</ul>}
      {archived.length > 0 && (
        <section aria-label={t('archived')} className="flex flex-col gap-3">
          <h2 className="text-heading">{t('archived')}</h2>
          <ul className="flex flex-col gap-3">{archived.map((c) => row(c, true))}</ul>
        </section>
      )}
    </div>
  );
}
