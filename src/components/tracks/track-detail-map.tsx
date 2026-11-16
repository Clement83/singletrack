'use client';

import type { RefObject } from 'react';
import { Marker, type MapRef } from 'react-map-gl/maplibre';
import { Flag, MapPin } from 'lucide-react';
import { useTranslations } from 'next-intl';
import BaseMap from '@/components/BaseMap';
import { SlopeRouteLayer } from '@/components/map/slope-route-layer';
import { KmMarkers } from '@/components/map/km-markers';
import { TrackTip, useTrackTip } from '@/components/map/track-tip';
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
};

/**
 * Carte de la fiche (#1391), isolée dans son propre module (#1371) : react-map-gl et MapLibre ne sont
 * téléchargés qu'à l'approche de la carte, jamais à l'hydratation de la page.
 */
export default function TrackDetailMap({ geometry, bbox, start, end, profile, data, colors, mapRef, marked, setHover }: Props) {
  const t = useTranslations('track');
  // Infobulle « km depuis le départ » (#1535) : survol à la souris, tap au doigt ; altitude du profil.
  const { tip, onMove, onTap, clear } = useTrackTip((e) =>
    e.features?.length ? { geometry, ele: (lon, lat) => profile[nearestProfileIndex(profile, lon, lat)]?.ele ?? null } : null,
  );
  return (
    <BaseMap
      lat={start[1]}
      lon={start[0]}
      embedded
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
      {marked && <ProfileCursorMarker mapRef={mapRef} lon={marked.lon} lat={marked.lat} />}
    </BaseMap>
  );
}
