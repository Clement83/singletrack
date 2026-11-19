'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban, Check, ExternalLink, Link2, Send, UserMinus, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useErrorText } from '@/lib/use-error-text';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';

type Entry = { id: string; userId: string | null; name: string; remote?: { actorId?: string; handle: string; domain: string; profileUrl: string } };
type Blocked = { id: string; handle: string; domain: string; displayName: string | null };
type Props = { friends: Entry[]; incoming: Entry[]; outgoing: Entry[]; blocked?: Blocked[]; federation?: boolean; myAddress?: string | null };

/** "My friends" (#1432): main action = request by email; single-use link second. */
export function FriendsScreen({ friends, incoming, outgoing, blocked = [], federation = false, myAddress = null }: Props) {
  const t = useTranslations('friends');
  const tm = useTranslations('moderation');
  const tp = useTranslations('userProfile');
  const tc = useTranslations('common');
  const [toRemove, setToRemove] = useState<Entry | null>(null);
  const errText = useErrorText();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(errText(data.error)); return null; }
      router.refresh();
      return data as Record<string, unknown>;
    } catch {
      toast.error(errText('network'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    const data = await call('/api/friends/invite', 'POST');
    if (typeof data?.path !== 'string') return;
    const url = `${window.location.origin}${data.path}`;
    setLink(url);
    try {
      if (navigator.share) await navigator.share({ text: t('shareText'), url });
      else { await navigator.clipboard.writeText(url); toast.success(t('linkCopied')); }
    } catch { /* share cancelled: the link stays displayed */ }
  }

  const section = (title: string, list: Entry[], actions: (e: Entry) => React.ReactNode, listIsFriends = false) =>
    list.length > 0 && (
      <section aria-label={title} className="flex flex-col gap-3">
        <h2 className="text-heading">{title}</h2>
        <ul className="flex flex-col gap-3">
          {list.map((e) => (
            <li key={e.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <p className="text-heading truncate">{e.name || t('unnamed')}</p>
                {e.remote && <span className="text-small text-muted-foreground" title={t('remoteBadgeHint')}>{t('remoteBadge', { domain: e.remote.domain })}</span>}
              </div>
              {listIsFriends && e.userId && <Link href={`/u/${e.userId}`} className="flex min-h-touch items-center text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">{tp('seeProfile')}</Link>}
              {listIsFriends && e.remote && (
                <a href={e.remote.profileUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-touch items-center gap-1 text-body font-semibold text-primary underline-offset-4 hover:underline active:opacity-70">
                  {t('remoteProfile', { domain: e.remote.domain })} <ExternalLink aria-hidden className="size-4" />
                </a>
              )}
              <div className="flex gap-2">{actions(e)}</div>
            </li>
          ))}
        </ul>
      </section>
    );

  const remove = (e: Entry, label: string) => (
    <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setToRemove(e)}>
      <UserMinus aria-hidden /> {label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      {section(t('incoming'), incoming, (e) => (
        <>
          {e.remote?.actorId && (
            <Button variant="ghost" disabled={busy} onClick={() => call(`/api/federation/blocks/${e.remote!.actorId}`, 'POST')}><Ban aria-hidden /> {tm('block')}</Button>
          )}
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => call(`/api/friends/${e.id}`, 'PATCH', { action: 'decline' })}><X aria-hidden /> {t('decline')}</Button>
          <Button className="flex-1" disabled={busy} onClick={() => call(`/api/friends/${e.id}`, 'PATCH', { action: 'accept' })}><Check aria-hidden /> {t('accept')}</Button>
        </>
      ))}
      <form
        className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (await call('/api/friends', 'POST', { email })) { setEmail(''); toast.success(t('requestSent')); }
        }}
      >
        <Field label={t('emailLabel')} hint={t('emailHint')}>
          {(p) => <Input {...p} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />}
        </Field>
        <Button type="submit" size="lg" disabled={busy || !email.trim()}><Send aria-hidden /> {t('ask')}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={createLink}><Link2 aria-hidden /> {t('createLink')}</Button>
        {link && <p className="text-small break-all text-muted-foreground">{link}</p>}
      </form>
      {federation && (
        <form
          className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm"
          onSubmit={async (ev) => {
            ev.preventDefault();
            if (await call('/api/friends', 'POST', { address })) { setAddress(''); toast.success(t('requestSent')); }
          }}
        >
          <Field label={t('remoteLabel')} hint={myAddress ? t('remoteHintMine', { address: myAddress }) : t('remoteHint')}>
            {(p) => <Input {...p} type="text" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder={t('remotePlaceholder')} value={address} onChange={(e) => setAddress(e.target.value)} required />}
          </Field>
          <Button type="submit" size="lg" variant="secondary" disabled={busy || !address.trim()}><Send aria-hidden /> {t('ask')}</Button>
        </form>
      )}
      {section(t('outgoing'), outgoing, (e) => remove(e, t('cancel')))}
      {friends.length === 0 && incoming.length === 0 && outgoing.length === 0
        ? <p className="text-muted-foreground">{t('empty')}</p>
        : section(t('mine'), friends, (e) => remove(e, t('remove')), true)}
      {blocked.length > 0 && (
        <section aria-label={tm('blockedTitle')} className="flex flex-col gap-3">
          <h2 className="text-heading">{tm('blockedTitle')}</h2>
          <ul className="flex flex-col gap-3">
            {blocked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                <p className="text-body min-w-0 flex-1 break-words">{b.displayName || b.handle} · {b.domain}</p>
                <Button variant="outline" disabled={busy} onClick={() => call(`/api/federation/blocks/${b.id}`, 'DELETE')}>{tm('unblock')}</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ConfirmDialog
        open={toRemove != null}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={t('remove')}
        description={t('removeConfirm', { name: toRemove?.name || t('unnamed') })}
        confirmLabel={t('remove')}
        cancelLabel={tc('cancel')}
        onConfirm={() => { const e = toRemove; setToRemove(null); if (e) void call(`/api/friends/${e.id}`, 'DELETE'); }}
      />
    </div>
  );
}
