'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { gradeAt, indexAtX, type ProfilePoint } from '@/lib/elevation';
import { autoKmStep, edgeGrades, slopeClass, slopeCssColor } from '@/lib/geo/slopes';

type Props = {
  points: ProfilePoint[];
  /** Appelé quand le curseur bouge (survol souris, glisser au doigt, flèches) avec le point visé, `null` quand il disparaît. */
  onScrub?: (point: (ProfilePoint & { index: number }) | null) => void;
  /** Curseur imposé de l'extérieur (ex. survol de la trace sur la carte), affiché quand le profil lui-même n'est pas visé. */
  cursor?: number | null;
  /** Colore chaque tronçon selon la pente (montée douce / raide, descente) et affiche la légende. */
  slopes?: boolean;
  /** Version basse (éditeur mobile, #1392) : profil de 64 px, sans légende. */
  compact?: boolean;
  /** Légende des pentes sous le profil (défaut : oui). La carte des traces la porte sur la carte (#1582). */
  legend?: boolean;
  className?: string;
};

// Classes Tailwind écrites en toutes lettres (le scanner ne voit pas les noms construits).
const UP_BG = ['bg-slope-up-1', 'bg-slope-up-2', 'bg-slope-up-3', 'bg-slope-up-4', 'bg-slope-up-5'];
const DOWN_BG = ['bg-slope-down-1', 'bg-slope-down-2', 'bg-slope-down-3', 'bg-slope-down-4', 'bg-slope-down-5'];

/** Largeur de repli avant la première mesure (rendu serveur). Le SVG est ensuite dessiné à la largeur réelle de son bloc (#1445). */
const DEFAULT_W = 320;

/**
 * Profil altimétrique partagé (fiche trace, sorties, éditeur) avec curseur synchronisé avec la carte (#1391) :
 * - souris : le curseur suit le **survol**, sans clic, et disparaît en sortant ;
 * - doigt : on glisse (pointer events, `touch-action: pan-y` pour garder le scroll vertical de la page) ;
 * - clavier : flèches gauche/droite (Maj = 10 points), Début/Fin, Échap.
 * Le curseur montre km, altitude et pente du tronçon (couleur + libellé) ; `onScrub` donne le point à marquer sur la carte.
 */
export function ElevationProfile({ points, onScrub, cursor = null, slopes = false, compact = false, legend = true, className }: Props) {
  const t = useTranslations('profile');
  const format = useFormatter();
  const ref = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [W, setW] = useState(DEFAULT_W);
  const H = compact ? 64 : 128; // = h-16 / h-32 : 1 unité du viewBox = 1 px, rien n'est déformé ni centré en bandes.
  const ready = points.length >= 2;
  // Largeur mesurée en continu (ResizeObserver) : le tracé suit le bloc, le curseur reste aligné sur la souris.
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
        {/* Graduation km (#1382) : mêmes bornes que les pastilles de la carte, pas automatique. */}
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
      {/* Étiquette du curseur : hauteur fixe et chiffres tabulaires, pas de saut de mise en page. */}
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
