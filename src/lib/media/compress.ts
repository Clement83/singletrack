import { readExifDate, readExifGps, type ExifDate, type GpsPos } from './exif';

export const COMPRESS_MAX_PX = 2000;
const EXIF_HEAD = 256 * 1024;

/** EXIF position read from the original (the canvas strips EXIF: it is read first); the server never publishes EXIF. */
export async function readFilePosition(file: File): Promise<GpsPos | null> {
  try {
    return readExifGps(new Uint8Array(await file.slice(0, EXIF_HEAD).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Shrinks a photo before upload (2000 px max, JPEG 82 %): a 6 MB phone shot becomes ~500 KB,
 * which matters on a trail's 4G. EXIF rotation applied by the browser. If the browser cannot
 * decode the file (HEIC outside Safari…), the original is returned and the server decides.
 */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, COMPRESS_MAX_PX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k);
    const h = Math.round(bmp.height * k);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** EXIF capture time read from the original, before compression (#1692). */
export async function readFileDate(file: File): Promise<ExifDate | null> {
  try {
    return readExifDate(new Uint8Array(await file.slice(0, EXIF_HEAD).arrayBuffer()));
  } catch {
    return null;
  }
}
