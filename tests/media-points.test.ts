import { describe, expect, it } from 'vitest';
import { mediaPoints, widenBbox } from '@/lib/outings/media-points';

describe('points de la carte des photos (#1702)', () => {
  it('photos et vidéos prêtes localisées ; sans position ou vidéo pas prête : exclues', () => {
    const pts = mediaPoints(
      [{ id: 'p1', pos: { lat: 43.2, lon: 6.3 } }, { id: 'p2', pos: null }],
      [
        { id: 'v1', pos: { lat: 43.21, lon: 6.31 }, status: 'ready' },
        { id: 'v2', pos: { lat: 43.22, lon: 6.32 }, status: 'pending' },
        { id: 'v3', pos: { lat: 43.23, lon: 6.33 }, status: 'failed' },
        { id: 'v4', pos: null, status: 'ready' },
      ],
    );
    expect(pts).toEqual([
      { id: 'p1', type: 'photo', lat: 43.2, lon: 6.3 },
      { id: 'v1', type: 'video', lat: 43.21, lon: 6.31 },
    ]);
  });
  it('widenBbox englobe tous les points', () => {
    expect(widenBbox([6, 43, 6.1, 43.1], [{ lat: 43.2, lon: 5.9 }])).toEqual([5.9, 43, 6.1, 43.2]);
  });
});
