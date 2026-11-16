'use client';

import { useEffect, useMemo, useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { CalendarDays } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { clusterOutings, type OutingCluster } from '@/lib/outings/map-cluster';
import { clusterTipLines, outingPeopleLine, outingStatsLine, outingTipDate } from '@/lib/outings/map-tip';
import type { MapOuting } from '@/lib/outings/map';

export type MapOutingDto = Omit<MapOuting, 'startsAt'> & { startsAt: string };
type View = [number, number, number, number];
type Item = MapOutingDto;

/** Sorties à venir de la vue (#1461) : `null` tant que rien n'est chargé ; échec silencieux (la carte reste utilisable). */
export function useMapOutings(on: boolean, view: View | null) {
  const [data, setData] = useState<MapOutingDto[]>([]);
  const key = view ? view.map((n) => n.toFixed(2)).join(',') : null;
  useEffect(() => {
    if (!on || !view || !key) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      const px = (view[2] - view[0]) * 0.1;
      const py = (view[3] - view[1]) * 0.1;
      const bbox = [view[0] - px, view[1] - py, view[2] + px, view[3] + py].map((n) => n.toFixed(4)).join(',');
      fetch(`/api/outings/map?bbox=${bbox}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((d: { outings: MapOutingDto[] }) => setData(d.outings))
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // `view` est résumé par `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key]);
  return on ? data : [];
}

/**
 * Repères des sorties (#1461, réduits en #1538) : une petite pastille abricot à icône calendrier, dans une zone
 * tactile de 44 px. Survol souris ou focus clavier : infobulle avec le détail (titre, date, participants, km · D+).
 * Tap (ou clic) : ouvre la fiche. Une grappe garde la même pastille, avec le nombre, et liste ses sorties au survol.
 */
export function OutingsLayer({ outings, zoom, onSelect, onCluster }: { outings: MapOutingDto[]; zoom: number; onSelect: (id: string) => void; onCluster: (lat: number, lon: number) => void }) {
  const clusters = useMemo(() => clusterOutings(outings, zoom), [outings, zoom]);
  return clusters.map((c) => (
    <OutingPin key={c.key} cluster={c} onSelect={onSelect} onCluster={onCluster} />
  ));
}

function OutingPin({ cluster: c, onSelect, onCluster }: { cluster: OutingCluster<Item>; onSelect: (id: string) => void; onCluster: (lat: number, lon: number) => void }) {
  const t = useTranslations('outingsMap');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const single = c.items.length === 1 ? c.items[0] : null;
  const label = single
    ? t('markerLabel', { title: single.title, date: outingTipDate(single, locale), n: single.yesCount })
    : t('clusterLabel', { n: c.items.length });

  return (
    <Marker longitude={c.lon} latitude={c.lat} anchor="bottom" style={{ zIndex: open ? 6 : 5 }}>
      <div className="relative">
        <button
          type="button"
          aria-label={label}
          onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
          onPointerLeave={(e) => { if (e.pointerType === 'mouse') setOpen(false); }}
          onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setOpen(true); }}
          onBlur={() => setOpen(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (single) onSelect(single.id);
            else onCluster(c.lat, c.lon);
          }}
          className="relative flex min-h-touch min-w-touch items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-full border-2 border-primary bg-accent text-accent-foreground shadow-md transition-transform duration-150 active:scale-95"
          >
            <CalendarDays className="size-3.5" />
          </span>
          {!single && (
            <span aria-hidden className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-4 font-semibold text-primary-foreground tabular-nums">
              {c.items.length}
            </span>
          )}
        </button>
        {open && (
          <div role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 mb-1 w-max max-w-[16rem] -translate-x-1/2 rounded-xl bg-popover px-3 py-2 text-small text-popover-foreground shadow-md">
            {single ? (
              <>
                <p className="truncate font-semibold">{single.title}</p>
                <p className="tabular-nums">{outingTipDate(single, locale)}</p>
                <p className="tabular-nums">{outingPeopleLine(single, (k, v) => t(k, v))}</p>
                <p className="tabular-nums">{outingStatsLine(single, locale)}</p>
              </>
            ) : (
              <ul className="space-y-1">
                {clusterTipLines(c.items, locale).map((l, i) => (
                  <li key={i} className="tabular-nums">
                    <span className="font-semibold">{l.title}</span> · {l.date}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Marker>
  );
}
