'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, CopyPlus, DoorOpen, Link2, Pencil, RefreshCw, Share2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useErrorText } from '@/lib/use-error-text';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { ActionSheet } from '@/components/ui/action-sheet';
import { RsvpBadge } from '@/components/ui/badge';
import type { Rsvp } from '@/lib/design/scales';

type Inv = { id: string; contactId: string | null; name: string; status: Rsvp; comment: string | null; origin: string; linked: boolean; revoked: boolean; shareable: boolean; respondedAt: string | null };
export type BookContact = { id: string; name: string; note: string | null };
export type Candidate = { userId: string; name: string };
type Props = { outingId: string; isOwner?: boolean; candidates?: Candidate[]; frozen?: boolean; slug: string; title: string; cancelled: boolean; done?: boolean; openLink: { enabled: boolean; token: string }; invitations: Inv[]; contacts: BookContact[]; reinvite?: { contactIds: string[]; names: string[] }; /** `invite` = invités et lien ouvert, `manage` = modifier, dupliquer, annuler… (menu « … », #1619). */ view?: 'all' | 'invite' | 'manage' };

const json = (body: unknown): RequestInit => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Gestion de la sortie côté organisateur : invitations nominatives, lien ouvert, annulation. */
export function OutingManager({ outingId, isOwner = false, candidates = [], frozen = false, slug, title, cancelled, done = false, openLink, invitations, contacts, reinvite, view = 'all' }: Props) {
  const showInvite = view !== 'manage';
  const showManage = view !== 'invite';
  const t = useTranslations('outingManager');
  const tc = useTranslations('common');
  const [confirming, setConfirming] = useState<{ kind: 'revoke'; id: string; name: string } | { kind: 'cancel' } | null>(null);
  const locale = useLocale();
  const errText = useErrorText();
  const router = useRouter();
  const [leaving, setLeaving] = useState<'owner' | 'creator' | null>(null);
  const [transferTo, setTransferTo] = useState(candidates[0]?.userId ?? '');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  // Réinviter (#1360) : contacts de la sortie d'origine cochés d'office ; sans contact, prénoms proposés (clé « n:<prénom> »).
  const [picked, setPicked] = useState<string[]>(() => [
    ...(reinvite?.contactIds ?? []).filter((id) => contacts.some((c) => c.id === id)),
    ...(reinvite?.names ?? []).map((n) => `n:${n}`),
  ]);
  const hasReinvite = !!reinvite && (reinvite.contactIds.length > 0 || reinvite.names.length > 0);
  const nameOnly = reinvite?.names ?? [];
  const [addToBook, setAddToBook] = useState(true);
  /** Dernière fournée d'invitations (liens à envoyer) : le message récapitulatif en est tiré. */
  const [batch, setBatch] = useState<{ name: string; url: string }[]>([]);

  const abs = (path: string) => `${window.location.origin}${path}`;
  async function call(url: string, init: RequestInit) {
    setBusy(true);
    try {
      const res = await fetch(url, init);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(errText(data.errors ? Object.values(data.errors)[0] : data.error));
      return res.ok ? data : null;
    } catch {
      toast.error(errText('network'));
      return null;
    } finally {
      setBusy(false);
    }
  }
  /** Départ du propriétaire (#1459) ou départ simple du créateur d'une publique : retour à la liste. */
  async function depart(body: unknown | null) {
    const d = body ? await call(`/api/outings/${slug}/depart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      : await call(`/api/outings/${outingId}/leave`, { method: 'POST' });
    if (d) { setLeaving(null); toast.success(t('leftToast')); router.push('/sorties'); router.refresh(); }
  }
  const patch = async (body: unknown) => {
    const d = await call(`/api/outings/${slug}`, json(body));
    if (d) router.refresh();
    return d;
  };

  async function invite(body: { contactIds?: string[]; newNames?: { name: string; addToBook: boolean }[] }) {
    const d = await call(`/api/outings/${slug}/invitations/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!d) return false;
    const made = d.invites as { id: string; name: string; path: string }[];
    setBatch(made.map((m) => ({ name: m.name, url: abs(m.path) })));
    if (d.skipped?.length) toast.info(t('alreadyInvited', { names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(d.skipped) }));
    router.refresh();
    return true;
  }
  async function inviteByName(e: React.FormEvent) {
    e.preventDefault();
    if (await invite({ newNames: [{ name, addToBook }] })) setName('');
  }
  async function inviteFromBook() {
    const contactIds = picked.filter((x) => !x.startsWith('n:'));
    const newNames = picked.filter((x) => x.startsWith('n:')).map((x) => ({ name: x.slice(2), addToBook: false }));
    if (await invite({ contactIds, newNames })) setPicked([]);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }
  /** Lien perso d'une personne (#1456) : déchiffré côté serveur, jamais régénéré. Partage natif, repli copie. */
  async function shareGuest(i: Inv) {
    const d = await call(`/api/outings/${slug}/invitations/${i.id}`, { method: 'GET' });
    if (d) await share(abs(d.path), i.name);
  }
  async function share(url: string, who: string) {
    if (navigator.share) {
      try { await navigator.share({ title, text: t('shareText', { who, title }), url }); } catch { /* annulé */ }
    } else await copy(url);
  }

  const invitedContactIds = new Set(invitations.filter((i) => !i.revoked && i.contactId).map((i) => i.contactId));
  const recap = batch.map((b) => `${b.name} : ${b.url}`).join('\n');
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const openUrl = typeof window === 'undefined' ? '' : abs(`/s/${openLink.token}/join`);
  const active = invitations.filter((i) => !i.revoked);
  const revoked = invitations.filter((i) => i.revoked);
  const counts = { yes: 0, maybe: 0, no: 0, pending: 0 } as Record<string, number>;
  active.forEach((i) => counts[i.status]++);

  return (
    <div className="flex flex-col gap-6">
      {showInvite && <>
      <section aria-label={t('inviteRegion')} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-heading">{t('invite')}</h2>
        {hasReinvite && <p className="rounded-xl bg-accent p-3 text-small">{t('reinviteHint')}</p>}
        {(contacts.length > 0 || nameOnly.length > 0) && (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-small text-muted-foreground mb-2">{t('bookHint')}</legend>
            <ul className="flex flex-col gap-2">
              {[...contacts, ...nameOnly.map((n) => ({ id: `n:${n}`, name: n, note: null }))].map((c) => {
                const already = invitedContactIds.has(c.id);
                const on = picked.includes(c.id);
                return (
                  <li key={c.id}>
                    <label className={`flex min-h-14 items-center gap-3 rounded-2xl border px-4 py-2 transition-colors duration-150 active:bg-accent/60 ${on ? 'border-primary bg-accent' : 'border-border bg-background'} ${already ? 'opacity-60' : ''}`}>
                      <input type="checkbox" className="size-6 shrink-0 accent-primary" checked={on} disabled={already || cancelled} onChange={() => toggle(c.id)} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body font-semibold truncate">{c.name}</span>
                        {(already || c.note) && <span className="text-small text-muted-foreground truncate">{already ? t('alreadyIn') : c.note}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        <form onSubmit={inviteByName} className="flex flex-col gap-3">
          <Field label={contacts.length ? t('inviteNameOther') : t('inviteName')} hint={t('inviteHint')}>
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />}
          </Field>
          {name.trim() && (
            <label className="flex min-h-touch items-center gap-3">
              <input type="checkbox" className="size-6 accent-primary" checked={addToBook} onChange={(e) => setAddToBook(e.target.checked)} />
              <span>{t('addToBook')}</span>
            </label>
          )}
          <Button type="submit" variant={contacts.length ? 'outline' : 'primary'} size="lg" disabled={busy || !name.trim() || cancelled}><UserPlus aria-hidden /> {t('createLink')}</Button>
        </form>
        <Link href="/sorties/potes" className="flex min-h-touch items-center text-small font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">{t('manageBook')}</Link>
        {batch.length > 1 && (
          <div className="flex flex-col gap-2 rounded-xl bg-accent p-3">
            <p className="text-small font-semibold">{t('recapTitle', { n: batch.length })}</p>
            <Button variant="outline" onClick={() => copy(recap)}><Copy aria-hidden /> {t('copyRecap')}</Button>
            <p className="text-caption text-muted-foreground">{t('linkOnce')}</p>
          </div>
        )}
      </section>

      <section aria-label={t('guests')} className="flex flex-col gap-3">
        <h2 className="text-heading">{t('guests')}</h2>
        {active.length > 0 && (
          <p className="text-small text-muted-foreground tabular-nums">
            {t('counts', { yes: counts.yes, maybe: counts.maybe, no: counts.no, pending: counts.pending })}
          </p>
        )}
        {active.length === 0 && <p className="text-muted-foreground">{t('noGuest')}</p>}
        <ul className="flex flex-col gap-3">
          {active.map((i) => (
            <li key={i.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-heading min-w-0 break-words">{i.name}</p>
                <RsvpBadge status={i.status} />
              </div>
              {i.linked && <p className="text-caption text-muted-foreground">{t('viaAccount')}</p>}
              {i.comment && <p className="text-small text-muted-foreground">« {i.comment} »</p>}
              {i.respondedAt && <p className="text-caption text-muted-foreground">{t('answered', { date: new Date(i.respondedAt).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { timeZone: 'Europe/Paris' }) })}</p>}
              <div className="flex gap-2">
                {i.shareable && (
                  <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => void shareGuest(i)}><Share2 aria-hidden /> {t('shareLink')}</Button>
                )}
                <Button
                  variant="ghost" className="flex-1 text-destructive" disabled={busy}
                  onClick={() => setConfirming({ kind: 'revoke', id: i.id, name: i.name })}
                ><X aria-hidden /> {t('revoke')}</Button>
              </div>
            </li>
          ))}
        </ul>
        {revoked.length > 0 && <p className="text-small text-muted-foreground">{t('revoked', { names: new Intl.ListFormat(locale, { type: 'conjunction' }).format(revoked.map((i) => i.name)) })}</p>}
      </section>

      <section aria-label={t('openRegion')} className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="text-heading">{t('open')}</h2>
        <p className="text-small text-muted-foreground">{t('openHint')}</p>
        {openLink.enabled ? (
          <>
            <p className="text-small break-all select-all">{openUrl}</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => copy(openUrl)}><Link2 aria-hidden /> {t('copy')}</Button>
              <Button variant="outline" className="flex-1" onClick={() => share(openUrl, t('hello'))}><Share2 aria-hidden /> {t('send')}</Button>
            </div>
            {!frozen && (
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => patch({ action: 'open-link', enabled: false })}>{t('disable')}</Button>
              </div>
            )}
          </>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => patch({ action: 'open-link', enabled: true })}>{t('enable')}</Button>
        )}
      </section>

      </>}

      {showManage && <section aria-label={t('manageRegion')} className="flex flex-col gap-2">
        {!frozen && <Button asChild variant="outline"><Link href={`/s/${slug}/modifier`}><Pencil aria-hidden /> {t('edit')}</Link></Button>}
        <Button asChild variant="outline"><Link href={`/s/${slug}/dupliquer`}><CopyPlus aria-hidden /> {t('duplicate')}</Link></Button>
        {!frozen && (
          <Button variant="outline" disabled={busy} onClick={async () => { if (await patch({ action: 'refresh' })) toast.success(t('refreshed')); }}>
            <RefreshCw aria-hidden /> {t('refresh')}
          </Button>
        )}
        {frozen && <p className="text-small text-muted-foreground">{t('frozenHint')}</p>}
        {!frozen && done && <Button variant="secondary" disabled={busy} onClick={() => patch({ action: 'restore' })}>{t('reopen')}</Button>}
        {!frozen && !cancelled && !done && <Button variant="secondary" disabled={busy} onClick={() => patch({ action: 'done' })}>{t('markDone')}</Button>}
        {frozen ? null : cancelled ? (
          <Button variant="secondary" disabled={busy} onClick={() => patch({ action: 'restore' })}>{t('restore')}</Button>
        ) : done ? null : (
          <Button variant="destructive" disabled={busy} onClick={() => setConfirming({ kind: 'cancel' })}>{t('cancel')}</Button>
        )}
        {!done && !cancelled && (isOwner || frozen) && (
          <Button variant="outline" disabled={busy} onClick={() => setLeaving(isOwner ? 'owner' : 'creator')}><DoorOpen aria-hidden /> {t('leave')}</Button>
        )}
      </section>}
      {showInvite && picked.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <Button size="lg" className="w-full" disabled={busy || cancelled} onClick={inviteFromBook}><Check aria-hidden /> {t('inviteN', { n: picked.length })}</Button>
        </div>
      )}
      <ConfirmDialog
        open={leaving === 'creator'}
        onOpenChange={(o) => !o && setLeaving(null)}
        title={t('leave')}
        description={t('leavePublicConfirm')}
        confirmLabel={t('leaveGo')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => depart(null)}
      />
      <ActionSheet open={leaving === 'owner'} onOpenChange={(o) => !o && setLeaving(null)} title={t('leave')}>
        <div className="flex flex-col gap-3">
          <p className="text-body text-pretty">{t('leaveIntro')}</p>
          <Button size="lg" variant="destructive" className="h-auto min-h-touch flex-col items-start gap-0.5 py-3 text-left" disabled={busy} onClick={() => depart({ choice: 'delete' })}>
            <span>{t('leaveDelete')}</span><span className="text-small font-normal opacity-90">{t('leaveDeleteHint')}</span>
          </Button>
          <Button size="lg" variant="outline" className="h-auto min-h-touch flex-col items-start gap-0.5 py-3 text-left" disabled={busy} onClick={() => depart({ choice: 'public' })}>
            <span>{t('leaveMakePublic')}</span><span className="text-small font-normal text-muted-foreground">{t('leaveMakePublicHint')}</span>
          </Button>
          <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
            <p className="font-semibold">{t('leaveTransfer')}</p>
            <p className="text-small text-muted-foreground">{candidates.length ? t('leaveTransferHint') : t('leaveTransferNone')}</p>
            {candidates.length > 0 && (
              <>
                <Field label={t('leaveTransferPick')}>
                  {(p) => (
                    <select {...p} className="min-h-touch w-full rounded-xl border border-border bg-background px-3 text-foreground" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                      {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
                    </select>
                  )}
                </Field>
                <Button size="lg" disabled={busy || !transferTo} onClick={() => depart({ choice: 'transfer', newOwnerId: transferTo })}>{t('leaveTransfer')}</Button>
              </>
            )}
          </div>
          <Button size="lg" variant="ghost" disabled={busy} onClick={() => setLeaving(null)}>{t('leaveBack')}</Button>
        </div>
      </ActionSheet>
      <ConfirmDialog
        open={confirming != null}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming?.kind === 'revoke' ? t('revoke') : t('cancel')}
        description={confirming?.kind === 'revoke' ? t('revokeConfirm', { name: confirming.name }) : t('cancelConfirm')}
        confirmLabel={confirming?.kind === 'revoke' ? t('revoke') : t('cancel')}
        cancelLabel={tc('cancel')}
        onConfirm={async () => {
          const c = confirming;
          setConfirming(null);
          if (c?.kind === 'revoke') { if (await call(`/api/outings/${slug}/invitations/${c.id}`, json({ action: 'revoke' }))) router.refresh(); }
          else if (c) await patch({ action: 'cancel' });
        }}
      />
    </div>
  );
}
