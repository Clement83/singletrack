'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { linkify } from '@/lib/outings/linkify';
import { cn } from '@/lib/utils';

type Comment = {
  id: string; author: string; organizer: boolean; body: string; createdAt: string;
  edited: boolean; mine: boolean; canEdit: boolean; canDelete: boolean;
};

const MAX = 1000;
const POLL_MS = 45_000;

/** Texte brut avec liens cliquables : React échappe tout, aucun HTML n'est interprété. */
function Body({ text }: { text: string }) {
  return (
    <p className="break-words whitespace-pre-line text-body">
      {linkify(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="font-semibold text-primary underline underline-offset-4 active:opacity-70">{p.text}</a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * Fil de discussion d'une sortie (#1358). `base` = `/api/i/<token>/comments` (invité, identité = lien perso)
 * ou `/api/outings/<slug>/comments` (organisateur). Actualisation par sondage léger + au retour sur l'onglet (`live`, coupé dans le sheet de la vue de sortie, #1622).
 */
export function OutingComments({ base, closed, live = true, bare = false }: { base: string; closed: boolean; live?: boolean; bare?: boolean }) {
  const t = useTranslations('comments');
  const locale = useLocale();
  const [items, setItems] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const endRef = useRef<HTMLLIElement>(null);
  const count = useRef(0);

  const errorText = useCallback((code: unknown) => (typeof code === 'string' && t.has(`errors.${code}` as never) ? t(`errors.${code}` as never) : t('errors.generic')), [t]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' });
      if (res.ok) setItems(((await res.json()) as { comments: Comment[] }).comments);
    } catch {
      /* hors ligne : on garde l'affichage courant */
    }
  }, [base]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- chargement initial
    void load();
    if (!live) return;
    const tick = () => { if (document.visibilityState === 'visible') void load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [load, live]);

  // Un nouveau message que j'ai envoyé ramène le dernier message à l'écran.
  useEffect(() => {
    if (items && items.length > count.current && count.current > 0) endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (items) count.current = items.length;
  }, [items]);

  async function call(url: string, method: string, body?: unknown): Promise<boolean> {
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (res.ok) return true;
      const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
      toast.error(errorText(data.errors?.body ?? data.error));
    } catch {
      toast.error(t('errors.network'));
    }
    return false;
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !text.trim()) return;
    setBusy(true);
    if (await call(base, 'POST', { body: text })) { setText(''); await load(); }
    setBusy(false);
  }

  async function saveEdit() {
    if (!editing) return;
    if (await call(`${base}/${editing.id}`, 'PATCH', { body: editing.text })) { setEditing(null); await load(); }
  }

  async function remove(id: string) {
    setConfirming(null);
    if (await call(`${base}/${id}`, 'DELETE')) await load();
  }

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

  return (
    <section aria-label={t('title')} className="flex flex-col gap-3">
      {!bare && <h2 className="text-heading">{t('title')}</h2>}
      {items && items.length === 0 && <p className="text-muted-foreground">{t('empty')}</p>}
      {items === null && <div aria-hidden className="h-16 animate-pulse rounded-2xl bg-muted" />}
      <ul aria-label={t('list')} aria-live="polite" className="flex flex-col gap-2">
        {items?.map((c) => (
          <li key={c.id} className={cn('flex flex-col gap-1 rounded-2xl border border-border p-3 shadow-sm', c.mine ? 'bg-accent' : 'bg-card')}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">
                {c.mine ? t('you') : c.organizer ? t('organizer') : c.author}
              </span>
              <time dateTime={c.createdAt} className="shrink-0 text-caption text-muted-foreground">
                {when(c.createdAt)}{c.edited ? ` · ${t('edited')}` : ''}
              </time>
            </div>
            {editing?.id === c.id ? (
              <div className="flex flex-col gap-2">
                <Textarea aria-label={t('label')} value={editing.text} maxLength={MAX} rows={3} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
                <div className="flex gap-2">
                  <Button onClick={saveEdit} disabled={!editing.text.trim()}>{t('save')}</Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Button>
                </div>
              </div>
            ) : (
              <Body text={c.body} />
            )}
            {editing?.id !== c.id && (c.canEdit || c.canDelete) && (
              confirming === c.id ? (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('deleteConfirm')}>
                  <span className="text-small">{t('deleteConfirm')}</span>
                  <Button variant="destructive" onClick={() => remove(c.id)}>{t('delete')}</Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>{t('cancel')}</Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  {c.canEdit && <Button variant="ghost" className="text-small" onClick={() => setEditing({ id: c.id, text: c.body })}>{t('edit')}</Button>}
                  {c.canDelete && (
                    <Button variant="ghost" className="text-small" onClick={() => setConfirming(c.id)} aria-label={c.mine ? t('delete') : t('moderate', { name: c.organizer ? t('organizer') : c.author })}>{t('delete')}</Button>
                  )}
                </div>
              )
            )}
          </li>
        ))}
        <li ref={endRef} aria-hidden className="h-0" />
      </ul>
      {closed ? (
        <p className="text-small text-muted-foreground">{t('closedNote')}</p>
      ) : (
        <form onSubmit={send} className="sticky bottom-0 z-10 -mx-4 flex items-end gap-2 border-t border-border bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Textarea aria-label={t('label')} name="comment" autoComplete="off" value={text} maxLength={MAX} rows={1} placeholder={t('placeholder')} className="min-h-touch resize-none" onChange={(e) => setText(e.target.value)} />
            {text.length > MAX - 100 && <span className="text-caption text-muted-foreground">{t('remaining', { n: MAX - text.length })}</span>}
          </div>
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label={busy ? t('sending') : t('send')}><Send aria-hidden /></Button>
        </form>
      )}
    </section>
  );
}
