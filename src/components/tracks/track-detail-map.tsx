'use client';

import type { RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import { Flag, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import BaseMap from '@/components/BaseMap';
import { SlopeRouteLayer } from '@/components/map/slope-route-layer';
import { KmMarkers } from '@/components/map/km-markers';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
import { Flyover, type FlyoverLink } from '@/components/map/flyover';
import { ProfileCursorMarker } from '@/components/map/profile-cursor-marker';
import { nearestProfileIndex, type LocatedProfilePoint } from '@/lib/elevation';
import type { SlopeCollection } from '@/lib/geo/slope-features';
import type { TrackGeometry } from '@/lib/geo/types';
import type { MapColors } from './use-map-colors';

type Props = {
  geometry: TrackGeometry;
  bbox: [number, number, number, number];
  start: [number, number];
  end: [number, number];
  profile: LocatedProfilePoint[];
  data: SlopeCollection;
  colors: MapColors;
  mapRef: RefObject<MapRef | null>;
  marked: LocatedProfilePoint | null;
  setHover: (i: number | null) => void;
  /** `false`: frozen preview (#1621); the full-screen enlargement stays interactive. */
  interactive?: boolean;
  /** Map embedded in a scrolling page (two fingers). `false` in full screen. */
  embedded?: boolean;
  /** 3D flyover (#1690), desktop: link with the profile. Absent = no button. */
  flyover?: FlyoverLink;
};

/**
 * Sheet map (#1391), isolated in its own module (#1371): react-map-gl and MapLibre are only
 * downloaded when the map gets close, never at page hydration.
 */
export default function TrackDetailMap({ geometry, bbox, start, end, profile, data, colors, mapRef, marked, setHover, interactive = true, embedded = true, flyover }: Props) {
  const t = useTranslations('track');
  // "km from the start" tooltip (#1535): mouse hover, finger tap; elevation from the profile.
  const { tip, onMove, onTap, clear } = useTrackTip((e) =>
    e.features?.length ? { geometry, ele: (lon, lat) => profile[nearestProfileIndex(profile, lon, lat)]?.ele ?? null } : null,
  );
  return (
    <BaseMap
      lat={start[1]}
      lon={start[0]}
      embedded={embedded}
      interactive={interactive}
      terrain
      mapRef={mapRef}
      bounds={bbox}
      boundsPadding={40}
      interactiveLayerIds={['route-casing']}
      onMouseMove={(e) => { setHover(e.features?.length ? nearestProfileIndex(profile, e.lngLat.lng, e.lngLat.lat) : null); onMove(e); }}
      onClick={onTap}
      onMouseLeave={() => { setHover(null); clear(); }}
    >
      <SlopeRouteLayer id="route" data={data} colors={colors} />
      <KmMarkers geometry={geometry} />
      <Marker longitude={start[0]} latitude={start[1]} anchor="bottom">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md" role="img" aria-label={t('start')}><MapPin className="size-5" /></span>
      </Marker>
      <Marker longitude={end[0]} latitude={end[1]} anchor="bottom">
        <span className="flex size-9 items-center justify-center rounded-full bg-foreground text-background shadow-md" role="img" aria-label={t('end')}><Flag className="size-5" /></span>
      </Marker>
      <TrackTip tip={tip} />
      {flyover && <Flyover geometry={geometry} profile={profile} link={flyover} barClassName={embedded ? undefined : 'bottom-40 right-16'} />}
      {marked && !flyover?.active && <ProfileCursorMarker mapRef={mapRef} lon={marked.lon} lat={marked.lat} />}
    </BaseMap>
  );
}
