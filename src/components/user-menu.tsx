'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Code, LogOut, Pencil, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { DESKTOP, useMediaQuery } from '@/lib/use-media-query';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { ActionSheet } from '@/components/ui/action-sheet';
import { Field, Input } from '@/components/ui/field';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { CharteSwitcher } from '@/components/charte-switcher';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { DefaultOutingVisibility } from '@/components/default-outing-visibility';
import type { OutingVisibilityValue } from '@/components/outing-visibility-switcher';
import { FederatedAddress } from '@/components/federated-address';
import { DefaultTrackVisibility, type TrackVisibilityValue } from '@/components/tracks/track-visibility';
import { VisibilitySwitcher } from '@/components/visibility-switcher';

type User = { id: string; name: string; email: string; profileVisibility: 'private' | 'public'; outingVisibility: OutingVisibilityValue; drawnTrackVisibility: TrackVisibilityValue; importedTrackVisibility: TrackVisibilityValue; charte: string; fed?: { handle: string; address: string; canChange: boolean } | null };

/** Initiale du prénom (avatar). */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-10 items-center justify-center rounded-full bg-primary text-heading text-primary-foreground', className)}
    >
      {initialOf(name)}
    </span>
  );
}

/** Contenu du menu : identité, thème, langue, prénom, déconnexion. Commun au tiroir mobile et au panneau desktop. */
function MenuBody({ user, onDone, sourceUrl, version }: { user: User; onDone: () => void; sourceUrl: string; version: string }) {
  const t = useTranslations('userMenu');
  const tTheme = useTranslations('theme');
  const tCharte = useTranslations('charte');
  const tProfile = useTranslations('userProfile');
  const tOutingVis = useTranslations('outingVisibility');
  const tTrackVis = useTranslations('trackVisibility');
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function saveName(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name')).trim();
    if (!name) return;
    setPending(true);
    setError(undefined);
    const { error } = await authClient.updateUser({ name });
    setPending(false);
    if (error) return setError(t('error'));
    setEditing(false);
    toast.success(t('nameSaved'));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-block">
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{tTheme('label')}</h3>
        <ThemeSwitcher />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{tCharte('label')}</h3>
        <CharteSwitcher account={user.charte} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{t('language')}</h3>
        <LocaleSwitcher />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{tProfile('visibility')}</h3>
        <VisibilitySwitcher initial={user.profileVisibility} />
        <Button asChild variant="ghost" className="w-full justify-start">
          <Link href={`/u/${user.id}`} onClick={onDone}>
            <UserRound aria-hidden />
            {tProfile('myProfile')}
          </Link>
        </Button>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{tOutingVis('menuTitle')}</h3>
        <DefaultOutingVisibility initial={user.outingVisibility} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-label uppercase text-muted-foreground">{tTrackVis('menuTitle')}</h3>
        <DefaultTrackVisibility origin="drawn" initial={user.drawnTrackVisibility} />
        <DefaultTrackVisibility origin="imported" initial={user.importedTrackVisibility} />
      </section>
      {user.fed && <FederatedAddress {...user.fed} />}
      <section>
        {editing ? (
          <form onSubmit={saveName} className="flex flex-col gap-3">
            <Field label={t('nameLabel')} error={error}>
              {(c) => (
                <Input {...c} name="name" defaultValue={user.name} autoComplete="given-name" autoCapitalize="words" maxLength={60} required />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? t('saving') : t('save')}
              </Button>
              <Button variant="ghost" onClick={() => { setEditing(false); setError(undefined); }}>
                {t('cancel')}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" className="w-full justify-start" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            {t('editName')}
          </Button>
        )}
      </section>
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          await authClient.signOut();
          onDone();
          router.replace('/login');
          router.refresh();
        }}
      >
        <LogOut aria-hidden />
        {t('signOut')}
      </Button>
      <Button asChild variant="ghost" className="w-full justify-start">
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
          <Code aria-hidden />
          {t('sourceCode')}
        </a>
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t('version', { version })}</p>
    </div>
  );
}

function Identity({ user }: { user: User }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={user.name} className="size-12" />
      <div className="min-w-0">
        <p className="truncate text-heading">{user.name}</p>
        <p className="truncate text-small text-muted-foreground">{user.email}</p>
      </div>
    </div>
  );
}

/**
 * Menu utilisateur (#1397) : avatar rond (initiale), en haut à gauche sur mobile, en bas de la barre latérale
 * en desktop. Tiroir modal sur mobile (vaul : focus piégé, Échap, glisser pour fermer), panneau flottant à
 * droite de la barre latérale en desktop (Échap, clic dehors, focus rendu à l'avatar).
 */
// Écrans plein écran centrés sur une seule tâche : pas d'avatar par-dessus (éditeur de traces, #1392).
const HIDDEN_ON = ['/new'];

export function UserMenu({ user, className, sourceUrl, version }: { user: User; className?: string; sourceUrl: string; version: string }) {
  const t = useTranslations('userMenu');
  const pathname = usePathname();
  const desktop = useMediaQuery(DESKTOP);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Desktop : Échap et clic hors du panneau ferment ; le focus entre dans le panneau puis revient à l'avatar.
  useEffect(() => {
    if (!desktop || !open) return;
    const trigger = triggerRef.current;
    panelRef.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !trigger?.contains(target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      trigger?.focus();
    };
  }, [desktop, open]);

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={t('open')}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={desktop && open ? panelId : undefined}
      onClick={() => setOpen((o) => !o)}
      className={cn(
        'flex size-touch items-center justify-center rounded-full bg-card shadow-md transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-95',
        className,
      )}
    >
      <Avatar name={user.name} />
    </button>
  );

  if (HIDDEN_ON.includes(pathname)) return null;

  if (desktop)
    return (
      <>
        {trigger}
        {open && (
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={t('title')}
            className="fixed bottom-4 left-[calc(var(--spacing-rail)+12px)] z-50 flex max-h-[calc(100dvh-2rem)] w-panel flex-col gap-4 overflow-y-auto overscroll-contain rounded-3xl border border-border bg-popover p-4 text-popover-foreground shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <Identity user={user} />
              <Button variant="ghost" size="icon" aria-label={t('close')} onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            <MenuBody user={user} sourceUrl={sourceUrl} version={version} onDone={() => setOpen(false)} />
          </div>
        )}
      </>
    );

  return (
    <ActionSheet open={open} onOpenChange={setOpen} title={t('title')} trigger={trigger} header={<Identity user={user} />}>
      <MenuBody user={user} sourceUrl={sourceUrl} version={version} onDone={() => setOpen(false)} />
    </ActionSheet>
  );
}
