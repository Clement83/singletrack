'use client';

import { useEffect, useState } from 'react';
import { Layer, useMap } from 'react-map-gl/maplibre';

/** Petite flèche blanche cernée, dessinée en canvas : le sens de parcours sans police de glyphes. */
export function arrowImage(fill: string, stroke: string) {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.moveTo(size * 0.82, size / 2);
  g.lineTo(size * 0.25, size * 0.2);
  g.lineTo(size * 0.4, size / 2);
  g.lineTo(size * 0.25, size * 0.8);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.stroke();
  g.fill();
  return g.getImageData(0, 0, size, size);
}

/** Flèches de direction le long d'une source de lignes (à placer dans le `<Source>` concerné). */
export function RouteArrows({ id = 'route-arrows', source, fill, stroke, spacing = 90 }: { id?: string; source: string; fill: string; stroke: string; spacing?: number }) {
  const { current: ref } = useMap();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const map = ref?.getMap();
    if (!map) return;
    const add = () => {
      if (map.hasImage('arrow')) map.removeImage('arrow');
      map.addImage('arrow', arrowImage(fill, stroke));
      setReady(true);
    };
    if (map.isStyleLoaded()) add();
    else map.once('load', add);
  }, [ref, fill, stroke]);
  if (!ready) return null;
  return (
    <Layer
      id={id}
      type="symbol"
      source={source}
      layout={{ 'symbol-placement': 'line', 'symbol-spacing': spacing, 'icon-image': 'arrow', 'icon-size': 0.6, 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true }}
    />
  );
}
