'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { gradeAt, indexAtX, type ProfilePoint } from '@/lib/elevation';
import { autoKmStep, edgeGrades, slopeClass, slopeCssColor } from '@/lib/geo/slopes';

type Props = {
  points: ProfilePoint[];
  /** Called when the cursor moves (mouse hover, finger drag, arrows) with the targeted point, `null` when it disappears. */
  onScrub?: (point: (ProfilePoint & { index: number }) | null) => void;
  /** Cursor imposed from outside (e.g. hovering the track on the map), shown when the profile itself is not targeted. */
  cursor?: number | null;
  /** Colours each segment by slope (gentle / steep climb, descent) and shows the legend. */
  slopes?: boolean;
  /** Low version (mobile editor, #1392): 64 px profile, no legend. */
  compact?: boolean;
  /** Slope legend under the profile (default: yes). The track map carries it on the map (#1582). */
  legend?: boolean;
  className?: string;
};

// Tailwind classes written out in full (the scanner does not see built names).
const UP_BG = ['bg-slope-up-1', 'bg-slope-up-2', 'bg-slope-up-3', 'bg-slope-up-4', 'bg-slope-up-5'];
const DOWN_BG = ['bg-slope-down-1', 'bg-slope-down-2', 'bg-slope-down-3', 'bg-slope-down-4', 'bg-slope-down-5'];

/** Fallback width before the first measurement (server rendering). The SVG is then drawn at the real width of its block (#1445). */
const DEFAULT_W = 320;

/**
 * Shared elevation profile (track sheet, outings, editor) with a cursor synchronised with the map (#1391):
 * - mouse: the cursor follows the **hover**, no click, and disappears when leaving;
 * - finger: drag (pointer events, `touch-action: pan-y` to keep the page's vertical scroll);
 * - keyboard: left/right arrows (Shift = 10 points), Home/End, Escape.
 * The cursor shows km, elevation and the segment's slope (colour + label); `onScrub` gives the point to mark on the map.
 */
export function ElevationProfile({ points, onScrub, cursor = null, slopes = false, compact = false, legend = true, className }: Props) {
  const t = useTranslations('profile');
  const format = useFormatter();
  const ref = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [W, setW] = useState(DEFAULT_W);
  const H = compact ? 64 : 128; // = h-16 / h-32: 1 viewBox unit = 1 px, nothing is distorted or letterboxed.
  const ready = points.length >= 2;
  // Width measured continuously (ResizeObserver): the line follows the block, the cursor stays aligned with the mouse.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setW(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  const titleId = useId();
  const eles = useMemo(() => points.map((p) => p.ele), [points]);
  const grades = useMemo(() => (points.length > 1 ? edgeGrades(points.map((p) => p.distKm * 1000), eles) : []), [points, eles]);
  if (points.length < 2) return null;

  const min = Math.min(...eles);
  const max = Math.max(...eles);
  const span = max - min || 1;
  const maxKm = points[points.length - 1].distKm || 1;
  const x = (p: ProfilePoint) => (p.distKm / maxKm) * W;
  const y = (p: ProfilePoint) => H - 8 - ((p.ele - min) / span) * (H - 24);
  const line = points.map((p) => `${x(p).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  const tickStep = autoKmStep(maxKm);
  const ticks = Array.from({ length: Math.floor(maxKm / tickStep + 1e-9) }, (_, i) => (i + 1) * tickStep).filter((k) => k < maxKm);
  const hasEstimated = points.some((p) => p.estimated);
  const area = `0,${H} ${line} ${W},${H}`;

  const select = (i: number | null) => {
    if (i === active) return;
    setActive(i);
    onScrub?.(i === null ? null : { ...points[i], index: i });
  };
  const fromEvent = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    select(indexAtX(points, ((clientX - r.left) / r.width) * W, W));
  };
  const shown = active ?? (cursor !== null && cursor >= 0 && cursor < points.length ? cursor : null);
  const cur = shown === null ? null : points[shown];
  const grade = shown === null ? null : gradeAt(grades, shown);
  const cls = grade === null ? null : slopeClass(grade);

  const km = (v: number) => format.number(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const m = (v: number) => format.number(Math.round(v));
  const step = (e: React.KeyboardEvent, d: number) => {
    e.preventDefault();
    select(Math.min(Math.max((active ?? (d > 0 ? -1 : points.length)) + d, 0), points.length - 1));
  };

  return (
    <figure className={className}>
      <svg
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={active ?? 0}
        aria-valuetext={cur ? t('point', { km: km(cur.distKm), ele: m(cur.ele) }) : undefined}
        viewBox={`0 0 ${W} ${H}`}
        className={`${compact ? 'h-16' : 'h-32'} min-h-touch w-full cursor-crosshair touch-pan-y rounded-xl border border-border bg-muted/60 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture(e.pointerId);
          fromEvent(e.clientX);
        }}
        onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons > 0) && fromEvent(e.clientX)}
        onPointerUp={(e) => e.pointerType !== 'mouse' && select(null)}
        onPointerCancel={() => select(null)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && select(null)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') step(e, e.shiftKey ? 10 : 1);
          else if (e.key === 'ArrowLeft') step(e, e.shiftKey ? -10 : -1);
          else if (e.key === 'Home') step(e, -points.length);
          else if (e.key === 'End') step(e, points.length);
          else if (e.key === 'Escape') select(null);
        }}
        onBlur={() => select(null)}
      >
        <title id={titleId}>{t('title')}</title>
        <polygon points={area} fill="var(--accent)" />
        {/* Km scale (#1382): same markers as the map chips, automatic step. */}
        {ticks.map((k) => (
          <g key={k} pointerEvents="none">
            <line x1={(k / maxKm) * W} x2={(k / maxKm) * W} y1={compact ? 0 : 14} y2={H} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {!compact && (
              <text x={(k / maxKm) * W} y={10} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)" className="font-medium tabular-nums">
                {format.number(k)}
              </text>
            )}
          </g>
        ))}
        {slopes ? (
          points.slice(1).map((p, i) => {
            const a = points[i];
            const est = a.estimated || p.estimated;
            return <line key={i} x1={x(a)} y1={y(a)} x2={x(p)} y2={y(p)} stroke={slopeCssColor(slopeClass(grades[i]))} strokeWidth={3} strokeLinecap={est ? 'butt' : 'round'} strokeDasharray={est ? '4 4' : undefined} opacity={est ? 0.7 : 1} />;
          })
        ) : (
          points.slice(1).map((p, i) => {
            const a = points[i];
            const est = a.estimated || p.estimated;
            return <line key={i} x1={x(a)} y1={y(a)} x2={x(p)} y2={y(p)} stroke="var(--primary)" strokeWidth={2} strokeDasharray={est ? '4 4' : undefined} />;
          })
        )}
        {cur && (
          <g pointerEvents="none">
            <line x1={x(cur)} x2={x(cur)} y1={0} y2={H} stroke="var(--foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(cur)} cy={y(cur)} r={5} fill="var(--foreground)" stroke="var(--card)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {/* Cursor label: fixed height and tabular figures, no layout shift. */}
      <figcaption className="mt-1.5 flex min-h-6 min-w-0 items-center gap-2 text-small text-muted-foreground tabular-nums" aria-live="polite">
        {cur ? (
          <>
            <span className="font-semibold text-foreground">
              {t('point', { km: km(cur.distKm), ele: m(cur.ele) })}
              {cur.estimated ? ` ${t('estimatedMark')}` : ''}
            </span>
            {cls && grade !== null && (
              <span className="flex min-w-0 items-center gap-1.5">
                <i aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: slopeCssColor(cls) }} />
                <span className="truncate">
                  {t('grade', { grade: format.number(Math.round(grade)) })} · {t(`levels.${cls.id as 'flat'}`)}
                </span>
              </span>
            )}
          </>
        ) : (
          t('summary', { km: km(maxKm), min: m(min), max: m(max) })
        )}
      </figcaption>
      {hasEstimated && !compact && (
        <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
          <svg aria-hidden width="24" height="4" className="shrink-0"><line x1="0" y1="2" x2="24" y2="2" stroke="var(--muted-foreground)" strokeWidth={3} strokeDasharray="4 4" /></svg>
          {t('estimated')}
        </p>
      )}
      {slopes && legend && !compact && (
        <div className="mt-1 space-y-1 text-caption text-muted-foreground">
          {(['up', 'down'] as const).map((dir) => (
            <p key={dir} className="flex items-center gap-1">
              <span className="w-16">{t(dir)}</span>
              {[1, 2, 3, 4, 5].map((l) => (
                <i key={l} aria-hidden className={`h-2.5 w-6 rounded-full ${dir === 'up' ? UP_BG[l - 1] : DOWN_BG[l - 1]}`} />
              ))}
              <span className="ml-1">{dir === 'up' ? t('upRange') : t('downRange')}</span>
            </p>
          ))}
        </div>
      )}
    </figure>
  );
}
