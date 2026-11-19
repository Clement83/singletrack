// Link preview of an outing (#1351): 1200 × 630 OpenGraph image generated on the server (next/og), with the line
// of the frozen track. Colours read from design/tokens.json (light theme: messaging apps show the preview on a light background).
import { ImageResponse } from 'next/og';
import tokens from '../../../design/tokens.json';
import type { OutingRow } from '@/db/schema';
import type { TrackGeometry } from '@/lib/geo/types';
import type { Locale } from '@/i18n/config';
import { translatorFor } from '@/i18n/server';
import { formatShareDate } from './export';

export const OG_SIZE = { width: 1200, height: 630 };
const color = (name: string) => tokens.color.find((c) => c.name === name)!.value.light;

/**
 * Line of a geometry projected into a `w × h` box (margin `pad`), aspect ratio kept (equirectangular
 * corrected for latitude), one SVG point string per line. Pure, tested.
 */
export function ogPaths(geometry: TrackGeometry, w: number, h: number, pad = 0): string[] {
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const all = lines.flat();
  if (all.length < 2) return [];
  const lats = all.map((p) => p[1]);
  const k = Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180));
  const xs = all.map((p) => p[0] * k);
  const minX = Math.min(...xs);
  const maxY = Math.max(...lats);
  const spanX = Math.max(...xs) - minX || 1e-9;
  const spanY = maxY - Math.min(...lats) || 1e-9;
  const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const ox = pad + (w - 2 * pad - spanX * s) / 2;
  const oy = pad + (h - 2 * pad - spanY * s) / 2;
  return lines.map((l) => l.map((p) => `${(ox + (p[0] * k - minX) * s).toFixed(1)},${(oy + (maxY - p[1]) * s).toFixed(1)}`).join(' '));
}

/** Preview image of an outing; `outing` absent (unknown or revoked link) ⇒ generic image, revealing nothing. */
export function outingOgImage(outing: Pick<OutingRow, 'title' | 'startsAt' | 'trackSnapshot'> | undefined, locale: Locale) {
  const t = translatorFor(locale);
  const paths = outing ? ogPaths(outing.trackSnapshot.geometry, 520, 520, 20) : [];
  const km = outing ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(outing.trackSnapshot.distanceM / 1000) : '';
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', background: color('background'), padding: 48, gap: 40 }}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1, gap: 20, color: color('foreground') }}>
          <div style={{ fontSize: 30, color: color('muted-foreground') }}>{t('share.ogInvite')}</div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{outing?.title ?? t('common.appName')}</div>
          {outing && <div style={{ fontSize: 36 }}>{formatShareDate(outing.startsAt, locale)}</div>}
          {outing && <div style={{ fontSize: 30, color: color('muted-foreground') }}>{`${km} km · ${outing.trackSnapshot.name}`}</div>}
          <div style={{ fontSize: 28, color: color('primary'), fontWeight: 700 }}>{t('common.appName')}</div>
        </div>
        {paths.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 534, height: 534, background: color('card'), borderRadius: 32 }}>
            <svg width="520" height="520" viewBox="0 0 520 520">
              {paths.map((d, i) => (
                <polyline key={i} points={d} fill="none" stroke={color('primary')} strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
              ))}
            </svg>
          </div>
        )}
      </div>
    ),
    OG_SIZE,
  );
}
