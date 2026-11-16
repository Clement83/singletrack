'use client';

import { useEffect, useMemo, useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { CalendarDays, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatOutingDate } from '@/lib/format';
import { clusterOutings } from '@/lib/outings/map-cluster';
import type { MapOuting } from '@/lib/outings/map';

export type MapOutingDto = Omit<MapOuting, 'startsAt'> & { startsAt: string };
type View = [number, number, number, number];

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

/** Marqueurs HTML (le style de carte n'a pas de police) : pastille abricot « date · participants », ≥ 44 px, distincte des départs de traces. */
export function OutingsLayer({ outings, zoom, onSelect, onCluster }: { outings: MapOutingDto[]; zoom: number; onSelect: (id: string) => void; onCluster: (lat: number, lon: number) => void }) {
  const t = useTranslations('outingsMap');
  const locale = useLocale();
  const clusters = useMemo(() => clusterOutings(outings, zoom), [outings, zoom]);
  return clusters.map((c) => {
    const single = c.items.length === 1 ? c.items[0] : null;
    return (
      <Marker key={c.key} longitude={c.lon} latitude={c.lat} anchor="bottom" style={{ zIndex: 5 }}>
        <button
          type="button"
          aria-label={single ? t('markerLabel', { title: single.title, date: formatOutingDate(new Date(single.startsAt), locale), n: single.yesCount }) : t('clusterLabel', { n: c.items.length })}
          onClick={(e) => {
            e.stopPropagation();
            if (single) onSelect(single.id);
            else onCluster(c.lat, c.lon);
          }}
          className="flex min-h-touch min-w-touch items-center justify-center gap-1.5 rounded-full border-2 border-primary bg-accent px-3 text-caption font-semibold whitespace-nowrap text-accent-foreground tabular-nums shadow-md transition-transform duration-150 active:scale-95"
        >
          <CalendarDays aria-hidden className="size-4 shrink-0" />
          {single ? (
            <>
              <span>{formatOutingDate(new Date(single.startsAt), locale)}</span>
              <Users aria-hidden className="size-4 shrink-0" />
              <span>{single.yesCount}</span>
            </>
          ) : (
            <span>{c.items.length}</span>
          )}
        </button>
      </Marker>
    );
  });
}
