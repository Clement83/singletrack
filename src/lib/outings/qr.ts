import QRCode from 'qrcode';

/** Absolute URL encoded in the outing QR (#1735): origin + path, nothing else. */
export function qrUrl(origin: string, path: string): string {
  return `${origin}${path}`;
}

/** SVG of the QR code, generated locally (no network call). qrcode defaults: black on white. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}
