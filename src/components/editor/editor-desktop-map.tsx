'use client';

import { useEffect } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Marker } from 'react-map-gl/maplibre';
import { MapPinPlus, Route, Spline, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Deviation, LonLat } from '@/lib/editor/doc';
import { slopeClass, slopeCssColor } from '@/lib/geo/slopes';
import type { AltSet } from '@/lib/editor/alts';
import { choiceDeltas, choiceSegs, type ChoicePair, type ChoiceWhich } from '@/lib/editor/choice';
import { segmentLine } from '@/lib/editor/doc';
import type { EditorCtl } from './track-editor';

export type LineMenuState = { seg: number; p: LonLat } | null;
export type HoverTipState = { x: number; y: number; km: number; ele: number | null; grade: number | null } | null;

/**
 * Right-click menu on the line (desktop, #1384): insert a point here, switch the segment to a straight line or
 * to the paths. The same actions exist without a right click (click on the line, point popover): nothing
 * is mouse-only. Escape or a click on the map closes it.
 */
export function LineMenu({ ctl, menu, onClose }: { ctl: EditorCtl; menu: NonNullable<LineMenuState>; onClose: () => void }) {
  const t = useTranslations('editor');
  const seg = ctl.doc.segments[menu.seg];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!seg) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <Marker longitude={menu.p[0]} latitude={menu.p[1]} anchor="top-left" offset={[8, 8]}>
      <div
        role="menu"
        aria-label={t('lineMenu')}
        onClick={stop}
        onMouseDown={stop}
        onPointerDown={stop}
        onContextMenu={(e) => {
          e.preventDefault();
          stop(e);
        }}
        className="flex w-64 cursor-default flex-col gap-0.5 glass rounded-2xl border border-border p-1.5 text-popover-foreground shadow-md"
      >
        <div className="flex items-center justify-between pl-2">
          <span className="text-small font-medium">{t('lineMenu')}</span>
          <Button variant="ghost" size="icon" aria-label={t('close')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <Button role="menuitem" variant="ghost" className="w-full justify-start" onClick={run(() => ctl.dispatch({ type: 'insert', seg: menu.seg, p: menu.p }))}>
          <MapPinPlus aria-hidden /> {t('insertHere')}
        </Button>
        <Button
          role="menuitem"
          variant="ghost"
          className="w-full justify-start"
          onClick={run(() => ctl.dispatch({ type: 'segmentMode', seg: menu.seg, mode: seg.mode === 'route' ? 'line' : 'route' }))}
        >
          {seg.mode === 'route' ? <Spline aria-hidden /> : <Route aria-hidden />} {seg.mode === 'route' ? t('straight') : t('followPaths')}
        </Button>
      </div>
    </Marker>
  );
}

/** Tooltip when hovering the line or a point (desktop, #1384): km, elevation, slope. Purely informative. */
export function HoverTip({ tip }: { tip: NonNullable<HoverTipState> }) {
  const tp = useTranslations('profile');
  const format = useFormatter();
  const km = format.number(tip.km, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const cls = tip.grade === null ? null : slopeClass(tip.grade);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-20 flex items-center gap-2 rounded-lg bg-popover px-2.5 py-1.5 text-small whitespace-nowrap text-popover-foreground tabular-nums shadow-md"
      style={{ left: tip.x + 14, top: tip.y + 14 }}
    >
      <span className="font-medium">{tip.ele === null ? tp('summaryKm', { km }) : tp('point', { km, ele: format.number(Math.round(tip.ele)) })}</span>
      {cls && tip.grade !== null && (
        <span className="flex items-center gap-1.5">
          <i className="size-2.5 rounded-full" style={{ background: slopeCssColor(cls) }} />
          {tp('grade', { grade: format.number(Math.round(tip.grade)) })}
        </span>
      )}
    </div>
  );
}

/**
 * Why this segment makes a detour (#1385): « +0,9 km, −140 m de D+ », placed in the middle of the re-routed segment,
 * quelques secondes, discret et non cliquable (mobile et desktop).
 */
export function RouteNoteMarker({ note }: { note: { p: LonLat; extraKm: number; gainSavedM: number | null } }) {
  const t = useTranslations('editor');
  const format = useFormatter();
  const km = format.number(note.extraKm, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });
  return (
    <Marker longitude={note.p[0]} latitude={note.p[1]} anchor="bottom" offset={[0, -10]} style={{ pointerEvents: 'none' }}>
      <span role="status" className="rounded-full bg-popover px-2.5 py-1 text-small font-medium whitespace-nowrap text-popover-foreground tabular-nums shadow-md">
        {note.gainSavedM !== null && note.gainSavedM > 0
          ? t('routeNote', { km, gain: format.number(Math.round(note.gainSavedM)) })
          : t('routeNoteKm', { km })}
      </span>
    </Marker>
  );
}

/** Short text of a route of `alts`: "+5 km · gentler" or "Recommended" (#1386). */
function useAltText(alts: AltSet) {
  const t = useTranslations('editor');
  const format = useFormatter();
  return (i: number) => {
    const l = alts.labels[i];
    if (!l) return t('alt.recommended');
    const km = format.number(l.deltaKm, { minimumFractionDigits: Math.abs(l.deltaKm) < 10 ? 1 : 0, maximumFractionDigits: 1, signDisplay: 'always' });
    return t('alt.label', { km, quality: t(`alt.quality.${l.quality}`) });
  };
}

/**
 * Chips of the routes not kept, on the map (desktop, #1386): a click = choose this route for the
 * segment. The choice is also possible from the keyboard (key A cycles): nothing is hover-only.
 */
export function AltLabels({ alts, onChoose }: { alts: AltSet; onChoose: (i: number) => void }) {
  const text = useAltText(alts);
  return alts.routes.map((r, i) => {
    if (i === alts.active) return null;
    const mid = r[Math.floor(r.length / 2)];
    return (
      <Marker key={i} longitude={mid[0]} latitude={mid[1]} anchor="center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChoose(i);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className="min-h-11 rounded-full border border-border bg-popover px-3 text-small font-medium whitespace-nowrap text-popover-foreground tabular-nums shadow-md hover:bg-accent"
        >
          {text(i)}
        </button>
      </Marker>
    );
  });
}

/** Small floating card above the bottom bar (mobile, #1386): one button ≥ 44 px per route. */
export function AltCard({ alts, onChoose, raised = false }: { alts: AltSet; onChoose: (i: number) => void; raised?: boolean }) {
  const t = useTranslations('editor');
  const text = useAltText(alts);
  return (
    <div
      role="group"
      aria-label={t('alt.title')}
      className={cn('absolute inset-x-3 z-10 flex gap-1.5 glass rounded-2xl border border-border p-1.5 shadow-md', raised ? 'bottom-[4.75rem]' : 'bottom-3')}
    >
      {alts.routes.map((_, i) => (
        <Button
          key={i}
          variant={i === alts.active ? 'primary' : 'ghost'}
          aria-pressed={i === alts.active}
          className="h-auto min-h-11 min-w-0 flex-1 px-2 py-1.5 text-small leading-tight whitespace-normal tabular-nums"
          onClick={() => onChoose(i)}
        >
          {text(i)}
        </Button>
      ))}
    </div>
  );
}

/** Original route replaced by a detour (#1451): chip on the grey line (desktop). */
export function DeviationLabel({ deviation, onRestore }: { deviation: Deviation; onRestore: () => void }) {
  const t = useTranslations('editor');
  const mid = deviation.path[Math.floor(deviation.path.length / 2)];
  return (
    <Marker longitude={mid[0]} latitude={mid[1]} anchor="center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRestore();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className="min-h-11 rounded-full border border-border bg-popover px-3 text-small font-medium whitespace-nowrap text-popover-foreground shadow-md hover:bg-accent"
      >
        {t('deviation.restore')}
      </button>
    </Marker>
  );
}

/** Mobile floating card: one button ≥ 44 px to restore the original route (#1451). */
export function DeviationCard({ onRestore }: { onRestore: () => void }) {
  const t = useTranslations('editor');
  return (
    <div role="group" aria-label={t('deviation.title')} className="absolute inset-x-3 bottom-3 z-10 glass rounded-2xl border border-border p-1.5 shadow-md">
      <Button variant="ghost" className="min-h-11 w-full" onClick={onRestore}>
        {t('deviation.restore')}
      </Button>
    </div>
  );
}

/**
 * Label of each path of a choice pair (desktop, #1642): km and gain difference from the other
 * option, placed on the line. A click = select this path; the selected one is marked by `aria-pressed`.
 */
export function ChoiceLabels({ choice, onSelect }: { choice: ChoicePair; onSelect: (w: ChoiceWhich) => void }) {
  const t = useTranslations('editor');
  const format = useFormatter();
  const d = choiceDeltas(choice);
  return (['new', 'old'] as const).map((w) => {
    const doc = w === 'new' ? choice.new : choice.old;
    const line = choiceSegs(choice, w).flatMap((k) => segmentLine(doc, k));
    if (line.length === 0) return null;
    const mid = line[Math.floor(line.length / 2)];
    const km = format.number(d[w].km, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });
    const g = d[w].gainM;
    const text = g === null ? t('choice.labelKm', { km }) : t('choice.label', { km, gain: format.number(Math.round(g), { signDisplay: 'always' }) });
    const on = choice.selected === w;
    return (
      <Marker key={w} longitude={mid[0]} latitude={mid[1]} anchor="center">
        <button
          type="button"
          aria-pressed={on}
          aria-label={`${t(`choice.${w}`)} : ${text}`}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(w);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            'min-h-11 rounded-full border-2 px-3 text-small font-medium whitespace-nowrap tabular-nums shadow-md',
            on ? 'border-primary bg-popover text-popover-foreground' : 'border-border bg-popover text-popover-foreground hover:bg-accent',
          )}
        >
          {text}
        </button>
      </Marker>
    );
  });
}
