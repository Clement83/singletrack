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
import type { EditorCtl } from './track-editor';

export type LineMenuState = { seg: number; p: LonLat } | null;
export type HoverTipState = { x: number; y: number; km: number; ele: number | null; grade: number | null } | null;

/**
 * Menu du clic droit sur la ligne (desktop, #1384) : insérer un point ici, passer le tronçon en ligne droite ou
 * sur les chemins. Les mêmes actions existent sans clic droit (clic sur la ligne, popover du point) : rien
 * n'est réservé à la souris. Échap ou un clic sur la carte le ferment.
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
        className="flex w-64 cursor-default flex-col gap-0.5 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      >
        <div className="flex items-center justify-between pl-2">
          <span className="text-small font-semibold">{t('lineMenu')}</span>
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

/** Infobulle au survol de la ligne ou d'un point (desktop, #1384) : km, altitude, pente. Purement informative. */
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
      <span className="font-semibold">{tip.ele === null ? tp('summaryKm', { km }) : tp('point', { km, ele: format.number(Math.round(tip.ele)) })}</span>
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
 * Pourquoi ce tronçon fait un détour (#1385) : « +0,9 km, −140 m de D+ », posé au milieu du tronçon recalé,
 * quelques secondes, discret et non cliquable (mobile et desktop).
 */
export function RouteNoteMarker({ note }: { note: { p: LonLat; extraKm: number; gainSavedM: number | null } }) {
  const t = useTranslations('editor');
  const format = useFormatter();
  const km = format.number(note.extraKm, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'always' });
  return (
    <Marker longitude={note.p[0]} latitude={note.p[1]} anchor="bottom" offset={[0, -10]} style={{ pointerEvents: 'none' }}>
      <span role="status" className="rounded-full bg-popover px-2.5 py-1 text-small font-semibold whitespace-nowrap text-popover-foreground tabular-nums shadow-md">
        {note.gainSavedM !== null && note.gainSavedM > 0
          ? t('routeNote', { km, gain: format.number(Math.round(note.gainSavedM)) })
          : t('routeNoteKm', { km })}
      </span>
    </Marker>
  );
}

/** Texte court d'un itinéraire de `alts` : « +5 km · plus doux » ou « Recommandé » (#1386). */
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
 * Pastilles des itinéraires non retenus sur la carte (desktop, #1386) : un clic = choisir cet itinéraire pour le
 * tronçon. Le choix reste aussi possible au clavier (touche A fait défiler) : rien n'est réservé au survol.
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
          className="min-h-11 rounded-full border border-border bg-popover px-3 text-small font-semibold whitespace-nowrap text-popover-foreground tabular-nums shadow-md hover:bg-accent"
        >
          {text(i)}
        </button>
      </Marker>
    );
  });
}

/** Petite carte flottante au-dessus de la barre du bas (mobile, #1386) : un bouton ≥ 44 px par itinéraire. */
export function AltCard({ alts, onChoose, raised = false }: { alts: AltSet; onChoose: (i: number) => void; raised?: boolean }) {
  const t = useTranslations('editor');
  const text = useAltText(alts);
  return (
    <div
      role="group"
      aria-label={t('alt.title')}
      className={cn('absolute inset-x-3 z-10 flex gap-1.5 rounded-2xl border border-border bg-card p-1.5 shadow-md', raised ? 'bottom-[4.75rem]' : 'bottom-3')}
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

/** Parcours d'origine remplacé par une déviation (#1451) : pastille sur la ligne grise (desktop). */
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
        className="min-h-11 rounded-full border border-border bg-popover px-3 text-small font-semibold whitespace-nowrap text-popover-foreground shadow-md hover:bg-accent"
      >
        {t('deviation.restore')}
      </button>
    </Marker>
  );
}

/** Carte flottante mobile : un bouton ≥ 44 px pour rétablir le parcours d'origine (#1451). */
export function DeviationCard({ onRestore }: { onRestore: () => void }) {
  const t = useTranslations('editor');
  return (
    <div role="group" aria-label={t('deviation.title')} className="absolute inset-x-3 bottom-3 z-10 rounded-2xl border border-border bg-card p-1.5 shadow-md">
      <Button variant="ghost" className="min-h-11 w-full" onClick={onRestore}>
        {t('deviation.restore')}
      </Button>
    </div>
  );
}
