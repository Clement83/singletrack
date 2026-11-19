'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Marker } from 'react-map-gl/maplibre';
import { Bike, Check, Zap } from 'lucide-react';
import { setRider } from '@/lib/editor/rider';
import {
  ArrowLeft, ArrowLeftRight, ArrowLeftToLine, ArrowRightToLine, ChevronDown, ChevronUp, CircleHelp, Home, LineChart, Loader2,
  Magnet, Maximize2, Minimize2, Redo2, Repeat, Route, Save, Spline, Trash2, Undo2, X, type LucideIcon,
} from 'lucide-react';
import { ElevationProfile } from '@/components/elevation-profile';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { SHORTCUTS, ariaShortcut, isTypingTarget, shortcutFor, type ShortcutAction } from '@/lib/editor/shortcuts';
import type { EditorCtl } from './track-editor';
import { AutosaveStatus, SaveForm, useEditorStats } from './editor-shared';

// Taille du profil flottant, mémorisée dans le navigateur (peut être indisponible : navigation privée…).
type ProfileSize = 'collapsed' | 'normal' | 'large';
const SIZE_KEY = 'singletrack.editor.desktopProfile';
const SIZE_EVENT = 'singletrack:editor-desktop-profile';
const readSize = (): ProfileSize => {
  try {
    const v = localStorage.getItem(SIZE_KEY);
    return v === 'collapsed' || v === 'large' ? v : 'normal';
  } catch {
    return 'normal';
  }
};
const writeSize = (v: ProfileSize) => {
  try {
    localStorage.setItem(SIZE_KEY, v);
  } catch {
    /* préférence non mémorisée, sans conséquence */
  }
  window.dispatchEvent(new Event(SIZE_EVENT));
};
const subscribeSize = (cb: () => void) => {
  window.addEventListener(SIZE_EVENT, cb);
  return () => window.removeEventListener(SIZE_EVENT, cb);
};

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Touches d'un raccourci, affichées en `<kbd>` (Ctrl/Maj, ou ⌘/⇧ sur Mac). */
function Keys({ action, className }: { action: ShortcutAction; className?: string }) {
  const t = useTranslations('editor.keys');
  const mac = isMac();
  const label = (k: string) =>
    k === 'mod' ? (mac ? '⌘' : t('mod')) : k === 'shift' ? (mac ? '⇧' : t('shift')) : k === 'delete' || k === 'escape' ? t(k) : k;
  const keys = SHORTCUTS.find((s) => s.action === action)?.keys ?? [];
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((k) => (
        <kbd key={k} className="min-w-6 rounded-md border border-border bg-muted px-1.5 text-center text-caption font-semibold text-foreground">
          {label(k)}
        </kbd>
      ))}
    </span>
  );
}

const panel = 'glass rounded-2xl border border-border text-card-foreground shadow-md';

/** Bouton de la boîte à outils : icône 44 px, libellé accessible, info-bulle (libellé + raccourci) au survol et au focus. */
function ToolButton({
  icon: Icon, label, shortcut, pressed, ...p
}: React.ComponentProps<typeof Button> & { icon: LucideIcon; label: string; shortcut?: ShortcutAction; pressed?: boolean }) {
  return (
    <div className="group relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
        aria-pressed={pressed}
        className={cn('rounded-md', pressed && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground active:bg-primary')}
        {...p}
      >
        <Icon aria-hidden />
      </Button>
      {/* Info-bulle décorative : le libellé est déjà porté par aria-label. */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-full z-30 ml-2 flex -translate-y-1/2 items-center gap-2 rounded-lg bg-popover px-2.5 py-1.5 text-small whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {label}
        {shortcut && <Keys action={shortcut} />}
      </span>
    </div>
  );
}

/**
 * Éditeur desktop (≥ 1024 px, #1393) : carte plein écran, l'interface flotte par-dessus.
 * Haut gauche : retour + titre ; colonne gauche : boîte à outils (info-bulles + raccourcis) ; haut droite :
 * profil flottant toujours visible (repliable en pastille, agrandissable) ; bas droite : « Enregistrer » →
 * panneau latéral. Raccourcis : Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Suppr, Échap, R / D, Ctrl/Cmd+S, « ? ».
 */
export function EditorDesktop({ ctl }: { ctl: EditorCtl }) {
  const t = useTranslations('editor');
  const { state, dispatch, doc, stats, pending, canSave, home, mode } = ctl;
  const [saveOpen, setSaveOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const size = useSyncExternalStore(subscribeSize, readSize, () => 'normal' as ProfileSize);
  const cells = useEditorStats(ctl);
  const helpClose = useRef<HTMLButtonElement>(null);
  const sel = state.selected;

  // Raccourcis clavier : le gestionnaire est remis à jour après chaque rendu (ref), l'écouteur n'est posé qu'une fois.
  const handler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    handler.current = (e: KeyboardEvent) => {
      const action = shortcutFor(e, isTypingTarget(e.target));
      if (!action) return;
      switch (action) {
        case 'undo':
          if (state.past.length) dispatch({ type: 'undo' });
          break;
        case 'redo':
          if (state.future.length) dispatch({ type: 'redo' });
          break;
        case 'delete':
          if (sel === null) return;
          dispatch({ type: 'remove', i: sel });
          break;
        case 'keepChoice':
          if (!state.choice || saveOpen || help) return;
          ctl.keepChoice();
          break;
        case 'escape':
          if (help) setHelp(false);
          else if (saveOpen) setSaveOpen(false);
          else if (state.choice) ctl.keepChoice();
          else if (sel !== null) dispatch({ type: 'select', i: null });
          else return;
          break;
        case 'modeRoute':
          dispatch({ type: 'newMode', mode: 'route' });
          break;
        case 'modeLine':
          dispatch({ type: 'newMode', mode: 'line' });
          break;
        case 'toggleMode':
          dispatch({ type: 'newMode', mode: state.newMode === 'route' ? 'line' : 'route' });
          break;
        case 'altRoute':
          if (state.choice) dispatch({ type: 'selectChoice', which: state.choice.selected === 'new' ? 'old' : 'new' });
          else if (!ctl.alts.length) return;
          else ctl.cycleAlt();
          break;
        case 'reverse':
          if (doc.waypoints.length < 2) return;
          dispatch({ type: 'reverse' });
          break;
        case 'close':
          if (doc.waypoints.length < 2) return;
          dispatch({ type: 'close' });
          break;
        case 'snapAll':
          if (doc.segments.length === 0) return;
          dispatch({ type: 'allModes', mode: 'route' });
          break;
        case 'save':
          if (saveOpen) void ctl.save();
          else if (canSave) setSaveOpen(true);
          break;
        case 'help':
          setHelp((h) => !h);
          break;
      }
      e.preventDefault();
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Aide : le focus va sur « Fermer » à l'ouverture et revient où il était à la fermeture.
  useEffect(() => {
    if (!help) return;
    const prev = document.activeElement as HTMLElement | null;
    helpClose.current?.focus();
    return () => prev?.focus();
  }, [help]);

  const setSize = (s: ProfileSize) => {
    if (s === 'collapsed') ctl.setProfileCursor(null);
    writeSize(s);
  };
  const hasProfile = stats.profile.length > 1;

  return (
    <>
      {/* Haut gauche : retour + titre */}
      <div className={cn(panel, 'absolute top-3 left-3 z-10 flex max-w-sm items-center gap-1 py-1 pr-4 pl-1')}>
        <Button asChild variant="ghost" size="icon" aria-label={t('quit')}>
          <Link href={ctl.quitHref} onClick={ctl.requestLeave}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-heading">{t(`title.${mode}`)}</h1>
        {pending.length > 0 && <Loader2 aria-label={t('routing')} className="ml-1 size-5 shrink-0 animate-spin text-muted-foreground" />}
        <span className="ml-2"><AutosaveStatus ctl={ctl} /></span>
      </div>

      {/* Colonne gauche : boîte à outils */}
      <div role="toolbar" aria-orientation="vertical" aria-label={t('toolbox')} className={cn(panel, 'absolute top-20 left-3 z-10 flex flex-col gap-1 p-1')}>
        <ToolButton icon={Route} label={t('shortcutLabels.modeRoute')} shortcut="modeRoute" pressed={state.newMode === 'route'} onClick={() => dispatch({ type: 'newMode', mode: 'route' })} />
        <ToolButton icon={Spline} label={t('shortcutLabels.modeLine')} shortcut="modeLine" pressed={state.newMode === 'line'} onClick={() => dispatch({ type: 'newMode', mode: 'line' })} />
        <hr className="mx-2 my-1 border-border" />
        <ToolButton icon={Undo2} label={t('undo')} shortcut="undo" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
        <ToolButton icon={Redo2} label={t('redo')} shortcut="redo" disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
        <hr className="mx-2 my-1 border-border" />
        <ToolButton icon={ArrowLeftRight} label={t('reverse')} shortcut="reverse" disabled={doc.waypoints.length < 2} onClick={() => dispatch({ type: 'reverse' })} />
        <ToolButton icon={Repeat} label={t('closeLoop')} shortcut="close" disabled={doc.waypoints.length < 2} onClick={() => dispatch({ type: 'close' })} />
        <ToolButton icon={Home} label={t('fromHome')} onClick={() => dispatch({ type: 'home', home })} />
        <ToolButton
          icon={ctl.rider === 'ebike' ? Zap : Bike}
          label={t('rider.current', { rider: t(`rider.${ctl.rider}`) })}
          onClick={() => setRider(ctl.rider === 'ebike' ? 'muscle' : 'ebike')}
        />
        <ToolButton icon={Magnet} label={t('snapAll')} shortcut="snapAll" disabled={doc.segments.length === 0} onClick={() => dispatch({ type: 'allModes', mode: 'route' })} />
        <hr className="mx-2 my-1 border-border" />
        <ToolButton icon={CircleHelp} label={t('help')} shortcut="help" aria-haspopup="dialog" onClick={() => setHelp(true)} />
      </div>

      {/* Haut droite : profil flottant (à gauche des boutons de la carte), masqué derrière le panneau d'enregistrement. */}
      {!saveOpen &&
        (size === 'collapsed' ? (
          <button
            type="button"
            aria-expanded={false}
            aria-label={t('showProfile')}
            onClick={() => setSize('normal')}
            className={cn(panel, 'absolute top-3 right-16 z-10 flex min-h-touch items-center gap-2 px-4 font-semibold tabular-nums hover:bg-accent active:bg-accent')}
          >
            <LineChart aria-hidden className="size-5" />
            {cells[0].value}
            <ChevronDown aria-hidden className="size-4" />
          </button>
        ) : (
          <section aria-label={t('viewProfile')} className={cn(panel, 'absolute top-3 right-16 z-10 flex flex-col gap-2 p-3', size === 'large' ? 'w-[680px]' : 'w-[420px]')}>
            <div className="flex items-center gap-1">
              <dl className="flex min-w-0 flex-1 gap-4" aria-live="polite">
                {cells.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="truncate text-caption text-muted-foreground">{c.label}</dt>
                    <dd className="truncate text-body font-semibold tabular-nums">{c.value}</dd>
                  </div>
                ))}
              </dl>
              <Button variant="ghost" size="icon" aria-label={size === 'large' ? t('shrinkProfile') : t('expandProfile')} onClick={() => setSize(size === 'large' ? 'normal' : 'large')}>
                {size === 'large' ? <Minimize2 /> : <Maximize2 />}
              </Button>
              <Button variant="ghost" size="icon" aria-expanded aria-label={t('hideProfile')} onClick={() => setSize('collapsed')}>
                <ChevronUp />
              </Button>
            </div>
            {hasProfile ? (
              <ElevationProfile points={stats.profile} slopes cursor={ctl.mapHoverIndex} onScrub={(p) => ctl.setProfileCursor(p ? p.index : null)} />
            ) : (
              <p className="flex h-32 items-center justify-center rounded-2xl bg-muted px-4 text-center text-small text-muted-foreground">
                {doc.waypoints.length < 2 ? t('profileEmpty') : t('profileNoEle')}
              </p>
            )}
          </section>
        ))}

      {/* Bas centre : valider la paire de chemins (#1642) */}
      {state.choice && !saveOpen && (
        <div role="group" aria-label={t('choice.group')} className="absolute bottom-10 left-1/2 z-10 -translate-x-1/2">
          <Button className="shadow-md" aria-keyshortcuts={ariaShortcut('keepChoice')} onClick={ctl.keepChoice}>
            <Check aria-hidden /> {t('choice.keep')}
          </Button>
        </div>
      )}

      {/* Bas droite : action principale */}
      {!saveOpen && (
        <Button
          className="absolute right-3 bottom-10 z-10 shadow-md"
          disabled={!canSave}
          aria-keyshortcuts={ariaShortcut('save')}
          onClick={() => setSaveOpen(true)}
        >
          {pending.length > 0 ? <Loader2 className="animate-spin" /> : <Save />}
          {pending.length > 0 ? t('routingEllipsis') : doc.waypoints.length < 2 ? t('needTwoPoints') : t(ctl.saveKey === 'publish' ? 'publish' : 'save')}
        </Button>
      )}

      {/* Panneau latéral d'enregistrement */}
      {saveOpen && (
        <aside aria-label={t('savePanel')} className={cn(panel, 'absolute inset-y-3 right-3 z-20 flex w-panel flex-col overflow-hidden')}>
          <header className="flex items-start gap-2 p-4 pb-2">
            <h2 className="min-w-0 flex-1 pt-2 text-title">{t(ctl.saveKey === 'publish' ? 'publishPanel' : 'savePanel')}</h2>
            <Button variant="ghost" size="icon" aria-label={t('close')} aria-keyshortcuts="Escape" onClick={() => setSaveOpen(false)}>
              <X />
            </Button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
            {stats.partial && <p className="mb-3 text-small text-muted-foreground">{t('partial')}</p>}
            <SaveForm ctl={ctl} autoFocusName />
          </div>
        </aside>
      )}

      {/* Aide « ? » */}
      {help && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-scrim p-6" onClick={() => setHelp(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-help-title"
            className="flex w-full max-w-md flex-col gap-4 glass rounded-3xl border border-border p-5 text-popover-foreground shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="editor-help-title" className="pt-2 text-title">{t('shortcutsTitle')}</h2>
              <Button ref={helpClose} variant="ghost" size="icon" aria-label={t('close')} onClick={() => setHelp(false)}>
                <X />
              </Button>
            </div>
            <dl className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2">
              {SHORTCUTS.map((s) => (
                <Fragment key={s.action}>
                  <dt className="text-body">{t(`shortcutLabels.${s.action}`)}</dt>
                  <dd>
                    <Keys action={s.action} />
                  </dd>
                </Fragment>
              ))}
            </dl>
            <p className="text-small text-pretty text-muted-foreground">{t('helpHints')}</p>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Popover ancré au point sélectionné (desktop, #1393) : Supprimer, Couper avant/après, mode du tronçon suivant.
 * À poser dans la carte (`Marker`). Les clics ne traversent pas jusqu'à la carte ; Échap ferme (raccourci global).
 */
export function DesktopPointPopover({ ctl }: { ctl: EditorCtl }) {
  const t = useTranslations('editor');
  const { state, dispatch, doc } = ctl;
  const sel = state.selected;
  if (sel === null || !doc.waypoints[sel]) return null;
  const [lon, lat] = doc.waypoints[sel];
  const next = doc.segments[sel];
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const item = (icon: LucideIcon, label: string, onClick: () => void, disabled = false, shortcut?: ShortcutAction) => {
    const Icon = icon;
    return (
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={disabled}
        aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
        onClick={onClick}
      >
        <Icon aria-hidden /> <span className="flex-1 text-left">{label}</span>
        {shortcut && <Keys action={shortcut} />}
      </Button>
    );
  };

  return (
    <Marker longitude={lon} latitude={lat} anchor="bottom" offset={[0, -28]}>
      <div
        role="dialog"
        aria-label={t('pointActions', { n: sel + 1 })}
        onClick={stop}
        onMouseDown={stop}
        onPointerDown={stop}
        onDoubleClick={stop}
        onWheel={stop}
        className="flex w-64 cursor-default flex-col gap-0.5 glass rounded-2xl border border-border p-1.5 text-popover-foreground shadow-md"
      >
        <div className="flex items-center justify-between pl-2">
          <span className="text-small font-semibold">{t('pointOf', { n: sel + 1, total: doc.waypoints.length })}</span>
          <Button variant="ghost" size="icon" aria-label={t('deselect')} aria-keyshortcuts="Escape" onClick={() => dispatch({ type: 'select', i: null })}>
            <X />
          </Button>
        </div>
        {item(Trash2, t('remove'), () => dispatch({ type: 'remove', i: sel }), false, 'delete')}
        {item(ArrowLeftToLine, t('trimBefore'), () => dispatch({ type: 'trimBefore', i: sel }), sel === 0)}
        {item(ArrowRightToLine, t('trimAfter'), () => dispatch({ type: 'trimAfter', i: sel }), sel >= doc.waypoints.length - 1)}
        {next &&
          item(next.mode === 'route' ? Spline : Route, next.mode === 'route' ? t('straight') : t('followPaths'), () =>
            dispatch({ type: 'segmentMode', seg: sel, mode: next.mode === 'route' ? 'line' : 'route' }),
          )}
      </div>
    </Marker>
  );
}
