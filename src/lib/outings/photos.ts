import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import sharp, { type OutputInfo } from 'sharp';
import type { Db } from '@/db';
import { invitation, outingPhoto, type OutingRow } from '@/db/schema';
import { readExifGps, validPos } from '@/lib/media/exif';
import type { Actor } from './comments';
import { canUploadRide } from './ride';

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
/** Photos par sortie, tous participants confondus (garde-fou disque). */
export const PHOTO_MAX_PER_OUTING = 60;
export const PHOTO_FULL_PX = 2000;
export const PHOTO_THUMB_PX = 480;

export type PhotoView = {
  id: string;
  author: string;
  organizer: boolean;
  mine: boolean;
  /** L'acteur peut la supprimer : l'auteur, ou l'organisateur (modération). */
  canDelete: boolean;
  width: number;
  height: number;
  /** Position arrondie (~10 m), seulement si la photo en avait une. */
  pos: { lat: number; lon: number } | null;
};

export type PhotoError = 'not_found' | 'closed' | 'tooEarly' | 'tooLarge' | 'notImage' | 'tooMany';
export type PhotoResult<T = object> = ({ ok: true } & T) | { ok: false; error: PhotoError };

/** Dossier des médias : `MEDIA_DIR`, sinon `media/` à côté de la base (bind mount `./data`). */
export function mediaDir(): string {
  return process.env.MEDIA_DIR || join(dirname(process.env.DATABASE_URL || './data/singletrack.db'), 'media');
}
const fileOf = (dir: string, outingId: string, id: string, thumb: boolean) => join(dir, outingId, `${id}${thumb ? '.thumb' : ''}.jpg`);

const isMine = (r: { invitationId: string | null; authorUserId: string | null }, a: Actor) =>
  a.kind === 'guest' ? r.invitationId === a.invitationId : r.invitationId === null && r.authorUserId === a.userId;

/**
 * Enregistre une photo. Le fichier est **toujours ré-encodé** (rotation EXIF appliquée, 2000 px max, JPEG) :
 * l'EXIF d'origine (appareil, date, GPS…) n'est jamais publié. Seule la position est conservée, en base,
 * pour placer la photo sur la carte — fournie par le navigateur (qui l'a lue avant compression) ou lue ici.
 */
export async function savePhoto(
  db: Db, o: OutingRow, actor: Actor, data: Buffer,
  opts: { pos?: { lat: number; lon: number } | null; now?: Date; dir?: string } = {},
): Promise<PhotoResult<{ id: string }>> {
  if (data.length > PHOTO_MAX_BYTES) return { ok: false, error: 'tooLarge' };
  if (o.status === 'cancelled') return { ok: false, error: 'closed' };
  if (!canUploadRide(o, opts.now)) return { ok: false, error: 'tooEarly' };
  if (db.select({ id: outingPhoto.id }).from(outingPhoto).where(eq(outingPhoto.outingId, o.id)).all().length >= PHOTO_MAX_PER_OUTING) {
    return { ok: false, error: 'tooMany' };
  }
  let full: { data: Buffer; info: OutputInfo };
  let thumb: Buffer;
  try {
    const pipe = () => sharp(data, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate();
    full = await pipe().resize({ width: PHOTO_FULL_PX, height: PHOTO_FULL_PX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    thumb = await pipe().resize({ width: PHOTO_THUMB_PX, height: PHOTO_THUMB_PX, fit: 'cover' }).jpeg({ quality: 72 }).toBuffer();
  } catch {
    return { ok: false, error: 'notImage' };
  }
  const found = opts.pos && validPos(opts.pos.lat, opts.pos.lon) ? opts.pos : readExifGps(data);
  const pos = found ? { lat: Math.round(found.lat * 1e4) / 1e4, lon: Math.round(found.lon * 1e4) / 1e4 } : null;
  const row = db.insert(outingPhoto).values({
    outingId: o.id, width: full.info.width, height: full.info.height, lat: pos?.lat ?? null, lon: pos?.lon ?? null,
    createdAt: opts.now,
    invitationId: actor.kind === 'guest' ? actor.invitationId : null,
    authorUserId: actor.kind === 'organizer' ? actor.userId : null,
  }).returning({ id: outingPhoto.id }).get();
  const dir = opts.dir ?? mediaDir();
  mkdirSync(join(dir, o.id), { recursive: true });
  writeFileSync(fileOf(dir, o.id, row.id, false), full.data);
  writeFileSync(fileOf(dir, o.id, row.id, true), thumb);
  return { ok: true, id: row.id };
}

/** Galerie : tous les participants voient toutes les photos de la sortie, des plus anciennes aux plus récentes. */
export function listPhotos(db: Db, outingId: string, actor: Actor): PhotoView[] {
  const rows = db.select({ p: outingPhoto, name: invitation.name }).from(outingPhoto)
    .leftJoin(invitation, eq(invitation.id, outingPhoto.invitationId))
    .where(eq(outingPhoto.outingId, outingId)).orderBy(asc(outingPhoto.createdAt), asc(outingPhoto.id)).all();
  return rows.map(({ p, name }) => {
    const mine = isMine(p, actor);
    return {
      id: p.id, author: name ?? '', organizer: p.invitationId === null, mine, canDelete: mine || actor.kind === 'organizer',
      width: p.width, height: p.height, pos: p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null,
    };
  });
}

/** Supprime une photo (auteur ou organisateur). `false` si inconnue ou non autorisée. */
export function deletePhoto(db: Db, o: OutingRow, actor: Actor, id: string, dir = mediaDir()): boolean {
  const p = db.select().from(outingPhoto).where(and(eq(outingPhoto.id, id), eq(outingPhoto.outingId, o.id))).get();
  if (!p || !(actor.kind === 'organizer' || isMine(p, actor))) return false;
  db.delete(outingPhoto).where(eq(outingPhoto.id, id)).run();
  for (const t of [false, true]) rmSync(fileOf(dir, o.id, id, t), { force: true });
  return true;
}

/** Octets JPEG d'une photo de la sortie (`null` si inconnue). L'id est un UUID relu en base : pas de chemin forgé. */
export function readPhoto(db: Db, outingId: string, id: string, thumb: boolean, dir = mediaDir()): Buffer | null {
  const p = db.select({ id: outingPhoto.id }).from(outingPhoto).where(and(eq(outingPhoto.id, id), eq(outingPhoto.outingId, outingId))).get();
  if (!p) return null;
  const f = fileOf(dir, outingId, p.id, thumb);
  return existsSync(f) ? readFileSync(f) : null;
}

/** Pour les tests de suppression en cascade : fichiers d'une sortie. */
export function photoFileExists(outingId: string, id: string, dir = mediaDir()): boolean {
  return existsSync(fileOf(dir, outingId, id, false));
}
