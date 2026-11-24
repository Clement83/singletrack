import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { qrSvg, qrUrl } from '@/lib/outings/qr';

describe('outing QR (#1735)', () => {
  it('encodes exactly the page URL', async () => {
    const url = qrUrl('https://example.org', '/i/abc123');
    expect(url).toBe('https://example.org/i/abc123');
    const svg = await qrSvg(url);
    expect(svg).toContain('<svg');
    // The SVG is the rendering of the matrix of this very URL.
    const same = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
    expect(svg).toBe(same);
    expect(svg).not.toBe(await qrSvg(qrUrl('https://example.org', '/i/other')));
  });
});
