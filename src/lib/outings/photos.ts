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
  /** The actor may delete it: the author, or the organiser (moderation). */
  canDelete: boolean;
  width: number;
  height: number;
  /** Capture time (epoch ms) if the browser could read it (#1692). */
  takenAt: number | null;
  /** Rounded position (~10 m), only if the photo had one. */
  pos: { lat: number; lon: number } | null;
};

export type PhotoError = 'not_found' | 'closed' | 'tooEarly' | 'tooLarge' | 'notImage' | 'tooMany';
export type PhotoResult<T = object> = ({ ok: true } & T) | { ok: false; error: PhotoError };

/** Media folder: `MEDIA_DIR`, otherwise `media/` next to the database (`./data` bind mount). */
export function mediaDir(): string {
  return process.env.MEDIA_DIR || join(dirname(process.env.DATABASE_URL || './data/singletrack.db'), 'media');
}
const fileOf = (dir: string, outingId: string, id: string, thumb: boolean) => join(dir, outingId, `${id}${thumb ? '.thumb' : ''}.jpg`);

/** The actor uploaded this media (guest: same invitation; organiser: same account, not through an invitation). */
export const isMine = (r: { invitationId: string | null; authorUserId: string | null }, a: Actor) =>
  a.kind === 'guest' ? r.invitationId === a.invitationId : r.invitationId === null && r.authorUserId === a.userId;

/**
 * Stores a photo. The file is **always re-encoded** (EXIF rotation applied, 2000 px max, JPEG):
 * the original EXIF (camera, GPS…) is never published. Only the position and the capture time are kept, in the database,
 * to place the photo on the map — provided by the browser (which read it before compression) or read here.
 */
export async function savePhoto(
  db: Db, o: OutingRow, actor: Actor, data: Buffer,
  opts: { pos?: { lat: number; lon: number } | null; takenAt?: number | null; now?: Date; dir?: string } = {},
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
    outingId: o.id, width: full.info.width, height: full.info.height, lat: pos?.lat ?? null, lon: pos?.lon ?? null, takenAt: opts.takenAt ?? null,
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

/** Gallery: every participant sees every photo of the outing, oldest first. */
export function listPhotos(db: Db, outingId: string, actor: Actor): PhotoView[] {
  const rows = db.select({ p: outingPhoto, name: invitation.name }).from(outingPhoto)
    .leftJoin(invitation, eq(invitation.id, outingPhoto.invitationId))
    .where(eq(outingPhoto.outingId, outingId)).orderBy(asc(outingPhoto.createdAt), asc(outingPhoto.id)).all();
  return rows.map(({ p, name }) => {
    const mine = isMine(p, actor);
    return {
      id: p.id, author: name ?? '', organizer: p.invitationId === null, mine, canDelete: mine || actor.kind === 'organizer',
      width: p.width, height: p.height, takenAt: p.takenAt, pos: p.lat != null && p.lon != null ? { lat: p.lat, lon: p.lon } : null,
    };
  });
}

/** Deletes a photo (author or organiser). `false` if unknown or not allowed. */
export function deletePhoto(db: Db, o: OutingRow, actor: Actor, id: string, dir = mediaDir()): boolean {
  const p = db.select().from(outingPhoto).where(and(eq(outingPhoto.id, id), eq(outingPhoto.outingId, o.id))).get();
  if (!p || !(actor.kind === 'organizer' || isMine(p, actor))) return false;
  db.delete(outingPhoto).where(eq(outingPhoto.id, id)).run();
  for (const t of [false, true]) rmSync(fileOf(dir, o.id, id, t), { force: true });
  return true;
}

/** JPEG bytes of a photo of the outing (`null` if unknown). The id is a UUID read back from the database: no forged path. */
export function readPhoto(db: Db, outingId: string, id: string, thumb: boolean, dir = mediaDir()): Buffer | null {
  const p = db.select({ id: outingPhoto.id }).from(outingPhoto).where(and(eq(outingPhoto.id, id), eq(outingPhoto.outingId, outingId))).get();
  if (!p) return null;
  const f = fileOf(dir, outingId, p.id, thumb);
  return existsSync(f) ? readFileSync(f) : null;
}

/** For cascade-deletion tests: files of an outing. */
export function photoFileExists(outingId: string, id: string, dir = mediaDir()): boolean {
  return existsSync(fileOf(dir, outingId, id, false));
}
