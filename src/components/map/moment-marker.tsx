'use client';

import { useState } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { Flag } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

export type MomentPoint = { id: string; lat: number; lon: number; at: number | null; name: string | null };

/**
 * Key moment of a ridden track (#1798): small flag marker in the style of the photo/video chips (32 px disc, 44 px touch
 * area) with its name next to it (truncated; the full name on tap/click). Without a name: "Key moment" + time.
 * `interactive={false}` (summary player) draws the label only, the player's map is not touchable.
 */
export function MomentMarker({ moment, interactive = true, onDark = false }: { moment: MomentPoint; interactive?: boolean; onDark?: boolean }) {
  const t = useTranslations('moments');
  const f = useFormatter();
  const [open, setOpen] = useState(false);
  const time = moment.at != null ? f.dateTime(moment.at, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : null;
  const text = moment.name ?? [t('label'), time].filter(Boolean).join(' · ');
  const aria = time ? t('aria', { name: moment.name ?? t('label'), time }) : text;
  const disc = (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground shadow-md">
      <Flag aria-hidden className="size-4" />
    </span>
  );
  const label = (
    <span
      className={`ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium shadow-sm ${onDark ? 'bg-media-surface/70 text-media-foreground' : 'bg-card text-card-foreground'} ${open ? 'max-w-64 whitespace-normal' : 'max-w-28 truncate'}`}
      data-testid="moment-label"
    >
      {text}
    </span>
  );
  return (
    <Marker longitude={moment.lon} latitude={moment.lat} anchor="left" style={interactive ? undefined : { pointerEvents: 'none' }}>
      {interactive ? (
        <button type="button" aria-label={aria} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-touch items-center text-left" data-testid="ride-map-moment">
          {disc}
          {label}
        </button>
      ) : (
        <span className="flex items-center" role="img" aria-label={aria} data-testid="summary-moment">
          {disc}
          {label}
        </span>
      )}
    </Marker>
  );
}
