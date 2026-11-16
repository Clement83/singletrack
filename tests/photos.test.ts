import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { openDb } from '@/db';
import { invitation, outing, outingPhoto, user } from '@/db/schema';
import { upsertTrack } from '@/lib/tracks';
import { createOuting, deletePhoto, listPhotos, PHOTO_MAX_PER_OUTING, readPhoto, savePhoto, _resetRateLimit } from '@/lib/outings';
import { readExifGps } from '@/lib/media/exif';

/** JPEG minimal avec un APP1 Exif contenant un GPS (43°13'30" N, 6°8'45" E) + un faux numéro de série. */
function jpegWithGps(base: Buffer, ref = ['N', 'E']): Buffer {
  const le = true;
  const parts: number[] = [];
  const w16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
  const w32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
  void le;
  parts.push(0x49, 0x49); w16(42); w32(8);
  // IFD0 : 1 entrée GPS pointer (0x8825) vers l'offset 26
  w16(1); w16(0x8825); w16(4); w32(1); w32(26); w32(0);
  // GPS IFD @26 : 4 entrées
  w16(4);
  const asc = (tag: number, c: string) => { w16(tag); w16(2); w32(2); parts.push(c.charCodeAt(0), 0, 0, 0); };
  const rat = (tag: number, off: number) => { w16(tag); w16(5); w32(3); w32(off); };
  asc(1, ref[0]); rat(2, 26 + 2 + 48 + 4); asc(3, ref[1]); rat(4, 26 + 2 + 48 + 4 + 24); w32(0);
  for (const [n] of [[43], [13], [30]]) { w32(n); w32(1); }
  for (const [n] of [[6], [8], [45]]) { w32(n); w32(1); }
  const tiff = Buffer.from(parts);
  const body = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)]);
}
const jpeg = (w = 3000, h = 2000) => sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } }).jpeg().toBuffer();

async function setup() {
  const { db } = openDb(':memory:');
  db.insert(user).values([{ id: 'u1', name: 'Orga', email: 'o@x.fr' }]).run();
  const t = await upsertTrack(db, {
    source: 'osm', externalId: 'r1', name: 'Boucle', license: 'ODbL', attribution: '© OSM',
    geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, i) => [6.1 + i * 0.002, 43.2, 100 + i * 10] as [number, number, number]) }, raw: {},
  }, { enrich: false });
  const r = await createOuting(db, 'u1', { trackSlug: t.slug, title: 'Sortie', date: '2026-11-14', time: '08:00' });
  if (!('slug' in r)) throw new Error('création');
  const o = db.select().from(outing).where(eq(outing.slug, r.slug)).get()!;
  db.insert(invitation).values({ id: 'i1', outingId: o.id, tokenHash: 'h1', name: 'Léa', status: 'yes' }).run();
  return { db, o, guest: { kind: 'guest' as const, invitationId: 'i1' }, orga: { kind: 'organizer' as const, userId: 'u1' } };
}
const after = new Date('2026-11-14T12:00:00Z');
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'media-')); _resetRateLimit(); });

describe('exif GPS (#1413)', () => {
  it('lit la position, N/E', async () => {
    const p = readExifGps(jpegWithGps(await jpeg(64, 64)))!;
    expect(p.lat).toBeCloseTo(43.225, 3);
    expect(p.lon).toBeCloseTo(6.1458, 3);
  });
  it('S/W inverse les signes ; pas d’EXIF ou fichier bancal → null', async () => {
    const p = readExifGps(jpegWithGps(await jpeg(64, 64), ['S', 'W']))!;
    expect(p.lat).toBeLessThan(0);
    expect(p.lon).toBeLessThan(0);
    expect(readExifGps(await jpeg(64, 64))).toBeNull();
    expect(readExifGps(Buffer.from('pas une image'))).toBeNull();
    expect(readExifGps(jpegWithGps(await jpeg(64, 64)).subarray(0, 30))).toBeNull();
  });
});

describe('savePhoto (#1413)', () => {
  it('réduit à 2000 px, retire l’EXIF du fichier publié, garde la position en base', async () => {
    const { db, o, guest } = await setup();
    const r = await savePhoto(db, o, guest, jpegWithGps(await jpeg()), { now: after, dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = readPhoto(db, o.id, r.id, false, dir)!;
    const meta = await sharp(out).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(meta.exif).toBeUndefined();
    expect(readExifGps(out)).toBeNull();
    const thumb = await sharp(readPhoto(db, o.id, r.id, true, dir)!).metadata();
    expect(thumb.width).toBe(480);
    const row = db.select().from(outingPhoto).get()!;
    expect(row.lat).toBeCloseTo(43.225, 3);
    expect(row.invitationId).toBe('i1');
  });
  it('la position fournie par le navigateur prime ; hors plage ignorée', async () => {
    const { db, o, guest } = await setup();
    await savePhoto(db, o, guest, await jpeg(100, 100), { now: after, dir, pos: { lat: 43.3, lon: 6.2 } });
    await savePhoto(db, o, guest, await jpeg(100, 100), { now: after, dir, pos: { lat: 999, lon: 6.2 } });
    const rows = db.select().from(outingPhoto).all();
    expect(rows.map((r) => r.lat).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([null, 43.3]);
  });
  it('refuse : non-image, trop gros, sortie annulée, trop tôt, quota', async () => {
    const { db, o, guest } = await setup();
    expect(await savePhoto(db, o, guest, Buffer.from('<svg onload=1>'), { now: after, dir })).toEqual({ ok: false, error: 'notImage' });
    expect(await savePhoto(db, o, guest, Buffer.alloc(11 * 1024 * 1024), { now: after, dir })).toEqual({ ok: false, error: 'tooLarge' });
    expect(await savePhoto(db, o, guest, await jpeg(50, 50), { now: new Date('2026-11-01T00:00:00Z'), dir })).toEqual({ ok: false, error: 'tooEarly' });
    expect(await savePhoto(db, { ...o, status: 'cancelled' }, guest, await jpeg(50, 50), { now: after, dir })).toEqual({ ok: false, error: 'closed' });
    db.insert(outingPhoto).values(Array.from({ length: PHOTO_MAX_PER_OUTING }, () => ({ outingId: o.id, width: 1, height: 1 }))).run();
    expect(await savePhoto(db, o, guest, await jpeg(50, 50), { now: after, dir })).toEqual({ ok: false, error: 'tooMany' });
  });
});

describe('galerie et suppression (#1413)', () => {
  it('tous voient tout ; l’auteur supprime la sienne, l’organisateur toutes, un invité pas celle d’un autre', async () => {
    const { db, o, guest, orga } = await setup();
    const a = await savePhoto(db, o, guest, await jpeg(80, 60), { now: after, dir });
    const b = await savePhoto(db, o, orga, await jpeg(80, 60), { now: after, dir });
    if (!a.ok || !b.ok) throw new Error('save');
    const asGuest = listPhotos(db, o.id, guest);
    expect(asGuest).toHaveLength(2);
    expect(asGuest.find((p) => p.id === a.id)).toMatchObject({ author: 'Léa', mine: true, canDelete: true });
    expect(asGuest.find((p) => p.id === b.id)).toMatchObject({ organizer: true, mine: false, canDelete: false });
    expect(deletePhoto(db, o, guest, b.id, dir)).toBe(false);
    expect(deletePhoto(db, o, guest, a.id, dir)).toBe(true);
    expect(existsSync(join(dir, o.id, `${a.id}.jpg`))).toBe(false);
    expect(deletePhoto(db, o, orga, b.id, dir)).toBe(true);
    expect(listPhotos(db, o.id, orga)).toHaveLength(0);
  });
  it('une photo d’une autre sortie est introuvable (id forgé)', async () => {
    const { db, o, guest } = await setup();
    const a = await savePhoto(db, o, guest, await jpeg(80, 60), { now: after, dir });
    if (!a.ok) throw new Error('save');
    expect(readPhoto(db, 'autre', a.id, false, dir)).toBeNull();
    expect(readPhoto(db, o.id, '../../etc/passwd', false, dir)).toBeNull();
  });
});
