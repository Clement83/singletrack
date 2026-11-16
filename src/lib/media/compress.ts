import { readExifGps, type GpsPos } from './exif';

export const COMPRESS_MAX_PX = 2000;
const EXIF_HEAD = 256 * 1024;

/** Position EXIF lue dans l'original (le canvas efface l'EXIF : on la lit avant) ; le serveur ne publie jamais l'EXIF. */
export async function readFilePosition(file: File): Promise<GpsPos | null> {
  try {
    return readExifGps(new Uint8Array(await file.slice(0, EXIF_HEAD).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Réduit une photo avant l'envoi (2000 px max, JPEG 82 %) : un cliché de téléphone de 6 Mo passe en ~500 Ko,
 * ce qui compte sur la 4G d'un sentier. Rotation EXIF appliquée par le navigateur. Si le navigateur ne sait pas
 * décoder le fichier (HEIC hors Safari…), on renvoie l'original et le serveur tranche.
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
