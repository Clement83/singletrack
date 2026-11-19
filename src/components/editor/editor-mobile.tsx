'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  ArrowLeft, ArrowLeftRight, Magnet, ArrowLeftToLine, Bike, Zap, ArrowRightToLine, ChevronDown, ChevronUp, Ellipsis, Home, Loader2, Mountain, Redo2,
  Repeat, Route, Save, Spline, Trash2, Undo2, X,
} from 'lucide-react';
import { ElevationProfile } from '@/components/elevation-profile';
import { Button } from '@/components/ui/button';
import { ActionSheet } from '@/components/ui/action-sheet';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { setRider } from '@/lib/editor/rider';
import { setSnapPref } from '@/lib/editor/snap-pref';
import type { Rider } from '@/lib/routing/score';
import { cn } from '@/lib/utils';
import type { EditorCtl } from './track-editor';
import { AutosaveStatus, SaveForm, useEditorStats } from './editor-shared';

// "Collapsed profile" preference, remembered in the browser (may be unavailable: private browsing…).
const PROFILE_KEY = 'singletrack.editor.profileCollapsed';
const PROFILE_EVENT = 'singletrack:editor-profile';
const readCollapsed = () => {
  try {
    return localStorage.getItem(PROFILE_KEY) === '1';
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(PROFILE_KEY, v ? '1' : '0');
  } catch {
    /* preference not remembered, no consequence */
  }
  window.dispatchEvent(new Event(PROFILE_EVENT));
};
const subscribe = (cb: () => void) => {
  window.addEventListener(PROFILE_EVENT, cb);
  return () => window.removeEventListener(PROFILE_EVENT, cb);
};

/**
 * Top of the mobile editor (#1392): quit button, live stats (distance, gain, loss) and compact full-width
 * profile, always visible (collapsible with a tap, preference remembered). Dragging on the profile = cursor +
 * point on the map (#1391). Fewer than two points: empty state of the same height, no layout shift.
 */
export function EditorMobileProfile({ ctl }: { ctl: EditorCtl }) {
  const t = useTranslations('editor');
  const cells = useEditorStats(ctl);
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);
  const { stats, doc, pending } = ctl;
  const toggle = () => {
    if (!collapsed) ctl.setProfileCursor(null);
    writeCollapsed(!collapsed);
  };

  return (
    <header className="z-10 flex flex-col gap-1 glass border-b border-border px-2 pt-[calc(4px+env(safe-area-inset-top))] pb-2 shadow-sm">
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size="icon" aria-label={t('quit')}>
          <Link href={ctl.quitHref} onClick={ctl.requestLeave}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="sr-only">{t(`title.${ctl.mode}`)}</h1>
        <dl className="flex min-w-0 flex-1 justify-around gap-1 text-center" aria-live="polite">
          {cells.map((c) => (
            <div key={c.key} className="min-w-0">
              <dt className="truncate text-caption text-muted-foreground">{c.label}</dt>
              <dd className="truncate text-body font-semibold tabular-nums">{c.value}</dd>
            </div>
          ))}
        </dl>
        {pending.length > 0 && <Loader2 aria-label={t('routing')} className="size-5 shrink-0 animate-spin text-muted-foreground" />}
        <AutosaveStatus ctl={ctl} showText={ctl.autosave === 'error'} />
        <Button variant="ghost" size="icon" aria-expanded={!collapsed} aria-label={collapsed ? t('showProfile') : t('hideProfile')} onClick={toggle}>
          {collapsed ? <ChevronDown /> : <ChevronUp />}
        </Button>
      </div>
      {!collapsed &&
        (stats.profile.length > 1 ? (
          <ElevationProfile points={stats.profile} slopes compact onScrub={(p) => ctl.setProfileCursor(p ? p.index : null)} />
        ) : (
          <div>
            {doc.waypoints.length < 2 ? (
              // Empty profile (#1406): a simple silhouette, no instructions; the text stays for screen readers.
              <div className="flex h-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <Mountain aria-hidden className="size-6 opacity-60" strokeWidth={1.5} />
                <span className="sr-only">{t('profileEmpty')}</span>
              </div>
            ) : (
              <p className="flex h-16 items-center justify-center rounded-2xl bg-muted px-4 text-center text-small text-muted-foreground">{t('profileNoEle')}</p>
            )}
            <div className="mt-1 min-h-6" />
          </div>
        ))}
    </header>
  );
}

/** Big toolbar button (≥ 56 px, icon + short label), within thumb reach. */
function BarButton({ label, icon: Icon, className, ...p }: React.ComponentProps<typeof Button> & { label: string; icon: typeof Route }) {
  return (
    <Button
      variant="ghost"
      className={cn('h-auto min-h-14 min-w-0 flex-col gap-1 rounded-2xl px-1 py-1.5 text-caption leading-tight whitespace-normal', className)}
      {...p}
    >
      <Icon aria-hidden />
      <span className="line-clamp-2 text-center">{label}</span>
    </Button>
  );
}

/**
 * Bottom of the mobile editor (#1392): toolbar (Undo · Redo · Paths/Straight · More · Save) or,
 * when a point is selected, its action bar (Delete, Cut before/after, Straight segment/Paths,
 * Close). Secondary actions and saving in drawers.
 */
export function EditorMobileBottom({ ctl }: { ctl: EditorCtl }) {
  const t = useTranslations('editor');
  const { state, dispatch, doc, pending, canSave, home } = ctl;
  const [more, setMore] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const sel = state.selected;
  const selSegNext = sel !== null ? doc.segments[sel] : undefined;

  // Short haptic feedback when a point is selected (if the phone allows it).
  useEffect(() => {
    if (sel !== null) navigator.vibrate?.(10);
  }, [sel]);

  const tool = (fn: () => void) => () => {
    fn();
    setMore(false);
  };

  return (
    <>
      <nav
        aria-label={sel !== null ? t('pointActions', { n: sel + 1 }) : t('toolsRegion')}
        className="glass z-10 border-t border-border px-2 pt-2 pb-[calc(8px+env(safe-area-inset-bottom))] shadow-md"
      >
        {sel !== null ? (
          <>
            <p className="px-2 pb-1 text-small font-semibold">{t('pointOf', { n: sel + 1, total: doc.waypoints.length })}</p>
            <div className="grid grid-cols-5 gap-1">
              <BarButton icon={Trash2} label={t('remove')} onClick={() => dispatch({ type: 'remove', i: sel })} />
              <BarButton icon={ArrowLeftToLine} label={t('trimBefore')} disabled={sel === 0} onClick={() => dispatch({ type: 'trimBefore', i: sel })} />
              <BarButton
                icon={ArrowRightToLine}
                label={t('trimAfter')}
                disabled={sel >= doc.waypoints.length - 1}
                onClick={() => dispatch({ type: 'trimAfter', i: sel })}
              />
              {selSegNext ? (
                <BarButton
                  icon={selSegNext.mode === 'route' ? Spline : Route}
                  label={selSegNext.mode === 'route' ? t('straight') : t('followPaths')}
                  onClick={() => dispatch({ type: 'segmentMode', seg: sel, mode: selSegNext.mode === 'route' ? 'line' : 'route' })}
                />
              ) : (
                <span />
              )}
              <BarButton icon={X} label={t('close')} onClick={() => dispatch({ type: 'select', i: null })} />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-5 gap-1">
            <BarButton icon={Undo2} label={t('undo')} disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })} />
            <BarButton icon={Redo2} label={t('redo')} disabled={state.future.length === 0} onClick={() => dispatch({ type: 'redo' })} />
            <BarButton
              icon={state.newMode === 'route' ? Route : Spline}
              label={state.newMode === 'route' ? t('modeRoute') : t('modeLine')}
              aria-label={t('modeButton', { mode: state.newMode === 'route' ? t('modeRoute') : t('modeLine') })}
              onClick={() => dispatch({ type: 'newMode', mode: state.newMode === 'route' ? 'line' : 'route' })}
            />
            <BarButton icon={Ellipsis} label={t('more')} aria-haspopup="dialog" onClick={() => setMore(true)} />
            <BarButton
              icon={pending.length > 0 ? Loader2 : Save}
              label={t(ctl.saveKey === 'publish' ? 'publish' : 'save')}
              variant="primary"
              className={cn(pending.length > 0 && '[&_svg]:animate-spin')}
              aria-label={pending.length > 0 ? t('routingEllipsis') : doc.waypoints.length < 2 ? t('needTwoPoints') : t(ctl.saveKey === 'publish' ? 'publish' : 'save')}
              disabled={!canSave}
              onClick={() => setSaveOpen(true)}
            />
          </div>
        )}
      </nav>

      <ActionSheet open={more} onOpenChange={setMore} title={t('moreTitle')}>
        <div className="grid grid-cols-1 gap-2">
          <Button variant="outline" className="justify-start" disabled={doc.waypoints.length < 2} onClick={tool(() => dispatch({ type: 'reverse' }))}>
            <ArrowLeftRight /> {t('reverse')}
          </Button>
          <Button variant="outline" className="justify-start" disabled={doc.waypoints.length < 2} onClick={tool(() => dispatch({ type: 'close' }))}>
            <Repeat /> {t('closeLoop')}
          </Button>
          <Button variant="outline" className="justify-start" onClick={tool(() => dispatch({ type: 'home', home }))}>
            <Home /> {t('fromHome')}
          </Button>
          <Button variant="outline" className="justify-start" disabled={doc.segments.length === 0} onClick={tool(() => dispatch({ type: 'allModes', mode: 'route' }))}>
            <Route /> {t('snapAll')}
          </Button>
        </div>
        {/* Magnet (#1437): on by default, remembered. */}
        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" role="switch" aria-checked={ctl.snapOn} className="justify-between" onClick={() => setSnapPref(!ctl.snapOn)}>
            <span className="flex items-center gap-2"><Magnet aria-hidden /> {t('snap.label')}</span>
            <span aria-hidden className={cn('h-6 w-11 rounded-full p-0.5 transition-colors', ctl.snapOn ? 'bg-primary' : 'bg-muted')}>
              <span className={cn('block size-5 rounded-full bg-card shadow-sm transition-transform', ctl.snapOn && 'translate-x-5')} />
            </span>
          </Button>
          <p className="text-small text-muted-foreground">{t('snap.hint')}</p>
        </div>
        {/* Routing rider (#1385): applies to the next computed segments. */}
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-body font-semibold">{t('rider.label')}</p>
          <ChoiceChips
            label={t('rider.label')}
            choices={[{ id: 'muscle', label: t('rider.muscle'), icon: Bike }, { id: 'ebike', label: t('rider.ebike'), icon: Zap }]}
            value={ctl.rider}
            onChange={(id) => setRider(id as Rider)}
          />
          <p className="text-small text-muted-foreground">{t('rider.hint')}</p>
        </div>
      </ActionSheet>

      <ActionSheet open={saveOpen} onOpenChange={setSaveOpen} title={t(`saveLabel.${ctl.saveKey}`)}>
        {ctl.stats.partial && <p className="mb-3 text-small text-muted-foreground">{t('partial')}</p>}
        <SaveForm ctl={ctl} />
      </ActionSheet>
    </>
  );
}
